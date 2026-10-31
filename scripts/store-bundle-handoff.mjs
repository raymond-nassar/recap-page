import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { releaseCloudInput } from './release-cloud-client.mjs';

export const WORKFLOW = '.github/workflows/store-bundle-handoff.yml';
export const BUNDLE = 'RecapPage_4.3.0.0_x64_arm64.msixbundle';
export const RECEIPT = 'store-bundle-handoff.json';
const REPOSITORY = 'raymond-nassar/recap-page';
const RECIPIENT = 'repository-owner-partner-center';
const PUBLISHER = 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472';
const NAME = 'PanelStackLabs.RecapPage';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const ARCHITECTURES = ['x64', 'arm64'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function demand(value, reason) {
  if (!value) throw new Error(`Store handoff: ${reason}.`);
}
function same(actual, expected, reason) {
  demand(isDeepStrictEqual(actual, expected), reason);
}
function keys(value, names) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'record required');
  same(Object.keys(value).sort(), [...names].sort(), 'record fields differ');
}
function json(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/, ''));
}
function write(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function regular(path) {
  const stat = lstatSync(path);
  demand(stat.isFile() && !stat.isSymbolicLink(), 'regular file required');
  const bytes = readFileSync(path);
  demand(bytes.length > 0, 'empty artifact');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

export function selection(env) {
  demand(SHA.test(env.SOURCE_SHA) && SHA.test(env.SOURCE_TREE)
    && SHA.test(env.REVIEWED_WORKFLOW_SHA), 'explicit immutable selections required');
  demand(env.GITHUB_REPOSITORY === REPOSITORY && env.DEFAULT_BRANCH === 'main'
    && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`
    && env.REVIEWED_WORKFLOW_SHA === env.GITHUB_WORKFLOW_SHA
    && env.REVIEWED_WORKFLOW_SHA === env.GITHUB_SHA, 'workflow selection differs');
  demand(env.HANDOFF_RECIPIENT === RECIPIENT
    && env.BUILD_APPROVED === 'true' && env.TRANSFER_APPROVED === 'true',
  'separate scoped build and transfer approvals required');
  demand(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID)
    && /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT), 'run identity differs');
  return {
    source: { commit: env.SOURCE_SHA, tree: env.SOURCE_TREE, productVersion: '4.3.0', storeVersion: '4.3.0.0' },
    workflow: { commit: env.REVIEWED_WORKFLOW_SHA, path: WORKFLOW,
      runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT },
    target: { recipient: RECIPIENT, storeId: '9PDJ7XR9Q40Q', purpose: 'owner-upload-only',
      buildApproved: true, transferApproved: true, submitAuthorized: false },
  };
}

export function observe(application, tooling, env = process.env) {
  const chosen = selection(env);
  for (const [root, commit, tree] of [
    [application, chosen.source.commit, chosen.source.tree], [tooling, chosen.workflow.commit, null],
  ]) {
    demand(git(root, ['rev-parse', 'HEAD']) === commit, 'checkout commit differs');
    if (tree) demand(git(root, ['rev-parse', 'HEAD^{tree}']) === tree, 'checkout tree differs');
    demand(git(root, ['status', '--porcelain=v1', '--untracked-files=no']) === ''
      && git(root, ['ls-files', '--others', '--exclude-standard', '--', 'src', 'scripts', 'host', 'packaging']) === '',
    'source is dirty');
    git(root, ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  }
  demand(json(join(application, 'package.json')).version === '4.3.0'
    && json(join(application, 'package-lock.json')).version === '4.3.0'
    && /export const APP_VERSION = '4\.3\.0';/.test(readFileSync(join(application, 'src', 'js', 'lib', 'version.js'), 'utf8')),
  'selected product version differs');
  const workflowBytes = execFileSync('git', ['show', `${chosen.workflow.commit}:${WORKFLOW}`],
    { cwd: tooling, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    ...chosen,
    workflow: { ...chosen.workflow, tree: git(tooling, ['rev-parse', 'HEAD^{tree}']),
      blobSha256: sha256(workflowBytes) },
  };
}

export function validateWack(value) {
  keys(value, ['overall', 'partial', 'latest', 'disposition']);
  demand(['FALSE', 'NOT REPORTED'].includes(value.partial)
    && ['TRUE', 'NOT REPORTED'].includes(value.latest)
    && ((value.overall === 'PASS' && ['PASS', 'PASS WITH OPTIONAL WARNINGS'].includes(value.disposition))
      || (value.overall === 'WARNING' && value.disposition === 'PASS WITH OPTIONAL WARNINGS')),
  'unqualified WACK');
  return value;
}

export function wackSummary(text, label, expected) {
  function field(name) {
    const prefix = `${label} ${name}: `;
    const lines = text.split(/\r?\n/).filter((line) => line.startsWith(prefix));
    demand(lines.length === 1, 'missing or duplicate WACK field');
    return lines[0].slice(prefix.length);
  }
  demand(field('SHA-256').toLowerCase() === expected, 'WACK hash differs');
  return validateWack({ overall: field('overall result'), partial: field('partial run'),
    latest: field('latest WACK'), disposition: field('disposition') });
}

export function inspectionSummary(report, digest) {
  demand(typeof digest === 'string' && HASH.test(digest), 'protected configuration digest required');
  demand(report.nodeVersion === 'v24.19.0' && report.packages.length === 2
    && report.bundle.packageCount === 2 && report.bundle.packages.length === 2,
  'inspection population differs');
  const entries = [...report.packages, report.proofUpdate, ...report.bundle.packages];
  for (const [index, entry] of entries.entries()) {
    const proof = index === 2;
    const architecture = proof ? 'x64' : ARCHITECTURES[index < 2 ? index : index - 3];
    same(entry.identity, { name: NAME, publisher: PUBLISHER, version: proof ? '4.3.0.1' : '4.3.0.0', architecture },
      'inspected package identity differs');
    demand((index >= 3 || entry.file === `RecapPage_${entry.identity.version}_${architecture}.msix`)
      && entry.signed === true && !Object.hasOwn(entry, 'runtimeProcess')
      && typeof entry.sha256 === 'string' && HASH.test(entry.sha256), 'package qualification differs');
    demand(entry.cloudClient === digest, 'package configuration differs from protected input');
  }
  same(report.bundle.identity, { name: NAME, publisher: PUBLISHER, version: '4.3.0.0' }, 'bundle identity differs');
  demand(report.bundle.file === BUNDLE && report.bundle.signed === true
    && typeof report.bundle.sha256 === 'string' && HASH.test(report.bundle.sha256), 'bundle qualification differs');
  return {
    structuralPassed: true, signed: true, proofVersionExcluded: true, configurationSha256: digest,
    bundleSha256: report.bundle.sha256,
    packages: entries.slice(0, 3).map((entry) => ({ file: entry.file, sha256: entry.sha256 })),
  };
}

export function validateReceipt(receipt, binding) {
  keys(receipt, ['schemaVersion', 'repository', 'source', 'workflow', 'target', 'configurationSha256',
    'bundle', 'inspection', 'wack', 'retention']);
  demand(receipt.schemaVersion === 1 && receipt.repository === REPOSITORY, 'receipt format differs');
  for (const field of ['source', 'workflow', 'target']) same(receipt[field], binding[field], 'receipt binding differs');
  demand(typeof receipt.configurationSha256 === 'string' && HASH.test(receipt.configurationSha256),
    'receipt configuration digest required');
  keys(receipt.bundle, ['file', 'bytes', 'sha256']);
  demand(receipt.bundle.file === BUNDLE && Number.isSafeInteger(receipt.bundle.bytes)
    && receipt.bundle.bytes > 0 && typeof receipt.bundle.sha256 === 'string'
    && HASH.test(receipt.bundle.sha256), 'receipt bundle differs');
  same(receipt.inspection, { structuralPassed: true, signed: true, proofVersionExcluded: true,
    configurationMatchedProtectedInput: true, packagesChecked: 5 }, 'receipt inspection differs');
  keys(receipt.wack, ['x64', 'bundle']);
  validateWack(receipt.wack.x64);
  validateWack(receipt.wack.bundle);
  same(receipt.retention, { days: 1, plaintext: true, temporary: true }, 'receipt retention differs');
  return receipt;
}

export function stageHandoff({ stage, bundle, binding, inspection, wack, expectedDigest }) {
  demand(inspection.configurationSha256 === expectedDigest && HASH.test(expectedDigest),
    'qualification configuration differs');
  const artifact = regular(bundle);
  demand(artifact.sha256 === inspection.bundleSha256, 'qualified bundle changed');
  const receipt = validateReceipt({
    schemaVersion: 1, repository: REPOSITORY, ...binding, configurationSha256: expectedDigest,
    bundle: { file: BUNDLE, ...artifact },
    inspection: { structuralPassed: true, signed: true, proofVersionExcluded: true,
      configurationMatchedProtectedInput: true, packagesChecked: 5 },
    wack: { x64: wackSummary(wack, 'x64 package', inspection.packages[0].sha256),
      bundle: wackSummary(wack, 'x64 ARM64 bundle', artifact.sha256) },
    retention: { days: 1, plaintext: true, temporary: true },
  }, binding);
  mkdirSync(stage);
  copyFileSync(bundle, join(stage, BUNDLE), constants.COPYFILE_EXCL);
  same(regular(join(stage, BUNDLE)), artifact, 'staged bundle changed');
  write(join(stage, RECEIPT), receipt);
  return regular(join(stage, RECEIPT)).sha256;
}

export function preflight(stage, binding, receiptHash) {
  demand(typeof receiptHash === 'string' && HASH.test(receiptHash), 'qualification receipt digest required');
  same(readdirSync(stage).sort(), [BUNDLE, RECEIPT].sort(), 'handoff file allowlist differs');
  demand(regular(join(stage, RECEIPT)).sha256 === receiptHash, 'qualified receipt changed');
  const receipt = validateReceipt(json(join(stage, RECEIPT)), binding);
  same(regular(join(stage, BUNDLE)), { bytes: receipt.bundle.bytes, sha256: receipt.bundle.sha256 },
    'upload bundle changed');
}

function main() {
  const env = process.env;
  const application = join(env.GITHUB_WORKSPACE, 'application');
  const tooling = join(env.GITHUB_WORKSPACE, 'tooling');
  const scratch = join(env.HANDOFF_ROOT, 'scratch');
  const stage = join(env.HANDOFF_ROOT, 'stage');
  const binding = observe(application, tooling, env);
  const mode = process.argv[2];
  if (mode === 'bind') {
    mkdirSync(scratch, { recursive: true });
    write(join(scratch, 'binding.json'), binding);
    appendFileSync(env.GITHUB_ENV, `TEMP=${scratch}\nTMP=${scratch}\nNUGET_PACKAGES=${join(scratch, 'nuget')}\nnpm_config_cache=${join(scratch, 'npm')}\n`);
    return;
  }
  if (mode === 'preflight') {
    preflight(stage, binding, env.RECEIPT_SHA256);
    console.log(`Store handoff receipt SHA-256: ${env.RECEIPT_SHA256}`);
    return;
  }
  same(binding, json(join(scratch, 'binding.json')), 'sources changed during qualification');
  if (mode === 'configuration') {
    write(join(scratch, 'configuration.json'), { sha256: releaseCloudInput(env.RECAP_ONEDRIVE_CLIENT_ID).digest });
  } else if (mode === 'inspect') {
    const text = readFileSync(join(scratch, 'inspection.txt'), 'utf8').replace(/^\ufeff/, '');
    const start = text.search(/^\{\r?$/m);
    demand(start >= 0, 'inspection report missing');
    const inspection = inspectionSummary(JSON.parse(text.slice(start)), json(join(scratch, 'configuration.json')).sha256);
    const msix = join(application, 'dist', 'msix');
    demand(regular(join(msix, BUNDLE)).sha256 === inspection.bundleSha256, 'inspected bundle changed');
    for (const entry of inspection.packages.slice(0, 3)) {
      demand(regular(join(msix, entry.file)).sha256 === entry.sha256, 'inspected standalone changed');
    }
    write(join(scratch, 'qualification.json'), inspection);
  } else if (mode === 'stage') {
    const receiptHash = stageHandoff({
      stage, bundle: join(application, 'dist', 'msix', BUNDLE), binding,
      inspection: json(join(scratch, 'qualification.json')),
      expectedDigest: json(join(scratch, 'configuration.json')).sha256,
      wack: readFileSync(join(scratch, 'wack.txt'), 'utf8').replace(/^\ufeff/, ''),
    });
    preflight(stage, binding, receiptHash);
    appendFileSync(env.GITHUB_OUTPUT, `receipt_sha256=${receiptHash}\n`);
  } else {
    throw new Error('Store handoff: unsupported operation.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch {
    console.error('Store handoff failed closed; no qualified transfer. Check the reviewed inputs and qualification steps.');
    process.exitCode = 1;
  }
}
