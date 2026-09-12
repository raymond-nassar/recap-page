import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/store-draft-handoff.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const application = 'd116ffbda21be4289f0546fa4d4da139363404ee';
const tree = 'b5d4af8849fdfa3cdd441b7946da3e0d93f70c01';
const workflowPath = '.github/workflows/store-draft-handoff.yml';
const bundle = 'RecapPage_2.1.0.0_x64_arm64.msixbundle';
const hash = 'a'.repeat(64);
const toolingCommit = 'b'.repeat(40);
const publisher = 'CN=inert-same-run-publisher';
const environment = {
  GITHUB_REPOSITORY: 'raymond-nassar/recap-page',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  DEFAULT_BRANCH: 'main',
  GITHUB_WORKFLOW_REF: `raymond-nassar/recap-page/${workflowPath}@refs/heads/main`,
  GITHUB_WORKFLOW_SHA: toolingCommit,
  GITHUB_SHA: toolingCommit,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
};

function step(name) {
  const block = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(block, `missing step ${name}`);
  return block.split('\n      - name: ')[0];
}

const inline = step('Bind both sources and install inline contract').match(/ {10}@'\r?\n([\s\S]*?)\r?\n {10}'@ \| Set-Content/)?.[1];
assert.ok(inline, 'actual executable contract must be present');
const source = inline.replace(/^ {10}/gm, '');
const contracts = source.split('// BEGIN handoff contracts\n')[1].split('// END handoff contracts')[0];
const { bind, allowFiles, makeReceipt, validateReceipt, wackSummary } = runInNewContext(
  `${contracts}\n({ bind, allowFiles, makeReceipt, validateReceipt, wackSummary });`,
);

function binding() {
  return {
    source: { commit: application, tree, applicationVersion: '2.1.0', storeVersion: '2.1.0.0' },
    workflow: { commit: toolingCommit, tree: 'c'.repeat(40), path: workflowPath,
      blobSha256: hash, runId: '123', runAttempt: '2' },
  };
}

function fixture() {
  const packageEntry = (architecture) => ({
    identity: { name: 'PanelStackLabs.RecapPage', publisher, version: '2.1.0.0', architecture },
    signed: true, sha256: hash, native: { sha256: hash, inputDigest: hash }, nodeSha256: hash,
  });
  const packages = ['x64', 'arm64'].map(packageEntry);
  const proofUpdate = packageEntry('x64');
  proofUpdate.identity.version = '2.1.0.1';
  return {
    report: { nodeVersion: 'v24.19.0', packages, proofUpdate,
      bundle: { file: bundle, signed: true, sha256: hash, packageCount: 2,
        identity: { name: 'PanelStackLabs.RecapPage', publisher, version: '2.1.0.0' },
        packages: ['x64', 'arm64'].map(packageEntry) } },
    native: { schemaVersion: 1, commit: application, productionDigest: null, inputDigest: hash,
      outputs: ['x64', 'arm64'].map((architecture) => ({ architecture, sha256: hash })),
      toolchain: { image: 'win22 20260901.1', sdk: '10.0.26100.0', compilerVersion: '19.44.35214',
        targets: ['x64', 'arm64'].map((architecture) => ({ architecture, compiler: hash, linker: hash, resources: hash })) } },
    signer: { subject: publisher, thumbprint: 'D'.repeat(40) },
    wack: ['x64 package', 'x64 ARM64 bundle'].map((label) => [
      `${label} SHA-256: ${hash.toUpperCase()}`,
      `${label} overall result: WARNING`,
      `${label} partial run: NOT REPORTED`,
      `${label} latest WACK: TRUE`,
      `${label} disposition: PASS WITH OPTIONAL WARNINGS`,
    ].join('\n')).join('\n'),
    hashes: { before: hash, after: hash, staged: hash },
  };
}

function receipt(f = fixture()) {
  return makeReceipt(binding(), f.report, f.native, hash, f.signer, f.wack, f.hashes, 1024);
}

test('handoff is manual/default-branch-only, protected and has no Store secrets or publisher', () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n\npermissions:\n {2}contents: read\n/m);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' &&\n {6}github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.equal((workflow.match(/^ {2}[a-z]+:\n/gm) ?? []).length, 1);
  assert.match(workflow, /environment: microsoft-store-production\n {4}runs-on: windows-2022/);
  assert.doesNotMatch(workflow, /secrets\.|PARTNER_CENTER|publish-store-update|check-store-release|release:\n|inputs:|matrix:|continue-on-error|IncludeProofTools|msix:prove|npm run (?:browser|upgrade|contract)|PartnerCenterValidate/);
  for (const changed of [
    { GITHUB_EVENT_NAME: 'release' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_WORKFLOW_REF: 'wrong' }, { GITHUB_REPOSITORY: 'unrelated/repository' },
    { GITHUB_WORKFLOW_SHA: 'd'.repeat(40) }, { GITHUB_RUN_ATTEMPT: '1' },
  ]) assert.throws(() => bind(binding(), { ...environment, ...changed }), /binding differs/);
});

test('handoff binds dual sources and installs the application inspection dependency', () => {
  assert.equal(bind(binding(), environment).source.commit, application);
  const wrong = binding();
  wrong.source.commit = toolingCommit;
  assert.throws(() => bind(wrong, environment), /qualified application source differs/,
    'wrong-source condition must be rejected');
  for (const field of ['tree', 'applicationVersion', 'storeVersion']) {
    const bad = binding();
    bad.source[field] = 'wrong';
    assert.throws(() => bind(bad, environment), /qualified application source differs/);
  }
  const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
  for (const name of ['Check out reviewed tooling', 'Check out qualified application']) {
    assert.ok(step(name).includes(checkout));
    assert.match(step(name), /persist-credentials: false/);
  }
  assert.match(step('Check out reviewed tooling'), /ref: \$\{\{ github\.workflow_sha \}\}\n {10}path: tooling/);
  assert.ok(step('Check out qualified application').includes(`ref: ${application}\n          path: application`));
  const install = step('Install application inspection tooling');
  assert.match(install, /timeout-minutes: 4\n {8}working-directory: application\n {8}run: \|\n {10}npm ci --ignore-scripts\n {10}if \(\$LASTEXITCODE -ne 0\) \{ throw 'Application tooling installation failed\.'/);
  assert.equal((workflow.match(/npm ci --ignore-scripts/g) ?? []).length, 1);
  assert.ok(source.includes("const application = path.join(env.GITHUB_WORKSPACE, 'application');"));
  assert.ok(source.includes("const tooling = path.join(env.GITHUB_WORKSPACE, 'tooling');"));
  assert.ok(source.includes("git(cwd, ['rev-parse', 'HEAD', 'HEAD^{tree}'])"));
  assert.ok(source.includes("git(cwd, ['status', '--porcelain=v1', '--untracked-files=no'])"));
  assert.ok(source.includes("git(tooling, ['show', `${workflow.commit}:${WORKFLOW}`])"));
  assert.match(source, /const binding = observe\(\);[\s\S]*same\(binding, json\(path\.join\(root, 'binding\.json'\)\), 'sources changed during qualification'\)/);
  assert.equal((source.match(/const binding = observe\(\)/g) ?? []).length, 2);
  assert.match(readFileSync(new URL('../scripts/inspect-msix.mjs', import.meta.url), 'utf8'), /startupSourceInputs\(ROOT\)/);
  assert.match(readFileSync(new URL('../scripts/lib/startup-contract.mjs', import.meta.url), 'utf8'), /createRequire\(import\.meta\.url\)\('eslint'\)/);
});

test('handoff exports exactly the bundle and recursively allowlisted receipt', () => {
  const entries = [bundle, 'store-draft-handoff.json'].map((name) => ({ name, file: true, link: false }));
  allowFiles(entries);
  assert.throws(() => allowFiles([...entries, { name: 'extra.txt', file: true, link: false }]),
    /handoff file allowlist differs/, 'extra-file condition must be rejected');
  assert.throws(() => allowFiles(entries.slice(1)), /file allowlist/);
  assert.throws(() => allowFiles([{ ...entries[0], link: true }, entries[1]]), /regular files/);
  const r = receipt();
  validateReceipt(r, binding(), publisher);
  assert.deepEqual(JSON.parse(JSON.stringify(r.source)), binding().source);
  assert.equal(r.wack.bundle.disposition, 'PASS WITH OPTIONAL WARNINGS');
  assert.equal(r.wack.x64.partial, 'NOT REPORTED');
  assert.equal(r.native.toolchain.sdk, '10.0.26100.0');
  assert.equal(r.retention.submitAuthorized, false);
  const paths = [[], ['source'], ['workflow'], ['target'], ['bundle'], ['native'], ['native', 'toolchain'],
    ['native', 'toolchain', 'targets', 0], ['native', 'toolchain', 'targets', 1],
    ['runtimes', 0], ['runtimes', 1], ['inspection'], ['signing'], ['wack'], ['wack', 'x64'],
    ['wack', 'bundle'], ['retention']];
  for (const parts of paths) {
    const changed = structuredClone(r);
    parts.reduce((value, key) => value[key], changed).extra = 'not-exportable';
    assert.throws(() => validateReceipt(changed, binding(), publisher), /fields|differs|qualified/);
  }
  for (const [section, field, value] of [
    ['bundle', 'bytes', '1024'], ['bundle', 'sha256', null], ['signing', 'thumbprint', 123],
    ['inspection', 'structuralPassed', 'true'], ['retention', 'temporary', 'true'],
    ['target', 'submissionId', 'wrong'], ['workflow', 'runAttempt', '1'],
    ['source', 'commit', toolingCommit],
  ]) {
    const changed = structuredClone(r);
    changed[section][field] = value;
    assert.throws(() => validateReceipt(changed, binding(), publisher), /differs?|qualified/);
  }
  const upload = step('Upload temporary handoff');
  assert.equal((upload.match(/\$\{\{ env\.HANDOFF_ROOT \}\}\\stage\\/g) ?? []).length, 2);
  assert.ok(upload.includes(`\\stage\\${bundle}`));
  assert.match(upload, /\\stage\\store-draft-handoff\.json/);
  assert.doesNotMatch(upload, /\*|\.pfx|\.cer|\.exe|2\.1\.0\.1|report/);
});

test('handoff derives qualification from real check results and enforces hash/dependency order', () => {
  const names = ['Install application inspection tooling', 'Build production native launchers', 'Pack Store bundle',
    'Inspect packages structurally', 'Record pre-WACK bundle hash and signer', 'Run WACK on exact packages',
    'Rebind and stage qualified handoff', 'Remove non-handoff material', 'Upload temporary handoff', 'Remove final staging'];
  const indices = names.map((name) => workflow.indexOf(`      - name: ${name}\n`));
  assert.ok(indices.every((position, index) => position >= 0 && (index === 0 || position > indices[index - 1])));
  assert.match(workflow, /defaults:\n {6}run:\n {8}shell: pwsh\n {8}working-directory: application/);
  for (const [name, command, failure] of [
    ['Build production native launchers', './scripts/build-native-launcher.ps1', /if \(-not \$\?\) \{ throw/],
    ['Pack Store bundle', 'npm run msix:pack', /if \(\$LASTEXITCODE -ne 0\) \{ throw/],
    ['Inspect packages structurally', 'npm run msix:inspect -- --structural', /if \(\$LASTEXITCODE -ne 0\) \{ throw/],
    ['Run WACK on exact packages', './scripts/run-wack.ps1', /if \(-not \$\?\) \{ throw/],
    ['Rebind and stage qualified handoff', "'contract.cjs') stage", /if \(\$LASTEXITCODE -ne 0\) \{ throw/],
  ]) {
    assert.equal(workflow.split(command).length - 1, 1);
    assert.match(step(name), failure);
    assert.doesNotMatch(step(name), /working-directory:|if:|continue-on-error/);
  }
  for (const key of ['before', 'after', 'staged']) {
    const f = fixture();
    f.hashes[key] = 'e'.repeat(64);
    assert.throws(() => receipt(f), /bundle hash changed/);
  }
  for (const change of [
    (f) => { f.report.bundle.signed = false; },
    (f) => { f.report.packages[0].runtimeProcess = {}; },
    (f) => { f.report.bundle.packages[1].identity.version = '2.1.0.1'; },
    (f) => { f.native.commit = toolingCommit; },
    (f) => { f.native.toolchain.sdk = '10.0.0.0'; },
    (f) => { f.report.bundle.packages[0].native.sha256 = 'e'.repeat(64); },
    (f) => { f.report.nodeVersion = 'v24.20.0'; },
    (f) => { f.wack = f.wack.replace('overall result: WARNING', 'overall result: FAIL'); },
    (f) => { f.wack = f.wack.replace('partial run: NOT REPORTED', 'partial run: TRUE'); },
    (f) => { f.wack = f.wack.replace('latest WACK: TRUE', 'latest WACK: FALSE'); },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => receipt(f), /differs?|missing|unqualified/);
  }
  assert.throws(() => wackSummary('', 'x64 package', hash), /missing or duplicate WACK/);
  const f = fixture();
  assert.throws(() => wackSummary(`${f.wack}\nx64 package SHA-256: ${hash}`, 'x64 package', hash), /duplicate WACK/);
  assert.throws(() => wackSummary(f.wack, 'x64 package', 'f'.repeat(64)), /WACK package hash differs/);
  assert.match(source, /sha\(fs\.readFileSync\(file\)\) === receipt\.bundle\.sha256, 'upload preflight hash differs'/);
  assert.match(source, /mode === 'stage'[\s\S]*makeReceipt[\s\S]*preflight\(binding, signer\.subject\)/);
  assert.match(step('Remove non-handoff material'), /Post-cleanup handoff hash differs/);
});

test('handoff cleanup, pinned tools, deadlines and one-day retention bound acceptance', () => {
  const deadlines = [...workflow.matchAll(/^\s+timeout-minutes: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.equal(deadlines[0], 130);
  assert.equal(deadlines.slice(1).reduce((sum, value) => sum + value, 0), 126);
  assert.equal(deadlines.length - 1, 15);
  assert.match(workflow, /group: store-draft-handoff\n {2}cancel-in-progress: false/);
  assert.match(step('Set up build driver'), /setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(step('Set up build driver'), /node-version: '24\.20\.0'/);
  const winapp = step('Install checksum-verified WinApp CLI');
  assert.match(winapp, /F6DC42E3B4E4709C8F617003008E2CFDD9A51735E04E7170D60EDDA258DB78A8/);
  assert.ok(winapp.indexOf('Get-FileHash') < winapp.indexOf('Expand-Archive'));
  assert.match(winapp, /if \(\$LASTEXITCODE -ne 0/);
  const cleanup = step('Remove non-handoff material');
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /shell: powershell/);
  assert.match(cleanup, /Remove-AppxPackage -Package \$package\.PackageFullName/);
  assert.match(cleanup, /Cert:\\LocalMachine\\TrustedPeople\\\$\(\$certificate\.Thumbprint\)/);
  for (const name of ['application\\dist', 'application\\node_modules', 'scratch', 'contract.cjs', 'binding.json']) {
    assert.ok(cleanup.includes(`'${name}'`));
  }
  assert.match(cleanup, /foreach \(\$path[\s\S]*catch \{ \$failures \+= \$_\.Exception \}/);
  assert.match(cleanup, /throw \[AggregateException\]/);
  assert.match(cleanup, /Post-cleanup handoff file allowlist differs/);
  assert.doesNotMatch(cleanup, /SilentlyContinue/);
  const upload = step('Upload temporary handoff');
  assert.match(upload, /if: success\(\) && steps\.staged\.outcome == 'success' && steps\.cleaned\.outcome == 'success'/);
  assert.match(upload, /upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(upload, /retention-days: 1\n {10}compression-level: 0/);
  assert.match(upload, /if-no-files-found: error/);
  assert.ok(upload.includes(`name: store-draft-handoff-\${{ github.run_id }}-\${{ github.run_attempt }}-\${{ github.workflow_sha }}-${application}`));
  const final = step('Remove final staging');
  assert.match(final, /if: always\(\)/);
  assert.match(final, /Remove-Item -LiteralPath \$env:HANDOFF_ROOT -Recurse -Force/);
  assert.match(final, /if \(Test-Path -LiteralPath \$env:HANDOFF_ROOT\) \{ throw/);
  assert.ok(source.includes("const stage = path.join(root, 'stage');"));
  assert.match(source, /TEMP=\$\{scratch\}\\nTMP=\$\{scratch\}\\nNUGET_PACKAGES=/);
  assert.ok(cleanup.includes('recap-native-build-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT'));
  assert.match(cleanup, /Out-File -FilePath \$env:GITHUB_ENV -Encoding utf8 -Append/);
});
