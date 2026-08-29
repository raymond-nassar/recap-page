import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/wack.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/run-wack.ps1', import.meta.url), 'utf8');

test('WACK is manual except when its own automation changes', () => {
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.match(workflow, /^  pull_request:\s*$/m);
  const paths = workflow.match(/    paths:\r?\n((?:      - .+\r?\n)+)/)?.[1] ?? '';
  assert.deepEqual(
    [...paths.matchAll(/      - (.+)/g)].map((match) => match[1]),
    ['.github/workflows/wack.yml', 'scripts/run-wack.ps1'],
  );
  assert.doesNotMatch(workflow, /pull_request_target|schedule:|^  push:/m);
});

test('WACK uses the supported no-cost x64 host and least privilege', () => {
  assert.match(workflow, /runs-on: windows-2022/);
  assert.deepEqual(
    [...workflow.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gm)].map((match) => match[1]),
    ['windows-2022'],
  );
  assert.match(workflow, /^permissions:\r?\n  contents: read\s*$/m);
  assert.match(workflow, /^  WINAPP_CLI_TELEMETRY_OPTOUT: '1'\s*$/m);
  assert.doesNotMatch(workflow, /id-token:|packages: write|contents: write|secrets\./);
  assert.match(runner, /PROCESSOR_ARCHITECTURE -ne 'AMD64'/);
  assert.match(runner, /SessionId/);
  assert.match(runner, /10\.0\.20348/);
});

test('WACK preserves the accepted corrected package source boundary', () => {
  assert.match(workflow, /c5cd22f4351265a9429230572149d72494eb515e HEAD/);
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
});

test('WACK uploads no package, certificate, installer, or raw report', () => {
  assert.doesNotMatch(workflow, /upload-artifact|cache\/save|gh release|store upload/i);
  assert.doesNotMatch(workflow, /\.pfx|winsdksetup|Invoke-WebRequest/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /Get-AppxPackage -Name PanelStackLabs\.RecapPage/);
  assert.match(workflow, /Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(workflow, /Remove-Item -LiteralPath \.\/dist/);
  assert.match(runner, /Remove-Item -LiteralPath \$reportRoot -Recurse -Force/);
  assert.doesNotMatch(runner, /Get-Content -LiteralPath .*(stdout|stderr)/);
});

test('WACK fails closed on tool identity, incomplete reports, and cleanup residue', () => {
  assert.match(runner, /O=Microsoft Corporation/);
  assert.match(runner, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(runner, /DtdProcessing = \[Xml\.DtdProcessing\]::Prohibit/);
  assert.match(runner, /\$summary\.Overall -eq 'PASS'/);
  assert.match(runner, /\$summary\.PartialRun -eq 'FALSE'/);
  assert.match(runner, /\$summary\.LatestVersion -eq 'TRUE'/);
  assert.match(runner, /if \(-not \$completePass\)/);
  assert.match(runner, /package identity remains after WACK cleanup/);
  assert.match(runner, /temporary WACK certificate remains trusted after cleanup/);
  assert.match(runner, /raw WACK report directory remains after cleanup/);
});
