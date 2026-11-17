import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  ENVIRONMENT, WORKFLOW, BUNDLE_ID, RELEASE_TYPE, AppStoreError, validateIntent, sealedBuild, validateInvocation,
  ascToken, ascClient, whatsNewDifference, transact, plan,
} from '../scripts/app-store-release.mjs';
import { REPOSITORY_ID } from '../scripts/google-play-publisher.mjs';
import { REPOSITORY } from '../scripts/android-candidate.mjs';
import { approvedStoreText, StoreTextError } from '../scripts/lib/store-text.mjs';

const API = 'https://api.appstoreconnect.apple.com';
const BEARER = 'header.payload.signature';
// Assembled so the publication gate does not read a placeholder issuer as a real identifier.
const ISSUER = ['00000000', '0000', '4000', '8000', '000000000000'].join('-');
const VERSION = '4.6.0';
const BUILD = 12;
const approved = approvedStoreText(readFileSync('docs/releases/4.6.0-store.json'), VERSION, 'app-store');
const TEXT = approved.text;
const LIVE_LINE_ONE = '- Browse the new "Universes" section, still under construction, and search lists, series, '
  + 'creators and comics.';
const ledger = JSON.parse(readFileSync('packaging/ios/build-numbers.json', 'utf8'));
const workflow = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
const spec = (mode = 'Submit', whatsNew = TEXT) => ({ mode, version: VERSION, buildNumber: BUILD,
  sealedBuildNumber: BUILD, whatsNew });

const appsReply = () => ({ data: [{ type: 'apps', id: 'app1', attributes: { bundleId: BUNDLE_ID } }] });
function buildsReply(attributes = {}, train = {}) {
  return {
    data: [{ type: 'builds', id: 'build12',
      attributes: { version: '12', processingState: 'VALID', expired: false, usesNonExemptEncryption: false,
        ...attributes },
      relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'pre46' } } } }],
    included: [{ type: 'preReleaseVersions', id: 'pre46', attributes: { version: VERSION, platform: 'IOS', ...train } }],
  };
}
const version = (id, versionString, appVersionState, releaseType = RELEASE_TYPE) => ({ type: 'appStoreVersions', id,
  attributes: { platform: 'IOS', versionString, appVersionState, releaseType } });
const released = () => version('v45', '4.5.0', 'READY_FOR_SALE');
const localization = (whatsNew, locale = 'en-US') => ({ type: 'appStoreVersionLocalizations', id: 'loc46',
  attributes: { locale, whatsNew } });
const submission = (id, state) => ({ type: 'reviewSubmissions', id, attributes: { platform: 'IOS', state } });
const buildLink = (id) => ({ data: id ? { type: 'builds', id } : null });

// One ordered journey per scenario, every request named by the receipt stage that sends it, so a
// stop test can cut the journey at its stage and change a single reply.
function journey({ create = true, live = 'Older notes.', attached = null, releaseType = 'MANUAL' } = {}) {
  const versions = create ? [released()] : [released(), version('v46', VERSION, 'PREPARE_FOR_SUBMISSION', releaseType)];
  const steps = [
    { stage: 'read-app', method: 'GET', path: `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=200`, reply: appsReply() },
    { stage: 'read-build', method: 'GET', path: `/v1/builds?filter[app]=app1&filter[version]=12`
      + `&filter[preReleaseVersion.version]=${VERSION}&include=preReleaseVersion&limit=200`, reply: buildsReply() },
    { stage: 'read-versions', method: 'GET', path: '/v1/apps/app1/appStoreVersions?filter[platform]=IOS&limit=200',
      reply: { data: versions } },
    { stage: 'read-review-submissions', method: 'GET', path: '/v1/reviewSubmissions?filter[app]=app1'
      + '&filter[platform]=IOS&limit=200', reply: { data: [submission('old', 'COMPLETE')] } },
  ];
  if (create) {
    steps.push(
      { stage: 'create-version', method: 'POST', path: '/v1/appStoreVersions', body: { data: { type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: VERSION, releaseType: RELEASE_TYPE },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } } } },
      status: 201, reply: { data: version('v46', VERSION, 'PREPARE_FOR_SUBMISSION') } },
      { stage: 'readback-version', method: 'GET', path: '/v1/appStoreVersions/v46',
        reply: { data: version('v46', VERSION, 'PREPARE_FOR_SUBMISSION') } },
    );
  } else if (releaseType !== RELEASE_TYPE) {
    steps.push(
      { stage: 'update-release-type', method: 'PATCH', path: '/v1/appStoreVersions/v46', body: { data: {
        type: 'appStoreVersions', id: 'v46', attributes: { releaseType: RELEASE_TYPE } } },
      reply: { data: version('v46', VERSION, 'PREPARE_FOR_SUBMISSION') } },
      { stage: 'readback-release-type', method: 'GET', path: '/v1/appStoreVersions/v46',
        reply: { data: version('v46', VERSION, 'PREPARE_FOR_SUBMISSION') } },
    );
  }
  const relation = '/v1/appStoreVersions/v46/relationships/build';
  steps.push({ stage: 'read-version-build', method: 'GET', path: relation, reply: buildLink(attached) });
  if (attached !== 'build12') {
    steps.push(
      { stage: 'attach-build', method: 'PATCH', path: relation, body: { data: { type: 'builds', id: 'build12' } },
        status: 204 },
      { stage: 'readback-version-build', method: 'GET', path: relation, reply: buildLink('build12') },
    );
  }
  steps.push({ stage: 'read-localizations', method: 'GET',
    path: '/v1/appStoreVersions/v46/appStoreVersionLocalizations?limit=200',
    reply: { data: [localization('Notes de version.', 'fr-FR'), localization(live)] } });
  if (live !== TEXT) {
    steps.push(
      { stage: 'update-whats-new', method: 'PATCH', path: '/v1/appStoreVersionLocalizations/loc46', body: { data: {
        type: 'appStoreVersionLocalizations', id: 'loc46', attributes: { whatsNew: TEXT } } },
      reply: { data: localization(TEXT) } },
      { stage: 'readback-whats-new', method: 'GET', path: '/v1/appStoreVersionLocalizations/loc46',
        reply: { data: localization(TEXT) } },
    );
  }
  steps.push(
    { stage: 'create-review-submission', method: 'POST', path: '/v1/reviewSubmissions', body: { data: {
      type: 'reviewSubmissions', attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: 'app1' } } } } },
    status: 201, reply: { data: submission('sub1', 'READY_FOR_REVIEW') } },
    { stage: 'add-review-item', method: 'POST', path: '/v1/reviewSubmissionItems', body: { data: {
      type: 'reviewSubmissionItems', relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: 'sub1' } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: 'v46' } } } } },
    status: 201, reply: { data: { type: 'reviewSubmissionItems', id: 'item1', attributes: { state: 'READY_FOR_REVIEW' } } } },
    { stage: 'read-review-items', method: 'GET', path: '/v1/reviewSubmissions/sub1/items?include=appStoreVersion&limit=200',
      reply: { data: [{ type: 'reviewSubmissionItems', id: 'item1', attributes: { state: 'READY_FOR_REVIEW' },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'v46' } } } }] } },
    { stage: 'submit-for-review', method: 'PATCH', path: '/v1/reviewSubmissions/sub1', body: { data: {
      type: 'reviewSubmissions', id: 'sub1', attributes: { submitted: true } } },
    reply: { data: submission('sub1', 'WAITING_FOR_REVIEW') } },
    { stage: 'readback-submission', method: 'GET', path: '/v1/reviewSubmissions/sub1',
      reply: { data: submission('sub1', 'WAITING_FOR_REVIEW') } },
    { stage: 'readback-version-state', method: 'GET', path: '/v1/appStoreVersions/v46',
      reply: { data: version('v46', VERSION, 'WAITING_FOR_REVIEW') } },
  );
  return steps;
}
const through = (steps, stage) => steps.slice(0, steps.findIndex((step) => step.stage === stage) + 1);
const at = (steps, stage) => steps.find((step) => step.stage === stage);

function fixture(steps) {
  const calls = [];
  const receipts = [];
  const fetchImpl = async (url, init) => {
    const step = steps[calls.length];
    calls.push({ stage: step?.stage, method: init.method });
    assert.ok(step, `unexpected request ${init.method} ${url}`);
    assert.ok(receipts.at(-1)?.stage === step.stage, `the receipt names ${step.stage} before it is sent`);
    assert.equal(init.method, step.method, step.stage);
    assert.equal(url, `${API}${step.path}`, step.stage);
    assert.deepEqual(init.body === undefined ? undefined : JSON.parse(init.body), step.body, step.stage);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Bearer ${BEARER}`);
    assert.equal(init.headers['Content-Type'], step.body === undefined ? undefined : 'application/json');
    if (step.transportError) throw new TypeError('socket closed');
    if (step.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(step.reply), { status: step.status ?? 200 });
  };
  return { fetchImpl, calls, receipts, record: async (receipt) => { receipts.push(receipt); } };
}
async function run(steps, mode = 'Submit', text = TEXT) {
  const harness = fixture(steps);
  const result = await transact(spec(mode, text), { fetchImpl: harness.fetchImpl, token: BEARER, record: harness.record,
    mode });
  assert.equal(harness.calls.length, steps.length, 'every expected request was sent and no other');
  return { ...harness, result };
}
async function stops(steps, code, { state = 'blocked', mode = 'Submit' } = {}) {
  const harness = fixture(steps);
  await assert.rejects(transact(spec(mode), { fetchImpl: harness.fetchImpl, token: BEARER, record: harness.record,
    mode }), (error) => error instanceof AppStoreError && error.code === code);
  assert.equal(harness.calls.length, steps.length, `stopped at ${steps.at(-1)?.stage}`);
  const last = harness.receipts.at(-1);
  assert.equal(last.state, state);
  assert.equal(last.code, code);
  return { ...harness, last };
}
const writes = (calls) => calls.filter((call) => call.method !== 'GET');

test('intent accepts exactly mode, version and a build number', () => {
  assert.deepEqual(validateIntent({ mode: 'Submit', version: '4.6.0', build_number: '12' }),
    { mode: 'Submit', version: '4.6.0', buildNumber: 12 });
  for (const [raw, code] of [
    [{ mode: 'Submit', version: '4.6', build_number: '12' }, 'VERSION_REQUIRED'],
    [{ mode: 'Submit', version: '04.6.0', build_number: '12' }, 'VERSION_REQUIRED'],
    [{ mode: 'Submit', version: '4.6.0', build_number: '012' }, 'BUILD_NUMBER_REQUIRED'],
    [{ mode: 'Submit', version: '4.6.0', build_number: '12a' }, 'BUILD_NUMBER_REQUIRED'],
    [{ mode: 'Submit', version: '4.6.0', build_number: 12 }, 'BUILD_NUMBER_REQUIRED'],
    [{ mode: 'Publish', version: '4.6.0', build_number: '12' }, 'EXPLICIT_MODE_REQUIRED'],
    [{ mode: 'Submit', version: '4.6.0', build_number: '12', notes: '- typed' }, 'EXACT_INPUTS_REQUIRED'],
    [{ mode: 'Submit', version: '4.6.0' }, 'EXACT_INPUTS_REQUIRED'],
  ]) {
    assert.throws(() => validateIntent(raw), (error) => error.code === code, JSON.stringify(raw));
  }
});

test('the build must be the newest sealed ledger build for exactly that version', () => {
  assert.equal(sealedBuild(ledger, { version: '4.6.0', buildNumber: 12 }).buildNumber, 12);
  for (const [intent, code] of [
    [{ version: '4.6.0', buildNumber: 99 }, 'BUILD_NOT_RESERVED'],
    [{ version: '4.4.0', buildNumber: 6 }, 'BUILD_NOT_SEALED'],
    [{ version: '4.6.0', buildNumber: 11 }, 'LEDGER_VERSION_MISMATCH'],
    [{ version: '4.5.0', buildNumber: 8 }, 'NEWER_SEALED_BUILD_EXISTS'],
  ]) {
    assert.throws(() => sealedBuild(ledger, intent), (error) => error.code === code, JSON.stringify(intent));
  }
  assert.throws(() => sealedBuild({ ...ledger, schemaVersion: 2 }, { version: '4.6.0', buildNumber: 12 }),
    (error) => error.code === 'IOS_LEDGER_REFUSED');
});

test('only a manual first attempt of this workflow on main is accepted', () => {
  const tooling = 'c'.repeat(40);
  const context = { repository: REPOSITORY, event: 'workflow_dispatch', ref: 'refs/heads/main', defaultBranch: 'main',
    attempt: 1, workflowSha: tooling, sha: tooling, workflowRef: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, runId: 7 };
  const runInfo = { id: 7, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main', head_sha: tooling,
    path: WORKFLOW, repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID } };
  validateInvocation(context, runInfo);
  assert.throws(() => validateInvocation({ ...context, attempt: 2 }, runInfo),
    (error) => error.code === 'MANUAL_MAIN_FIRST_ATTEMPT_REQUIRED');
  assert.throws(() => validateInvocation(context, { ...runInfo, path: '.github/workflows/other.yml' }),
    (error) => error.code === 'WORKFLOW_IDENTITY_MISMATCH');
});

test('the token is an ES256 JWT with a raw 64-byte signature and a bounded lifetime', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  const token = ascToken({ keyId: 'ABC123DEF4', issuerId: ISSUER,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), now });
  const [header, payload, signature] = token.split('.');
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  assert.deepEqual(decode(header), { alg: 'ES256', kid: 'ABC123DEF4', typ: 'JWT' });
  const claims = decode(payload);
  assert.deepEqual(claims, { iss: ISSUER, iat: now / 1000, exp: now / 1000 + 900,
    aud: 'appstoreconnect-v1' });
  assert.ok(claims.exp - claims.iat <= 1200, 'Apple refuses a token living more than 20 minutes');
  const raw = Buffer.from(signature, 'base64url');
  assert.equal(raw.length, 64, 'JWS ES256 is r||s, not DER');
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw));
  assert.ok(!token.includes('PRIVATE'));
});

test('the token refuses malformed identifiers and keys that are not P-256', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const good = { keyId: 'ABC123DEF4', issuerId: ISSUER, privateKeyPem: pem };
  for (const [value, code] of [
    [{ keyId: 'abc123def4' }, 'ASC_KEY_ID_REQUIRED'],
    [{ issuerId: 'issuer' }, 'ASC_ISSUER_ID_REQUIRED'],
    [{ privateKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }) }, 'ASC_PRIVATE_KEY_REQUIRED'],
    [{ privateKeyPem: `-----BEGIN ${'PRIVATE'} KEY-----\nnot a key\n-----END ${'PRIVATE'} KEY-----` },
      'ASC_PRIVATE_KEY_UNREADABLE'],
    [{ privateKeyPem: generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey
      .export({ type: 'pkcs8', format: 'pem' }) }, 'ASC_PRIVATE_KEY_NOT_P256'],
  ]) {
    assert.throws(() => ascToken({ ...good, ...value }), (error) => error.code === code && !error.message.includes('MII'));
  }
});

test('Submit creates a missing version, attaches the build, sets What\'s New and submits it', async () => {
  const { result, receipts, calls } = await run(journey({ create: true }));
  assert.equal(result.state, 'submitted-for-review');
  assert.equal(result.mutationAttempted, true);
  assert.deepEqual(result.ids, { app: 'app1', build: 'build12', appStoreVersion: 'v46', localization: 'loc46',
    reviewSubmission: 'sub1', reviewSubmissionItem: 'item1' });
  assert.equal(result.before.appStoreVersion, null);
  assert.deepEqual(result.before.openSubmissions, []);
  assert.equal(result.after.reviewSubmission.state, 'WAITING_FOR_REVIEW');
  assert.equal(result.after.appStoreVersion.appVersionState, 'WAITING_FOR_REVIEW');
  assert.equal(writes(calls).length, 6);
  assert.ok(receipts.length > calls.length, 'a receipt precedes every request and the outcome');
  assert.ok(!JSON.stringify(receipts).includes(BEARER), 'the receipt never holds the token');
});

test('Submit updates an editable version, recording the before and after state', async () => {
  const { result, calls } = await run(journey({ create: false, live: 'Older notes.', attached: 'build11' }));
  assert.equal(result.state, 'submitted-for-review');
  assert.deepEqual(result.before.appStoreVersion, { id: 'v46', versionString: VERSION,
    appVersionState: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' });
  assert.equal(result.before.buildId, 'build11');
  assert.equal(result.before.whatsNew, 'Older notes.');
  assert.equal(result.after.buildId, 'build12');
  assert.deepEqual(writes(calls).map((call) => call.stage), ['update-release-type', 'attach-build', 'update-whats-new',
    'create-review-submission', 'add-review-item', 'submit-for-review']);
});

test('Submit leaves matching fields alone and only submits', async () => {
  const { result, calls } = await run(journey({ create: false, live: TEXT, attached: 'build12', releaseType: RELEASE_TYPE }));
  assert.equal(result.state, 'submitted-for-review');
  assert.equal(result.whatsNewDifference.identical, true);
  assert.deepEqual(writes(calls).map((call) => call.stage), ['create-review-submission', 'add-review-item',
    'submit-for-review']);
});

test('Inspect sends only GETs and reports what Submit would create', async () => {
  const steps = journey({ create: true }).filter((step) => step.method === 'GET').slice(0, 4);
  const { result, calls } = await run(steps, 'Inspect');
  assert.equal(writes(calls).length, 0);
  assert.equal(result.state, 'inspected-no-change');
  assert.equal(result.mutationAttempted, false);
  assert.deepEqual(result.planned.map((item) => item.stage), ['create-version', 'attach-build', 'update-whats-new',
    'create-review-submission', 'add-review-item', 'submit-for-review']);
  assert.equal(result.whatsNewDifference.liveMissing, true);
});

test('Inspect reports exactly the 4.6.0 line that differs from the approved file, without throwing', async () => {
  const live = [LIVE_LINE_ONE, ...TEXT.split('\n').slice(1)].join('\n');
  assert.equal(TEXT.split('\n').length, 5);
  const steps = journey({ create: false, live, attached: 'build12', releaseType: RELEASE_TYPE })
    .filter((step) => step.method === 'GET' && !step.stage.startsWith('readback') && step.stage !== 'read-review-items');
  const { result, calls } = await run(steps, 'Inspect');
  assert.equal(writes(calls).length, 0);
  assert.deepEqual(result.whatsNewDifference, { identical: false, liveMissing: false, lines: [{ line: 1,
    live: LIVE_LINE_ONE,
    approved: '- Browse Universes, still under construction, and search lists, series, creators and comics.' }] });
  assert.deepEqual(result.planned.map((item) => item.stage), ['update-whats-new', 'create-review-submission',
    'add-review-item', 'submit-for-review']);
  assert.deepEqual(result.planned[0].body.data.attributes.whatsNew, TEXT);
});

test('the line difference names added and removed lines too', () => {
  assert.deepEqual(whatsNewDifference('- a\n- b', '- a\n- c\n- d').lines, [
    { line: 2, live: '- b', approved: '- c' }, { line: 3, live: null, approved: '- d' }]);
});

test('the Inspect client refuses any write before it is sent', async () => {
  let sent = 0;
  const receipt = { stage: 'ready' };
  const { request } = ascClient({ fetchImpl: async () => { sent += 1; return new Response('{}'); }, token: BEARER,
    mode: 'Inspect', receipt, save: async () => {} });
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await assert.rejects(request('probe', method, '/v1/appStoreVersions', {}),
      (error) => error.code === 'INSPECT_REFUSES_WRITES');
  }
  assert.equal(sent, 0);
  assert.equal(receipt.stage, 'ready');
});

test('a build that is missing, duplicated or not the sealed build for this version stops', async () => {
  const base = through(journey(), 'read-build');
  const variants = [
    [{ data: [] }, 'ONE_BUILD_REQUIRED'],
    [{ ...buildsReply(), data: [...buildsReply().data, { ...buildsReply().data[0], id: 'build12b' }] }, 'ONE_BUILD_REQUIRED'],
    [buildsReply({ version: '11' }), 'BUILD_NUMBER_MISMATCH'],
    [buildsReply({}, { version: '4.5.0' }), 'BUILD_VERSION_MISMATCH'],
    [buildsReply({ processingState: 'PROCESSING' }), 'BUILD_NOT_VALID'],
    [buildsReply({ expired: true }), 'BUILD_EXPIRED'],
    [buildsReply({ usesNonExemptEncryption: null }), 'EXPORT_COMPLIANCE_UNANSWERED'],
    [buildsReply({ usesNonExemptEncryption: true }), 'EXPORT_COMPLIANCE_UNANSWERED'],
  ];
  for (const [reply, code] of variants) {
    const steps = structuredClone(base);
    at(steps, 'read-build').reply = reply;
    const { last } = await stops(steps, code);
    assert.equal(last.mutationAttempted, false);
  }
});

test('a target version that is not editable, or another editable version, stops before any write', async () => {
  for (const [versions, code] of [
    [[version('v46', VERSION, 'WAITING_FOR_REVIEW')], 'TARGET_VERSION_NOT_EDITABLE'],
    [[version('v46', VERSION, 'READY_FOR_SALE')], 'TARGET_VERSION_NOT_EDITABLE'],
    [[version('v45', '4.5.0', 'PREPARE_FOR_SUBMISSION')], 'ANOTHER_VERSION_EDITABLE'],
    [[{ ...released(), attributes: { platform: 'IOS', versionString: '4.5.0', appStoreState: 'READY_FOR_SALE' } }],
      'APP_VERSION_STATE_MISSING'],
  ]) {
    const steps = through(journey(), 'read-versions');
    at(steps, 'read-versions').reply = { data: versions };
    const { calls } = await stops(steps, code);
    assert.equal(writes(calls).length, 0);
  }
});

test('an open review submission stops with nothing changed, never reused or canceled', async () => {
  for (const state of ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES']) {
    const steps = through(journey(), 'read-review-submissions');
    at(steps, 'read-review-submissions').reply = { data: [submission('old', 'COMPLETE'), submission('open', state)] };
    const { calls, last } = await stops(steps, 'OPEN_REVIEW_SUBMISSION');
    assert.equal(writes(calls).length, 0);
    assert.deepEqual(last.before.openSubmissions, [{ id: 'open', state }]);
  }
});

test('a version without exactly one en-US localization stops; none is created', async () => {
  const steps = through(journey({ create: false, attached: 'build12', releaseType: RELEASE_TYPE }), 'read-localizations');
  at(steps, 'read-localizations').reply = { data: [localization('Notes.', 'en-GB')] };
  const { calls } = await stops(steps, 'ONE_EN_US_LOCALIZATION_REQUIRED');
  assert.equal(writes(calls).length, 0);
});

test('a What\'s New readback that is not byte for byte the approved text stops', async () => {
  const steps = through(journey({ create: false, attached: 'build12', releaseType: RELEASE_TYPE }), 'readback-whats-new');
  at(steps, 'readback-whats-new').reply = { data: localization(`${TEXT} `) };
  const { last } = await stops(steps, 'WHATS_NEW_READBACK_MISMATCH');
  assert.equal(last.mutationAttempted, true);
});

test('a build relationship readback that is not the target build stops', async () => {
  const steps = through(journey({ create: false, attached: 'build11', releaseType: RELEASE_TYPE }),
    'readback-version-build');
  at(steps, 'readback-version-build').reply = buildLink('build11');
  await stops(steps, 'BUILD_READBACK_MISMATCH');
});

test('after an acknowledged submit, an unexpected or failed read back is never reported as blocked', async () => {
  let steps = through(journey(), 'readback-submission');
  at(steps, 'readback-submission').reply = { data: submission('sub1', 'READY_FOR_REVIEW') };
  let { last } = await stops(steps, 'SUBMISSION_READBACK_STATE', { state: 'submitted-readback-unverified' });
  assert.equal(last.after.reviewSubmission.state, 'READY_FOR_REVIEW');
  assert.equal(last.submitAcknowledged, true);

  steps = through(journey(), 'readback-submission');
  at(steps, 'readback-submission').transportError = true;
  ({ last } = await stops(steps, 'TRANSPORT_OUTCOME_UNKNOWN', { state: 'submitted-readback-unverified' }));
  assert.equal(last.stage, 'readback-submission');
});

test('a throttled or unanswered write is uncertain, a throttled read is not', async () => {
  let steps = through(journey(), 'create-version');
  at(steps, 'create-version').status = 429;
  at(steps, 'create-version').reply = { errors: [{ code: 'RATE_LIMIT_EXCEEDED', detail: 'not recorded' }] };
  let { last } = await stops(steps, 'APPLE_HTTP_REJECTED', { state: 'uncertain' });
  assert.equal(last.httpStatus, 429);
  assert.equal(last.mutationAttempted, true);
  assert.deepEqual(last.appleErrors, ['RATE_LIMIT_EXCEEDED']);

  steps = through(journey({ create: false, attached: 'build12', releaseType: RELEASE_TYPE }), 'update-whats-new');
  at(steps, 'update-whats-new').transportError = true;
  ({ last } = await stops(steps, 'TRANSPORT_OUTCOME_UNKNOWN', { state: 'uncertain' }));
  assert.equal(last.stage, 'update-whats-new');

  steps = through(journey(), 'read-app');
  at(steps, 'read-app').status = 429;
  ({ last } = await stops(steps, 'APPLE_HTTP_REJECTED'));
  assert.equal(last.mutationAttempted, false);
});

test('a list with another page is refused rather than guessed', async () => {
  const steps = through(journey(), 'read-app');
  at(steps, 'read-app').reply = { ...appsReply(), links: { next: `${API}/v1/apps?cursor=x` } };
  await stops(steps, 'PAGINATION_REFUSED');
});

test('text over the App Store limit is refused before any request, never truncated', async () => {
  const long = `- ${'a'.repeat(3998)}\n`.slice(0, 4001);
  assert.throws(() => approvedStoreText(JSON.stringify({ version: VERSION, locale: 'en-us', text: long }), VERSION,
    'app-store'), StoreTextError);
  const harness = fixture([]);
  await assert.rejects(transact(spec('Submit', 'x'.repeat(4001)), { fetchImpl: harness.fetchImpl, token: BEARER,
    record: harness.record, mode: 'Submit' }), (error) => error.code === 'APPROVED_TEXT_REQUIRED');
  await assert.rejects(plan(spec('Inspect', 'x'.repeat(4001)), { fetchImpl: harness.fetchImpl, token: BEARER,
    record: harness.record }), (error) => error.code === 'APPROVED_TEXT_REQUIRED');
  assert.equal(harness.calls.length, 0);
});

// The workflow is read as text, as the other release workflow tests do, so no YAML parser is needed.
const jobText = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, name);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};
const stepsOf = (job) => job.split(/\n {6}- /).slice(1);
const minutes = (text) => Number(/timeout-minutes: (\d+)/.exec(text)?.[1]);

test('the workflow is manual only and accepts no input that could carry text', () => {
  const on = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:\n'));
  assert.deepEqual(on.match(/^ {2}\S.*$/gm), ['  workflow_dispatch:']);
  assert.deepEqual(on.match(/^ {6}\S.*$/gm), ['      mode:', '      version:', '      build_number:']);
  assert.match(on, /options: \[Validate, Inspect, Submit\]\n\s+default: Validate/);
  assert.doesNotMatch(workflow, /pull_request|^\s+push:|schedule:|workflow_run:/m);
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n/m);
  assert.match(workflow, /concurrency:\n {2}group: app-store-release\n {2}cancel-in-progress: false\n/);
});

test('only the store job is protected and only its operation step sees Apple secrets', () => {
  const validate = jobText('validate');
  const store = jobText('store');
  assert.deepEqual(workflow.match(/^ {4}environment: .*$/gm), [`    environment: ${ENVIRONMENT}`]);
  assert.ok(store.includes(`    environment: ${ENVIRONMENT}\n`));
  assert.ok(!validate.includes('secrets.'));
  for (const part of ["github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'",
    "inputs.mode != 'Validate'", `needs.validate.outputs.environment == '${ENVIRONMENT}'`]) {
    assert.ok(store.includes(part), part);
  }
  const secretSteps = stepsOf(store).filter((step) => step.includes('secrets.'));
  assert.equal(secretSteps.length, 1);
  assert.match(secretSteps[0], /node scripts\/app-store-release\.mjs "\$RECAP_ASC_OPERATION"/);
  assert.deepEqual(secretSteps[0].match(/secrets\.\w+/g), ['secrets.ASC_PRIVATE_KEY', 'secrets.ASC_KEY_ID',
    'secrets.ASC_ISSUER_ID']);
  assert.equal(workflow.match(/secrets\./g).length, 3);
  assert.match(stepsOf(store).at(-1), /if: always\(\)[\s\S]*retention-days: 30[\s\S]*app-store-receipt\.json/);
  assert.match(store, /approvals|approved-validate/);
});

test('every action is pinned by SHA and every step and job has a deadline', () => {
  const uses = workflow.match(/uses: .*/g);
  assert.ok(uses.length >= 5);
  for (const line of uses) assert.match(line, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  for (const line of workflow.match(/actions\/checkout@.*/g)) assert.ok(line.endsWith('# v7.0.1'));
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  for (const name of ['validate', 'store']) {
    const job = jobText(name);
    const steps = stepsOf(job);
    const total = steps.reduce((sum, step) => {
      assert.ok(minutes(step) > 0, `${name} step lacks a deadline: ${step.split('\n')[0]}`);
      return sum + minutes(step);
    }, 0);
    assert.ok(minutes(job.split(/\n {4}steps:\n/)[0]) > total, `${name} job deadline exceeds its steps`);
  }
});
