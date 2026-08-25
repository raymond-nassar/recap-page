import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createJsonFetcher } from '../../../scripts/lib/fetch-json.mjs';

const sourcePath = new URL('../2026-08-23/historical-event-source-pages.json', import.meta.url);
const outputPath = new URL('historical-event-reading-orders-batch-four-scan.json', import.meta.url);
const selectedPositions = new Set([17, 18, 19, 20, 21, 22]);
const pageDelayMs = 5_000;

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '...',
    laquo: '"',
    ldquo: '"',
    lsquo: "'",
    lt: '<',
    mdash: '-',
    nbsp: ' ',
    ndash: '-',
    quot: '"',
    raquo: '"',
    rdquo: '"',
    rsquo: "'",
    times: 'x',
  };
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function textOf(fragment) {
  return decodeEntities(String(fragment)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function issueReferencesFrom(html) {
  const panels = [...html.matchAll(
    /<div[^>]+class="[^"]*x-tabs-panel[^"]*x-active[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  )].map((match) => match[1]);
  const article = html.match(/<div class="entry-content[^"]*"[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? '';
  const fragments = panels.length > 0 ? panels : [article];
  const extracted = fragments
    .flatMap((fragment) => textOf(fragment))
    .filter((line) => /#\s*[0-9A-Za-z]/.test(line))
    .map((line) => line.replace(/\s+/g, ' ').trim());
  return {
    issueReferences: extracted.filter((line) => !/\bacts as a build up\b/i.test(line)),
    excludedSourceReferences: extracted.filter((line) => /\bacts as a build up\b/i.test(line)),
  };
}

function searchQuery(reference) {
  return reference
    .replace(/\s+-\s+Mislabeled.*$/i, '')
    .replace(/\s+Vol\.\s*\d+/gi, '')
    .replace(/\s+#/g, ' ')
    .replace(/\s+\(\d{4}\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchSource(entry) {
  const response = await fetch(entry.canonicalUrl, {
    headers: { 'user-agent': 'MarvelReadingTrackerResearch/1.0' },
  });
  if (!response.ok) throw new Error(`${response.status} ${entry.canonicalUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = bytes.toString('utf8');
  const references = issueReferencesFrom(html);
  return {
    position: entry.position,
    event: entry.event,
    year: entry.year,
    url: entry.url,
    canonicalUrl: html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/i)?.[1]
      ?? entry.canonicalUrl,
    retrievedAt: new Date().toISOString(),
    modifiedAt: html.match(
      /<meta property=["']article:modified_time["'] content=["']([^"']+)["']/i,
    )?.[1] ?? null,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    byteLength: bytes.length,
    contentSha256: digest(bytes),
    previousContentSha256: entry.contentSha256,
    sourceRowsMatchPrevious: JSON.stringify(references.issueReferences)
      === JSON.stringify(entry.issueReferences),
    ...references,
  };
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const previous = await readFile(outputPath, 'utf8')
  .then((value) => JSON.parse(value))
  .catch(() => null);
const previousEvents = new Map(
  (previous?.events ?? []).map((event) => [event.position, event]),
);
const selected = source.eventPages
  .filter((entry) => selectedPositions.has(entry.position))
  .sort((left, right) => left.position - right.position);
if (selected.length !== selectedPositions.size) {
  throw new Error(`Expected ${selectedPositions.size} source pages, found ${selected.length}`);
}

const pages = [];
let fetchedPageCount = 0;
for (const entry of selected) {
  const cached = previousEvents.get(entry.position);
  if (cached) {
    pages.push(cached);
    continue;
  }
  if (fetchedPageCount > 0) await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
  pages.push(await fetchSource(entry));
  fetchedPageCount += 1;
}

const { getJson } = createJsonFetcher();
const events = [];
for (const page of pages) {
  const cached = previousEvents.get(page.position);
  if (cached) {
    events.push(cached);
    continue;
  }
  const rows = [];
  for (const [index, sourceIssueReference] of page.issueReferences.entries()) {
    const query = searchQuery(sourceIssueReference);
    const url = new URL('https://marvel.emreparker.com/v1/search/issues');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '20');
    let payload;
    let blocker = null;
    try {
      payload = await getJson(url);
    } catch (error) {
      blocker = error.message;
      payload = { items: [] };
    }
    rows.push({
      sourcePosition: index + 1,
      sourceIssueReference,
      query,
      retrievedAt: new Date().toISOString(),
      blocker,
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
    });
  }
  events.push({
    ...page,
    rows,
  });
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  accessPolicy: {
    normalPublicAccessOnly: true,
    crawlDelaySeconds: 5,
    userAgent: 'MarvelReadingTrackerResearch/1.0',
  },
  metadataApi: 'https://marvel.emreparker.com/v1/search/issues',
  candidateWindow: [...selectedPositions],
  events,
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  events: events.map((event) => ({
    position: event.position,
    id: event.event,
    rows: event.rows.length,
    sourceRowsMatchPrevious: event.sourceRowsMatchPrevious,
    digestChanged: event.contentSha256 !== event.previousContentSha256,
    rowsWithoutCandidates: event.rows.filter((row) => row.candidates.length === 0).length,
  })),
}, null, 2));
