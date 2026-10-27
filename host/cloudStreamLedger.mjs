import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isCloudMatchTag } from './cloudProviderTransport.mjs';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';

const HEX = /^[a-f0-9]{64}$/;
const FORMAT = 'recap-cloud-stream-intent';
const LIMIT = 8192;
const RECORD_BYTES = 8192;
const FENCED = new Set(['in-flight', 'unknown']);

export class CloudStreamLedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudStreamLedgerError';
  }
}

function refuse(message = 'Cloud stream journal is unavailable or inconsistent. Preserve its files before recovery.') {
  return new CloudStreamLedgerError(message);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fixedSlot(value) {
  return typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value);
}

function hex(value) {
  return typeof value === 'string' && HEX.test(value);
}

function snapshot(attempt) {
  return { id: attempt.id, generation: attempt.generation, digest: attempt.digest };
}

function validate(state, binding, slots) {
  if (!state || state.format !== FORMAT || state.version !== 1 || !integer(state.sequence)
    || !same(state.binding, binding) || !same(state.fixedSlots, slots) || !integer(state.maxGeneration)
    || !Array.isArray(state.snapshots) || state.snapshots.length !== 2
    || (state.previous !== null && (typeof state.previous !== 'string' || !HEX.test(state.previous)))) throw refuse();
  for (const entry of state.snapshots) {
    if (entry !== null && (!entry || !hex(entry.id) || !hex(entry.digest)
      || !integer(entry.generation, 1) || entry.generation > state.maxGeneration
      || Object.keys(entry).sort().join(',') !== 'digest,generation,id')) throw refuse();
  }
  if (state.snapshots[0] && state.snapshots[1]
    && state.snapshots[0].generation === state.snapshots[1].generation) throw refuse();
  const attempt = state.attempt;
  const attemptKeys = ['digest', 'epoch', 'generation', 'id', 'phase', 'session', 'slot'];
  if (attempt && Object.hasOwn(attempt, 'condition')) attemptKeys.push('condition');
  if (attempt && Object.hasOwn(attempt, 'byteLength')) attemptKeys.push('byteLength');
  if (attempt !== null && (!attempt || !hex(attempt.id) || !hex(attempt.digest)
    || !integer(attempt.generation, 1) || attempt.generation !== state.maxGeneration
    || !integer(attempt.epoch, 1) || ![0, 1].includes(attempt.slot)
    || !['prepared', 'in-flight', 'unknown', 'acknowledged', 'failed'].includes(attempt.phase)
    || (attempt.session !== null && (typeof attempt.session !== 'string' || !HEX.test(attempt.session)))
    || (Object.hasOwn(attempt, 'condition') && (binding.provider !== 'microsoft' || !isCloudMatchTag(attempt.condition)))
    || (Object.hasOwn(attempt, 'byteLength') && (!integer(attempt.byteLength, 1) || attempt.byteLength > 32 * 1024 * 1024))
    || Object.keys(attempt).sort().join(',') !== attemptKeys.sort().join(','))) throw refuse();
  if (Object.hasOwn(state, 'maintenance') && state.maintenance !== true) throw refuse();
  if (Object.keys(state).sort().join(',') !== (state.maintenance
    ? 'attempt,binding,fixedSlots,format,maintenance,maxGeneration,previous,sequence,snapshots,version'
    : 'attempt,binding,fixedSlots,format,maxGeneration,previous,sequence,snapshots,version')) throw refuse();
}

export function selectCloudStreamSlot(state) {
  if (!state.snapshots[0]) return 0;
  if (!state.snapshots[1]) return 1;
  return state.snapshots[0].generation < state.snapshots[1].generation ? 0 : 1;
}

function transition(before, after) {
  if (!before) {
    if (after.sequence !== 0 || after.previous !== null || after.maxGeneration !== 0 || after.maintenance
      || after.attempt !== null || after.snapshots.some((value) => value !== null)) throw refuse();
    return;
  }
  if (after.sequence !== before.sequence + 1) throw refuse();
  if (after.maintenance) {
    const content = (state) => {
      const value = { ...state };
      delete value.sequence;
      delete value.previous;
      delete value.maintenance;
      return value;
    };
    if ((before.attempt && !['acknowledged', 'failed'].includes(before.attempt.phase))
      || !same(content(before), content(after))) throw refuse();
    return;
  }
  const a = before.attempt;
  const b = after.attempt;
  if (!b) throw refuse();
  if (b.phase === 'prepared') {
    if ((a && !['acknowledged', 'failed'].includes(a.phase))
      || b.generation <= before.maxGeneration || b.slot !== selectCloudStreamSlot(before)
      || b.session !== null || (a && b.id === a.id)
      || !same(before.snapshots, after.snapshots)) throw refuse();
  } else {
    if (!a || !same({ ...a, phase: b.phase, session: b.session }, b)
      || after.maxGeneration !== before.maxGeneration) throw refuse();
    const sessionChange = a.phase === 'in-flight' && b.phase === 'in-flight'
      && a.session === null && typeof b.session === 'string' && HEX.test(b.session);
    if (!sessionChange && a.session !== b.session) throw refuse();
    if (b.phase === 'in-flight' && a.phase !== 'prepared' && !sessionChange) throw refuse();
    if (b.phase === 'unknown' && a.phase !== 'in-flight') throw refuse();
    if (['acknowledged', 'failed'].includes(b.phase)
      && !FENCED.has(a.phase) && !(b.phase === 'failed' && a.phase === 'prepared' && a.session === null)) throw refuse();
    const expected = before.snapshots.slice();
    if (b.phase === 'acknowledged') expected[b.slot] = snapshot(b);
    if (!same(after.snapshots, expected)) throw refuse();
  }
}

// Append reservations are compare-and-set claims. An incomplete claimed record is never discarded.
export async function openCloudStreamLedger({
  directory, profileId, provider, accountId, streamId, fixedSlots, initialize = false, verifyTerminal,
}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)
    || typeof profileId !== 'string' || !HEX.test(profileId)
    || !['google', 'microsoft'].includes(provider) || typeof streamId !== 'string' || !HEX.test(streamId)
    || typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024
    || !Array.isArray(fixedSlots) || fixedSlots.length !== 2 || !fixedSlots.every(fixedSlot)
    || fixedSlots[0] === fixedSlots[1] || typeof initialize !== 'boolean'
    || (verifyTerminal !== undefined && typeof verifyTerminal !== 'function')) {
    throw new TypeError('Cloud stream journal requires an exact host-owned destination binding.');
  }
  const slots = fixedSlots.slice();
  const binding = { profileId, provider, account: hash(accountId), streamId };
  const parent = join(directory, 'cloud-streams', profileId, provider, binding.account);
  const root = join(parent, streamId);
  function filename(sequence) { return `${String(sequence).padStart(8, '0')}.json`; }
  async function regular(path, directoryEntry = false) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directoryEntry ? !info.isDirectory()
      : !info.isFile() || info.size < 1 || info.size > RECORD_BYTES)) throw refuse();
  }
  async function append(state) {
    const bytes = JSON.stringify(state);
    if (!integer(state.sequence)) throw refuse();
    if (Buffer.byteLength(bytes) > RECORD_BYTES) throw refuse();
    const path = join(root, filename(state.sequence));
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally { await file.close(); }
    await regular(path);
    if (await readFile(path, 'utf8') !== bytes) throw refuse();
    return { state, bytes };
  }
  async function load(visit) {
    await regular(root, true);
    const names = (await readdir(root)).sort();
    if (!names.length || names.length > LIMIT * 4
      || names.some((name) => !/^(?:checkpoint-)?\d{8,16}\.json$/.test(name))) throw refuse();
    let previous = null;
    let baseSequence = -1;
    const sequenceOf = (name) => Number(name.replace('checkpoint-', '').replace('.json', ''));
    const checkpoint = names.filter((name) => name.startsWith('checkpoint-'))
      .sort((a, b) => sequenceOf(a) - sequenceOf(b)).at(-1);
    if (checkpoint) {
      const path = join(root, checkpoint);
      await regular(path);
      const bytes = await readFile(path, 'utf8');
      const state = JSON.parse(bytes);
      validate(state, binding, slots);
      if (!state.maintenance || (state.attempt && !['acknowledged', 'failed'].includes(state.attempt.phase))
        || checkpoint !== `checkpoint-${filename(state.sequence)}`) throw refuse();
      baseSequence = state.sequence;
      previous = { state, bytes, checkpoint: true, path };
      if (visit) visit(state, { checkpoint: true });
    }
    const records = names.filter((name) => !name.startsWith('checkpoint-')
      && sequenceOf(name) > baseSequence).sort((a, b) => sequenceOf(a) - sequenceOf(b));
    if (records.length > LIMIT + 1) throw refuse();
    for (let index = 0; index < records.length; index++) {
      const sequence = baseSequence + index + 1;
      if (records[index] !== filename(sequence) || (previous?.state.maintenance && !previous.checkpoint)) throw refuse();
      const path = join(root, records[index]);
      await regular(path);
      const bytes = await readFile(path, 'utf8');
      if (Buffer.byteLength(bytes) > RECORD_BYTES) throw refuse();
      const state = JSON.parse(bytes);
      validate(state, binding, slots);
      if (state.sequence !== sequence || state.previous !== (previous ? hash(previous.bytes) : null)) throw refuse();
      transition(previous?.state, state);
      if (visit) visit(state, { checkpoint: false });
      previous = { state, bytes, checkpoint: false, path };
    }
    if (!previous) throw refuse();
    if (records.length > LIMIT && !previous.state.maintenance) throw refuse();
    // Another owner can observe a complete append before its writer flushes it.
    const committed = await open(previous.path, 'r+');
    try { await committed.sync(); } finally { await committed.close(); }
    return { ...previous, baseSequence };
  }
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof CloudStreamLedgerError) throw error;
      throw copyCloudFailureMetadata(refuse(), error);
    }
  }
  await guarded(async () => {
    if (initialize) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      await append({
        format: FORMAT, version: 1, sequence: 0, previous: null, binding, fixedSlots: slots,
        maxGeneration: 0, snapshots: [null, null], attempt: null,
      });
    }
    await load();
  });
  async function update(change) {
    return guarded(async () => {
      const prior = await load();
      if ((prior.state.maintenance && !prior.checkpoint) || prior.state.sequence - prior.baseSequence >= LIMIT) {
        throw refuse('Cloud stream journal needs maintenance before another transition.');
      }
      const changed = await change(globalThis.structuredClone(prior.state));
      if (changed.attempt?.phase === 'prepared' && LIMIT - (prior.state.sequence - prior.baseSequence) < 5) {
        throw refuse('Cloud stream journal needs maintenance before reserving another upload.');
      }
      const next = { ...changed, sequence: prior.state.sequence + 1, previous: hash(prior.bytes) };
      delete next.maintenance;
      validate(next, binding, slots);
      transition(prior.state, next);
      return globalThis.structuredClone((await append(next)).state);
    });
  }
  function requireAttempt(state, id, phases) {
    if (!state.attempt || state.attempt.id !== id || !phases.includes(state.attempt.phase)) {
      throw refuse('Cloud stream attempt is stale, already dispatched or not eligible for this operation.');
    }
  }
  return {
    inspect: () => guarded(async () => globalThis.structuredClone((await load()).state)),
    capacity: () => guarded(async () => {
      const prior = await load();
      const remainingTransitions = LIMIT - (prior.state.sequence - prior.baseSequence);
      return { maximumRecords: LIMIT, remainingTransitions, canPrepare: remainingTransitions >= 5
        && (!prior.state.attempt || ['acknowledged', 'failed'].includes(prior.state.attempt.phase))
        && (!prior.state.maintenance || prior.checkpoint) };
    }),
    compact: ({ retireTerminal } = {}) => guarded(async () => {
      const terminals = new Map();
      let priorTerminal = null;
      let prior = await load((state, { checkpoint }) => {
        if (checkpoint) priorTerminal = state.attempt?.id ?? null;
        if (state.attempt?.id === priorTerminal) return;
        if (state.attempt?.session && ['acknowledged', 'failed'].includes(state.attempt.phase)) {
          terminals.set(state.attempt.id, { binding: state.binding, fixedSlots: state.fixedSlots, attempt: state.attempt });
        }
      });
      if (prior.state.attempt && !['acknowledged', 'failed'].includes(prior.state.attempt.phase)) {
        throw refuse('An unresolved stream cannot be compacted. Preserve its entire intent history.');
      }
      for (const proof of terminals.values()) {
        if (typeof retireTerminal !== 'function') throw refuse('Retire terminal upload capabilities before journal compaction.');
        const result = await retireTerminal(globalThis.structuredClone(proof));
        if (result?.retired !== true || result.reference !== proof.attempt.session) throw refuse();
      }
      if (!prior.state.maintenance || prior.checkpoint) {
        const state = { ...prior.state, sequence: prior.state.sequence + 1, previous: hash(prior.bytes), maintenance: true };
        validate(state, binding, slots);
        transition(prior.state, state);
        prior = await append(state);
      }
      const checkpoint = `checkpoint-${filename(prior.state.sequence)}`;
      const file = await open(join(root, checkpoint), 'wx', 0o600);
      try { await file.writeFile(prior.bytes); await file.sync(); } finally { await file.close(); }
      await regular(join(root, checkpoint));
      if (await readFile(join(root, checkpoint), 'utf8') !== prior.bytes) throw refuse();
      for (const name of await readdir(root)) {
        if (!/^(?:checkpoint-)?\d{8,16}\.json$/.test(name)) throw refuse();
        const sequence = Number(name.replace('checkpoint-', '').replace('.json', ''));
        if (name === checkpoint || sequence > prior.state.sequence) continue;
        await regular(join(root, name));
        await unlink(join(root, name));
      }
      return globalThis.structuredClone((await load()).state);
    }),
    terminalAttempt: ({ attemptId }) => guarded(async () => {
      if (!hex(attemptId)) throw refuse();
      let proof = null;
      await load((state) => {
        if (state.attempt?.id !== attemptId) return;
        proof = ['acknowledged', 'failed'].includes(state.attempt.phase)
          ? { binding: state.binding, fixedSlots: state.fixedSlots, attempt: state.attempt } : null;
      });
      return globalThis.structuredClone(proof);
    }),
    prepare: ({ digest, epoch, remoteGeneration = 0, requestedAttemptId, expectedSequence, condition, byteLength }) => update((state) => {
      if (typeof digest !== 'string' || !HEX.test(digest) || !integer(epoch, 1) || !integer(remoteGeneration)) throw refuse();
      if (condition !== undefined && (provider !== 'microsoft' || !isCloudMatchTag(condition))) throw refuse();
      if (byteLength !== undefined && (!integer(byteLength, 1) || byteLength > 32 * 1024 * 1024)) throw refuse();
      if (requestedAttemptId !== undefined || expectedSequence !== undefined) {
        if (!hex(requestedAttemptId) || !integer(expectedSequence) || state.sequence !== expectedSequence) {
          throw refuse('Cloud stream reservation changed. No prepared snapshot can be dispatched from the stale witness.');
        }
      }
      if (state.attempt && !['acknowledged', 'failed'].includes(state.attempt.phase)) {
        throw refuse('Cloud stream has an unresolved attempt. Later writes are fenced until provider proof is verified.');
      }
      const generation = Math.max(state.maxGeneration, remoteGeneration) + 1;
      if (!integer(generation, 1)) throw refuse('Cloud stream generation limit reached.');
      state.maxGeneration = generation;
      state.attempt = {
        id: requestedAttemptId ?? randomBytes(32).toString('hex'), generation, digest, epoch,
        slot: selectCloudStreamSlot(state), phase: 'prepared', session: null,
        ...(condition !== undefined ? { condition } : {}),
        ...(byteLength !== undefined ? { byteLength } : {}),
      };
      return state;
    }),
    abandonPrepared: ({ attemptId }) => update((state) => {
      requireAttempt(state, attemptId, ['prepared']);
      if (state.attempt.session !== null) throw refuse();
      state.attempt.phase = 'failed';
      return state;
    }),
    dispatch: ({ attemptId }) => update((state) => {
      requireAttempt(state, attemptId, ['prepared']);
      state.attempt.phase = 'in-flight';
      return state;
    }),
    markUnknown: ({ attemptId }) => update((state) => {
      requireAttempt(state, attemptId, ['in-flight']);
      state.attempt.phase = 'unknown';
      return state;
    }),
    attachSession: ({ attemptId, sessionReference }) => update((state) => {
      requireAttempt(state, attemptId, ['in-flight']);
      if (state.attempt.session !== null || typeof sessionReference !== 'string' || !HEX.test(sessionReference)) {
        throw refuse('Cloud stream needs a single host-protected session reference, never a capability URL.');
      }
      state.attempt.session = sessionReference;
      return state;
    }),
    settle: ({ attemptId, evidence }) => update(async (state) => {
      requireAttempt(state, attemptId, ['in-flight', 'unknown']);
      if (!verifyTerminal) throw refuse('Native provider terminal verification is unavailable. The stream remains fenced.');
      const proof = await verifyTerminal({ binding: globalThis.structuredClone(binding), slotId: slots[state.attempt.slot],
        attempt: globalThis.structuredClone(state.attempt), evidence });
      if (!proof || !['completed', 'failed'].includes(proof.result) || proof.attemptId !== attemptId
        || proof.generation !== state.attempt.generation || proof.digest !== state.attempt.digest
        || proof.slotId !== slots[state.attempt.slot] || proof.noOutstandingMutation !== true
        || (proof.result === 'completed' && proof.exactReadback !== true)) {
        throw refuse('Provider evidence does not establish a terminal matching attempt. The stream remains fenced.');
      }
      state.attempt.phase = proof.result === 'completed' ? 'acknowledged' : 'failed';
      if (proof.result === 'completed') state.snapshots[state.attempt.slot] = snapshot(state.attempt);
      return state;
    }),
  };
}
