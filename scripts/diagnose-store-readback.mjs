import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiFields, prepareApiDraft, validateReleaseEvent, validateReleaseNotes, validateReleaseNotesTarget,
  validatePublishedSubmission, validateApiPackageReplacement, verifyPreservedIntent,
} from './check-store-release.mjs';
import {
  sha256, kind, descriptor, checkResult, knownValue, readbackChecks, statusObservation, packageObservation,
} from './store-readback.mjs';
import { observeUploadedBundle } from './store-upload-readback.mjs';

const API = 'https://manage.devcenter.microsoft.com/v1.0/my/applications';
const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SUBMISSION = /^[1-9]\d{1,30}$/;

function demand(condition) {
  if (!condition) throw new Error('Contract check failed');
}

export function configurationChecks(config) {
  const { productId, pendingId, publishedId, version, bundleName, bundleSha256, notesSha256,
    releaseTag, sourceSha, actualSourceSha, tagSha, toolingSha, applicationVersion, notes, release } = config;
  return [
    checkResult('INPUT_IDENTITIES', () => demand(
      typeof productId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(productId)
      && typeof pendingId === 'string' && SUBMISSION.test(pendingId)
      && typeof publishedId === 'string' && SUBMISSION.test(publishedId) && pendingId !== publishedId)),
    checkResult('SOURCE_BINDING', () => demand(
      typeof sourceSha === 'string' && COMMIT.test(sourceSha) && actualSourceSha === sourceSha
      && tagSha === sourceSha && config.sourceOnMain === true && COMMIT.test(toolingSha))),
    checkResult('SOURCE_VERSION', () => demand(
      typeof applicationVersion === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(applicationVersion)
      && version === `${applicationVersion}.0` && releaseTag === `v${applicationVersion}`
      && bundleName === `RecapPage_${version}_x64_arm64.msixbundle`)),
    checkResult('PUBLIC_RELEASE', () => validateReleaseEvent({ action: 'published', release },
      applicationVersion, version)),
    checkResult('APPROVED_NOTES', () => validateReleaseNotes(notes, version)),
    checkResult('NOTES_HASH', () => demand(
      typeof notesSha256 === 'string' && HASH.test(notesSha256)
      && typeof notes?.text === 'string' && sha256(notes.text) === notesSha256)),
    checkResult('BUNDLE_HASH_INPUT', () => demand(typeof bundleSha256 === 'string' && HASH.test(bundleSha256))),
    checkResult('UPLOAD_READ_OPTION', () => demand(typeof config.readUploadedBundle === 'boolean')),
  ];
}

export async function diagnoseStoreReadback(config, { fetchImpl = globalThis.fetch } = {}) {
  const report = {
    schema: 1, state: 'failed', mutationCount: 0, checks: configurationChecks(config), requests: [],
    evidenceLimits: {
      comparison: 'CURRENT_PUBLISHED_PLUS_APPROVED_NOTES_AND_PACKAGE_EDIT',
      historicalCreatedPayload: 'UNAVAILABLE_NOT_RECONSTRUCTED',
      historicalPublishedPayload: 'UNAVAILABLE_NOT_VERIFIED',
      originalCopyRelationship: 'NOT_PROVABLE_FROM_CURRENT_READS',
      uploadedBundleBytes: 'NOT_VERIFIABLE_BY_METADATA_GET_SEE_OPTIONAL_UPLOAD_READ',
      originalUploadZipSha256: 'UNRECORDED',
      bundleSha256: 'OPERATOR_SUPPLIED_BINDING_NOT_OBSERVED_BYTES',
      snapshotAtomicity: 'SEQUENTIAL_READS_NOT_AN_ATOMIC_SNAPSHOT',
      authorization: 'DIAGNOSIS_ONLY_NOT_RESUME_OR_COMMIT_AUTHORIZATION',
    },
  };
  if (report.checks.some((check) => check.result !== 'pass')) return report;
  const { productId, publishedId, pendingId, bundleName, version, notes, credentials } = config;
  report.bindings = { releaseTag: config.releaseTag, sourceSha: config.sourceSha, toolingSha: config.toolingSha,
    version, bundleName, bundleSha256: config.bundleSha256, notesSha256: config.notesSha256,
    pendingId, publishedId };
  const check = (id, operation) => {
    const result = checkResult(id, operation);
    report.checks.push(result);
    return result.result === 'pass';
  };
  if (!check('PROTECTED_CREDENTIALS', () => {
    for (const key of ['tenantId', 'clientId', 'clientSecret']) {
      demand(typeof credentials?.[key] === 'string' && credentials[key].trim().length > 0);
    }
  })) return report;

  async function request(checkId, url, init) {
    const observed = { checkId, httpStatus: null };
    report.requests.push(observed);
    try {
      const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
        observed.httpStatus = response.status;
      }
      demand(response.status === 200);
      const body = await response.json();
      demand(body && typeof body === 'object' && !Array.isArray(body));
      report.checks.push({ checkId, result: 'pass', code: 'OK' });
      return body;
    } catch {
      report.checks.push({ checkId, result: 'fail', code: checkId });
      return undefined;
    }
  }

  const token = await request('AUTH_HTTP', `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/token`,
    { method: 'POST', body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: credentials.clientId,
      client_secret: credentials.clientSecret, resource: 'https://manage.devcenter.microsoft.com',
    }) });
  if (!check('AUTH_TOKEN', () => demand(typeof token?.access_token === 'string' && token.access_token.trim()))) {
    return report;
  }
  const root = `${API}/${encodeURIComponent(productId)}`;
  const publishedUrl = `${root}/submissions/${publishedId}`;
  const pendingUrl = `${root}/submissions/${pendingId}`;
  const endpoints = new Set([root, publishedUrl, pendingUrl, `${pendingUrl}/status`]);
  const get = async (id, url) => {
    demand(endpoints.has(url));
    const body = await request(id, url, {
      method: 'GET', headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    });
    let normalized;
    check(`${id}_FIELDS`, () => {
      demand(body !== undefined);
      normalized = apiFields(body);
    });
    return normalized;
  };
  function references(app, prefix) {
    check(`${prefix}_PRODUCT`, () => demand(app?.id === productId));
    check(`${prefix}_PUBLISHED_REFERENCE`, () => demand(app?.lastPublishedApplicationSubmission?.id === publishedId));
    check(`${prefix}_PENDING_REFERENCE`, () => demand(app?.pendingApplicationSubmission?.id === pendingId));
  }
  const app = await get('APPLICATION_GET', root);
  references(app, 'APPLICATION');
  const published = await get('PUBLISHED_GET', publishedUrl);
  const pending = await get('PENDING_GET', pendingUrl);
  const status = await get('STATUS_GET', `${pendingUrl}/status`);
  check('PUBLISHED_IDENTITY', () => demand(published?.id === publishedId));
  check('PUBLISHED_STATUS', () => demand(published?.status === 'Published'));
  check('PUBLISHED_FREE', () => demand(published?.pricing?.priceId === 'Free'));
  check('PUBLISHED_VERSION_ADVANCE', () => validatePublishedSubmission(published, version));
  check('PUBLISHED_PACKAGE_REPLACEMENT', () => validateApiPackageReplacement(published, bundleName));
  check('PUBLISHED_NOTES_TARGET', () => validateReleaseNotesTarget(published, notes, version));
  check('PENDING_IDENTITY', () => demand(pending?.id === pendingId));
  check('PENDING_FREE', () => demand(pending?.pricing?.priceId === 'Free'));
  check('PENDING_PUBLICATION_MODE', () => demand(pending?.targetPublishMode === 'Immediate'));
  check('PENDING_ROLLOUT_DISABLED', () => demand(
    pending?.packageDeliveryOptions?.packageRollout?.isPackageRollout === false));
  check('PENDING_PUBLICATION_DATE', () => demand(pending?.targetPublishDate === null
    || (typeof pending?.targetPublishDate === 'string' && Number.isFinite(Date.parse(pending.targetPublishDate)))));
  const targets = Array.isArray(pending?.applicationPackages)
    ? pending.applicationPackages.filter((entry) => entry?.fileName === bundleName) : [];
  check('PENDING_TARGET_FILENAME', () => demand(targets.length === 1));
  check('PENDING_TARGET_FILE_STATUS', () => demand(targets.length === 1 && targets[0].fileStatus === 'PendingUpload'));
  check('PENDING_TARGET_VERSION', () => demand(targets.length === 1
    && (!Object.hasOwn(targets[0], 'version') || targets[0].version === version)));
  check('PENDING_NOTES_LOCALE', () => demand(Object.hasOwn(pending?.listings ?? {}, notes.locale)));
  const observedNotes = pending?.listings?.[notes.locale]?.baseListing?.releaseNotes;
  check('PENDING_NOTES_HASH', () => demand(typeof observedNotes === 'string' && sha256(observedNotes) === config.notesSha256));
  check('STATUS_PENDING', () => demand(status?.status === 'PendingCommit'));
  check('STATUS_ERRORS_EMPTY', () => demand(Array.isArray(status?.statusDetails?.errors) && status.statusDetails.errors.length === 0));

  report.observed = {};
  for (const [label, submission] of [['published', published], ['pending', pending]]) {
    report.observed[label] = {
      ...statusObservation(submission),
      packagesType: kind(submission?.applicationPackages),
      packages: Array.isArray(submission?.applicationPackages)
        ? submission.applicationPackages.map((entry) => packageObservation(entry, bundleName, version)) : [],
      publicationMode: knownValue(submission?.targetPublishMode, new Set(['Immediate', 'Manual', 'SpecificDate'])),
      rollout: knownValue(submission?.packageDeliveryOptions?.packageRollout?.isPackageRollout, new Set([true, false])),
    };
  }
  report.observed.status = statusObservation(status);
  report.observed.notes = { ...descriptor(observedNotes),
    textSha256: typeof observedNotes === 'string' ? sha256(observedNotes) : null,
    locale: notes.locale, sourceVersion: notes.version, matches: observedNotes === notes.text };
  let expected;
  check('EXPECTED_UPDATE', () => {
    expected = prepareApiDraft({ ...published, id: pendingId }, bundleName, pendingId, notes, version);
  });
  const readback = readbackChecks(pending, expected, { bundleName, pendingId, notes, version });
  report.checks.push(...readback.checks);
  report.comparison = { semantic: readback.semantic, normalized: readback.normalized,
    beforeNormalization: readback.beforeNormalization };
  const uploadBound = ['APPLICATION_PRODUCT', 'APPLICATION_PENDING_REFERENCE', 'APPLICATION_PUBLISHED_REFERENCE',
    'PENDING_IDENTITY'].every((id) => report.checks.find((entry) => entry.checkId === id)?.result === 'pass');
  report.uploadRead = { state: 'not-requested', originalUploadZipSha256: 'UNRECORDED' };
  if (config.readUploadedBundle) {
    report.uploadRead = uploadBound
      ? await observeUploadedBundle(pending?.fileUploadUrl, bundleName, config.bundleSha256, { fetchImpl })
      : { state: 'unavailable', originalUploadZipSha256: 'UNRECORDED',
        checks: [{ checkId: 'UPLOAD_READ_BINDING', result: 'fail', code: 'UPLOAD_READ_BINDING' }] };
  }
  if (config.readUploadedBundle) report.checks.push(...report.uploadRead.checks);
  references(await get('APPLICATION_RECHECK_GET', root), 'APPLICATION_RECHECK');
  const finalPublished = await get('PUBLISHED_RECHECK_GET', publishedUrl);
  check('PUBLISHED_RECHECK_IDENTITY', () => demand(finalPublished?.id === publishedId));
  check('PUBLISHED_RECHECK_STATUS', () => demand(finalPublished?.status === 'Published'));
  check('PUBLISHED_RECHECK_INTENT', () => verifyPreservedIntent(finalPublished, published));
  report.state = report.checks.every((entry) => entry.result === 'pass') ? 'observed' : 'failed';
  return report;
}

export function loadConfiguration(env = process.env) {
  const source = resolve(env.READBACK_SOURCE_DIRECTORY);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  demand(COMMIT.test(env.SOURCE_SHA) && /^v\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(env.RELEASE_TAG));
  demand(/^[A-Za-z0-9_.-]+$/.test(env.DEFAULT_BRANCH));
  demand(['true', 'false'].includes(env.READ_UPLOADED_BUNDLE));
  const applicationVersion = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')).version;
  demand(typeof applicationVersion === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(applicationVersion));
  git('merge-base', '--is-ancestor', env.SOURCE_SHA, `origin/${env.DEFAULT_BRANCH}`);
  return {
    productId: env.MICROSOFT_STORE_PRODUCT_ID, pendingId: env.EXPECTED_PENDING_ID, publishedId: env.EXPECTED_PUBLISHED_ID,
    sourceSha: env.SOURCE_SHA, actualSourceSha: git('rev-parse', 'HEAD'),
    tagSha: git('rev-parse', `${env.RELEASE_TAG}^{commit}`), sourceOnMain: true,
    toolingSha: env.TOOLING_SHA, releaseTag: env.RELEASE_TAG, applicationVersion, version: `${applicationVersion}.0`,
    bundleName: `RecapPage_${applicationVersion}.0_x64_arm64.msixbundle`,
    bundleSha256: env.BUNDLE_SHA256, notesSha256: env.NOTES_SHA256,
    readUploadedBundle: env.READ_UPLOADED_BUNDLE === 'true',
    notes: JSON.parse(readFileSync(resolve(source, 'docs', 'releases', `${applicationVersion}-store.json`), 'utf8')),
    release: JSON.parse(readFileSync(env.READBACK_RELEASE_FILE, 'utf8')),
    credentials: { tenantId: env.PARTNER_CENTER_TENANT_ID, clientId: env.PARTNER_CENTER_CLIENT_ID,
      clientSecret: env.PARTNER_CENTER_CLIENT_SECRET },
  };
}

export async function runDiagnosis(args, env = process.env, {
  load = loadConfiguration, fetchImpl = globalThis.fetch, write = (text) => process.stdout.write(text),
  summarize = (text) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text); },
} = {}) {
  let report;
  try {
    demand(args.length === 1 && ['--preflight', '--diagnose'].includes(args[0]));
    const config = load(env);
    if (args[0] === '--preflight') {
      const checks = configurationChecks(config);
      report = { state: checks.every((entry) => entry.result === 'pass') ? 'validated' : 'failed', mutationCount: 0, checks };
    } else {
      report = await diagnoseStoreReadback(config, { fetchImpl });
    }
  } catch {
    report = { state: 'failed', mutationCount: 0,
      checks: [{ checkId: 'LOCAL_INPUT_OR_DIAGNOSTIC', result: 'fail', code: 'LOCAL_INPUT_OR_DIAGNOSTIC' }] };
  }
  try {
    const text = `${JSON.stringify(report, null, 2)}\n`;
    write(text);
    summarize(`## Read-only Store readback diagnosis\n\n\`\`\`json\n${text}\`\`\`\n`);
  } catch {
    process.stderr.write('READBACK_REPORT_WRITE_FAILED. No Store mutation was attempted.\n');
    return 1;
  }
  return report.state === 'failed' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runDiagnosis(process.argv.slice(2));
}
