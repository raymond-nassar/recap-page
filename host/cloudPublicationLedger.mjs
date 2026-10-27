import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { openCloudLocalJournal } from './cloudLocalJournal.mjs';
import { selectCloudStreamSlot } from './cloudStreamLedger.mjs';
import { isCloudMatchTag } from './cloudProviderTransport.mjs';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';
import {
  MICROSOFT_PUBLICATION_PROTOCOL, decodeMicrosoftPublication, microsoftPayloadName,
} from './cloudMicrosoftPublicationRecord.mjs';

const HEX = /^[a-f0-9]{64}$/;
const RESERVE = 32;
const MAX_FENCES = 8;
const MAX_BYTES = 32 * 1024 * 1024;
const TERMINAL = new Set(['acknowledged', 'failed']);
const STEPS = new Set(['reserved', 'creating', 'session', 'uploading', 'uploaded',
  'publishing', 'published', 'fencing', 'fenced', 'abandoned']);
const EVENTS = {
  initialize: ['type'], prepare: ['type', 'id', 'digest', 'byteLength', 'epoch', 'condition'],
  dispatch: ['type', 'id'], session: ['type', 'id', 'reference'], upload: ['type', 'id'],
  payload: ['type', 'id', 'payloadId'], publish: ['type', 'id'], published: ['type', 'id', 'condition'],
  unknown: ['type', 'id'], abandon: ['type', 'id'], fence: ['type', 'id', 'text', 'condition'],
  fenced: ['type', 'id', 'condition'], settle: ['type', 'id', 'completed'],
  retired: ['type', 'id', 'reference'], cleanup: ['type', 'id', 'condition'], cleaned: ['type', 'id'],
};
const hex = (value) => typeof value === 'string' && HEX.test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value)
  && !['.', '..'].includes(value);
function exact(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === names.slice().sort().join(',');
}
export class CloudPublicationLedgerError extends Error {
  constructor(message = 'OneDrive publication ownership is incomplete or changed. Preserve its records; no uncertain payload was discarded.') {
    super(message);
    this.name = 'CloudPublicationLedgerError';
  }
}
function refuse(message) { throw new CloudPublicationLedgerError(message); }
function referenced(state, id) { return state.snapshots.some((entry) => entry?.id === id); }
function staging(state) { return state.payloads.filter((entry) => !referenced(state, entry.attemptId)).length; }
function quiescent(state) {
  return (!state.attempt || TERMINAL.has(state.attempt.phase)) && state.payloads.every((entry) => entry.cleanup === null);
}
function payload(state, id) {
  const value = state.payloads.find((entry) => entry.attemptId === id);
  if (!value) refuse();
  return value;
}
function attempt(state, id, phases, steps) {
  const value = state.attempt;
  if (!value || value.id !== id || !phases.includes(value.phase) || (steps && !steps.includes(value.step))) {
    refuse('The publication attempt changed or has been withdrawn. No stale publication was authorized.');
  }
  return value;
}
function pointerMatches(pointer, entry, data) {
  return pointer !== null && entry !== null && data !== undefined
    && pointer.attemptId === entry.id && pointer.generation === entry.generation
    && pointer.digest === entry.digest && pointer.payloadId === data.id && pointer.byteLength === data.byteLength;
}

export async function openCloudPublicationLedger({
  directory, profileId, provider = 'microsoft', accountId, streamId, fixedSlots, initialize = false, verifyTerminal,
}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !hex(profileId) || provider !== 'microsoft'
    || typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024 || !hex(streamId)
    || !Array.isArray(fixedSlots) || fixedSlots.length !== 2 || !fixedSlots.every(identifier)
    || fixedSlots[0] === fixedSlots[1] || typeof initialize !== 'boolean'
    || (verifyTerminal !== undefined && typeof verifyTerminal !== 'function')) {
    throw new TypeError('An exact versioned native OneDrive publication destination is required.');
  }
  const slots = fixedSlots.slice();
  const binding = { profileId, provider, account: hash(accountId), streamId };
  const namespace = ['cloud-publication-streams', profileId, provider, binding.account, streamId];
  const initial = {
    protocol: MICROSOFT_PUBLICATION_PROTOCOL, binding, fixedSlots: slots, maxGeneration: 0,
    snapshots: [null, null], payloads: [], attempt: null, event: { type: 'initialize' },
  };
  function validate(state) {
    if (!exact(state, Object.keys(initial)) || state.protocol !== MICROSOFT_PUBLICATION_PROTOCOL
      || !same(state.binding, binding) || !same(state.fixedSlots, slots) || !integer(state.maxGeneration)
      || !Array.isArray(state.snapshots) || state.snapshots.length !== 2 || !Array.isArray(state.payloads)
      || state.payloads.length > 4 || staging(state) > 2 || !EVENTS[state.event?.type]
      || !exact(state.event, EVENTS[state.event.type])) return false;
    const ids = new Set();
    const fileIds = new Set();
    for (const entry of state.payloads) {
      if (!exact(entry, ['attemptId', 'generation', 'digest', 'byteLength', 'epoch', 'name', 'id',
        'session', 'terminal', 'retired', 'cleanup']) || !hex(entry.attemptId) || ids.has(entry.attemptId)
        || !integer(entry.generation, 1) || entry.generation > state.maxGeneration || !hex(entry.digest)
        || !integer(entry.byteLength, 1) || entry.byteLength > MAX_BYTES || !integer(entry.epoch, 1)
        || entry.name !== microsoftPayloadName(streamId, entry.attemptId)
        || (entry.id !== null && (!identifier(entry.id) || slots.includes(entry.id) || fileIds.has(entry.id)))
        || (entry.session !== null && !hex(entry.session)) || typeof entry.terminal !== 'boolean'
        || typeof entry.retired !== 'boolean' || (entry.terminal && (entry.id === null || entry.session === null))
        || (entry.retired && !entry.terminal)
        || (entry.cleanup !== null && (!isCloudMatchTag(entry.cleanup) || !entry.terminal || !entry.retired
          || referenced(state, entry.attemptId)))) return false;
      ids.add(entry.attemptId);
      if (entry.id !== null) fileIds.add(entry.id);
    }
    for (const entry of state.snapshots) {
      if (entry === null) continue;
      const data = state.payloads.find((item) => item.attemptId === entry.id);
      if (!exact(entry, ['id', 'generation', 'digest']) || !hex(entry.id) || !hex(entry.digest)
        || !integer(entry.generation, 1) || entry.generation > state.maxGeneration || !data?.terminal
        || !data.retired || entry.generation !== data.generation || entry.digest !== data.digest) return false;
    }
    if (state.snapshots[0] && state.snapshots[1]
      && state.snapshots[0].generation === state.snapshots[1].generation) return false;
    const value = state.attempt;
    if (value === null) return state.maxGeneration === 0 && state.payloads.length === 0;
    if (!exact(value, ['id', 'generation', 'digest', 'byteLength', 'epoch', 'slot', 'phase', 'step',
      'condition', 'publicationTag', 'fence', 'fences']) || !hex(value.id) || !hex(value.digest)
      || !integer(value.generation, 1) || value.generation !== state.maxGeneration
      || !integer(value.byteLength, 1) || value.byteLength > MAX_BYTES || !integer(value.epoch, 1)
      || ![0, 1].includes(value.slot) || !['prepared', 'in-flight', 'unknown', ...TERMINAL].includes(value.phase)
      || !STEPS.has(value.step) || !isCloudMatchTag(value.condition)
      || (value.publicationTag !== null && !isCloudMatchTag(value.publicationTag))
      || !integer(value.fences) || value.fences > MAX_FENCES) return false;
    if (value.phase === 'prepared' && value.step !== 'reserved'
      || value.phase === 'acknowledged' && !['published', 'fenced'].includes(value.step)
      || value.phase === 'failed' && !['abandoned', 'fenced'].includes(value.step)
      || ['in-flight', 'unknown'].includes(value.phase) && ['reserved', 'abandoned'].includes(value.step)
      || (value.fences === 0) !== (value.fence === null)) return false;
    if (!TERMINAL.has(value.phase) && !ids.has(value.id)) return false;
    if (value.fence !== null) {
      if (!exact(value.fence, ['text', 'condition', 'tag']) || !isCloudMatchTag(value.fence.condition)
        || (value.fence.tag !== null && !isCloudMatchTag(value.fence.tag))) return false;
      decodeMicrosoftPublication(value.fence.text, { streamId, slotId: slots[value.slot] });
    }
    return true;
  }
  function reduce(before, event) {
    if (!EVENTS[event?.type] || !exact(event, EVENTS[event.type]) || event.type === 'initialize') refuse();
    const next = globalThis.structuredClone(before);
    next.event = globalThis.structuredClone(event);
    if (event.type === 'prepare') {
      if (!quiescent(next) || staging(next) >= 2) refuse('OneDrive staging has no capacity. Preserve unresolved payloads before another backup.');
      if (!hex(event.id) || !hex(event.digest) || !integer(event.byteLength, 1) || event.byteLength > MAX_BYTES
        || !integer(event.epoch, 1) || !isCloudMatchTag(event.condition)
        || next.payloads.some((entry) => entry.attemptId === event.id) || next.attempt?.id === event.id
        || !integer(next.maxGeneration + 1, 1)) refuse();
      next.maxGeneration++;
      next.attempt = {
        id: event.id, generation: next.maxGeneration, digest: event.digest, byteLength: event.byteLength,
        epoch: event.epoch, slot: selectCloudStreamSlot(next), phase: 'prepared', step: 'reserved',
        condition: event.condition, publicationTag: null, fence: null, fences: 0,
      };
      next.payloads.push({
        attemptId: event.id, generation: next.maxGeneration, digest: event.digest, byteLength: event.byteLength,
        epoch: event.epoch, name: microsoftPayloadName(streamId, event.id), id: null, session: null,
        terminal: false, retired: false, cleanup: null,
      });
      return next;
    }
    if (['retired', 'cleanup', 'cleaned'].includes(event.type)) {
      const data = payload(next, event.id);
      if (!data.terminal) refuse();
      if (event.type === 'retired') {
        if (data.retired || event.reference !== data.session) refuse();
        data.retired = true;
      } else {
        if (!quiescent(next) && !(event.type === 'cleaned' && TERMINAL.has(next.attempt?.phase))
          || referenced(next, event.id) || !data.retired) refuse();
        if (event.type === 'cleanup') {
          if (data.cleanup !== null || !isCloudMatchTag(event.condition)) refuse();
          data.cleanup = event.condition;
        } else {
          if (data.cleanup === null) refuse();
          next.payloads = next.payloads.filter((entry) => entry.attemptId !== event.id);
        }
      }
      return next;
    }
    const value = attempt(next, event.id, event.type === 'dispatch' || event.type === 'abandon'
      ? ['prepared'] : event.type === 'unknown' ? ['in-flight'] : ['in-flight', 'unknown']);
    const data = payload(next, event.id);
    switch (event.type) {
      case 'dispatch':
        if (value.step !== 'reserved') refuse();
        value.phase = 'in-flight'; value.step = 'creating'; break;
      case 'abandon':
        if (value.step !== 'reserved' || data.session !== null || data.id !== null) refuse();
        value.phase = 'failed'; value.step = 'abandoned';
        next.payloads = next.payloads.filter((entry) => entry.attemptId !== event.id); break;
      case 'session':
        if (value.phase !== 'in-flight' || value.step !== 'creating' || data.session !== null || !hex(event.reference)) refuse();
        data.session = event.reference; value.step = 'session'; break;
      case 'upload':
        if (value.phase !== 'in-flight' || value.step !== 'session' || data.session === null) refuse();
        value.step = 'uploading'; break;
      case 'payload':
        if (value.phase !== 'in-flight' || value.step !== 'uploading' || !identifier(event.payloadId)
          || slots.includes(event.payloadId) || next.payloads.some((entry) => entry.id === event.payloadId)) refuse();
        data.id = event.payloadId; data.terminal = true; value.step = 'uploaded'; break;
      case 'publish':
        if (value.phase !== 'in-flight' || value.step !== 'uploaded' || !data.terminal || !data.retired) refuse();
        value.step = 'publishing'; break;
      case 'published':
        if (value.phase !== 'in-flight' || value.step !== 'publishing'
          || !isCloudMatchTag(event.condition) || event.condition === value.condition) refuse();
        value.publicationTag = event.condition; value.step = 'published'; break;
      case 'unknown': value.phase = 'unknown'; break;
      case 'fence': {
        if (!isCloudMatchTag(event.condition) || value.fences >= MAX_FENCES) refuse('OneDrive publication fencing requires recovery. Preserve its journal.');
        const record = decodeMicrosoftPublication(event.text, { streamId, slotId: slots[value.slot] });
        const prior = next.snapshots[value.slot];
        const pending = pointerMatches(record.publication, value, data);
        if (record.publication !== null && !pending && !pointerMatches(record.publication, prior,
          next.payloads.find((entry) => entry.attemptId === prior?.id))) refuse();
        if (pending && !data.terminal) refuse();
        value.fence = { text: event.text, condition: event.condition, tag: null };
        value.fences++; value.step = 'fencing'; break;
      }
      case 'fenced':
        if (value.step !== 'fencing' || !value.fence || !isCloudMatchTag(event.condition)
          || event.condition === value.fence.condition || event.condition === value.condition) refuse();
        value.fence.tag = event.condition; value.step = 'fenced'; break;
      case 'settle': {
        if (!['published', 'fenced'].includes(value.step) || typeof event.completed !== 'boolean') refuse();
        const record = value.step === 'fenced'
          ? decodeMicrosoftPublication(value.fence.text, { streamId, slotId: slots[value.slot] }) : null;
        const completed = record ? pointerMatches(record.publication, value, data) : true;
        if (event.completed !== completed || (completed && (!data.terminal || !data.retired))) refuse();
        value.phase = completed ? 'acknowledged' : 'failed';
        if (completed) next.snapshots[value.slot] = { id: value.id, generation: value.generation, digest: value.digest };
        break;
      }
      default: refuse();
    }
    return next;
  }
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof CloudPublicationLedgerError) throw error;
      throw copyCloudFailureMetadata(new CloudPublicationLedgerError(), error);
    }
  }
  if (!initialize) await guarded(async () => {
    const info = await lstat(join(directory, ...namespace));
    if (!info.isDirectory() || info.isSymbolicLink()) refuse();
  });
  const journal = await openCloudLocalJournal({
    directory, namespace, format: 'recap-cloud-publication-intent', initial, validate,
    transition: (before, after) => before === null ? same(after, initial) : same(reduce(before, after.event), after),
  });
  const inspect = () => guarded(async () => {
    const head = await journal.inspect();
    return { ...head.state, sequence: head.sequence };
  });
  async function change(event, expectedSequence) {
    return guarded(async () => {
      const head = await journal.inspect();
      if (expectedSequence !== undefined && head.sequence !== expectedSequence) refuse('Publication reservation changed. No upload was dispatched.');
      const result = await journal.update({ expectedSequence: head.sequence, change: (state) => reduce(state, event) });
      return { ...result.state, sequence: result.sequence };
    });
  }
  function terminalProof(state, data) {
    if (!data?.terminal || !data.session) return null;
    const slot = state.snapshots.findIndex((entry) => entry?.id === data.attemptId);
    const index = slot < 0 ? state.attempt?.id === data.attemptId ? state.attempt.slot : 0 : slot;
    const targets = slots.slice();
    targets[index] = data.name;
    return { binding, fixedSlots: targets, attempt: {
      id: data.attemptId, generation: data.generation, digest: data.digest, epoch: data.epoch,
      slot: index, session: data.session, phase: 'acknowledged', byteLength: data.byteLength,
    } };
  }
  return {
    inspect,
    capacity: () => guarded(async () => {
      const state = await inspect();
      const capacity = await journal.capacity();
      return { maximumRecords: capacity.maximumRecords, remainingTransitions: capacity.remainingTransitions,
        canPrepare: capacity.canUpdate && capacity.remainingTransitions >= RESERVE && quiescent(state) && staging(state) < 2 };
    }),
    prepare: async ({ digest, byteLength, epoch, condition, requestedAttemptId, expectedSequence }) => {
      const capacity = await journal.capacity();
      if (!capacity.canUpdate || capacity.remainingTransitions < RESERVE || !integer(expectedSequence)) {
        refuse('OneDrive publication journal needs capacity before another upload.');
      }
      const state = await inspect();
      if (!quiescent(state) || staging(state) >= 2) {
        refuse('OneDrive staging has no capacity. Preserve unresolved payloads before another backup.');
      }
      return change({ type: 'prepare', id: requestedAttemptId, digest, byteLength, epoch, condition }, expectedSequence);
    },
    dispatch: ({ attemptId }) => change({ type: 'dispatch', id: attemptId }),
    attachSession: ({ attemptId, sessionReference }) => change({ type: 'session', id: attemptId, reference: sessionReference }),
    dispatchPayload: ({ attemptId }) => change({ type: 'upload', id: attemptId }),
    payloadAcknowledged: ({ attemptId, payloadId }) => change({ type: 'payload', id: attemptId, payloadId }),
    payloadSessionRetired: async ({ attemptId, result }) => {
      const state = await inspect();
      const data = payload(state, attemptId);
      if (result?.retired !== true || result.reference !== data.session) refuse();
      return change({ type: 'retired', id: attemptId, reference: result.reference }, state.sequence);
    },
    dispatchPublication: ({ attemptId }) => change({ type: 'publish', id: attemptId }),
    publicationAcknowledged: ({ attemptId, condition }) => change({ type: 'published', id: attemptId, condition }),
    markUnknown: ({ attemptId }) => change({ type: 'unknown', id: attemptId }),
    abandonPrepared: ({ attemptId }) => change({ type: 'abandon', id: attemptId }),
    beginFence: ({ attemptId, text, condition }) => change({ type: 'fence', id: attemptId, text, condition }),
    fenceAcknowledged: ({ attemptId, condition }) => change({ type: 'fenced', id: attemptId, condition }),
    beginCleanup: async ({ payloadAttemptId, condition }) => {
      const capacity = await journal.capacity();
      if (!capacity.canUpdate || capacity.remainingTransitions < 8) {
        refuse('OneDrive publication cleanup needs journal capacity before deleting a payload.');
      }
      return change({ type: 'cleanup', id: payloadAttemptId, condition });
    },
    finishCleanup: ({ payloadAttemptId }) => change({ type: 'cleaned', id: payloadAttemptId }),
    terminalAttempt: async ({ attemptId }) => {
      if (!hex(attemptId)) refuse();
      const state = await inspect();
      return terminalProof(state, state.payloads.find((entry) => entry.attemptId === attemptId));
    },
    settle: ({ attemptId, evidence } = {}) => guarded(async () => {
      const state = await inspect();
      const value = attempt(state, attemptId, ['in-flight', 'unknown'], ['published', 'fenced']);
      if (typeof verifyTerminal !== 'function') refuse('Native publication verification is unavailable. Preserve the pending attempt.');
      const proof = await verifyTerminal({ binding: globalThis.structuredClone(binding), slotId: slots[value.slot],
        attempt: globalThis.structuredClone(value), payload: globalThis.structuredClone(payload(state, attemptId)), evidence });
      if (!proof || !['completed', 'failed'].includes(proof.result) || proof.attemptId !== attemptId
        || proof.generation !== value.generation || proof.digest !== value.digest || proof.slotId !== slots[value.slot]
        || proof.noOutstandingMutation !== true || (proof.result === 'completed' && proof.exactReadback !== true)) refuse();
      return change({ type: 'settle', id: attemptId, completed: proof.result === 'completed' }, state.sequence);
    }),
    compact: ({ retireTerminal } = {}) => guarded(async () => {
      let state = await inspect();
      if (!quiescent(state)) refuse('Unresolved publication or cleanup cannot be compacted.');
      for (const data of state.payloads) {
        if (!data.terminal || !data.session || data.retired) continue;
        if (typeof retireTerminal !== 'function') refuse();
        const result = await retireTerminal(terminalProof(state, data));
        if (result?.retired !== true || result.reference !== data.session) refuse();
        state = await change({ type: 'retired', id: data.attemptId, reference: result.reference });
      }
      const result = await journal.compact({ canCompact: quiescent });
      return { ...result.state, sequence: result.sequence };
    }),
  };
}
