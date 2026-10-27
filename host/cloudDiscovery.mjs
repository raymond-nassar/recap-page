import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { MICROSOFT_CLOUD_SLOT_SEED } from './cloudMicrosoftWrite.mjs';
import { MICROSOFT_PUBLICATION_SEED, requireMicrosoftPublicationSnapshot } from './cloudMicrosoftPublicationRecord.mjs';

export const CLOUD_SLOT_NAME = /^recap-backup-([a-f0-9]{64})-([01])\.json$/;
const MAX_DISCOVERY_BYTES = 64 * 1024 * 1024;
class InvalidSnapshot extends Error {}

export class CloudDiscoveryError extends Error {
  constructor() {
    super('Cloud backup discovery is incomplete or changed. No initial choice or restore was authorized.');
    this.name = 'CloudDiscoveryError';
  }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

// Only fully decoded snapshots become choices. Names, timestamps and provider eTags are not commit authority.
export function createCloudDiscovery({ reads, isCurrent }) {
  if (typeof reads?.listFiles !== 'function' || typeof reads.readFile !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('Native cloud discovery requires bounded reads and an exact connection.');
  }
  function current() { if (isCurrent() !== true) throw new CloudDiscoveryError(); }
  async function selected(file) {
    current();
    const result = await reads.readFile(file);
    current();
    if (result.file?.id !== file.id || result.file.name !== file.name || !Buffer.isBuffer(result.bytes)
      || result.file.size !== result.bytes.length || result.bytes.length !== file.size) throw new CloudDiscoveryError();
    if (result.bytes.equals(Buffer.from(MICROSOFT_CLOUD_SLOT_SEED))
      || result.bytes.equals(Buffer.from(MICROSOFT_PUBLICATION_SEED))) return { reserved: true };
    let snapshot;
    try {
      snapshot = await parseCloudSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
      if (result.publication) requireMicrosoftPublicationSnapshot(result.publication, snapshot, result.bytes);
    }
    catch { throw new InvalidSnapshot(); }
    current();
    const match = CLOUD_SLOT_NAME.exec(file.name);
    if (!match || snapshot.streamId !== match[1] || snapshot.slotId !== file.id) throw new InvalidSnapshot();
    return { snapshot, digest: hash(result.bytes) };
  }
  return {
    async discover() {
      try {
        current();
        const files = await reads.listFiles();
        current();
        if (!Array.isArray(files) || files.length > 2000) throw new CloudDiscoveryError();
        const candidates = files.filter((file) => CLOUD_SLOT_NAME.test(file?.name));
        if (candidates.length > 128) throw new CloudDiscoveryError();
        const groups = new Map();
        const rejected = [];
        const ids = new Set();
        const positions = new Set();
        let total = 0;
        for (const file of candidates) {
          if (typeof file.id !== 'string' || ids.has(file.id) || !Number.isSafeInteger(file.size)
            || file.size < 1 || file.size > 32 * 1024 * 1024
            || (total += file.size) > MAX_DISCOVERY_BYTES) throw new CloudDiscoveryError();
          ids.add(file.id);
          const [, streamId, slot] = CLOUD_SLOT_NAME.exec(file.name);
          let group = groups.get(streamId);
          if (!group) { group = { slots: [null, null], invalid: false }; groups.set(streamId, group); }
          const position = `${streamId}:${slot}`;
          if (positions.has(position)) group.invalid = true;
          positions.add(position);
          try {
            const result = await selected(file);
            if (result.reserved) continue;
            const { snapshot, digest } = result;
            const summary = {
              id: file.id, name: file.name, size: file.size, modifiedAt: file.modifiedAt,
              generation: snapshot.generation, attemptId: snapshot.attemptId, captureId: snapshot.captureId,
              capturedAt: snapshot.capturedAt, label: snapshot.label, contentDigest: snapshot.contentDigest,
              digest, version: snapshot.version,
            };
            group.slots[Number(slot)] = summary;
          } catch (error) {
            current();
            if (!(error instanceof InvalidSnapshot)) throw error;
            group.invalid = true;
            rejected.push({ id: file.id, reason: 'invalid-snapshot' });
          }
        }
        const streams = [];
        for (const [streamId, group] of groups) {
          const valid = group.slots.filter(Boolean).sort((a, b) => b.generation - a.generation);
          if (group.invalid || !valid.length || (valid.length === 2 && (valid[0].generation === valid[1].generation
            || valid[0].attemptId === valid[1].attemptId || valid[0].id === valid[1].id))) {
            for (const file of valid) rejected.push({ id: file.id, reason: 'ambiguous-stream' });
          } else streams.push({ streamId, current: valid[0], previous: valid[1] ?? null });
        }
        current();
        return { streams: streams.sort((a, b) => a.streamId.localeCompare(b.streamId)), rejected };
      } catch { throw new CloudDiscoveryError(); }
    },
    async readSnapshot({ streamId, selection }) {
      try {
        if (typeof streamId !== 'string' || !/^[a-f0-9]{64}$/.test(streamId) || !selection) throw new CloudDiscoveryError();
        const result = await selected(selection);
        if (result.reserved || result.digest !== selection.digest || result.snapshot.streamId !== streamId
          || result.snapshot.generation !== selection.generation || result.snapshot.attemptId !== selection.attemptId) {
          throw new CloudDiscoveryError();
        }
        return result.snapshot;
      } catch { throw new CloudDiscoveryError(); }
    },
  };
}
