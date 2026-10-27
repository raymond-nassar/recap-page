import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { createWindowsCloudAuth } from './windowsCloudAuth.mjs';
import { openCloudConnection } from './cloudConnection.mjs';
import { createCloudProviderTransport } from './cloudProviderTransport.mjs';
import { createCloudProviderReads } from './cloudProviderReads.mjs';
import { createCloudDiscovery } from './cloudDiscovery.mjs';
import { openCloudAllocation, loadCloudAllocationRoot } from './cloudAllocation.mjs';
import { loadCloudDestination } from './cloudDestination.mjs';
import { openCloudStreamLedger } from './cloudStreamLedger.mjs';
import { createWindowsCloudUploadSessions } from './cloudUploadSessions.mjs';
import { createGoogleCloudTerminalVerifier } from './cloudGoogleTerminal.mjs';
import { createGoogleCloudSlotWriter } from './cloudGoogleWrite.mjs';
import { openCloudPublicationLedger } from './cloudPublicationLedger.mjs';
import { createMicrosoftCloudPublication } from './cloudMicrosoftPublication.mjs';
import { createMicrosoftPublicationReads } from './cloudMicrosoftPublicationReads.mjs';
import { MICROSOFT_PUBLICATION_PROTOCOL, requireMicrosoftPublicationSnapshot } from './cloudMicrosoftPublicationRecord.mjs';
import { parseCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';

const HEX = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');

function failure(cause) {
  return copyCloudFailureMetadata(new Error('Native cloud backup is not ready or could not be verified. Local data is unchanged; preserve ownership and reconnect only when ready.'), cause);
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// No startup route constructs this service until supported platform/dependency/provider gates pass.
export function createWindowsCloudBackupService({
  directory, clients, openBrowser, createAuth = createWindowsCloudAuth, fetchImpl = globalThis.fetch, loadSdk,
}) {
  if (typeof openBrowser !== 'function' || typeof createAuth !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('Native cloud backup configuration is required.');
  }
  const owners = new Map();
  return async function adapterForProfile({ profileId, provider }) {
    if (typeof profileId !== 'string' || !HEX.test(profileId) || !['google', 'microsoft'].includes(provider)) throw failure();
    let pending = owners.get(profileId);
    if (!pending) {
      if (owners.size >= 256) throw failure();
      pending = openCloudConnection({ directory, profileId }).then((connection) => ({
        connection, provider: null, stopped: false, epoch: null, auth: null, account: null, runtime: null,
        tail: Promise.resolve(), cleanup: null,
      }));
      owners.set(profileId, pending);
      pending.catch(() => {});
    }
    const owner = await pending;
    const stored = await owner.connection.inspect();
    if ((stored.provider !== null && stored.provider !== provider)
      || (owner.provider !== null && owner.provider !== provider)) throw failure();
    owner.provider = provider;
    const client = clients?.[provider];
    if (!client || typeof client.clientId !== 'string' || !client.clientId) throw failure();
    const connection = owner.connection;
    async function state(phases) {
      const current = await connection.inspect();
      if (owner.stopped || (current.provider !== null && current.provider !== provider)
        || (owner.epoch !== null && current.epoch !== owner.epoch)
        || (phases && !phases.includes(current.phase))) throw failure();
      return current;
    }
    function current() { return !owner.stopped; }
    function run(operation) {
      const result = owner.tail.then(async () => {
        try { return await operation(); } catch (error) { throw failure(error); }
      });
      owner.tail = result.catch(() => {});
      return result;
    }
    async function auth(currentState) {
      if (!owner.auth) {
        owner.epoch = currentState.epoch;
        owner.auth = Promise.resolve().then(() => createAuth({
          directory, provider, profileId, epoch: owner.epoch, clientId: client.clientId, clientSecret: client.clientSecret,
          openBrowser, isCurrent: (binding) => !owner.stopped && binding.profileId === profileId
            && binding.provider === provider && binding.epoch === owner.epoch,
        }));
        owner.auth.catch(() => {});
      }
      const value = await owner.auth;
      await state();
      return value;
    }
    async function account(currentState) {
      const value = await (await auth(currentState)).status();
      await state();
      if (value.state !== 'connected' || value.provider !== provider
        || typeof value.account?.id !== 'string' || !value.account.id
        || typeof value.account.label !== 'string' || !value.account.label
        || (currentState.account !== null && currentState.account !== hash(value.account.id))
        || (currentState.client !== null && currentState.client !== hash(client.clientId))) throw failure();
      owner.account = { id: value.account.id, label: value.account.label };
      return owner.account;
    }
    async function requireCurrent(phases) {
      const value = await state(phases);
      if (!owner.account) await account(value);
      await connection.requireCurrent({
        epoch: owner.epoch, provider, accountId: owner.account.id, clientId: client.clientId, phases,
      });
      return value;
    }
    async function runtime(phases) {
      const value = await requireCurrent(phases);
      if (!owner.runtime) {
        const active = {};
        const transport = createCloudProviderTransport({
          provider, fetchImpl,
          getAccessToken: async () => {
            await requireCurrent(['discovering', 'awaiting-choice', 'allocating', 'active']);
            const token = await (await auth(value)).getAccessToken();
            await requireCurrent(['discovering', 'awaiting-choice', 'allocating', 'active']);
            return token;
          },
        });
        active.request = async (request) => {
          await requireCurrent(['discovering', 'awaiting-choice', 'allocating', 'active']);
          const reply = await transport(request);
          await requireCurrent(['discovering', 'awaiting-choice', 'allocating', 'active']);
          return reply;
        };
        active.rawReads = createCloudProviderReads({ provider, request: active.request, isCurrent: current });
        active.reads = provider === 'microsoft' ? createMicrosoftPublicationReads({
          reads: active.rawReads, isCurrent: current,
        }) : active.rawReads;
        active.discovery = createCloudDiscovery({ reads: active.reads, isCurrent: current });
        active.sessions = createWindowsCloudUploadSessions({
          directory, platform: 'win32', loadSdk,
          readTerminal: async (id) => await active.ledger?.terminalAttempt({ attemptId: id })
            ?? await active.allocation?.terminalAttempt({ attemptId: id }) ?? null,
        });
        owner.runtime = active;
      }
      return owner.runtime;
    }
    function destinationOptions(root) {
      return { directory, profileId, provider, accountId: owner.account.id, clientId: client.clientId, ...root };
    }
    function boundReads(active, root) {
      active.rawReads = createCloudProviderReads({ provider, request: active.request, isCurrent: current, ...root });
      active.reads = provider === 'microsoft' ? createMicrosoftPublicationReads({
        reads: active.rawReads, isCurrent: current,
      }) : active.rawReads;
      active.discovery = createCloudDiscovery({ reads: active.reads, isCurrent: current });
    }
    async function bindDestination(active, destination, allowInitialize = false) {
      boundReads(active, { appRootId: destination.appRootId, driveId: destination.driveId });
      const options = { directory, profileId, provider, accountId: owner.account.id,
        streamId: destination.streamId, fixedSlots: destination.fixedSlots };
      if (provider === 'microsoft') {
        if (destination.protocol !== MICROSOFT_PUBLICATION_PROTOCOL) {
          throw new Error('The legacy OneDrive stream is restore-only. Preserve it, disconnect, then choose a separate backup stream.');
        }
        const root = join(directory, 'cloud-publication-streams', profileId, provider, destination.account, destination.streamId);
        active.ledger = await openCloudPublicationLedger({
          ...options, initialize: allowInitialize && !await exists(root),
          verifyTerminal: (value) => publication.verifyTerminal(value),
        });
        const publication = createMicrosoftCloudPublication({
          destination, accountId: owner.account.id, ledger: active.ledger, request: active.request,
          reads: active.rawReads, sessions: active.sessions, isCurrent: current,
        });
        active.destination = destination;
        active.publication = publication;
        active.writer = publication;
        active.reads = publication.reads;
        active.discovery = createCloudDiscovery({ reads: active.reads, isCurrent: current });
        return;
      }
      const verifyTerminal = createGoogleCloudTerminalVerifier({ ...options, sessions: active.sessions, request: active.request,
        readFile: active.reads.readFile, isCurrent: current });
      const root = join(directory, 'cloud-streams', profileId, provider, destination.account, destination.streamId);
      active.ledger = await openCloudStreamLedger({
        ...options, verifyTerminal, initialize: allowInitialize && !await exists(root),
      });
      active.destination = destination;
      active.writer = createGoogleCloudSlotWriter({
        destination, accountId: owner.account.id, ledger: active.ledger, sessions: active.sessions,
        request: active.request, reads: active.reads, isCurrent: current,
      });
    }
    async function activeRuntime() {
      const active = await runtime(['active']);
      if (!active.destination) {
        const destination = await loadCloudDestination(destinationOptions({}));
        const value = await requireCurrent(['active']);
        if (destination.streamId !== value.streamId) throw failure();
        await bindDestination(active, destination);
      }
      return active;
    }
    async function acknowledge(active, ledgerState) {
      const attempt = ledgerState.attempt;
      if (attempt?.phase !== 'acknowledged') throw failure();
      const slotId = active.destination.fixedSlots[attempt.slot];
      const selected = await active.reads.readFile({ id: slotId });
      if (hash(selected.bytes) !== attempt.digest
        || (attempt.byteLength !== undefined && selected.bytes.length !== attempt.byteLength)) throw failure();
      const snapshot = await parseCloudSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(selected.bytes));
      if (selected.publication) requireMicrosoftPublicationSnapshot(selected.publication, snapshot, selected.bytes);
      if (snapshot.streamId !== active.destination.streamId || snapshot.slotId !== slotId
        || snapshot.attemptId !== attempt.id || snapshot.generation !== attempt.generation) throw failure();
      await requireCurrent(['active']);
      const acknowledgement = {
        epoch: owner.epoch, attemptEpoch: attempt.epoch, streamId: snapshot.streamId, attemptId: attempt.id,
        generation: attempt.generation, contentDigest: snapshot.contentDigest, byteDigest: attempt.digest,
      };
      await connection.acknowledge({ epoch: owner.epoch, acknowledgement });
      return { provider, phase: 'acknowledged', ...acknowledgement };
    }
    async function maintenance(active) {
      if (active.publication) await active.publication.cleanup();
      const compacted = await active.ledger.compact({
        retireTerminal: (proof) => active.sessions.retire({
          binding: { profileId, provider, accountId: owner.account.id, streamId: proof.binding.streamId,
            attemptId: proof.attempt.id, epoch: proof.attempt.epoch, slotId: proof.fixedSlots[proof.attempt.slot] },
          reference: proof.attempt.session,
        }),
      });
      const sessionsPruned = await active.sessions.sweep({
        profileId, provider, accountId: owner.account.id, streamId: active.destination.streamId,
      });
      await requireCurrent(['active']);
      await connection.compact();
      return { provider, epoch: owner.epoch, sequence: compacted.sequence,
        capacity: await active.ledger.capacity(), sessionsPruned };
    }
    const adapter = {
      status: () => run(async () => {
        const value = await state();
        if (value.phase === 'disconnected') return { provider, state: 'disconnected', phase: value.phase, epoch: value.epoch, account: null };
        if (['connecting', 'disconnecting'].includes(value.phase)) return {
          provider, state: 'reconnect-required', phase: value.phase, epoch: value.epoch, account: null,
        };
        const identity = await account(value);
        return { provider, state: value.phase === 'active' ? 'connected' : 'pending-choice',
          phase: value.phase, epoch: value.epoch, account: identity, acknowledgement: value.acknowledgement };
      }),
      connect: () => run(async () => {
        const begun = await connection.begin(provider);
        owner.epoch = begun.epoch;
        const native = await auth(begun);
        await native.connect();
        const identity = await account(begun);
        await connection.bindAccount({ epoch: begun.epoch, accountId: identity.id, clientId: client.clientId });
        return { provider, state: 'discovering', epoch: begun.epoch, account: identity };
      }),
      discover: () => run(async () => {
        const active = await runtime(['discovering', 'awaiting-choice', 'active']);
        const value = await state();
        const owned = await exists(join(directory, 'cloud-destinations', profileId, provider, value.account))
          || provider === 'microsoft' && await exists(join(directory, 'cloud-publication-destinations', profileId, provider, value.account));
        let resumable = owned;
        if (owned && !active.destination) {
          const destination = await loadCloudDestination(destinationOptions({}));
          resumable = provider !== 'microsoft' || destination.protocol === MICROSOFT_PUBLICATION_PROTOCOL;
          if (resumable) await bindDestination(active, destination);
          else boundReads(active, { appRootId: destination.appRootId, driveId: destination.driveId });
        }
        const publicationAllocation = provider === 'microsoft'
          && await exists(join(directory, 'cloud-publication-allocations', profileId, provider, value.account));
        if (!owned && !publicationAllocation && await exists(join(directory, 'cloud-allocations', profileId, provider, value.account))) {
          boundReads(active, await loadCloudAllocationRoot(destinationOptions({})));
        }
        if (publicationAllocation) {
          boundReads(active, await loadCloudAllocationRoot({ ...destinationOptions({}), protocol: MICROSOFT_PUBLICATION_PROTOCOL }));
        }
        const discoveredRoot = await active.reads.discoverRoot();
        if (!active.destination) boundReads(active, discoveredRoot);
        const result = await active.discovery.discover();
        if (value.phase === 'discovering' && resumable) {
          const destination = active.destination;
          await connection.activate({ epoch: owner.epoch, destination });
          return { provider, state: 'active', epoch: owner.epoch, ...result };
        }
        if (value.phase === 'active') return { provider, state: 'active', epoch: owner.epoch, ...result };
        const choice = await connection.discovered({ epoch: owner.epoch, result });
        return { provider, state: 'awaiting-choice', epoch: owner.epoch, discoveryId: choice.discoveryId, ...result };
      }),
      chooseSeparate: ({ epoch, discoveryId }) => run(async () => {
        const value = await state(['awaiting-choice', 'allocating']);
        if (epoch !== value.epoch || discoveryId !== value.discoveryId) throw failure();
        const publication = provider === 'microsoft';
        const active = await runtime(publication ? ['awaiting-choice', 'allocating'] : ['allocating', 'awaiting-choice']);
        if (publication) {
          const present = await exists(join(directory, 'cloud-publication-allocations', profileId, provider, value.account));
          if (value.phase === 'allocating' && !present) throw failure();
          const root = present
            ? await loadCloudAllocationRoot({ ...destinationOptions({}), protocol: MICROSOFT_PUBLICATION_PROTOCOL })
            : await active.rawReads.discoverRoot();
          boundReads(active, root);
          active.allocation = await openCloudAllocation({
            ...destinationOptions(root), protocol: MICROSOFT_PUBLICATION_PROTOCOL,
            epoch, request: active.request, reads: active.rawReads, sessions: active.sessions, isCurrent: current,
          });
          if (value.phase === 'awaiting-choice') await connection.chooseSeparate({ epoch, discoveryId });
          const destination = await active.allocation.allocate();
          await bindDestination(active, destination, true);
          await connection.activate({ epoch, destination });
          return { provider, state: 'active', epoch, streamId: destination.streamId };
        }
        if (value.phase === 'awaiting-choice') await connection.chooseSeparate({ epoch, discoveryId });
        const root = await exists(join(directory, 'cloud-allocations', profileId, provider, value.account))
          ? await loadCloudAllocationRoot(destinationOptions({})) : await active.reads.discoverRoot();
        boundReads(active, root);
        active.allocation = await openCloudAllocation({
          ...destinationOptions(root), epoch, request: active.request, reads: active.reads,
          sessions: active.sessions, isCurrent: current,
        });
        const destination = await active.allocation.allocate();
        await bindDestination(active, destination, true);
        await connection.activate({ epoch, destination });
        return { provider, state: 'active', epoch, streamId: destination.streamId };
      }),
      readSnapshot: ({ streamId, selection }) => run(async () => {
        const active = await runtime(['awaiting-choice', 'active']);
        return active.discovery.readSnapshot({ streamId, selection });
      }),
      writeSnapshot: ({ components, label, epoch }) => {
        let copy;
        try { copy = globalThis.structuredClone(components); } catch { return Promise.reject(failure()); }
        return run(async () => {
          const value = await state(['active']);
          if (value.epoch !== epoch) throw failure();
          const active = await activeRuntime();
          if ((await active.ledger.capacity()).remainingTransitions < 5) await maintenance(active);
          const written = await active.writer.writeSnapshot({ components: copy, label, epoch });
          return acknowledge(active, written);
        });
      },
      reconcile: () => run(async () => {
        const active = await activeRuntime();
        let ledgerState = active.publication ? await active.publication.reconcile() : await active.ledger.inspect();
        if (!active.publication && ledgerState.attempt?.phase === 'prepared') {
          ledgerState = await active.ledger.abandonPrepared({ attemptId: ledgerState.attempt.id });
        } else if (!active.publication && ['in-flight', 'unknown'].includes(ledgerState.attempt?.phase)) {
          ledgerState = await active.ledger.settle({ attemptId: ledgerState.attempt.id });
        }
        if (ledgerState.attempt?.phase === 'acknowledged') return acknowledge(active, ledgerState);
        return { provider, epoch: owner.epoch, phase: ledgerState.attempt?.phase ?? 'empty', acknowledgement: null };
      }),
      maintain: () => run(async () => {
        const active = await activeRuntime();
        return maintenance(active);
      }),
      disconnect() {
        owner.stopped = true;
        if (!owner.cleanup) {
          owner.cleanup = (async () => {
            try {
              const stopped = await connection.suspend();
              if (stopped.provider !== null && stopped.provider !== provider) throw failure();
              if (stopped.phase !== 'disconnected') {
                // Cleanup is permitted even when a stale/failed initialization cannot serve status.
                const native = owner.auth ? await owner.auth : await createAuth({
                  directory, profileId, provider, epoch: stopped.epoch, clientId: client.clientId,
                  clientSecret: client.clientSecret, openBrowser, isCurrent: () => false,
                });
                await native.disconnect();
                await connection.finishDisconnect({ epoch: stopped.epoch });
              }
              if (owners.get(profileId) === pending) owners.delete(profileId);
              return { provider, state: 'disconnected', account: null };
            } catch { throw failure(); }
          })();
          owner.cleanup.catch(() => { owner.cleanup = null; });
        }
        return owner.cleanup;
      },
    };
    return adapter;
  };
}
