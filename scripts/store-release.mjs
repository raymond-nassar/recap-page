import { readFileSync, appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  apiFields, validateApplication, validateSubmissionIdentity, validatePublishedSubmission,
  validateApiPackageReplacement, validateReleaseNotes, validateReleaseNotesTarget,
  prepareApiDraft, verifyDraft, verifyPreservedIntent, requirePendingDraft,
  validateCommitResponse, validateSubmissionStatus,
} from './check-store-release.mjs';

const API = 'https://manage.devcenter.microsoft.com/v1.0/my/applications';
const OBSERVATION_MS = 5 * 60 * 1000;
const POLL_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ID = /^[A-Za-z0-9-]{1,80}$/;

export function uploadLocation(value, now = Date.now()) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname) ||
      url.username || url.password || url.port || url.hash ||
      !/^\/ingestion\/[^/]+$/.test(url.pathname) ||
      url.searchParams.getAll('sig').length !== 1 || !url.searchParams.get('sig') ||
      url.searchParams.getAll('se').length !== 1 ||
      !(Date.parse(url.searchParams.get('se')) > now + 15 * 60 * 1000)) {
    throw new Error('Upload authorization is invalid or expires too soon');
  }
  return url.href;
}

async function singleRequest(fetchImpl, url, options, statuses, timeout = 120000, json = true) {
  const response = await fetchImpl(url, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(timeout),
  });
  if (!statuses.includes(response.status)) throw new Error('Unexpected Store HTTP response');
  if (json) return response.json();
  await response.arrayBuffer();
}

function bindApplication(application, productId, publishedId, submissionId) {
  const app = apiFields(application);
  if (app.id !== productId || app.lastPublishedApplicationSubmission?.id !== publishedId ||
      app.pendingApplicationSubmission?.id !== submissionId) {
    throw new Error('Store application references changed');
  }
}

export function formatOutcome(outcome) {
  const action = outcome.state === 'failed'
    ? 'Inspect this submission and the last stage before any further action. Do not rerun or edit an API-created submission in Partner Center.'
    : outcome.state === 'published' ? 'Store reports Published.'
      : outcome.state === 'validated' ? 'Read-only rehearsal passed; no Store mutation was sent.'
        : 'Publication is not verified. Monitor this submission; do not rerun. Microsoft publishes after certification.';
  return `Store release: ${outcome.state}; stage: ${outcome.stage}; submission: ${outcome.submissionId ?? 'not-known'}; status: ${outcome.status ?? 'not-observed'}; commit: ${outcome.commit}; ingested package: ${outcome.package ?? 'not-observed'}; approved notes SHA-256: ${outcome.notesSha256 ?? 'not-validated'}.\n${action}\n`;
}

export async function publishStoreUpdate(config, {
  fetchImpl = globalThis.fetch, now = Date.now, wait = sleep, report = () => {}, log = () => {},
} = {}) {
  const outcome = { state: 'failed', stage: 'preflight', submissionId: null,
    status: null, commit: 'not-attempted' };
  const observedFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
      log(`Store stage=${outcome.stage} HTTP=${response.status}\n`);
    }
    return response;
  };
  try {
    const { mode, productId, bundleName, version, notes, archive, credentials } = config;
    if (!['Validate', 'Submit'].includes(mode) || !ID.test(productId) ||
        bundleName !== `RecapPage_${version}_x64_arm64.msixbundle`) {
      throw new Error('Invalid release configuration');
    }
    validateReleaseNotes(notes, version);
    outcome.notesSha256 = createHash('sha256').update(notes.text).digest('hex');
    if (mode === 'Submit' && (!Buffer.isBuffer(archive) || !archive.length)) {
      throw new Error('Missing upload archive');
    }
    for (const key of ['tenantId', 'clientId', 'clientSecret']) {
      if (typeof credentials?.[key] !== 'string' || !credentials[key].trim()) {
        throw new Error('Missing protected credential');
      }
    }
    outcome.stage = 'authentication';
    const token = await singleRequest(observedFetch,
      `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/token`, {
        method: 'POST', body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: credentials.clientId,
          client_secret: credentials.clientSecret, resource: 'https://manage.devcenter.microsoft.com',
        }),
      }, [200], 60000);
    if (typeof token?.access_token !== 'string' || !token.access_token.trim()) {
      throw new Error('Missing access token');
    }
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' };
    const request = (method, url, body, statuses = [200], timeout = 120000) =>
      singleRequest(observedFetch, url, {
        method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, statuses, timeout);
    const root = `${API}/${encodeURIComponent(productId)}`;
    const submissions = `${root}/submissions`;
    outcome.stage = 'application';
    const { lastPublishedSubmissionId: publishedId } =
      validateApplication(await request('GET', root), productId);
    if (!ID.test(publishedId)) throw new Error('Invalid published submission identity');
    const publishedUrl = `${submissions}/${encodeURIComponent(publishedId)}`;
    outcome.stage = 'baseline';
    const published = apiFields(await request('GET', publishedUrl));
    validateSubmissionIdentity(published, publishedId);
    if (published.status !== 'Published') throw new Error('Baseline is not published');
    validatePublishedSubmission(published, version);
    validateApiPackageReplacement(published, bundleName);
    validateReleaseNotesTarget(published, notes, version);
    if (mode === 'Validate') {
      outcome.state = 'validated';
      return outcome;
    }
    outcome.stage = 'create';
    log(`Store stage=create targetVersion=${version}\n`);
    const created = apiFields(await request('POST', submissions, undefined, [200, 201]));
    if (typeof created.id !== 'string' || !ID.test(created.id) || created.id === publishedId) {
      throw new Error('Invalid created submission identity');
    }
    outcome.submissionId = created.id;
    log(`Store stage=create submission=${created.id}\n`);
    requirePendingDraft(created);
    verifyPreservedIntent(created, published);
    const prepared = prepareApiDraft(created, bundleName, created.id, notes, version);
    const uploadUrl = uploadLocation(created.fileUploadUrl, now());
    const draftUrl = `${submissions}/${encodeURIComponent(created.id)}`;
    outcome.stage = 'pre-upload';
    bindApplication(await request('GET', root), productId, publishedId, created.id);
    outcome.stage = 'upload';
    await singleRequest(observedFetch, uploadUrl, {
      method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/zip' },
      body: archive,
    }, [201], 600000, false);
    outcome.stage = 'update';
    const updated = apiFields(await request('PUT', draftUrl, prepared));
    validateSubmissionIdentity(updated, created.id);
    outcome.stage = 'readback';
    const actual = apiFields(await request('GET', draftUrl));
    requirePendingDraft(actual);
    verifyDraft(actual, bundleName, created.id, notes, version);
    verifyPreservedIntent(actual, prepared, bundleName);
    bindApplication(await request('GET', root), productId, publishedId, created.id);
    const baseline = apiFields(await request('GET', publishedUrl));
    validateSubmissionIdentity(baseline, publishedId);
    if (baseline.status !== 'Published') throw new Error('Baseline status changed');
    verifyPreservedIntent(baseline, published);
    outcome.stage = 'commit';
    outcome.commit = 'attempted';
    const commit = await request('POST', `${draftUrl}/commit`, undefined, [200, 202]);
    validateCommitResponse(commit);
    outcome.commit = 'acknowledged';
    outcome.status = 'CommitStarted';
    outcome.state = 'acknowledged';
    report({ ...outcome });
    outcome.stage = 'status';
    const deadline = now() + OBSERVATION_MS;
    while (now() < deadline) {
      const remaining = deadline - now();
      if (remaining <= 0) break;
      const observed = validateSubmissionStatus(await request(
        'GET', `${draftUrl}/status`, undefined, [200], Math.min(60000, remaining),
      ));
      Object.assign(outcome, observed);
      if (outcome.state === 'failed') throw new Error('Store processing failed');
      if (outcome.state !== 'acknowledged' && now() < deadline) {
        const ingested = apiFields(await request(
          'GET', draftUrl, undefined, [200], Math.min(60000, deadline - now()),
        ));
        validateSubmissionIdentity(ingested, created.id);
        verifyPreservedIntent({ ...ingested, applicationPackages: [] },
          { ...prepared, applicationPackages: [] });
        const matches = ingested.applicationPackages?.filter((entry) => entry.fileName === bundleName);
        if (!matches || matches.length !== 1) throw new Error('Ingested package identity differs');
        const target = matches[0];
        if (target.version && target.version !== version) throw new Error('Ingested package version differs');
        outcome.package = target.version === version && target.fileStatus === 'Uploaded'
          ? 'verified' : 'pending';
        if (outcome.package === 'verified') return outcome;
        if (outcome.state === 'published') throw new Error('Published package is not verified');
      }
      await wait(Math.min(POLL_MS, Math.max(0, deadline - now())));
    }
    return outcome;
  } catch {
    // External exceptions can include tokens, SAS URLs, raw response bodies and private listing data.
    outcome.state = 'failed';
    return outcome;
  } finally {
    report({ ...outcome });
  }
}

export async function runRelease(args, env = process.env) {
  let result;
  let lastOutcome;
  const report = (outcome) => {
    lastOutcome = { ...outcome };
    const text = formatOutcome(outcome);
    process.stdout.write(text);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };
  try {
    const [mode, productId, bundlePath, version, notesPath, archivePath, ...extra] = args;
    if (extra.length || !archivePath) throw new Error('Invalid arguments');
    result = await publishStoreUpdate({
      mode, productId, bundleName: basename(bundlePath), version,
      notes: JSON.parse(readFileSync(notesPath, 'utf8')),
      archive: mode === 'Submit' ? readFileSync(archivePath) : undefined,
      credentials: { tenantId: env.PARTNER_CENTER_TENANT_ID,
        clientId: env.PARTNER_CENTER_CLIENT_ID, clientSecret: env.PARTNER_CENTER_CLIENT_SECRET },
    }, { report, log: (text) => process.stdout.write(text) });
  } catch {
    result = { ...(lastOutcome ?? { stage: 'local-input', submissionId: null,
      status: null, commit: 'not-attempted' }), state: 'failed' };
    process.stderr.write(formatOutcome(result));
    if (!lastOutcome) {
      try {
        report(result);
      } catch {
        process.stderr.write('Store input failure could not be written to the outcome summary.\n');
      }
    } else {
      process.stderr.write('Store outcome reporting failed. The last submission state above remains authoritative; do not rerun.\n');
    }
  }
  return result.state === 'failed' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runRelease(process.argv.slice(2));
}
