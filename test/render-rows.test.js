// The render paths BL-033 changed, exercised rather than scanned.
//
// Until BL-064 these were covered by source-text tests in test/library.test.js, which matched
// the shape of the code rather than what it does. BL-033's own block says why that was
// unsatisfying: all six mutations tried against them changed exactly the text the scans read,
// so passing was close to tautological. These call the functions.
import test from 'node:test';
import assert from 'node:assert/strict';

import { commitRows, rowCacheKey, detailsState, synopsisFallback, DETAILS_BADGE } from '../src/js/views/reading.js';
import { NO_SYNOPSIS } from '../src/js/synopsis.js';

// The smallest node that commitRows actually uses: childNodes, remove() and insertBefore().
// A DOM implementation would do, but nothing here needs one, which is the point.
function container(children = []) {
  const box = {
    childNodes: [...children],
    insertBefore(node, ref) {
      const from = this.childNodes.indexOf(node);
      if (from !== -1) this.childNodes.splice(from, 1);
      const at = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
      this.childNodes.splice(at === -1 ? this.childNodes.length : at, 0, node);
      return node;
    },
  };
  for (const child of box.childNodes) child.parent = box;
  return box;
}

function row(name) {
  const node = { name, parent: null };
  node.remove = function remove() {
    if (!this.parent) return;
    const at = this.parent.childNodes.indexOf(this);
    if (at !== -1) this.parent.childNodes.splice(at, 1);
    this.parent = null;
  };
  return node;
}

const names = (box) => box.childNodes.map((n) => n.name);

test('commitRows leaves a list that is already correct completely alone', () => {
  const [a, b, c] = [row('a'), row('b'), row('c')];
  const box = container([a, b, c]);
  let moves = 0;
  const insertBefore = box.insertBefore.bind(box);
  box.insertBefore = (node, ref) => { moves += 1; return insertBefore(node, ref); };

  commitRows(box, [a, b, c]);

  assert.deepEqual(names(box), ['a', 'b', 'c']);
  assert.equal(moves, 0, 'an unchanged order must not touch the tree at all');
});

test('commitRows removes what the new order does not ask for', () => {
  const [a, b, c] = [row('a'), row('b'), row('c')];
  const box = container([a, b, c]);

  commitRows(box, [a, c]);

  assert.deepEqual(names(box), ['a', 'c']);
  assert.equal(b.parent, null, 'the dropped row must be detached, not merely skipped');
});

test('commitRows adds a new row in the position the order gives it', () => {
  const [a, c] = [row('a'), row('c')];
  const box = container([a, c]);
  const b = row('b');

  commitRows(box, [a, b, c]);

  assert.deepEqual(names(box), ['a', 'b', 'c']);
});

// This is the defect BL-033's block records: the first version placed before it dropped, which
// left the stale node in front of the reused ones, shifted every later index by one, and turned
// one rebuilt row into a move of all the rest. It scored 217 of 219 rows reused and still
// churned 219 nodes. Ordering is the whole of the fix, so the test counts moves rather than
// only checking the result, because the wrong order still arrives at the right list.
test('commitRows drops before it places, so one replaced row costs one move', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(row);
  const box = container(rows);
  let moves = 0;
  const insertBefore = box.insertBefore.bind(box);
  box.insertBefore = (node, ref) => { moves += 1; return insertBefore(node, ref); };

  // 'a' is rebuilt; the other four are reused untouched.
  const fresh = row('a2');
  commitRows(box, [fresh, ...rows.slice(1)]);

  assert.deepEqual(names(box), ['a2', 'b', 'c', 'd', 'e']);
  assert.equal(moves, 1, 'placing before dropping would move every later row as well');
});

test('commitRows reorders a reused row without rebuilding it', () => {
  const rows = ['a', 'b', 'c'].map(row);
  const box = container(rows);
  const [a, b, c] = rows;

  commitRows(box, [c, a, b]);

  assert.deepEqual(names(box), ['c', 'a', 'b']);
  assert.equal(box.childNodes[0], c, 'the moved node must be the same object, not a copy');
});

test('commitRows empties a container when the order asks for nothing', () => {
  const rows = ['a', 'b'].map(row);
  const box = container(rows);

  commitRows(box, []);

  assert.deepEqual(names(box), []);
});

// The key is the whole item, which is what stops a field being left out of an enumerated list
// and silently freezing a row. Changing any field at all has to change the key.
test('the row cache key changes when any field of the item changes', () => {
  const item = { issueId: 1, read: false, title: 'One', date: '2025-01-01' };
  const base = rowCacheKey(item, 9, '2025-06-01');

  for (const [field, value] of [['read', true], ['title', 'Two'], ['date', '2025-02-02']]) {
    const changed = rowCacheKey({ ...item, [field]: value }, 9, '2025-06-01');
    assert.notEqual(changed, base, `changing ${field} must invalidate the cached row`);
  }
});

test('the row cache key changes when the row becomes the one up next', () => {
  const item = { issueId: 1, read: false };
  assert.notEqual(rowCacheKey(item, 1, '2025-06-01'), rowCacheKey(item, 9, '2025-06-01'));
});

// The midnight bug, which the BL-033 review found after the first pass asserted currentId was
// the only input outside the item. availability() and describe() both default `today` to the
// local day at call time, and it is date > today that decides between "soon scheduled" and
// "MU Unlimited", so a tab left open across local midnight reused yesterday's row for good.
test('the row cache key changes when the day changes under an open tab', () => {
  const item = { issueId: 1, read: false, date: '2025-06-02' };
  assert.notEqual(rowCacheKey(item, 9, '2025-06-01'), rowCacheKey(item, 9, '2025-06-02'));
});

// BL-108's half of the same bug, and it bites in the direction that looks harmless. With covers
// off the row's <img> is never given a src, so the node is correct on screen; turning the setting
// back on then reuses that node and the cover never arrives, which makes the switch one way until
// a reload. The key carries the setting so the reuse cannot happen.
test('the row cache key changes when cover art is switched', () => {
  const item = { issueId: 1, read: false, title: 'One' };
  assert.notEqual(
    rowCacheKey(item, 9, '2025-06-01', false),
    rowCacheKey(item, 9, '2025-06-01', true),
    'a row built without its cover must not be reused once cover art is switched back on',
  );
});

test('the row cache key is stable when nothing has changed', () => {
  const item = { issueId: 1, read: false, title: 'One' };
  assert.equal(rowCacheKey(item, 9, '2025-06-01', true), rowCacheKey({ ...item }, 9, '2025-06-01', true));
});

// -------------------------------------------------- what a row says about details it does not have

// A row had two states where there are three, and the missing one was being shown as the wrong one
// of the two. "Details pending" over an issue upstream has already refused is a promise the app
// cannot keep, and it is the shipped catalog's ordinary case rather than an edge: 34 issues.
test('an issue upstream has no record of is not described as waiting for one', () => {
  assert.equal(detailsState({ hydrated: false, detailsRefused: true, source: 'curated' }), 'norecord');
  assert.equal(detailsState({ hydrated: false, source: 'import' }), 'pending');
  assert.equal(detailsState({ hydrated: true, source: 'api' }), null);
  assert.equal(detailsState({ hydrated: false, source: 'manual' }), null, 'a hand-added issue has no upstream record to wait for');
});

// The refusal wins over pending rather than the other way round, because both are true of the same
// issue: it is not hydrated and it never will be. Ordering them the other way puts every refused
// issue back under the wording this item exists to remove.
test('a refusal is reported as a refusal even though the issue is also unhydrated', () => {
  assert.equal(detailsState({ hydrated: false, detailsRefused: true, source: 'import' }), 'norecord');
});

// The visible half of a badge is two or three words, so the reason has to live in the hidden half
// or it is not written down anywhere, which is the finding BL-030 recorded about the availability
// badge beside it. Both halves are checked here because the wording is the whole of the feature.
test('each details badge carries its reason in the half a screen reader gets', () => {
  assert.equal(DETAILS_BADGE.norecord.text, 'no details held');
  assert.match(DETAILS_BADGE.norecord.hint, /no record of this issue/);
  assert.match(DETAILS_BADGE.norecord.hint, /nothing to fetch|no details to fetch/);
  assert.equal(DETAILS_BADGE.pending.text, 'details pending');
  assert.match(DETAILS_BADGE.pending.hint, /have not been fetched yet/);
  for (const { text, hint } of Object.values(DETAILS_BADGE)) {
    assert.ok(text.length > 0 && hint.length > 0);
    assert.ok(!/[\u2013\u2014]/.test(`${text} ${hint}`), 'constraint 11: no dashes in shipped copy');
  }
});

// The issue page says the same three things in a sentence that stands alone, and it had the same
// two-way fallback. What has changed since BL-134 is where a synopsis can come from: nothing stored
// carries prose any more, so there is no issue.description branch left. A synopsis fetched during
// this session is passed in beside the issue, and it wins, because it is the only one there is.
test('the issue page tells the same three states apart', () => {
  assert.equal(synopsisFallback({ detailsRefused: true }, 'A real synopsis.'), 'A real synopsis.');
  assert.equal(synopsisFallback({ detailsRefused: true }), DETAILS_BADGE.norecord.hint);
  assert.equal(synopsisFallback({ hydrated: true }), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback({ hydrated: false }), 'Details have not been fetched yet.');
});

// A run that asked and was answered with nothing is the same answer as a snapshot holding nothing,
// so an empty or blank session value falls through rather than blanking the sentence.
test('a session synopsis that came back empty says what the snapshot would have said', () => {
  assert.equal(synopsisFallback({ hydrated: true }, ''), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback({ hydrated: true }, '   '), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback({ hydrated: true }, null), 'No synopsis is recorded for this issue.');
});

// A stored description cannot exist after BL-134, and if a hand-edited state file put one back this
// must not render it: the promise is that prose is fetched and shown, never stored and shown.
test('a description smuggled onto a stored issue is not rendered', () => {
  assert.equal(
    synopsisFallback({ hydrated: true, description: 'Smuggled.' }),
    'No synopsis is recorded for this issue.',
  );
});

// normalizeIssue keeps hydrated and detailsRefused mutually exclusive, but the merge does not:
// hydrated is OR-preserved across an upsert and detailsRefused is last write wins, so an issue
// added from a search and then imported inside a curated order that has no entry for it carries
// both. Asking the refusal first reported no record over a record the tracker was holding.
test('a record the tracker holds outranks a refusal, however the two came to be set together', () => {
  const both = { hydrated: true, detailsRefused: true, source: 'curated', digitalId: 42 };
  assert.equal(detailsState(both), null, 'a hydrated issue has nothing pending and nothing missing');
  assert.equal(synopsisFallback(both), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback(both, 'Held.'), 'Held.');
});

test('and a genuine refusal, which is never hydrated, still says so on both surfaces', () => {
  const refused = { hydrated: false, detailsRefused: true, source: 'curated' };
  assert.equal(detailsState(refused), 'norecord');
  assert.equal(synopsisFallback(refused), DETAILS_BADGE.norecord.hint);
});

// An issue nobody has hydrated says "Details have not been fetched yet", which is true right up
// until a synopsis run asks about it and is told there is nothing. After that the sentence sends the
// reader to wait for a fetch that has already happened, which is the whole of what this sentence was
// rewritten to stop doing. The session holds a known negative distinct from "not asked", and it has
// to reach here for that distinction to be worth keeping.
test('an issue the run asked about and found nothing for stops promising a fetch', () => {
  assert.equal(synopsisFallback({ hydrated: false }, NO_SYNOPSIS), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback({ hydrated: false }), 'Details have not been fetched yet.');
});
