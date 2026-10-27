import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudProviderTransport, CloudProviderTransportError } from '../host/cloudProviderTransport.mjs';
import { openCloudStreamLedger, CloudStreamLedgerError } from '../host/cloudStreamLedger.mjs';
import { mkdtemp, mkdir, open, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { createWindowsCloudUploadSessions } from '../host/cloudUploadSessions.mjs';
import { createCloudProviderReads, CloudProviderReadError } from '../host/cloudProviderReads.mjs';
import { openCloudDestination, loadCloudDestination, CloudDestinationError } from '../host/cloudDestination.mjs';
import { createGoogleCloudTerminalVerifier, CloudGoogleTerminalError } from '../host/cloudGoogleTerminal.mjs';
import { createGoogleCloudSlotWriter, CloudGoogleWriteError } from '../host/cloudGoogleWrite.mjs';
import { captureCloudContent, parseCloudSnapshot, createCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { createMicrosoftCloudTerminalVerifier, CloudMicrosoftTerminalError } from '../host/cloudMicrosoftTerminal.mjs';
import { createMicrosoftCloudSlotWriter, CloudMicrosoftWriteError, MICROSOFT_CLOUD_SLOT_SEED } from '../host/cloudMicrosoftWrite.mjs';
import { createCloudDiscovery, CloudDiscoveryError } from '../host/cloudDiscovery.mjs';
import { openCloudConnection } from '../host/cloudConnection.mjs';
import { openCloudAllocation, loadCloudAllocationRoot, CloudAllocationError } from '../host/cloudAllocation.mjs';
import { createWindowsCloudBackupService } from '../host/windowsCloudBackup.mjs';

function backupServiceFixture(directory) {
  const files = new Map();
  const sessions = new Map();
  const control = { connected: false, putCount: 0, loseFinal: false, incomplete: false, failCleanup: false, requests: 0 };
  const sdk = sessionSdk();
  const nativeFile = (id) => {
    const file = files.get(id);
    return { id, name: file.name, size: String(file.bytes.length), mimeType: 'application/json',
      spaces: ['appDataFolder'], trashed: false, modifiedTime: '2026-10-22T00:00:00.000Z' };
  };
  const options = {
    directory, clients: { google: { clientId: 'synthetic-client' }, microsoft: { clientId: 'synthetic-microsoft' } },
    openBrowser: async () => assert.fail('fake service must not open a real browser'), loadSdk: sdk.loadSdk,
    createAuth: async ({ provider, isCurrent, profileId, epoch }) => ({
      connect: async () => { assert(isCurrent({ profileId, provider, epoch })); control.connected = true; },
      status: async () => ({ provider, state: control.connected ? 'connected' : 'disconnected',
        account: control.connected ? { id: 'synthetic-account', label: 'Synthetic reader' } : null }),
      getAccessToken: async () => { assert(control.connected); return 'synthetic-token'; },
      disconnect: async () => { if (control.failCleanup) throw new Error('PRIVATE_CLEANUP'); control.connected = false; },
    }),
    fetchImpl: async (url, request) => {
      control.requests++;
      assert.equal(url.origin, 'https://www.googleapis.com');
      assert.equal(request.headers.authorization, 'Bearer synthetic-token');
      if (url.pathname.endsWith('/generateIds')) return Response.json({ ids: ['service-slot-0', 'service-slot-1'] });
      if (url.searchParams.has('upload_id')) {
        const session = sessions.get(url.searchParams.get('upload_id'));
        if (request.headers['content-range'].startsWith('bytes */')) {
          return control.incomplete ? new Response(null, { status: 308 }) : Response.json({ id: session.id, size: String(files.get(session.id).bytes.length) });
        }
        control.putCount++;
        files.set(session.id, { name: session.name, bytes: Buffer.from(request.body) });
        if (control.loseFinal) { control.loseFinal = false; throw new Error('PRIVATE_DROPPED_FINAL'); }
        return Response.json({ id: session.id, size: String(request.body.length) });
      }
      if (url.pathname.startsWith('/upload/')) {
        const metadata = JSON.parse(request.body.toString());
        const id = metadata.id ?? url.pathname.split('/').at(-1);
        const token = String(sessions.size + 1);
        sessions.set(token, { id, name: metadata.name ?? files.get(id).name });
        return new Response('{}', { headers: { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${token}` } });
      }
      if (url.pathname === '/drive/v3/files') return Response.json({ files: [...files.keys()].map(nativeFile) });
      const id = url.pathname.split('/').at(-1);
      if (url.searchParams.get('alt') === 'media') return new Response(files.get(id).bytes);
      return Response.json(nativeFile(id));
    },
  };
  return { options, files, control };
}

test('native service requires discovery choice, distinguishes portable acknowledgements and reconciles lost reply without resending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-native-service-'));
  try {
    const fixture = backupServiceFixture(directory);
    const binding = { profileId: '6'.repeat(64), provider: 'google' };
    const adapter = await createWindowsCloudBackupService(fixture.options)(binding);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const begun = await adapter.connect();
    await assert.rejects(adapter.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: begun.epoch }));
    assert.equal(fixture.control.putCount, 0);
    const choices = await adapter.discover();
    assert.equal(choices.state, 'awaiting-choice');
    assert.deepEqual(choices.streams, []);
    await assert.rejects(adapter.chooseSeparate({ epoch: choices.epoch, discoveryId: 'f'.repeat(64) }));
    const active = await adapter.chooseSeparate(choices);
    const writing = adapter.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: active.epoch });
    capture.components.reader.notes[999] = 'This mutation follows the captured call';
    const acknowledged = await writing;
    assert.equal(acknowledged.contentDigest, capture.contentDigest);
    assert.equal(acknowledged.generation, 1);
    assert.equal(acknowledged.attemptEpoch, active.epoch);
    assert.notEqual(acknowledged.byteDigest, acknowledged.contentDigest);
    assert.equal((await adapter.status()).acknowledgement.contentDigest, capture.contentDigest);
    const reopenedFactory = createWindowsCloudBackupService(fixture.options);
    const reopened = await reopenedFactory(binding);
    assert.equal((await reopened.status()).acknowledgement.byteDigest, acknowledged.byteDigest);
    const discovered = await reopened.discover();
    assert.equal(discovered.streams[0].current.generation, 1);
    const selected = await reopened.readSnapshot({ streamId: active.streamId, selection: discovered.streams[0].current });
    assert.equal(selected.components.reader.notes[999], undefined);
    fixture.control.loseFinal = true;
    await assert.rejects(reopened.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: active.epoch }));
    assert.equal(fixture.control.putCount, 2);
    assert.equal((await reopened.status()).acknowledgement.generation, 1, 'lost B cannot be reported as acknowledged A');
    fixture.control.incomplete = true;
    await assert.rejects(reopened.reconcile());
    await assert.rejects(reopened.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: active.epoch }));
    assert.equal(fixture.control.putCount, 2, 'unknown A fences every later content attempt');
    fixture.control.incomplete = false;
    const recovered = await reopened.reconcile();
    assert.equal(recovered.generation, 2);
    assert.notEqual(recovered.contentDigest, acknowledged.contentDigest);
    assert.equal(fixture.control.putCount, 2, 'terminal reconciliation sends status/readback only');
    const maintained = await reopened.maintain();
    assert.equal(maintained.capacity.remainingTransitions, 8192);
    assert.equal(maintained.sessionsPruned.removed, 2);
    assert.equal((await reopened.maintain()).capacity.remainingTransitions, 8192, 'pruned capabilities are not reopened by repeated compaction');
    fixture.control.failCleanup = true;
    await assert.rejects(reopened.disconnect());
    const requests = fixture.control.requests;
    await assert.rejects(adapter.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: active.epoch }));
    assert.equal(fixture.control.requests, requests, 'another native process sees disconnect before provider work');
    await assert.rejects(reopenedFactory({ ...binding, provider: 'microsoft' }));
    const retry = await reopenedFactory(binding);
    fixture.control.failCleanup = false;
    await retry.disconnect();
    assert.equal(fixture.files.size, 2, 'disconnect preserves both remote snapshots');
    const disconnected = await (await createWindowsCloudBackupService(fixture.options)(binding)).status();
    assert.equal(disconnected.state, 'disconnected');
    assert.equal(disconnected.account, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native discovery validates complete envelopes and orders current and previous by generation rather than clocks', async () => {
  const { components } = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
  const streamId = '9'.repeat(64);
  const files = [];
  const bodies = new Map();
  for (let slot = 0; slot < 2; slot++) {
    const { text } = await createCloudSnapshot(components, {
      captureId: String(slot + 1).repeat(64), streamId, slotId: `discovered-${slot}`,
      attemptId: String(slot + 3).repeat(64), generation: slot + 1,
      capturedAt: slot ? '2020-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z', label: 'Synthetic device',
    });
    const file = { id: `discovered-${slot}`, name: `recap-backup-${streamId}-${slot}.json`,
      size: Buffer.byteLength(text), modifiedAt: null };
    files.push(file);
    bodies.set(file.id, Buffer.from(text));
  }
  let current = true;
  const reads = { listFiles: async () => [...files, { name: 'unrelated.json', id: 'ignored' }],
    readFile: async ({ id }) => ({ file: files.find((file) => file.id === id), bytes: bodies.get(id) }) };
  const discovery = createCloudDiscovery({ reads, isCurrent: () => current });
  const found = await discovery.discover();
  assert.equal(found.streams.length, 1);
  assert.equal(found.streams[0].current.generation, 2);
  assert.equal(found.streams[0].previous.generation, 1);
  assert.notEqual(found.streams[0].current.digest, found.streams[0].current.contentDigest);
  assert.equal((await discovery.readSnapshot({ streamId, selection: found.streams[0].current })).generation, 2);
  const original = bodies.get(files[1].id);
  const originalSize = files[1].size;
  bodies.set(files[1].id, Buffer.from(MICROSOFT_CLOUD_SLOT_SEED));
  files[1].size = Buffer.byteLength(MICROSOFT_CLOUD_SLOT_SEED);
  const firstOnly = await discovery.discover();
  assert.equal(firstOnly.streams[0].current.generation, 1, 'an unused reservation is not a corrupt complete snapshot');
  assert.equal(firstOnly.streams[0].previous, null);
  assert.deepEqual(firstOnly.rejected, []);
  bodies.set(files[1].id, original);
  files[1].size = originalSize;
  bodies.set(files[1].id, Buffer.alloc(files[1].size, 32));
  await assert.rejects(discovery.readSnapshot({ streamId, selection: found.streams[0].current }), CloudDiscoveryError);
  assert.equal((await discovery.discover()).streams.length, 0, 'a corrupt current slot cannot silently promote its older companion');
  bodies.set(files[1].id, bodies.get(files[0].id));
  const failedReads = createCloudDiscovery({
    reads: { ...reads, readFile: async () => { throw new Error('PRIVATE_PROVIDER_DETAIL'); } }, isCurrent: () => true,
  });
  await assert.rejects(failedReads.discover(), (error) => error instanceof CloudDiscoveryError && !error.message.includes('PRIVATE'));
  current = false;
  await assert.rejects(discovery.discover(), CloudDiscoveryError);
});

test('durable native connection requires exact initial choice and fences restart before disconnect cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-connection-'));
  try {
    const profileId = '7'.repeat(64);
    const options = { directory, profileId };
    const first = await openCloudConnection(options);
    const state = await first.begin('google');
    await assert.rejects(first.begin('microsoft'));
    await assert.rejects(first.activate({ epoch: state.epoch, destination: {} }));
    await first.bindAccount({ epoch: state.epoch, accountId: 'synthetic-account', clientId: 'synthetic-client' });
    const found = await first.discovered({ epoch: state.epoch, result: { streams: [], rejected: [] } });
    await assert.rejects(first.chooseSeparate({ epoch: state.epoch, discoveryId: '8'.repeat(64) }));
    const exact = { epoch: state.epoch, provider: 'google', accountId: 'synthetic-account', clientId: 'synthetic-client' };
    await assert.rejects(first.requireCurrent(exact));
    await first.chooseSeparate({ epoch: state.epoch, discoveryId: found.discoveryId });
    const destination = { profileId, provider: 'google', account: digest(exact.accountId), client: digest(exact.clientId), streamId: '5'.repeat(64) };
    await assert.rejects(first.activate({ epoch: state.epoch, destination: { ...destination, account: 'f'.repeat(64) } }));
    const active = await first.activate({ epoch: state.epoch, destination });
    assert.deepEqual(await first.requireCurrent(exact), active);
    const reopened = await openCloudConnection(options);
    await reopened.compact();
    assert.deepEqual(await reopened.inspect(), active);
    const stopping = await reopened.suspend();
    assert.equal(stopping.epoch, state.epoch + 1);
    await assert.rejects(first.requireCurrent(exact), 'old process must observe the durable fence');
    await assert.rejects(first.begin('microsoft'), 'cleanup must finish before another provider is selected');
    assert.equal((await (await openCloudConnection(options)).inspect()).phase, 'disconnecting');
    await reopened.finishDisconnect({ epoch: stopping.epoch });
    const disconnected = await first.inspect();
    assert.equal(disconnected.phase, 'disconnected');
    assert.equal(disconnected.account, null);
    assert.equal(disconnected.streamId, null);
    const results = await Promise.allSettled([first.begin('google'), reopened.begin('microsoft')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const root = join(directory, 'cloud-connections', profileId);
    const records = (await readdir(root)).filter((name) => !name.startsWith('c-')).sort();
    await writeFile(join(root, records.at(-1)), '{');
    await assert.rejects(openCloudConnection(options));
    assert.equal(await readFile(join(root, records.at(-1)), 'utf8'), '{');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function allocationFixture(options, { loseReply = false, duplicate = false, seed = MICROSOFT_CLOUD_SLOT_SEED, idPrefix = 'allocated-' } = {}) {
  let allocation;
  const files = [];
  const sessionsByUrl = new Map();
  const calls = [];
  const retired = [];
  const reads = {
    discoverRoot: async () => ({ appRootId: options.appRootId, driveId: options.driveId }),
    listFiles: async () => duplicate ? [{ name: `recap-backup-${(await allocation.inspect()).state.streamId}-0.json`, id: 'foreign' }] : files,
    readConditionalFile: async ({ id }) => ({ file: files.find((file) => file.id === id),
      bytes: Buffer.from(seed), condition: '"seed-tag"' }),
  };
  const sessions = {
    save: async ({ binding, target }) => { sessionsByUrl.set(target, binding); return digest(target); },
    retire: async ({ binding, reference }) => {
      const proof = await allocation.terminalAttempt({ attemptId: binding.attemptId });
      assert.equal(proof.attempt.session, reference);
      assert.equal(proof.attempt.digest, digest(seed));
      assert.equal(proof.fixedSlots[proof.attempt.slot], binding.slotId);
      retired.push(reference);
      return { retired: true, reference };
    },
  };
  const request = async (request) => {
    calls.push(request);
    if (options.provider === 'google') {
      assert.equal(request.target, '/drive/v3/files/generateIds?count=2&space=appDataFolder&type=files');
      return jsonReply({ ids: ['reserved-0', 'reserved-1'] });
    }
    if (request.kind !== 'session') {
      assert.equal(request.method, 'POST');
      assert.equal(request.body, undefined, 'Microsoft new-file initiation must remain body-free');
      assert(request.target.endsWith(':/createUploadSession?@microsoft.graph.conflictBehavior=fail'));
      if (loseReply) throw new Error('PRIVATE_LOST_REPLY');
      return jsonReply({ uploadUrl: `https://synthetic.up.1drv.com/${calls.length}` });
    }
    assert.equal(request.body.toString(), seed);
    const binding = sessionsByUrl.get(request.target);
    const file = { id: `${idPrefix}${files.length}`, name: binding.slotId, size: request.body.length,
      parentReference: { id: options.appRootId, driveId: options.driveId } };
    files.push(file);
    return { ...jsonReply(file), status: 201 };
  };
  return { reads, sessions, request, calls, retired, setAllocation: (value) => { allocation = value; } };
}

test('owned allocation reserves exact Google IDs or body-free nonconflicting Microsoft seeds before destination publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-allocation-'));
  try {
    for (const provider of ['google', 'microsoft']) {
      const options = { ...destinationOptions(directory, provider), epoch: 1, isCurrent: () => true };
      const fixture = allocationFixture(options);
      const allocation = await openCloudAllocation({ ...options, ...fixture });
      fixture.setAllocation(allocation);
      const destination = await allocation.allocate();
      assert.deepEqual(await loadCloudAllocationRoot(options), { appRootId: options.appRootId, driveId: options.driveId });
      assert.deepEqual(await loadCloudDestination(options), destination);
      const intent = await allocation.inspect();
      assert.equal(destination.streamId, intent.state.streamId);
      assert.deepEqual(destination.fixedSlots, provider === 'google' ? ['reserved-0', 'reserved-1'] : ['allocated-0', 'allocated-1']);
      assert.deepEqual(await openCloudDestination(destinationOptions(directory, provider)), destination);
      const sent = fixture.calls.length;
      const reopened = await openCloudAllocation({ ...options, ...fixture });
      fixture.setAllocation(reopened);
      assert.deepEqual(await reopened.allocate(), destination);
      assert.equal(fixture.calls.length, sent, 'reopening cannot create another stream or seed');
      if (provider === 'microsoft') assert.equal(new Set(fixture.retired).size, 2, 'each completed seed session must retire before its witness is superseded');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('owned allocation preserves uncertain create across reopen and refuses duplicate names before dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-allocation-'));
  try {
    for (const duplicate of [false, true]) {
      const options = { ...destinationOptions(directory, 'microsoft'), profileId: (duplicate ? 'b' : 'a').repeat(64),
        epoch: 1, isCurrent: () => true };
      const fixture = allocationFixture(options, { loseReply: true, duplicate });
      let allocation = await openCloudAllocation({ ...options, ...fixture });
      fixture.setAllocation(allocation);
      await assert.rejects(allocation.allocate(), (error) => error instanceof CloudAllocationError && !error.message.includes('PRIVATE'));
      const before = await allocation.inspect();
      assert.equal(before.state.step?.phase ?? null, duplicate ? null : 'dispatched');
      const calls = fixture.calls.length;
      allocation = await openCloudAllocation({ ...options, epoch: 2, ...fixture });
      fixture.setAllocation(allocation);
      await assert.rejects(allocation.allocate(), CloudAllocationError);
      assert.equal(fixture.calls.length, calls);
      assert.deepEqual(await allocation.inspect(), before);
      await assert.rejects(openCloudDestination({ ...destinationOptions(directory, 'microsoft'), profileId: options.profileId }));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('owned Microsoft root reads never invoke the special-folder creating lookup during reconciliation', async () => {
  const calls = [];
  const reads = createCloudProviderReads({
    provider: 'microsoft', appRootId: 'owned!root', driveId: 'owned-drive', isCurrent: () => true,
    request: async (request) => {
      calls.push(request);
      assert(!request.target.includes('/special/'));
      if (request.target.includes('/children')) return jsonReply({ value: [] });
      return jsonReply({ id: 'owned!root', folder: {}, parentReference: { driveId: 'owned-drive' }, specialFolder: { name: 'approot' } });
    },
  });
  assert.deepEqual(await reads.discoverRoot(), { appRootId: 'owned!root', driveId: 'owned-drive' });
  assert.deepEqual(await reads.listFiles(), []);
  assert.equal(calls.length, 3);
  const missing = createCloudProviderReads({
    provider: 'microsoft', appRootId: 'owned!root', driveId: 'owned-drive', isCurrent: () => true,
    request: async (request) => {
      assert(!request.target.includes('/special/'));
      throw new CloudProviderTransportError('Missing owned root.', { status: 404, outcome: 'read-only' });
    },
  });
  await assert.rejects(missing.discoverRoot(), (error) => error.status === 404 && error.outcome === 'read-only');
});

test('stream compaction retires only terminal sessions and preserves generations and unknown fences across reopen', async () => {
  await withLedger(async ({ options }) => {
    const { ledger, store, binding, reference } = await terminalSessionFixture(options);
    const next = await ledger.prepare({ digest: digest('newer'), epoch: 2 });
    await ledger.dispatch({ attemptId: next.attempt.id });
    await ledger.markUnknown({ attemptId: next.attempt.id });
    const unknown = await ledger.inspect();
    const retireTerminal = (proof) => store.retire({ binding: { ...binding, attemptId: proof.attempt.id }, reference: proof.attempt.session });
    await assert.rejects(ledger.compact({ retireTerminal }), /unresolved/);
    assert.deepEqual(await ledger.inspect(), unknown);
    await ledger.settle({ attemptId: next.attempt.id });
    const before = await ledger.inspect();
    await assert.rejects(ledger.compact(), /Retire terminal/);
    const compacted = await ledger.compact({ retireTerminal });
    assert.equal(compacted.maxGeneration, before.maxGeneration);
    assert.deepEqual(compacted.snapshots, before.snapshots);
    assert.deepEqual(compacted.attempt, before.attempt);
    assert.equal(compacted.sequence, before.sequence + 1);
    const reopened = await openCloudStreamLedger(options);
    assert.deepEqual(await reopened.inspect(), compacted);
    assert.equal((await reopened.capacity()).remainingTransitions, 8192);
    assert.equal(await reopened.terminalAttempt({ attemptId: binding.attemptId }), null, 'retired older authority no longer needs the discarded chain');
    await assert.rejects(store.load({ binding, reference }), /remains fenced/);
    const after = await reopened.prepare({ digest: digest('latest'), epoch: 3 });
    assert.equal(after.attempt.generation, before.maxGeneration + 1);
    assert.equal(after.maintenance, undefined);
    await assert.rejects(reopened.compact({ retireTerminal }), /unresolved/);
  });
});

test('stream maintenance resumes an interrupted exclusive claim and cannot discard a concurrently reserved generation', async () => {
  await withLedger(async ({ options }) => {
    const { ledger, store, binding, reference } = await terminalSessionFixture(options);
    let reserved;
    const retiring = (proof) => store.retire({ binding: { ...binding, attemptId: proof.attempt.id }, reference: proof.attempt.session });
    await assert.rejects(ledger.compact({
      retireTerminal: async (proof) => {
        const result = await retiring(proof);
        reserved = await ledger.prepare({ digest: digest('concurrent-reservation'), epoch: 2 });
        return result;
      },
    }));
    assert.equal((await ledger.inspect()).attempt.id, reserved.attempt.id);
    await assert.rejects(ledger.compact({ retireTerminal: retiring }), /unresolved/);
    const settled = await ledger.abandonPrepared({ attemptId: reserved.attempt.id });
    assert.equal(settled.attempt.phase, 'failed');
    await assert.rejects(ledger.dispatch({ attemptId: reserved.attempt.id }), /stale/);
    const root = join(options.directory, 'cloud-streams', options.profileId, options.provider, digest(options.accountId), options.streamId);
    const priorBytes = await readFile(join(root, `${String(settled.sequence).padStart(8, '0')}.json`), 'utf8');
    const interrupted = { ...settled, sequence: settled.sequence + 1, previous: digest(priorBytes), maintenance: true };
    await writeFile(join(root, `${String(interrupted.sequence).padStart(8, '0')}.json`), JSON.stringify(interrupted));
    const reopened = await openCloudStreamLedger(options);
    await assert.rejects(reopened.prepare({ digest: digest('must-not-dispatch'), epoch: 3 }), /maintenance/);
    assert.equal((await reopened.inspect()).maxGeneration, settled.maxGeneration);
    const compacted = await reopened.compact({ retireTerminal: retiring });
    assert.equal(compacted.maxGeneration, settled.maxGeneration);
    assert.deepEqual(compacted.snapshots, settled.snapshots);
    await assert.rejects(store.load({ binding, reference }), /remains fenced/);
    const latest = await reopened.prepare({ digest: digest('next-after-maintenance'), epoch: 3 });
    assert.equal(latest.attempt.generation, settled.maxGeneration + 1);
  });
});

test('provider transport refuses unsupported targets and payloads before acquiring credentials', async () => {
  let calls = 0;
  const transport = createCloudProviderTransport({
    provider: 'google', getAccessToken: async () => { calls++; return 'synthetic'; },
    fetchImpl: async () => assert.fail('unsupported input must not reach the network'),
  });
  for (const options of [
    { target: 'https://www.googleapis.com/drive/v3/files' },
    { target: '//untrusted.example/drive/v3/files' },
    { target: '/drive/v3/files/../other' },
    { target: '/drive/v3/files/%2e%2e/other' },
    { target: '/drive/v3/files', method: 'DELETE' },
    { target: '/drive/v3/files', body: 'unexpected' },
    { target: '/upload/drive/v3/files?uploadType=media', method: 'POST', body: '{}' },
    { target: '/drive/v3/files', method: 'POST', body: '{}', uploadSize: 2 },
    { kind: 'session', target: 'https://www.googleapis.com.evil.example/upload/drive/v3/files', method: 'PUT' },
    { kind: 'session', target: 'https://user:password@www.googleapis.com/upload/drive/v3/files', method: 'PUT' },
    { kind: 'session', target: 'https://www.googleapis.com/upload/drive/v3/files', method: 'PUT',
      contentRange: 'bytes 0-2/3', body: 'ab' },
  ]) await assert.rejects(transport(options), (error) => error.outcome === 'not-sent');
  assert.equal(calls, 0);
});

test('provider transport scopes bearer credentials to fixed APIs and Google sessions only', async () => {
  const seen = [];
  for (const provider of ['google', 'microsoft']) {
    let tokens = 0;
    const transport = createCloudProviderTransport({
      provider, getAccessToken: async () => { tokens++; return 'synthetic-token'; },
      fetchImpl: async (url, options) => {
        seen.push({ url: url.href, ...options });
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    const api = provider === 'google' ? '/drive/v3/files?spaces=appDataFolder' : '/v1.0/me/drive/special/approot';
    assert.equal((await transport({ target: api })).bytes.toString(), '{"ok":true}');
    const session = provider === 'google' ? 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'
      : 'https://synthetic.up.1drv.com/session';
    await transport({ kind: 'session', target: session, method: 'PUT', body: '{}', contentRange: 'bytes 0-1/2' });
    assert.equal(tokens, provider === 'google' ? 2 : 1);
    assert.equal(seen.at(-1).headers.authorization, provider === 'google' ? 'Bearer synthetic-token' : undefined);
    if (provider === 'google') {
      await transport({
        target: '/upload/drive/v3/files?uploadType=resumable', method: 'POST', body: '{"name":"synthetic"}', uploadSize: 2,
      });
      assert.equal(seen.at(-1).headers['x-upload-content-length'], '2');
      assert.equal(seen.at(-1).headers['x-upload-content-type'], 'application/json');
      assert.equal(seen.at(-1).headers.authorization, 'Bearer synthetic-token');
    }
    if (provider === 'microsoft') {
      const personalSession = 'https://my.microsoftpersonalcontent.com/personal/synthetic/session?capability=synthetic';
      await transport({ kind: 'session', target: personalSession, method: 'PUT', body: '{}', contentRange: 'bytes 0-1/2' });
      assert.equal(seen.at(-1).url, personalSession);
      assert.equal(seen.at(-1).headers.authorization, undefined);
      await transport({ kind: 'session', target: personalSession });
      assert.equal(seen.at(-1).headers.authorization, undefined);
      await transport({ kind: 'download', target: 'https://synthetic.files.1drv.com/download' });
      assert.equal(seen.at(-1).headers.authorization, undefined);
      const personalDownload = 'https://my.microsoftpersonalcontent.com/personal/synthetic/content?capability=synthetic';
      await transport({ kind: 'download', target: personalDownload });
      assert.equal(seen.at(-1).url, personalDownload);
      assert.equal(seen.at(-1).headers.authorization, undefined);
      assert.equal(tokens, 1);
      await assert.rejects(transport({ kind: 'session', target: 'https://synthetic.up.1drv.com.evil.example/session' }));
      await assert.rejects(transport({ kind: 'download', target: 'https://1drv.com.evil.example/download' }));
      const requestsBeforeInvalid = seen.length;
      for (const target of [
        'https://my.microsoftpersonalcontent.com.evil.example/session',
        'https://evil.my.microsoftpersonalcontent.com/session',
        'https://microsoftpersonalcontent.com/session',
        'https://unqualified.microsoftpersonalcontent.com/session',
        'http://my.microsoftpersonalcontent.com/session',
        'https://my.microsoftpersonalcontent.com:8443/session',
        'https://user:password@my.microsoftpersonalcontent.com/session',
        'https://my.microsoftpersonalcontent.com/session#capability',
      ]) {
        for (const kind of ['session', 'download']) {
          await assert.rejects(transport({ kind, target }), (error) => error.outcome === 'not-sent');
        }
      }
      assert.equal(seen.length, requestsBeforeInvalid, 'unsupported personal-content destinations must not dispatch');
      assert.equal(tokens, 1, 'Microsoft capabilities must not acquire bearer credentials');
      const redirected = createCloudProviderTransport({
        provider, getAccessToken: async () => assert.fail('capability must not acquire credentials'),
        fetchImpl: async (url, options) => {
          assert.equal(url.href, personalSession);
          assert.equal(options.redirect, 'manual');
          assert.equal(options.headers.authorization, undefined);
          return new Response(null, { status: 307, headers: { location: 'https://untrusted.example/session' } });
        },
      });
      await assert.rejects(redirected({
        kind: 'session', target: personalSession, method: 'PUT', body: '{}', contentRange: 'bytes 0-1/2',
      }), (error) => error.status === 307 && error.outcome === 'unknown');
      await assert.rejects(redirected({
        kind: 'download', target: personalSession,
      }), (error) => error.status === 307 && error.outcome === 'read-only');
      let contentCalls = 0;
      let nextLocation = personalDownload;
      const content = createCloudProviderTransport({
        provider, getAccessToken: async () => 'synthetic-token',
        fetchImpl: async (url, options) => {
          contentCalls++;
          assert.equal(options.redirect, 'manual');
          if (url.origin === 'https://graph.microsoft.com') {
            assert.equal(options.headers.authorization, 'Bearer synthetic-token');
            return new Response('ignored', { status: 302, headers: { location: nextLocation } });
          }
          assert.equal(url.href, personalDownload);
          assert.equal(options.headers.authorization, undefined);
          return new Response('{}');
        },
      });
      const contentTarget = '/v1.0/me/drive/items/synthetic/content';
      const handoff = await content({ target: contentTarget });
      assert.equal(handoff.status, 302);
      assert.equal(handoff.location, personalDownload);
      assert.equal(handoff.bytes.length, 0);
      assert.equal(contentCalls, 1, 'content handoff must not follow the redirect');
      assert.equal((await content({ kind: 'download', target: handoff.location })).bytes.toString(), '{}');
      assert.equal(contentCalls, 2);
      for (nextLocation of ['https://untrusted.example/download', 'http://my.microsoftpersonalcontent.com/download']) {
        await assert.rejects(content({ target: contentTarget }), (error) => {
          assert.equal(error.outcome, 'read-only');
          assert.equal(error.status, 302);
          assert(!error.message.includes(nextLocation));
          return true;
        });
      }
      nextLocation = personalDownload;
      for (const target of ['/v1.0/me/drive/items/synthetic', '/v1.0/me/drive/items/synthetic/other/content']) {
        await assert.rejects(content({ target }), (error) => error.status === 302 && error.outcome === 'read-only');
      }
      await assert.rejects(content({ target: contentTarget, method: 'POST' }),
        (error) => error.status === 302 && error.outcome === 'unknown');
    }
  }
  for (const request of seen) {
    assert.equal(request.redirect, 'manual');
    assert(request.signal instanceof AbortSignal);
    assert.equal(request.signal.aborted, true, 'completion closes the response deadline');
  }
});

test('provider transport never follows redirects and preserves unknown writes without exposing provider errors', async () => {
  const requests = [];
  let status = 302;
  const transport = createCloudProviderTransport({
    provider: 'google', getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url) => {
      requests.push(url.href);
      if (status === 0) throw new Error('PRIVATE_TOKEN_AND_SESSION_URL');
      return new Response('PRIVATE_TOKEN_AND_SESSION_URL', {
        status, headers: { location: 'https://untrusted.example/steal', 'retry-after': '600' },
      });
    },
  });
  for (status of [302, 401, 404, 429, 500, 0]) {
    for (const method of ['GET', 'PATCH']) {
      await assert.rejects(transport({ target: '/drive/v3/files/synthetic', method }), (error) => {
        assert(error instanceof CloudProviderTransportError);
        assert.equal(error.outcome, method === 'GET' ? 'read-only' : 'unknown');
        if (status) assert.equal(error.retryAfterMs, 600000, 'preserve longer provider retry delays');
        assert(!error.message.includes('PRIVATE'));
        assert(!error.message.includes('untrusted'));
        return true;
      });
    }
  }
  assert.equal(requests.length, 12, 'one dispatch per request, no retry or redirect');
});

test('provider transport bounds declared and streamed bytes and redacts body-reader failures', async () => {
  let response;
  const transport = createCloudProviderTransport({
    provider: 'microsoft', getAccessToken: async () => 'synthetic-token',
    fetchImpl: async () => response(),
  });
  const inputs = [
    () => new Response('small', { headers: { 'content-length': '100' } }),
    () => new Response('small', { headers: { 'content-length': 'invalid' } }),
    () => new Response('too-large'),
    () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error('PRIVATE_READER_DETAIL')); },
    })),
  ];
  for (response of inputs) {
    await assert.rejects(transport({ target: '/v1.0/me/drive/items/synthetic', maxBytes: 5 }), (error) =>
      error.outcome === 'read-only' && !error.message.includes('PRIVATE'));
  }
  response = () => new Response('exact');
  assert.equal((await transport({ target: '/v1.0/me/drive/items/synthetic', maxBytes: 5 })).bytes.toString(), 'exact');
});

test('provider transport separates credential failure, incomplete upload and complete-response deadlines', async (context) => {
  const unavailable = createCloudProviderTransport({
    provider: 'google', getAccessToken: async () => { throw new Error('PRIVATE_AUTH_DETAIL'); },
    fetchImpl: async () => assert.fail('authentication failure must not dispatch'),
  });
  await assert.rejects(unavailable({ target: '/drive/v3/files' }), (error) =>
    error.outcome === 'not-sent' && !error.message.includes('PRIVATE'));
  const transport = createCloudProviderTransport({
    provider: 'google', getAccessToken: async () => 'synthetic-token',
    fetchImpl: async () => new Response(null, { status: 308, headers: { range: 'bytes=0-1' } }),
  });
  const result = await transport({
    kind: 'session', target: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic',
    method: 'PUT', contentRange: 'bytes */10',
  });
  assert.equal(result.status, 308, 'an incomplete session must never become a completed upload');
  assert.equal(result.range, 'bytes=0-1');
  assert.equal(result.bytes.length, 0);
  await assert.rejects(transport({ target: '/drive/v3/files' }), /unsupported/);
  let expire;
  const timer = {};
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 30000);
    expire = callback;
    return timer;
  });
  context.mock.method(globalThis, 'clearTimeout', (handle) => assert.equal(handle, timer));
  for (const stall of ['headers', 'body']) {
    let signal;
    let ready;
    const started = new Promise((resolve) => { ready = resolve; });
    const stalled = createCloudProviderTransport({
      provider: 'google', getAccessToken: async () => 'synthetic-token',
      fetchImpl: async (url, options) => {
        signal = options.signal;
        if (stall === 'headers') {
          ready();
          return new Promise(() => {});
        }
        return new Response(new ReadableStream({ pull() { ready(); return new Promise(() => {}); } }));
      },
    });
    const pending = stalled({ target: '/drive/v3/files/synthetic', method: 'PATCH', body: '{}' });
    const rejected = assert.rejects(pending, (error) => error.outcome === 'unknown' && /timed out/.test(error.message));
    await started;
    assert.equal(signal.aborted, false);
    expire();
    await rejected;
    assert.equal(signal.aborted, true, `30-second deadline covers stalled ${stall}`);
  }
});

function nativeFile(provider, id = 'synthetic-file') {
  const common = { id, name: `${id}.json`, size: 2 };
  return provider === 'google' ? {
    ...common, size: '2', spaces: ['appDataFolder'], trashed: false, mimeType: 'application/json',
  } : { ...common, file: { mimeType: 'application/json' }, eTag: '"synthetic-tag"',
    parentReference: { id: 'app-root', driveId: 'personal-drive' } };
}

function jsonReply(value) { return { status: 200, bytes: Buffer.from(JSON.stringify(value)) }; }

test('native file discovery and reads stay in app storage and download exact selected bytes without capability bearer', async () => {
  for (const provider of ['google', 'microsoft']) {
    const seen = [];
    const first = nativeFile(provider);
    const second = nativeFile(provider, 'second-file');
    const image = provider === 'google'
      ? { ...nativeFile(provider, 'image'), mimeType: 'image/jpeg' }
      : { ...nativeFile(provider, 'image'), file: { mimeType: 'image/jpeg' } };
    const folder = provider === 'google'
      ? { ...nativeFile(provider, 'folder'), mimeType: 'application/vnd.google-apps.folder' }
      : { ...nativeFile(provider, 'folder'), file: undefined, folder: {} };
    const transport = createCloudProviderTransport({
      provider, getAccessToken: async () => 'synthetic-token',
      fetchImpl: async (url, options) => {
        seen.push({ url, options });
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'manual');
        if (url.origin === 'https://my.microsoftpersonalcontent.com') {
          assert.equal(options.headers.authorization, undefined);
          return new Response('{}');
        }
        assert.equal(options.headers.authorization, 'Bearer synthetic-token');
        if (url.pathname.endsWith('/special/approot')) {
          return Response.json({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' } });
        }
        if (url.pathname === '/drive/v3/files' || url.pathname.endsWith('/children')) {
          if (provider === 'google') {
            assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
            assert.equal(url.searchParams.get('q'), 'trashed = false');
            return Response.json(url.searchParams.has('pageToken')
              ? { files: [second], incompleteSearch: false }
              : { files: [first, folder, image], nextPageToken: 'opaque +/?', incompleteSearch: false });
          }
          assert.equal(url.pathname, '/v1.0/me/drive/items/app-root/children');
          return Response.json(url.searchParams.has('$skiptoken')
            ? { value: [second] }
            : { value: [first, folder, image],
              '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/items/app-root/children?$skiptoken=opaque' });
        }
        if (url.searchParams.get('alt') === 'media') return new Response('{}');
        if (url.pathname.endsWith('/content')) {
          return new Response(null, { status: 302,
            headers: { location: 'https://my.microsoftpersonalcontent.com/synthetic/download?capability=synthetic' } });
        }
        return Response.json(first);
      },
    });
    const requests = [];
    const reads = createCloudProviderReads({
      provider, isCurrent: () => true,
      request: (options) => { requests.push(options); return transport(options); },
    });
    const files = await reads.listFiles();
    assert.deepEqual(files, [
      { id: first.id, name: first.name, size: 2, modifiedAt: null },
      { id: second.id, name: second.name, size: 2, modifiedAt: null },
    ]);
    assert.equal(seen.length, provider === 'google' ? 2 : 3);
    const result = await reads.readFile({ id: files[0].id });
    assert.deepEqual(result.file, files[0]);
    assert.equal(result.bytes.toString(), '{}');
    assert.equal(result.digest, digest('{}'));
    assert.equal(seen.length, provider === 'google' ? 4 : 7);
    assert.equal(requests.at(-1).maxBytes, 2, 'metadata size bounds the streamed content request');
    assert(!JSON.stringify(result.file).includes('capability'));
    assert(!Object.hasOwn(reads, 'writeFile'), 'this prerequisite must not expose mutations');
    if (provider === 'microsoft') {
      const conditional = await reads.readConditionalFile({ id: first.id });
      assert.equal(conditional.condition, first.eTag);
      assert.equal(conditional.digest, result.digest);
    } else {
      const before = seen.length;
      await assert.rejects(reads.readConditionalFile({ id: first.id }), CloudProviderReadError);
      assert.equal(seen.length, before);
    }
  }
});

test('selected Microsoft downloads allow only one explicit same-origin handoff without credentials', async () => {
  const start = 'https://my.microsoftpersonalcontent.com/synthetic/start?capability=synthetic';
  const final = 'https://my.microsoftpersonalcontent.com/synthetic/final?capability=synthetic';
  const calls = [];
  let location = final;
  let finalStatus = 200;
  let content = '{}';
  let current = true;
  let withdraw = false;
  const transport = createCloudProviderTransport({
    provider: 'microsoft', getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      if (url.hostname === 'graph.microsoft.com') {
        assert.equal(options.headers.authorization, 'Bearer synthetic-token');
        if (url.pathname.endsWith('/special/approot')) {
          return Response.json({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' } });
        }
        if (url.pathname.endsWith('/content')) return new Response(null, { status: 302, headers: { location: start } });
        return Response.json(nativeFile('microsoft'));
      }
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.body, undefined);
      if (url.href === start) {
        if (withdraw) current = false;
        return new Response(null, { status: 302, headers: location === null ? {} : { location } });
      }
      assert.equal(url.href, final, 'a further or foreign destination must never be dispatched');
      return new Response(content, { status: finalStatus, headers: { location: start } });
    },
  });
  const reads = createCloudProviderReads({ provider: 'microsoft', request: transport, isCurrent: () => current });
  const selected = await reads.readFile({ id: nativeFile('microsoft').id });
  assert.equal(selected.bytes.toString(), '{}');
  assert.equal(selected.digest, digest('{}'));
  assert.equal(calls.length, 5, 'three authenticated metadata/content reads and two explicit tokenless GETs');
  for (location of [
    start, null, '/relative', 'http://my.microsoftpersonalcontent.com/synthetic/final',
    'https://other.1drv.com/synthetic/final', 'https://untrusted.example/synthetic/final',
    `${final}#fragment`, 'https://user@my.microsoftpersonalcontent.com/synthetic/final',
    'https://my.microsoftpersonalcontent.com:8443/synthetic/final',
  ]) {
    const before = calls.length;
    await assert.rejects(reads.readFile({ id: nativeFile('microsoft').id }), (error) => {
      assert(error instanceof CloudProviderTransportError || error instanceof CloudProviderReadError);
      assert(!error.message.includes('capability'));
      return true;
    });
    assert.equal(calls.length, before + 4, 'an invalid additional handoff must not dispatch its destination');
  }
  location = final;
  for (finalStatus of [302, 307]) {
    const before = calls.length;
    await assert.rejects(reads.readFile({ id: nativeFile('microsoft').id }));
    assert.equal(calls.length, before + 5, 'the reader must stop rather than follow a third capability request');
  }
  finalStatus = 200;
  content = 'oversized';
  await assert.rejects(reads.readFile({ id: nativeFile('microsoft').id }), CloudProviderTransportError);
  content = '{}';
  withdraw = true;
  const before = calls.length;
  await assert.rejects(reads.readFile({ id: nativeFile('microsoft').id }), CloudProviderReadError);
  assert.equal(calls.length, before + 4, 'withdrawal between handoffs must prevent the next GET');
});

test('native Microsoft conditional mutations require exact item routes and a strong bounded tag', async () => {
  let calls = 0;
  let tokens = 0;
  const seen = [];
  const request = createCloudProviderTransport({
    provider: 'microsoft', getAccessToken: async () => { tokens++; return 'synthetic-token'; },
    fetchImpl: async (url, options) => {
      calls++;
      seen.push({ url, options });
      return Response.json({ id: 'fixed', eTag: '"changed"' });
    },
  });
  for (const value of [undefined, '*', 'W/"weak"', 'not-quoted', '"bad\r\nvalue"', `"${'a'.repeat(1025)}"`]) {
    await assert.rejects(request({
      target: '/v1.0/me/drive/items/fixed/content', method: 'PUT', body: '{}', ifMatch: value,
    }), (error) => error.outcome === 'not-sent');
  }
  for (const options of [
    { target: '/v1.0/me/drive/root/content', method: 'PUT' },
    { target: '/v1.0/me/drive/items/fixed/other', method: 'PATCH' },
    { target: '/v1.0/me/drive/items/fixed', method: 'GET' },
    { target: '/v1.0/me/drive/items/fixed/createUploadSession', method: 'POST' },
  ]) await assert.rejects(request({ ...options, ifMatch: '"tag"', body: options.method === 'GET' ? undefined : '{}' }));
  for (const body of [undefined, '', Buffer.alloc(0)]) {
    await assert.rejects(request({
      target: '/v1.0/me/drive/items/fixed/content', method: 'PUT', ifMatch: '"tag"', body,
    }));
  }
  const google = createCloudProviderTransport({
    provider: 'google', getAccessToken: async () => { tokens++; return 'synthetic-token'; },
    fetchImpl: async () => { calls++; return Response.json({}); },
  });
  await assert.rejects(google({ target: '/drive/v3/files/fixed', method: 'PATCH', ifMatch: '"tag"', body: '{}' }));
  await assert.rejects(request({
    kind: 'session', target: 'https://my.microsoftpersonalcontent.com/session', method: 'PUT',
    ifMatch: '"tag"', body: '{}', contentRange: 'bytes 0-1/2',
  }));
  assert.equal(calls, 0);
  assert.equal(tokens, 0);
  await request({ target: '/v1.0/me/drive/items/fixed/content', method: 'PUT', ifMatch: '"tag"', body: '{}' });
  await request({ target: '/v1.0/me/drive/items/fixed?$select=id,eTag', method: 'PATCH', ifMatch: '"tag"', body: '{"description":"fence"}' });
  assert.equal(calls, 2);
  assert.equal(tokens, 2);
  assert(seen.every(({ options }) => options.headers['if-match'] === '"tag"'
    && options.headers.authorization === 'Bearer synthetic-token' && options.redirect === 'manual'));
});

test('native file discovery rejects incomplete, foreign, cyclic and over-limit replies instead of partial success', async () => {
  const valid = nativeFile('google');
  const malformed = [
    {}, { files: [valid], incompleteSearch: true }, { files: [valid, valid] },
    { files: [{ ...valid, spaces: ['drive'] }] }, { files: [{ ...valid, trashed: true }] },
    { files: [{ ...valid, size: '9007199254740992' }] }, { files: [{ ...valid, size: '2x' }] },
    { files: [{ ...valid, id: '../foreign' }] }, { files: [{ ...valid, modifiedTime: 'not-a-date' }] },
    { files: [], nextPageToken: '' }, { files: [], nextPageToken: 'x'.repeat(8193) },
    { files: Array.from({ length: 2001 }, (_, i) => nativeFile('google', `file-${i}`)) },
  ];
  for (const page of malformed) {
    const reads = createCloudProviderReads({ provider: 'google', request: async () => jsonReply(page), isCurrent: () => true });
    await assert.rejects(reads.listFiles(), CloudProviderReadError);
  }
  for (const pattern of ['cycle', 'pages', 'bytes']) {
    let count = 0;
    const reads = createCloudProviderReads({
      provider: 'google', isCurrent: () => true,
      request: async () => {
        count++;
        return jsonReply({ files: [], nextPageToken: pattern === 'cycle' ? 'repeated' : `page-${count}`,
          padding: pattern === 'bytes' ? 'x'.repeat(950 * 1024) : '' });
      },
    });
    await assert.rejects(reads.listFiles(), CloudProviderReadError);
    assert.equal(count, pattern === 'cycle' ? 2 : pattern === 'pages' ? 20 : 9);
  }
  for (const next of [
    'https://evil.example/v1.0/me/drive/items/app-root/children?$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/drive/items/foreign/children?$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/drive/items/app-root/children?$expand=children&$skiptoken=x',
    'https://graph.microsoft.com/v1.0/me/drive/items/app-root/children?$skiptoken=x&$skipToken=y',
    'https://graph.microsoft.com/v1.0/me/drive/items/app-root/children',
    'https://user@graph.microsoft.com/v1.0/me/drive/items/app-root/children?$skiptoken=x',
  ]) {
    let count = 0;
    const reads = createCloudProviderReads({
      provider: 'microsoft', isCurrent: () => true,
      request: async () => ++count === 1
        ? jsonReply({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' } })
        : jsonReply({ value: [nativeFile('microsoft')], '@odata.nextLink': next }),
    });
    await assert.rejects(reads.listFiles(), CloudProviderReadError);
    assert.equal(count, 2, 'foreign continuation must stop before another request');
  }
  for (const bytes of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(1024 * 1024 + 1)]) {
    const reads = createCloudProviderReads({
      provider: 'google', isCurrent: () => true, request: async () => ({ status: 200, bytes }),
    });
    await assert.rejects(reads.listFiles(), CloudProviderReadError);
  }
});

test('native selected reads reject wrong identity, oversized or changed bytes and stale connection results', async () => {
  const valid = nativeFile('google');
  for (const file of [
    { ...valid, id: 'foreign' }, { ...valid, size: String(32 * 1024 * 1024 + 1) },
    { ...valid, spaces: ['drive'] }, { ...valid, mimeType: 'application/vnd.google-apps.folder' },
    { ...valid, mimeType: 'image/jpeg' }, { ...valid, mimeType: 'application/octet-stream' },
  ]) {
    let calls = 0;
    const reads = createCloudProviderReads({
      provider: 'google', isCurrent: () => true, request: async () => { calls++; return jsonReply(file); },
    });
    await assert.rejects(reads.readFile({ id: valid.id }), CloudProviderReadError);
    assert.equal(calls, 1, 'invalid selected metadata must not start a download');
  }
  for (const bytes of ['{', '{}extra']) {
    let calls = 0;
    const reads = createCloudProviderReads({
      provider: 'google', isCurrent: () => true,
      request: async () => ++calls === 1 ? jsonReply(valid) : { status: 200, bytes: Buffer.from(bytes) },
    });
    await assert.rejects(reads.readFile({ id: valid.id }), CloudProviderReadError);
  }
  for (const change of [{ parentReference: { id: 'foreign', driveId: 'personal-drive' } },
    { parentReference: { id: 'app-root', driveId: 'foreign' } }, { remoteItem: {} }, { deleted: {} },
    { file: { mimeType: 'image/jpeg' } }, { file: {} }]) {
    let calls = 0;
    const reads = createCloudProviderReads({
      provider: 'microsoft', isCurrent: () => true,
      request: async () => ++calls === 1
        ? jsonReply({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' } })
        : jsonReply({ ...nativeFile('microsoft'), ...change }),
    });
    await assert.rejects(reads.readFile({ id: valid.id }), CloudProviderReadError);
    assert.equal(calls, 2);
  }
  for (const eTag of [undefined, '*', 'W/"weak"', 'unquoted', '"bad\nheader"']) {
    let calls = 0;
    const reads = createCloudProviderReads({
      provider: 'microsoft', isCurrent: () => true,
      request: async () => ++calls === 1
        ? jsonReply({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' } })
        : jsonReply({ ...nativeFile('microsoft'), eTag }),
    });
    await assert.rejects(reads.readConditionalFile({ id: valid.id }), CloudProviderReadError);
    assert.equal(calls, 2, 'a missing or weak precondition must stop before content');
  }
  for (const staleAt of [0, 1, 2]) {
    let current = staleAt !== 0;
    let calls = 0;
    const reads = createCloudProviderReads({
      provider: 'google', isCurrent: () => current,
      request: async () => {
        calls++;
        const result = calls === 1 ? jsonReply(valid) : { status: 200, bytes: Buffer.from('{}') };
        if (calls === staleAt) current = false;
        return result;
      },
    });
    await assert.rejects(reads.readFile({ id: valid.id }), /connection changed/);
    assert.equal(calls, staleAt);
  }
  const failure = createCloudProviderReads({
    provider: 'google', isCurrent: () => true,
    request: async () => { throw new Error('PRIVATE_PROVIDER_CAPABILITY'); },
  });
  await assert.rejects(failure.listFiles(), (error) =>
    error instanceof CloudProviderReadError && !error.message.includes('PRIVATE'));
});

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function terminalFixture(overrides = {}) {
  const bytes = Buffer.from('{"synthetic":"pending"}');
  const profileId = 'a'.repeat(64);
  const streamId = 'b'.repeat(64);
  const accountId = 'synthetic-account';
  const fixedSlots = ['fixed-slot-a', 'fixed-slot-b'];
  const attempt = {
    id: 'c'.repeat(64), digest: digest(bytes), generation: 1, epoch: 1,
    slot: 0, phase: 'unknown', session: 'd'.repeat(64),
  };
  const input = {
    binding: { profileId, provider: 'google', account: digest(accountId), streamId },
    slotId: fixedSlots[0], attempt, evidence: { byteLength: bytes.length },
  };
  const options = {
    profileId, streamId, accountId, fixedSlots,
    sessions: { load: async () => sessionTarget },
    request: async () => ({ status: 200, bytes: Buffer.from(JSON.stringify({
      id: input.slotId, size: String(bytes.length),
    })) }),
    readFile: async () => ({ file: { id: input.slotId, size: bytes.length }, bytes }),
    isCurrent: () => true,
    ...overrides,
  };
  return { bytes, input, options, verify: createGoogleCloudTerminalVerifier(options) };
}

test('Google terminal verification settles a reopened unknown ledger only after protected status and exact readback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-google-terminal-'));
  try {
    const fixture = terminalFixture();
    const { profileId, streamId, accountId, fixedSlots } = fixture.options;
    const sdk = sessionSdk();
    const sessions = createWindowsCloudUploadSessions({ directory, platform: 'win32', loadSdk: sdk.loadSdk });
    const options = { directory, profileId, provider: 'google', accountId, streamId, fixedSlots };
    const ledger = await openCloudStreamLedger({ ...options, initialize: true });
    const prepared = await ledger.prepare({ digest: digest(fixture.bytes), epoch: 1 });
    const attemptId = prepared.attempt.id;
    await ledger.dispatch({ attemptId });
    const reference = await sessions.save({
      binding: { profileId, provider: 'google', accountId, streamId, attemptId, epoch: 1, slotId: fixedSlots[0] },
      target: sessionTarget,
    });
    await ledger.attachSession({ attemptId, sessionReference: reference });
    await ledger.markUnknown({ attemptId });
    const { stdout } = await promisify(execFile)(process.execPath, [
      '--input-type=module', '-e',
      `import {openCloudStreamLedger} from ${JSON.stringify(new URL('../host/cloudStreamLedger.mjs', import.meta.url).href)};
       const ledger=await openCloudStreamLedger(JSON.parse(process.argv[1]));
       console.log(JSON.stringify(await ledger.inspect()));`,
      JSON.stringify(options),
    ]);
    assert.equal(JSON.parse(stdout).attempt.phase, 'unknown');
    let statusReads = 0;
    let contentReads = 0;
    const request = createCloudProviderTransport({
      provider: 'google', getAccessToken: async () => 'synthetic-token',
      fetchImpl: async (url, request) => {
        assert.equal(url.href, sessionTarget);
        assert.equal(request.method, 'PUT');
        assert.equal(request.body, undefined);
        assert.equal(request.headers['content-range'], `bytes */${fixture.bytes.length}`);
        assert.equal(request.redirect, 'manual');
        statusReads++;
        return Response.json({ id: fixedSlots[0], size: String(fixture.bytes.length) });
      },
    });
    const reopened = await openCloudStreamLedger({
      ...options,
      verifyTerminal: createGoogleCloudTerminalVerifier({
        ...fixture.options, sessions, request,
        readFile: async (selection) => {
          assert.equal(statusReads, 1, 'completion status must precede readback');
          assert.equal(selection.id, fixedSlots[0]);
          contentReads++;
          return fixture.options.readFile(selection);
        },
      }),
    });
    await assert.rejects(reopened.prepare({ digest: digest('newer'), epoch: 1 }), /unresolved attempt/);
    const settled = await reopened.settle({ attemptId, evidence: { byteLength: fixture.bytes.length } });
    assert.equal(settled.attempt.phase, 'acknowledged');
    assert.equal(statusReads, 1);
    assert.equal(contentReads, 1);
    assert.equal(settled.snapshots[0].digest, digest(fixture.bytes));
    const next = await reopened.prepare({ digest: digest('newer'), epoch: 1 });
    assert.equal(next.attempt.generation, 2);
    assert.equal(next.attempt.slot, 1);
    assert.equal(sdk.writes.length, 1, 'status verification must not rewrite protected sessions');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Google terminal verification retains the durable fence for incomplete, missing, malformed and mismatched results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-google-fence-'));
  try {
    const base = terminalFixture();
    const { profileId, streamId, accountId, fixedSlots } = base.options;
    let verifier;
    const ledger = await openCloudStreamLedger({
      directory, profileId, provider: 'google', accountId, streamId, fixedSlots, initialize: true,
      verifyTerminal: (input) => verifier(input),
    });
    const prepared = await ledger.prepare({ digest: digest(base.bytes), epoch: 1 });
    const attemptId = prepared.attempt.id;
    await ledger.dispatch({ attemptId });
    await ledger.attachSession({ attemptId, sessionReference: 'd'.repeat(64) });
    await ledger.markUnknown({ attemptId });
    const before = await ledger.inspect();
    const reply = (value, status = 200) => ({ status, bytes: Buffer.from(JSON.stringify(value)) });
    for (const overrides of [
      { request: async () => reply({}, 308) },
      { request: async () => { throw new CloudProviderTransportError('Provider refused.', { status: 404, outcome: 'read-only' }); } },
      { request: async () => reply({}, 202) },
      { request: async () => ({ status: 200, bytes: Buffer.from('{') }) },
      { request: async () => reply({ id: 'foreign-slot', size: String(base.bytes.length) }) },
      { request: async () => reply({ id: fixedSlots[0], size: '999' }) },
      { readFile: async () => ({ file: { id: fixedSlots[0], size: base.bytes.length },
        bytes: Buffer.alloc(base.bytes.length), digest: digest(base.bytes) }) },
      { readFile: async () => ({ file: { id: 'foreign-slot', size: base.bytes.length }, bytes: base.bytes }) },
      { readFile: async () => ({ file: { id: fixedSlots[0], size: base.bytes.length }, bytes: base.bytes.subarray(1) }) },
    ]) {
      verifier = terminalFixture(overrides).verify;
      await assert.rejects(ledger.settle({ attemptId, evidence: { byteLength: base.bytes.length } }));
      assert.deepEqual(await ledger.inspect(), before);
      await assert.rejects(ledger.prepare({ digest: digest('newer'), epoch: 1 }), /unresolved attempt/);
    }
    let readCalls = 0;
    const incomplete = terminalFixture({
      request: async () => reply({}, 308), readFile: async () => { readCalls++; return base.options.readFile(); },
    });
    await assert.rejects(incomplete.verify(incomplete.input), /incomplete upload/);
    assert.equal(readCalls, 0, 'old content is not terminal evidence when the session is incomplete');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Google terminal verification rejects foreign attempts, stale connections and leaked dependency errors', async () => {
  let loads = 0;
  const base = terminalFixture({ sessions: { load: async () => { loads++; return sessionTarget; } } });
  for (const input of [
    { ...base.input, binding: { ...base.input.binding, provider: 'microsoft' } },
    { ...base.input, binding: { ...base.input.binding, account: digest('other') } },
    { ...base.input, binding: { ...base.input.binding, profileId: 'e'.repeat(64) } },
    { ...base.input, binding: { ...base.input.binding, streamId: 'e'.repeat(64) } },
    { ...base.input, slotId: 'foreign-slot' },
    { ...base.input, attempt: { ...base.input.attempt, session: null } },
    { ...base.input, attempt: { ...base.input.attempt, phase: 'acknowledged' } },
    { ...base.input, evidence: { byteLength: 0 } },
    { ...base.input, evidence: { byteLength: 32 * 1024 * 1024 + 1 } },
  ]) await assert.rejects(base.verify(input), CloudGoogleTerminalError);
  assert.equal(loads, 0);
  for (const stage of ['load', 'status', 'readback']) {
    let current = true;
    let requests = 0;
    let reads = 0;
    const fixture = terminalFixture({
      isCurrent: () => current,
      sessions: { load: async ({ binding, reference }) => {
        assert.equal(binding.attemptId, base.input.attempt.id);
        assert.equal(binding.epoch, 1);
        assert.equal(binding.slotId, base.input.slotId);
        assert.equal(reference, base.input.attempt.session);
        if (stage === 'load') current = false;
        return sessionTarget;
      } },
      request: async () => {
        requests++;
        if (stage === 'status') current = false;
        return base.options.request();
      },
      readFile: async () => {
        reads++;
        if (stage === 'readback') current = false;
        return base.options.readFile();
      },
    });
    await assert.rejects(fixture.verify(fixture.input), /connection changed/);
    assert.equal(requests, stage === 'load' ? 0 : 1);
    assert.equal(reads, stage === 'readback' ? 1 : 0);
  }
  const failed = terminalFixture({
    sessions: { load: async () => { throw new Error('PRIVATE_SESSION_CAPABILITY'); } },
  });
  await assert.rejects(failed.verify(failed.input),
    (error) => error instanceof CloudGoogleTerminalError && !error.message.includes('PRIVATE'));
  const unsafe = terminalFixture({ sessions: { load: async () => 'https://foreign.example/upload' } });
  await assert.rejects(unsafe.verify(unsafe.input), CloudProviderTransportError);
});

function destinationOptions(directory, provider = 'google') {
  return {
    directory, profileId: '1'.repeat(64), provider, accountId: 'synthetic-account', clientId: 'synthetic-client',
    appRootId: provider === 'google' ? 'appDataFolder' : 'synthetic-root',
    driveId: provider === 'google' ? null : 'synthetic-drive',
  };
}

test('durable destination owns random installation stream and fixed slots across exact-account reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-destination-'));
  try {
    for (const provider of ['google', 'microsoft']) {
      const options = destinationOptions(directory, provider);
      const reserved = ['slot-a', 'slot-b'];
      const first = await openCloudDestination({ ...options, initialize: true, fixedSlots: reserved });
      const root = join(directory, 'cloud-destinations', options.profileId, provider, digest(options.accountId));
      const persisted = await readFile(join(root, 'destination.json'), 'utf8');
      assert.match(first.streamId, /^[a-f0-9]{64}$/);
      assert.equal(first.account, digest(options.accountId));
      assert.equal(first.client, digest(options.clientId));
      assert(!persisted.includes(options.accountId));
      assert(!persisted.includes(options.clientId));
      reserved[0] = 'foreign-slot';
      const reopened = await openCloudDestination(options);
      assert.deepEqual(reopened, first);
      assert.deepEqual(reopened.fixedSlots, ['slot-a', 'slot-b']);
      reopened.fixedSlots[0] = 'other-slot';
      assert.deepEqual(await openCloudDestination(options), first);
      assert.equal(await readFile(join(root, 'destination.json'), 'utf8'), persisted);
      const { stdout } = await promisify(execFile)(process.execPath, [
        '--input-type=module', '-e',
        `import {openCloudDestination} from ${JSON.stringify(new URL('../host/cloudDestination.mjs', import.meta.url).href)};
         const result=await openCloudDestination(JSON.parse(process.argv[1]));
         console.log(JSON.stringify(result));`,
        JSON.stringify(options),
      ]);
      assert.deepEqual(JSON.parse(stdout), first, 'separate native process must retain exact stream/slot ownership');
      for (const change of [{ clientId: 'other-client' }, provider === 'microsoft'
        ? { appRootId: 'other-root' } : { accountId: 'other-account' }]) {
        await assert.rejects(openCloudDestination({ ...options, ...change }), CloudDestinationError);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('durable destination reservations refuse concurrent, incomplete and corrupt ownership without replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-destination-'));
  try {
    const options = destinationOptions(directory);
    const initialize = { ...options, initialize: true, fixedSlots: ['slot-a', 'slot-b'] };
    const results = await Promise.allSettled([openCloudDestination(initialize), openCloudDestination(initialize)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const root = join(directory, 'cloud-destinations', options.profileId, options.provider, digest(options.accountId));
    const manifest = join(root, 'destination.json');
    const ready = join(root, 'ready');
    const original = await readFile(manifest, 'utf8');
    const originalReady = await readFile(ready, 'utf8');
    await assert.rejects(openCloudDestination(initialize), CloudDestinationError);
    assert.equal(await readFile(manifest, 'utf8'), original);
    for (const value of ['', '{', JSON.stringify({ ...JSON.parse(original), streamId: 'foreign-stream' }),
      JSON.stringify({ ...JSON.parse(original), fixedSlots: ['same', 'same'] }),
      JSON.stringify({ ...JSON.parse(original), binding: { ...JSON.parse(original).binding, client: '2'.repeat(64) } })]) {
      await writeFile(manifest, value);
      await assert.rejects(openCloudDestination(options), CloudDestinationError);
      await assert.rejects(openCloudDestination(initialize), CloudDestinationError);
      assert.equal(await readFile(manifest, 'utf8'), value);
    }
    await writeFile(manifest, original);
    await writeFile(ready, 'incomplete');
    await assert.rejects(openCloudDestination(options), CloudDestinationError);
    await rm(ready);
    await assert.rejects(openCloudDestination(options), CloudDestinationError);
    await assert.rejects(openCloudDestination(initialize), CloudDestinationError);
    assert.equal(await readFile(manifest, 'utf8'), original);
    await writeFile(ready, originalReady);
    assert.equal((await openCloudDestination(options)).streamId, JSON.parse(original).streamId);
    const partial = destinationOptions(directory, 'microsoft');
    const partialRoot = join(directory, 'cloud-destinations', partial.profileId, partial.provider, digest(partial.accountId));
    await mkdir(partialRoot, { recursive: true });
    await assert.rejects(openCloudDestination(partial), CloudDestinationError);
    await assert.rejects(openCloudDestination({ ...partial, initialize: true, fixedSlots: ['a', 'b'] }), CloudDestinationError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('durable destination validates native input and isolates profiles, providers and accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-destination-'));
  try {
    const options = destinationOptions(directory);
    for (const change of [
      { directory: 'relative' }, { profileId: '../foreign' }, { accountId: '' }, { clientId: '' },
      { provider: 'foreign' }, { appRootId: 'drive' }, { driveId: 'foreign-drive' },
      { initialize: 'true' }, { fixedSlots: ['a', 'b'] },
    ]) await assert.rejects(openCloudDestination({ ...options, ...change }), TypeError);
    for (const fixedSlots of [[], ['a'], ['same', 'same'], ['../other', 'b']]) {
      await assert.rejects(openCloudDestination({ ...options, initialize: true, fixedSlots }), TypeError);
    }
    const owners = [];
    for (const bound of [options, { ...options, accountId: 'other-account' },
      { ...options, profileId: '3'.repeat(64) }, destinationOptions(directory, 'microsoft')]) {
      owners.push(await openCloudDestination({ ...bound, initialize: true, fixedSlots: ['a', 'b'] }));
    }
    assert.equal(new Set(owners.map((owner) => owner.streamId)).size, owners.length);
    const root = join(directory, 'cloud-destinations', options.profileId, options.provider, digest(options.accountId));
    await writeFile(join(root, 'unexpected'), 'preserve');
    await assert.rejects(openCloudDestination(options), CloudDestinationError);
    assert.equal(await readFile(join(root, 'unexpected'), 'utf8'), 'preserve');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function sessionSdk({ failSave = false } = {}) {
  const writes = [];
  const control = { sdkLoads: 0 };
  const sdk = {
    DataProtectionScope: { CurrentUser: 'CurrentUser' },
    FilePersistenceWithDataProtection: {
      async create(path, scope) {
        assert.equal(scope, 'CurrentUser');
        const file = await open(path, 'a');
        await file.close();
        return {
          async save(value) {
            if (path.endsWith('credentials.bin')) {
              writes.push({ path, value });
              if (failSave) throw new Error('PRIVATE_CAPABILITY_URL');
            }
            // File-lifecycle fixture only. Actual encryption is proved with the native SDK separately.
            await writeFile(path, Buffer.from(value).toString('base64'));
          },
          async load() { return Buffer.from(await readFile(path, 'utf8'), 'base64').toString(); },
          async delete() { await rm(path); },
        };
      },
    },
  };
  return { writes, control, loadSdk: async () => { control.sdkLoads++; return sdk; } };
}

const sessionBinding = {
  profileId: 'a'.repeat(64), provider: 'google', accountId: 'synthetic-account',
  streamId: 'b'.repeat(64), attemptId: 'c'.repeat(64), epoch: 1, slotId: 'fixed-slot-a',
};
const sessionTarget = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic-capability';

test('protected upload sessions return only opaque references and reopen exact attempt-bound capability URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-upload-session-'));
  try {
    const fixture = sessionSdk();
    const options = { directory, platform: 'win32', loadSdk: fixture.loadSdk };
    const store = createWindowsCloudUploadSessions(options);
    const reference = await store.save({ binding: sessionBinding, target: sessionTarget });
    assert.match(reference, /^[a-f0-9]{64}$/);
    assert(!reference.includes('synthetic-capability'));
    assert.equal(fixture.writes.length, 1);
    assert.equal(await createWindowsCloudUploadSessions(options).load({ binding: sessionBinding, reference }), sessionTarget);
    assert.equal(fixture.writes.length, 1, 'reopening must not rewrite capability records');
    for (const change of [
      { profileId: 'd'.repeat(64) }, { provider: 'microsoft' }, { accountId: 'foreign-account' },
      { streamId: 'e'.repeat(64) }, { attemptId: 'f'.repeat(64) }, { epoch: 2 }, { slotId: 'foreign-slot' },
    ]) await assert.rejects(store.load({ binding: { ...sessionBinding, ...change }, reference }), /remains fenced/);
    assert.equal(fixture.writes.length, 1);
    const microsoftBinding = { ...sessionBinding, provider: 'microsoft' };
    const microsoftTarget = 'https://my.microsoftpersonalcontent.com/personal/synthetic/session?capability=synthetic';
    const microsoftReference = await store.save({ binding: microsoftBinding, target: microsoftTarget });
    assert.equal(await createWindowsCloudUploadSessions(options).load({
      binding: microsoftBinding, reference: microsoftReference,
    }), microsoftTarget);
    await assert.rejects(store.load({
      binding: { ...microsoftBinding, attemptId: 'f'.repeat(64) }, reference: microsoftReference,
    }), /remains fenced/);
    assert.equal(fixture.writes.length, 2, 'Microsoft exact-bound reopening must not rewrite the session');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('protected upload sessions withdraw retired or incomplete-retirement capabilities before loading the SDK', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-retired-session-'));
  try {
    const fixture = sessionSdk();
    const store = createWindowsCloudUploadSessions({ directory, platform: 'win32', loadSdk: fixture.loadSdk });
    const reference = await store.save({ binding: sessionBinding, target: sessionTarget });
    const ciphertext = fixture.writes[0].path;
    const original = await readFile(ciphertext);
    const marker = join(ciphertext, '..', '..', 'retired.json');
    await writeFile(marker, '{incomplete');
    const before = fixture.control.sdkLoads;
    await assert.rejects(store.load({ binding: sessionBinding, reference }), /remains fenced/);
    assert.equal(fixture.control.sdkLoads, before, 'withdrawn capabilities must not open or recreate native credentials');
    assert.deepEqual(await readFile(ciphertext), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function terminalSessionFixture(options) {
  const sdk = sessionSdk();
  const ledger = await openCloudStreamLedger({
    ...options, initialize: true,
    verifyTerminal: async ({ attempt, slotId }) => ({
      result: 'completed', attemptId: attempt.id, generation: attempt.generation,
      digest: attempt.digest, slotId, noOutstandingMutation: true, exactReadback: true,
    }),
  });
  const storeOptions = {
    directory: options.directory, platform: 'win32', loadSdk: sdk.loadSdk,
    readTerminal: (id) => ledger.terminalAttempt({ attemptId: id }),
  };
  const store = createWindowsCloudUploadSessions(storeOptions);
  const prepared = await ledger.prepare({ digest: digest('synthetic-completed-A'), epoch: 1 });
  const binding = {
    profileId: options.profileId, provider: options.provider, accountId: options.accountId,
    streamId: options.streamId, attemptId: prepared.attempt.id, epoch: 1, slotId: options.fixedSlots[prepared.attempt.slot],
  };
  const reference = await store.save({ binding, target: sessionTarget });
  await ledger.dispatch({ attemptId: binding.attemptId });
  await ledger.attachSession({ attemptId: binding.attemptId, sessionReference: reference });
  await ledger.settle({ attemptId: binding.attemptId });
  return { sdk, ledger, store, storeOptions, binding, reference, ciphertext: sdk.writes[0].path };
}

test('historical terminal session retirement never clears a newer unknown attempt or recreates credentials', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await terminalSessionFixture(options);
    const { ledger, store, binding, reference, ciphertext, sdk } = fixture;
    const historical = await ledger.terminalAttempt({ attemptId: binding.attemptId });
    assert.equal(historical.attempt.phase, 'acknowledged');
    historical.attempt.phase = 'unknown';
    assert.equal((await ledger.terminalAttempt({ attemptId: binding.attemptId })).attempt.phase, 'acknowledged');
    const next = await ledger.prepare({ digest: digest('synthetic-B'), epoch: 2 });
    await ledger.dispatch({ attemptId: next.attempt.id });
    await ledger.markUnknown({ attemptId: next.attempt.id });
    const before = await ledger.inspect();
    assert.equal(await ledger.terminalAttempt({ attemptId: next.attempt.id }), null);
    assert.equal(await ledger.terminalAttempt({ attemptId: 'e'.repeat(64) }), null);
    await assert.rejects(ledger.terminalAttempt({ attemptId: 'not-a-native-id' }), CloudStreamLedgerError);
    assert.deepEqual(await store.retire({ binding, reference }), { retired: true, reference });
    await assert.rejects(readFile(ciphertext), { code: 'ENOENT' });
    const marker = await readFile(join(ciphertext, '..', '..', 'retired.json'), 'utf8');
    assert(!marker.includes('upload_id') && !marker.includes('synthetic-capability'));
    const loads = sdk.control.sdkLoads;
    await assert.rejects(store.load({ binding, reference }), /remains fenced/);
    assert.equal(sdk.control.sdkLoads, loads);
    const reopened = createWindowsCloudUploadSessions({
      ...fixture.storeOptions,
      loadSdk: async () => assert.fail('completed retirement must not reopen native credentials'),
      readTerminal: async () => assert.fail('completed retirement already holds its verified authority'),
    });

    assert.deepEqual(await reopened.retire({ binding, reference }), { retired: true, reference });
    await assert.rejects(readFile(ciphertext), { code: 'ENOENT' });
    assert.deepEqual(await ledger.inspect(), before);
    await assert.rejects(ledger.prepare({ digest: digest('C'), epoch: 2 }), /fenced/);
  });
});

test('session retirement refuses a concurrent native opener so its SDK cannot recreate deleted ciphertext', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await terminalSessionFixture(options);
    let release;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const blocked = new Promise((resolve) => { release = resolve; });
    let first = true;
    const store = createWindowsCloudUploadSessions({
      ...fixture.storeOptions,
      loadSdk: async () => {
        if (first) { first = false; entered(); await blocked; }
        return fixture.sdk.loadSdk();
      },
    });
    const loading = store.load({ binding: fixture.binding, reference: fixture.reference });
    loading.catch(() => {});
    await started;
    try {
      await assert.rejects(store.retire({ binding: fixture.binding, reference: fixture.reference }), /retirement.*could not be verified/);
      assert((await readFile(fixture.ciphertext)).length > 0);
    } finally { release(); await loading.catch(() => {}); }
    await store.retire({ binding: fixture.binding, reference: fixture.reference });
    await assert.rejects(readFile(fixture.ciphertext), { code: 'ENOENT' });
  });
});

test('terminal tombstone pruning never opens credentials or removes a newer unresolved capability', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await terminalSessionFixture(options);
    const { ledger, store, binding, reference } = fixture;
    await store.retire({ binding, reference });
    const next = await ledger.prepare({ digest: digest('newer-unknown'), epoch: 2 });
    const newerBinding = { ...binding, attemptId: next.attempt.id, epoch: 2 };
    const newerReference = await store.save({ binding: newerBinding, target: sessionTarget });
    await ledger.dispatch({ attemptId: next.attempt.id });
    await ledger.attachSession({ attemptId: next.attempt.id, sessionReference: newerReference });
    await ledger.markUnknown({ attemptId: next.attempt.id });
    const before = await ledger.inspect();
    const parent = join(fixture.ciphertext, '..', '..', '..');
    const root = join(parent, reference);
    await writeFile(join(root, 'unowned-extra'), 'preserve');
    const sweep = createWindowsCloudUploadSessions({
      ...fixture.storeOptions, loadSdk: async () => assert.fail('sweep must never open native credentials'),
    });
    const scope = { profileId: binding.profileId, provider: binding.provider, accountId: binding.accountId, streamId: binding.streamId };
    await assert.rejects(sweep.sweep(scope), /retirement/);
    assert.equal(await readFile(join(root, 'unowned-extra'), 'utf8'), 'preserve');
    await rm(join(root, 'unowned-extra'));
    assert.deepEqual(await sweep.sweep(scope), { removed: 1, retained: 1 });
    await assert.rejects(readFile(join(root, 'retired.json')), { code: 'ENOENT' });
    assert.equal(await store.load({ binding: newerBinding, reference: newerReference }), sessionTarget);
    assert.deepEqual(await ledger.inspect(), before);
    assert.deepEqual(await sweep.sweep(scope), { removed: 0, retained: 1 });
  });
});

test('session retirement requires exact native terminal proof and leaves failed cleanup withdrawn for explicit retry', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await terminalSessionFixture(options);
    const { ledger, binding, reference, ciphertext, storeOptions, sdk } = fixture;
    const proof = await ledger.terminalAttempt({ attemptId: binding.attemptId });
    const original = await readFile(ciphertext);
    const marker = join(ciphertext, '..', '..', 'retired.json');
    const invalid = [
      null, { ...proof, binding: { ...proof.binding, account: 'f'.repeat(64) } },
      ...[{ phase: 'unknown' }, { epoch: 2 }, { session: 'f'.repeat(64) }, { digest: 'invalid' }, { slot: 1 }]
        .map((change) => ({ ...proof, attempt: { ...proof.attempt, ...change } })),
    ];
    for (const value of invalid) {
      const loads = sdk.control.sdkLoads;
      const store = createWindowsCloudUploadSessions({ ...storeOptions, readTerminal: async () => value });
      await assert.rejects(store.retire({ binding, reference }), /retirement.*could not be verified/);
      assert.equal(sdk.control.sdkLoads, loads);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      assert.deepEqual(await readFile(ciphertext), original);
    }
    let removals = 0;
    const failed = createWindowsCloudUploadSessions({
      ...storeOptions,
      removeCiphertext: async (path) => {
        removals++;
        assert.equal(path, ciphertext);
        const loads = sdk.control.sdkLoads;
        await assert.rejects(failed.load({ binding, reference }), /remains fenced/);
        assert.equal(sdk.control.sdkLoads, loads);
        throw new Error('PRIVATE_REMOVAL_FAILURE');
      },
    });
    await assert.rejects(failed.retire({ binding, reference }),
      (error) => /retirement.*could not be verified/.test(error.message) && !error.message.includes('PRIVATE'));
    assert.equal(removals, 1);
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).terminal.attemptId, binding.attemptId);
    assert.deepEqual(await readFile(ciphertext), original);
    const noop = createWindowsCloudUploadSessions({ ...storeOptions, removeCiphertext: async () => {} });
    await assert.rejects(noop.retire({ binding, reference }), /retirement.*could not be verified/);
    assert.deepEqual(await readFile(ciphertext), original);
    const retried = createWindowsCloudUploadSessions({
      ...storeOptions,
      loadSdk: async () => assert.fail('retirement retry must not recreate a protected credential'),
      readTerminal: async () => assert.fail('retirement retry must use its existing verified marker'),
    });
    assert.deepEqual(await retried.retire({ binding, reference }), { retired: true, reference });
    await assert.rejects(readFile(ciphertext), { code: 'ENOENT' });
    await assert.rejects(retried.load({ binding, reference }), /remains fenced/);
  });
});

test('protected upload sessions retain incomplete and corrupt files instead of opening or replacing them', async () => {
  for (const corruption of ['marker', 'missing', 'record']) {
    const directory = await mkdtemp(join(tmpdir(), 'recap-upload-session-'));
    try {
      const fixture = sessionSdk();
      const store = createWindowsCloudUploadSessions({ directory, platform: 'win32', loadSdk: fixture.loadSdk });
      const reference = await store.save({ binding: sessionBinding, target: sessionTarget });
      const { path, value } = fixture.writes[0];
      const ready = join(path, '..', '..', 'ready');
      if (corruption === 'marker') await rm(ready);
      if (corruption === 'missing') await rm(path);
      if (corruption === 'record') {
        const record = JSON.parse(value);
        record.binding.attemptId = 'e'.repeat(64);
        await writeFile(path, Buffer.from(JSON.stringify(record)).toString('base64'));
      }
      await assert.rejects(store.load({ binding: sessionBinding, reference }), /remains fenced/);
      assert.equal(fixture.writes.length, 1);
      if (corruption === 'missing') await assert.rejects(readFile(path), { code: 'ENOENT' });
      if (corruption === 'marker') await assert.rejects(readFile(ready), { code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('protected upload sessions refuse unsupported targets and failures without reflecting or saving capabilities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-upload-session-'));
  try {
    const fixture = sessionSdk({ failSave: true });
    const store = createWindowsCloudUploadSessions({ directory, platform: 'win32', loadSdk: fixture.loadSdk });
    for (const target of ['https://untrusted.example/PRIVATE_CAPABILITY_URL',
      'https://www.googleapis.com.evil.example/upload/drive/v3/files', 'http://www.googleapis.com/upload/drive/v3/files']) {
      await assert.rejects(store.save({ binding: sessionBinding, target }), (error) =>
        /remains fenced/.test(error.message) && !error.message.includes('PRIVATE'));
    }
    assert.equal(fixture.writes.length, 0);
    await assert.rejects(store.save({ binding: sessionBinding, target: sessionTarget }), (error) =>
      /remains fenced/.test(error.message) && !error.message.includes('PRIVATE'));
    assert.equal(fixture.writes.length, 1);
    assert.throws(() => createWindowsCloudUploadSessions({ directory, platform: 'linux', loadSdk: fixture.loadSdk }), /Windows/);
    await assert.rejects(store.load({ binding: sessionBinding, reference: '../other' }), /remains fenced/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function withLedger(run) {
  const directory = await mkdtemp(join(tmpdir(), 'recap-cloud-ledger-'));
  const options = {
    directory, profileId: 'a'.repeat(64), provider: 'google',
    accountId: 'synthetic-stable-account', streamId: 'b'.repeat(64), fixedSlots: ['synthetic-slot-a', 'synthetic-slot-b'],
  };
  const path = join(directory, 'cloud-streams', options.profileId, options.provider, digest(options.accountId), options.streamId);
  try { await run({ options, path }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('stream ledger preserves exact binding and prepared intent across reopen without sharing mutable state', async () => {
  await withLedger(async ({ options }) => {
    await assert.rejects(openCloudStreamLedger(options), /journal/);
    const ledger = await openCloudStreamLedger({ ...options, initialize: true });
    for (const reservation of [
      { requestedAttemptId: 'f'.repeat(64), expectedSequence: 1 },
      { requestedAttemptId: 'f'.repeat(64) },
      { expectedSequence: 0 },
    ]) {
      await assert.rejects(ledger.prepare({ digest: digest('stale'), epoch: 1, ...reservation }), /reservation changed/);
      assert.equal((await ledger.inspect()).sequence, 0);
    }
    const first = await ledger.prepare({ digest: digest('A'), epoch: 1, remoteGeneration: 12 });
    assert.equal(first.attempt.generation, 13);
    assert.equal(first.attempt.phase, 'prepared');
    assert.equal(first.attempt.slot, 0);
    const reopened = await openCloudStreamLedger(options);
    assert.deepEqual(await reopened.inspect(), first);
    const moduleUrl = new URL('../host/cloudStreamLedger.mjs', import.meta.url).href;
    const code = `import { openCloudStreamLedger } from ${JSON.stringify(moduleUrl)};
      const ledger = await openCloudStreamLedger(JSON.parse(process.argv[1]));
      console.log(JSON.stringify(await ledger.inspect()));`;
    const child = await promisify(execFile)(process.execPath,
      ['--input-type=module', '-e', code, JSON.stringify(options)], { windowsHide: true });
    assert.deepEqual(JSON.parse(child.stdout), first, 'another process reopens the same durable prepared intent');
    first.attempt.digest = digest('changed returned object');
    assert.equal((await reopened.inspect()).attempt.digest, digest('A'));
    await assert.rejects(openCloudStreamLedger({ ...options, fixedSlots: ['foreign-a', 'foreign-b'] }), /journal/);
    await assert.rejects(openCloudStreamLedger({ ...options, accountId: 'other-account' }), /journal/);
    await assert.rejects(openCloudStreamLedger({ ...options, initialize: true }), /journal/);
    await assert.rejects(openCloudStreamLedger({ ...options, streamId: '../other' }), /binding/);
  });
});

test('unknown stream attempt fences restart and queued B until verified late A completion, retaining actual remote bytes', async () => {
  await withLedger(async ({ options }) => {
    const remote = new Map();
    const verifyTerminal = async ({ attempt, slotId, evidence }) => {
      const completed = remote.get(slotId);
      return {
        result: 'completed', attemptId: attempt.id, generation: completed?.generation,
        digest: completed ? digest(completed.bytes) : null, slotId,
        noOutstandingMutation: evidence === 'provider-terminal-session', exactReadback: completed?.id === attempt.id,
      };
    };
    let ledger = await openCloudStreamLedger({ ...options, initialize: true, verifyTerminal });
    const a = (await ledger.prepare({ digest: digest('A'), epoch: 1 })).attempt;
    await ledger.dispatch({ attemptId: a.id });
    await ledger.attachSession({ attemptId: a.id, sessionReference: 'c'.repeat(64) });
    await assert.rejects(ledger.attachSession({ attemptId: a.id, sessionReference: 'd'.repeat(64) }), /single/);
    await ledger.markUnknown({ attemptId: a.id });
    ledger = await openCloudStreamLedger({ ...options, verifyTerminal });
    assert.equal((await ledger.inspect()).attempt.session, 'c'.repeat(64));
    await assert.rejects(ledger.prepare({ digest: digest('B'), epoch: 2 }), /fenced/);
    await assert.rejects(ledger.dispatch({ attemptId: a.id }), /already dispatched/);
    await assert.rejects(ledger.settle({ attemptId: a.id, evidence: 'old-bytes-or-absence' }), /terminal/);
    assert.equal(remote.size, 0);
    // Fake provider finishes A after the local timeout, not when its callback was discarded.
    remote.set(options.fixedSlots[a.slot], { id: a.id, generation: a.generation, bytes: 'A' });
    await ledger.settle({ attemptId: a.id, evidence: 'provider-terminal-session' });
    const b = (await ledger.prepare({ digest: digest('B'), epoch: 2 })).attempt;
    assert.equal(b.generation, a.generation + 1);
    assert.notEqual(b.slot, a.slot);
    await ledger.dispatch({ attemptId: b.id });
    remote.set(options.fixedSlots[b.slot], { id: b.id, generation: b.generation, bytes: 'B' });
    await ledger.settle({ attemptId: b.id, evidence: 'provider-terminal-session' });
    const final = await (await openCloudStreamLedger({ ...options, verifyTerminal })).inspect();
    assert.deepEqual(final.snapshots.map((value) => value.generation), [1, 2]);
    assert.equal(remote.get(options.fixedSlots[0]).bytes, 'A');
    assert.equal(remote.get(options.fixedSlots[1]).bytes, 'B');
    assert.equal(final.snapshots[1].digest, digest('B'));
    await assert.rejects(ledger.settle({ attemptId: a.id, evidence: 'provider-terminal-session' }), /stale/);
    const c = (await ledger.prepare({ digest: digest('C'), epoch: 2 })).attempt;
    assert.equal(c.slot, a.slot, 'replace only the older slot, retaining current B');
    assert.equal(c.generation, 3);
  });
});

test('exclusive stream append claims prevent duplicate dispatch across independently opened owners', async () => {
  await withLedger(async ({ options }) => {
    const first = await openCloudStreamLedger({ ...options, initialize: true });
    const second = await openCloudStreamLedger(options);
    const prepared = await Promise.allSettled([
      first.prepare({ digest: digest('A'), epoch: 1 }),
      second.prepare({ digest: digest('B'), epoch: 1 }),
    ]);
    assert.equal(prepared.filter((result) => result.status === 'fulfilled').length, 1);
    const { attempt } = await first.inspect();
    const sent = await Promise.allSettled([
      first.dispatch({ attemptId: attempt.id }), second.dispatch({ attemptId: attempt.id }),
    ]);
    assert.equal(sent.filter((result) => result.status === 'fulfilled').length, 1);
    const restarted = await openCloudStreamLedger(options);
    assert.equal((await restarted.inspect()).attempt.phase, 'in-flight');
    await assert.rejects(restarted.prepare({ digest: digest('C'), epoch: 3 }), /fenced/);
    await assert.rejects(restarted.dispatch({ attemptId: attempt.id }), /already dispatched/);
  });
});

test('stream journal refuses truncated, gapped and altered records without replacing or dropping evidence', async () => {
  for (const corruption of ['truncated', 'gap', 'altered']) {
    await withLedger(async ({ options, path }) => {
      const ledger = await openCloudStreamLedger({ ...options, initialize: true });
      await ledger.prepare({ digest: digest('A'), epoch: 1 });
      const filename = join(path, corruption === 'gap' ? '00000003.json' : '00000001.json');
      let bytes = '{"partial":';
      if (corruption === 'altered') {
        const value = JSON.parse(await readFile(filename, 'utf8'));
        value.maxGeneration = 0;
        bytes = JSON.stringify(value);
      }
      await writeFile(filename, bytes);
      await assert.rejects(openCloudStreamLedger(options), /journal/);
      await assert.rejects(ledger.prepare({ digest: digest('B'), epoch: 2 }), /journal/);
      assert.equal(await readFile(filename, 'utf8'), bytes);
    });
  }
});

test('stream settlement requires exact native terminal proof and failed attempts never reuse a generation', async () => {
  await withLedger(async ({ options }) => {
    const ledger = await openCloudStreamLedger({ ...options, initialize: true });
    const a = (await ledger.prepare({ digest: digest('A'), epoch: 1 })).attempt;
    await ledger.dispatch({ attemptId: a.id });
    await assert.rejects(ledger.settle({ attemptId: a.id, evidence: true }), /verification is unavailable/);
    let proof;
    const verifier = await openCloudStreamLedger({ ...options, verifyTerminal: async () => proof });
    const valid = { result: 'failed', attemptId: a.id, generation: a.generation, digest: a.digest,
      slotId: options.fixedSlots[a.slot], noOutstandingMutation: true };
    for (const changed of [{ noOutstandingMutation: false }, { digest: digest('other') }, { result: 'completed', exactReadback: false }]) {
      proof = { ...valid, ...changed };
      await assert.rejects(verifier.settle({ attemptId: a.id }), /terminal/);
      assert.equal((await verifier.inspect()).attempt.phase, 'in-flight');
    }
    proof = valid;
    const failed = await verifier.settle({ attemptId: a.id });
    assert.deepEqual(failed.snapshots, [null, null]);
    const b = (await verifier.prepare({ digest: digest('B'), epoch: 2 })).attempt;
    assert.equal(b.generation, 2);
    assert.equal(b.slot, 0);
    await assert.rejects(verifier.prepare({ digest: digest('C'), epoch: 2 }), /fenced/);
    await assert.rejects(verifier.dispatch({ attemptId: a.id }), /stale/);
    await verifier.dispatch({ attemptId: b.id });
    let finish;
    let started;
    const waiting = new Promise((resolve) => { started = resolve; });
    const delayed = await openCloudStreamLedger({ ...options, verifyTerminal: async () => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    } });
    const pending = delayed.settle({ attemptId: b.id });
    const rejected = assert.rejects(pending, /journal/);
    await waiting;
    await verifier.markUnknown({ attemptId: b.id });
    finish({ result: 'completed', attemptId: b.id, generation: b.generation, digest: b.digest,
      slotId: options.fixedSlots[b.slot], noOutstandingMutation: true, exactReadback: true });
    await rejected;
    const remaining = await verifier.inspect();
    assert.equal(remaining.attempt.phase, 'unknown', 'proof started against an older journal cannot replace a newer transition');
    assert.deepEqual(remaining.snapshots, [null, null]);
  });
});

test('Google slot writer reserves one attempt, retains previous bytes and acknowledges only verified remote content', async () => {
  await withLedger(async ({ options }) => {
    const destination = await openCloudDestination({
      ...options, clientId: 'registered-native-client', appRootId: 'appDataFolder',
      fixedSlots: options.fixedSlots, initialize: true,
    });
    const remote = new Map();
    const sessions = {
      async save({ binding, target }) {
        assert.equal(binding.streamId, destination.streamId);
        assert.equal(target, sessionTarget);
        return 'd'.repeat(64);
      },
      async load() { return sessionTarget; },
    };
    let initiation;
    const requests = [];
    const request = async ({ target, method, kind, body, contentRange, uploadSize }) => {
      requests.push({ target, method, kind, contentRange, uploadSize });
      if (kind === 'session' && contentRange.startsWith('bytes */')) {
        const file = remote.get(initiation.id);
        return { status: 200, bytes: Buffer.from(JSON.stringify({ id: file.id, size: String(file.bytes.length) })) };
      }
      if (kind === 'session') {
        assert.equal(contentRange, `bytes 0-${body.length - 1}/${body.length}`);
        remote.set(initiation.id, { ...initiation, bytes: Buffer.from(body) });
        return { status: 200, bytes: Buffer.from('{}') };
      }
      assert.equal(uploadSize > 0, true);
      if (method === 'POST') {
        initiation = JSON.parse(body);
        assert.deepEqual(initiation.parents, ['appDataFolder']);
        assert(!remote.has(initiation.id));
      } else {
        assert.equal(method, 'PATCH');
        initiation = remote.get(decodeURIComponent(target.split('/files/')[1].split('?')[0]));
        assert.deepEqual(JSON.parse(body), {});
      }
      return { status: 200, location: sessionTarget };
    };
    const reads = {
      listFiles: async () => [...remote.values()].map(({ id, name, bytes }) =>
        ({ id, name, size: bytes.length })),
      readFile: async ({ id }) => {
        const file = remote.get(id);
        return { file: { id, name: file.name, size: file.bytes.length }, bytes: Buffer.from(file.bytes) };
      },
    };
    const verifier = createGoogleCloudTerminalVerifier({
      profileId: options.profileId, accountId: options.accountId,
      streamId: destination.streamId, fixedSlots: destination.fixedSlots,
      sessions, request, readFile: reads.readFile, isCurrent: () => true,
    });
    const ledger = await openCloudStreamLedger({
      ...options, streamId: destination.streamId, initialize: true, verifyTerminal: verifier,
    });
    const writer = createGoogleCloudSlotWriter({
      destination, accountId: options.accountId, ledger, sessions, request, reads, isCurrent: () => true,
    });
    for (const [index, content] of ['A', 'B', 'C'].entries()) {
      const input = Buffer.from(content);
      const pending = writer.write({ bytes: input, epoch: 1 });
      input.fill(0);
      const state = await pending;
      assert.equal(state.attempt.phase, 'acknowledged');
      assert.equal(state.attempt.generation, index + 1);
      assert.equal(remote.get(options.fixedSlots[state.attempt.slot]).bytes.toString(), content);
      assert.equal(state.attempt.slot, index === 2 ? 0 : index);
      if (index === 2) assert.equal(remote.get(options.fixedSlots[1]).bytes.toString(), 'B');
    }
    assert.equal(requests.filter(({ kind, contentRange }) =>
      kind === 'session' && !contentRange.startsWith('bytes */')).length, 3);
    assert.deepEqual(requests.filter(({ method }) => ['POST', 'PATCH'].includes(method))
      .map(({ method }) => method), ['POST', 'POST', 'PATCH']);
    const portable = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const pending = writer.writeSnapshot({ components: portable.components, epoch: 1, label: 'Synthetic desktop' });
    portable.components.reader.notes[999] = 'Not the captured revision';
    const committed = await pending;
    const actualBytes = remote.get(options.fixedSlots[1]).bytes;
    const envelope = await parseCloudSnapshot(actualBytes.toString('utf8'));
    assert.equal(envelope.attemptId, committed.attempt.id);
    assert.equal(envelope.generation, committed.attempt.generation);
    assert.equal(envelope.generation, 4);
    assert.equal(envelope.slotId, options.fixedSlots[committed.attempt.slot]);
    assert.equal(envelope.streamId, destination.streamId);
    assert.equal(envelope.contentDigest, portable.contentDigest);
    assert.equal(envelope.components.reader.notes[999], undefined);
    assert.equal(committed.attempt.digest, digest(actualBytes));
    assert.equal(remote.get(options.fixedSlots[0]).bytes.toString(), 'C');
  });
});

test('Google slot writer preserves an unknown late response across restart and refuses conflicting remote ownership', async () => {
  await withLedger(async ({ options }) => {
    const destination = await openCloudDestination({
      ...options, clientId: 'registered-native-client', appRootId: 'appDataFolder',
      fixedSlots: options.fixedSlots, initialize: true,
    });
    const remote = new Map();
    let loseReply = true;
    let requests = 0;
    const reads = {
      listFiles: async () => [...remote.values()].map(({ id, name, bytes }) =>
        ({ id, name, size: bytes.length })),
      readFile: async ({ id }) => {
        const file = remote.get(id);
        return { file: { id, name: file.name, size: file.bytes.length }, bytes: Buffer.from(file.bytes) };
      },
    };
    const sessions = { save: async () => 'd'.repeat(64), load: async () => sessionTarget };
    const request = async ({ kind, method, body, contentRange }) => {
      requests++;
      if (kind === 'session' && contentRange.startsWith('bytes */')) {
        const file = remote.get(options.fixedSlots[0]);
        return { status: 200, bytes: Buffer.from(JSON.stringify({ id: file.id, size: String(file.bytes.length) })) };
      }
      if (kind === 'session') {
        const id = options.fixedSlots[0];
        remote.set(id, { id, name: `recap-backup-${destination.streamId}-0.json`, bytes: Buffer.from(body) });
        if (loseReply) throw new Error('PRIVATE_LOST_PROVIDER_RESPONSE');
        return { status: 200 };
      }
      assert.equal(method, 'POST');
      assert.equal(JSON.parse(body).id, options.fixedSlots[0]);
      return { status: 200, location: sessionTarget };
    };
    const verifier = createGoogleCloudTerminalVerifier({
      profileId: options.profileId, accountId: options.accountId,
      streamId: destination.streamId, fixedSlots: destination.fixedSlots,
      sessions, request, readFile: reads.readFile, isCurrent: () => true,
    });
    const ledgerOptions = { ...options, streamId: destination.streamId, verifyTerminal: verifier };
    const first = await openCloudStreamLedger({ ...ledgerOptions, initialize: true });
    const writer = (ledger) => createGoogleCloudSlotWriter({
      destination, accountId: options.accountId, ledger, sessions, request, reads, isCurrent: () => true,
    });
    await assert.rejects(writer(first).write({ bytes: Buffer.from('A'), epoch: 1 }),
      (error) => error instanceof CloudGoogleWriteError && !error.message.includes('PRIVATE'));
    const reopened = await openCloudStreamLedger(ledgerOptions);
    const unknown = (await reopened.inspect()).attempt;
    assert.equal(unknown.phase, 'unknown');
    const before = requests;
    await assert.rejects(writer(reopened).write({ bytes: Buffer.from('B'), epoch: 1 }), CloudGoogleWriteError);
    assert.equal(requests, before);
    loseReply = false;
    await reopened.settle({ attemptId: unknown.id, evidence: { byteLength: 1 } });
    remote.set(options.fixedSlots[1], {
      id: options.fixedSlots[1], name: `recap-backup-${destination.streamId}-1.json`, bytes: Buffer.from('foreign'),
    });
    await assert.rejects(writer(reopened).write({ bytes: Buffer.from('B'), epoch: 1 }), /fixed slot differs/);
    assert.equal(requests, before + 1, 'only terminal status may dispatch after unknown, not conflicting writes');
    assert.equal((await reopened.inspect()).attempt.phase, 'acknowledged');
  });
});

test('native Microsoft conditioned intent survives reopening and acknowledges only matching changed-tag bytes', async () => {
  await withLedger(async ({ options }) => {
    const ms = { ...options, provider: 'microsoft' };
    const bytes = Buffer.from('{"synthetic":"A"}');
    const verifyTerminal = createMicrosoftCloudTerminalVerifier({
      ...ms, isCurrent: () => true, request: async () => assert.fail('changed condition needs no fence mutation'),
      readConditionalFile: async ({ id }) => ({ file: { id, size: bytes.length }, bytes, condition: '"changed"' }),
    });
    const ledger = await openCloudStreamLedger({ ...ms, initialize: true, verifyTerminal });
    const initial = await ledger.inspect();
    for (const condition of ['*', 'W/"weak"', 'unquoted']) {
      await assert.rejects(ledger.prepare({ digest: digest(bytes), epoch: 1, condition }));
      assert.deepEqual(await ledger.inspect(), initial);
    }
    const { attempt } = await ledger.prepare({ digest: digest(bytes), epoch: 1, condition: '"original"' });
    await ledger.dispatch({ attemptId: attempt.id });
    await ledger.markUnknown({ attemptId: attempt.id });
    const child = await promisify(execFile)(process.execPath, [
      '--input-type=module', '-e',
      `import {openCloudStreamLedger} from ${JSON.stringify(new URL('../host/cloudStreamLedger.mjs', import.meta.url).href)};
       const ledger=await openCloudStreamLedger(JSON.parse(process.argv[1]));
       console.log(JSON.stringify(await ledger.inspect()));`,
      JSON.stringify(ms),
    ]);
    assert.equal(JSON.parse(child.stdout).attempt.condition, '"original"');
    const tail = join(ms.directory, 'cloud-streams', ms.profileId, ms.provider, digest(ms.accountId),
      ms.streamId, '00000003.json');
    const exactTail = await readFile(tail, 'utf8');
    const changedTail = JSON.parse(exactTail);
    changedTail.attempt.condition = '"substituted"';
    await writeFile(tail, JSON.stringify(changedTail));
    await assert.rejects(ledger.inspect(), CloudStreamLedgerError);
    await writeFile(tail, exactTail);
    const reopened = await openCloudStreamLedger({ ...ms, verifyTerminal });
    await assert.rejects(reopened.prepare({ digest: digest('B'), epoch: 1, condition: '"changed"' }), /fenced/);
    const settled = await reopened.settle({ attemptId: attempt.id });
    assert.equal(settled.attempt.phase, 'acknowledged');
    assert.equal(settled.attempt.condition, '"original"');
    assert.equal(settled.snapshots[0].digest, digest(bytes));
  });
  await withLedger(async ({ options }) => {
    const ledger = await openCloudStreamLedger({ ...options, initialize: true });
    const initial = await ledger.inspect();
    await assert.rejects(ledger.prepare({ digest: digest('A'), epoch: 1, condition: '"microsoft-only"' }));
    assert.deepEqual(await ledger.inspect(), initial);
  });
});

test('native Microsoft metadata fence preserves old bytes and consumes failed generation before any later write', async () => {
  await withLedger(async ({ options }) => {
    const ms = { ...options, provider: 'microsoft' };
    const before = Buffer.from('{"synthetic":"before"}');
    const proposed = Buffer.from('{"synthetic":"A"}');
    let condition = '"original"';
    let bytes = before;
    let patches = 0;
    const verifyTerminal = createMicrosoftCloudTerminalVerifier({
      ...ms, isCurrent: () => true,
      readConditionalFile: async ({ id }) => ({ file: { id, size: bytes.length }, bytes, condition }),
      request: async (request) => {
        patches++;
        assert.equal(request.method, 'PATCH');
        assert.equal(request.ifMatch, '"original"');
        assert.equal(request.target, `/v1.0/me/drive/items/${ms.fixedSlots[0]}?$select=id,eTag`);
        assert.match(JSON.parse(request.body).description, /^Recap backup conditional fence [a-f0-9]{64}$/);
        condition = '"fenced"';
        return jsonReply({ id: ms.fixedSlots[0], eTag: condition });
      },
    });
    const ledger = await openCloudStreamLedger({ ...ms, initialize: true, verifyTerminal });
    const { attempt } = await ledger.prepare({ digest: digest(proposed), epoch: 1, condition });
    await ledger.dispatch({ attemptId: attempt.id });
    await ledger.markUnknown({ attemptId: attempt.id });
    const settled = await ledger.settle({ attemptId: attempt.id });
    assert.equal(settled.attempt.phase, 'failed');
    assert.equal(patches, 1);
    assert.deepEqual(settled.snapshots, [null, null]);
    const lateA = () => {
      if (condition !== attempt.condition) return 412;
      bytes = proposed;
      return 200;
    };
    assert.equal(lateA(), 412);
    assert.deepEqual(bytes, before);
    const next = await ledger.prepare({ digest: digest('B'), epoch: 2, condition });
    assert.equal(next.attempt.generation, 2);
  });
});

test('native Microsoft verifier retains unknown for old protocols, unverifiable tags and stale connections', async () => {
  await withLedger(async ({ options }) => {
    const ms = { ...options, provider: 'microsoft' };
    const bytes = Buffer.from('{"synthetic":"A"}');
    let verifier;
    const ledger = await openCloudStreamLedger({
      ...ms, initialize: true, verifyTerminal: (input) => verifier(input),
    });
    const { attempt } = await ledger.prepare({ digest: digest(bytes), epoch: 1, condition: '"original"' });
    await ledger.dispatch({ attemptId: attempt.id });
    await ledger.markUnknown({ attemptId: attempt.id });
    const saved = await ledger.inspect();
    const correct = { file: { id: ms.fixedSlots[0], size: bytes.length }, bytes, condition: '"original"' };
    for (const changed of [
      { readConditionalFile: async () => { throw new CloudProviderTransportError('Refused.', { status: 404, outcome: 'read-only' }); } },
      { readConditionalFile: async () => ({ ...correct, condition: 'W/"weak"' }) },
      { readConditionalFile: async () => ({ ...correct, file: { ...correct.file, id: 'foreign' } }) },
      { readConditionalFile: async () => ({ ...correct, bytes: bytes.subarray(1) }) },
      { request: async () => jsonReply({ id: ms.fixedSlots[0], eTag: '"original"' }) },
      { request: async () => { throw new CloudProviderTransportError('Unknown.', { status: 412, outcome: 'unknown' }); } },
    ]) {
      verifier = createMicrosoftCloudTerminalVerifier({
        ...ms, isCurrent: () => true, readConditionalFile: async () => correct,
        request: async () => jsonReply({ id: ms.fixedSlots[0], eTag: '"fenced"' }), ...changed,
      });
      await assert.rejects(ledger.settle({ attemptId: attempt.id }));
      assert.deepEqual(await ledger.inspect(), saved);
    }
    let reads = 0;
    const base = {
      ...ms, isCurrent: () => true,
      readConditionalFile: async () => { reads++; return correct; },
      request: async () => assert.fail('invalid protocol must not mutate'),
    };
    const exact = { binding: saved.binding, slotId: ms.fixedSlots[0], attempt: saved.attempt };
    const verify = createMicrosoftCloudTerminalVerifier(base);
    for (const modified of [{ condition: undefined }, { session: 'c'.repeat(64) }, { phase: 'acknowledged' }]) {
      await assert.rejects(verify({ ...exact, attempt: { ...saved.attempt, ...modified } }), CloudMicrosoftTerminalError);
    }
    assert.equal(reads, 0);
    for (const modified of [
      { binding: { ...saved.binding, account: 'f'.repeat(64) } },
      { binding: { ...saved.binding, provider: 'google' } },
      { slotId: ms.fixedSlots[1] },
    ]) await assert.rejects(verify({ ...exact, ...modified }), CloudMicrosoftTerminalError);
    assert.equal(reads, 0);
    let current = true;
    const stale = createMicrosoftCloudTerminalVerifier({
      ...base, isCurrent: () => current,
      readConditionalFile: async () => { current = false; return { ...correct, condition: '"changed"' }; },
    });
    await assert.rejects(stale(exact), /connection changed/);
    const spoof = createMicrosoftCloudTerminalVerifier({
      ...base, readConditionalFile: async () => ({
        ...correct, condition: '"changed"', bytes: Buffer.alloc(bytes.length), digest: digest(bytes),
      }),
    });
    assert.equal((await spoof(exact)).result, 'failed', 'only computed bytes can acknowledge the pending digest');
    for (const status of [412, undefined]) {
      let readCount = 0;
      let fenceCount = 0;
      const uncertain = createMicrosoftCloudTerminalVerifier({
        ...base,
        readConditionalFile: async () => ({ ...correct, condition: ++readCount === 1 ? '"original"' : '"changed"' }),
        request: async () => {
          fenceCount++;
          throw new CloudProviderTransportError('Uncertain fence reply.', { status, outcome: 'unknown' });
        },
      });
      const proof = await uncertain(exact);
      assert.equal(proof.result, 'completed');
      assert.equal(proof.exactReadback, true);
      assert.equal(readCount, 2);
      assert.equal(fenceCount, 1);
    }
    await assert.rejects(ledger.prepare({ digest: digest('B'), epoch: 1, condition: '"changed"' }), /fenced/);
  });
});

async function microsoftSlotFixture(options) {
  const native = { ...options, provider: 'microsoft', appRootId: 'app-root', driveId: 'personal-drive' };
  const destination = await openCloudDestination({ ...native, clientId: 'registered-native-client', initialize: true });
  native.streamId = destination.streamId;
  const remote = new Map(native.fixedSlots.map((id, slot) => [id, {
    id, name: `synthetic-reserved-${slot}.json`, bytes: Buffer.from(MICROSOFT_CLOUD_SLOT_SEED),
    condition: `"seed-${slot}"`,
  }]));
  const calls = [];
  const control = { foreignRoot: false, holdContent: false };
  let sequence = 0;
  let pending;
  const request = async ({ target, method = 'GET', body, ifMatch }) => {
    calls.push({ target, method, ifMatch });
    if (method === 'GET') {
      assert.equal(target, '/v1.0/me/drive/items/app-root?$select=id,folder,parentReference,specialFolder');
      return jsonReply({
        id: control.foreignRoot ? 'foreign-root' : 'app-root', folder: {},
        parentReference: { driveId: 'personal-drive' }, specialFolder: { name: 'appRoot' },
      });
    }
    assert.equal(method, 'PUT');
    const id = decodeURIComponent(target.split('/items/')[1].split('/')[0]);
    assert.equal(target, `/v1.0/me/drive/items/${encodeURIComponent(id)}/content`);
    const file = remote.get(id);
    assert(file && Buffer.isBuffer(body));
    const commit = () => {
      if (ifMatch !== file.condition) {
        throw new CloudProviderTransportError('Synthetic stale condition.', { status: 412, outcome: 'unknown' });
      }
      file.bytes = Buffer.from(body);
      file.condition = `"written-${++sequence}"`;
      return { status: 200, bytes: Buffer.from('{}') };
    };
    if (control.holdContent) {
      pending = commit;
      throw new Error('PRIVATE_PENDING_CONTENT_REPLY');
    }
    return commit();
  };
  const reads = {
    listFiles: async () => [...remote.values()].map(({ id, name, bytes }) => ({ id, name, size: bytes.length })),
    readConditionalFile: async ({ id }) => {
      const file = remote.get(id);
      return { file: { id, name: file.name, size: file.bytes.length },
        bytes: Buffer.from(file.bytes), condition: file.condition };
    },
  };
  const verifyTerminal = createMicrosoftCloudTerminalVerifier({
    ...native, request, readConditionalFile: reads.readConditionalFile, isCurrent: () => true,
  });
  const ledgerOptions = { ...native, verifyTerminal };
  const ledger = await openCloudStreamLedger({ ...ledgerOptions, initialize: true });
  const writer = (owner = ledger) => createMicrosoftCloudSlotWriter({
    destination, accountId: native.accountId, ledger: owner, request, reads, isCurrent: () => true,
  });
  return { destination, remote, control, calls, ledger, ledgerOptions, writer, finish: () => pending() };
}

test('Microsoft slot writer preserves previous bytes and binds copied complete content to its actual conditioned attempt', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await microsoftSlotFixture(options);
    const { remote, calls, writer, destination } = fixture;
    for (const [index, content] of ['A', 'B', 'C'].entries()) {
      const bytes = Buffer.from(content);
      const pending = writer().write({ bytes, epoch: 1 });
      bytes.fill(0);
      const committed = await pending;
      assert.equal(committed.attempt.phase, 'acknowledged');
      assert.equal(committed.attempt.generation, index + 1);
      assert.equal(committed.attempt.slot, index === 2 ? 0 : index);
      assert.equal(remote.get(options.fixedSlots[committed.attempt.slot]).bytes.toString(), content);
      if (index === 2) assert.equal(remote.get(options.fixedSlots[1]).bytes.toString(), 'B');
    }
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const pending = writer().writeSnapshot({ components: capture.components, epoch: 1, label: 'Synthetic desktop' });
    capture.components.reader.notes[999] = 'Not the captured revision';
    const committed = await pending;
    const actual = remote.get(options.fixedSlots[1]).bytes;
    const envelope = await parseCloudSnapshot(actual.toString('utf8'));
    assert.equal(envelope.attemptId, committed.attempt.id);
    assert.equal(envelope.generation, 4);
    assert.equal(envelope.streamId, destination.streamId);
    assert.equal(envelope.slotId, options.fixedSlots[1]);
    assert.equal(envelope.contentDigest, capture.contentDigest);
    assert.equal(envelope.components.reader.notes[999], undefined);
    assert.equal(committed.attempt.digest, digest(actual));
    assert.equal(committed.attempt.condition, '"written-2"');
    assert.equal(remote.get(options.fixedSlots[0]).bytes.toString(), 'C');
    assert.deepEqual(calls.filter(({ method }) => method === 'PUT').map(({ ifMatch }) => ifMatch),
      ['"seed-0"', '"seed-1"', '"written-1"', '"written-2"']);
    assert(calls.every(({ method }) => ['GET', 'PUT'].includes(method)), 'writer never creates files or upload sessions');
  });
});

test('Microsoft slot writer fences unknown late A across reopen and refuses foreign roots, seeds and stale reservations', async () => {
  await withLedger(async ({ options }) => {
    const fixture = await microsoftSlotFixture(options);
    const { remote, control, calls, ledger, ledgerOptions, writer } = fixture;
    const initial = await ledger.inspect();
    control.foreignRoot = true;
    await assert.rejects(writer().write({ bytes: Buffer.from('A'), epoch: 1 }), /app-root ownership changed/);
    control.foreignRoot = false;
    const a = remote.get(options.fixedSlots[0]);
    a.bytes = Buffer.from('foreign');
    await assert.rejects(writer().write({ bytes: Buffer.from('A'), epoch: 1 }), /owned slot bytes changed/);
    a.bytes = Buffer.from(MICROSOFT_CLOUD_SLOT_SEED);
    const b = remote.get(options.fixedSlots[1]);
    remote.delete(b.id);
    await assert.rejects(writer().write({ bytes: Buffer.from('A'), epoch: 1 }), /fixed slot differs/);
    remote.set(b.id, b);
    assert.equal(calls.filter(({ method }) => method === 'PUT').length, 0);
    assert.deepEqual(await ledger.inspect(), initial);
    control.holdContent = true;
    await assert.rejects(writer().write({ bytes: Buffer.from('A'), epoch: 1 }),
      (error) => error instanceof CloudMicrosoftWriteError && !error.message.includes('PRIVATE'));
    const reopened = await openCloudStreamLedger(ledgerOptions);
    const unknown = (await reopened.inspect()).attempt;
    assert.equal(unknown.phase, 'unknown');
    assert.equal(a.bytes.toString(), MICROSOFT_CLOUD_SLOT_SEED);
    const before = calls.length;
    await assert.rejects(writer(reopened).write({ bytes: Buffer.from('B'), epoch: 1 }), /unresolved/);
    assert.equal(calls.length, before, 'unknown blocks every later provider request, not merely its result callback');
    fixture.finish();
    assert.equal(a.bytes.toString(), 'A');
    const acknowledged = await reopened.settle({ attemptId: unknown.id });
    assert.equal(acknowledged.attempt.phase, 'acknowledged');
    control.holdContent = false;
    const next = await writer(reopened).write({ bytes: Buffer.from('B'), epoch: 1 });
    assert.equal(next.attempt.generation, 2);
    assert.equal(next.attempt.slot, 1);
    assert.equal(a.bytes.toString(), 'A');
    assert.equal(b.bytes.toString(), 'B');
    const puts = calls.filter(({ method }) => method === 'PUT').length;
    const stale = {
      ...reopened,
      prepare: async (candidate) => {
        await reopened.prepare({ digest: digest('not-dispatched'), epoch: 1, condition: a.condition });
        return reopened.prepare(candidate);
      },
    };
    await assert.rejects(writer(stale).write({ bytes: Buffer.from('C'), epoch: 1 }), /reservation changed/);
    assert.equal(calls.filter(({ method }) => method === 'PUT').length, puts);
    assert.equal(a.bytes.toString(), 'A');
    assert.equal(b.bytes.toString(), 'B');
  });
});

function encodedPublicationDescription(text) {
  return text.replace(/[{}:"!]/g, (character) => character === '"' ? '&quot;' : `&#${character.charCodeAt(0)};`);
}

test('Microsoft publication records bind immutable payloads without changing the snapshot format', async () => {
  const {
    encodeMicrosoftPublication, decodeMicrosoftPublication, decodeMicrosoftPublicationDescription, microsoftPayloadName,
    MICROSOFT_PUBLICATION_PROTOCOL, CloudMicrosoftPublicationRecordError,
  } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  assert.equal(MICROSOFT_PUBLICATION_PROTOCOL, 'microsoft-publication-v1');
  const streamId = '3'.repeat(64);
  const slotId = 'publication-record';
  const attemptId = '4'.repeat(64);
  const nonce = '5'.repeat(64);
  const { components } = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
  const snapshot = await createCloudSnapshot(components, {
    captureId: '6'.repeat(64), streamId, slotId, attemptId, generation: 1,
    capturedAt: '2026-10-24T00:00:00.000Z', label: 'Synthetic publication',
  });
  const record = { streamId, slotId, nonce, publication: {
    attemptId, generation: 1, payloadId: 'immutable-payload',
    byteLength: Buffer.byteLength(snapshot.text), digest: digest(snapshot.text),
  } };
  const text = encodeMicrosoftPublication(record);
  assert(Buffer.byteLength(text) <= 1024);
  assert.deepEqual(Object.keys(JSON.parse(text)), ['f', 'n', 'p', 'r', 's', 'v']);
  assert.deepEqual(Object.keys(JSON.parse(text).p), ['a', 'd', 'g', 'i', 'z']);
  assert.deepEqual(decodeMicrosoftPublication(text, { streamId, slotId }), record);
  const encoded = encodedPublicationDescription(text);
  assert.deepEqual(decodeMicrosoftPublicationDescription(text, { streamId, slotId }), record);
  assert.deepEqual(decodeMicrosoftPublicationDescription(encoded, { streamId, slotId }), record);
  const numeric = text.replace(/./g, (character) => `&#${character.charCodeAt(0)};`);
  assert(Buffer.byteLength(numeric) > 1024);
  assert.deepEqual(decodeMicrosoftPublicationDescription(numeric, { streamId, slotId }), record);
  assert.throws(() => decodeMicrosoftPublication(encoded, { streamId, slotId }), CloudMicrosoftPublicationRecordError,
    'local durable wire must remain canonical, not HTML');
  for (const invalid of [
    `${encoded} `, `<p>${encoded}</p>`, encoded.replace('&quot;', '&amp;quot;'),
    encoded.replace('&quot;', '&unknown;'), encoded.replace('&quot;', '&#0;'),
    encoded.replace('&quot;', '&#999;'), `&#34;${'x'.repeat(6144)}`,
    encodedPublicationDescription(`{"extra":1,${text.slice(1)}`),
  ]) assert.throws(() => decodeMicrosoftPublicationDescription(invalid, { streamId, slotId }), CloudMicrosoftPublicationRecordError);
  assert.throws(() => decodeMicrosoftPublicationDescription(encoded, { streamId, slotId: 'other' }), CloudMicrosoftPublicationRecordError);
  assert.equal(microsoftPayloadName(streamId, attemptId), `recap-payload-${streamId}-${attemptId}.json`);
  const restored = await parseCloudSnapshot(snapshot.text);
  assert.equal(restored.version, 1);
  assert.equal(restored.slotId, slotId, 'the logical slot is the publication record, not the payload ID');
  assert.equal(restored.contentDigest, (await captureCloudContent({
    storage: { getItem: () => null }, isBlocked: () => false,
  })).contentDigest);
  const reserved = { streamId, slotId, nonce, publication: null };
  assert.deepEqual(decodeMicrosoftPublication(encodeMicrosoftPublication(reserved), { streamId, slotId }), reserved);
  for (const bad of [
    { ...record, nonce: 'bad' },
    { ...record, publication: { ...record.publication, payloadId: slotId } },
    { ...record, publication: { ...record.publication, payloadId: 'https://PRIVATE.invalid' } },
    { ...record, publication: { ...record.publication, byteLength: 32 * 1024 * 1024 + 1 } },
    { ...record, publication: { ...record.publication, generation: Number.MAX_SAFE_INTEGER + 1 } },
    { ...record, publication: { ...record.publication, accessToken: 'PRIVATE' } },
  ]) assert.throws(() => encodeMicrosoftPublication(bad), CloudMicrosoftPublicationRecordError);
  assert.throws(() => decodeMicrosoftPublication(text, { streamId: '7'.repeat(64), slotId }), CloudMicrosoftPublicationRecordError);
  assert.throws(() => decodeMicrosoftPublication(text, { streamId, slotId: 'different-record' }), CloudMicrosoftPublicationRecordError);
  assert.throws(() => decodeMicrosoftPublication(`${text} `, { streamId, slotId }), CloudMicrosoftPublicationRecordError);
  const extra = JSON.parse(text);
  extra.url = 'https://PRIVATE.invalid';
  assert.throws(() => decodeMicrosoftPublication(JSON.stringify(extra), { streamId, slotId }), CloudMicrosoftPublicationRecordError);
});

test('publication journal capacity and compaction guard preserve an unresolved state', async () => {
  const { openCloudLocalJournal } = await import('../host/cloudLocalJournal.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-journal-'));
  try {
    const journal = await openCloudLocalJournal({
      directory, namespace: ['publication-check'], format: 'publication-check',
      initial: { pending: true }, validate: (value) => typeof value?.pending === 'boolean',
      transition: (before, after) => before === null ? after.pending === true : true,
    });
    assert.equal((await journal.capacity()).remainingTransitions, 8191);
    const prior = await journal.inspect();
    await assert.rejects(journal.compact({ canCompact: (state) => !state.pending }));
    assert.deepEqual(await journal.inspect(), prior);
    await journal.update({ expectedSequence: prior.sequence, change: () => ({ pending: false }) });
    await journal.compact({ canCompact: (state) => !state.pending });
    assert.equal((await journal.capacity()).remainingTransitions, 8192);
    assert.equal((await journal.inspect()).state.pending, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Microsoft publication ledger keeps immutable staging uncertainty separate from fenced publication', async () => {
  const { openCloudPublicationLedger } = await import('../host/cloudPublicationLedger.mjs');
  const { encodeMicrosoftPublication, microsoftPayloadName } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-ledger-'));
  try {
    let outcome = 'completed';
    let verifications = 0;
    const options = {
      directory, profileId: 'a'.repeat(64), provider: 'microsoft', accountId: 'synthetic-account',
      streamId: 'b'.repeat(64), fixedSlots: ['publication-0', 'publication-1'],
      verifyTerminal: async ({ slotId, attempt }) => {
        verifications++;
        return { result: outcome, attemptId: attempt.id, generation: attempt.generation, digest: attempt.digest,
          slotId, noOutstandingMutation: true, exactReadback: outcome === 'completed' };
      },
    };
    const ledger = await openCloudPublicationLedger({ ...options, initialize: true });
    const prepare = async (number, condition) => ledger.prepare({
      digest: digest('{}'), byteLength: 2, epoch: 1, condition,
      requestedAttemptId: String(number).repeat(64), expectedSequence: (await ledger.inspect()).sequence,
    });
    const first = (await prepare(1, '"seed-0"')).attempt;
    assert.equal(first.slot, 0);
    await ledger.dispatch({ attemptId: first.id });
    await ledger.attachSession({ attemptId: first.id, sessionReference: 'c'.repeat(64) });
    await ledger.dispatchPayload({ attemptId: first.id });
    await ledger.payloadAcknowledged({ attemptId: first.id, payloadId: 'immutable-1' });
    const uploadProof = await ledger.terminalAttempt({ attemptId: first.id });
    assert.equal(uploadProof.fixedSlots[0], microsoftPayloadName(options.streamId, first.id));
    assert.equal((await ledger.inspect()).attempt.phase, 'in-flight', 'a payload receipt is not publication acknowledgement');
    await ledger.payloadSessionRetired({ attemptId: first.id, result: { retired: true, reference: 'c'.repeat(64) } });
    await ledger.dispatchPublication({ attemptId: first.id });
    await ledger.publicationAcknowledged({ attemptId: first.id, condition: '"published-1"' });
    assert.equal((await ledger.settle({ attemptId: first.id })).attempt.phase, 'acknowledged');
    outcome = 'failed';
    for (let number = 2; number <= 3; number++) {
      const attempt = (await prepare(number, number === 2 ? '"seed-1"' : '"fence-2"')).attempt;
      await ledger.dispatch({ attemptId: attempt.id });
      if (number === 2) {
        await ledger.attachSession({ attemptId: attempt.id, sessionReference: 'd'.repeat(64) });
        await ledger.dispatchPayload({ attemptId: attempt.id });
      }
      await ledger.markUnknown({ attemptId: attempt.id });
      const before = verifications;
      await assert.rejects(ledger.settle({ attemptId: attempt.id }));
      assert.equal(verifications, before, 'an unfenced pending publication is never passed to a success-shaped verifier');
      const text = encodeMicrosoftPublication({ streamId: options.streamId, slotId: 'publication-1',
        nonce: String(number + 3).repeat(64), publication: null });
      await ledger.beginFence({ attemptId: attempt.id, text, condition: attempt.condition });
      await assert.rejects(ledger.dispatchPublication({ attemptId: attempt.id }), /publication/i);
      await ledger.fenceAcknowledged({ attemptId: attempt.id, condition: `"fence-${number}"` });
      const fenced = await ledger.settle({ attemptId: attempt.id });
      assert.equal(fenced.attempt.phase, 'failed');
      assert.equal(fenced.snapshots[0].id, first.id);
      assert.equal(fenced.payloads.find((entry) => entry.attemptId === attempt.id).terminal, false,
        'fencing publication does not pretend an immutable payload upload has ended');
      await assert.rejects(ledger.beginCleanup({ payloadAttemptId: attempt.id, condition: '"not-authority"' }));
    }
    const prior = await ledger.inspect();
    await assert.rejects(prepare(4, '"fence-3"'), /staging|capacity/i);
    assert.deepEqual(await ledger.inspect(), prior);
    assert.equal((await ledger.capacity()).canPrepare, false);
    await ledger.compact();
    const reopened = await openCloudPublicationLedger({ ...options, initialize: false });
    assert.equal((await reopened.capacity()).remainingTransitions, 8192);
    assert.equal((await reopened.capacity()).canPrepare, false);
    assert.deepEqual((await reopened.inspect()).payloads, prior.payloads);
    assert.equal((await reopened.inspect()).maxGeneration, 3);
    await assert.rejects(openCloudPublicationLedger({ ...options, provider: 'google', initialize: false }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication destination version isolates legacy ownership and never falls back from corrupt new records', async () => {
  const { MICROSOFT_PUBLICATION_PROTOCOL } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-destination-'));
  try {
    const options = destinationOptions(directory, 'microsoft');
    const legacy = await openCloudDestination({ ...options, initialize: true,
      streamId: '1'.repeat(64), fixedSlots: ['legacy-0', 'legacy-1'] });
    const root = join(directory, 'cloud-destinations', options.profileId, 'microsoft', digest(options.accountId));
    const before = await readFile(join(root, 'destination.json'));
    const publication = await openCloudDestination({ ...options, protocol: MICROSOFT_PUBLICATION_PROTOCOL,
      initialize: true, streamId: '2'.repeat(64), fixedSlots: ['record-0', 'record-1'] });
    assert.equal(publication.protocol, MICROSOFT_PUBLICATION_PROTOCOL);
    assert.deepEqual(await loadCloudDestination(options), publication);
    assert.deepEqual(await openCloudDestination(options), legacy);
    assert.deepEqual(await readFile(join(root, 'destination.json')), before);
    const newRoot = join(directory, 'cloud-publication-destinations', options.profileId, 'microsoft', digest(options.accountId));
    const path = join(newRoot, 'destination.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(record.version, 2);
    assert.equal(record.protocol, MICROSOFT_PUBLICATION_PROTOCOL);
    record.protocol = 'unrecognized';
    await writeFile(path, JSON.stringify(record));
    await assert.rejects(loadCloudDestination(options), CloudDestinationError);
    assert.deepEqual(await readFile(join(root, 'destination.json')), before);
    await assert.rejects(openCloudDestination({ ...destinationOptions(directory, 'google'),
      protocol: MICROSOFT_PUBLICATION_PROTOCOL, initialize: true, fixedSlots: ['g0', 'g1'] }), TypeError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication allocation creates only versioned record seeds and preserves legacy allocation authority', async () => {
  const { MICROSOFT_PUBLICATION_PROTOCOL, MICROSOFT_PUBLICATION_SEED } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-allocation-'));
  try {
    const base = { ...destinationOptions(directory, 'microsoft'), epoch: 1, isCurrent: () => true };
    const legacyFixture = allocationFixture(base);
    const legacy = await openCloudAllocation({ ...base, ...legacyFixture });
    legacyFixture.setAllocation(legacy);
    const legacyDestination = await legacy.allocate();
    const legacyBefore = await legacy.inspect();
    const options = { ...base, protocol: MICROSOFT_PUBLICATION_PROTOCOL };
    const fixture = allocationFixture(options, { seed: MICROSOFT_PUBLICATION_SEED, idPrefix: 'publication-' });
    const allocation = await openCloudAllocation({ ...options, ...fixture });
    fixture.setAllocation(allocation);
    const destination = await allocation.allocate();
    assert.equal(destination.protocol, MICROSOFT_PUBLICATION_PROTOCOL);
    assert.notEqual(destination.streamId, legacyDestination.streamId);
    assert.deepEqual(destination.fixedSlots, ['publication-0', 'publication-1']);
    assert.deepEqual(await loadCloudAllocationRoot(options), { appRootId: base.appRootId, driveId: base.driveId });
    assert.deepEqual(await legacy.inspect(), legacyBefore);
    const count = fixture.calls.length;
    const reopened = await openCloudAllocation({ ...options, ...fixture });
    fixture.setAllocation(reopened);
    assert.deepEqual(await reopened.allocate(), destination);
    assert.equal(fixture.calls.length, count);
    assert.equal(new Set(fixture.retired).size, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication metadata reads validate the owned record without downloading its content', async () => {
  const calls = [];
  let file = { ...nativeFile('microsoft', 'record'), description: 'synthetic-description' };
  const reads = createCloudProviderReads({
    provider: 'microsoft', appRootId: 'app-root', driveId: 'personal-drive', isCurrent: () => true,
    request: async (options) => {
      calls.push(options);
      if (options.target.startsWith('/v1.0/me/drive/items/app-root?')) {
        return jsonReply({ id: 'app-root', folder: {}, parentReference: { driveId: 'personal-drive' },
          specialFolder: { name: 'approot' } });
      }
      assert(!options.target.endsWith('/content'));
      assert(options.target.includes('description'));
      return jsonReply(file);
    },
  });
  const result = await reads.readMetadata({ id: 'record' });
  assert.equal(result.description, file.description);
  assert.equal(result.condition, file.eTag);
  assert.equal(result.file.id, file.id);
  assert.equal(calls.length, 2);
  file = { ...file, eTag: 'W/"weak"' };
  await assert.rejects(reads.readMetadata({ id: 'record' }), CloudProviderReadError);
  file = { ...file, eTag: '"valid"', parentReference: { id: 'foreign', driveId: 'personal-drive' } };
  await assert.rejects(reads.readMetadata({ id: 'record' }), CloudProviderReadError);
  const google = createCloudProviderReads({
    provider: 'google', isCurrent: () => true, request: async () => assert.fail('wrong provider must refuse before network'),
  });
  await assert.rejects(google.readMetadata({ id: 'record' }), CloudProviderReadError);
});

test('publication reads resolve immutable payloads while preserving legacy discovery and pointer authority', async () => {
  const { createMicrosoftPublicationReads } = await import('../host/cloudMicrosoftPublicationReads.mjs');
  const { encodeMicrosoftPublication, MICROSOFT_PUBLICATION_SEED, microsoftPayloadName } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  const { components } = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
  const streamId = '8'.repeat(64), legacyStream = '9'.repeat(64), attemptId = 'a'.repeat(64);
  const files = new Map();
  const make = async (stream, slotId, id) => Buffer.from((await createCloudSnapshot(components, {
    captureId: 'b'.repeat(64), streamId: stream, slotId, attemptId: id, generation: 1,
    capturedAt: '2026-10-24T00:00:00.000Z', label: 'Synthetic',
  })).text);
  const bytes = await make(streamId, 'record', attemptId);
  const record = { streamId, slotId: 'record', nonce: 'c'.repeat(64), publication: {
    attemptId, generation: 1, payloadId: 'data', byteLength: bytes.length, digest: digest(bytes),
  } };
  files.set('record', { name: `recap-backup-${streamId}-0.json`, bytes: Buffer.from(MICROSOFT_PUBLICATION_SEED),
    description: encodeMicrosoftPublication(record), condition: '"record-1"' });
  files.set('data', { name: microsoftPayloadName(streamId, attemptId), bytes });
  files.set('legacy', { name: `recap-backup-${legacyStream}-0.json`, bytes: await make(legacyStream, 'legacy', 'd'.repeat(64)) });
  const descriptor = (id) => ({ id, name: files.get(id).name, size: files.get(id).bytes.length, modifiedAt: null });
  let changeDuringRead = false;
  const read = async ({ id }) => {
    if (id === 'data' && changeDuringRead) files.get('record').condition = '"changed"';
    return { file: descriptor(id), bytes: files.get(id).bytes, digest: digest(files.get(id).bytes), condition: files.get(id).condition };
  };
  const reads = createMicrosoftPublicationReads({
    isCurrent: () => true,
    reads: { discoverRoot: async () => ({ appRootId: 'root', driveId: 'drive' }),
      listFiles: async () => [...files.keys()].map(descriptor), readFile: read, readConditionalFile: read,
      readMetadata: async ({ id }) => ({ file: descriptor(id), condition: files.get(id).condition,
        description: files.get(id).description ?? null }) },
  });
  const listed = await reads.listFiles();
  assert.equal(listed.find((file) => file.id === 'record').size, bytes.length);
  const logical = await reads.readConditionalFile({ id: 'record' });
  assert.equal(logical.file.id, 'record');
  assert.deepEqual(logical.bytes, bytes);
  assert.equal(logical.condition, '"record-1"');
  const discovery = createCloudDiscovery({ reads, isCurrent: () => true });
  const found = await discovery.discover();
  assert.equal(found.streams.length, 2);
  assert.equal((await discovery.readSnapshot({
    streamId, selection: found.streams.find((stream) => stream.streamId === streamId).current,
  })).slotId, 'record');
  files.get('record').description = encodeMicrosoftPublication({ ...record,
    publication: { ...record.publication, generation: 2 } });
  const inconsistent = await discovery.discover();
  assert.equal(inconsistent.streams.length, 1, 'payload generation cannot override the publication record');
  assert.equal(inconsistent.streams[0].streamId, legacyStream);
  files.get('record').description = encodeMicrosoftPublication(record);
  changeDuringRead = true;
  await assert.rejects(reads.readFile({ id: 'record' }));
  changeDuringRead = false;
  files.get('record').description = encodeMicrosoftPublication({ ...record, publication: null });
  const reserved = await discovery.discover();
  assert.equal(reserved.streams.length, 1);
  assert.equal(reserved.streams[0].streamId, legacyStream);
});

test('publication cleanup transport permits only an exact body-free Microsoft item delete with a strong condition', async () => {
  let calls = 0;
  let tokens = 0;
  const request = createCloudProviderTransport({
    provider: 'microsoft', getAccessToken: async () => { tokens++; return 'synthetic-token'; },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.pathname, '/v1.0/me/drive/items/owned-payload');
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers['if-match'], '"owned-tag"');
      assert.equal(options.body, undefined);
      return new Response(null, { status: 204 });
    },
  });
  for (const options of [
    { target: '/v1.0/me/drive/items/owned-payload' },
    { target: '/v1.0/me/drive/items/owned-payload', ifMatch: '*' },
    { target: '/v1.0/me/drive/items/owned-payload', ifMatch: '"owned-tag"', body: '' },
    { target: '/v1.0/me/drive/items/owned-payload/content', ifMatch: '"owned-tag"' },
    { target: '/v1.0/me/drive/items/owned-payload?$select=id', ifMatch: '"owned-tag"' },
    { kind: 'session', target: 'https://my.microsoftpersonalcontent.com/session', ifMatch: '"owned-tag"' },
  ]) await assert.rejects(request({ ...options, method: 'DELETE' }));
  assert.equal(calls, 0);
  assert.equal(tokens, 0);
  const deleted = await request({ target: '/v1.0/me/drive/items/owned-payload', method: 'DELETE', ifMatch: '"owned-tag"' });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.bytes.length, 0);
  assert.equal(calls, 1);
});

async function publicationWriterFixture(directory) {
  const { createMicrosoftCloudPublication } = await import('../host/cloudMicrosoftPublication.mjs');
  const { openCloudPublicationLedger } = await import('../host/cloudPublicationLedger.mjs');
  const { MICROSOFT_PUBLICATION_PROTOCOL, MICROSOFT_PUBLICATION_SEED } = await import('../host/cloudMicrosoftPublicationRecord.mjs');
  const native = { ...destinationOptions(directory, 'microsoft'), protocol: MICROSOFT_PUBLICATION_PROTOCOL };
  const files = new Map(), uploads = new Map(), calls = [];
  const control = { payloadPuts: 0, losePublication: false, holdPublication: false, losePayload: false,
    holdDelete: false, missingRoot: false, rootReads: 0, root404At: null, root404Hits: 0, deleted: [] };
  let revision = 0, pending, pendingDelete, ledger, engine;
  const metadata = (id) => {
    const file = files.get(id);
    return { id, name: file.name, size: file.bytes.length, file: { mimeType: 'application/json' },
      parentReference: { id: native.appRootId, driveId: native.driveId },
      eTag: file.condition, description: file.description === undefined ? null : encodedPublicationDescription(file.description) };
  };
  const transportOptions = {
    provider: 'microsoft', getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url, options) => {
      calls.push({ method: options.method, target: url.href });
      if (url.origin === 'https://my.microsoftpersonalcontent.com') {
        assert.equal(options.headers.authorization, undefined);
        const upload = uploads.get(url.href);
        assert.equal(options.method, 'PUT');
        assert(upload);
        assert(!files.has(upload.id), 'an immutable payload or record seed must never be uploaded twice');
        files.set(upload.id, { name: upload.name, bytes: Buffer.from(options.body), condition: `"v-${++revision}"` });
        if (upload.name.startsWith('recap-payload-')) {
          control.payloadPuts++;
          if (control.losePayload) { control.losePayload = false; throw new Error('SYNTHETIC_LOST_PAYLOAD'); }
        }
        return Response.json(metadata(upload.id), { status: 201 });
      }
      assert.equal(url.origin, 'https://graph.microsoft.com');
      if (url.pathname === `/v1.0/me/drive/items/${native.appRootId}` || url.pathname === '/v1.0/me/drive/special/approot') {
        control.rootReads++;
        if (control.missingRoot || control.rootReads === control.root404At) {
          control.root404Hits++;
          return Response.json({ error: { code: 'itemNotFound' } }, { status: 404 });
        }
        return Response.json({ id: native.appRootId, folder: {}, parentReference: { driveId: native.driveId },
          specialFolder: { name: 'approot' } });
      }
      if (url.pathname.endsWith('/createUploadSession')) {
        assert.equal(options.method, 'POST');
        assert.equal(options.body, undefined);
        const name = decodeURIComponent(url.pathname.split(':/')[1].split(':/')[0]);
        assert(![...files.values()].some((file) => file.name === name));
        const target = `https://my.microsoftpersonalcontent.com/session/${uploads.size + 1}`;
        uploads.set(target, { id: `immutable-${uploads.size + 1}`, name });
        return Response.json({ uploadUrl: target });
      }
      if (url.pathname.endsWith('/children')) return Response.json({ value: [...files.keys()].map(metadata) });
      const parts = url.pathname.split('/');
      const id = decodeURIComponent(parts.at(-1) === 'content' ? parts.at(-2) : parts.at(-1));
      const file = files.get(id);
      if (!file) return Response.json({ error: { code: 'itemNotFound' } }, { status: 404 });
      if (options.method === 'GET') {
        if (!url.pathname.endsWith('/content')) return Response.json(metadata(id));
        const reply = new Response(file.bytes);
        if (file.bytes.equals(Buffer.from(MICROSOFT_PUBLICATION_SEED))) control.afterSeedRead?.(id);
        if (file.name.startsWith('recap-payload-')) control.afterPayloadRead?.(id);
        return reply;
      }
      assert.equal(options.headers['if-match'], file.condition);
      if (options.method === 'DELETE') {
        if (control.holdDelete) {
          control.holdDelete = false;
          pendingDelete = () => {
            if (files.get(id)?.condition !== options.headers['if-match']) return false;
            files.delete(id);
            control.deleted.push(id);
            return true;
          };
          throw new Error('SYNTHETIC_PENDING_DELETE');
        }
        files.delete(id);
        control.deleted.push(id);
        return new Response(null, { status: 204 });
      }
      assert.equal(options.method, 'PATCH');
      const description = JSON.parse(options.body.toString()).description;
      const record = JSON.parse(description);
      const apply = () => {
        if (options.headers['if-match'] !== file.condition) return false;
        file.description = description;
        file.condition = `"v-${++revision}"`;
        return true;
      };
      if (control.holdPublication && record.p && record.n === record.p.a) {
        control.holdPublication = false; pending = apply;
        throw new Error('SYNTHETIC_STILL_PENDING_PUBLICATION');
      }
      apply();
      if (control.losePublication && record.p && record.n === record.p.a) {
        control.losePublication = false; throw new Error('SYNTHETIC_LOST_PUBLICATION');
      }
      return Response.json(metadata(id));
    },
  };
  const request = createCloudProviderTransport(transportOptions);
  const reads = createCloudProviderReads({ provider: 'microsoft', request, isCurrent: () => true,
    appRootId: native.appRootId, driveId: native.driveId });
  const sdk = sessionSdk();
  const sessions = createWindowsCloudUploadSessions({
    directory, platform: 'win32', loadSdk: sdk.loadSdk,
    readTerminal: async (id) => await ledger?.terminalAttempt({ attemptId: id })
      ?? await allocation?.terminalAttempt({ attemptId: id }) ?? null,
  });
  const allocation = await openCloudAllocation({ ...native, epoch: 1, request, reads, sessions, isCurrent: () => true });
  const destination = await allocation.allocate();
  const reopen = async (initialize = false) => {
    ledger = await openCloudPublicationLedger({ ...native, streamId: destination.streamId,
      fixedSlots: destination.fixedSlots, initialize, verifyTerminal: (value) => engine.verifyTerminal(value) });
    engine = createMicrosoftCloudPublication({ destination, accountId: native.accountId,
      ledger, request, reads, sessions, isCurrent: () => true });
    return engine;
  };
  await reopen(true);
  const authentication = { connected: false };
  const serviceOptions = {
    directory: join(directory, 'service'), clients: { microsoft: { clientId: native.clientId } },
    openBrowser: async () => assert.fail('source service fixture must never open a browser'),
    fetchImpl: transportOptions.fetchImpl, loadSdk: sdk.loadSdk,
    createAuth: async ({ provider, profileId, epoch, isCurrent }) => ({
      connect: async () => { assert(isCurrent({ profileId, provider, epoch })); authentication.connected = true; },
      status: async () => ({ provider, state: authentication.connected ? 'connected' : 'disconnected',
        account: authentication.connected ? { id: native.accountId, label: 'Synthetic native account' } : null }),
      getAccessToken: async () => {
        assert(authentication.connected && isCurrent({ profileId, provider, epoch }));
        return 'synthetic-token';
      },
      disconnect: async () => { authentication.connected = false; },
    }),
  };
  return { engine, reopen, destination, files, control, calls, reads, serviceOptions, getLedger: () => ledger,
    release: () => { const apply = pending; pending = null; return apply?.(); },
    releaseDelete: () => { const apply = pendingDelete; pendingDelete = null; return apply?.(); } };
}

test('publication discovery consumes one seed witness per exact listed object, never for restore or copied selections', async () => {
  const { createMicrosoftPublicationReads } = await import('../host/cloudMicrosoftPublicationReads.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-discovery-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    await fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 });
    const reads = createMicrosoftPublicationReads({ reads: fixture.reads, isCurrent: () => true });
    const discovery = createCloudDiscovery({ reads, isCurrent: () => true });
    const seedReads = (id) => fixture.calls.filter((call) => call.method === 'GET'
      && new URL(call.target).pathname === `/v1.0/me/drive/items/${id}/content`).length;
    fixture.calls.length = 0;
    const found = await discovery.discover();
    assert.equal(found.streams.length, 1);
    for (const id of fixture.destination.fixedSlots) assert.equal(seedReads(id), 1,
      'listing already validated this exact seed; discovery must refresh metadata instead of downloading it twice again');
    const { streamId, current } = found.streams[0];
    await discovery.readSnapshot({ streamId, selection: current });
    assert.equal(seedReads(current.id), 3, 'a serialized restore choice must fully revalidate the seed');
    const listed = (await reads.listFiles()).find((file) => file.id === current.id);
    fixture.calls.length = 0;
    assert.equal((await reads.readFile(listed)).digest, current.digest);
    assert.equal(seedReads(current.id), 0);
    await reads.readFile(listed);
    assert.equal(seedReads(current.id), 2, 'a witness can be consumed only once');
    const next = (await reads.listFiles()).find((file) => file.id === current.id);
    fixture.calls.length = 0;
    await reads.readFile({ ...next });
    assert.equal(seedReads(current.id), 2, 'matching fields do not copy list-object identity');
    await reads.listFiles();
    fixture.calls.length = 0;
    await reads.readFile(next);
    assert.equal(seedReads(current.id), 2, 'a new listing invalidates unused witnesses from the previous one');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication discovery fully revalidates changed tag, raw description and corrupt seed versions', async () => {
  const { createMicrosoftPublicationReads } = await import('../host/cloudMicrosoftPublicationReads.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-discovery-change-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    await fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 });
    const reads = createMicrosoftPublicationReads({ reads: fixture.reads, isCurrent: () => true });
    const id = fixture.destination.fixedSlots[0];
    const original = fixture.files.get(id);
    for (const mode of ['tag', 'description', 'corrupt']) {
      const listed = (await reads.listFiles()).find((file) => file.id === id);
      const bytes = Buffer.from(original.bytes), description = original.description;
      if (mode === 'description') {
        const record = JSON.parse(description);
        record.n = 'f'.repeat(64);
        original.description = JSON.stringify(record);
      } else original.condition = `"changed-${mode}"`;
      if (mode === 'corrupt') original.bytes[0] ^= 1;
      fixture.calls.length = 0;
      const result = await reads.readFile(listed);
      const contentIds = fixture.calls.filter((call) => call.method === 'GET'
        && new URL(call.target).pathname.endsWith('/content'))
        .map((call) => new URL(call.target).pathname.split('/').at(-2));
      assert(contentIds.includes(id), `${mode} must not reuse the old seed witness`);
      if (mode === 'corrupt') {
        await assert.rejects(parseCloudSnapshot(result.bytes.toString('utf8')));
        assert.deepEqual(contentIds, [id], 'corrupt seed must not grant payload authority');
      } else {
        assert.equal((await parseCloudSnapshot(result.bytes.toString('utf8'))).streamId, fixture.destination.streamId);
        assert.equal(contentIds.filter((value) => value === id).length, 2);
      }
      original.bytes = bytes;
      original.description = description;
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication discovery witness preserves payload hashing and the final pointer version fence', async () => {
  const { createMicrosoftPublicationReads } = await import('../host/cloudMicrosoftPublicationReads.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-discovery-fence-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    await fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 });
    const reads = createMicrosoftPublicationReads({ reads: fixture.reads, isCurrent: () => true });
    const id = fixture.destination.fixedSlots[0];
    const payload = [...fixture.files.values()].find((file) => file.name.startsWith('recap-payload-'));
    const listed = (await reads.listFiles()).find((file) => file.id === id);
    payload.bytes[0] ^= 1;
    await assert.rejects(reads.readFile(listed));
    payload.bytes[0] ^= 1;
    const next = (await reads.listFiles()).find((file) => file.id === id);
    fixture.control.afterPayloadRead = () => { fixture.files.get(id).condition = '"changed-during-payload"'; };
    await assert.rejects(reads.readFile(next));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication preflight reuses exact seed witnesses only after fresh matching metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-preflight-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const start = fixture.calls.length;
    await fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 });
    const calls = fixture.calls.slice(start);
    const dispatched = calls.findIndex((call) => call.method === 'POST' && new URL(call.target).pathname.endsWith('/createUploadSession'));
    assert(dispatched > 0);
    const preflight = calls.slice(0, dispatched);
    for (const id of fixture.destination.fixedSlots) {
      assert.equal(preflight.filter((call) => call.method === 'GET'
        && new URL(call.target).pathname === `/v1.0/me/drive/items/${id}/content`).length, 1,
      'A seed already verified under its exact strong tag must not be downloaded again during the same preflight');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication preflight refuses a changed record witness before creating a payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-preflight-change-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const first = fixture.destination.fixedSlots[0], second = fixture.destination.fixedSlots[1];
    fixture.control.afterSeedRead = (id) => {
      if (id === second) {
        fixture.files.get(first).condition = '"externally-changed"';
        fixture.files.get(first).bytes[0] ^= 1;
      }
    };
    const start = fixture.calls.length;
    await assert.rejects(fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 }));
    assert.equal(fixture.calls.slice(start).some((call) => call.method === 'POST'), false);
    assert.equal((await fixture.getLedger().inspect()).attempt, null);
    assert.equal(fixture.control.payloadPuts, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication preflight fully revalidates a changed but still valid record version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-preflight-version-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const first = fixture.destination.fixedSlots[0], second = fixture.destination.fixedSlots[1];
    let changed = false;
    fixture.control.afterSeedRead = (id) => {
      if (id === second && !changed) {
        fixture.files.get(first).condition = '"new-valid-version"';
        changed = true;
      }
    };
    const result = await fixture.engine.writeSnapshot({ components: capture.components, label: 'Synthetic', epoch: 1 });
    assert.equal(result.attempt.phase, 'acknowledged');
    assert.equal(fixture.control.payloadPuts, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication writer rotates immutable snapshots and recovers a lost publication reply without another payload upload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-writer-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const write = (engine, note) => engine.writeSnapshot({
      components: { ...capture.components, reader: { ...capture.components.reader, notes: { 1: note } } },
      label: 'Synthetic', epoch: 1,
    });
    const first = await write(fixture.engine, 'A');
    assert.equal(first.attempt.phase, 'acknowledged');
    assert.equal(fixture.files.size, 3);
    fixture.control.losePublication = true;
    await assert.rejects(write(fixture.engine, 'B'));
    assert.equal((await fixture.getLedger().inspect()).attempt.phase, 'unknown');
    const reopened = await fixture.reopen();
    const second = await reopened.reconcile();
    assert.equal(second.attempt.phase, 'acknowledged');
    assert.equal(second.attempt.generation, 2);
    assert.equal(fixture.control.payloadPuts, 2);
    const third = await write(reopened, 'C');
    assert.equal(third.attempt.generation, 3);
    const ownedLedger = fixture.getLedger();
    const capacity = ownedLedger.capacity;
    const compact = ownedLedger.compact;
    let lowCapacity = true, compactions = 0;
    ownedLedger.capacity = async () => {
      const value = await capacity();
      if (!lowCapacity) return value;
      lowCapacity = false;
      return { ...value, remainingTransitions: 0, canPrepare: false };
    };
    ownedLedger.compact = async (options) => { compactions++; return compact(options); };
    fixture.control.holdDelete = true;
    await assert.rejects(reopened.cleanup());
    assert.equal(compactions, 1, 'capacity is restored before an irreversible cleanup can strand its journal');
    assert.equal(fixture.control.holdDelete, false, 'the compacted cleanup reached the controlled pending deletion');
    const pending = await fixture.getLedger().inspect();
    assert.equal(pending.payloads.filter((entry) => entry.cleanup !== null).length, 1);
    fixture.control.root404At = fixture.control.rootReads + 8;
    await assert.rejects(reopened.cleanup());
    assert.equal(fixture.control.root404Hits, 1, 'the payload read actually encountered the transient root404');
    assert.deepEqual(await fixture.getLedger().inspect(), pending, 'root404 cannot forget a still-existing immutable payload');
    assert.equal(fixture.releaseDelete(), true);
    await reopened.cleanup();
    assert.equal(fixture.files.size, 4, 'only two publication records and two committed payloads remain');
    const discovery = createCloudDiscovery({ reads: reopened.reads, isCurrent: () => true });
    const found = await discovery.discover();
    assert.equal(found.streams[0].current.generation, 3);
    assert.equal(found.streams[0].previous.generation, 2);
    const restored = await discovery.readSnapshot({ streamId: fixture.destination.streamId, selection: found.streams[0].previous });
    assert.equal(restored.components.reader.notes[1], 'B');
    assert(fixture.control.deleted.length > 0);
    const binding = { provider: 'microsoft', profileId: 'e'.repeat(64) };
    const adapter = await createWindowsCloudBackupService(fixture.serviceOptions)(binding);
    const connected = await adapter.connect();
    await assert.rejects(adapter.writeSnapshot({ components: capture.components, label: 'Native service', epoch: connected.epoch }));
    const choices = await adapter.discover();
    assert.equal(choices.state, 'awaiting-choice');
    assert.equal(choices.streams.length, 1);
    const active = await adapter.chooseSeparate(choices);
    const firstAck = await adapter.writeSnapshot({ components: capture.components, label: 'Native service', epoch: active.epoch });
    assert.equal(firstAck.generation, 1);
    fixture.control.losePublication = true;
    await assert.rejects(adapter.writeSnapshot({
      components: { ...capture.components, reader: { ...capture.components.reader, notes: { 2: 'Native B' } } },
      label: 'Native service', epoch: active.epoch,
    }));
    assert.equal((await adapter.status()).acknowledgement.generation, 1);
    const reopenedAdapter = await createWindowsCloudBackupService(fixture.serviceOptions)(binding);
    const ack = await reopenedAdapter.reconcile();
    assert.equal(ack.generation, 2);
    const nativeDiscovery = await reopenedAdapter.discover();
    const nativeStream = nativeDiscovery.streams.find((stream) => stream.streamId === active.streamId);
    assert.equal(nativeStream.current.generation, 2);
    assert.equal((await reopenedAdapter.readSnapshot({ streamId: active.streamId, selection: nativeStream.current }))
      .components.reader.notes[2], 'Native B');
    assert.equal((await reopenedAdapter.maintain()).capacity.remainingTransitions, 8192);
    assert(fixture.calls.every((call) => call.method !== 'PUT' || !new URL(call.target).pathname.endsWith('/content')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication fencing defeats a still-pending old publisher and bounds uncertain immutable payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-publication-fence-'));
  try {
    const fixture = await publicationWriterFixture(directory);
    const capture = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
    const write = (engine, note) => engine.writeSnapshot({
      components: { ...capture.components, reader: { ...capture.components.reader, notes: { 1: note } } },
      label: 'Synthetic', epoch: 1,
    });
    await write(fixture.engine, 'A');
    fixture.control.holdPublication = true;
    await assert.rejects(write(fixture.engine, 'not-published'));
    const reopened = await fixture.reopen();
    assert.equal((await reopened.reconcile()).attempt.phase, 'failed');
    await write(reopened, 'C');
    assert.equal(fixture.release(), false, 'the old request checks its frozen record condition when it finally publishes');
    const found = await createCloudDiscovery({ reads: reopened.reads, isCurrent: () => true }).discover();
    assert.equal(found.streams[0].current.generation, 3);
    for (const note of ['uncertain-D', 'uncertain-E']) {
      fixture.control.losePayload = true;
      await assert.rejects(write(reopened, note));
      assert.equal((await reopened.reconcile()).attempt.phase, 'failed');
    }
    const puts = fixture.control.payloadPuts;
    await assert.rejects(write(reopened, 'over-capacity'));
    assert.equal(fixture.control.payloadPuts, puts);
    assert.equal(fixture.files.size, 6);
    assert.equal((await fixture.getLedger().inspect()).maxGeneration, 5);
    assert.equal((await fixture.getLedger().inspect()).payloads.filter((value) => !value.terminal).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
