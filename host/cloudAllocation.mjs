import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { openCloudLocalJournal } from './cloudLocalJournal.mjs';
import { openCloudDestination } from './cloudDestination.mjs';
import { MICROSOFT_CLOUD_SLOT_SEED } from './cloudMicrosoftWrite.mjs';
import { validateCloudUploadSession, isCloudMatchTag } from './cloudProviderTransport.mjs';
import { MICROSOFT_PUBLICATION_PROTOCOL, MICROSOFT_PUBLICATION_SEED } from './cloudMicrosoftPublicationRecord.mjs';

const HEX = /^[a-f0-9]{64}$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (value) => typeof value === 'string' && HEX.test(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value) && !['.', '..'].includes(value);

export class CloudAllocationError extends Error {
  constructor() {
    super('Cloud slot allocation is incomplete or its result is unknown. Preserve native ownership; no create or upload was retried.');
    this.name = 'CloudAllocationError';
  }
}

function metadata(reply, statuses = [200]) {
  if (!reply || !statuses.includes(reply.status) || !Buffer.isBuffer(reply.bytes) || reply.bytes.length > 1024 * 1024) {
    throw new CloudAllocationError();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes));
}

export async function loadCloudAllocationRoot({ directory, profileId, provider, accountId, clientId, protocol }) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !hex(profileId) || !['google', 'microsoft'].includes(provider)
    || [accountId, clientId].some((value) => typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024)
    || (protocol !== undefined && (provider !== 'microsoft' || protocol !== MICROSOFT_PUBLICATION_PROTOCOL))) {
    throw new TypeError('Native allocation identity is required.');
  }
  try {
    const publication = protocol === MICROSOFT_PUBLICATION_PROTOCOL;
    const path = join(directory, publication ? 'cloud-publication-allocations' : 'cloud-allocations',
      profileId, provider, hash(accountId), '0000000000000000.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 32768) throw new CloudAllocationError();
    const binding = JSON.parse(await readFile(path, 'utf8'))?.state?.binding;
    if (binding?.profileId !== profileId || binding.provider !== provider || binding.account !== hash(accountId)
      || binding.client !== hash(clientId) || (provider === 'google' ? binding.appRootId !== 'appDataFolder' || binding.driveId !== null
      : !identifier(binding.appRootId) || !identifier(binding.driveId))
      || (publication && binding.protocol !== MICROSOFT_PUBLICATION_PROTOCOL)) throw new CloudAllocationError();
    return { appRootId: binding.appRootId, driveId: binding.driveId };
  } catch { throw new CloudAllocationError(); }
}

// An interrupted remote creation is never inferred failed from absence or retried by name.
export async function openCloudAllocation({
  directory, profileId, provider, accountId, clientId, appRootId, driveId = null, epoch,
  request, reads, sessions, isCurrent, protocol,
}) {
  if (!hex(profileId) || !['google', 'microsoft'].includes(provider)
    || [accountId, clientId].some((value) => typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024)
    || (provider === 'google' ? appRootId !== 'appDataFolder' || driveId !== null : !identifier(appRootId) || !identifier(driveId))
    || !Number.isSafeInteger(epoch) || epoch < 1 || typeof request !== 'function'
    || typeof reads?.listFiles !== 'function' || typeof reads.discoverRoot !== 'function'
    || (provider === 'microsoft' && (typeof reads.readConditionalFile !== 'function'
      || typeof sessions?.save !== 'function' || typeof sessions.retire !== 'function'))
    || typeof isCurrent !== 'function'
    || (protocol !== undefined && (provider !== 'microsoft' || protocol !== MICROSOFT_PUBLICATION_PROTOCOL))) {
    throw new TypeError('Native allocation requires an exact consented app-storage connection.');
  }
  const publication = protocol === MICROSOFT_PUBLICATION_PROTOCOL;
  const seedBytes = Buffer.from(publication ? MICROSOFT_PUBLICATION_SEED : MICROSOFT_CLOUD_SLOT_SEED);
  const binding = { profileId, provider, account: hash(accountId), client: hash(clientId), appRootId, driveId,
    ...(publication ? { protocol: MICROSOFT_PUBLICATION_PROTOCOL } : {}) };
  const initial = { binding, streamId: randomBytes(32).toString('hex'), slots: [null, null], step: null };
  function validate(state) {
    if (!state || Object.keys(state).sort().join(',') !== 'binding,slots,step,streamId' || !same(state.binding, binding)
      || !hex(state.streamId) || !Array.isArray(state.slots) || state.slots.length !== 2
      || !state.slots.every((id) => id === null || identifier(id))
      || (state.slots[0] !== null && state.slots[0] === state.slots[1])) return false;
    const step = state.step;
    return step === null || (Object.keys(step).sort().join(',') === 'epoch,id,index,phase,session'
      && hex(step.id) && Number.isSafeInteger(step.epoch) && step.epoch >= 1 && [0, 1].includes(step.index)
      && ['dispatched', 'session', 'completed'].includes(step.phase)
      && (step.session === null || hex(step.session))
      && (step.phase !== 'session' || hex(step.session))
      && (step.phase !== 'completed' || state.slots[step.index] !== null));
  }
  function transition(a, b) {
    if (!a) return b.step === null && b.slots.every((id) => id === null);
    if (!same(a.binding, b.binding) || a.streamId !== b.streamId) return false;
    if (provider === 'google') return a.step === null && a.slots.every((id) => id === null)
      && b.step === null && b.slots.every(identifier);
    if (b.step?.phase === 'dispatched') return (!a.step || a.step.phase === 'completed')
      && b.step.index === a.slots.findIndex((id) => id === null) && same(a.slots, b.slots) && b.step.session === null;
    if (!a.step || !b.step || !same({ ...a.step, phase: b.step.phase, session: b.step.session }, b.step)) return false;
    if (a.step.phase === 'dispatched' && b.step.phase === 'session') return same(a.slots, b.slots);
    return a.step.phase === 'session' && b.step.phase === 'completed' && a.step.session === b.step.session
      && identifier(b.slots[b.step.index])
      && same(a.slots.map((id, index) => index === b.step.index ? b.slots[index] : id), b.slots);
  }
  const journal = await openCloudLocalJournal({
    directory, namespace: [publication ? 'cloud-publication-allocations' : 'cloud-allocations', profileId, provider, binding.account],
    format: publication ? 'recap-cloud-publication-allocation' : 'recap-cloud-allocation', initial, validate, transition,
  });
  function current() { if (isCurrent() !== true) throw new CloudAllocationError(); }
  async function call(options) { current(); const response = await request(options); current(); return response; }
  async function change(prior, operation) {
    current();
    return journal.update({ expectedSequence: prior.sequence, change: operation });
  }
  function name(state, index) { return `recap-backup-${state.streamId}-${index}.json`; }
  async function exactRoot() {
    current();
    const root = await reads.discoverRoot();
    current();
    if (root.appRootId !== appRootId || root.driveId !== driveId) throw new CloudAllocationError();
  }
  async function retireCompleted(state) {
    const step = state.step;
    if (provider !== 'microsoft' || step?.phase !== 'completed') return;
    current();
    await sessions.retire({ binding: { profileId, provider, accountId, streamId: state.streamId,
      attemptId: step.id, epoch: step.epoch, slotId: name(state, step.index) }, reference: step.session });
    current();
  }
  return {
    inspect: journal.inspect,
    terminalAttempt: async ({ attemptId }) => {
      // There are exactly two seed sessions; retained journal history is their retirement authority.
      const prior = await journal.inspect();
      const step = prior.state.step;
      if (!hex(attemptId) || step?.id !== attemptId || step.phase !== 'completed' || !step.session) return null;
      return {
        binding: { profileId, provider, account: binding.account, streamId: prior.state.streamId },
        fixedSlots: [name(prior.state, 0), name(prior.state, 1)],
        attempt: { id: step.id, epoch: step.epoch, slot: step.index, generation: step.index + 1,
          digest: hash(seedBytes), session: step.session, phase: 'acknowledged' },
      };
    },
    async allocate() {
      try {
        current();
        let prior = await journal.inspect();
        if (prior.state.step && prior.state.step.phase !== 'completed') throw new CloudAllocationError();
        await exactRoot();
        const options = { directory, profileId, provider, accountId, clientId, appRootId, driveId,
          ...(publication ? { protocol: MICROSOFT_PUBLICATION_PROTOCOL } : {}) };
        const root = join(directory, publication ? 'cloud-publication-destinations' : 'cloud-destinations', profileId, provider, binding.account);
        if (prior.state.slots.every(identifier)) {
          let present = true;
          try { await lstat(root); } catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
          if (present) {
            const destination = await openCloudDestination(options);
            if (destination.streamId !== prior.state.streamId || !same(destination.fixedSlots, prior.state.slots)) throw new CloudAllocationError();
            current();
            return destination;
          }
        }
        await retireCompleted(prior.state);
        if (provider === 'google' && prior.state.slots.some((id) => id === null)) {
          const ids = metadata(await call({
            target: '/drive/v3/files/generateIds?count=2&space=appDataFolder&type=files', maxBytes: 1024 * 1024,
          })).ids;
          if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(identifier) || ids[0] === ids[1]) throw new CloudAllocationError();
          prior = await change(prior, (state) => ({ ...state, slots: ids.slice() }));
        }
        while (provider === 'microsoft' && prior.state.slots.some((id) => id === null)) {
          if (prior.state.step && prior.state.step.phase !== 'completed') throw new CloudAllocationError();
          const index = prior.state.slots.findIndex((id) => id === null);
          const fileName = name(prior.state, index);
          current();
          const files = await reads.listFiles();
          current();
          if (!Array.isArray(files) || files.some((file) => file.name === fileName)) throw new CloudAllocationError();
          prior = await change(prior, (state) => ({ ...state,
            step: { id: randomBytes(32).toString('hex'), index, epoch, phase: 'dispatched', session: null } }));
          const started = metadata(await call({
            target: `/v1.0/me/drive/items/${encodeURIComponent(appRootId)}:/${fileName}:/createUploadSession?@microsoft.graph.conflictBehavior=fail`,
            method: 'POST', maxBytes: 1024 * 1024,
          }));
          const target = validateCloudUploadSession(provider, started.uploadUrl);
          const reference = await sessions.save({
            binding: { profileId, provider, accountId, streamId: prior.state.streamId,
              attemptId: prior.state.step.id, epoch, slotId: fileName }, target,
          });
          current();
          prior = await change(prior, (state) => ({ ...state, step: { ...state.step, phase: 'session', session: reference } }));
          const seed = seedBytes;
          const created = metadata(await call({
            kind: 'session', target, method: 'PUT', body: seed,
            contentRange: `bytes 0-${seed.length - 1}/${seed.length}`, maxBytes: 1024 * 1024,
          }), [200, 201]);
          if (!identifier(created?.id) || created.name !== fileName || created.parentReference?.id !== appRootId
            || created.parentReference?.driveId !== driveId) throw new CloudAllocationError();
          const selected = await reads.readConditionalFile({ id: created.id });
          current();
          if (selected.file?.id !== created.id || selected.file.name !== fileName || !Buffer.isBuffer(selected.bytes)
            || selected.file.size !== seed.length || !selected.bytes.equals(seed)
            || !isCloudMatchTag(selected.condition)) throw new CloudAllocationError();
          prior = await change(prior, (state) => ({ ...state,
            slots: state.slots.map((id, slot) => slot === index ? created.id : id),
            step: { ...state.step, phase: 'completed' } }));
          // Retire before advancing: the next seed must not discard the preceding terminal witness.
          await retireCompleted(prior.state);
        }
        let exists = true;
        try { await lstat(root); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
        current();
        const destination = await openCloudDestination(exists ? options : {
          ...options, initialize: true, streamId: prior.state.streamId, fixedSlots: prior.state.slots,
        });
        current();
        if (destination.streamId !== prior.state.streamId || !same(destination.fixedSlots, prior.state.slots)) throw new CloudAllocationError();
        return destination;
      } catch { throw new CloudAllocationError(); }
    },
  };
}
