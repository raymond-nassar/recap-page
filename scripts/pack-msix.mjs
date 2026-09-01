import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NODE_ARCH, NODE_VERSION, appFiles, fetchRuntime, runtimeArchiveName,
} from './pack-windows.mjs';

export const PACKAGE_NAME = 'PanelStackLabs.RecapPage';
export const PACKAGE_PUBLISHER = 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472';
export const PACKAGE_FAMILY = 'PanelStackLabs.RecapPage_we33aa8nvkpcc';
export const AUMID = `${PACKAGE_FAMILY}!App`;
export const STORE_PACKAGE_VERSION = '2.0.2.0';
export const PROOF_UPDATE_VERSION = '2.0.2.1';
export const PACKAGE_VERSIONS = Object.freeze([STORE_PACKAGE_VERSION, PROOF_UPDATE_VERSION]);
export const PACKAGE_ARCHITECTURES = Object.freeze([
  Object.freeze({ id: 'x64', node: NODE_ARCH, peMachine: 0x8664 }),
  Object.freeze({ id: 'arm64', node: 'win-arm64', peMachine: 0xaa64 }),
]);
export const LAUNCHER_NAME = 'Launcher.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MSIX_ROOT = join(ROOT, 'dist', 'msix');
export const MSIX_PROOF_ROOT = join(ROOT, 'dist', 'msix-proof');
export const CERTIFICATE_PATH = join(MSIX_ROOT, 'RecapPage-local-proof.pfx');
export const PUBLIC_CERTIFICATE_PATH = join(MSIX_ROOT, 'RecapPage-local-proof.cer');

const MANIFEST_SOURCE = join(ROOT, 'packaging', 'windows', 'Package.appxmanifest');
const LAUNCHER_SOURCE = join(ROOT, 'packaging', 'windows', LAUNCHER_NAME);
const ICON_SOURCE = join(ROOT, 'src', 'icons', 'icon-512.png');

const say = (line) => process.stdout.write(`${line}\n`);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64e6,
    ...options,
  });
}

export function winAppCliVersion(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^\d+\.\d+\.\d+$/.test(line)) ?? null;
}

function powershell(script) {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function architecture(id) {
  const found = PACKAGE_ARCHITECTURES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unsupported package architecture: ${id}`);
  return found;
}

export function packagePath(architectureId = 'x64') {
  architecture(architectureId);
  return join(MSIX_ROOT, `RecapPage_${STORE_PACKAGE_VERSION}_${architectureId}.msix`);
}

export function proofPackagePath(version) {
  if (!PACKAGE_VERSIONS.includes(version)) throw new Error(`unsupported proof version: ${version}`);
  if (version === STORE_PACKAGE_VERSION) return packagePath('x64');
  return join(MSIX_PROOF_ROOT, `RecapPage_${version}_x64.msix`);
}

export function bundlePath() {
  return join(MSIX_ROOT, `RecapPage_${STORE_PACKAGE_VERSION}_x64_arm64.msixbundle`);
}

function layoutPath(staging, version, architectureId) {
  return join(staging, `layout-${version}-${architectureId}`);
}

async function copyApp(layout) {
  const files = appFiles().filter((path) => path !== 'Start on Windows.cmd');
  for (const file of files) {
    const destination = join(layout, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(ROOT, file), destination);
  }
}

async function filesUnder(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(join(root, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

async function layoutGeneration(layout) {
  const digest = createHash('sha256');
  for (const relative of (await filesUnder(layout)).sort()) {
    digest.update(relative);
    digest.update('\0');
    digest.update(await readFile(join(layout, ...relative.split('/'))));
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function prepareLayout(staging, version, target, runtimeDir) {
  const layout = layoutPath(staging, version, target.id);
  await mkdir(layout, { recursive: true });
  await copyApp(layout);
  await copyFile(LAUNCHER_SOURCE, join(layout, LAUNCHER_NAME));

  const manifest = (await readFile(MANIFEST_SOURCE, 'utf8'))
    .replace(/Version="[^"]+"/, `Version="${version}"`)
    .replace(/ProcessorArchitecture="[^"]+"/, `ProcessorArchitecture="${target.id}"`);
  await writeFile(join(layout, 'Package.appxmanifest'), manifest);

  const runtimeOut = join(layout, 'runtime');
  await mkdir(runtimeOut, { recursive: true });
  await copyFile(join(runtimeDir, 'node.exe'), join(runtimeOut, 'node.exe'));
  await copyFile(join(runtimeDir, 'LICENSE'), join(runtimeOut, 'LICENSE-node.txt'));

  const generation = await layoutGeneration(layout);
  await writeFile(
    join(layout, 'src', 'msix-generation.json'),
    `${JSON.stringify({ packageVersion: version, generation }, null, 2)}\n`,
  );

  run('winapp', [
    'manifest', 'update-assets', ICON_SOURCE,
    '--manifest', join(layout, 'Package.appxmanifest'),
    '--quiet',
  ]);
  return layout;
}

async function fetchRuntimeDirectory(staging, target) {
  const runtimeStaging = join(staging, `runtime-${target.id}`);
  await mkdir(runtimeStaging, { recursive: true });
  const archive = await fetchRuntime(target.node);
  const archivePath = join(runtimeStaging, runtimeArchiveName(target.node));
  await writeFile(archivePath, archive);
  powershell(
    `Expand-Archive -LiteralPath ${psLiteral(archivePath)} `
    + `-DestinationPath ${psLiteral(runtimeStaging)} -Force`,
  );
  return join(runtimeStaging, `node-${NODE_VERSION}-${target.node}`);
}

async function hash(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function packageLayout(layout, output, password) {
  run('winapp', [
    'package', layout,
    '--manifest', join(layout, 'Package.appxmanifest'),
    '--output', output,
    '--cert', CERTIFICATE_PATH,
    '--cert-password', password,
    '--quiet',
  ]);
}

async function build() {
  const version = winAppCliVersion(run('winapp', ['--version']));
  if (version !== '0.6.0') {
    throw new Error(`winapp 0.6.0 is required for this build; found ${version || 'no version'}`);
  }
  if (NODE_ARCH !== 'win-x64') {
    throw new Error(`the GitHub ZIP runtime must remain win-x64; found ${NODE_ARCH}`);
  }

  await rm(MSIX_ROOT, { recursive: true, force: true });
  await rm(MSIX_PROOF_ROOT, { recursive: true, force: true });
  await mkdir(MSIX_ROOT, { recursive: true });
  await mkdir(MSIX_PROOF_ROOT, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), 'recap-page-msix-'));

  try {
    const runtimeDirectories = new Map();
    for (const target of PACKAGE_ARCHITECTURES) {
      runtimeDirectories.set(target.id, await fetchRuntimeDirectory(staging, target));
    }

    const layouts = new Map();
    for (const target of PACKAGE_ARCHITECTURES) {
      layouts.set(target.id, await prepareLayout(
        staging,
        STORE_PACKAGE_VERSION,
        target,
        runtimeDirectories.get(target.id),
      ));
    }
    const x64 = architecture('x64');
    const updateLayout = await prepareLayout(
      staging,
      PROOF_UPDATE_VERSION,
      x64,
      runtimeDirectories.get(x64.id),
    );
    const password = randomBytes(32).toString('hex');
    run('winapp', [
      'cert', 'generate',
      '--manifest', join(layouts.get('x64'), 'Package.appxmanifest'),
      '--output', CERTIFICATE_PATH,
      '--password', password,
      '--export-cer',
      '--if-exists', 'overwrite',
      '--quiet',
    ]);

    for (const target of PACKAGE_ARCHITECTURES) {
      say(`packaging ${STORE_PACKAGE_VERSION} ${target.id}`);
      packageLayout(layouts.get(target.id), packagePath(target.id), password);
    }

    say(`packaging proof-only ${PROOF_UPDATE_VERSION} x64`);
    packageLayout(updateLayout, proofPackagePath(PROOF_UPDATE_VERSION), password);

    say(`bundling ${STORE_PACKAGE_VERSION} x64 and arm64`);
    run('winapp', [
      'package',
      layouts.get('x64'),
      layouts.get('arm64'),
      '--output', bundlePath(),
      '--cert', CERTIFICATE_PATH,
      '--cert-password', password,
      '--quiet',
    ]);
  } finally {
    await rm(CERTIFICATE_PATH, { force: true });
    await rm(staging, { recursive: true, force: true });
  }

  say('');
  for (const target of PACKAGE_ARCHITECTURES) {
    const output = packagePath(target.id);
    const { size } = await stat(output);
    say(`${output}\n  ${size} bytes, sha256 ${await hash(output)}`);
  }
  const bundle = bundlePath();
  const { size } = await stat(bundle);
  say(`${bundle}\n  ${size} bytes, sha256 ${await hash(bundle)}`);
  say(`${proofPackagePath(PROOF_UPDATE_VERSION)}\n  proof-only, excluded from Store output and bundle`);
  say(PUBLIC_CERTIFICATE_PATH);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build();
}

export { build, layoutGeneration };
