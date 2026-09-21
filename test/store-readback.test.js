import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { diagnoseStoreReadback, loadConfiguration, runDiagnosis } from '../scripts/diagnose-store-readback.mjs';
import { prepareApiDraft, preservedIntentPair, verifyPreservedIntent } from '../scripts/check-store-release.mjs';
import { sha256, semanticDifferences, readbackChecks } from '../scripts/store-readback.mjs';

function fixture() {
  const config = {
    productId: '9TESTPRODUCT', pendingId: '1234567892', publishedId: '1234567891',
    version: '3.1.0.0', applicationVersion: '3.1.0', releaseTag: 'v3.1.0',
    sourceSha: 'a'.repeat(40), actualSourceSha: 'a'.repeat(40), tagSha: 'a'.repeat(40),
    toolingSha: 'b'.repeat(40), sourceOnMain: true,
    bundleName: 'RecapPage_3.1.0.0_x64_arm64.msixbundle', bundleSha256: 'c'.repeat(64),
    notes: { version: '3.1.0', locale: 'en-us', text: '- Approved notes.' },
    release: { draft: false, prerelease: false, tag_name: 'v3.1.0' },
    credentials: { tenantId: 'tenant', clientId: 'PRIVATE_CLIENT', clientSecret: 'PRIVATE_SECRET' },
    readUploadedBundle: false,
  };
  config.notesSha256 = sha256(config.notes.text);
  const published = {
    id: config.publishedId, status: 'Published', statusDetails: { errors: [], warnings: [] },
    pricing: { priceId: 'Free', isAdvancedPricingModel: true },
    listings: { 'en-us': { baseListing: { releaseNotes: 'Old notes', description: 'PRIVATE_DESCRIPTION',
      images: [{ id: 'original-image', fileName: 'PRIVATE_IMAGE.png' }] } } },
    applicationPackages: [{ id: 'old', fileName: 'old.msixbundle', fileStatus: 'Uploaded', version: '3.0.0.0' }],
    targetPublishMode: 'Immediate', targetPublishDate: null,
    packageDeliveryOptions: { isMandatoryUpdate: false, mandatoryUpdateEffectiveDate: '1601-01-01T00:00:00Z',
      packageRollout: { isPackageRollout: false, packageRolloutPercentage: 0, fallbackSubmissionId: '0' } },
    visibility: 'Public', automaticBackupEnabled: false,
  };
  const pending = prepareApiDraft({ ...published, id: config.pendingId, status: 'PendingCommit' },
    config.bundleName, config.pendingId, config.notes, config.version);
  pending.fileUploadUrl = 'https://fixture.blob.core.windows.net/ingestion/PRIVATE_PATH?sig=PRIVATE_SAS&se=2099-01-01';
  const app = { id: config.productId, lastPublishedApplicationSubmission: { id: config.publishedId },
    pendingApplicationSubmission: { id: config.pendingId } };
  const status = { status: 'PendingCommit', statusDetails: { errors: [], warnings: [] } };
  const calls = [];
  const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${config.productId}`;
  let appReads = 0;
  let baselineReads = 0;
  const f = { config, published, pending, app, status, calls, root };
  f.fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    let value;
    if (url.startsWith('https://login.microsoftonline.com/')) {
      assert.equal(init.method, 'POST');
      value = { access_token: 'PRIVATE_TOKEN' };
    } else {
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      if (url === pending.fileUploadUrl) {
        assert.equal(init.headers, undefined);
        return new Response('PRIVATE denied', { status: 403 });
      }
      assert.equal(init.headers.Authorization, 'Bearer PRIVATE_TOKEN');
      if (url === root) value = ++appReads === 2 && f.finalApp ? f.finalApp : app;
      else if (url === `${root}/submissions/${config.publishedId}`) {
        value = ++baselineReads === 2 && f.finalPublished ? f.finalPublished : published;
      } else if (url === `${root}/submissions/${config.pendingId}`) value = pending;
      else if (url === `${root}/submissions/${config.pendingId}/status`) value = status;
      else assert.fail('Unexpected endpoint');
    }
    const override = f.respond?.(url, init, value);
    if (override) return override;
    return new Response(JSON.stringify(value));
  };
  f.run = () => diagnoseStoreReadback(config, { fetchImpl: f.fetchImpl });
  return f;
}

const failures = (result) => result.checks.filter((entry) => entry.result === 'fail').map((entry) => entry.checkId);

test('actual read-only orchestration reports every contract with a missing new package version and zero mutations', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.state, 'observed');
  assert.deepEqual(failures(result), []);
  assert.equal(result.mutationCount, 0);
  assert.deepEqual(f.calls.map((call) => call.method), ['POST', 'GET', 'GET', 'GET', 'GET', 'GET', 'GET']);
  assert.equal(result.observed.pending.packages[1].version.type, 'missing');
  assert.equal(result.observed.pending.packages[1].filenameMatches, true);
  assert.equal(result.observed.pending.packages[1].fileStatus.value, 'PendingUpload');
  assert.equal(result.observed.pending.packages[0].version.value, '3.0.0.0');
  assert.equal(result.observed.notes.textSha256, f.config.notesSha256);
  assert.equal(result.evidenceLimits.originalUploadZipSha256, 'UNRECORDED');
  assert.equal(result.evidenceLimits.historicalCreatedPayload, 'UNAVAILABLE_NOT_RECONSTRUCTED');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|access_token|fileUploadUrl|blob\.core/);
  for (const id of ['READBACK_PENDING', 'READBACK_DRAFT', 'READBACK_INTENT', 'READBACK_DIFFERENCES',
    'PENDING_FREE', 'PENDING_PUBLICATION_MODE', 'PENDING_ROLLOUT_DISABLED', 'PENDING_NOTES_LOCALE',
    'PENDING_NOTES_HASH', 'PUBLISHED_RECHECK_INTENT']) {
    assert.equal(result.checks.find((check) => check.checkId === id)?.result, 'pass');
  }
});

test('documented normalization shares publisher acceptance while showing package-derived typed differences', async () => {
  const f = fixture();
  f.pending.targetPublishDate = '1601-01-01T00:00:00Z';
  f.pending.pricing.isAdvancedPricingModel = false;
  f.pending.packageDeliveryOptions.mandatoryUpdateEffectiveDate = '1601-01-01T00:00:00.0000000Z';
  f.pending.packageDeliveryOptions.packageRollout.packageRolloutPercentage = 100;
  f.pending.applicationPackages[1].version = f.config.version;
  f.pending.applicationPackages[1].architecture = 'Neutral';
  f.pending.applicationPackages[1].minimumSystemRam = null;
  const result = await f.run();
  assert.equal(result.state, 'observed');
  assert.equal(result.comparison.semantic.total, 0);
  assert.ok(result.comparison.beforeNormalization.differences.some((entry) =>
    entry.path === '/targetPublishDate' && entry.before.type === 'null' && entry.after.type === 'string'));
  assert.ok(result.comparison.normalized.differences.some((entry) => entry.path.endsWith('/version')
    && entry.before.type === 'missing' && entry.after.type === 'string'));
  assert.equal(result.observed.pending.packages[1].version.matches, true);
  const expected = prepareApiDraft({ ...f.published, id: f.config.pendingId },
    f.config.bundleName, f.config.pendingId, f.config.notes, f.config.version);
  const pair = preservedIntentPair(f.pending, expected, f.config.bundleName);
  assert.deepEqual(pair.actual, pair.expected);
  assert.doesNotThrow(() => verifyPreservedIntent(f.pending, expected, f.config.bundleName));
});

test('independent readback failures retain exact safe paths, types and hashes instead of aborting the report', async () => {
  const f = fixture();
  f.pending.status = 'Certification';
  f.pending.pricing.priceId = 'Paid';
  f.pending.targetPublishMode = 'Manual';
  f.pending.packageDeliveryOptions.packageRollout.isPackageRollout = true;
  f.pending.listings['en-us'].baseListing.releaseNotes = 'PRIVATE_WRONG_NOTES';
  f.pending.listings['en-us'].baseListing.description = null;
  f.pending.applicationPackages[1].fileStatus = 'Uploaded';
  f.status.statusDetails.errors = [{ code: 'MissingFiles', details: 'PRIVATE_ERROR' }];
  const result = await f.run();
  for (const id of ['READBACK_PENDING', 'READBACK_DRAFT', 'READBACK_INTENT', 'PENDING_FREE',
    'PENDING_PUBLICATION_MODE', 'PENDING_ROLLOUT_DISABLED', 'PENDING_NOTES_HASH', 'STATUS_ERRORS_EMPTY']) {
    assert.ok(failures(result).includes(id), id);
  }
  const diff = result.comparison.semantic.differences.find((entry) => entry.path === '/listings/en-us/baseListing/description');
  assert.equal(diff.before.type, 'string');
  assert.equal(diff.after.type, 'null');
  assert.match(diff.before.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.observed.status.errors.codes, ['MissingFiles']);
  assert.equal(f.calls.length, 7);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|Paid/);
});

test('deleted old bundle targetPlatform omission is the only newly accepted semantic difference', async () => {
  const f = fixture();
  f.published.applicationPackages[0].targetPlatform = 'PRIVATE_PLATFORM';
  const result = await f.run();
  assert.equal(result.state, 'observed');
  assert.equal(result.comparison.semantic.total, 0);
  assert.ok(result.comparison.normalized.differences.some((entry) =>
    entry.path.endsWith('/targetPlatform') && entry.before.type === 'string' && entry.after.type === 'missing'));
  const expected = prepareApiDraft({ ...f.published, id: f.config.pendingId },
    f.config.bundleName, f.config.pendingId, f.config.notes, f.config.version);
  for (const change of [
    (actual) => { actual.applicationPackages[0].targetPlatform = null; },
    (actual) => { actual.applicationPackages[0].targetPlatform = 'Different'; },
    (actual) => { actual.applicationPackages[0].fileName = 'other.msixbundle'; },
    (actual) => { actual.applicationPackages[0].fileStatus = 'Uploaded'; },
    (actual) => { actual.applicationPackages[0].version = '2.0.0.0'; },
    (actual) => { actual.visibility = 'Hidden'; },
  ]) {
    const actual = structuredClone(f.pending);
    change(actual);
    assert.throws(() => verifyPreservedIntent(actual, expected, f.config.bundleName));
  }
  for (const fileStatus of ['Uploaded', 'PendingUpload']) {
    const actual = structuredClone(f.pending);
    const intended = structuredClone(expected);
    actual.applicationPackages[0].fileStatus = intended.applicationPackages[0].fileStatus = fileStatus;
    assert.throws(() => verifyPreservedIntent(actual, intended, f.config.bundleName));
  }
  for (const value of ['', null, false]) {
    const intended = structuredClone(expected);
    intended.applicationPackages[0].targetPlatform = value;
    assert.throws(() => verifyPreservedIntent(f.pending, intended, f.config.bundleName));
  }
  const intended = structuredClone(f.pending);
  intended.applicationPackages[1].targetPlatform = 'PRIVATE_PLATFORM';
  assert.throws(() => verifyPreservedIntent(f.pending, intended, f.config.bundleName));
  assert.throws(() => verifyPreservedIntent(f.pending, expected));
});

test('all local immutable release, identity, notes and source guards fail before authentication', async () => {
  for (const [mutate, code] of [
    [(c) => { c.pendingId = c.publishedId; }, 'INPUT_IDENTITIES'],
    [(c) => { c.pendingId = 'bad/PRIVATE'; }, 'INPUT_IDENTITIES'],
    [(c) => { c.productId = '../PRIVATE'; }, 'INPUT_IDENTITIES'],
    [(c) => { c.actualSourceSha = 'd'.repeat(40); }, 'SOURCE_BINDING'],
    [(c) => { c.tagSha = 'd'.repeat(40); }, 'SOURCE_BINDING'],
    [(c) => { c.sourceOnMain = false; }, 'SOURCE_BINDING'],
    [(c) => { c.toolingSha = 'bad'; }, 'SOURCE_BINDING'],
    [(c) => { c.version = '3.2.0.0'; }, 'SOURCE_VERSION'],
    [(c) => { c.bundleName = 'wrong.msixbundle'; }, 'SOURCE_VERSION'],
    [(c) => { c.releaseTag = 'v3.2.0'; }, 'SOURCE_VERSION'],
    [(c) => { c.release.draft = true; }, 'PUBLIC_RELEASE'],
    [(c) => { c.release.prerelease = true; }, 'PUBLIC_RELEASE'],
    [(c) => { c.notes.version = '3.0.0'; }, 'APPROVED_NOTES'],
    [(c) => { c.notes.locale = 'fr-fr'; }, 'APPROVED_NOTES'],
    [(c) => { c.notes.text = '- Changed'; }, 'NOTES_HASH'],
    [(c) => { c.notesSha256 = 'bad'; }, 'NOTES_HASH'],
    [(c) => { c.bundleSha256 = 'bad'; }, 'BUNDLE_HASH_INPUT'],
    [(c) => { c.readUploadedBundle = 'false'; }, 'UPLOAD_READ_OPTION'],
  ]) {
    const f = fixture();
    mutate(f.config);
    const result = await f.run();
    assert.ok(failures(result).includes(code), code);
    assert.equal(f.calls.length, 0);
    assert.equal(result.mutationCount, 0);
  }
});

test('each current identity, publication, package and notes check fails independently', async () => {
  for (const [mutate, code] of [
    [(f) => { f.app.id = 'wrong'; }, 'APPLICATION_PRODUCT'],
    [(f) => { f.app.pendingApplicationSubmission.id = 'wrong'; }, 'APPLICATION_PENDING_REFERENCE'],
    [(f) => { f.app.lastPublishedApplicationSubmission.id = 'wrong'; }, 'APPLICATION_PUBLISHED_REFERENCE'],
    [(f) => { f.published.id = 'wrong'; }, 'PUBLISHED_IDENTITY'],
    [(f) => { f.published.status = 'PendingCommit'; }, 'PUBLISHED_STATUS'],
    [(f) => { f.published.pricing.priceId = 'Paid'; }, 'PUBLISHED_FREE'],
    [(f) => { f.published.applicationPackages[0].version = f.config.version; }, 'PUBLISHED_VERSION_ADVANCE'],
    [(f) => { delete f.published.applicationPackages[0].version; }, 'PUBLISHED_VERSION_ADVANCE'],
    [(f) => { f.published.applicationPackages.push({ fileName: 'extra.msixbundle' }); }, 'PUBLISHED_PACKAGE_REPLACEMENT'],
    [(f) => { f.pending.id = 'wrong'; }, 'PENDING_IDENTITY'],
    [(f) => { delete f.pending.listings['en-us']; }, 'PENDING_NOTES_LOCALE'],
    [(f) => { f.pending.statusDetails.errors = [{ code: 'InvalidState' }]; }, 'READBACK_PENDING'],
    [(f) => { f.pending.applicationPackages[1].fileName = 'wrong.msixbundle'; }, 'READBACK_DRAFT'],
    [(f) => { f.pending.applicationPackages[1].version = '9.0.0.0'; }, 'PENDING_TARGET_VERSION'],
    [(f) => { f.pending.applicationPackages[1].version = null; }, 'PENDING_TARGET_VERSION'],
    [(f) => { delete f.pending.targetPublishDate; }, 'PENDING_PUBLICATION_DATE'],
    [(f) => { f.status.status = 'CommitStarted'; }, 'STATUS_PENDING'],
    [(f) => { delete f.status.statusDetails.errors; }, 'STATUS_ERRORS_EMPTY'],
    [(f) => { f.finalApp = { ...f.app, pendingApplicationSubmission: null }; }, 'APPLICATION_RECHECK_PENDING_REFERENCE'],
    [(f) => { f.finalPublished = { ...f.published, visibility: 'Hidden' }; }, 'PUBLISHED_RECHECK_INTENT'],
  ]) {
    const f = fixture();
    mutate(f);
    const result = await f.run();
    assert.ok(failures(result).includes(code), code);
    assert.equal(result.state, 'failed');
    assert.equal(result.mutationCount, 0);
    assert.ok(f.calls.slice(1).every((call) => call.method === 'GET'));
  }
});

test('transport, HTTP, JSON and ambiguous field failures preserve other stages and never retry or leak', async () => {
  for (const fail of [
    () => { throw new Error('PRIVATE_SAS raw-response'); },
    () => new Response('PRIVATE_RAW', { status: 403 }),
    () => new Response('PRIVATE_NOT_JSON'),
    () => new Response(JSON.stringify({ id: 'one', Id: 'two' })),
  ]) {
    const f = fixture();
    f.respond = (url) => url.endsWith(f.config.pendingId) ? fail() : undefined;
    const result = await f.run();
    assert.equal(result.state, 'failed');
    assert.equal(f.calls.length, 7);
    assert.ok(result.checks.some((check) => check.checkId === 'PUBLISHED_RECHECK_INTENT' && check.result === 'pass'));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|raw-response|blob\.core|Bearer/);
  }
});

test('hostile dynamic keys, error codes, unknown status and package versions are hashed or suppressed', async () => {
  const f = fixture();
  f.pending.listings['PRIVATE_locale'] = { baseListing: { description: 'PRIVATE_VALUE' } };
  f.pending['https://PRIVATE.invalid/?sig=PRIVATE_SAS'] = 'PRIVATE_VALUE';
  f.pending.packageDeliveryOptions['PRIVATE_DYNAMIC'] = null;
  f.pending.status = 'PRIVATE_STATUS';
  f.pending.applicationPackages[1].version = 'PRIVATE_VERSION';
  f.pending.applicationPackages[1].fileStatus = 'PRIVATE_FILE_STATUS';
  f.pending.statusDetails.errors = [{ code: 'PRIVATE_CODE', message: 'PRIVATE_MESSAGE' }];
  const result = await f.run();
  assert.equal(result.observed.pending.status.value, undefined);
  assert.equal(result.observed.pending.packages[1].version.value, undefined);
  assert.deepEqual(result.observed.pending.errors.codes, ['REDACTED_UNKNOWN_CODE']);
  assert.ok(result.comparison.semantic.differences.some((entry) => entry.path.includes('/redacted-')));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|https:|sig=|fileUploadUrl|message|stack/);
  const before = JSON.parse('{"__proto__":{"PRIVATE_key":null}}');
  assert.doesNotMatch(JSON.stringify(semanticDifferences(before, {})), /__proto__|PRIVATE_key/);
  const crowded = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`PRIVATE_${index}`, true]));
  const bounded = semanticDifferences({}, crowded);
  assert.equal(bounded.total, 101);
  assert.equal(bounded.differences.length, 100);
  assert.equal(bounded.truncated, true);
});

test('missing, null, default and array cardinality differences remain distinguishable', () => {
  const result = semanticDifferences({ visibility: null, images: [1, 2] }, { visibility: false, images: [1] });
  assert.equal(result.total, 2);
  assert.ok(result.differences.some((diff) => diff.path === '/images/1' && diff.after.type === 'missing'));
  assert.ok(result.differences.some((diff) => diff.path === '/visibility' && diff.before.type === 'null'
    && diff.after.type === 'boolean'));
  const f = fixture();
  const readback = readbackChecks({ ...f.pending, applicationPackages: null }, f.pending,
    { ...f.config });
  assert.equal(readback.checks.find((check) => check.checkId === 'READBACK_DRAFT').result, 'fail');
});

test('optional upload GET denial reports unavailable but completes metadata diagnosis', async () => {
  const f = fixture();
  f.config.readUploadedBundle = true;
  const result = await f.run();
  assert.equal(result.uploadRead.state, 'unavailable');
  assert.equal(result.uploadRead.httpStatus, 403);
  assert.ok(failures(result).includes('UPLOAD_READ_HTTP'));
  assert.ok(result.checks.some((check) => check.checkId === 'PUBLISHED_RECHECK_INTENT' && check.result === 'pass'));
  assert.equal(result.mutationCount, 0);
  assert.equal(f.calls.length, 8);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|blob\.core|sig=/);
});

test('optional upload read cannot follow an upload location without the expected submission bindings', async () => {
  const f = fixture();
  f.config.readUploadedBundle = true;
  f.pending.id = 'wrong';
  const result = await f.run();
  assert.ok(failures(result).includes('UPLOAD_READ_BINDING'));
  assert.equal(f.calls.length, 7);
  assert.equal(result.uploadRead.state, 'unavailable');
});

test('CLI preflight is network-free and output contains fixed failures instead of exception text', async () => {
  const output = [];
  const f = fixture();
  const options = { load: () => f.config, fetchImpl: f.fetchImpl,
    write: (text) => output.push(text), summarize: (text) => output.push(text) };
  assert.equal(await runDiagnosis(['--preflight'], {}, options), 0);
  assert.equal(f.calls.length, 0);
  assert.equal(await runDiagnosis(['--diagnose'], {}, options), 0);
  options.load = () => { throw new Error('PRIVATE credential error stack'); };
  assert.equal(await runDiagnosis(['--diagnose'], {}, options), 1);
  assert.match(output.join(''), /LOCAL_INPUT_OR_DIAGNOSTIC/);
  assert.doesNotMatch(output.join(''), /PRIVATE|stack|credential error/);
});

test('configuration loader binds real git tag, checkout, ancestor, version and approved notes', () => {
  const source = mkdtempSync(join(tmpdir(), 'store-readback-source-'));
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    // Copy only the public data layout, never execute application source.
    const { config } = fixture();
    writeFileSync(join(source, 'package.json'), JSON.stringify({ version: config.applicationVersion }));
    git('add', 'package.json');
    git('commit', '-m', 'fixture');
    git('tag', config.releaseTag);
    const commit = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', commit);
    const releaseFile = join(source, 'release.json');
    writeFileSync(releaseFile, JSON.stringify(config.release));
    const env = { READBACK_SOURCE_DIRECTORY: source, SOURCE_SHA: commit, RELEASE_TAG: config.releaseTag,
      DEFAULT_BRANCH: 'main', READ_UPLOADED_BUNDLE: 'false', READBACK_RELEASE_FILE: releaseFile,
      MICROSOFT_STORE_PRODUCT_ID: config.productId, EXPECTED_PENDING_ID: config.pendingId,
      EXPECTED_PUBLISHED_ID: config.publishedId, TOOLING_SHA: config.toolingSha,
      BUNDLE_SHA256: config.bundleSha256, NOTES_SHA256: config.notesSha256 };
    assert.throws(() => loadConfiguration(env));
    mkdirSync(join(source, 'docs', 'releases'), { recursive: true });
    writeFileSync(join(source, 'docs', 'releases', '3.1.0-store.json'), JSON.stringify(config.notes));
    const loaded = loadConfiguration(env);
    assert.equal(loaded.sourceSha, commit);
    assert.equal(loaded.tagSha, commit);
    assert.equal(loaded.actualSourceSha, commit);
    assert.equal(loaded.bundleName, config.bundleName);
    assert.deepEqual(loaded.notes, config.notes);
    assert.throws(() => loadConfiguration({ ...env, SOURCE_SHA: '--help' }));
    assert.throws(() => loadConfiguration({ ...env, RELEASE_TAG: '../unsafe' }));
    assert.throws(() => loadConfiguration({ ...env, READ_UPLOADED_BUNDLE: 'maybe' }));
    assert.throws(() => loadConfiguration({ ...env, SOURCE_SHA: 'f'.repeat(40) }));
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test('workflow confines credentialed execution to protected GET-only diagnosis without builds or mutation tools', () => {
  const workflow = readFileSync(new URL('../.github/workflows/store-readback-diagnose.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /environment: microsoft-store-production/);
  assert.match(workflow, /group: microsoft-store-production\n {2}cancel-in-progress: false/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ inputs.source_sha \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.equal((workflow.match(/PARTNER_CENTER_CLIENT_SECRET:/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /npm ci|msix:pack|run-wack|publish-store-update|resume-store|upload-artifact|release:\n/);
  assert.doesNotMatch(workflow, /115292150570|7345c97d|26164bc/);
  const script = readFileSync(new URL('../scripts/diagnose-store-readback.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /resume-store-recovery|inspect-store-recovery|\/commit|method: 'PUT'|method: 'DELETE'/);
});
