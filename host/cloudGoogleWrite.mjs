import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { validateCloudUploadSession } from './cloudProviderTransport.mjs';
import { selectCloudStreamSlot } from './cloudStreamLedger.mjs';
import { createCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';

const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;

export class CloudGoogleWriteError extends Error {
  constructor(message = 'Google backup could not be verified. Preserve the stream journal; later writes remain fenced.') {
    super(message);
    this.name = 'CloudGoogleWriteError';
  }
}

function refuse(message) { throw new CloudGoogleWriteError(message); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

// A write is never acknowledged by its content PUT; only the ledger's native verifier can settle it.
export function createGoogleCloudSlotWriter({ destination, accountId, ledger, sessions, request, reads, isCurrent }) {
  if (!destination || destination.provider !== 'google' || !HEX.test(destination.profileId)
    || !HEX.test(destination.streamId) || destination.appRootId !== 'appDataFolder'
    || destination.driveId !== null || typeof accountId !== 'string' || !accountId
    || Buffer.byteLength(accountId) > 1024 || destination.account !== hash(accountId)
    || !Array.isArray(destination.fixedSlots) || destination.fixedSlots.length !== 2
    || destination.fixedSlots.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9!_.:-]{1,256}$/.test(id))
    || destination.fixedSlots[0] === destination.fixedSlots[1]
    || typeof ledger?.inspect !== 'function' || typeof ledger.prepare !== 'function'
    || typeof ledger.dispatch !== 'function' || typeof ledger.attachSession !== 'function'
    || typeof ledger.settle !== 'function' || typeof ledger.markUnknown !== 'function' || typeof sessions?.save !== 'function'
    || typeof request !== 'function' || typeof reads?.listFiles !== 'function'
    || typeof reads.readFile !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('Google slot writes require a native destination, guarded ledger and protected session store.');
  }
  const { profileId, streamId } = destination;
  const fixedSlots = destination.fixedSlots.slice();
  const binding = { profileId, provider: 'google', account: destination.account, streamId };
  function current() {
    if (isCurrent() !== true) refuse('The cloud connection changed. Preserve the unresolved stream before reconnecting.');
  }
  function name(slot) { return `recap-backup-${streamId}-${slot}.json`; }
  async function write({ bytes, epoch, components, label, complete = false }) {
    if (!Number.isSafeInteger(epoch) || epoch < 1
        || (complete ? !components || typeof components !== 'object' || Array.isArray(components)
          || typeof label !== 'string' || !label.trim() || label.length > 200
          : !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES)) {
      refuse('Google backup requires a bounded complete snapshot and current connection epoch.');
    }
    let content;
    try { content = complete ? globalThis.structuredClone(components) : Buffer.from(bytes); }
    catch { refuse('Google backup input could not be captured. No upload started.'); }
    current();
    const previous = await ledger.inspect();
    if (JSON.stringify(previous.binding) !== JSON.stringify(binding)
        || JSON.stringify(previous.fixedSlots) !== JSON.stringify(fixedSlots)
        || (previous.attempt && !['acknowledged', 'failed'].includes(previous.attempt.phase))) {
      refuse('Google backup destination or stream intent is unresolved.');
    }
    const files = await reads.listFiles();
    current();
    if (!Array.isArray(files)) refuse('Google app-data discovery is incomplete.');
    for (let slot = 0; slot < 2; slot++) {
      const matches = files.filter((file) => file.id === fixedSlots[slot] || file.name === name(slot));
      const committed = previous.snapshots[slot];
      if (matches.length !== (committed ? 1 : 0)
          || (committed && (matches[0].id !== fixedSlots[slot] || matches[0].name !== name(slot)))) {
        refuse('Google fixed slot differs from the protected destination. No upload started.');
      }
      if (committed) {
        const read = await reads.readFile({ id: fixedSlots[slot] });
        current();
        if (read.file?.id !== fixedSlots[slot] || read.file.name !== name(slot) || !Buffer.isBuffer(read.bytes)
            || hash(read.bytes) !== committed.digest) {
          refuse('Google committed slot changed. No upload started.');
        }
      }
    }
    const requestedAttemptId = randomBytes(32).toString('hex');
    const slot = selectCloudStreamSlot(previous);
    const generation = previous.maxGeneration + 1;
    const snapshotBytes = complete ? Buffer.from((await createCloudSnapshot(content, {
      captureId: randomBytes(32).toString('hex'), streamId, slotId: fixedSlots[slot],
      attemptId: requestedAttemptId, generation, capturedAt: new Date().toISOString(), label,
    })).text) : content;
    current();
    const prepared = await ledger.prepare({
      digest: hash(snapshotBytes), epoch, requestedAttemptId, expectedSequence: previous.sequence, byteLength: snapshotBytes.length,
    });
    const attempt = prepared.attempt;
    if (prepared.sequence !== previous.sequence + 1
        || attempt.id !== requestedAttemptId || attempt.generation !== generation || attempt.slot !== slot
        || JSON.stringify(prepared.snapshots) !== JSON.stringify(previous.snapshots)) {
      refuse('Google stream changed during slot validation. Preserve its prepared intent before recovery.');
    }
    const slotId = fixedSlots[attempt.slot];
    const target = previous.snapshots[attempt.slot]
      ? `/upload/drive/v3/files/${encodeURIComponent(slotId)}?uploadType=resumable&fields=id,size`
      : '/upload/drive/v3/files?uploadType=resumable&fields=id,size';
    const metadata = previous.snapshots[attempt.slot] ? {}
      : { id: slotId, name: name(attempt.slot), parents: ['appDataFolder'], mimeType: 'application/json' };
    current();
    await ledger.dispatch({ attemptId: attempt.id });
    try {
      current();
      const start = await request({
        target, method: previous.snapshots[attempt.slot] ? 'PATCH' : 'POST',
        body: JSON.stringify(metadata), uploadSize: snapshotBytes.length, maxBytes: 1024 * 1024,
      });
      current();
      if (start.status !== 200 || typeof start.location !== 'string') refuse();
      const session = validateCloudUploadSession('google', start.location);
      const reference = await sessions.save({
        binding: { profileId, provider: 'google', accountId, streamId, attemptId: attempt.id,
          epoch, slotId },
        target: session,
      });
      current();
      await ledger.attachSession({ attemptId: attempt.id, sessionReference: reference });
      const uploaded = await request({
        kind: 'session', target: session, method: 'PUT',
        body: snapshotBytes, contentRange: `bytes 0-${snapshotBytes.length - 1}/${snapshotBytes.length}`,
        maxBytes: 1024 * 1024,
      });
      current();
      if (![200, 201].includes(uploaded.status)) refuse();
      return await ledger.settle({ attemptId: attempt.id, evidence: { byteLength: snapshotBytes.length } });
    } catch (error) {
      // An in-flight record is already a durable fence, even if marking it unknown fails.
      const state = await ledger.inspect();
      if (state.attempt?.id === attempt.id && state.attempt.phase === 'in-flight') {
        await ledger.markUnknown({ attemptId: attempt.id });
      }
      throw copyCloudFailureMetadata(new CloudGoogleWriteError(), error, { unknown: true });
    }
  }
  return {
    write: ({ bytes, epoch }) => write({ bytes, epoch }),
    writeSnapshot: ({ components, label, epoch }) => write({ components, label, epoch, complete: true }),
  };
}
