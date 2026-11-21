import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  applyListRevision, compareListOrders, matchesEarlierPublishedOrder, publishedRevisionItems, revisedOrderKeepingExtras,
} from '../src/js/lib/listCorrection.js';
import {
  addIssuesToList, createEmptyState, createList, isDeferred, issueNote, issueRating, listProgress,
  markRead, setDeferred, setIssueNote, setIssueRating, setListNote, setOverride,
} from '../src/js/lib/model.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';
import { legacyReadingOrder } from '../src/js/lib/legacyReadingOrders.js';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { beforeWolverineCorrectionIssueIds, firstReleasedWolverineIssueOrders } from './helpers/wolverine-correction-history.mjs';

test('a list update comparison preserves the identity and order of each side', () => {
  const saved = [1, 7, 2, 9];
  const revised = [2, 3, 1, 4];
  assert.deepEqual(compareListOrders(saved, revised), {
    added: [3, 4],
    retained: [7, 9],
    reordered: true,
  });
  assert.deepEqual(saved, [1, 7, 2, 9]);
  assert.deepEqual(revised, [2, 3, 1, 4]);
  assert.deepEqual(compareListOrders([1, 2], [1, 3, 2]), {
    added: [3], retained: [], reordered: false,
  });
  assert.deepEqual(compareListOrders([1, 2], [1, 2]), {
    added: [], retained: [], reordered: false,
  });
});

test('a list update comparison refuses invalid or duplicate identities', () => {
  for (const [saved, revised] of [
    [[1, 1], [1]],
    [[1], [1, 1]],
    [[0], [1]],
    [[1], [Number.MAX_SAFE_INTEGER + 1]],
    [[1], []],
    [null, [1]],
  ]) {
    assert.throws(() => compareListOrders(saved, revised), /identity|order/i);
  }
});

test('updating follows the new order without dropping saved comics and is repeatable', () => {
  const saved = [1, 7, 2, 9];
  const revised = [2, 3, 1, 4];
  const updated = revisedOrderKeepingExtras(saved, revised);
  assert.deepEqual(updated, [7, 2, 3, 1, 4, 9]);
  assert.deepEqual(revisedOrderKeepingExtras(updated, revised), updated);
  assert.deepEqual(revisedOrderKeepingExtras([8, 9], [1, 2]), [1, 2, 8, 9]);
  assert.deepEqual(revisedOrderKeepingExtras([], [1]), [1]);
  const many = Array.from({ length: 130000 }, (_, index) => index + 2);
  const large = revisedOrderKeepingExtras([...many, 1], [1, 200000]);
  assert.equal(large.length, 130002);
  assert.deepEqual(large.slice(0, 3), [2, 3, 4]);
  assert.deepEqual(large.slice(-3), [130001, 1, 200000]);
});

test('a revision retains list and comic data by identity and rejects a stale review', () => {
  let state = createList(createEmptyState(), { id: '__proto__', name: 'Kept', catalogId: 'example' });
  state = addIssuesToList(state, '__proto__', [
    { issueId: 1, title: 'Saved one', collectedIn: 'Book' },
    { issueId: 7, title: 'Retired' },
    { issueId: 2, title: 'Saved two' },
  ]).state;
  state = markRead(state, 7, true, 123);
  state = setIssueNote(state, 7, 'Remember');
  state = setIssueRating(state, 7, 4.5);
  state = setOverride(state, 7, 'unavailable');
  state = setDeferred(state, '__proto__', 7);
  state = setListNote(state, '__proto__', 'My list note');
  const expected = JSON.stringify(state.lists.__proto__);
  const revision = [
    { issueId: 2, title: 'Different metadata' },
    { issueId: 3, title: 'New', collectedIn: 'New book' },
    { issueId: 1, title: 'Also different' },
  ];
  const updated = applyListRevision(state, '__proto__', expected, revision);
  assert.deepEqual(updated.lists.__proto__.itemIds, [7, 2, 3, 1]);
  assert.equal(Object.getPrototypeOf(updated.lists), null);
  assert.equal(updated.lists.__proto__.note, 'My list note');
  assert.deepEqual(updated.lists.__proto__.collectedIn, { 1: 'Book', 3: 'New book' });
  assert.deepEqual(updated.lists.__proto__.deferredIssueIds, [7]);
  assert.deepEqual(updated.issues[1], state.issues[1]);
  assert.deepEqual(updated.issues[2], state.issues[2]);
  assert.equal(updated.issues[3].title, 'New');
  for (const key of ['read', 'notes', 'ratings', 'overrides']) assert.deepEqual(updated[key], state[key]);
  assert.equal(updated.read[7], 123);
  assert.equal(applyListRevision(updated, '__proto__', JSON.stringify(updated.lists.__proto__), revision), updated);
  assert.throws(() => applyListRevision(updated, '__proto__', expected, revision), /changed/i);
  assert.throws(() => applyListRevision(state, 'missing', expected, revision), /changed/i);
  const withoutTitle = applyListRevision(state, '__proto__', expected, [{ issueId: 5 }]);
  assert.equal(withoutTitle.issues[5].title, 'Issue 5');
});

test('the Wolverine revision comparison uses identities, including reordered shared comics', () => {
  const payload = JSON.parse(readFileSync(new URL('../src/data/wolverine_reading_order.json', import.meta.url)));
  const revised = payload.items.map(({ issueId }) => issueId);
  const saved = beforeWolverineCorrectionIssueIds(revised).map(Number);
  const diff = compareListOrders(saved, revised);
  assert.equal(diff.added.length, 69);
  assert.equal(diff.retained.length, 4);
  assert.equal(diff.reordered, true);
  assert.deepEqual(compareListOrders(revised, revised), { added: [], retained: [], reordered: false });
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: saved }), true);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: null, itemIds: saved }), true);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: revised }), false);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: saved.slice(1) }), false);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'another-list', itemIds: saved }), false);
  assert.equal(publishedRevisionItems({ id: payload.id }, payload), payload.items);
  assert.throws(() => publishedRevisionItems({ id: payload.id }, { ...payload, items: saved.map((issueId) => ({ issueId })), count: saved.length }), /not available/);
  assert.throws(() => publishedRevisionItems({ id: 'another-list' }, payload), /verified/);
  assert.throws(() => publishedRevisionItems({ id: payload.id }, { ...payload, count: 1 }), /verified/);
});

test('updating the actual earlier Wolverine list retains retired comics and their data', () => {
  const payload = JSON.parse(readFileSync(new URL('../src/data/wolverine_reading_order.json', import.meta.url)));
  const revised = payload.items.map(({ issueId }) => issueId);
  const saved = beforeWolverineCorrectionIssueIds(revised).map(Number);
  const current = new Map(payload.items.map((item) => [item.issueId, item]));
  const retired = saved.filter((id) => !current.has(id));
  let state = createList(createEmptyState(), { id: 'wolverine', name: 'Wolverine', catalogId: payload.id });
  state = addIssuesToList(state, 'wolverine', saved.map((issueId) => current.get(issueId) ?? { issueId })).state;
  state = markRead(state, retired[0], true, 123);
  state = setIssueNote(state, retired[0], 'My note');
  state = setOverride(state, retired[0], 'unavailable');
  state = setDeferred(state, 'wolverine', retired[0]);
  const updated = applyListRevision(state, 'wolverine', JSON.stringify(state.lists.wolverine), payload.items);
  assert.equal(updated.lists.wolverine.itemIds.length, 1276);
  assert.deepEqual(updated.lists.wolverine.itemIds.filter((id) => current.has(id)), revised);
  assert.ok(retired.every((id) => updated.lists.wolverine.itemIds.includes(id)));
  assert.equal(updated.read[retired[0]], 123);
  assert.equal(updated.notes[retired[0]], 'My note');
  assert.equal(updated.overrides[retired[0]], 'unavailable');
  assert.ok(updated.lists.wolverine.deferredIssueIds.includes(retired[0]));
});

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));

test('legacy X-Men identities resolve to unchanged payloads with the approved live credit', () => {
  for (const [id, file, hash] of [
    ['xmen-claremont', 'xmen_claremont.json', 'dc7031e2bd534e1d2dc3d09d173ac35c8267f654eecd8d46616b911f10aed5c2'],
    ['xmen-claremont-complete', 'xmen_claremont_complete.json', 'bf85935acdcf1f10f91e318164ca1f41b8f2deea05e56d9b742b9a5e141fd250'],
  ]) {
    const entry = legacyReadingOrder(id);
    const text = readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const payload = JSON.parse(text);
    assert.equal(createHash('sha256').update(text).digest('hex'), hash);
    assert.equal(entry.file, file);
    for (const key of ['id', 'name']) {
      assert.equal(entry[key], payload[key], `${id}: ${key}`);
    }
    assert.equal(entry.source, 'https://www.comicbookherald.com/chris-claremont-era-x-men-reading-order-guide/');
    assert.equal(entry.sourceOrigin, "Based on a reader's outline and Comic Book Herald's guide");
    assert.equal(entry.sourceLicense, null);
  }
  assert.equal(legacyReadingOrder('__proto__'), null);
});

for (const [guideId, title] of [
  ['xmen-silver-age', 'X-Men Annual (1970) #2'],
  ['xmen-claremont-era', 'Power Pack (1984) #27'],
  ['xmen-claremont-era', 'Power Pack (1984) #28'],
]) {
  test(`new X-Men guides share the Expanded comic record for ${title}`, () => {
    const expanded = readJson('../src/data/xmen_claremont_complete.json');
    const core = readJson('../src/data/xmen_claremont.json');
    const old = expanded.items.find((item) => item.title === title);
    const coreItems = core.items.filter((item) => item.title.startsWith('Power Pack (1984) #'));
    assert.ok(old?.placeholder);
    assert.equal(coreItems.length, 2);
    const newId = placeholderId(guideId, title);
    assert.equal(newId, old.issueId, title);
    assert.notEqual(placeholderId(guideId, title, 'other-occurrence'), old.issueId);
    assert.notEqual(placeholderId('unrelated-guide', title), old.issueId);

    let state = createList(createEmptyState(), { id: 'expanded', name: 'Expanded' });
    state = createList(state, { id: 'core', name: 'Core' });
    state = addIssuesToList(state, 'expanded', [old]).state;
    state = addIssuesToList(state, 'core', coreItems).state;
    for (const [index, item] of coreItems.entries()) {
      assert.equal(placeholderId(core.id, item.title), item.issueId);
      assert.notEqual(item.issueId, old.issueId);
      state = markRead(state, item.issueId, true, 100 + index);
      state = setIssueNote(state, item.issueId, `Core ${index}`);
      state = setIssueRating(state, item.issueId, 2 + index);
      state = setOverride(state, item.issueId, 'unavailable');
      state = setDeferred(state, 'core', item.issueId);
    }
    state = markRead(state, old.issueId, true, 200);
    state = setIssueNote(state, old.issueId, 'Expanded note');
    state = setIssueRating(state, old.issueId, 3);
    state = setOverride(state, old.issueId, 'unavailable');
    state = setDeferred(state, 'expanded', old.issueId);
    const before = {
      expandedList: JSON.stringify(state.lists.expanded),
      coreList: JSON.stringify(state.lists.core),
      comic: JSON.stringify(state.issues[old.issueId]),
      read: JSON.stringify(state.read),
      notes: JSON.stringify(state.notes),
      ratings: JSON.stringify(state.ratings),
      overrides: JSON.stringify(state.overrides),
    };

    state = createList(state, { id: 'new', name: 'New', catalogId: guideId });
    state = addIssuesToList(state, 'new', [{
      ...old, issueId: newId,
      ...(guideId === 'xmen-silver-age' ? { collectedIn: 'Optional guest appearances and annuals' } : {}),
    }]).state;
    assert.equal(JSON.stringify(state.lists.expanded), before.expandedList);
    assert.equal(JSON.stringify(state.lists.core), before.coreList);
    assert.equal(JSON.stringify(state.issues[old.issueId]), before.comic);
    for (const key of ['read', 'notes', 'ratings', 'overrides']) {
      assert.equal(JSON.stringify(state[key]), before[key]);
    }
    assert.deepEqual(listProgress(state, 'new'), { read: 1, total: 1 });
    assert.equal(issueNote(state, newId), 'Expanded note');
    assert.equal(issueRating(state, newId), 3);
    assert.equal(state.overrides[newId], 'unavailable');
    assert.equal(isDeferred(state, 'expanded', old.issueId), true);
    assert.equal(isDeferred(state, 'new', newId), false);

    state = markRead(state, newId, false);
    state = setIssueNote(state, newId, 'New note');
    state = setIssueRating(state, newId, 4.5);
    state = setOverride(state, newId, 'available');
    state = setDeferred(state, 'new', newId);
    assert.deepEqual(listProgress(state, 'expanded'), { read: 0, total: 1 });
    assert.equal(issueNote(state, old.issueId), 'New note');
    assert.equal(issueRating(state, old.issueId), 4.5);
    assert.equal(state.overrides[old.issueId], 'available');
    state = setDeferred(state, 'expanded', old.issueId, false);
    assert.equal(isDeferred(state, 'new', newId), true);
    assert.equal(isDeferred(state, 'expanded', old.issueId), false);
    state = setDeferred(state, 'new', newId, false);
    state = setDeferred(state, 'expanded', old.issueId);
    assert.equal(isDeferred(state, 'new', newId), false);
    assert.equal(isDeferred(state, 'expanded', old.issueId), true);

    state = markRead(state, old.issueId, true, 300);
    state = setIssueNote(state, old.issueId, 'Changed in Expanded');
    state = setIssueRating(state, old.issueId, 1.5);
    state = setOverride(state, old.issueId, 'unavailable');
    assert.deepEqual(listProgress(state, 'new'), { read: 1, total: 1 });
    assert.equal(issueNote(state, newId), 'Changed in Expanded');
    assert.equal(issueRating(state, newId), 1.5);
    assert.equal(state.overrides[newId], 'unavailable');
    assert.equal(isDeferred(state, 'new', newId), false);
    assert.equal(JSON.stringify(state.lists.core), before.coreList);
    for (const [index, item] of coreItems.entries()) {
      assert.equal(state.read[item.issueId], 100 + index);
      assert.equal(issueNote(state, item.issueId), `Core ${index}`);
      assert.equal(issueRating(state, item.issueId), 2 + index);
      assert.equal(state.overrides[item.issueId], 'unavailable');
      assert.equal(isDeferred(state, 'core', item.issueId), true);
    }
    for (const item of coreItems) {
      state = markRead(state, item.issueId, false);
      state = setIssueNote(state, item.issueId, 'Changed in Core');
      state = setIssueRating(state, item.issueId, 5);
      state = setOverride(state, item.issueId, 'available');
      assert.deepEqual(listProgress(state, 'new'), { read: 1, total: 1 });
      assert.equal(issueNote(state, newId), 'Changed in Expanded');
      assert.equal(issueRating(state, newId), 1.5);
      assert.equal(state.overrides[newId], 'unavailable');
    }
  });
}

test('new X-Men guides do not reuse other Expanded placeholder identities', () => {
  const expanded = readJson('../src/data/xmen_claremont_complete.json');
  assert.notEqual(placeholderId('xmen-silver-age', 'Power Pack (1984) #27'),
    expanded.items.find((item) => item.title === 'Power Pack (1984) #27').issueId);
  assert.notEqual(placeholderId('xmen-claremont-era', 'X-Men Annual (1970) #2'),
    expanded.items.find((item) => item.title === 'X-Men Annual (1970) #2').issueId);
});

// The earlier orders are rebuilt from the ledgers each correction committed, so a registry entry
// that drifts from what was actually published before fails here rather than offering nothing.
const ledgerEarlierOrders = {
  'thor-best-of': (revised) => {
    const ledger = readJson('../scripts/data/thor-celestial-correction.json');
    const start = ledger.replacements[0].sourcePosition - 1;
    assert.deepEqual(revised.slice(start, start + ledger.replacements.length), ledger.replacements.map(({ issueId }) => issueId));
    return [
      ...revised.slice(0, start),
      ...ledger.removed.map(({ issueId }) => issueId),
      ...revised.slice(start + ledger.replacements.length),
    ];
  },
  'xmen-claremont': (revised) => {
    const ledger = readJson('../scripts/data/curated-source-ledgers/xmen-claremont-first-class.json');
    assert.deepEqual(revised.slice(0, ledger.added.length), ledger.added.map(({ issueId }) => issueId));
    const retained = revised.slice(ledger.added.length);
    assert.equal(retained.length, ledger.retained.count);
    assert.equal(retained[0], ledger.retained.firstIssueId);
    return [...ledger.removed.map(({ issueId }) => issueId), ...retained];
  },
  // The upstream checklist kept each series together, with Avengers #34.1 and #34.2 after #44,
  // so regrouping the interleaved block by series rebuilds the order readers saved before.
  'hickman-full': (revised) => {
    const byId = new Map(readJson('../src/data/hickman_full.json').items.map((item) => [item.issueId, item]));
    const series = ['Avengers (2012)', 'New Avengers (2013)', 'Infinity (2013)'];
    const block = revised.slice(124, 209);
    const key = (id) => {
      const [, name, number] = byId.get(id).title.match(/^(.+) #(\S+)$/);
      return [series.indexOf(name), Number.isInteger(Number(number)) ? 0 : 1, Number(number)];
    };
    assert.ok(block.every((id) => key(id)[0] >= 0));
    const regrouped = [...block].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    return [...revised.slice(0, 124), ...regrouped, ...revised.slice(209)];
  },
};

test('each registered revision records the published order before it and the order published now', () => {
  const catalog = readJson('../src/data/catalog.json');
  assert.deepEqual(READING_ORDER_REVISIONS.map(({ catalogId }) => catalogId).sort(),
    ['hickman-full', 'thor-best-of', 'wolverine-reading-order', 'xmen-claremont']);
  for (const { catalogId, previousOrders, revisedOrder } of READING_ORDER_REVISIONS) {
    const entry = (catalog.lists ?? catalog).find(({ id }) => id === catalogId) ?? legacyReadingOrder(catalogId);
    const payload = readJson(`../src/data/${entry.file}`);
    const revised = payload.items.map(({ issueId }) => issueId);
    assert.deepEqual(revisedOrder, revised, catalogId);
    const earlier = catalogId === 'wolverine-reading-order'
      ? beforeWolverineCorrectionIssueIds(revised).map(Number) : ledgerEarlierOrders[catalogId](revised);
    assert.deepEqual(previousOrders, catalogId === 'wolverine-reading-order'
      ? [earlier, ...firstReleasedWolverineIssueOrders()] : [earlier], catalogId);
    assert.equal(matchesEarlierPublishedOrder({ catalogId, itemIds: earlier }), true, catalogId);
    assert.equal(matchesEarlierPublishedOrder({ catalogId, itemIds: revised }), false, catalogId);
    assert.equal(publishedRevisionItems({ id: catalogId }, payload), payload.items, catalogId);
  }
});

test('updating the first released Wolverine order adds 83 comics and retains all 33 extras with progress', () => {
  const payload = readJson('../src/data/wolverine_reading_order.json');
  const current = new Map(payload.items.map((item) => [item.issueId, item]));
  for (const saved of firstReleasedWolverineIssueOrders()) {
    assert.equal(saved.length, 1222);
    assert.equal(matchesEarlierPublishedOrder({ catalogId: payload.id, itemIds: saved }), true);
    const difference = compareListOrders(saved, [...current.keys()]);
    assert.equal(difference.added.length, 83);
    assert.equal(difference.retained.length, 33);
    let state = createList(createEmptyState(), { id: 'first', name: 'First release', catalogId: payload.id });
    state = addIssuesToList(state, 'first', saved.map((issueId) => current.get(issueId) ?? { issueId })).state;
    state = markRead(state, difference.retained[0], true, 123);
    const updated = applyListRevision(state, 'first', JSON.stringify(state.lists.first), payload.items);
    assert.equal(updated.lists.first.itemIds.length, 1305);
    assert.ok(saved.every((id) => updated.lists.first.itemIds.includes(id)));
    assert.deepEqual(updated.lists.first.itemIds.filter((id) => current.has(id)), [...current.keys()]);
    assert.deepEqual(updated.read, state.read);
  }
});

for (const [catalogId, file, removed, added, length] of [
  ['thor-best-of', 'thor_best_of.json', 7, 20, 151],
  ['xmen-claremont', 'xmen_claremont.json', 72, 28, 346],
]) {
  test(`updating the actual earlier ${catalogId} list keeps every earlier comic and its progress`, () => {
    const payload = readJson(`../src/data/${file}`);
    const revised = payload.items.map(({ issueId }) => issueId);
    const saved = ledgerEarlierOrders[catalogId](revised);
    const current = new Map(payload.items.map((item) => [item.issueId, item]));
    const retired = saved.filter((id) => !current.has(id));
    assert.equal(retired.length, removed);
    assert.equal(revised.filter((id) => !saved.includes(id)).length, added);
    let state = createList(createEmptyState(), { id: 'saved', name: 'Saved', catalogId });
    state = addIssuesToList(state, 'saved', saved.map((issueId) => current.get(issueId) ?? { issueId })).state;
    state = markRead(state, retired[0], true, 123);
    state = markRead(state, revised.at(-1), true, 456);
    state = setIssueNote(state, retired.at(-1), 'My note');
    const updated = applyListRevision(state, 'saved', JSON.stringify(state.lists.saved), payload.items);
    const ids = updated.lists.saved.itemIds;
    assert.equal(ids.length, length);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.filter((id) => current.has(id)), revised);
    assert.ok(saved.every((id) => ids.includes(id)));
    assert.deepEqual(updated.read, { [retired[0]]: 123, [revised.at(-1)]: 456 });
    assert.equal(updated.notes[retired.at(-1)], 'My note');
  });
}

test('updating the earlier Hickman list interleaves Avengers and New Avengers and keeps all progress', () => {
  const payload = readJson('../src/data/hickman_full.json');
  const revised = payload.items.map(({ issueId }) => issueId);
  const saved = ledgerEarlierOrders['hickman-full'](revised);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: payload.id, itemIds: saved }), true);
  assert.deepEqual(compareListOrders(saved, revised), { added: [], retained: [], reordered: true });
  assert.equal(saved.filter((id, index) => id !== revised[index]).length, 84);
  const titles = new Map(payload.items.map(({ issueId, title }) => [issueId, title]));
  assert.deepEqual(revised.slice(124, 128).map((id) => titles.get(id)), [
    'New Avengers (2013) #1', 'New Avengers (2013) #2', 'New Avengers (2013) #3', 'Avengers (2012) #1',
  ]);
  const [avengers, newAvengers] = [revised[124 + 3], revised[124]];
  let state = createList(createEmptyState(), { id: 'saved', name: 'Saved', catalogId: payload.id });
  state = addIssuesToList(state, 'saved', saved.map((issueId) => payload.items.find((item) => item.issueId === issueId))).state;
  state = markRead(state, avengers, true, 123);
  state = setIssueNote(state, newAvengers, 'My note');
  const updated = applyListRevision(state, 'saved', JSON.stringify(state.lists.saved), payload.items);
  assert.deepEqual(updated.lists.saved.itemIds, revised);
  assert.deepEqual(updated.read, { [avengers]: 123 });
  assert.equal(updated.notes[newAvengers], 'My note');
});
