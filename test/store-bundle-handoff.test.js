import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLE, RECEIPT, WORKFLOW, selection, observe, inspectionSummary, wackSummary,
  stageHandoff, preflight, validateReceipt,
} from '../scripts/store-bundle-handoff.mjs';
import { releaseCloudInput } from '../scripts/release-cloud-client.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = releaseCloudInput('synthetic-client.recap-page').digest;
const bundleBytes = Buffer.from('synthetic qualified bundle');
const bundleHash = hash(bundleBytes);
const workflow = readFileSync(new URL('../.github/workflows/store-bundle-handoff.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const env = {
  SOURCE_SHA: 'a'.repeat(40), SOURCE_TREE: 'b'.repeat(40), REVIEWED_WORKFLOW_SHA: 'c'.repeat(40),
  GITHUB_REPOSITORY: 'raymond-nassar/recap-page', DEFAULT_BRANCH: 'main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `raymond-nassar/recap-page/${WORKFLOW}@refs/heads/main`,
  GITHUB_SHA: 'c'.repeat(40), GITHUB_WORKFLOW_SHA: 'c'.repeat(40),
  HANDOFF_RECIPIENT: 'repository-owner-partner-center', BUILD_APPROVED: 'true', TRANSFER_APPROVED: 'true',
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
};
function binding() {
  const chosen = selection(env);
  return { ...chosen, workflow: { ...chosen.workflow, tree: 'd'.repeat(40), blobSha256: 'e'.repeat(64) } };
}
function fixture() {
  const entry = (architecture, proof = false) => ({
    file: `RecapPage_${proof ? '4.3.0.1' : '4.3.0.0'}_${architecture}.msix`,
    identity: { name: 'PanelStackLabs.RecapPage',
      publisher: 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472',
      version: proof ? '4.3.0.1' : '4.3.0.0', architecture },
    signed: true, sha256: 'f'.repeat(64), cloudClient: digest,
  });
  return { nodeVersion: 'v24.19.0', packages: ['x64', 'arm64'].map((a) => entry(a)),
    proofUpdate: entry('x64', true), bundle: { file: BUNDLE, signed: true,
      sha256: bundleHash, packageCount: 2,
      identity: { name: 'PanelStackLabs.RecapPage',
        publisher: 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472', version: '4.3.0.0' },
      packages: ['x64', 'arm64'].map((a) => entry(a)) } };
}
function wack() {
  return [['x64 package', 'f'.repeat(64)], ['x64 ARM64 bundle', bundleHash]]
    .map(([label, sha]) => [
      `${label} SHA-256: ${sha.toUpperCase()}`,
      `${label} overall result: WARNING`,
      `${label} partial run: NOT REPORTED`,
      `${label} latest WACK: TRUE`,
      `${label} disposition: PASS WITH OPTIONAL WARNINGS`,
    ].join('\n')).join('\n');
}
function scratch(fn) {
  const root = mkdtempSync(join(tmpdir(), 'recap-store-handoff-test-'));
  try { return fn(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function step(name) {
  const text = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(text, `missing step: ${name}`);
  return text.split('\n      - name: ')[0];
}

test('Store handoff selections reject wrong source syntax, workflow, recipient and either absent approval', () => {
  assert.equal(selection(env).source.productVersion, '4.3.0');
  for (const [field, values] of Object.entries({
    SOURCE_SHA: ['', 'main', 'a'.repeat(39), "'; arbitrary code"], SOURCE_TREE: ['main', 'A'.repeat(40)],
    REVIEWED_WORKFLOW_SHA: ['d'.repeat(40)], GITHUB_SHA: ['d'.repeat(40)],
    GITHUB_WORKFLOW_SHA: ['d'.repeat(40)], GITHUB_WORKFLOW_REF: ['wrong'],
    GITHUB_REPOSITORY: ['unrelated/repository'], DEFAULT_BRANCH: ['feature'],
    GITHUB_EVENT_NAME: ['release'], GITHUB_REF: ['refs/heads/feature'],
    HANDOFF_RECIPIENT: ['another-recipient', ''], BUILD_APPROVED: ['false', '', 'True'],
    TRANSFER_APPROVED: ['false', ''], GITHUB_RUN_ID: ['0'], GITHUB_RUN_ATTEMPT: ['invalid'],
  })) for (const value of values) {
    assert.throws(() => selection({ ...env, [field]: value }), /Store handoff:/, field);
  }
});

test('Store handoff observes actual immutable main ancestry, both trees and synchronized release version', () => scratch((root) => {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'src', 'js', 'lib'), { recursive: true });
  writeFileSync(join(root, WORKFLOW), 'synthetic workflow\n');
  writeFileSync(join(root, 'package.json'), '{"version":"4.3.0"}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"version":"4.3.0"}\n');
  writeFileSync(join(root, 'src', 'js', 'lib', 'version.js'), "export const APP_VERSION = '4.3.0';\n");
  const source = commit();
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  git(['update-ref', 'refs/remotes/origin/main', source]);
  const inputs = { ...env, SOURCE_SHA: source, SOURCE_TREE: tree,
    REVIEWED_WORKFLOW_SHA: source, GITHUB_SHA: source, GITHUB_WORKFLOW_SHA: source };
  assert.equal(observe(root, root, inputs).workflow.blobSha256, hash(Buffer.from('synthetic workflow\n')));
  assert.throws(() => observe(root, root, { ...inputs, SOURCE_SHA: 'a'.repeat(40) }), /checkout commit/);
  assert.throws(() => observe(root, root, { ...inputs, SOURCE_TREE: 'b'.repeat(40) }), /checkout tree/);
  writeFileSync(join(root, 'src', 'extra.js'), 'untracked\n');
  assert.throws(() => observe(root, root, inputs), /source is dirty/);
  rmSync(join(root, 'src', 'extra.js'));
  writeFileSync(join(root, 'package.json'), '{"version":"4.2.0"}\n');
  assert.throws(() => observe(root, root, inputs), /source is dirty/);
  const wrongVersion = commit();
  const wrongInputs = { ...inputs, SOURCE_SHA: wrongVersion, SOURCE_TREE: git(['rev-parse', 'HEAD^{tree}']),
    REVIEWED_WORKFLOW_SHA: wrongVersion, GITHUB_SHA: wrongVersion, GITHUB_WORKFLOW_SHA: wrongVersion };
  assert.throws(() => observe(root, root, wrongInputs), /Command failed/);
  git(['update-ref', 'refs/remotes/origin/main', wrongVersion]);
  assert.throws(() => observe(root, root, wrongInputs), /selected product version differs/);
}));

test('Store inspection matches every configuration against protected input rather than self-consistent identity', () => {
  const report = fixture();
  assert.equal(inspectionSummary(report, digest).packages.length, 3);
  const all = (r) => [...r.packages, r.proofUpdate, ...r.bundle.packages];
  for (let index = 0; index < 5; index += 1) {
    for (const changed of [null, 'a'.repeat(64), undefined]) {
      const bad = fixture();
      all(bad)[index].cloudClient = changed;
      assert.throws(() => inspectionSummary(bad, digest), /configuration differs/);
    }
  }
  for (const bad of [null, '', undefined, 'bad']) {
    assert.throws(() => inspectionSummary(report, bad), /protected configuration digest required/);
  }
  const different = releaseCloudInput('different-synthetic-client').digest;
  for (const entry of all(report)) entry.cloudClient = different;
  assert.throws(() => inspectionSummary(report, digest), /configuration differs/);
  for (const change of [
    (r) => { r.bundle.signed = false; }, (r) => { r.bundle.packages[1].identity.version = '4.3.0.1'; },
    (r) => { r.proofUpdate.identity.version = '4.3.0.0'; }, (r) => { r.packages.pop(); },
    (r) => { r.packages[0].signed = false; }, (r) => { r.proofUpdate.runtimeProcess = {}; },
    (r) => { r.bundle.identity.publisher = 'wrong'; }, (r) => { r.bundle.sha256 = null; },
    (r) => { r.bundle.file = 'renamed.msixbundle'; }, (r) => { r.packages[0].file = '../wrong'; },
  ]) {
    const bad = fixture();
    change(bad);
    assert.throws(() => inspectionSummary(bad, digest), /Store handoff:/);
  }
});

test('Store WACK rejects missing, duplicate, partial, outdated, unqualified and wrong-byte results', () => {
  assert.equal(wackSummary(wack(), 'x64 ARM64 bundle', bundleHash).disposition, 'PASS WITH OPTIONAL WARNINGS');
  for (const text of ['', `${wack()}\nx64 ARM64 bundle SHA-256: ${bundleHash}`,
    wack().replace('partial run: NOT REPORTED', 'partial run: TRUE'),
    wack().replace('latest WACK: TRUE', 'latest WACK: FALSE'),
    wack().replace('overall result: WARNING', 'overall result: FAIL'),
    wack().replace('disposition: PASS WITH OPTIONAL WARNINGS', 'disposition: UNKNOWN')]) {
    assert.throws(() => wackSummary(text, 'x64 package', 'f'.repeat(64))
      && wackSummary(text, 'x64 ARM64 bundle', bundleHash), /Store handoff:/);
  }
  assert.throws(() => wackSummary(wack(), 'x64 ARM64 bundle', '0'.repeat(64)), /WACK hash differs/);
});

test('Store staging and upload preflight reject changed bundle, receipt, qualification and extra files', () => scratch((root) => {
  const bundle = join(root, BUNDLE);
  const stage = join(root, 'stage');
  const inspection = inspectionSummary(fixture(), digest);
  const args = { stage, bundle, binding: binding(), inspection, wack: wack(), expectedDigest: digest };
  writeFileSync(bundle, 'changed before staging');
  assert.throws(() => stageHandoff(args), /qualified bundle changed/);
  writeFileSync(bundle, bundleBytes);
  assert.throws(() => stageHandoff({ ...args, expectedDigest: 'a'.repeat(64) }), /qualification configuration/);
  assert.throws(() => stageHandoff({ ...args, wack: wack().replace(bundleHash.toUpperCase(), '0'.repeat(64)) }), /WACK hash/);
  const receiptHash = stageHandoff(args);
  preflight(stage, binding(), receiptHash);
  const receipt = JSON.parse(readFileSync(join(stage, RECEIPT), 'utf8'));
  assert.equal(receipt.configurationSha256, digest);
  assert.equal(receipt.target.submitAuthorized, false);
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic-client|clientId|redirectHash|certificate|fixture@example/);
  for (const path of [[], ['source'], ['workflow'], ['target'], ['bundle'], ['inspection'],
    ['wack'], ['wack', 'x64'], ['wack', 'bundle'], ['retention']]) {
    const bad = structuredClone(receipt);
    path.reduce((value, key) => value[key], bad).extra = 'private metadata';
    assert.throws(() => validateReceipt(bad, binding()), /fields differ|binding differs|inspection differs|retention differs/);
  }
  writeFileSync(join(stage, BUNDLE), 'changed after qualification');
  assert.throws(() => preflight(stage, binding(), receiptHash), /upload bundle changed/);
  writeFileSync(join(stage, BUNDLE), bundleBytes);
  writeFileSync(join(stage, 'extra.txt'), 'not allowed');
  assert.throws(() => preflight(stage, binding(), receiptHash), /file allowlist differs/);
  rmSync(join(stage, 'extra.txt'));
  writeFileSync(join(stage, RECEIPT), JSON.stringify({ ...receipt, configurationSha256: 'a'.repeat(64) }));
  assert.throws(() => preflight(stage, binding(), receiptHash), /qualified receipt changed/);
  assert.throws(() => preflight(stage, binding(), ''), /receipt digest required/);
}));

test('Store handoff workflow keeps approvals, secrets, qualification, cleanup and transfer ordered and private', () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^ {2}(push|release|pull_request|schedule|workflow_call|workflow_run):/m);
  assert.match(workflow, /environment: microsoft-store-production/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|id-token:|PARTNER_CENTER|publish-store|gh release|git tag|continue-on-error|cache:/);
  assert.match(workflow, /group: microsoft-store-production\n {2}cancel-in-progress: false/);
  assert.match(workflow, /inputs\.build_approved == true && inputs\.transfer_approved == true/);
  const names = ['Check out reviewed tooling', 'Check out selected release', 'Bind selected source and reviewed workflow before execution',
    'Install inspection tooling privately', 'Build production native launchers privately',
    'Bind protected configuration and build once privately', 'Remove protected configuration scratch',
    'Inspect exact packages and independently match protected configuration', 'Run existing WACK qualification privately',
    'Rebind and stage exact qualified bytes', 'Remove all non-handoff material',
    'Verify final allowlist and qualified hashes after cleanup', 'Upload one-day plaintext owner handoff',
    'Verify transferred staging remains qualified', 'Remove final staging'];
  const positions = names.map((name) => workflow.indexOf(`      - name: ${name}\n`));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])));
  for (const name of names.slice(0, 2)) {
    assert.match(step(name), /fetch-depth: 0/);
    assert.match(step(name), /persist-credentials: false/);
  }
  const runBlocks = [...workflow.matchAll(/ {8}run: \|\n([\s\S]*?)(?=\n {6}- name:|$)/g)].map((m) => m[1]);
  assert.ok(runBlocks.length > 10);
  for (const text of runBlocks) assert.doesNotMatch(text, /\$\{\{/, 'no expression interpolation in shell');
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 1);
  assert.match(step('Bind protected configuration and build once privately'), /RECAP_ONEDRIVE_CLIENT_ID: \$\{\{ secrets\.RECAP_ONEDRIVE_CLIENT_ID \}\}/);
  assert.equal((workflow.match(/release-cloud-client\.mjs windows-msix/g) ?? []).length, 1);
  for (const name of ['Install inspection tooling privately', 'Build production native launchers privately',
    'Bind protected configuration and build once privately', 'Inspect exact packages and independently match protected configuration',
    'Run existing WACK qualification privately']) {
    assert.match(step(name), /(?:\*>|1>) \(Join-Path \$env:HANDOFF_ROOT 'scratch\\/);
    assert.match(step(name), /throw '/);
  }
  assert.match(step('Run existing WACK qualification privately'), /Remove-Item Env:\\GITHUB_STEP_SUMMARY/);
  assert.match(step('Remove protected configuration scratch'), /if: always\(\) && steps\.binding\.outcome == 'success'/);
  const cleanup = step('Remove all non-handoff material');
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /shell: powershell/);
  assert.match(cleanup, /Remove-AppxPackage/);
  assert.match(cleanup, /Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(cleanup, /application\\dist/);
  assert.match(cleanup, /application\\node_modules/);
  assert.match(cleanup, /recap-native-build-/);
  assert.match(cleanup, /'scratch'/);
  assert.match(cleanup, /if \(Test-Path -LiteralPath \$path\) \{ throw/);
  assert.match(cleanup, /if \(\$failures\.Count -ne 0\) \{ throw/);
  assert.doesNotMatch(cleanup, /SilentlyContinue/);
  const upload = step('Upload one-day plaintext owner handoff');
  assert.match(upload, /if: success\(\) && steps\.staged\.outcome == 'success' && steps\.cleaned\.outcome == 'success'/);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /if-no-files-found: error/);
  assert.equal((upload.match(/\\stage\\/g) ?? []).length, 2);
  assert.doesNotMatch(upload, /\*|\.cer|\.pfx|report|scratch/);
  assert.match(step('Remove final staging'), /if: always\(\)/);
  const timeouts = [...workflow.matchAll(/timeout-minutes: (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(timeouts.length - 1, (workflow.match(/^ {6}- name:/gm) ?? []).length);
  assert.ok(timeouts[0] > timeouts.slice(1).reduce((a, b) => a + b, 0));
});

test('Store handoff CLI failure never echoes untrusted source or protected configuration', () => {
  const result = spawnSync(process.execPath, ['scripts/store-bundle-handoff.mjs', 'configuration'], {
    env: { ...process.env, ...env, SOURCE_SHA: 'private-invalid-source', RECAP_ONEDRIVE_CLIENT_ID: 'private-invalid-client',
      GITHUB_WORKSPACE: process.cwd(), HANDOFF_ROOT: process.cwd() }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed closed/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-invalid|Error:|at /);
});

const powershell = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0;
test('Store workflow shell parses and cleanup rejects residue or removal failure without leaking its cause', {
  skip: powershell ? false : 'Windows PowerShell required; Windows release runner executes this shell',
}, () => scratch((root) => {
  const blocks = [...workflow.matchAll(/ {8}run: \|\n([\s\S]*?)(?=\n {6}- name:|$)/g)]
    .map((match) => match[1].replace(/^ {10}/gm, ''));
  const scripts = join(root, 'scripts');
  mkdirSync(scripts);
  blocks.forEach((text, index) => writeFileSync(join(scripts, `${index}.ps1`), text));
  const parser = join(root, 'parse.ps1');
  writeFileSync(parser, [
    '$ErrorActionPreference = "Stop"',
    'foreach ($file in Get-ChildItem -LiteralPath $env:FIXTURE_SCRIPTS) {',
    '  $tokens = $null; $errors = $null',
    '  $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)',
    '  if ($errors.Count -ne 0) { throw "Workflow shell failed parsing." }',
    '}',
  ].join('\n'));
  const parsed = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-File', parser], {
    env: { ...process.env, FIXTURE_SCRIPTS: scripts }, encoding: 'utf8',
  });
  assert.equal(parsed.status, 0, parsed.stderr);
  const cleanup = step('Remove all non-handoff material').split('        run: |\n')[1].replace(/^ {10}/gm, '');
  const file = join(root, 'cleanup.ps1');
  const mocks = [
    'function Get-AppxPackage { @() }',
    'function Test-Path { param($LiteralPath); return ($env:FIXTURE_FAULT -ne "none" -and $LiteralPath.EndsWith("application\\dist")) }',
    'function Remove-Item { param($LiteralPath, [switch]$Recurse, [switch]$Force); if ($env:FIXTURE_FAULT -eq "remove") { throw "private-cleanup-detail" } }',
  ].join('\n');
  writeFileSync(file, `${mocks}\n${cleanup}`);
  for (const fault of ['none', 'residue', 'remove']) {
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-File', file], {
      env: { ...process.env, GITHUB_WORKSPACE: root, RUNNER_TEMP: root, HANDOFF_ROOT: join(root, 'handoff'),
        GITHUB_ENV: join(root, 'env'), FIXTURE_FAULT: fault }, encoding: 'utf8',
    });
    assert.equal(result.status, fault === 'none' ? 0 : 1, result.stderr);
    if (fault !== 'none') assert.match(result.stderr, /Non-handoff cleanup failed; transfer is forbidden/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-cleanup-detail/);
  }
}));

test('Store handoff CLI uses later tooling to qualify earlier release source without handoff files', () => scratch((root) => {
  const application = join(root, 'application');
  const tooling = join(root, 'tooling');
  mkdirSync(application);
  const git = (args) => execFileSync('git', args, { cwd: application, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']);
  mkdirSync(join(application, 'src', 'js', 'lib'), { recursive: true });
  writeFileSync(join(application, 'package.json'), '{"version":"4.3.0"}\n');
  writeFileSync(join(application, 'package-lock.json'), '{"version":"4.3.0"}\n');
  writeFileSync(join(application, 'src', 'js', 'lib', 'version.js'), "export const APP_VERSION = '4.3.0';\n");
  writeFileSync(join(application, '.gitignore'), 'dist/\n');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/main', commit]);
  git(['clone', '--no-hardlinks', application, tooling]);
  const toolGit = (args) => execFileSync('git', args, { cwd: tooling, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  mkdirSync(join(tooling, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(tooling, WORKFLOW), 'synthetic later reviewed workflow\n');
  toolGit(['add', '.']);
  toolGit(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'later tooling']);
  const reviewed = toolGit(['rev-parse', 'HEAD']);
  toolGit(['update-ref', 'refs/remotes/origin/main', reviewed]);
  git(['fetch', '--no-tags', tooling, 'HEAD:refs/remotes/origin/main']);
  assert.notEqual(reviewed, commit);
  assert.equal(existsSync(join(application, WORKFLOW)), false);
  const outputs = join(root, 'outputs');
  const handoff = join(root, 'handoff');
  const scratchPath = join(handoff, 'scratch');
  const options = { ...process.env, ...env, SOURCE_SHA: commit, SOURCE_TREE: git(['rev-parse', 'HEAD^{tree}']),
    REVIEWED_WORKFLOW_SHA: reviewed, GITHUB_SHA: reviewed, GITHUB_WORKFLOW_SHA: reviewed,
    GITHUB_WORKSPACE: root, HANDOFF_ROOT: handoff, GITHUB_ENV: join(root, 'env'), GITHUB_OUTPUT: outputs,
    RECAP_ONEDRIVE_CLIENT_ID: 'synthetic-client.recap-page' };
  const command = fileURLToPath(new URL('../scripts/store-bundle-handoff.mjs', import.meta.url));
  const run = (mode, expected = 0) => {
    const result = spawnSync(process.execPath, [command, mode], { env: options, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-client|fixture@example|clientId/);
    return result;
  };
  run('bind');
  run('configuration');
  const report = fixture();
  const standalone = Buffer.from('synthetic standalone');
  const msix = join(application, 'dist', 'msix');
  mkdirSync(msix, { recursive: true });
  for (const entry of [...report.packages, report.proofUpdate]) {
    entry.sha256 = hash(standalone);
    const output = join(application, 'dist', entry === report.proofUpdate ? 'msix-proof' : 'msix');
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, entry.file), standalone);
  }
  writeFileSync(join(msix, BUNDLE), bundleBytes);
  writeFileSync(join(scratchPath, 'inspection.txt'), `synthetic tooling header\n${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(msix, BUNDLE), 'changed before WACK');
  run('inspect', 1);
  writeFileSync(join(msix, BUNDLE), bundleBytes);
  const proof = join(application, 'dist', 'msix-proof', report.proofUpdate.file);
  writeFileSync(proof, 'changed proof before WACK');
  run('inspect', 1);
  writeFileSync(proof, standalone);
  run('inspect');
  writeFileSync(join(scratchPath, 'wack.txt'), wack().replaceAll('F'.repeat(64), hash(standalone).toUpperCase()));
  run('stage');
  const receipt = JSON.parse(readFileSync(join(handoff, 'stage', RECEIPT), 'utf8'));
  assert.equal(receipt.source.commit, commit);
  assert.equal(receipt.workflow.commit, reviewed);
  assert.notEqual(receipt.source.tree, receipt.workflow.tree);
  options.RECEIPT_SHA256 = readFileSync(outputs, 'utf8').trim().split('=')[1];
  rmSync(scratchPath, { recursive: true });
  rmSync(join(application, 'dist'), { recursive: true });
  assert.match(run('preflight').stdout, new RegExp(options.RECEIPT_SHA256));
  writeFileSync(join(handoff, 'stage', BUNDLE), 'changed during upload');
  run('preflight', 1);
}));
