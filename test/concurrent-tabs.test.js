import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, KEY } from '../src/js/storage.js';
import { dispatchStorageEvent } from '../src/js/main.js';
import {
  SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE, createSaveEducation,
} from '../src/js/lib/saveEducation.js';
import {
  createEmptyState, createList, addIssuesToList, markRead, isRead, exportBackup, migrate,
} from '../src/js/lib/model.js';

// One storage, several stores over it, which is what two tabs on this origin actually are. The
// browser fires a storage event in every tab except the one that wrote, so notify() does the same:
// it is the listener wired in main.js, called by hand because Node has no second tab to hear from.
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    failReads: false,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) {
      if (this.failReads) throw new Error('unreadable');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function seedState() {
  let s = createList(createEmptyState(), { name: 'Hickman' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [
    { issueId: 1, title: 'One' },
    { issueId: 2, title: 'Two' },
    { issueId: 3, title: 'Three' },
  ]).state;
  return s;
}

// Deliberately tokenless, because this is what a value written before this contract existed looks
// like, and several tests below start from exactly that.
function seedRaw() {
  return JSON.stringify(exportBackup(seedState()));
}

function openTabs(storage, count) {
  const stores = [];
  for (let i = 0; i < count; i += 1) {
    const store = new Store({ storage });
    store.load();
    stores.push(store);
  }
  const notify = (writer) => {
    const raw = storage.getItem(KEY);
    for (const s of stores) if (s !== writer) s.adoptForeignWrite(raw);
  };
  return { stores, notify };
}

function savedState(storage) {
  const raw = storage.getItem(KEY);
  return raw ? migrate(JSON.parse(raw)) : createEmptyState();
}

// --------------------------------------------------------------------- the defect, reproduced

// The loss BL-084 was filed for. Two tabs, both holding the snapshot they loaded, both editing.
// Before the compare-before-write the second write replaced the whole payload, so the first tab's
// issue was simply not read any more and nothing reported it.
test('a stale tab does not overwrite what another tab saved', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  b.update((s) => markRead(s, 2, true));

  const saved = savedState(storage);
  assert.equal(isRead(saved, 1), true, "the first tab's work must survive the second tab's write");
  assert.equal(isRead(saved, 2), false, 'the stale write must not have landed');
  assert.equal(b.lastUpdateOk, false, 'and the tab that lost must be told, not left to assume');
});

test('the refused write leaves the saved data byte for byte as the other tab wrote it', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  const afterA = storage.getItem(KEY);
  b.update((s) => markRead(s, 2, true));

  assert.equal(storage.getItem(KEY), afterA, 'a refused write must not touch the key at all');
});

// The rollback that must not roll back. `previous` is the stale snapshot the refusal was about, so
// restoring it would leave the reader looking at data just established not to be saved, and every
// later edit would be refused for the same reason with no way out but a reload.
test('a refused write leaves the tab holding what is saved, not what it had', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  b.update((s) => markRead(s, 2, true));

  assert.equal(isRead(b.state, 1), true, "the refused tab must have picked up the other tab's work");
  assert.equal(isRead(b.state, 2), false, 'and must not still be showing its own unsaved edit');
});

test('a tab told it lost can make the change again and keep it', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  b.update((s) => markRead(s, 2, true));
  b.update((s) => markRead(s, 2, true));

  const saved = savedState(storage);
  assert.equal(b.lastUpdateOk, true, 'the second attempt is against fresh data and must land');
  assert.equal(isRead(saved, 1), true);
  assert.equal(isRead(saved, 2), true, 'both tabs\u2019 work is saved once the retry goes through');
});

// ------------------------------------------------------------------------- ordinary two tabs

// What the listener buys. With adoption the refusal above never fires at all: each tab edits on top
// of what is actually stored, so alternating edits accumulate instead of competing.
test('two tabs alternating edits lose nothing and never refuse a write', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b], notify } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  notify(a);
  b.update((s) => markRead(s, 2, true));
  notify(b);
  a.update((s) => markRead(s, 3, true));
  notify(a);

  const saved = savedState(storage);
  assert.equal(isRead(saved, 1), true);
  assert.equal(isRead(saved, 2), true);
  assert.equal(isRead(saved, 3), true);
  assert.equal(a.lastUpdateOk, true);
  assert.equal(b.lastUpdateOk, true, 'no write should have been refused in the ordinary case');
});

test('a tab that adopts builds its next edit on the value it adopted', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b], notify } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  notify(a);

  assert.equal(isRead(b.state, 1), true, 'the adopting tab shows the write it was told about');
  b.update((s) => markRead(s, 2, true));
  assert.equal(b.lastUpdateOk, true, 'and its own edit is no longer stale');
  assert.equal(isRead(savedState(storage), 1), true, 'so nothing was written back over');
});

test('adopting repaints, because a tab showing stale data is the visible half of this defect', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  let repaints = 0;
  const b = new Store({ storage, onChange: () => { repaints += 1; } });
  b.load();
  const a = new Store({ storage });
  a.load();

  a.update((s) => markRead(s, 1, true));
  const before = repaints;
  b.adoptForeignWrite(storage.getItem(KEY));

  assert.equal(repaints, before + 1, 'adoption must notify, or the screen keeps the old data');
});

test('production storage dispatch keeps reader data and education in their own lanes', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const education = createSaveEducation({ storage });
  education.complete();
  const readerBefore = storage.getItem(KEY);
  const readerEvents = [];
  const readerStore = { adoptForeignWrite: (raw) => readerEvents.push(raw) };
  let educationRenders = 0;

  dispatchStorageEvent(
    { key: SAVE_EDUCATION_KEY, newValue: SAVE_EDUCATION_STATE.EXPLAINING },
    { readerStore, education, renderEducation: () => { educationRenders += 1; } },
  );
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), SAVE_EDUCATION_STATE.COMPLETE);
  assert.equal(educationRenders, 1, 'a preference event must repaint its own surface');
  assert.deepEqual(readerEvents, [], 'preference traffic must never enter the reader store');
  assert.equal(storage.getItem(KEY), readerBefore, 'preference repair must not rewrite reader data');

  dispatchStorageEvent(
    { key: KEY, newValue: '{"new":"reader state"}' },
    { readerStore, education, renderEducation: () => { educationRenders += 1; } },
  );
  dispatchStorageEvent(
    { key: 'unrelated', newValue: 'anything' },
    { readerStore, education, renderEducation: () => { educationRenders += 1; } },
  );
  assert.deepEqual(readerEvents, ['{"new":"reader state"}']);
  assert.equal(educationRenders, 1);

  storage.removeItem(SAVE_EDUCATION_KEY);
  dispatchStorageEvent(
    { key: null, newValue: null },
    { readerStore, education, renderEducation: () => { educationRenders += 1; } },
  );
  assert.deepEqual(readerEvents, ['{"new":"reader state"}', null]);
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), SAVE_EDUCATION_STATE.COMPLETE);
  assert.equal(educationRenders, 2);
  assert.equal(storage.getItem(KEY), readerBefore);
});

test('three queued legacy writes cannot roll current state back through middle events', () => {
  const legacyRaw = (id, title) => JSON.stringify({
    ...createEmptyState(),
    issues: { [id]: { issueId: id, title, description: `${title} synopsis.` } },
  });
  const first = legacyRaw(1, 'One');
  const middle = legacyRaw(2, 'Two');
  const latest = legacyRaw(3, 'Three');
  const storage = fakeStorage({ [KEY]: first });
  const readerStore = new Store({ storage });
  readerStore.load();
  storage.setItem(KEY, latest);

  dispatchStorageEvent({ key: KEY, newValue: first }, { readerStore });
  dispatchStorageEvent({ key: KEY, newValue: middle }, { readerStore });
  readerStore.update((state) => ({ ...state, read: { ...state.read, 3: true } }));
  dispatchStorageEvent({ key: KEY, newValue: latest }, { readerStore });

  const durable = JSON.parse(storage.getItem(KEY));
  assert.equal('1' in durable.issues, false);
  assert.equal('2' in durable.issues, false);
  assert.equal(durable.issues[3].title, 'Three');
  assert.equal(durable.read[3], true, 'the current edit between queued events was lost');
});

test('queued legacy lineage preserves a current list and read mark before the last event', () => {
  const legacyRaw = (id, title) => JSON.stringify({
    ...createEmptyState(),
    issues: { [id]: { issueId: id, title, description: `${title} synopsis.` } },
  });
  const first = legacyRaw(1, 'One');
  const middle = legacyRaw(2, 'Two');
  const latest = legacyRaw(3, 'Three');
  const storage = fakeStorage({ [KEY]: first });
  const readerStore = new Store({ storage });
  readerStore.load();
  dispatchStorageEvent({ key: KEY, newValue: first }, { readerStore });

  storage.setItem(KEY, middle);
  storage.setItem(KEY, latest);
  dispatchStorageEvent({ key: KEY, newValue: middle }, { readerStore });
  readerStore.update((state) => {
    const created = createList(state, { name: 'Current tab list' });
    return markRead(created, 3, true);
  });
  dispatchStorageEvent({ key: KEY, newValue: latest }, { readerStore });

  const durable = JSON.parse(storage.getItem(KEY));
  assert.equal(durable.issues[3].title, 'Three');
  assert.ok(durable.read[3]);
  assert.equal(durable.lists[durable.listOrder[0]].name, 'Current tab list');
  assert.equal(readerStore.state.lists[readerStore.state.listOrder[0]].name, 'Current tab list');
  assert.equal(readerStore.lastError, null);
});

// ----------------------------------------------------------------------------- whole-state routes

test('an erase in another tab is adopted rather than written back over', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.update((s) => markRead(s, 1, true));
  a.eraseAll();
  // An erase can arrive as a removed key or a cleared origin, and both reach the listener as an
  // absent new value. This is that shape, which the stored-value shape cannot stand in for.
  storage.removeItem(KEY);
  b.adoptForeignWrite(null);

  assert.equal(b.state.listOrder.length, 0, 'the tab must hold the erase, not its own snapshot');
  b.update((s) => markRead(s, 1, true));
  assert.equal(b.lastUpdateOk, true, 'and must be able to write again afterwards');
});

test('a tab that never heard about the erase cannot write its old library back', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b] } = openTabs(storage, 2);

  a.eraseAll();
  b.update((s) => markRead(s, 1, true));

  assert.equal(b.lastUpdateOk, false, 'the stale write must be refused');
  assert.equal(savedState(storage).listOrder.length, 0, 'the erase must still be what is saved');
});

test('a restore in one tab is adopted by the other', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const { stores: [a, b], notify } = openTabs(storage, 2);

  let other = createList(createEmptyState(), { name: 'Replacement' });
  other = addIssuesToList(other, other.listOrder[0], [{ issueId: 42, title: 'Different' }]).state;
  assert.equal(a.restore(JSON.stringify(exportBackup(other))).ok, true);
  notify(a);

  assert.deepEqual(
    Object.values(b.state.lists).map((l) => l.name), ['Replacement'],
    'the other tab shows the restored library',
  );
  b.update((s) => markRead(s, 42, true));
  assert.equal(b.lastUpdateOk, true, 'and its next edit is against the restore, so it lands');
});

// A restore stamps its own token, so the tab that restored is not left comparing against what it
// read at boot and refusing its own next edit.
test('the tab that restored can still write afterwards', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();

  let other = createList(createEmptyState(), { name: 'Replacement' });
  other = addIssuesToList(other, other.listOrder[0], [{ issueId: 42, title: 'Different' }]).state;
  assert.equal(store.restore(JSON.stringify(exportBackup(other))).ok, true);
  store.update((s) => markRead(s, 42, true));

  assert.equal(store.lastUpdateOk, true);
  assert.equal(isRead(savedState(storage), 42), true);
});

// ------------------------------------------------------------------------------ the blocked tab

test('a blocked tab neither adopts a foreign write nor stops being blocked', () => {
  const storage = fakeStorage({ [KEY]: '{ this is not valid json' });
  const blocked = new Store({ storage });
  blocked.load();
  assert.equal(blocked.blocked, true, 'precondition: the unreadable value latched the store');

  const adopted = blocked.adoptForeignWrite(seedRaw());

  assert.equal(adopted, false, 'the latch is protecting a salvage copy and must not lift itself');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.state.listOrder.length, 0, 'and its screen must not change under it');
});

test('a value another tab wrote that will not parse is declined rather than adopted', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();

  const adopted = store.adoptForeignWrite('{ not json either');

  assert.equal(adopted, false);
  assert.equal(store.blocked, false, 'this is not this tab\u2019s incident to latch on');
  assert.equal(store.state.listOrder.length, 1, 'and its own data stays on screen');
});

// ------------------------------------------------------------------------------- the edges

// The upgrade path. A value written before this contract carries no token, and a tab that read it
// expects none, so the two agree and the write goes through. Without this every existing install
// would have refused its first edit.
test('a saved value with no token is written to rather than refused', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();

  store.update((s) => markRead(s, 1, true));

  assert.equal(store.lastUpdateOk, true);
  assert.equal(isRead(savedState(storage), 1), true);
});

test('a first ever write, with nothing saved at all, is not refused', () => {
  const storage = fakeStorage();
  const store = new Store({ storage });
  store.load();

  store.update(() => markRead(seedState(), 1, true));

  assert.equal(store.lastUpdateOk, true);
  assert.equal(isRead(savedState(storage), 1), true);
});

test('every write is named differently, so no two writes are mistaken for each other', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();

  store.update((s) => markRead(s, 1, true));
  const first = JSON.parse(storage.getItem(KEY)).writeToken;
  store.update((s) => markRead(s, 2, true));
  const second = JSON.parse(storage.getItem(KEY)).writeToken;

  assert.equal(typeof first, 'string');
  assert.notEqual(first, '', 'an empty token would compare equal to a value that has none');
  assert.notEqual(first, second, 'two writes must be distinguishable');
});

// The token is written first so the check can read a bounded prefix instead of parsing the whole
// payload, which at this origin's ceiling is the difference between free and doubling every write.
test('the token is the first key of the stored value', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();

  store.update((s) => markRead(s, 1, true));

  assert.equal(Object.keys(JSON.parse(storage.getItem(KEY)))[0], 'writeToken');
  assert.match(storage.getItem(KEY).slice(0, 128), /^\{"writeToken":"[^"]+"/);
});

// The token belongs to the stored value alone. No file on disk changes shape, so BL-085's restore
// validation has nothing new to consider and no backup taken before this item reads differently.
test('a downloaded backup carries no token', () => {
  assert.equal(Object.hasOwn(exportBackup(seedState()), 'writeToken'), false);
  assert.equal(
    Object.hasOwn(migrate(JSON.parse(JSON.stringify({ writeToken: 'x', ...exportBackup(seedState()) }))), 'writeToken'),
    false,
    'and one arriving in a hand-edited file is dropped rather than carried into state',
  );
});

// A read that fails is not a licence to write. What is stored is unknown, and the only certain thing
// about the write is that it would replace it, so this refuses in the direction load() latches in.
test('a storage that will not say what it holds is not written over', () => {
  const storage = fakeStorage({ [KEY]: seedRaw() });
  const store = new Store({ storage });
  store.load();
  const before = storage.getItem(KEY);
  storage.failReads = true;

  store.update((s) => markRead(s, 1, true));

  storage.failReads = false;
  assert.equal(store.lastUpdateOk, false);
  assert.equal(storage.getItem(KEY), before, 'the saved data must be exactly as it was');
});

// ------------------------------------------------------- the escape hatch out of the blocked tab

// The jam this contract created and BL-084's review found. A blocked store never adopts, so its
// token is fixed for as long as it lives, and startFresh() writes through persist(). Once any other
// tab wrote, every press was refused, forever, while the banner went on telling the reader to press
// it. Both tabs are blocked in the natural case, because the value neither can read is the shared
// one, so one of them starting fresh is the ordinary way to reach this.
test('the escape from a blocked tab is not jammed by another tab having taken it first', () => {
  const storage = fakeStorage({ [KEY]: '{ CORRUPT not json' });
  const a = new Store({ storage });
  const b = new Store({ storage });
  a.load();
  b.load();
  assert.equal(a.blocked && b.blocked, true, 'precondition: one unreadable value latched both');

  assert.equal(b.startFresh(), true, 'the reader takes the offer in the tab they are looking at');

  assert.equal(a.startFresh(), false, 'and in the other tab it declines, rather than erasing');
  assert.equal(a.blocked, false, 'because the value it could not read is gone and this one reads');
  assert.equal(a.blockedReason, null, 'so the banner it was pressing from comes down');
  assert.match(a.lastError, /^Another tab replaced the data this tab could not read, and the new/);
});

// The harm the jam was hiding. startFresh() salvages and then clears, and neither step is safe once
// the value has been replaced: the clear would erase whatever the other tab put there. A refusal
// inside persist() arrives after the copy has already been taken, which is why the check is at the
// top of the call instead.
//
// A guard rather than evidence, and it says so because it passes on the unfixed module: the jam
// prevented the erase there, for a reason that had nothing to do with wanting the data kept. What
// it pins is that the data survives however the withdrawal is arrived at. The test above it is the
// one that fails without the fix.
test('starting fresh does not erase the library another tab made while this tab was blocked', () => {
  const storage = fakeStorage({ [KEY]: '{ CORRUPT not json' });
  const a = new Store({ storage });
  const b = new Store({ storage });
  a.load();
  b.load();
  b.startFresh();
  b.update((s) => createList(s, { name: 'Rebuilt by hand' }));

  b.update((s) => markRead(addIssuesToList(s, s.listOrder[0], [{ issueId: 2, title: 'Two' }]).state, 2, true));

  assert.equal(a.startFresh(), false);

  const saved = savedState(storage);
  assert.equal(saved.listOrder.length, 1, 'the other tab\u2019s list is still there');
  assert.equal(isRead(saved, 2), true, 'and so is what was read in it');
});

// The second-order harm. salvage() re-points salvageKey at whatever the main key holds now, so a
// press that got as far as salvaging handed "Download a copy" the other tab's readable data under
// the name of this tab's unreadable incident.
test('starting fresh does not file another tab\u2019s data as this tab\u2019s unreadable copy', () => {
  const storage = fakeStorage({ [KEY]: '{ CORRUPT not json' });
  const a = new Store({ storage });
  const b = new Store({ storage });
  a.load();
  b.load();
  const atBoot = a.salvagedRaw();
  b.startFresh();
  b.update((s) => createList(s, { name: 'Rebuilt by hand' }));

  a.startFresh();

  assert.equal(a.salvagedRaw(), atBoot, 'the copy on offer is still the data that would not read');
});

// The other direction, and the reason re-reading is the response rather than an exemption. When the
// replacement will not read either, the tab re-latches on it, but with the token that belongs to it,
// so the button works on the next press instead of being refused for the rest of the session.
test('a blocked tab can start fresh on the press after the one that withdrew', () => {
  const storage = fakeStorage({ [KEY]: '{ CORRUPT not json' });
  const stale = new Store({ storage });
  stale.load();
  // A newer build of the app in the other tab, which is the case load() names: a valid, stamped
  // value this build refuses, so the replacement latches the tab exactly as the first value did.
  storage.setItem(KEY, JSON.stringify({
    writeToken: 'a-token-a-newer-build-wrote',
    ...exportBackup(seedState()),
    schemaVersion: 99,
  }));

  assert.equal(stale.startFresh(), false, 'the first press withdraws, because the premise moved');
  assert.equal(stale.blocked, true, 'and the new value latches it just as the old one did');
  assert.match(stale.lastError, /so try again\.$/);

  assert.equal(stale.startFresh(), true, 'the press the message asks for works');
  assert.equal(stale.blocked, false);
  assert.equal(savedState(storage).listOrder.length, 0);
});

// conflicted said which rollback update() should take, and only update() cleared it. A refusal
// raised for startFresh() therefore outlived its call, and the next ordinary edit, refused by the
// blocked latch for a reason that is not a conflict at all, read the leftover true and rolled back
// by re-reading. That cleared the latch, so an unrelated edit tore down the recovery banner and the
// store started saving again on the strength of a flag left behind by a different call.
test('a refusal raised for one call is not inherited by the next', () => {
  const storage = fakeStorage({ [KEY]: '{ CORRUPT not json' });
  const a = new Store({ storage });
  const b = new Store({ storage });
  a.load();
  b.load();
  b.startFresh();
  a.startFresh();
  a.blocked = true; // the reader ignored the message and carried on in the tab still showing it
  a.blockedReason = 'Could not read your saved data (x).';

  a.update((s) => createList(s, { name: 'Anything' }));

  assert.equal(a.blocked, true, 'a refused edit must not lift the latch');
  assert.equal(a.blockedReason, 'Could not read your saved data (x).', 'nor take the banner down');
  assert.equal(a.lastUpdateOk, false);
});
