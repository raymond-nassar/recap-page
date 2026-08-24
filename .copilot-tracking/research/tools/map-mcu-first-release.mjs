import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComparisonReport } from '../../../scripts/lib/cbh-overlap.mjs';
import { loadLibrarySnapshot } from '../../../scripts/report-order-overlap.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT = resolve(
  ROOT,
  '.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json',
);
const API = 'https://marvel.emreparker.com/v1';

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
}

const guides = [
  {
    priority: 1,
    id: 'doctor-strange-multiverse-of-madness',
    rows: [
      ...range(1, 10).map((issueNumber) => ({
        sourceIssueReference: `Doctor Strange (2015) #${issueNumber}`,
        seriesId: 20457,
        issueNumber,
      })),
      {
        sourceIssueReference: 'New Avengers: Illuminati #0',
        seriesId: 43504,
        issueNumber: '1',
        sourceIssueNumber: '0',
        manualIdentityReason: 'The source calls the separately published Illuminati one-shot #0; Marvel metadata numbers the only issue in its exact one-shot series #1.',
      },
      ...range(1, 5).map((issueNumber) => ({
        sourceIssueReference: `New Avengers: Illuminati #${issueNumber}`,
        seriesId: 1137,
        issueNumber,
      })),
      {
        sourceIssueReference: 'New Avengers #51',
        seriesId: 753,
        issueNumber: '51',
      },
    ],
  },
  {
    priority: 2,
    id: 'spider-man-no-way-home',
    rows: [
      ...['57', '58', '500', ...range(539, 543)].map((issueNumber) => ({
        sourceIssueReference: `Amazing Spider-Man (1999) #${issueNumber}`,
        seriesId: 454,
        issueNumber,
      })),
      ...range(17, 23).map((issueNumber) => ({
        sourceIssueReference: `Friendly Neighborhood Spider-Man (2005) #${issueNumber}`,
        seriesId: 877,
        issueNumber,
      })),
      {
        sourceIssueReference: 'Friendly Neighborhood Spider-Man Annual #1',
        seriesId: 3895,
        issueNumber: '1',
      },
      {
        sourceIssueReference: 'Doctor Strange (2015) #390',
        seriesId: 20457,
        issueNumber: '390',
      },
    ],
  },
  {
    priority: 3,
    id: 'marvel-multiverse',
    rows: range(142, 143).map((issueNumber) => ({
      sourceIssueReference: `Uncanny X-Men (1963) #${issueNumber}`,
      seriesId: 2258,
      issueNumber,
    })),
  },
  {
    priority: 4,
    id: 'marvel-what-if',
    rows: [
      ...['22', '25', '28', '30'].map((issueNumber) => ({
        sourceIssueReference: `What If? (1977) #${issueNumber}`,
        seriesId: 2095,
        issueNumber,
      })),
      {
        sourceIssueReference: 'What If? (1989) #105',
        seriesId: 3648,
        issueNumber: '105',
      },
      {
        sourceIssueReference: 'What If? Age of Ultron #5',
        seriesId: 18819,
        issueNumber: '5',
      },
      {
        sourceIssueReference: 'What If? Magik',
        seriesId: 26488,
        issueNumber: '1',
        manualIdentityReason: 'The source names the exact unnumbered one-shot; Marvel metadata numbers the only issue in that exact series #1.',
      },
    ],
  },
  {
    priority: 6,
    id: 'spider-man-far-from-home',
    rows: [
      ...range(66, 67).map((issueNumber) => ({
        sourceIssueReference: `The Amazing Spider-Man (1963) #${issueNumber}`,
        seriesId: 1987,
        issueNumber,
      })),
      ...range(50, 51).map((issueNumber) => ({
        sourceIssueReference: `Peter Parker, the Spectacular Spider-Man (1976) #${issueNumber}`,
        seriesId: 2271,
        issueNumber,
      })),
      ...range(618, 620).map((issueNumber) => ({
        sourceIssueReference: `Amazing Spider-Man (1999) #${issueNumber}`,
        seriesId: 454,
        issueNumber,
      })),
      {
        sourceIssueReference: 'Friendly Neighborhood Spider-Man (2005) #6',
        seriesId: 877,
        issueNumber: '6',
      },
    ],
  },
];

async function fetchJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 3) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 20_000);
  }
  throw new Error(`${url}: exhausted metadata retries`);
}

async function seriesIssues(seriesId) {
  const items = [];
  let offset = 0;
  for (;;) {
    const page = await fetchJson(`${API}/series/${seriesId}/issues?limit=200&offset=${offset}`);
    const batch = Array.isArray(page?.items) ? page.items : [];
    items.push(...batch);
    if (batch.length < 200 || items.length >= Number(page?.total ?? items.length)) break;
    offset += batch.length;
    await wait(250);
  }
  return items;
}

const seriesIds = [...new Set(guides.flatMap((guide) => guide.rows.map((row) => row.seriesId)))];
const bySeries = new Map();
for (const seriesId of seriesIds) {
  bySeries.set(seriesId, await seriesIssues(seriesId));
  await wait(250);
}

for (const guide of guides) {
  for (const [index, row] of guide.rows.entries()) {
    const matches = bySeries.get(row.seriesId)
      .filter((issue) => String(issue.issueNumber) === row.issueNumber);
    if (matches.length !== 1) {
      throw new Error(`${guide.id} row ${index + 1} resolved ${matches.length} metadata issues`);
    }
    const issue = matches[0];
    Object.assign(row, {
      sourcePosition: index + 1,
      selectedIssueId: Number(issue.id),
      resolvedIssueTitle: issue.title,
      metadataIssueNumber: String(issue.issueNumber),
      apiSeriesName: issue.seriesName,
      marvelIssueUrl: issue.detailUrl,
      onSaleDate: issue.onSaleDate,
      resolutionStatus: 'exact',
    });
  }
  const ids = guide.rows.map((row) => String(row.selectedIssueId));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${guide.id} contains a repeated selected issue id`);
  }
}

const library = await loadLibrarySnapshot();
const peerOrders = guides.map((guide) => ({
  orderId: guide.id,
  issueIds: guide.rows.map((row) => String(row.selectedIssueId)),
}));

for (const guide of guides) {
  const peers = peerOrders.filter((peer) => peer.orderId !== guide.id);
  guide.overlap = buildComparisonReport({
    candidateIds: guide.rows.map((row) => String(row.selectedIssueId)),
    orders: library.orders,
    peerOrders: peers,
  });
  guide.nonNoneRelationships = guide.overlap.comparisons
    .filter((comparison) => comparison.relationship !== 'none');
}

const output = {
  schemaVersion: 1,
  taskId: 'MRT-004',
  generatedAt: new Date().toISOString(),
  metadataApi: API,
  libraryDigest: library.libraryDigest,
  libraryOrderCount: library.orders.length,
  selectedPeerCount: guides.length - 1,
  guides,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
output.evidenceSha256 = createHash('sha256').update(serialized, 'utf8').digest('hex');

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: OUTPUT,
  libraryOrderCount: output.libraryOrderCount,
  guides: guides.map((guide) => ({
    id: guide.id,
    rows: guide.rows.length,
    comparisons: guide.overlap.comparisonCount,
    nonNone: guide.nonNoneRelationships,
  })),
}, null, 2));
