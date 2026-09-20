import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { apiFields, verifyPreservedIntent, validateCommitResponse } from './check-store-release.mjs';
import { configurationChecks, loadConfiguration, runDiagnosis } from './diagnose-store-readback.mjs';
import { checkResult, currentReadbackChecks, statusObservation } from './store-readback.mjs';
import { observeUploadedBundle } from './store-upload-readback.mjs';
import { observeCommittedSubmission } from './store-release.mjs';

const API = 'https://manage.devcenter.microsoft.com/v1.0/my/applications';

function demand(condition) {
  if (!condition) throw new Error('Commit-only contract failed');
}

export function commitConfigurationChecks(config) {
  return [
    ...configurationChecks(config),
    checkResult('EXPLICIT_COMMIT_APPROVAL', () => demand(config.commitApproved === true)),
    checkResult('FIRST_RUN_ATTEMPT', () => demand(config.runAttempt === '1')),
    checkResult('REQUIRED_UPLOAD_PROOF', () => demand(config.readUploadedBundle === true)),
    checkResult('APPROVED_CURRENT_ZIP_HASH', () => demand(
      typeof config.currentZipSha256 === 'string' && /^[0-9a-f]{64}$/.test(config.currentZipSha256))),
  ];
}

export async function commitStoreUpdate(config, {
  fetchImpl = globalThis.fetch, now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), report = () => {},
} = {}) {
  const outcome = { state: 'failed', stage: 'preflight', submissionId: null, status: null,
    commit: 'not-attempted', commitAttempted: false, mutationCount: 0, checks: [], requests: [],
    authorization: 'CURRENT_PUBLISHED_PLUS_APPROVED_NOTES_AND_PACKAGE_EDIT',
    originalUploadZipSha256: 'UNRECORDED',
    historicalSnapshots: 'UNAVAILABLE_NOT_RECONSTRUCTED',
    snapshotAtomicity: 'SEQUENTIAL_READS_NOT_AN_ATOMIC_SNAPSHOT' };
  const check = (id, operation) => {
    const result = checkResult(id, operation);
    outcome.checks.push(result);
    if (result.result !== 'pass') {
      outcome.failureCode = id;
      throw new Error('Commit-only check failed');
    }
  };
  const requireChecks = (checks) => {
    outcome.checks.push(...checks);
    const failed = checks.find((entry) => entry.result !== 'pass');
    if (failed) {
      outcome.failureCode = failed.code;
      throw new Error('Commit-only checks failed');
    }
  };
  async function readResponse(url, init, statuses = [200], timeout = 60000) {
    const observed = { stage: outcome.stage, httpStatus: null };
    outcome.requests.push(observed);
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
      observed.httpStatus = response.status;
    }
    demand(statuses.includes(response.status));
    const value = await response.json();
    demand(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  }
  try {
    requireChecks(commitConfigurationChecks(config));
    const { productId, pendingId, publishedId, bundleName, version, credentials } = config;
    Object.assign(outcome, { submissionId: pendingId, publishedId, releaseTag: config.releaseTag,
      sourceSha: config.sourceSha, toolingSha: config.toolingSha, version, bundleName,
      notesSha256: config.notesSha256, bundleSha256: config.bundleSha256,
      approvedCurrentZipSha256: config.currentZipSha256 });
    check('PROTECTED_CREDENTIALS', () => {
      for (const key of ['tenantId', 'clientId', 'clientSecret']) {
        demand(typeof credentials?.[key] === 'string' && credentials[key].trim().length > 0);
      }
    });
    outcome.stage = 'authentication';
    const token = await readResponse(
      `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/token`,
      { method: 'POST', body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: credentials.clientId,
        client_secret: credentials.clientSecret, resource: 'https://manage.devcenter.microsoft.com',
      }) });
    check('AUTH_TOKEN', () => demand(typeof token.access_token === 'string' && token.access_token.trim()));
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' };
    const root = `${API}/${encodeURIComponent(productId)}`;
    const publishedUrl = `${root}/submissions/${publishedId}`;
    const draftUrl = `${root}/submissions/${pendingId}`;
    const commitUrl = `${draftUrl}/commit`;
    const gets = new Set([root, publishedUrl, draftUrl, `${draftUrl}/status`]);
    const request = async (method, url, body, statuses = [200], timeout = 60000) => {
      demand(body === undefined);
      if (method === 'GET') {
        demand(gets.has(url));
      } else {
        demand(method === 'POST' && url === commitUrl && !outcome.commitAttempted);
        outcome.commitAttempted = true;
        outcome.commit = 'attempted';
        outcome.mutationCount = 1;
      }
      return readResponse(url, { method, headers }, statuses, timeout);
    };
    const get = async (stage, url) => {
      outcome.stage = stage;
      return apiFields(await request('GET', url));
    };
    const app = await get('application', root);
    const published = await get('published', publishedUrl);
    const pending = await get('pending', draftUrl);
    const status = await get('pending-status', `${draftUrl}/status`);
    outcome.status = statusObservation(status).status.value ?? null;
    outcome.stage = 'current-intent';
    requireChecks(currentReadbackChecks({ app, published, pending, status }, config).checks);

    outcome.stage = 'uploaded-bundle-proof';
    outcome.uploadRead = await observeUploadedBundle(pending.fileUploadUrl, bundleName, config.bundleSha256,
      { fetchImpl, now });
    requireChecks(outcome.uploadRead.checks);
    check('CURRENT_ZIP_HASH_MATCH', () => demand(
      outcome.uploadRead.state === 'verified' && outcome.uploadRead.currentZipSha256 === config.currentZipSha256));

    const finalApp = await get('recheck-application', root);
    const finalPublished = await get('recheck-published', publishedUrl);
    const finalPending = await get('recheck-pending', draftUrl);
    const finalStatus = await get('recheck-status', `${draftUrl}/status`);
    outcome.status = statusObservation(finalStatus).status.value ?? null;
    outcome.stage = 'precommit-recheck';
    requireChecks(currentReadbackChecks({
      app: finalApp, published: finalPublished, pending: finalPending, status: finalStatus,
    }, config).checks.map((entry) => ({ ...entry, checkId: `RECHECK_${entry.checkId}`,
      code: entry.result === 'pass' ? 'OK' : `RECHECK_${entry.code}` })));
    check('PUBLISHED_INTENT_UNCHANGED', () => verifyPreservedIntent(finalPublished, published));
    // No package-derived exception here: the final pending intent must still be the one just inspected.
    check('PENDING_INTENT_UNCHANGED', () => verifyPreservedIntent(finalPending, pending));
    check('UPLOAD_LOCATION_UNCHANGED', () => demand(finalPending.fileUploadUrl === pending.fileUploadUrl));

    outcome.stage = 'commit';
    validateCommitResponse(await request('POST', commitUrl, undefined, [200, 202]));
    Object.assign(outcome, { commit: 'acknowledged', status: 'CommitStarted', state: 'acknowledged' });
    outcome.stage = 'acknowledgement-report';
    report(structuredClone(outcome));
    await observeCommittedSubmission({ outcome, request, draftUrl, expected: finalPending,
      bundleName, version, now, wait });
    if (outcome.package === 'verified') outcome.notes = 'verified';
    return outcome;
  } catch {
    // Never copy exception text from authenticated transport or private Store resources.
    outcome.state = 'failed';
    outcome.failureCode ??= `COMMIT_ONLY_${outcome.stage.toUpperCase().replaceAll('-', '_')}`;
    return outcome;
  }
}

export function loadCommitConfiguration(env = process.env) {
  return { ...loadConfiguration(env), currentZipSha256: env.CURRENT_ZIP_SHA256,
    runAttempt: env.GITHUB_RUN_ATTEMPT, commitApproved: env.STORE_COMMIT_APPROVED === 'true' };
}

export async function runCommitOnly(args, env = process.env, {
  load = loadCommitConfiguration, fetchImpl = globalThis.fetch, now, wait,
  write = (text) => process.stdout.write(text), error = (text) => process.stderr.write(text),
  summarize = (text) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text); },
} = {}) {
  if (!args.length || (args.length === 1 && args[0] === '--diagnose')) {
    return runDiagnosis(['--diagnose'], env, { load, fetchImpl, write, summarize });
  }
  let result = { state: 'failed', stage: 'local-input', submissionId: null,
    commit: 'not-attempted', commitAttempted: false, mutationCount: 0 };
  const emit = (outcome) => {
    result = structuredClone(outcome);
    const text = `${JSON.stringify(outcome, null, 2)}\n`;
    write(text);
    summarize(`## Store commit-only outcome\n\n\`\`\`json\n${text}\`\`\`\n`
      + 'Only an observed published result verifies publication. Otherwise inspect the exact submission; do not rerun or edit it.\n');
  };
  try {
    demand(args.length === 1 && ['--preflight', '--commit-only'].includes(args[0]));
    const config = load(env);
    if (args[0] === '--preflight') {
      const checks = commitConfigurationChecks(config);
      result = { ...result, stage: 'preflight', checks,
        state: checks.every((entry) => entry.result === 'pass') ? 'validated' : 'failed' };
    } else {
      result = await commitStoreUpdate(config, { fetchImpl, now, wait, report: emit });
    }
    emit(result);
  } catch {
    result = { ...result, state: 'failed', reportingOrInputFailure: true };
    error(`${JSON.stringify(result)}\nCOMMIT_ONLY_REPORT_OR_INPUT_FAILED. Retain this submission and attempt state; do not rerun.\n`);
  }
  return result.state === 'failed' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCommitOnly(process.argv.slice(2));
}
