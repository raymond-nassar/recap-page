import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';

const inventoryPath = new URL('../2026-08-22/character-spotlight-source-inventory.json', import.meta.url);
const outputPath = new URL('../2026-08-22/character-spotlight-boundaries.json', import.meta.url);
const endpoint = 'https://www.comicbookherald.com/wp-json/wp/v2';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36';

function argumentValue(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value == null ? fallback : Number(value.slice(prefix.length));
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textOf(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withAsciiDashes(value) {
  return typeof value === 'string' ? value.replace(/[\u2013\u2014]/g, '-') : value;
}

function contentBlocks(html) {
  return [...html.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({
      kind: match[1].toLowerCase(),
      text: textOf(match[2]),
    }))
    .filter((block) => block.text);
}

function fetchJson(url) {
  const result = spawnSync('curl.exe', [
    '--location',
    '--silent',
    '--show-error',
    '--max-time',
    '20',
    '--retry',
    '1',
    '--user-agent',
    userAgent,
    url,
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `curl exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function extractRecord(source, wordpressType, record) {
  const html = record.content?.rendered ?? '';
  const blocks = contentBlocks(html);
  const headings = blocks
    .filter((block) => block.kind.startsWith('h'))
    .map((block) => withAsciiDashes(block.text));
  const issueBlocks = blocks.filter((block) => (
    /(?:\bcollects?\b|\bincludes?\b|\bcontents?\b)\s*:/i.test(block.text)
    || /(?:^|[\s([])#\d+(?:\.\w+)?(?:\s*[-\u2013]\s*#?\d+(?:\.\w+)?)?/i.test(block.text)
  ));
  const years = issueBlocks.flatMap((block) => (
    [...block.text.matchAll(/\b(19[3-9]\d|20[0-2]\d)\b/g)].map((match) => Number(match[1]))
  ));

  return {
    url: source.url,
    labels: source.labels,
    positions: source.positions,
    evidenceStatus: issueBlocks.length > 0 ? 'exact-page-snapshot' : 'blocked-no-issue-bearing-block',
    wordpressType,
    wordpressId: record.id,
    wordpressSlug: record.slug,
    wordpressDate: record.date,
    wordpressModified: record.modified,
    canonicalUrl: record.link,
    pageTitle: withAsciiDashes(textOf(record.title?.rendered ?? '')),
    contentSha256: createHash('sha256').update(html, 'utf8').digest('hex'),
    contentLength: html.length,
    blockCount: blocks.length,
    headingCount: headings.length,
    firstHeading: headings[0] ?? null,
    lastHeading: headings.at(-1) ?? null,
    issueBearingBlockCount: issueBlocks.length,
    issueBearingBlocksSha256: issueBlocks.length === 0
      ? null
      : createHash('sha256')
          .update(issueBlocks.map((block) => block.text).join('\n'), 'utf8')
          .digest('hex'),
    maximumExplicitIssueBlockYear: years.length > 0 ? Math.max(...years) : null,
  };
}

async function writeOutput(output) {
  const temporaryPath = new URL(`${outputPath.pathname}.tmp`, outputPath);
  await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

const start = argumentValue('start', 1);
const count = argumentValue('count', 16);
if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1) {
  throw new Error('--start and --count must be positive integers');
}

if (process.argv.includes('--minimize-existing')) {
  const output = JSON.parse(await readFile(outputPath, 'utf8'));
  output.method = 'WordPress REST posts/pages lookup by exact URL slug, retaining raw content and issue-block digests plus boundary facts.';
  output.records = output.records.map((record) => {
    const issueBearingBlocks = Array.isArray(record.issueBearingBlocks)
      ? record.issueBearingBlocks
      : [];
    const issueBearingBlocksSha256 = issueBearingBlocks.length === 0
      ? (record.issueBearingBlocksSha256 ?? null)
      : createHash('sha256').update(issueBearingBlocks.join('\n'), 'utf8').digest('hex');
    const boundary = { ...record };
    delete boundary.firstIssueBearingBlock;
    delete boundary.lastIssueBearingBlock;
    delete boundary.issueBearingBlocks;
    boundary.pageTitle = withAsciiDashes(boundary.pageTitle);
    boundary.firstHeading = withAsciiDashes(boundary.firstHeading);
    boundary.lastHeading = withAsciiDashes(boundary.lastHeading);
    return { ...boundary, issueBearingBlocksSha256 };
  });
  await writeOutput(output);
  console.log(`Minimized ${output.records.length} source-boundary records`);
  process.exit(0);
}

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const sources = [];
for (const entry of inventory.entries) {
  const existing = sources.find((source) => source.url === entry.url);
  if (existing) {
    existing.labels.push(entry.label);
    existing.positions.push(entry.position);
  } else {
    sources.push({ url: entry.url, labels: [entry.label], positions: [entry.position] });
  }
}

let output;
try {
  output = JSON.parse(await readFile(outputPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  output = {
    taskId: 'MRT-002-C01',
    sourceRetrievedAt: '2026-08-23',
    sourceIdentityCount: sources.length,
    metadataHorizon: '2025-10-29',
    method: 'WordPress REST posts/pages lookup by exact URL slug, retaining raw content and issue-block digests plus boundary facts.',
    records: [],
  };
}

const byUrl = new Map(output.records.map((record) => [record.url, record]));
for (const [offset, source] of sources.slice(start - 1, start - 1 + count).entries()) {
  const ordinal = start + offset;
  const slug = new URL(source.url).pathname.split('/').filter(Boolean).at(-1);
  let stored;
  try {
    let records = fetchJson(`${endpoint}/posts?slug=${encodeURIComponent(slug)}&_fields=id,date,modified,slug,link,title,content`);
    let wordpressType = 'post';
    if (records.length === 0) {
      records = fetchJson(`${endpoint}/pages?slug=${encodeURIComponent(slug)}&_fields=id,date,modified,slug,link,title,content`);
      wordpressType = 'page';
    }
    stored = records.length === 1
      ? extractRecord(source, wordpressType, records[0])
      : {
          ...source,
          evidenceStatus: records.length === 0 ? 'blocked-not-found' : 'blocked-ambiguous-slug',
          wordpressType,
          wordpressRecordCount: records.length,
        };
  } catch (error) {
    stored = {
      ...source,
      evidenceStatus: 'blocked-fetch-error',
      error: String(error.message ?? error),
    };
  }
  byUrl.set(source.url, stored);
  output.records = sources
    .filter((candidate) => byUrl.has(candidate.url))
    .map((candidate) => byUrl.get(candidate.url));
  output.completedIdentityCount = output.records.length;
  output.completedThrough = ordinal;
  await writeOutput(output);
  console.log(`${ordinal}/${sources.length} ${stored.evidenceStatus} ${source.labels.join(' / ')}`);
}
