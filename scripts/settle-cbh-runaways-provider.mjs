#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_DIR = process.env.MRT_SESSION_CACHE_DIR;
const API = 'https://marvel.emreparker.com/v1';
const SOURCE_URL = 'https://www.comicbookherald.com/runaways-reading-order/';
const RETRIEVED_AT = '2026-08-27';
const SOURCE_CONTENT_SHA256 = '825db3ad08b3a34cb39ef3e971523afbe225218f409391ac3ad44975856a24d9';
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const LEDGER_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-source-ledgers', 'runaways-reading-order.json');
const SETTLEMENT_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-provider-settlements', 'runaways-reading-order.json');

if (!SESSION_DIR) throw new Error('Set MRT_SESSION_CACHE_DIR to a session-only cache directory.');

const digest = (value) => createHash('sha256').update(
  typeof value === 'string' ? value : JSON.stringify(value),
  'utf8',
).digest('hex');

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => String(start + index));

const SOURCE_BLOCKS = [
  {
    group: "I) Brian K. Vaughn and Adrian Alphona's Runaways",
    text: 'Collects: Runaways (2003 - 2004) #1 to #18',
    title: 'Runaways',
    year: 2003,
    issues: range(1, 18),
  },
  {
    group: "I) Brian K. Vaughn and Adrian Alphona's Runaways",
    text: 'Collects: Runaways (2005 - 2008) #1 to #18, Free Comic Book Day 2006 (X-Men/Runaways) 1',
    title: 'Runaways',
    year: 2005,
    issues: range(1, 18),
  },
  {
    group: "I) Brian K. Vaughn and Adrian Alphona's Runaways",
    text: 'Collects: Runaways (2005 - 2008) #1 to #18, Free Comic Book Day 2006 (X-Men/Runaways) 1',
    title: 'Free Comic Book Day 2006 (X-Men/Runaways)',
    year: 2006,
    catalogTitle: 'Free Comic Book Day 2006 (X-Men/Runaways)',
    catalogYear: null,
    issues: ['1'],
    reference: 'Free Comic Book Day 2006 (X-Men/Runaways) 1',
    ownerProvidedIssueId: 15695,
    ownerProvidedIssueUrl: 'https://www.marvel.com/comics/issue/15695/read',
  },
  {
    group: 'II) Runaways Meet Marvel Civil War and Secret Invasion, and Joss Whedon Joins',
    text: 'Collects: Civil War: Young Avengers & Runaways #1 to #4, Runaways (2005) 19-30, Runaways Saga 1, Secret Invasion: Runaways/Young Avengers 1-3',
    title: 'Civil War: Young Avengers & Runaways',
    year: 2006,
    issues: range(1, 4),
  },
  {
    group: 'II) Runaways Meet Marvel Civil War and Secret Invasion, and Joss Whedon Joins',
    text: 'Collects: Civil War: Young Avengers & Runaways #1 to #4, Runaways (2005) 19-30, Runaways Saga 1, Secret Invasion: Runaways/Young Avengers 1-3',
    title: 'Runaways',
    year: 2005,
    issues: range(19, 30),
  },
  {
    group: 'II) Runaways Meet Marvel Civil War and Secret Invasion, and Joss Whedon Joins',
    text: 'Collects: Civil War: Young Avengers & Runaways #1 to #4, Runaways (2005) 19-30, Runaways Saga 1, Secret Invasion: Runaways/Young Avengers 1-3',
    title: 'Runaways Saga',
    year: 2007,
    issues: ['1'],
  },
  {
    group: 'II) Runaways Meet Marvel Civil War and Secret Invasion, and Joss Whedon Joins',
    text: 'Collects: Civil War: Young Avengers & Runaways #1 to #4, Runaways (2005) 19-30, Runaways Saga 1, Secret Invasion: Runaways/Young Avengers 1-3',
    title: 'Secret Invasion: Runaways/Young Avengers',
    year: 2008,
    issues: range(1, 3),
  },
  {
    group: 'III) Terry Moore and Stuart Immonen Revive the Runaways Ongoing',
    text: 'Collects: Mystic Arcana #4: Sister Grimm, Runaways (2008 - 2009) #1 to #14, What if the Runaways became the Young Avengers?',
    title: 'Mystic Arcana',
    year: 2007,
    issues: ['4'],
    reference: 'Mystic Arcana #4: Sister Grimm',
  },
  {
    group: 'III) Terry Moore and Stuart Immonen Revive the Runaways Ongoing',
    text: 'Collects: Mystic Arcana #4: Sister Grimm, Runaways (2008 - 2009) #1 to #14, What if the Runaways became the Young Avengers?',
    title: 'Runaways',
    year: 2008,
    issues: range(1, 14),
  },
  {
    group: 'III) Terry Moore and Stuart Immonen Revive the Runaways Ongoing',
    text: 'Collects: Mystic Arcana #4: Sister Grimm, Runaways (2008 - 2009) #1 to #14, What if the Runaways became the Young Avengers?',
    title: 'What if the Runaways became the Young Avengers?',
    year: 2008,
    issues: [null],
    reference: 'What if the Runaways became the Young Avengers?',
    omitFromReader: true,
    omissionReason: 'Owner-directed exclusion: this is the Part 1 backup story in What If? House of M (2009) #1, but no official Marvel issue page is available for a reader link.',
    omissionIdentity: 'What If? House of M (2009) #1, Part 1 backup story',
  },
  {
    group: 'IV) The Runaways of Secret Wars',
    text: 'Collects: Runaways (2015) #1 to #4, Secret Wars: Secret Love',
    title: 'Runaways',
    year: 2015,
    issues: range(1, 4),
    omittedIssueNumbers: ['1'],
    omissionReason: 'Owner-directed exclusion: no exact provider issue or official Marvel issue page is available for Runaways (2015) #1.',
  },
  {
    group: 'IV) The Runaways of Secret Wars',
    text: 'Collects: Runaways (2015) #1 to #4, Secret Wars: Secret Love',
    title: 'Secret Wars: Secret Love',
    year: 2015,
    issues: [null],
    reference: 'Secret Wars: Secret Love',
  },
  {
    group: 'Latest Additions:',
    text: 'Collects: Runaways (2017) #1 to #38',
    title: 'Runaways',
    year: 2017,
    issues: range(1, 38),
  },
];

function sourceRows() {
  let position = 0;
  return SOURCE_BLOCKS.flatMap((block, sourceBlockPosition) => block.issues.map((issueNumber) => {
    position += 1;
    const omitFromReader = block.omitFromReader === true
      || (block.omittedIssueNumbers ?? []).includes(issueNumber);
    const sourceIssueReference = block.reference
      ?? `${block.title} (${block.year}) #${issueNumber}`;
    return {
      position,
      sourceBlockPosition: sourceBlockPosition + 1,
      sourceGroup: block.group,
      sourceText: block.text,
      sourceIssueReference,
      sourceRangeReference: block.text,
      normalizedSeriesTitle: block.title,
      seriesYear: block.year,
      issueNumber,
      catalogTitle: block.catalogTitle ?? block.title,
      catalogYear: Object.hasOwn(block, 'catalogYear') ? block.catalogYear : block.year,
      ownerProvidedIssueId: block.ownerProvidedIssueId ?? null,
      ownerProvidedIssueUrl: block.ownerProvidedIssueUrl ?? null,
      omitFromReader,
      omissionReason: omitFromReader ? (block.omissionReason ?? null) : null,
      omissionIdentity: omitFromReader ? (block.omissionIdentity ?? null) : null,
      provisionalDisposition: 'canonical-candidate',
    };
  }));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function exactText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function catalogIdentity(name) {
  const match = /^(.*?)\s+\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)$/.exec(String(name ?? '').trim());
  return match
    ? { title: match[1], year: Number(match[2]) }
    : { title: String(name ?? '').trim(), year: null };
}

function coverFor(issue) {
  const cover = issue?.cover;
  if (!cover || typeof cover.path !== 'string' || typeof cover.extension !== 'string') return null;
  return {
    path: cover.path.replace(/^http:/, 'https:'),
    ext: cover.extension,
  };
}

function isNonemptyJson(value) {
  return Array.isArray(value)
    ? value.length > 0
    : Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

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
    const cachePath = path.join(this.directory, `${digest(url)}.json`);
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      if (cached.url === url && cached.status === 200 && isNonemptyJson(cached.body)
        && cached.bodySha256 === digest(cached.body)) {
        this.metrics.cacheHits += 1;
        return cached.body;
      }
      throw new Error(`Invalid cache entry for ${url}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      this.metrics.networkAttempts += 1;
      let response;
      try {
        response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      } catch (error) {
        this.metrics.errors.push({ url, attempt, kind: 'network', message: error.message });
        throw error;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 6) {
          const error = new Error(`HTTP ${response.status} after retry exhaustion`);
          this.metrics.errors.push({ url, attempt, kind: 'operational', message: error.message });
          throw error;
        }
        this.metrics.retries += 1;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      if (response.status !== 200) {
        const error = new Error(`HTTP ${response.status}`);
        this.metrics.errors.push({ url, attempt, kind: 'http', message: error.message });
        throw error;
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        this.metrics.errors.push({ url, attempt, kind: 'invalid-json', message: error.message });
        throw error;
      }
      if (!isNonemptyJson(body)) {
        const error = new Error('empty HTTP 200 JSON');
        this.metrics.errors.push({ url, attempt, kind: 'empty-json', message: error.message });
        throw error;
      }
      const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
      const record = { url, status: 200, bodySha256: digest(body), body };
      await writeFile(temporary, JSON.stringify(record), 'utf8');
      await rename(temporary, cachePath);
      this.metrics.cacheWrites += 1;
      return body;
    }
    throw new Error(`Unreachable retry state for ${url}`);
  }
}

async function fetchAllPages(cache, endpoint, label) {
  const items = [];
  const pages = [];
  let total = null;
  for (let offset = 0; offset < Number.MAX_SAFE_INTEGER; ) {
    if (pages.length >= MAX_PAGES) throw new Error(`${label} exceeded ${MAX_PAGES} pages`);
    const body = await cache.get(`${endpoint}?limit=${PAGE_SIZE}&offset=${offset}`);
    const page = Array.isArray(body.items) ? body.items : [];
    if (!Number.isInteger(body.total) || body.total < 0 || (pages.length === 0 && page.length === 0)) {
      throw new Error(`${label} returned invalid pagination at offset ${offset}`);
    }
    if (total == null) total = body.total;
    if (body.total !== total) throw new Error(`${label} changed total while paging`);
    pages.push({ offset, count: page.length, hasNext: body.has_next === true, sha256: digest(body) });
    items.push(...page);
    if (!body.has_next) break;
    if (page.length === 0) throw new Error(`${label} claimed another page after an empty page`);
    offset += page.length;
  }
  if (items.length !== total) throw new Error(`${label} ended with ${items.length} items, expected ${total}`);
  if (new Set(items.map((item) => String(item.id))).size !== items.length) {
    throw new Error(`${label} returned duplicate ids across pages`);
  }
  return { total, pages, items };
}

function selectedSeriesFor(row, catalog) {
  const title = row.catalogTitle ?? row.title;
  const year = Object.hasOwn(row, 'catalogYear') ? row.catalogYear : row.year;
  const matches = catalog.items.filter((item) => {
    const identity = catalogIdentity(item.name);
    return exactText(identity.title) === exactText(title)
      && identity.year === year;
  });
  return matches.map((item) => Number(item.id));
}

function verifyIssue(row, seriesId, issue) {
  if (Number(issue?.id) !== Number(issue?.id) || Number(issue.id) <= 0) return false;
  if (Number(issue.seriesId) !== seriesId) return false;
  if (row.issueNumber != null && String(issue.issueNumber) !== String(row.issueNumber)) return false;
  if (typeof issue.title !== 'string' || !issue.title.trim()) return false;
  if (typeof issue.seriesName !== 'string' || !issue.seriesName.trim()) return false;
  if (!/^https:\/\/www\.marvel\.com\/comics\/issue\/\d+\//.test(String(issue.detailUrl ?? ''))) return false;
  const identity = catalogIdentity(issue.seriesName);
  return exactText(identity.title) === exactText(row.catalogTitle)
    && identity.year === row.catalogYear;
}

function readerDispositionFor(row) {
  if (row.omitFromReader === true) return 'owner-directed-exclusion';
  if (row.resolution === 'exact' || row.resolution === 'owner-validated') {
    return row.hydrated?.digitalId == null ? 'owner-directed-exclusion' : 'publish';
  }
  return 'owner-directed-exclusion';
}

function toLedger(rows, outcomes, sourceContentSha256) {
  const byPosition = new Map(outcomes.map((row) => [row.position, row]));
  const sourceNodes = SOURCE_BLOCKS.map((block, index) => ({
    position: index + 1,
    sourceGroup: block.group,
    tag: 'p',
    text: block.text,
  }));
  const occurrences = rows.map((row) => {
    const outcome = byPosition.get(row.position);
    const disposition = readerDispositionFor(outcome);
    return {
      position: row.position,
      sourceBlockPosition: row.sourceBlockPosition,
      sourceGroup: row.sourceGroup,
      sourceText: row.sourceText,
      sourceReference: row.sourceIssueReference,
      sourceRangeReference: row.sourceRangeReference,
      sourceClauseKind: row.issueNumber == null ? 'named-work-label' : 'collect-clause',
      normalizedSeriesTitle: row.normalizedSeriesTitle,
      seriesYear: row.seriesYear,
      issueNumber: row.issueNumber,
      disposition: disposition === 'publish' ? 'exact' : 'exclusion',
      readerDisposition: disposition,
      ...(outcome.ownerProvidedIssueUrl == null ? {} : {
        ownerProvidedIssueUrl: outcome.ownerProvidedIssueUrl,
        ownerProvidedIssueId: outcome.ownerProvidedIssueId,
      }),
      ...(outcome.omissionReason == null ? {} : {
        ownerDirectedReason: outcome.omissionReason,
        ownerDirectedIdentity: outcome.omissionIdentity ?? outcome.sourceIssueReference,
      }),
      providerResolution: outcome.resolution,
      providerReason: outcome.reason,
    };
  });
  const provenanceGroups = SOURCE_BLOCKS.map((block, index) => ({
    sourceGroupPosition: index + 1,
    heading: block.group,
    blocks: [{
      sourceBlockPosition: index + 1,
      sourceText: block.text,
      occurrences: rows
        .filter((row) => row.sourceBlockPosition === index + 1)
        .map((row) => ({ ...byPosition.get(row.position), readerDisposition: readerDispositionFor(byPosition.get(row.position)) })),
    }],
  }));
  const boundary = {
    scope: 'full page',
    qualifyingSection: null,
    rationale: 'No Best Comics or Essential Comics subsection appears on the source page, so the full visible reading order is the required boundary.',
    firstHeading: "I) Brian K. Vaughn and Adrian Alphona's Runaways",
    lastHeading: 'Latest Additions:',
    firstBlockText: SOURCE_BLOCKS[0].text,
    lastBlockText: SOURCE_BLOCKS.at(-1).text,
  };
  return {
    schemaVersion: 1,
    id: 'runaways-reading-order',
    inventoryId: 'runaways-reading-order',
    sourceUrl: SOURCE_URL,
    sourceRetrievedAt: RETRIEVED_AT,
    sourceContentSha256,
    sourceNodeSha256: digest(sourceNodes.map((node) => `${node.tag}:${node.text}`).join('\n')),
    sourceOccurrenceSha256: digest(occurrences),
    sourceIssueBearingBlocksSha256: digest(SOURCE_BLOCKS.map(({ group, text }) => ({ group, text }))),
    sourceBoundary: boundary,
    sourceBoundaryDigest: digest(canonical(boundary)),
    sourceGroupCount: provenanceGroups.length,
    sourceNodeCount: sourceNodes.length,
    sourceOccurrenceCount: occurrences.length,
    counts: {
      exact: occurrences.filter((row) => row.disposition === 'exact').length,
      exclusion: occurrences.filter((row) => row.disposition === 'exclusion').length,
      repeat: 0,
      gap: 0,
    },
    sourceNodes,
    occurrences,
    provenanceGroups,
  };
}

async function writeJson(pathname, value) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, pathname);
}

async function main() {
  const cacheDirectory = path.join(SESSION_DIR, 'runaways-provider-cache');
  await mkdir(cacheDirectory, { recursive: true });
  const rows = sourceRows();
  if (rows.length !== 116) throw new Error(`Expected 116 source positions, found ${rows.length}`);
  if (new Set(rows.map((row) => row.position)).size !== rows.length) {
    throw new Error('Source positions are not unique');
  }
  const identityKeys = rows.map((row) => `${exactText(row.normalizedSeriesTitle)}|${row.seriesYear}|${row.issueNumber}`);
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new Error('Source has duplicate normalized title, year, and issue identities');
  }

  const cache = new SessionJsonCache(cacheDirectory);
  const catalog = await fetchAllPages(cache, `${API}/series`, 'Series catalog');
  const sourceSeries = new Map(rows.map((row) => [
    `${row.catalogTitle}|${row.catalogYear}`,
    { title: row.catalogTitle, year: row.catalogYear },
  ]));
  const selectedSeries = new Map();
  const outcomes = [];

  for (const [key, sourceSeriesIdentity] of sourceSeries) {
    const candidateIds = selectedSeriesFor(sourceSeriesIdentity, catalog);
    selectedSeries.set(key, candidateIds);
  }

  const ownerProvidedIssues = new Map();
  for (const row of rows.filter((candidate) => candidate.ownerProvidedIssueId != null)) {
    const issue = await cache.get(`${API}/issues/${row.ownerProvidedIssueId}`);
    const urlId = Number(/\/issue\/(\d+)\//.exec(row.ownerProvidedIssueUrl)?.[1]);
    if (Number(issue.id) !== row.ownerProvidedIssueId || urlId !== row.ownerProvidedIssueId
      || String(issue.issueNumber) !== String(row.issueNumber)
      || !/^https:\/\/www\.marvel\.com\/comics\/issue\/\d+\//.test(String(issue.detailUrl ?? ''))) {
      throw new Error(`Owner-provided identity for ${row.sourceIssueReference} did not validate.`);
    }
    ownerProvidedIssues.set(row.position, issue);
  }

  const exactSeriesIds = [...new Set([...selectedSeries.values()]
    .filter((ids) => ids.length === 1)
    .flat()
    .concat([...ownerProvidedIssues.values()].map((issue) => Number(issue.seriesId))))]
    .sort((left, right) => left - right);
  const series = new Map();
  const directSeries = [];
  for (const seriesId of exactSeriesIds) {
    const record = await fetchAllPages(cache, `${API}/series/${seriesId}/issues`, `Series ${seriesId}`);
    series.set(seriesId, record);
    const catalogItem = catalog.items.find((item) => Number(item.id) === seriesId);
    directSeries.push({
      seriesId,
      catalogName: catalogItem?.name ?? null,
      total: record.total,
      pages: record.pages,
      issueIdDigest: digest(record.items.map((item) => item.id)),
    });
  }

  for (const row of rows) {
    const ownerProvidedIssue = ownerProvidedIssues.get(row.position);
    if (ownerProvidedIssue) {
      const seriesId = Number(ownerProvidedIssue.seriesId);
      const seriesItems = series.get(seriesId)?.items ?? [];
      if (!seriesItems.some((item) => Number(item.id) === Number(ownerProvidedIssue.id))) {
        throw new Error(`Owner-provided issue ${ownerProvidedIssue.id} is absent from its fully paginated provider series.`);
      }
      outcomes.push({
        ...row,
        resolution: 'owner-validated-pending-hydration',
        selectedSeriesIds: [seriesId],
        candidateIssueIds: [Number(ownerProvidedIssue.id)],
        selectedIssueId: Number(ownerProvidedIssue.id),
        reason: 'Owner-provided official Marvel issue identity was validated against the provider.',
        hydrated: null,
      });
      continue;
    }
    const seriesIds = selectedSeries.get(`${row.catalogTitle}|${row.catalogYear}`) ?? [];
    if (seriesIds.length === 0) {
      outcomes.push({
        ...row,
        resolution: 'metadata-absent',
        selectedSeriesIds: [],
        candidateIssueIds: [],
        selectedIssueId: null,
        reason: 'No provider series has the exact source title and year.',
        hydrated: null,
      });
      continue;
    }
    if (seriesIds.length > 1) {
      outcomes.push({
        ...row,
        resolution: 'ambiguous',
        selectedSeriesIds: seriesIds,
        candidateIssueIds: [],
        selectedIssueId: null,
        reason: 'More than one provider series has the exact source title and year.',
        hydrated: null,
      });
      continue;
    }
    const seriesId = seriesIds[0];
    const matches = series.get(seriesId).items.filter((item) => (
      row.issueNumber == null || String(item.issueNumber) === String(row.issueNumber)
    ));
    const candidateIssueIds = matches.map((item) => Number(item.id));
    if (matches.length === 0) {
      outcomes.push({
        ...row,
        resolution: 'metadata-absent',
        selectedSeriesIds: [seriesId],
        candidateIssueIds,
        selectedIssueId: null,
        reason: 'The exact provider series has no issue with the exact source issue number.',
        hydrated: null,
      });
      continue;
    }
    if (matches.length > 1) {
      outcomes.push({
        ...row,
        resolution: 'ambiguous',
        selectedSeriesIds: [seriesId],
        candidateIssueIds,
        selectedIssueId: null,
        reason: 'The exact provider series has more than one issue with the exact source issue number.',
        hydrated: null,
      });
      continue;
    }
    outcomes.push({
      ...row,
      resolution: 'exact-pending-hydration',
      selectedSeriesIds: [seriesId],
      candidateIssueIds,
      selectedIssueId: candidateIssueIds[0],
      reason: 'One provider issue matches the exact source title, year, and issue number.',
      hydrated: null,
    });
  }

  const selectedIds = outcomes
    .filter((row) => row.selectedIssueId != null)
    .map((row) => row.selectedIssueId);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('Exact source rows selected duplicate provider issue ids');
  }
  const hydrated = new Map();
  for (const issueId of selectedIds) hydrated.set(issueId, await cache.get(`${API}/issues/${issueId}`));
  for (const row of outcomes.filter((candidate) => candidate.selectedIssueId != null)) {
    const issue = hydrated.get(row.selectedIssueId);
    const isOwnerValidated = row.resolution === 'owner-validated-pending-hydration';
    if ((!isOwnerValidated && !verifyIssue(row, row.selectedSeriesIds[0], issue))
      || (isOwnerValidated && Number(issue?.id) !== row.ownerProvidedIssueId)) {
      row.resolution = 'operational';
      row.selectedIssueId = null;
      row.reason = 'Hydrated provider issue did not preserve the exact selected identity.';
      continue;
    }
    row.resolution = isOwnerValidated ? 'owner-validated' : 'exact';
    row.reason = isOwnerValidated
      ? 'Owner-provided official Marvel issue identity was validated against the provider.'
      : 'Source title, year, and issue number match one hydrated provider issue.';
    row.hydrated = {
      issueId: Number(issue.id),
      seriesId: Number(issue.seriesId),
      seriesName: issue.seriesName,
      title: issue.title,
      issueNumber: String(issue.issueNumber),
      detailUrl: issue.detailUrl,
      onSaleDate: issue.onSaleDate ?? null,
      unlimitedDate: issue.unlimitedDate ?? null,
      digitalId: issue.digitalId ?? null,
      cover: coverFor(issue),
      pageCount: issue.pageCount ?? null,
      creators: Array.isArray(issue.creators)
        ? issue.creators
          .filter((creator) => /writer|penciler|artist/i.test(creator.role ?? ''))
          .map(({ name, role }) => ({ name, role }))
        : [],
      responseSha256: digest(issue),
    };
  }

  const partition = Object.fromEntries(
    ['exact', 'owner-validated', 'metadata-absent', 'ambiguous', 'operational']
      .map((status) => [status, outcomes.filter((row) => row.resolution === status).length]),
  );
  if (Object.values(partition).reduce((total, count) => total + count, 0) !== rows.length) {
    throw new Error('Settlement partition does not account for every source position');
  }
  if (partition.operational > 0 || cache.metrics.errors.length > 0) {
    throw new Error('Operational provider failures cannot be converted into source metadata gaps.');
  }

  const ledger = toLedger(rows, outcomes, SOURCE_CONTENT_SHA256);
  const outputRows = outcomes.map((row) => ({
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
    hydrated: row.hydrated,
    readerDisposition: readerDispositionFor(row),
    ownerProvidedIssueId: row.ownerProvidedIssueId,
    ownerProvidedIssueUrl: row.ownerProvidedIssueUrl,
    ownerDirectedReason: row.omissionReason,
    ownerDirectedIdentity: row.omissionIdentity,
  }));
  const firstCovered = outputRows.find((row) => row.hydrated?.cover != null) ?? null;
  const settlement = {
    schemaVersion: 1,
    id: 'runaways-reading-order-provider-settlement',
    sourceLedger: {
      path: 'scripts/data/cbh-source-ledgers/runaways-reading-order.json',
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
        itemDigest: digest(catalog.items),
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
    coverReadiness: {
      sourcePosition: firstCovered?.sourcePosition ?? null,
      selectedIssueId: firstCovered?.selectedIssueId ?? null,
      ready: firstCovered != null,
      cover: firstCovered?.hydrated?.cover ?? null,
    },
    digests: {
      rowsSha256: digest(outputRows),
      groupsSha256: digest(ledger.provenanceGroups.map((group) => ({
        heading: group.heading,
        positions: group.blocks.flatMap((block) => block.occurrences.map((row) => row.position)),
      }))),
      selectedIssueIdsSha256: digest(outputRows
        .filter((row) => row.selectedIssueId != null)
        .map((row) => row.selectedIssueId)),
    },
  };

  await writeJson(LEDGER_PATH, ledger);
  await writeJson(SETTLEMENT_PATH, settlement);
  console.log(JSON.stringify({
    sourcePositions: rows.length,
    partition,
    cover: settlement.coverReadiness,
    retrieval: cache.metrics,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
