/* global caches, document, location */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AUMID, PACKAGE_ARCHITECTURES, PACKAGE_FAMILY, PACKAGE_NAME,
  PROOF_UPDATE_VERSION, STORE_PACKAGE_VERSION, bundlePath, packagePath, proofPackagePath,
} from './pack-msix.mjs';
import { verifyNativeArtifact } from './lib/native-launcher.mjs';
import {
  bindInstalledInputs, captureBindings, captureRequest, composeCapture, demandCapturePass,
  parseCaptureReport, selectDeployment, sourceRevision, startupSourceInputs, validateExpectations,
} from './lib/startup-contract.mjs';

export const SCENARIOS = Object.freeze([
  'certification-functionality',
  'busy-port-refusal',
  'update-state-continuity',
]);

const ORIGIN = 'http://127.0.0.1:8787';
const CATALOG_ROUTE = '#/catalog';
const CATALOG_RESULTS = '#catalog-results';
const CATALOG_LIST_ID = 'house-of-m';
const CATALOG_ITEM_COUNT = 20;
const ARCHITECTURES = Object.freeze(PACKAGE_ARCHITECTURES.map(({ id }) => id));
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
let activeSemanticCapture = null;
let startupEvidence = null;
const installedStartup = new Map();

async function loadStartupEvidence() {
  const native = await verifyNativeArtifact();
  const proof = await verifyNativeArtifact({ proof: true });
  const text = readFileSync(join(ROOT, 'dist', 'msix-proof', 'startup-inputs.json'), 'utf8');
  if (Buffer.byteLength(text) > 16384) throw new Error('startup expectation record exceeds its bound');
  const expectations = validateExpectations(JSON.parse(text), {
    ...sourceRevision(), nativeDigest: native.digest, sourceInputs: startupSourceInputs(ROOT),
  });
  startupEvidence = { native, proof, expectations };
}

function closingStartupInputs(installed) {
  const evidence = installedStartup.get(installed.InstallLocation);
  if (!evidence) throw new Error('mandatory installed startup inputs are missing');
  const snapshot = bindInstalledInputs(installed.InstallLocation, evidence.variant);
  if (snapshot.digest !== evidence.snapshot.digest) throw new Error('installed startup inputs changed');
  console.log('DIAG installed-startup-inputs files=9 matched=9 snapshot=complete');
  return snapshot;
}

function startupCaptureInputs(installed, architecture, source, proof) {
  const evidence = installedStartup.get(installed.InstallLocation);
  if (!evidence || !startupEvidence || startupEvidence.proof.digest !== proof.digest
    || evidence.variant.identity.architecture !== architecture || evidence.source !== source) {
    throw new Error('mandatory startup contract bindings are missing');
  }
  return captureBindings(proof, architecture, evidence.snapshot.digest, {
    kind: 'installed', family: PACKAGE_FAMILY, architecture, version: evidence.variant.identity.version,
    packageDigest: evidence.packageDigest, source,
  });
}

function powershell(script, operation) {
  const ticket = activeSemanticCapture?.begin(operation, script);
  let result;
  let failure;
  try {
    result = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32e6 },
    ).trim();
  } catch (error) {
    failure = error;
  }
  try {
    if (ticket) activeSemanticCapture.end(ticket, Boolean(failure));
  } catch (error) {
    if (failure) throw new AggregateError([failure, error], 'helper and semantic reporting failed');
    throw error;
  }
  if (failure) throw failure;
  return result;
}

function publishSemanticRecord(root, name, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16384) throw new Error('semantic record exceeds its byte limit');
  const path = join(root, name);
  if (existsSync(path)) throw new Error('semantic record already exists');
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    const errno = Number.isSafeInteger(error.errno) ? error.errno : 'unknown';
    throw new Error(`semantic record publication failed errno=${errno}`);
  }
}

function createSemanticCapture(root, architecture, mode, source) {
  const browser = resolveEdge(false);
  const fields = [
    'RCPSEM1', String(process.pid), process.execPath, fileURLToPath(import.meta.url),
    browser ? resolve(browser) : '', mode, architecture, source,
  ];
  if (fields.some((value) => typeof value !== 'string' || /[\r\n\0]/.test(value))) {
    throw new Error('semantic caller fields are invalid');
  }
  publishSemanticRecord(root, 'semantic-caller.txt', `${fields.join('\n')}\n`);
  let ordinal = 0;
  const operations = new Set([
    'aumid-activate', 'listener-query', 'package-process-query',
    'package-info-query', 'process-exists-query', 'browser-snapshot-query',
  ]);
  const waitForAck = (name, expected) => {
    const path = join(root, name);
    const deadline = performance.now() + 10000;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(path)) {
      if (performance.now() >= deadline) throw new Error('semantic acknowledgement deadline exceeded');
      Atomics.wait(sleeper, 0, 0, 20);
    }
    let received;
    try {
      received = readFileSync(path, 'utf8');
    } catch (error) {
      const errno = Number.isSafeInteger(error.errno) ? error.errno : 'unknown';
      throw new Error(`semantic acknowledgement read failed errno=${errno}`);
    }
    if (received !== String(expected)) throw new Error('semantic acknowledgement differs');
  };
  return {
    begin(operation, script) {
      if (!operations.has(operation) || /[\r\n\0]/.test(script) || ordinal >= 256) {
        throw new Error('semantic operation is unknown or exceeds its bound');
      }
      ordinal += 1;
      publishSemanticRecord(root, `semantic-begin-${ordinal}.txt`, `${operation}\n${script}`);
      waitForAck(`semantic-begin-${ordinal}.ack`, ordinal);
      return { ordinal, operation };
    },
    end(ticket, failed) {
      if (ticket.ordinal !== ordinal) throw new Error('semantic operation ordering differs');
      publishSemanticRecord(root, `semantic-end-${ordinal}.txt`, failed ? 'failed' : 'ok');
      waitForAck(`semantic-end-${ordinal}.ack`, ordinal);
    },
  };
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
    'package-info-query',
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

function retainPackageProcess(process, installRoot, parentProcessId = 0) {
  const inPackage = typeof process.ExecutablePath === 'string'
    && process.ExecutablePath.toLowerCase().startsWith(installRoot.toLowerCase());
  const directChild = Number.isInteger(parentProcessId)
    && parentProcessId > 0
    && process.ParentProcessId === parentProcessId;
  return inPackage || directChild;
}

function packageProcesses(
  installed,
  since = new Date(0),
  {
    parentProcessId = 0,
    runPowerShell = powershell,
  } = {},
) {
  const parent = Number.isInteger(parentProcessId) && parentProcessId > 0
    ? parentProcessId
    : 0;
  const raw = runPowerShell(
    `$since = [datetime]${psLiteral(since.toISOString())}; `
    + '$rows = Get-CimInstance Win32_Process | ForEach-Object { $created = [datetime]$_.CreationDate; '
    + 'if ($created -ge $since) { [pscustomobject]@{ Name = $_.Name; ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; ExecutablePath = $_.ExecutablePath; CreationDate = $created.ToString("o"); CommandLine = $_.CommandLine } } }; '
    + '@($rows) | ConvertTo-Json -Compress',
    'package-process-query',
  );
  const parsed = JSON.parse(raw || '[]');
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  return processes.filter((process) => (
    retainPackageProcess(process, installed.InstallLocation, parent)
  ));
}

function stopPids(pids, runPowerShell = powershell) {
  const failures = [];
  for (const pid of [...new Set(pids)].filter((value) => Number.isInteger(value) && value > 0)) {
    try {
      runPowerShell(
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; `
        + `if ($p) { Stop-Process -Id ${pid} -Force -ErrorAction Stop; `
        + `if (-not $p.WaitForExit(10000)) { throw "process ${pid} remains after stop" } }`,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'one or more package processes could not be stopped');
  }
}

function installPackage(
  version,
  architecture = 'x64',
  source = 'package',
  explicitPath = null,
) {
  if (!ARCHITECTURES.includes(architecture)) {
    throw new Error(`unsupported package architecture: ${architecture}`);
  }
  if (!['package', 'bundle'].includes(source)) {
    throw new Error(`unsupported package source: ${source}`);
  }
  if (!explicitPath && source === 'bundle' && version !== STORE_PACKAGE_VERSION) {
    throw new Error('the Store bundle contains only the Store package version');
  }
  if (!explicitPath && version !== STORE_PACKAGE_VERSION && architecture !== 'x64') {
    throw new Error('the proof-only update package exists only for x64');
  }
  const path = explicitPath ?? (source === 'bundle'
    ? bundlePath()
    : version === STORE_PACKAGE_VERSION
      ? packagePath(architecture)
      : proofPackagePath(version));
  if (!existsSync(path)) throw new Error(`missing package: ${path}`);
  if (!startupEvidence) throw new Error('mandatory package startup expectations are missing');
  const startup = selectDeployment(startupEvidence.expectations, version, architecture, source, path);
  powershell(`Add-AppxPackage -Path ${psLiteral(path)} -ForceApplicationShutdown`);
  const installed = packageInfo();
  if (!installed) throw new Error(`package ${version} was not registered after installation`);
  if (String(installed.Version) !== version) {
    throw new Error(`installed ${installed.Version}, expected ${version}`);
  }
  if (installed.Name !== PACKAGE_NAME || installed.PackageFamilyName !== PACKAGE_FAMILY) {
    throw new Error(`installed identity differs: ${installed.Name}, ${installed.PackageFamilyName}`);
  }
  if (!String(installed.PackageFullName).toLowerCase().includes(`_${architecture}__`)) {
    throw new Error(`installed architecture differs: ${installed.PackageFullName}`);
  }
  const snapshot = bindInstalledInputs(installed.InstallLocation, startup.variant);
  installedStartup.set(installed.InstallLocation, { ...startup, snapshot });
  console.log('DIAG installed-startup-inputs files=9 matched=9 snapshot=complete');
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

function cleanupPackage(
  {
    installed,
    since,
  },
  {
    listProcesses = packageProcesses,
    stopProcesses = stopPids,
    removeOwnedPackage = removePackage,
  } = {},
) {
  const failures = [];
  let currentProcessIds = [];
  if (installed && since) {
    try {
      currentProcessIds = listProcesses(installed, since).map((entry) => entry.ProcessId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (currentProcessIds.length) {
    try {
      stopProcesses(currentProcessIds);
    } catch (error) {
      failures.push(error);
    }
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
  powershell(`Start-Process explorer.exe -ArgumentList ${psLiteral(`shell:AppsFolder\\${AUMID}`)}`, 'aumid-activate');
}

async function withNativeObservation(installed, architecture, source, mode, body) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('native installed observation is restricted to controlled Actions runners');
  }
  const artifact = await verifyNativeArtifact({ proof: true });
  const root = mkdtempSync(join(tmpdir(), 'recap-native-observer-'));
  const report = join(root, 'result.txt');
  const failures = [];
  let child;
  let exited = false;
  let exitCode = null;
  let spawnFailure = null;
  let unexpectedOutput = false;
  let closed = false;
  let result;
  let record;
  let reportText = '';
  let closingInputs = false;
  let captureClean = false;
  const profile = mode === 'busy' ? 'installed-busy' : 'installed-functionality';
  let bindings;
  try {
    bindings = startupCaptureInputs(installed, architecture, source, artifact);
    if (activeSemanticCapture) throw new Error('native semantic captures cannot overlap');
    const semanticCapture = createSemanticCapture(root, architecture, mode, source);
    publishSemanticRecord(root, 'startup-context.txt', captureRequest(bindings, profile));
    child = spawn(join(artifact.root, architecture, 'NativeStartupTests.exe'), [
      '--mode', mode, '--root', root, '--report', report,
      '--installed-root', installed.InstallLocation, '--contract', join(root, 'startup-context.txt'),
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.once('error', (error) => { spawnFailure = error; });
    child.once('exit', (code) => { exited = true; exitCode = code; });
    child.once('close', () => { closed = true; });
    child.stdout.on('data', () => { unexpectedOutput = true; });
    child.stderr.on('data', () => { unexpectedOutput = true; });
    const assertAlive = () => {
      if (spawnFailure) throw spawnFailure;
      if (exited) {
        if (existsSync(report) && statSync(report).size > 1024 * 1024) throw new Error('startup report exceeds its bound');
        const detail = existsSync(report) ? readFileSync(report, 'utf8') : 'no observer report';
        throw new Error(`native observer exited ${exitCode}: ${detail}`);
      }
    };
    await waitFor(() => {
      assertAlive();
      return existsSync(join(root, 'ready.txt'));
    }, 'native observer did not become ready', 30000);
    activeSemanticCapture = semanticCapture;
    try {
      result = await body({
        waitForSettledRoots: (count) => waitFor(() => {
          assertAlive();
          const counts = join(root, 'counts.txt');
          return existsSync(counts)
            && readFileSync(counts, 'utf8') === `started=${count}\nended=${count}\n`;
        }, 'native activation lifecycle did not settle', 30000),
      });
    } catch (error) {
      failures.push(error);
    } finally {
      activeSemanticCapture = null;
      if (mode === 'functionality' && Number.isInteger(result?.settledListenerPid)) {
        publishSemanticRecord(root, 'winning-server.txt', String(result.settledListenerPid));
      }
      publishSemanticRecord(root, 'semantic-finished.txt', 'finished');
    }
    if (mode === 'functionality') writeFileSync(join(root, 'finish.txt'), 'finish');
    await waitFor(() => {
      if (spawnFailure) throw spawnFailure;
      return exited && closed;
    }, 'native observer did not finish', 30000);
    if (existsSync(report) && statSync(report).size > 1024 * 1024) throw new Error('startup report exceeds its bound');
    reportText = existsSync(report) ? readFileSync(report, 'utf8') : '';
    record = parseCaptureReport(reportText, bindings, profile);
    closingStartupInputs(installed);
    closingInputs = true;
    if (exitCode !== 0 || unexpectedOutput) {
      throw new Error(`native installed observation failed: exit ${exitCode}; ${reportText}`);
    }
  } catch (error) {
    failures.push(error);
  } finally {
    if (child?.pid && !exited) {
      try {
        child.kill();
        await waitFor(() => exited && closed, 'owned native observer did not stop', 2000);
      } catch (error) {
        failures.push(error);
      }
    }
    if (!child?.pid || exited) {
      try {
        rmSync(root, { recursive: true, force: true });
        captureClean = (!child?.pid || (exited && closed)) && !unexpectedOutput;
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'native observed journey failed');
  const composed = demandCapturePass(composeCapture({
    bindings, profile, record, inputs: closingInputs, creation: true, behavior: true,
    cleanup: { scope: 'capture', completed: captureClean, reportValid: true, closingInputs },
  }));
  console.log(reportText.trim());
  console.log(`PASS app-startup-contract-v2 profile=${composed.profile} scope=capture`);
  return result;
}

function browserSnapshotDigest() {
  const raw = powershell(
    '$names = "msedge","chrome","firefox"; '
    + '$rows = Get-Process -Name $names -ErrorAction SilentlyContinue | '
    + 'Where-Object { $_.MainWindowHandle -ne 0 } | '
    + 'Select-Object Id,ProcessName,MainWindowHandle,MainWindowTitle; '
    + '@($rows) | ConvertTo-Json -Compress',
    'browser-snapshot-query',
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

async function waitForProcess(
  installed,
  since,
  name = 'node.exe',
  commandLineFragment,
  listProcesses = packageProcesses,
) {
  return waitFor(
    () => listProcesses(installed, since).find((process) => (
      process.Name === name
      && (!commandLineFragment || process.CommandLine?.includes(commandLineFragment))
    )) ?? null,
    `registered activation did not create a new package-owned ${name}`
      + `${commandLineFragment ? ` running ${commandLineFragment}` : ''} process`,
  );
}

function serverChildExited(processes, supervisor) {
  if (!Number.isInteger(supervisor?.ProcessId)
    || typeof supervisor.Name !== 'string'
    || typeof supervisor.ExecutablePath !== 'string') {
    return false;
  }

  const liveSupervisor = processes.find((process) => process.ProcessId === supervisor.ProcessId);
  if (!liveSupervisor
    || liveSupervisor.Name?.toLowerCase() !== supervisor.Name.toLowerCase()
    || liveSupervisor.ExecutablePath?.toLowerCase() !== supervisor.ExecutablePath.toLowerCase()) {
    return false;
  }

  for (const process of processes) {
    if (process.ProcessId === supervisor.ProcessId) continue;
    if (!Number.isInteger(process.ProcessId)
      || !Number.isInteger(process.ParentProcessId)
      || typeof process.Name !== 'string'
      || typeof process.ExecutablePath !== 'string') {
      return false;
    }
    if (process.ParentProcessId === supervisor.ProcessId
      && process.Name.toLowerCase() === supervisor.Name.toLowerCase()
      && process.ExecutablePath.toLowerCase() === supervisor.ExecutablePath.toLowerCase()) {
      return false;
    }
  }
  return true;
}

async function generation() {
  const response = await fetch(`${ORIGIN}/msix-generation.json`, { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

const INSTALLED_LAUNCHER_FILES = Object.freeze([
  Object.freeze(['runtime', 'node.exe']),
  Object.freeze(['Launcher.mjs']),
  Object.freeze(['server.mjs']),
  Object.freeze(['src', 'msix-generation.json']),
]);

function stageInstalledLauncher(
  installed,
  {
    createTemp = mkdtempSync,
    makeDirectory = mkdirSync,
    copyFile = copyFileSync,
    removeTree = rmSync,
  } = {},
) {
  const root = createTemp(join(tmpdir(), 'recap-page-installed-launcher-'));
  try {
    for (const parts of INSTALLED_LAUNCHER_FILES) {
      const destination = join(root, ...parts);
      makeDirectory(dirname(destination), { recursive: true });
      copyFile(join(installed.InstallLocation, ...parts), destination);
    }
    return {
      root,
      executable: join(root, 'runtime', 'node.exe'),
      launcher: join(root, 'Launcher.mjs'),
      files: INSTALLED_LAUNCHER_FILES.map((parts) => join(...parts)),
    };
  } catch (error) {
    removeTree(root, { recursive: true, force: true });
    throw error;
  }
}

function startInstalledLauncher(
  installed,
  {
    spawnImpl = spawn,
    environment = process.env,
    stageLauncher = stageInstalledLauncher,
    removeTree = rmSync,
  } = {},
) {
  const staged = stageLauncher(installed);
  let child;
  try {
    child = spawnImpl(staged.executable, [staged.launcher], {
      cwd: staged.root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    removeTree(staged.root, { recursive: true, force: true });
    throw error;
  }
  const output = [];
  let error = null;
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.once('error', (failure) => {
    error = failure;
  });
  return {
    child,
    output,
    error: () => error,
    stagingRoot: staged.root,
    stagedFiles: staged.files,
  };
}

function removeStagedLauncher(
  launched,
  {
    stopProcesses = stopPids,
    removeTree = rmSync,
  } = {},
) {
  if (!launched) return;
  const failures = [];
  try {
    stopProcesses([launched.child.pid]);
  } catch (error) {
    failures.push(error);
  }
  try {
    removeTree(launched.stagingRoot, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(failures, 'staged installed launcher cleanup failed');
  }
}

async function fetchEssentialJson() {
  const paths = [
    '/data/creators-index.json',
    '/data/series-index.json',
    '/data/catalog.json',
    '/data/house_of_m.json',
  ];
  const results = [];
  for (const path of paths) {
    const response = await fetch(`${ORIGIN}${path}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== 'object') throw new Error(`${path} did not contain a JSON object`);
    results.push({ path, status: response.status });
  }
  return results;
}

function resolveBrowserDriver() {
  const root = process.env.MRT_PUPPETEER;
  if (!root) throw new Error('MRT_PUPPETEER must name an external puppeteer-core entry file');
  if (!existsSync(root)) throw new Error(`MRT_PUPPETEER does not exist: ${root}`);
  return root;
}

function resolveEdge(required = true) {
  const candidates = [
    process.env.MRT_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found && required) throw new Error('Microsoft Edge was not found');
  return found || '';
}

async function withBrowser(body) {
  const driver = resolveBrowserDriver();
  const { default: puppeteer } = await import(pathToFileURL(driver).href);
  const profile = mkdtempSync(join(tmpdir(), 'recap-page-msix-browser-'));
  const browser = await puppeteer.launch({
    executablePath: resolveEdge(),
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    return await body(browser);
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

async function setRoute(page, route) {
  await page.evaluate((value) => {
    location.hash = value;
  }, route);
  await page.waitForFunction(
    (value) => location.hash === value,
    {},
    route,
  );
}

async function searchName(page, kind, query, expected) {
  const input = kind === 'creator' ? '#creator-q' : '#series-q';
  const form = kind === 'creator' ? '#form-creator' : '#form-series';
  const results = kind === 'creator' ? '#creator-results' : '#series-results';
  await setRoute(page, kind === 'creator' ? '#/add-creator' : '#/add-series');
  await page.waitForSelector(input);
  await page.$eval(input, (field, value) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, query);
  await page.$eval(form, (node) => node.requestSubmit());
  await page.waitForFunction(
    (selector, text) => [...document.querySelectorAll(`${selector} .result-title`)]
      .some((node) => node.textContent.includes(text)),
    { timeout: 15000 },
    results,
    expected,
  );
}

async function waitForCatalogCard(page, title) {
  await page.waitForFunction(
    (selector, expected) => [...document.querySelectorAll(`${selector} .catalog-card-title`)]
      .some((node) => node.textContent.trim() === expected),
    { timeout: 15000 },
    CATALOG_RESULTS,
    title,
  );
}

async function removeCachedPaths(page, paths) {
  await page.evaluate(async (targets) => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const path of targets) await cache.delete(new URL(path, location.origin));
    }
  }, paths);
}

function processExists(pid) {
  return powershell(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { "true" } else { "false" }`, 'process-exists-query') === 'true';
}

function listenerPid(runPowerShell = powershell) {
  const raw = runPowerShell(
    '$row = Get-NetTCPConnection -State Listen -ErrorAction Stop | '
    + "Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 8787 } | "
    + 'Select-Object -First 1; if ($row) { $row.OwningProcess }',
    'listener-query',
  );
  return raw ? Number(raw) : null;
}

function selectListenerServer(processes, processId) {
  if (!Number.isInteger(processId) || processId <= 0) return null;
  const candidate = processes.find((process) => process.ProcessId === processId);
  if (!candidate) return null;
  if (!candidate.CommandLine?.includes('server.mjs')) {
    throw new Error(`listener PID ${processId} did not run the package server`);
  }
  return candidate;
}

async function certificationFunctionality(architecture, source) {
  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(STORE_PACKAGE_VERSION, architecture, source);
    context.since = new Date();
    const { marker, settledListenerPid, serverProcess, settledServers } = await withNativeObservation(
      context.installed, architecture, source, 'functionality', async (observation) => {
        activate();
        activate();
        const marker = await waitFor(generation, 'the package server did not answer at the canonical origin');
        const settledListenerPid = await waitFor(
          () => listenerPid(),
          'the package server did not own port 8787',
        );
        const serverProcess = await waitFor(
          () => selectListenerServer(
            packageProcesses(context.installed, context.since),
            settledListenerPid,
          ),
          `listener PID ${settledListenerPid} was not owned by the installed package`,
        );
        const launchersExited = () => !packageProcesses(context.installed, context.since)
          .some((process) => process.CommandLine?.includes('Launcher.mjs')
            || process.Name?.toLowerCase() === 'recappagelauncher.exe');
        await observation.waitForSettledRoots(2);
        await waitFor(launchersExited, 'the overlapping native launchers or coordinators did not exit');
        const settledServers = packageProcesses(context.installed, context.since)
          .filter((process) => process.CommandLine?.includes('server.mjs'));
        if (settledServers.length !== 1
          || settledServers[0].ProcessId !== settledListenerPid
          || listenerPid() !== settledListenerPid) {
          throw new Error(`overlapping activation left ${settledServers.length} server processes`);
        }
        activate();
        await observation.waitForSettledRoots(3);
        await waitFor(launchersExited, 'the warm native launcher or coordinator did not exit');
        if (listenerPid() !== settledListenerPid) throw new Error('warm activation replaced the healthy server');
        return { marker, settledListenerPid, serverProcess, settledServers };
      },
    );
    if (marker.packageVersion !== STORE_PACKAGE_VERSION) {
      throw new Error(`served ${marker.packageVersion}, expected ${STORE_PACKAGE_VERSION}`);
    }
    const json = await fetchEssentialJson();

    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(`${ORIGIN}/#/home`, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        return true;
      });
      await setRoute(page, CATALOG_ROUTE);
      await waitForCatalogCard(page, 'House of M');
      const opened = await page.evaluate((selector) => {
        const card = [...document.querySelectorAll(`${selector} .catalog-card`)]
          .find((candidate) => candidate.querySelector('.catalog-card-title')?.textContent.trim() === 'House of M');
        const button = card?.querySelector('button[data-act="preview"]');
        button?.click();
        return Boolean(button);
      }, CATALOG_RESULTS);
      if (!opened) throw new Error('House of M was not available to preview');
      await page.waitForSelector('#preview[open] .preview-issue-link');
      await page.$eval(
        `#preview input[data-act="path-preview"][data-key="${CATALOG_LIST_ID}"]`,
        (radio) => radio.click(),
      );
      await page.waitForFunction(
        (count) => document.querySelectorAll('#preview-body .preview-issue-link').length === count,
        {},
        CATALOG_ITEM_COUNT,
      );
      await page.$eval('#preview-add [data-act="main"]', (button) => button.click());
      await page.waitForFunction((catalogId, count) => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return Object.values(state?.lists ?? {}).some((list) => (
          list.catalogId === catalogId && list.itemIds?.length === count
        ));
      }, {}, CATALOG_LIST_ID, CATALOG_ITEM_COUNT);
      await page.$eval('#preview-close', (button) => button.click());
      await searchName(page, 'creator', 'Hickman', 'Hickman');
      await searchName(page, 'series', 'House of M', 'House of M');

      const external = await browser.newPage();
      await external.setRequestInterception(true);
      external.on('request', (request) => {
        if (request.url().startsWith('https://marvel.emreparker.com/v1')) request.abort();
        else request.continue();
      });
      await external.goto(`${ORIGIN}/#/home`, { waitUntil: 'domcontentloaded' });
      await external.waitForFunction(
        () => document.querySelector('#api-status')?.textContent
          === 'API unreachable. Lists and progress still work',
      );
      await setRoute(external, '#/add-search');
      await external.$eval('#search-q', (field) => { field.value = 'Secret Wars'; });
      await external.$eval('#form-search', (form) => form.requestSubmit());
      await external.waitForFunction(
        () => document.querySelector('#search-results')?.textContent
          .includes('Could not reach the metadata service'),
      );
      await external.close();

      await removeCachedPaths(page, [
        '/data/creators-index.json',
        '/data/series-index.json',
        '/data/catalog.json',
        '/data/house_of_m.json',
      ]);
      stopPids([serverProcess.ProcessId]);
      await waitFor(
        () => listenerPid() === null,
        'the deliberate server stop did not release the canonical port',
      );

      await setRoute(page, CATALOG_ROUTE);
      await waitForCatalogCard(page, 'House of M');
      const previewOpened = await page.evaluate((selector) => {
        const card = [...document.querySelectorAll(`${selector} .catalog-card`)]
          .find((candidate) => candidate.querySelector('.catalog-card-title')?.textContent.trim() === 'House of M');
        const button = card?.querySelector('button[data-act="preview"]');
        button?.click();
        return Boolean(button);
      }, CATALOG_RESULTS);
      if (!previewOpened) throw new Error('House of M was not available to preview');
      await page.waitForFunction(
        () => document.querySelector('#preview-body')?.textContent
          .includes('The local app connection is not available'),
      );

      const stalePage = await browser.newPage();
      await stalePage.goto(`${ORIGIN}/#/add-creator`, { waitUntil: 'domcontentloaded' });
      await stalePage.waitForSelector('#creator-q');
      await stalePage.$eval('#creator-q', (field) => { field.value = 'Hickman'; });
      await stalePage.$eval('#form-creator', (form) => form.requestSubmit());
      await stalePage.waitForFunction(
        () => document.querySelector('#creator-results')?.textContent
          .includes('The local app connection is not available'),
      );
      await setRoute(stalePage, '#/add-series');
      await stalePage.$eval('#series-q', (field) => { field.value = 'House of M'; });
      await stalePage.$eval('#form-series', (form) => form.requestSubmit());
      await stalePage.waitForFunction(
        () => document.querySelector('#series-results')?.textContent
          .includes('The local app connection is not available'),
      );
      await stalePage.close();

      const catalogPage = await browser.newPage();
      await catalogPage.goto(`${ORIGIN}${CATALOG_ROUTE}`, { waitUntil: 'domcontentloaded' });
      await catalogPage.waitForFunction(
        () => document.querySelector('#catalog-report')?.textContent
          .includes('The local app connection is not available'),
      );
      await catalogPage.close();
    });

    context.since = new Date();
    activate();
    const relaunched = await waitForProcess(
      context.installed,
      context.since,
      'node.exe',
      'server.mjs',
    );
    await waitFor(generation, 'the package did not relaunch after deliberate server stop');

    const livePid = relaunched.ProcessId;
    closingStartupInputs(context.installed);
    removePackage();
    await waitFor(
      () => !processExists(livePid) && listenerPid() === null && packageInfo() === null,
      'live package removal left registration, server process, or listener behind',
    );
    context.installed = null;

    console.log(JSON.stringify({
      phase: 'behavior',
      scenario: SCENARIOS[0],
      architecture,
      source,
      aumid: AUMID,
      processId: serverProcess.ProcessId,
      listenerProcessId: settledListenerPid,
      relaunchedProcessId: relaunched.ProcessId,
      origin: ORIGIN,
      generation: marker.generation,
      essentialJson: json,
      coordinatorExited: true,
      overlappingActivationServerCount: settledServers.length,
      externalFailureDistinct: true,
      localFailureDiagnosed: true,
      liveRemovalClean: true,
    }, null, 2));
  });
}

async function busyPortRefusal(architecture, source) {
  const holder = createServer();
  let launched = null;
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(8787, '127.0.0.1', resolve);
  });

  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(STORE_PACKAGE_VERSION, architecture, source);
    context.since = new Date();
    const browserBefore = browserSnapshotDigest();
    launched = startInstalledLauncher(context.installed);
    const guidance = await waitFor(
      () => {
        if (launched.error()) throw launched.error();
        const text = launched.output.join('');
        return text?.includes('Port 8787 is already in use.') ? text : null;
      },
      'the installed supervisor did not retain the busy-port guidance',
    );
    const serverChildren = packageProcesses(context.installed, context.since, {
      parentProcessId: launched.child.pid,
    }).filter((candidate) => candidate.CommandLine?.includes('server.mjs'));
    if (serverChildren.length !== 0) {
      throw new Error(`busy-port refusal started ${serverChildren.length} server children`);
    }
    const browserAfter = browserSnapshotDigest();
    if (browserAfter !== browserBefore) {
      throw new Error('browser windows changed during busy-port refusal');
    }
    for (const expected of [
      'It is not running this version of Recap Page.',
      'Do not start Recap Page on a different port.',
      'another port opens a separate browser storage location.',
    ]) {
      if (!guidance.includes(expected)) throw new Error(`busy-port guidance omitted: ${expected}`);
    }
    await withNativeObservation(context.installed, architecture, source, 'busy', async () => {
      activate();
    });
    if (browserSnapshotDigest() !== browserBefore) {
      throw new Error('native busy-port refusal changed browser windows');
    }
    if (packageProcesses(context.installed, context.since)
      .some((candidate) => candidate.CommandLine?.includes('server.mjs'))) {
      throw new Error('native busy-port refusal started a server child');
    }
    console.log(JSON.stringify({
      phase: 'behavior',
      scenario: SCENARIOS[1],
      architecture,
      source,
      aumid: AUMID,
      holderProcessId: process.pid,
      launcherProcessId: launched.child.pid,
      stagedInstalledFiles: launched.stagedFiles,
      serverChildrenStarted: 0,
      safeGuidanceVisible: true,
      browserWindowDigestUnchanged: true,
    }, null, 2));
  }, {
    afterCleanup: async () => {
      const failures = [];
      try {
        removeStagedLauncher(launched);
      } catch (error) {
        failures.push(error);
      }
      try {
        await new Promise((resolve, reject) => {
          holder.close((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length) {
        throw new AggregateError(failures, 'busy-port fixture cleanup failed');
      }
    },
  });
}

async function updateStateContinuity(architecture, source) {
  if (architecture !== 'x64' || source !== 'package') {
    throw new Error('the historical package-update proof is x64 only');
  }
  await runInstalledScenario(async (context) => {
    assertNoPreexistingPackage();
    context.cleanupAuthorized = true;
    context.installed = installPackage(STORE_PACKAGE_VERSION, architecture);
    context.since = new Date();
    activate();
    const oldServer = await waitForProcess(context.installed, context.since, 'node.exe', 'server.mjs');
    const before = await waitFor(generation, 'version N did not answer');

    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(`${ORIGIN}/#/home`, { waitUntil: 'networkidle0' });
      const sentinel = {
        schemaVersion: 2,
        issues: {
          900001: {
            issueId: 900001,
            title: 'Certification update sentinel',
            number: '1',
            url: 'https://www.marvel.com/comics/issue/900001/',
            seriesId: null,
            seriesName: null,
            onSale: null,
            mu: null,
            digitalId: null,
            cover: null,
            source: 'manual',
            hydrated: false,
          },
        },
        read: { 900001: 1 },
        overrides: {},
        notes: { 900001: '2.0.2.0 to 2.0.2.1 continuity' },
        lists: {
          certification: {
            id: 'certification',
            name: 'Certification update sentinel',
            description: '',
            note: '',
            created: 1,
            catalogId: null,
            itemIds: [900001],
            collectedIn: {},
          },
        },
        listOrder: ['certification'],
        active: 'certification',
      };
      await page.evaluate((value) => {
        localStorage.setItem('mrt.state.v2', JSON.stringify(value));
      }, sentinel);

      closingStartupInputs(context.installed);
      context.installed = installPackage(PROOF_UPDATE_VERSION, architecture);
      await waitFor(
        () => !processExists(oldServer.ProcessId) && listenerPid() === null,
        `the live ${STORE_PACKAGE_VERSION} server survived package update`,
      );

      context.since = new Date();
      activate();
      await waitForProcess(context.installed, context.since, 'node.exe', 'server.mjs');
      const after = await waitFor(generation, 'version N+1 did not answer');
      await page.reload({ waitUntil: 'networkidle0' });
      const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
      if (restored?.notes?.['900001'] !== sentinel.notes[900001]
        || restored?.read?.['900001'] !== sentinel.read[900001]) {
        throw new Error('browser-owned sentinel changed across package update');
      }
      if (before.packageVersion !== STORE_PACKAGE_VERSION
        || after.packageVersion !== PROOF_UPDATE_VERSION) {
        throw new Error(`generation mismatch: ${before.packageVersion} then ${after.packageVersion}`);
      }
      closingStartupInputs(context.installed);
      console.log(JSON.stringify({
        phase: 'behavior',
        scenario: SCENARIOS[2],
        architecture,
        source,
        aumid: AUMID,
        origin: ORIGIN,
        before: before.generation,
        after: after.generation,
        oldProcessExitedWithoutPrekill: true,
        stateContinuity: true,
      }, null, 2));
    });
  });
}

async function main() {
  const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice(11);
  const architecture = process.argv.find((arg) => arg.startsWith('--architecture='))
    ?.slice(15) ?? 'x64';
  const source = process.argv.find((arg) => arg.startsWith('--source='))
    ?.slice(9) ?? 'package';
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`choose --scenario=${SCENARIOS.join('|')}`);
  }
  if (!ARCHITECTURES.includes(architecture)) {
    throw new Error(`choose --architecture=${ARCHITECTURES.join('|')}`);
  }
  if (!['package', 'bundle'].includes(source)) {
    throw new Error('choose --source=package|bundle');
  }
  await loadStartupEvidence();
  if (scenario === SCENARIOS[0]) await certificationFunctionality(architecture, source);
  if (scenario === SCENARIOS[1]) await busyPortRefusal(architecture, source);
  if (scenario === SCENARIOS[2]) {
    await updateStateContinuity(architecture, source);
  }
  console.log(`PASS installed-journey scenario=${scenario} architecture=${architecture} source=${source} cleanup=complete`);
}

function formatProofError(error, indent = '') {
  const text = error?.stack ?? String(error);
  const lines = [`${indent}${text}`];
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      lines.push(formatProofError(nested, `${indent}  `));
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(formatProofError(err));
    process.exit(1);
  });
}

export {
  assertNoPreexistingPackage, cleanupPackage, generation, installPackage,
  formatProofError, listenerPid, packageInfo, packageProcesses, removePackage, retainPackageProcess,
  removeStagedLauncher, runInstalledScenario, selectListenerServer, stageInstalledLauncher,
  startInstalledLauncher, stopPids,
  serverChildExited, waitForProcess,
};
