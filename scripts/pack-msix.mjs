import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFile, mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NODE_ARCH, NODE_VERSION, appFiles, fetchRuntime,
} from './pack-windows.mjs';

export const PACKAGE_NAME = 'PanelStackLabs.RecapPage';
export const PACKAGE_PUBLISHER = 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472';
export const PACKAGE_FAMILY = 'PanelStackLabs.RecapPage_we33aa8nvkpcc';
export const AUMID = `${PACKAGE_FAMILY}!App`;
export const PACKAGE_VERSIONS = Object.freeze(['2.0.0.0', '2.0.0.1']);
export const LAUNCHER_NAME = 'RecapPageLauncher.exe';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MSIX_ROOT = join(ROOT, 'dist', 'msix');
export const CERTIFICATE_PATH = join(MSIX_ROOT, 'RecapPage-local-proof.pfx');
export const PUBLIC_CERTIFICATE_PATH = join(MSIX_ROOT, 'RecapPage-local-proof.cer');

const MANIFEST_SOURCE = join(ROOT, 'packaging', 'windows', 'Package.appxmanifest');
const LAUNCHER_SOURCE = join(ROOT, 'packaging', 'windows', 'Launcher.cs');
const ICON_SOURCE = join(ROOT, 'src', 'icons', 'icon-512.png');
const CSC_PATH = join(
  process.env.WINDIR ?? 'C:\\Windows',
  'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe',
);
const runtimeZip = `node-${NODE_VERSION}-${NODE_ARCH}.zip`;

const packagePath = (version) => join(MSIX_ROOT, `RecapPage_${version}_x64.msix`);
const layoutPath = (staging, version) => join(staging, `layout-${version}`);
const say = (line) => process.stdout.write(`${line}\n`);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64e6,
    ...options,
  });
}

function powershell(script) {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function copyApp(layout) {
  const files = appFiles().filter((path) => path !== 'Start on Windows.cmd');
  for (const file of files) {
    const destination = join(layout, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(ROOT, file), destination);
  }
}

async function prepareLayout(staging, version, runtimeDir) {
  const layout = layoutPath(staging, version);
  await mkdir(layout, { recursive: true });
  await copyApp(layout);

  const manifest = (await readFile(MANIFEST_SOURCE, 'utf8'))
    .replace(/Version="[^"]+"/, `Version="${version}"`);
  await writeFile(join(layout, 'Package.appxmanifest'), manifest);

  const runtimeOut = join(layout, 'runtime');
  await mkdir(runtimeOut, { recursive: true });
  await copyFile(join(runtimeDir, 'node.exe'), join(runtimeOut, 'node.exe'));
  await copyFile(join(runtimeDir, 'LICENSE'), join(runtimeOut, 'LICENSE-node.txt'));
  run(CSC_PATH, [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    `/out:${join(layout, LAUNCHER_NAME)}`,
    LAUNCHER_SOURCE,
  ]);

  await writeFile(
    join(layout, 'src', 'msix-generation.json'),
    `${JSON.stringify({ packageVersion: version, generation: `proof-${version}` }, null, 2)}\n`,
  );

  run('winapp', [
    'manifest', 'update-assets', ICON_SOURCE,
    '--manifest', join(layout, 'Package.appxmanifest'),
    '--quiet',
  ]);
  return layout;
}

async function build() {
  const version = run('winapp', ['--version']).trim();
  if (version !== '0.6.0') {
    throw new Error(`winapp 0.6.0 is required for this proof; found ${version || 'no version'}`);
  }
  if (NODE_ARCH !== 'win-x64') throw new Error(`MSIX proof requires win-x64 Node; found ${NODE_ARCH}`);

  await rm(MSIX_ROOT, { recursive: true, force: true });
  await mkdir(MSIX_ROOT, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), 'recap-page-msix-'));

  try {
    const archive = await fetchRuntime();
    const archivePath = join(staging, runtimeZip);
    await writeFile(archivePath, archive);
    powershell(`Expand-Archive -LiteralPath ${psLiteral(archivePath)} -DestinationPath ${psLiteral(staging)} -Force`);
    const runtimeDir = join(staging, `node-${NODE_VERSION}-${NODE_ARCH}`);

    const layouts = [];
    for (const packageVersion of PACKAGE_VERSIONS) {
      layouts.push(await prepareLayout(staging, packageVersion, runtimeDir));
    }

    const password = randomBytes(32).toString('hex');
    run('winapp', [
      'cert', 'generate',
      '--manifest', join(layouts[0], 'Package.appxmanifest'),
      '--output', CERTIFICATE_PATH,
      '--password', password,
      '--export-cer',
      '--if-exists', 'overwrite',
      '--quiet',
    ]);

    for (let index = 0; index < PACKAGE_VERSIONS.length; index += 1) {
      const packageVersion = PACKAGE_VERSIONS[index];
      say(`packaging ${packageVersion}`);
      run('winapp', [
        'package', layouts[index],
        '--manifest', join(layouts[index], 'Package.appxmanifest'),
        '--output', packagePath(packageVersion),
        '--cert', CERTIFICATE_PATH,
        '--cert-password', password,
        '--quiet',
      ]);
    }
  } finally {
    await rm(CERTIFICATE_PATH, { force: true });
    await rm(staging, { recursive: true, force: true });
  }

  say('');
  for (const packageVersion of PACKAGE_VERSIONS) say(packagePath(packageVersion));
  say(PUBLIC_CERTIFICATE_PATH);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build();
}

export { build, packagePath };
