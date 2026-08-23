import { readFile, writeFile } from 'node:fs/promises';

const inputPath = new URL('historical-event-source-pages.json', import.meta.url);
const outputPath = new URL('historical-event-pilot-search.json', import.meta.url);
const selectedPositions = new Set([23, 36, 38, 41, 44, 55]);
const delayMs = 1_500;

function searchQuery(reference) {
  return reference
    .replace(/\s+Vol\.\s*\d+/gi, '')
    .replace(/\s+#/g, ' ')
    .replace(/\s+\(\d{4}\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function search(reference) {
  const query = searchQuery(reference);
  const url = new URL('https://marvel.emreparker.com/v1/search/issues');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const payload = await response.json();
  return {
    sourceIssueReference: reference,
    query,
    retrievedAt: new Date().toISOString(),
    candidates: (payload.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      issueNumber: item.issueNumber,
      detailUrl: item.detailUrl,
      seriesId: item.seriesId,
      seriesName: item.seriesName,
      onSaleDate: item.onSaleDate,
      yearPage: item.yearPage,
    })),
  };
}

const scan = JSON.parse(await readFile(inputPath, 'utf8'));
const selected = scan.eventPages
  .filter((entry) => selectedPositions.has(entry.position))
  .sort((left, right) => left.position - right.position);
if (selected.length !== selectedPositions.size) {
  throw new Error(`Expected ${selectedPositions.size} selected pages, found ${selected.length}`);
}

const events = [];
for (const event of selected) {
  const rows = [];
  for (const reference of event.issueReferences) {
    if (rows.length > 0 || events.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      rows.push(await search(reference));
    } catch (error) {
      rows.push({
        sourceIssueReference: reference,
        query: searchQuery(reference),
        retrievedAt: new Date().toISOString(),
        blocker: error.message,
        candidates: [],
      });
    }
  }
  events.push({
    position: event.position,
    event: event.event,
    year: event.year,
    sourceUrl: event.url,
    sourceContentSha256: event.contentSha256,
    rows,
  });
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  api: 'https://marvel.emreparker.com/v1/search/issues',
  events,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  events: events.length,
  rows: events.reduce((sum, event) => sum + event.rows.length, 0),
  emptyCandidateRows: events.flatMap((event) => event.rows)
    .filter((row) => row.candidates.length === 0).length,
}));
