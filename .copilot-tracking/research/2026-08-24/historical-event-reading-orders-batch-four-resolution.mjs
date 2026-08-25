import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildComparisonReport } from '../../../scripts/lib/cbh-overlap.mjs';
import { createJsonFetcher } from '../../../scripts/lib/fetch-json.mjs';
import { loadLibrarySnapshot } from '../../../scripts/report-order-overlap.mjs';

const api = 'https://marvel.emreparker.com/v1';
const scanPath = new URL('historical-event-reading-orders-batch-four-scan.json', import.meta.url);
const outputPath = new URL(
  'historical-event-reading-orders-batch-four-resolution.json',
  import.meta.url,
);

const idsByPosition = Object.freeze({
  17: 'evolutionary-war',
  18: 'inferno',
  19: 'atlantis-attacks',
  20: 'acts-of-vengeance',
  21: 'days-of-future-present',
  22: 'x-tinction-agenda',
});

const seriesBySourceTitle = Object.freeze({
  'Alpha Flight': 2116,
  'Amazing Spider-Man': 1987,
  'Amazing Spider-Man Annual': 2984,
  Avengers: 1991,
  'Avengers Annual': 1988,
  'Avengers Spotlight': 24456,
  'Avengers West Coast': 3630,
  'Avengers West Coast Annual': 3632,
  'Avengers: West Coast': 3630,
  'Captain America': 1996,
  'Cloak and Dagger Vol. 3': 16368,
  'Damage Control': 21003,
  'Damage Control Vol. 2': 16297,
  Daredevil: 2002,
  'Daredevil Annual': 7665,
  'Doctor Strange: Sorcerer Supreme': 3741,
  Excalibur: 2011,
  'Fantastic Four': 2121,
  'Fantastic Four Annual': 2012,
  'Incredible Hulk': 2021,
  'Iron Man': 2029,
  'Iron Man Annual': 3723,
  'Marc Spector: Moon Knight': 23996,
  'Marvel Comics Presents': 2039,
  'New Mutants': 2055,
  'New Mutants Annual': 2053,
  'Power Pack': 15186,
  'Punisher Annual Vol. 2': 25499,
  'Punisher Vol. 2': 21468,
  'Punisher Vol. 2 Annual': 25499,
  'Punisher War Journal': 5860,
  Quasar: 3695,
  'Silver Surfer Annual': 19005,
  'Spectacular Spider-Man': 2271,
  'Spectacular Spider-Man Annual': 20403,
  Thor: 2083,
  'Thor Annual': 2978,
  'Uncanny X-Men': 2258,
  'Uncanny X-Men Annual': 2100,
  'Web of Spider-man': 2092,
  'Web of Spider-Man': 2092,
  'Web of Spider-Man Annual': 19003,
  'West Coast Avengers Annual': 3632,
  'Wolverine Vol. 2': 2262,
  'X-Factor': 2098,
  'X-Factor Annual': 6689,
  'X-Men Annual': 2100,
  'X-Terminators': 15489,
});

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function sourceSeries(reference) {
  return reference.replace(/\s+#.*$/, '').trim();
}

function sourceIssueNumber(reference) {
  return reference.match(/#\s*([0-9]+(?:\.[0-9]+)?)/)?.[1] ?? null;
}

function seriesYear(seriesName) {
  const value = Number(String(seriesName).match(/\((\d{4})/)?.[1]);
  return Number.isInteger(value) ? value : null;
}

const scan = JSON.parse(await readFile(scanPath, 'utf8'));
const previous = await readFile(outputPath, 'utf8')
  .then((value) => JSON.parse(value))
  .catch(() => null);
const cachedRows = new Map((previous?.events ?? []).flatMap((event) => (
  event.rows.map((row) => [`${event.position}:${row.sourcePosition}`, {
    sourceContentSha256: event.sourceContentSha256,
    row,
  }])
)));
const library = await loadLibrarySnapshot();
const { getJson } = createJsonFetcher();
const issuesBySeries = new Map();

const seriesIdsToFetch = new Set();
for (const event of scan.events) {
  for (const row of event.rows) {
    const cached = cachedRows.get(`${event.position}:${row.sourcePosition}`);
    if (
      cached?.sourceContentSha256 === event.contentSha256
      && cached.row.sourceIssueReference === row.sourceIssueReference
    ) {
      continue;
    }
    const seriesId = seriesBySourceTitle[sourceSeries(row.sourceIssueReference)];
    if (seriesId) seriesIdsToFetch.add(seriesId);
  }
}

for (const seriesId of seriesIdsToFetch) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const body = await getJson(`${api}/series/${seriesId}/issues?limit=200&offset=${offset}`);
    if (!Array.isArray(body?.items)) {
      throw new Error(`Series ${seriesId} returned no items array at offset ${offset}`);
    }
    items.push(...body.items);
    if (!body.has_next || body.items.length === 0) break;
    if (items.length > 2_000) throw new Error(`Series ${seriesId} paging did not terminate`);
  }
  issuesBySeries.set(seriesId, items);
}

const events = scan.events.map((event) => {
  const id = idsByPosition[event.position];
  if (!id) throw new Error(`No canonical id for source position ${event.position}`);
  const rows = event.rows.map((sourceRow) => {
    const cached = cachedRows.get(`${event.position}:${sourceRow.sourcePosition}`);
    if (
      cached?.sourceContentSha256 === event.contentSha256
      && cached.row.sourceIssueReference === sourceRow.sourceIssueReference
    ) {
      return cached.row;
    }
    const sourceSeriesTitle = sourceSeries(sourceRow.sourceIssueReference);
    const issueNumber = sourceIssueNumber(sourceRow.sourceIssueReference);
    const seriesId = seriesBySourceTitle[sourceSeriesTitle];
    if (!seriesId || !issueNumber) {
      return {
        sourcePosition: sourceRow.sourcePosition,
        sourceIssueReference: sourceRow.sourceIssueReference,
        resolutionStatus: 'unmatched',
        blocker: !seriesId
          ? `No reviewed configured series exists for ${sourceSeriesTitle}.`
          : 'The source reference has no exact issue number.',
      };
    }
    const matches = issuesBySeries.get(seriesId).filter((item) => (
      String(item.issueNumber) === issueNumber
      && Number(item.seriesId) === seriesId
      && Number(item.id) > 0
      && /^https:\/\/www\.marvel\.com\/comics\/issue\/\d+\//.test(String(item.detailUrl ?? ''))
    ));
    if (matches.length !== 1) {
      return {
        sourcePosition: sourceRow.sourcePosition,
        sourceIssueReference: sourceRow.sourceIssueReference,
        sourceSeriesTitle,
        issueNumber,
        seriesId,
        resolutionStatus: matches.length === 0 ? 'unmatched' : 'ambiguous',
        blocker: `${sourceRow.sourceIssueReference} resolved to ${matches.length} exact issues in configured series ${seriesId}.`,
        candidateIssueIds: matches.map((item) => Number(item.id)),
      };
    }
    const item = matches[0];
    return {
      sourcePosition: sourceRow.sourcePosition,
      sourceIssueReference: sourceRow.sourceIssueReference,
      sourceSeriesTitle,
      issueNumber,
      seriesId,
      seriesName: item.seriesName,
      seriesYear: seriesYear(item.seriesName),
      selectedIssueId: Number(item.id),
      resolvedIssueTitle: item.title,
      marvelIssueUrl: item.detailUrl,
      onSaleDate: item.onSaleDate,
      resolutionStatus: 'exact',
    };
  });
  const unresolvedRows = rows.filter((row) => row.resolutionStatus !== 'exact');
  const selectedIssueIds = rows
    .filter((row) => row.resolutionStatus === 'exact')
    .map((row) => String(row.selectedIssueId));
  const duplicateIssueIds = selectedIssueIds.filter(
    (issueId, index) => selectedIssueIds.indexOf(issueId) !== index,
  );
  return {
    position: event.position,
    id,
    title: event.event,
    year: event.year,
    sourceUrl: event.canonicalUrl,
    sourceRetrievedAt: event.retrievedAt,
    sourceContentSha256: event.contentSha256,
    previousSourceContentSha256: event.previousContentSha256,
    sourceRowsMatchPrevious: event.sourceRowsMatchPrevious,
    sourceRowCount: event.rows.length,
    exactRowCount: rows.length - unresolvedRows.length,
    unresolvedRowCount: unresolvedRows.length,
    duplicateIssueIds: [...new Set(duplicateIssueIds)],
    rows,
    selectedIssueIds,
    mappingDigest: unresolvedRows.length === 0 && duplicateIssueIds.length === 0
      ? digest({ id, rows })
      : null,
    chronology: unresolvedRows.length === 0
      ? {
        firstOnSaleDate: rows.map((row) => row.onSaleDate).sort()[0],
        lastOnSaleDate: rows.map((row) => row.onSaleDate).sort().at(-1),
      }
      : null,
  };
});

const eligible = events.filter((event) => (
  event.unresolvedRowCount === 0 && event.duplicateIssueIds.length === 0
));
const selected = eligible.slice(0, 4);
for (const event of selected) {
  const peers = selected
    .filter((candidate) => candidate.id !== event.id)
    .map((candidate) => ({ orderId: candidate.id, issueIds: candidate.selectedIssueIds }));
  const report = buildComparisonReport({
    candidateIds: event.selectedIssueIds,
    orders: library.orders,
    peerOrders: peers,
  });
  event.overlap = {
    libraryDigest: library.libraryDigest,
    peerDigests: Object.fromEntries(selected
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
  candidateSourcePositions: events.map((event) => event.position),
  eligibleSourcePositions: eligible.map((event) => event.position),
  selectedSourcePositions: selected.map((event) => event.position),
  selectedIds: selected.map((event) => event.id),
  selectedIssueCount: selected.reduce((sum, event) => sum + event.rows.length, 0),
  events,
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  listCount: result.currentLibrary.listCount,
  eligibleSourcePositions: result.eligibleSourcePositions,
  selectedIds: result.selectedIds,
  selectedIssueCount: result.selectedIssueCount,
  events: events.map((event) => ({
    position: event.position,
    id: event.id,
    sourceRows: event.sourceRowCount,
    exactRows: event.exactRowCount,
    unresolved: event.rows
      .filter((row) => row.resolutionStatus !== 'exact')
      .map((row) => ({
        sourcePosition: row.sourcePosition,
        sourceIssueReference: row.sourceIssueReference,
        blocker: row.blocker,
      })),
    nonNoneRelationships: event.overlap?.comparisons.filter(
      (comparison) => comparison.relationship !== 'none',
    ) ?? [],
  })),
}, null, 2));
