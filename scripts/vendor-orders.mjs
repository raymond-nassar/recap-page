// Build-time vendoring of curated reading orders.
// Reads the curated-list manifest (src/data/curated-lists.json), loads each markdown order,
// and enriches every issue with the fields the app needs (digitalId, seriesId, onSale,
// unlimitedDate), writing pinned JSON plus the catalog manifest into src/data/.
//
// An order is loaded either from `sourceUrl` over https or from `sourceFile`, a checklist kept
// in src/data/orders/. Adding a curated list is a manifest edit only, with no change to this
// script or to the app.
//
// Run manually:  npm run vendor
// One list only: npm run vendor -- --only=new-ultimate-universe
//
// `--only` exists because re-vendoring every order to add one costs hundreds of API calls and
// rewrites the snapshot date on files that did not change. Orders that are skipped keep their
// existing pinned JSON, and their catalog entries are rebuilt from it so catalog.json stays
// complete rather than silently losing the lists that were not rebuilt.
//
// The output is committed so importing a curated order needs zero network access at runtime,
// and so we are not exposed to upstream `main` changing under us.

import {
  readFile, writeFile, mkdir, rename, rm,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonFetcher } from './lib/fetch-json.mjs';
import { lookupIssues } from './lib/lookup-issues.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseIssueNumber, reconcileIssueTitleNumber } from './lib/issue-number.mjs';
import { RateLimiter } from '../src/js/lib/limiter.js';
import { placeholderId } from './lib/placeholder-id.mjs';
import { countOrderGaps } from '../src/js/lib/model.js';
import {
  buildChapterFamily,
  buildChildOverlapEvidence,
  validateChapterLedger,
} from './lib/chapter-orders.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://marvel.emreparker.com/v1';
const MANIFEST = join(ROOT, 'src', 'data', 'curated-lists.json');
const DATA_DIR = join(ROOT, 'src', 'data');
const ORDERS_DIR = join(DATA_DIR, 'orders');
const SCRIPT_DATA_DIR = join(ROOT, 'scripts', 'data');

// A manifest that cannot be read in full is a maintainer error: vendoring the valid subset
// would quietly ship a catalog missing a list nobody noticed was broken.
async function loadOrders() {
  const { entries, paths, errors } = parseManifest(JSON.parse(await readFile(MANIFEST, 'utf8')));
  if (errors.length) {
    throw new Error(`curated-lists.json is not valid:\n  - ${errors.join('\n  - ')}`);
  }
  if (!entries.length) throw new Error('curated-lists.json defines no reading lists');
  return { entries, paths };
}

// Vendoring hammers the metadata service harder than the app does, so use a stricter
// limiter here to stay clear of its burst cap while still keeping the run deterministic.
const { getJson } = createJsonFetcher({
  maxAttempts: 10,
  limiter: new RateLimiter({
    concurrency: 1,
    windows: [
      { max: 10, ms: 60_000 },
      { max: 5, ms: 10_000 },
    ],
  }),
});

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// An order comes from exactly one place; the manifest has already guaranteed which.
async function loadOrderText(order) {
  if (order.sourceFile) return readFile(join(ORDERS_DIR, order.sourceFile), 'utf8');
  return getText(order.sourceUrl);
}

async function loadPartitionLedgers(orders) {
  const ledgers = new Map();
  for (const order of orders.filter((entry) => entry.partitionFile)) {
    const ledger = validateChapterLedger(JSON.parse(
      await readFile(join(SCRIPT_DATA_DIR, order.partitionFile), 'utf8'),
    ));
    if (ledger.parentId !== order.id) {
      throw new Error(`${order.partitionFile} belongs to "${ledger.parentId}", not "${order.id}"`);
    }
    ledgers.set(order.id, ledger);
  }
  return ledgers;
}

function parseOnly(argv) {
  const ids = new Set();
  for (const arg of argv) {
    if (!arg.startsWith('--only=')) continue;
    for (const id of arg.slice('--only='.length).split(',')) {
      if (id.trim()) ids.add(id.trim());
    }
  }
  return ids;
}

function parseMetadataCache(argv) {
  const matches = argv.filter((arg) => arg.startsWith('--metadata-cache='));
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('Use --metadata-cache once');
  const cacheDir = matches[0].slice('--metadata-cache='.length).trim();
  if (!cacheDir) throw new Error('--metadata-cache must name a cache directory');
  return resolve(cacheDir);
}

function cacheKey(url) {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

function assertCachedMetadata(record, id, url) {
  if (!record || typeof record !== 'object') {
    throw new Error(`Cached metadata for issue ${id} is not an object`);
  }
  if (record.url !== url || record.urlSha256 !== cacheKey(url)) {
    throw new Error(`Cached metadata for issue ${id} does not match its request URL`);
  }
  if (record.status !== 200 || !record.body || typeof record.body !== 'object'
    || Array.isArray(record.body)) {
    throw new Error(`Cached metadata for issue ${id} is not a successful JSON response`);
  }
  if (!Number.isInteger(record.body.id) || record.body.id !== id) {
    throw new Error(`Cached metadata for issue ${id} does not identify that exact issue`);
  }
  if (record.bodySha256 !== cacheKey(JSON.stringify(record.body))) {
    throw new Error(`Cached metadata for issue ${id} has an invalid body digest`);
  }
  for (const field of ['title', 'issueNumber', 'detailUrl', 'seriesId', 'seriesName']) {
    if (record.body[field] == null || String(record.body[field]).trim() === '') {
      throw new Error(`Cached metadata for issue ${id} has no ${field}`);
    }
  }
  return record.body;
}

async function loadCachedMetadata(ids, cacheDir) {
  if (new Set(ids).size !== ids.length) {
    throw new Error('Cache-only metadata requires each requested issue exactly once');
  }
  const metadata = await Promise.all(ids.map(async (id) => {
    const url = `${API}/issues/${id}`;
    const file = join(cacheDir, `${cacheKey(url)}.json`);
    let record;
    try {
      record = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Cached metadata for issue ${id} could not be read from ${file}`, {
        cause: error,
      });
    }
    return [id, assertCachedMetadata(record, id, url)];
  }));
  const meta = new Map(metadata);
  if (meta.size !== ids.length) {
    throw new Error('Cache-only metadata did not establish a one-to-one issue set');
  }
  return meta;
}

async function cleanupArtifacts(paths) {
  const results = await Promise.allSettled(paths.map((artifact) => rm(artifact, { force: true })));
  return results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
}

async function restoreOutput(output) {
  if (output.backedUp) {
    await rm(output.path, { force: true });
    await rename(output.backupPath, output.path);
    output.restored = true;
  } else if (output.replaced) {
    await rm(output.path, { force: true });
    output.restored = true;
  }
}

export async function writeOutputsAtomically(outputs, { replaceFile = rename } = {}) {
  const staged = outputs.map((output) => ({
    ...output,
    tempPath: `${output.path}.tmp-${process.pid}-${randomUUID()}`,
    backupPath: `${output.path}.backup-${process.pid}-${randomUUID()}`,
    backedUp: false,
    replaced: false,
    restored: false,
  }));
  let retainBackups = false;
  let outcomeError = null;
  try {
    const writes = await Promise.allSettled(
      staged.map((output) => writeFile(output.tempPath, output.content, 'utf8')),
    );
    const writeErrors = writes
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (writeErrors.length) {
      throw new AggregateError(writeErrors, 'Vendor output staging failed');
    }

    for (const output of staged) {
      // Renames commit one file at a time. Keeping the old file beside its replacement lets a
      // later failed commit return every final output to the exact pre-vendoring state.
      try {
        await rename(output.path, output.backupPath);
        output.backedUp = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await replaceFile(output.tempPath, output.path);
      output.replaced = true;
    }
  } catch (error) {
    const restores = await Promise.allSettled(
      [...staged].reverse().map((output) => restoreOutput(output)),
    );
    const restoreErrors = restores
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (restoreErrors.length) {
      retainBackups = true;
      outcomeError = new AggregateError(
        [error, ...restoreErrors],
        `Vendor output commit failed and recovery was incomplete: ${error.message}`,
        { cause: error },
      );
    } else {
      outcomeError = error;
    }
  }
  const artifacts = staged.map((output) => output.tempPath);
  if (!retainBackups) artifacts.push(...staged.map((output) => output.backupPath));
  const cleanupErrors = await cleanupArtifacts(artifacts);
  if (cleanupErrors.length) {
    const cause = outcomeError ?? cleanupErrors[0];
    const message = outcomeError
      ? `Vendor output commit failed and temporary cleanup also failed: ${outcomeError.message}`
      : 'Vendor output commit succeeded but temporary cleanup failed';
    throw new AggregateError(
      outcomeError ? [outcomeError, ...cleanupErrors] : cleanupErrors,
      message,
      { cause },
    );
  }
  if (outcomeError) throw outcomeError;
}

// Marvel's metadata occasionally carries a doubled space inside a title, as in
// "King In Black: Black Panther  (2021) #1". The extra space is not data, and pinning it verbatim
// makes it read as our typo rather than theirs, so internal whitespace is collapsed on ingest.
// Typographic dashes are normalized too because issue titles are shipped surface copy.
//
// It is applied to titles resolved from the API, never to a placeholder's title: that string is
// the input to placeholderId(), so rewriting it would change the id and silently reset the
// reader's progress on that entry.
//
// Scope it to titles and series names. Marvel's `description` is their prose, and it double-spaces
// after sentences on purpose; collapsing that would rewrite their copy to no reader's benefit, and
// unlike a title it is not a field anything matches, sorts or searches on. Since BL-130 the field
// is no longer vendored at all, so a sweep for doubled spaces in src/data no longer finds any in a
// description. The 47 it does find are series names out of the index, which a different generator
// writes. Neither fact is a reason to widen this function: the placeholder-title hazard above is
// unchanged and is the one that would cost a reader their progress.
function cleanText(s) {
  return String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}

// Marvel's CDN serves http:// in the API payload but supports https. Normalise so covers
// are not blocked as mixed content if the app is ever served over https.
function coverBase(cover) {
  if (!cover?.path || !cover?.extension) return null;
  return { path: String(cover.path).replace(/^http:/, 'https:'), ext: cover.extension };
}

// The card art for a reading order. `coverIssueId` names the issue an order should be
// recognised by; without one the first issue in reading order that has art stands in, which
// is the issue a reader would open first anyway. Either way the image is Marvel's own
// metadata for an issue that is actually in the order, never a hand-picked promotional
// image, so nothing here is scraped and the attribution stays truthful.
function catalogCover(order, payload) {
  const items = payload.items ?? [];
  if (order.coverIssueId != null) {
    const named = items.find((i) => i.issueId === order.coverIssueId);
    // A silent fallback here would pin art for an issue the curator did not choose and give
    // no sign that the reference had gone stale.
    if (!named) throw new Error(`${order.id}: coverIssueId ${order.coverIssueId} is not an issue in this order`);
    if (!named.cover) throw new Error(`${order.id}: coverIssueId ${order.coverIssueId} has no cover in Marvel's metadata`);
    return { coverIssueId: named.issueId, cover: named.cover };
  }
  const first = items.find((i) => i?.cover?.path && i?.cover?.ext);
  return first ? { coverIssueId: first.issueId, cover: first.cover } : { coverIssueId: null, cover: null };
}

// Derived from the payload rather than restated, so the issue count a reader sees before
// importing can never drift from the file they will actually import.
function catalogEntry(order, payload) {
  const { coverIssueId, cover } = catalogCover(order, payload);
  const { placeholders, empty } = countOrderGaps(payload);
  return {
    id: order.id,
    file: order.out,
    name: order.name,
    description: order.description,
    type: order.type,
    depth: order.depth,
    ...(order.type === 'character-run' ? { spotlightKind: order.spotlightKind } : {}),
    count: payload.count,
    placeholderCount: placeholders,
    emptyRecordCount: empty,
    // Derived from the payload for the same reason the issue count is: a number the reader
    // sees before importing must come from the file they will actually import. Orders that are
    // not divided into collected editions report 0, which the catalog renders as nothing.
    collections: Number.isInteger(payload.collections) ? payload.collections : 0,
    characters: order.characters ?? [],
    keywords: order.keywords ?? [],
    group: order.group,
    groupName: order.groupName,
    variant: order.variant,
    // An editorial judgement recorded in curated-lists.json, not inferred: true means the
    // order opens the story it tells, so it assumes no prior reading.
    beginner: order.beginner === true,
    // Also editorial: the year this order's reading starts, which is what the catalog is
    // ordered by. Null for an order that ranges across the timeline instead of sitting on it.
    timeline: Number.isInteger(order.timeline) ? order.timeline : null,
    coverIssueId,
    cover,
    source: payload.source,
    ...(payload.sourceSection ? { sourceSection: payload.sourceSection } : {}),
    sourceOrigin: payload.sourceOrigin,
    sourceLicense: payload.sourceLicense,
    updatedAt: payload.generatedAt,
  };
}

async function main() {
  const { entries: orders, paths } = await loadOrders();
  const args = process.argv.slice(2);
  const only = parseOnly(args);
  const metadataCacheDir = parseMetadataCache(args);
  const partitionLedgers = await loadPartitionLedgers(orders);
  const childParents = new Map();
  for (const [parentId, ledger] of partitionLedgers) {
    for (const chapter of ledger.chapters) childParents.set(chapter.id, parentId);
  }
  // The catalog carries editorial metadata — descriptions, keywords, beginner, the cover
  // issue — that changes without any reading order changing. Rebuilding it from the pinned
  // files costs no API calls and leaves every order's snapshot date alone, so an editorial
  // edit is not a reason to re-fetch several hundred issues.
  const catalogOnly = args.includes('--catalog-only');
  if (catalogOnly && only.size) {
    throw new Error('--catalog-only rebuilds every catalog entry from the pinned files, so it cannot be combined with --only');
  }
  if (metadataCacheDir && (catalogOnly || only.size === 0)) {
    throw new Error('--metadata-cache requires an --only target and cannot rebuild catalog-only');
  }
  const selectedParents = new Set();
  for (const id of only) {
    const parentId = orders.some((order) => order.id === id) ? id : childParents.get(id);
    // A typo here would otherwise vendor nothing and look like a success. Generated children
    // resolve to their one partition parent so a catalog id is also a usable maintenance target.
    if (!parentId) {
      throw new Error(`--only names "${id}", which is not a list in curated-lists.json`);
    }
    selectedParents.add(parentId);
  }
  const targets = catalogOnly
    ? []
    : (only.size ? orders.filter((order) => selectedParents.has(order.id)) : orders);
  if (metadataCacheDir && targets.length !== 1) {
    throw new Error('--metadata-cache requires exactly one source order');
  }
  if (metadataCacheDir && targets.some((order) => !order.sourceFile)) {
    throw new Error('--metadata-cache requires a local sourceFile and never fetches source pages');
  }
  if (catalogOnly) console.log('Rebuilding catalog.json from the pinned order files; no issues are re-fetched.');
  else if (only.size) console.log(`Vendoring ${targets.length} of ${orders.length} source orders; the rest keep their pinned files.`);

  const parsed = [];
  for (const order of targets) {
    const md = await loadOrderText(order);
    const parsedOrder = parseChecklist(md);
    const { entries, unresolved } = parsedOrder;
    console.log(`${order.id}: ${entries.length} issues, ${unresolved.length} unresolved`);
    parsed.push({ order, parsedOrder });
  }

  const ids = [...new Set(parsed.flatMap(({ parsedOrder }) => (
    parsedOrder.entries.map((entry) => entry.issueId)
  )))];
  if (ids.length) {
    console.log(metadataCacheDir
      ? `Reading ${ids.length} unique issues from the metadata cache only...`
      : `Hydrating ${ids.length} unique issues (rate limited, expect a few minutes)...`);
  }

  const { meta, refused } = metadataCacheDir
    ? {
      meta: await loadCachedMetadata(ids, metadataCacheDir),
      refused: new Set(),
    }
    : await lookupIssues(ids, {
      getJson,
      url: (id) => `${API}/issues/${id}`,
      onProgress: ({ done, total, id, refused: wasRefused }) => {
        if (wasRefused) console.warn(`  ! issue ${id}: upstream holds no record of it (404)`);
        if (done % 25 === 0) console.log(`  ${done}/${total}`);
      },
    });

  const generatedAt = new Date().toISOString();
  const summary = [];
  const catalogById = new Map();
  const payloadByCatalogId = new Map();
  const families = new Map();
  const outputs = [];
  const addCatalogOutputs = (order, parsedOrder, payload) => {
    const ledger = partitionLedgers.get(order.id);
    if (!ledger) {
      catalogById.set(order.id, [catalogEntry(order, payload)]);
      payloadByCatalogId.set(order.id, payload);
      return;
    }
    const family = buildChapterFamily({
      order,
      parsed: parsedOrder,
      parentPayload: payload,
      ledger,
      existingPathIds: paths.map((entry) => entry.id),
    });
    families.set(order.id, family);
    for (const child of family.children) {
      outputs.push({
        path: join(DATA_DIR, child.order.out),
        content: `${JSON.stringify(child.payload, null, 2)}\n`,
      });
      payloadByCatalogId.set(child.order.id, child.payload);
    }
    catalogById.set(
      order.id,
      family.children.map((child) => catalogEntry(child.order, child.payload)),
    );
  };

  for (const { order, parsedOrder } of parsed) {
    const { entries, unresolved } = parsedOrder;
    let missingDigital = 0;
    let missingCover = 0;

    const issueItems = entries.map((e) => {
      const d = meta.get(e.issueId) ?? {};
      if (d.digitalId == null) missingDigital += 1;
      const cover = coverBase(d.cover);
      if (!cover) missingCover += 1;
      const metadataTitle = cleanText(d.title ?? e.title);
      const metadataNumber = parseIssueNumber(metadataTitle);
      const checklistNumber = parseIssueNumber(e.title);
      return {
        at: e.index,
        item: {
          issueId: e.issueId,
          title: reconcileIssueTitleNumber(
            metadataTitle,
            metadataNumber,
            checklistNumber ?? metadataNumber,
          ),
          number: checklistNumber ?? metadataNumber,
          url: d.detailUrl ?? e.url,
          seriesId: d.seriesId ?? null,
          seriesName: d.seriesName == null ? null : cleanText(d.seriesName),
          onSale: d.onSaleDate ?? null,
          mu: d.unlimitedDate ?? null,
          digitalId: d.digitalId ?? null,
          cover,
          // Not vendored, deliberately. This is the one copied field that is Marvel's own prose
          // reproduced verbatim rather than a fact about a publication, which is why the provenance
          // record names it as the field to look at hardest. Dropping it removed 151,840 characters
          // across 798 of 1,473 records and cost one sentence on one screen: the field reached the
          // interface through a single consumer, and `synopsisFallback` already answered for its
          // absence for the 675 records that never had one. The lookup above still requests it, and
          // `npm run contract` still asserts the service returns it, so this stays reversible by
          // changing this one line back rather than by rebuilding anything.
          description: null,
          pageCount: d.pageCount ?? null,
          creators: Array.isArray(d.creators)
            ? d.creators.filter((c) => /writer|penciler|artist/i.test(c.role ?? '')).map((c) => ({ name: c.name, role: c.role }))
            : [],
          // The one thing this run learned that the item cannot otherwise show. An issue the
          // service answered 404 for is recorded here as refused, so the app is reading what the
          // lookup was told instead of inferring it from every field being empty. Written only
          // when it is true, so an order with nothing refused re-vendors with no per-item change
          // at all. The file still differs, because generatedAt is a fresh wall clock on every
          // run, so an empty diff is not the thing to check a run against.
          ...(refused.has(e.issueId) ? { detailsRefused: true } : {}),
          // The collected edition this issue belongs to, taken from the checklist's own
          // sub-headings. It is the curator's grouping, not Marvel's: the metadata API carries
          // no collection record for anything published after 2023, so there is nothing
          // upstream to derive it from. Omitted entirely for an order with no sub-headings, so
          // the orders that predate trade orders re-vendor to the same items they had before.
          ...(e.section ? { collectedIn: cleanText(e.section) } : {}),
        },
      };
    });

    const placeholderItems = unresolved.map((u) => ({
      at: u.index,
      item: {
        issueId: placeholderId(order.id, u.title, u.sourceKey),
        title: u.title,
        number: parseIssueNumber(u.title),
        url: u.url ?? null,
        seriesId: null,
        seriesName: null,
        onSale: null,
        mu: null,
        digitalId: null,
        cover: null,
        description: null,
        pageCount: null,
        creators: [],
        placeholder: true,
        ...(u.section ? { collectedIn: cleanText(u.section) } : {}),
      },
    }));

    // Reading order is the point of these files, so resolved and unresolved lines are merged
    // back into the sequence they were written in rather than appended in a lump.
    const items = [...issueItems, ...placeholderItems].sort((a, b) => a.at - b.at).map((x) => x.item);

    // How many collected editions the order is divided into. Counted from the items rather
    // than from the headings, because a heading with no issues under it is not a book a reader
    // can read, and the catalog states this number next to the issue count.
    const collections = new Set(items.map((i) => i.collectedIn).filter(Boolean)).size;

    const dupes = new Set();
    const seenIds = new Set();
    for (const it of items) {
      if (seenIds.has(it.issueId)) dupes.add(it.issueId);
      seenIds.add(it.issueId);
    }
    if (dupes.size) {
      console.warn(`  ! ${order.id}: ${dupes.size} duplicate issue id(s) in the order; importing will collapse them: ${[...dupes].join(', ')}`);
    }

    const payload = {
      id: order.id,
      name: order.name,
      description: order.description,
      source: order.sourcePage,
      ...(order.sourceSection ? { sourceSection: order.sourceSection } : {}),
      sourceOrigin: order.sourceOrigin,
      sourceLicense: order.sourceLicense,
      generatedAt,
      apiBase: API,
      count: items.length,
      collections,
      placeholders: placeholderItems.length,
      unresolved,
      items,
    };

    outputs.push({
      path: join(DATA_DIR, order.out),
      content: `${JSON.stringify(payload, null, 2)}\n`,
    });
    summary.push({
      file: order.out,
      count: items.length,
      expected: order.expect ?? items.length,
      placeholders: placeholderItems.length,
      missingDigital,
      missingCover,
    });
    addCatalogOutputs(order, parsedOrder, payload);
  }

  // Lists we did not rebuild still have to appear in the catalog, so their entries are derived
  // from the pinned file already on disk. Omitting them would make --only quietly delete lists.
  for (const order of orders) {
    if (catalogById.has(order.id)) continue;
    const path = join(DATA_DIR, order.out);
    let payload;
    try {
      payload = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      throw new Error(`${order.id} was skipped but has no pinned ${order.out} to reuse (${err.message}); run without --only`, { cause: err });
    }
    const parsedOrder = order.partitionFile
      ? parseChecklist(await loadOrderText(order))
      : null;
    addCatalogOutputs(order, parsedOrder, payload);
  }

  const catalog = orders.flatMap((order) => catalogById.get(order.id));
  const checked = parseCatalog({ lists: catalog });
  if (checked.dropped) throw new Error(`${checked.dropped} catalog entries are not valid; catalog.json not written`);
  const outputGeneratedAt = catalogOnly
    ? catalog.reduce((latest, entry) => (
      entry.updatedAt && entry.updatedAt > latest ? entry.updatedAt : latest
    ), '') || generatedAt
    : generatedAt;
  const generatedPaths = [...families.values()].map((family) => family.path);
  for (const family of families.values()) {
    const peers = [...payloadByCatalogId].map(([id, payload]) => ({ id, payload }));
    const overlap = buildChildOverlapEvidence({ family, peers, generatedAt: outputGeneratedAt });
    outputs.push({
      path: join(SCRIPT_DATA_DIR, family.ledger.overlapFile),
      content: `${JSON.stringify(overlap, null, 2)}\n`,
    });
  }
  outputs.push({
    path: join(DATA_DIR, 'catalog.json'),
    content: `${JSON.stringify({
      generatedAt: outputGeneratedAt,
      lists: catalog,
      paths: [...paths, ...generatedPaths],
    }, null, 2)}\n`,
  });
  const outputPaths = outputs.map((output) => output.path);
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error('Vendor outputs contain duplicate file paths');
  }
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(SCRIPT_DATA_DIR, { recursive: true });
  await writeOutputsAtomically(outputs);

  if (summary.length) console.table(summary);
  const bad = summary.filter((s) => s.count !== s.expected);
  if (bad.length) {
    console.warn('WARNING: counts differ from the plan\u2019s expected values:', bad);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
