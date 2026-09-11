import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/wack.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/run-wack.ps1', import.meta.url), 'utf8');

function topLevelMap(source, key) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `${key} top-level map is missing`);
  const entries = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(' ')) break;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const pair = /^ {2}([A-Za-z0-9_-]+):\s*(\S+)\s*$/.exec(line);
    assert.ok(pair, `${key} contains an unreadable entry: ${line}`);
    entries.push([pair[1], pair[2]]);
  }
  return Object.fromEntries(entries);
}

test('WACK and installed proof run when package behavior changes', () => {
  assert.match(workflow, /^ {2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /^ {2}pull_request:\s*$/m);
  const paths = workflow.match(/ {4}paths:\r?\n((?: {6}- .+\r?\n)+)/)?.[1] ?? '';
  assert.deepEqual(
    [...paths.matchAll(/ {6}- (.+)/g)].map((match) => match[1]),
    [
      '.github/workflows/wack.yml',
      '.github/workflows/microsoft-store-release.yml',
      '.github/browser-proof/**',
      'LICENSE',
      'package.json',
      'packaging/windows/**',
      'server.mjs',
      'src/**',
      'scripts/inspect-msix.mjs',
      'scripts/build-native-launcher.ps1',
      'scripts/lib/native-launcher.mjs',
      'scripts/lib/startup-contract.mjs',
      'scripts/msix-proof.mjs',
      'scripts/native-startup-proof.ps1',
      'scripts/pack-msix.mjs',
      'scripts/pack-windows.mjs',
      'scripts/run-wack.ps1',
      'scripts/test-wack-report.ps1',
      'scripts/wack-report.ps1',
      'test/msix-packaging.test.js',
      'test/microsoft-store-release.test.js',
      'test/native/**',
      'test/server-contract.test.js',
      'test/startup-contract.test.js',
      'test/wack-workflow.test.js',
    ],
  );
  assert.doesNotMatch(workflow, /pull_request_target|schedule:|^ {2}push:/m);
});

test('WACK uses the supported no-cost x64 host and least privilege', () => {
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /runner: windows-11-arm/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.deepEqual(topLevelMap(workflow, 'permissions'), { contents: 'read' });
  assert.match(workflow, /^ {2}WINAPP_CLI_TELEMETRY_OPTOUT: '1'\s*$/m);
  assert.match(workflow, /releases\/download\/v0\.6\.0\/winappcli-x64\.zip/);
  assert.match(workflow, /F6DC42E3B4E4709C8F617003008E2CFDD9A51735E04E7170D60EDDA258DB78A8/);
  assert.ok(workflow.indexOf('Get-FileHash') < workflow.indexOf('Expand-Archive'));
  assert.ok(workflow.indexOf('Expand-Archive') < workflow.indexOf('winapp.exe'));
  assert.doesNotMatch(workflow, /setup-WinAppCli/);
  assert.doesNotMatch(workflow, /id-token:|packages: write|contents: write|secrets\./);
  assert.match(runner, /PROCESSOR_ARCHITECTURE -ne 'AMD64'/);
  assert.match(runner, /SessionId/);
  assert.match(runner, /10\.0\.20348/);
});

test('the supported Windows job executes parser fixtures before certification', () => {
  const ordinary = workflow.slice(workflow.indexOf('\n  certify:'));
  const fixtures = ordinary.indexOf('run: ./scripts/test-wack-report.ps1');
  const builds = [...ordinary.matchAll(/run: npm run msix:pack/g)].map((match) => match.index);
  const inspections = [...ordinary.matchAll(
    /run: npm run msix:inspect -- --structural/g,
  )].map((match) => match.index);
  const certification = ordinary.indexOf('./scripts/run-wack.ps1');
  const installedProof = ordinary.indexOf('npm run msix:prove --');
  assert.ok(fixtures > 0, 'the executable PowerShell fixture suite is not run');
  assert.ok(certification > fixtures, 'certification runs before its parser fixture suite');
  assert.equal(builds.length, 2, 'each proof lane should build one package set');
  assert.equal(inspections.length, 2, 'each proof lane should inspect one package set');
  assert.ok(
    builds[0] < inspections[0] && inspections[0] < certification,
    'WACK consumes packages before structural inspection',
  );
  assert.ok(
    builds[1] < inspections[1] && inspections[1] < installedProof,
    'installed proof consumes packages before structural inspection',
  );
  assert.match(runner, /\. \(Join-Path \$PSScriptRoot 'wack-report\.ps1'\)/);
});

test('WACK builds exact clean package inputs at the canonical version', () => {
  assert.doesNotMatch(workflow, /c5cd22f4351265a9429230572149d72494eb515e/);
  assert.match(workflow, /git diff --exit-code --/);
  for (const input of [
    'LICENSE',
    'packaging/windows',
    'scripts/pack-msix.mjs',
    'scripts/pack-windows.mjs',
    'server.mjs',
    'src',
  ]) {
    assert.match(workflow, new RegExp(input.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(workflow, /RecapPage_2\.0\.0\.0/);
  assert.match(workflow, /\$storeVersion = "\$appVersion\.0"/);
  assert.match(workflow, /id: package-paths/);
  assert.match(workflow, /steps\.package-paths\.outputs\.x64/);
  assert.match(workflow, /steps\.package-paths\.outputs\.bundle/);
  assert.match(workflow, /steps\.package-paths\.outputs\.certificate/);
});

test('WACK proof lanes upload no package, certificate, installer, or raw report', () => {
  const uploads = [...workflow.matchAll(/ {6}- name: Transfer only[\s\S]*?(?=\n {6}- name:|\n {2}[a-z])/g)]
    .map((match) => match[0]);
  assert.equal(uploads.length, 2);
  for (const upload of uploads) {
    assert.match(upload, /path: \|\r?\n {12}dist\/native-(?:launcher|proof)\/build\.json/);
    assert.doesNotMatch(upload, /msix|\.cer|\.pfx|\.log|\.xml|\.bmp|\.png|\*\*/i);
  }
  assert.doesNotMatch(workflow, /cache\/save|gh release|store upload/i);
  assert.doesNotMatch(workflow, /\.pfx|winsdksetup/);
  assert.equal((workflow.match(/Invoke-WebRequest/g) ?? []).length, 3);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /Get-AppxPackage -Name PanelStackLabs\.RecapPage/);
  assert.match(workflow, /Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(workflow, /'\.\/dist'/);
  assert.match(workflow, /Remove-Item -LiteralPath \$path -Recurse -Force/);
  assert.match(runner, /Remove-Item -LiteralPath \$reportRoot -Recurse -Force/);
  assert.doesNotMatch(runner, /Get-Content -LiteralPath .*(stdout|stderr)/);
  assert.match(workflow, /\.github\/browser-proof/);
  assert.match(workflow, /npm ci --prefix \$root --ignore-scripts/);
  assert.doesNotMatch(workflow, /npm install .*puppeteer-core/);
  assert.match(workflow, /--scenario=certification-functionality/);
  assert.match(workflow, /--scenario=busy-port-refusal/);
  assert.match(workflow, /--scenario=update-state-continuity/);
  assert.match(workflow, /npm run msix:inspect -- --structural/);
  assert.match(workflow, /runner: windows-11-arm/);
  const installedCleanup = workflow.match(
    /- name: Remove installed proof material[\s\S]*?shell: (.+)\r?\n/,
  )?.[1];
  assert.equal(installedCleanup, 'powershell');
  assert.match(runner, /Data\.Contains\('WackRejectedSummary'\)/);
  assert.match(runner, /WACK rejected summary: \$safeSummary/);
  assert.match(runner, /throw \$primaryFailure/);
});

test('native producer outputs and job deadlines bind every package consumer', () => {
  assert.match(workflow, /run: \.\/scripts\/build-native-launcher\.ps1 -IncludeProofTools/);
  assert.match(workflow, /run: \.\/scripts\/native-startup-proof\.ps1 -Negatives/);
  assert.equal((workflow.match(/^ {4}needs: native$/gm) ?? []).length, 2);
  assert.equal((workflow.match(/MRT_NATIVE_SHA256:/g) ?? []).length, 2);
  assert.match(workflow, /MRT_NATIVE_PROOF_SHA256: \$\{\{ needs\.native\.outputs\.proof_sha256 \}\}/);
  assert.match(workflow, /native-startup-proof\.ps1 -Architecture '\$\{\{ matrix\.architecture \}\}'/);
  const jobs = workflow.slice(workflow.search(/^jobs:\r?$/m))
    .split(/(?=^ {2}[a-z][\w-]*:)/m).slice(1);
  assert.deepEqual(jobs.map((job) => /^ {2}([\w-]+):/.exec(job)?.[1]), ['native', 'certify', 'installed', 'preparation']);
  assert.match(workflow, /native_only:\r?\n {8}description: .+\r?\n {8}type: boolean\r?\n {8}required: false\r?\n {8}default: false/);
  assert.match(workflow, /diagnostic_only:\r?\n {8}description: .+\r?\n {8}type: boolean\r?\n {8}required: false\r?\n {8}default: false/);
  const predicate = "!(github.event_name == 'workflow_dispatch' && (inputs.native_only == true || inputs.diagnostic_only == true))";
  for (const job of jobs.slice(1, 3)) {
    const expression = job.match(/^ {4}if: \$\{\{ (.+) \}\}\r?$/m)?.[1];
    assert.equal(expression, predicate);
    for (const [event, inputs, expected] of [
      ['workflow_dispatch', { native_only: true }, false],
      ['workflow_dispatch', { native_only: false }, true],
      ['workflow_dispatch', { diagnostic_only: true }, false],
      ['workflow_dispatch', { native_only: false, diagnostic_only: false }, true],
      ['workflow_dispatch', { native_only: true, diagnostic_only: true }, false],
      ['workflow_dispatch', {}, true],
      ['pull_request', { native_only: true }, true],
      ['pull_request', { diagnostic_only: true }, true],
      ['pull_request', { native_only: true, diagnostic_only: true }, true],
      ['pull_request', {}, true],
    ]) {
      assert.equal(runInNewContext(expression, { github: { event_name: event }, inputs }), expected);
    }
    assert.match(jobs[0], /\$env:GITHUB_EVENT_NAME -eq 'workflow_dispatch' -and\r?\n\s*\$env:NATIVE_ONLY -eq 'true' -and \$env:DIAGNOSTIC_ONLY -eq 'true'/);
    assert.ok(jobs[0].indexOf('Reject conflicting manual diagnostic modes') < jobs[0].indexOf('Build both native targets'));
    const nativeStep = (name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return jobs[0].match(new RegExp(` {6}- name: ${escaped}\\r?\\n[\\s\\S]*?(?=\\r?\\n {6}- name:|$)`))?.[0] ?? '';
    };
    const diagnostic = "github.event_name == 'workflow_dispatch' && inputs.diagnostic_only == true";
    const consoleDiagnostic = `${diagnostic} && !(inputs.diagnostic_target == 'handles' || inputs.diagnostic_target == 'f01-smoke')`;
    const handleDiagnostic = `${diagnostic} && inputs.diagnostic_target == 'handles'`;
    for (const name of [
      'Install the checksum-verified diagnostic package tool',
      'Build one diagnostic package set',
      'Inspect the diagnostic package set',
      'Acquire both native and WACK diagnostic facts',
    ]) {
      assert.equal(nativeStep(name).match(/if: \$\{\{ (.+) \}\}/)?.[1], consoleDiagnostic);
    }
    const handleStep = nativeStep('Acquire the focused handle diagnostic');
    assert.equal(handleStep.match(/if: \$\{\{ (.+) \}\}/)?.[1], handleDiagnostic);
    assert.match(handleStep, /native-startup-proof\.ps1 -Diagnostic -DiagnosticTarget handles/);
    assert.doesNotMatch(handleStep, /msix:pack|msix:inspect|run-wack|-Negatives/);
    assert.match(jobs[0], /\$env:DIAGNOSTIC_TARGET -in @\('handles', 'f01-smoke'\) -and \$env:DIAGNOSTIC_ONLY -ne 'true'/);
    const smokeStep = nativeStep('Run bounded F01 and wrapper smoke');
    assert.equal(smokeStep.match(/if: \$\{\{ (.+) \}\}/)?.[1], `${diagnostic} && inputs.diagnostic_target == 'f01-smoke'`);
    assert.match(smokeStep, /timeout-minutes: 6/);
    assert.match(smokeStep, /-DiagnosticTarget f01-smoke/);
    assert.doesNotMatch(smokeStep, /msix:pack|msix:inspect|run-wack|-Negatives/);
    for (const [event, inputs, expectedConsole, expectedHandle] of [
      ['workflow_dispatch', { diagnostic_only: true }, true, false],
      ['workflow_dispatch', { diagnostic_only: true, diagnostic_target: 'console-wack' }, true, false],
      ['workflow_dispatch', { diagnostic_only: true, diagnostic_target: 'handles' }, false, true],
      ['workflow_dispatch', { diagnostic_only: true, diagnostic_target: 'f01-smoke' }, false, false],
      ['workflow_dispatch', { diagnostic_only: false, diagnostic_target: 'handles' }, false, false],
      ['pull_request', { diagnostic_only: true, diagnostic_target: 'handles' }, false, false],
    ]) {
      const context = { github: { event_name: event }, inputs };
      assert.equal(runInNewContext(consoleDiagnostic, context), expectedConsole);
      assert.equal(runInNewContext(handleDiagnostic, context), expectedHandle);
    }
    assert.equal(nativeStep('Prove startup negatives and reviewed placement').match(/if: \$\{\{ (.+) \}\}/)?.[1], `!(${diagnostic})`);
    const acquisition = nativeStep('Acquire both native and WACK diagnostic facts');
    assert.equal((acquisition.match(/\btry \{/g) ?? []).length, 2);
    assert.equal((acquisition.match(/\bcatch \{/g) ?? []).length, 2);
    assert.ok(acquisition.indexOf('-Diagnostic') < acquisition.indexOf('./scripts/run-wack.ps1'));
    assert.ok(acquisition.indexOf('$failures.Count') > acquisition.indexOf('./scripts/run-wack.ps1'));
    assert.match(acquisition, /throw \[AggregateException\]/);
    assert.doesNotMatch(workflow, /continue-on-error/);
  }
  for (const job of jobs) {
    const backstop = Number(job.match(/^ {4}timeout-minutes: (\d+)/m)?.[1]);
    const steps = [...job.matchAll(/^ {8}timeout-minutes: (\d+)/gm)].map((match) => Number(match[1]));
    assert.equal(steps.length, (job.match(/^ {6}- (?:name|uses):/gm) ?? []).length);
    assert.ok(steps.length > 0 && backstop > steps.reduce((sum, value) => sum + value, 0));
  }
});

test('native artifact transfer pins exact inputs and refuses digest mismatches', async (t) => {
  const fixtureSource = readFileSync(new URL('./native/Launcher.fixture.mjs.in', import.meta.url), 'utf8');
  const publisher = fixtureSource.match(/^function publishFixtureRecord\([\s\S]*?^\}/m)?.[0] ?? '';
  const observedWrite = fixtureSource.match(/^(?:writeFileSync\(join\(root, 'observed\.txt'\),|publishFixtureRecord\('observed\.txt',) \[[\s\S]*?\]\.join\('\\n'\)\);/m)?.[0];
  assert.ok(observedWrite, 'the actual observed-record publisher is missing');
  const fixtureRoot = 'inert-fixture';
  const finalRecord = join(fixtureRoot, 'observed.txt');
  const records = new Map();
  let partialFinalVisible = false;
  let renames = 0;
  runInNewContext(`${publisher}\n${observedWrite}`, {
    root: fixtureRoot, join,
    process: { pid: 123, argv: ['node', 'Launcher.mjs', '--gui-startup-v1'], env: {}, cwd: () => fixtureRoot },
    existsSync: (path) => records.has(path),
    writeFileSync: (path, value) => {
      records.set(path, { text: '', closed: false });
      partialFinalVisible ||= records.has(finalRecord) && !records.get(finalRecord).closed;
      records.set(path, { text: value, closed: true });
    },
    renameSync: (source, destination) => {
      assert.equal(dirname(source), dirname(destination));
      assert.equal(records.get(source)?.closed, true, 'rename happened before complete close');
      assert.equal(records.has(destination), false, 'publication overwrote a completed record');
      records.set(destination, records.get(source));
      records.delete(source);
      renames += 1;
    },
  });
  assert.equal(partialFinalVisible, false, 'final fixture record is visible before all bytes are published');
  assert.equal(renames, 1, 'observed record was not published by a single same-directory rename');
  assert.equal(records.get(finalRecord)?.text, 'pid=123\narguments=true\nenvironment=true\ncwd=true');
  assert.match(fixtureSource, /publishFixtureRecord\('sentinel\.txt', String\(child\.pid\)\)/);
  t.diagnostic('PASS atomic-fixture-publication original-interleaving-defended=1 unchanged-record=1');
  const installedProof = readFileSync(new URL('../scripts/msix-proof.mjs', import.meta.url), 'utf8');
  const mainSource = installedProof.match(/^async function main\([\s\S]*?^\}/m)?.[0];
  const descriptorSource = installedProof.match(/^function createSemanticCapture\([\s\S]*?^\}/m)?.[0]
    .replace('fileURLToPath(import.meta.url)', 'proofModule');
  assert.ok(mainSource && descriptorSource, 'the actual CLI or descriptor producer is missing');
  const descriptorCases = [
    { args: ['--architecture=x64', '--source=package', '--scenario=certification-functionality'], architecture: 'x64', source: 'package' },
    { args: ['--source=bundle', '--scenario=certification-functionality', '--architecture=arm64'], architecture: 'arm64', source: 'bundle' },
    { args: ['--scenario=certification-functionality'], architecture: 'x64', source: 'package' },
    { args: ['--scenario=certification-functionality', '--source=bundle'], architecture: 'x64', source: 'bundle' },
  ];
  for (const item of descriptorCases) {
    let descriptor;
    await runInNewContext(`${descriptorSource}\n${mainSource}
      function certificationFunctionality(architecture, source) {
        createSemanticCapture('inert-control', architecture, 'functionality', source);
      }
      main();`, {
      SCENARIOS: ['certification-functionality', 'busy-port-refusal', 'update-state-continuity'],
      ARCHITECTURES: ['x64', 'arm64'],
      process: { pid: 123, execPath: 'X:\\fixture\\node.exe', argv: ['node', 'msix-proof.mjs', ...item.args] },
      proofModule: 'X:\\fixture\\scripts\\msix-proof.mjs',
      loadStartupEvidence: async () => {},
      console: { log: () => {} },
      resolveEdge: () => '',
      publishSemanticRecord: (root, name, text) => {
        assert.equal(root, 'inert-control');
        assert.equal(name, 'semantic-caller.txt');
        descriptor = text.split('\n');
      },
    });
    assert.equal(descriptor?.[5], 'functionality');
    assert.equal(descriptor?.[6], item.architecture);
    assert.equal(descriptor?.[7], item.source, 'actual equals-form CLI source was changed in the semantic descriptor');
  }
  t.diagnostic('PASS actual-cli-descriptors cases=4 package-bundle-defaults-order=1');
  const shellWrapper = installedProof.match(/^function powershell\([\s\S]*?^\}/m)?.[0];
  const listenerQuery = installedProof.match(/^function listenerPid\([\s\S]*?^\}/m)?.[0];
  assert.ok(shellWrapper && listenerQuery, 'the actual installed helper/query definitions are missing');
  const operations = [];
  let requestedScript;
  const listener = runInNewContext(`${shellWrapper}\n${listenerQuery}\nlistenerPid();`, {
    ROOT: 'inert-proof-root',
    activeSemanticCapture: {
      begin: (operation, script) => {
        operations.push(`begin:${operation}`);
        requestedScript = script;
        return { operation };
      },
      end: (ticket, failed) => operations.push(`end:${ticket.operation}:${failed}`),
    },
    execFileSync: (executable, args, options) => {
      operations.push('execute');
      assert.equal(executable, 'powershell');
      assert.equal(args[0], '-NoProfile');
      assert.equal(args[1], '-NonInteractive');
      assert.equal(args[2], '-Command');
      assert.deepEqual(Object.keys(options).sort(), ['cwd', 'encoding', 'maxBuffer']);
      if (requestedScript !== undefined) assert.equal(args[3], requestedScript);
      return '42\n';
    },
  });
  assert.equal(listener, 42);
  assert.deepEqual(operations, ['begin:listener-query', 'execute', 'end:listener-query:false'],
    'the existing listener helper ran without native operation fences');
  t.diagnostic('PASS existing-helper-binding fixed-listener=1 unchanged-presentation-options=1');
  assert.equal((workflow.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/g) ?? []).length, 4);
  assert.equal((workflow.match(/actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/g) ?? []).length, 3);
  assert.equal((workflow.match(/digest-mismatch: error/g) ?? []).length, 3);
  const inputs = [...workflow.matchAll(/^ {12}(dist\/native-(?:launcher|proof)\/.+)$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(inputs, [
    'dist/native-launcher/build.json',
    'dist/native-launcher/x64/RecapPageLauncher.exe',
    'dist/native-launcher/arm64/RecapPageLauncher.exe',
    'dist/native-proof/build.json',
    'dist/native-proof/x64/NativeStartupTests.exe',
    'dist/native-proof/arm64/NativeStartupTests.exe',
  ]);
  const previews = [...workflow.matchAll(/^ {12}(dist\/native-preview\/.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(previews, [
    'dist/native-preview/x64/pending-dark.bmp',
    'dist/native-preview/x64/evidence.json',
    'dist/native-preview/${{ matrix.architecture }}/pending-dark.bmp',
    'dist/native-preview/${{ matrix.architecture }}/evidence.json',
  ]);
  assert.match(workflow, /steps\.f01_smoke\.outputs\.preview_ready == 'true'/);
  assert.match(workflow, /steps\.native_fixtures\.outputs\.preview_ready == 'true'/);
  assert.equal((workflow.match(/retention-days: 1/g) ?? []).length, 4);
  assert.doesNotMatch(workflow, /merge-multiple: true|include-hidden-files: true|overwrite: true/);
  const proof = readFileSync(new URL('../scripts/native-startup-proof.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(proof, /ReadToEndAsync|\.WaitForExit\(\)/);
  assert.match(proof, /\$entry\.Task\.IsCompleted/);
  assert.match(proof, /FixtureJob\]::new/);
  assert.ok(proof.indexOf('$job.Assign($process.Handle)') < proof.indexOf("WriteAllText($go, 'contained'"));
  assert.match(proof, /Write-Host \$line/);
  assert.match(proof, /wrapper-held-writer/);
  assert.match(proof, /wrapper-stall/);
  assert.match(proof, /held-writer-drain/);
  assert.match(proof, /RestoreContrast\(\$contrast\)/);
  assert.match(proof, /\$limit = 290000/);
  assert.match(proof, /function Export-NativePreview/);
  assert.match(proof, /\$bytes\.Length -gt 4MB/);
  assert.match(proof, /renderedReviewRequired/);
  assert.match(proof, /preview_ready=true/);
  assert.match(proof, /@\('N1', 'N2', 'N3', 'LC-001'\)/);
  assert.match(proof, /review-original-condition/);
  assert.match(proof, /FAIL code=lc001-failure-outside-work-area/);
  assert.match(proof, /--mode', 'calibration'/);
  assert.match(proof, /-TotalTimeoutMs 60000/);
  assert.ok(proof.indexOf('calibration-preflight.txt') < proof.indexOf('$runtimeInfo = (& node'));
  assert.ok(proof.indexOf('calibration-preflight.txt') < proof.indexOf('$mutations ='));
  const native = readFileSync(new URL('./native/StartupTests.cpp', import.meta.url), 'utf8');
  assert.match(native, /LC-001 failure rectangle escaped the current monitor work area/);
  assert.doesNotMatch(native, /calibration\(observer\)/);
  assert.match(native, /reportCalibrationFailure/);
  assert.match(native, /checkpoint\("FAIL", "calibration"\)/);
  assert.match(native, /writeFailure\(report, failure,/);
  assert.match(native, /child\.primaryThread = recap::Handle\(process\.hThread\)/);
  assert.match(native, /observer\.bindClient\(control\.pid, control\.process\.get\(\), control\.primaryThread\.get\(\), control\.primaryTid, true\)/);
  assert.match(native, /cases=22 passed=22/);
  assert.match(native, /observer\.assertCalibrations\(controls, report\)/);
  const observer = readFileSync(new URL('./native/StartupObserver.h', import.meta.url), 'utf8');
  const filesystemInclude = observer.match(/^#include <filesystem>\r?$/m);
  assert.ok(filesystemInclude && filesystemInclude.index < observer.indexOf('std::filesystem::'),
    'StartupObserver must include filesystem before its direct uses');
  assert.match(observer, /struct ConsoleBinding/);
  assert.match(observer, /correlateWindows\(windows_, clockValid\(\), healthy\(\), consoleBindings\(\)\)/);
  assert.match(observer, /recap::samePath\(value\.image, classicHostImage_\)/);
  assert.match(observer, /row\.consoleBound && row\.completeControl/);
  assert.match(observer, /struct ProcessGraph/);
  assert.match(observer, /CHECK ENTER final-observer-closure/);
  assert.match(observer, /registered-visual-helper/);
  assert.match(native, /process-instance-cases cases=6 passed=6/);
  assert.match(native, /pending footer text ink was not captured/);
  assert.match(native, /fixture-record-cases cases=18 passed=18 max_bytes=256 no_bad_record_retry=1/);
  assert.match(native, /fixture-observed-parse/);
  assert.match(native, /fixture-sentinel-retain/);
  assert.doesNotMatch(native, /stoul\(observed\.substr/);
  assert.match(proof, /\$Result\.NonNativeFailure/);
  assert.match(native, /app-contract-cases actors=32 host=8 passed=40/);
  assert.match(native, /fixture-cleanup-cases fixtures=7 diagnostic=1 passed=8 old_exit_rule_rejected=2/);
  assert.match(native, /observed\("fixture-cleanup-cases", \[\] \{ fixtureCleanupCases\(\); \}\)/);
  assert.match(observer, /startup::applyFixtureExit\(fact, identity,/);
  assert.match(observer, /startup::prioritizeActorContext\(finalActorContexts_, linked, context\)/);
  assert.match(native, /console-api-host-cases rows=12 role_evaluations=10 window_evaluations=3 passed=12/);
  assert.match(native, /observed\("console-api-host-cases", \[\] \{ consoleApiHostCases\(\); \}\)/);
  assert.match(observer, /appChildEvidence\(graph, threads, index, parent, facts\[parent\], image, classicHostImage_\)/);
  assert.match(observer, /appWindowEvidence\(raw, identity, linked, linkedOwner, apiHost, consoleAssociation\)/);
  assert.match(native, /ObservationProfile::nativeFixture, verifyFixedFixture\(options\[L"--fixture"\]\)/);
  assert.match(observer, /unknown_object_metadata=/);
  assert.match(observer, /unassessed_global=/);
  assert.doesNotMatch(observer, /const std::vector<DWORD>& roots, bool installed/);
  assert.match(proof, /footerInkPixels -lt 64/);
  assert.match(observer, /temporary_closed=/);
  assert.doesNotMatch(observer, /ConsoleControl\(|ConsoleSetWindowOwner/);
  assert.match(proof, /function Test-NativeSuiteResult/);
  assert.match(proof, /if \(-not \(Test-NativeSuiteResult \$result\)\)/);
  assert.match(observer, /EVENT_TRACE_FLAG_PROCESS \| EVENT_TRACE_FLAG_THREAD/);
  assert.match(observer, /property\(event, L"TThreadId"\)/);
  assert.match(observer, /sourceSnapshot\(graph, report\)/);
  assert.match(native, /source-lifetime-cases cases=24 passed=24/);
  assert.match(native, /semantic-cases cases=16 passed=16 diagnostic_only=1 acceptance_inputs=0/);
  assert.match(native, /caller-context-cases rows=8 passed=8 acceptance_unchanged=1/);
  assert.match(installedProof, /context\.installed, architecture, source, 'functionality'/);
  assert.match(installedProof, /withNativeObservation\(context\.installed, architecture, source, 'busy'/);
  assert.match(observer, /delegated_association_known=0/);
  const scripts = new Map();
  const declarations = ['psLiteral', 'packageInfo', 'packageProcesses', 'processExists', 'listenerPid', 'browserSnapshotDigest', 'activate']
    .map((name) => {
      const definition = installedProof.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
      assert.ok(definition, `existing ${name} definition is missing`);
      return definition;
    }).join('\n');
  runInNewContext(`${declarations}
    packageInfo();
    packageProcesses({ InstallLocation: 'X:\\\\fixture' }, new Date('2026-01-02T03:04:05.006Z'));
    processExists(42); listenerPid(); browserSnapshotDigest(); activate();`, {
    PACKAGE_NAME: 'PanelStackLabs.RecapPage',
    PACKAGE_FAMILY: 'PanelStackLabs.RecapPage_we33aa8nvkpcc',
    AUMID: 'PanelStackLabs.RecapPage_we33aa8nvkpcc!App',
    powershell: (script, operation) => { scripts.set(operation, script); return '[]'; },
    createHash: () => ({ update: () => ({ digest: () => 'inert-digest' }) }),
  });
  const nativeLiteral = (name) => {
    const value = observer.match(new RegExp(`${name}\\[\\] = LR"SEM\\(([\\s\\S]*?)\\)SEM";`))?.[1];
    assert.notEqual(value, undefined, `${name} fixed native predicate is missing`);
    return value;
  };
  assert.equal(scripts.size, 6);
  assert.equal(scripts.get('listener-query'), nativeLiteral('SemanticListenerScript'));
  assert.equal(scripts.get('package-info-query'), nativeLiteral('SemanticPackageInfoScript'));
  assert.equal(scripts.get('browser-snapshot-query'), nativeLiteral('SemanticBrowserScript'));
  assert.equal(scripts.get('package-process-query'),
    `$since = [datetime]'2026-01-02T03:04:05.006Z${nativeLiteral('SemanticPackageSuffix')}`);
  assert.equal(scripts.get('aumid-activate'),
    "Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\PanelStackLabs.RecapPage_we33aa8nvkpcc!App'");
  assert.equal(scripts.get('process-exists-query'),
    'if (Get-Process -Id 42 -ErrorAction SilentlyContinue) { "true" } else { "false" }');
  t.diagnostic('PASS fixed-operation-scripts actual-callers=6 native-predicates=6');
  if (process.platform === 'win32') {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File',
      fileURLToPath(new URL('./native/proof-report.ps1', import.meta.url)),
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
    assert.match(output, /PASS report-limits line-count=4096 size=1048576 poisoned-reparse=0/);
    assert.match(output, /PASS cleanup-accounting report-fatal-clean=1 secondary-faults=2 stages-attempted=7/);
    assert.match(output, /PASS native-primary-preserved residue-secondary=1 cleanup-does-not-upgrade=1/);
    assert.match(output, /PASS suite-result-shapes accepted=2 invalid-labels=9 invalid-outcomes=8/);
    assert.match(output, /PASS semantic-diagnostics frozen-definitions=6 separate-registration=1/);
    assert.match(output, /PASS host-completion-consumer configurations=12 expected-native-primary-preserved=1/);
    assert.match(output, /PASS builder-node-resolution configurations=8 assertions=16 proof-and-production=1 native-starts=0/);
    assert.match(output, /PASS completed-native-report configurations=7 assertions=8 specific-before-fallback=1/);
    assert.match(output, /PASS composer-completion-guard configurations=6 assertions=8 stdout-and-exit-required=1/);
    assert.match(output, /PASS installed-journey-workflow configurations=6 assertions=8 live-output=1 final-record-and-exit=1/);
    assert.match(output, /PASS native-control-status configurations=8 actual-completion-chain=1/);
    assert.match(output, /PASS proof-report-fixtures assertions=178/);
    t.diagnostic(output.trim());
  } else {
    t.diagnostic('Windows-only inert PowerShell reporting fixtures were not executed on this host.');
  }
  assert.doesNotMatch(previews.join('\n'), /\*{2}|\.xml|\.pfx|\.cer|trace|error|desktop/);
});

test('app startup prerequisites preserve native-only and all five installed journey routes', () => {
  const jobs = [...workflow.slice(workflow.indexOf('\njobs:')).matchAll(/^ {2}[a-z]+:\r?$/gm)];
  const expression = workflow.match(/^ {4}if: \$\{\{ (.+inputs\.native_only.+) \}\}\r?$/m)?.[1];
  assert.ok(expression);
  for (const [event, inputs, enabled] of [
    ['workflow_dispatch', { native_only: true, diagnostic_only: false }, false],
    ['workflow_dispatch', { native_only: false, diagnostic_only: false }, true],
    ['workflow_dispatch', {}, true],
    ['pull_request', { native_only: true }, true],
    ['pull_request', {}, true],
    ['workflow_dispatch', { diagnostic_only: true }, false],
  ]) assert.equal(runInNewContext(expression, { github: { event_name: event }, inputs }), enabled);
  assert.equal(jobs.length, 4);
  assert.match(workflow, /--scenario=certification-functionality/);
  assert.match(workflow, /--scenario=busy-port-refusal/);
  assert.match(workflow, /--scenario=update-state-continuity/);
  assert.match(workflow, /scripts\/lib\/startup-contract\.mjs/);
  const build = readFileSync(new URL('../scripts/build-native-launcher.ps1', import.meta.url), 'utf8');
  assert.ok(build.indexOf('production-creation tests failed') < build.indexOf('foreach ($architecture'));
  assert.match(build, /WaitForExit\(120000\)/);
});

const preparation = workflow.slice(workflow.indexOf('\n  preparation:'));

test('portable preparation excludes nonmanual and incomplete proof executions', () => {
  assert.match(workflow, /release_preparation:\r?\n {8}description: .+\r?\n {8}type: boolean\r?\n {8}required: false\r?\n {8}default: false/);
  const expression = preparation.match(/^ {4}if: \$\{\{ (.+) \}\}\r?$/m)?.[1];
  assert.ok(expression);
  let cases = 0;
  for (const event of ['workflow_dispatch', 'pull_request', 'push', 'release']) {
    for (const release_preparation of [true, false, undefined]) {
      for (const native_only of [true, false]) {
        for (const diagnostic_only of [true, false]) {
          const expected = event === 'workflow_dispatch' && release_preparation === true
            && !native_only && !diagnostic_only;
          assert.equal(runInNewContext(expression, {
            github: { event_name: event }, inputs: { release_preparation, native_only, diagnostic_only },
          }), expected, `${event}/${release_preparation}/${native_only}/${diagnostic_only}`);
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 48);
  assert.match(workflow, /\$env:RELEASE_PREPARATION -eq 'true' -and\r?\n\s*\(\$env:NATIVE_ONLY -eq 'true' -or \$env:DIAGNOSTIC_ONLY -eq 'true'\)/);
  assert.match(preparation, /runs-on: windows-2022/);
  assert.match(preparation, /fetch-depth: 0/);
  assert.match(preparation, /persist-credentials: false/);
  assert.doesNotMatch(preparation, /needs:|secrets\.|msix:|winapp|build-native|native-startup|continue-on-error/);
});

test('portable preparation runs the bounded release commands and cleans independently', () => {
  const commands = [...preparation.matchAll(/^ {8}run: (npm .+)\r?$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, [
    'npm ci --ignore-scripts', 'npm run lint', 'npm test', 'npm run counts',
    'npm run sizes', 'npm run anchors', 'npm run spacing', 'npm run palette',
    'npm run publication', 'npm run contract', 'npm run browser', 'npm run upgrade',
    'npm run store:check', 'npm run pack',
  ]);
  assert.match(preparation, /\.github\/browser-proof/);
  assert.match(preparation, /npm ci --prefix \$root --ignore-scripts\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(preparation, /node \$verifier\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/);
  const steps = [...preparation.matchAll(/^ {8}timeout-minutes: (\d+)/gm)].map((match) => Number(match[1]));
  assert.equal(steps.length, (preparation.match(/^ {6}- name:/gm) ?? []).length);
  assert.ok(Number(preparation.match(/^ {4}timeout-minutes: (\d+)/m)?.[1]) > steps.reduce((a, b) => a + b, 0));
  const cleanup = preparation.slice(preparation.indexOf('      - name: Remove portable preparation material'));
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /foreach \(\$path[\s\S]*try \{[\s\S]*catch \{ \$failures \+= \$_\.Exception \}/);
  assert.match(cleanup, /throw \[AggregateException\]/);
  for (const path of ['recap-release-puppeteer', 'recap-release-preparation', 'dist']) {
    assert.ok(cleanup.includes(`'${path}'`));
  }
  assert.doesNotMatch(cleanup, /SilentlyContinue/);
});

test('portable preparation verifies its own payload and allowlisted provenance', async () => {
  const upload = preparation.match(/ {6}- name: Retain only the portable candidate and provenance[\s\S]*?(?=\n {6}- name:)/)?.[0];
  assert.ok(upload);
  assert.deepEqual([...upload.matchAll(/^ {12}(dist\/.+)\r?$/gm)].map((match) => match[1]), [
    'dist/marvel-reading-tracker-windows.zip', 'dist/release-preparation.json',
  ]);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /if-no-files-found: error/);
  assert.doesNotMatch(upload, /if: always|\.msix|\.cer|\.pfx|\*/);
  const inline = preparation.match(/ {10}@'\r?\n([\s\S]*?)\r?\n {10}'@ \| Set-Content/)?.[1];
  assert.ok(inline, 'the executable inline verifier is missing');
  const source = inline.replace(/^ {10}/gm, '');
  assert.match(source, /\nawait main\(\);$/);
  const library = source.replace(/\nawait main\(\);$/, '');
  const { verifyPortableEntries, verifyPortableNames, candidateRecord } = await import(
    `data:text/javascript;base64,${Buffer.from(library).toString('base64')}`
  );
  const expected = new Map([
    ['Start on Windows.cmd', Buffer.from('command launcher')],
    ['server.mjs', Buffer.from('server')],
    ['src/js/lib/version.js', Buffer.from('2.1.0')],
    ['LICENSE', Buffer.from('app licence')],
    ['Read this first.txt', Buffer.from('command window instructions')],
    ['runtime/LICENSE-node.txt', Buffer.from('complete official runtime licence')],
    ['runtime/node.exe', Buffer.from('official x64 runtime')],
  ]);
  const names = [...expected.keys()].map((name) => `recap-page/${name}`);
  verifyPortableNames(expected, names, 'recap-page');
  verifyPortableNames(expected, [...names, 'recap-page/', 'recap-page/runtime/'], 'recap-page');
  for (const invalid of [
    [...names, names[0]], [...names, '../outside'], [...names, 'recap-page/unexpected/'],
    names.slice(1), names.map((name) => name.replace('/', '\\')),
  ]) assert.throws(() => verifyPortableNames(expected, invalid, 'recap-page'));
  verifyPortableEntries(expected, new Map(expected));
  for (const name of expected.keys()) {
    const missing = new Map(expected);
    missing.delete(name);
    assert.throws(() => verifyPortableEntries(expected, missing), /allowlist/);
    const changed = new Map(expected);
    changed.set(name, Buffer.from('changed'));
    assert.throws(() => verifyPortableEntries(expected, changed), /portable bytes/);
  }
  for (const extra of ['RecapPageLauncher.exe', 'unexpected.txt', 'runtime/helper.EXE']) {
    const actual = new Map(expected);
    actual.set(extra, Buffer.from('unapproved'));
    assert.throws(() => verifyPortableEntries(expected, actual), /allowlist/);
  }
  const input = {
    repository: 'raymond-nassar/recap-page', commit: 'a'.repeat(40), expectedCommit: 'a'.repeat(40),
    tree: 'b'.repeat(40), version: '2.1.0', lockVersion: '2.1.0', browserVersion: '2.1.0',
    runId: '123', runAttempt: '1', nodeVersion: 'v24.19.0', nodeArchitecture: 'win-x64',
    nodeHash: 'c'.repeat(64), bytes: 1234, sha256: 'd'.repeat(64),
  };
  const record = candidateRecord({ ...input, privateValue: 'must not escape' });
  assert.deepEqual(Object.keys(record), [
    'schemaVersion', 'repository', 'commit', 'tree', 'applicationVersion',
    'workflow', 'archive', 'bundledNode', 'portableLauncher',
  ]);
  assert.deepEqual(record.archive, { file: 'marvel-reading-tracker-windows.zip', bytes: 1234, sha256: input.sha256 });
  assert.deepEqual(record.bundledNode, { version: 'v24.19.0', architecture: 'win-x64', sha256: input.nodeHash });
  assert.equal(record.portableLauncher, 'Start on Windows.cmd');
  for (const change of [
    { repository: 'other/repo' }, { expectedCommit: 'e'.repeat(40) }, { tree: 'invalid' },
    { lockVersion: '2.0.3' }, { browserVersion: '2.0.3' }, { version: '2.1.0.0' },
    { runId: '0' }, { runAttempt: '0' }, { nodeArchitecture: 'win-arm64' },
    { nodeVersion: process.version.replace(/^v24/, 'v99') }, { nodeHash: 'bad' },
    { bytes: 0 }, { sha256: 'bad' },
  ]) assert.throws(() => candidateRecord({ ...input, ...change }));
  assert.match(source, /await fetchRuntime\(NODE_ARCH\)/);
  assert.match(source, /readFile\(join\(official, 'LICENSE'\)\)/);
  assert.match(source, /for \(const name of appFiles\(\)\)/);
  assert.match(source, /verifyPortableEntries\(expected, await entries/);
  assert.ok(source.indexOf('verifyPortableNames(expected, names, PAYLOAD_NAME)')
    < source.indexOf("unpack(archivePath, join(scratch, 'portable'))"));
  assert.match(source, /expectedCommit: process\.env\.GITHUB_SHA/);
  assert.match(source, /nodeVersion: NODE_VERSION, nodeArchitecture: NODE_ARCH/);
  assert.match(source, /digest\(await readFile\(archivePath\)\), record\.archive\.sha256/);
  assert.doesNotMatch(source, /process\.version|RecapPageLauncher\.exe/);
});
