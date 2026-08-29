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

const ORIGIN = 'http://127.0.0.1:8787';
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const READY_GUIDANCE = Object.freeze([
  'Recap Page running at http://127.0.0.1:8787/',
  'Other addresses are separate browser storage.',
]);

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

function packageInfo(runPowerShell = powershell) {
  const raw = runPowerShell(
    `$p = Get-AppxPackage -Name ${psLiteral(PACKAGE_NAME)} | `
    + `Where-Object PackageFamilyName -eq ${psLiteral(PACKAGE_FAMILY)} | `
    + 'Sort-Object Version -Descending | Select-Object -First 1; '
    + 'if (-not $p) { "null"; exit 0 }; '
    + '$p | Select-Object Name,PackageFullName,PackageFamilyName,InstallLocation,Version | ConvertTo-Json -Compress',
  );
  return JSON.parse(raw);
}

function assertNoPreexistingPackage(getPackageInfo = packageInfo) {
  const installed = getPackageInfo();
  if (installed) {
    throw new Error(
      `refusing to replace pre-existing package ${installed.PackageFullName}; remove it explicitly first`,
    );
  }
}

function packageProcesses(installed, since = new Date(0), runPowerShell = powershell) {
  const raw = runPowerShell(
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

function stopPids(pids, runPowerShell = powershell) {
  const failures = [];
  for (const pid of [...new Set(pids)].filter((value) => Number.isInteger(value) && value > 0)) {
    try {
      runPowerShell(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id ${pid}; Wait-Process -Id ${pid} -ErrorAction SilentlyContinue }`);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'one or more package processes could not be stopped');
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

function removePackage(
  packageName = PACKAGE_NAME,
  packageFamily = PACKAGE_FAMILY,
  {
    runPowerShell = powershell,
    getPackageInfo = () => packageInfo(runPowerShell),
  } = {},
) {
  if (packageName !== PACKAGE_NAME || packageFamily !== PACKAGE_FAMILY) {
    throw new Error('refusing to remove a package outside the exact Recap Page identity');
  }
  const failures = [];
  try {
    runPowerShell(
      `$packages = @(Get-AppxPackage -Name ${psLiteral(packageName)} | Where-Object PackageFamilyName -eq ${psLiteral(packageFamily)}); `
      + 'foreach ($p in $packages) { Remove-AppxPackage -Package $p.PackageFullName }',
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    const remaining = getPackageInfo();
    if (remaining) {
      failures.push(new Error(`package identity remains registered: ${remaining.PackageFullName}`));
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(failures, 'package removal or absence verification failed');
  }
}

function assertReadyGuidance(text) {
  for (const expected of READY_GUIDANCE) {
    if (!text?.includes(expected)) throw new Error(`ready guidance omitted: ${expected}`);
  }
}

function cleanupPackage(
  {
    installed,
    since,
    owned,
  },
  {
    listProcesses = packageProcesses,
    stopProcesses = stopPids,
    removeOwnedPackage = removePackage,
  } = {},
) {
  const failures = [];
  if (installed && since) {
    try {
      owned.push(...listProcesses(installed, since).map((entry) => entry.ProcessId));
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    stopProcesses(owned);
  } catch (error) {
    failures.push(error);
  }
  try {
    removeOwnedPackage(PACKAGE_NAME, PACKAGE_FAMILY);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(failures, 'installed scenario cleanup did not complete');
  }
}

async function runInstalledScenario(body, { afterCleanup } = {}) {
  const context = {
    cleanupAuthorized: false,
    installed: null,
    owned: [],
    since: null,
  };
  let result;
  let scenarioFailure;
  try {
    result = await body(context);
  } catch (error) {
    scenarioFailure = error;
  }

  const cleanupFailures = [];
  if (context.cleanupAuthorized) {
    try {
      cleanupPackage(context);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (afterCleanup) {
    try {
      await afterCleanup();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (scenarioFailure && cleanupFailures.length) {
    throw new AggregateError(
      [scenarioFailure, ...cleanupFailures],
      'installed scenario and its cleanup both failed',
    );
  }
  if (scenarioFailure) throw scenarioFailure;
  if (cleanupFailures.length) {
    throw new AggregateError(cleanupFailures, 'installed scenario cleanup failed');
  }
  return result;
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
  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(PACKAGE_VERSIONS[0]);
    context.since = new Date();
    const terminals = new Set(terminalWindows().map((window) => window.hwnd));
    activate();
    const process = await waitForProcess(context.installed, context.since);
    context.owned.push(process.ProcessId);
    const launcher = await waitForProcess(
      context.installed,
      context.since,
      'RecapPageLauncher.exe',
    );
    context.owned.push(launcher.ProcessId);
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
    assertReadyGuidance(readyText);
    console.log(JSON.stringify({
      scenario: SCENARIOS[0],
      aumid: AUMID,
      launcherProcessId: launcher.ProcessId,
      processId: process.ProcessId,
      terminalHwnd: terminal.hwnd,
      origin: ORIGIN,
      generation: marker.generation,
      readyGuidanceVisible: true,
      manualBrowserCheckpoint: 'profile, reader tab, and saved-state observations are not automated',
    }, null, 2));
  });
}

async function busyPortRefusal() {
  const holder = createServer();
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(8787, '127.0.0.1', resolve);
  });

  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(PACKAGE_VERSIONS[0]);
    context.since = new Date();
    const terminals = new Set(terminalWindows().map((window) => window.hwnd));
    const browserBefore = browserSnapshotDigest();
    activate();

    const launcher = await waitForProcess(
      context.installed,
      context.since,
      'RecapPageLauncher.exe',
    );
    context.owned.push(launcher.ProcessId);
    const terminal = await waitForNewTerminal(terminals);
    const guidance = await waitFor(
      () => {
        const text = terminalText(terminal.hwnd);
        return text?.includes('Port 8787 is already in use.') ? text : null;
      },
      'the visible console did not retain the busy-port guidance',
    );
    await waitFor(
      () => packageProcesses(context.installed, context.since)
        .every((process) => process.Name !== 'node.exe'),
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
  }, {
    afterCleanup: () => new Promise((resolve) => holder.close(resolve)),
  });
}

async function updateStateContinuity() {
  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(PACKAGE_VERSIONS[0]);
    context.since = new Date();
    activate();
    context.owned.push((await waitForProcess(context.installed, context.since)).ProcessId);
    context.owned.push((
      await waitForProcess(context.installed, context.since, 'RecapPageLauncher.exe')
    ).ProcessId);
    const before = await waitFor(generation, 'version N did not answer');
    stopPids(context.owned.splice(0));

    context.installed = installPackage(PACKAGE_VERSIONS[1]);
    context.since = new Date();
    activate();
    context.owned.push((await waitForProcess(context.installed, context.since)).ProcessId);
    context.owned.push((
      await waitForProcess(context.installed, context.since, 'RecapPageLauncher.exe')
    ).ProcessId);
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
      manualBrowserCheckpoint: 'same-profile saved-state continuity is not automated',
    }, null, 2));
  });
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
  assertNoPreexistingPackage, assertReadyGuidance, cleanupPackage, generation, installPackage,
  packageInfo, packageProcesses, removePackage, runInstalledScenario, stopPids, waitForProcess,
};
