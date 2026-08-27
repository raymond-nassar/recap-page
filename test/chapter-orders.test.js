import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildChapterFamily,
  buildChildOverlapEvidence,
  chapterOrdinal,
  digestJson,
  validateChapterLedger,
} from '../scripts/lib/chapter-orders.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { hasMetadata } from '../src/js/lib/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parentId = 'marvel-knights-to-planet-x';
const ledgerPath = path.join(root, 'scripts', 'data', 'marvel-knights-to-planet-x-lists.json');
const overlapPath = path.join(root, 'scripts', 'data', 'marvel-knights-to-planet-x-overlaps.json');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function fixture() {
  const manifestRaw = await readJson('src/data/curated-lists.json');
  const manifest = parseManifest(manifestRaw);
  assert.deepEqual(manifest.errors, []);
  const order = manifest.entries.find((entry) => entry.id === parentId);
  const markdown = await readFile(path.join(root, 'src', 'data', 'orders', order.sourceFile), 'utf8');
  const parsed = parseChecklist(markdown);
  const parentPayload = await readJson(`src/data/${order.out}`);
  const ledger = validateChapterLedger(JSON.parse(await readFile(ledgerPath, 'utf8')));
  const family = buildChapterFamily({
    order,
    parsed,
    parentPayload,
    ledger,
    existingPathIds: manifest.paths.map((entry) => entry.id),
  });
  return {
    manifestRaw, manifest, order, parsed, parentPayload, ledger, family,
  };
}

const clone = (value) => structuredClone(value);

test('the corrected owner ledger pins every chapter field and source position', async () => {
  const {
    parsed, ledger, family,
  } = await fixture();
  assert.equal(ledger.ownerAttachmentSha256, '822e8ee50f7034cc174af11c7bd69ef5eed0f76200d9de2e6f6d07d2a1b69420');
  assert.equal(ledger.sourceVectorSha256, '437d917e2e469bdf33ccc855c4d88366a688758e497cdaea569b8f421465c6c5');
  assert.equal(ledger.issueIdsSha256, '0223bbdca9912019ebe609de5dcdfc6f703682787e6ff59fc7e863bfc52dd00d');
  assert.equal(ledger.chapterContractSha256, '498cdd1fa3183ba9a0d48fa8b85ec4de2bc0f3bf8ca75cb5367782a6a0bc7c35');
  assert.equal(ledger.chapterNamesSha256, '315b0761581e77095e06b08a076f51820521542d77d0c130a230fdf519fbd784');
  assert.equal(ledger.path.stepsSha256, '0c2c3296ee07bd2a7e3a3878efff6af2f12810cdac27319f921ed34f5bec85b7');

  assert.equal(parsed.sourcePositions.length, 99);
  assert.deepEqual(
    ledger.sourceGroups.map((group) => (
      parsed.sourcePositions.filter((position) => position.section === group.name).length
    )),
    [4, 87, 8],
  );
  assert.equal(ledger.chapters.length, 78);
  assert.equal(ledger.chapters.reduce((total, chapter) => total + chapter.ownerBulletCount, 0), 98);
  assert.deepEqual(
    ledger.chapters.flatMap((chapter) => (
      Array.from({ length: chapter.sourceCount }, (_, offset) => chapter.sourceStart + offset)
    )),
    Array.from({ length: 99 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.chapters.map((chapter) => chapter.id),
    Array.from({ length: 78 }, (_, index) => `${parentId}-${String(index + 1).padStart(2, '0')}`),
  );

  assert.equal(ledger.chapters[3].name, 'X-Treme X-Men: Destiny');
  assert.deepEqual(
    ledger.chapters[36],
    {
      id: 'marvel-knights-to-planet-x-37',
      name: 'X-Treme X-Men: X-Pose + Schism',
      sourceStart: 47,
      sourceCount: 3,
      ownerBulletCount: 2,
      issueCount: 7,
      timelineYear: 2002,
      issueIdsSha256: '777b9034deb082102e9db06672cb7aec2b22b4d76f048f7621ec69d55f009055',
    },
  );
  assert.deepEqual(family.children[36].payload.items.map((item) => item.issueId), [
    15021, 43391, 43392, 15023, 15024, 15025, 15026,
  ]);
  assert.equal(ledger.chapters[38].name, 'Truth: Red, White and Black');
  assert.equal(ledger.chapters[76].name, 'X-Treme X-Men: Storm: The Arena');
  assert.ok(ledger.chapters.every((chapter) => !/[\u2011\u2013\u2014]/.test(chapter.name)));
});

test('the generator emits 78 ordinary metadata-complete payloads in exact aggregate order', async () => {
  const { ledger, family, parentPayload } = await fixture();
  const generatedIds = family.children.flatMap(({ payload }) => (
    payload.items.map((item) => item.issueId)
  ));
  assert.deepEqual(generatedIds, parentPayload.items.map((item) => item.issueId));
  assert.equal(new Set(generatedIds).size, 487);
  assert.equal(digestJson(generatedIds), ledger.issueIdsSha256);
  assert.equal(family.children.reduce((total, child) => total + child.payload.count, 0), 487);

  for (const { chapter, order, payload } of family.children) {
    const onDisk = await readJson(`src/data/${order.out}`);
    assert.equal(payload.id, chapter.id);
    assert.equal(order.id, chapter.id);
    assert.equal(payload.count, chapter.issueCount);
    assert.equal(payload.collections, 0);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(digestJson(payload.items.map((item) => item.issueId)), chapter.issueIdsSha256);
    assert.ok(payload.items.every((item) => hasMetadata(item)));
    assert.ok(payload.items.every((item) => !Object.hasOwn(item, 'collectedIn')));
    assert.equal(order.group, null);
    assert.equal(order.groupName, null);
    assert.equal(order.variant, null);
    assert.equal(order.timeline, chapter.timelineYear);
    assert.equal(order.coverIssueId, payload.items[0].issueId);
    assert.deepEqual(onDisk, payload, `${order.out} differs from the generated contract`);
  }

  const years = Object.fromEntries(
    [1998, 1999, 2000, 2001, 2002, 2003, 2004]
      .map((year) => [year, family.children.filter(({ order }) => order.timeline === year).length]),
  );
  assert.deepEqual(years, {
    1998: 1, 1999: 0, 2000: 2, 2001: 16, 2002: 24, 2003: 32, 2004: 3,
  });
});

test('the generated catalog replaces the parent with every child and the owner-order path', async () => {
  const {
    ledger, family, manifestRaw,
  } = await fixture();
  const raw = await readJson('src/data/catalog.json');
  const catalog = parseCatalog(raw);
  const children = catalog.lists.filter((entry) => (
    chapterOrdinal(parentId, ledger.chapterCount, entry.id) !== null
  ));
  assert.equal(manifestRaw.lists.length, 161);
  assert.equal(raw.lists.length, 238);
  assert.equal(catalog.lists.length, 238);
  assert.equal(catalog.lists.some((entry) => entry.id === parentId), false);
  assert.equal(children.length, 78);

  for (const { chapter, order } of family.children) {
    const entry = children.find((candidate) => candidate.id === chapter.id);
    assert.ok(entry, `${chapter.id} is missing from the catalog`);
    assert.equal(entry.file, order.out);
    assert.equal(entry.name, chapter.name);
    assert.equal(entry.count, chapter.issueCount);
    assert.equal(entry.collections, 0);
    assert.equal(entry.timeline, chapter.timelineYear);
    assert.equal(entry.group, null);
  }

  const ownerPath = raw.paths.find((entry) => entry.id === ledger.path.id);
  assert.deepEqual(ownerPath, family.path);
  assert.equal(raw.paths.length, 3);
});

test('the child overlap matrix is current, disjoint and aggregates to the parent peers', async () => {
  const { family } = await fixture();
  const rawCatalog = await readJson('src/data/catalog.json');
  const peers = await Promise.all(rawCatalog.lists.map(async (entry) => ({
    id: entry.id,
    payload: await readJson(`src/data/${entry.file}`),
  })));
  const actual = buildChildOverlapEvidence({
    family,
    peers,
    generatedAt: 'ignored',
  });
  const pinned = JSON.parse(await readFile(overlapPath, 'utf8'));

  for (const field of [
    'pairCount',
    'chapterCountWithOverlap',
    'existingListCount',
    'sharedOccurrenceCount',
    'internalChildOverlapCount',
    'matrixSha256',
    'existingLists',
    'pairs',
  ]) {
    assert.deepEqual(pinned[field], actual[field], `${field} is stale`);
  }
  assert.deepEqual(
    [
      pinned.pairCount,
      pinned.chapterCountWithOverlap,
      pinned.existingListCount,
      pinned.sharedOccurrenceCount,
      pinned.internalChildOverlapCount,
      pinned.matrixSha256,
    ],
    [53, 44, 14, 279, 0, '89f987ace565c82c236a81a33fca18091eeac54cba47963cdd7f7be0e5198561'],
  );
});

test('the generator rejects the smallest ledger and parent-vector mutations', async () => {
  const {
    order, parsed, parentPayload, ledger, manifest,
  } = await fixture();
  const build = (nextLedger = ledger, nextPayload = parentPayload) => buildChapterFamily({
    order,
    parsed,
    parentPayload: nextPayload,
    ledger: nextLedger,
    existingPathIds: manifest.paths.map((entry) => entry.id),
  });

  const gap = clone(ledger);
  gap.chapters[1].sourceStart += 1;
  assert.throws(() => build(gap), /does not continue the source-position vector/);

  const wrongTitle = clone(ledger);
  wrongTitle.chapters[3].name = 'X-Treme X-Men Launch';
  assert.throws(() => build(wrongTitle), /Chapter contract digest is stale/);

  const wrongPath = clone(ledger);
  wrongPath.path.stepsSha256 = '0'.repeat(64);
  assert.throws(() => build(wrongPath), /path steps digest is stale/i);

  const duplicate = clone(parentPayload);
  duplicate.items[1] = clone(duplicate.items[0]);
  assert.throws(() => build(ledger, duplicate), /duplicate issue ids/);

  const swapped = clone(parentPayload);
  [swapped.items[0], swapped.items[1]] = [swapped.items[1], swapped.items[0]];
  assert.throws(() => build(ledger, swapped), /issue vector digest is stale/);

  const wrongYear = clone(parentPayload);
  wrongYear.items[0].onSale = '1999-11-01T00:00:00+0000';
  assert.throws(() => build(ledger, wrongYear), /timeline year differs from its first issue/);

  assert.throws(
    () => buildChapterFamily({
      order,
      parsed,
      parentPayload,
      ledger,
      existingPathIds: [...manifest.paths.map((entry) => entry.id), ledger.path.id],
    }),
    /duplicates an existing path/,
  );
});

test('the overlap digest notices one removed peer issue', async () => {
  const { family } = await fixture();
  const first = family.children[0].payload.items[0];
  const peers = [{
    id: 'peer',
    payload: { items: [first] },
  }];
  const before = buildChildOverlapEvidence({ family, peers, generatedAt: 'before' });
  peers[0].payload.items = [];
  const after = buildChildOverlapEvidence({ family, peers, generatedAt: 'after' });
  assert.notEqual(before.matrixSha256, after.matrixSha256);
  assert.equal(before.pairCount, 1);
  assert.equal(after.pairCount, 0);
});
