import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PAGE_DOCUMENTS, RELEASE_PAGE, renderDocumentPage, renderSitePage } from './lib/pages-documents.mjs';
import { readReleaseDates, releasesPage } from './lib/pages-releases.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const PAGE_SOURCES = Object.freeze([
  Object.freeze({ source: 'pages/index.html', destination: 'index.html' }),
  Object.freeze({ source: 'pages/site.css', destination: 'site.css' }),
  Object.freeze({
    source: 'docs/screenshots/home-960.png',
    destination: 'assets/home-960.png',
  }),
  Object.freeze({
    source: 'docs/screenshots/avengers-disassembled-reading-960.png',
    destination: 'assets/avengers-disassembled-reading-960.png',
  }),
  Object.freeze({
    source: 'pages/assets/android-feature-graphic.png',
    destination: 'assets/android-feature-graphic.png',
  }),
  Object.freeze({
    source: 'pages/assets/android-library-preview.png',
    destination: 'assets/android-library-preview.png',
  }),
  Object.freeze({
    source: 'pages/assets/android-reading-preview.png',
    destination: 'assets/android-reading-preview.png',
  }),
]);

export const PAGE_OUTPUTS = Object.freeze(
  [...PAGE_SOURCES, ...PAGE_DOCUMENTS, RELEASE_PAGE].map(({ destination }) => destination).sort(),
);

export { PAGE_DOCUMENTS, RELEASE_PAGE };

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
  releaseDates = readReleaseDates,
} = {}) {
  const sourceRoot = resolve(root);
  const output = resolve(destination);
  const outputParent = dirname(output);
  await requireExactEntries(join(sourceRoot, 'pages'), ['assets', 'being-built.md', 'data-sources.md', 'index.html', 'site.css']);
  await requireExactEntries(
    join(sourceRoot, 'pages', 'assets'),
    PAGE_SOURCES
      .filter(({ source }) => source.startsWith('pages/assets/'))
      .map(({ source }) => basename(source)),
  );
  await requireExactEntries(
    join(sourceRoot, 'docs', 'screenshots'),
    PAGE_SOURCES
      .filter(({ source }) => source.startsWith('docs/screenshots/'))
      .map(({ source }) => basename(source)),
  );

  for (const { source } of [...PAGE_SOURCES, ...PAGE_DOCUMENTS, RELEASE_PAGE]) {
    await requireRegularFile(join(sourceRoot, ...source.split('/')));
  }
  const changelog = await readFile(join(sourceRoot, ...RELEASE_PAGE.source.split('/')), 'utf8');
  const releasePage = renderSitePage(RELEASE_PAGE, releasesPage(changelog, releaseDates(sourceRoot)));

  await mkdir(outputParent, { recursive: true });
  const staged = await mkdtemp(join(outputParent, `${basename(output)}.staged-`));

  try {
    for (const { source, destination: relativeDestination } of PAGE_SOURCES) {
      const target = join(staged, ...relativeDestination.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(sourceRoot, ...source.split('/')), target);
    }
    for (const document of PAGE_DOCUMENTS) {
      const markdown = await readFile(join(sourceRoot, ...document.source.split('/')), 'utf8');
      await writeFile(join(staged, document.destination), renderDocumentPage(document, markdown));
    }
    await writeFile(join(staged, RELEASE_PAGE.destination), releasePage);
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
