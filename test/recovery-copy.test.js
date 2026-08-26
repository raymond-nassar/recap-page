import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, KEY } from '../src/js/storage.js';

// The recovery banner is written in two places at once: the markup carries the standing copy
// and the store builds the line above it. Nothing joined the two up, so each could be edited
// while reading only half of what the reader ends up seeing, and both drifted into saying the
// same three things. This reads both halves and holds them to one rule: each instruction is
// written once. It fails in both directions, which is the point, since deleting the guidance
// outright would otherwise look like an improvement to whichever half you were reading.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The banner's prose, as a reader sees it: comments and tags dropped, whitespace collapsed.
// It stops at the buttons, because a button label is not the copy being tested and "Download a
// copy of the unreadable data" would satisfy the download rule on its own, leaving the
// paragraph free to lose the sentence that orders the two actions.
function bannerProse() {
  const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
  const from = html.indexOf('<section id="blocked-banner"');
  assert.notEqual(from, -1, 'the recovery banner must still be in the markup');
  const to = html.indexOf('<div class="blocked-actions">', from);
  assert.notEqual(to, -1, 'the banner must still carry its actions, which bound the prose');
  return html.slice(from, to)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A schema from a newer build, which is the realistic trigger migrate() throws on, rather than
// a syntax error that only proves JSON.parse works.
function blockedStore() {
  const map = new Map([[KEY, JSON.stringify({ schemaVersion: 99, lists: {} })]]);
  const storage = {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true, 'the fixture must actually reach the blocked state');
  return store;
}

const INSTRUCTIONS = [
  ['the data survived', /not been changed or deleted/i],
  ['saving is paused', /saving is paused/i],
  ['download a copy before starting fresh', /download a copy/i],
];

// Both writers, because both are on screen: the load failure is the banner's explanation line
// and a refusal goes to the assertive save pane directly above the standing copy. Either one
// that repeats an instruction puts it on the screen twice however well it reads on its own.
function saidWhileBlocked() {
  const onLoad = blockedStore().blockedReason;

  const store = blockedStore();
  store.update((s) => ({ ...s, listOrder: ['forced'] }));
  const onWrite = store.lastError;
  assert.notEqual(onWrite, onLoad, 'a refused write must report itself, not repeat the load');

  return [['the load failure', onLoad], ['a write refused while blocked', onWrite]];
}

test('each recovery instruction is written in one place, not two', () => {
  const prose = bannerProse();
  for (const [what, said] of INSTRUCTIONS) {
    assert.match(prose, said, `the banner must be where "${what}" is said`);
    for (const [when, message] of saidWhileBlocked()) {
      assert.doesNotMatch(message, said, `${when} must not say "${what}" a second time`);
    }
  }
});

// The exception, and the reason it is one. Refusing to start fresh is the only message here
// that knows something the banner cannot: the automatic copy did not land, storage is full,
// and the way through is to save the file by hand and press again. It repeats the download
// because it is redirecting the reader, not restating the standing advice.
test('the refusal to start fresh may repeat itself, because it is redirecting', () => {
  const store = blockedStore();
  store.storage.map.delete('mrt.state.salvage');
  store.storage.setItem = () => { throw new Error('quota'); };

  assert.equal(store.startFresh(), false, 'the hatch must stay shut without a verified copy');
  assert.match(store.lastError, /Nothing was cleared/i);
  assert.match(store.lastError, /try again/i);
});

// The standing copy cannot know why the load failed, and the reader needs it: a schema from a
// newer build and a corrupted file are the same banner with different answers to "now what".
test('the store error keeps the reason, which the standing copy cannot know', () => {
  assert.match(blockedStore().blockedReason, /Unsupported schema version 99/);
  assert.doesNotMatch(bannerProse(), /schema/i);
});

test('save education stays outside recovery copy and hides while saving is blocked', () => {
  const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const blockedStart = html.indexOf('<section id="blocked-banner"');
  const blockedEnd = html.indexOf('</section>', blockedStart);

  assert.doesNotMatch(html.slice(blockedStart, blockedEnd), /save-education/);
  assert.match(main, /const hidden = saveEducation\.current\(\)[\s\S]{0,100}\|\| store\.blocked/);
  assert.doesNotMatch(main, /record(?:NonEmptyList|DirectProgress)Save[\s\S]{0,300}#save-report/);
});
