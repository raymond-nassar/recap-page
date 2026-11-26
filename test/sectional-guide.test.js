import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONAL_GUIDE_COPY, openLinkedGuide, sectionalCatalogGroups, sectionalGuideParts, sectionalGuideSteps,
  sectionalPartDescription, sectionalPartName, sectionalReadingRows,
} from '../src/js/lib/sectionalGuide.js';

// Private authoring witness, not a shipped list: the coordinates the source owners pinned for the
// whole Civil War to Secret Invasion page (903 positions). The owner asked for smaller guides, so
// this only proves the contract can hold every pinned pause and return point of that page.
const bridge = Object.freeze({
  guideId: 'civil-war-to-secret-invasion',
  positionCount: 903,
  markers: [
    { beforePosition: 1, catalogId: 'civil-war', copy: null },
    { beforePosition: 16, catalogId: null, copy: null },
    { beforePosition: 504, catalogId: 'messiah-complex', copy: null },
    { beforePosition: 761, catalogId: 'annihilation-conquest', copy: null },
  ],
  pauses: [
    { afterPosition: 19, resumeAt: 22, title: 'Iron Man: Director of SHIELD', copy: 'pauseReturn' },
    { afterPosition: 72, resumeAt: 75, title: 'Avengers: The Initiative', copy: 'pauseReturn' },
    { afterPosition: 147, resumeAt: 149, title: 'Punisher War Journal', copy: 'pauseReturn' },
    { afterPosition: 168, resumeAt: 170, title: 'Irredeemable Ant-Man', copy: 'pauseReturn' },
    { afterPosition: 353, resumeAt: 356, title: 'Ghost Rider', copy: 'pauseReturn' },
    { afterPosition: 473, resumeAt: null, title: 'Heroes for Hire', copy: 'pauseHeroesForHire' },
  ],
  event: { afterPosition: 485, catalogId: 'world-war-hulk', copy: 'openEvent' },
  next: { afterPosition: 903, catalogId: 'secret-invasion', copy: 'openNext' },
});

const layout = (change = {}) => ({ ...bridge, ...change });

test('only the exact saved part order receives its source steps and cross-part return', () => {
  const parts = bridgeParts.map(({ first, last }) => ({
    first, last, issueIds: Array.from({ length: last - first + 1 }, (_, index) => 1000 + first + index),
  }));
  const lists = parts.map(({ issueIds }, index) => ({
    id: `${bridge.guideId}-part-${index + 1}`, count: issueIds.length,
    name: sectionalPartName('Civil War to Secret Invasion', index + 1),
  }));
  const group = { id: bridge.guideId, name: 'Civil War to Secret Invasion', year: 2007, layout: bridge, parts };
  const [placement] = sectionalCatalogGroups([group], lists);
  assert.deepEqual(placement.lists, lists);
  assert.equal(placement.options.some(({ list }) => list.id === bridge.guideId), false);
  assert.throws(() => sectionalCatalogGroups([group], lists.slice(0, -1)), /inconsistent part 14/);
  const items = parts[6].issueIds.map((issueId) => ({ issueId }));
  const seventh = placement.lists[6].sectionalPart;
  assert.deepEqual(sectionalReadingRows(seventh, items).after
    .filter(({ kind }) => kind === 'return-point')
    .map(({ catalogId, localPosition }) => [catalogId, localPosition]), [
    [`${bridge.guideId}-part-1`, 22], [`${bridge.guideId}-part-2`, 6], [`${bridge.guideId}-part-3`, 10],
    [`${bridge.guideId}-part-3`, 31], [`${bridge.guideId}-part-6`, 9],
  ]);
  assert.equal(sectionalReadingRows(seventh, items.slice().reverse()), null);
});

test('the bridge keeps every source position once in order with its pauses, event link and return points', () => {
  const steps = sectionalGuideSteps(bridge);
  const positions = steps.filter((step) => step.kind === 'position').map((step) => step.position);
  assert.deepEqual(positions, Array.from({ length: 903 }, (_, index) => index + 1));

  const after = (position) => {
    const index = steps.findIndex((step) => step.kind === 'position' && step.position === position);
    const out = [];
    for (let i = index + 1; i < steps.length && steps[i].kind !== 'position'; i += 1) out.push(steps[i]);
    return out;
  };
  const pauses = steps.filter((step) => step.kind === 'pause');
  assert.deepEqual(pauses.map((step) => SECTIONAL_GUIDE_COPY[step.copy]), [
    ...Array(5).fill('Pause here. Come back after World War Hulk.'),
    'Pause here. Issues 11 to 15 are in World War Hulk.',
  ]);
  for (const [position, title] of [[19, 'Iron Man: Director of SHIELD'], [473, 'Heroes for Hire']]) {
    assert.equal(after(position)[0].title, title);
  }

  assert.deepEqual(after(485).map((step) => step.kind === 'return-point' ? step.position : SECTIONAL_GUIDE_COPY[step.copy]), [
    'Open World War Hulk', 'Continue after World War Hulk', 22, 75, 149, 170, 356,
  ]);
  assert.deepEqual(after(903).map((step) => [step.catalogId, SECTIONAL_GUIDE_COPY[step.copy]]), [
    ['secret-invasion', 'Open Secret Invasion'],
  ]);
  assert.equal(steps.at(-1).kind, 'guide-link');

  // A return point leads back to a position already in this guide rather than to another list.
  const returnIndexes = steps.flatMap((step, index) => step.kind === 'return-point' ? [index] : []);
  for (const index of returnIndexes) {
    const target = steps.findIndex((step) => step.kind === 'position' && step.position === steps[index].position);
    assert.ok(target >= 0 && target < index);
    assert.equal(steps[index].catalogId, undefined);
  }

  const markers = steps.filter((step) => step.kind === 'marker');
  assert.deepEqual(markers.map((step) => [steps[steps.indexOf(step) + 1].position, step.copy]), [
    [1, null], [16, null], [504, null], [761, null],
  ]);
});

test('a sectional layout refuses pauses and return points the source does not support', () => {
  const pauses = bridge.pauses;
  const cases = [
    [{ pauses: [pauses[1], pauses[0], ...pauses.slice(2)] }, /source order/],
    [{ pauses: [...pauses, { afterPosition: 490, resumeAt: null, title: 'Late', copy: 'pauseHeroesForHire' }] }, /before the event/],
    [{ pauses: [{ ...pauses[0], resumeAt: 486 }, ...pauses.slice(1)] }, /between its pause and the event/],
    [{ pauses: [{ ...pauses[0], resumeAt: 19 }, ...pauses.slice(1)] }, /between its pause and the event/],
    [{ pauses: [pauses[0], { ...pauses[1], resumeAt: 22, afterPosition: 20 }] }, /same position/],
    [{ pauses: [{ ...pauses[0], copy: 'pauseHeroesForHire' }] }, /return copy/],
    [{ pauses: [{ ...pauses[5], copy: 'pauseReturn' }] }, /its own copy/],
    [{ pauses: [{ ...pauses[0], copy: 'pauseLater' }] }, /no approved copy/],
    [{ next: { ...bridge.next, afterPosition: 902 } }, /last position/],
    [{ event: { ...bridge.event, afterPosition: 904 } }, /from 1 to 903/],
    [{ event: null }, /needs its event link/],
  ];
  for (const [change, message] of cases) assert.throws(() => sectionalGuideSteps(layout(change)), message);
});

test('a smaller guide uses its own positions and needs no event or next link when it has no pause', () => {
  // The Iron Man run alone (source 16 to 33) as an 18-issue guide holding its own pause and return.
  const ironMan = {
    guideId: 'iron-man-run', positionCount: 18, markers: [],
    pauses: [{ afterPosition: 4, resumeAt: 7, title: 'Iron Man: Director of SHIELD', copy: 'pauseReturn' }],
    event: { afterPosition: 18, catalogId: 'world-war-hulk', copy: 'openEvent' },
  };
  const steps = sectionalGuideSteps(ironMan);
  assert.equal(steps.filter((step) => step.kind === 'position').length, 18);
  assert.deepEqual(steps.slice(18).map((step) => step.kind === 'return-point' ? step.position : step.kind), [
    'position', 'guide-link', 'heading', 7,
  ]);

  const plain = sectionalGuideSteps({ guideId: 'later-run', positionCount: 12 });
  assert.deepEqual(plain.map((step) => step.position), Array.from({ length: 12 }, (_, index) => index + 1));
});

// The owner-approved split of that page into 14 parts of 18 to 75 comics, 2026-11-25. Each first
// position starts a source run, so no run, collection or return group is cut.
const bridgeParts = [
  [1, 69], [70, 139], [140, 211], [212, 274], [275, 347], [348, 414], [415, 485],
  [486, 503], [504, 573], [574, 639], [640, 714], [715, 760], [761, 835], [836, 903],
].map(([first, last]) => ({ first, last }));

test('a long source splits into addable parts without moving a step, and returns lead across parts', () => {
  const parts = sectionalGuideParts(bridge, bridgeParts, {
    protectedRanges: [{ first: 479, last: 484, label: 'Silent War' }],
  });
  assert.equal(parts.length, 14);
  const unsplit = parts.flatMap((part) => part.steps).map(({ part: _part, localPosition: _local, ...step }) => step);
  assert.deepEqual(unsplit, sectionalGuideSteps(bridge));
  assert.deepEqual(parts.map((part) => part.steps.filter((step) => step.kind === 'position').length),
    [69, 70, 72, 63, 73, 67, 71, 18, 70, 66, 75, 46, 75, 68]);

  const seventh = parts[6].steps;
  const eventAt = seventh.findIndex((step) => step.kind === 'guide-link');
  assert.equal(seventh[eventAt - 1].position, 485);
  assert.deepEqual(seventh.slice(eventAt + 1).map((step) => step.kind === 'return-point'
    ? [step.part, step.localPosition, step.position] : step.copy), [
    'continueHeading', [1, 22, 22], [2, 6, 75], [3, 10, 149], [3, 31, 170], [6, 9, 356],
  ]);
  assert.equal(parts[13].steps.at(-1).copy, 'openNext');
  assert.equal(parts[8].steps[0].catalogId, 'messiah-complex');
  assert.equal(parts[12].steps[0].catalogId, 'annihilation-conquest');
  assert.equal(parts[1].steps[0].localPosition, 1);

  assert.equal(sectionalPartName('Civil War to Secret Invasion', 7), 'Civil War to Secret Invasion: Part 7');
  assert.equal(sectionalPartDescription('Wolverine #51', 'World War Hulk Prologue: World Breaker #1'),
    'Read from Wolverine #51 through World War Hulk Prologue: World Breaker #1.');

  const swap = (index, range) => bridgeParts.map((part, at) => (at === index ? range : part));
  const cases = [
    [swap(1, { first: 71, last: 139 }), /every source position once/],
    [bridgeParts.slice(0, 13), /every source position once/],
    [[{ first: 1, last: 17 }, ...swap(0, { first: 18, last: 69 })], /18 to 75 comics/],
    [bridgeParts, null],
    [swap(6, { first: 415, last: 481 }).map((part, at) => (at === 7 ? { first: 482, last: 503 } : part)), /split Silent War/],
  ];
  for (const [candidate, message] of cases) {
    const run = () => sectionalGuideParts(bridge, candidate, { protectedRanges: [{ first: 479, last: 484, label: 'Silent War' }] });
    if (message) assert.throws(run, message); else assert.doesNotThrow(run);
  }
  assert.throws(() => sectionalGuideParts(bridge, swap(10, { first: 640, last: 715 })
    .map((part, at) => (at === 11 ? { first: 716, last: 760 } : part))), /18 to 75 comics/);
});
test('a linked guide that cannot open keeps this guide open and changes no reading state', async () => {
  const state = Object.freeze({ read: Object.freeze({ 5861: 1 }) });
  const before = JSON.stringify(state);
  const [eventLink] = sectionalGuideSteps(bridge).filter((step) => step.kind === 'guide-link');
  const calls = [];
  const attempt = (open) => openLinkedGuide({ link: eventLink, currentGuideId: bridge.guideId, open: (...args) => {
    calls.push(args);
    return open();
  } });

  assert.deepEqual(await attempt(() => true), { opened: true, guideId: 'world-war-hulk', message: null });
  const failed = { opened: false, guideId: 'civil-war-to-secret-invasion', message: "This list couldn't be opened. You can keep reading this guide." };
  assert.deepEqual(await attempt(() => false), failed);
  assert.deepEqual(await attempt(() => Promise.reject(new Error('missing'))), failed);
  assert.deepEqual(await attempt(() => { throw new Error('missing'); }), failed);
  assert.deepEqual(await attempt(() => ({ ok: true })), failed);
  assert.deepEqual(calls, Array(5).fill(['world-war-hulk']));
  assert.equal(JSON.stringify(state), before);
});
