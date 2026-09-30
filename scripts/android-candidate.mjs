import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir, readdir, lstat, rm, cp } from 'node:fs/promises';
import { basename, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, ANDROID_CODE_LIMIT, DEVELOPMENT_ANDROID_CODE, validateAndroidLedger,
  assertAppendOnlyLedger, sourceIdentity, validateIdentity, verifyArtifact,
} from './lib/release-identity.mjs';
import { NATIVE_METHODS, verifyInstrumentation } from './check-android-instrumentation.mjs';

export const REPOSITORY = 'raymond-nassar/recap-page';
export const ENVIRONMENT = 'android-release-candidate';
export const OFFICIAL_ID = 'io.github.raymondnassar.recappage';
export const PROTOTYPE_ID = `${OFFICIAL_ID}.prototype`;
export const BUNDLETOOL = {
  version: '1.18.3',
  sha256: 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29',
};
export const PACKET = ['android-artifact.json', 'android-candidate.json', 'recap-page-android.aab', 'version-codes.proposed.json'];
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const LEDGER = 'packaging/android/version-codes.json';
const SECRET_NAMES = ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_UPLOAD_STORE_PASSWORD',
  'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD'];

export class CandidateError extends Error {}
function requireValue(condition, message) {
  if (!condition) throw new CandidateError(`Android candidate: ${message}`);
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
function exactKeys(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join(), 'unexpected report fields');
}
function execute(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
      maxBuffer: 32 * 1024 * 1024, ...options,
    }).trim();
  } catch {
    // Tool exceptions can contain expanded passwords, private aliases and complete stderr.
    throw new CandidateError(`Android candidate: ${basename(file)} failed; check this stage's approved inputs. Raw tool output was not retained.`);
  }
}
const git = (root, ...args) => execute('git', args, { cwd: root });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !SECRET_NAMES.includes(key)));
export function certificateFingerprint(value) {
  requireValue(typeof value === 'string' && /^[a-fA-F0-9:]+$/.test(value), 'missing public certificate SHA-256');
  const result = value.replaceAll(':', '').toLowerCase();
  requireValue(HASH.test(result), 'invalid public certificate SHA-256');
  return result;
}

export function validateInvocation(input, context, run) {
  requireValue(['Candidate', 'Rehearsal'].includes(input.mode), 'explicit Candidate or Rehearsal mode required');
  requireValue(SHA.test(input.sourceSha), 'full immutable source SHA required');
  requireValue(context.repository === REPOSITORY && context.event === 'workflow_dispatch'
    && context.defaultBranch === 'main', 'only this repository and an explicit manual event are permitted');
  requireValue(Number.isSafeInteger(context.runId) && context.runId > 0
    && Number.isSafeInteger(context.attempt) && context.attempt > 0, 'invalid run identity');
  requireValue(run.id === context.runId && run.event === context.event
    && run.head_sha === context.workflowSha && context.sha === context.workflowSha
    && run.run_attempt === context.attempt && run.head_branch === context.ref.replace(/^refs\/heads\//, '')
    && Number.isSafeInteger(run.workflow_id), 'API run identity differs from the executing workflow');
  const own = '.github/workflows/android-release-candidate.yml';
  const ci = '.github/workflows/ci.yml';
  const path = run.path?.split('@')[0];
  requireValue([own, ci].includes(path)
    && context.workflowRef === `${REPOSITORY}/${path}@${context.ref}`, 'unknown direct workflow path');
  if (input.mode === 'Candidate') {
    requireValue(path === own && context.ref === 'refs/heads/main' && context.attempt === 1,
      'Candidate requires its own direct main workflow, first attempt; CI cannot sign');
    requireValue(SHA.test(input.ledgerSha) && /^[1-9]\d*$/.test(input.code)
      && Number.isSafeInteger(Number(input.code)) && Number(input.code) <= ANDROID_CODE_LIMIT
      && Number(input.code) > DEVELOPMENT_ANDROID_CODE, 'valid source-bound reservation required');
    requireValue(/^(0|[1-9]\d*)$/.test(input.highWater)
      && Number.isSafeInteger(Number(input.highWater)) && Number(input.highWater) < Number(input.code),
    'observed Play high-water must be lower than the reserved code');
    requireValue(/^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/\d+#issuecomment-\d+$/.test(input.evidence),
      'parent public Play high-water evidence reference required');
  } else {
    requireValue(!input.ledgerSha && !input.code && !input.highWater && !input.evidence,
      'Rehearsal must not receive candidate ledger, code or Play inputs');
    requireValue(input.sourceSha === context.sha, 'rehearsal must use the exact executing source');
    if (path === ci) {
      requireValue(context.rehearsalFlag === true && context.emulatorFlag === false,
        'CI rehearsal requires exclusive explicit manual rehearsal flag');
    }
  }
  return { path, workflowId: run.workflow_id };
}

export function protectionPolicy(environment, branches) {
  requireValue(environment.name === ENVIRONMENT && Number.isSafeInteger(environment.id)
    && environment.id > 0 && environment.can_admins_bypass === false, 'environment absent or admin bypass not disabled');
  requireValue(environment.deployment_branch_policy?.custom_branch_policies === true
    && environment.deployment_branch_policy.protected_branches === false,
  'environment requires exact main-only custom branch policy');
  requireValue(branches.total_count === 1 && branches.branch_policies?.length === 1
    && branches.branch_policies[0].name === 'main' && branches.branch_policies[0].type === 'branch',
  'environment branch policy must allow main only, without tags or wildcards');
  const rules = environment.protection_rules;
  requireValue(Array.isArray(rules), 'environment protection rules unavailable');
  const review = rules.filter((rule) => rule.type === 'required_reviewers');
  requireValue(review.length === 1 && review[0].prevent_self_review === true
    && Array.isArray(review[0].reviewers), 'human review with self-review disabled is required');
  const reviewers = review[0].reviewers.filter((entry) => entry.type === 'User'
    && Number.isSafeInteger(entry.reviewer?.id) && entry.reviewer.type === 'User')
    .map((entry) => entry.reviewer.id).sort((a, b) => a - b);
  requireValue(reviewers.length > 0, 'a directly verifiable authorized human reviewer is required');
  const policy = { environmentId: environment.id, reviewers, preventSelfReview: true,
    adminBypass: false, branch: 'main', rules };
  return { ...policy, sha256: digest(JSON.stringify(policy)) };
}

export function requireApproval(approvals, policy, context) {
  requireValue(context.attempt === 1 && Array.isArray(approvals), 'run approval history unavailable');
  const relevant = approvals.filter((entry) => entry.environments?.some((env) => env.id === policy.environmentId));
  requireValue(relevant.length === 1 && relevant[0].state === 'approved', 'one unambiguous approved environment review required');
  const user = relevant[0].user;
  requireValue(user?.type === 'User' && policy.reviewers.includes(user.id)
    && user.login !== context.actor && user.login !== context.triggeringActor,
  'approval must be an authorized human distinct from the dispatch initiator');
  return { runId: context.runId, environmentId: policy.environmentId, policySha256: policy.sha256, approved: true };
}

export function eligibleReservation(selected, current, source, code) {
  validateAndroidLedger(selected);
  assertAppendOnlyLedger(selected, current);
  const expected = selected.reservations.find((entry) => entry.versionCode === Number(code));
  const latest = current.reservations.find((entry) => entry.versionCode === Number(code));
  requireValue(expected && latest && expected.artifact === null && latest.artifact === null
    && JSON.stringify(expected) === JSON.stringify(latest), 'reservation is absent, changed or already sealed on current main');
  requireValue(expected.sourceRevision === source.sourceRevision && expected.sourceTree === source.sourceTree
    && expected.productVersion === source.productVersion, 'reservation does not match selected source');
  return expected;
}

export function requireSourceAncestry(root, source, ledger, tooling, main) {
  requireValue([source, ledger, tooling, main].every((revision) => SHA.test(revision)), 'full ancestry pins required');
  for (const revision of [source, ledger, tooling]) {
    git(root, 'merge-base', '--is-ancestor', revision, main);
  }
  git(root, 'merge-base', '--is-ancestor', source, ledger);
}

async function github(path) {
  requireValue(path.startsWith(`repos/${REPOSITORY}/`), 'non-repository API read refused');
  const token = process.env.GITHUB_TOKEN;
  requireValue(token, 'read-only GitHub token unavailable');
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  requireValue(response.ok, `required GitHub GET failed (${response.status}); no approval or configuration fallback`);
  return response.json();
}

export async function requireUnusedCode(readPage, code, runId) {
  let currentSeen = false;
  for (let page = 1; page <= 3; page += 1) {
    const result = await readPage(page);
    requireValue(Array.isArray(result.workflow_runs) && Number.isSafeInteger(result.total_count),
      'candidate attempt history unavailable');
    for (const run of result.workflow_runs) {
      if (run.id === runId) currentSeen = true;
      requireValue(run.id === runId || !run.display_title?.startsWith(`Android Candidate code ${code} `),
        'this reserved code has an earlier dispatch; allocate a new code, do not retry');
    }
    if (page * 100 >= result.total_count) {
      requireValue(currentSeen, 'candidate history does not include this run; current eligibility is uncertain');
      return;
    }
  }
  throw new CandidateError('Android candidate: attempt history exceeds bounded read; parent must reconcile, not retry blindly');
}

function environmentRequest() {
  return {
    mode: process.env.RECAP_ANDROID_MODE,
    sourceSha: process.env.RECAP_ANDROID_SOURCE_SHA,
    ledgerSha: process.env.RECAP_ANDROID_LEDGER_SHA || '',
    code: process.env.RECAP_ANDROID_CODE || '',
    highWater: process.env.RECAP_ANDROID_PLAY_HIGH_WATER || '',
    evidence: process.env.RECAP_ANDROID_PLAY_EVIDENCE || '',
  };
}
async function executionContext() {
  const event = await json(process.env.GITHUB_EVENT_PATH);
  return {
    repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME,
    defaultBranch: event.repository?.default_branch, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
    rehearsalFlag: ['true', true].includes(event.inputs?.android_rehearsal),
    emulatorFlag: ['true', true].includes(event.inputs?.android_emulator),
  };
}

export async function preflight({ afterApproval = false } = {}) {
  const input = environmentRequest();
  const context = await executionContext();
  const prefix = `repos/${REPOSITORY}`;
  const run = await github(`${prefix}/actions/runs/${context.runId}`);
  const invocation = validateInvocation(input, context, run);
  const tooling = sourceIdentity(ROOT);
  requireValue(tooling.sourceRevision === context.workflowSha && !tooling.sourceDirty,
    'tooling must be the exact clean executing workflow source');
  requireValue(git(ROOT, 'rev-parse', `${input.sourceSha}^{commit}`) === input.sourceSha, 'source is not an exact available commit');
  const source = {
    sourceRevision: input.sourceSha, sourceTree: git(ROOT, 'rev-parse', `${input.sourceSha}^{tree}`),
    productVersion: JSON.parse(git(ROOT, 'show', `${input.sourceSha}:package.json`)).version,
  };
  const result = { schemaVersion: 1, input, context, invocation, source, policy: null, approval: null, ledger: null };
  if (input.mode === 'Candidate') {
    git(ROOT, 'fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    const main = git(ROOT, 'rev-parse', 'refs/remotes/origin/main');
    requireSourceAncestry(ROOT, input.sourceSha, input.ledgerSha, context.workflowSha, main);
    const selected = JSON.parse(git(ROOT, 'show', `${input.ledgerSha}:${LEDGER}`));
    const current = JSON.parse(git(ROOT, 'show', `${main}:${LEDGER}`));
    let previous = { schemaVersion: 1, retiredThrough: DEVELOPMENT_ANDROID_CODE, reservations: [] };
    const history = git(ROOT, 'log', '--first-parent', '--reverse', '--format=%H', main, '--', LEDGER);
    for (const commit of history.split(/\r?\n/).filter(Boolean)) {
      const next = JSON.parse(git(ROOT, 'show', `${commit}:${LEDGER}`));
      assertAppendOnlyLedger(previous, next);
      previous = next;
    }
    eligibleReservation(selected, current, source, input.code);
    result.ledger = { selected, main, sha256: digest(JSON.stringify(selected)) };
    result.policy = protectionPolicy(
      await github(`${prefix}/environments/${ENVIRONMENT}`),
      await github(`${prefix}/environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100`),
    );
    if (afterApproval) {
      requireValue(String(result.policy.environmentId) === process.env.RECAP_ANDROID_EXPECTED_ENVIRONMENT_ID
        && result.policy.sha256 === process.env.RECAP_ANDROID_EXPECTED_POLICY_SHA,
      'environment was changed or recreated while approval was pending; parent must keep protection stable');
      result.approval = requireApproval(await github(`${prefix}/actions/runs/${context.runId}/approvals`),
        result.policy, context);
    }
    await requireUnusedCode((page) => github(`${prefix}/actions/workflows/${invocation.workflowId}/runs?event=workflow_dispatch&per_page=100&page=${page}`),
      input.code, context.runId);
  }
  return result;
}

export function sourceCommand(root, command, args, { code, ledger } = {}) {
  const env = cleanEnv();
  delete env.RECAP_ANDROID_VERSION_CODE;
  delete env.RECAP_ANDROID_LEDGER;
  if (code !== undefined) {
    env.RECAP_ANDROID_VERSION_CODE = code;
    env.RECAP_ANDROID_LEDGER = ledger;
  }
  return execute(process.execPath, [join(root, 'scripts', 'android-release.mjs'), command, ...args], { cwd: root, env });
}

export function checkRecord(record, identity) {
  validateIdentity(identity);
  requireValue(identity.channel === 'candidate' && record.channel === 'candidate', 'development records cannot qualify a candidate');
  const { artifact, ...actual } = record;
  requireValue(JSON.stringify(actual) === JSON.stringify(identity) && artifact?.name === 'recap-page-android.aab',
    'record identity differs from the selected application source');
}

export async function assertFiles(directory, allowed) {
  const entries = await readdir(directory, { withFileTypes: true });
  requireValue(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
    && entries.map((entry) => entry.name).sort().join() === [...allowed].sort().join(),
  'output contains missing, extra or nonregular files');
}

export async function withPrivateDirectory(work, name, action) {
  requireValue(['upload-secret', 'jdk-proof'].includes(name), 'unknown private scratch purpose');
  const directory = join(work, name);
  await mkdir(directory, { mode: 0o700 });
  try {
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
    requireValue(!(await readdir(work)).includes(name), 'private signing scratch cleanup failed');
  }
}

async function ownedWork() {
  const root = resolve(process.env.RUNNER_TEMP || '');
  requireValue(process.env.RUNNER_TEMP && process.env.RECAP_ANDROID_WORK, 'explicit runner temporary work directory required');
  const work = resolve(process.env.RECAP_ANDROID_WORK);
  const child = relative(root, work);
  requireValue(child && !child.startsWith('..') && !isAbsolute(child), 'work directory must be inside runner temporary storage');
  for (let path = work; path !== root; path = resolve(path, '..')) {
    const stat = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    requireValue(!stat?.isSymbolicLink(), 'temporary path must not traverse symlinks');
  }
  return work;
}

async function assertIntegration(root) {
  const [gradle, runner, fixture] = await Promise.all([
    readFile(join(root, 'packaging', 'android', 'app', 'build.gradle'), 'utf8'),
    readFile(join(root, 'scripts', 'android-emulator-ci.sh'), 'utf8'),
    readFile(join(root, 'packaging', 'android', 'app', 'src', 'androidTest', 'java', 'io', 'github',
      'raymondnassar', 'recappage', 'prototype', 'NativeIntegrationTest.java'), 'utf8'),
  ]);
  requireValue(gradle.includes('recapAndroidTestBuildType')
    && runner.includes('RECAP_ANDROID_DERIVED_INTERFACE=1')
    && ['official-seed', 'prototype-seed', 'official-probe', 'prototype-probe'].every((phase) => fixture.includes(phase)),
  'INTEGRATION_HELD: release testBuildType, derived runner interface v1 and non-reseeding installation phases must land before execution');
}

export async function checkAssets(extracted, generated, root, identity) {
  const manifest = await json(join(generated, 'android-assets.json'));
  requireValue(JSON.stringify(manifest.build) === JSON.stringify(identity), 'generated asset build identity mismatch');
  const expected = new Set(['.recap-android-assets', 'android-assets.json']);
  for (const file of manifest.files) {
    requireValue(typeof file.path === 'string' && !file.path.startsWith('/')
      && file.path.split('/').every((part) => part && part !== '.' && part !== '..')
      && !file.path.includes('\\') && !expected.has(file.path), 'unsafe or duplicate asset path');
    expected.add(file.path);
    const actual = await readFile(join(extracted, file.path));
    requireValue(digest(actual) === file.sha256 && actual.equals(await readFile(join(generated, file.path))),
      'bundled asset differs from preserved generated source');
    if (file.source) {
      requireValue(/^(src|packaging\/android\/web)\//.test(file.source) && !file.source.includes('..'),
        'asset provenance leaves approved source');
      requireValue(digest(await readFile(join(root, file.source))) === file.sourceSha256, 'asset source hash mismatch');
    }
  }
  async function list(path, prefix = '') {
    const output = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      requireValue(!entry.isSymbolicLink(), 'asset symlink refused');
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) output.push(...await list(join(path, entry.name), name));
      else if (entry.isFile()) output.push(name);
      else throw new CandidateError('Android candidate: nonregular asset refused');
    }
    return output.sort();
  }
  requireValue((await list(extracted)).join() === [...expected].sort().join(), 'missing or extra bundled assets');
  requireValue((await readFile(join(extracted, 'android-assets.json'))).equals(await readFile(join(generated, 'android-assets.json'))),
    'embedded asset inventory differs from preserved output');
  requireValue((await readFile(join(extracted, '.recap-android-assets'))).equals(await readFile(join(generated, '.recap-android-assets'))),
    'generated asset ownership marker differs');
  const embedded = validateIdentity(await json(join(extracted, 'build-info.json')));
  requireValue(expected.has('build-info.json') && expected.has('android-config.json')
    && JSON.stringify(embedded) === JSON.stringify(identity), 'embedded build record differs from selected source identity');
  const config = await json(join(extracted, 'android-config.json'));
  requireValue(config.origin === 'http://127.0.0.1:8787' && config.version === identity.productVersion,
    'packaged local origin or product version changed');
  for (const forbidden of ['dev-faults.html', 'dev-faults.js', 'sw.js', 'js/app.js']) {
    requireValue(!expected.has(forbidden), 'development-only asset bundled');
  }
  return { files: expected.size, manifestSha256: digest(await readFile(join(generated, 'android-assets.json'))) };
}

export function verifyNativeReport(report, control) {
  exactKeys(report, ['schemaVersion', 'interfaceVersion', 'synthetic', 'device', 'executions']);
  requireValue(report.schemaVersion === 1 && report.interfaceVersion === 1 && report.synthetic === true,
    'native derived-artifact report interface mismatch');
  exactKeys(report.device, ['sdk', 'abi', 'width', 'height', 'density', 'webViewVersion', 'externalNetworkBlocked']);
  requireValue(report.device.sdk === 36 && report.device.abi === 'x86_64'
    && report.device.width === 1080 && report.device.height === 2400 && report.device.density === 420
    && report.device.externalNetworkBlocked === true && /^\d+(?:\.\d+){3}$/.test(report.device.webViewVersion),
  'native device/profile/firewall evidence mismatch');
  requireValue(Array.isArray(report.executions) && report.executions.length === 12, 'native proof must contain exactly twelve executions');
  const suite = report.executions.slice(0, NATIVE_METHODS.length);
  requireValue(suite.map((entry) => entry.method).sort().join() === [...NATIVE_METHODS].sort().join(),
    'native suite differs from the six existing methods');
  const expected = [
    ...suite.map(({ method }) => ({ phase: 'suite', method, role: 'official' })),
    ...['restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe']
      .map((phase) => ({ phase, method: 'startupAndPersistence', role: phase.startsWith('prototype') ? 'prototype' : 'official' })),
  ];
  const uids = new Map();
  for (let index = 0; index < expected.length; index += 1) {
    const actual = report.executions[index];
    exactKeys(actual, ['phase', 'method', 'packageName', 'uid', 'status', 'tests', 'skipped',
      'appHashes', 'harnessHash', 'signerSha256', 'stateMatched', 'settingsMatched', 'storageCleared']);
    const entry = expected[index];
    const target = control[entry.role];
    requireValue(actual.phase === entry.phase && actual.method === entry.method
      && actual.packageName === target.packageName && actual.status === 'passed' && actual.tests === 1 && actual.skipped === 0,
    'native method, target, phase or pass evidence mismatch');
    requireValue(Array.isArray(actual.appHashes) && actual.appHashes.every((hash) => HASH.test(hash))
      && HASH.test(actual.harnessHash) && HASH.test(actual.signerSha256)
      && ['stateMatched', 'settingsMatched', 'storageCleared'].every((key) => typeof actual[key] === 'boolean'),
    'native evidence contains unsafe or missing values');
    requireValue(JSON.stringify([...actual.appHashes].sort()) === JSON.stringify([...target.appHashes].sort())
      && actual.harnessHash === target.harnessHash && actual.signerSha256 === target.signerSha256,
    'native installed bytes or signer differ from AAB-derived inputs');
    requireValue(Number.isSafeInteger(actual.uid) && actual.uid > 0, 'native target UID missing');
    if (uids.has(entry.role)) requireValue(uids.get(entry.role) === actual.uid, 'target UID changed during proof');
    uids.set(entry.role, actual.uid);
    if (entry.phase.endsWith('-probe')) {
      requireValue(actual.storageCleared === false && actual.stateMatched === true && actual.settingsMatched === true,
        'native probe reseeded or failed independent state/settings comparison');
    }
  }
  requireValue(uids.get('official') !== uids.get('prototype'), 'coexisting packages must have distinct UIDs');
  return report;
}

const fileDigest = async (path) => digest(await readFile(path));
const javaHelper = () => join(ROOT, 'scripts', 'android', 'VerifyBundle.java');
const java = (...args) => execute('java', [javaHelper(), ...args], { env: cleanEnv() });
function sdkTool(name) {
  requireValue(process.env.ANDROID_HOME, 'Android SDK location required');
  return name === 'apkanalyzer'
    ? join(process.env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', name)
    : join(process.env.ANDROID_HOME, 'build-tools', '35.0.0', name);
}
const bundletool = (work, ...args) => execute('java', ['-jar', join(work, 'bundletool.jar'), ...args], { env: cleanEnv() });
export function noNative(files) {
  requireValue(files.every((file) => !file.elf && !/^(?:[^/]+\/)?lib\//.test(file.name) && !file.name.endsWith('.so')),
    'unexpected native library; scoped ABI/16 KB reassessment required');
}
function apkCertificate(path) {
  const result = execute(sdkTool('apksigner'), ['verify', '--verbose', '--print-certs', path], { env: cleanEnv() });
  const matches = [...result.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9:]+)$/gm)];
  requireValue(matches.length === 1, 'APK needs exactly one verified signer');
  return certificateFingerprint(matches[0][1]);
}

async function inspectPackages(work, root) {
  const version = await json(join(work, 'version.json'));
  const signer = await json(join(work, 'signer.json'));
  const bundle = join(work, 'recap-page-android.aab');
  requireValue(await fileDigest(join(work, 'bundletool.jar')) === BUNDLETOOL.sha256, 'bundletool checksum mismatch');
  const before = await fileDigest(bundle);
  bundletool(work, 'validate', `--bundle=${bundle}`);
  const inventory = JSON.parse(java('archive', bundle, certificateFingerprint(signer.sha256), join(work, 'bundle')));
  noNative(inventory.files);
  requireValue(inventory.files.every((file) => /^(base\/|META-INF\/|BUNDLE-METADATA\/|BundleConfig\.pb$)/.test(file.name))
    && inventory.files.some((file) => file.name === 'base/manifest/AndroidManifest.xml'), 'unexpected or missing bundle module');
  const bundleManifest = join(work, 'bundle-manifest.xml');
  await writeFile(bundleManifest, bundletool(work, 'dump', 'manifest', `--bundle=${bundle}`, '--module=base'));
  java('manifest', bundleManifest, OFFICIAL_ID, String(version.versionCode), version.versionName, 'app');
  await checkAssets(join(work, 'bundle', 'base', 'assets', 'recap'), join(work, 'generated'), root, version.identity);
  const apks = JSON.parse(java('archive', join(work, 'derived.apks'), '-', join(work, 'apks')));
  const splits = apks.files.filter((file) => file.name.endsWith('.apk'));
  requireValue(splits.length > 0 && splits.length <= 32
    && splits.every((file) => file.name.startsWith('splits/')), 'expected one bounded device-specific split set');
  const proof = certificateFingerprint((await json(join(work, 'proof-signer.json'))).sha256);
  requireValue(proof !== signer.sha256, 'bundle and disposable install signer roles must differ');
  let baseCount = 0;
  for (const [index, split] of splits.entries()) {
    const path = join(work, 'apks', split.name);
    requireValue(apkCertificate(path) === proof, 'derived split signer mismatch');
    execute(sdkTool('zipalign'), ['-c', '-P', '16', '4', path], { env: cleanEnv() });
    const extracted = join(work, `split-${index}`);
    const contents = JSON.parse(java('archive', path, '-', extracted));
    noNative(contents.files);
    const xmlPath = join(work, `split-${index}.xml`);
    const manifest = execute(sdkTool('apkanalyzer'), ['manifest', 'print', path], { env: cleanEnv() });
    await writeFile(xmlPath, manifest);
    java('manifest', xmlPath, OFFICIAL_ID, String(version.versionCode), version.versionName, 'apk');
    if (contents.files.some((file) => file.name === 'assets/recap/build-info.json')) {
      baseCount += 1;
      await checkAssets(join(extracted, 'assets', 'recap'), join(work, 'generated'), root, version.identity);
      const badging = execute(sdkTool('aapt2'), ['dump', 'badging', path], { env: cleanEnv() });
      requireValue(/^application-label:'Recap Page'$/m.test(badging), 'resolved application label mismatch');
      const resources = execute(sdkTool('aapt2'), ['dump', 'resources', path], { env: cleanEnv() });
      await writeFile(join(work, 'resources.txt'), resources);
      java('manifest', xmlPath, OFFICIAL_ID, String(version.versionCode), version.versionName,
        'app', join(work, 'resources.txt'));
      for (const name of ['backup_rules', 'data_extraction_rules', 'network_security_config']) {
        const decoded = join(work, `${name}.xml`);
        await writeFile(decoded, execute(sdkTool('apkanalyzer'),
          ['resources', 'xml', '--file', `/res/xml/${name}.xml`, path], { env: cleanEnv() }));
        java('resource', decoded, join(root, 'packaging', 'android', 'app', 'src', 'main', 'res', 'xml', `${name}.xml`));
      }
      const dex = execute(sdkTool('apkanalyzer'), ['dex', 'packages', '--defined-only', path], { env: cleanEnv() });
      const symbols = dex.split(/\r?\n/).map((line) => line.trim().split(/\s+/).at(-1))
        .filter((name) => name && /^[A-Za-z_$][\w.$]*$/.test(name));
      requireValue(symbols.some((name) => name.includes('MainActivity'))
        && symbols.every((name) => name === '<TOTAL>' || name === 'name' || PROTOTYPE_ID.startsWith(`${name}.`)
          || name === PROTOTYPE_ID || name.startsWith(`${PROTOTYPE_ID}.`))
        && !/NativeIntegrationTest|FixtureDocumentProvider|FixtureMetadataServer|androidx\./.test(dex),
      'unexpected shipped DEX class or test/runtime dependency');
    }
  }
  requireValue(baseCount === 1, 'exactly one derived base APK must carry the source assets');
  const harness = join(work, 'release-test.apk');
  requireValue(apkCertificate(harness) === proof, 'release harness and derived split signers must match');
  const harnessXml = join(work, 'harness.xml');
  await writeFile(harnessXml, execute(sdkTool('apkanalyzer'), ['manifest', 'print', harness], { env: cleanEnv() }));
  java('manifest', harnessXml, `${OFFICIAL_ID}.test`, String(version.versionCode), version.versionName, 'test');
  const prototype = join(work, 'prototype.apk');
  const prototypeHarness = join(work, 'prototype-test.apk');
  const debugSigner = apkCertificate(prototype);
  requireValue(apkCertificate(prototypeHarness) === debugSigner, 'prototype harness signer mismatch');
  const summary = execute(sdkTool('apkanalyzer'), ['apk', 'summary', prototype], { env: cleanEnv() }).split(/\s+/);
  requireValue(summary.length === 3 && summary[0] === PROTOTYPE_ID && summary[1] === String(DEVELOPMENT_ANDROID_CODE)
    && summary[2] === `${version.identity.productVersion}-dev.${version.identity.sourceRevision.slice(0, 8)}`,
  'prototype coexistence control must retain its clean development identity');
  const prototypeHarnessXml = join(work, 'prototype-harness.xml');
  await writeFile(prototypeHarnessXml, execute(sdkTool('apkanalyzer'), ['manifest', 'print', prototypeHarness], { env: cleanEnv() }));
  java('manifest', prototypeHarnessXml, `${PROTOTYPE_ID}.test`, summary[1], summary[2], 'test');
  requireValue(await fileDigest(bundle) === before, 'bundle changed during derived package inspection');
  const control = {
    schemaVersion: 1, interfaceVersion: 1, bundleSha256: before,
    apks: join(work, 'derived.apks'), result: join(work, 'native-result.json'),
    bundletool: { path: join(work, 'bundletool.jar'), sha256: BUNDLETOOL.sha256 },
    official: { packageName: OFFICIAL_ID, appHashes: splits.map((split) => split.sha256).sort(),
      harness, harnessHash: await fileDigest(harness), signerSha256: proof },
    prototype: { packageName: PROTOTYPE_ID, apk: prototype, appHashes: [await fileDigest(prototype)],
      harness: prototypeHarness, harnessHash: await fileDigest(prototypeHarness), signerSha256: debugSigner },
    phases: ['suite', 'restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe'],
  };
  await save(join(work, 'native-input.json'), control);
  await save(join(work, 'package-checks.json'), {
    bundleSha256: before, bundleSignerSha256: signer.sha256, structure: true,
    manifest: true, resources: true, assets: true, nativeLibraries: 0, apkSignatures: true,
  });
}

async function jdkProof(work) {
  const scratch = join(work, 'jdk-proof');
  await mkdir(scratch, { mode: 0o700 });
  const env = { ...cleanEnv(), RECAP_PROOF_PASSWORD: randomBytes(32).toString('hex'), RECAP_PROOF_ALIAS: 'proof' };
  try {
    const store = join(scratch, 'fixture.p12');
    execute('keytool', ['-genkeypair', '-alias', 'proof', '-keyalg', 'RSA', '-keysize', '2048',
      '-validity', '2', '-dname', 'CN=Recap disposable verifier fixture', '-storetype', 'PKCS12',
      '-keystore', store, '-storepass:env', 'RECAP_PROOF_PASSWORD', '-keypass:env', 'RECAP_PROOF_PASSWORD'], { env });
    const cert = JSON.parse(execute('java', [javaHelper(), 'certificate', store, 'RECAP_PROOF_ALIAS', 'RECAP_PROOF_PASSWORD'], { env }));
    await writeFile(join(scratch, 'original.txt'), 'Synthetic verifier fixture\n');
    const jar = join(scratch, 'fixture.jar');
    execute('jar', ['--create', '--file', jar, '-C', scratch, 'original.txt'], { env });
    execute('jarsigner', ['-keystore', store, '-storepass:env', 'RECAP_PROOF_PASSWORD',
      '-keypass:env', 'RECAP_PROOF_PASSWORD', '-sigfile', 'RECAP', jar, 'proof'], { env });
    java('archive', jar, cert.sha256, join(scratch, 'positive'));
    await writeFile(join(scratch, 'addition.txt'), 'Unsigned extra payload\n');
    execute('jar', ['--update', '--file', jar, '-C', scratch, 'addition.txt'], { env });
    const runVerifier = (helper, output) => spawnSync('java', [helper, 'archive', jar, cert.sha256, output], {
      env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 1024 * 1024,
    });
    const assertUnsignedRejected = (result) => requireValue(result.status === 1
      && String(result.stderr).trim() === 'UNSIGNED_ENTRY', 'JDK unsigned-entry regression assertion failed');
    assertUnsignedRejected(runVerifier(javaHelper(), join(scratch, 'negative')));
    const source = await readFile(javaHelper(), 'utf8');
    const guard = 'require(signers != null && signers.length == 1, "UNSIGNED_ENTRY");';
    requireValue(source.split(guard).length === 2, 'aimed JDK mutation guard changed');
    const mutant = join(scratch, 'VerifyBundle.java');
    await writeFile(mutant, source.replace(guard, ''));
    const mutated = runVerifier(mutant, join(scratch, 'mutant'));
    requireValue(mutated.status === 0 && !mutated.error, 'aimed mutant did not accept the unsigned fixture');
    let regressionFailed = false;
    try {
      assertUnsignedRejected(mutated);
    } catch (error) {
      regressionFailed = error instanceof CandidateError;
    }
    requireValue(regressionFailed, 'JDK mutation did not falsify the original regression assertion');
    await save(join(work, 'jdk-proof.json'), {
      signedFixturePassed: true, fixedRejectedUnsignedEntry: true,
      mutantViolatedRejectionAssertion: true, verifierSha256: digest(source),
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function nativeInputs(work, input, result) {
  requireValue(resolve(input) === join(work, 'native-input.json')
    && resolve(result) === join(work, 'native-result.json'), 'derived runner paths must belong to this candidate workspace');
  const control = await json(input);
  exactKeys(control, ['schemaVersion', 'interfaceVersion', 'bundleSha256', 'apks', 'result',
    'bundletool', 'official', 'prototype', 'phases']);
  requireValue(control.schemaVersion === 1 && control.interfaceVersion === 1 && HASH.test(control.bundleSha256)
    && control.result === result && control.official.packageName === OFFICIAL_ID
    && control.prototype.packageName === PROTOTYPE_ID, 'invalid derived runner control identity');
  requireValue(control.bundletool.sha256 === BUNDLETOOL.sha256, 'derived runner bundletool pin mismatch');
  const paths = [control.apks, control.bundletool.path, control.official.harness,
    control.prototype.apk, control.prototype.harness];
  for (const path of paths) {
    requireValue(typeof path === 'string' && !/[\r\n\0]/.test(path)
      && resolve(path) === path && relative(work, path) && !relative(work, path).startsWith('..')
      && !isAbsolute(relative(work, path)), 'derived runner input leaves the owned workspace');
    const info = await lstat(path);
    requireValue(info.isFile() && !info.isSymbolicLink(), 'derived runner needs regular verified files');
  }
  requireValue(await fileDigest(control.bundletool.path) === BUNDLETOOL.sha256
    && await fileDigest(control.official.harness) === control.official.harnessHash
    && await fileDigest(control.prototype.harness) === control.prototype.harnessHash
    && JSON.stringify(control.prototype.appHashes) === JSON.stringify([await fileDigest(control.prototype.apk)]),
  'derived input changed since inspection');
  requireValue(await fileDigest(join(work, 'recap-page-android.aab')) === control.bundleSha256,
    'signed source bundle changed before native testing');
  return [...paths, NATIVE_METHODS.join(',')];
}

async function collectNativeReport(work) {
  const control = await json(join(work, 'native-input.json'));
  requireValue(await readFile(join(work, 'native-evidence', 'network-verified.txt'), 'utf8') === 'external-network-blocked-v1\n',
    'derived runner did not confirm both external-network firewall rules');
  const phases = ['suite', 'restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe'];
  const executions = [];
  const installation = new Map();
  let device;
  for (const phase of phases) {
    const methods = phase === 'suite' ? NATIVE_METHODS : ['startupAndPersistence'];
    const log = await readFile(join(work, 'native-evidence', `${phase}.log`), 'utf8');
    verifyInstrumentation(log, { methods });
    for (const method of methods) {
      const receipt = await json(join(work, 'native-receipts', phase, `${method}.json`));
      exactKeys(receipt, ['execution', 'device', 'installation']);
      exactKeys(receipt.device, ['sdk', 'abi', 'width', 'height', 'density', 'webViewVersion']);
      requireValue(receipt.execution.phase === phase && receipt.execution.method === method,
        'native receipt identity differs from actual instrumentation result');
      if (device) {
        requireValue(Object.keys(device).every((key) => device[key] === receipt.device[key]),
          'native device identity changed between executions');
      } else device = receipt.device;
      if (phase.startsWith('official-') || phase.startsWith('prototype-')) {
        exactKeys(receipt.installation, ['role', 'stateSha256', 'settingsSha256']);
        const role = phase.split('-')[0];
        requireValue(receipt.installation.role === role && HASH.test(receipt.installation.stateSha256)
          && HASH.test(receipt.installation.settingsSha256), 'installation snapshot evidence missing');
        if (phase.endsWith('-seed')) installation.set(role, receipt.installation);
        else {
          const seeded = installation.get(role);
          requireValue(seeded && seeded.stateSha256 === receipt.installation.stateSha256
            && seeded.settingsSha256 === receipt.installation.settingsSha256,
          'retained installation data differs from its independent pre-replacement receipt');
        }
      } else requireValue(receipt.installation === null, 'unexpected installation state in ordinary native suite');
      executions.push(receipt.execution);
    }
  }
  requireValue(installation.get('official')?.stateSha256 !== installation.get('prototype')?.stateSha256
    && installation.get('official')?.settingsSha256 !== installation.get('prototype')?.settingsSha256,
  'coexistence fixtures must have independent distinct state and settings');
  const report = { schemaVersion: 1, interfaceVersion: 1, synthetic: true,
    device: { ...device, externalNetworkBlocked: true }, executions };
  verifyNativeReport(report, control);
  await save(join(work, 'native-result.json'), report);
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  const work = await ownedWork();
  const root = resolve(process.env.RECAP_ANDROID_SOURCE_ROOT || ROOT);
  if (command === 'preflight') {
    const receipt = await preflight({ afterApproval: process.env.RECAP_ANDROID_AFTER_APPROVAL === 'true' });
    await mkdir(work, { recursive: true, mode: 0o700 });
    await save(join(work, 'preflight.json'), receipt);
    if (process.env.GITHUB_OUTPUT && receipt.policy) {
      await appendFile(process.env.GITHUB_OUTPUT, `environment=${ENVIRONMENT}\nenvironment_id=${receipt.policy.environmentId}\npolicy_sha=${receipt.policy.sha256}\n`);
    }
  } else if (command === 'prepare') {
    const receipt = await json(join(work, 'preflight.json'));
    await assertIntegration(root);
    const source = sourceIdentity(root);
    requireValue(!source.sourceDirty && source.sourceRevision === receipt.source.sourceRevision
      && source.sourceTree === receipt.source.sourceTree, 'application checkout must match exact clean selected source');
    if (receipt.input.mode === 'Candidate') {
      requireValue(receipt.approval?.approved === true, 'run-bound protected approval required before building a real candidate');
      await save(join(work, 'ledger.json'), receipt.ledger.selected);
    }
    const version = JSON.parse(sourceCommand(root, 'version', [], receipt.input.mode === 'Candidate'
      ? { code: receipt.input.code, ledger: join(work, 'ledger.json') } : {}));
    validateIdentity(version.identity);
    await save(join(work, 'version.json'), version);
  } else if (command === 'sign') {
    const receipt = await json(join(work, 'preflight.json'));
    requireValue(receipt.input.mode === 'Candidate' && receipt.approval?.approved, 'protected Candidate signing only');
    const fresh = await preflight({ afterApproval: true });
    requireValue(fresh.policy.sha256 === receipt.policy.sha256, 'approval policy changed before signing');
    requireValue(SECRET_NAMES.every((name) => process.env[name]?.length), 'all four protected upload credentials must be present');
    const fingerprint = certificateFingerprint(process.env.ANDROID_UPLOAD_CERT_SHA256);
    await withPrivateDirectory(work, 'upload-secret', async (secret) => {
      const encoded = process.env.ANDROID_UPLOAD_KEYSTORE_BASE64;
      requireValue(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        && encoded.length > 0 && encoded.length < 2 * 1024 * 1024, 'invalid bounded base64 upload keystore');
      const store = join(secret, 'upload.p12');
      await writeFile(store, Buffer.from(encoded, 'base64'), { mode: 0o600, flag: 'wx' });
      const helper = join(ROOT, 'scripts', 'android', 'VerifyBundle.java');
      const cert = JSON.parse(execute('java', [helper, 'certificate', store,
        'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_STORE_PASSWORD']));
      requireValue(cert.sha256 === fingerprint && cert.debug === false, 'upload certificate differs from approved non-debug public fingerprint');
      execute('jarsigner', ['-keystore', store, '-storepass:env', 'ANDROID_UPLOAD_STORE_PASSWORD',
        '-keypass:env', 'ANDROID_UPLOAD_KEY_PASSWORD', '-sigfile', 'RECAP', '-digestalg', 'SHA-256',
        '-signedjar', join(work, 'recap-page-android.aab'), join(work, 'unsigned.aab'), process.env.ANDROID_UPLOAD_KEY_ALIAS]);
      await save(join(work, 'signer.json'), { sha256: cert.sha256, role: 'upload' });
    });
  } else if (command === 'jdk-proof') {
    requireValue(environmentRequest().mode === 'Rehearsal', 'disposable mutation proof is rehearsal-only');
    await jdkProof(work);
  } else if (command === 'inspect') {
    await inspectPackages(work, root);
  } else if (command === 'native-input') {
    console.log((await nativeInputs(work, input, output)).join('\n'));
  } else if (command === 'native-report') {
    await collectNativeReport(work);
  } else if (command === 'assets') {
    const { identity } = await json(join(work, 'version.json'));
    await save(join(work, 'assets-check.json'), await checkAssets(join(work, 'bundle', 'base', 'assets', 'recap'),
      join(work, 'generated'), root, identity));
  } else if (command === 'finish') {
    const receipt = await json(join(work, 'preflight.json'));
    const { identity } = await json(join(work, 'version.json'));
    const tooling = sourceIdentity(ROOT);
    requireValue(tooling.sourceRevision === receipt.context.workflowSha && !tooling.sourceDirty,
      'reviewed tooling changed during qualification');
    requireValue(JSON.stringify(sourceIdentity(root)) === JSON.stringify({
      sourceRevision: identity.sourceRevision, sourceTree: identity.sourceTree, sourceDirty: false,
    }), 'application source changed during qualification');
    requireValue(!(await readdir(work)).some((name) => ['upload-secret', 'proof-secret', 'fixture-secret'].includes(name)),
      'secret material remains before output staging');
    const control = await json(join(work, 'native-input.json'));
    const report = verifyNativeReport(await json(join(work, 'native-result.json')), control);
    const checks = await json(join(work, 'package-checks.json'));
    exactKeys(checks, ['bundleSha256', 'bundleSignerSha256', 'structure', 'manifest', 'resources', 'assets', 'nativeLibraries', 'apkSignatures']);
    requireValue(['structure', 'manifest', 'resources', 'assets', 'apkSignatures'].every((name) => checks[name] === true)
      && checks.nativeLibraries === 0, 'actual signed package inspection is incomplete');
    const bundle = join(work, 'recap-page-android.aab');
    requireValue(digest(await readFile(bundle)) === checks.bundleSha256
      && checks.bundleSha256 === control.bundleSha256, 'qualified bundle bytes changed after derivation');
    const publicRoot = join(work, 'public');
    await mkdir(publicRoot, { mode: 0o700 });
    const tools = await json(join(work, 'toolchain.json'));
    exactKeys(tools, ['jdk', 'gradle', 'agp', 'sdkBuildTools']);
    requireValue(/^openjdk 17[.\s]/.test(tools.jdk) && tools.gradle === '9.8.0'
      && tools.agp === '9.4.1' && tools.sdkBuildTools === '35.0.0', 'unexpected toolchain record');
    const attestation = {
      schemaVersion: 1, kind: receipt.input.mode === 'Candidate' ? 'qualified-candidate' : 'rehearsal-only',
      source: identity, workflow: { sha: receipt.context.workflowSha, path: receipt.invocation.path,
        runId: receipt.context.runId, attempt: receipt.context.attempt },
      ledgerCommit: receipt.input.ledgerSha || null,
      approval: receipt.approval, bundle: checks,
      proofSignerSha256: control.official.signerSha256, native: report,
      scope: 'Synthetic API36 payload, restart, same-byte reinstall and coexistence only; not Play signer, upgrade or physical acceptance.',
      tools: { bundletool: BUNDLETOOL, ...tools },
    };
    if (receipt.input.mode === 'Candidate') {
      await preflight({ afterApproval: true });
      requireValue(checks.bundleSignerSha256 === certificateFingerprint(process.env.ANDROID_UPLOAD_CERT_SHA256)
        && checks.bundleSignerSha256 !== control.official.signerSha256
        && checks.bundleSignerSha256 !== control.prototype.signerSha256, 'test signer cannot qualify an upload bundle');
      const recordPath = join(work, 'android-artifact.json');
      const options = { code: receipt.input.code, ledger: join(work, 'ledger.json') };
      sourceCommand(root, 'record', [bundle, recordPath], options);
      sourceCommand(root, 'verify', [bundle, recordPath], options);
      const record = await json(recordPath);
      checkRecord(record, identity);
      await verifyArtifact(bundle, record);
      attestation.artifactRecordSha256 = digest(await readFile(recordPath));
      await cp(bundle, join(publicRoot, 'recap-page-android.aab'));
      await cp(recordPath, join(publicRoot, 'android-artifact.json'));
      await cp(join(work, 'ledger.json'), join(publicRoot, 'version-codes.proposed.json'));
      await save(join(publicRoot, 'android-candidate.json'), attestation);
      await assertFiles(publicRoot, PACKET);
    } else {
      requireValue(identity.channel === 'development' && !receipt.approval && !receipt.ledger,
        'rehearsal identity may not be candidate-shaped');
      const proof = await json(join(work, 'jdk-proof.json'));
      exactKeys(proof, ['signedFixturePassed', 'fixedRejectedUnsignedEntry', 'mutantViolatedRejectionAssertion', 'verifierSha256']);
      requireValue(proof.signedFixturePassed === true && proof.fixedRejectedUnsignedEntry === true
        && proof.mutantViolatedRejectionAssertion === true && proof.verifierSha256 === await fileDigest(javaHelper()),
      'actual JDK positive/negative proof missing or verifier changed');
      attestation.jdkProof = proof;
      await save(join(publicRoot, 'android-rehearsal.json'), attestation);
      await assertFiles(publicRoot, ['android-rehearsal.json']);
    }
  } else {
    throw new CandidateError('Android candidate: expected preflight, prepare, sign, jdk-proof, inspect, native-input, native-report, assets or finish');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof CandidateError ? error.message : 'Android candidate: stage failed; no qualified output. Inspect approved inputs and integration contracts.');
    process.exitCode = 1;
  });
}
