import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { loadLibrarySnapshot } from '../../scripts/report-order-overlap.mjs';
import { historicalReadingChoiceIssueIds, historicalReadingChoiceManifest } from './reading-choice-history.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturePath = path.join(root, 'test', 'fixtures', 'agatha-historical-library.json');
const tempDirs = new Set();
let cachedSnapshotPromise;

after(async () => {
  await Promise.all([...tempDirs].map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

function lfSha256(value) {
  return createHash('sha256')
    .update(value.replace(/\r\n?/g, '\n'), 'utf8')
    .digest('hex');
}

function safeBasename(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.basename(value) !== value) {
    throw new Error(`${label} must be a safe basename`);
  }
  return value;
}

export function reorderHistoricalAgathaEntry(lists, agathaEntry, beforeId) {
  const nextLists = lists.filter((entry) => entry.id !== agathaEntry.id);
  const beforeIndex = nextLists.findIndex((entry) => entry.id === beforeId);
  if (beforeIndex < 0) {
    throw new Error(`Missing historical Agatha insertion anchor ${beforeId}`);
  }
  nextLists.splice(beforeIndex, 0, agathaEntry);
  return nextLists;
}

export async function historicalAgathaLibrarySnapshot() {
  if (!cachedSnapshotPromise) {
    cachedSnapshotPromise = (async () => {
      const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
      const liveManifest = historicalReadingChoiceManifest(
        JSON.parse(await readFile(path.join(root, 'src', 'data', 'curated-lists.json'), 'utf8')),
      );
      const agathaEntry = liveManifest.lists.find((entry) => entry.id === fixture.manifestEntry.id);
      if (!agathaEntry) {
        throw new Error(`Missing live manifest entry for ${fixture.manifestEntry.id}`);
      }
      if (fixture.issueIds.length !== 104) {
        throw new Error('Historical Agatha fixture must retain exactly 104 ordered issue ids');
      }
      if (lfSha256(`${JSON.stringify(fixture.manifestEntry, null, 2)}\n`) !== fixture.manifestEntryLfSha256) {
        throw new Error('Historical Agatha manifest entry does not match its pinned hash');
      }
      if (lfSha256(`${JSON.stringify(fixture.issueIds, null, 2)}\n`) !== fixture.issueIdsLfSha256) {
        throw new Error('Historical Agatha issue vector does not match its pinned hash');
      }

      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agatha-history-'));
      tempDirs.add(tempDir);
      const payloadDir = path.join(tempDir, 'payloads');
      await mkdir(payloadDir, { recursive: true });

      const manifest = {
        ...liveManifest,
        lists: reorderHistoricalAgathaEntry(
          liveManifest.lists.map((entry) => (
            entry.id === fixture.manifestEntry.id ? fixture.manifestEntry : entry
          )),
          fixture.manifestEntry,
          fixture.beforeId,
        ),
      };

      const payloads = await Promise.all(manifest.lists.map(async (entry) => {
        const out = safeBasename(entry.out || `${entry.id}.json`, `Output for ${entry.id}`);
        if (entry.id === fixture.manifestEntry.id) {
          return [out, { issueIds: fixture.issueIds }];
        }
        const sourcePayload = JSON.parse(await readFile(path.join(root, 'src', 'data', out), 'utf8'));
        return [out, { issueIds: historicalReadingChoiceIssueIds(entry.id, issueIdsFromValue(sourcePayload)) }];
      }));

      await writeFile(path.join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await Promise.all(payloads.map(async ([out, payload]) => {
        await writeFile(path.join(payloadDir, out), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      }));

      const snapshot = await loadLibrarySnapshot({
        manifestFile: path.join(tempDir, 'manifest.json'),
        payloadDir,
      });

      return {
        ...snapshot,
        manifestFile: path.join(tempDir, 'manifest.json'),
        payloadDir,
        fixture,
      };
    })();
  }

  return cachedSnapshotPromise;
}
