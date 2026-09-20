import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commitStoreUpdate, runCommitOnly, loadCommitConfiguration } from '../scripts/commit-store-update.mjs';
import { prepareApiDraft } from '../scripts/check-store-release.mjs';
import { sha256 } from '../scripts/store-readback.mjs';
import { archive, payload, bundleName } from './support/store-zip.mjs';

function fixture() {
  let clock = Date.parse('2026-09-20T00:00:00Z');
  const start = clock;
  const zip = archive();
  const config = {
    productId: '9TESTPRODUCT', pendingId: '1234567892', publishedId: '1234567891',
    version: '3.1.0.0', applicationVersion: '3.1.0', releaseTag: 'v3.1.0',
    sourceSha: 'a'.repeat(40), actualSourceSha: 'a'.repeat(40), tagSha: 'a'.repeat(40),
    toolingSha: 'b'.repeat(40), sourceOnMain: true, bundleName,
    bundleSha256: sha256(payload), currentZipSha256: sha256(zip),
    notes: { version: '3.1.0', locale: 'en-us', text: '- Approved notes.' },
    release: { draft: false, prerelease: false, tag_name: 'v3.1.0' },
    credentials: { tenantId: 'tenant', clientId: 'PRIVATE_CLIENT', clientSecret: 'PRIVATE_SECRET' },
    readUploadedBundle: true, commitApproved: true, runAttempt: '1',
  };
  config.notesSha256 = sha256(config.notes.text);
  const published = {
    id: config.publishedId, status: 'Published', statusDetails: { errors: [], warnings: [] },
    pricing: { priceId: 'Free', isAdvancedPricingModel: true },
    listings: { 'en-us': { baseListing: { releaseNotes: 'Old notes', description: 'PRIVATE_DESCRIPTION',
      images: [{ id: 'image', fileName: 'PRIVATE_IMAGE.png' }] } } },
    applicationPackages: [{ id: 'old', fileName: 'old.msixbundle', fileStatus: 'Uploaded',
      version: '3.0.0.0', targetPlatform: 'PRIVATE_PLATFORM' }],
    targetPublishMode: 'Immediate', targetPublishDate: null,
    packageDeliveryOptions: { isMandatoryUpdate: false, mandatoryUpdateEffectiveDate: '1601-01-01T00:00:00Z',
      packageRollout: { isPackageRollout: false, packageRolloutPercentage: 0, fallbackSubmissionId: '0' } },
    visibility: 'Public', automaticBackupEnabled: false,
  };
  const pending = prepareApiDraft({ ...published, id: config.pendingId, status: 'PendingCommit' },
    bundleName, config.pendingId, config.notes, config.version);
  delete pending.applicationPackages[0].targetPlatform;
  const sas = 'https://fixture.blob.core.windows.net/ingestion/PRIVATE_PATH?sig=PRIVATE_SAS&se=2099-01-01';
  pending.fileUploadUrl = sas;
  const app = { id: config.productId, lastPublishedApplicationSubmission: { id: config.publishedId },
    pendingApplicationSubmission: { id: config.pendingId } };
  const status = { status: 'PendingCommit', statusDetails: { errors: [], warnings: [] } };
  const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${config.productId}`;
  const draftUrl = `${root}/submissions/${config.pendingId}`;
  const publishedUrl = `${root}/submissions/${config.publishedId}`;
  const calls = [];
  const reports = [];
  const counts = new Map();
  let committed = false;
  const f = { config, published, pending, app, status, zip, sas, root, draftUrl, publishedUrl, calls, reports };
  f.now = () => clock;
  f.wait = async (ms) => { clock += ms; };
  f.fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    calls.push({ url, method: init.method });
    counts.set(url, (counts.get(url) ?? 0) + 1);
    const count = counts.get(url);
    let value;
    let code = 200;
    if (url.startsWith('https://login.microsoftonline.com/')) {
      assert.equal(init.method, 'POST');
      value = { access_token: 'PRIVATE_TOKEN' };
    } else if (url === sas) {
      assert.equal(init.method, 'GET');
      assert.equal(init.headers, undefined);
      assert.equal(init.body, undefined);
      const response = f.respond?.(url, init, null, count);
      return response ?? new Response(zip);
    } else {
      assert.equal(init.headers.Authorization, 'Bearer PRIVATE_TOKEN');
      assert.equal(init.body, undefined);
      if (url === `${draftUrl}/commit`) {
        assert.equal(init.method, 'POST');
        assert.equal(committed, false);
        committed = true;
        value = { status: 'CommitStarted' };
        code = f.commitCode ?? 202;
      } else {
        assert.equal(init.method, 'GET');
        if (url === root) value = count === 2 && f.finalApp ? f.finalApp : app;
        else if (url === publishedUrl) value = count === 2 && f.finalPublished ? f.finalPublished : published;
        else if (url === draftUrl) {
          value = structuredClone(count === 2 && f.finalPending ? f.finalPending : pending);
          if (committed && !f.noIngestion) {
            value.applicationPackages[1].version = config.version;
            value.applicationPackages[1].fileStatus = 'Uploaded';
            f.ingested?.(value);
          }
        } else if (url === `${draftUrl}/status`) {
          value = committed
            ? { status: f.processingStatus ?? 'Certification', statusDetails: { errors: [] } }
            : count === 2 && f.finalStatus ? f.finalStatus : status;
        } else assert.fail('Unexpected Store endpoint');
      }
    }
    return f.respond?.(url, init, value, count) ?? new Response(JSON.stringify(value), { status: code });
  };
  f.run = () => commitStoreUpdate(config, { fetchImpl: f.fetchImpl, now: f.now, wait: f.wait,
    report: (value) => reports.push(value) });
  f.mutations = () => calls.filter((call) => call.method !== 'GET'
    && !call.url.startsWith('https://login.microsoftonline.com/'));
  f.elapsed = () => clock - start;
  return f;
}

test('actual commit-only transport proves remote bytes and current intent, commits once on 200/202, then observes ingestion', async () => {
  for (const code of [200, 202]) {
    const f = fixture();
    f.commitCode = code;
    const result = await f.run();
    assert.equal(result.state, 'certification');
    assert.equal(result.status, 'Certification');
    assert.equal(result.package, 'verified');
    assert.equal(result.notes, 'verified');
    assert.equal(result.commitAttempted, true);
    assert.equal(result.commit, 'acknowledged');
    assert.equal(result.submissionId, f.config.pendingId);
    assert.equal(result.uploadRead.currentZipSha256, f.config.currentZipSha256);
    assert.equal(result.uploadRead.bundleSha256, f.config.bundleSha256);
    assert.equal(result.uploadRead.bundleSize, payload.length);
    assert.equal(result.originalUploadZipSha256, 'UNRECORDED');
    assert.equal(result.historicalSnapshots, 'UNAVAILABLE_NOT_RECONSTRUCTED');
    assert.equal(result.authorization, 'CURRENT_PUBLISHED_PLUS_APPROVED_NOTES_AND_PACKAGE_EDIT');
    assert.deepEqual(f.mutations(), [{ url: `${f.draftUrl}/commit`, method: 'POST' }]);
    assert.deepEqual(f.calls.slice(1, 11).map((entry) => entry.url), [
      f.root, f.publishedUrl, f.draftUrl, `${f.draftUrl}/status`, f.sas,
      f.root, f.publishedUrl, f.draftUrl, `${f.draftUrl}/status`, `${f.draftUrl}/commit`,
    ]);
    assert.equal(f.reports[0].status, 'CommitStarted');
    assert.ok(result.checks.every((entry) => entry.result === 'pass'));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|blob\.core|access_token|fileUploadUrl/);
  }
});

test('commit-only local binding and explicit approval blockers send no requests', async () => {
  for (const mutate of [
    (c) => { c.runAttempt = '2'; }, (c) => { delete c.runAttempt; },
    (c) => { c.commitApproved = false; }, (c) => { c.commitApproved = 'true'; },
    (c) => { c.readUploadedBundle = false; }, (c) => { c.currentZipSha256 = 'bad'; },
    (c) => { c.pendingId = c.publishedId; }, (c) => { c.pendingId = 'bad/PRIVATE'; },
    (c) => { c.publishedId = ''; }, (c) => { c.productId = '../PRIVATE'; },
    (c) => { c.actualSourceSha = 'd'.repeat(40); }, (c) => { c.tagSha = 'd'.repeat(40); },
    (c) => { c.sourceOnMain = false; }, (c) => { c.toolingSha = 'bad'; },
    (c) => { c.version = '3.2.0.0'; }, (c) => { c.bundleName = 'wrong.msixbundle'; },
    (c) => { c.releaseTag = 'v3.2.0'; }, (c) => { c.release.draft = true; },
    (c) => { c.release.prerelease = true; }, (c) => { c.notes = undefined; },
    (c) => { c.notes.version = '3.0.0'; }, (c) => { c.notes.locale = 'fr-fr'; },
    (c) => { c.notes.text = '- Changed'; }, (c) => { c.notesSha256 = 'bad'; },
    (c) => { c.bundleSha256 = 'bad'; }, (c) => { c.credentials.clientSecret = ''; },
  ]) {
    const f = fixture();
    mutate(f.config);
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.commitAttempted, false);
    assert.equal(f.calls.length, 0);
  }
});

test('current metadata blockers preserve ID and stop without any Store mutation', async () => {
  for (const mutate of [
    (f) => { f.app.id = 'wrong'; },
    (f) => { f.app.pendingApplicationSubmission.id = 'wrong'; },
    (f) => { f.app.lastPublishedApplicationSubmission.id = 'wrong'; },
    (f) => { f.published.id = 'wrong'; },
    (f) => { f.published.status = 'PendingCommit'; },
    (f) => { f.published.applicationPackages[0].version = f.config.version; },
    (f) => { f.published.pricing.priceId = 'Paid'; },
    (f) => { f.pending.id = 'wrong'; },
    (f) => { f.pending.status = 'CommitStarted'; },
    (f) => { f.pending.statusDetails.errors.push({ description: 'PRIVATE' }); },
    (f) => { f.pending.pricing.priceId = 'Paid'; },
    (f) => { f.pending.targetPublishMode = 'Manual'; },
    (f) => { delete f.pending.targetPublishDate; },
    (f) => { f.pending.packageDeliveryOptions.packageRollout.isPackageRollout = true; },
    (f) => { f.pending.applicationPackages[0].fileStatus = 'Uploaded'; },
    (f) => { f.pending.applicationPackages[0].targetPlatform = null; },
    (f) => { f.pending.applicationPackages[0].targetPlatform = 'Different'; },
    (f) => { f.pending.applicationPackages[1].fileStatus = 'Uploaded'; },
    (f) => { f.pending.applicationPackages[1].version = '2.1.0.0'; },
    (f) => { delete f.pending.listings['en-us'].baseListing.releaseNotes; },
    (f) => { f.pending.listings['en-us'].baseListing.description = 'Changed'; },
    (f) => { f.status.status = 'Certification'; },
    (f) => { delete f.status.statusDetails.errors; },
  ]) {
    const f = fixture();
    mutate(f);
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.submissionId, f.config.pendingId);
    assert.equal(result.commitAttempted, false);
    assert.deepEqual(f.mutations(), []);
    assert.equal(f.calls.some((call) => call.url === f.sas), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|blob\.core/);
  }
});

test('remote ZIP drift, corrupt CRC, wrong inner hash and unreadable upload never permit commit', async () => {
  for (const mutate of [
    (f) => { f.config.currentZipSha256 = 'f'.repeat(64); },
    (f) => { f.config.bundleSha256 = 'f'.repeat(64); },
    (f) => { f.zip[30 + Buffer.byteLength(bundleName)] ^= 1; },
    (f) => { f.pending.fileUploadUrl = 'https://untrusted.invalid/PRIVATE'; },
    (f) => { f.respond = (url) => url === f.sas ? new Response('PRIVATE', { status: 403 }) : undefined; },
    (f) => { f.respond = (url) => url === f.sas ? new Response(archive({ filename: '../wrong.msixbundle' })) : undefined; },
  ]) {
    const f = fixture();
    mutate(f);
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.stage, 'uploaded-bundle-proof');
    assert.equal(result.commitAttempted, false);
    assert.deepEqual(f.mutations(), []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|untrusted|Bearer|blob\.core/);
  }
});

test('changed pending intent after blob proof blocks commit even when current expected-update comparison permits derived metadata', async () => {
  const f = fixture();
  f.finalPending = structuredClone(f.pending);
  f.finalPending.applicationPackages[1].architecture = 'Neutral';
  const result = await f.run();
  assert.equal(result.failureCode, 'PENDING_INTENT_UNCHANGED');
  assert.equal(result.uploadRead.state, 'verified');
  assert.deepEqual(f.mutations(), []);
});

test('final application, published, pending notes/settings/upload and status rechecks block stale authorization', async () => {
  for (const mutate of [
    (f) => { f.finalApp.pendingApplicationSubmission = null; },
    (f) => { f.finalApp.lastPublishedApplicationSubmission.id = 'different'; },
    (f) => { f.finalPublished.visibility = f.finalPending.visibility = 'Hidden'; },
    (f) => { f.finalPending.listings['en-us'].baseListing.releaseNotes = 'Changed'; },
    (f) => { f.finalPending.packageDeliveryOptions.isMandatoryUpdate = true; },
    (f) => { f.finalPending.fileUploadUrl += '&changed=true'; },
    (f) => { f.finalPending.status = 'CommitStarted'; },
    (f) => { f.finalStatus.status = 'CommitStarted'; },
    (f) => { f.finalStatus.statusDetails.errors.push({ code: 'PRIVATE' }); },
  ]) {
    const f = fixture();
    for (const [key, value] of Object.entries({ finalApp: f.app, finalPublished: f.published,
      finalPending: f.pending, finalStatus: f.status })) f[key] = structuredClone(value);
    mutate(f);
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.uploadRead.state, 'verified');
    assert.equal(result.commitAttempted, false);
    assert.deepEqual(f.mutations(), []);
  }
});

test('each precommit HTTP stage stops once on failure with a safe phase and validated pending ID', async () => {
  for (let failAt = 1; failAt <= 10; failAt++) {
    const f = fixture();
    f.respond = () => {
      if (f.calls.length === failAt) throw new Error('PRIVATE raw-response');
    };
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.submissionId, f.config.pendingId);
    assert.equal(result.commitAttempted, false);
    assert.equal(f.calls.length, failAt);
    assert.deepEqual(f.mutations(), []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|raw-response/);
  }
});

test('ambiguous or invalid commit response retains the attempt and ID, with no retry or status GET', async () => {
  for (const response of [
    () => { throw new Error('PRIVATE ambiguous'); },
    () => new Response('PRIVATE malformed'),
    () => new Response(JSON.stringify({ status: 'CommitStarted' }), { status: 201 }),
    () => new Response(JSON.stringify({ status: 'CommitStarted' }), { status: 500 }),
    () => new Response(JSON.stringify({ status: 'PendingCommit' })),
    () => new Response(JSON.stringify({ status: 'CommitStarted', errors: ['PRIVATE'] })),
    () => new Response(JSON.stringify({ status: 'CommitStarted', Status: 'CommitStarted' })),
    () => new Response('null'),
  ]) {
    const f = fixture();
    f.respond = (url) => url.endsWith('/commit') ? response() : undefined;
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.stage, 'commit');
    assert.equal(result.commitAttempted, true);
    assert.equal(result.commit, 'attempted');
    assert.equal(result.submissionId, f.config.pendingId);
    assert.equal(f.calls.length, 11);
    assert.equal(f.mutations().length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|malformed|ambiguous/);
  }
});

test('postcommit observation failures retain acknowledged mutation without retry', async () => {
  for (const mutate of [
    (f) => { f.respond = (url) => f.calls.length > 11 && url.endsWith('/status') ? new Response('PRIVATE', { status: 500 }) : undefined; },
    (f) => { f.processingStatus = 'CertificationFailed'; },
    (f) => { f.processingStatus = 'PRIVATE_UNKNOWN'; },
    (f) => { f.ingested = (d) => { d.applicationPackages[1].version = '2.1.0.0'; }; },
    (f) => { f.ingested = (d) => { d.listings['en-us'].baseListing.releaseNotes = 'Changed'; }; },
    (f) => { f.ingested = (d) => { d.id = 'wrong'; }; },
    (f) => { f.processingStatus = 'Published'; f.noIngestion = true; },
  ]) {
    const f = fixture();
    mutate(f);
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(result.commit, 'acknowledged');
    assert.equal(result.submissionId, f.config.pendingId);
    assert.equal(f.mutations().length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|blob\.core/);
  }
});

test('bounded pending, certification and verified publication outcomes remain distinct', async () => {
  for (const [status, state, noIngestion, elapsed] of [
    ['CommitStarted', 'acknowledged', true, 300000],
    ['Certification', 'certification', true, 300000],
    ['Certification', 'certification', false, 0],
    ['Published', 'published', false, 0],
  ]) {
    const f = fixture();
    f.processingStatus = status;
    f.noIngestion = noIngestion;
    const result = await f.run();
    assert.equal(result.state, state);
    assert.equal(f.elapsed(), elapsed);
    assert.equal(f.mutations().length, 1);
    assert.equal(result.notes, noIngestion ? undefined : 'verified');
  }
});

test('CLI defaults to GET-only diagnosis and preflight never authenticates', async () => {
  const f = fixture();
  const options = { load: () => f.config, fetchImpl: f.fetchImpl, write: () => {}, summarize: () => {} };
  assert.equal(await runCommitOnly(['--preflight'], {}, options), 0);
  assert.equal(f.calls.length, 0);
  assert.equal(await runCommitOnly([], {}, options), 0);
  assert.deepEqual(f.mutations(), []);
  assert.throws(() => loadCommitConfiguration({}));
});

test('summary or stdout failure after acknowledgement preserves attempt state in safe fallback output', async () => {
  for (const failedWriter of ['write', 'summarize']) {
    const f = fixture();
    const errors = [];
    const options = { load: () => f.config, fetchImpl: f.fetchImpl, now: f.now, wait: f.wait,
      write: () => {}, summarize: () => {}, error: (text) => errors.push(text) };
    options[failedWriter] = () => { throw new Error('PRIVATE disk failure'); };
    assert.equal(await runCommitOnly(['--commit-only'], {}, options), 1);
    assert.equal(f.mutations().length, 1);
    assert.equal(f.calls.length, 11);
    assert.match(errors.join(''), /"commitAttempted":true/);
    assert.match(errors.join(''), /"commit":"acknowledged"/);
    assert.match(errors.join(''), new RegExp(f.config.pendingId));
    assert.doesNotMatch(errors.join(''), /PRIVATE|Bearer|blob\.core/);
  }
});

test('protected workflow separates current tooling from immutable source and exposes only explicit commit-only execution', () => {
  const workflow = readFileSync(new URL('../.github/workflows/store-commit-only.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /environment: microsoft-store-production/);
  assert.match(workflow, /group: microsoft-store-production\n {2}cancel-in-progress: false/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ inputs.source_sha \}\}/);
  assert.match(workflow, /commit_only:[\s\S]*?default: false/);
  assert.match(workflow, /if: inputs\.commit_only && github\.run_attempt == 1/);
  assert.match(workflow, /node scripts\/commit-store-update\.mjs --preflight/);
  assert.match(workflow, /node scripts\/commit-store-update\.mjs --commit-only/);
  assert.equal((workflow.match(/PARTNER_CENTER_CLIENT_SECRET:/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /npm ci|msix:pack|run-wack|publish-store-update|resume-store-recovery|upload-artifact|release:\n/);
  assert.doesNotMatch(workflow, /115292150570|7345c97d|55807e74|26164bc/);
  const script = readFileSync(new URL('../scripts/commit-store-update.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /method: 'PUT'|method: 'DELETE'|resume-store-recovery|inspect-store-recovery/);
});
