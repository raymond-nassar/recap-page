import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildComparisonReport } from '../../../scripts/lib/cbh-overlap.mjs';
import { loadLibrarySnapshot } from '../../../scripts/report-order-overlap.mjs';

const scanPath = new URL('historical-event-source-pages.json', import.meta.url);
const outputPath = new URL('historical-event-pilot-resolution.json', import.meta.url);
const delayMs = 1_500;

const selections = [
  {
    position: 23,
    id: 'muir-island-saga',
    rows: [
      ['Uncanny X-Men #278', 13819, false, null],
      ['Uncanny X-Men #279', 13820, false, null],
      ['X-Factor #69', 12289, false, null],
      ['Uncanny X-Men #280', 13821, false, null],
      ['X-Factor #70', 12291, false, null],
    ],
  },
  {
    position: 36,
    id: 'bloodties',
    rows: [
      ['Avengers #368', 7250, false, null],
      ['X-Men Vol. 2 #26', 14313, false, null],
      [
        'Avengers West Coast #101',
        17788,
        true,
        'The metadata series is West Coast Avengers (1985), whose issue #101 is the unique 1993 match.',
      ],
      ['Uncanny X-Men #307', 13848, false, null],
      ['Avengers #369', 7251, false, null],
    ],
  },
  {
    position: 38,
    id: 'midnight-massacre',
    rows: [
      ['Nightstalkers #10', 80296, false, null],
      ['Ghost Rider Vol. 3 #40', 22675, false, null],
      [
        'Darkhold #11',
        73583,
        true,
        'The metadata expands the unique 1993 issue to Darkhold: Pages from the Book of Sins.',
      ],
      ['Morbius: The Living Vampire #12', 78135, false, null],
      [
        'Spirits of Vengeance #13',
        68431,
        true,
        'The metadata expands the unique 1993 issue to Ghost Rider/Blaze: Spirits of Vengeance.',
      ],
    ],
  },
  {
    position: 41,
    id: 'childs-play',
    rows: [
      ['X-Force #32', 17997, false, null],
      ['New Warriors #45', 60145, false, null],
      ['X-Force #33', 17998, false, null],
      ['New Warriors #46', 60146, false, null],
    ],
  },
  {
    position: 55,
    id: 'eighth-day',
    rows: [
      ['Iron Man Vol. 3 #21', 19893, false, null],
      ['Iron Man Vol. 3 #22', 19894, false, null],
      ['Peter Parker: Spider-Man Vol. 2 #11', 10519, false, null],
      [
        'Juggernaut Vol. 2 #1 (1999)',
        43033,
        true,
        'The metadata names the one-issue 1999 series JUGGERNAUT 1.',
      ],
    ],
  },
];

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function issueNumberFrom(reference) {
  return reference.match(/#\s*([0-9A-Za-z.]+)/)?.[1] ?? null;
}

async function fetchIssue(issueId) {
  const url = `https://marvel.emreparker.com/v1/issues/${issueId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const scan = JSON.parse(await readFile(scanPath, 'utf8'));
const library = await loadLibrarySnapshot();
const events = [];

for (const selection of selections) {
  const source = scan.eventPages.find((entry) => entry.position === selection.position);
  if (!source) throw new Error(`Missing source page at position ${selection.position}`);
  const sourceReferences = source.issueReferences;
  const selectedReferences = selection.rows.map(([reference]) => reference);
  if (JSON.stringify(sourceReferences) !== JSON.stringify(selectedReferences)) {
    throw new Error(`${selection.id} selected rows differ from the source scan`);
  }

  const rows = [];
  for (const [index, [reference, issueId, manualSeriesSelection, selectionNote]] of selection.rows.entries()) {
    if (index > 0 || events.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const metadata = await fetchIssue(issueId);
    const expectedNumber = issueNumberFrom(reference);
    if (String(metadata.issueNumber) !== expectedNumber) {
      throw new Error(`${selection.id} ${reference} resolved to issue number ${metadata.issueNumber}`);
    }
    rows.push({
      sourceIssueReference: reference,
      selectedIssueId: issueId,
      issueNumber: String(metadata.issueNumber),
      resolvedIssueTitle: metadata.title,
      seriesId: metadata.seriesId,
      seriesName: metadata.seriesName,
      onSaleDate: metadata.onSaleDate,
      marvelIssueUrl: metadata.detailUrl,
      manualSeriesSelection,
      manualSeriesSelectionApproved: manualSeriesSelection,
      selectionNote,
      resolutionStatus: 'exact',
    });
  }

  const selectedIssueIds = rows.map((row) => String(row.selectedIssueId));
  events.push({
    position: source.position,
    id: selection.id,
    event: source.event,
    year: source.year,
    sourceUrl: source.url,
    sourceRetrievedAt: source.retrievedAt,
    sourceContentSha256: source.contentSha256,
    sourceModifiedAt: source.modifiedAt,
    sourceRowCount: source.issueReferences.length,
    excludedSourceReferences: source.excludedSourceReferences,
    rows,
    selectedIssueIds,
    mappingDigest: sha256({
      id: selection.id,
      sourceUrl: source.url,
      sourceContentSha256: source.contentSha256,
      selectedIssueIds,
      rows,
    }),
  });
}

for (const event of events) {
  const peers = events
    .filter((candidate) => candidate.id !== event.id)
    .map((candidate) => ({
      orderId: candidate.id,
      issueIds: candidate.selectedIssueIds,
    }));
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
  event.overlap.reportDigest = sha256(event.overlap);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  currentLibrary: {
    listCount: library.lists.length,
    libraryDigest: library.libraryDigest,
  },
  events,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  events: events.length,
  rows: events.reduce((sum, event) => sum + event.rows.length, 0),
  exactRelationships: events.reduce(
    (sum, event) => sum + event.overlap.comparisons.filter(
      (comparison) => comparison.relationship === 'exact',
    ).length,
    0,
  ),
  nonNoneRelationships: events.reduce(
    (sum, event) => sum + event.overlap.comparisons.filter(
      (comparison) => comparison.relationship !== 'none',
    ).length,
    0,
  ),
}));
