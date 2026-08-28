// Build the one archive a reader downloads: the app, a Windows Node runtime, and the launcher.
//
// The reason this exists is in BL-145. BL-140 removed the terminal, and everything before the
// terminal was left: install Node from one website, find the project on another, choose the right
// item from a menu written for programmers, extract, open the folder, then double-click. The
// audience is one person who does not program, and every one of those steps is a place they stop.
//
// Run it on any platform. It never copies the runtime this script is running on, which matters
// more than it looks: this project is developed on ARM64, and an archive built from the local
// binary would run for the author and fail for nearly everyone else. That is the worst shape a
// distribution fault can take, because the only person able to diagnose it is the one person who
// cannot reproduce it. The x64 build is fetched from nodejs.org every time, so the author ships
// what the reader receives rather than what the author happens to have.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned by the test matrix rather than by the engines floor. package.json asks for Node 20 or
// newer, which every current line satisfies, so the floor narrows nothing. The CI matrix does: the
// suite runs on 20 and 24 and nothing else, so bundling any other line would hand the reader a
// runtime this project never runs its own tests against.
const NODE_VERSION = 'v24.19.0';
const NODE_ARCH = 'win-x64';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ARCHIVE = join(DIST, 'marvel-reading-tracker-windows.zip');
const PAYLOAD_NAME = 'recap-page';

const base = `https://nodejs.org/dist/${NODE_VERSION}`;
const runtimeZip = `node-${NODE_VERSION}-${NODE_ARCH}.zip`;

const say = (line) => process.stdout.write(`${line}\n`);

// PowerShell rather than a zip library, because a library would be the first runtime dependency
// this project has ever had and Constraint 4 says that number stays at zero. Compress-Archive and
// Expand-Archive ship with Windows, and this script only runs where the archive is built.
function powershell(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// The checksum is what makes this a supply chain step rather than a download. It does not verify
// who signed the list, only that the bytes match the list, so a compromised nodejs.org would defeat
// it. Saying so is the point: the check is worth having and is not worth more confidence than it
// earns.
async function fetchRuntime() {
  say(`fetching ${runtimeZip}`);
  const [archive, sums] = await Promise.all([
    download(`${base}/${runtimeZip}`),
    download(`${base}/SHASUMS256.txt`).then((buffer) => buffer.toString('utf8')),
  ]);

  const line = sums.split(/\r?\n/).find((entry) => entry.trim().endsWith(runtimeZip));
  if (!line) throw new Error(`SHASUMS256.txt for ${NODE_VERSION} does not list ${runtimeZip}`);

  const expected = line.trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) {
    throw new Error(`${runtimeZip} does not match its published checksum:\n  published ${expected}\n  received  ${actual}`);
  }

  say(`  ${archive.length} bytes, sha256 verified`);
  return archive;
}

// What goes in is derived from git rather than listed here. A list is a thing someone has to keep
// complete, and the failure it produces is an archive missing a file nobody noticed, on a machine
// nobody here is sitting at. The rule is what the running app touches: the server, everything it
// serves, the launcher it is started by, and the licences.
function appFiles() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

  const wanted = tracked.filter((path) => path.startsWith('src/')
    || path === 'server.mjs'
    || path === 'Start on Windows.cmd'
    || path === 'LICENSE');

  if (!wanted.includes('server.mjs')) throw new Error('server.mjs is not tracked, so the archive would not run');
  if (!wanted.includes('Start on Windows.cmd')) throw new Error('the Windows launcher is not tracked');
  if (!wanted.some((path) => path.startsWith('src/'))) throw new Error('no src/ files are tracked');

  return wanted;
}

// The reader has just extracted a folder and is looking at it. This is the only thing in the
// archive written to be read before anything is run.
const readMe = [
  'Recap Page',
  '',
  'To start: double-click "Start on Windows.cmd" in this folder.',
  '',
  'A small window opens and stays open, and your browser opens the tracker by itself.',
  'That window is the tracker running, so leave it alone until you are finished.',
  'To stop, click that window and press Ctrl+C.',
  '',
  'Nothing needs installing. Everything the tracker needs is in this folder, including',
  'the runtime, which is in "runtime". Nothing is uploaded anywhere and no account is',
  'needed. Your reading progress is kept by your browser, so stopping the tracker never',
  'loses it.',
  '',
  'Windows may ask you to confirm the first time, because this folder arrived from the',
  'internet. That prompt is expected.',
  '',
  'The tracker itself is covered by LICENSE. The bundled runtime is Node.js, and its own',
  'licence, covering everything inside it, is runtime\\LICENSE-node.txt.',
  '',
].join('\r\n');

async function main() {
  const staging = await mkdtemp(join(tmpdir(), 'mrt-pack-'));
  // Staged outside the repository on purpose. A copy of src/ inside the tree would be walked by
  // the licence boundary test, which counts item-bearing files across everything that is not
  // node_modules, .git or .copilot-tracking, and its count is exact rather than a floor.
  const payload = join(staging, PAYLOAD_NAME);
  const runtimeOut = join(payload, 'runtime');

  try {
    const archive = await fetchRuntime();
    const runtimeZipPath = join(staging, runtimeZip);
    await writeFile(runtimeZipPath, archive);

    say('extracting the runtime');
    await mkdir(runtimeOut, { recursive: true });
    powershell(`Expand-Archive -LiteralPath '${runtimeZipPath}' -DestinationPath '${staging}' -Force`);

    const unpacked = join(staging, `node-${NODE_VERSION}-${NODE_ARCH}`);
    await copyFile(join(unpacked, 'node.exe'), join(runtimeOut, 'node.exe'));

    // The whole file, not a summary of it. The runtime's own grant is MIT, but the file that
    // travels with the distribution names 47 bundled components, OpenSSL and V8 and ICU among
    // them, each with its own attribution terms. Writing "MIT" beside the binary would
    // under-attribute what is inside it. Measured on the v24.19.0 win-x64 distribution: 160,552
    // bytes, 47 entries reading "located at".
    await copyFile(join(unpacked, 'LICENSE'), join(runtimeOut, 'LICENSE-node.txt'));

    say('staging the app');
    for (const file of appFiles()) {
      const destination = join(payload, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(ROOT, file), destination);
    }
    await writeFile(join(payload, 'Read this first.txt'), readMe);

    say('compressing');
    await rm(DIST, { recursive: true, force: true });
    await mkdir(DIST, { recursive: true });
    powershell(`Compress-Archive -LiteralPath '${payload}' -DestinationPath '${ARCHIVE}' -Force`);

    const { size } = await stat(ARCHIVE);
    say('');
    say(`${relative(ROOT, ARCHIVE)}`);
    say(`  ${size} bytes, near ${Math.round(size / (1024 * 1024))} MiB`);
    say(`  runtime ${NODE_VERSION} ${NODE_ARCH}, fetched and checksum-verified rather than copied from this machine`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Only when run directly. The test imports this module for the constants and the file rule, and an
// import that downloaded 37 MB of runtime would be a test suite nobody runs twice.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

export { NODE_VERSION, NODE_ARCH, PAYLOAD_NAME, appFiles, ARCHIVE, readMe, fetchRuntime };
