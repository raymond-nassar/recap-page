import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from '../../scripts/report-order-overlap.mjs';

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
const tempDirs = new Set();
let snapshotPromise;

after(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
});

// Source approvals bind the original names and vectors, not the later catalog's renamed choices.
export function historicalReadingChoiceManifest(manifest) {
  return {
    ...manifest,
    lists: manifest.lists
      .filter(({ id }) => id !== 'avengers-doomsday-secret-wars')
      .map((entry) => entries.has(entry.id) ? structuredClone(entries.get(entry.id)) : entry),
  };
}

export function historicalReadingChoiceIssueIds(id, currentIds) {
  return id === 'hickman-minimal' ? evidence.issueIds.map(String) : currentIds;
}

export function historicalReadingChoiceCatalogEntry(entry) {
  return catalogEntries.has(entry.id) ? structuredClone(catalogEntries.get(entry.id)) : entry;
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
  let text = await readFile(sourcePath, 'utf8');
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
