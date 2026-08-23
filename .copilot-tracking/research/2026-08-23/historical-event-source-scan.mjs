import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const inventoryPath = new URL(
  '../subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md',
  import.meta.url,
);
const outputPath = new URL('historical-event-source-pages.json', import.meta.url);
const timelineUrl = 'https://comicbookreadingorders.com/marvel/event-timeline/';
const delayMs = 5_000;

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseInventory(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(
      /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d{4})\s*\|\s*(https:\/\/comicbookreadingorders\.com\/marvel\/events\/[^| ]+\/|none)\s*\|\s*([^|]+?)\s*\|$/,
    ))
    .filter(Boolean)
    .map((match) => ({
      position: Number(match[1]),
      event: match[2].trim(),
      year: Number(match[3]),
      sourceUrl: match[4] === 'none' ? timelineUrl : match[4],
      sourceSection: match[4] === 'none' ? match[2].trim() : null,
      sourceForm: match[4] === 'none' ? 'timeline-text' : 'event-page',
      inventoryNote: match[5].trim(),
    }));
}

async function fetchSnapshot(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'MarvelReadingTrackerResearch/1.0' },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = bytes.toString('utf8');
  const canonicalUrl = html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/i)?.[1] ?? url;
  const modifiedAt = html.match(/<meta property=["']article:modified_time["'] content=["']([^"']+)["']/i)?.[1] ?? null;
  const references = issueReferencesFrom(html);
  return {
    url,
    canonicalUrl,
    retrievedAt: new Date().toISOString(),
    modifiedAt,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    byteLength: bytes.length,
    contentSha256: sha256(bytes),
    ...references,
  };
}

const markdown = await readFile(inventoryPath, 'utf8');
const inventory = parseInventory(markdown);
if (inventory.length !== 58) {
  throw new Error(`Expected 58 inventory rows, found ${inventory.length}`);
}

const timelineSnapshot = await fetchSnapshot(timelineUrl);
delete timelineSnapshot.issueReferences;
delete timelineSnapshot.excludedSourceReferences;
const eventPageRows = inventory.filter((entry) => entry.sourceForm === 'event-page');
const pageSnapshots = [];
for (const [index, entry] of eventPageRows.entries()) {
  if (index > 0 || timelineSnapshot.retrievedAt) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  try {
    const snapshot = await fetchSnapshot(entry.sourceUrl);
    pageSnapshots.push({
      position: entry.position,
      event: entry.event,
      year: entry.year,
      ...snapshot,
      extractionStatus: snapshot.issueReferences.length > 0
        ? 'issue-references-extracted'
        : 'blocked-no-issue-references',
    });
  } catch (error) {
    pageSnapshots.push({
      position: entry.position,
      event: entry.event,
      year: entry.year,
      url: entry.sourceUrl,
      extractionStatus: 'blocked-retrieval-failed',
      blocker: error.message,
      issueReferences: [],
    });
  }
}

const textOnlyRows = inventory
  .filter((entry) => entry.sourceForm === 'timeline-text')
  .map((entry) => ({
    position: entry.position,
    event: entry.event,
    year: entry.year,
    sourceUrl: timelineUrl,
    sourceSection: entry.sourceSection,
    sourceForm: entry.sourceForm,
    inventoryNote: entry.inventoryNote,
  }));

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  accessPolicy: {
    normalPublicAccessOnly: true,
    crawlDelaySeconds: 5,
    userAgent: 'MarvelReadingTrackerResearch/1.0',
  },
  timeline: timelineSnapshot,
  counts: {
    totalPreCutoff: inventory.length,
    eventPages: eventPageRows.length,
    timelineTextEntries: textOnlyRows.length,
    eventPagesWithIssueReferences: pageSnapshots.filter(
      (entry) => entry.extractionStatus === 'issue-references-extracted',
    ).length,
    blockedEventPages: pageSnapshots.filter(
      (entry) => entry.extractionStatus !== 'issue-references-extracted',
    ).length,
  },
  textOnlyEntries: textOnlyRows,
  eventPages: pageSnapshots,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output.counts));
