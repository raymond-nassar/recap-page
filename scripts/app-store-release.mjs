import { createHash, createPrivateKey, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, lstat, rename } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, protectionPolicy, requireApproval, CandidateError } from './android-candidate.mjs';
import { REPOSITORY_ID, canonical } from './google-play-publisher.mjs';
import { ROOT, sourceIdentity } from './lib/release-identity.mjs';
import { validateIosLedger } from './ios-release.mjs';
import {
  approvedStoreText, storeTextPath, textLength, STORE_LIMITS, StoreTextError,
} from './lib/store-text.mjs';

export const ENVIRONMENT = 'app-store-release';
export const WORKFLOW = '.github/workflows/app-store-release.yml';
export const BUNDLE_ID = 'io.github.raymondnassar.recappage';
export const LEDGER = 'packaging/ios/build-numbers.json';

// Owner decisions, one constant each, so a changed answer is a one-line edit and a reviewed change.
// RELEASE_TYPE, owner decision on 16 November 2026: "Release it automatically once Apple approves,
// as 4.4.0 did (Recommended)". AFTER_APPROVAL releases the version as soon as Apple approves it; MANUAL would hold it until the owner releases it in App Store Connect.
export const RELEASE_TYPE = 'AFTER_APPROVAL';
// The approved store files are written for en-us and Apple names that locale en-US. No other
// localization is touched and none is ever created, so a missing one stops rather than adds.
export const APPLE_LOCALE = 'en-US';
export const STORE_LOCALE = 'en-us';
export const PLATFORM = 'IOS';
// Apple accepts at most 20 minutes; 15 leaves room for runner clock skew.
export const TOKEN_SECONDS = 900;
export const REQUEST_TIMEOUT_MS = 30000;
// Apple's editable appVersionState values. A version in any other state is already submitted,
// in review or released, and the owner reconciles it in App Store Connect.
export const EDITABLE_STATES = Object.freeze(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED',
  'METADATA_REJECTED', 'INVALID_BINARY']);
// A review submission in one of these is open. It is never reused or canceled from here, because
// it may hold items the owner added by hand.
export const OPEN_SUBMISSION_STATES = Object.freeze(['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW',
  'UNRESOLVED_ISSUES', 'CANCELING', 'COMPLETING']);
export const SUBMITTED_STATES = Object.freeze(['WAITING_FOR_REVIEW', 'IN_REVIEW']);

const API = 'https://api.appstoreconnect.apple.com';
const MODES = ['Validate', 'Inspect', 'Submit'];
const INPUTS = ['mode', 'version', 'build_number'];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9-]{1,128}$/;
const STATE = /^[A-Z_]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JSON = 2 * 1024 * 1024;
const PAGE = 200;

export class AppStoreError extends Error {
  constructor(code, { status = null, uncertain = false, detail = null } = {}) {
    super(`App Store release: ${code}${detail ? ` (${detail})` : ''}`);
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
    this.detail = detail;
  }
}
const demand = (value, code, detail = null) => { if (!value) throw new AppStoreError(code, { detail }); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateIntent(raw) {
  demand(plainObject(raw), 'INPUTS_REQUIRED');
  demand(Object.keys(raw).sort().join() === [...INPUTS].sort().join(), 'EXACT_INPUTS_REQUIRED',
    'only mode, version and build_number are accepted');
  demand(MODES.includes(raw.mode), 'EXPLICIT_MODE_REQUIRED', 'Validate, Inspect or Submit');
  demand(typeof raw.version === 'string' && VERSION.test(raw.version), 'VERSION_REQUIRED', 'x.y.z');
  demand(typeof raw.build_number === 'string' && /^[1-9]\d{0,3}$/.test(raw.build_number),
    'BUILD_NUMBER_REQUIRED', 'a reserved build number from 1 to 9999');
  return { mode: raw.mode, version: raw.version, buildNumber: Number(raw.build_number) };
}

// The build is bound to the ledger, not only to the input: it must be sealed for this version,
// and it must be the newest sealed build for it, so a superseded upload cannot be sent for review.
export function sealedBuild(ledger, intent) {
  try { validateIosLedger(ledger); } catch (error) {
    throw new AppStoreError('IOS_LEDGER_REFUSED', { detail: error.message });
  }
  const entry = ledger.reservations.find((item) => item.buildNumber === intent.buildNumber);
  demand(entry, 'BUILD_NOT_RESERVED', `build ${intent.buildNumber} is not in ${LEDGER}`);
  demand(entry.artifact !== null, 'BUILD_NOT_SEALED', `build ${intent.buildNumber} has no sealed IPA`);
  demand(entry.productVersion === intent.version, 'LEDGER_VERSION_MISMATCH',
    `build ${intent.buildNumber} is sealed for ${entry.productVersion}, not ${intent.version}`);
  const newest = ledger.reservations.filter((item) => item.productVersion === intent.version && item.artifact !== null)
    .at(-1);
  demand(newest.buildNumber === entry.buildNumber, 'NEWER_SEALED_BUILD_EXISTS',
    `the newest sealed build for ${intent.version} is ${newest.buildNumber}`);
  return entry;
}

export function validateInvocation(context, run) {
  demand(context.repository === REPOSITORY && context.event === 'workflow_dispatch'
    && context.ref === 'refs/heads/main' && context.defaultBranch === 'main'
    && context.attempt === 1 && SHA.test(context.workflowSha) && context.sha === context.workflowSha
    && context.workflowRef === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`,
  'MANUAL_MAIN_FIRST_ATTEMPT_REQUIRED');
  demand(Number.isSafeInteger(context.runId) && context.runId > 0
    && run.id === context.runId && run.run_attempt === 1 && run.event === 'workflow_dispatch'
    && run.head_branch === 'main' && run.head_sha === context.workflowSha
    && run.path?.split('@')[0] === WORKFLOW && run.repository?.id === REPOSITORY_ID
    && run.head_repository?.id === REPOSITORY_ID, 'WORKFLOW_IDENTITY_MISMATCH');
}

export function ascToken({ keyId, issuerId, privateKeyPem, now = Date.now() }) {
  demand(typeof keyId === 'string' && /^[A-Z0-9]{10}$/.test(keyId), 'ASC_KEY_ID_REQUIRED');
  demand(typeof issuerId === 'string' && UUID.test(issuerId), 'ASC_ISSUER_ID_REQUIRED');
  demand(typeof privateKeyPem === 'string' && privateKeyPem.includes('PRIVATE KEY'), 'ASC_PRIVATE_KEY_REQUIRED');
  demand(Number.isFinite(now) && now > 0, 'CLOCK_REQUIRED');
  let key;
  // The parser's own message is never surfaced, so no fragment of the key can reach a log.
  try { key = createPrivateKey(privateKeyPem); } catch { throw new AppStoreError('ASC_PRIVATE_KEY_UNREADABLE'); }
  demand(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1',
    'ASC_PRIVATE_KEY_NOT_P256');
  const iat = Math.floor(now / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
    iss: issuerId, iat, exp: iat + TOKEN_SECONDS, aud: 'appstoreconnect-v1' })}`;
  // JWS ES256 is the raw 64-byte r||s pair. Node's default is DER, which Apple rejects as an
  // invalid signature, so the encoding is stated rather than inherited.
  const signature = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${signature.toString('base64url')}`;
}

// Line by line, because the owner reads this to see which approved bullet differs from the
// live listing, and a whole-text mismatch says only that something does.
export function whatsNewDifference(live, approved) {
  const before = typeof live === 'string' ? live.split('\n') : [];
  const after = approved.split('\n');
  const lines = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] !== after[index]) {
      lines.push({ line: index + 1, live: before[index] ?? null, approved: after[index] ?? null });
    }
  }
  return { identical: live === approved, liveMissing: typeof live !== 'string', lines };
}

async function boundedJson(response) {
  demand(response.body, 'EMPTY_API_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      demand(size <= MAX_JSON, 'API_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppStoreError('INVALID_API_JSON'); }
}
function resource(value, type) {
  demand(plainObject(value) && value.type === type && typeof value.id === 'string' && ID.test(value.id)
    && plainObject(value.attributes), 'INVALID_RESOURCE', type);
  return value;
}
const single = (body, type) => resource(plainObject(body) ? body.data : null, type);
function linkage(body, type) {
  demand(plainObject(body) && Object.hasOwn(body, 'data'), 'INVALID_RELATIONSHIP', type);
  if (body.data === null) return null;
  demand(plainObject(body.data) && body.data.type === type && typeof body.data.id === 'string'
    && ID.test(body.data.id), 'INVALID_RELATIONSHIP', type);
  return body.data.id;
}
function versionOf(item) {
  const attributes = resource(item, 'appStoreVersions').attributes;
  demand(typeof attributes.versionString === 'string' && attributes.platform === PLATFORM,
    'INVALID_APP_STORE_VERSION');
  demand(typeof attributes.appVersionState === 'string' && STATE.test(attributes.appVersionState),
    'APP_VERSION_STATE_MISSING', 'appStoreState is deprecated and is not read in its place');
  return { id: item.id, versionString: attributes.versionString, appVersionState: attributes.appVersionState,
    releaseType: typeof attributes.releaseType === 'string' ? attributes.releaseType : null };
}
function appleErrorCodes(body) {
  if (!plainObject(body) || !Array.isArray(body.errors)) return [];
  return body.errors.map((error) => error?.code).filter((code) => typeof code === 'string'
    && /^[A-Z0-9_.]{1,100}$/.test(code)).slice(0, 5);
}

// The receipt is saved before every request, so a run that dies mid-request still says which
// request it was and whether it could have changed anything. Nothing is ever retried.
export function ascClient({ fetchImpl = globalThis.fetch, token, mode, receipt, save }) {
  demand(['Inspect', 'Submit'].includes(mode) && plainObject(receipt) && typeof save === 'function',
    'APPLE_CLIENT_CONTEXT_REQUIRED');
  async function request(stage, method, path, payload) {
    const write = method !== 'GET';
    // Defensive: Inspect is promised to be read-only, so a write that reaches here is a defect.
    if (write && mode === 'Inspect') throw new AppStoreError('INSPECT_REFUSES_WRITES', { detail: stage });
    demand(path.startsWith('/v1/'), 'API_PATH_REQUIRED');
    receipt.stage = stage;
    receipt.httpStatus = null;
    receipt.mutationAttempted ||= write;
    await save();
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      throw new AppStoreError('TRANSPORT_OUTCOME_UNKNOWN', { uncertain: write });
    }
    receipt.httpStatus = response.status;
    if (!response.ok) {
      let codes = [];
      try { codes = appleErrorCodes(await boundedJson(response)); } catch { /* the status is the finding */ }
      if (codes.length) receipt.appleErrors = codes;
      // A throttled or failed write may still have been applied, so neither can be read as refused.
      throw new AppStoreError('APPLE_HTTP_REJECTED', {
        status: response.status, uncertain: write && (response.status === 429 || response.status >= 500),
      });
    }
    if (response.status === 204) { await response.body?.cancel(); return null; }
    try { return await boundedJson(response); } catch (error) {
      throw new AppStoreError(error instanceof AppStoreError ? error.code : 'API_READ_FAILED',
        { status: response.status, uncertain: write });
    }
  }
  return { request };
}

export async function transact(spec, { fetchImpl = globalThis.fetch, token, record, mode } = {}) {
  demand(plainObject(spec) && ['Inspect', 'Submit'].includes(mode) && spec.mode === mode, 'APPLE_OPERATION_REQUIRED');
  demand(typeof record === 'function', 'DURABLE_RECEIPT_WRITER_REQUIRED');
  demand(typeof spec.version === 'string' && VERSION.test(spec.version)
    && Number.isSafeInteger(spec.buildNumber) && spec.buildNumber > 0 && spec.buildNumber <= 9999
    && spec.sealedBuildNumber === spec.buildNumber, 'SEALED_BUILD_IDENTITY_REQUIRED');
  demand(typeof spec.whatsNew === 'string' && spec.whatsNew.trim().length > 0
    && textLength(spec.whatsNew) <= STORE_LIMITS['app-store'], 'APPROVED_TEXT_REQUIRED',
  `at most ${STORE_LIMITS['app-store']} characters; nothing is truncated`);
  demand(typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token), 'ASC_TOKEN_REQUIRED');
  const text = spec.whatsNew;
  const receipt = {
    schemaVersion: 1, mode, bundleId: BUNDLE_ID, version: spec.version, buildNumber: spec.buildNumber,
    releaseType: RELEASE_TYPE, locale: APPLE_LOCALE, whatsNewSha256: digest(text), whatsNewLength: textLength(text),
    stage: 'ready', state: 'running', mutationAttempted: false, httpStatus: null,
    ids: { app: null, build: null, appStoreVersion: null, localization: null, reviewSubmission: null,
      reviewSubmissionItem: null },
    before: { appStoreVersion: null, buildId: null, whatsNew: null, openSubmissions: null },
    whatsNewDifference: null, planned: [], after: null,
  };
  const save = async () => record(structuredClone(receipt));
  const { request } = ascClient({ fetchImpl, token, mode, receipt, save });
  const read = (stage, path) => request(stage, 'GET', path);
  async function list(stage, path, type) {
    const body = await read(stage, path);
    demand(plainObject(body) && Array.isArray(body.data) && body.data.length <= PAGE, 'INVALID_LIST', stage);
    demand(!body.links?.next, 'PAGINATION_REFUSED', `${stage} has more than one page; nothing is guessed`);
    body.data.forEach((item) => resource(item, type));
    return body;
  }
  // A write that Apple acknowledged but whose answer cannot be verified leaves the outcome unknown.
  async function change(stage, method, path, payload, check = () => {}) {
    if (mode === 'Inspect') {
      receipt.planned.push({ stage, method, path, body: payload ?? null });
      return null;
    }
    const result = await request(stage, method, path, payload);
    try { check(result); } catch (error) {
      throw new AppStoreError(error.code ?? 'WRITE_RESPONSE_UNVERIFIED',
        { status: receipt.httpStatus, uncertain: true, detail: error.detail ?? null });
    }
    return result;
  }
  try {
    const apps = (await list('read-app', `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=${PAGE}`, 'apps')).data;
    demand(apps.length === 1 && apps[0].attributes.bundleId === BUNDLE_ID, 'ONE_APP_REQUIRED',
      `${apps.length} apps answered for ${BUNDLE_ID}`);
    const appId = apps[0].id;
    receipt.ids.app = appId;

    const builds = await list('read-build', `/v1/builds?filter[app]=${appId}&filter[version]=${spec.buildNumber}`
      + `&filter[preReleaseVersion.version]=${spec.version}&include=preReleaseVersion&limit=${PAGE}`, 'builds');
    demand(builds.data.length === 1, 'ONE_BUILD_REQUIRED',
      `${builds.data.length} builds answered for ${spec.version} build ${spec.buildNumber}`);
    const build = builds.data[0];
    const attributes = build.attributes;
    demand(attributes.version === String(spec.sealedBuildNumber), 'BUILD_NUMBER_MISMATCH',
      `Apple's build is not the ledger's sealed build ${spec.sealedBuildNumber}`);
    const preRelease = build.relationships?.preReleaseVersion?.data;
    const train = Array.isArray(builds.included) ? builds.included.filter((item) => item?.type === 'preReleaseVersions'
      && item.id === preRelease?.id) : [];
    demand(train.length === 1 && train[0].attributes?.version === spec.version
      && train[0].attributes.platform === PLATFORM, 'BUILD_VERSION_MISMATCH',
    `the build is not attached to version ${spec.version}`);
    demand(attributes.processingState === 'VALID', 'BUILD_NOT_VALID',
      `processingState ${STATE.test(attributes.processingState ?? '') ? attributes.processingState : 'unknown'}`);
    demand(attributes.expired === false, 'BUILD_EXPIRED');
    // packaging/ios/RecapPage-Info.plist declares ITSAppUsesNonExemptEncryption false, so Apple
    // should already hold the answer; null means it did not take, and the owner answers it once.
    demand(attributes.usesNonExemptEncryption === false, 'EXPORT_COMPLIANCE_UNANSWERED',
      'answer export compliance for this build in App Store Connect; RecapPage-Info.plist declares '
      + 'ITSAppUsesNonExemptEncryption false');
    receipt.ids.build = build.id;

    const versions = (await list('read-versions',
      `/v1/apps/${appId}/appStoreVersions?filter[platform]=${PLATFORM}&limit=${PAGE}`, 'appStoreVersions'))
      .data.map(versionOf);
    const targets = versions.filter((item) => item.versionString === spec.version);
    demand(targets.length <= 1, 'DUPLICATE_VERSION');
    const target = targets[0] ?? null;
    receipt.before.appStoreVersion = target;
    demand(!target || EDITABLE_STATES.includes(target.appVersionState), 'TARGET_VERSION_NOT_EDITABLE',
      `${spec.version} is ${target?.appVersionState}; it is already submitted or released`);
    const other = versions.filter((item) => item.versionString !== spec.version
      && EDITABLE_STATES.includes(item.appVersionState));
    demand(other.length === 0, 'ANOTHER_VERSION_EDITABLE',
      `${other.map((item) => item.versionString).join(', ')} is editable; Apple allows one, so reconcile it in App Store Connect`);

    const submissions = (await list('read-review-submissions',
      `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${PLATFORM}&limit=${PAGE}`, 'reviewSubmissions')).data;
    submissions.forEach((item) => demand(typeof item.attributes.state === 'string'
      && STATE.test(item.attributes.state), 'SUBMISSION_STATE_MISSING'));
    const open = submissions.filter((item) => OPEN_SUBMISSION_STATES.includes(item.attributes.state));
    receipt.before.openSubmissions = open.map((item) => ({ id: item.id, state: item.attributes.state }));
    // Checked before the first write, so an open submission stops the run with nothing changed.
    demand(open.length === 0, 'OPEN_REVIEW_SUBMISSION',
      'reconcile the open review submission in App Store Connect; nothing is reused or canceled here');

    const versionPath = (id) => `/v1/appStoreVersions/${id}`;
    const readVersion = async (stage, id) => versionOf(single(await read(stage, versionPath(id)), 'appStoreVersions'));
    let versionId = target?.id ?? null;
    if (!target) {
      await change('create-version', 'POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions',
        attributes: { platform: PLATFORM, versionString: spec.version, releaseType: RELEASE_TYPE },
        relationships: { app: { data: { type: 'apps', id: appId } } } } }, (body) => {
        versionId = single(body, 'appStoreVersions').id;
      });
      if (versionId) {
        receipt.ids.appStoreVersion = versionId;
        const created = await readVersion('readback-version', versionId);
        demand(created.versionString === spec.version && created.appVersionState === 'PREPARE_FOR_SUBMISSION'
          && created.releaseType === RELEASE_TYPE, 'CREATED_VERSION_READBACK_MISMATCH');
      }
    } else {
      receipt.ids.appStoreVersion = versionId;
      if (target.releaseType !== RELEASE_TYPE) {
        await change('update-release-type', 'PATCH', versionPath(versionId), { data: { type: 'appStoreVersions',
          id: versionId, attributes: { releaseType: RELEASE_TYPE } } });
        if (mode === 'Submit') {
          demand((await readVersion('readback-release-type', versionId)).releaseType === RELEASE_TYPE,
            'RELEASE_TYPE_READBACK_MISMATCH');
        }
      }
    }

    // The relationship and submitted-flag bodies follow Apple's API reference and are unverified
    // against a live account until the hosted proof plan's Inspect and Submit runs.
    const buildRelation = (id) => `/v1/appStoreVersions/${id}/relationships/build`;
    const setBuild = { data: { type: 'builds', id: build.id } };
    if (versionId) {
      const attached = linkage(await read('read-version-build', buildRelation(versionId)), 'builds');
      if (target) receipt.before.buildId = attached;
      if (attached !== build.id) {
        await change('attach-build', 'PATCH', buildRelation(versionId), setBuild);
        if (mode === 'Submit') {
          demand(linkage(await read('readback-version-build', buildRelation(versionId)), 'builds') === build.id,
            'BUILD_READBACK_MISMATCH');
        }
      }
    } else {
      await change('attach-build', 'PATCH', buildRelation('<created-version>'), setBuild);
    }

    if (versionId) {
      const localizations = (await list('read-localizations',
        `${versionPath(versionId)}/appStoreVersionLocalizations?limit=${PAGE}`, 'appStoreVersionLocalizations'))
        .data.filter((item) => item.attributes.locale === APPLE_LOCALE);
      demand(localizations.length === 1, 'ONE_EN_US_LOCALIZATION_REQUIRED',
        `${localizations.length} ${APPLE_LOCALE} localizations; none is created here`);
      const localization = localizations[0];
      const live = localization.attributes.whatsNew;
      demand(live === null || live === undefined || typeof live === 'string', 'INVALID_WHATS_NEW');
      receipt.ids.localization = localization.id;
      receipt.before.whatsNew = live ?? null;
      receipt.whatsNewDifference = whatsNewDifference(live ?? null, text);
      if (live !== text) {
        const path = `/v1/appStoreVersionLocalizations/${localization.id}`;
        await change('update-whats-new', 'PATCH', path, { data: { type: 'appStoreVersionLocalizations',
          id: localization.id, attributes: { whatsNew: text } } });
        if (mode === 'Submit') {
          const readback = single(await read('readback-whats-new', path), 'appStoreVersionLocalizations');
          demand(readback.attributes.whatsNew === text, 'WHATS_NEW_READBACK_MISMATCH',
            'the live text is not byte for byte the approved text');
        }
      }
    } else {
      receipt.whatsNewDifference = whatsNewDifference(null, text);
      await change('update-whats-new', 'PATCH', '/v1/appStoreVersionLocalizations/<created-en-US>',
        { data: { type: 'appStoreVersionLocalizations', attributes: { whatsNew: text } } });
    }

    let submissionId = null;
    await change('create-review-submission', 'POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions',
      attributes: { platform: PLATFORM }, relationships: { app: { data: { type: 'apps', id: appId } } } } }, (body) => {
      submissionId = single(body, 'reviewSubmissions').id;
    });
    receipt.ids.reviewSubmission = submissionId;
    await change('add-review-item', 'POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems',
      relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId ?? '<created>' } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId ?? '<created-version>' } } } } }, (body) => {
      receipt.ids.reviewSubmissionItem = single(body, 'reviewSubmissionItems').id;
    });
    if (mode === 'Inspect') {
      await change('submit-for-review', 'PATCH', '/v1/reviewSubmissions/<created>', { data: {
        type: 'reviewSubmissions', id: '<created>', attributes: { submitted: true } } });
      receipt.state = 'inspected-no-change';
      receipt.stage = 'complete';
      await save();
      return receipt;
    }
    const items = (await list('read-review-items',
      `/v1/reviewSubmissions/${submissionId}/items?include=appStoreVersion&limit=${PAGE}`, 'reviewSubmissionItems')).data;
    demand(items.length === 1 && items[0].relationships?.appStoreVersion?.data?.id === versionId,
      'REVIEW_ITEMS_MISMATCH', 'the submission must hold exactly this version');
    await change('submit-for-review', 'PATCH', `/v1/reviewSubmissions/${submissionId}`, { data: {
      type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } });
    // From here the version may already be with Apple, so no later failure may read as "blocked".
    receipt.submitAcknowledged = true;
    await save();
    const submitted = single(await read('readback-submission', `/v1/reviewSubmissions/${submissionId}`),
      'reviewSubmissions');
    const state = STATE.test(submitted.attributes.state ?? '') ? submitted.attributes.state : 'unknown';
    receipt.after = { reviewSubmission: { id: submissionId, state } };
    demand(SUBMITTED_STATES.includes(state), 'SUBMISSION_READBACK_STATE', `state ${state}`);
    const after = await readVersion('readback-version-state', versionId);
    receipt.after.appStoreVersion = after;
    receipt.after.buildId = build.id;
    receipt.after.whatsNewSha256 = digest(text);
    receipt.state = 'submitted-for-review';
    receipt.stage = 'complete';
    await save();
    return receipt;
  } catch (error) {
    const known = error instanceof AppStoreError;
    receipt.state = receipt.submitAcknowledged ? 'submitted-readback-unverified'
      : known && error.uncertain ? 'uncertain' : 'blocked';
    receipt.code = known ? error.code : 'UNEXPECTED_FAILURE';
    if (known && error.detail) receipt.detail = error.detail;
    if (known && error.status !== null) receipt.httpStatus = error.status;
    await save();
    throw error;
  }
}
export const plan = (spec, options = {}) => transact({ ...spec, mode: 'Inspect' }, { ...options, mode: 'Inspect' });

function git(...args) {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return { ok: !result.error && result.status === 0 && !result.signal, out: result.stdout?.trim() ?? '' };
}
function gitOut(...args) {
  const result = git(...args);
  demand(result.ok, 'GIT_PROVENANCE_FAILED', args[0]);
  return result.out;
}
async function readJson(path) {
  const bytes = await readFile(path);
  demand(bytes.length <= MAX_JSON, 'JSON_FILE_TOO_LARGE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new AppStoreError('INVALID_JSON_FILE'); }
}
async function github(path) {
  demand(path.startsWith(`repos/${REPOSITORY}/`) && process.env.GITHUB_TOKEN, 'GITHUB_READ_CONTEXT_REQUIRED');
  let response;
  try {
    response = await fetch(`https://api.github.com/${path}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch { throw new AppStoreError('GITHUB_READ_FAILED'); }
  if (!response.ok) await response.body?.cancel();
  demand(response.ok, 'GITHUB_REQUIRED_READ_REJECTED');
  return boundedJson(response);
}
export function runDirectory(environment = process.env) {
  demand(typeof environment.RUNNER_TEMP === 'string' && isAbsolute(environment.RUNNER_TEMP),
    'ABSOLUTE_RUNNER_TEMP_REQUIRED');
  const run = environment.GITHUB_RUN_ID;
  const attempt = environment.GITHUB_RUN_ATTEMPT;
  demand(/^[1-9]\d*$/.test(run ?? '') && /^[1-9]\d*$/.test(attempt ?? ''), 'EXACT_RUN_IDENTITY_REQUIRED');
  const root = resolve(environment.RUNNER_TEMP);
  return { root, work: join(root, `recap-app-store-${run}-${attempt}`) };
}
async function ownedWork() {
  const { root, work } = runDirectory();
  const child = relative(root, work);
  demand(child && !child.startsWith('..') && !isAbsolute(child), 'WORK_OUTSIDE_RUNNER_TEMP');
  for (let item = work; item !== root; item = resolve(item, '..')) {
    let stat;
    try { stat = await lstat(item); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    demand(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'UNSAFE_WORK_DIRECTORY');
  }
  await mkdir(work, { recursive: true, mode: 0o700 });
  return work;
}
async function atomicJson(path, value) {
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
async function environmentPolicy() {
  return protectionPolicy(await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}`),
    await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100`),
    ENVIRONMENT);
}
const fence = (value) => '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)));

export async function prepare({ afterApproval = false } = {}) {
  demand(!process.env.ASC_PRIVATE_KEY && !process.env.ASC_KEY_ID && !process.env.ASC_ISSUER_ID,
    'APPLE_CREDENTIALS_BEFORE_APPROVED_OPERATION');
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
  const source = sourceIdentity(ROOT);
  demand(!source.sourceDirty && source.sourceRevision === context.workflowSha, 'CLEAN_REVIEWED_TOOLING_REQUIRED');
  gitOut('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  const main = gitOut('rev-parse', 'refs/remotes/origin/main');
  demand(git('merge-base', '--is-ancestor', context.workflowSha, main).ok, 'TOOLING_NOT_ON_MAIN');
  let ledger;
  try { ledger = JSON.parse(gitOut('show', `${context.workflowSha}:${LEDGER}`)); }
  catch (error) { throw error instanceof AppStoreError ? error : new AppStoreError('INVALID_IOS_LEDGER'); }
  const entry = sealedBuild(ledger, intent);
  demand(git('merge-base', '--is-ancestor', entry.sourceRevision, main).ok, 'SOURCE_NOT_ON_MAIN');
  demand(gitOut('rev-parse', `${entry.sourceRevision}^{tree}`) === entry.sourceTree, 'SOURCE_TREE_MISMATCH');
  demand(JSON.parse(gitOut('show', `${entry.sourceRevision}:package.json`)).version === intent.version,
    'PACKAGE_VERSION_MISMATCH');
  const approved = approvedStoreText(gitOut('show', `${context.workflowSha}:${storeTextPath(intent.version)}`),
    intent.version, 'app-store');
  demand(approved.locale === STORE_LOCALE, 'APPROVED_LOCALE_MISMATCH');
  const binding = { intent, entry, whatsNewSha256: digest(approved.text) };
  const bindingSha = digest(canonical(binding));
  let policy = null;
  if (intent.mode !== 'Validate') {
    policy = await environmentPolicy();
    if (afterApproval) {
      demand(String(policy.environmentId) === process.env.RECAP_ASC_EXPECTED_ENVIRONMENT_ID
        && policy.sha256 === process.env.RECAP_ASC_EXPECTED_POLICY_SHA
        && HASH.test(bindingSha) && bindingSha === process.env.RECAP_ASC_EXPECTED_BINDING_SHA,
      'APPROVED_BINDING_OR_POLICY_CHANGED');
      requireApproval(await github(`repos/${REPOSITORY}/actions/runs/${context.runId}/approvals`), policy, context);
    }
  } else demand(!afterApproval, 'VALIDATE_HAS_NO_APPROVAL_OR_APPLE_ACCESS');
  if (!afterApproval && process.env.GITHUB_STEP_SUMMARY) {
    const marks = fence(approved.text);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      '## App Store review submission intent', '',
      `Mode ${intent.mode}, version ${intent.version}, sealed build ${entry.buildNumber}, source ${entry.sourceRevision}, `
      + `IPA SHA-256 ${entry.artifact.sha256}, release type ${RELEASE_TYPE}.`, '',
      `### What's New in This Version (${APPLE_LOCALE}), exactly as it would be sent`, '',
      `${approved.length} of ${approved.limit} characters, from ${approved.path} at ${context.workflowSha}.`, '',
      `${marks}text`, approved.text, marks, '',
      'No Apple access has occurred in this validation. Approve only this exact version, build and text.', '',
    ].join('\n'));
  }
  if (!afterApproval && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `binding_sha=${bindingSha}\nenvironment=${policy ? ENVIRONMENT : ''}\n`
      + `environment_id=${policy?.environmentId ?? ''}\npolicy_sha=${policy?.sha256 ?? ''}\n`);
  }
  console.log(`App Store intent validated: ${intent.version} build ${entry.buildNumber}; no Apple access performed.`);
  return { intent, context, entry, approved, bindingSha, policy };
}

export async function operate(command) {
  // Taken out of the environment before any child process starts, so git never inherits the key.
  const secrets = { keyId: process.env.ASC_KEY_ID, issuerId: process.env.ASC_ISSUER_ID,
    privateKeyPem: process.env.ASC_PRIVATE_KEY };
  delete process.env.ASC_KEY_ID;
  delete process.env.ASC_ISSUER_ID;
  delete process.env.ASC_PRIVATE_KEY;
  const prepared = await prepare({ afterApproval: true });
  const mode = command === 'submit' ? 'Submit' : 'Inspect';
  demand(prepared.intent.mode === mode, 'COMMAND_MODE_MISMATCH');
  const token = ascToken(secrets);
  const receiptPath = join(await ownedWork(), 'app-store-receipt.json');
  const result = await transact({ mode, version: prepared.intent.version, buildNumber: prepared.intent.buildNumber,
    sealedBuildNumber: prepared.entry.buildNumber, whatsNew: prepared.approved.text },
  { token, mode, record: (receipt) => atomicJson(receiptPath, receipt) });
  console.log(`App Store result: ${result.state}.`);
  if (result.whatsNewDifference && !result.whatsNewDifference.identical) {
    for (const line of result.whatsNewDifference.lines) {
      console.log(`What's New line ${line.line} differs. Live: ${JSON.stringify(line.live)} Approved: ${JSON.stringify(line.approved)}`);
    }
  }
  return result;
}

async function main() {
  demand(process.argv.length === 3, 'EXPECTED_ONE_COMMAND');
  const command = process.argv[2];
  if (command === 'validate') await prepare();
  else if (command === 'approved-validate') await prepare({ afterApproval: true });
  else if (command === 'inspect' || command === 'submit') await operate(command);
  else throw new AppStoreError('EXPECTED_VALIDATE_INSPECT_OR_SUBMIT');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof AppStoreError || error instanceof CandidateError || error instanceof StoreTextError
      ? error.message : 'App Store release: a required check failed; no success or retry implied.');
    process.exitCode = 1;
  });
}
