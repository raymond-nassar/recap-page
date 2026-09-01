import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir, mkdtemp, readFile, readdir, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename, dirname, join, relative,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAUNCHER_NAME, PACKAGE_ARCHITECTURES, PACKAGE_NAME, PACKAGE_PUBLISHER,
  PROOF_UPDATE_VERSION, STORE_PACKAGE_VERSION, bundlePath, packagePath,
} from './pack-msix.mjs';
import { NODE_VERSION } from './pack-windows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTERNAL_UPDATER_MARKERS = Object.freeze([
  ['GitHub release API', 'api.github.com/repos/raymond-nassar/recap-page/releases'],
  ['GitHub release page', 'github.com/raymond-nassar/recap-page/releases'],
  ['standalone Windows archive', 'marvel-reading-tracker-windows.zip'],
  ['automatic update function', 'runAutomaticUpdateCheck'],
  ['manual update function', 'runExplicitUpdateCheck'],
  ['update preference control', 'opt-update-checks'],
  ['manual update control', 'btn-check-updates'],
  ['update result region', 'update-check-report'],
  ['standalone extraction instruction', 'Unzip it anywhere'],
  ['standalone replacement instruction', 'delete the old folder'],
  ['App Installer URI', 'ms-appinstaller:'],
]);

export function parseInspectArguments(args) {
  let structural = false;
  for (const arg of args) {
    if (arg === '--structural') structural = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { measureRuntimes: !structural };
}

export function externalUpdaterFindings(entries) {
  const findings = [];
  for (const entry of entries) {
    const path = String(entry.path).replaceAll('\\', '/');
    const lowerPath = path.toLowerCase();
    if (lowerPath === 'src/js/lib/updatecheck.js') {
      findings.push({ path, reason: 'retired updater module' });
    }
    if (lowerPath.endsWith('.appinstaller')) {
      findings.push({ path, reason: 'App Installer file' });
    }
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(String(entry.bytes));
    for (const [name, marker] of EXTERNAL_UPDATER_MARKERS) {
      if (bytes.includes(Buffer.from(marker))) findings.push({ path, reason: name });
    }
  }
  return findings;
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
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

async function assertNoExternalUpdater(root, files, packageName) {
  const entries = await Promise.all(files.map(async (path) => ({
    path: relative(root, path),
    bytes: await readFile(path),
  })));
  const findings = externalUpdaterFindings(entries);
  if (findings.length === 0) return;
  throw new Error(
    `${packageName} contains an external updater: `
    + findings.map((finding) => `${finding.path} (${finding.reason})`).join(', '),
  );
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

async function measureRuntime(
  layout,
  expectedArchitecture,
  { spawnImpl = spawn, waitForOutputImpl = waitForOutput } = {},
) {
  const executable = join(layout, 'runtime', 'node.exe');
  const launcher = spawnImpl(executable, ['-e', 'console.log(`runtime=${process.arch}`)'], {
    cwd: layout,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exitPromise = new Promise((resolveExit, rejectExit) => {
    launcher.once('error', rejectExit);
    launcher.once('exit', resolveExit);
  });
  const output = [];
  launcher.stdout.on('data', (chunk) => output.push(chunk.toString()));
  launcher.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const [architecture, exit] = await Promise.all([
    waitForOutputImpl(output, /runtime=(\w+)/),
    exitPromise,
  ]);
  if (exit !== 0 || architecture !== expectedArchitecture) {
    throw new Error(
      `runtime architecture mismatch: ${architecture}, expected ${expectedArchitecture}, exit ${exit}`,
    );
  }
  return {
    runtime: architecture,
    output: output.join('').trim(),
  };
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
    await assertNoExternalUpdater(unpacked, files, basename(path));
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
    const generation = JSON.parse(
      await readFile(join(unpacked, 'src', 'msix-generation.json'), 'utf8'),
    );
    if (generation.packageVersion !== STORE_PACKAGE_VERSION
      || !/^[0-9a-f]{64}$/.test(generation.generation)) {
      throw new Error(`${basename(path)} has an invalid package generation marker`);
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
      generation,
      runtimeProcess: measure ? await measureRuntime(unpacked, target.id) : undefined,
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

async function main({ measureRuntimes = true } = {}) {
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
      { measure: measureRuntimes },
    ));
  }
  const bundle = await inspectBundle(bundlePath(), hashes);
  console.log(JSON.stringify({ nodeVersion: NODE_VERSION, packages, bundle }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(parseInspectArguments(process.argv.slice(2))).catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}

export { inspectBundle, inspectPackage, measureRuntime };
