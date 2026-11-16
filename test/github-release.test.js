import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import {
  ASSET, RECORD, MAKE_LATEST, RELEASE_BODY_STYLE, BODY_LIMIT, STABLE_DOWNLOAD, ReleaseError,
  validateIntent, validateInvocation, validatePreparationRun, selectPreparationArtifact,
  validatePreparationRecord, releaseBody, binding, readZip, assertUnreleased, transact, digest,
} from '../scripts/github-release.mjs';

const REPO = 'raymond-nassar/recap-page';
const REPO_ID = 1322551430;
const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
// Deliberately short: this is a fixture, not a credential.
const TOKEN = 'fixture-gh';
const API = `https://api.github.com/repos/${REPO}`;

const CHANGELOG = [
  '# Changelog', '', '## Unreleased', '', '## 4.7.0', '', '### What\'s new for readers', '',
  '- Faster restore.', '- Clearer badges.', '', '### Saved data and upgrading', '', '- Nothing changes.', '',
  '## 4.6.0', '', '### What\'s new for readers', '', '- Older.', '',
].join('\r\n');

test('the owner decisions are one named constant each', () => {
  assert.equal(RELEASE_BODY_STYLE, 'summary-and-link');
  assert.equal(MAKE_LATEST, 'true');
});

test('releaseBody takes the first section verbatim and links the changelog at the commit', () => {
  assert.equal(releaseBody(CHANGELOG, '4.7.0', COMMIT),
    '### What\'s new for readers\n\n- Faster restore.\n- Clearer badges.\n\n'
    + `[Read the full changelog](https://github.com/${REPO}/blob/${COMMIT}/CHANGELOG.md#470).`);
  assert.equal(releaseBody(CHANGELOG, '4.6.0', COMMIT, 'summary'), '### What\'s new for readers\n\n- Older.');
});

test('releaseBody stops on a missing version, an empty first section or an oversized body', () => {
  const code = (expected) => (error) => error instanceof ReleaseError && error.code === expected;
  assert.throws(() => releaseBody(CHANGELOG, '4.8.0', COMMIT), code('CHANGELOG_VERSION_SECTION_REQUIRED'));
  assert.throws(() => releaseBody('## 4.7.0\n\n### What\'s new for readers\n\n\n### Saved data\n\n- x\n', '4.7.0', COMMIT),
    code('CHANGELOG_READER_SUMMARY_REQUIRED'));
  assert.throws(() => releaseBody('## 4.7.0\n\nNo sections.\n', '4.7.0', COMMIT), code('CHANGELOG_READER_SUMMARY_REQUIRED'));
  const huge = `## 4.7.0\n\n### What's new for readers\n\n${'x'.repeat(BODY_LIMIT)}\n`;
  assert.throws(() => releaseBody(huge, '4.7.0', COMMIT), code('RELEASE_BODY_TOO_LONG'));
});

test('intent accepts exactly the three inputs in strict forms', () => {
  assert.deepEqual(validateIntent({ mode: 'Publish', version: '4.7.0', preparation_run_id: '123' }),
    { mode: 'Publish', version: '4.7.0', preparationRunId: 123, tag: 'v4.7.0', name: 'Recap Page 4.7.0' });
  for (const raw of [
    { mode: 'publish', version: '4.7.0', preparation_run_id: '1' },
    { mode: 'Validate', version: 'v4.7.0', preparation_run_id: '1' },
    { mode: 'Validate', version: '4.07.0', preparation_run_id: '1' },
    { mode: 'Validate', version: '4.7.0', preparation_run_id: '0' },
    { mode: 'Validate', version: '4.7.0', preparation_run_id: '1', body: 'typed' },
    { mode: 'Validate', version: '4.7.0' },
  ]) assert.throws(() => validateIntent(raw), ReleaseError);
});

const ownRun = { id: 9, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main', head_sha: COMMIT,
  path: '.github/workflows/github-release.yml', repository: { id: REPO_ID }, head_repository: { id: REPO_ID } };
const context = { repository: REPO, event: 'workflow_dispatch', ref: 'refs/heads/main', defaultBranch: 'main',
  attempt: 1, workflowSha: COMMIT, sha: COMMIT, workflowRef: `${REPO}/.github/workflows/github-release.yml@refs/heads/main`, runId: 9 };

test('invocation must be a first-attempt manual run of this workflow on main', () => {
  assert.doesNotThrow(() => validateInvocation(context, ownRun));
  assert.throws(() => validateInvocation({ ...context, attempt: 2 }, ownRun), ReleaseError);
  assert.throws(() => validateInvocation({ ...context, ref: 'refs/heads/topic' }, ownRun), ReleaseError);
  assert.throws(() => validateInvocation(context, { ...ownRun, path: '.github/workflows/ci.yml' }), ReleaseError);
});

const prepRun = { id: 500, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main', status: 'completed',
  conclusion: 'success', head_sha: COMMIT, path: '.github/workflows/wack.yml',
  repository: { id: REPO_ID }, head_repository: { id: REPO_ID } };

test('the preparation run must be a successful first-attempt manual wack run on main', () => {
  assert.equal(validatePreparationRun(500, prepRun), COMMIT);
  for (const change of [{ path: '.github/workflows/ci.yml' }, { conclusion: 'failure' }, { status: 'in_progress' },
    { head_branch: 'release' }, { run_attempt: 2 }, { event: 'push' }, { id: 501 }, { head_repository: { id: 1 } }]) {
    assert.throws(() => validatePreparationRun(500, { ...prepRun, ...change }),
      (error) => error.code === 'QUALIFIED_PREPARATION_RUN_REQUIRED');
  }
});

const NOW = Date.parse('2026-12-01T12:00:00Z');
const artifact = (change = {}) => ({ id: 70, name: `portable-candidate-${COMMIT}`, size_in_bytes: 1000,
  digest: `sha256:${'c'.repeat(64)}`, expired: false, expires_at: '2026-12-02T00:00:00Z',
  workflow_run: { id: 500, head_sha: COMMIT, head_branch: 'main', repository_id: REPO_ID, head_repository_id: REPO_ID },
  ...change });
const listing = (...items) => ({ total_count: items.length, artifacts: items });

test('artifact selection takes the one unexpired portable candidate for the run commit', () => {
  assert.equal(selectPreparationArtifact(prepRun, listing(artifact(), { name: 'other' }), NOW).id, 70);
  assert.throws(() => selectPreparationArtifact(prepRun, listing(artifact(), artifact({ id: 71 })), NOW),
    (error) => error.code === 'ONE_PREPARATION_ARTIFACT_REQUIRED');
  assert.throws(() => selectPreparationArtifact(prepRun, listing(artifact({ workflow_run: { id: 1 } })), NOW),
    (error) => error.code === 'PREPARATION_ARTIFACT_MISMATCH');
});

test('an expired or missing artifact stops and asks for a fresh preparation run within a day', () => {
  for (const items of [[artifact({ expired: true })], [artifact({ expires_at: '2026-12-01T11:59:59Z' })], []]) {
    assert.throws(() => selectPreparationArtifact(prepRun, listing(...items), NOW), (error) =>
      error.code === 'PREPARATION_ARTIFACT_MISSING_OR_EXPIRED' && /within a day/.test(error.message)
      && /fresh/.test(error.message));
  }
});

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = (c >>> 8) ^ CRC[(c ^ b) & 0xff]; return (c ^ 0xffffffff) >>> 0; };
// Writes deflated entries with data descriptors, the shape upload-artifact streams.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.from(content);
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(nameBytes.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc32(raw), 4);
    descriptor.writeUInt32LE(packed.length, 8); descriptor.writeUInt32LE(raw.length, 12);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed, descriptor);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length + 16;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const WINDOWS_ZIP = Buffer.from('portable archive bytes');
const goodRecord = () => ({
  schemaVersion: 1, repository: REPO, commit: COMMIT, tree: 'd'.repeat(40), applicationVersion: '4.7.0',
  workflow: { runId: '500', runAttempt: '1' },
  archive: { file: ASSET, bytes: WINDOWS_ZIP.length, sha256: digest(WINDOWS_ZIP) },
  bundledNode: { version: 'v24.11.1', architecture: 'win-x64', sha256: 'e'.repeat(64) },
  portableLauncher: 'Start on Windows.cmd', configurationSha256: 'f'.repeat(64),
});

test('the artifact reader returns exactly the stored files and rejects extras and damage', () => {
  const packed = makeZip([[ASSET, WINDOWS_ZIP], [RECORD, JSON.stringify(goodRecord())]]);
  const files = readZip(packed);
  assert.deepEqual([...files.keys()], [ASSET, RECORD]);
  assert.ok(files.get(ASSET).equals(WINDOWS_ZIP));
  assert.throws(() => readZip(makeZip([[ASSET, 'a'], [RECORD, 'b'], ['extra.txt', 'c']])), ReleaseError);
  assert.throws(() => readZip(makeZip([['../evil', 'a']])), ReleaseError);
  const damaged = Buffer.from(packed);
  damaged[40] ^= 0xff;
  assert.throws(() => readZip(damaged), ReleaseError);
});

test('the preparation record must name this commit, version, run and archive bytes', () => {
  const names = [ASSET, RECORD];
  const check = (record, extra = {}) => validatePreparationRecord(record,
    { run: prepRun, version: '4.7.0', names, zip: WINDOWS_ZIP, ...extra });
  assert.equal(check(goodRecord()).sha256, digest(WINDOWS_ZIP));
  assert.throws(() => check({ ...goodRecord(), commit: OTHER }), (e) => e.code === 'PREPARATION_RECORD_IDENTITY_MISMATCH');
  assert.throws(() => check({ ...goodRecord(), applicationVersion: '4.6.0' }), (e) => e.code === 'PREPARATION_RECORD_IDENTITY_MISMATCH');
  assert.throws(() => check({ ...goodRecord(), archive: { ...goodRecord().archive, sha256: '0'.repeat(64) } }),
    (e) => e.code === 'PREPARATION_ARCHIVE_MISMATCH');
  assert.throws(() => check({ ...goodRecord(), workflow: { runId: 500, runAttempt: '1' } }), (e) => e.code === 'PREPARATION_RECORD_RUN_MISMATCH');
  assert.throws(() => check(goodRecord(), { names: [...names, 'extra.txt'] }), (e) => e.code === 'EXACT_PREPARATION_FILES_REQUIRED');
  assert.throws(() => check({ ...goodRecord(), note: 'x' }), (e) => e.code === 'PREPARATION_RECORD_SHAPE');
});

test('binding covers every approved field', () => {
  const base = { version: '4.7.0', commit: COMMIT, body: 'b', zipSha256: 'c'.repeat(64), zipBytes: 3, preparationRunId: 500 };
  const values = new Set([binding(base), ...Object.keys(base).map((key) =>
    binding({ ...base, [key]: typeof base[key] === 'number' ? base[key] + 1 : `${base[key]}x` }))]);
  assert.equal(values.size, 7);
});

test('an existing tag or a release naming the tag stops before any write', () => {
  assert.throws(() => assertUnreleased({ ref: 'refs/tags/v4.7.0' }, [], 'v4.7.0'), (e) => e.code === 'TAG_ALREADY_EXISTS');
  assert.throws(() => assertUnreleased(null, [{ tag_name: 'v4.7.0', draft: true }], 'v4.7.0'), (e) => e.code === 'RELEASE_ALREADY_EXISTS');
  assert.doesNotThrow(() => assertUnreleased(null, [{ tag_name: 'v4.6.0' }], 'v4.7.0'));
});

const BODY = releaseBody(CHANGELOG, '4.7.0', COMMIT);
const PLAN = { version: '4.7.0', commit: COMMIT, body: BODY, zipSha256: digest(WINDOWS_ZIP),
  zipBytes: WINDOWS_ZIP.length, preparationRunId: 500 };
const ASSET_URL = `https://github.com/${REPO}/releases/download/v4.7.0/${ASSET}`;
const release = (draft, assets = []) => ({ id: 77, tag_name: 'v4.7.0', target_commitish: COMMIT, name: 'Recap Page 4.7.0',
  body: BODY, draft, prerelease: false, assets,
  upload_url: `https://uploads.github.com/repos/${REPO}/releases/77/assets{?name,label}` });
// GitHub serves a draft's assets from an untagged- address until the release is published.
const uploadedAsset = { id: 88, name: ASSET, state: 'uploaded', size: WINDOWS_ZIP.length,
  digest: `sha256:${digest(WINDOWS_ZIP)}`,
  browser_download_url: `https://github.com/${REPO}/releases/download/untagged-0123456789abcdef0123/${ASSET}` };
const publishedAsset = { ...uploadedAsset, browser_download_url: ASSET_URL };

function happySteps() {
  return [
    ['GET', `${API}/git/ref/tags/v4.7.0`, 404, { message: 'Not Found' }],
    ['GET', `${API}/releases?per_page=100&page=1`, 200, [{ tag_name: 'v4.6.0', draft: false }]],
    ['POST', `${API}/releases`, 201, { id: 77 }],
    ['GET', `${API}/releases/77`, 200, release(true)],
    ['POST', `https://uploads.github.com/repos/${REPO}/releases/77/assets?name=${ASSET}`, 201, { id: 88 }],
    ['GET', `${API}/releases/77/assets?per_page=100`, 200, [uploadedAsset]],
    ['PATCH', `${API}/releases/77`, 200, { id: 77 }],
    ['GET', `${API}/releases/tags/v4.7.0`, 200, release(false, [publishedAsset])],
    ['GET', `${API}/git/ref/tags/v4.7.0`, 200, { ref: 'refs/tags/v4.7.0', object: { type: 'commit', sha: COMMIT } }],
    ['GET', `${API}/releases/latest`, 200, { id: 77 }],
    ['GET', ASSET_URL, 200, WINDOWS_ZIP],
    ['GET', STABLE_DOWNLOAD, 200, WINDOWS_ZIP],
  ];
}

function harness(steps) {
  const calls = [];
  const receipts = [];
  const fetchImpl = async (url, options) => {
    const step = steps[calls.length];
    calls.push({ method: options.method, url, options });
    assert.ok(step, `unexpected request ${options.method} ${url}`);
    if (step === 'throw') throw new TypeError('network down');
    const [method, expected, status, payload] = step;
    assert.equal(options.method, method);
    assert.equal(url, expected);
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    return new Response(bytes, { status });
  };
  const run = () => transact({ plan: PLAN, zip: WINDOWS_ZIP, token: TOKEN, fetchImpl,
    record: async (receipt) => { receipts.push(receipt); } });
  return { calls, receipts, run };
}
const stopped = async (run, code) => {
  let caught;
  await assert.rejects(run, (error) => { caught = error; return error.code === code; });
  return caught;
};

test('publish creates a draft, uploads, verifies, publishes and reads every part back in order', async () => {
  const steps = happySteps();
  const { calls, receipts, run } = harness(steps);
  const result = await run();
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), steps.map(([m, u]) => `${m} ${u}`));
  assert.deepEqual(JSON.parse(calls[2].options.body), { tag_name: 'v4.7.0', target_commitish: COMMIT,
    name: 'Recap Page 4.7.0', body: BODY, draft: true, prerelease: false });
  assert.ok(calls[4].options.body.equals(WINDOWS_ZIP));
  assert.equal(calls[4].options.headers['Content-Type'], 'application/zip');
  assert.deepEqual(JSON.parse(calls[6].options.body), { draft: false, make_latest: 'true' });
  for (const call of calls.slice(0, 10)) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
  }
  for (const call of calls.slice(10)) {
    assert.equal(call.options.redirect, 'follow');
    assert.equal(call.options.headers.Authorization, undefined);
  }
  assert.equal(result.state, 'published-verified');
  assert.equal(result.releaseId, 77);
  assert.equal(result.assetId, 88);
  assert.ok(receipts.length >= calls.length);
  assert.ok(!JSON.stringify(receipts).includes(TOKEN));
});

const replace = (index, step) => { const steps = happySteps(); steps.splice(index, steps.length - index, step); return steps; };
const swap = (index, payload, status = 200) => {
  const steps = happySteps().slice(0, index + 1);
  steps[index] = [steps[index][0], steps[index][1], status, payload];
  return steps;
};

test('an existing tag stops before any write', async () => {
  const { calls, receipts, run } = harness(swap(0, { ref: 'refs/tags/v4.7.0', object: { type: 'commit', sha: OTHER } }).concat([happySteps()[1]]));
  await stopped(run, 'TAG_ALREADY_EXISTS');
  assert.ok(calls.every((call) => call.method === 'GET'));
  assert.equal(receipts.at(-1).state, 'blocked');
  assert.equal(receipts.at(-1).mutationAttempted, false);
});

test('an existing draft for the tag stops before any write', async () => {
  const { calls, receipts, run } = harness(swap(1, [{ tag_name: 'v4.7.0', draft: true }]));
  await stopped(run, 'RELEASE_ALREADY_EXISTS');
  assert.equal(calls.length, 2);
  assert.equal(receipts.at(-1).state, 'blocked');
});

test('a published asset that is not served at the tagged address stops as uncertain before any download', async () => {
  const { calls, receipts, run } = harness(swap(7, release(false, [uploadedAsset])));
  await stopped(run, 'ASSET_URL_MISMATCH');
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.ok(!calls.some((call) => call.url === ASSET_URL));
  assert.equal(receipts.at(-1).state, 'uncertain');
});

test('an asset digest that differs stops as uncertain and never publishes', async () => {
  const { calls, receipts, run } = harness(swap(5, [{ ...uploadedAsset, digest: `sha256:${'0'.repeat(64)}` }]));
  await stopped(run, 'ASSET_DIGEST_MISMATCH');
  assert.ok(!calls.some((call) => call.method === 'PATCH'));
  assert.equal(receipts.at(-1).state, 'uncertain');
  assert.equal(receipts.at(-1).releaseId, 77);
});

test('a missing asset digest stops rather than skipping the check', async () => {
  const withoutDigest = { ...uploadedAsset };
  delete withoutDigest.digest;
  const { run } = harness(swap(5, [withoutDigest]));
  await stopped(run, 'ASSET_DIGEST_UNAVAILABLE');
});

test('a starter or duplicate asset stops as uncertain with no delete or retry', async () => {
  for (const assets of [[{ ...uploadedAsset, state: 'starter' }], [uploadedAsset, { ...uploadedAsset, id: 89 }]]) {
    const { calls, receipts, run } = harness(swap(5, assets));
    await assert.rejects(run, ReleaseError);
    assert.ok(!calls.some((call) => ['DELETE', 'PATCH'].includes(call.method)));
    assert.equal(calls.filter((call) => call.url.startsWith('https://uploads.')).length, 1);
    assert.equal(receipts.at(-1).state, 'uncertain');
  }
});

test('a refused publish leaves the verified draft for the owner and records it', async () => {
  const { receipts, run } = harness(swap(6, { message: 'Resource not accessible by integration' }, 403));
  const error = await stopped(run, 'PUBLISH_REFUSED_DRAFT_LEFT_FOR_OWNER');
  assert.match(error.message, /Draft release 77/);
  assert.match(error.message, /publish it by hand/);
  assert.equal(receipts.at(-1).state, 'draft-verified-publish-refused');
  assert.equal(receipts.at(-1).releaseId, 77);
  assert.equal(receipts.at(-1).httpStatus, 403);
});

test('a tag that points elsewhere or at a tag object stops', async () => {
  const { receipts, run } = harness(swap(8, { ref: 'refs/tags/v4.7.0', object: { type: 'commit', sha: OTHER } }));
  await stopped(run, 'TAG_COMMIT_MISMATCH');
  assert.equal(receipts.at(-1).state, 'uncertain');
  await stopped(harness(swap(8, { ref: 'refs/tags/v4.7.0', object: { type: 'tag', sha: COMMIT } })).run, 'LIGHTWEIGHT_TAG_REQUIRED');
});

test('a latest release that is not ours stops', async () => {
  await stopped(harness(swap(9, { id: 76 })).run, 'LATEST_RELEASE_MISMATCH');
});

test('a public download that differs stops', async () => {
  await stopped(harness(swap(11, Buffer.from('portable archive bytez'))).run, 'PUBLIC_DOWNLOAD_MISMATCH');
});

test('a 5xx or a transport error on a write is uncertain, and a clean refusal before any draft is blocked', async () => {
  for (const index of [2, 4, 6]) {
    const { calls, receipts, run } = harness(swap(index, { message: 'boom' }, 502));
    const error = await stopped(run, 'GITHUB_HTTP_REJECTED');
    assert.equal(error.uncertain, true);
    assert.equal(calls.length, index + 1);
    assert.equal(receipts.at(-1).state, 'uncertain');
    assert.equal(receipts.at(-1).httpStatus, 502);
    const transport = harness(replace(index, 'throw'));
    await stopped(transport.run, 'TRANSPORT_OUTCOME_UNKNOWN');
    assert.equal(transport.receipts.at(-1).state, 'uncertain');
    assert.equal(transport.receipts.at(-1).mutationAttempted, true);
  }
  const refused = harness(swap(2, { message: 'Validation Failed' }, 422));
  await stopped(refused.run, 'GITHUB_HTTP_REJECTED');
  assert.equal(refused.receipts.at(-1).state, 'blocked');
});

test('the workflow is manual only, with writes and the environment confined to the approved job', () => {
  const text = readFileSync(new URL('../.github/workflows/github-release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const on = text.match(/^on:\n([\s\S]*?)\n\S/m)[1];
  assert.deepEqual([...on.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]), ['workflow_dispatch']);
  assert.deepEqual([...on.matchAll(/^ {6}(\w+):/gm)].map((match) => match[1]), ['mode', 'version', 'preparation_run_id']);
  assert.match(on, /options: \[Validate, Publish\]\n\s+default: Validate/);
  assert.match(text, /^permissions:\n {2}contents: read\n {2}actions: read\n\n/m);
  assert.match(text, /^concurrency:\n {2}group: github-release\n {2}cancel-in-progress: false$/m);
  const validate = text.slice(text.indexOf('\n  validate:'), text.indexOf('\n  publish:'));
  const publish = text.slice(text.indexOf('\n  publish:'));
  assert.doesNotMatch(validate, /environment:\s*github-release|contents: write|^ {4}if:/m);
  assert.match(publish, /^ {4}environment: github-release$/m);
  assert.match(publish, /^ {4}permissions:\n {6}contents: write\n {6}actions: read$/m);
  assert.equal(text.match(/contents: write/g).length, 1);
  assert.match(publish, /inputs\.mode == 'Publish' &&\n\s+needs\.validate\.outputs\.environment == 'github-release'/);
  for (const [, uses] of text.matchAll(/uses: (\S+)/g)) assert.match(uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  for (const job of [validate, publish]) {
    const steps = job.split(/\n {6}- /).slice(1);
    const jobLimit = Number(job.match(/^ {4}timeout-minutes: (\d+)$/m)[1]);
    const stepLimits = steps.map((step) => Number(step.match(/timeout-minutes: (\d+)/)[1]));
    assert.ok(stepLimits.every((value) => value > 0));
    assert.ok(jobLimit > stepLimits.reduce((sum, value) => sum + value, 0));
  }
  assert.match(publish, /if: always\(\)[\s\S]*retention-days: 30[\s\S]*github-release-receipt\.json/);
});
