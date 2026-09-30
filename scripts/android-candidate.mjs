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
const DERIVED_SDK_CONTEXT = 'bundletool-1.18.3-api36';
export const PACKET = ['android-artifact.json', 'android-candidate.json', 'recap-page-android.aab', 'version-codes.proposed.json'];
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const LEDGER = 'packaging/android/version-codes.json';
const SECRET_NAMES = ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_UPLOAD_STORE_PASSWORD',
  'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD'];
const VERIFIER_STAGES = new Set([
  'AAB_ARCHIVE', 'AAB_MANIFEST', 'APKS_ARCHIVE', 'SPLIT_ARCHIVE', 'SPLIT_MANIFEST',
  'BASE_APK_POLICY_MANIFEST', 'BASE_APK_BACKUP_RULES', 'BASE_APK_EXTRACTION_RULES',
  'BASE_APK_NETWORK_RULES', 'RELEASE_HARNESS_MANIFEST', 'PROTOTYPE_HARNESS_MANIFEST',
  'BASE_APK_SPLITS_XML', 'JDK_FIXTURE_ARCHIVE',
]);
const INSPECTION_STAGES = new Set([
  ...VERIFIER_STAGES, 'AAB_STRUCTURE', 'AAB_MANIFEST_DUMP', 'SPLIT_SIGNATURE',
  'SPLIT_ALIGNMENT', 'SPLIT_MANIFEST_DUMP', 'BASE_APK_BADGING', 'BASE_APK_RESOURCES_DUMP',
  'BASE_APK_BACKUP_XML_DUMP', 'BASE_APK_EXTRACTION_XML_DUMP', 'BASE_APK_NETWORK_XML_DUMP',
  'BASE_APK_DEX', 'BASE_APK_SPLITS_XML_DUMP', 'RELEASE_HARNESS_SIGNATURE', 'RELEASE_HARNESS_MANIFEST_DUMP',
  'PROTOTYPE_SIGNATURE', 'PROTOTYPE_HARNESS_SIGNATURE', 'PROTOTYPE_SUMMARY',
  'PROTOTYPE_HARNESS_MANIFEST_DUMP',
]);
const PUBLIC_VERIFIER_CODES = new Set([
  'ARCHIVE_ARGUMENTS', 'CERTIFICATE_KEY_POLICY', 'COMMAND_REQUIRED', 'DEBUGGABLE_APPLICATION',
  'EMPTY_ARCHIVE', 'INSTRUMENTATION_TARGET', 'MANIFEST_APPLICATION', 'MANIFEST_ARGUMENTS',
  'GENERATED_SPLITS_METADATA', 'GENERATED_SPLITS_RESOURCE', 'GENERATED_SPLITS_XML', 'GENERATED_SPLITS_MAPPING',
  'MANIFEST_BACKUP_NETWORK', 'MANIFEST_BROWSER_QUERY', 'MANIFEST_COMPONENTS', 'MANIFEST_KIND',
  'MANIFEST_PACKAGE', 'MANIFEST_PERMISSIONS', 'MANIFEST_POLICY_RESOURCE', 'MANIFEST_QUERIES',
  'MANIFEST_QUERY_INTENT', 'MANIFEST_QUERY_INVENTORY', 'MANIFEST_ROOT_INVENTORY', 'MANIFEST_SDK',
  'MANIFEST_TEST_COMPONENT', 'MANIFEST_VERSION', 'OUTPUT_EXISTS', 'POLICY_RESOURCE_REFERENCE',
  'NETWORK_TREE_FORMAT', 'NETWORK_TREE_BOUNDS',
  'POLICY_RESOURCE_UNRESOLVED', 'RESOURCE_POLICY_MISMATCH', 'SIGNER_ARGUMENT', 'SPLIT_COMPONENTS', 'SPLIT_IDENTITY',
  'UNEXPECTED_SIGNER', 'UNKNOWN_COMMAND', 'UNSIGNED_ENTRY', 'VERIFICATION_FAILED',
  'ZIP_CENTRAL_ENTRY', 'ZIP_CENTRAL_LENGTH', 'ZIP_DIRECTORY', 'ZIP_ENCRYPTED', 'ZIP_END',
  'ZIP_ENTRY_DISK', 'ZIP_ENTRY_LENGTH', 'ZIP_ENTRY_NAME', 'ZIP_ENTRY_SIZE', 'ZIP_ENTRY_TRAVERSAL',
  'ZIP_EXPANSION_LIMIT', 'ZIP_MULTIDISK', 'ZIP_SIZE', 'ZIP_SPECIAL_FILE',
]);
const INSPECTION_SIGNALS = new Set([
  'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGHUP', 'SIGILL', 'SIGINT', 'SIGKILL', 'SIGPIPE', 'SIGSEGV', 'SIGTERM',
]);

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
function sdkFailureShape(stderr, stage) {
  if (!['AAB_MANIFEST', 'SPLIT_MANIFEST', 'BASE_APK_POLICY_MANIFEST'].includes(stage)) return null;
  const lines = stderr.split(/\r?\n/).filter((line) => line.startsWith('SDK_SHAPE '));
  if (lines.length !== 1) return null;
  const payload = lines[0].slice('SDK_SHAPE '.length);
  if (payload.length > 256) return null;
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  const keys = ['kind', 'configSplit', 'splitOrdinal', 'usesSdkCount', 'minSdk', 'targetSdk'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).join() !== keys.join() || JSON.stringify(value) !== payload) return null;
  const apk = stage === 'SPLIT_MANIFEST';
  if (value.kind !== (apk ? 'apk' : 'app') || typeof value.configSplit !== 'boolean'
    || (apk ? !Number.isInteger(value.splitOrdinal) || value.splitOrdinal < 0 || value.splitOrdinal > 31
      : value.configSplit || value.splitOrdinal !== null)
    || !Number.isInteger(value.usesSdkCount) || value.usesSdkCount < 0 || value.usesSdkCount > 100000) return null;
  for (const token of [value.minSdk, value.targetSdk]) {
    if (typeof token !== 'string' || !/^(?:absent|invalid|0|[1-9][0-9]{0,3})$/.test(token)) return null;
  }
  return value;
}
function networkFailureShape(stderr) {
  const lines = stderr.split(/\r?\n/).filter((line) => line.startsWith('NETWORK_SHAPE '));
  if (lines.length !== 1) return null;
  const payload = lines[0].slice('NETWORK_SHAPE '.length);
  if (payload.length > 3072) return null;
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  const keys = (object, names) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).join() === names.join();
  if (!keys(value, ['expected', 'actual']) || JSON.stringify(value) !== payload) return null;
  const count = (n) => n === 'overflow' || (Number.isInteger(n) && n >= 0 && n <= 16);
  const namespace = (n) => ['none', 'android', 'other'].includes(n);
  const attributeNamespace = (n) => namespace(n) || ['absent', 'ambiguous'].includes(n);
  const boolean = (n) => ['true', 'false', 'absent', 'other'].includes(n);
  const textKind = (n) => ['empty', 'blank', 'text', 'cdata', 'mixed', 'other'].includes(n);
  const element = (node) => namespace(node.namespace) && count(node.attributes)
    && count(node.children) && textKind(node.textKind);
  const config = (node) => node === null || (keys(node,
    ['namespace', 'attributes', 'children', 'textKind', 'cleartext', 'cleartextNamespace'])
    && element(node) && boolean(node.cleartext) && attributeNamespace(node.cleartextNamespace));
  for (const tree of [value.expected, value.actual]) {
    if (!keys(tree, ['root', 'namespace', 'attributes', 'children', 'textKind', 'baseCount',
      'domainConfigCount', 'base', 'domainConfig', 'domainCount', 'domains'])
      || !['network-security-config', 'other'].includes(tree.root) || !element(tree)
      || !count(tree.baseCount) || !count(tree.domainConfigCount) || !count(tree.domainCount)
      || !config(tree.base) || !config(tree.domainConfig) || !Array.isArray(tree.domains)
      || tree.domains.length !== (tree.domainCount === 'overflow' ? 4 : Math.min(tree.domainCount, 4))
      || (tree.baseCount === 0) !== (tree.base === null)
      || (tree.domainConfigCount === 0) !== (tree.domainConfig === null)) return null;
    for (const domain of tree.domains) {
      if (!keys(domain, ['namespace', 'attributes', 'children', 'textKind', 'includeSubdomains', 'includeNamespace', 'value'])
        || !element(domain) || !boolean(domain.includeSubdomains) || !attributeNamespace(domain.includeNamespace)
        || !['loopback', 'localhost', 'absent', 'other'].includes(domain.value)) return null;
    }
  }
  return value;
}
export function execute(file, args, options = {}, inspectionStage) {
  if (inspectionStage !== undefined) {
    requireValue(INSPECTION_STAGES.has(inspectionStage), 'unknown inspection stage');
    const tool = basename(file).replace(/\.exe$/i, '');
    requireValue(!args.includes('certificate') && !['jarsigner', 'keytool'].includes(tool)
      && !(tool === 'apksigner' && args[0] === 'sign'),
    'secret-bearing commands do not support inspection diagnostics');
  }
  try {
    return execFileSync(file, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
      maxBuffer: 32 * 1024 * 1024, ...options,
    }).trim();
  } catch (error) {
    if (inspectionStage !== undefined) {
      const exit = Number.isInteger(error?.status) && error.status >= 1 && error.status <= 255 ? error.status : 'unknown';
      const signal = error?.signal == null ? 'none' : INSPECTION_SIGNALS.has(error.signal) ? error.signal : 'unrecognized';
      let code = 'unclassified';
      const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr
        : typeof error?.stderr === 'string' ? Buffer.from(error.stderr, 'utf8') : null;
      let sdk = null;
      let network = null;
      if (VERIFIER_STAGES.has(inspectionStage) && stderr && stderr.length <= 4096) {
        const last = stderr.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/).at(-1);
        if (PUBLIC_VERIFIER_CODES.has(last)) code = last;
        if (code === 'MANIFEST_SDK') sdk = sdkFailureShape(stderr.toString('utf8'), inspectionStage);
        if (code === 'RESOURCE_POLICY_MISMATCH' && inspectionStage === 'BASE_APK_NETWORK_RULES') {
          network = networkFailureShape(stderr.toString('utf8'));
        }
      }
      throw new CandidateError(`Android candidate: inspection ${inspectionStage} failed; exit=${exit}; signal=${signal}; code=${code}${sdk ? `; sdk=${JSON.stringify(sdk)}` : ''}${network ? `; network=${JSON.stringify(network)}` : ''}. Raw tool output was not retained.`);
    }
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

export async function checkAssets(extracted, generated, root, identity, stage) {
  requireValue(['AAB', 'base-APK'].includes(stage), 'unknown asset verification stage');
  const manifest = await json(join(generated, 'android-assets.json'));
  requireValue(JSON.stringify(manifest.build) === JSON.stringify(identity), `${stage} generated asset build identity mismatch`);
  const expected = new Set(['android-assets.json']);
  for (const file of manifest.files) {
    requireValue(typeof file.path === 'string' && !file.path.startsWith('/')
      && file.path.split('/').every((part) => part && part !== '.' && part !== '..')
      && !file.path.includes('\\') && !expected.has(file.path)
      && file.path !== '.recap-android-assets', `${stage} unsafe, private or duplicate asset path`);
    expected.add(file.path);
  }
  async function list(path, prefix = '') {
    const output = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      requireValue(!entry.isSymbolicLink(), `${stage} asset symlink refused`);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) output.push(...await list(join(path, entry.name), name));
      else if (entry.isFile()) output.push(name);
      else throw new CandidateError(`Android candidate: ${stage} nonregular asset refused`);
    }
    return output.sort();
  }
  const actualPaths = await list(extracted);
  const actualSet = new Set(actualPaths);
  const missing = [...expected].filter((name) => !actualSet.has(name)).sort();
  const extra = actualPaths.filter((name) => !expected.has(name));
  const describe = (names) => names.slice(0, 5).map((name) => name.length <= 160
    && /^[A-Za-z0-9_.+/-]+$/.test(name) && !name.startsWith('/')
    && name.split('/').every((part) => part && part !== '.' && part !== '..')
    ? name : '[unreportable-name]').join(', ');
  requireValue(missing.length === 0 && extra.length === 0,
    `${stage} missing or extra bundled assets: missing=${missing.length} [${describe(missing)}]; extra=${extra.length} [${describe(extra)}]`);
  for (const file of manifest.files) {
    const actual = await readFile(join(extracted, file.path));
    requireValue(digest(actual) === file.sha256 && actual.equals(await readFile(join(generated, file.path))),
      `${stage} bundled asset differs from preserved generated source`);
    if (file.source) {
      requireValue(/^(src|packaging\/android\/web)\//.test(file.source) && !file.source.includes('..'),
        `${stage} asset provenance leaves approved source`);
      requireValue(digest(await readFile(join(root, file.source))) === file.sourceSha256, `${stage} asset source hash mismatch`);
    }
  }
  requireValue((await readFile(join(extracted, 'android-assets.json'))).equals(await readFile(join(generated, 'android-assets.json'))),
    `${stage} embedded asset inventory differs from preserved output`);
  const embedded = validateIdentity(await json(join(extracted, 'build-info.json')));
  requireValue(expected.has('build-info.json') && expected.has('android-config.json')
    && JSON.stringify(embedded) === JSON.stringify(identity), `${stage} embedded build record differs from selected source identity`);
  const config = await json(join(extracted, 'android-config.json'));
  requireValue(config.origin === 'http://127.0.0.1:8787' && config.version === identity.productVersion,
    `${stage} packaged local origin or product version changed`);
  for (const forbidden of ['dev-faults.html', 'dev-faults.js', 'sw.js', 'js/app.js']) {
    requireValue(!expected.has(forbidden), `${stage} development-only asset bundled`);
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
const java = (stage, ...args) => execute('java', [javaHelper(), ...args], { env: cleanEnv() }, stage);
export function compiledNetworkShape(raw) {
  const unsupported = (reason) => ({ status: 'unsupported', reason });
  if (typeof raw !== 'string' || raw.length > 32768) return unsupported('bounds');
  if ([...raw].some((character) => {
    const code = character.codePointAt(0);
    return (code < 32 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
  })) return unsupported('control');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > 128 || lines.some((line) => line.length > 1024)) return unsupported('bounds');
  const stack = [];
  const roots = [];
  const elements = [];
  let attributeCount = 0;
  let unknownAttributes = 0;
  let textCount = 0;
  const boolean = (input) => {
    const withRaw = input.match(/^(.*) \(Raw: "(true|false)"\)$/);
    const value = withRaw ? withRaw[1] : input;
    const result = ['true', '"true"', '(boolean) true', '(type 0x12)0xffffffff', '(type 0x12)0x1'].includes(value) ? 'true'
      : ['false', '"false"', '(boolean) false', '(type 0x12)0x0'].includes(value) ? 'false' : 'other';
    return withRaw && withRaw[2] !== result ? 'other' : result;
  };
  for (const line of lines) {
    const record = line.match(/^( *)([EATC]): (.*)$/);
    if (!record) return unsupported('format');
    const [, spaces, type, body] = record;
    const indent = spaces.length;
    if (indent > 32) return unsupported('bounds');
    if (type === 'E') {
      const element = body.match(/^(\S+) \(line=[0-9]{1,9}\)$/);
      if (!element) return unsupported('format');
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      if (stack.length >= 4 || elements.length >= 32) return unsupported('bounds');
      const kind = ['network-security-config', 'base-config', 'domain-config', 'domain'].includes(element[1])
        ? element[1] : 'other';
      const node = { kind, indent, attributes: new Map(), children: [], text: [], markers: new Set() };
      if (stack.length) stack.at(-1).children.push(node);
      else roots.push(node);
      stack.push(node);
      elements.push(node);
    } else {
      const node = stack.at(-1);
      if (!node || indent <= node.indent) return unsupported('structure');
      if (type === 'A') {
        const attribute = body.match(/^([^=]+)=(.*)$/);
        if (!attribute || ++attributeCount > 64) return unsupported('bounds');
        const name = attribute[1].replace(/\(0x[0-9a-fA-F]{1,8}\)$/, '');
        if (['cleartextTrafficPermitted', 'includeSubdomains'].includes(name)) {
          const values = node.attributes.get(name) || [];
          values.push(boolean(attribute[2]));
          node.attributes.set(name, values);
        } else unknownAttributes += 1;
      } else {
        const text = body.match(/^'(.*)'$/) || body.match(/^"(.*)"$/);
        if (!text) return unsupported('format');
        if (++textCount > 16) return unsupported('bounds');
        node.text.push(text[1]);
        node.markers.add(type);
      }
    }
  }
  if (roots.length !== 1) return unsupported('structure');
  const root = roots[0];
  const bases = root.children.filter((node) => node.kind === 'base-config');
  const configs = root.children.filter((node) => node.kind === 'domain-config');
  const domains = configs[0]?.children.filter((node) => node.kind === 'domain') || [];
  if (domains.length > 4) return unsupported('bounds');
  const flag = (node, name) => {
    const values = node?.attributes.get(name) || [];
    return values.length === 0 ? 'absent' : values.length === 1 ? values[0] : 'other';
  };
  return {
    status: 'observed', root: root.kind === 'network-security-config' ? root.kind : 'other',
    elementCount: elements.length, baseConfigCount: bases.length, domainConfigCount: configs.length,
    otherElements: elements.filter((node) => node.kind === 'other').length, unknownAttributes,
    baseCleartext: flag(bases[0], 'cleartextTrafficPermitted'),
    domainCleartext: flag(configs[0], 'cleartextTrafficPermitted'), domainCount: domains.length,
    domains: domains.map((node) => {
      const text = node.text.join('').trim();
      return { includeSubdomains: flag(node, 'includeSubdomains'), textRecords: node.text.length,
        textKind: node.markers.size === 0 ? 'absent' : node.markers.size === 1 ? [...node.markers][0] : 'mixed',
        value: text === '' ? 'absent' : text === '127.0.0.1' ? 'loopback' : text === 'localhost' ? 'localhost' : 'other' };
    }),
  };
}
export async function verifyPolicyResource(stage, decoded, expected, apk, work) {
  if (stage !== 'BASE_APK_NETWORK_RULES') return java(stage, 'resource', decoded, expected);
  let raw;
  const path = join(work, 'network-compiled-tree.raw.txt');
  try {
    raw = execFileSync(sdkTool('aapt2'),
      ['dump', 'xmltree', '--file', 'res/xml/network_security_config.xml', apk],
      { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 128 * 1024 });
    await writeFile(path, raw, { mode: 0o600, flag: 'wx' });
  } catch {
    throw new CandidateError('Android candidate: authoritative compiled network read failed; raw tool output was not retained.');
  }
  try {
    return java(stage, 'network-resource', path, expected);
  } catch (error) {
    if (!(error instanceof CandidateError)
      || !error.message.startsWith('Android candidate: inspection BASE_APK_NETWORK_RULES failed;')
      || !/; code=RESOURCE_POLICY_MISMATCH(?:; network=|\. Raw tool output was not retained\.$)/.test(error.message)) throw error;
    const observation = compiledNetworkShape(raw.toString('utf8'));
    throw new CandidateError(`${error.message} Compiled network observer: ${JSON.stringify(observation)}`);
  }
}
function sdkTool(name) {
  requireValue(process.env.ANDROID_HOME, 'Android SDK location required');
  return name === 'apkanalyzer'
    ? join(process.env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', name)
    : join(process.env.ANDROID_HOME, 'build-tools', '35.0.0', name);
}
const bundletool = (stage, work, ...args) => execute('java', ['-jar', join(work, 'bundletool.jar'), ...args], { env: cleanEnv() }, stage);
export function derivedSdkContext(toolSha256, device) {
  exactKeys(device, ['sdkVersion', 'screenDensity', 'supportedAbis', 'supportedLocales']);
  requireValue(BUNDLETOOL.version === '1.18.3' && toolSha256 === BUNDLETOOL.sha256
    && device.sdkVersion === 36 && device.screenDensity === 420
    && JSON.stringify(device.supportedAbis) === '["x86_64"]'
    && JSON.stringify(device.supportedLocales) === '["en-US"]',
  'derived SDK context requires the reviewed bundletool hash and exact API36 proof profile');
  return DERIVED_SDK_CONTEXT;
}
export function noNative(files) {
  requireValue(files.every((file) => !file.elf && !/^(?:[^/]+\/)?lib\//.test(file.name) && !file.name.endsWith('.so')),
    'unexpected native library; scoped ABI/16 KB reassessment required');
}
export function assertCodeFreeConfig(files) {
  requireValue(files.every((file) => !/^classes(?:[0-9]+)?\.dex$/.test(file.name)),
    'configuration APK must not contain DEX code');
}
export function assertGeneratedSplitsSource(files, directories) {
  requireValue(!files.some((file) => file.name === 'base/res/xml/splits0.xml'),
    'generated splits0 resource collision with the publishing source');
  const supported = new Set(['xml', 'values', 'values-v27', 'values-night', 'values-night-v27']);
  requireValue(directories.includes('xml') && directories.includes('values')
    && directories.every((name) => supported.has(name)), 'generated splits XML requires the reviewed non-localized resource profile');
}
function apkCertificate(path, stage) {
  const result = execute(sdkTool('apksigner'), ['verify', '--verbose', '--print-certs', path], { env: cleanEnv() }, stage);
  const matches = [...result.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9:]+)$/gm)];
  requireValue(matches.length === 1, 'APK needs exactly one verified signer');
  return certificateFingerprint(matches[0][1]);
}

async function inspectPackages(work, root) {
  const version = await json(join(work, 'version.json'));
  const signer = await json(join(work, 'signer.json'));
  const bundle = join(work, 'recap-page-android.aab');
  const derivedContext = derivedSdkContext(await fileDigest(join(work, 'bundletool.jar')),
    await json(join(work, 'device-spec.json')));
  const before = await fileDigest(bundle);
  bundletool('AAB_STRUCTURE', work, 'validate', `--bundle=${bundle}`);
  const inventory = JSON.parse(java('AAB_ARCHIVE', 'archive', bundle, certificateFingerprint(signer.sha256), join(work, 'bundle')));
  noNative(inventory.files);
  const resourceDirectories = await readdir(join(root, 'packaging', 'android', 'app', 'src', 'main', 'res'), { withFileTypes: true });
  requireValue(resourceDirectories.every((entry) => entry.isDirectory() && !entry.isSymbolicLink()),
    'generated splits source resource directories must be regular');
  assertGeneratedSplitsSource(inventory.files, resourceDirectories.map((entry) => entry.name));
  requireValue(inventory.files.every((file) => /^(base\/|META-INF\/|BUNDLE-METADATA\/|BundleConfig\.pb$)/.test(file.name))
    && inventory.files.some((file) => file.name === 'base/manifest/AndroidManifest.xml'), 'unexpected or missing bundle module');
  const bundleManifest = join(work, 'bundle-manifest.xml');
  await writeFile(bundleManifest, bundletool('AAB_MANIFEST_DUMP', work, 'dump', 'manifest', `--bundle=${bundle}`, '--module=base'));
  java('AAB_MANIFEST', 'manifest', bundleManifest, OFFICIAL_ID, String(version.versionCode), version.versionName, 'app', 'publishing');
  await checkAssets(join(work, 'bundle', 'base', 'assets', 'recap'), join(work, 'generated'), root, version.identity, 'AAB');
  console.log('Android candidate: AAB public asset checks passed.');
  const apks = JSON.parse(java('APKS_ARCHIVE', 'archive', join(work, 'derived.apks'), '-', join(work, 'apks')));
  const splits = apks.files.filter((file) => file.name.endsWith('.apk'));
  requireValue(splits.length > 0 && splits.length <= 32
    && splits.every((file) => file.name.startsWith('splits/')), 'expected one bounded device-specific split set');
  const proof = certificateFingerprint((await json(join(work, 'proof-signer.json'))).sha256);
  requireValue(proof !== signer.sha256, 'bundle and disposable install signer roles must differ');
  let baseCount = 0;
  let baseManifestPath;
  const splitManifestPaths = [];
  for (const [index, split] of splits.entries()) {
    const path = join(work, 'apks', split.name);
    requireValue(apkCertificate(path, 'SPLIT_SIGNATURE') === proof, 'derived split signer mismatch');
    execute(sdkTool('zipalign'), ['-c', '-P', '16', '4', path], { env: cleanEnv() }, 'SPLIT_ALIGNMENT');
    const extracted = join(work, `split-${index}`);
    const contents = JSON.parse(java('SPLIT_ARCHIVE', 'archive', path, '-', extracted));
    noNative(contents.files);
    const xmlPath = join(work, `split-${index}.xml`);
    splitManifestPaths.push(xmlPath);
    const manifest = execute(sdkTool('apkanalyzer'), ['manifest', 'print', path], { env: cleanEnv() }, 'SPLIT_MANIFEST_DUMP');
    await writeFile(xmlPath, manifest);
    java('SPLIT_MANIFEST', 'manifest', xmlPath, OFFICIAL_ID, String(version.versionCode), version.versionName, 'apk', derivedContext, `--split-ordinal=${index}`);
    if (contents.files.some((file) => file.name === 'assets/recap/build-info.json')) {
      baseCount += 1;
      baseManifestPath = xmlPath;
      await checkAssets(join(extracted, 'assets', 'recap'), join(work, 'generated'), root, version.identity, 'base-APK');
      console.log('Android candidate: base-APK public asset checks passed.');
      const badging = execute(sdkTool('aapt2'), ['dump', 'badging', path], { env: cleanEnv() }, 'BASE_APK_BADGING');
      requireValue(/^application-label:'Recap Page'$/m.test(badging), 'resolved application label mismatch');
      const resources = execute(sdkTool('aapt2'), ['dump', 'resources', path], { env: cleanEnv() }, 'BASE_APK_RESOURCES_DUMP');
      await writeFile(join(work, 'resources.txt'), resources);
      java('BASE_APK_POLICY_MANIFEST', 'manifest', xmlPath, OFFICIAL_ID, String(version.versionCode), version.versionName,
        'app', derivedContext, join(work, 'resources.txt'));
      for (const [name, dumpStage, verifyStage] of [
        ['backup_rules', 'BASE_APK_BACKUP_XML_DUMP', 'BASE_APK_BACKUP_RULES'],
        ['data_extraction_rules', 'BASE_APK_EXTRACTION_XML_DUMP', 'BASE_APK_EXTRACTION_RULES'],
        ['network_security_config', 'BASE_APK_NETWORK_XML_DUMP', 'BASE_APK_NETWORK_RULES'],
      ]) {
        const decoded = join(work, `${name}.xml`);
        if (verifyStage !== 'BASE_APK_NETWORK_RULES') {
          await writeFile(decoded, execute(sdkTool('apkanalyzer'),
            ['resources', 'xml', '--file', `/res/xml/${name}.xml`, path], { env: cleanEnv() }, dumpStage));
        }
        await verifyPolicyResource(verifyStage, decoded,
          join(root, 'packaging', 'android', 'app', 'src', 'main', 'res', 'xml', `${name}.xml`), path, work);
      }
      requireValue(contents.files.some((file) => file.name === 'res/xml/splits0.xml'),
        'derived base is missing its generated splits XML resource');
      await writeFile(join(work, 'splits0.xml'), execute(sdkTool('apkanalyzer'),
        ['resources', 'xml', '--file', '/res/xml/splits0.xml', path], { env: cleanEnv() }, 'BASE_APK_SPLITS_XML_DUMP'));
      const dex = execute(sdkTool('apkanalyzer'), ['dex', 'packages', '--defined-only', path], { env: cleanEnv() }, 'BASE_APK_DEX');
      const symbols = dex.split(/\r?\n/).map((line) => line.trim().split(/\s+/).at(-1))
        .filter((name) => name && /^[A-Za-z_$][\w.$]*$/.test(name));
      requireValue(symbols.some((name) => name.includes('MainActivity'))
        && symbols.every((name) => name === '<TOTAL>' || name === 'name' || PROTOTYPE_ID.startsWith(`${name}.`)
          || name === PROTOTYPE_ID || name.startsWith(`${PROTOTYPE_ID}.`))
        && !/NativeIntegrationTest|FixtureDocumentProvider|FixtureMetadataServer|androidx\./.test(dex),
      'unexpected shipped DEX class or test/runtime dependency');
    } else {
      assertCodeFreeConfig(contents.files);
    }
  }
  requireValue(baseCount === 1, 'exactly one derived base APK must carry the source assets');
  java('BASE_APK_SPLITS_XML', 'generated-splits', baseManifestPath, String(version.versionCode), version.versionName,
    join(work, 'resources.txt'), join(work, 'splits0.xml'), ...splitManifestPaths);
  const harness = join(work, 'release-test.apk');
  requireValue(apkCertificate(harness, 'RELEASE_HARNESS_SIGNATURE') === proof, 'release harness and derived split signers must match');
  const harnessXml = join(work, 'harness.xml');
  await writeFile(harnessXml, execute(sdkTool('apkanalyzer'), ['manifest', 'print', harness], { env: cleanEnv() }, 'RELEASE_HARNESS_MANIFEST_DUMP'));
  java('RELEASE_HARNESS_MANIFEST', 'manifest', harnessXml, `${OFFICIAL_ID}.test`, String(version.versionCode), version.versionName, 'test', 'publishing');
  const prototype = join(work, 'prototype.apk');
  const prototypeHarness = join(work, 'prototype-test.apk');
  const debugSigner = apkCertificate(prototype, 'PROTOTYPE_SIGNATURE');
  requireValue(apkCertificate(prototypeHarness, 'PROTOTYPE_HARNESS_SIGNATURE') === debugSigner, 'prototype harness signer mismatch');
  const summary = execute(sdkTool('apkanalyzer'), ['apk', 'summary', prototype], { env: cleanEnv() }, 'PROTOTYPE_SUMMARY').split(/\s+/);
  requireValue(summary.length === 3 && summary[0] === PROTOTYPE_ID && summary[1] === String(DEVELOPMENT_ANDROID_CODE)
    && summary[2] === `${version.identity.productVersion}-dev.${version.identity.sourceRevision.slice(0, 8)}`,
  'prototype coexistence control must retain its clean development identity');
  const prototypeHarnessXml = join(work, 'prototype-harness.xml');
  await writeFile(prototypeHarnessXml, execute(sdkTool('apkanalyzer'), ['manifest', 'print', prototypeHarness], { env: cleanEnv() }, 'PROTOTYPE_HARNESS_MANIFEST_DUMP'));
  java('PROTOTYPE_HARNESS_MANIFEST', 'manifest', prototypeHarnessXml, `${PROTOTYPE_ID}.test`, summary[1], summary[2], 'test', 'publishing');
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
    const networkSource = join(scratch, 'network-policy.xml');
    await writeFile(networkSource, '<network-security-config><base-config cleartextTrafficPermitted="false"/>'
      + '<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain>'
      + '<domain includeSubdomains="false">localhost</domain></domain-config></network-security-config>');
    const networkTree = [
      'E: network-security-config (line=2)',
      '    E: base-config (line=3)', '      A: cleartextTrafficPermitted=false',
      '    E: domain-config (line=4)', '      A: cleartextTrafficPermitted="true" (Raw: "true")',
      '        E: domain (line=5)', '          A: includeSubdomains=false', "            T: '127.0.0.1'",
      '        E: domain (line=6)', '          A: includeSubdomains="false" (Raw: "false")', "            C: 'localhost'",
    ].join('\n') + '\n';
    const annotatedNetwork = networkTree.replaceAll('cleartextTrafficPermitted', 'cleartextTrafficPermitted(0x00000000)')
      .replaceAll('includeSubdomains', 'includeSubdomains(0x00000000)');
    const networkFixtures = [
      [networkTree, null],
      [networkTree.replace('127.0.0.1', 'example.invalid'), 'RESOURCE_POLICY_MISMATCH'],
      [networkTree.replace("            T: '127.0.0.1'\n", ''), 'RESOURCE_POLICY_MISMATCH'],
      [networkTree.replace('cleartextTrafficPermitted=false', 'cleartextTrafficPermitted=true')
        .replace('cleartextTrafficPermitted="true" (Raw: "true")', 'cleartextTrafficPermitted=false')
        .replace('includeSubdomains=false', 'includeSubdomains=true'), 'RESOURCE_POLICY_MISMATCH'],
      [networkTree.replace('      A: cleartextTrafficPermitted=false',
        '      A: cleartextTrafficPermitted=false\n      A: unexpected="private"'), 'NETWORK_TREE_FORMAT'],
      [networkTree + "        E: domain (line=7)\n          A: includeSubdomains=false\n            T: 'example.invalid'\n", 'RESOURCE_POLICY_MISMATCH'],
      ['N: unsupported=urn:unsupported (line=1)\n' + networkTree, 'NETWORK_TREE_FORMAT'],
      [networkTree.replace("T: '127.0.0.1'", "T: '127.0.0.1"), 'NETWORK_TREE_FORMAT'],
      [annotatedNetwork, null],
      [annotatedNetwork.replace('(0x00000000)', '(0xNOPE)'), 'NETWORK_TREE_FORMAT'],
    ];
    for (const [index, [tree, code]] of networkFixtures.entries()) {
      const fixture = join(scratch, `network-tree-${index}.txt`);
      await writeFile(fixture, tree);
      let rejected = false;
      try {
        java('BASE_APK_NETWORK_RULES', 'network-resource', fixture, networkSource);
      } catch (error) {
        const prefix = `Android candidate: inspection BASE_APK_NETWORK_RULES failed; exit=1; signal=none; code=${code}`;
        requireValue(code && error instanceof CandidateError
          && (error.message === `${prefix}. Raw tool output was not retained.`
            || (code === 'RESOURCE_POLICY_MISMATCH' && error.message.startsWith(`${prefix}; network=`))),
        `JDK network policy fixture ${index} failed for an unexpected reason`);
        rejected = true;
      }
      requireValue(rejected === (code !== null), `JDK network policy fixture ${index} changed acceptance`);
    }
    console.log(`Android candidate: JDK text-preserving network policy fixtures passed (${networkFixtures.length} cases).`);
    const resourceTable = join(scratch, 'reference-resources.txt');
    const splitsXml = join(scratch, 'reference-splits0.xml');
    await writeFile(resourceTable, 'resource 0x7f120000 xml/backup_rules\nresource 0x7f120001 xml/data_extraction_rules\n'
      + 'resource 0x7f120002 xml/network_security_config\nresource 0x7f120003 xml/splits0\n  () (file) res/xml/splits0.xml type=XML\n');
    await writeFile(splitsXml, '<splits/>');
    const referenceFixtures = [
      { refs: ['@ref/0x7f120000', '@ref/0x7f120001', '@ref/0x7f120002', '@ref/0x7f120003'], rejected: false },
      { refs: ['@ref/0x7f120099', '@ref/0x7f120001', '@ref/0x7f120002', '@ref/0x7f120003'], rejected: true },
      { refs: ['@other/0x7f120000', '@ref/0x7f120001', '@ref/0x7f120002', '@ref/0x7f120003'], rejected: true },
      { refs: ['@ref/0x7f120000junk', '@ref/0x7f120001', '@ref/0x7f120002', '@ref/0x7f120003'], rejected: true },
      { refs: ['@xml/backup_rules', '@0x7f120001', '@7f120002', '@xml/splits0'], rejected: false },
    ];
    for (const [index, fixture] of referenceFixtures.entries()) {
      const manifest = join(scratch, `reference-${index}.xml`);
      await writeFile(manifest, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${OFFICIAL_ID}" android:versionCode="3000002" android:versionName="3.1.0">`
        + '<uses-sdk android:minSdkVersion="32" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.INTERNET"/>'
        + '<queries><intent><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https"/></intent></queries>'
        + `<application android:allowBackup="false" android:usesCleartextTraffic="false" android:fullBackupContent="${fixture.refs[0]}" android:dataExtractionRules="${fixture.refs[1]}" android:networkSecurityConfig="${fixture.refs[2]}">`
        + `<activity android:name="${PROTOTYPE_ID}.MainActivity" android:exported="true"/>`
        + `<meta-data android:name="com.android.vending.splits" android:resource="${fixture.refs[3]}"/></application></manifest>`);
      let rejected = false;
      try {
        java('BASE_APK_SPLITS_XML', 'generated-splits', manifest, '3000002', '3.1.0', resourceTable, splitsXml, manifest);
      } catch (error) {
        requireValue(error instanceof CandidateError
          && error.message === 'Android candidate: inspection BASE_APK_SPLITS_XML failed; exit=1; signal=none; code=POLICY_RESOURCE_REFERENCE. Raw tool output was not retained.',
        'JDK resource-reference fixture failed for an unexpected reason');
        rejected = true;
      }
      requireValue(rejected === fixture.rejected, 'JDK exact resource-reference fixture changed acceptance');
    }
    console.log('Android candidate: JDK exact XML-resource reference fixtures passed.');
    const sdkFixtures = [
      { min: '21', target: '', minToken: '21', targetToken: 'absent' },
      { min: 'PRIVATE_VALUE_/private/keystore.p12', target: ' android:targetSdkVersion="36&#9;"', minToken: 'invalid', targetToken: 'invalid' },
    ];
    for (const [ordinal, fixture] of sdkFixtures.entries()) {
      const manifest = join(scratch, `sdk-shape-${ordinal}.xml`);
      await writeFile(manifest, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${OFFICIAL_ID}" android:versionCode="3000002" split="config.fixture"><uses-sdk android:minSdkVersion="${fixture.min}"${fixture.target}/><application/></manifest>`);
      const projection = { kind: 'apk', configSplit: true, splitOrdinal: ordinal, usesSdkCount: 1,
        minSdk: fixture.minToken, targetSdk: fixture.targetToken };
      let rejected = false;
      try {
        java('SPLIT_MANIFEST', 'manifest', manifest, OFFICIAL_ID, '3000002', '3.1.0', 'apk', 'publishing', `--split-ordinal=${ordinal}`);
      } catch (error) {
        rejected = error instanceof CandidateError
          && error.message === `Android candidate: inspection SPLIT_MANIFEST failed; exit=1; signal=none; code=MANIFEST_SDK; sdk=${JSON.stringify(projection)}. Raw tool output was not retained.`;
      }
      requireValue(rejected, 'JDK SDK-shape fixture must fail with only the validated public projection');
    }
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
    java('JDK_FIXTURE_ARCHIVE', 'archive', jar, cert.sha256, join(scratch, 'positive'));
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
      join(work, 'generated'), root, identity, 'AAB'));
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
      scope: 'Publishing AAB minSdk26/targetSdk36; tested bundletool1.18.3/API36 base minSdk32/targetSdk36; any base-module config split requires minSdk32/targetSdk absent. Synthetic payload, restart, same-byte reinstall and coexistence only; not API26 runtime, Play signer, upgrade or physical acceptance.',
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
