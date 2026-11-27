import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { appLinkFor, appViewerFor } from '../src/js/lib/marvelComicsApp.js';
import { appLaunchUrl, taggedViewer, VIEWER_KEY_OFFSET, viewerKey } from '../src/js/lib/marvelComicsAppUrl.js';
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

const tagged = (viewer, extra = {}) => ({ issueId: viewerKey(viewer), appViewer: viewer, ...extra });

test('1601 a viewer-only key round-trips through its tag, stays safe and never meets an old number', () => {
  const tabled = new Set(marvelComicsAppLinkPairs.map(([oldId]) => oldId));
  for (const viewer of ACCEPTANCE) {
    const key = viewerKey(viewer);
    assert.ok(Number.isSafeInteger(key) && key < -VIEWER_KEY_OFFSET, viewer);
    assert.equal(key, -(VIEWER_KEY_OFFSET + Number(viewer)));
    assert.equal(viewerKey(Number(viewer)), key, 'a number and its text make one key');
    assert.equal(taggedViewer(tagged(viewer)), viewer);
    assert.equal(tabled.has(key), false);
  }
  assert.equal(viewerKey(999999999) > Number.MIN_SAFE_INTEGER, true);
  for (const bad of [0, '0', '012', 1234567890, -1, 'abc', null]) assert.equal(viewerKey(bad), null, String(bad));
});

test('1601 a tag is believed only with its own appViewer and the key derived from it', () => {
  const key = viewerKey('21709');
  assert.equal(taggedViewer({ issueId: key, appViewer: '21709' }), '21709');
  assert.equal(taggedViewer({ issueId: key, appViewer: 21709 }), '21709');
  for (const record of [
    { issueId: key },
    { issueId: key, appViewer: null },
    { issueId: key, appViewer: '21710' },
    { issueId: key, appViewer: '021709' },
    { issueId: String(key), appViewer: '21709' },
    { issueId: 21709, appViewer: '21709' },
    { issueId: -2146471348, appViewer: '21709' },
    null, undefined, 21709, key,
  ]) {
    assert.equal(taggedViewer(record), null, JSON.stringify(record) ?? String(record));
  }
});

test('1601 an untagged key in the viewer range is not decoded into a viewer and launches no app', () => {
  // -8000000000012618 with an unrelated title is not Runaways #1 (viewer 12618).
  const untagged = { issueId: -8000000000012618, title: 'Unrelated comic' };
  assert.equal(taggedViewer(untagged), null);
  assert.equal(appViewerFor(untagged), null);
  assert.equal(appLinkFor(untagged), null);
  assert.equal(appViewerFor(untagged.issueId), null, 'a bare key is never read as a viewer');
  assert.equal(appLinkFor(untagged.issueId), null);
  assert.equal(isLaunchable(untagged), true, 'a saved title can use the website fallback without acquiring an app identity');
  const params = new URL(launchUrl(untagged, origin)).searchParams;
  assert.equal(params.has('a'), false);
  assert.equal(params.get('r'), 'comics');
  assert.deepEqual(readingChoices(untagged, null, { launchable: true, app: false }), []);
});

test('1601 appLaunchUrl opens a viewer only for a tagged or tabled comic', () => {
  const launchOf = (issue) => appLaunchUrl(new URL(launchUrl(issue, origin)).searchParams);
  assert.equal(launchOf(tagged('21709', { title: 'Tagged' })), viewerUrl(21709));
  assert.equal(launchOf({ issueId: 12459, title: 'Tabled' }), viewerUrl(18255));
  assert.equal(launchOf({ issueId: 42, title: 'Untabled' }), null);
  assert.equal(launchOf({ issueId: -8000000000021709, title: 'Untagged' }), null);
  assert.equal(launchOf({ issueId: -8000000000021709, appViewer: '21710', title: 'Mismatched' }), null);
});

test('1601 viewer 12618 and old number 12618 stay two different comics', () => {
  const comic = tagged('12618');
  assert.equal(appLinkFor(comic), viewerUrl(12618));
  assert.equal(appViewerFor(comic), '12618');
  assert.notEqual(appLinkFor(12618), viewerUrl(12618), 'the old number must not borrow the viewer address');
});

test('1601 a viewer-only comic opens only its viewer address, whichever reader was chosen', () => {
  const comic = tagged('21709', { title: 'Acceptance comic', digitalId: 38811, url: 'https://www.marvel.com/comics/issue/1/x' });
  assert.equal(isLaunchable({ issueId: comic.issueId, appViewer: '21709' }), true);
  assert.equal(isLaunchable({ issueId: comic.issueId }), false, 'the key alone is not a reference');
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
    assert.equal(openIssue(tagged('21709', { title: 'x' }), { origin, now: before }).target, 'app');
    assert.deepEqual(openIssue({ issueId: comic.issueId, title: 'x' }, { origin, now: before }),
      { ok: true, target: 'comics', window: null }, 'an untagged key opens only the general website');
  } finally {
    globalThis.window = prior;
  }
});

test('1601 Reading options offer no Marvel Unlimited choice for any comic', () => {
  for (const now of [before, after]) {
    const keyed = readingChoices(tagged('12646', { title: 'K' }), null, { launchable: true, app: true, now });
    assert.deepEqual(keyed.map((choice) => choice.key), ['app']);
    const old = readingChoices({ issueId: 12459, title: 'O' }, null, { launchable: true, app: true, now });
    assert.deepEqual(old.map((choice) => choice.key), ['app']);
    assert.deepEqual(readingChoices({ issueId: 42, title: 'N' }, null, { launchable: true, app: false, now }), []);
  }
});

test('1601 saved progress for a viewer-only comic survives load and backup, one checkmark across guides', () => {
  const key = viewerKey('21714');
  const item = { issueId: key, appViewer: '21714', title: 'Acceptance comic', source: 'curated' };
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
  assert.equal(fromBackup.issues[key].appViewer, '21714', 'the tag survives a backup round trip');
  assert.equal(appViewerFor(fromBackup.issues[key]), '21714');
});

test('Blood Hunt shares the existing Amazing Spider-Man #49 progress and reader link', () => {
  const read = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
  const published = read('amazing_spider_man_reading_order_modern_marvel_era.json').items[2066];
  const bloodHunt = read('blood_hunt.json').items[9];
  assert.equal(bloodHunt.issueId, 109636);
  assert.equal(bloodHunt.issueId, published.issueId);
  assert.equal(bloodHunt.seriesId, 32866);
  assert.equal(bloodHunt.seriesId, published.seriesId);
  assert.equal(String(bloodHunt.onSale).slice(0, 10), '2024-05-08');
  assert.equal(String(bloodHunt.onSale).slice(0, 10), String(published.onSale).slice(0, 10));
  assert.equal(appLinkFor(bloodHunt), viewerUrl(35682));
  assert.equal(taggedViewer(bloodHunt), null);

  for (const [first, second] of [[published, bloodHunt], [bloodHunt, published]]) {
    let state = createList(createEmptyState(), { id: 'first', name: 'First import' });
    state = addIssuesToList(state, 'first', [first]).state;
    state = markRead(state, first.issueId, true, 1);
    state = setIssueNote(state, first.issueId, 'Shared reading note');
    state = createList(state, { id: 'second', name: 'Second import' });
    state = addIssuesToList(state, 'second', [second]).state;
    const backup = validateBackup(JSON.parse(JSON.stringify(exportBackup(state))));
    const restored = backup.state ?? backup;
    assert.deepEqual(restored.lists.first.itemIds, [published.issueId]);
    assert.deepEqual(restored.lists.second.itemIds, [published.issueId]);
    assert.equal(isRead(restored, second.issueId), true);
    assert.equal(restored.notes[published.issueId], 'Shared reading note');
  }
});

test('1601 no shipped guide gives a comic with an old number a second viewer-only checkmark', () => {
  const owned = new Set(marvelComicsAppLinkPairs.map(([, viewer]) => String(viewer)));
  const dir = new URL('../src/data/', import.meta.url);
  const conflicts = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    for (const entry of Array.isArray(data?.items) ? data.items : []) {
      const viewer = taggedViewer(entry);
      if (viewer && owned.has(viewer)) conflicts.push(`${name}: viewer ${viewer}`);
      // A guide entry in the viewer range must carry its own matching tag, or it opens nothing.
      if (Number.isSafeInteger(entry?.issueId) && entry.issueId < -VIEWER_KEY_OFFSET && !viewer) {
        conflicts.push(`${name}: untagged ${entry.issueId}`);
      }
    }
  }
  assert.deepEqual(conflicts, []);
});
