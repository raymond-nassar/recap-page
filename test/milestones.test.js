import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyState, createList, addIssuesToList, markRead, setDeferred, exportBackup,
} from '../src/js/lib/model.js';
import {
  MILESTONE_KEYFRAMES, MILESTONE_MS, SECTION_NAME_MAX,
  playMilestone, readMilestones, sectionHeading, sectionName, sectionSentence,
} from '../src/js/lib/milestones.js';

// #874 (UX-37): the conditions of the two Reading Journey milestones, and the gate on their moment.

const comic = (issueId, collectedIn = null) => ({
  issueId, title: `Comic ${issueId}`, number: String(issueId), source: 'manual', collectedIn,
});

function journey(sections = ['One', 'One', 'Two', null]) {
  let state = createList(createEmptyState(), { id: 'j', name: 'Journey' });
  state = addIssuesToList(state, 'j', sections.map((name, index) => comic(index + 1, name))).state;
  return state;
}

const mark = (state, id, read = true) => markRead(state, id, read, 1000 + id);

test('a mark that leaves its section with nothing unread reaches that section, by its heading', () => {
  const start = mark(journey(), 1);
  assert.deepEqual(readMilestones(start, mark(start, 2), 'j', 2), { section: { index: 0, name: 'One' }, list: false });
  assert.deepEqual(readMilestones(start, mark(start, 3), 'j', 3), { section: { index: 1, name: 'Two' }, list: false },
    'a one-comic section is finished by its only comic');
  assert.deepEqual(readMilestones(journey(), mark(journey(), 1), 'j', 1), { section: null, list: false },
    'a section with another comic unread is not finished');
});

test('an unnamed run after a named section is the heading "Individual issues"; a list without sections has none', () => {
  const start = journey();
  assert.deepEqual(readMilestones(start, mark(start, 4), 'j', 4).section, { index: 2, name: 'Individual issues' });
  const leading = journey([null, 'One']);
  assert.equal(readMilestones(leading, mark(leading, 1), 'j', 1).section, null,
    'a leading unnamed run shows no heading in the full list, so it has no milestone to report');
  const plain = journey([null, null]);
  const once = mark(plain, 1);
  assert.deepEqual(readMilestones(plain, once, 'j', 1), { section: null, list: false });
  assert.deepEqual(readMilestones(once, mark(once, 2), 'j', 2), { section: null, list: true },
    'a list with no sections still reaches the whole-list milestone');
  assert.equal(sectionHeading({ name: 'Named' }, 0), 'Named');
  assert.equal(sectionHeading({ name: null }, 0), null);
  assert.equal(sectionHeading({ name: null }, 3), 'Individual issues');
  assert.equal(sectionHeading(undefined, 0), null);
});

test('the last unread comic reaches the whole list and its own section together', () => {
  let state = journey(['One', 'Two']);
  state = mark(state, 1);
  assert.deepEqual(readMilestones(state, mark(state, 2), 'j', 2), { section: { index: 1, name: 'Two' }, list: true });
});

test('nothing is reached by an unmark, a repeated mark, a comic outside the list or a list with deferred comics unread', () => {
  const start = mark(mark(journey(), 1), 2);
  assert.deepEqual(readMilestones(start, mark(start, 2, false), 'j', 2), { section: null, list: false }, 'unmark');
  assert.deepEqual(readMilestones(start, mark(start, 2), 'j', 2), { section: null, list: false }, 'already read');
  assert.deepEqual(readMilestones(start, mark(start, 99), 'j', 99), { section: null, list: false }, 'not in the list');
  assert.deepEqual(readMilestones(start, mark(start, 3), 'missing', 3), { section: null, list: false }, 'no such list');
  assert.deepEqual(readMilestones(null, mark(start, 3), 'j', 3), { section: null, list: false }, 'no earlier state');
  const deferred = setDeferred(mark(start, 3), 'j', 4, true);
  assert.deepEqual(readMilestones(deferred, deferred, 'j', 4), { section: null, list: false });
  const lastQueued = setDeferred(start, 'j', 4, true);
  assert.equal(readMilestones(lastQueued, mark(lastQueued, 3), 'j', 3).list, false,
    'a deferred comic is still unread, so the list is not finished');
});

test('a section split in two by the order is judged as the run the comic is in', () => {
  const state = journey(['One', 'Two', 'One']);
  assert.deepEqual(readMilestones(state, mark(state, 1), 'j', 1), { section: { index: 0, name: 'One' }, list: false },
    'the full list shows each run under its own heading, so the first finishes on its own');
  assert.deepEqual(readMilestones(state, mark(state, 3), 'j', 3), { section: { index: 2, name: 'One' }, list: false });
});

test('milestone conditions read saved progress only, so nothing new is stored or backed up', () => {
  const start = mark(journey(), 1);
  const after = mark(start, 2);
  const shape = JSON.stringify(Object.keys(exportBackup(after)));
  readMilestones(start, after, 'j', 2);
  assert.equal(JSON.stringify(Object.keys(exportBackup(after))), shape);
  assert.deepEqual(Object.keys(exportBackup(after)), Object.keys(exportBackup(createEmptyState())));
});

test('a section name in a sentence is cut at a word near 60 characters and ends one sentence', () => {
  assert.equal(sectionSentence('Book One'), 'Section complete: Book One.');
  assert.equal(sectionSentence('Avengers Disassembled.'), 'Section complete: Avengers Disassembled.');
  assert.equal(sectionSentence('What If?'), 'Section complete: What If?');
  const long = 'Collects: Venom: Lethal Protector 1-6, Venom: Funeral Pyre 1-3, Daredevil (1964) 323';
  const cut = sectionName(long);
  assert.ok(cut.length <= SECTION_NAME_MAX + 1, cut);
  assert.equal(cut, 'Collects: Venom: Lethal Protector 1-6, Venom: Funeral Pyre…');
  assert.equal(sectionSentence(long), `Section complete: ${cut}`);
  assert.equal(sectionName('x'.repeat(90)), `${'x'.repeat(SECTION_NAME_MAX)}…`, 'a name with no space is cut where it must be');
  assert.equal(sectionName('  spaced \n name  '), 'spaced name');
});

test('the moment plays once, under half a second, without flashing, and not at all with reduced motion', () => {
  const calls = [];
  const node = (extra = {}) => ({
    isConnected: true, getClientRects: () => [{}],
    animate: (keyframes, options) => { calls.push({ keyframes, options }); return { keyframes, options }; },
    ...extra,
  });
  const motion = (reduce) => ({ matchMedia: (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduce }) });
  assert.ok(playMilestone(node(), motion(false)));
  assert.equal(calls.length, 1);
  assert.ok(MILESTONE_MS < 500 && calls[0].options.duration === MILESTONE_MS);
  // WCAG 2.3.1: opacity rises once and never falls back, so no pair of opposing changes occurs.
  const opacity = MILESTONE_KEYFRAMES.map((frame) => frame.opacity);
  assert.deepEqual(opacity, [...opacity].sort((a, b) => a - b));
  assert.equal(opacity.at(-1), 1);
  assert.equal(MILESTONE_KEYFRAMES.at(-1).scale, 1, 'it settles where the element is drawn');

  assert.equal(playMilestone(node(), motion(true)), null, 'reduced motion');
  assert.equal(playMilestone(node({ getClientRects: () => [] }), motion(false)), null, 'not on screen');
  assert.equal(playMilestone(node({ isConnected: false }), motion(false)), null, 'not in the page');
  assert.equal(playMilestone(node({ animate: undefined }), motion(false)), null, 'no animation support');
  assert.equal(playMilestone(null, motion(false)), null);
  assert.equal(calls.length, 1);
});
