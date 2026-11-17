import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, lstat, rename } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { REPOSITORY, protectionPolicy, requireApproval, CandidateError } from './android-candidate.mjs';

// Automates "Cutting a release" steps 4 and 5 of docs/MAINTAINING.md: one approved run creates
// v<version> at the merged release commit with notes taken from that commit's CHANGELOG.md and the
// Windows ZIP the hosted preparation run already verified, then reads every part of it back.

export const ENVIRONMENT = 'github-release';
export const WORKFLOW = '.github/workflows/github-release.yml';
export const PREPARATION_WORKFLOW = '.github/workflows/wack.yml';
export const REPOSITORY_ID = 1322551430;
export const ASSET = 'marvel-reading-tracker-windows.zip';
export const RECORD = 'release-preparation.json';
export const STABLE_DOWNLOAD = `https://github.com/${REPOSITORY}/releases/latest/download/${ASSET}`;
// Owner decision, 16 November 2026: "The reader summary from the changelog you approve with each
// release, plus a link to the full changelog (Recommended)". That is the first level-three section
// under the version heading, then a link to the full changelog at the release commit, and nothing
// else. 'summary' drops the link; 'full-section-and-link' publishes the whole version section.
export const RELEASE_BODY_STYLE = 'summary-and-link';
// GitHub accepts 'true', 'false' or 'legacy'. Only 'true' lets this run prove that the README's latest-download address now serves the new archive.
export const MAKE_LATEST = 'true';
// No limit is documented by GitHub. 125000 characters is the figure third-party tools report for
// release bodies, so a longer body stops here rather than being cut or rejected half-published.
export const BODY_LIMIT = 125000;
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MODES = ['Validate', 'Publish'];
const INPUTS = ['mode', 'version', 'preparation_run_id'];
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_JSON = 8 * 1024 * 1024;
const MAX_RELEASE_PAGES = 10;

export class ReleaseError extends Error {
  constructor(code, { status = null, uncertain = false, detail = '' } = {}) {
    super(`GitHub release: ${code}${detail ? `: ${detail}` : ''}`);
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}
const demand = (value, code, detail) => { if (!value) throw new ReleaseError(code, { detail }); };
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function exact(value, keys, code) {
  demand(value && typeof value === 'object' && !Array.isArray(value)
    && canonical(Object.keys(value).sort()) === canonical([...keys].sort()), code);
}
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export function validateIntent(raw) {
  exact(raw, INPUTS, 'EXACT_INPUTS_REQUIRED');
  demand(INPUTS.every((key) => typeof raw[key] === 'string'), 'EXACT_INPUTS_REQUIRED');
  demand(MODES.includes(raw.mode), 'EXPLICIT_MODE_REQUIRED');
  demand(VERSION.test(raw.version), 'EXACT_VERSION_REQUIRED');
  demand(/^[1-9]\d{0,19}$/.test(raw.preparation_run_id)
    && Number.isSafeInteger(Number(raw.preparation_run_id)), 'PREPARATION_RUN_ID_REQUIRED');
  return {
    mode: raw.mode, version: raw.version, preparationRunId: Number(raw.preparation_run_id),
    tag: `v${raw.version}`, name: `Recap Page ${raw.version}`,
  };
}

export function validateInvocation(context, run) {
  demand(context.repository === REPOSITORY && context.event === 'workflow_dispatch'
    && context.ref === 'refs/heads/main' && context.defaultBranch === 'main'
    && context.attempt === 1 && SHA.test(context.workflowSha) && context.sha === context.workflowSha
    && context.workflowRef === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`,
  'MANUAL_MAIN_FIRST_ATTEMPT_REQUIRED');
  demand(positive(context.runId) && run.id === context.runId && run.run_attempt === 1
    && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === context.workflowSha && run.path?.split('@')[0] === WORKFLOW
    && run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID,
  'WORKFLOW_IDENTITY_MISMATCH');
}

// Only a first attempt is accepted: a rerun leaves artifacts from more than one attempt under one
// run id, and the record names exactly one of them.
export function validatePreparationRun(runId, run) {
  demand(positive(runId) && run && run.id === runId && run.run_attempt === 1
    && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.status === 'completed' && run.conclusion === 'success' && SHA.test(run.head_sha)
    && run.path?.split('@')[0] === PREPARATION_WORKFLOW
    && run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID,
  'QUALIFIED_PREPARATION_RUN_REQUIRED',
  `run ${runId} must be a successful first-attempt manual ${PREPARATION_WORKFLOW} run on main`);
  return run.head_sha;
}

const EXPIRED_DETAIL = 'the portable-candidate artifact is kept for one day, so this release run must '
  + 'start within a day of the Windows App Certification Kit preparation run. Dispatch a fresh '
  + 'preparation run with release_preparation=true while main is still the release commit, then '
  + 'release from that run';
export function selectPreparationArtifact(run, listing, now = Date.now()) {
  demand(listing && Number.isSafeInteger(listing.total_count) && listing.total_count >= 0
    && listing.total_count <= 100 && Array.isArray(listing.artifacts)
    && listing.artifacts.length === listing.total_count, 'COMPLETE_BOUNDED_ARTIFACT_LIST_REQUIRED');
  const matches = listing.artifacts.filter((item) => item?.name === `portable-candidate-${run.head_sha}`);
  demand(matches.length <= 1, 'ONE_PREPARATION_ARTIFACT_REQUIRED');
  demand(matches.length === 1, 'PREPARATION_ARTIFACT_MISSING_OR_EXPIRED', EXPIRED_DETAIL);
  const [artifact] = matches;
  const expires = Date.parse(artifact.expires_at);
  demand(artifact.expired === false && Number.isFinite(expires) && expires > now,
    'PREPARATION_ARTIFACT_MISSING_OR_EXPIRED', EXPIRED_DETAIL);
  demand(positive(artifact.id) && positive(artifact.size_in_bytes) && artifact.size_in_bytes <= MAX_ARCHIVE
    && /^sha256:[0-9a-f]{64}$/.test(artifact.digest)
    && artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === run.head_sha
    && artifact.workflow_run.head_branch === 'main'
    && artifact.workflow_run.repository_id === REPOSITORY_ID
    && artifact.workflow_run.head_repository_id === REPOSITORY_ID, 'PREPARATION_ARTIFACT_MISMATCH');
  return artifact;
}

export function validatePreparationRecord(record, { run, version, names, zip }) {
  demand(Array.isArray(names) && canonical([...names].sort()) === canonical([ASSET, RECORD]),
    'EXACT_PREPARATION_FILES_REQUIRED');
  exact(record, ['schemaVersion', 'repository', 'commit', 'tree', 'applicationVersion', 'workflow',
    'archive', 'bundledNode', 'portableLauncher', 'configurationSha256'], 'PREPARATION_RECORD_SHAPE');
  exact(record.workflow, ['runId', 'runAttempt'], 'PREPARATION_RECORD_SHAPE');
  exact(record.archive, ['file', 'bytes', 'sha256'], 'PREPARATION_RECORD_SHAPE');
  exact(record.bundledNode, ['version', 'architecture', 'sha256'], 'PREPARATION_RECORD_SHAPE');
  demand(record.schemaVersion === 1 && record.repository === REPOSITORY && record.commit === run.head_sha
    && SHA.test(record.tree) && record.applicationVersion === version
    && record.portableLauncher === 'Start on Windows.cmd' && HASH.test(record.configurationSha256)
    && HASH.test(record.bundledNode.sha256), 'PREPARATION_RECORD_IDENTITY_MISMATCH');
  // The writer records these from GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT, so they are strings.
  demand(record.workflow.runId === String(run.id) && record.workflow.runAttempt === '1',
    'PREPARATION_RECORD_RUN_MISMATCH');
  demand(Buffer.isBuffer(zip) && record.archive.file === ASSET && record.archive.bytes === zip.length
    && record.archive.sha256 === digest(zip), 'PREPARATION_ARCHIVE_MISMATCH');
  return record.archive;
}

export function releaseBody(changelogText, version, commit, style = RELEASE_BODY_STYLE) {
  demand(typeof changelogText === 'string' && VERSION.test(version) && SHA.test(commit), 'RELEASE_BODY_INPUT');
  demand(['summary-and-link', 'summary', 'full-section-and-link'].includes(style), 'UNKNOWN_BODY_STYLE');
  const lines = changelogText.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (line === `## ${version}` ? [index] : []));
  demand(starts.length === 1, 'CHANGELOG_VERSION_SECTION_REQUIRED', `exactly one "## ${version}" heading`);
  let end = lines.findIndex((line, index) => index > starts[0] && /^#{1,2}\s/.test(line));
  if (end === -1) end = lines.length;
  const section = lines.slice(starts[0] + 1, end);
  const first = section.findIndex((line) => /^###\s/.test(line));
  demand(first !== -1, 'CHANGELOG_READER_SUMMARY_REQUIRED', `no ### section under ${version}`);
  let next = section.findIndex((line, index) => index > first && /^###\s/.test(line));
  if (next === -1) next = section.length;
  const trim = (part) => part.join('\n').replace(/^\s*\n/, '').trimEnd();
  const summary = trim(section.slice(first + 1, next));
  demand(summary.trim().length > 0, 'CHANGELOG_READER_SUMMARY_REQUIRED', `the first ### section under ${version} is empty`);
  const content = style === 'full-section-and-link' ? trim(section) : `${section[first]}\n\n${summary}`;
  const link = `[Read the full changelog](https://github.com/${REPOSITORY}/blob/${commit}/CHANGELOG.md#${version.replaceAll('.', '')}).`;
  const body = style === 'summary' ? content : `${content}\n\n${link}`;
  demand(body.length <= BODY_LIMIT, 'RELEASE_BODY_TOO_LONG', `${body.length} characters; nothing is truncated`);
  return body;
}

export const binding = ({ version, commit, body, zipSha256, zipBytes, preparationRunId }) =>
  digest(canonical({ version, commit, body, zipSha256, zipBytes, preparationRunId }));

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
// Dependency-free, so the Ubuntu job and Windows tests read the artifact the same way. It reads
// what upload-artifact writes: no encryption, stored or deflated entries, optional data
// descriptors, and ZIP64 sizes only through the per-entry extra field.
export function readZip(zip, maxEntries = 2) {
  const fail = () => { throw new ReleaseError('PREPARATION_ARCHIVE_UNREADABLE'); };
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ARCHIVE) fail();
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65535); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50 && at + 22 + zip.readUInt16LE(at + 20) === zip.length) { end = at; break; }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) fail();
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const central = zip.readUInt32LE(end + 16);
  if (count !== zip.readUInt16LE(end + 8) || count < 1 || count > maxEntries || central + size !== end) fail();
  const files = new Map();
  let at = central;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) fail();
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    let compressedSize = zip.readUInt32LE(at + 20);
    let uncompressedSize = zip.readUInt32LE(at + 24);
    const nameSize = zip.readUInt16LE(at + 28);
    const extraSize = zip.readUInt16LE(at + 30);
    const commentSize = zip.readUInt16LE(at + 32);
    let offset = zip.readUInt32LE(at + 42);
    if ((flags & 0x41) !== 0 || ![0, 8].includes(method) || zip.readUInt16LE(at + 34) !== 0) fail();
    const name = zip.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    const extra = zip.subarray(at + 46 + nameSize, at + 46 + nameSize + extraSize);
    for (let field = 0; field + 4 <= extra.length;) {
      const id = extra.readUInt16LE(field);
      const length = extra.readUInt16LE(field + 2);
      if (id === 0x0001) {
        let cursor = field + 4;
        const wide = () => { const value = Number(extra.readBigUInt64LE(cursor)); cursor += 8; return value; };
        if (uncompressedSize === 0xffffffff) uncompressedSize = wide();
        if (compressedSize === 0xffffffff) compressedSize = wide();
        if (offset === 0xffffffff) offset = wide();
      }
      field += 4 + length;
    }
    at += 46 + nameSize + extraSize + commentSize;
    if (!name || name.includes('/') || name.includes('\\') || files.has(name)
      || uncompressedSize > MAX_ARCHIVE || offset + 30 > central
      || zip.readUInt32LE(offset) !== 0x04034b50 || zip.readUInt16LE(offset + 8) !== method
      || zip.readUInt16LE(offset + 26) !== nameSize
      || !zip.subarray(offset + 30, offset + 30 + nameSize).equals(Buffer.from(name, 'utf8'))) fail();
    const start = offset + 30 + nameSize + zip.readUInt16LE(offset + 28);
    if (start + compressedSize > central) fail();
    const stored = zip.subarray(start, start + compressedSize);
    let bytes;
    try { bytes = method === 0 ? Buffer.from(stored) : inflateRawSync(stored, { maxOutputLength: MAX_ARCHIVE }); }
    catch { fail(); }
    if (bytes.length !== uncompressedSize || crc32(bytes) !== crc) fail();
    files.set(name, bytes);
  }
  if (at !== end) fail();
  return files;
}

export function assertUnreleased(tagRef, releases, tag) {
  demand(tagRef === null, 'TAG_ALREADY_EXISTS', `${tag} already exists; an existing tag is never moved or reused`);
  demand(Array.isArray(releases) && releases.every((item) => item && typeof item.tag_name === 'string'),
    'RELEASE_LIST_UNREADABLE');
  demand(!releases.some((item) => item.tag_name === tag), 'RELEASE_ALREADY_EXISTS',
    `a release or draft already names ${tag}; resolve it by hand rather than adding a second`);
}

async function boundedBytes(response, maximum, code) {
  demand(response.body, 'EMPTY_API_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      demand(size <= maximum, code);
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks);
}
async function boundedJson(response) {
  const bytes = await boundedBytes(response, MAX_JSON, 'API_RESPONSE_TOO_LARGE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new ReleaseError('INVALID_API_JSON'); }
}

const WRITE_STAGES = ['create-draft', 'upload-asset', 'publish-draft'];
export async function transact({ plan, zip, token, record, fetchImpl = globalThis.fetch }) {
  demand(typeof record === 'function', 'DURABLE_RECEIPT_WRITER_REQUIRED');
  demand(plan && VERSION.test(plan.version) && SHA.test(plan.commit) && typeof plan.body === 'string'
    && plan.body.length > 0 && plan.body.length <= BODY_LIMIT && HASH.test(plan.zipSha256)
    && positive(plan.zipBytes) && positive(plan.preparationRunId), 'INVALID_OPERATION_IDENTITY');
  demand(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'ACCESS_TOKEN_REQUIRED');
  demand(Buffer.isBuffer(zip) && zip.length === plan.zipBytes && digest(zip) === plan.zipSha256,
    'ARCHIVE_CHANGED_BEFORE_OPERATION');
  const tag = `v${plan.version}`;
  const name = `Recap Page ${plan.version}`;
  const repo = `${API}/repos/${REPOSITORY}`;
  const receipt = {
    schemaVersion: 1, repository: REPOSITORY, tag, commit: plan.commit, name,
    bodySha256: digest(plan.body), asset: ASSET, assetSha256: plan.zipSha256, assetBytes: plan.zipBytes,
    preparationRunId: plan.preparationRunId, bindingSha256: binding(plan), makeLatest: MAKE_LATEST,
    stage: 'ready', state: 'running', releaseId: null, assetId: null, draft: null,
    mutationAttempted: false, httpStatus: null,
    manualChecks: ['A clean download of the archive opens at http://127.0.0.1:8787/'],
  };
  const save = async () => record(structuredClone(receipt));
  async function request(stage, method, url, { json, bytes, allow404 = false, auth = true, download = 0 } = {}) {
    receipt.stage = stage;
    receipt.httpStatus = null;
    const mutation = method !== 'GET';
    receipt.mutationAttempted ||= mutation;
    await save();
    const headers = { Accept: download ? 'application/octet-stream' : 'application/vnd.github+json',
      'User-Agent': 'recap-page-github-release' };
    if (auth) Object.assign(headers, { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (bytes !== undefined) headers['Content-Type'] = 'application/zip';
    let response;
    try {
      response = await fetchImpl(url, {
        method, headers,
        // Only the two public asset downloads follow redirects: GitHub serves release assets from
        // a separate storage host, and those requests carry no credential to forward.
        redirect: download ? 'follow' : 'error',
        signal: AbortSignal.timeout(bytes !== undefined || download ? 300000 : 30000),
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        ...(bytes !== undefined ? { body: bytes } : {}),
      });
    } catch {
      throw new ReleaseError('TRANSPORT_OUTCOME_UNKNOWN', { uncertain: mutation });
    }
    receipt.httpStatus = response.status;
    if (allow404 && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ReleaseError('GITHUB_HTTP_REJECTED', { status: response.status, uncertain: mutation && response.status >= 500 });
    }
    try {
      return download ? await boundedBytes(response, download, 'DOWNLOAD_LARGER_THAN_ASSET') : await boundedJson(response);
    } catch (error) {
      throw new ReleaseError(error instanceof ReleaseError ? error.code : 'API_READ_FAILED',
        { status: response.status, uncertain: mutation });
    }
  }
  const expectRelease = (release, draft) => demand(release && release.id === receipt.releaseId
    && release.tag_name === tag && release.target_commitish === plan.commit && release.name === name
    && release.body === plan.body && release.draft === draft && release.prerelease === false,
  'RELEASE_READBACK_MISMATCH');
  try {
    const existing = await request('check-tag', 'GET', `${repo}/git/ref/tags/${tag}`, { allow404: true });
    const releases = [];
    for (let page = 1; ; page++) {
      demand(page <= MAX_RELEASE_PAGES, 'RELEASE_LIST_TOO_LONG');
      const batch = await request('check-releases', 'GET', `${repo}/releases?per_page=100&page=${page}`);
      demand(Array.isArray(batch), 'RELEASE_LIST_UNREADABLE');
      releases.push(...batch);
      if (batch.length < 100) break;
    }
    assertUnreleased(existing, releases, tag);

    // A draft creates no tag, so any stop before the final PATCH leaves nothing public.
    const created = await request('create-draft', 'POST', `${repo}/releases`, { json: {
      tag_name: tag, target_commitish: plan.commit, name, body: plan.body, draft: true, prerelease: false,
    } });
    demand(positive(created?.id), 'CREATED_RELEASE_IDENTITY_UNREADABLE');
    receipt.releaseId = created.id;
    receipt.draft = true;
    await save();
    const draft = await request('read-draft', 'GET', `${repo}/releases/${created.id}`);
    expectRelease(draft, true);
    demand(Array.isArray(draft.assets) && draft.assets.length === 0
      && draft.upload_url === `${UPLOADS}/repos/${REPOSITORY}/releases/${created.id}/assets{?name,label}`,
    'DRAFT_READBACK_MISMATCH');

    const uploaded = await request('upload-asset', 'POST',
      `${UPLOADS}/repos/${REPOSITORY}/releases/${created.id}/assets?name=${ASSET}`, { bytes: zip });
    demand(positive(uploaded?.id), 'UPLOADED_ASSET_IDENTITY_UNREADABLE');
    receipt.assetId = uploaded.id;
    await save();
    const assets = await request('read-assets', 'GET', `${repo}/releases/${created.id}/assets?per_page=100`);
    demand(Array.isArray(assets) && assets.every((item) => item?.state === 'uploaded'), 'ASSET_NOT_SETTLED');
    demand(assets.length === 1 && assets[0].id === uploaded.id && assets[0].name === ASSET, 'EXACTLY_ONE_ASSET_REQUIRED');
    demand(typeof assets[0].digest === 'string', 'ASSET_DIGEST_UNAVAILABLE',
      'GitHub reported no digest, so the uploaded bytes cannot be confirmed');
    demand(assets[0].size === plan.zipBytes && assets[0].digest === `sha256:${plan.zipSha256}`,
      'ASSET_DIGEST_MISMATCH');
    // A draft has no tag, so GitHub serves its assets from an untagged- address until it is
    // published; the tagged address can only be checked on the published read back.
    const assetUrl = `https://github.com/${REPOSITORY}/releases/download/${tag}/${ASSET}`;
    receipt.stage = 'draft-verified';
    await save();

    try {
      await request('publish-draft', 'PATCH', `${repo}/releases/${created.id}`,
        { json: { draft: false, make_latest: MAKE_LATEST } });
    } catch (error) {
      if (error instanceof ReleaseError && [403, 404, 422].includes(error.status)) {
        receipt.state = 'draft-verified-publish-refused';
        receipt.code = 'PUBLISH_REFUSED_DRAFT_LEFT_FOR_OWNER';
        await save();
        throw new ReleaseError('PUBLISH_REFUSED_DRAFT_LEFT_FOR_OWNER', { status: error.status,
          detail: `GitHub refused to publish (HTTP ${error.status}). Draft release ${created.id} stays with its `
            + 'verified asset and no tag. Check it on the Releases page and publish it by hand; '
            + 'a token without the workflows permission cannot create a tag at a commit that changes workflow files' });
      }
      throw error;
    }
    receipt.draft = false;
    await save();
    const published = await request('read-published', 'GET', `${repo}/releases/tags/${tag}`);
    expectRelease(published, false);
    const servedAssets = Array.isArray(published.assets) ? published.assets : [];
    demand(servedAssets.length === 1 && servedAssets[0]?.id === uploaded.id && servedAssets[0].name === ASSET
      && servedAssets[0].size === plan.zipBytes && servedAssets[0].digest === `sha256:${plan.zipSha256}`
      && servedAssets[0].browser_download_url === assetUrl, 'ASSET_URL_MISMATCH');
    const ref = await request('read-tag', 'GET', `${repo}/git/ref/tags/${tag}`);
    demand(ref?.ref === `refs/tags/${tag}` && ref.object?.type === 'commit', 'LIGHTWEIGHT_TAG_REQUIRED');
    demand(ref.object.sha === plan.commit, 'TAG_COMMIT_MISMATCH');
    if (MAKE_LATEST === 'true') {
      const latest = await request('read-latest', 'GET', `${repo}/releases/latest`);
      demand(latest?.id === created.id, 'LATEST_RELEASE_MISMATCH');
    }
    for (const [stage, url] of [['download-asset', assetUrl],
      ...(MAKE_LATEST === 'true' ? [['download-stable', STABLE_DOWNLOAD]] : [])]) {
      const served = await request(stage, 'GET', url, { auth: false, download: plan.zipBytes });
      demand(served.length === plan.zipBytes && digest(served) === plan.zipSha256, 'PUBLIC_DOWNLOAD_MISMATCH');
    }
    receipt.state = 'published-verified';
    receipt.stage = 'complete';
    await save();
    return receipt;
  } catch (error) {
    if (receipt.state !== 'draft-verified-publish-refused') {
      const unverifiedWrite = WRITE_STAGES.includes(receipt.stage) && receipt.httpStatus >= 200 && receipt.httpStatus < 300;
      // Once a draft exists, any stop leaves remote state the owner has to look at.
      receipt.state = (error instanceof ReleaseError && error.uncertain) || unverifiedWrite || receipt.releaseId !== null
        ? 'uncertain' : 'blocked';
      receipt.code = error instanceof ReleaseError ? error.code : 'UNEXPECTED_FAILURE';
      if (error instanceof ReleaseError && error.status !== null) receipt.httpStatus = error.status;
      await save();
    }
    throw error;
  }
}

function native(file, args, { binary = false, code = 'NATIVE_COMMAND_FAILED', allowFailure = false } = {}) {
  const result = spawnSync(file, args, {
    cwd: ROOT, encoding: binary ? undefined : 'utf8', timeout: 300000,
    maxBuffer: binary ? MAX_ARCHIVE : 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (allowFailure) return !result.error && result.status === 0 && !result.signal;
  demand(!result.error && result.status === 0 && !result.signal, code);
  return binary ? result.stdout : result.stdout.trim();
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => native('git', ['--no-pager', ...args], { code: 'GIT_PROVENANCE_FAILED' });
async function readJson(path) {
  const bytes = await readFile(path);
  demand(bytes.length <= MAX_JSON, 'JSON_FILE_TOO_LARGE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new ReleaseError('INVALID_JSON_FILE'); }
}
async function github(path, { allow404 = false } = {}) {
  demand(path.startsWith(`repos/${REPOSITORY}/`) && process.env.GITHUB_TOKEN, 'GITHUB_READ_CONTEXT_REQUIRED');
  let response;
  try {
    response = await fetch(`${API}/${path}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'recap-page-github-release' },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
  } catch { throw new ReleaseError('GITHUB_READ_FAILED'); }
  if (allow404 && response.status === 404) { await response.body?.cancel(); return null; }
  demand(response.ok, 'GITHUB_REQUIRED_READ_REJECTED', `${response.status} reading ${path.split('?')[0]}`);
  return boundedJson(response);
}
export function runDirectory(environment = process.env) {
  demand(typeof environment.RUNNER_TEMP === 'string' && isAbsolute(environment.RUNNER_TEMP),
    'ABSOLUTE_RUNNER_TEMP_REQUIRED');
  const run = environment.GITHUB_RUN_ID;
  const attempt = environment.GITHUB_RUN_ATTEMPT;
  demand(typeof run === 'string' && /^[1-9]\d*$/.test(run) && Number.isSafeInteger(Number(run))
    && typeof attempt === 'string' && /^[1-9]\d*$/.test(attempt), 'EXACT_RUN_IDENTITY_REQUIRED');
  const root = resolve(environment.RUNNER_TEMP);
  return { root, work: join(root, `recap-github-release-${run}-${attempt}`) };
}
async function ownedWork() {
  const { root, work } = runDirectory();
  const child = relative(root, work);
  demand(child && !child.startsWith('..') && !isAbsolute(child), 'WORK_OUTSIDE_RUNNER_TEMP');
  let stat;
  try { stat = await lstat(work); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  demand(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'UNSAFE_WORK_DIRECTORY');
  await mkdir(work, { recursive: true, mode: 0o700 });
  return work;
}
async function atomicJson(path, value) {
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
async function releasesOf() {
  const all = [];
  for (let page = 1; ; page++) {
    demand(page <= MAX_RELEASE_PAGES, 'RELEASE_LIST_TOO_LONG');
    const batch = await github(`repos/${REPOSITORY}/releases?per_page=100&page=${page}`);
    demand(Array.isArray(batch), 'RELEASE_LIST_UNREADABLE');
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}
async function policy() {
  return protectionPolicy(await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}`),
    await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100`), ENVIRONMENT);
}

export async function prepare({ afterApproval = false } = {}) {
  const event = await readJson(process.env.GITHUB_EVENT_PATH);
  const intent = validateIntent(event.inputs);
  const context = {
    repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF, defaultBranch: event.repository?.default_branch,
    sha: process.env.GITHUB_SHA, workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    workflowRef: process.env.GITHUB_WORKFLOW_REF, runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  };
  validateInvocation(context, await github(`repos/${REPOSITORY}/actions/runs/${context.runId}`));
  demand(git('rev-parse', 'HEAD') === context.workflowSha && git('status', '--porcelain') === '',
    'CLEAN_REVIEWED_TOOLING_REQUIRED');
  const run = await github(`repos/${REPOSITORY}/actions/runs/${intent.preparationRunId}`);
  const commit = validatePreparationRun(intent.preparationRunId, run);
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  demand(git('rev-parse', `${commit}^{commit}`) === commit, 'RELEASE_COMMIT_REQUIRED');
  demand(native('git', ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'], { allowFailure: true }),
    'RELEASE_COMMIT_NOT_ON_MAIN', `${commit} is not on main`);
  demand(JSON.parse(git('show', `${commit}:package.json`)).version === intent.version, 'PACKAGE_VERSION_MISMATCH',
    `package.json at ${commit} does not hold ${intent.version}`);
  const body = releaseBody(git('show', `${commit}:CHANGELOG.md`), intent.version, commit);
  demand(git('show', `${commit}:README.md`).includes(`(${STABLE_DOWNLOAD})`), 'README_STABLE_DOWNLOAD_CHANGED');
  const artifact = selectPreparationArtifact(run,
    await github(`repos/${REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`));
  const archive = native('gh', ['api', `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
    '--allow-escape-sequences'], { binary: true, code: 'ARTIFACT_DOWNLOAD_FAILED' });
  demand(archive.length === artifact.size_in_bytes && digest(archive) === artifact.digest.slice(7),
    'ARTIFACT_ARCHIVE_DIGEST_MISMATCH');
  const files = readZip(archive);
  const recordBytes = files.get(RECORD);
  demand(recordBytes && recordBytes.length <= MAX_JSON, 'PREPARATION_RECORD_REQUIRED');
  let record;
  try { record = JSON.parse(recordBytes.toString('utf8')); } catch { throw new ReleaseError('PREPARATION_RECORD_SHAPE'); }
  const zip = files.get(ASSET);
  validatePreparationRecord(record, { run, version: intent.version, names: [...files.keys()], zip });
  demand(git('rev-parse', `${commit}^{tree}`) === record.tree, 'PREPARATION_TREE_MISMATCH');
  // A contents: read token cannot see drafts, so the approved job, which holds contents: write,
  // repeats this inside the operation before its first write.
  assertUnreleased(await github(`repos/${REPOSITORY}/git/ref/tags/${intent.tag}`, { allow404: true }),
    await releasesOf(), intent.tag);
  const plan = { version: intent.version, commit, body, zipSha256: digest(zip), zipBytes: zip.length,
    preparationRunId: run.id };
  const bindingSha = binding(plan);
  let releasePolicy = null;
  if (intent.mode === 'Publish') {
    releasePolicy = await policy();
    if (afterApproval) {
      demand(String(releasePolicy.environmentId) === process.env.RECAP_RELEASE_EXPECTED_ENVIRONMENT_ID
        && releasePolicy.sha256 === process.env.RECAP_RELEASE_EXPECTED_POLICY_SHA
        && bindingSha === process.env.RECAP_RELEASE_EXPECTED_BINDING_SHA, 'APPROVED_BINDING_OR_POLICY_CHANGED');
      requireApproval(await github(`repos/${REPOSITORY}/actions/runs/${context.runId}/approvals`), releasePolicy, context);
    }
  } else demand(!afterApproval, 'VALIDATE_HAS_NO_APPROVAL');
  if (process.env.GITHUB_STEP_SUMMARY && !afterApproval) {
    const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((match) => match[0].length + 1)));
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Exact GitHub release intent\n\n\`\`\`json\n${JSON.stringify({ mode: intent.mode, tag: intent.tag,
        name: intent.name, commit, tree: record.tree, preparationRunId: run.id, asset: ASSET, assetSha256: plan.zipSha256,
        assetBytes: plan.zipBytes, makeLatest: MAKE_LATEST, bindingSha256: bindingSha }, null, 2)}\n\`\`\`\n\n`
      + `### Release body, exactly as it will be published\n\n${fence}markdown\n${body}\n${fence}\n\n`
      + 'Approve only this exact commit, body and archive. Opening a clean download at '
      + 'http://127.0.0.1:8787/ stays a manual check after publication.\n');
  }
  if (process.env.GITHUB_OUTPUT && !afterApproval) {
    await appendFile(process.env.GITHUB_OUTPUT, `binding_sha=${bindingSha}\n`
      + `environment=${releasePolicy ? ENVIRONMENT : ''}\n`
      + `environment_id=${releasePolicy?.environmentId ?? ''}\npolicy_sha=${releasePolicy?.sha256 ?? ''}\n`);
  }
  console.log(`GitHub release ${intent.tag} validated at ${commit}; ${ASSET} sha256 ${plan.zipSha256}.`);
  return { plan, zip };
}

export async function publish() {
  const work = await ownedWork();
  const { plan, zip } = await prepare({ afterApproval: true });
  const receiptPath = join(work, 'github-release-receipt.json');
  const result = await transact({ plan, zip, token: process.env.GITHUB_TOKEN,
    record: (receipt) => atomicJson(receiptPath, receipt) });
  console.log(`GitHub release v${plan.version}: ${result.state}. Check by hand that a clean download opens at http://127.0.0.1:8787/.`);
  return result;
}

async function main() {
  demand(process.argv.length === 3, 'EXPECTED_ONE_COMMAND');
  const command = process.argv[2];
  if (command === 'validate') await prepare();
  else if (command === 'publish') await publish();
  else throw new ReleaseError('EXPECTED_VALIDATE_OR_PUBLISH');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof ReleaseError || error instanceof CandidateError ? error.message
      : 'GitHub release: a required check failed; no success or retry implied.');
    process.exitCode = 1;
  });
}
