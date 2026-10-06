import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  ENVIRONMENT, WORKFLOW, PRODUCER, REPOSITORY_ID, PublisherError, digest, canonical,
  validateIntent, resolveIntent, validateInvocation, validateProducer, selectProducerArtifact, validateQualification,
  trackSnapshot, trackDigest, proposedTrack, transact, validatePrepared, runDirectory, prepare, publish,
} from '../scripts/google-play-publisher.mjs';
import {
  REPOSITORY, OFFICIAL_ID, PROTOTYPE_ID, BUNDLETOOL, protectionPolicy, requireApproval,
} from '../scripts/android-candidate.mjs';
import { NATIVE_METHODS } from '../scripts/check-android-instrumentation.mjs';

const source = 'a'.repeat(40);
const ledger = 'b'.repeat(40);
const tooling = 'c'.repeat(40);
const signer = 'd'.repeat(64);
const code = 3000004;
const bytes = Buffer.from('Synthetic network fixture, not a signed candidate.');
const artifact = { name: 'recap-page-android.aab', bytes: bytes.length, sha256: digest(bytes) };
const emptyTrack = () => ({ track: 'qa', releases: [] });
const release = () => ({
  name: 'Recap Page 3.2.0', versionCodes: [String(code)], status: 'completed',
  releaseNotes: [{ language: 'en-US', text: 'Compatible reading improvements.' }],
});
function raw(mode = 'Publish') {
  return {
    mode, source_sha: source, ledger_sha: ledger, candidate_run_id: '123', artifact_id: '456',
    version_code: String(code), upload_cert_sha256: signer,
    track: mode === 'Inspect' ? '' : 'qa',
    release_json: mode === 'Inspect' ? '' : JSON.stringify(release()),
    expected_track_sha256: mode === 'Inspect' ? '' : trackDigest(emptyTrack()),
  };
}
const pins = ['source_sha', 'ledger_sha', 'artifact_id', 'version_code', 'upload_cert_sha256'];
function guided(mode = 'Publish') {
  return { mode, candidate_run_id: '123', track: 'qa', release_notes: release().releaseNotes[0].text };
}
function resolved(value = guided()) {
  const request = validateIntent(value);
  return resolveIntent(request, { sourceSha: source, ledgerSha: request.ledgerSha || tooling,
    artifactId: 456, code, signer, productVersion: '3.2.0' });
}
const identity = () => ({
  schemaVersion: 1, productVersion: '3.2.0', platform: 'android', packageVersion: code,
  channel: 'candidate', sourceRevision: source, sourceTree: 'e'.repeat(40), sourceDirty: false,
});
const context = () => ({
  repository: REPOSITORY, event: 'workflow_dispatch', ref: 'refs/heads/main',
  defaultBranch: 'main', runId: 789, attempt: 1, workflowSha: tooling, sha: tooling,
  workflowRef: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`,
});
const run = (producer = false) => ({
  id: producer ? 123 : 789, run_attempt: 1, event: 'workflow_dispatch',
  head_branch: 'main', head_sha: tooling, path: producer ? PRODUCER : WORKFLOW,
  status: 'completed', conclusion: 'success',
  repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID },
});
const githubArtifact = () => ({
  id: 456, name: `android-candidate-${code}-123`, expired: false, size_in_bytes: 100,
  digest: `sha256:${'f'.repeat(64)}`,
  workflow_run: { id: 123, head_branch: 'main', head_sha: tooling,
    repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID },
});
function environment(name = ENVIRONMENT) {
  return {
    name, id: 42, can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { type: 'User', id: 7 } }] }],
  };
}
const branches = () => ({ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] });
const approvals = () => [{ state: 'approved', user: { type: 'User', id: 7 }, environments: [{ id: 42 }] }];
function qualification() {
  const record = { ...identity(), artifact };
  const recordBytes = Buffer.from(`${JSON.stringify(record)}\n`);
  const approval = { runId: 123, environmentId: 42, policySha256: '1'.repeat(64), approved: true };
  const row = (phase, method = 'startupAndPersistence') => {
    const prototype = phase.startsWith('prototype');
    return {
      phase, method, packageName: prototype ? PROTOTYPE_ID : OFFICIAL_ID,
      uid: prototype ? 200 : 100, status: 'passed', tests: 1, skipped: 0,
      appHashes: [prototype ? '2'.repeat(64) : '3'.repeat(64)],
      harnessHash: '4'.repeat(64), signerSha256: prototype ? '5'.repeat(64) : '6'.repeat(64),
      stateMatched: true, settingsMatched: true, storageCleared: false,
    };
  };
  return { record, recordBytes, approval, report: {
    schemaVersion: 1, kind: 'qualified-candidate', source: identity(),
    workflow: { sha: tooling, path: PRODUCER, runId: 123, attempt: 1 },
    ledgerCommit: ledger, approval,
    bundle: { bundleSha256: artifact.sha256, bundleSignerSha256: signer,
      structure: true, manifest: true, resources: true, assets: true,
      nativeLibraries: 0, apkSignatures: true },
    proofSignerSha256: '6'.repeat(64),
    native: { schemaVersion: 1, interfaceVersion: 1, synthetic: true,
      device: { sdk: 36, abi: 'x86_64', width: 1080, height: 2400, density: 420,
        webViewVersion: '140.0.0.0', externalNetworkBlocked: true },
      executions: [...NATIVE_METHODS.map((method) => row('suite', method)),
        ...['restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe']
          .map((phase) => row(phase))] },
    scope: 'Synthetic qualification; not API26 runtime, Play signer, upgrade or physical acceptance.',
    tools: { bundletool: BUNDLETOOL, jdk: 'openjdk 17', gradle: '9.8.0', agp: '9.4.1', sdkBuildTools: '35.0.0' },
    artifactRecordSha256: digest(recordBytes),
  } };
}
function harness(options = {}) {
  const calls = [];
  const receipts = [];
  const timeline = [];
  let tracks = structuredClone(options.tracks || [emptyTrack(), { track: 'production', releases: [] }]);
  const token = 'fixture-token-never-recorded';
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const request = { path: parsed.pathname, query: parsed.search, method: init.method, init };
    calls.push(request);
    timeline.push(`request:${init.method}:${parsed.pathname}`);
    assert.equal(parsed.origin, 'https://androidpublisher.googleapis.com');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    if (options.intercept) {
      const result = await options.intercept(request, calls);
      if (result !== undefined) return result;
    }
    const response = (value) => new Response(JSON.stringify(value), { status: 200 });
    if (parsed.pathname.endsWith('/edits') && init.method === 'POST') {
      return response(options.edit || { id: 'edit-123', expiryTimeSeconds: '2000000000' });
    }
    if (parsed.pathname.endsWith('/tracks') && init.method === 'GET') return response({ tracks });
    if (parsed.pathname.endsWith('/bundles') && init.method === 'GET') return response({ bundles: options.bundles || [] });
    if (parsed.pathname.endsWith('/apks')) return response({ apks: options.apks || [] });
    if (parsed.pathname.includes('/upload/')) {
      assert.deepEqual(init.body, bytes);
      assert.equal(init.headers['Content-Type'], 'application/octet-stream');
      return response(options.upload || { versionCode: code, sha256: artifact.sha256 });
    }
    if (init.method === 'PUT') {
      const desired = JSON.parse(init.body);
      tracks = tracks.map((track) => track.track === desired.track ? desired : track);
      if (options.alterReadback) tracks = options.alterReadback(tracks);
      return response(desired);
    }
    if (parsed.pathname.endsWith(':validate') || parsed.pathname.endsWith(':commit')) return response({ id: 'edit-123' });
    assert.fail(`Unexpected fixture request: ${init.method} ${parsed.pathname}`);
  };
  return {
    calls, receipts, timeline, token, fetchImpl, now: () => 1900000000000,
    record: async (value) => { receipts.push(value); timeline.push(`receipt:${value.stage}`); },
  };
}
const operation = (mode, fixture) => transact(validateIntent(raw(mode)), bytes, artifact, fixture);

test('publisher intent accepts explicit modes and rejects unpinned or production input', () => {
  for (const mode of ['Validate', 'Inspect', 'Publish', 'Promote']) assert.equal(validateIntent(raw(mode)).mode, mode);
  for (const change of [
    (v) => { v.mode = 'Submit'; }, (v) => { v.source_sha = 'main'; },
    (v) => { v.ledger_sha = ''; }, (v) => { v.candidate_run_id = '0123'; },
    (v) => { v.artifact_id = '1e3'; }, (v) => { v.version_code = '3000002'; },
    (v) => { v.version_code = '2100000001'; }, (v) => { v.track = 'production'; },
    (v) => { v.track = 'wear:production'; }, (v) => { v.track = '../qa'; },
    (v) => { v.upload_cert_sha256 = 'not-a-certificate'; }, (v) => { v.extra = 'ignored'; },
  ]) {
    const value = raw();
    change(value);
    assert.throws(() => validateIntent(value));
  }
});

test('release intent is closed, bounded and never supplies an implicit rollout or code', () => {
  for (const change of [
    (v) => { v.expected_track_sha256 = ''; }, (v) => { v.release_json = '{'; },
    (v) => { v.release_json = JSON.stringify({ ...release(), userFraction: 0.5 }); },
    (v) => { v.release_json = JSON.stringify({ ...release(), status: 'inProgress' }); },
    (v) => { v.release_json = JSON.stringify({ ...release(), versionCodes: ['3000003'] }); },
    (v) => { v.release_json = JSON.stringify({ ...release(), versionCodes: [String(code), String(code)] }); },
    (v) => { v.release_json = JSON.stringify({ ...release(), releaseNotes: [{ language: 'en-US', text: 'x'.repeat(501) }] }); },
    (v) => { v.mode = 'Inspect'; },
  ]) {
    const value = raw();
    change(value);
    assert.throws(() => validateIntent(value));
  }
});

test('guided and pinned requests share canonical mode policy routing without mixed overrides', () => {
  for (const mode of ['Validate', 'Publish']) {
    for (const identityPins of [{}, Object.fromEntries(pins.map((key) => [key, raw()[key]]))]) {
      for (const patch of [
        { expected_track_sha256: '', expected: 'capture-current-simple' },
        { expected_track_sha256: trackDigest(emptyTrack()), expected: 'explicit-pin' },
        { track_state_policy: 'capture-current-simple', expected: 'capture-current-simple' },
      ]) {
        const { expected, ...input } = patch;
        const value = { ...guided(mode), ...identityPins, ...input };
        assert.equal(validateIntent(value).trackStatePolicy, expected);
        assert.deepEqual(resolved(value).release, release());
      }
      const custom = { ...release(), name: 'Reviewed custom release', status: 'draft',
        versionCodes: ['3000003', String(code)], releaseNotes: [{ language: 'fr', text: 'Notes.' }, ...release().releaseNotes] };
      for (const policy of ['automatic', 'capture-current-simple']) {
        const value = { mode, candidate_run_id: '123', track: 'qa', ...identityPins,
          release_json: JSON.stringify(custom), track_state_policy: policy,
          expected_track_sha256: policy === 'automatic' ? trackDigest(emptyTrack()) : '' };
        assert.deepEqual(resolved(value).release, custom);
        assert.equal(validateIntent(value).trackStatePolicy,
          policy === 'automatic' ? 'explicit-pin' : 'capture-current-simple');
      }
    }
  }
  for (const mode of ['Validate', 'Inspect']) {
    for (const identityPins of [{}, Object.fromEntries(pins.map((key) => [key, raw()[key]]))]) {
      const value = { mode, candidate_run_id: '123', ...identityPins };
      const spec = resolved(value);
      assert.equal(spec.trackStatePolicy, null);
      assert.equal(spec.release, null);
      assert.equal(spec.expectedTrackSha256, '');
      for (const patch of [{ track_state_policy: 'explicit-pin' },
        { track_state_policy: 'capture-current-simple' }, { expected_track_sha256: trackDigest(emptyTrack()) }]) {
        assert.throws(() => validateIntent({ ...value, ...patch }));
      }
    }
  }
  const url = `https://github.com/${REPOSITORY}/actions/runs/123`;
  assert.deepEqual(validateIntent({ ...guided(), candidate_run_id: url }), validateIntent(guided()));
  for (const candidate_run_id of [`${url}/`, `${url}?attempt=1`, url.replace(REPOSITORY, 'fixture/fork'),
    url.replace('https:', 'http:'), `${url}#artifacts`, 'latest', '0', '0123']) {
    assert.throws(() => validateIntent({ ...guided(), candidate_run_id }));
  }
  for (const key of pins) {
    assert.throws(() => validateIntent({ ...guided(), [key]: raw()[key] }), /ALL_OR_NONE/);
    assert.throws(() => validateIntent({ ...raw(), [key]: '' }), /ALL_OR_NONE/);
  }
  for (const patch of [
    { release_json: JSON.stringify(release()) }, { release_notes: ' \n\t' },
    { release_notes: '\u{1f642}'.repeat(501) }, { expected_track_sha256: 'not-a-digest' },
    { track_state_policy: 'unknown' }, { mode: 'Inspect' },
    { mode: 'Promote' }, { track_state_policy: 'explicit-pin' },
    { track_state_policy: 'capture-current-simple', expected_track_sha256: trackDigest(emptyTrack()) },
    { mode: 'Promote', track_state_policy: 'capture-current-simple' },
  ]) assert.throws(() => validateIntent({ ...guided(), ...patch }));
  assert.equal(validateIntent({ ...guided(), release_notes: '\u{1f642}'.repeat(500) }).releaseNotes.length, 1000);
  assert.equal(resolved({ ...guided('Promote'), expected_track_sha256: trackDigest(emptyTrack()) }).trackStatePolicy, 'explicit-pin');
  assert.throws(() => validateIntent({ ...raw(), release_json: `{"name":"${'x'.repeat(8192)}"}` }), /TOO_LARGE/);
  const wrongCode = { ...raw(), release_json: JSON.stringify({ ...release(), versionCodes: ['3000003'] }) };
  for (const key of pins) delete wrongCode[key];
  assert.throws(() => resolved(wrongCode), /CANDIDATE_CODE_REQUIRED/);
  for (const patch of [{ source_sha: tooling }, { artifact_id: '457' }, { upload_cert_sha256: 'e'.repeat(64) }]) {
    assert.throws(() => resolved({ ...raw(), ...patch }), /IDENTITY_PIN_MISMATCH/);
  }
});

test('publisher invocation requires the actual direct main workflow and first attempt', () => {
  assert.doesNotThrow(() => validateInvocation(context(), run()));
  for (const change of [
    (c) => { c.event = 'release'; }, (c) => { c.ref = 'refs/tags/v3.2.0'; },
    (c) => { c.defaultBranch = 'feature'; }, (c) => { c.attempt = 2; },
    (c) => { c.workflowRef = `${REPOSITORY}/${PRODUCER}@refs/heads/main`; },
    (c) => { c.workflowSha = source; }, (c) => { c.repository = 'fixture/fork'; },
  ]) {
    const value = context();
    change(value);
    assert.throws(() => validateInvocation(value, run()));
  }
  assert.throws(() => validateInvocation(context(), { ...run(), head_repository: { id: 1 } }));
});

test('producer qualification binds a successful signed run to its exact immutable artifact', () => {
  const spec = validateIntent(raw());
  assert.doesNotThrow(() => validateProducer(spec, run(true), githubArtifact()));
  for (const patch of [{ conclusion: 'failure' }, { status: 'in_progress' }, { run_attempt: 2 },
    { path: '.github/workflows/ci.yml' }, { head_branch: 'feature' }, { event: 'pull_request' }]) {
    assert.throws(() => validateProducer(spec, { ...run(true), ...patch }, githubArtifact()));
  }
  for (const patch of [{ id: 457 }, { expired: true }, { name: 'rehearsal' }, { digest: '' },
    { size_in_bytes: 0 }, { workflow_run: { ...githubArtifact().workflow_run, repository_id: 1 } }]) {
    assert.throws(() => validateProducer(spec, run(true), { ...githubArtifact(), ...patch }));
  }
});

test('named producer selection rejects ambiguous packets including expired competitors', () => {
  const request = validateIntent(guided());
  const packet = githubArtifact();
  const unrelated = { ...packet, id: 457, name: 'unrelated-report' };
  assert.deepEqual(selectProducerArtifact(request, run(true), { total_count: 2, artifacts: [unrelated, packet] }),
    { artifact: packet, code });
  for (const listing of [
    { total_count: 0, artifacts: [] }, { total_count: 2, artifacts: [packet] },
    { total_count: 101, artifacts: [packet] }, { total_count: '1', artifacts: [packet] },
    { total_count: 1, artifacts: [unrelated] },
    { total_count: 2, artifacts: [packet, { ...unrelated, id: packet.id }] },
    { total_count: 1, artifacts: [{ ...packet, expired: true }] },
    { total_count: 2, artifacts: [packet, { ...packet, id: 458, name: `android-candidate-${code + 1}-123` }] },
    { total_count: 2, artifacts: [packet, { ...packet, id: 458, expired: true }] },
    { total_count: 1, artifacts: [{ ...packet, name: 'android-candidate-3000002-123' }] },
    { total_count: 1, artifacts: [{ ...packet, name: 'android-candidate-2100000001-123' }] },
    { total_count: 1, artifacts: [{ ...packet, workflow_run: { ...packet.workflow_run, id: 124 } }] },
    { total_count: 2, artifacts: [packet, { ...unrelated, workflow_run: { ...packet.workflow_run, repository_id: 1 } }] },
  ]) assert.throws(() => selectProducerArtifact(request, run(true), listing));
  assert.throws(() => selectProducerArtifact(request, { ...run(true), run_attempt: 2 },
    { total_count: 1, artifacts: [packet] }), /QUALIFIED_PRODUCER_REQUIRED/);
});

test('qualification receipt preserves actual identity, signatures, approval and limited native scope', () => {
  const spec = validateIntent(raw());
  const good = qualification();
  assert.doesNotThrow(() => validateQualification(good.report, good.record, good.recordBytes, spec, run(true), good.approval));
  for (const change of [
    (v) => { v.kind = 'rehearsal-only'; }, (v) => { v.source.packageVersion += 1; },
    (v) => { v.artifactRecordSha256 = '0'.repeat(64); }, (v) => { v.workflow.runId += 1; },
    (v) => { v.approval.approved = false; }, (v) => { v.bundle.manifest = false; },
    (v) => { v.bundle.bundleSignerSha256 = '6'.repeat(64); },
    (v) => { v.native.executions[7].stateMatched = false; },
    (v) => { v.scope = 'Physical production acceptance'; },
    (v) => { v.tools.extra = true; },
  ]) {
    const report = structuredClone(good.report);
    change(report);
    assert.throws(() => validateQualification(report, good.record, good.recordBytes, spec, run(true), good.approval));
  }
});

test('shared environment-name support preserves the signing default and exact publisher policy', () => {
  assert.throws(() => protectionPolicy(environment(), branches()));
  assert.doesNotThrow(() => protectionPolicy(environment('android-release-candidate'), branches()));
  const policy = protectionPolicy(environment(), branches(), ENVIRONMENT);
  assert.equal(policy.environmentId, 42);
  for (const patch of [{ name: 'arbitrary-environment' }, { can_admins_bypass: true }, { protection_rules: [] }]) {
    assert.throws(() => protectionPolicy({ ...environment(), ...patch }, branches(), ENVIRONMENT));
  }
});

test('publisher approval must come from one listed human for the exact protected environment', () => {
  const policy = protectionPolicy(environment(), branches(), ENVIRONMENT);
  assert.equal(requireApproval(approvals(), policy, context()).approved, true);
  for (const value of [[], [...approvals(), ...approvals()],
    [{ ...approvals()[0], state: 'rejected' }],
    [{ ...approvals()[0], user: { id: 7, type: 'Bot' } }],
    [{ ...approvals()[0], environments: [{ id: 43 }] }]]) {
    assert.throws(() => requireApproval(value, policy, context()));
  }
});

test('track digest normalizes documented defaults and unordered codes and languages', () => {
  assert.equal(trackDigest({ track: 'qa' }), trackDigest(emptyTrack()));
  assert.equal(trackDigest({ releases: [release()], track: 'qa' }),
    trackDigest({ track: 'qa', releases: [{ releaseNotes: release().releaseNotes,
      status: 'completed', versionCodes: [String(code)], name: release().name }] }));
  assert.throws(() => trackSnapshot({ track: 'qa', unexpected: true }));
  assert.throws(() => trackSnapshot({ track: 'qa', releases: null }));
  const first = { ...release(), versionCodes: ['3000003', String(code)],
    releaseNotes: [{ language: 'en-US', text: 'English.' }, { language: 'fr', text: 'French.' }] };
  const reordered = { ...first, versionCodes: [...first.versionCodes].reverse(),
    releaseNotes: [...first.releaseNotes].reverse(), inAppUpdatePriority: 0 };
  assert.equal(trackDigest({ track: 'qa', releases: [first] }),
    trackDigest({ track: 'qa', releases: [reordered] }));
  assert.throws(() => trackSnapshot({ track: 'qa', releases: [{ ...first,
    releaseNotes: [first.releaseNotes[0], first.releaseNotes[0]] }] }));
});

test('proposed track refuses stale, complex or unapproved retained-version changes', () => {
  const spec = validateIntent(raw());
  assert.deepEqual(proposedTrack(spec, emptyTrack()), { track: 'qa', releases: [release()] });
  assert.throws(() => proposedTrack({ ...spec, expectedTrackSha256: '0'.repeat(64) }, emptyTrack()));
  for (const releases of [[release(), release()], [{ ...release(), status: 'inProgress', userFraction: 0.2 }],
    [{ ...release(), countryTargeting: { countries: ['CA'] } }],
    [{ ...release(), inAppUpdatePriority: 5 }]]) {
    const current = { track: 'qa', releases };
    assert.throws(() => proposedTrack({ ...spec, expectedTrackSha256: trackDigest(current) }, current));
  }
  assert.throws(() => proposedTrack({ ...spec, release: { ...release(), versionCodes: ['3000003', String(code)] } }, emptyTrack()));
});

test('publish uses exact bytes once and reports submitted rather than user availability', async () => {
  const fixture = harness({ alterReadback: (tracks) => tracks.map((track) => ({
    ...track, releases: track.releases.map((item) => ({ ...item, inAppUpdatePriority: 0 })),
  })) });
  const result = await operation('Publish', fixture);
  assert.equal(fixture.calls.length, 9);
  assert.equal(fixture.calls.filter((call) => call.path.includes('/upload/')).length, 1);
  assert.equal(result.state, 'submitted-publication-unverified');
  assert.equal(result.commitAcknowledged, true);
  assert.equal(result.userAvailability, 'unverified');
  assert.match(fixture.calls.at(-1).query, /changesInReviewBehavior=ERROR_IF_IN_REVIEW/);
  assert.ok(!JSON.stringify(fixture.receipts).includes(fixture.token));
  const changed = Buffer.from(bytes);
  const later = harness({ intercept: (call) => {
    if (call.path.endsWith('/tracks') && call.method === 'GET') changed[0] ^= 1;
  } });
  await assert.rejects(transact(validateIntent(raw()), changed, artifact, later), /BUNDLE_CHANGED_BEFORE_UPLOAD/);
  assert.equal(later.calls.length, 4);
});

test('captured target evidence is durable before upload without changing the approved intent', async () => {
  const prior = { track: 'qa', kind: 'androidpublisher#track', releases: [{
    name: 'Previous release', status: 'completed', versionCodes: ['3000003'], inAppUpdatePriority: 0,
  }] };
  const spec = resolved();
  const approved = canonical(spec);
  Object.freeze(spec);
  const fixture = harness({ tracks: [prior, { track: 'production', releases: [] }] });
  const result = await transact(spec, bytes, artifact, fixture);
  assert.equal(result.state, 'submitted-publication-unverified');
  assert.equal(result.trackStatePolicy, 'capture-current-simple');
  assert.equal(result.expectedTrackSha256, null);
  assert.deepEqual(result.targetBefore, trackSnapshot(prior));
  assert.equal(result.targetBeforeSha256, trackDigest(prior));
  assert.deepEqual(result.desiredTarget, { track: 'qa', releases: [release()] });
  assert.equal(canonical(spec), approved);
  const captured = fixture.timeline.indexOf('receipt:target-prepared');
  const upload = fixture.timeline.findIndex((item) => item.startsWith('request:POST:') && item.includes('/upload/'));
  assert.ok(captured > 0 && captured < upload);
  const beforeUpload = fixture.receipts.find((receipt) => receipt.stage === 'upload-bundle');
  assert.deepEqual(beforeUpload.targetBefore, trackSnapshot(prior));
  assert.equal(beforeUpload.targetBeforeSha256, result.targetBeforeSha256);
  assert.deepEqual(beforeUpload.desiredTarget, result.desiredTarget);
  assert.equal(fixture.calls.length, 9);
  const blocked = harness();
  await assert.rejects(transact(spec, bytes, artifact, { ...blocked, record: async (receipt) => {
    if (receipt.stage === 'target-prepared') throw new Error('capture receipt unavailable');
    await blocked.record(receipt);
  } }), /capture receipt unavailable/);
  assert.equal(blocked.calls.length, 4);
  assert.ok(!blocked.calls.some((call) => call.path.includes('/upload/') || call.method === 'PUT'));
});

test('automatic capture refuses complex tracks and used codes before uploading', async () => {
  const previous = { ...release(), versionCodes: ['3000003'] };
  for (const options of [
    { tracks: [{ track: 'qa', releases: [previous, previous] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, status: 'inProgress', userFraction: 0.5 }] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, status: 'halted' }] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, userFraction: 0.5 }] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, countryTargeting: { includeRestOfWorld: true } }] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, inAppUpdatePriority: 1 }] }] },
    { tracks: [{ track: 'qa', releases: [{ ...previous, unrecognized: true }] }] },
    { tracks: [{ track: 'internal', releases: [] }] },
    { bundles: [{ versionCode: code, sha256: artifact.sha256 }] },
    { apks: [{ versionCode: code + 1 }] },
    { tracks: [emptyTrack(), { track: 'production', releases: [{ ...previous, versionCodes: [String(code)] }] }] },
  ]) {
    const fixture = harness(options);
    await assert.rejects(transact(resolved(), bytes, artifact, fixture));
    assert.ok(fixture.calls.length <= 4);
    assert.ok(!fixture.calls.some((call) => call.path.includes('/upload/') || call.method === 'PUT'));
    assert.equal(fixture.receipts.at(-1).state, 'blocked');
  }
});

test('inspect creates one read-only working edit without uploading, changing tracks or committing', async () => {
  const fixture = harness();
  const result = await operation('Inspect', fixture);
  assert.equal(fixture.calls.length, 4);
  assert.equal(fixture.calls.filter((call) => call.method !== 'GET').length, 1);
  assert.deepEqual(result.tracks, [{ track: 'qa', sha256: trackDigest(emptyTrack()) }]);
  assert.equal(result.state, 'inspected-no-release-change');
  assert.equal(result.commitAcknowledged, false);
});

test('promotion reuses an already uploaded exact bundle and never reuploads it', async () => {
  const fixture = harness({ bundles: [{ versionCode: code, sha256: artifact.sha256 }] });
  const result = await operation('Promote', fixture);
  assert.equal(result.commitAcknowledged, true);
  assert.equal(fixture.calls.length, 8);
  assert.equal(fixture.calls.filter((call) => call.path.includes('/upload/')).length, 0);
  const mismatch = harness({ bundles: [{ versionCode: code, sha256: '0'.repeat(64) }] });
  await assert.rejects(operation('Promote', mismatch), /EXACT_EXISTING_BUNDLE/);
  assert.equal(mismatch.calls.length, 4);
});

test('no Google request occurs without exact bundle bytes, token, receipt writer and safe intent', async () => {
  for (const value of [
    { bundle: Buffer.alloc(bytes.length), options: {} },
    { bundle: bytes, options: { token: '' } },
    { bundle: bytes, options: { record: undefined } },
    { bundle: bytes, options: {}, spec: { ...validateIntent(raw()), track: 'production' } },
  ]) {
    const fixture = harness();
    await assert.rejects(transact(value.spec || validateIntent(raw()), value.bundle, artifact,
      { ...fixture, ...value.options }));
    assert.equal(fixture.calls.length, 0);
  }
});

test('an absent testing track is never silently redirected to an internal alias', async () => {
  const fixture = harness({ tracks: [{ track: 'internal', releases: [] }] });
  await assert.rejects(operation('Publish', fixture), /TRACK_NOT_FOUND_NO_ALIAS_FALLBACK/);
  assert.equal(fixture.calls.length, 4);
});

test('publish refuses used and out-of-order codes seen in bundles, APKs or tracks', async () => {
  for (const options of [
    { bundles: [{ versionCode: code, sha256: artifact.sha256 }] },
    { apks: [{ versionCode: code + 1 }] },
    { tracks: [emptyTrack(), { track: 'production', releases: [{ status: 'completed', versionCodes: [String(code + 1)] }] }] },
  ]) {
    const fixture = harness(options);
    await assert.rejects(operation('Publish', fixture), /CODE_ALREADY_USED_OR_OUT_OF_ORDER/);
    assert.equal(fixture.calls.length, 4);
  }
});

test('upload identity mismatch stops before track mutation and records uncertain remote effect', async () => {
  for (const upload of [{ versionCode: code + 1, sha256: artifact.sha256 },
    { versionCode: code, sha256: '0'.repeat(64) }]) {
    const fixture = harness({ upload });
    await assert.rejects(operation('Publish', fixture), /UPLOAD_IDENTITY_MISMATCH/);
    assert.equal(fixture.calls.length, 5);
    assert.equal(fixture.receipts.at(-1).state, 'uncertain');
  }
});

test('target state movement stops before upload instead of overwriting a newer release', async () => {
  const fixture = harness({ tracks: [{ track: 'qa', releases: [{ ...release(), versionCodes: ['3000003'] }] }] });
  await assert.rejects(operation('Publish', fixture), /TRACK_STATE_CHANGED/);
  assert.equal(fixture.calls.length, 4);
});

test('readback must preserve every non-target track before validation and commit', async () => {
  const fixture = harness({ alterReadback: (tracks) => tracks.filter((track) => track.track === 'qa') });
  await assert.rejects(operation('Publish', fixture), /TRACK_READBACK_MISMATCH/);
  assert.equal(fixture.calls.length, 7);
  assert.ok(!fixture.calls.some((call) => call.path.endsWith(':commit')));
});

test('an existing review rejection never retries commit or enables review cancellation', async () => {
  const fixture = harness({ intercept: (call) => {
    if (!call.path.endsWith(':commit')) return undefined;
    return call.query === '?changesInReviewBehavior=ERROR_IF_IN_REVIEW'
      ? new Response('private server detail', { status: 400 })
      : new Response(JSON.stringify({ id: 'edit-123' }), { status: 200 });
  } });
  await assert.rejects(operation('Publish', fixture), /PLAY_HTTP_REJECTED/);
  const commits = fixture.calls.filter((call) => call.path.endsWith(':commit'));
  assert.equal(commits.length, 1);
  assert.equal(commits[0].query, '?changesInReviewBehavior=ERROR_IF_IN_REVIEW');
  assert.equal(fixture.receipts.at(-1).httpStatus, 400);
  assert.equal(fixture.receipts.at(-1).state, 'blocked');
  assert.ok(!JSON.stringify(fixture.receipts).includes('private server detail'));
});

test('uncertain upload or commit is recorded once without mutation retry or token leakage', async () => {
  for (const target of ['upload', 'commit']) {
    const matches = (call) => target === 'upload' ? call.path.includes('/upload/') : call.path.endsWith(':commit');
    const fixture = harness({ intercept: (call) => {
      if (matches(call)) throw new Error('fixture-token-never-recorded');
    } });
    await assert.rejects(operation('Publish', fixture), /TRANSPORT_OUTCOME_UNKNOWN/);
    assert.equal(fixture.calls.filter(matches).length, 1);
    assert.equal(fixture.receipts.at(-1).state, 'uncertain');
    assert.equal(fixture.receipts.at(-1).commitAcknowledged, false);
    assert.ok(!JSON.stringify(fixture.receipts).includes(fixture.token));
  }
});

test('expired or malformed API state fails explicitly without subsequent publishing steps', async () => {
  const expired = harness({ edit: { id: 'edit-123', expiryTimeSeconds: '1' } });
  await assert.rejects(operation('Publish', expired), /EDIT_EXPIRED/);
  assert.equal(expired.calls.length, 1);
  const malformed = harness({ intercept: (call) => call.path.endsWith('/tracks')
    ? new Response('{', { status: 200 }) : undefined });
  await assert.rejects(operation('Publish', malformed), /INVALID_API_JSON/);
  assert.equal(malformed.calls.length, 2);
});

test('workflow protects the exact main operation before narrow short-lived authentication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/google-play-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: Validate/);
  assert.match(workflow, /candidate_run_id:[\s\S]*?type: string\s+required: true/);
  assert.match(workflow, /release_notes:[\s\S]*?type: string/);
  assert.match(workflow, /options: \[automatic, capture-current-simple, explicit-pin\]\s+default: automatic/);
  assert.equal([...workflow.matchAll(/required: true/g)].length, 1, 'Only the named producer is always required');
  for (const name of pins) {
    assert.match(workflow, new RegExp(`      ${name}:\\s+description: Advanced optional`));
  }
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|release):/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  const preflight = workflow.slice(workflow.indexOf('  preflight:'), workflow.indexOf('\n  publish:'));
  assert.doesNotMatch(preflight, /github\.run_attempt == 1|^\s{4}if:/m,
    'Invalid dispatches must reach the failing preflight, not an all-skipped success.');
  let jobEnvironment = false;
  for (const line of workflow.split(/\r?\n/)) {
    if (/^ {4}env:\s*$/.test(line)) jobEnvironment = true;
    else if (/^ {0,4}\S/.test(line)) jobEnvironment = false;
    if (jobEnvironment) assert.doesNotMatch(line, /\$\{\{\s*runner\./,
      'The runner context is unavailable in jobs.job_id.env.');
  }
  const environment = { RUNNER_TEMP: tmpdir(), GITHUB_RUN_ID: '789', GITHUB_RUN_ATTEMPT: '1' };
  assert.deepEqual(runDirectory(environment),
    { root: resolve(tmpdir()), work: join(resolve(tmpdir()), 'recap-google-play-789-1') });
  for (const patch of [{ RUNNER_TEMP: '' }, { RUNNER_TEMP: 'relative' },
    { GITHUB_RUN_ID: '../escape' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_RUN_ID: 789 }]) {
    assert.throws(() => runDirectory({ ...environment, ...patch }));
  }
  assert.match(workflow, /environment: \$\{\{ needs\.preflight\.outputs\.environment \}\}/);
  assert.ok(workflow.indexOf('approved-preflight') < workflow.indexOf('uses: google-github-actions/auth@'));
  assert.match(workflow, /auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/);
  assert.match(workflow, /create_credentials_file: false/);
  assert.match(workflow, /export_environment_variables: false/);
  assert.match(workflow, /access_token_scopes: https:\/\/www\.googleapis\.com\/auth\/androidpublisher/);
  assert.match(workflow, /access_token_lifetime: 900s/);
  assert.doesNotMatch(workflow, /credentials_json:|continue-on-error:|pull_request_target/);
  assert.match(workflow, /RECAP_PLAY_EXPECTED_BINDING_SHA: \$\{\{ needs\.preflight\.outputs\.binding_sha \}\}/);
});

test('prepared binding cannot be forged, changed after approval or reused by another run', () => {
  const spec = validateIntent(raw());
  const binding = { request: spec, spec, source: identity(), artifactId: 456, bundle: artifact };
  const expected = digest(canonical(binding));
  const prepared = { binding, bindingSha: expected, approval: { approved: true }, context: context() };
  assert.doesNotThrow(() => validatePrepared(prepared, spec, context(), expected));
  for (const change of [
    (v) => { v.approval.approved = false; }, (v) => { v.context.runId += 1; },
    (v) => { v.context.attempt = 2; }, (v) => { v.binding.bundle.sha256 = '0'.repeat(64); },
    (v) => { v.binding.source.packageVersion += 1; }, (v) => { v.bindingSha = '0'.repeat(64); },
    (v) => { v.binding.spec.trackStatePolicy = 'capture-current-simple'; },
    (v) => { v.binding.request.expectedTrackSha256 = ''; },
  ]) {
    const value = structuredClone(prepared);
    change(value);
    assert.throws(() => validatePrepared(value, spec, context(), expected));
  }
  for (const value of [
    { mode: 'Validate', candidate_run_id: '123' }, { mode: 'Inspect', candidate_run_id: '123' },
    guided(), guided('Validate'), { ...guided('Promote'), expected_track_sha256: trackDigest(emptyTrack()) },
    { ...raw(), release_json: '', release_notes: guided().release_notes, expected_track_sha256: '' },
    { ...raw(), track_state_policy: 'capture-current-simple', expected_track_sha256: '' },
  ]) {
    const request = validateIntent(value);
    const actual = resolved(value);
    const binding = { request, spec: actual, source: identity(), artifactId: 456, bundle: artifact };
    const expected = digest(canonical(binding));
    const prepared = { binding, bindingSha: expected, approval: { approved: true }, context: context() };
    assert.deepEqual(validatePrepared(prepared, validateIntent(value), context(), expected), actual);
    assert.throws(() => validatePrepared(prepared, { ...request, track: 'other' }, context(), expected));
    assert.throws(() => validatePrepared(prepared, { ...request, trackStatePolicy: 'automatic' }, context(), expected));
  }
});

test('guided preparation and approved execution use the original packet and immutable dispatch ledger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recap-play-prepare-'));
  const eventPath = join(root, 'event.json');
  const summaryPath = join(root, 'summary.txt');
  const work = join(root, 'recap-google-play-789-1');
  const savedEnvironment = { ...process.env };
  const original = { fetch: globalThis.fetch, spawn: childProcess.spawnSync, exec: childProcess.execFileSync };
  const fixture = harness();
  const qualified = qualification();
  qualified.approval.policySha256 = protectionPolicy(environment('android-release-candidate'), branches()).sha256;
  const zip = Buffer.from('Synthetic archive transport; extraction and signature subprocesses are mocked.');
  const packetArtifact = { ...githubArtifact(), size_in_bytes: zip.length, digest: `sha256:${digest(zip)}` };
  const entry = (versionCode, sealed = false) => ({ versionCode, productVersion: '3.2.0',
    sourceRevision: source, sourceTree: identity().sourceTree, artifact: sealed ? artifact : null });
  const reservation = { schemaVersion: 1, retiredThrough: 3000002, reservations: [entry(3000003), entry(code)] };
  const sealed = { ...reservation, reservations: [entry(3000003), entry(code, true)] };
  let current = sealed;
  const main = '9'.repeat(40);
  const laterLedger = '8'.repeat(40);
  const githubReads = [];
  const ancestry = [];
  const nativeCalls = [];
  const gitOutput = (args) => {
    if (args[0] === '--no-pager') args = args.slice(1);
    if (args[0] === 'fetch' || ['status', 'ls-files'].includes(args[0])) return '';
    if (args[0] === 'merge-base') {
      ancestry.push(args.slice(2));
      assert.notDeepEqual(args.slice(2), [laterLedger, tooling], 'Do not impose new legacy ledger-to-tooling ancestry');
      return '';
    }
    if (args[0] === 'log') return `${ledger}\n${tooling}\n${main}`;
    if (args[0] === 'rev-parse') {
      if (args[1] === 'HEAD') return tooling;
      if (args[1] === 'refs/remotes/origin/main') return main;
      if (args[1].endsWith('^{tree}')) return identity().sourceTree;
      if (args[1] === `${source}^{commit}`) return source;
    }
    if (args[0] === 'show') {
      if (args[1] === `${source}:package.json`) return JSON.stringify({ version: '3.2.0' });
      if (args[1].endsWith(':packaging/android/version-codes.json')) {
        const revision = args[1].split(':')[0];
        return JSON.stringify(revision === ledger ? reservation : revision === tooling ? sealed : current);
      }
    }
    assert.fail(`Unexpected fixture git read: ${args.join(' ')}`);
  };
  try {
    Object.assign(process.env, { RUNNER_TEMP: root, GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: tooling, GITHUB_WORKFLOW_SHA: tooling, GITHUB_WORKFLOW_REF: context().workflowRef,
      GITHUB_RUN_ID: '789', GITHUB_RUN_ATTEMPT: '1', GITHUB_TOKEN: fixture.token,
      JAVA_HOME_17_X64: join(root, 'fixture-jdk'), GITHUB_OUTPUT: join(root, 'output.txt'),
      GITHUB_STEP_SUMMARY: summaryPath });
    delete process.env.RECAP_PLAY_ACCESS_TOKEN;
    childProcess.execFileSync = (file, args) => {
      assert.equal(file, 'git');
      return gitOutput(args);
    };
    childProcess.spawnSync = (file, args) => {
      nativeCalls.push({ file, args });
      if (file === 'git') return { status: 0, stdout: gitOutput(args) };
      if (file === 'gh') {
        assert.deepEqual(args, ['api', `repos/${REPOSITORY}/actions/artifacts/456/zip`, '--allow-escape-sequences']);
        return { status: 0, stdout: zip };
      }
      assert.equal(basename(file), 'java');
      assert.equal(args[1], 'archive');
      const output = args[4];
      mkdirSync(output, { recursive: true });
      if (args[3] === '-') {
        assert.equal(basename(args[2]), 'candidate-packet.zip');
        writeFileSync(join(output, 'android-artifact.json'), qualified.recordBytes);
        writeFileSync(join(output, 'android-candidate.json'), JSON.stringify(qualified.report));
        writeFileSync(join(output, 'version-codes.proposed.json'), JSON.stringify(sealed));
        writeFileSync(join(output, 'recap-page-android.aab'), bytes);
      } else {
        assert.equal(args[3], signer, 'The actual signature verifier must receive the derived upload signer');
        const assets = join(output, 'base', 'assets', 'recap');
        mkdirSync(assets, { recursive: true });
        writeFileSync(join(assets, 'build-info.json'), JSON.stringify(identity()));
      }
      return { status: 0, stdout: '' };
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, init) => {
      if (new URL(url).origin === 'https://androidpublisher.googleapis.com') return fixture.fetchImpl(url, init);
      const path = new URL(url).pathname + new URL(url).search;
      githubReads.push(path);
      assert.ok(path.startsWith(`/repos/${REPOSITORY}/`));
      let body;
      if (path.endsWith('/actions/runs/789')) body = run();
      else if (path.endsWith('/actions/runs/123')) body = run(true);
      else if (path.endsWith('/actions/runs/123/artifacts?per_page=100')) body = { total_count: 1, artifacts: [packetArtifact] };
      else if (path.endsWith('/actions/artifacts/456')) body = packetArtifact;
      else if (path.endsWith('/deployment-branch-policies?per_page=100')) body = branches();
      else if (path.endsWith('/environments/android-release-candidate')) body = environment('android-release-candidate');
      else if (path.endsWith(`/environments/${ENVIRONMENT}`)) body = environment();
      else if (path.endsWith('/approvals')) body = approvals();
      else assert.fail(`Unexpected fixture GitHub read: ${path}`);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const setInput = (inputs) => writeFile(eventPath, JSON.stringify({ repository: { default_branch: 'main' }, inputs }));
    for (const inputs of [{ mode: 'Validate', candidate_run_id: '123' }, guided('Validate')]) {
      await setInput(inputs);
      const result = await prepare();
      assert.equal(result.publisherPolicy, null);
      assert.equal(result.binding.spec.ledgerSha, tooling);
      assert.equal(result.binding.spec.trackStatePolicy, inputs.release_notes ? 'capture-current-simple' : null);
      assert.equal(fixture.calls.length, 0, 'Validate never contacts Google');
      await rm(work, { recursive: true, force: true });
    }
    await setInput(guided());
    const initial = await prepare();
    assert.equal(initial.binding.spec.sourceSha, source);
    assert.notEqual(initial.binding.spec.sourceSha, tooling);
    assert.equal(initial.binding.spec.ledgerSha, tooling);
    assert.deepEqual(initial.binding.spec.release, release());
    assert.equal(initial.binding.qualificationSha256, digest(Buffer.from(JSON.stringify(qualified.report))));
    assert.equal(fixture.calls.length, 0);
    Object.assign(process.env, { RECAP_PLAY_EXPECTED_ENVIRONMENT_ID: String(initial.publisherPolicy.environmentId),
      RECAP_PLAY_EXPECTED_POLICY_SHA: initial.publisherPolicy.sha256,
      RECAP_PLAY_EXPECTED_BINDING_SHA: initial.bindingSha, RECAP_PLAY_APPROVED_SIGNER: 'e'.repeat(64) });
    current = { ...sealed, reservations: [...sealed.reservations, entry(code + 1)] };
    await rm(work, { recursive: true, force: true });
    await assert.rejects(prepare({ afterApproval: true }), /PROTECTED_SIGNER_MISMATCH/);
    assert.equal(fixture.calls.length, 0);
    process.env.RECAP_PLAY_APPROVED_SIGNER = signer;
    await rm(work, { recursive: true, force: true });
    await setInput({ ...guided(), release_notes: 'Changed while awaiting approval.' });
    await assert.rejects(prepare({ afterApproval: true }), /APPROVED_BINDING_OR_POLICY_CHANGED/);
    await rm(work, { recursive: true, force: true });
    await setInput(guided());
    const approved = await prepare({ afterApproval: true });
    assert.equal(approved.bindingSha, initial.bindingSha, 'Later main reservations must not retarget the selected ledger');
    assert.equal(approved.approval.approved, true);
    process.env.RECAP_PLAY_ACCESS_TOKEN = fixture.token;
    await setInput({ ...guided(), release_notes: 'Changed after approval.' });
    await assert.rejects(publish(), /APPROVED_PREPARATION_REQUIRED/);
    assert.equal(fixture.calls.length, 0);
    await setInput(guided());
    assert.equal((await publish()).state, 'submitted-publication-unverified');
    assert.equal(fixture.calls.length, 9);
    const receipt = JSON.parse(await readFile(join(work, 'google-play-receipt.json'), 'utf8'));
    assert.deepEqual(receipt.targetBefore, emptyTrack());
    assert.equal(receipt.trackStatePolicy, 'capture-current-simple');
    assert.ok(githubReads.some((path) => path.endsWith('/actions/runs/123/artifacts?per_page=100')));
    assert.ok(nativeCalls.filter(({ file }) => basename(file) === 'java').length >= 2);
    assert.match(await readFile(summaryPath, 'utf8'), /no concurrent publisher or pending Console changes/);
    delete process.env.RECAP_PLAY_ACCESS_TOKEN;
    await rm(work, { recursive: true, force: true });
    await setInput({ ...raw('Inspect'), ledger_sha: laterLedger });
    const legacy = await prepare();
    assert.equal(legacy.binding.spec.ledgerSha, laterLedger);
    assert.equal(legacy.binding.spec.trackStatePolicy, null);
    assert.ok(ancestry.some(([from, to]) => from === source && to === laterLedger));
    assert.ok(githubReads.some((path) => path.endsWith('/actions/artifacts/456')));
    assert.equal(fixture.calls.length, 9, 'Legacy preflight remains non-Google');
  } finally {
    globalThis.fetch = original.fetch;
    childProcess.spawnSync = original.spawn;
    childProcess.execFileSync = original.exec;
    syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(savedEnvironment, key)) delete process.env[key];
    Object.assign(process.env, savedEnvironment);
    await rm(root, { recursive: true, force: true });
  }
});

test('attempt evidence is durable before each request and a failed writer prevents the first mutation', async () => {
  const fixture = harness();
  await operation('Publish', fixture);
  for (let index = 0; index < fixture.timeline.length; index += 1) {
    if (fixture.timeline[index].startsWith('request:')) assert.match(fixture.timeline[index - 1], /^receipt:/);
  }
  const blocked = harness();
  await assert.rejects(operation('Publish', { ...blocked, record: async () => { throw new Error('disk unavailable'); } }),
    /disk unavailable/);
  assert.equal(blocked.calls.length, 0);
  assert.ok(new PublisherError('FIXTURE') instanceof Error);
});
