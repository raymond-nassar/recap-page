import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_DIR = process.env.MRT_SESSION_CACHE_DIR;
const API = 'https://marvel.emreparker.com/v1';
const CATALOG_LIMIT = 200;
const MAX_PAGES = 100;
const OUTPUT_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-provider-settlements', 'inhumans-reading-order.json');
const LEDGER_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-source-ledgers', 'inhumans-reading-order.json');

if (!SESSION_DIR) throw new Error('Set MRT_SESSION_CACHE_DIR to a session-only cache directory.');

const jsonDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nonemptyJson = (value) => Array.isArray(value)
  ? value.length > 0
  : Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);

class SessionJsonCache {
  constructor(directory) {
    this.directory = directory;
    this.metrics = {
      logicalRequests: 0,
      cacheHits: 0,
      cacheWrites: 0,
      networkAttempts: 0,
      retries: 0,
      errors: [],
    };
  }

  async get(url) {
    this.metrics.logicalRequests += 1;
    const cachePath = path.join(this.directory, `${createHash('sha256').update(url).digest('hex')}.json`);
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      if (cached.url === url && nonemptyJson(cached.body) && cached.bodySha256 === jsonDigest(cached.body)) {
        this.metrics.cacheHits += 1;
        return cached.body;
      }
      throw new Error(`Invalid cache entry for ${url}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      this.metrics.networkAttempts += 1;
      let response;
      try {
        response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      } catch (error) {
        this.metrics.errors.push({ url, attempt: attempt + 1, kind: 'network', message: error.message });
        throw error;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 5) {
          const error = new Error(`HTTP ${response.status} after retry exhaustion`);
          this.metrics.errors.push({ url, attempt: attempt + 1, kind: 'operational', message: error.message });
          throw error;
        }
        this.metrics.retries += 1;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (response.status !== 200) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        this.metrics.errors.push({ url, attempt: attempt + 1, kind: 'http', message: error.message });
        throw error;
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        this.metrics.errors.push({ url, attempt: attempt + 1, kind: 'invalid-json', message: error.message });
        throw error;
      }
      if (!nonemptyJson(body)) {
        const error = new Error('empty HTTP 200 JSON');
        this.metrics.errors.push({ url, attempt: attempt + 1, kind: 'empty-json', message: error.message });
        throw error;
      }
      const entry = { url, bodySha256: jsonDigest(body), body };
      const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(entry), 'utf8');
      await rename(tempPath, cachePath);
      this.metrics.cacheWrites += 1;
      return body;
    }
    throw new Error(`Unreachable retry state for ${url}`);
  }
}

const seriesByTitle = {
  'Fantastic Four Annual': 2012,
  Thor: 2083,
  'Son Of M': 980,
  'Silent War': 1134,
  'World War Hulk': 2400,
  'New Avengers: Illuminati': 1137,
  'Secret Invasion: Inhumans': 5352,
  'War Of Kings': 6972,
  FF: 13440,
  'New Avengers': 16451,
  'Avengers Assemble': 15373,
  Inhumanity: 18499,
  'Uncanny X-Men': 17602,
  'Indestructible Hulk': 16583,
  'Iron Man': 16593,
  Inhuman: 18065,
  'Uncanny Inhumans': 19780,
  'All-New Inhumans': 20681,
  Karnak: 20258,
  'Moon Girl and Devil Dinosaur': 20839,
  'Uncanny Inhumans Annual': 22224,
  Avengers: 16452,
  'Spider-Man/Deadpool': 19679,
  'All-New X-Men': 20622,
  Champions: 22552,
  'Doctor Strange': 20457,
  'Guardians of the Galaxy': 20465,
  'The Totally Awesome Hulk': 20614,
  'Secret Warriors': 23047,
  Mosaic: 20818,
  'Black Bolt': 23121,
  'Marvel Universe Avengers: Ultron Revolution': 21698,
  'Death of Inhumans': 24738,
};

const missingExactCatalogTitle = new Set([
  'Young Inhumans',
  'Inhumans 2099 One-Shot',
  'Mighty Avengers',
  'Realm Of Kings: Inhumans',
  'Inhumans Prime',
  'Inhumans: Judgement Day',
  'Inhumans: Once & Future Kings',
]);

function reviewedSeriesIds(row) {
  if (missingExactCatalogTitle.has(row.normalizedSeriesTitle)) return [];
  if (row.normalizedSeriesTitle === 'Fantastic Four') return [row.position <= 21 ? 2121 : 421];
  if (row.normalizedSeriesTitle === 'Inhumans') return [row.seriesYear === 1998 ? 2026 : 2027];
  if (row.normalizedSeriesTitle === 'Infinity') return [17735, 17736];
  if (row.normalizedSeriesTitle === 'Royals') return [23026];
  const id = seriesByTitle[row.normalizedSeriesTitle];
  if (!id) throw new Error(`No reviewed direct-series selection for ${row.normalizedSeriesTitle} at ${row.position}`);
  return [id];
}

async function fetchAllPages(cache, endpoint, label) {
  const items = [];
  const pages = [];
  let total = null;
  for (let offset = 0, page = 0; page < MAX_PAGES; page += 1) {
    const body = await cache.get(`${endpoint}?limit=${CATALOG_LIMIT}&offset=${offset}`);
    const current = Array.isArray(body.items) ? body.items : [];
    if (!Number.isInteger(body.total) || body.total < 0 || (page === 0 && current.length === 0)) {
      throw new Error(`${label} returned invalid pagination at offset ${offset}`);
    }
    if (total == null) total = body.total;
    if (body.total !== total) throw new Error(`${label} changed total while paging`);
    pages.push({ offset, count: current.length, hasNext: body.has_next === true, sha256: jsonDigest(body) });
    items.push(...current);
    if (!body.has_next || current.length === 0) break;
    offset += current.length;
  }
  if (items.length !== total) throw new Error(`${label} ended with ${items.length} items, expected ${total}`);
  if (new Set(items.map((item) => String(item.id))).size !== items.length) {
    throw new Error(`${label} has duplicate issue identifiers across pages`);
  }
  return { items, pages, total };
}

function sourceRows(ledger) {
  return ledger.provenanceGroups
    .flatMap((group) => group.blocks.flatMap((block) => block.occurrences
      .map((occurrence) => ({ ...occurrence, sourceGroup: group.heading }))))
    .filter((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate')
    .sort((a, b) => a.position - b.position);
}

function coverUrl(cover) {
  if (typeof cover === 'string') return cover;
  if (cover && typeof cover === 'object' && typeof cover.url === 'string') return cover.url;
  if (cover && typeof cover === 'object' && typeof cover.path === 'string' && typeof cover.extension === 'string') {
    return `${cover.path}.${cover.extension}`;
  }
  return null;
}

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogIdentity(name) {
  const match = /^(.*?)\s+\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)$/.exec(String(name ?? '').trim());
  return match ? { title: match[1], year: Number(match[2]) } : { title: name, year: null };
}

async function main() {
  await mkdir(SESSION_DIR, { recursive: true });
  const cache = new SessionJsonCache(SESSION_DIR);
  const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
  const rows = sourceRows(ledger);
  if (rows.length !== 259) throw new Error(`Expected 259 candidate rows, received ${rows.length}`);

  const catalog = await fetchAllPages(cache, `${API}/series`, 'Series catalog');
  const catalogById = new Map(catalog.items.map((item) => [Number(item.id), item]));
  const directSeriesIds = [...new Set(rows.flatMap(reviewedSeriesIds))].sort((a, b) => a - b);
  const series = new Map();
  const directSeries = [];
  for (const id of directSeriesIds) {
    const catalogEntry = catalogById.get(id);
    if (!catalogEntry) throw new Error(`Reviewed series ${id} is absent from the catalog`);
    const record = await fetchAllPages(cache, `${API}/series/${id}/issues`, `Series ${id}`);
    series.set(id, record);
    directSeries.push({
      seriesId: id,
      catalogName: catalogEntry.name,
      total: record.total,
      pages: record.pages,
      issueIdDigest: jsonDigest(record.items.map((item) => item.id)),
    });
  }

  const settledRows = rows.map((row) => {
    const selectedSeriesIds = reviewedSeriesIds(row);
    if (selectedSeriesIds.length === 0) {
      return {
        ...row,
        resolution: 'metadata-absent',
        selectedSeriesIds,
        candidateIssueIds: [],
        selectedIssueId: null,
        reason: 'No exact catalog series title matches this source series title.',
      };
    }
    const matches = selectedSeriesIds.flatMap((seriesId) => series.get(seriesId).items
      .filter((item) => row.issueNumber == null || String(item.issueNumber) === String(row.issueNumber))
      .map((item) => ({ ...item, selectedSeriesId: seriesId })));
    const candidateIssueIds = matches.map((item) => Number(item.id));
    if (matches.length === 0) {
      return {
        ...row,
        resolution: 'metadata-absent',
        selectedSeriesIds,
        candidateIssueIds,
        selectedIssueId: null,
        reason: 'The reviewed direct series has no issue with the exact source issue number.',
      };
    }
    if (matches.length > 1) {
      return {
        ...row,
        resolution: 'ambiguous',
        selectedSeriesIds,
        candidateIssueIds,
        selectedIssueId: null,
        reason: 'More than one reviewed direct-series issue has the exact source issue number.',
      };
    }
    const catalogEntry = catalogById.get(selectedSeriesIds[0]);
    const identity = catalogIdentity(catalogEntry.name);
    const exact = row.seriesYear != null
      && normalizeTitle(identity.title) === normalizeTitle(row.normalizedSeriesTitle)
      && identity.year === row.seriesYear;
    return {
      ...row,
      resolution: exact ? 'exact' : 'context-resolved',
      selectedSeriesIds,
      candidateIssueIds,
      selectedIssueId: Number(matches[0].id),
      reason: exact
        ? 'Source title, year, and issue number match one provider issue.'
        : 'Source chronology and explicit issue reference select one reviewed direct series.',
    };
  });

  const provisionalIds = settledRows.filter((row) => row.selectedIssueId != null).map((row) => row.selectedIssueId);
  if (new Set(provisionalIds).size !== provisionalIds.length) throw new Error('Duplicate selected issue ID before hydration');
  const hydrated = new Map();
  for (const id of provisionalIds) hydrated.set(id, await cache.get(`${API}/issues/${id}`));
  for (const row of settledRows.filter((candidate) => candidate.selectedIssueId != null)) {
    const issue = hydrated.get(row.selectedIssueId);
    const identityMatches = Number(issue.id) === row.selectedIssueId
      && row.selectedSeriesIds.includes(Number(issue.seriesId))
      && (row.issueNumber == null || String(issue.issueNumber) === String(row.issueNumber))
      && typeof issue.title === 'string'
      && issue.title.trim().length > 0
      && typeof issue.seriesName === 'string'
      && issue.seriesName.trim().length > 0;
    if (!identityMatches) {
      row.resolution = 'operational';
      row.selectedIssueId = null;
      row.reason = 'Hydrated issue identity disagrees with its direct-series result.';
      continue;
    }
    row.hydrated = {
      issueId: Number(issue.id),
      seriesId: Number(issue.seriesId),
      title: issue.title,
      issueNumber: String(issue.issueNumber),
      detailUrl: issue.detailUrl,
      cover: issue.cover ?? null,
      responseSha256: jsonDigest(issue),
    };
  }

  const partition = Object.fromEntries(
    ['exact', 'context-resolved', 'metadata-absent', 'ambiguous', 'operational']
      .map((status) => [status, settledRows.filter((row) => row.resolution === status).length]),
  );
  if (Object.values(partition).reduce((sum, count) => sum + count, 0) !== 259) {
    throw new Error('Settlement partition does not total 259');
  }
  const selectedIds = settledRows.filter((row) => row.selectedIssueId != null).map((row) => row.selectedIssueId);
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error('Duplicate selected issue ID after hydration');
  const representative = settledRows.find((row) => row.selectedIssueId != null) ?? null;
  const cover = representative?.hydrated?.cover ?? null;

  const outputRows = settledRows.map((row) => ({
    sourcePosition: row.position,
    sourceGroup: row.sourceGroup,
    sourceIssueReference: row.sourceIssueReference,
    sourceRangeReference: row.sourceRangeReference,
    normalizedSeriesTitle: row.normalizedSeriesTitle,
    seriesYear: row.seriesYear,
    issueNumber: row.issueNumber,
    resolution: row.resolution,
    selectedSeriesIds: row.selectedSeriesIds,
    candidateIssueIds: row.candidateIssueIds,
    selectedIssueId: row.selectedIssueId,
    reason: row.reason,
    hydrated: row.hydrated ?? null,
  }));
  const artifact = {
    schemaVersion: 1,
    id: 'inhumans-reading-order-provider-settlement',
    sourceLedger: {
      path: 'scripts/data/cbh-source-ledgers/inhumans-reading-order.json',
      id: ledger.id,
      sourceUrl: ledger.sourceUrl,
      sourceBoundaryDigest: ledger.sourceBoundaryDigest,
      candidateCount: rows.length,
    },
    provider: {
      baseUrl: API,
      catalog: {
        endpoint: `${API}/series?limit=200&offset=<offset>`,
        total: catalog.total,
        itemDigest: jsonDigest(catalog.items),
      },
      directSeries,
    },
    retrieval: {
      serialized: true,
      cache: {
        scope: 'session-only',
        key: 'exact request URL',
        value: 'HTTP 200 nonempty JSON with SHA-256, atomically written',
        metrics: cache.metrics,
      },
      noImageBytesStored: true,
    },
    partition,
    rows: outputRows,
    digests: {
      rowsSha256: jsonDigest(outputRows),
      groupsSha256: jsonDigest(ledger.provenanceGroups.map((group) => ({
        heading: group.heading,
        candidatePositions: outputRows
          .filter((row) => row.sourceGroup === group.heading)
          .map((row) => row.sourcePosition),
      }))),
      selectedIssueIdsSha256: jsonDigest(selectedIds),
    },
    coverReadiness: {
      sourcePosition: representative?.position ?? null,
      selectedIssueId: representative?.selectedIssueId ?? null,
      ready: Boolean(coverUrl(cover)),
      cover,
    },
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    partition,
    directSeries: directSeries.length,
    selected: selectedIds.length,
    coverReadiness: artifact.coverReadiness,
    metrics: cache.metrics,
    digests: artifact.digests,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
