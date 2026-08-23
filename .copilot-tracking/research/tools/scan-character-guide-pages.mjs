import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const inputPath = new URL('../2026-08-22/character-spotlight-source-inventory.json', import.meta.url);
const outputPath = new URL('../2026-08-22/character-spotlight-page-scan.json', import.meta.url);

function decodeText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8211;|&#x2013;/gi, '-')
    .replace(/&#8212;|&#x2014;/gi, '-')
    .replace(/&#8217;|&#x2019;/gi, "'")
    .replace(/&#8220;|&#x201c;|&#8221;|&#x201d;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

const inventory = JSON.parse(await readFile(inputPath, 'utf8'));
const byUrl = new Map();
for (const entry of inventory.entries) {
  const current = byUrl.get(entry.url) ?? { url: entry.url, labels: [], positions: [] };
  current.labels.push(entry.label);
  current.positions.push(entry.position);
  byUrl.set(entry.url, current);
}

const pages = [];
for (const [index, source] of [...byUrl.values()].entries()) {
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'recap-page-research/1.0' },
    redirect: 'follow',
  });
  const html = await response.text();
  const text = decodeText(html);
  const updateMarkers = matches(text, /\b(?:updated?|updates by:)[^.!?]{0,80}(?:20\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/gi)
    .slice(0, 5);
  const issueReferenceCount = matches(text, /\b[A-Z][A-Za-z0-9&'.: -]{1,80}\s+#?\d+(?:\.\w+)?(?:\s*-\s*\d+(?:\.\w+)?)?/g).length;
  pages.push({
    ...source,
    status: response.status,
    finalUrl: response.url,
    contentLength: html.length,
    textLength: text.length,
    bodySha256: createHash('sha256').update(html).digest('hex'),
    updateMarkers,
    collectsMarkerCount: matches(text, /\bcollects?\s*:/gi).length,
    issueReferenceCount,
  });
  console.log(`${index + 1}/${byUrl.size} ${response.status} ${html.length} ${source.labels.join(' / ')}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const output = {
  taskId: 'MRT-002-C01',
  retrievedAt: '2026-08-22',
  sourceIdentityCount: pages.length,
  pages,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
