import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const PAGE_SOURCES = Object.freeze([
  Object.freeze({ source: 'pages/index.html', destination: 'index.html' }),
  Object.freeze({ source: 'pages/site.css', destination: 'site.css' }),
  Object.freeze({
    source: 'docs/screenshots/home-1280.png',
    destination: 'assets/home-1280.png',
  }),
  Object.freeze({
    source: 'docs/screenshots/avengers-disassembled-reading-1280.png',
    destination: 'assets/avengers-disassembled-reading-1280.png',
  }),
]);

export const PAGE_OUTPUTS = Object.freeze(PAGE_SOURCES.map(({ destination }) => destination).sort());

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function requireRegularFile(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Pages source must be a regular file: ${path}`);
  }
}

async function requireExactEntries(path, expected) {
  const entries = (await readdir(path)).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(entries) !== JSON.stringify(wanted)) {
    throw new Error(
      `Pages source inventory at ${path} is ${JSON.stringify(entries)}, expected ${JSON.stringify(wanted)}`,
    );
  }
}

export async function artifactInventory(root) {
  const found = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Pages artifact cannot contain a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Pages artifact can contain only files and directories: ${path}`);
      }
      found.push(relative(root, path).replaceAll('\\', '/'));
    }
  }

  await walk(root);
  return found.sort();
}

async function verifyArtifact(path) {
  const actual = await artifactInventory(path);
  if (JSON.stringify(actual) !== JSON.stringify(PAGE_OUTPUTS)) {
    throw new Error(
      `Pages artifact inventory is ${JSON.stringify(actual)}, expected ${JSON.stringify(PAGE_OUTPUTS)}`,
    );
  }
}

export async function installArtifact(staged, destination, {
  pathExists = exists,
  move = rename,
  remove = rm,
  makeId = randomUUID,
} = {}) {
  const previous = `${destination}.previous-${makeId()}`;
  const hadPrevious = await pathExists(destination);

  if (hadPrevious) await move(destination, previous);

  try {
    await move(staged, destination);
  } catch (installError) {
    if (!hadPrevious) throw installError;
    try {
      await move(previous, destination);
    } catch (restoreError) {
      throw new AggregateError(
        [installError, restoreError],
        `Pages artifact installation failed and the previous artifact could not be restored at ${destination}`,
        { cause: restoreError },
      );
    }
    throw installError;
  }

  if (hadPrevious) await remove(previous, { recursive: true });
}

export async function buildPages({
  root = ROOT,
  destination = join(root, 'dist', 'pages'),
  installer = installArtifact,
} = {}) {
  const sourceRoot = resolve(root);
  const output = resolve(destination);
  const outputParent = dirname(output);
  await requireExactEntries(join(sourceRoot, 'pages'), ['index.html', 'site.css']);
  await requireExactEntries(
    join(sourceRoot, 'docs', 'screenshots'),
    PAGE_SOURCES
      .filter(({ source }) => source.startsWith('docs/screenshots/'))
      .map(({ source }) => basename(source)),
  );

  for (const { source } of PAGE_SOURCES) {
    await requireRegularFile(join(sourceRoot, ...source.split('/')));
  }

  await mkdir(outputParent, { recursive: true });
  const staged = await mkdtemp(join(outputParent, `${basename(output)}.staged-`));

  try {
    for (const { source, destination: relativeDestination } of PAGE_SOURCES) {
      const target = join(staged, ...relativeDestination.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(sourceRoot, ...source.split('/')), target);
    }
    await verifyArtifact(staged);
    await installer(staged, output);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }

  await verifyArtifact(output);
  return { destination: output, files: [...PAGE_OUTPUTS] };
}

async function main() {
  const result = await buildPages();
  console.log(`Pages artifact: ${result.files.length} files in ${result.destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
