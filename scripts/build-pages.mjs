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
import { createHash, randomUUID } from 'node:crypto';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PAGE_DOCUMENTS, RELEASE_PAGE, renderDocumentPage, renderSitePage } from './lib/pages-documents.mjs';
import { readReleaseDates, releasesPage } from './lib/pages-releases.mjs';
import { renderAppDemo } from './lib/pages-demo.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const PAGE_SOURCES = Object.freeze([
  Object.freeze({ source: 'pages/index.html', destination: 'index.html' }),
  Object.freeze({ source: 'pages/site.css', destination: 'site.css' }),
  Object.freeze({ source: 'pages/site.js', destination: 'site.js' }),
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
  Object.freeze({
    source: 'pages/assets/wordmark.svg',
    destination: 'assets/wordmark.svg',
  }),
  Object.freeze({
    source: 'pages/assets/wordmark-dark.svg',
    destination: 'assets/wordmark-dark.svg',
  }),
]);

export const PAGE_OUTPUTS = Object.freeze(
  [...PAGE_SOURCES, ...PAGE_DOCUMENTS, RELEASE_PAGE, { destination: 'demo.html' }].map(({ destination }) => destination).sort(),
);

export { PAGE_DOCUMENTS, RELEASE_PAGE };

// GitHub Pages lets a browser reuse each file for ten minutes, so a visit soon after a deploy could
// pair new markup with the previous stylesheet and script. Three minutes after #1421 deployed, the
// redesigned home rendered that way, unstyled and pinned to the left of a wide window. A digest of
// each file's bytes in the address makes every deploy that changes a file ask for it afresh. The
// order is load-bearing: the demo address lands in site.js before site.js is digested.
const STYLESHEET_LINK = '<link rel="stylesheet" href="./site.css" />';
export const ASSET_STAMPS = Object.freeze([
  Object.freeze({ file: 'site.js', asset: 'demo.html', reference: "frame.src = './demo.html';" }),
  Object.freeze({ file: 'index.html', asset: 'site.css', reference: STYLESHEET_LINK }),
  Object.freeze({ file: 'index.html', asset: 'site.js', reference: '<script type="module" src="./site.js"></script>' }),
  ...[...PAGE_DOCUMENTS, RELEASE_PAGE].map(({ destination }) => (
    Object.freeze({ file: destination, asset: 'site.css', reference: STYLESHEET_LINK })
  )),
]);

export function assetVersion(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export function stampedReference({ asset, reference }, version) {
  return reference.replace(`./${asset}`, `./${asset}?v=${version}`);
}

export async function stampAssets(root, stamps = ASSET_STAMPS) {
  for (const stamp of stamps) {
    const path = join(root, stamp.file);
    const parts = (await readFile(path, 'utf8')).split(stamp.reference);
    if (parts.length !== 2) {
      throw new Error(`${stamp.file} must contain ${stamp.reference} exactly once, found ${parts.length - 1}`);
    }
    const version = assetVersion(await readFile(join(root, stamp.asset)));
    await writeFile(path, parts.join(stampedReference(stamp, version)));
  }
}

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
  await requireExactEntries(join(sourceRoot, 'pages'), ['assets', 'being-built.md', 'data-sources.md', 'demo.css', 'demo.js', 'index.html', 'site.css', 'site.js']);
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
    await writeFile(join(staged, 'demo.html'), await renderAppDemo(sourceRoot));
    await stampAssets(staged);
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
