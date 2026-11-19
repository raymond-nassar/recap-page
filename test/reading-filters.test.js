import test from 'node:test';
import assert from 'node:assert/strict';

import {
  READING_FILTERS, DEFAULT_FILTER, LEGACY_READING_FILTERS, readingFilter, matchesReadingFilter, filterListProblems,
} from '../src/js/lib/readingFilters.js';

// The shape listItems() hands the renderer: the issue record, plus the read flag and the override
// resolved out of their own maps. Only the five fields the predicates read are named here.
const item = (extra = {}) => ({
  issueId: 1, title: 'Issue 1', read: false, hydrated: true, source: 'catalog', override: null, ...extra,
});

// Far enough either side of today that the test does not change answer overnight.
const past = '2001-01-01';
const future = '2999-01-01';

test('the list is what the radios are built from, so it has to be self-consistent', () => {
  assert.deepEqual(filterListProblems(READING_FILTERS), []);
  assert.equal(READING_FILTERS.some((f) => f.value === DEFAULT_FILTER), true);
});

test('a filter that names a value and does not decide one is reported, not accepted', () => {
  // The single failure the one list can still express. It used to be a whole class: a radio in
  // index.html with no matching branch in main.js reached a trailing "return true" and filtered
  // nothing, saying nothing.
  assert.deepEqual(
    filterListProblems([{ value: 'all', label: 'All', match: () => true }, { value: 'crossovers', label: 'Crossovers' }]),
    ['Filter 1 has no match function.'],
  );
  assert.deepEqual(
    filterListProblems([{ value: 'all', label: 'All', match: () => true }, { value: 'all', label: 'Again', match: () => true }]),
    ['Filter 1 repeats the value "all".'],
  );
  assert.deepEqual(
    filterListProblems([{ value: 'unread', label: 'Unread', match: () => true }]),
    ['No filter offers the default value "all".'],
  );
  assert.deepEqual(filterListProblems([]), ['The filter list is empty.']);
});

test('an unknown filter throws rather than quietly matching everything', () => {
  assert.throws(() => matchesReadingFilter('crossovers', item()), /Unknown reading filter: "crossovers"/);
  assert.throws(() => matchesReadingFilter(undefined, item()), /Unknown reading filter/);
  assert.equal(readingFilter('crossovers'), null);
});

test('All matches every row, which is what makes it the way back', () => {
  assert.equal(matchesReadingFilter('all', item()), true);
  assert.equal(matchesReadingFilter('all', item({ read: true })), true);
});

test('Read and Unread partition the list between them', () => {
  for (const row of [item(), item({ read: true })]) {
    assert.equal(matchesReadingFilter('read', row) !== matchesReadingFilter('unread', row), true);
  }
  assert.equal(matchesReadingFilter('read', item({ read: true })), true);
  assert.equal(matchesReadingFilter('unread', item()), true);
});

test('the list offers All, Unread, Deferred and Read, and nothing about availability or details', () => {
  // Removed at the owner's request on 19 Nov 2026: "Past Unlimited date or marked available" and
  // "Details pending" answered questions about the data rather than about reading.
  assert.deepEqual(READING_FILTERS.map((f) => [f.value, f.label]),
    [['all', 'All'], ['unread', 'Unread'], ['deferred', 'Deferred'], ['read', 'Read']]);
  for (const removed of LEGACY_READING_FILTERS) assert.equal(readingFilter(removed), null, removed);
  assert.deepEqual([...LEGACY_READING_FILTERS], ['unlimited', 'pending']);
});

test('every filter answers every row, so no radio can render without a predicate behind it', () => {
  const rows = [item(), item({ read: true }), item({ hydrated: false }), item({ mu: past }), item({ mu: future })];
  for (const f of READING_FILTERS) {
    for (const row of rows) {
      assert.equal(typeof matchesReadingFilter(f.value, row), 'boolean', `${f.value} should decide every row`);
    }
    assert.equal(typeof f.label, 'string');
    assert.notEqual(f.label, '');
  }
});
