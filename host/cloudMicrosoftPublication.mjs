import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { createCloudSnapshot, parseCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { selectCloudStreamSlot } from './cloudStreamLedger.mjs';
import { isCloudMatchTag, validateCloudUploadSession } from './cloudProviderTransport.mjs';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';
import { createMicrosoftPublicationReads } from './cloudMicrosoftPublicationReads.mjs';
import {
  MICROSOFT_PUBLICATION_PROTOCOL, MICROSOFT_PUBLICATION_SEED, decodeMicrosoftPublicationDescription,
  encodeMicrosoftPublication, microsoftPayloadName, requireMicrosoftPublicationSnapshot,
} from './cloudMicrosoftPublicationRecord.mjs';

const HEX = /^[a-f0-9]{64}$/;
const SEED = Buffer.from(MICROSOFT_PUBLICATION_SEED);
const TERMINAL = new Set(['acknowledged', 'failed']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value)
  && !['.', '..'].includes(value);

export class CloudMicrosoftPublicationError extends Error {
  constructor(message = 'OneDrive publication could not be verified. Local progress and unresolved cloud records remain preserved.') {
    super(message);
    this.name = 'CloudMicrosoftPublicationError';
  }
}
function refuse(message) { throw new CloudMicrosoftPublicationError(message); }
function metadata(reply, statuses = [200]) {
  if (!reply || !statuses.includes(reply.status) || !Buffer.isBuffer(reply.bytes)
    || reply.bytes.length > 1024 * 1024) refuse();
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes)); }
  catch { refuse(); }
}

export function createMicrosoftCloudPublication({ destination, accountId, ledger, request, reads: raw, sessions, isCurrent }) {
  if (destination?.protocol !== MICROSOFT_PUBLICATION_PROTOCOL || destination.provider !== 'microsoft'
    || !HEX.test(destination.profileId) || !HEX.test(destination.streamId) || !HEX.test(destination.client)
    || typeof accountId !== 'string' || !accountId || destination.account !== hash(accountId)
    || !identifier(destination.appRootId) || !identifier(destination.driveId)
    || !Array.isArray(destination.fixedSlots) || destination.fixedSlots.length !== 2
    || !destination.fixedSlots.every(identifier) || destination.fixedSlots[0] === destination.fixedSlots[1]
    || typeof ledger?.prepare !== 'function' || typeof ledger.beginFence !== 'function'
    || typeof sessions?.save !== 'function' || typeof sessions.retire !== 'function'
    || typeof request !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('An exact versioned OneDrive publication owner, ledger and protected payload sessions are required.');
  }
  const { profileId, streamId, appRootId, driveId } = destination;
  const slots = destination.fixedSlots.slice();
  const binding = { profileId, provider: 'microsoft', account: destination.account, streamId };
  const reads = createMicrosoftPublicationReads({ reads: raw, isCurrent });
  function current() { if (isCurrent() !== true) refuse('The OneDrive connection changed. Preserve its pending publication.'); }
  async function call(options) {
    current();
    const result = await request(options);
    current();
    return result;
  }
  async function state() {
    current();
    const value = await ledger.inspect();
    current();
    if (value.protocol !== MICROSOFT_PUBLICATION_PROTOCOL || !same(value.binding, binding)
      || !same(value.fixedSlots, slots)) refuse();
    return value;
  }
  async function root() {
    const value = await raw.discoverRoot();
    current();
    if (value.appRootId !== appRootId || value.driveId !== driveId) refuse();
  }
  function name(slot) { return `recap-backup-${streamId}-${slot}.json`; }
  function payload(state, id) {
    const value = state.payloads.find((entry) => entry.attemptId === id);
    if (!value) refuse();
    return value;
  }
  function pointerMatches(pointer, attempt, data) {
    return pointer && attempt && data && pointer.attemptId === attempt.id && pointer.generation === attempt.generation
      && pointer.digest === attempt.digest && pointer.payloadId === data.id && pointer.byteLength === data.byteLength;
  }
  async function record(slot) {
    current();
    const before = await raw.readMetadata({ id: slots[slot] });
    const selected = await raw.readConditionalFile({ id: slots[slot] });
    const after = await raw.readMetadata({ id: slots[slot] });
    current();
    if (before.file?.id !== slots[slot] || before.file.name !== name(slot) || before.file.size !== SEED.length
      || selected.file?.id !== slots[slot] || selected.file.name !== name(slot) || !Buffer.isBuffer(selected.bytes)
      || !selected.bytes.equals(SEED) || before.condition !== selected.condition
      || after.file?.id !== slots[slot] || after.file.name !== name(slot) || after.file.size !== SEED.length
      || before.condition !== after.condition || before.description !== after.description
      || !isCloudMatchTag(before.condition)) refuse();
    const value = before.description === null || before.description === '' ? null
      : decodeMicrosoftPublicationDescription(before.description, { streamId, slotId: slots[slot] });
    return { condition: before.condition, description: before.description,
      text: value === null ? before.description : encodeMicrosoftPublication(value), value };
  }
  async function refreshRecord(slot, checked) {
    const latest = await raw.readMetadata({ id: slots[slot] });
    current();
    if (latest.file?.id !== slots[slot] || latest.file.name !== name(slot) || latest.file.size !== SEED.length
      || !isCloudMatchTag(latest.condition)) refuse();
    if (latest.condition !== checked.condition || latest.description !== checked.description) return record(slot);
    return checked;
  }
  function ownedPointer(value, state, slot, pending = false) {
    const pointer = value?.publication ?? null;
    const acknowledged = state.snapshots[slot];
    if (pointer === null) {
      if (acknowledged !== null) refuse('OneDrive publication metadata no longer contains the acknowledged backup.');
      return;
    }
    const previousData = state.payloads.find((entry) => entry.attemptId === acknowledged?.id);
    if (pointerMatches(pointer, acknowledged, previousData)) return;
    const attempt = state.attempt;
    const candidate = state.payloads.find((entry) => entry.attemptId === attempt?.id);
    if (pending && attempt?.slot === slot && candidate?.terminal && candidate.retired
      && pointerMatches(pointer, attempt, candidate)) return;
    refuse('OneDrive publication identity changed outside its durable owner. No overwrite was authorized.');
  }
  async function completeSnapshot(slot) {
    const selected = await reads.readConditionalFile({ id: slots[slot] });
    current();
    if (!selected.publication) refuse();
    const snapshot = await parseCloudSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(selected.bytes));
    current();
    requireMicrosoftPublicationSnapshot(selected.publication, snapshot, selected.bytes);
    return { ...selected, snapshot };
  }
  function sessionOptions(data) {
    return { binding: { profileId, provider: 'microsoft', accountId, streamId,
      attemptId: data.attemptId, epoch: data.epoch, slotId: data.name }, reference: data.session };
  }
  async function retire(data) {
    current();
    return sessions.retire(sessionOptions(data));
  }
  async function ensureRetired(data) {
    if (!data.terminal || data.retired) return;
    const result = await retire(data);
    current();
    await ledger.payloadSessionRetired({ attemptId: data.attemptId, result });
  }
  function compact() {
    return ledger.compact({ retireTerminal: (proof) => sessions.retire({
      binding: { profileId, provider: 'microsoft', accountId, streamId, attemptId: proof.attempt.id,
        epoch: proof.attempt.epoch, slotId: proof.fixedSlots[proof.attempt.slot] }, reference: proof.attempt.session,
    }) });
  }
  async function cleanup(checked = null) {
    let value = await state();
    if (value.attempt && !TERMINAL.has(value.attempt.phase)) refuse('Resolve the pending OneDrive publication before cleanup or another backup.');
    if (value.payloads.every((entry) => entry.cleanup === null)
      && (await ledger.capacity()).remainingTransitions < 32) {
      await compact();
      value = await state();
    }
    await root();
    for (let slot = 0; slot < 2; slot++) {
      const selected = await record(slot);
      ownedPointer(selected.value, value, slot);
      if (checked) checked[slot] = selected;
    }
    let removed = 0;
    for (const candidate of value.payloads) {
      if (value.snapshots.some((entry) => entry?.id === candidate.attemptId) || !candidate.terminal) continue;
      await ensureRetired(candidate);
      value = await state();
      const data = payload(value, candidate.attemptId);
      let selected;
      try { selected = await raw.readConditionalFile({ id: data.id }); }
      catch (error) {
        if (error.status !== 404 || data.cleanup === null) throw error;
        await root();
        let missing = false;
        try {
          const present = metadata(await call({
            target: `/v1.0/me/drive/items/${encodeURIComponent(data.id)}?$select=id`, maxBytes: 1024 * 1024,
          }));
          if (present.id !== data.id) refuse();
        } catch (probe) {
          if (probe.status !== 404 || probe.outcome !== 'read-only') throw probe;
          missing = true;
        }
        if (!missing) throw error;
        // This exact terminal, retired upload ID has no producer; absence settles cleanup, not an unknown upload.
        await ledger.finishCleanup({ payloadAttemptId: data.attemptId });
        removed++;
        continue;
      }
      current();
      if (selected.file?.id !== data.id || selected.file.name !== data.name || !Buffer.isBuffer(selected.bytes)
        || selected.bytes.length !== data.byteLength || hash(selected.bytes) !== data.digest
        || !isCloudMatchTag(selected.condition) || (data.cleanup !== null && data.cleanup !== selected.condition)) refuse();
      if (data.cleanup === null) await ledger.beginCleanup({ payloadAttemptId: data.attemptId, condition: selected.condition });
      const deleted = await call({
        target: `/v1.0/me/drive/items/${encodeURIComponent(data.id)}`, method: 'DELETE',
        ifMatch: selected.condition, maxBytes: 1024 * 1024,
      });
      if (deleted.status !== 204 || deleted.bytes.length !== 0) refuse();
      await ledger.finishCleanup({ payloadAttemptId: data.attemptId });
      removed++;
      value = await state();
    }
    return { removed };
  }
  async function verifyTerminal({ binding: expected, slotId, attempt, payload: data }) {
    if (!same(expected, binding) || slotId !== slots[attempt.slot]) refuse();
    const value = await state();
    const remote = await record(attempt.slot);
    ownedPointer(remote.value, value, attempt.slot, true);
    if (attempt.step === 'published') {
      if (remote.condition !== attempt.publicationTag || remote.value?.nonce !== attempt.id
        || !pointerMatches(remote.value?.publication, attempt, data)) refuse();
    } else if (attempt.step !== 'fenced' || remote.text !== attempt.fence?.text
      || remote.condition !== attempt.fence?.tag) refuse('A matching acknowledged publication fence is required.');
    const completed = pointerMatches(remote.value?.publication, attempt, data) === true;
    if (remote.value?.publication) {
      const selected = await completeSnapshot(attempt.slot);
      if (selected.condition !== remote.condition || encodeMicrosoftPublication(selected.publication) !== remote.text
        || (completed && (selected.digest !== attempt.digest || selected.bytes.length !== attempt.byteLength))) refuse();
    }
    // This proof concerns the fixed publication record, never outstanding immutable payload uploads.
    return { result: completed ? 'completed' : 'failed', attemptId: attempt.id, generation: attempt.generation,
      digest: attempt.digest, slotId, noOutstandingMutation: true, exactReadback: completed };
  }
  async function reconcile() {
    let value = await state();
    if (!value.attempt || TERMINAL.has(value.attempt.phase)) return value;
    if (value.attempt.phase === 'prepared') return ledger.abandonPrepared({ attemptId: value.attempt.id });
    await root();
    const pending = value.attempt;
    await ensureRetired(payload(value, pending.id));
    value = await state();
    const remote = await record(pending.slot);
    ownedPointer(remote.value, value, pending.slot, true);
    const text = encodeMicrosoftPublication({ streamId, slotId: slots[pending.slot],
      nonce: randomBytes(32).toString('hex'), publication: remote.value?.publication ?? null });
    await ledger.beginFence({ attemptId: pending.id, text, condition: remote.condition });
    try {
      const fenced = metadata(await call({
        target: `/v1.0/me/drive/items/${encodeURIComponent(slots[pending.slot])}?$select=id,eTag`,
        method: 'PATCH', ifMatch: remote.condition, body: JSON.stringify({ description: text }), maxBytes: 1024 * 1024,
      }));
      if (fenced.id !== slots[pending.slot] || !isCloudMatchTag(fenced.eTag)) refuse();
      await ledger.fenceAcknowledged({ attemptId: pending.id, condition: fenced.eTag });
      return await ledger.settle({ attemptId: pending.id });
    } catch (error) {
      const observed = await state();
      if (observed.attempt?.id === pending.id && observed.attempt.phase === 'in-flight') {
        await ledger.markUnknown({ attemptId: pending.id });
      }
      throw copyCloudFailureMetadata(new CloudMicrosoftPublicationError(), error, { unknown: true });
    }
  }
  async function writeSnapshot({ components, label, epoch }) {
    if (!Number.isSafeInteger(epoch) || epoch < 1 || !components || typeof components !== 'object'
      || Array.isArray(components) || typeof label !== 'string' || !label.trim() || label.length > 200) refuse();
    let copy;
    try { copy = globalThis.structuredClone(components); } catch { refuse(); }
    const checked = [];
    await cleanup(checked);
    if ((await ledger.capacity()).remainingTransitions < 32) await compact();
    const before = await state();
    if (before.attempt && !TERMINAL.has(before.attempt.phase)) refuse();
    const conditions = [];
    for (let slot = 0; slot < 2; slot++) {
      const selected = await refreshRecord(slot, checked[slot]);
      ownedPointer(selected.value, before, slot);
      if (before.snapshots[slot]) {
        const complete = await completeSnapshot(slot);
        if (complete.digest !== before.snapshots[slot].digest || complete.condition !== selected.condition) refuse();
      }
      conditions.push(selected.condition);
    }
    const slot = selectCloudStreamSlot(before), attemptId = randomBytes(32).toString('hex');
    const bytes = Buffer.from((await createCloudSnapshot(copy, {
      captureId: randomBytes(32).toString('hex'), streamId, slotId: slots[slot], attemptId,
      generation: before.maxGeneration + 1, capturedAt: new Date().toISOString(), label,
    })).text);
    current();
    const prepared = await ledger.prepare({ digest: hash(bytes), byteLength: bytes.length, epoch,
      requestedAttemptId: attemptId, expectedSequence: before.sequence, condition: conditions[slot] });
    await ledger.dispatch({ attemptId });
    try {
      const fileName = microsoftPayloadName(streamId, attemptId);
      const files = await raw.listFiles();
      current();
      if (!Array.isArray(files) || files.some((file) => file.name === fileName)) refuse();
      const started = metadata(await call({
        target: `/v1.0/me/drive/items/${encodeURIComponent(appRootId)}:/${fileName}:/createUploadSession?@microsoft.graph.conflictBehavior=fail`,
        method: 'POST', maxBytes: 1024 * 1024,
      }));
      const target = validateCloudUploadSession('microsoft', started.uploadUrl);
      const reference = await sessions.save({ binding: { profileId, provider: 'microsoft', accountId, streamId,
        attemptId, epoch, slotId: fileName }, target });
      current();
      await ledger.attachSession({ attemptId, sessionReference: reference });
      await ledger.dispatchPayload({ attemptId });
      const created = metadata(await call({ kind: 'session', target, method: 'PUT', body: bytes,
        contentRange: `bytes 0-${bytes.length - 1}/${bytes.length}`, maxBytes: 1024 * 1024 }), [200, 201]);
      if (!identifier(created.id) || created.name !== fileName || created.size !== bytes.length
        || created.parentReference?.id !== appRootId || created.parentReference.driveId !== driveId) refuse();
      await ledger.payloadAcknowledged({ attemptId, payloadId: created.id });
      const selected = await raw.readFile({ id: created.id });
      current();
      if (selected.file?.id !== created.id || selected.file.name !== fileName || !Buffer.isBuffer(selected.bytes)
        || !selected.bytes.equals(bytes)) refuse();
      await ensureRetired(payload(await state(), attemptId));
      const text = encodeMicrosoftPublication({
        streamId, slotId: slots[slot], nonce: attemptId,
        publication: { attemptId, generation: prepared.attempt.generation, payloadId: created.id,
          byteLength: bytes.length, digest: prepared.attempt.digest },
      });
      await ledger.dispatchPublication({ attemptId });
      const published = metadata(await call({
        target: `/v1.0/me/drive/items/${encodeURIComponent(slots[slot])}?$select=id,eTag`,
        method: 'PATCH', ifMatch: prepared.attempt.condition, body: JSON.stringify({ description: text }), maxBytes: 1024 * 1024,
      }));
      if (published.id !== slots[slot] || !isCloudMatchTag(published.eTag)) refuse();
      await ledger.publicationAcknowledged({ attemptId, condition: published.eTag });
      return await ledger.settle({ attemptId });
    } catch (error) {
      const observed = await state();
      if (observed.attempt?.id === attemptId && observed.attempt.phase === 'in-flight') await ledger.markUnknown({ attemptId });
      throw copyCloudFailureMetadata(new CloudMicrosoftPublicationError(), error, { unknown: true });
    }
  }
  return { reads, writeSnapshot, verifyTerminal, reconcile, cleanup: () => cleanup() };
}
