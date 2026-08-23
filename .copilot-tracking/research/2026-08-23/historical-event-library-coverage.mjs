import { readFile, writeFile } from 'node:fs/promises';
import { loadLibrarySnapshot } from '../../../scripts/report-order-overlap.mjs';
import { compareIssueSets } from '../../../scripts/lib/cbh-overlap.mjs';

const scanPath = new URL('historical-event-source-pages.json', import.meta.url);
const pilotPath = new URL('historical-event-pilot-resolution.json', import.meta.url);
const outputPath = new URL('historical-event-library-coverage.json', import.meta.url);

const aliasGroups = [
  ['avengers west coast', 'west coast avengers'],
  ['darkhold', 'darkhold pages from the book of sins'],
  ['spirits of vengeance', 'ghost rider blaze spirits of vengeance'],
  ['spectacular spider man', 'peter parker the spectacular spider man'],
];

function normalizeSeries(value) {
  let normalized = String(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bvol(?:ume)?\.?\s*\d+\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const group of aliasGroups) {
    if (group.includes(normalized)) normalized = group[0];
  }
  return normalized;
}

function rangeNumbers(value) {
  const match = String(value).match(/^([0-9]+)-([0-9]+)$/);
  if (!match) return [value];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end < start || end - start > 500) return [value];
  return Array.from({ length: end - start + 1 }, (_entry, index) => String(start + index));
}

function parseReference(reference) {
  const matches = [...String(reference).matchAll(/(?:^|;\s*)([^#;]+?)\s*#\s*([0-9]+(?:-[0-9]+)?|[0-9]+(?:\.[0-9]+)?|[0-9]+[A-Za-z]+)\b/g)];
  if (matches.length === 0) return { references: [], blocker: 'no-series-and-issue pattern' };
  const references = matches.flatMap((match) => rangeNumbers(match[2]).map((number) => ({
    series: normalizeSeries(match[1]),
    number,
  })));
  return { references, blocker: null };
}

function textOnlyReferences(entry) {
  const note = entry.inventoryNote.replace(/^text-only:\s*/i, '');
  if (!/#/.test(note)) return { references: [], blocker: 'timeline entry has no issue range' };
  return parseReference(note);
}

function strongestRelationship(comparisons) {
  const priority = ['exact', 'candidate-subset', 'existing-subset', 'partial', 'none'];
  return priority.find((relationship) => comparisons.some(
    (comparison) => comparison.relationship === relationship,
  )) ?? 'none';
}

const scan = JSON.parse(await readFile(scanPath, 'utf8'));
const pilot = JSON.parse(await readFile(pilotPath, 'utf8'));
const pilotByPosition = new Map(pilot.events.map((event) => [event.position, event]));
const library = await loadLibrarySnapshot();

const issueMembership = new Map();
for (const order of library.orders) {
  for (const issueId of order.issueIds) {
    if (!issueMembership.has(String(issueId))) issueMembership.set(String(issueId), []);
    issueMembership.get(String(issueId)).push(order.orderId);
  }
}

const bibliographicIndex = new Map();
for (const order of library.orders) {
  const manifestEntry = library.lists.find((entry) => entry.id === order.orderId);
  const payload = JSON.parse(await readFile(
    new URL(`../../../src/data/${manifestEntry.out}`, import.meta.url),
    'utf8',
  ));
  for (const item of payload.items ?? []) {
    if (item?.placeholder === true || item?.issueId == null || item?.number == null) continue;
    const key = `${normalizeSeries(item.seriesName)}|${String(item.number)}`;
    if (!bibliographicIndex.has(key)) bibliographicIndex.set(key, new Set());
    bibliographicIndex.get(key).add(String(item.issueId));
  }
}

const inventory = [
  ...scan.textOnlyEntries.map((entry) => ({
    position: entry.position,
    event: entry.event,
    year: entry.year,
    sourceUrl: entry.sourceUrl,
    sourceSection: entry.sourceSection,
    sourceForm: entry.sourceForm,
    parsed: textOnlyReferences(entry),
  })),
  ...scan.eventPages.map((entry) => {
    const parsedRows = entry.issueReferences.map((reference) => ({
      sourceIssueReference: reference,
      ...parseReference(reference),
    }));
    return {
      position: entry.position,
      event: entry.event,
      year: entry.year,
      sourceUrl: entry.url,
      sourceSection: null,
      sourceForm: 'event-page',
      parsed: {
        references: parsedRows.flatMap((row) => row.references),
        blocker: parsedRows.some((row) => row.blocker)
          ? parsedRows.filter((row) => row.blocker)
            .map((row) => `${row.sourceIssueReference}: ${row.blocker}`).join('; ')
          : null,
      },
    };
  }),
].sort((left, right) => left.position - right.position);

const coverage = inventory.map((entry) => {
  const pilotEvent = pilotByPosition.get(entry.position);
  if (pilotEvent) {
    const comparisons = pilotEvent.overlap.comparisons
      .filter((comparison) => !pilotEvent.overlap.peerDigests[comparison.orderId]);
    return {
      position: entry.position,
      event: entry.event,
      year: entry.year,
      sourceUrl: entry.sourceUrl,
      sourceSection: entry.sourceSection,
      sourceForm: entry.sourceForm,
      sourceReferenceCount: pilotEvent.rows.length,
      resolvedIssueCount: pilotEvent.selectedIssueIds.length,
      unresolvedReferenceCount: 0,
      strongestRelationship: strongestRelationship(comparisons),
      relationshipCounts: Object.fromEntries(
        ['exact', 'candidate-subset', 'existing-subset', 'partial', 'none']
          .map((relationship) => [
            relationship,
            comparisons.filter((comparison) => comparison.relationship === relationship).length,
          ]),
      ),
      relatedOrders: comparisons.filter((comparison) => comparison.relationship !== 'none'),
      coverageStatus: 'exact-metadata-and-complete-library-report',
      blocker: null,
    };
  }

  const matchedIds = [];
  let unresolved = 0;
  let ambiguous = 0;
  for (const reference of entry.parsed.references) {
    const candidates = [...(bibliographicIndex.get(`${reference.series}|${reference.number}`) ?? [])];
    if (candidates.length === 1) matchedIds.push(candidates[0]);
    else if (candidates.length === 0) unresolved += 1;
    else ambiguous += 1;
  }
  const uniqueMatchedIds = [...new Set(matchedIds)];
  const comparisons = library.orders.map((order) => ({
    orderId: order.orderId,
    ...compareIssueSets(uniqueMatchedIds, order.issueIds),
  }));
  const relatedOrders = comparisons.filter((comparison) => comparison.relationship !== 'none');
  const allResolved = entry.parsed.blocker == null && unresolved === 0 && ambiguous === 0
    && uniqueMatchedIds.length === entry.parsed.references.length;
  const reportedRelationships = allResolved
    ? relatedOrders
    : relatedOrders.map((comparison) => ({
      ...comparison,
      potentialRelationship: comparison.relationship,
      relationship: 'unresolved',
    }));
  return {
    position: entry.position,
    event: entry.event,
    year: entry.year,
    sourceUrl: entry.sourceUrl,
    sourceSection: entry.sourceSection,
    sourceForm: entry.sourceForm,
    sourceReferenceCount: entry.parsed.references.length,
    resolvedIssueCount: uniqueMatchedIds.length,
    unresolvedReferenceCount: unresolved,
    ambiguousReferenceCount: ambiguous,
    strongestRelationship: allResolved ? strongestRelationship(comparisons) : 'unresolved',
    relationshipCounts: Object.fromEntries(
      ['exact', 'candidate-subset', 'existing-subset', 'partial', 'none']
        .map((relationship) => [
          relationship,
          comparisons.filter((comparison) => comparison.relationship === relationship).length,
        ]),
    ),
    relatedOrders: reportedRelationships,
    coverageStatus: allResolved
      ? 'complete-current-library-reference-report'
      : 'blocked-incomplete-bibliographic-resolution',
    blocker: [
      entry.parsed.blocker,
      unresolved > 0 ? `${unresolved} source references absent from the current library index` : null,
      ambiguous > 0 ? `${ambiguous} source references match multiple current issue identities` : null,
    ].filter(Boolean).join('; ') || null,
  };
});

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  currentLibrary: {
    listCount: library.lists.length,
    libraryDigest: library.libraryDigest,
  },
  method: {
    exactPilotPositions: [...pilotByPosition.keys()].sort((left, right) => left - right),
    remainingCandidates: 'Bibliographic source-reference scan against every shipped payload',
    limitation: 'A missing bibliographic match is an explicit resolution blocker, not proof of no overlap.',
  },
  coverage,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  candidates: coverage.length,
  exactMetadataReports: coverage.filter(
    (entry) => entry.coverageStatus === 'exact-metadata-and-complete-library-report',
  ).length,
  completeReferenceReports: coverage.filter(
    (entry) => entry.coverageStatus === 'complete-current-library-reference-report',
  ).length,
  blockedReferenceReports: coverage.filter(
    (entry) => entry.coverageStatus === 'blocked-incomplete-bibliographic-resolution',
  ).length,
  relationshipCounts: Object.fromEntries(
    ['exact', 'candidate-subset', 'existing-subset', 'partial', 'none', 'unresolved']
      .map((relationship) => [
        relationship,
        coverage.filter((entry) => entry.strongestRelationship === relationship).length,
      ]),
  ),
}));
