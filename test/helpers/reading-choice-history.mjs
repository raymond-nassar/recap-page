import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from '../../scripts/report-order-overlap.mjs';
import { registeredOwnerGuideIds } from '../../scripts/lib/owner-guide-registry.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { sha256, ...evidence } = JSON.parse(readFileSync(
  new URL('../fixtures/reading-choice-history.json', import.meta.url), 'utf8',
));
if (createHash('sha256').update(JSON.stringify(evidence)).digest('hex') !== sha256
  || evidence.entries.length !== 13 || evidence.issueIds.length !== 89
  || new Set(evidence.entries.map(({ id }) => id)).size !== 13
  || new Set(evidence.issueIds).size !== 89
  || Object.keys(evidence.payloadEditorial).length !== 12
  || evidence.catalogEntries.length !== 13
  || new Set(evidence.catalogEntries.map(({ id }) => id)).size !== 13) {
  throw new Error('Historical reading choices do not match their captured source inputs.');
}
const entries = new Map(evidence.entries.map((entry) => [entry.id, entry]));
const catalogEntries = new Map(evidence.catalogEntries.map((entry) => [entry.id, entry]));
const { sha256: descriptionSha256, ...descriptionRevision } = JSON.parse(readFileSync(
  new URL('../fixtures/mcu-prep-description-refresh.json', import.meta.url), 'utf8',
));
if (createHash('sha256').update(JSON.stringify(descriptionRevision)).digest('hex') !== descriptionSha256
  || descriptionRevision.sourceCommit !== '1389e546de45b76844325cf149a6b7911829d360'
  || descriptionRevision.entries.length !== 10
  || new Set(descriptionRevision.entries.map(({ id }) => id)).size !== 10
  || new Set(descriptionRevision.entries.map(({ file }) => file)).size !== 10) {
  throw new Error('MCU description revision does not match its captured editorial change.');
}
const descriptions = new Map(descriptionRevision.entries.map((entry) => [entry.id, entry]));
const descriptionFiles = new Map(descriptionRevision.entries.map((entry) => [entry.file, entry]));
const tempDirs = new Set();
let snapshotPromise;

after(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
});

function requireCurrentDescription(entry, revision) {
  if (entry.id !== revision.id) {
    throw new Error(`${revision.file}: MCU description identity does not match ${revision.id}`);
  }
  if (entry.description !== revision.after) {
    throw new Error(`${revision.id}: expected exact current description before historical reconstruction`);
  }
}

// A copy revision is not a new source approval. Replay only its exact, checked inverse.
export function historicalMcuDescriptionEntry(entry) {
  const file = entry.out ?? entry.file;
  const revision = descriptions.get(entry.id) ?? descriptionFiles.get(file);
  if (!revision) return entry;
  requireCurrentDescription(entry, revision);
  if (file !== revision.file
    || (Object.hasOwn(entry, 'out') && entry.out !== revision.file)
    || (Object.hasOwn(entry, 'file') && entry.file !== revision.file)) {
    throw new Error(`${revision.id}: MCU description payload identity does not match ${revision.file}`);
  }
  return { ...entry, description: revision.before };
}

export function historicalMcuDescriptionManifest(manifest) {
  return { ...manifest, lists: manifest.lists.map(historicalMcuDescriptionEntry) };
}

export function historicalMcuDescriptionPayloadText(file, text) {
  const revision = descriptionFiles.get(file);
  if (!revision) return text;
  requireCurrentDescription(JSON.parse(text), revision);
  const header = `  "description": ${JSON.stringify(revision.after)},`;
  const headers = text.match(/^ {2}"description": .+,\r?$/gm) ?? [];
  if (headers.length !== 1 || headers[0].replace(/\r$/, '') !== header) {
    throw new Error(`${file}: expected one exact top-level MCU description header`);
  }
  return text.replace(header, () => `  "description": ${JSON.stringify(revision.before)},`);
}

// Source approvals bind the original names and vectors, not the later catalog's renamed choices.
export function historicalReadingChoiceManifest(manifest) {
  return {
    ...manifest,
    lists: historicalMcuDescriptionManifest(manifest).lists
      .filter(({ id }) => id !== 'avengers-doomsday-secret-wars' && !registeredOwnerGuideIds.includes(id))
      .map((entry) => entries.has(entry.id) ? structuredClone(entries.get(entry.id)) : entry),
  };
}

export function historicalReadingChoiceIssueIds(id, currentIds) {
  return id === 'hickman-minimal' ? evidence.issueIds.map(String) : currentIds;
}

export function historicalReadingChoiceCatalogEntry(entry) {
  const original = historicalMcuDescriptionEntry(entry);
  return catalogEntries.has(entry.id) ? structuredClone(catalogEntries.get(entry.id)) : original;
}

export async function historicalReadingChoicePayloadText(file) {
  const sourcePath = path.resolve(root, file);
  const relative = path.relative(root, sourcePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Historical payload sources must remain inside the repository.');
  }
  const payloadFile = path.relative(path.join(root, 'src', 'data'), sourcePath);
  if (payloadFile === 'hickman_minimal.json') {
    throw new Error('The rewritten fast-track payload requires its original metadata, not only its historical vector.');
  }
  let text = historicalMcuDescriptionPayloadText(payloadFile, await readFile(sourcePath, 'utf8'));
  const editorial = evidence.payloadEditorial[payloadFile];
  if (!editorial) return text;
  for (const [field, value] of Object.entries(editorial)) {
    const header = new RegExp(`^  "${field}": .+,$`, 'm');
    if (!header.test(text)) throw new Error(`Missing historical payload header ${field} in ${file}`);
    text = text.replace(header, () => `  "${field}": ${JSON.stringify(value)},`);
  }
  return text;
}

export async function loadHistoricalReadingChoiceLibrary(options = {}) {
  if (options.manifestFile || options.payloadDir) return loadLibrarySnapshot(options);
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const live = JSON.parse(await readFile(path.join(root, 'src', 'data', 'curated-lists.json'), 'utf8'));
      const manifest = historicalReadingChoiceManifest(live);
      const dir = await mkdtemp(path.join(os.tmpdir(), 'reading-choice-history-'));
      tempDirs.add(dir);
      const payloadDir = path.join(dir, 'payloads');
      const manifestFile = path.join(dir, 'manifest.json');
      await mkdir(payloadDir);
      await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`);
      await Promise.all(manifest.lists.map(async (entry) => {
        const file = entry.out || `${entry.id}.json`;
        if (path.basename(file) !== file) throw new Error(`Unsafe historical payload filename: ${file}`);
        const payload = JSON.parse(await readFile(path.join(root, 'src', 'data', file), 'utf8'));
        const issueIds = historicalReadingChoiceIssueIds(entry.id, issueIdsFromValue(payload));
        await writeFile(path.join(payloadDir, file), `${JSON.stringify({ issueIds })}\n`);
      }));
      return { ...await loadLibrarySnapshot({ manifestFile, payloadDir }), manifestFile, payloadDir };
    })();
  }
  return snapshotPromise;
}

export async function buildHistoricalReadingChoiceReport(mappingPath, peerPaths = [], options = {}) {
  const library = await loadHistoricalReadingChoiceLibrary(options);
  return buildReportForMapping(mappingPath, peerPaths, {
    ...options,
    manifestFile: library.manifestFile ?? options.manifestFile,
    payloadDir: library.payloadDir ?? options.payloadDir,
  });
}
