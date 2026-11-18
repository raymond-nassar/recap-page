import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENVIRONMENT, WORKFLOW, PRODUCTION_ROLLOUT_STATUS, validateRequest, selectReservation, desiredProduction,
  bindingFor, planPromotion, transactProduction, validateInvocation,
} from '../scripts/google-play-production.mjs';
import { REPOSITORY_ID, digest } from '../scripts/google-play-publisher.mjs';

const ledger = JSON.parse(readFileSync(new URL('../packaging/android/version-codes.json', import.meta.url), 'utf8'));
const NOTES = '- Compatible reading improvements.';
const SHA = 'a'.repeat(40);
const reservation = selectReservation(ledger, '4.6.0');
const binding = bindingFor({ version: '4.6.0', reservation, notes: NOTES, description: null, workflowSha: SHA });
const testing = (code = 3000018, notes = NOTES, status = 'completed') => ({
  track: 'internal',
  releases: [{ name: 'Recap Page 4.6.0', versionCodes: [String(code)], status,
    releaseNotes: [{ language: 'en-US', text: notes }] }],
});
const production = (code = 3000017) => ({
  track: 'production',
  releases: [{ name: 'Recap Page 4.5.0', versionCodes: [String(code)], status: 'completed',
    releaseNotes: [{ language: 'en-US', text: '- Earlier.' }] }],
});
const bundle = (sha256 = reservation.artifact.sha256) => ({ versionCode: 3000018, sha1: 'b'.repeat(40), sha256 });
const plan = (overrides = {}) => planPromotion({
  tracks: [testing(), production()], bundles: [bundle()], reservation, notes: NOTES, version: '4.6.0', ...overrides,
});

test('the request carries only a mode and a version, so notes cannot be typed at dispatch', () => {
  assert.deepEqual(validateRequest({ mode: 'Publish', version: '4.6.0' }), { mode: 'Publish', version: '4.6.0' });
  assert.throws(() => validateRequest({ mode: 'Publish', version: '4.6.0', release_notes: 'typed' }), /UNEXPECTED_FIELDS/);
  assert.throws(() => validateRequest({ mode: 'Promote', version: '4.6.0' }), /PRODUCTION_MODE_REQUIRED/);
  assert.throws(() => validateRequest({ mode: 'Publish', version: '4.6' }), /PRODUCT_VERSION_REQUIRED/);
});

test('the newest sealed reservation is chosen and a later unsealed one for the version is refused', () => {
  assert.equal(reservation.versionCode, 3000018);
  const reserved = structuredClone(ledger);
  const last = reserved.reservations.at(-1);
  reserved.reservations.push({ versionCode: last.versionCode + 1, productVersion: '4.6.0',
    sourceRevision: last.sourceRevision, sourceTree: last.sourceTree, artifact: null });
  assert.throws(() => selectReservation(reserved, '4.6.0'), /NEWER_UNSEALED_RESERVATION_FOR_VERSION/);
  assert.throws(() => selectReservation(ledger, '9.9.9'), /SEALED_RESERVATION_FOR_VERSION_REQUIRED/);
});

test('production goes to everyone at once with the approved notes', () => {
  assert.equal(PRODUCTION_ROLLOUT_STATUS, 'completed');
  const release = desiredProduction('4.6.0', 3000018, NOTES).releases[0];
  assert.equal(release.status, 'completed');
  assert.equal(release.userFraction, undefined);
  assert.deepEqual(release.releaseNotes, [{ language: 'en-US', text: NOTES }]);
  assert.equal(binding.notesSha256, digest(NOTES));
  assert.equal(binding.notesPath, 'docs/releases/4.6.0-store.json');
  assert.equal(binding.descriptionSha256, null);
});

test('promotion is planned only when Play agrees with the sealed ledger and the approved text', () => {
  const ok = plan();
  assert.deepEqual(ok.testingTracks, ['internal']);
  assert.equal(ok.desired.releases[0].versionCodes[0], '3000018');
  const refusals = [
    [{ bundles: [] }, /BUNDLE_NOT_IN_PLAY/],
    [{ bundles: [bundle('c'.repeat(64))] }, /PLAY_BUNDLE_DIGEST_DIFFERS_FROM_SEAL/],
    [{ bundles: [{ versionCode: 3000018, sha1: 'b'.repeat(40) }] }, /PLAY_BUNDLE_DIGEST_DIFFERS_FROM_SEAL/],
    [{ tracks: [testing(), production(3000018)] }, /CODE_ALREADY_IN_PRODUCTION/],
    [{ tracks: [production()] }, /CODE_NOT_ON_COMPLETED_TESTING_RELEASE/],
    [{ tracks: [testing(3000018, NOTES, 'draft'), production()] }, /CODE_NOT_ON_COMPLETED_TESTING_RELEASE/],
    [{ tracks: [testing(3000018, '- Typed by hand.'), production()] }, /TESTING_NOTES_DIFFER_FROM_APPROVED_TEXT/],
    [{ tracks: [testing(), production(3000019)] }, /PRODUCTION_ALREADY_AT_OR_ABOVE_CODE/],
  ];
  for (const [overrides, code] of refusals) assert.throws(() => plan(overrides), code);
  const staged = production();
  staged.releases[0].status = 'inProgress';
  staged.releases[0].userFraction = 0.2;
  assert.throws(() => plan({ tracks: [testing(), staged] }), /COMPLEX_PRODUCTION_REQUIRES_OPERATOR_RECONCILIATION/);
});

function fakePlay({ committed = null, fail = null, listings = null, listingReadback = null, committedListings = null } = {}) {
  const calls = [];
  const receipts = [];
  let edits = 0;
  let stored = [testing(), production()];
  let storedListings = listings;
  const fetchImpl = async (url, init) => {
    const method = init.method;
    const path = url.replace(/^https:\/\/androidpublisher\.googleapis\.com\/androidpublisher\/v3\/applications\/[^/]+/, '');
    calls.push(`${method} ${path}`);
    assert.equal(receipts.at(-1).httpStatus, null, 'a receipt is saved before every request');
    const failure = fail?.(method, path);
    if (failure) return failure();
    const json = (value) => new Response(JSON.stringify(value), { status: 200 });
    if (method === 'POST' && path === '/edits') {
      edits += 1;
      return json({ id: `edit-${edits}`, expiryTimeSeconds: String(4e9) });
    }
    if (method === 'GET' && path.endsWith('/tracks')) return json({ tracks: stored });
    if (method === 'GET' && path.endsWith('/bundles')) return json({ bundles: [bundle()] });
    if (method === 'GET' && path.endsWith('/listings')) {
      const list = edits === 2 && committedListings ? committedListings(storedListings)
        : listingReadback && calls.some((call) => call.startsWith('PATCH ')) ? listingReadback(storedListings)
          : storedListings;
      return json({ listings: list });
    }
    if (method === 'PATCH' && path.endsWith('/listings/en-US')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ['fullDescription']);
      storedListings = storedListings.map((item) => item.language === 'en-US' ? { ...item, ...body } : item);
      return json(storedListings.find((item) => item.language === 'en-US'));
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      stored = [stored[0], body];
      return json(body);
    }
    if (method === 'POST' && path.endsWith(':validate')) return json({ id: 'edit-1' });
    if (method === 'POST' && path.includes(':commit')) {
      if (committed) stored = committed(stored);
      return json({ id: 'edit-1' });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${method} ${path}`);
  };
  const options = { token: 'token', fetchImpl, notes: NOTES, description: null,
    record: async (receipt) => { receipts.push(receipt); } };
  return { calls, receipts, options };
}

test('Inspect reads Play and discards its edit without changing anything', async () => {
  const play = fakePlay();
  const result = await transactProduction(binding, { ...play.options, mode: 'Inspect' });
  assert.equal(result.state, 'inspected-no-release-change');
  assert.equal(result.mutationAttempted, false);
  assert.deepEqual(play.calls, ['POST /edits', 'GET /edits/edit-1/tracks', 'GET /edits/edit-1/bundles', 'DELETE /edits/edit-1']);
});

test('Publish promotes, reads back before committing and again from a fresh edit after', async () => {
  const play = fakePlay();
  const result = await transactProduction(binding, { ...play.options, mode: 'Publish' });
  assert.deepEqual(play.calls, [
    'POST /edits', 'GET /edits/edit-1/tracks', 'GET /edits/edit-1/bundles', 'PUT /edits/edit-1/tracks/production',
    'GET /edits/edit-1/tracks', 'POST /edits/edit-1:validate',
    'POST /edits/edit-1:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW',
    'POST /edits', 'GET /edits/edit-2/tracks', 'DELETE /edits/edit-2',
  ]);
  assert.equal(result.state, 'submitted-production-review-unverified');
  assert.equal(result.productionAfter.releases[0].releaseNotes[0].text, NOTES);
  assert.equal(result.productionBefore.releases[0].versionCodes[0], '3000017');
});

test('a committed production that reads back differently is reported, never called a success', async () => {
  const play = fakePlay({ committed: (tracks) => [tracks[0], production()] });
  await assert.rejects(transactProduction(binding, { ...play.options, mode: 'Publish' }), /COMMITTED_PRODUCTION_DIFFERS/);
  assert.equal(play.receipts.at(-1).state, 'committed-readback-unverified');
});

test('a lost commit response is uncertain and a refused read before any change is blocked', async () => {
  const lost = fakePlay({ fail: (method, path) => path.includes(':commit') && (() => Promise.reject(new Error('reset'))) });
  await assert.rejects(transactProduction(binding, { ...lost.options, mode: 'Publish' }), /TRANSPORT_OUTCOME_UNKNOWN/);
  assert.equal(lost.receipts.at(-1).state, 'uncertain');
  assert.equal(lost.receipts.at(-1).mutationAttempted, true);
  const refused = fakePlay({ fail: (method, path) => path.endsWith('/bundles') && (() => new Response('x', { status: 403 })) });
  await assert.rejects(transactProduction(binding, { ...refused.options, mode: 'Publish' }), /PLAY_HTTP_REJECTED/);
  assert.equal(refused.receipts.at(-1).state, 'blocked');
  assert.equal(refused.receipts.at(-1).mutationAttempted, false);
  assert.equal(refused.calls.some((call) => call.startsWith('PUT')), false);
});

test('notes that changed after binding stop before Google is contacted', async () => {
  const play = fakePlay();
  await assert.rejects(transactProduction(binding, { ...play.options, notes: '- Changed.', mode: 'Publish' }),
    /BINDING_CHANGED_BEFORE_OPERATION/);
  assert.equal(play.calls.length, 0);
});

test('production updates only the English description and checks all listings before and after commit', async () => {
  const description = 'Fake approved Play description';
  const withDescription = bindingFor({ version: '4.6.0', reservation, notes: NOTES, description, workflowSha: SHA });
  const listings = [{ language: 'en-US', title: 'Fake title', shortDescription: 'Fake short', fullDescription: 'Fake old' },
    { language: 'fr-FR', title: 'Fake French title', fullDescription: 'Fake French description' }];
  const play = fakePlay({ listings });
  const result = await transactProduction(withDescription, { ...play.options, description, mode: 'Publish' });
  assert.equal(result.listingBefore.fullDescription, 'Fake old');
  assert.equal(result.listingAfter.fullDescription, description);
  assert.ok(play.calls.indexOf('GET /edits/edit-1/listings') < play.calls.indexOf('PUT /edits/edit-1/tracks/production'));
  assert.ok(play.calls.indexOf('PATCH /edits/edit-1/listings/en-US') < play.calls.indexOf('POST /edits/edit-1:validate'));
  assert.ok(play.calls.includes('GET /edits/edit-2/listings'));

  for (const listingReadback of [
    (items) => items.map((item) => item.language === 'en-US' ? { ...item, fullDescription: 'Different' } : item),
    (items) => items.map((item) => item.language === 'en-US' ? { ...item, shortDescription: 'Different' } : item),
    (items) => items.map((item) => item.language === 'fr-FR' ? { ...item, title: 'Changed' } : item),
    (items) => items.filter((item) => item.language !== 'fr-FR'),
  ]) {
    const wrong = fakePlay({ listings, listingReadback });
    await assert.rejects(transactProduction(withDescription, { ...wrong.options, description, mode: 'Publish' }),
      /LISTING_READBACK_MISMATCH/);
    assert.equal(wrong.calls.some((call) => call.includes(':validate') || call.includes(':commit')), false);
    assert.equal(wrong.receipts.at(-1).state, 'blocked');
  }

  const committedWrong = fakePlay({ listings, committedListings: (items) =>
    items.map((item) => item.language === 'en-US' ? { ...item, fullDescription: 'Different' } : item) });
  await assert.rejects(transactProduction(withDescription, { ...committedWrong.options, description, mode: 'Publish' }),
    /COMMITTED_LISTING_DIFFERS/);
  assert.equal(committedWrong.receipts.at(-1).state, 'committed-readback-unverified');
});

test('description binding and ambiguous English listings fail closed', async () => {
  const description = 'Fake approved Play description';
  const withDescription = bindingFor({ version: '4.6.0', reservation, notes: NOTES, description, workflowSha: SHA });
  const wrongBinding = fakePlay();
  await assert.rejects(transactProduction(withDescription, { ...wrongBinding.options, description: 'Changed', mode: 'Publish' }),
    /BINDING_CHANGED_BEFORE_OPERATION/);
  assert.equal(wrongBinding.calls.length, 0);
  const duplicate = fakePlay({ listings: [{ language: 'en-US' }, { language: 'en-us' }] });
  await assert.rejects(transactProduction(withDescription, { ...duplicate.options, description, mode: 'Publish' }),
    /ONE_EN_US_LISTING_REQUIRED/);
  assert.equal(duplicate.calls.some((call) => call.startsWith('PUT')), false);
  const inspect = fakePlay({ listings: [{ language: 'en-US', fullDescription: 'Fake old' }] });
  const result = await transactProduction(withDescription, { ...inspect.options, description, mode: 'Inspect' });
  assert.equal(result.state, 'inspected-no-release-change');
  assert.equal(inspect.calls.some((call) => call.startsWith('PATCH')), false);
  const invalid = fakePlay();
  await assert.rejects(transactProduction(withDescription, { ...invalid.options, description: 'x'.repeat(4001), mode: 'Publish' }),
    /APPROVED_DESCRIPTION_REQUIRED/);
  assert.equal(invalid.calls.length, 0);
  const matching = fakePlay({ listings: [{ language: 'en-US', fullDescription: description }] });
  await transactProduction(withDescription, { ...matching.options, description, mode: 'Publish' });
  assert.equal(matching.calls.some((call) => call.startsWith('PATCH')), false);
  assert.ok(matching.calls.includes('GET /edits/edit-2/listings'));
});

test('only a first-attempt manual dispatch of this workflow on main is accepted', () => {
  const context = { repository: 'raymond-nassar/recap-page', event: 'workflow_dispatch', ref: 'refs/heads/main',
    attempt: 1, workflowSha: SHA, sha: SHA, runId: 7,
    workflowRef: `raymond-nassar/recap-page/${WORKFLOW}@refs/heads/main` };
  const run = { id: 7, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main', head_sha: SHA,
    path: WORKFLOW, repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID } };
  validateInvocation(context, run);
  assert.throws(() => validateInvocation({ ...context, attempt: 2 }, run), /MANUAL_MAIN_FIRST_ATTEMPT_REQUIRED/);
  assert.throws(() => validateInvocation(context, { ...run, path: '.github/workflows/google-play-release.yml' }),
    /WORKFLOW_IDENTITY_MISMATCH/);
});

test('the workflow is dispatch-only, gated by the production environment and its own credential', () => {
  const text = readFileSync(new URL('../.github/workflows/google-play-production.yml', import.meta.url), 'utf8');
  const on = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|push:|schedule:|workflow_run/);
  const inputs = [...on.matchAll(/^ {6}([a-z_]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(inputs, ['mode', 'version']);
  assert.match(text, /options: \[Validate, Inspect, Publish\]/);
  assert.equal(ENVIRONMENT, 'google-play-production');
  assert.match(text, /needs\.preflight\.outputs\.environment == 'google-play-production'/);
  assert.match(text, /environment: \$\{\{ needs\.preflight\.outputs\.environment \}\}/);
  assert.match(text, /vars\.GOOGLE_PLAY_PRODUCTION_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(text, /vars\.GOOGLE_PLAY_PRODUCTION_SERVICE_ACCOUNT/);
  assert.doesNotMatch(text, /vars\.GOOGLE_PLAY_(WORKLOAD|SERVICE)/);
  assert.doesNotMatch(text, /secrets\./);
  const approved = text.indexOf('approved-preflight');
  assert.ok(approved > 0 && approved < text.indexOf('google-github-actions/auth'), 'approval is rechecked before auth');
  for (const line of text.split('\n').filter((value) => /uses:/.test(value))) {
    assert.match(line, /@[0-9a-f]{40} # v\d/, line);
  }
});
