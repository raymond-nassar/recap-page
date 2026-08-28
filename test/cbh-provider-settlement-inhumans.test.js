import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const artifactPath = path.join(ROOT, 'scripts', 'data', 'cbh-provider-settlements', 'inhumans-reading-order.json');
const ledgerPath = path.join(ROOT, 'scripts', 'data', 'cbh-source-ledgers', 'inhumans-reading-order.json');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

test('Inhumans provider settlement completely and uniquely accounts for source candidates', async () => {
  const [artifact, ledger] = await Promise.all([readJson(artifactPath), readJson(ledgerPath)]);
  const sourcePositions = ledger.provenanceGroups
    .flatMap((group) => group.blocks.flatMap((block) => block.occurrences))
    .filter((row) => row.provisionalDisposition === 'canonical-candidate')
    .map((row) => row.position);

  assert.equal(artifact.sourceLedger.candidateCount, 259);
  assert.deepEqual(artifact.rows.map((row) => row.sourcePosition), sourcePositions);
  assert.deepEqual(artifact.partition, {
    exact: 64,
    'context-resolved': 153,
    'metadata-absent': 42,
    ambiguous: 0,
    operational: 0,
  });
  assert.equal(Object.values(artifact.partition).reduce((total, count) => total + count, 0), 259);

  const selectedIds = artifact.rows
    .map((row) => row.selectedIssueId)
    .filter((id) => id != null);
  assert.equal(selectedIds.length, 217);
  assert.equal(new Set(selectedIds).size, selectedIds.length);

  for (const row of artifact.rows.filter((candidate) => candidate.selectedIssueId != null)) {
    assert.ok(row.candidateIssueIds.includes(row.selectedIssueId));
    assert.equal(row.hydrated.issueId, row.selectedIssueId);
    assert.ok(row.selectedSeriesIds.includes(row.hydrated.seriesId));
    if (row.issueNumber != null) assert.equal(row.hydrated.issueNumber, row.issueNumber);
    assert.equal(typeof row.hydrated.title, 'string');
    assert.ok(row.hydrated.title.length > 0);
    assert.equal(typeof row.hydrated.seriesId, 'number');
  }

  assert.deepEqual(
    artifact.rows.filter((row) => row.resolution === 'metadata-absent').map((row) => row.sourcePosition),
    [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 87, 114, 133, 144, 145, 146, 147, 148, 191, 192, 193, 198, 199, 200, 202, 280, 289, 291, 292, 293, 294, 295, 297, 298, 299, 300, 301, 302, 303, 304],
  );
});

test('Inhumans provider settlement records complete pagination and URL-only cover metadata', async () => {
  const artifact = await readJson(artifactPath);

  assert.equal(artifact.provider.catalog.total, 6990);
  assert.equal(artifact.provider.directSeries.length, 40);
  for (const series of artifact.provider.directSeries) {
    assert.equal(series.pages.reduce((count, page) => count + page.count, 0), series.total);
    assert.equal(series.pages.at(-1).hasNext, false);
    assert.equal(series.pages[0].offset, 0);
    for (let index = 1; index < series.pages.length; index += 1) {
      assert.equal(series.pages[index].offset, series.pages[index - 1].offset + series.pages[index - 1].count);
    }
  }

  assert.equal(artifact.retrieval.serialized, true);
  assert.equal(artifact.retrieval.cache.scope, 'session-only');
  assert.equal(artifact.retrieval.cache.key, 'exact request URL');
  assert.equal(artifact.retrieval.noImageBytesStored, true);
  assert.equal(artifact.retrieval.cache.metrics.logicalRequests, 295);
  assert.equal(artifact.retrieval.cache.metrics.cacheWrites, 295);
  assert.equal(artifact.retrieval.cache.metrics.cacheHits, 0);
  assert.ok(artifact.retrieval.cache.metrics.networkAttempts >= artifact.retrieval.cache.metrics.logicalRequests);
  assert.deepEqual(artifact.retrieval.cache.metrics.errors, []);

  assert.equal(artifact.coverReadiness.sourcePosition, 6);
  assert.equal(artifact.coverReadiness.selectedIssueId, 13183);
  assert.equal(artifact.coverReadiness.ready, true);
  assert.equal(typeof artifact.coverReadiness.cover.path, 'string');
  assert.equal(typeof artifact.coverReadiness.cover.extension, 'string');
  assert.equal(Object.hasOwn(artifact.coverReadiness.cover, 'bytes'), false);
  for (const row of artifact.rows.filter((candidate) => candidate.hydrated?.cover != null)) {
    assert.equal(Object.hasOwn(row.hydrated.cover, 'bytes'), false);
    assert.equal(Object.hasOwn(row.hydrated.cover, 'data'), false);
  }

  assert.deepEqual(artifact.digests, {
    rowsSha256: '35087603efa3ab737b138a06c917d06b4edc7ed440c0b3005948b07bda7d6b57',
    groupsSha256: '40b46070e353fbfacdcdddb3bd8a65ab1c99dac72e10981a2760f19271b3dcf5',
    selectedIssueIdsSha256: '90b317a623bdd0e42f8d01e331b12ef195b285113971635407ccba3054adc378',
  });
});
