import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishStoreUpdate, formatOutcome, uploadLocation, runRelease } from '../scripts/store-release.mjs';
import { apiFields, verifyPreservedIntent } from '../scripts/check-store-release.mjs';

const product = '9TESTPRODUCT';
const publishedId = '1234567890123456789';
const draftId = '1234567890123456790';
const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${product}`;
const version = '3.1.0.0';
const bundleName = `RecapPage_${version}_x64_arm64.msixbundle`;
const epoch = Date.parse('2026-09-19T00:00:00Z');
const sas = 'https://newingestionaccount.blob.core.windows.net/ingestion/upload?sig=PRIVATE_SAS&se=2099-01-01';

function baseline() {
  return {
    id: publishedId, status: 'Published', statusDetails: { errors: [], warnings: [] },
    pricing: { priceId: 'Free', isAdvancedPricingModel: true },
    listings: { 'en-us': { baseListing: {
      releaseNotes: 'Old notes', description: 'Private listing', images: [{ id: 'image', fileName: 'cover.png' }],
    } }, 'fr-fr': { baseListing: { description: 'Other listing' } } },
    applicationPackages: [{ fileName: 'RecapPage_3.0.0.0_x64_arm64.msixbundle',
      fileStatus: 'Uploaded', version: '3.0.0.0', id: 'old-package', targetPlatform: 'Windows' }],
    targetPublishMode: 'Immediate', targetPublishDate: null,
    packageDeliveryOptions: { isMandatoryUpdate: false, mandatoryUpdateEffectiveDate: '1601-01-01T00:00:00Z',
      packageRollout: { isPackageRollout: false, packageRolloutPercentage: 0,
        packageRolloutStatus: 'PackageRolloutNotStarted', fallbackSubmissionId: '0' } },
    visibility: 'Public', automaticBackupEnabled: false,
    allowTargetFutureDeviceFamilies: { Desktop: true, Mobile: false },
  };
}

function fixture(options = {}) {
  let clock = epoch;
  const calls = [];
  const reports = [];
  const source = baseline();
  let draft;
  let statusIndex = 0;
  let appReads = 0;
  const config = {
    mode: 'Submit', productId: product, version, bundleName,
    notes: { version: '3.1.0', locale: 'en-us', text: '- Better reading.' },
    archive: Buffer.from('qualified ZIP fixture'),
    credentials: { tenantId: 'fixture', clientId: 'PRIVATE_CLIENT', clientSecret: 'PRIVATE_SECRET' },
    ...options.config,
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    const method = init.method;
    calls.push({ method, url, body: init.body, timeoutSignal: init.signal });
    const response = (value, code = 200) => new Response(JSON.stringify(value), { status: code });
    if (options.failure?.(url, init, calls)) throw new Error(`PRIVATE_SECRET ${sas} raw-response`);
    if (url.startsWith('https://login.microsoftonline.com/')) {
      return response({ access_token: 'PRIVATE_TOKEN' });
    }
    if (url === sas) {
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers['x-ms-blob-type'], 'BlockBlob');
      return response(null, options.uploadCode ?? 201);
    }
    assert.equal(init.headers.Authorization, 'Bearer PRIVATE_TOKEN');
    if (url === root) {
      appReads += 1;
      return response({
        id: product,
        lastPublishedApplicationSubmission: { id: publishedId },
        pendingApplicationSubmission: options.pending
          ? { id: 'existing' } : draft ? { id: options.wrongPending && appReads >= 2 ? 'wrong' : draftId } : null,
      });
    }
    if (url === `${root}/submissions/${publishedId}`) {
      return response(source);
    }
    if (url === `${root}/submissions`) {
      assert.equal(method, 'POST');
      draft = { ...structuredClone(source), id: draftId, status: 'PendingCommit', fileUploadUrl: sas };
      options.created?.(draft);
      return response(draft, options.createCode ?? 201);
    }
    if (url === `${root}/submissions/${draftId}`) {
      if (method === 'PUT') {
        draft = JSON.parse(init.body);
        options.readback?.(draft);
      }
      return response(draft, method === 'PUT' ? options.updateCode ?? 200 : 200);
    }
    if (url === `${root}/submissions/${draftId}/commit`) {
      assert.equal(method, 'POST');
      assert.equal(init.body, undefined);
      if (options.commitRaw) return new Response(options.commitRaw, { status: 200 });
      return response(options.commitBody ?? { status: 'CommitStarted' }, options.commitCode ?? 202);
    }
    if (url === `${root}/submissions/${draftId}/status`) {
      assert.equal(method, 'GET');
      const statuses = options.statuses ?? ['CommitStarted', 'PreProcessing'];
      const status = statuses[Math.min(statusIndex++, statuses.length - 1)];
      if (status !== 'CommitStarted' && !options.noIngestion) {
        draft.applicationPackages[1].version = version;
        draft.applicationPackages[1].fileStatus = 'Uploaded';
        options.ingested?.(draft);
      }
      return response(typeof status === 'string'
        ? { status, statusDetails: { errors: [] } } : status, options.statusCode ?? 200);
    }
    assert.fail('Unexpected endpoint');
  };
  return { calls, reports, config, fetchImpl,
    run: () => publishStoreUpdate(config, {
      fetchImpl, now: () => clock, wait: async (ms) => { clock += ms; },
      report: (value) => reports.push(value),
    }),
    mutations: () => calls.filter((call) => call.method !== 'GET' &&
      !call.url.startsWith('https://login.microsoftonline.com/')).map((call) =>
      call.url === sas ? 'upload' : call.url.endsWith('/commit') ? 'commit' : call.method),
    elapsed: () => clock - epoch,
  };
}

test('production flow accepts create201 and commit202, uploads and commits exactly once, then observes ingestion', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, { state: 'processing', stage: 'status', submissionId: draftId,
    status: 'PreProcessing', commit: 'acknowledged', package: 'verified',
    notes: 'verified', intent: 'verified',
    notesSha256: createHash('sha256').update(f.config.notes.text).digest('hex') });
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/status')).length, 2);
  assert.equal(f.reports[0].state, 'acknowledged');
  assert.doesNotMatch(f.reports.map(formatOutcome).join(''), /PRIVATE|blob\.core|listing/);
});

test('production flow accepts documented irrelevant date and server-managed readback normalization', async () => {
  const f = fixture({ readback: (draft) => {
    draft.targetPublishDate = '1601-01-01T00:00:00Z';
    draft.statusDetails.warnings = [{ description: 'PRIVATE warning' }];
    draft.fileUploadUrl = 'PRIVATE rotated SAS';
    draft.friendlyName = 'Server generated label';
    draft.pricing.isAdvancedPricingModel = false;
    draft.packageDeliveryOptions.packageRollout.packageRolloutPercentage = 100;
    draft.packageDeliveryOptions.packageRollout.fallbackSubmissionId = '1234';
    draft.packageDeliveryOptions.mandatoryUpdateEffectiveDate = '1601-01-01T00:00:00.0000000Z';
    draft.applicationPackages[1].id = 'generated';
    draft.applicationPackages[1].version = version;
    draft.applicationPackages[1].architecture = 'Neutral';
    draft.applicationPackages[1].minimumSystemRam = null;
  } });
  assert.equal((await f.run()).state, 'processing');
  assert.equal(f.mutations().filter((method) => method === 'commit').length, 1);
});

test('production readback blocks unrelated settings, missing notes, wrong ID and erroneous drafts before commit', async () => {
  for (const mutate of [
    (d) => { d.listings['en-us'].baseListing.description = 'Changed'; },
    (d) => { d.listings['fr-fr'].baseListing.description = 'Changed'; },
    (d) => { d.listings['en-us'].baseListing.images = []; },
    (d) => { d.pricing.priceId = 'Paid'; },
    (d) => { d.visibility = 'Hidden'; },
    (d) => { d.automaticBackupEnabled = true; },
    (d) => { delete d.allowTargetFutureDeviceFamilies.Mobile; },
    (d) => { d.packageDeliveryOptions.isMandatoryUpdate = true; },
    (d) => { d.packageDeliveryOptions.mandatoryUpdateEffectiveDate = '2027-01-01T00:00:00Z'; },
    (d) => { d.packageDeliveryOptions.packageRollout.isPackageRollout = true; },
    (d) => { d.targetPublishMode = 'Manual'; },
    (d) => { d.id = 'wrong'; },
    (d) => { d.listings['en-us'].baseListing.releaseNotes = 'Old notes'; },
    (d) => { delete d.listings['en-us'].baseListing.releaseNotes; },
    (d) => { d.applicationPackages[0].fileName = 'wrong.msixbundle'; },
    (d) => { d.applicationPackages.push({ fileName: 'extra.appx', fileStatus: 'Uploaded' }); },
    (d) => { d.status = 'Certification'; },
    (d) => { d.statusDetails.errors.push({ description: 'PRIVATE error' }); },
  ]) {
    const f = fixture({ readback: mutate });
    assert.equal((await f.run()).state, 'failed');
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT']);
  }
});

test('normal publisher shares the narrow deleted-bundle targetPlatform readback correction', async () => {
  const f = fixture({ readback: (draft) => { delete draft.applicationPackages[0].targetPlatform; } });
  assert.equal((await f.run()).state, 'processing');
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
});

test('invalid notes, stale version and pending submission stop before creation', async () => {
  for (const options of [
    { config: { notes: undefined } }, { config: { notes: {} } },
    { config: { notes: { version: '3.0.0', locale: 'en-us', text: '- Wrong version' } } },
    { config: { version: '3.0.0.0', bundleName: 'RecapPage_3.0.0.0_x64_arm64.msixbundle',
      notes: { version: '3.0.0', locale: 'en-us', text: '- Old version' } } },
    { pending: true },
  ]) {
    const f = fixture(options);
    assert.equal((await f.run()).state, 'failed');
    assert.deepEqual(f.mutations(), []);
  }
});

test('publisher readback failure names the exact contract and safe semantic path without another mutation', async () => {
  const f = fixture({ readback: (draft) => { draft.listings['en-us'].baseListing.description = null; } });
  const result = await f.run();
  assert.equal(result.failureCode, 'READBACK_INTENT');
  assert.equal(result.readback.checks.find((check) => check.checkId === 'READBACK_DRAFT').result, 'pass');
  assert.ok(result.readback.semantic.differences.some((entry) =>
    entry.path === '/listings/en-us/baseListing/description'
    && entry.before.type === 'string' && entry.after.type === 'null'));
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT']);
  assert.doesNotMatch(formatOutcome(result), /PRIVATE|blob\.core|Private listing/);
});

test('created copy drift and wrong pending identity stop before upload', async () => {
  for (const options of [
    { wrongPending: true },
    { created: (d) => { d.visibility = 'Hidden'; } },
    { created: (d) => { d.id = publishedId; } },
    { created: (d) => { d.id = 'bad\n::warning::PRIVATE'; } },
    { created: (d) => { d.fileUploadUrl = 'http://untrusted.invalid/?PRIVATE'; } },
  ]) {
    const f = fixture(options);
    const outcome = await f.run();
    assert.equal(outcome.state, 'failed');
    assert.deepEqual(f.mutations(), ['POST']);
    assert.doesNotMatch(formatOutcome(outcome), /PRIVATE|untrusted|::warning::/);
  }
});

test('production read-only rehearsal never creates, uploads, updates, commits or polls', async () => {
  const f = fixture({ config: { mode: 'Validate', archive: undefined } });
  assert.equal((await f.run()).state, 'validated');
  assert.deepEqual(f.mutations(), []);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/status')).length, 0);
});

test('only endpoint-specific HTTP successes with valid bodies advance the production flow', async () => {
  const ok = fixture({ createCode: 200, commitCode: 200 });
  assert.equal((await ok.run()).state, 'processing');
  for (const options of [
    { createCode: 202 }, { uploadCode: 200 }, { updateCode: 201 }, { updateCode: 202 },
    { commitCode: 201 }, { commitCode: 203 }, { commitCode: 409 }, { commitCode: 500 },
    { commitBody: {} }, { commitBody: { status: 'PendingCommit' } }, { commitRaw: 'PRIVATE not JSON' },
  ]) {
    const f = fixture(options);
    assert.equal((await f.run()).state, 'failed');
    assert.ok(f.mutations().filter((method) => method === 'commit').length <= 1);
  }
});

test('ambiguous commit and status transport failure never retry a mutation and retain safe identity', async () => {
  for (const suffix of ['/commit', '/status']) {
    const f = fixture({ failure: (url) => url.endsWith(suffix) });
    const result = await f.run();
    assert.equal(result.state, suffix === '/commit' ? 'failed' : 'verification-pending');
    if (suffix === '/status') assert.equal(result.status, 'CommitStarted');
    assert.equal(result.submissionId, draftId);
    assert.equal(result.commit, suffix === '/commit' ? 'attempted' : 'acknowledged');
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
    assert.doesNotMatch(formatOutcome(result), /PRIVATE|raw-response|blob\.core/);
  }
});

test('every pre-commit transport failure stops at that request without retry', async () => {
  for (const [match, mutations] of [
    [(url, init) => url === `${root}/submissions` && init.method === 'POST', ['POST']],
    [(url) => url === sas, ['POST', 'upload']],
    [(url, init) => url.endsWith(draftId) && init.method === 'PUT', ['POST', 'upload', 'PUT']],
    [(url, init) => url.endsWith(draftId) && init.method === 'GET', ['POST', 'upload', 'PUT']],
  ]) {
    const f = fixture({ failure: match });
    assert.equal((await f.run()).state, 'failed');
    assert.deepEqual(f.mutations(), mutations);
  }
});

test('bounded observation retains acknowledgement but reports incomplete verification after five minutes', async () => {
  const f = fixture({ statuses: ['CommitStarted'] });
  const result = await f.run();
  assert.equal(result.state, 'verification-pending');
  assert.equal(result.status, 'CommitStarted');
  assert.equal(result.failureCode, 'POSTCOMMIT_DEADLINE');
  assert.equal(f.elapsed(), 300000);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/status')).length, 20);
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
  assert.match(formatOutcome(result), /Publication is not verified/);
});

test('processing, certification and publication states remain distinct from failures', async () => {
  for (const [status, state] of [
    ['PreProcessing', 'processing'], ['Certification', 'certification'],
    ['PendingPublication', 'publication-pending'], ['Publishing', 'publication-pending'],
    ['Release', 'publication-pending'], ['Published', 'published'],
    ['None', 'verification-pending'], ['PendingCommit', 'verification-pending'],
    ...['Canceled', 'CommitFailed', 'PreProcessingFailed',
      'CertificationFailed', 'PublishFailed', 'ReleaseFailed'].map((status) => [status, 'failed']),
  ]) {
    const f = fixture({ statuses: [status] });
    const result = await f.run();
    assert.equal(result.state, state);
    assert.equal(result.status, status);
    if (state === 'failed') assert.equal(result.failureCode, 'STORE_PROCESSING_FAILED');
    assert.equal(f.elapsed(), 0);
  }
  for (const [status, state] of [
    [{ status: 'Published', statusDetails: { errors: [{ description: 'PRIVATE' }] } }, 'failed'],
    [{ status: 'PRIVATE unexpected', statusDetails: { errors: [] } }, 'verification-pending'],
  ]) {
    const result = await fixture({ statuses: [status] }).run();
    assert.equal(result.state, state);
    assert.doesNotMatch(formatOutcome(result), /PRIVATE/);
  }
});

test('certification remains pending within the deadline until package ingestion is verifiable', async () => {
  const f = fixture({ statuses: ['Certification'], noIngestion: true });
  const result = await f.run();
  assert.equal(result.state, 'verification-pending');
  assert.equal(result.status, 'Certification');
  assert.equal(result.failureCode, 'POSTCOMMIT_DEADLINE');
  assert.equal(result.package, 'pending');
  assert.equal(f.elapsed(), 300000);
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
});

test('post-commit ingestion verifies the actual version and approved notes without resubmission', async () => {
  for (const mutate of [
    (d) => { d.applicationPackages[1].version = '2.1.0.0'; },
    (d) => { d.listings['en-us'].baseListing.releaseNotes = 'Old notes'; },
    (d) => { d.applicationPackages[1].fileName = 'old.msixbundle'; },
  ]) {
    const f = fixture({ ingested: mutate, statuses: ['Certification'] });
    assert.equal((await f.run()).state, 'verification-pending');
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
  }
});

test('postcommit local verification keeps independent package and notes proofs without accepting editable drift', async () => {
  for (const [status, mutate] of [
    ['PreProcessing', (d) => { delete d.allowTargetFutureDeviceFamilies.Mobile; }],
    ['Certification', (d) => { delete d.allowTargetFutureDeviceFamilies.Mobile; }],
    ['Certification', (d) => { d.allowTargetFutureDeviceFamilies.Mobile = true; }],
    ['Published', (d) => { d.visibility = 'Hidden'; }],
  ]) {
    const f = fixture({ statuses: [status], ingested: mutate });
    const result = await f.run();
    assert.equal(result.state, 'verification-pending');
    assert.equal(result.status, status);
    assert.equal(result.commit, 'acknowledged');
    assert.equal(result.package, 'verified');
    assert.equal(result.notes, 'verified');
    assert.equal(result.intent, 'review-required');
    assert.equal(result.stage, 'ingestion-intent');
    assert.equal(result.failureCode, 'POSTCOMMIT_INTENT');
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
    assert.match(formatOutcome(result), /Local verification is blocked.*not a confirmed Store rejection/);
    assert.doesNotMatch(formatOutcome(result), /Store reports Published|PRIVATE|blob\.core|Mobile/);
  }
  const notes = await fixture({ statuses: ['Published'],
    ingested: (d) => { d.listings['en-us'].baseListing.releaseNotes = 'PRIVATE changed'; } }).run();
  assert.equal(notes.state, 'verification-pending');
  assert.equal(notes.package, 'verified');
  assert.equal(notes.notes, 'review-required');
  assert.equal(notes.intent, 'review-required');
  assert.equal(notes.failureCode, 'POSTCOMMIT_NOTES');
  const pkg = await fixture({ statuses: ['Published'],
    ingested: (d) => { d.applicationPackages[1].version = '2.1.0.0'; } }).run();
  assert.equal(pkg.state, 'verification-pending');
  assert.equal(pkg.package, 'review-required');
  assert.equal(pkg.notes, 'verified');
  assert.equal(pkg.intent, 'verified');
  assert.equal(pkg.failureCode, 'POSTCOMMIT_PACKAGE');
});

test('malformed and unavailable observations retain the last valid publisher lifecycle status', async () => {
  for (const options of [
    { statusCode: 202 },
    { statuses: [{ status: 'PreProcessing' }] },
    { statuses: ['Certification', { status: 'PRIVATE unknown', statusDetails: { errors: [] } }] },
    { statuses: ['Certification', { status: 'Published', statusDetails: {} }] },
    { statuses: ['Certification'], failure: (url, init, calls) =>
      url.endsWith('/status') && calls.filter((entry) => entry.url.endsWith('/status')).length === 2 },
  ]) {
    const f = fixture({ ...options, noIngestion: true });
    const result = await f.run();
    assert.equal(result.state, 'verification-pending');
    assert.equal(result.status, f.calls.filter((entry) => entry.url.endsWith('/status')).length === 2
      ? 'Certification' : 'CommitStarted');
    assert.equal(result.stage, 'status');
    assert.equal(result.failureCode, 'POSTCOMMIT_STATUS');
    assert.equal(result.commit, 'acknowledged');
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
    assert.doesNotMatch(formatOutcome(result), /PRIVATE|raw-response|blob\.core/);
  }
  const published = await fixture({ statuses: ['Published'], noIngestion: true }).run();
  assert.equal(published.state, 'verification-pending');
  assert.equal(published.status, 'Published');
  assert.equal(published.failureCode, 'POSTCOMMIT_INGESTION_PACKAGE');
  for (const ingested of [
    (d) => { d.id = 'PRIVATE wrong'; },
    (d) => { d.applicationPackages = null; },
  ]) {
    const result = await fixture({ statuses: ['Certification'], ingested }).run();
    assert.equal(result.state, 'verification-pending');
    assert.equal(result.status, 'Certification');
    assert.notEqual(result.package, 'verified');
  }
});

test('publisher CLI exits nonzero for local verification blockers and zero for fully verified ingestion', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-store-observer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const notes = join(directory, 'notes.json');
  const archive = join(directory, 'bundle.zip');
  const output = [];
  t.mock.method(process.stdout, 'write', (text) => { output.push(text); return true; });
  for (const [ingested, exitCode] of [
    [(d) => { delete d.allowTargetFutureDeviceFamilies.Mobile; }, 1],
    [undefined, 0],
  ]) {
    const f = fixture({ statuses: ['Certification'], ingested });
    writeFileSync(notes, JSON.stringify(f.config.notes));
    writeFileSync(archive, f.config.archive);
    t.mock.method(globalThis, 'fetch', f.fetchImpl);
    assert.equal(await runRelease(['Submit', product, bundleName, version, notes, archive], {
      PARTNER_CENTER_TENANT_ID: 'fixture', PARTNER_CENTER_CLIENT_ID: 'PRIVATE_CLIENT',
      PARTNER_CENTER_CLIENT_SECRET: 'PRIVATE_SECRET',
    }), exitCode);
    assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
  }
  assert.match(output.join(''), /verification-pending.*status: Certification; commit: acknowledged/);
  assert.match(output.join(''), /Local verification is blocked/);
  assert.doesNotMatch(output.join(''), /PRIVATE|blob\.core/);
});

test('signed upload location is host-independent but never permits redirects, arbitrary hosts or expired SAS', () => {
  assert.equal(uploadLocation(sas, epoch), sas);
  for (const url of [
    sas.replace('https:', 'http:'), sas.replace('.net/', '.net.evil.invalid/'),
    sas.replace('newingestionaccount', 'user@newingestionaccount'),
    sas.replace('/ingestion/', '/other/'), sas.replace('2099-01-01', '2026-09-19'),
    sas.replace('sig=', 'missing='), `${sas}#fragment`, `${sas}&sig=duplicate`,
    sas.replace('.net/', '.net:8443/'),
  ]) assert.throws(() => uploadLocation(url, epoch));
});

test('metadata comparison protects dictionary keys and rejects ambiguous API casing', () => {
  assert.deepEqual(apiFields({ Listings: { 'en-us': { BaseListing: { ReleaseNotes: 'Notes' } } } }),
    { listings: { 'en-us': { baseListing: { releaseNotes: 'Notes' } } } });
  assert.throws(() => apiFields({ Id: 'one', id: 'two' }), /Ambiguous/);
  const changed = baseline();
  changed.allowTargetFutureDeviceFamilies = { desktop: true };
  assert.throws(() => verifyPreservedIntent(changed, baseline()), /settings changed/);
});

test('CLI returns failure and writes a safe actionable summary for missing or invalid note files', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-store-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const summary = join(directory, 'summary.txt');
  const notes = join(directory, 'notes.json');
  const output = [];
  t.mock.method(process.stdout, 'write', (text) => { output.push(text); return true; });
  for (const text of [undefined, 'PRIVATE malformed JSON', '{}']) {
    if (text !== undefined) writeFileSync(notes, text);
    assert.equal(await runRelease(['Validate', product, bundleName, version, notes, 'unused'],
      { GITHUB_STEP_SUMMARY: summary }), 1);
  }
  assert.match(readFileSync(summary, 'utf8'), /Inspect this submission/);
  assert.doesNotMatch(output.join(''), /PRIVATE/);
});

test('PowerShell entry point invokes the production CLI and cleans its archive after local rejection',
  { skip: process.platform !== 'win32' }, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'recap-store-wrapper-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bundle = join(directory, bundleName);
    const notes = join(directory, 'notes.json');
    const summary = join(directory, 'summary.txt');
    writeFileSync(bundle, 'synthetic package; never upload');
    writeFileSync(notes, '{}');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-File',
      fileURLToPath(new URL('../scripts/publish-store-update.ps1', import.meta.url)),
      '-Mode', 'Submit', '-ProductId', product, '-BundlePath', bundle,
      '-ExpectedVersion', version, '-ReleaseNotesPath', notes, '-WorkDirectory', directory], {
      encoding: 'utf8', timeout: 30000, env: { ...process.env, GITHUB_STEP_SUMMARY: summary,
        PARTNER_CENTER_CLIENT_ID: '', PARTNER_CENTER_CLIENT_SECRET: '', PARTNER_CENTER_TENANT_ID: '' },
    });
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stdout, /stage: preflight/);
    assert.match(readFileSync(summary, 'utf8'), /No automatic retry was performed/);
    assert.throws(() => readFileSync(join(directory, 'store-upload.zip')), { code: 'ENOENT' });
  });

test('summary write failure after commit preserves the acknowledged submission and never retries', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-store-summary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture({ statuses: ['PreProcessing'] });
  const notes = join(directory, 'notes.json');
  const archive = join(directory, 'bundle.zip');
  writeFileSync(notes, JSON.stringify(f.config.notes));
  writeFileSync(archive, f.config.archive);
  const output = [];
  t.mock.method(globalThis, 'fetch', f.fetchImpl);
  t.mock.method(process.stdout, 'write', (text) => { output.push(text); return true; });
  t.mock.method(process.stderr, 'write', (text) => { output.push(text); return true; });
  assert.equal(await runRelease(['Submit', product, bundleName, version, notes, archive], {
    PARTNER_CENTER_TENANT_ID: 'fixture', PARTNER_CENTER_CLIENT_ID: 'PRIVATE_CLIENT',
    PARTNER_CENTER_CLIENT_SECRET: 'PRIVATE_SECRET',
    GITHUB_STEP_SUMMARY: join(directory, 'missing-directory', 'summary.txt'),
  }), 1);
  assert.deepEqual(f.mutations(), ['POST', 'upload', 'PUT', 'commit']);
  assert.match(output.join(''), new RegExp(`submission: ${draftId}; status: CommitStarted; commit: acknowledged`));
  assert.match(output.join(''), /outcome reporting failed/);
  assert.doesNotMatch(output.join(''), /commit: not-attempted|stage: local-input|PRIVATE|missing-directory/);
});
