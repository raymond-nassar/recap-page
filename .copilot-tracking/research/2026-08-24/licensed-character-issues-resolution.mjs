import { readFile, writeFile } from 'node:fs/promises';
import { createJsonFetcher } from '../../../scripts/lib/fetch-json.mjs';

const API = 'https://marvel.emreparker.com/v1';
const SOURCE_PATH = new URL('../2026-08-23/historical-event-source-pages.json', import.meta.url);
const OUTPUT_PATH = new URL('licensed-character-issues-resolution.json', import.meta.url);
const DECISION_SCOPE = 'mrt-003-c02-b04';
const EXCLUSION_REASON =
  'User-approved guide-scoped exclusion: nonessential tie-in not discoverable through Marvel Unlimited.';

const guides = Object.freeze([
  {
    id: 'wraith-war',
    title: 'Wraith War',
    excludedPositions: Object.freeze([
      ...Array.from({ length: 13 }, (_value, index) => index + 1),
      15,
      ...Array.from({ length: 6 }, (_value, index) => index + 18),
      ...Array.from({ length: 8 }, (_value, index) => index + 28),
    ]),
  },
  {
    id: 'secret-wars-ii',
    title: 'Secret Wars II',
    excludedPositions: Object.freeze([18, 27]),
  },
  {
    id: 'mutant-massacre',
    title: 'Mutant Massacre',
    excludedPositions: Object.freeze([7]),
  },
]);

const seriesBySourceTitle = Object.freeze({
  'Alpha Flight': Object.freeze({ id: 2116, name: 'Alpha Flight (1983 - 1994)', year: 1983 }),
  'Amazing Spider-Man': Object.freeze({ id: 1987, name: 'The Amazing Spider-Man (1963 - 1998)', year: 1963 }),
  Avengers: Object.freeze({ id: 1991, name: 'Avengers (1963 - 1996)', year: 1963 }),
  'Captain America': Object.freeze({ id: 1996, name: 'Captain America (1968 - 1996)', year: 1968 }),
  'Cloak and Dagger Vol. 2': Object.freeze({ id: 14157, name: 'Cloak and Dagger (1985 - 1987)', year: 1985 }),
  Daredevil: Object.freeze({ id: 2002, name: 'Daredevil (1964 - 1998)', year: 1964 }),
  Dazzler: Object.freeze({ id: 3745, name: 'Dazzler (1981 - 1986)', year: 1981 }),
  Defenders: Object.freeze({ id: 3743, name: 'Defenders (1972 - 1986)', year: 1972 }),
  'Doctor Strange Vol. 2': Object.freeze({ id: 3740, name: 'Doctor Strange (1974 - 1988)', year: 1974 }),
  'Fantastic Four': Object.freeze({ id: 2121, name: 'Fantastic Four (1961 - 1998)', year: 1961 }),
  'Incredible Hulk': Object.freeze({ id: 2021, name: 'Incredible Hulk (1962 - 1999)', year: 1962 }),
  'Iron Man': Object.freeze({ id: 2029, name: 'Iron Man (1968 - 1996)', year: 1968 }),
  'New Mutants': Object.freeze({ id: 2055, name: 'New Mutants (1983 - 1991)', year: 1983 }),
  'Peter Parker, the Spectacular Spider-Man': Object.freeze({ id: 2271, name: 'Peter Parker, the Spectacular Spider-Man (1976 - 1998)', year: 1976 }),
  'Power Man and Iron Fist': Object.freeze({ id: 20674, name: 'Power Man (1974 - 1986)', year: 1974 }),
  'Power Pack': Object.freeze({ id: 15186, name: 'Power Pack (1984 - 1991)', year: 1984 }),
  'Secret Wars II': Object.freeze({ id: 3694, name: 'Secret Wars II (1985)', year: 1985 }),
  'The Thing': Object.freeze({ id: 3667, name: 'Thing (1983 - 1986)', year: 1983 }),
  Thor: Object.freeze({ id: 2083, name: 'Thor (1966 - 1996)', year: 1966 }),
  'Uncanny X-Men': Object.freeze({ id: 2258, name: 'Uncanny X-Men (1963 - 2011)', year: 1963 }),
  'Web of Spider-Man': Object.freeze({ id: 2092, name: 'Web of Spider-Man (1985 - 1995)', year: 1985 }),
  'X-Factor': Object.freeze({ id: 2098, name: 'X-Factor (1986 - 1998)', year: 1986 }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSeries(reference) {
  return reference.replace(/\s+#.*$/, '').trim();
}

function sourceIssueNumber(reference) {
  const number = reference.match(/#\s*([0-9]+(?:\.[0-9]+)?)/)?.[1];
  assert(number, `Source reference has no issue number: ${reference}`);
  return number;
}

function exactIssue(items, reference, series) {
  const number = sourceIssueNumber(reference);
  const matches = items.filter((item) => (
    String(item.issueNumber) === number
    && Number(item.seriesId) === series.id
    && Number(item.id) > 0
    && /^https:\/\/www\.marvel\.com\/comics\/issue\/\d+\//.test(String(item.detailUrl ?? ''))
  ));
  assert(matches.length === 1,
    `${reference} resolved to ${matches.length} exact issues in configured series ${series.id}`);
  return matches[0];
}

const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8'));
const entries = source.eventPages.filter((entry) => guides.some((guide) => guide.title === entry.event));
assert(entries.length === guides.length, 'The committed source snapshot is missing a selected guide');

const selectedSeries = [...new Set(entries.flatMap((entry) => (
  entry.issueReferences.map(sourceSeries)
)).filter((title) => !['Rom', 'Rom Annual', 'ROM', 'Micronauts Vol. 2'].includes(title)))];
for (const title of selectedSeries) {
  assert(seriesBySourceTitle[title], `No configured series selection exists for ${title}`);
}

const { getJson } = createJsonFetcher();
const issuesBySeries = new Map();
for (const title of selectedSeries) {
  const series = seriesBySourceTitle[title];
  if (issuesBySeries.has(series.id)) continue;
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const body = await getJson(`${API}/series/${series.id}/issues?limit=200&offset=${offset}`);
    assert(Array.isArray(body?.items), `Series ${series.id} returned no items array at offset ${offset}`);
    items.push(...body.items);
    if (!body.has_next || body.items.length === 0) break;
    assert(items.length <= 2000, `Series ${series.id} paging did not terminate`);
  }
  issuesBySeries.set(series.id, items);
}

const resolvedGuides = guides.map((guide) => {
  const entry = entries.find((candidate) => candidate.event === guide.title);
  const excluded = new Set(guide.excludedPositions);
  const excludedSourceRows = entry.issueReferences
    .map((sourceIssueReference, index) => ({
      sourcePosition: index + 1,
      sourceIssueReference,
      reason: EXCLUSION_REASON,
      decisionScope: DECISION_SCOPE,
    }))
    .filter((row) => excluded.has(row.sourcePosition));
  const rows = entry.issueReferences
    .map((sourceIssueReference, index) => ({ sourcePosition: index + 1, sourceIssueReference }))
    .filter((row) => !excluded.has(row.sourcePosition))
    .map((row) => {
      const sourceTitle = sourceSeries(row.sourceIssueReference);
      const series = seriesBySourceTitle[sourceTitle];
      const issue = exactIssue(issuesBySeries.get(series.id), row.sourceIssueReference, series);
      return {
        ...row,
        normalizedSeriesTitle: sourceTitle.replace(/\s+Vol\.\s+\d+$/i, ''),
        seriesYear: series.year,
        issueNumber: sourceIssueNumber(row.sourceIssueReference),
        seriesId: series.id,
        apiSeriesName: series.name,
        candidateIssueId: Number(issue.id),
        resolvedIssueTitle: issue.title,
        marvelIssueUrl: issue.detailUrl,
        onSaleDate: issue.onSaleDate,
      };
    });
  assert(rows.length + excludedSourceRows.length === entry.issueReferences.length,
    `${guide.id} source rows are not conserved`);
  assert(new Set([
    ...rows.map((row) => row.sourcePosition),
    ...excludedSourceRows.map((row) => row.sourcePosition),
  ]).size === entry.issueReferences.length, `${guide.id} source positions are not unique`);
  return {
    id: guide.id,
    title: guide.title,
    sourceUrl: entry.canonicalUrl,
    sourceRetrievedAt: entry.retrievedAt,
    sourceContentSha256: entry.contentSha256,
    sourceRowCount: entry.issueReferences.length,
    retainedCount: rows.length,
    excludedCount: excludedSourceRows.length,
    excludedSourceRows,
    rows,
    chronology: {
      firstOnSaleDate: rows.map((row) => row.onSaleDate).sort()[0],
      lastOnSaleDate: rows.map((row) => row.onSaleDate).sort().at(-1),
    },
  };
});

const authorIds = [...resolvedGuides]
  .sort((left, right) => (
    left.chronology.firstOnSaleDate.localeCompare(right.chronology.firstOnSaleDate)
    || left.id.localeCompare(right.id)
  ))
  .map((guide) => guide.id);

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  decisionScope: DECISION_SCOPE,
  exclusionReason: EXCLUSION_REASON,
  sourceRowCount: resolvedGuides.reduce((sum, guide) => sum + guide.sourceRowCount, 0),
  retainedCount: resolvedGuides.reduce((sum, guide) => sum + guide.retainedCount, 0),
  excludedCount: resolvedGuides.reduce((sum, guide) => sum + guide.excludedCount, 0),
  sourceIds: guides.map((guide) => guide.id),
  authorIds,
  supplementalFutureEvidence: {
    url: 'https://www.comicbookherald.com/the-25-essential-trades-to-marvel-comics-from-1961-to-2000/',
    retrievedAt: '2026-08-25T02:20:42.8651808Z',
    byteLength: 240452,
    sha256: '02c1da6e95b3d400ca7cd26b5c5cec5a0e60ab43ad7f5db0e4a49354918bacc5',
    replacesHistoricalCursor: false,
  },
  guides: resolvedGuides,
};

assert(result.sourceRowCount === 89, 'Expected 89 total source rows');
assert(result.retainedCount === 58, 'Expected 58 retained rows');
assert(result.excludedCount === 31, 'Expected 31 excluded rows');

await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  sourceRowCount: result.sourceRowCount,
  retainedCount: result.retainedCount,
  excludedCount: result.excludedCount,
  authorIds: result.authorIds,
  guides: result.guides.map((guide) => ({
    id: guide.id,
    retainedCount: guide.retainedCount,
    excludedCount: guide.excludedCount,
    chronology: guide.chronology,
  })),
}, null, 2));
