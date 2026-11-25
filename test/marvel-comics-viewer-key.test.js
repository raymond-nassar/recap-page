import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { appLinkFor, appViewerFor } from '../src/js/lib/marvelComicsApp.js';
import { VIEWER_KEY_OFFSET, viewerFromKey, viewerKey } from '../src/js/lib/marvelComicsAppUrl.js';
import { marvelComicsAppLinkPairs } from '../src/data/marvelComicsAppLinks.js';
import { isLaunchable, launchUrl, openIssue } from '../src/js/reader.js';
import { readingChoices } from '../src/js/views/shared/reading-options.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, isRead, markRead, migrate,
  normalizeIssue, pendingIssueIds, setIssueNote, setIssueRating, upsertIssue, validateBackup,
} from '../src/js/lib/model.js';

// #1601 acceptance cases: Marvel Comics app viewer numbers with no old catalog number.
const ACCEPTANCE = ['21709', '21707', '21714', '21716', '21710', '21713', '12618', '12646'];
const origin = 'https://recap.test';
const before = new Date(2026, 10, 25, 12);
const after = new Date(2026, 11, 8, 12);
const viewerUrl = (n) => `https://www.marvelcomicsapp.com/viewer/${n}`;

test('1601 a viewer-only key round-trips, stays safe and never meets an old number', () => {
  const tabled = new Set(marvelComicsAppLinkPairs.map(([oldId]) => oldId));
  for (const viewer of ACCEPTANCE) {
    const key = viewerKey(viewer);
    assert.ok(Number.isSafeInteger(key) && key < -VIEWER_KEY_OFFSET, viewer);
    assert.equal(viewerFromKey(key), viewer);
    assert.equal(tabled.has(key), false);
  }
  assert.equal(viewerKey(999999999) > Number.MIN_SAFE_INTEGER, true);
  for (const bad of [0, '0', '012', 1234567890, -1, 'abc', null]) assert.equal(viewerKey(bad), null, String(bad));
  // Placeholders, hand-added comics and positive old numbers are not keys.
  for (const other of [-2146471348, -2100946, -1795600000000, 12618, -VIEWER_KEY_OFFSET, -(VIEWER_KEY_OFFSET + 1e9)]) {
    assert.equal(viewerFromKey(other), null, String(other));
  }
});

test('1601 viewer 12618 and old number 12618 stay two different comics', () => {
  const key = viewerKey('12618');
  assert.equal(appLinkFor(key), viewerUrl(12618));
  assert.equal(appViewerFor(key), '12618');
  assert.notEqual(appLinkFor(12618), viewerUrl(12618), 'the old number must not borrow the viewer address');
});

test('1601 a viewer-only comic opens only its viewer address, whichever reader was chosen', () => {
  const comic = { issueId: viewerKey('21709'), title: 'Acceptance comic', digitalId: 38811, url: 'https://www.marvel.com/comics/issue/1/x' };
  assert.equal(isLaunchable({ issueId: comic.issueId }), true);
  for (const now of [before, after]) {
    for (const app of [true, false]) {
      const params = new URL(launchUrl(comic, origin, { now, app })).searchParams;
      assert.deepEqual([...params.keys()].sort(), ['a', 'r', 't']);
      assert.equal(params.get('a'), '21709');
    }
  }
  const prior = globalThis.window;
  globalThis.window = { open() { return null; } };
  try {
    assert.equal(openIssue({ issueId: comic.issueId, title: 'x' }, { origin, now: before }).target, 'app');
  } finally {
    globalThis.window = prior;
  }
});

test('1601 Reading options offer no Marvel Unlimited choice for a viewer-only comic', () => {
  const keyed = readingChoices({ issueId: viewerKey('12646'), title: 'K' }, null, { launchable: true, app: true, now: before });
  assert.deepEqual(keyed.map((choice) => choice.key), ['app']);
  const old = readingChoices({ issueId: 12459, title: 'O' }, null, { launchable: true, app: true, now: before });
  assert.deepEqual(old.map((choice) => choice.key), ['app', 'unlimited']);
});

test('1601 saved progress for a viewer-only comic survives load and backup, one checkmark across guides', () => {
  const key = viewerKey('21714');
  const item = { issueId: key, title: 'Acceptance comic', source: 'curated' };
  const issue = normalizeIssue(item);
  assert.equal(issue.issueId, key);
  assert.equal(issue.url, null, 'no marvel.com page is invented');
  assert.equal(issue.detailsRefused, true, 'no metadata lookup is spent');

  let state = createEmptyState();
  state = upsertIssue(state, item);
  state = createList(state, { name: 'Guide one', id: 'one' });
  state = addIssuesToList(state, 'one', [item]).state;
  state = createList(state, { name: 'Guide two', id: 'two' });
  state = addIssuesToList(state, 'two', [item]).state;
  state = markRead(state, key, true, 1);
  state = setIssueNote(state, key, 'kept');
  state = setIssueRating(state, key, 4);
  assert.deepEqual(pendingIssueIds(state), []);

  const restored = migrate(JSON.parse(JSON.stringify(state)));
  assert.equal(isRead(restored, key), true);
  assert.deepEqual(restored.lists.one.itemIds, [key]);
  assert.deepEqual(restored.lists.two.itemIds, [key]);
  assert.equal(restored.notes[key], 'kept');
  const backup = validateBackup(JSON.parse(JSON.stringify(exportBackup(restored))));
  const fromBackup = backup.state ?? backup;
  assert.equal(isRead(fromBackup, key), true);
  assert.equal(fromBackup.issues[key].issueId, key);
});

test('1601 no shipped guide gives a comic with an old number a second viewer-only checkmark', () => {
  const owned = new Set(marvelComicsAppLinkPairs.map(([, viewer]) => String(viewer)));
  const dir = new URL('../src/data/', import.meta.url);
  const conflicts = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    for (const entry of Array.isArray(data?.items) ? data.items : []) {
      const viewer = viewerFromKey(entry?.issueId);
      if (viewer && owned.has(viewer)) conflicts.push(`${name}: viewer ${viewer}`);
    }
  }
  assert.deepEqual(conflicts, []);
});
