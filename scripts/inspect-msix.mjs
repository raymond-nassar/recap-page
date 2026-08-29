import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAUNCHER_NAME, PACKAGE_ARCHITECTURES, PACKAGE_NAME, PACKAGE_PUBLISHER,
  PROOF_UPDATE_VERSION, STORE_PACKAGE_VERSION, bundlePath, packagePath,
} from './pack-msix.mjs';
import { NODE_VERSION } from './pack-windows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
}

function powershell(script) {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]).trim();
}

function makeAppx(args) {
  return run('winapp', ['tool', 'makeappx', ...args]);
}

function xmlAttribute(source, elementName, attributeName) {
  const element = source.match(new RegExp(`<${elementName}\\b[^>]*>`, 'i'))?.[0] ?? '';
  return element.match(new RegExp(`\\b${attributeName}="([^"]*)"`, 'i'))?.[1] ?? null;
}

export function peMachine(bytes) {
  if (bytes.length < 0x40 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('file is not a PE executable');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('file has no PE signature');
  }
  return bytes.readUInt16LE(peOffset + 4);
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function filesUnder(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else found.push(path);
  }
  return found;
}

async function unpackPackage(path, destination) {
  await mkdir(destination, { recursive: true });
  makeAppx(['unpack', '/p', path, '/d', destination, '/o']);
}

async function publishedNodeHashes() {
  const response = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`);
  if (!response.ok) throw new Error(`Node SHASUMS256.txt returned ${response.status}`);
  const hashes = new Map();
  for (const line of (await response.text()).split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+win-(x64|arm64)\/node\.exe$/);
    if (match) hashes.set(match[2], match[1]);
  }
  return hashes;
}

async function waitForChild(parentPid, executable, timeout = 10000) {
  const expected = executable.replaceAll("'", "''");
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const raw = powershell(
      `$row = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid}" | `
      + `Where-Object { $_.ExecutablePath -eq '${expected}' } | `
      + 'Select-Object -First 1 ProcessId,ExecutablePath; '
      + 'if ($row) { $row | ConvertTo-Json -Compress }',
    );
    if (raw) return JSON.parse(raw);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`launcher ${parentPid} did not create its Node child`);
}

async function waitForOutput(output, pattern, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const text = output.join('');
    const match = text.match(pattern);
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`process output did not match ${pattern}`);
}

async function waitForExit(pid, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`process ${pid} remained after cleanup`);
}

async function removeTree(path) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function stopPid(pid) {
  powershell(
    `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; `
    + `if ($process) { Stop-Process -Id ${pid} -Force; `
    + `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue }`,
  );
}

async function measureProcesses(layout, expectedArchitecture) {
  const measurement = await mkdtemp(join(tmpdir(), 'recap-page-arch-'));
  const runtime = join(measurement, 'runtime');
  await mkdir(runtime, { recursive: true });
  await cp(join(layout, 'runtime', 'node.exe'), join(runtime, 'node.exe'));
  await cp(join(layout, LAUNCHER_NAME), join(measurement, LAUNCHER_NAME));
  await writeFile(
    join(measurement, 'server.mjs'),
    'console.log(`child=${process.arch}`);\nsetInterval(() => {}, 1000);\n',
  );

  const executable = join(runtime, 'node.exe');
  const launcher = spawn(executable, [join(measurement, LAUNCHER_NAME)], {
    cwd: measurement,
    env: { ...process.env, MRT_PACKAGE_ARCH_PROBE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  launcher.stdout.on('data', (chunk) => output.push(chunk.toString()));
  launcher.stderr.on('data', (chunk) => output.push(chunk.toString()));
  let child;

  try {
    child = await waitForChild(launcher.pid, executable);
    const launcherArchitecture = await waitForOutput(output, /launcher=(\w+)/);
    const nodeArchitecture = await waitForOutput(output, /child=(\w+)/);
    if (launcherArchitecture !== expectedArchitecture
      || nodeArchitecture !== expectedArchitecture) {
      throw new Error(
        `runtime architecture mismatch: launcher ${launcherArchitecture}, `
        + `child ${nodeArchitecture}, expected ${expectedArchitecture}`,
      );
    }
    return {
      launcher: launcherArchitecture,
      node: nodeArchitecture,
      childOutput: output.join('').trim(),
    };
  } finally {
    if (child?.ProcessId) {
      try {
        stopPid(child.ProcessId);
      } catch {
        // The child may have already exited after an earlier failure.
      }
    }
    try {
      stopPid(launcher.pid);
    } catch {
      // The launcher may have already exited after an earlier failure.
    }
    if (child?.ProcessId) await waitForExit(child.ProcessId);
    await waitForExit(launcher.pid);
    await removeTree(measurement);
  }
}

async function inspectPackage(path, target, hashes, { measure = false } = {}) {
  const unpacked = await mkdtemp(join(tmpdir(), `recap-page-${target.id}-`));
  try {
    await unpackPackage(path, unpacked);
    const manifest = await readFile(join(unpacked, 'AppxManifest.xml'), 'utf8');
    const identity = {
      name: xmlAttribute(manifest, 'Identity', 'Name'),
      publisher: xmlAttribute(manifest, 'Identity', 'Publisher'),
      version: xmlAttribute(manifest, 'Identity', 'Version'),
      architecture: xmlAttribute(manifest, 'Identity', 'ProcessorArchitecture'),
    };
    const application = {
      executable: xmlAttribute(manifest, 'Application', 'Executable'),
      parameters: xmlAttribute(manifest, 'Application', 'uap10:Parameters'),
    };
    const expectedIdentity = {
      name: PACKAGE_NAME,
      publisher: PACKAGE_PUBLISHER,
      version: STORE_PACKAGE_VERSION,
      architecture: target.id,
    };
    if (JSON.stringify(identity) !== JSON.stringify(expectedIdentity)) {
      throw new Error(`${basename(path)} identity differs: ${JSON.stringify(identity)}`);
    }
    if (application.executable !== 'runtime\\node.exe'
      || application.parameters !== `&quot;$(package.effectivePath)\\${LAUNCHER_NAME}&quot;`) {
      throw new Error(`${basename(path)} activation differs: ${JSON.stringify(application)}`);
    }

    const files = await filesUnder(unpacked);
    const payloads = files.filter((file) => /\.(?:exe|dll|node)$/i.test(file));
    const signed = files.some((file) => basename(file).toLowerCase() === 'appxsignature.p7x');
    if (!signed) throw new Error(`${basename(path)} has no AppxSignature.p7x`);
    if (payloads.length !== 1 || basename(payloads[0]).toLowerCase() !== 'node.exe') {
      throw new Error(`${basename(path)} has unexpected executable payloads: ${payloads.join(', ')}`);
    }
    const nodeMachine = peMachine(await readFile(payloads[0]));
    if (nodeMachine !== target.peMachine) {
      throw new Error(
        `${basename(path)} Node machine 0x${nodeMachine.toString(16)} is not ${target.id}`,
      );
    }
    const nodeHash = await sha256(payloads[0]);
    if (nodeHash !== hashes.get(target.id)) {
      throw new Error(`${basename(path)} Node hash does not match Node's published ${target.id} hash`);
    }

    return {
      file: basename(path),
      sha256: await sha256(path),
      identity,
      application,
      fileCount: files.length,
      signed,
      executablePayloads: ['runtime\\node.exe'],
      nodePeMachine: `0x${nodeMachine.toString(16)}`,
      nodeSha256: nodeHash,
      processes: measure ? await measureProcesses(unpacked, target.id) : undefined,
    };
  } finally {
    await removeTree(unpacked);
  }
}

async function inspectBundle(path, hashes) {
  const unpacked = await mkdtemp(join(tmpdir(), 'recap-page-bundle-'));
  try {
    makeAppx(['unbundle', '/p', path, '/d', unpacked, '/o']);
    const manifest = await readFile(
      join(unpacked, 'AppxMetadata', 'AppxBundleManifest.xml'),
      'utf8',
    );
    const identity = {
      name: xmlAttribute(manifest, 'Identity', 'Name'),
      publisher: xmlAttribute(manifest, 'Identity', 'Publisher'),
      version: xmlAttribute(manifest, 'Identity', 'Version'),
    };
    if (identity.name !== PACKAGE_NAME
      || identity.publisher !== PACKAGE_PUBLISHER
      || identity.version !== STORE_PACKAGE_VERSION) {
      throw new Error(`bundle identity differs: ${JSON.stringify(identity)}`);
    }
    if (manifest.includes(PROOF_UPDATE_VERSION)) {
      throw new Error(`bundle includes proof-only version ${PROOF_UPDATE_VERSION}`);
    }

    const files = await filesUnder(unpacked);
    const innerPaths = files.filter((file) => /\.msix$/i.test(file));
    const signed = files.some((file) => basename(file).toLowerCase() === 'appxsignature.p7x');
    if (!signed) throw new Error(`${basename(path)} has no AppxSignature.p7x`);
    if (innerPaths.length !== PACKAGE_ARCHITECTURES.length) {
      throw new Error(`bundle contains ${innerPaths.length} inner packages`);
    }
    const inner = [];
    for (const target of PACKAGE_ARCHITECTURES) {
      const pathForArchitecture = innerPaths.find((candidate) => (
        basename(candidate).toLowerCase().includes(`_${target.id}.msix`)
      ));
      if (!pathForArchitecture) throw new Error(`bundle is missing its ${target.id} package`);
      inner.push(await inspectPackage(pathForArchitecture, target, hashes));
    }
    return {
      file: basename(path),
      sha256: await sha256(path),
      identity,
      packageCount: innerPaths.length,
      signed,
      packages: inner,
    };
  } finally {
    await removeTree(unpacked);
  }
}

async function main() {
  const hashes = await publishedNodeHashes();
  for (const target of PACKAGE_ARCHITECTURES) {
    if (!hashes.has(target.id)) {
      throw new Error(`Node's published list has no ${target.id} executable hash`);
    }
  }

  const packages = [];
  for (const target of PACKAGE_ARCHITECTURES) {
    packages.push(await inspectPackage(
      packagePath(target.id),
      target,
      hashes,
      { measure: true },
    ));
  }
  const bundle = await inspectBundle(bundlePath(), hashes);
  console.log(JSON.stringify({ nodeVersion: NODE_VERSION, packages, bundle }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}

export { inspectBundle, inspectPackage };
