import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUMID, PACKAGE_FAMILY, PACKAGE_NAME, PACKAGE_VERSIONS, packagePath,
} from './pack-msix.mjs';

export const SCENARIOS = Object.freeze([
  'start-profile-reader-relaunch',
  'busy-port-refusal',
  'update-state-continuity',
]);

export const MUTATIONS = Object.freeze({
  'canonical-origin': 'start-profile-reader-relaunch',
  'synchronous-reader': 'start-profile-reader-relaunch',
  'update-state': 'update-state-continuity',
});

const ORIGIN = 'http://127.0.0.1:8787';
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));

function powershell(script) {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32e6 },
  ).trim();
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function packageInfo() {
  const raw = powershell(
    `$p = Get-AppxPackage -Name ${psLiteral(PACKAGE_NAME)} | Sort-Object Version -Descending | Select-Object -First 1; `
    + 'if (-not $p) { "null"; exit 0 }; '
    + '$p | Select-Object Name,PackageFullName,PackageFamilyName,InstallLocation,Version | ConvertTo-Json -Compress',
  );
  return JSON.parse(raw);
}

function assertNoPreexistingPackage() {
  const installed = packageInfo();
  if (installed) {
    throw new Error(
      `refusing to replace pre-existing package ${installed.PackageFullName}; remove it explicitly first`,
    );
  }
}

function packageProcesses(installed, since = new Date(0)) {
  const raw = powershell(
    `$root = ${psLiteral(installed.InstallLocation)}; `
    + `$since = [datetime]${psLiteral(since.toISOString())}; `
    + '$rows = Get-CimInstance Win32_Process | Where-Object { '
    + '$_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) '
    + '} | ForEach-Object { $created = [datetime]$_.CreationDate; '
    + 'if ($created -ge $since) { [pscustomobject]@{ Name = $_.Name; ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; ExecutablePath = $_.ExecutablePath; CreationDate = $created.ToString("o"); CommandLine = $_.CommandLine } } }; '
    + '@($rows) | ConvertTo-Json -Compress',
  );
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function stopPids(pids) {
  for (const pid of [...new Set(pids)].filter((value) => Number.isInteger(value) && value > 0)) {
    powershell(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id ${pid}; Wait-Process -Id ${pid} -ErrorAction SilentlyContinue }`);
  }
}

function installPackage(version) {
  const path = packagePath(version);
  if (!existsSync(path)) throw new Error(`missing package: ${path}`);
  powershell(`Add-AppxPackage -Path ${psLiteral(path)} -ForceApplicationShutdown`);
  const installed = packageInfo();
  if (!installed) throw new Error(`package ${version} was not registered after installation`);
  if (String(installed.Version) !== version) {
    throw new Error(`installed ${installed.Version}, expected ${version}`);
  }
  if (installed.Name !== PACKAGE_NAME || installed.PackageFamilyName !== PACKAGE_FAMILY) {
    throw new Error(`installed identity differs: ${installed.Name}, ${installed.PackageFamilyName}`);
  }
  return installed;
}

function removePackage(packageFullName) {
  if (
    typeof packageFullName !== 'string'
    || !packageFullName.startsWith(`${PACKAGE_NAME}_`)
  ) {
    throw new Error('refusing to remove a package without its exact owned full name');
  }
  powershell(
    `$p = Get-AppxPackage -Name ${psLiteral(PACKAGE_NAME)} | Where-Object PackageFullName -eq ${psLiteral(packageFullName)}; `
    + 'if ($p) { Remove-AppxPackage -Package $p.PackageFullName }',
  );
}

function activate() {
  powershell(`Start-Process explorer.exe -ArgumentList ${psLiteral(`shell:AppsFolder\\${AUMID}`)}`);
}

function winappJson(args) {
  const raw = execFileSync('winapp', [...args, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32e6,
  });
  return JSON.parse(raw || 'null');
}

function terminalWindows() {
  return winappJson(['ui', 'list-windows', '-a', 'WindowsTerminal']) ?? [];
}

function findTermControl(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.className === 'TermControl' && value.selector) return value.selector;
  for (const child of value.children ?? []) {
    const found = findTermControl(child);
    if (found) return found;
  }
  for (const child of value.elements ?? []) {
    const found = findTermControl(child);
    if (found) return found;
  }
  for (const child of value.windows ?? []) {
    const found = findTermControl(child);
    if (found) return found;
  }
  return null;
}

function terminalText(hwnd) {
  const tree = winappJson(['ui', 'inspect', '-w', String(hwnd), '--depth', '8']);
  const selector = findTermControl(tree);
  if (!selector) return null;
  return winappJson(['ui', 'get-value', selector, '-w', String(hwnd)])?.text ?? null;
}

function browserSnapshotDigest() {
  const raw = powershell(
    '$names = "msedge","chrome","firefox"; '
    + '$rows = Get-Process -Name $names -ErrorAction SilentlyContinue | '
    + 'Where-Object { $_.MainWindowHandle -ne 0 } | '
    + 'Select-Object Id,ProcessName,MainWindowHandle,MainWindowTitle; '
    + '@($rows) | ConvertTo-Json -Compress',
  );
  return createHash('sha256').update(raw || '[]').digest('hex');
}

async function waitFor(check, message, timeout = 15000) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await check();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForProcess(installed, since, name = 'node.exe') {
  return waitFor(
    () => packageProcesses(installed, since).find((process) => process.Name === name) ?? null,
    `registered activation did not create a new package-owned ${name} process`,
  );
}

async function waitForNewTerminal(baseline) {
  return waitFor(
    () => terminalWindows().find((window) => !baseline.has(window.hwnd)) ?? null,
    'registered activation did not create a new visible console window',
  );
}

async function generation() {
  const response = await fetch(`${ORIGIN}/msix-generation.json`, { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

async function startProfileReaderRelaunch() {
  const owned = [];
  let ownedPackageFullName = null;
  let installed;
  let since;
  try {
    assertNoPreexistingPackage();
    installed = installPackage(PACKAGE_VERSIONS[0]);
    ownedPackageFullName = installed.PackageFullName;
    since = new Date();
    const terminals = new Set(terminalWindows().map((window) => window.hwnd));
    activate();
    const process = await waitForProcess(installed, since);
    owned.push(process.ProcessId);
    const launcher = await waitForProcess(installed, since, 'RecapPageLauncher.exe');
    owned.push(launcher.ProcessId);
    const terminal = await waitForNewTerminal(terminals);
    const readyText = await waitFor(
      () => {
        const text = terminalText(terminal.hwnd);
        return text?.includes('Recap Page running at http://127.0.0.1:8787/') ? text : null;
      },
      'the visible console did not show the canonical ready guidance',
    );
    const marker = await waitFor(generation, 'the package server did not answer at the canonical origin');
    if (marker.packageVersion !== PACKAGE_VERSIONS[0]) {
      throw new Error(`served ${marker.packageVersion}, expected ${PACKAGE_VERSIONS[0]}`);
    }
    console.log(JSON.stringify({
      scenario: SCENARIOS[0],
      aumid: AUMID,
      launcherProcessId: launcher.ProcessId,
      processId: process.ProcessId,
      terminalHwnd: terminal.hwnd,
      origin: ORIGIN,
      generation: marker.generation,
      readyGuidanceVisible: readyText.includes('Other addresses are separate browser storage.'),
      witnessedCheckpoint: 'required in the browser Windows opened',
    }, null, 2));
  } finally {
    if (installed && since) {
      owned.push(...packageProcesses(installed, since).map((process) => process.ProcessId));
    }
    stopPids(owned);
    if (ownedPackageFullName) removePackage(ownedPackageFullName);
  }
}

async function busyPortRefusal() {
  const holder = createServer();
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(8787, '127.0.0.1', resolve);
  });

  const owned = [];
  let ownedPackageFullName = null;
  let installed;
  let since;
  try {
    assertNoPreexistingPackage();
    installed = installPackage(PACKAGE_VERSIONS[0]);
    ownedPackageFullName = installed.PackageFullName;
    since = new Date();
    const terminals = new Set(terminalWindows().map((window) => window.hwnd));
    const browserBefore = browserSnapshotDigest();
    activate();

    const launcher = await waitForProcess(installed, since, 'RecapPageLauncher.exe');
    owned.push(launcher.ProcessId);
    const terminal = await waitForNewTerminal(terminals);
    const guidance = await waitFor(
      () => {
        const text = terminalText(terminal.hwnd);
        return text?.includes('Port 8787 is already in use.') ? text : null;
      },
      'the visible console did not retain the busy-port guidance',
    );
    await waitFor(
      () => packageProcesses(installed, since).every((process) => process.Name !== 'node.exe'),
      'the busy-port Node child did not exit',
    );
    const browserAfter = browserSnapshotDigest();
    if (browserAfter !== browserBefore) {
      throw new Error('browser windows changed during busy-port refusal');
    }
    for (const expected of [
      'If the tracker is already running, open http://127.0.0.1:8787/ instead.',
      'Do not start the tracker on a different port to get past this.',
      'another port opens an app',
      'with nothing in it.',
    ]) {
      if (!guidance.includes(expected)) throw new Error(`busy-port guidance omitted: ${expected}`);
    }
    console.log(JSON.stringify({
      scenario: SCENARIOS[1],
      aumid: AUMID,
      holderProcessId: process.pid,
      launcherProcessId: launcher.ProcessId,
      terminalHwnd: terminal.hwnd,
      nodeExited: true,
      safeGuidanceVisible: true,
      browserWindowDigestUnchanged: true,
    }, null, 2));
  } finally {
    if (installed && since) {
      owned.push(...packageProcesses(installed, since).map((process) => process.ProcessId));
    }
    stopPids(owned);
    if (ownedPackageFullName) removePackage(ownedPackageFullName);
    await new Promise((resolve) => holder.close(resolve));
  }
}

async function updateStateContinuity() {
  const owned = [];
  let installed;
  let since;
  let ownedPackageFullName = null;
  try {
    assertNoPreexistingPackage();
    installed = installPackage(PACKAGE_VERSIONS[0]);
    ownedPackageFullName = installed.PackageFullName;
    since = new Date();
    activate();
    owned.push((await waitForProcess(installed, since)).ProcessId);
    owned.push((await waitForProcess(installed, since, 'RecapPageLauncher.exe')).ProcessId);
    const before = await waitFor(generation, 'version N did not answer');
    stopPids(owned.splice(0));

    installed = installPackage(PACKAGE_VERSIONS[1]);
    ownedPackageFullName = installed.PackageFullName;
    since = new Date();
    activate();
    owned.push((await waitForProcess(installed, since)).ProcessId);
    owned.push((await waitForProcess(installed, since, 'RecapPageLauncher.exe')).ProcessId);
    const after = await waitFor(generation, 'version N+1 did not answer');
    if (before.packageVersion !== PACKAGE_VERSIONS[0] || after.packageVersion !== PACKAGE_VERSIONS[1]) {
      throw new Error(`generation mismatch: ${before.packageVersion} then ${after.packageVersion}`);
    }
    console.log(JSON.stringify({
      scenario: SCENARIOS[2],
      aumid: AUMID,
      origin: ORIGIN,
      before: before.generation,
      after: after.generation,
      witnessedCheckpoint: 'same-profile sentinel and restore required',
    }, null, 2));
  } finally {
    if (installed && since) {
      owned.push(...packageProcesses(installed, since).map((process) => process.ProcessId));
    }
    stopPids(owned);
    if (ownedPackageFullName) removePackage(ownedPackageFullName);
  }
}

async function main() {
  const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice(11);
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`choose --scenario=${SCENARIOS.join('|')}`);
  }
  if (scenario === SCENARIOS[0]) await startProfileReaderRelaunch();
  if (scenario === SCENARIOS[1]) await busyPortRefusal();
  if (scenario === SCENARIOS[2]) await updateStateContinuity();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}

export {
  assertNoPreexistingPackage, generation, installPackage, packageInfo, packageProcesses,
  removePackage, stopPids, waitForProcess,
};
