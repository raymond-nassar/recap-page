import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fingerprint } from './inspect-store-recovery.mjs';
import {
  prepareApiDraft, verifyDraft, validatePublishedSubmission, validateCommitResponse,
} from './check-store-release.mjs';

export const TARGET = Object.freeze({
  product: '9PDJ7XR9Q40Q',
  draft: '1152921505701916536',
  published: '1152921505701831258',
  draftFingerprint: '0a78641cf2dc2961950420e76f037abf09013cc40ba10baf00167787d65d2d84',
  publishedFingerprint: 'f1b6ebeabe522b8f138d086ace860016208a3c9a132a1ea0e908a74a593104c9',
  notesFingerprint: '3c96294836f4e98fc25eb8d7aa82b4d5d55be4fc9460969c878c4c31a828e402',
  bundle: 'RecapPage_3.0.0.0_x64_arm64.msixbundle',
  version: '3.0.0.0',
});
const API = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${TARGET.product}`;
const DRAFT = `${API}/submissions/${TARGET.draft}`;
const PUBLISHED = `${API}/submissions/${TARGET.published}`;

class RecoveryError extends Error {}

function demand(condition, message) {
  if (!condition) throw new RecoveryError(message);
}

function pendingWithoutErrors(draft) {
  demand(draft?.status === 'PendingCommit' && Array.isArray(draft.statusDetails?.errors)
    && draft.statusDetails.errors.length === 0, 'Draft is not pending commit without errors');
}

export function bindApplication(app) {
  demand(app?.id === TARGET.product
    && app.pendingApplicationSubmission?.id === TARGET.draft
    && app.lastPublishedApplicationSubmission?.id === TARGET.published,
  'Application no longer references the approved draft and baseline');
}

export function prepareRecovery(app, published, draft, notes) {
  bindApplication(app);
  demand(published?.id === TARGET.published && published.status === 'Published'
    && fingerprint(published) === TARGET.publishedFingerprint, 'Published baseline changed');
  demand(draft?.id === TARGET.draft && draft.status === 'PendingCommit'
    && fingerprint(draft) === TARGET.draftFingerprint, 'Approved pending draft changed');
  pendingWithoutErrors(draft);
  demand(fingerprint(notes) === TARGET.notesFingerprint, 'Approved release notes changed');
  demand(draft.targetPublishMode === 'Immediate'
    && draft.packageDeliveryOptions?.packageRollout?.isPackageRollout === false,
  'Publication intent changed');
  validatePublishedSubmission(published, TARGET.version);
  const prepared = prepareApiDraft(draft, TARGET.bundle, TARGET.draft, notes, TARGET.version);
  // Immediate publication ignores this date; recovery preserves the existing field verbatim.
  prepared.targetPublishDate = draft.targetPublishDate;
  return prepared;
}

export function verifyRecovery(actual, prepared, notes) {
  pendingWithoutErrors(actual);
  verifyDraft({ ...actual, targetPublishDate: null }, TARGET.bundle, TARGET.draft, notes, TARGET.version);
  function metadata(value) {
    const copy = structuredClone(value);
    delete copy.applicationPackages;
    return fingerprint(copy);
  }
  demand(metadata(actual) === metadata(prepared), 'Unrelated submission fields changed');
  demand(actual.applicationPackages.length === prepared.applicationPackages.length,
    'Package population changed');
  for (const expected of prepared.applicationPackages) {
    const matches = actual.applicationPackages.filter((entry) => entry.fileName === expected.fileName);
    demand(matches.length === 1, 'Package identity changed');
    // Partner Center may populate metadata for a new PendingUpload entry.
    for (const [key, value] of Object.entries(expected)) {
      demand(JSON.stringify(matches[0][key]) === JSON.stringify(value), 'Package fields changed');
    }
  }
}

export function uploadLocation(value, now = Date.now()) {
  const url = new URL(value);
  demand(url.protocol === 'https:' && /^productingestionbin\d+\.blob\.core\.windows\.net$/.test(url.hostname)
    && !url.username && !url.password && !url.port && !url.hash,
  'Upload location is not the expected Microsoft ingestion service');
  demand(url.pathname.startsWith('/ingestion/') && url.searchParams.has('sig')
    && Date.parse(url.searchParams.get('se')) > now + 15 * 60 * 1000,
  'Upload authorization is absent or too close to expiry');
  return url.href;
}

export async function resume(request, upload, notes, archive) {
  const app = await request('GET', API);
  const published = await request('GET', PUBLISHED);
  const draft = await request('GET', DRAFT);
  const prepared = prepareRecovery(app, published, draft, notes);
  const uploadUrl = uploadLocation(draft.fileUploadUrl);
  bindApplication(await request('GET', API));
  demand(fingerprint(await request('GET', DRAFT)) === TARGET.draftFingerprint,
    'Draft changed before upload');
  await upload(uploadUrl, archive);
  await request('PUT', DRAFT, prepared);
  verifyRecovery(await request('GET', DRAFT), prepared, notes);
  bindApplication(await request('GET', API));
  demand(fingerprint(await request('GET', PUBLISHED)) === TARGET.publishedFingerprint,
    'Published baseline changed before commit');
  verifyRecovery(await request('GET', DRAFT), prepared, notes);
  const result = await request('POST', `${DRAFT}/commit`);
  validateCommitResponse(result);
  return { submissionId: TARGET.draft, status: result.status };
}

export async function transport() {
  const env = process.env;
  for (const name of ['PARTNER_CENTER_TENANT_ID', 'PARTNER_CENTER_CLIENT_ID', 'PARTNER_CENTER_CLIENT_SECRET']) {
    demand(typeof env[name] === 'string' && env[name].trim(), 'Missing protected credential');
  }
  const auth = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.PARTNER_CENTER_TENANT_ID)}/oauth2/token`,
    {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: env.PARTNER_CENTER_CLIENT_ID,
        client_secret: env.PARTNER_CENTER_CLIENT_SECRET,
        resource: 'https://manage.devcenter.microsoft.com',
      }),
    },
  );
  demand(auth.status === 200, 'Protected authentication failed');
  const { access_token: token } = await auth.json();
  demand(typeof token === 'string' && token.length > 0, 'Missing access token');
  return {
    request: async (method, url, body) => {
      const commit = method === 'POST' && url === `${DRAFT}/commit`;
      demand((method === 'GET' && [API, DRAFT, PUBLISHED].includes(url))
        || (method === 'PUT' && url === DRAFT) || commit, 'Store endpoint not allowlisted');
      const response = await fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      process.stdout.write(`Store ${commit ? 'commit' : method} HTTP ${response.status}\n`);
      demand((commit ? [200, 202] : [200]).includes(response.status),
        'Store response status not accepted; inspect before any further action');
      return response.json();
    },
    upload: async (url, archive) => {
      uploadLocation(url);
      const response = await fetch(url, {
        method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(600000),
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/zip' },
        body: archive,
      });
      process.stdout.write(`Store bundle upload HTTP ${response.status}\n`);
      demand(response.status === 201, 'Upload response not accepted; inspect before any further action');
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [bundlePath, archivePath, notesPath, ...extra] = process.argv.slice(2);
    demand(extra.length === 0 && bundlePath && archivePath && notesPath, 'Expected bundle, archive and notes paths');
    demand(process.env.GITHUB_RUN_ATTEMPT === '1', 'Recovery reruns are not permitted');
    demand(basename(bundlePath) === TARGET.bundle, 'Bundle filename differs');
    const bundleHash = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    demand(/^[0-9a-f]{64}$/i.test(process.env.EXPECTED_BUNDLE_SHA256 ?? '')
      && bundleHash === process.env.EXPECTED_BUNDLE_SHA256.toLowerCase(), 'Validated bundle changed');
    const notes = JSON.parse(readFileSync(notesPath, 'utf8'));
    const archive = readFileSync(archivePath);
    const archiveHash = createHash('sha256').update(archive).digest('hex');
    demand(/^[0-9a-f]{64}$/i.test(process.env.EXPECTED_ARCHIVE_SHA256 ?? '')
      && archiveHash === process.env.EXPECTED_ARCHIVE_SHA256.toLowerCase(), 'Validated archive changed');
    const { request, upload } = await transport();
    const result = await resume(request, upload, notes, archive);
    const outcome = `Submission ${result.submissionId}: ${result.status}. Certification and publication are not yet verified.\n`;
    process.stdout.write(outcome);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, outcome);
  } catch (error) {
    const reason = error instanceof RecoveryError ? error.message : 'External request or response validation failed';
    process.stderr.write(`Store recovery stopped: ${reason}. A mutation may have succeeded; inspect the exact draft before further action. No retry is permitted. Private details suppressed.\n`);
    process.exitCode = 1;
  }
}
