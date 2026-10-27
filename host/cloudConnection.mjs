import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { openCloudLocalJournal } from './cloudLocalJournal.mjs';

const HEX = /^[a-f0-9]{64}$/;
const PHASES = ['disconnected', 'connecting', 'discovering', 'awaiting-choice', 'allocating', 'active', 'disconnecting'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function failure() { return new Error('Cloud connection ownership changed or needs explicit recovery. No upload is authorized.'); }
function hex(value) { return typeof value === 'string' && HEX.test(value); }

export async function openCloudConnection({ directory, profileId }) {
  if (!hex(profileId)) throw new TypeError('A native profile identity is required.');
  const initial = { profileId, epoch: 0, phase: 'disconnected', provider: null, account: null, client: null,
    discoveryId: null, discoveryDigest: null, streamId: null, acknowledgement: null };
  function validate(state) {
    if (!state || Object.keys(state).sort().join(',') !== 'account,acknowledgement,client,discoveryDigest,discoveryId,epoch,phase,profileId,provider,streamId'
      || state.profileId !== profileId || !Number.isSafeInteger(state.epoch) || state.epoch < 0
      || !PHASES.includes(state.phase)) return false;
    if (state.phase === 'disconnected') return same(state, { ...initial, epoch: state.epoch });
    if (!['google', 'microsoft'].includes(state.provider) || state.epoch < 1
      || !['account', 'client', 'discoveryId', 'discoveryDigest', 'streamId'].every((key) => state[key] === null || hex(state[key]))) return false;
    if (state.phase === 'connecting') return ['account', 'client', 'discoveryId', 'discoveryDigest', 'streamId'].every((key) => state[key] === null);
    if (state.phase === 'disconnecting') return true;
    if (!hex(state.account) || !hex(state.client)) return false;
    if (['awaiting-choice', 'allocating'].includes(state.phase)
      && (!hex(state.discoveryId) || !hex(state.discoveryDigest))) return false;
    const ack = state.acknowledgement;
    if (ack !== null && (!ack || Object.keys(ack).sort().join(',') !== 'attemptEpoch,attemptId,byteDigest,contentDigest,epoch,generation,streamId'
      || !['attemptId', 'byteDigest', 'contentDigest', 'streamId'].every((key) => hex(ack[key]))
      || !Number.isSafeInteger(ack.generation) || ack.generation < 1 || ack.epoch !== state.epoch
      || !Number.isSafeInteger(ack.attemptEpoch) || ack.attemptEpoch < 1
      || ack.streamId !== state.streamId || state.phase !== 'active')) return false;
    return state.phase !== 'active' || hex(state.streamId);
  }
  function transition(a, b) {
    if (!a) return same(b, initial);
    if (a.phase === 'disconnected') return b.phase === 'connecting' && b.epoch === a.epoch + 1
      && same(b, { ...initial, provider: b.provider, phase: 'connecting', epoch: b.epoch });
    if (b.phase === 'disconnecting') return b.epoch === a.epoch + 1
      && same(b, { ...a, epoch: b.epoch, phase: b.phase, acknowledgement: null });
    if (a.phase === 'disconnecting') return b.phase === 'disconnected' && b.epoch === a.epoch;
    if (b.epoch !== a.epoch || b.provider !== a.provider) return false;
    if (a.phase === 'connecting') return b.phase === 'discovering' && hex(b.account) && hex(b.client)
      && same(b, { ...a, phase: b.phase, account: b.account, client: b.client });
    if (['discovering', 'awaiting-choice'].includes(a.phase) && b.phase === 'awaiting-choice') return hex(b.discoveryId) && hex(b.discoveryDigest)
      && same(b, { ...a, phase: b.phase, discoveryId: b.discoveryId, discoveryDigest: b.discoveryDigest });
    if (a.phase === 'awaiting-choice' && b.phase === 'allocating') return same(b, { ...a, phase: b.phase });
    if (['discovering', 'allocating'].includes(a.phase) && b.phase === 'active') return hex(b.streamId)
      && same(b, { ...a, phase: b.phase, streamId: b.streamId });
    if (a.phase === 'active' && b.phase === 'active') return b.acknowledgement !== null
      && (!a.acknowledgement || b.acknowledgement.generation >= a.acknowledgement.generation)
      && (!a.acknowledgement || b.acknowledgement.generation !== a.acknowledgement.generation
        || same(a.acknowledgement, b.acknowledgement))
      && same(b, { ...a, acknowledgement: b.acknowledgement });
    return false;
  }
  const journal = await openCloudLocalJournal({
    directory, namespace: ['cloud-connections', profileId], format: 'recap-cloud-connection',
    initial, validate, transition,
  });
  async function update(epoch, phases, change) {
    const prior = await journal.inspect();
    if (prior.state.epoch !== epoch || !phases.includes(prior.state.phase)) throw failure();
    return (await journal.update({ expectedSequence: prior.sequence, change })).state;
  }
  function identity(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024) throw failure();
    return hash(value);
  }
  return {
    inspect: async () => (await journal.inspect()).state,
    begin: async (provider) => {
      if (!['google', 'microsoft'].includes(provider)) throw failure();
      const prior = await journal.inspect();
      if (prior.state.phase !== 'disconnected' || !Number.isSafeInteger(prior.state.epoch + 1)) throw failure();
      return (await journal.update({ expectedSequence: prior.sequence,
        change: (state) => ({ ...initial, epoch: state.epoch + 1, provider, phase: 'connecting' }) })).state;
    },
    bindAccount: ({ epoch, accountId, clientId }) => update(epoch, ['connecting'], (state) => ({
      ...state, phase: 'discovering', account: identity(accountId), client: identity(clientId),
    })),
    discovered: ({ epoch, result }) => {
      const bytes = JSON.stringify(result);
      if (!result || !Array.isArray(result.streams) || !Array.isArray(result.rejected) || bytes.length > 1024 * 1024) throw failure();
      return update(epoch, ['discovering', 'awaiting-choice'], (state) => ({ ...state, phase: 'awaiting-choice',
        discoveryId: randomBytes(32).toString('hex'), discoveryDigest: hash(bytes) }));
    },
    chooseSeparate: ({ epoch, discoveryId }) => update(epoch, ['awaiting-choice'], (state) => {
      if (!hex(discoveryId) || state.discoveryId !== discoveryId) throw failure();
      return { ...state, phase: 'allocating' };
    }),
    activate: ({ epoch, destination }) => update(epoch, ['discovering', 'allocating'], (state) => {
      if (!destination || destination.profileId !== profileId || destination.provider !== state.provider
        || destination.account !== state.account || destination.client !== state.client || !hex(destination.streamId)) throw failure();
      return { ...state, phase: 'active', streamId: destination.streamId };
    }),
    acknowledge: ({ epoch, acknowledgement }) => update(epoch, ['active'], (state) => ({
      ...state, acknowledgement: globalThis.structuredClone(acknowledgement),
    })),
    requireCurrent: async ({ epoch, provider, accountId, clientId, streamId, phases = ['active'] }) => {
      const state = (await journal.inspect()).state;
      if (state.epoch !== epoch || state.provider !== provider || !phases.includes(state.phase)
        || state.account !== identity(accountId) || state.client !== identity(clientId)
        || (streamId !== undefined && state.streamId !== streamId)) throw failure();
      return state;
    },
    suspend: async () => {
      const prior = await journal.inspect();
      if (['disconnecting', 'disconnected'].includes(prior.state.phase)) return prior.state;
      return update(prior.state.epoch, PHASES.filter((phase) => !['disconnected', 'disconnecting'].includes(phase)),
        (state) => ({ ...state, epoch: state.epoch + 1, phase: 'disconnecting', acknowledgement: null }));
    },
    finishDisconnect: ({ epoch }) => update(epoch, ['disconnecting'], () => ({ ...initial, epoch })),
    compact: journal.compact,
  };
}
