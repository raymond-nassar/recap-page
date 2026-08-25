import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildComparisonReport } from '../../../scripts/lib/cbh-overlap.mjs';
import { loadLibrarySnapshot } from '../../../scripts/report-order-overlap.mjs';

const sourcePath = new URL('../2026-08-23/historical-event-source-pages.json', import.meta.url);
const outputPath = new URL('historical-event-reading-orders-batch-three-resolution.json', import.meta.url);

const selections = [
  {
    position: 11,
    id: 'marvel-super-heroes-secret-wars',
    sourceReferences: Array.from(
      { length: 12 },
      (_value, index) => `Marvel Super Heroes Secret Wars #${index + 1}`,
    ),
    rows: [
      [10580, 2063], [10584, 2063], [10585, 2063], [10586, 2063],
      [10587, 2063], [10588, 2063], [10589, 2063], [10590, 2063],
      [10591, 2063], [10581, 2063], [10582, 2063], [10583, 2063],
    ],
  },
  {
    position: 15,
    id: 'kravens-last-hunt',
    rows: [
      [12027, 2092], [6697, 1987], [14578, 2271], [12028, 2092],
      [6698, 1987], [14579, 2271], [108295, 37250],
    ],
  },
  {
    position: 16,
    id: 'fall-of-the-mutants',
    rows: [
      [12233, 2098], [12234, 2098], [12236, 2098], [12237, 2098],
      [12238, 2098], [12239, 2098], [12240, 2098], [12241, 2098],
      [48078, 15186], [8243, 2002], [7720, 1996], [12242, 2098],
      [13131, 2121], [13761, 2258], [13762, 2258], [13763, 2258],
      [13764, 2258], [13765, 2258], [9151, 2021], [13766, 2258],
      [13767, 2258], [13768, 2258], [10394, 2055], [10395, 2055],
      [10396, 2055], [10397, 2055], [10398, 2055], [10400, 2055],
      [10401, 2055],
    ],
  },
];

const blocked = [
  {
    position: 12,
    id: 'wraith-war',
    blocker: 'The configured metadata snapshot has no historical ROM series or ROM Annual series, so 30 source rows cannot resolve exactly.',
  },
  {
    position: 13,
    id: 'secret-wars-ii',
    blocker: 'ROM #72 and Micronauts Vol. 2 #16 have no exact configured metadata series, so the 42-row order cannot pass the no-silent-drop mapping gate.',
  },
  {
    position: 14,
    id: 'mutant-massacre',
    blocker: 'Power Pack #27 is absent from the configured Power Pack series, so the 12-row order cannot resolve exactly.',
  },
];

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function issueNumber(reference) {
  return reference.match(/#\s*([0-9]+(?:\.[0-9]+)?)/)?.[1] ?? null;
}

async function fetchIssue(id) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://marvel.emreparker.com/v1/issues/${id}`);
    if (response.ok) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return response.json();
    }
    if (response.status !== 429 || attempt === 3) {
      throw new Error(`Issue ${id} returned ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`Issue ${id} exhausted retries`);
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const library = await loadLibrarySnapshot();
const sourceEntries = [
  ...source.textOnlyEntries.map((entry) => ({
    ...entry,
    url: entry.sourceUrl,
    retrievedAt: source.timeline.retrievedAt,
    contentSha256: source.timeline.contentSha256,
    issueReferences: entry.position === 11
      ? selections.find((selection) => selection.position === 11).sourceReferences
      : [],
    excludedSourceReferences: [],
  })),
  ...source.eventPages,
];

const events = [];
for (const selection of selections) {
  const sourceEntry = sourceEntries.find((entry) => entry.position === selection.position);
  if (!sourceEntry) throw new Error(`Missing source position ${selection.position}`);
  if (sourceEntry.issueReferences.length !== selection.rows.length) {
    throw new Error(`${selection.id} source and selection counts differ`);
  }
  const rows = [];
  for (const [index, [selectedIssueId, expectedSeriesId]] of selection.rows.entries()) {
    const metadata = await fetchIssue(selectedIssueId);
    const reference = sourceEntry.issueReferences[index];
    if (Number(metadata.seriesId) !== expectedSeriesId) {
      throw new Error(`${selection.id} ${reference} resolved to series ${metadata.seriesId}`);
    }
    if (String(metadata.issueNumber) !== issueNumber(reference)) {
      throw new Error(`${selection.id} ${reference} resolved to issue ${metadata.issueNumber}`);
    }
    rows.push({
      sourcePosition: index + 1,
      sourceIssueReference: reference,
      selectedIssueId,
      seriesId: metadata.seriesId,
      seriesName: metadata.seriesName,
      issueNumber: String(metadata.issueNumber),
      resolvedIssueTitle: metadata.title,
      marvelIssueUrl: metadata.detailUrl,
      onSaleDate: metadata.onSaleDate,
      resolutionStatus: 'exact',
    });
  }
  const selectedIssueIds = rows.map((row) => String(row.selectedIssueId));
  events.push({
    position: selection.position,
    id: selection.id,
    title: sourceEntry.event,
    year: sourceEntry.year,
    sourceUrl: sourceEntry.url,
    sourceSection: sourceEntry.sourceSection ?? null,
    sourceRetrievedAt: sourceEntry.retrievedAt,
    sourceContentSha256: sourceEntry.contentSha256,
    excludedSourceReferences: sourceEntry.excludedSourceReferences,
    rows,
    selectedIssueIds,
    mappingDigest: digest({ id: selection.id, rows }),
    chronology: {
      firstOnSaleDate: rows.map((row) => row.onSaleDate).sort()[0],
      lastOnSaleDate: rows.map((row) => row.onSaleDate).sort().at(-1),
    },
  });
}

for (const event of events) {
  const peers = events
    .filter((candidate) => candidate.id !== event.id)
    .map((candidate) => ({ orderId: candidate.id, issueIds: candidate.selectedIssueIds }));
  const report = buildComparisonReport({
    candidateIds: event.selectedIssueIds,
    orders: library.orders,
    peerOrders: peers,
  });
  event.overlap = {
    libraryDigest: library.libraryDigest,
    peerDigests: Object.fromEntries(events
      .filter((candidate) => candidate.id !== event.id)
      .map((candidate) => [candidate.id, candidate.mappingDigest])
      .sort(([left], [right]) => left.localeCompare(right))),
    ...report,
  };
  event.overlap.reportDigest = digest(event.overlap);
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  currentLibrary: {
    listCount: library.lists.length,
    libraryDigest: library.libraryDigest,
  },
  selectedSourcePositions: events.map((event) => event.position),
  selectedIds: events.map((event) => event.id),
  selectedIssueCount: events.reduce((sum, event) => sum + event.rows.length, 0),
  blocked,
  events,
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  listCount: result.currentLibrary.listCount,
  selectedIds: result.selectedIds,
  selectedIssueCount: result.selectedIssueCount,
  blockedIds: blocked.map((entry) => entry.id),
  nonNoneRelationships: events.map((event) => ({
    id: event.id,
    comparisons: event.overlap.comparisons.filter(
      (comparison) => comparison.relationship !== 'none',
    ),
  })),
}, null, 2));
