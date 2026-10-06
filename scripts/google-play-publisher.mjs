import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPOSITORY, OFFICIAL_ID, PROTOTYPE_ID, PACKET, BUNDLETOOL, certificateFingerprint,
  protectionPolicy, requireApproval, requireSourceAncestry, assertFiles, checkRecord,
  verifyNativeReport, CandidateError,
} from './android-candidate.mjs';
import {
  ROOT, ANDROID_CODE_LIMIT, DEVELOPMENT_ANDROID_CODE, sourceIdentity,
  validateAndroidLedger, assertAppendOnlyLedger, verifyAndroidPromotion,
} from './lib/release-identity.mjs';

export const ENVIRONMENT = 'google-play-publishing';
export const WORKFLOW = '.github/workflows/google-play-release.yml';
export const PRODUCER = '.github/workflows/android-release-candidate.yml';
export const REPOSITORY_ID = 1322551430;
const LEDGER = 'packaging/android/version-codes.json';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const MODES = ['Validate', 'Inspect', 'Publish', 'Promote'];
const INPUTS = ['mode', 'source_sha', 'ledger_sha', 'candidate_run_id', 'artifact_id',
  'version_code', 'track', 'release_notes', 'release_json', 'track_state_policy',
  'expected_track_sha256', 'upload_cert_sha256'];
const IDENTITY_INPUTS = ['source_sha', 'ledger_sha', 'artifact_id', 'version_code', 'upload_cert_sha256'];
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${OFFICIAL_ID}`;

export class PublisherError extends Error {
  constructor(code, { status = null, uncertain = false } = {}) {
    super(`Google Play publisher: ${code}`);
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}
const demand = (value, code) => { if (!value) throw new PublisherError(code); };
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function object(value, required, optional = []) {
  demand(value && typeof value === 'object' && !Array.isArray(value), 'OBJECT_REQUIRED');
  demand(required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => [...required, ...optional].includes(key)), 'UNEXPECTED_FIELDS');
}
function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  demand(typeof value === 'string' && /^[1-9]\d*$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) <= maximum, 'INVALID_INTEGER');
  return Number(value);
}
function text(value, maximum) {
  demand(typeof value === 'string' && value.trim().length > 0 && [...value].length <= maximum,
    'INVALID_TEXT');
  demand(![...value].some((character) => {
    const code = character.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
      || (code >= 0xd800 && code <= 0xdfff);
  }), 'INVALID_TEXT');
  return value;
}
export function testingTrack(value) {
  demand(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value),
    'EXPLICIT_TRACK_REQUIRED');
  demand(!/(^|:)production$/i.test(value), 'PRODUCTION_NOT_AUTHORIZED');
  return value;
}
function desiredRelease(value, code) {
  object(value, ['name', 'versionCodes', 'status', 'releaseNotes']);
  text(value.name, 100);
  demand(['draft', 'completed'].includes(value.status), 'ROLLOUT_NOT_AUTHORIZED');
  demand(Array.isArray(value.versionCodes) && value.versionCodes.length > 0
    && value.versionCodes.length <= 20, 'VERSION_CODES_REQUIRED');
  value.versionCodes.forEach((item) => integer(item, ANDROID_CODE_LIMIT));
  demand(new Set(value.versionCodes).size === value.versionCodes.length
    && (code === null || value.versionCodes.filter((item) => item === String(code)).length === 1),
  'CANDIDATE_CODE_REQUIRED');
  demand(Array.isArray(value.releaseNotes) && value.releaseNotes.length > 0
    && value.releaseNotes.length <= 10, 'RELEASE_NOTES_REQUIRED');
  const languages = new Set();
  for (const note of value.releaseNotes) {
    object(note, ['language', 'text']);
    demand(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(note.language)
      && !languages.has(note.language), 'INVALID_NOTE_LANGUAGE');
    languages.add(note.language);
    text(note.text, 500);
  }
  return value;
}
export function validateIntent(raw) {
  object(raw, ['mode', 'candidate_run_id'], INPUTS);
  demand(Object.values(raw).every((value) => typeof value === 'string'
    && (value === '' || value.trim().length > 0)), 'INVALID_INPUT_TEXT');
  demand(MODES.includes(raw.mode), 'EXPLICIT_MODE_REQUIRED');
  const pins = IDENTITY_INPUTS.filter((key) => raw[key]);
  demand(pins.length === 0 || pins.length === IDENTITY_INPUTS.length, 'ALL_OR_NONE_IDENTITY_PINS_REQUIRED');
  const pinned = pins.length > 0;
  demand(!pinned || (SHA.test(raw.source_sha) && SHA.test(raw.ledger_sha)), 'EXACT_SOURCE_REQUIRED');
  const code = pinned ? integer(raw.version_code, ANDROID_CODE_LIMIT) : null;
  demand(code === null || code > DEVELOPMENT_ANDROID_CODE, 'DEVELOPMENT_CODE_REFUSED');
  const runPrefix = `https://github.com/${REPOSITORY}/actions/runs/`;
  const producer = raw.candidate_run_id.startsWith(runPrefix)
    ? raw.candidate_run_id.slice(runPrefix.length) : raw.candidate_run_id;
  const requestedPolicy = raw.track_state_policy || 'automatic';
  demand(['automatic', 'capture-current-simple', 'explicit-pin'].includes(requestedPolicy), 'UNKNOWN_TRACK_STATE_POLICY');
  demand(!(raw.release_notes && raw.release_json), 'NOTES_AND_JSON_CONFLICT');
  const spec = {
    mode: raw.mode, sourceSha: pinned ? raw.source_sha : null, ledgerSha: pinned ? raw.ledger_sha : null,
    producerRunId: integer(producer), artifactId: pinned ? integer(raw.artifact_id) : null, code,
    signer: pinned ? certificateFingerprint(raw.upload_cert_sha256) : null, track: raw.track || '',
    expectedTrackSha256: raw.expected_track_sha256 || '', trackStatePolicy: null,
    releaseNotes: raw.release_notes ? text(raw.release_notes, 500) : '', release: null,
  };
  if (spec.track) testingTrack(spec.track);
  const mutating = ['Publish', 'Promote'].includes(spec.mode);
  const proposed = Boolean(raw.release_json || spec.releaseNotes);
  demand(!spec.expectedTrackSha256 || HASH.test(spec.expectedTrackSha256), 'INVALID_TRACK_PIN');
  demand(requestedPolicy !== 'capture-current-simple' || !spec.expectedTrackSha256, 'CAPTURE_AND_PIN_CONFLICT');
  demand(spec.mode !== 'Inspect' || (!proposed && !spec.expectedTrackSha256 && requestedPolicy === 'automatic'),
    'INSPECT_CANNOT_RECEIVE_RELEASE_INTENT');
  if (!mutating && !proposed) {
    demand(!spec.expectedTrackSha256 && requestedPolicy === 'automatic', 'NEUTRAL_MODE_CANNOT_RECEIVE_TRACK_POLICY');
  } else {
    testingTrack(spec.track);
    demand(proposed, 'RELEASE_REQUIRED');
    spec.trackStatePolicy = requestedPolicy === 'automatic'
      ? spec.expectedTrackSha256 ? 'explicit-pin' : spec.releaseNotes ? 'capture-current-simple' : null
      : requestedPolicy;
    demand(spec.trackStatePolicy !== null, 'TRACK_PIN_AND_RELEASE_REQUIRED');
    demand(spec.trackStatePolicy !== 'explicit-pin' || HASH.test(spec.expectedTrackSha256), 'TRACK_PIN_REQUIRED');
    demand(spec.mode !== 'Promote' || spec.trackStatePolicy === 'explicit-pin', 'PROMOTION_REQUIRES_EXPLICIT_PIN');
    if (raw.release_json) {
      demand(Buffer.byteLength(raw.release_json) <= 8192, 'RELEASE_JSON_TOO_LARGE');
      let release;
      try { release = JSON.parse(raw.release_json); } catch { throw new PublisherError('INVALID_RELEASE_JSON'); }
      spec.release = desiredRelease(release, code);
    }
  }
  return spec;
}

export function resolveIntent(request, { sourceSha, ledgerSha, artifactId, code, signer, productVersion }) {
  demand(SHA.test(sourceSha) && SHA.test(ledgerSha) && Number.isSafeInteger(artifactId) && artifactId > 0
    && Number.isSafeInteger(code) && code > DEVELOPMENT_ANDROID_CODE && code <= ANDROID_CODE_LIMIT
    && HASH.test(signer), 'RESOLVED_IDENTITY_REQUIRED');
  const pins = { sourceSha, ledgerSha, artifactId, code, signer };
  demand(Object.entries(pins).every(([key, value]) => request[key] === null || request[key] === value),
    'IDENTITY_PIN_MISMATCH');
  const release = request.releaseNotes ? {
    name: `Recap Page ${text(productVersion, 80)}`, versionCodes: [String(code)], status: 'completed',
    releaseNotes: [{ language: 'en-US', text: request.releaseNotes }],
  } : request.release;
  return { ...request, ...pins, release: release ? desiredRelease(release, code) : null };
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
function validateProducerRun(producerRunId, run) {
  demand(run.id === producerRunId && run.run_attempt === 1 && run.event === 'workflow_dispatch'
    && run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'main'
    && SHA.test(run.head_sha) && run.path?.split('@')[0] === PRODUCER
    && run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID,
  'QUALIFIED_PRODUCER_REQUIRED');
}
function artifactRunMatches(artifact, run) {
  return artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === run.head_sha
    && artifact.workflow_run.head_branch === 'main'
    && artifact.workflow_run.repository_id === REPOSITORY_ID
    && artifact.workflow_run.head_repository_id === REPOSITORY_ID;
}
export function validateProducer(spec, run, artifact) {
  validateProducerRun(spec.producerRunId, run);
  demand(artifact.id === spec.artifactId && artifact.expired === false
    && artifact.name === `android-candidate-${spec.code}-${run.id}`
    && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
    && artifact.size_in_bytes <= MAX_ARCHIVE
    && /^sha256:[0-9a-f]{64}$/.test(artifact.digest)
    && artifactRunMatches(artifact, run), 'PRODUCER_ARTIFACT_MISMATCH');
}
export function selectProducerArtifact(request, producer, listing) {
  validateProducerRun(request.producerRunId, producer);
  demand(Number.isSafeInteger(listing.total_count) && listing.total_count > 0 && listing.total_count <= 100
    && Array.isArray(listing.artifacts) && listing.artifacts.length === listing.total_count,
  'COMPLETE_BOUNDED_ARTIFACT_LIST_REQUIRED');
  demand(listing.artifacts.every((artifact) => artifact && Number.isSafeInteger(artifact.id)
    && artifact.id > 0 && typeof artifact.name === 'string' && artifactRunMatches(artifact, producer))
    && new Set(listing.artifacts.map((artifact) => artifact.id)).size === listing.artifacts.length,
  'ARTIFACT_LIST_IDENTITY_MISMATCH');
  const name = new RegExp(`^android-candidate-([1-9]\\d*)-${producer.id}$`);
  const matches = listing.artifacts.filter((artifact) => name.test(artifact.name));
  demand(matches.length === 1, 'ONE_CANDIDATE_PACKET_REQUIRED');
  const artifact = matches[0];
  const code = integer(name.exec(artifact.name)[1], ANDROID_CODE_LIMIT);
  demand(code > DEVELOPMENT_ANDROID_CODE, 'DEVELOPMENT_CODE_REFUSED');
  validateProducer({ ...request, artifactId: artifact.id, code }, producer, artifact);
  return { artifact, code };
}
export function validateQualification(report, record, recordBytes, spec, producer, approval) {
  const { artifact, ...identity } = record;
  object(report, ['schemaVersion', 'kind', 'source', 'workflow', 'ledgerCommit', 'approval',
    'bundle', 'proofSignerSha256', 'native', 'scope', 'tools', 'artifactRecordSha256']);
  demand(report.schemaVersion === 1 && report.kind === 'qualified-candidate'
    && report.artifactRecordSha256 === digest(recordBytes)
    && artifact && canonical(report.source) === canonical(identity),
  'QUALIFICATION_IDENTITY_MISMATCH');
  object(report.workflow, ['sha', 'path', 'runId', 'attempt']);
  demand(report.workflow.sha === producer.head_sha && report.workflow.path === PRODUCER
    && report.workflow.runId === spec.producerRunId && report.workflow.attempt === 1
    && SHA.test(report.ledgerCommit) && canonical(report.approval) === canonical(approval),
  'QUALIFICATION_APPROVAL_MISMATCH');
  object(report.bundle, ['bundleSha256', 'bundleSignerSha256', 'structure', 'manifest',
    'resources', 'assets', 'nativeLibraries', 'apkSignatures']);
  demand(report.bundle.bundleSha256 === record.artifact.sha256
    && report.bundle.bundleSignerSha256 === spec.signer
    && ['structure', 'manifest', 'resources', 'assets', 'apkSignatures'].every((key) => report.bundle[key] === true)
    && report.bundle.nativeLibraries === 0, 'PACKAGE_QUALIFICATION_INCOMPLETE');
  const official = report.native?.executions?.find((entry) => entry.packageName === OFFICIAL_ID);
  const prototype = report.native?.executions?.find((entry) => entry.packageName === PROTOTYPE_ID);
  demand(official && prototype && report.proofSignerSha256 === official.signerSha256
    && spec.signer !== official.signerSha256 && spec.signer !== prototype.signerSha256,
  'UPLOAD_AND_TEST_SIGNERS_MUST_DIFFER');
  // These are receipt-consistency checks; the immutable producer run supplies the native proof.
  verifyNativeReport(report.native, { official, prototype });
  object(report.tools, ['bundletool', 'jdk', 'gradle', 'agp', 'sdkBuildTools']);
  demand(canonical(report.tools?.bundletool) === canonical(BUNDLETOOL)
    && typeof report.scope === 'string' && report.scope.includes('Synthetic')
    && report.scope.includes('not API26 runtime, Play signer, upgrade or physical acceptance'),
  'QUALIFICATION_SCOPE_MISMATCH');
}

function actualRelease(value) {
  object(value, ['versionCodes', 'status'], ['name', 'releaseNotes', 'userFraction',
    'countryTargeting', 'inAppUpdatePriority']);
  demand(['draft', 'completed', 'inProgress', 'halted'].includes(value.status)
    && Array.isArray(value.versionCodes) && value.versionCodes.length <= 100, 'INVALID_REMOTE_RELEASE');
  value.versionCodes.forEach((code) => integer(code, ANDROID_CODE_LIMIT));
  demand(new Set(value.versionCodes).size === value.versionCodes.length, 'DUPLICATE_REMOTE_CODE');
  if (value.name !== undefined) text(value.name, 1000);
  if (value.releaseNotes !== undefined) {
    demand(Array.isArray(value.releaseNotes) && value.releaseNotes.length <= 100, 'INVALID_REMOTE_NOTES');
    const languages = new Set();
    for (const note of value.releaseNotes) {
      object(note, ['language', 'text']);
      text(note.language, 100);
      text(note.text, 4096);
      demand(!languages.has(note.language), 'DUPLICATE_REMOTE_NOTE_LANGUAGE');
      languages.add(note.language);
    }
  }
  if (value.userFraction !== undefined) demand(Number.isFinite(value.userFraction)
    && value.userFraction > 0 && value.userFraction < 1, 'INVALID_REMOTE_FRACTION');
  if (value.inAppUpdatePriority !== undefined) demand(Number.isInteger(value.inAppUpdatePriority)
    && value.inAppUpdatePriority >= 0 && value.inAppUpdatePriority <= 5, 'INVALID_REMOTE_PRIORITY');
  if (value.countryTargeting !== undefined) {
    object(value.countryTargeting, [], ['countries', 'includeRestOfWorld']);
    demand(value.countryTargeting.countries === undefined
      || (Array.isArray(value.countryTargeting.countries)
        && value.countryTargeting.countries.every((country) => /^[A-Z]{2}$/.test(country))),
    'INVALID_REMOTE_COUNTRIES');
    demand(value.countryTargeting.includeRestOfWorld === undefined
      || typeof value.countryTargeting.includeRestOfWorld === 'boolean', 'INVALID_REMOTE_COUNTRIES');
  }
  const result = { ...value, versionCodes: [...value.versionCodes].sort((a, b) => Number(a) - Number(b)) };
  if (value.releaseNotes) result.releaseNotes = [...value.releaseNotes]
    .sort((a, b) => a.language < b.language ? -1 : a.language > b.language ? 1 : 0);
  if (result.inAppUpdatePriority === 0) delete result.inAppUpdatePriority;
  return result;
}
export function trackSnapshot(value) {
  object(value, ['track'], ['releases', 'kind']);
  demand(typeof value.track === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value.track),
    'INVALID_REMOTE_TRACK');
  if (value.kind !== undefined) demand(value.kind === 'androidpublisher#track', 'INVALID_REMOTE_TRACK_KIND');
  // Google omits empty repeated fields; only its documented release array is normalized.
  const releases = value.releases === undefined ? [] : value.releases;
  demand(Array.isArray(releases) && releases.length <= 100, 'INVALID_REMOTE_RELEASES');
  return { track: value.track, releases: releases.map(actualRelease) };
}
export const trackDigest = (value) => digest(canonical(trackSnapshot(value)));
export function proposedTrack(spec, current) {
  testingTrack(spec.track);
  const snapshot = trackSnapshot(current);
  demand(spec.release && snapshot.track === spec.track, 'TRACK_STATE_CHANGED');
  demand(['explicit-pin', 'capture-current-simple'].includes(spec.trackStatePolicy), 'RESOLVED_TRACK_POLICY_REQUIRED');
  if (spec.trackStatePolicy === 'explicit-pin') {
    demand(trackDigest(snapshot) === spec.expectedTrackSha256, 'TRACK_STATE_CHANGED');
  } else {
    demand(['Publish', 'Validate'].includes(spec.mode) && !spec.expectedTrackSha256, 'CAPTURE_POLICY_CONFLICT');
  }
  demand(snapshot.releases.length <= 1
    && snapshot.releases.every((release) => ['draft', 'completed'].includes(release.status)
      && release.userFraction === undefined && release.countryTargeting === undefined
      && (release.inAppUpdatePriority === undefined || release.inAppUpdatePriority === 0)),
  'COMPLEX_TRACK_REQUIRES_OPERATOR_RECONCILIATION');
  const previousCodes = new Set(snapshot.releases.flatMap((release) => release.versionCodes));
  demand(spec.release.versionCodes.every((code) => code === String(spec.code) || previousCodes.has(code)),
    'UNAPPROVED_RETAINED_CODE');
  return { track: spec.track, releases: [spec.release] };
}
function tracksBody(value) {
  object(value, [], ['kind', 'tracks']);
  if (value.kind !== undefined) demand(value.kind === 'androidpublisher#tracksListResponse', 'INVALID_TRACKS_KIND');
  const tracks = value.tracks === undefined ? [] : value.tracks;
  demand(Array.isArray(tracks) && tracks.length <= 200, 'INVALID_TRACK_LIST');
  const result = tracks.map(trackSnapshot);
  demand(new Set(result.map((track) => track.track)).size === result.length, 'DUPLICATE_TRACK');
  return result;
}
function binaryList(value, property) {
  object(value, [], [property, 'kind']);
  const items = value[property] === undefined ? [] : value[property];
  demand(Array.isArray(items) && items.length <= 10000, 'INVALID_BINARY_LIST');
  for (const item of items) demand(Number.isSafeInteger(item.versionCode)
    && item.versionCode > 0 && item.versionCode <= ANDROID_CODE_LIMIT, 'INVALID_REMOTE_CODE');
  return items;
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
  catch { throw new PublisherError('INVALID_API_JSON'); }
}
export async function transact(spec, bundle, artifact, {
  token, fetchImpl = globalThis.fetch, record, now = Date.now,
} = {}) {
  demand(['Inspect', 'Publish', 'Promote'].includes(spec.mode), 'PLAY_OPERATION_REQUIRED');
  demand(typeof record === 'function', 'DURABLE_RECEIPT_WRITER_REQUIRED');
  demand(SHA.test(spec.sourceSha) && Number.isSafeInteger(spec.code)
    && spec.code > DEVELOPMENT_ANDROID_CODE && spec.code <= ANDROID_CODE_LIMIT, 'INVALID_OPERATION_IDENTITY');
  if (spec.track) testingTrack(spec.track);
  if (spec.mode !== 'Inspect') {
    testingTrack(spec.track);
    desiredRelease(spec.release, spec.code);
    demand(spec.trackStatePolicy === 'explicit-pin' ? HASH.test(spec.expectedTrackSha256)
      : spec.trackStatePolicy === 'capture-current-simple' && spec.mode === 'Publish' && !spec.expectedTrackSha256,
    'RESOLVED_TRACK_POLICY_REQUIRED');
  } else {
    demand(spec.trackStatePolicy === null && !spec.release && !spec.releaseNotes && !spec.expectedTrackSha256,
      'INSPECT_CANNOT_RECEIVE_RELEASE_INTENT');
  }
  demand(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'ACCESS_TOKEN_REQUIRED');
  demand(Buffer.isBuffer(bundle) && bundle.length === artifact.bytes
    && digest(bundle) === artifact.sha256, 'BUNDLE_CHANGED_BEFORE_OPERATION');
  const receipt = {
    schemaVersion: 1, mode: spec.mode, packageName: OFFICIAL_ID,
    sourceRevision: spec.sourceSha, versionCode: spec.code, bundleSha256: artifact.sha256,
    intentSha256: digest(canonical(spec)),
    track: spec.track || null, expectedTrackSha256: spec.expectedTrackSha256 || null,
    trackStatePolicy: spec.trackStatePolicy,
    stage: 'ready', state: 'running', editId: null, mutationAttempted: false,
    commitAcknowledged: false, userAvailability: 'unverified', httpStatus: null,
  };
  const save = async () => record(structuredClone(receipt));
  let expiry = Infinity;
  async function request(stage, method, url, payload, media = false) {
    demand(now() < expiry, 'EDIT_EXPIRED');
    receipt.stage = stage;
    receipt.httpStatus = null;
    const mutation = method !== 'GET';
    receipt.mutationAttempted ||= mutation;
    await save();
    let response;
    try {
      response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(media ? 120000 : 30000),
        headers: { Authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { 'Content-Type': media ? 'application/octet-stream' : 'application/json' }) },
        ...(payload === undefined ? {} : { body: media ? payload : JSON.stringify(payload) }),
      });
    } catch {
      throw new PublisherError('TRANSPORT_OUTCOME_UNKNOWN', { uncertain: mutation });
    }
    receipt.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublisherError('PLAY_HTTP_REJECTED', {
        status: response.status, uncertain: mutation && response.status >= 500,
      });
    }
    try { return await boundedJson(response); }
    catch (error) {
      throw new PublisherError(error instanceof PublisherError ? error.code : 'API_READ_FAILED',
        { status: response.status, uncertain: mutation });
    }
  }
  try {
    const edit = await request('create-edit', 'POST', `${API}/edits`, {});
    demand(typeof edit.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(edit.id)
      && typeof edit.expiryTimeSeconds === 'string' && /^\d+$/.test(edit.expiryTimeSeconds)
      && Number.isSafeInteger(Number(edit.expiryTimeSeconds)), 'INVALID_EDIT_IDENTITY');
    receipt.editId = edit.id;
    expiry = Number(edit.expiryTimeSeconds) * 1000;
    demand(Number.isSafeInteger(expiry) && expiry > now(), 'EDIT_EXPIRED');
    await save();
    const editUrl = `${API}/edits/${encodeURIComponent(edit.id)}`;
    const tracks = tracksBody(await request('read-tracks', 'GET', `${editUrl}/tracks`));
    const bundles = binaryList(await request('read-bundles', 'GET', `${editUrl}/bundles`), 'bundles');
    const apks = binaryList(await request('read-apks', 'GET', `${editUrl}/apks`), 'apks');
    const codes = [...bundles, ...apks].map((item) => item.versionCode);
    for (const track of tracks) for (const release of track.releases) {
      for (const value of release.versionCodes) codes.push(Number(value));
    }
    receipt.observedHighWater = codes.reduce((maximum, value) => Math.max(maximum, value), 0);
    if (spec.mode === 'Inspect') {
      receipt.tracks = tracks.filter((track) => !/(^|:)production$/i.test(track.track))
        .map((track) => ({ track: track.track, sha256: trackDigest(track) }));
      receipt.state = 'inspected-no-release-change';
      receipt.stage = 'complete';
      await save();
      return receipt;
    }
    const current = tracks.find((track) => track.track === spec.track);
    demand(current, 'TRACK_NOT_FOUND_NO_ALIAS_FALLBACK');
    const desired = proposedTrack(spec, current);
    const matching = bundles.filter((item) => item.versionCode === spec.code);
    if (spec.mode === 'Publish') {
      demand(spec.code > receipt.observedHighWater && matching.length === 0, 'CODE_ALREADY_USED_OR_OUT_OF_ORDER');
    } else {
      demand(matching.length === 1 && matching[0].sha256 === artifact.sha256,
        'PROMOTION_REQUIRES_EXACT_EXISTING_BUNDLE');
    }
    receipt.targetBefore = trackSnapshot(current);
    receipt.targetBeforeSha256 = trackDigest(current);
    receipt.desiredTarget = trackSnapshot(desired);
    receipt.stage = 'target-prepared';
    await save();
    if (spec.mode === 'Publish') {
      demand(digest(bundle) === artifact.sha256 && bundle.length === artifact.bytes, 'BUNDLE_CHANGED_BEFORE_UPLOAD');
      const uploaded = await request('upload-bundle', 'POST',
        `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${OFFICIAL_ID}/edits/${encodeURIComponent(edit.id)}/bundles?uploadType=media`,
        bundle, true);
      demand(uploaded.versionCode === spec.code && uploaded.sha256 === artifact.sha256, 'UPLOAD_IDENTITY_MISMATCH');
    }
    await request('update-track', 'PUT', `${editUrl}/tracks/${encodeURIComponent(spec.track)}`, desired);
    const readback = tracksBody(await request('readback-tracks', 'GET', `${editUrl}/tracks`));
    demand(readback.length === tracks.length && tracks.every((track) => {
      const actual = readback.find((entry) => entry.track === track.track);
      return actual && canonical(actual) === canonical(track.track === spec.track ? trackSnapshot(desired) : track);
    }), 'TRACK_READBACK_MISMATCH');
    const validation = await request('validate-edit', 'POST', `${editUrl}:validate`);
    demand(validation.id === edit.id, 'VALIDATION_IDENTITY_MISMATCH');
    const committed = await request('commit-edit', 'POST',
      `${editUrl}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`);
    demand(committed.id === edit.id, 'COMMIT_ACKNOWLEDGEMENT_UNVERIFIED');
    receipt.commitAcknowledged = true;
    receipt.state = 'submitted-publication-unverified';
    receipt.stage = 'complete';
    await save();
    return receipt;
  } catch (error) {
    const unverifiedMutation = ['create-edit', 'upload-bundle', 'update-track', 'commit-edit'].includes(receipt.stage)
      && receipt.httpStatus >= 200 && receipt.httpStatus < 300;
    receipt.state = (error instanceof PublisherError && error.uncertain) || unverifiedMutation ? 'uncertain' : 'blocked';
    receipt.code = error instanceof PublisherError ? error.code : 'UNEXPECTED_FAILURE';
    if (error instanceof PublisherError && error.status !== null) receipt.httpStatus = error.status;
    await save();
    throw error;
  }
}

function native(file, args, { binary = false, code = 'NATIVE_COMMAND_FAILED' } = {}) {
  const result = spawnSync(file, args, {
    cwd: ROOT, encoding: binary ? undefined : 'utf8', timeout: 120000,
    maxBuffer: binary ? MAX_ARCHIVE : 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  demand(!result.error && result.status === 0 && !result.signal, code);
  return binary ? result.stdout : result.stdout.trim();
}
const git = (...args) => native('git', ['--no-pager', ...args], { code: 'GIT_PROVENANCE_FAILED' });
async function readJson(path) {
  const bytes = await readFile(path);
  demand(bytes.length <= MAX_JSON, 'JSON_FILE_TOO_LARGE');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new PublisherError('INVALID_JSON_FILE'); }
}
async function github(path) {
  demand(path.startsWith(`repos/${REPOSITORY}/`) && process.env.GITHUB_TOKEN, 'GITHUB_READ_CONTEXT_REQUIRED');
  let response;
  try {
    response = await fetch(`https://api.github.com/${path}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
  } catch { throw new PublisherError('GITHUB_READ_FAILED'); }
  demand(response.ok, 'GITHUB_REQUIRED_READ_REJECTED');
  return boundedJson(response);
}
export function runDirectory(environment = process.env) {
  demand(typeof environment.RUNNER_TEMP === 'string' && isAbsolute(environment.RUNNER_TEMP),
    'ABSOLUTE_RUNNER_TEMP_REQUIRED');
  const run = environment.GITHUB_RUN_ID;
  const attempt = environment.GITHUB_RUN_ATTEMPT;
  demand(typeof run === 'string' && /^[1-9]\d*$/.test(run) && Number.isSafeInteger(Number(run))
    && typeof attempt === 'string' && /^[1-9]\d*$/.test(attempt) && Number.isSafeInteger(Number(attempt)),
  'EXACT_RUN_IDENTITY_REQUIRED');
  const root = resolve(environment.RUNNER_TEMP);
  return { root, work: join(root, `recap-google-play-${run}-${attempt}`) };
}
async function ownedWork() {
  const { root, work } = runDirectory();
  const child = relative(root, work);
  demand(child && !child.startsWith('..') && !isAbsolute(child), 'WORK_OUTSIDE_RUNNER_TEMP');
  for (let item = work; item !== root; item = resolve(item, '..')) {
    let stat;
    try { stat = await lstat(item); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
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
async function contextAndInput() {
  const event = await readJson(process.env.GITHUB_EVENT_PATH);
  const request = validateIntent(event.inputs);
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
  return { request, context };
}
async function policy(name) {
  return protectionPolicy(await github(`repos/${REPOSITORY}/environments/${name}`),
    await github(`repos/${REPOSITORY}/environments/${name}/deployment-branch-policies?per_page=100`), name);
}
export async function prepare({ afterApproval = false } = {}) {
  demand(!process.env.RECAP_PLAY_ACCESS_TOKEN, 'TOKEN_BEFORE_APPROVED_VALIDATION');
  const { request, context } = await contextAndInput();
  const work = await ownedWork();
  const producer = await github(`repos/${REPOSITORY}/actions/runs/${request.producerRunId}`);
  validateProducerRun(request.producerRunId, producer);
  let artifact;
  let code = request.code;
  if (request.artifactId !== null) {
    artifact = await github(`repos/${REPOSITORY}/actions/artifacts/${request.artifactId}`);
    validateProducer(request, producer, artifact);
  } else {
    ({ artifact, code } = selectProducerArtifact(request, producer,
      await github(`repos/${REPOSITORY}/actions/runs/${producer.id}/artifacts?per_page=100`)));
  }
  const ledgerSha = request.ledgerSha || context.workflowSha;
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  const main = git('rev-parse', 'refs/remotes/origin/main');
  const selected = validateAndroidLedger(JSON.parse(git('show', `${ledgerSha}:${LEDGER}`)));
  const reservation = selected.reservations.find((entry) => entry.versionCode === code);
  demand(reservation?.artifact, 'SEALED_RESERVATION_REQUIRED');
  const sourceSha = reservation.sourceRevision;
  requireSourceAncestry(ROOT, sourceSha, ledgerSha, context.workflowSha, main);
  demand(git('rev-parse', `${sourceSha}^{commit}`) === sourceSha, 'SOURCE_COMMIT_REQUIRED');
  git('merge-base', '--is-ancestor', producer.head_sha, main);
  const current = validateAndroidLedger(JSON.parse(git('show', `${main}:${LEDGER}`)));
  assertAppendOnlyLedger(selected, current);
  let previous = { schemaVersion: 1, retiredThrough: DEVELOPMENT_ANDROID_CODE, reservations: [] };
  for (const revision of git('log', '--first-parent', '--reverse', '--format=%H', main, '--', LEDGER).split(/\r?\n/).filter(Boolean)) {
    const next = JSON.parse(git('show', `${revision}:${LEDGER}`));
    assertAppendOnlyLedger(previous, next);
    previous = next;
  }
  const signingPolicy = await policy('android-release-candidate');
  const producerApproval = requireApproval(
    await github(`repos/${REPOSITORY}/actions/runs/${producer.id}/approvals`),
    signingPolicy, { runId: producer.id, attempt: 1 },
  );
  const zip = native('gh', ['api', `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
    '--allow-escape-sequences'], { binary: true, code: 'ARTIFACT_DOWNLOAD_FAILED' });
  demand(zip.length === artifact.size_in_bytes && digest(zip) === artifact.digest.slice(7), 'ARTIFACT_ARCHIVE_DIGEST_MISMATCH');
  const archive = join(work, 'candidate-packet.zip');
  await writeFile(archive, zip, { flag: 'wx', mode: 0o600 });
  demand(process.env.JAVA_HOME_17_X64 && isAbsolute(process.env.JAVA_HOME_17_X64), 'REVIEWED_JDK17_REQUIRED');
  const java = join(process.env.JAVA_HOME_17_X64, 'bin', 'java');
  const helper = join(ROOT, 'scripts', 'android', 'VerifyBundle.java');
  const packet = join(work, 'packet');
  native(java, [helper, 'archive', archive, '-', packet], { code: 'PACKET_ARCHIVE_REFUSED' });
  await assertFiles(packet, PACKET);
  const recordPath = join(packet, 'android-artifact.json');
  const recordBytes = await readFile(recordPath);
  const record = await readJson(recordPath);
  const report = await readJson(join(packet, 'android-candidate.json'));
  const proposed = validateAndroidLedger(await readJson(join(packet, 'version-codes.proposed.json')));
  const identity = {
    schemaVersion: 1, productVersion: JSON.parse(git('show', `${sourceSha}:package.json`)).version,
    platform: 'android', packageVersion: code, channel: 'candidate',
    sourceRevision: sourceSha, sourceTree: git('rev-parse', `${sourceSha}^{tree}`), sourceDirty: false,
  };
  const spec = resolveIntent(request, { sourceSha, ledgerSha, artifactId: artifact.id, code,
    signer: certificateFingerprint(report.bundle?.bundleSignerSha256), productVersion: identity.productVersion });
  checkRecord(record, identity);
  assertAppendOnlyLedger(proposed, selected);
  const bundlePath = join(packet, 'recap-page-android.aab');
  await verifyAndroidPromotion(bundlePath, record, selected);
  await verifyAndroidPromotion(bundlePath, record, current);
  validateQualification(report, record, recordBytes, spec, producer, producerApproval);
  requireSourceAncestry(ROOT, spec.sourceSha, report.ledgerCommit, producer.head_sha, main);
  git('merge-base', '--is-ancestor', report.ledgerCommit, spec.ledgerSha);
  native(java, [helper, 'archive', bundlePath, spec.signer, join(work, 'verified-bundle')],
    { code: 'ACTUAL_BUNDLE_SIGNATURE_REFUSED' });
  demand(canonical(await readJson(join(work, 'verified-bundle', 'base', 'assets', 'recap', 'build-info.json')))
    === canonical(identity), 'EMBEDDED_SOURCE_IDENTITY_MISMATCH');
  const binding = {
    schemaVersion: 1, request, spec, source: identity, artifactId: artifact.id, archiveSha256: artifact.digest.slice(7),
    bundle: record.artifact, producerRunId: producer.id, producerSha: producer.head_sha,
    qualificationSha256: digest(await readFile(join(packet, 'android-candidate.json'))),
    ledgerSha256: digest(canonical(selected)),
  };
  const bindingSha = digest(canonical(binding));
  let publisherPolicy = null;
  let approval = null;
  if (spec.mode !== 'Validate') {
    publisherPolicy = await policy(ENVIRONMENT);
    if (afterApproval) {
      demand(String(publisherPolicy.environmentId) === process.env.RECAP_PLAY_EXPECTED_ENVIRONMENT_ID
        && publisherPolicy.sha256 === process.env.RECAP_PLAY_EXPECTED_POLICY_SHA
        && bindingSha === process.env.RECAP_PLAY_EXPECTED_BINDING_SHA, 'APPROVED_BINDING_OR_POLICY_CHANGED');
      demand(certificateFingerprint(process.env.RECAP_PLAY_APPROVED_SIGNER) === spec.signer, 'PROTECTED_SIGNER_MISMATCH');
      approval = requireApproval(await github(`repos/${REPOSITORY}/actions/runs/${context.runId}/approvals`),
        publisherPolicy, context);
    }
  } else demand(!afterApproval, 'VALIDATE_HAS_NO_APPROVAL_OR_GOOGLE_ACCESS');
  const result = { binding, bindingSha, publisherPolicy, approval, context };
  await atomicJson(join(work, 'prepared.json'), result);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = {
      mode: spec.mode, productVersion: identity.productVersion, source: spec.sourceSha,
      sourceTree: identity.sourceTree, ledger: spec.ledgerSha, versionCode: spec.code, producerRunId: producer.id,
      artifactId: artifact.id, archiveSha256: artifact.digest.slice(7),
      bundleSha256: record.artifact.sha256, uploadCertificateSha256: spec.signer,
      track: spec.track || null,
      expectedTrackSha256: spec.expectedTrackSha256 || null, trackStatePolicy: spec.trackStatePolicy,
      requestedRelease: spec.release,
    };
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Exact Google Play testing intent\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n`
      + 'No Google access has occurred in this validation. Approve only this exact packet and track intent. '
      + 'There must be no concurrent publisher or pending Console changes: committing can also submit Console work already ready for review. '
      + 'Submission does not establish tester availability. '
      + 'Native evidence is synthetic; account, first Console upload, signing, privacy and device gates remain independent.\n');
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `binding_sha=${bindingSha}\n`
      + `environment=${publisherPolicy ? ENVIRONMENT : ''}\n`
      + `environment_id=${publisherPolicy?.environmentId ?? ''}\npolicy_sha=${publisherPolicy?.sha256 ?? ''}\n`);
  }
  console.log(`Google Play packet validated: ${identity.productVersion}, code ${spec.code}; no Google access performed.`);
  return result;
}
export function validatePrepared(prepared, request, context, expectedBinding) {
  demand(prepared.approval?.approved === true && prepared.context?.runId === context.runId
    && prepared.context.attempt === 1 && prepared.context.workflowSha === context.workflowSha
    && canonical(prepared.binding?.request) === canonical(request)
    && HASH.test(expectedBinding) && prepared.bindingSha === expectedBinding
    && digest(canonical(prepared.binding)) === expectedBinding,
  'APPROVED_PREPARATION_REQUIRED');
  const spec = resolveIntent(request, {
    sourceSha: prepared.binding.source.sourceRevision, ledgerSha: request.ledgerSha || context.workflowSha,
    artifactId: prepared.binding.artifactId, code: prepared.binding.source.packageVersion,
    signer: prepared.binding.spec.signer, productVersion: prepared.binding.source.productVersion,
  });
  demand(canonical(prepared.binding.spec) === canonical(spec), 'APPROVED_PREPARATION_REQUIRED');
  return spec;
}
export async function publish() {
  const work = await ownedWork();
  const prepared = await readJson(join(work, 'prepared.json'));
  const { request, context } = await contextAndInput();
  const spec = validatePrepared(prepared, request, context, process.env.RECAP_PLAY_EXPECTED_BINDING_SHA);
  const currentPolicy = await policy(ENVIRONMENT);
  demand(currentPolicy.environmentId === prepared.publisherPolicy.environmentId
    && currentPolicy.sha256 === prepared.publisherPolicy.sha256, 'POLICY_CHANGED_BEFORE_OPERATION');
  requireApproval(await github(`repos/${REPOSITORY}/actions/runs/${context.runId}/approvals`), currentPolicy, context);
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  const current = JSON.parse(git('show', `refs/remotes/origin/main:${LEDGER}`));
  const packet = join(work, 'packet');
  const bundlePath = join(packet, 'recap-page-android.aab');
  const record = await readJson(join(packet, 'android-artifact.json'));
  checkRecord(record, prepared.binding.source);
  await verifyAndroidPromotion(bundlePath, record, current);
  demand(canonical(record.artifact) === canonical(prepared.binding.bundle), 'PREPARED_ARTIFACT_CHANGED');
  const bundle = await readFile(bundlePath);
  const receiptPath = join(work, 'google-play-receipt.json');
  const result = await transact(spec, bundle, record.artifact, {
    token: process.env.RECAP_PLAY_ACCESS_TOKEN,
    record: (receipt) => atomicJson(receiptPath, receipt),
  });
  console.log(`Google Play result: ${result.state}; user availability remains unverified.`);
  return result;
}
async function main() {
  const command = process.argv[2];
  demand(process.argv.length === 3, 'EXPECTED_ONE_COMMAND');
  if (command === 'preflight') await prepare();
  else if (command === 'approved-preflight') await prepare({ afterApproval: true });
  else if (command === 'publish') await publish();
  else if (command === 'cleanup') {
    const work = await ownedWork();
    await rm(work, { recursive: true, force: true });
    console.log('Removed only this run\'s verified owned publishing scratch.');
  }
  else throw new PublisherError('EXPECTED_PREFLIGHT_OR_PUBLISH');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof PublisherError || error instanceof CandidateError ? error.message
      : 'Google Play publisher: required qualification failed; no success or retry implied.');
    process.exitCode = 1;
  });
}
