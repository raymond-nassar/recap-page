import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/store-existing-draft-recovery.yml', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');
const application = '40b6a529dbdc462799f613d9a3430912f7dde22e';
const tree = '1fb29569aa3b17a095ee6da4adf837d50e708e14';
const bundle = 'RecapPage_3.0.0.0_x64_arm64.msixbundle';
const stepBlocks = workflow.split(/^ {6}- name: /m).slice(1);
const steps = stepBlocks.map((block) => ({
  name: block.split('\n')[0],
  block,
  run: block.match(/^ {8}run: \|\r?\n([\s\S]*)/m)?.[1]?.replace(/^ {10}/gm, '') ?? '',
}));
function step(name) {
  const found = steps.filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `expected one step: ${name}`);
  return found[0];
}
function field(block, key, indent = 10) {
  const value = block.match(new RegExp(`^ {${indent}}${key}: (.+)$`, 'm'))?.[1];
  assert.ok(value, `missing ${key}`);
  return value;
}
const contract = workflow.match(/\/\/ BEGIN recovery source contract\r?\n([\s\S]*?) *\/\/ END recovery source contract/)?.[1];
assert.ok(contract, 'the executed source contract must be present');
const { bind, releaseCommit } = runInNewContext(`${contract}\n({ bind, releaseCommit });`);
const toolingSha = 'a'.repeat(40);
const toolingTree = 'b'.repeat(40);
function binding() {
  return {
    observed: {
      toolingHead: toolingSha, toolingTree, reviewedTree: toolingTree, toolingStatus: '',
      applicationHead: application, applicationTree: tree, applicationStatus: '',
      version: '3.0.0', releaseTag: `${application}\trefs/tags/v3.0.0`,
    },
    env: {
      GITHUB_REPOSITORY: 'raymond-nassar/recap-page', GITHUB_EVENT_NAME: 'workflow_dispatch',
      DEFAULT_BRANCH: 'main', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_WORKFLOW_REF: 'raymond-nassar/recap-page/.github/workflows/store-existing-draft-recovery.yml@refs/heads/main',
      GITHUB_WORKFLOW_SHA: toolingSha, GITHUB_SHA: toolingSha,
    },
  };
}

test('temporary workflow is manual, default-main-only, protected, serialized and first-attempt-only', () => {
  assert.equal(workflow.match(/^on:\r?\n([\s\S]*?)\r?\npermissions:/m)?.[1].trim(), 'workflow_dispatch:');
  assert.equal(workflow.match(/^permissions:\r?\n([\s\S]*?)\r?\nconcurrency:/m)?.[1].trim(), 'contents: read');
  assert.equal(workflow.match(/^concurrency:\r?\n([\s\S]*?)\r?\njobs:/m)?.[1].trim(),
    'group: microsoft-store-production\n  cancel-in-progress: false');
  const routing = workflow.match(/^ {4}if: >-\r?\n([\s\S]*?)^ {4}environment:/m)?.[1].trim();
  assert.equal(routing, [
    "github.event_name == 'workflow_dispatch' &&",
    "      github.event.repository.default_branch == 'main' &&",
    "      github.ref == 'refs/heads/main' &&",
    '      github.run_attempt == 1',
  ].join('\n'));
  assert.equal(field(workflow, 'environment', 4), 'microsoft-store-production');
  assert.equal(field(workflow, 'runs-on', 4), 'windows-2022');
  assert.doesNotMatch(workflow, /continue-on-error|strategy:|workflow_call:|inputs:|upload-artifact|download-artifact/);
  const deadline = Number(field(workflow, 'timeout-minutes', 4));
  const stepMinutes = steps.map(({ block }) => Number(field(block, 'timeout-minutes', 8)));
  assert.ok(stepMinutes.every((minutes) => Number.isInteger(minutes) && minutes > 0));
  assert.ok(deadline > stepMinutes.reduce((sum, minutes) => sum + minutes, 0));
});

test('both checkouts bind immutable reviewed commits and all builds stay in application', () => {
  const tooling = step('Check out reviewed tooling').block;
  const app = step('Check out qualified application').block;
  assert.equal(field(tooling, 'ref'), '${{ github.workflow_sha }}');
  assert.equal(field(tooling, 'path'), 'tooling');
  assert.equal(field(app, 'ref'), application);
  assert.equal(field(app, 'path'), 'application');
  for (const checkout of [tooling, app]) {
    assert.equal(field(checkout, 'persist-credentials'), 'false');
    assert.equal(field(checkout, 'uses', 8).split(' #')[0],
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
  }
  assert.equal(field(workflow, 'working-directory', 8), 'application');
  const directoryOverrides = steps.flatMap(({ block }) =>
    [...block.matchAll(/^ {8}working-directory: (.+)$/gm)].map((match) => match[1]));
  assert.deepEqual(directoryOverrides, ['${{ github.workspace }}']);
  const source = step('Bind reviewed tooling and qualified source').run;
  for (const required of [
    "git(tooling, 'rev-parse', 'HEAD')", "git(tooling, 'rev-parse', 'HEAD^{tree}')",
    '`${env.GITHUB_WORKFLOW_SHA}^{tree}`', "git(application, 'rev-parse', 'HEAD')",
    "git(application, 'rev-parse', 'HEAD^{tree}')", "'status', '--porcelain', '--untracked-files=all'",
    "'ls-remote', '--exit-code', 'origin', TAG, `${TAG}^{}`",
    "path.join(application, 'package.json')",
  ]) assert.ok(source.includes(required), required);
  assert.match(source, /node \(Join-Path \$env:RECOVERY_ROOT 'bind\.cjs'\)/);
  assert.match(step('Rebind sources and archive the unchanged bundle').run, /node \(Join-Path \$env:RECOVERY_ROOT 'bind\.cjs'\)/);
  assert.doesNotMatch(workflow, /git (?:push|tag|reset|checkout)|Copy-Item|Set-Content[^\n]*(?:application|scripts\\)/);
});

test('executed binding rejects each changed source, tag and routing boundary', () => {
  const good = binding();
  assert.doesNotThrow(() => bind(good.observed, good.env));
  const badObserved = {
    toolingHead: 'c'.repeat(40), toolingTree: 'd'.repeat(40), reviewedTree: 'e'.repeat(40),
    toolingStatus: ' M scripts/resume-store-recovery.mjs', applicationHead: 'f'.repeat(40),
    applicationTree: '0'.repeat(40), applicationStatus: '?? scripts/override.mjs',
    version: '3.0.1', releaseTag: `${'1'.repeat(40)}\trefs/tags/v3.0.0`,
  };
  for (const [key, value] of Object.entries(badObserved)) {
    assert.throws(() => bind({ ...good.observed, [key]: value }, good.env), /source binding failed/, key);
  }
  const badEnv = {
    GITHUB_REPOSITORY: 'other/recap-page', GITHUB_EVENT_NAME: 'release', DEFAULT_BRANCH: 'develop',
    GITHUB_REF: 'refs/tags/v3.0.0', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_WORKFLOW_REF: good.env.GITHUB_WORKFLOW_REF.replace('@refs/heads/main', '@refs/heads/other'),
    GITHUB_WORKFLOW_SHA: '2'.repeat(40), GITHUB_SHA: '3'.repeat(40),
  };
  for (const [key, value] of Object.entries(badEnv)) {
    assert.throws(() => bind(good.observed, { ...good.env, [key]: value }), /source binding failed/, key);
  }
});

test('read-only release tag guard accepts lightweight and peeled tags, not missing or ambiguous tags', () => {
  const tag = `refs/tags/v3.0.0`;
  assert.equal(releaseCommit(`${application}\t${tag}`), application);
  assert.equal(releaseCommit(`${'4'.repeat(40)}\t${tag}\n${application}\t${tag}^{}`), application);
  for (const value of [
    '', `${application}\trefs/tags/v3.0.1`, `${application}\t${tag}^{}`,
    `${application}\t${tag}\n${application}\t${tag}`, `invalid\t${tag}`,
  ]) assert.throws(() => releaseCommit(value), /source binding failed/);
});

test('established qualified builder, packer, structural inspection and WACK execute once in order', () => {
  const names = [
    'Install locked application inspection tooling', 'Install checksum-verified WinApp CLI',
    'Build production native launchers', 'Pack qualified Store bundle once',
    'Inspect packages structurally', 'Record validated bundle hash',
    'Run WACK on exact qualified packages', 'Rebind sources and archive the unchanged bundle',
    'Resume the fixed existing draft once', 'Remove all generated recovery material',
  ];
  const positions = names.map((name) => steps.indexOf(step(name)));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(step(names[0]).run, /npm ci --ignore-scripts/);
  const winapp = step(names[1]).run;
  assert.match(winapp, /releases\/download\/v0\.6\.0\/winappcli-x64\.zip/);
  assert.match(winapp, /F6DC42E3B4E4709C8F617003008E2CFDD9A51735E04E7170D60EDDA258DB78A8/);
  assert.ok(winapp.indexOf('Get-FileHash') < winapp.indexOf('Expand-Archive'));
  assert.ok(winapp.indexOf('Expand-Archive') < winapp.indexOf('winapp.exe'));
  assert.match(winapp, /@\('0\.6\.0', 'v0\.6\.0'\) -notcontains \$output\[-1\]\.Trim\(\)/);
  assert.match(step(names[2]).run, /\.\/scripts\/build-native-launcher\.ps1 \*> \$null/);
  assert.equal(workflow.match(/npm run msix:pack/g)?.length, 1);
  assert.equal(workflow.match(/npm run msix:inspect -- --structural/g)?.length, 1);
  assert.equal(workflow.match(/\.\/scripts\/run-wack\.ps1/g)?.length, 1);
  assert.doesNotMatch(workflow, /IncludeProofTools|msix:prove|3\.0\.0\.1|publish-store-update|create-debug-identity/);
  const wack = step(names[6]);
  assert.ok(wack.run.includes(`-Bundle '.\\dist\\msix\\${bundle}'`));
  assert.match(wack.run, /-X64Package '\.\\dist\\msix\\RecapPage_3\.0\.0\.0_x64\.msix'/);
  assert.match(wack.run, /-Certificate '\.\\dist\\msix\\RecapPage-local-proof\.cer'/);
  assert.match(wack.block, /GITHUB_STEP_SUMMARY: ''/);
});

test('one exact bundle is hashed around WACK and ZIP creation and passed with three absolute positional paths', () => {
  assert.ok(step('Record validated bundle hash').run.includes(`-LiteralPath '.\\dist\\msix\\${bundle}'`));
  const archive = step('Rebind sources and archive the unchanged bundle');
  const mutation = step('Resume the fixed existing draft once');
  for (const entry of [archive, mutation]) {
    assert.equal(field(entry.block, 'EXPECTED_BUNDLE_SHA256'), '${{ steps.bundle_hash.outputs.sha256 }}');
    assert.ok(entry.run.includes(`$bundle = (Resolve-Path -LiteralPath '.\\dist\\msix\\${bundle}').Path`));
    assert.match(entry.run, /\$env:EXPECTED_BUNDLE_SHA256 -cnotmatch '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(entry.run, /Get-FileHash -Algorithm SHA256 -LiteralPath \$bundle/);
  }
  assert.equal(workflow.match(/Compress-Archive/g)?.length, 1);
  assert.match(archive.run, /Compress-Archive -LiteralPath \$bundle -DestinationPath \$archive -CompressionLevel Optimal/);
  assert.equal(archive.run.match(/-cne \$env:EXPECTED_BUNDLE_SHA256/g)?.length, 3);
  assert.match(archive.run, /\$archive = Join-Path \$env:RECOVERY_ROOT 'store-upload\.zip'/);
  assert.match(mutation.run, /\$archive = \(Resolve-Path -LiteralPath \(Join-Path \$env:RECOVERY_ROOT 'store-upload\.zip'\)\)\.Path/);
  assert.match(mutation.run, /\$notes = \(Resolve-Path -LiteralPath '\.\\docs\\releases\\3\.0\.0-store\.json'\)\.Path/);
  assert.equal(mutation.run.match(/^node .+$/m)?.[0],
    "node (Join-Path $env:GITHUB_WORKSPACE 'tooling\\scripts\\resume-store-recovery.mjs') $bundle $archive $notes");
  assert.equal(workflow.match(/resume-store-recovery\.mjs/g)?.length, 1);
  assert.match(mutation.run, /\$env:GITHUB_RUN_ATTEMPT -ne '1'/);
});

test('ZIP contains exactly the target bundle, streams its validated content hash, and binds archive bytes to recovery', () => {
  const archive = step('Rebind sources and archive the unchanged bundle');
  const mutation = step('Resume the fixed existing draft once');
  assert.equal(field(archive.block, 'id', 8), 'archive_hash');
  assert.equal(field(mutation.block, 'EXPECTED_ARCHIVE_SHA256'), '${{ steps.archive_hash.outputs.sha256 }}');
  assert.match(archive.run, /\$zip = \[IO\.Compression\.ZipFile\]::OpenRead\(\$archive\)/);
  assert.match(archive.run, /if \(\$zip\.Entries\.Count -ne 1 -or\s+\$zip\.Entries\[0\]\.FullName -cne 'RecapPage_3\.0\.0\.0_x64_arm64\.msixbundle'\)/);
  assert.match(archive.run, /\$stream = \$zip\.Entries\[0\]\.Open\(\)/);
  assert.match(archive.run, /\$sha256 = \[Security\.Cryptography\.SHA256\]::Create\(\)/);
  assert.match(archive.run, /\$entryHash = \[Convert\]::ToHexString\(\$sha256\.ComputeHash\(\$stream\)\)\.ToLowerInvariant\(\)/);
  assert.match(archive.run, /if \(\$entryHash -cne \$env:EXPECTED_BUNDLE_SHA256\)/);
  assert.match(archive.run, /\$archiveHash = \(Get-FileHash -Algorithm SHA256 -LiteralPath \$archive\)\.Hash\.ToLowerInvariant\(\)/);
  assert.match(archive.run, /\$archiveHash -cnotmatch '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(archive.run, /"sha256=\$archiveHash" \| Out-File -FilePath \$env:GITHUB_OUTPUT/);
  const ordered = [
    'Compress-Archive', '$zip =', '$zip.Entries.Count', '$stream =', '$entryHash =',
    'if ($entryHash -cne', '$archiveHash =', '$zip.Dispose()', '"sha256=$archiveHash"',
  ].map((text) => archive.run.indexOf(text));
  assert.ok(ordered.every((position) => position >= 0));
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  for (const resource of ['sha256', 'stream', 'zip']) {
    assert.ok(archive.run.includes(`finally { $${resource}.Dispose() }`));
  }
  assert.doesNotMatch(archive.run, /ExtractToDirectory|ExtractToFile|CopyTo|ReadAllBytes/);
  assert.match(archive.run, /catch \{ throw 'Recovery ZIP binding failed; private details suppressed\.' \}/);
  assert.equal(workflow.match(/Compress-Archive/g)?.length, 1, 'never recompress before upload');
});

test('credentials belong only to the sole final recovery invocation, with no direct mutation or raw response logs', () => {
  const mutation = step('Resume the fixed existing draft once');
  const secretSteps = steps.filter(({ block }) => block.includes('secrets.'));
  assert.deepEqual(secretSteps.map(({ name }) => name), [mutation.name]);
  for (const credential of ['CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID']) {
    assert.equal(field(mutation.block, `PARTNER_CENTER_${credential}`), `\${{ secrets.PARTNER_CENTER_${credential} }}`);
  }
  assert.equal(workflow.match(/secrets\./g)?.length, 3);
  assert.doesNotMatch(workflow, /manage\.devcenter|login\.microsoftonline|Invoke-RestMethod|publish-store-update|MICROSOFT_STORE_PRODUCT_ID|fileUploadUrl/);
  assert.doesNotMatch(mutation.run, /while\s*\(|for\s*\(|Start-Sleep|catch|ConvertTo-Json|Write-Output.*(?:response|url)/i);
  assert.match(mutation.run, /State may be uncertain; do not rerun/);
  assert.match(mutation.run, /Commit started; publication and certification are not verified/);
  assert.deepEqual(steps.filter(({ run }) => run.includes('FilePath $env:GITHUB_OUTPUT')).map(({ name }) => name),
    ['Record validated bundle hash', 'Rebind sources and archive the unchanged bundle']);
});

test('always cleanup removes run-scoped generated material, exact package and trust with sanitized aggregate failures', () => {
  const cleanup = step('Remove all generated recovery material');
  assert.equal(steps.at(-1), cleanup);
  assert.equal(field(cleanup.block, 'if', 8), 'always()');
  assert.equal(field(cleanup.block, 'shell', 8), 'powershell');
  assert.equal(field(cleanup.block, 'working-directory', 8), '${{ github.workspace }}');
  assert.equal(field(workflow, 'RECOVERY_ROOT', 6),
    '${{ runner.temp }}\\recap-store-recovery-${{ github.run_id }}-${{ github.run_attempt }}');
  for (const variable of ['TEMP', 'TMP']) {
    assert.ok(step('Bind reviewed tooling and qualified source').run.includes(
      `"${variable}=$(Join-Path $env:RECOVERY_ROOT 'scratch')"`));
  }
  for (const boundary of [
    "'application\\dist'", "'application\\node_modules'", '$env:RECOVERY_ROOT',
    '"recap-native-build-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"',
    "'application\\dist\\msix\\RecapPage-local-proof.cer'",
    'Cert:\\LocalMachine\\TrustedPeople\\$($certificate.Thumbprint)',
    "Where-Object PackageFamilyName -eq 'PanelStackLabs.RecapPage_we33aa8nvkpcc'",
    'Remove-AppxPackage -Package $package.PackageFullName',
    'Remove-Item -LiteralPath $trusted -Force', '$certificate.Dispose()',
    'Remove-Item -LiteralPath $path -Recurse -Force',
    "if (Test-Path -LiteralPath $path) { throw 'Generated material remains.' }",
    "[AggregateException]::new('Recovery cleanup boundaries failed.', [Exception[]]$failures)",
  ]) assert.ok(cleanup.run.includes(boundary), boundary);
  assert.equal(cleanup.run.match(/catch \{ \$failures \+= \[Exception\]::new/g)?.length, 3);
  assert.doesNotMatch(cleanup.run, /\$_|SilentlyContinue|Stop-Process|15432/);
  assert.ok(cleanup.run.indexOf('Remove-AppxPackage') < cleanup.run.indexOf("'application\\dist'"));
  assert.ok(cleanup.run.indexOf('Remove-Item -LiteralPath $trusted') < cleanup.run.indexOf("'application\\dist'"));
});
