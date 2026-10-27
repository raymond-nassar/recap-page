import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { isCloudMatchTag } from './cloudProviderTransport.mjs';
import { selectCloudStreamSlot } from './cloudStreamLedger.mjs';
import { createCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';

const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;
export const MICROSOFT_CLOUD_SLOT_SEED = '{"format":"recap-page-reserved-cloud-slot","version":1}';

export class CloudMicrosoftWriteError extends Error {
  constructor(message = 'Microsoft backup could not be verified. Preserve the stream journal; later writes remain fenced.') {
    super(message);
    this.name = 'CloudMicrosoftWriteError';
  }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function refuse(message) { throw new CloudMicrosoftWriteError(message); }
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value) && !['.', '..'].includes(value);
}

export function createMicrosoftCloudSlotWriter({ destination, accountId, ledger, request, reads, isCurrent }) {
  if (!destination || destination.provider !== 'microsoft' || !HEX.test(destination.profileId)
    || !HEX.test(destination.streamId) || !HEX.test(destination.client)
    || !identifier(destination.appRootId) || !identifier(destination.driveId)
    || typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024
    || destination.account !== hash(accountId) || !Array.isArray(destination.fixedSlots)
    || destination.fixedSlots.length !== 2 || !destination.fixedSlots.every(identifier)
    || destination.fixedSlots[0] === destination.fixedSlots[1]
    || typeof ledger?.inspect !== 'function' || typeof ledger.prepare !== 'function'
    || typeof ledger.dispatch !== 'function' || typeof ledger.markUnknown !== 'function'
    || typeof ledger.settle !== 'function' || typeof request !== 'function'
    || typeof reads?.listFiles !== 'function' || typeof reads.readConditionalFile !== 'function'
    || typeof isCurrent !== 'function') {
    throw new TypeError('Microsoft slot writes require an exact native destination, conditional reader and guarded ledger.');
  }
  const { profileId, streamId, appRootId, driveId } = destination;
  const fixedSlots = destination.fixedSlots.slice();
  const binding = { profileId, provider: 'microsoft', account: destination.account, streamId };
  function current() {
    if (isCurrent() !== true) refuse('The cloud connection changed. Preserve the unresolved stream before reconnecting.');
  }
  async function root() {
    current();
    const response = await request({
      target: `/v1.0/me/drive/items/${encodeURIComponent(appRootId)}?$select=id,folder,parentReference,specialFolder`,
      maxBytes: MAX_METADATA,
    });
    current();
    if (response.status !== 200 || !Buffer.isBuffer(response.bytes) || response.bytes.length > MAX_METADATA) refuse();
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); }
    catch { refuse('Microsoft app-root metadata is incomplete. No upload started.'); }
    if (value?.id !== appRootId || !value.folder || typeof value.folder !== 'object' || Array.isArray(value.folder)
      || value.parentReference?.driveId !== driveId
      || typeof value.specialFolder?.name !== 'string' || value.specialFolder.name.toLowerCase() !== 'approot') {
      refuse('Microsoft app-root ownership changed. No upload started.');
    }
  }
  async function write({ bytes, components, label, epoch, complete = false }) {
    if (!Number.isSafeInteger(epoch) || epoch < 1
      || (complete ? !components || typeof components !== 'object' || Array.isArray(components)
        || typeof label !== 'string' || !label.trim() || label.length > 200
        : !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES)) {
      refuse('Microsoft backup requires a bounded complete snapshot and current connection epoch.');
    }
    let content;
    try { content = complete ? globalThis.structuredClone(components) : Buffer.from(bytes); }
    catch { refuse('Microsoft backup input could not be captured. No upload started.'); }
    current();
    const previous = await ledger.inspect();
    current();
    if (JSON.stringify(previous.binding) !== JSON.stringify(binding)
      || JSON.stringify(previous.fixedSlots) !== JSON.stringify(fixedSlots)
      || (previous.attempt && !['acknowledged', 'failed'].includes(previous.attempt.phase))) {
      refuse('Microsoft backup destination or stream intent is unresolved.');
    }
    await root();
    const files = await reads.listFiles();
    current();
    if (!Array.isArray(files)) refuse('Microsoft app-data discovery is incomplete.');
    const conditions = [];
    for (let slot = 0; slot < 2; slot++) {
      if (files.filter((file) => file?.id === fixedSlots[slot]).length !== 1) {
        refuse('Microsoft fixed slot differs from its protected destination. No upload started.');
      }
      const selected = await reads.readConditionalFile({ id: fixedSlots[slot] });
      current();
      if (selected.file?.id !== fixedSlots[slot] || !Number.isSafeInteger(selected.file.size)
        || selected.file.size < 0 || selected.file.size > MAX_BYTES || !Buffer.isBuffer(selected.bytes)
        || selected.bytes.length !== selected.file.size || !isCloudMatchTag(selected.condition)
        || hash(selected.bytes) !== (previous.snapshots[slot]?.digest ?? hash(MICROSOFT_CLOUD_SLOT_SEED))) {
        refuse('Microsoft owned slot bytes changed or were not reserved by this installation. No upload started.');
      }
      conditions.push(selected.condition);
    }
    const slot = selectCloudStreamSlot(previous);
    const generation = previous.maxGeneration + 1;
    const requestedAttemptId = randomBytes(32).toString('hex');
    const snapshotBytes = complete ? Buffer.from((await createCloudSnapshot(content, {
      captureId: randomBytes(32).toString('hex'), streamId, slotId: fixedSlots[slot],
      attemptId: requestedAttemptId, generation, capturedAt: new Date().toISOString(), label,
    })).text) : content;
    current();
    const prepared = await ledger.prepare({
      digest: hash(snapshotBytes), epoch, requestedAttemptId, expectedSequence: previous.sequence, condition: conditions[slot],
      byteLength: snapshotBytes.length,
    });
    const attempt = prepared.attempt;
    if (prepared.sequence !== previous.sequence + 1 || attempt.id !== requestedAttemptId
      || attempt.generation !== generation || attempt.slot !== slot || attempt.condition !== conditions[slot]
      || JSON.stringify(prepared.snapshots) !== JSON.stringify(previous.snapshots)) {
      refuse('Microsoft stream changed during slot validation. Preserve its prepared intent before recovery.');
    }
    current();
    await ledger.dispatch({ attemptId: attempt.id });
    try {
      current();
      const response = await request({
        target: `/v1.0/me/drive/items/${encodeURIComponent(fixedSlots[slot])}/content`,
        method: 'PUT', body: snapshotBytes, ifMatch: attempt.condition, maxBytes: MAX_METADATA,
      });
      current();
      if (![200, 201].includes(response.status)) refuse();
      return await ledger.settle({ attemptId: attempt.id });
    } catch (error) {
      const state = await ledger.inspect();
      if (state.attempt?.id === attempt.id && state.attempt.phase === 'in-flight') {
        await ledger.markUnknown({ attemptId: attempt.id });
      }
      throw copyCloudFailureMetadata(new CloudMicrosoftWriteError(), error, { unknown: true });
    }
  }
  return {
    write: ({ bytes, epoch }) => write({ bytes, epoch }),
    writeSnapshot: ({ components, label, epoch }) => write({ components, label, epoch, complete: true }),
  };
}
