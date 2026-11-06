import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { cleanText } from '../scripts/vendor-orders.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { parseCatalog, catalogListShelf } from '../src/js/lib/catalog.js';
import {
  addIssuesToList, createEmptyState, createList, listItems, markRead, normalizeCover, setIssueNote,
} from '../src/js/lib/model.js';
import {
  beforeAmazingSpiderManSupplementCatalogEntry, beforeAmazingSpiderManSupplementEntry,
  beforeAmazingSpiderManSupplementPayloadText,
} from './helpers/amazing-spider-man-history.mjs';

const root = new URL('../', import.meta.url);
const json = (file) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
const orderId = 'amazing-spider-man-reading-order-modern-marvel-era';
const payload = json('src/data/amazing_spider_man_reading_order_modern_marvel_era.json');
const catalog = parseCatalog(json('src/data/catalog.json'));
const manifest = json('src/data/curated-lists.json');
const ledger = json('scripts/data/owner-selections/amazing-spider-man-early-supplement.json');
const baseline = json('test/fixtures/amazing-spider-man-before-supplement.json');
const source = readFileSync(new URL(`src/data/orders/${orderId}.md`, root), 'utf8');

const spectacularIds = [
  14542, 14653, 14728, 14739, 14750, 14761, 14772, 14783, 14794, 14543,
  14554, 14565, 14576, 14587, 14598, 14609, 14620, 14631, 14642, 14654,
  14665, 14676, 14687, 14698, 14709, 14720, 14725, 14726, 14727, 14729,
  14730, 14731, 14732, 14733, 14734, 14735, 14736, 14737, 14738, 14740,
  14741, 14742, 14743, 14744, 14745, 14746, 14747, 14748, 14749, 14751,
  14752, 14753, 14754, 14755, 14756, 14757, 14758, 14759, 14760, 14762,
  14763, 14764, 14765, 14766, 14767, 14768, 14769, 14770, 14771, 14773,
  14774, 14775, 14776, 14777, 14778, 14779, 14780, 14781, 14782, 14784,
  14785, 14786, 14787, 14788, 14789, 14790, 14791, 14792, 14793,
];
const teamUpIds = [
  19575, 19637, 19648, 19659, 19670, 19681, 19692,
  19703, 19714, 19576, 19587, 19598, 19609, 19620,
];
const addedIds = new Set([...spectacularIds, ...teamUpIds]);
const originalItems = payload.items.filter((item) => !addedIds.has(item.issueId));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const itemIndex = (id) => payload.items.findIndex((item) => item.issueId === id);
const amazingIndex = (number) => payload.items.findIndex((item) => (
  item.seriesId === 1987 && item.number === String(number)
));

test('the owner-selected Spider-Man issues retain every exact identity and prior item', () => {
  assert.equal(addedIds.size, 103);
  assert.deepEqual(
    payload.items.filter((item) => addedIds.has(item.issueId)).map((item) => item.issueId),
    [...teamUpIds, ...spectacularIds],
  );
  assert.equal(payload.count, 2144);
  assert.equal(payload.items.length, 2144);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 2144);
  assert.equal(originalItems.length, 2041);
  assert.equal(digest(originalItems), 'a492af64a1063b79a2f63f50be0d070c22e2882c3fdbc3661634b7bf1fdadb2a');

  for (const [ids, seriesId] of [[spectacularIds, 2271], [teamUpIds, 3716]]) {
    ids.forEach((issueId, index) => {
      const item = payload.items.find((candidate) => candidate.issueId === issueId);
      assert.equal(item.seriesId, seriesId, `series for issue ${issueId}`);
      assert.equal(item.number, String(index + 1), `number for issue ${issueId}`);
      assert.match(item.url, new RegExp(`^https://www\\.marvel\\.com/comics/issue/${issueId}(?:/|$)`));
      assert.equal(item.description, null);
      assert.notEqual(item.placeholder, true);
      assert.ok(Number.isInteger(item.digitalId) && item.digitalId > 0, `reader ID for issue ${issueId}`);
    });
  }
});

test('supplemental issues sit alongside the flagship issues from the same publication month', () => {
  const teamUpAmazingNumbers = [106, 108, 110, 112, 114, 116, 118, 119, 120, 121, 122, 123, 124, 125];
  teamUpIds.forEach((issueId, index) => {
    const position = itemIndex(issueId);
    const number = teamUpAmazingNumbers[index];
    assert.ok(amazingIndex(number) < position && position < amazingIndex(number + 1), `Marvel Team-Up #${index + 1}`);
    assert.equal(payload.items[position].onSale.slice(0, 7), payload.items[amazingIndex(number)].onSale.slice(0, 7));
  });
  spectacularIds.forEach((issueId, index) => {
    const position = itemIndex(issueId);
    const number = index + 163;
    const preceding = amazingIndex(Math.min(number, 241));
    const following = amazingIndex(number < 241 ? number + 1 : 252);
    assert.ok(preceding < position && position < following, `Spectacular Spider-Man #${index + 1}`);
    if (number <= 241) {
      assert.equal(payload.items[position].onSale.slice(0, 7), payload.items[preceding].onSale.slice(0, 7));
    }
  });
});

test('checklist, catalog and preserved gaps describe the revised Spider-Man guide', () => {
  const parsed = parseChecklist(source);
  const parsedItems = [...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.issueId ?? placeholderId(orderId, item.title, item.sourceKey));
  assert.deepEqual(parsedItems, payload.items.map((item) => item.issueId));
  assert.equal(payload.placeholders, 7);
  assert.deepEqual(payload.unresolved.map((item) => item.index), [408, 410, 411, 492, 537, 1547, 1548]);
  const catalogEntry = catalog.lists.find((entry) => entry.id === orderId);
  const manifestEntry = manifest.lists.find((entry) => entry.id === orderId);
  assert.deepEqual(
    [manifestEntry.expect, catalogEntry.count, catalogEntry.placeholderCount, catalogEntry.emptyRecordCount],
    [2144, 2144, 7, 25],
  );
  assert.equal(catalogListShelf(catalog.lists, orderId), 'spotlights');
  assert.match(payload.sourceOrigin, /Comic Book Herald.*owner-selected additions/i);
  assert.equal(catalogEntry.sourceOrigin, payload.sourceOrigin);
  assert.equal(manifestEntry.sourceOrigin, payload.sourceOrigin);
  assert.equal(payload.sourceLicense, null);
});

test('the expanded guide records the Far From Home companion as a complete subset', () => {
  const companion = manifest.lists.find((entry) => entry.id === 'spider-man-far-from-home');
  const companionIds = json(`src/data/${companion.out}`).items.map((item) => item.issueId);
  const oldIds = new Set(originalItems.map((item) => item.issueId));
  const currentIds = new Set(payload.items.map((item) => item.issueId));
  assert.equal(companionIds.length, 8);
  assert.equal(companionIds.filter((id) => oldIds.has(id)).length, 6);
  assert.ok(companionIds.every((id) => currentIds.has(id)));
  assert.ok(catalog.lists.find((entry) => entry.id === orderId).contains.includes(companion.id));
});

test('the supplement retains the supplied URLs, publication evidence and exact insertion positions', () => {
  const parsed = parseChecklist(source);
  const entries = new Map(parsed.entries.map((entry) => [entry.issueId, entry]));
  assert.deepEqual(ledger.rows.map((row) => row.issueId), [...spectacularIds, ...teamUpIds]);
  assert.deepEqual(ledger.rows.map((row) => row.requestPosition), Array.from({ length: 103 }, (_, index) => index + 1));
  assert.equal(ledger.rows.filter((row) => row.metadata.kind === 'provider-response').length, 67);
  assert.equal(ledger.rows.filter((row) => row.metadata.kind === 'pinned-payload').length, 36);
  assert.equal(ledger.publicationIndexes.length, 11);

  for (const row of ledger.rows) {
    const item = payload.items[row.guidePosition - 1];
    assert.equal(item.issueId, row.issueId);
    assert.equal(payload.items[row.guidePosition - 2].issueId, row.placementAfterIssueId);
    assert.equal(item.onSale.slice(0, 7), row.publicationMonth);
    assert.equal(row.requestedUrl, `https://www.marvel.com/comics/issue/${row.issueId}/`);
    assert.equal(entries.get(row.issueId).url, row.requestedUrl);
    assert.equal(row.publicationIndex, `https://spiderfan.org/year/comics/${row.publicationMonth.slice(0, 4)}.html`);
    assert.ok(ledger.publicationIndexes.includes(row.publicationIndex));
    if (row.metadata.kind === 'provider-response') {
      assert.equal(row.metadata.url, `https://marvel.emreparker.com/v1/issues/${row.issueId}`);
      assert.match(row.metadata.bodySha256, /^[a-f0-9]{64}$/);
      assert.ok(!Number.isNaN(Date.parse(row.metadata.retrievedAt)));
    }
  }
  assert.equal(ledger.rows.find((row) => row.issueId === 14742).metadata.kind, 'provider-response');
  assert.equal(payload.items.find((item) => item.issueId === 14742).digitalId, 6680);
});

test('provider-backed additions retain the recorded factual metadata and reader IDs', () => {
  const rows = ledger.rows.filter((row) => row.metadata.kind === 'provider-response');
  assert.equal(rows.length, 67);
  for (const row of rows) {
    const projection = row.metadata.providerProjection;
    assert.ok(projection, `Missing provider projection for ${row.issueId}.`);
    assert.deepEqual(Object.keys(projection).sort(), [
      'cover', 'creators', 'detailUrl', 'digitalId', 'id', 'issueNumber', 'onSaleDate',
      'pageCount', 'seriesId', 'seriesName', 'title', 'unlimitedDate',
    ]);
    const item = payload.items[row.guidePosition - 1];
    assert.deepEqual({
      issueId: item.issueId, title: item.title, number: item.number, url: item.url,
      seriesId: item.seriesId, seriesName: item.seriesName, onSale: item.onSale, mu: item.mu,
      digitalId: item.digitalId, cover: item.cover, pageCount: item.pageCount, creators: item.creators,
    }, {
      issueId: projection.id, title: cleanText(projection.title), number: String(projection.issueNumber),
      url: projection.detailUrl, seriesId: projection.seriesId,
      seriesName: projection.seriesName == null ? null : cleanText(projection.seriesName),
      onSale: projection.onSaleDate, mu: projection.unlimitedDate, digitalId: projection.digitalId,
      cover: normalizeCover(projection.cover), pageCount: projection.pageCount,
      creators: projection.creators.filter(({ role }) => /writer|penciler|artist/i.test(role ?? ''))
        .map(({ name, role }) => ({ name, role })),
    }, `Published metadata for ${row.issueId} must match its recorded provider response.`);
  }
});

test('reused issue facts and the historical review baseline come from the recorded commit', () => {
  const files = new Map();
  const atBaseline = (file) => {
    if (!files.has(file)) {
      files.set(file, execFileSync('git', ['show', `${baseline.sourceCommit}:${file}`], {
        cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      }));
    }
    return files.get(file);
  };
  const previous = JSON.parse(atBaseline(ledger.originalGuide.payloadFile));
  assert.equal(createHash('sha256').update(atBaseline(ledger.originalGuide.payloadFile)).digest('hex'),
    baseline.payloadSha256);
  assert.deepEqual(previous.items.map((item) => String(item.issueId)), baseline.issueIds);
  assert.deepEqual(
    JSON.parse(atBaseline('src/data/curated-lists.json')).lists.find((entry) => entry.id === orderId),
    baseline.manifestEntry,
  );
  assert.deepEqual(
    JSON.parse(atBaseline('src/data/catalog.json')).lists.find((entry) => entry.id === orderId),
    baseline.catalogEntry,
  );
  assert.deepEqual(JSON.parse(beforeAmazingSpiderManSupplementPayloadText(JSON.stringify(payload))), previous);

  const fields = ['issueId', 'title', 'number', 'url', 'seriesId', 'seriesName', 'onSale', 'mu',
    'digitalId', 'cover', 'description', 'pageCount', 'creators'];
  for (const row of ledger.rows.filter((entry) => entry.metadata.kind === 'pinned-payload')) {
    assert.equal(row.metadata.sourceCommit, baseline.sourceCommit);
    const text = atBaseline(row.metadata.file);
    assert.equal(createHash('sha256').update(text).digest('hex'), row.metadata.fileSha256);
    const prior = JSON.parse(text).items.find((item) => item.issueId === row.issueId);
    const current = payload.items[row.guidePosition - 1];
    assert.ok(prior);
    assert.deepEqual(Object.fromEntries(fields.map((field) => [field, current[field]])),
      Object.fromEntries(fields.map((field) => [field, prior[field]])));
  }
});

test('historical reconstruction rejects an unrecorded description', () => {
  const entry = manifest.lists.find((item) => item.id === orderId);
  const priorDescription = json('scripts/data/description-revisions.json').entries
    .find((item) => item.id === orderId).before;
  assert.equal(beforeAmazingSpiderManSupplementEntry({ ...entry, description: priorDescription }).description,
    priorDescription);
  assert.throws(() => beforeAmazingSpiderManSupplementEntry({ ...entry, description: 'Unrecorded edit.' }));
});

test('historical reconstruction rejects unrelated catalog changes', () => {
  const currentCatalog = json('src/data/catalog.json').lists.find((item) => item.id === orderId);
  assert.throws(() => beforeAmazingSpiderManSupplementCatalogEntry({
    ...currentCatalog,
    sourceLicense: 'MIT',
  }));
});

test('historical catalog descriptors preserve only the matching output filename', () => {
  const entry = json('src/data/catalog.json').lists.find((item) => item.id === orderId);
  const result = beforeAmazingSpiderManSupplementCatalogEntry({ ...entry, out: entry.file });
  assert.equal(result.out, entry.file);
  assert.throws(() => beforeAmazingSpiderManSupplementCatalogEntry({ ...entry, out: 'another.json' }));
});

test('historical reconstruction permits later derived catalog relationships', () => {
  const currentCatalog = json('src/data/catalog.json').lists.find((item) => item.id === orderId);
  const result = beforeAmazingSpiderManSupplementCatalogEntry({
    ...currentCatalog,
    contains: [...currentCatalog.contains, 'later-guide'],
  });
  assert.deepEqual(result.contains, baseline.catalogEntry.contains);
});

test('the revised guide preserves an existing list and global notes and progress', () => {
  let state = createList(createEmptyState(), {
    id: 'existing', name: payload.name, catalogId: orderId,
    itemIds: originalItems.map((item) => item.issueId),
  });
  state = addIssuesToList(state, 'existing', originalItems).state;
  state = createList(state, { id: 'other', name: 'Another reading list' });
  const addedIssue = payload.items.find((item) => item.issueId === spectacularIds[0]);
  assert.ok(addedIssue);
  state = addIssuesToList(state, 'other', [addedIssue]).state;
  state = markRead(state, originalItems[0].issueId, true, 123456);
  state = markRead(state, addedIssue.issueId, true, 123457);
  state = setIssueNote(state, originalItems[0].issueId, 'Keep my place');
  state = setIssueNote(state, addedIssue.issueId, 'Already read');
  const saved = structuredClone(state.lists.existing);
  const read = structuredClone(state.read);

  state = createList(state, { id: 'candidate', name: payload.name, catalogId: orderId });
  state = addIssuesToList(state, 'candidate', payload.items).state;
  assert.deepEqual(state.lists.existing, saved);
  assert.deepEqual(state.read, read);
  assert.equal(state.notes[originalItems[0].issueId], 'Keep my place');
  assert.equal(state.notes[addedIssue.issueId], 'Already read');
  assert.equal(listItems(state, 'existing').length, 2041);
  assert.equal(listItems(state, 'candidate').length, 2144);
});
