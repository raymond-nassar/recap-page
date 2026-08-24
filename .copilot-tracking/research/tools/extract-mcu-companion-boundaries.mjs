import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT = resolve(
  ROOT,
  '.copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json',
);
const ENDPOINT = 'https://www.comicbookherald.com/wp-json/wp/v2/posts';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36';

const sources = [
  [1, 'the-best-comics-to-read-with-doctor-strange-multiverse-of-madness'],
  [2, 'the-best-comics-to-read-before-spider-man-no-way-home'],
  [3, '10-great-comics-featuring-the-marvel-multiverse'],
  [4, 'best-of-marvel-what-if-comics'],
  [5, '10-best-comics-to-read-with-wandavision'],
  [6, 'the-best-comics-to-read-before-spider-man-far-from-home'],
  [7, 'one-comics-rec-for-every-avenger-in-avengers-endgame'],
  [8, 'best-comics-to-read-before-avengers-endgame'],
  [9, 'the-best-miles-morales-comics-to-read-with-into-the-spider-verse'],
  [10, 'the-best-venom-comics-to-read-with-venom-the-movie'],
  [11, 'best-ant-man-wasp-comics-to-read-with-the-mcu'],
  [12, 'best-deadpool-comics-to-read-with-deadpool-2'],
  [13, 'best-comics-to-read-with-avengers-infinity-war'],
  [14, 'best-iron-man-comics-to-read-before-iron-man-3'],
];

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => (
      String.fromCodePoint(Number.parseInt(code, 16))
    ));
}

function textOf(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentBlocks(html) {
  const marked = html
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<\/?(h[1-6]|p|li|figcaption|figure|blockquote|div|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/(?:\r?\n\s*){2,}/g, '\n');
  return marked
    .split(/\r?\n/)
    .map((fragment) => ({ kind: 'text', text: textOf(fragment) }))
    .filter((block) => block.text);
}

function isIssueBearing(text) {
  return /(?:\bcollects?\b|\bissues?\b|\bincludes?\b|\bcontents?\b)\s*:/i.test(text)
    || /#\s*\d+(?:\.\d+)?/i.test(text);
}

const records = [];
for (const [priority, slug] of sources) {
  const url = `${ENDPOINT}?slug=${encodeURIComponent(slug)}&_fields=id,date,date_gmt,modified,modified_gmt,slug,link,title,content`;
  const response = spawnSync('curl.exe', [
    '--location',
    '--silent',
    '--show-error',
    '--max-time',
    '30',
    '--retry',
    '1',
    '--user-agent',
    USER_AGENT,
    url,
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (response.error) throw response.error;
  if (response.status !== 0) {
    throw new Error(`${slug}: ${response.stderr.trim() || `curl exited ${response.status}`}`);
  }
  const matches = JSON.parse(response.stdout);
  if (!Array.isArray(matches) || matches.length !== 1) {
    throw new Error(`${slug}: expected one WordPress post, found ${matches?.length ?? 'invalid'}`);
  }
  const post = matches[0];
  const html = post.content?.rendered ?? '';
  const blocks = contentBlocks(html);
  const issueBearingBlocks = blocks.filter((block) => isIssueBearing(block.text));
  records.push({
    priority,
    wordpressType: 'post',
    wordpressId: post.id,
    wordpressSlug: post.slug,
    wordpressDate: post.date,
    wordpressDateGmt: post.date_gmt,
    wordpressModified: post.modified,
    wordpressModifiedGmt: post.modified_gmt,
    canonicalUrl: post.link,
    pageTitle: textOf(post.title?.rendered ?? ''),
    sourceRetrievedAt: new Date().toISOString(),
    sourceContentSha256: digest(html),
    sourceContentLength: html.length,
    blockCount: blocks.length,
    issueBearingBlockCount: issueBearingBlocks.length,
    sourceIssueBearingBlocksSha256: digest(
      issueBearingBlocks.map((block) => `${block.kind}\t${block.text}`).join('\n'),
    ),
    firstIssueBearingBlock: issueBearingBlocks[0]?.text ?? null,
    lastIssueBearingBlock: issueBearingBlocks.at(-1)?.text ?? null,
  });
  await wait(500);
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({
  schemaVersion: 1,
  taskId: 'MRT-004',
  method: 'Exact WordPress post slug lookup with raw rendered-content and normalized issue-bearing-block SHA-256 digests.',
  records,
}, null, 2)}\n`, 'utf8');
console.log(`Wrote ${records.length} source boundary records to ${OUTPUT}`);
