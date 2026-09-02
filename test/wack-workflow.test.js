import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
      '.github/browser-proof/**',
      'LICENSE',
      'package.json',
      'packaging/windows/**',
      'server.mjs',
      'src/**',
      'scripts/inspect-msix.mjs',
      'scripts/msix-proof.mjs',
      'scripts/pack-msix.mjs',
      'scripts/pack-windows.mjs',
      'scripts/run-wack.ps1',
      'scripts/test-wack-report.ps1',
      'scripts/wack-report.ps1',
      'test/msix-packaging.test.js',
      'test/server-contract.test.js',
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
  const fixtures = workflow.indexOf('run: ./scripts/test-wack-report.ps1');
  const builds = [...workflow.matchAll(/run: npm run msix:pack/g)].map((match) => match.index);
  const inspections = [...workflow.matchAll(
    /run: npm run msix:inspect -- --structural/g,
  )].map((match) => match.index);
  const certification = workflow.indexOf('./scripts/run-wack.ps1');
  const installedProof = workflow.indexOf('npm run msix:prove --');
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

test('WACK uploads no package, certificate, installer, or raw report', () => {
  assert.doesNotMatch(workflow, /upload-artifact|cache\/save|gh release|store upload/i);
  assert.doesNotMatch(workflow, /\.pfx|winsdksetup/);
  assert.equal((workflow.match(/Invoke-WebRequest/g) ?? []).length, 2);
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
});
