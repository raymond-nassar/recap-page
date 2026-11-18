import { spawnSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, OFFICIAL_ID, protectionPolicy, requireApproval, CandidateError } from './android-candidate.mjs';
import { ROOT, ANDROID_CODE_LIMIT, validateAndroidLedger, assertAppendOnlyLedger, sourceIdentity } from './lib/release-identity.mjs';
import { approvedStoreText, StoreTextError, storeTextPath } from './lib/store-text.mjs';
import { approvedText } from './check-store-release.mjs';
import { approvedDescriptionsAt, descriptionsPath, DESCRIPTION_LIMIT, markdownFence } from './lib/store-descriptions.mjs';
import {
  REPOSITORY_ID, PublisherError, digest, canonical, trackSnapshot, tracksBody, binaryList, boundedJson,
} from './google-play-publisher.mjs';

// Production promotes bytes testers already received; it never uploads. Its credential is a
// separate service account bound only to this environment and workflow, so the delegated testing
// approvals can never reach production (#1322).
export const ENVIRONMENT = 'google-play-production';
export const WORKFLOW = '.github/workflows/google-play-production.yml';
// Owner decision, 16 November 2026: "Everyone at once (Recommended)". A staged rollout would be
// 'inProgress' with a userFraction; changing this one constant is the whole of that change.
export const PRODUCTION_ROLLOUT_STATUS = 'completed';
export const PRODUCTION_TRACK = 'production';
const LEDGER = 'packaging/android/version-codes.json';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MODES = ['Validate', 'Inspect', 'Publish'];
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${OFFICIAL_ID}`;

const demand = (value, code) => { if (!value) throw new PublisherError(code); };
const isProduction = (track) => /(^|:)production$/i.test(track);

export function validateRequest(inputs) {
  demand(inputs && typeof inputs === 'object' && !Array.isArray(inputs), 'OBJECT_REQUIRED');
  const unexpected = Object.keys(inputs).filter((key) => !['mode', 'version'].includes(key));
  demand(unexpected.length === 0, 'UNEXPECTED_FIELDS');
  demand(MODES.includes(inputs.mode), 'PRODUCTION_MODE_REQUIRED');
  demand(typeof inputs.version === 'string' && VERSION.test(inputs.version), 'PRODUCT_VERSION_REQUIRED');
  return { mode: inputs.mode, version: inputs.version };
}

// The newest sealed reservation is the one the release ships. An older seal for the same version
// was superseded by a rebuild and must never reach production, so it is refused rather than chosen.
export function selectReservation(ledger, version) {
  validateAndroidLedger(ledger);
  const sealed = ledger.reservations.filter((entry) => entry.productVersion === version && entry.artifact);
  demand(sealed.length > 0, 'SEALED_RESERVATION_FOR_VERSION_REQUIRED');
  const reservation = sealed.at(-1);
  const later = ledger.reservations.filter((entry) => entry.versionCode > reservation.versionCode
    && entry.productVersion === version);
  demand(later.length === 0, 'NEWER_UNSEALED_RESERVATION_FOR_VERSION');
  return reservation;
}

export function desiredProduction(version, code, notes) {
  return {
    track: PRODUCTION_TRACK,
    releases: [{
      name: `Recap Page ${version}`, versionCodes: [String(code)], status: PRODUCTION_ROLLOUT_STATUS,
      releaseNotes: [{ language: 'en-US', text: notes }],
    }],
  };
}

export function bindingFor({ version, reservation, notes, description, workflowSha }) {
  demand(SHA.test(workflowSha), 'WORKFLOW_SHA_REQUIRED');
  demand(description === null || typeof description === 'string', 'APPROVED_DESCRIPTION_REQUIRED');
  return {
    schemaVersion: 1, version, versionCode: reservation.versionCode,
    sourceRevision: reservation.sourceRevision, sourceTree: reservation.sourceTree,
    bundle: reservation.artifact, notesSha256: digest(notes), notesPath: storeTextPath(version),
    descriptionSha256: description === null ? null : digest(description),
    descriptionPath: description === null ? null : descriptionsPath(version),
    desired: desiredProduction(version, reservation.versionCode, notes), workflowSha,
  };
}

const notesOf = (release) => release.releaseNotes?.find((note) => note.language === 'en-US')?.text;

// Play's own record must agree with the sealed ledger before anything changes: the bundle Play
// holds for the code has the sealed SHA-256, a testing release already carries it with exactly the
// approved notes, and production holds only lower codes in a simple completed release.
export function planPromotion({ tracks, bundles, reservation, notes, version }) {
  const code = reservation.versionCode;
  const matching = bundles.filter((item) => item.versionCode === code);
  demand(matching.length === 1, 'BUNDLE_NOT_IN_PLAY');
  demand(typeof matching[0].sha256 === 'string' && HASH.test(matching[0].sha256)
    && matching[0].sha256 === reservation.artifact.sha256, 'PLAY_BUNDLE_DIGEST_DIFFERS_FROM_SEAL');
  const holding = [];
  for (const track of tracks) for (const release of track.releases) {
    if (release.versionCodes.includes(String(code))) holding.push({ track: track.track, release });
  }
  const production = tracks.find((track) => track.track === PRODUCTION_TRACK);
  demand(!holding.some((entry) => isProduction(entry.track)), 'CODE_ALREADY_IN_PRODUCTION');
  const testing = holding.filter((entry) => !isProduction(entry.track));
  demand(testing.some((entry) => entry.release.status === 'completed'), 'CODE_NOT_ON_COMPLETED_TESTING_RELEASE');
  demand(testing.every((entry) => notesOf(entry.release) === notes), 'TESTING_NOTES_DIFFER_FROM_APPROVED_TEXT');
  const before = trackSnapshot(production || { track: PRODUCTION_TRACK });
  demand(before.releases.length <= 1 && before.releases.every((release) => release.status === 'completed'
    && release.userFraction === undefined && release.countryTargeting === undefined),
  'COMPLEX_PRODUCTION_REQUIRES_OPERATOR_RECONCILIATION');
  demand(before.releases.every((release) => release.versionCodes.every((value) => Number(value) < code)),
    'PRODUCTION_ALREADY_AT_OR_ABOVE_CODE');
  return {
    before, beforeSha256: digest(canonical(before)), desired: trackSnapshot(desiredProduction(version, code, notes)),
    testingTracks: [...new Set(testing.map((entry) => entry.track))].sort(),
  };
}

function listingSnapshot(body) {
  demand(body && typeof body === 'object' && Array.isArray(body.listings) && !body.nextPageToken,
    'INVALID_LISTINGS');
  const listings = body.listings;
  demand(listings.every((item) => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.language === 'string'), 'INVALID_LISTINGS');
  const languages = listings.map((item) => item.language.toLowerCase());
  demand(new Set(languages).size === languages.length
    && listings.filter((item) => item.language === 'en-US').length === 1,
  'ONE_EN_US_LISTING_REQUIRED');
  return [...listings].sort((a, b) => a.language.localeCompare(b.language));
}

export async function transactProduction(binding, { token, fetchImpl = globalThis.fetch, record, now = Date.now, mode, notes, description }) {
  demand(['Inspect', 'Publish'].includes(mode), 'PLAY_OPERATION_REQUIRED');
  demand(typeof record === 'function', 'DURABLE_RECEIPT_WRITER_REQUIRED');
  demand(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'ACCESS_TOKEN_REQUIRED');
  if (description !== null) {
    try { approvedText(description, DESCRIPTION_LIMIT, 'Google Play description'); }
    catch { throw new PublisherError('APPROVED_DESCRIPTION_REQUIRED'); }
  }
  demand(Number.isSafeInteger(binding.versionCode) && binding.versionCode <= ANDROID_CODE_LIMIT
    && digest(notes) === binding.notesSha256
    && (description === null ? binding.descriptionSha256 === null : digest(description) === binding.descriptionSha256),
  'BINDING_CHANGED_BEFORE_OPERATION');
  const reservation = { versionCode: binding.versionCode, artifact: binding.bundle };
  const receipt = {
    schemaVersion: 1, mode, packageName: OFFICIAL_ID, track: PRODUCTION_TRACK, version: binding.version,
    versionCode: binding.versionCode, bundleSha256: binding.bundle.sha256, notesSha256: binding.notesSha256,
    descriptionSha256: binding.descriptionSha256,
    bindingSha256: digest(canonical(binding)), stage: 'ready', state: 'running', editId: null,
    mutationAttempted: false, commitAcknowledged: false, userAvailability: 'unverified', httpStatus: null,
  };
  const save = async () => record(structuredClone(receipt));
  let expiry = Infinity;
  async function request(stage, method, url, payload) {
    demand(now() < expiry, 'EDIT_EXPIRED');
    receipt.stage = stage;
    receipt.httpStatus = null;
    const mutation = method !== 'GET';
    // Opening or discarding an edit changes nothing a reader can see.
    receipt.mutationAttempted ||= ['update-track', 'update-listing', 'validate-edit', 'commit-edit'].includes(stage);
    await save();
    let response;
    try {
      response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      throw new PublisherError('TRANSPORT_OUTCOME_UNKNOWN', { uncertain: mutation });
    }
    receipt.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublisherError('PLAY_HTTP_REJECTED', { status: response.status, uncertain: mutation && response.status >= 500 });
    }
    if (method === 'DELETE') { await response.body?.cancel(); return null; }
    try { return await boundedJson(response); }
    catch (error) {
      throw new PublisherError(error instanceof PublisherError ? error.code : 'API_READ_FAILED',
        { status: response.status, uncertain: mutation });
    }
  }
  async function openEdit(stage) {
    const edit = await request(stage, 'POST', `${API}/edits`, {});
    demand(typeof edit.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(edit.id)
      && typeof edit.expiryTimeSeconds === 'string' && /^\d+$/.test(edit.expiryTimeSeconds), 'INVALID_EDIT_IDENTITY');
    expiry = Number(edit.expiryTimeSeconds) * 1000;
    demand(Number.isSafeInteger(expiry) && expiry > now(), 'EDIT_EXPIRED');
    return { id: edit.id, url: `${API}/edits/${encodeURIComponent(edit.id)}` };
  }
  try {
    const edit = await openEdit('create-edit');
    receipt.editId = edit.id;
    await save();
    const tracks = tracksBody(await request('read-tracks', 'GET', `${edit.url}/tracks`));
    const bundles = binaryList(await request('read-bundles', 'GET', `${edit.url}/bundles`), 'bundles');
    const plan = planPromotion({ tracks, bundles, reservation, notes, version: binding.version });
    demand(canonical(plan.desired) === canonical(trackSnapshot(binding.desired)), 'BINDING_CHANGED_BEFORE_OPERATION');
    receipt.productionBefore = plan.before;
    receipt.productionBeforeSha256 = plan.beforeSha256;
    receipt.desiredProduction = plan.desired;
    receipt.testingTracks = plan.testingTracks;
    let expectedListings = null;
    if (description !== null) {
      const listings = listingSnapshot(await request('read-listings', 'GET', `${edit.url}/listings`));
      receipt.listingBefore = listings.find((item) => item.language === 'en-US');
      expectedListings = listings.map((item) => item.language === 'en-US'
        ? { ...item, fullDescription: description } : item);
    }
    receipt.stage = 'target-prepared';
    await save();
    if (mode === 'Inspect') {
      await request('delete-edit', 'DELETE', edit.url);
      receipt.state = 'inspected-no-release-change';
      receipt.stage = 'complete';
      await save();
      return receipt;
    }
    await request('update-track', 'PUT', `${edit.url}/tracks/${PRODUCTION_TRACK}`, binding.desired);
    const readback = tracksBody(await request('readback-tracks', 'GET', `${edit.url}/tracks`));
    demand(readback.length === tracks.length + (tracks.some((track) => track.track === PRODUCTION_TRACK) ? 0 : 1)
      && readback.every((actual) => {
        if (actual.track === PRODUCTION_TRACK) return canonical(actual) === canonical(plan.desired);
        const original = tracks.find((track) => track.track === actual.track);
        return original && canonical(actual) === canonical(original);
      }), 'TRACK_READBACK_MISMATCH');
    if (expectedListings !== null) {
      if (receipt.listingBefore.fullDescription !== description) {
        await request('update-listing', 'PATCH', `${edit.url}/listings/en-US`, { fullDescription: description });
      }
      const listings = listingSnapshot(await request('readback-listings', 'GET', `${edit.url}/listings`));
      demand(canonical(listings) === canonical(expectedListings), 'LISTING_READBACK_MISMATCH');
    }
    const validation = await request('validate-edit', 'POST', `${edit.url}:validate`);
    demand(validation.id === edit.id, 'VALIDATION_IDENTITY_MISMATCH');
    const committed = await request('commit-edit', 'POST', `${edit.url}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`);
    demand(committed.id === edit.id, 'COMMIT_ACKNOWLEDGEMENT_UNVERIFIED');
    receipt.commitAcknowledged = true;
    receipt.state = 'committed-readback-pending';
    await save();
    const fresh = await openEdit('readback-create-edit');
    receipt.readbackEditId = fresh.id;
    const after = tracksBody(await request('readback-committed-tracks', 'GET', `${fresh.url}/tracks`))
      .find((track) => track.track === PRODUCTION_TRACK);
    receipt.productionAfter = after || null;
    let afterListings = null;
    if (expectedListings !== null) {
      afterListings = listingSnapshot(await request('readback-committed-listings', 'GET', `${fresh.url}/listings`));
      receipt.listingAfter = afterListings.find((item) => item.language === 'en-US');
    }
    await request('delete-readback-edit', 'DELETE', fresh.url);
    demand(after && canonical(after) === canonical(plan.desired), 'COMMITTED_PRODUCTION_DIFFERS');
    demand(expectedListings === null || canonical(afterListings) === canonical(expectedListings),
      'COMMITTED_LISTING_DIFFERS');
    receipt.state = 'submitted-production-review-unverified';
    receipt.stage = 'complete';
    await save();
    return receipt;
  } catch (error) {
    const unverifiedMutation = ['update-track', 'update-listing', 'commit-edit'].includes(receipt.stage)
      && receipt.httpStatus >= 200 && receipt.httpStatus < 300;
    receipt.state = receipt.commitAcknowledged ? 'committed-readback-unverified'
      : (error instanceof PublisherError && error.uncertain) || unverifiedMutation ? 'uncertain' : 'blocked';
    receipt.code = error instanceof PublisherError ? error.code : 'UNEXPECTED_FAILURE';
    if (error instanceof PublisherError && error.status !== null) receipt.httpStatus = error.status;
    await save();
    throw error;
  }
}

function native(file, args, code) {
  const result = spawnSync(file, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  demand(!result.error && result.status === 0 && !result.signal, code);
  return result.stdout.trim();
}
const git = (...args) => native('git', ['--no-pager', ...args], 'GIT_PROVENANCE_FAILED');
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
export function validateInvocation(context, run) {
  demand(context.repository === REPOSITORY && context.event === 'workflow_dispatch'
    && context.ref === 'refs/heads/main' && context.attempt === 1 && SHA.test(context.workflowSha)
    && context.sha === context.workflowSha && context.workflowRef === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`,
  'MANUAL_MAIN_FIRST_ATTEMPT_REQUIRED');
  demand(Number.isSafeInteger(context.runId) && context.runId > 0 && run.id === context.runId
    && run.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === context.workflowSha && run.path?.split('@')[0] === WORKFLOW
    && run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID, 'WORKFLOW_IDENTITY_MISMATCH');
}
async function work() {
  const root = process.env.RUNNER_TEMP;
  demand(typeof root === 'string' && isAbsolute(root) && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID || ''),
    'EXACT_RUN_IDENTITY_REQUIRED');
  const path = join(resolve(root), `recap-google-play-production-${process.env.GITHUB_RUN_ID}`);
  const child = relative(resolve(root), path);
  demand(child && !child.startsWith('..') && !isAbsolute(child), 'WORK_OUTSIDE_RUNNER_TEMP');
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  demand(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'UNSAFE_WORK_DIRECTORY');
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}
async function atomicJson(path, value) {
  await writeFile(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  await rename(`${path}.next`, path);
}
async function policy() {
  return protectionPolicy(await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}`),
    await github(`repos/${REPOSITORY}/environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100`), ENVIRONMENT);
}
async function prepareBinding() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const request = validateRequest(event.inputs);
  const context = {
    repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, workflowSha: process.env.GITHUB_WORKFLOW_SHA, workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  };
  validateInvocation(context, await github(`repos/${REPOSITORY}/actions/runs/${context.runId}`));
  const source = sourceIdentity(ROOT);
  demand(!source.sourceDirty && source.sourceRevision === context.workflowSha, 'CLEAN_REVIEWED_TOOLING_REQUIRED');
  const notes = approvedStoreText(git('show', `${context.workflowSha}:${storeTextPath(request.version)}`),
    request.version, 'google-play').text;
  const descriptions = approvedDescriptionsAt({ revision: context.workflowSha, version: request.version, git });
  const description = descriptions?.googlePlay ?? null;
  const selected = validateAndroidLedger(JSON.parse(git('show', `${context.workflowSha}:${LEDGER}`)));
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  const current = validateAndroidLedger(JSON.parse(git('show', `refs/remotes/origin/main:${LEDGER}`)));
  assertAppendOnlyLedger(selected, current);
  const reservation = selectReservation(selected, request.version);
  demand(canonical(selectReservation(current, request.version)) === canonical(reservation), 'LATEST_MAIN_SEAL_CHANGED');
  git('merge-base', '--is-ancestor', reservation.sourceRevision, context.workflowSha);
  const binding = bindingFor({ version: request.version, reservation, notes, description, workflowSha: context.workflowSha });
  return { request, context, notes, description, binding, bindingSha: digest(canonical(binding)) };
}
async function checkApproved({ context, bindingSha }) {
  const currentPolicy = await policy();
  demand(String(currentPolicy.environmentId) === process.env.RECAP_PLAY_EXPECTED_ENVIRONMENT_ID
    && currentPolicy.sha256 === process.env.RECAP_PLAY_EXPECTED_POLICY_SHA
    && HASH.test(bindingSha) && bindingSha === process.env.RECAP_PLAY_EXPECTED_BINDING_SHA,
  'APPROVED_BINDING_OR_POLICY_CHANGED');
  requireApproval(await github(`repos/${REPOSITORY}/actions/runs/${context.runId}/approvals`), currentPolicy, context);
  return currentPolicy;
}
export async function preflight({ afterApproval = false } = {}) {
  demand(!process.env.RECAP_PLAY_ACCESS_TOKEN, 'TOKEN_BEFORE_APPROVED_VALIDATION');
  const prepared = await prepareBinding();
  const { request, binding, bindingSha, description } = prepared;
  let currentPolicy = null;
  if (request.mode !== 'Validate') {
    currentPolicy = afterApproval ? await checkApproved(prepared) : await policy();
  } else demand(!afterApproval, 'VALIDATE_HAS_NO_APPROVAL_OR_GOOGLE_ACCESS');
  if (process.env.GITHUB_STEP_SUMMARY && !afterApproval) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Exact Google Play production intent\n\n\`\`\`json\n${
      JSON.stringify({ mode: request.mode, ...binding }, null, 2)}\n\`\`\`\n\n`
      + 'No Google access has occurred in this validation. Approving promotes only this sealed code, already on a '
      + 'testing track, to production for everyone with exactly these notes. Nothing is uploaded. '
      + 'Committing can also submit Console work already ready for review, so there must be none pending.\n\n'
      + (description === null ? 'No approved description file: the Google Play description is not changed.\n'
        : `### Google Play description (en-US), exactly as it would be sent\n\n`
          + `${description.length} of ${DESCRIPTION_LIMIT} characters, from ${binding.descriptionPath} at ${binding.workflowSha}.\n\n`
          + `${markdownFence(description)}text\n${description}\n${markdownFence(description)}\n`));
  }
  if (process.env.GITHUB_OUTPUT && !afterApproval) {
    await appendFile(process.env.GITHUB_OUTPUT, `binding_sha=${bindingSha}\n`
      + `environment=${currentPolicy ? ENVIRONMENT : ''}\nenvironment_id=${currentPolicy?.environmentId ?? ''}\n`
      + `policy_sha=${currentPolicy?.sha256 ?? ''}\n`);
  }
  console.log(`Google Play production intent validated: ${binding.version}, code ${binding.versionCode}; no Google access performed.`);
  return { ...prepared, policy: currentPolicy };
}
export async function operate() {
  // Everything is derived again from the reviewed commit and checked against what was approved,
  // so a ledger seal or approved-text change after approval stops here, before Google is touched.
  const prepared = await prepareBinding();
  const { request, notes, description, binding } = prepared;
  demand(request.mode !== 'Validate', 'VALIDATE_HAS_NO_APPROVAL_OR_GOOGLE_ACCESS');
  await checkApproved(prepared);
  const receiptPath = join(await work(), 'google-play-production-receipt.json');
  const result = await transactProduction(binding, {
    token: process.env.RECAP_PLAY_ACCESS_TOKEN, mode: request.mode, notes, description,
    record: (receipt) => atomicJson(receiptPath, receipt),
  });
  console.log(`Google Play production result: ${result.state}; review outcome and user availability remain unverified.`);
  return result;
}
async function main() {
  demand(process.argv.length === 3, 'EXPECTED_ONE_COMMAND');
  const command = process.argv[2];
  if (command === 'preflight') await preflight();
  else if (command === 'approved-preflight') await preflight({ afterApproval: true });
  else if (command === 'operate') await operate();
  else if (command === 'cleanup') await rm(await work(), { recursive: true, force: true });
  else throw new PublisherError('EXPECTED_PREFLIGHT_OPERATE_OR_CLEANUP');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof PublisherError || error instanceof CandidateError || error instanceof StoreTextError
      ? error.message.replace('Google Play publisher', 'Google Play production')
      : 'Google Play production: required check failed; no success or retry implied.');
    process.exitCode = 1;
  });
}
