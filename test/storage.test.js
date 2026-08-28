import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, KEY } from '../src/js/storage.js';
import { createEmptyState, createList, addIssuesToList, markRead, isRead, exportBackup } from '../src/js/lib/model.js';

// Minimal localStorage stand-in. `failWrites` simulates a full quota; `failKey` fails only
// writes to one key, which is the realistic near-quota shape: copying the whole state aside
// doubles the footprint and throws, while overwriting it with a small empty state succeeds.
// `writes` records the keys that were actually written, which is how the salvage tests count
// copies: the archive key carries a timestamp, so boots inside one millisecond collide on it and
// leave a single key holding the last of several writes.
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    failWrites: false,
    failKey: null,
    // A cleanup that throws and a read that throws are the two stages the write flags cannot
    // reach, and they are the stages the restore reconciliation exists for.
    failRemoveKey: null,
    failReadKey: null,
    // A storage that stops answering reads does not stop for one key, and a setItem can report a
    // success it did not have. Neither shape can be made with the key-scoped flags above, and both
    // are what the restore reconciliation is for.
    failReads: false,
    silentKey: null,
    // The removal counterpart of silentKey, and the only shape that reaches the read-back in
    // forgetPreRestore(). A removeItem that throws is caught before the read-back runs, so a
    // removal that reports a success it did not have is what actually holds that line in place.
    silentRemoveKey: null,
    writes: [],
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) {
      if (this.failReads) throw new Error('unreadable');
      if (this.failReadKey && k.startsWith(this.failReadKey)) throw new Error('unreadable');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (this.failWrites || (this.failKey && k.startsWith(this.failKey))) {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      this.writes.push(k);
      if (this.silentKey && k.startsWith(this.silentKey)) return;
      map.set(k, String(v));
    },
    removeItem(k) {
      if (this.failRemoveKey && k.startsWith(this.failRemoveKey)) throw new Error('locked');
      if (this.silentRemoveKey && k.startsWith(this.silentRemoveKey)) return;
      map.delete(k);
    },
  };
}

function goodBackup() {
  let s = createList(createEmptyState(), { name: 'Hickman' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [{ issueId: 1, title: 'One' }, { issueId: 2, title: 'Two' }]).state;
  s = markRead(s, 1, true);
  return JSON.stringify(exportBackup(s));
}

// ---------------------------------------------------------------- the data-loss regression

// This is the defect that mattered most: a failed load fell back to empty state, and the very
// next user action persisted that empty state over the intact original. Reading must never be
// able to destroy.
test('unreadable saved data is never overwritten by subsequent edits', () => {
  const original = goodBackup();
  const storage = fakeStorage({ [KEY]: '{ this is not valid json' });
  const store = new Store({ storage });

  store.load();
  assert.equal(store.blocked, true, 'the store must latch read-only');
  // Shape rather than wording, because the reason inside the brackets is V8's and moves
  // between releases. What the reassurance and the instructions became is held by
  // test/recovery-copy.test.js: they are the banner's copy now, not this string's.
  assert.match(store.blockedReason, /^Could not read your saved data \(.+\)\.$/);

  // Simulate the user carrying on regardless.
  store.update((s) => createList(s, { name: 'New list' }));
  store.update((s) => markRead(s, 99, true));

  assert.equal(storage.getItem(KEY), '{ this is not valid json',
    'the unreadable original must still be on disk, untouched');
  assert.ok(storage.getItem('mrt.state.salvage'), 'a salvage copy must exist');
  assert.equal(store.salvagedRaw(), '{ this is not valid json');

  // And the same must hold for the realistic trigger: a schema from a newer build.
  const newer = fakeStorage({ [KEY]: JSON.stringify({ schemaVersion: 99, lists: {} }) });
  const s2 = new Store({ storage: newer });
  s2.load();
  assert.equal(s2.blocked, true);
  s2.update((s) => createList(s, { name: 'x' }));
  assert.equal(JSON.parse(newer.getItem(KEY)).schemaVersion, 99, 'newer-schema data must survive');

  void original;
});

test('start fresh is the only way out, and it is deliberate', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt' });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true);

  assert.equal(store.startFresh(), true);
  assert.equal(store.blocked, false);
  assert.equal(store.lastError, null);
  assert.equal(store.blockedReason, null, 'and the reason goes with the block');
  assert.equal(storage.getItem('mrt.state.salvage'), 'corrupt', 'the original is still recoverable');

  // Saving works again.
  store.update((s) => createList(s, { name: 'Fresh' }));
  assert.equal(JSON.parse(storage.getItem(KEY)).listOrder.length, 1);
});

test('a second failed load does not clobber the first salvage copy', () => {
  const storage = fakeStorage({ [KEY]: 'original-corrupt' });
  const store = new Store({ storage });
  store.load();
  storage.setItem(KEY, 'later-and-worse');
  store.load();
  assert.equal(storage.getItem('mrt.state.salvage'), 'original-corrupt');
});

// ---------------------------------------------------------------- recovery-path regressions

// The escape hatch must not be able to destroy the thing it exists to protect. Copying the
// state doubles this origin's footprint, so a state near the quota is exactly the case where
// the salvage write throws, and that is precisely when the banner is telling the user to
// press "Start fresh".
test('start fresh refuses when no copy of the unreadable data survives', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt-and-precious' });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true);

  storage.map.delete('mrt.state.salvage'); // the boot-time salvage did not land
  storage.failWrites = true;

  assert.equal(store.startFresh(), false, 'must refuse without a verified copy');
  assert.equal(store.blocked, true, 'and must stay latched');
  assert.equal(storage.getItem(KEY), 'corrupt-and-precious', 'the original must survive');
  assert.match(store.lastError, /Download a copy/i);
});

// ...but refusing must not be a dead end. Once the user has saved the file themselves, the
// hatch has to open even though storage is still too full to hold a second copy.
test('start fresh proceeds once the user has downloaded a copy themselves', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt' });
  storage.failKey = 'mrt.state.salvage';
  const store = new Store({ storage });
  store.load();

  assert.equal(store.blocked, true);
  assert.equal(storage.getItem('mrt.state.salvage'), null, 'the copy could not be made');
  assert.equal(store.salvagedRaw(), 'corrupt', 'so the download falls back to the live value');
  assert.equal(store.startFresh(), false, 'and the blind hatch stays shut');

  assert.equal(store.startFresh({ confirmedDownloaded: true }), true);
  assert.equal(store.blocked, false);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).listOrder, []);
});

// A stale salvage from an old incident must not be presented as the current data, and must not
// stop the current incident from being saved.
test('a second, unrelated incident is salvaged and offered accurately', () => {
  const storage = fakeStorage({ [KEY]: 'incident-one' });
  const first = new Store({ storage });
  first.load();
  assert.equal(storage.getItem('mrt.state.salvage'), 'incident-one');

  // Months later: the user has resolved incident one and accumulated real progress, which then
  // becomes unreadable in its own right.
  storage.setItem(KEY, 'months-of-real-progress-now-unreadable');
  const second = new Store({ storage });
  second.load();

  assert.equal(second.blocked, true);
  assert.equal(second.salvagedRaw(), 'months-of-real-progress-now-unreadable',
    'the user must be offered THIS incident, not the old blob');
  assert.equal(storage.getItem('mrt.state.salvage'), 'incident-one',
    'and the earlier copy must not be clobbered');

  const archived = [...storage.map.entries()]
    .filter(([k]) => k.startsWith('mrt.state.salvage.'))
    .map(([, v]) => v);
  assert.deepEqual(archived, ['months-of-real-progress-now-unreadable']);

  assert.equal(second.startFresh(), true);
  assert.ok([...storage.map.values()].includes('months-of-real-progress-now-unreadable'),
    'a copy must still exist after starting fresh');
});

// A blocked page is a page the reader reloads, and the archive key carried the time of the write,
// so the choice of where the copy goes was remade from scratch on every boot and each one wrote
// the identical bytes under a new name.
//
// Counting writes rather than keys is the point of the assertion. Three boots inside one
// millisecond collide on Date.now() and leave one key holding the last of three writes, so a test
// that counted keys would pass on the broken code whenever it ran fast enough, which in a unit test
// is always.
test('reloading during a second incident does not copy the same bytes aside again', () => {
  const storage = fakeStorage({ [KEY]: 'incident-one' });
  new Store({ storage }).load();

  storage.setItem(KEY, 'months-of-real-progress-now-unreadable');
  storage.writes.length = 0;

  for (let i = 0; i < 3; i += 1) new Store({ storage }).load();

  assert.equal(storage.writes.length, 1,
    'three boots must set the bytes aside once between them, not once each');
  assert.equal(
    [...storage.map.values()].filter((v) => v === 'months-of-real-progress-now-unreadable').length,
    2,
    'the live value and exactly one copy of it',
  );
  assert.equal(storage.getItem('mrt.state.salvage'), 'incident-one',
    'and the earlier incident is still there');
});

// startFresh() salvages before it clears, so on a second incident the reader's own recovery step
// archived another copy of what the boot they were looking at had already archived.
test('starting fresh during a second incident adds no copy of its own', () => {
  const storage = fakeStorage({ [KEY]: 'incident-one' });
  new Store({ storage }).load();
  storage.setItem(KEY, 'months-of-real-progress-now-unreadable');

  const store = new Store({ storage });
  store.load();
  const copyKey = store.salvageKey;
  storage.writes.length = 0;

  assert.equal(store.startFresh(), true);

  assert.deepEqual(storage.writes, [KEY],
    'the only write is the empty state, not another copy alongside it');
  assert.equal(storage.getItem(copyKey), 'months-of-real-progress-now-unreadable',
    'and the copy the reader was promised survives');
});

// The case that makes the repeat a defect rather than housekeeping. Near the quota the copy cannot
// be written a second time, and answering "does a copy exist" by trying to write one confuses that
// question with "can one be written now". The copy from the previous boot was on disk throughout,
// while the hatch refused and told the reader nothing had been set aside.
test('start fresh uses the copy a previous boot already made rather than refusing', () => {
  const storage = fakeStorage({ [KEY]: 'incident-one' });
  new Store({ storage }).load();
  storage.setItem(KEY, 'months-of-real-progress-now-unreadable');

  new Store({ storage }).load(); // the boot with room, which archives the copy
  storage.failKey = 'mrt.state.salvage'; // and now there is no room for another

  const store = new Store({ storage });
  store.load();
  assert.ok(store.salvageKey, 'the copy on disk must be found, not written over');
  assert.equal(store.salvagedRaw(), 'months-of-real-progress-now-unreadable');

  assert.equal(store.startFresh(), true, 'the reader must not be refused their own escape hatch');
  assert.equal(store.blocked, false);
  assert.ok([...storage.map.values()].includes('months-of-real-progress-now-unreadable'),
    'and the copy outlives the clearing');
});

// The seven below guard boundaries the adopting introduces. Unlike the three above they pass on
// the old code too, because they are not reproductions of the defect: they pin down what may be
// adopted, so that a later change cannot widen it into serving one incident's bytes for another.

// Enumeration is an addition to this question, never a replacement for it. The shipped code asked
// the main slot directly and wrote nothing when it already held these bytes, and that answer needed
// no walk at all. Routing the whole question through the walk regressed exactly this: on a storage
// with no enumeration the copy in hand went unrecognised and a duplicate was written where the
// shipped code wrote none. Measured before it was fixed, on this storage: 1 write against 0.
test('a copy already in the main slot is recognised without enumerating', () => {
  const bare = new Map([[KEY, 'corrupt-and-precious'], ['mrt.state.salvage', 'corrupt-and-precious']]);
  let writes = 0;
  const store = new Store({
    storage: {
      getItem: (k) => (bare.has(k) ? bare.get(k) : null),
      setItem: (k, v) => { writes += 1; bare.set(k, String(v)); },
      removeItem: (k) => bare.delete(k),
    },
  });

  assert.equal(store.salvage(), true);
  assert.equal(writes, 0);
  assert.equal(store.salvageKey, 'mrt.state.salvage');
  assert.equal(bare.size, 2);
});

// The same regression at the point where it costs the reader something. A duplicate write that is
// merely wasteful when there is room is a refusal when there is not, because the failed write is
// what makes salvage() answer false and startFresh() turn down the only way out. The shipped code
// never attempted that write, so it never had to succeed.
test('start fresh is not refused on a storage that cannot be enumerated', () => {
  const bare = new Map([[KEY, 'corrupt-and-precious'], ['mrt.state.salvage', 'corrupt-and-precious']]);
  const store = new Store({
    storage: {
      getItem: (k) => (bare.has(k) ? bare.get(k) : null),
      setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
      removeItem: (k) => bare.delete(k),
    },
  });

  assert.equal(store.salvage(), true);
  assert.equal(store.salvageKey, 'mrt.state.salvage');
  assert.equal(store.salvagedRaw(), 'corrupt-and-precious');
});

// Identity here is byte identity, deliberately, and never the clock. A dated copy holding some
// other incident is not this incident's copy however recently it was written.
test('a dated copy of a different incident is never adopted for this one', () => {
  const storage = fakeStorage({
    [KEY]: 'incident-three',
    'mrt.state.salvage': 'incident-one',
    'mrt.state.salvage.111': 'incident-two',
  });
  const store = new Store({ storage });

  assert.equal(store.salvage(), true);
  assert.notEqual(store.salvageKey, 'mrt.state.salvage.111');
  assert.equal(storage.getItem(store.salvageKey), 'incident-three');
  assert.equal(storage.getItem('mrt.state.salvage.111'), 'incident-two',
    'and the incident it does hold is untouched');
  assert.equal(storage.getItem('mrt.state.salvage'), 'incident-one');
});

// Only the salvage family may be adopted. restore() overwrites the pre-restore slot, so a copy
// found there is not one this store may promise to still be holding later.
test('the pre-restore snapshot is never adopted as a salvage copy', () => {
  const storage = fakeStorage({ [KEY]: 'live-bytes', 'mrt.state.prerestore': 'live-bytes' });
  const store = new Store({ storage });

  assert.equal(store.salvage(), true);
  assert.equal(store.salvageKey, 'mrt.state.salvage');
  assert.equal(storage.getItem('mrt.state.salvage'), 'live-bytes');
});

// Looking for an existing copy is an optimisation, and an optimisation must never be the reason a
// recovery is refused. A storage that cannot be enumerated answers "no copy", which is the answer
// that leads to writing one.
test('a storage that cannot be enumerated still gets a copy', () => {
  const bare = new Map([[KEY, 'corrupt-and-precious']]);
  const store = new Store({
    storage: {
      getItem: (k) => (bare.has(k) ? bare.get(k) : null),
      setItem: (k, v) => bare.set(k, String(v)),
      removeItem: (k) => bare.delete(k),
    },
  });

  assert.equal(store.salvage(), true);
  assert.equal(bare.get('mrt.state.salvage'), 'corrupt-and-precious');
});

// An absent enumeration API is not the only way this fails, and the two do not share a path: with no
// `length` the loop is never entered, so the case above exercises the `?? 0` fallback and never
// reaches the catch. Measured by removing the catch and letting the throw escape: the suite stayed at
// 599 pass, 0 fail, so nothing covered it. It matters because that throw would escape into salvage()'s
// own catch, which returns false, and a false there is what makes startFresh() refuse the reader the
// only way out they have.
test('a storage that throws when asked to enumerate still gets a copy', () => {
  const bare = new Map([[KEY, 'corrupt-and-precious']]);
  const store = new Store({
    storage: {
      get length() { throw new Error('enumeration denied'); },
      key: () => null,
      getItem: (k) => (bare.has(k) ? bare.get(k) : null),
      setItem: (k, v) => bare.set(k, String(v)),
      removeItem: (k) => bare.delete(k),
    },
  });

  assert.equal(store.salvage(), true);
  assert.equal(store.salvageKey, 'mrt.state.salvage');
  assert.equal(bare.get('mrt.state.salvage'), 'corrupt-and-precious');
});

// Throwing at the second key rather than at `length` is a third path: the walk has begun and a
// partial answer is on the table, so the code has to discard it rather than treat what it saw as the
// whole story. Answering "none" from a partial walk is safe in the one direction that matters, since
// it writes a copy that may duplicate one it never reached, and never adopts one it cannot confirm.
test('a storage that throws part way through enumeration still gets a copy', () => {
  const bare = new Map([['mrt.state.salvage.older', 'another-incident'], [KEY, 'corrupt-and-precious']]);
  const store = new Store({
    storage: {
      length: 2,
      key: (i) => {
        if (i > 0) throw new Error('gone mid-walk');
        return 'mrt.state.salvage.older';
      },
      getItem: (k) => (bare.has(k) ? bare.get(k) : null),
      setItem: (k, v) => bare.set(k, String(v)),
      removeItem: (k) => bare.delete(k),
    },
  });

  assert.equal(store.salvage(), true);
  assert.equal(store.salvageKey, 'mrt.state.salvage');
  assert.equal(bare.get('mrt.state.salvage'), 'corrupt-and-precious');
  assert.equal(bare.get('mrt.state.salvage.older'), 'another-incident');
});

// The archive exists so one incident's copy cannot destroy another's, and the timestamp alone did
// not deliver that. startFresh() salvages before it clears, so when another tab rewrites the live
// key between the boot and the button, the second write lands in the same millisecond as the first
// and took the same name. The copy the reader had already been promised was overwritten by it.
//
// This is a clobber, so counting writes is not enough here: both trees write twice. What separates
// them is how many copies survive.
test('a second copy taken in the same millisecond does not overwrite the first', () => {
  const storage = fakeStorage({ [KEY]: 'incident-one' });
  new Store({ storage }).load();
  storage.setItem(KEY, 'incident-two');

  const store = new Store({ storage });
  store.load();
  const firstCopy = store.salvageKey;
  assert.equal(storage.getItem(firstCopy), 'incident-two');

  // Another tab of the same origin writes the live key while this one sits blocked.
  storage.setItem(KEY, 'incident-three-from-another-tab');
  assert.equal(store.startFresh(), true);

  const archived = [...storage.map.entries()]
    .filter(([k]) => k.startsWith('mrt.state.salvage.'))
    .map(([, v]) => v);
  assert.equal(archived.length, 2, 'both archived copies must survive, not one on top of the other');
  assert.ok(archived.includes('incident-two'), 'the copy the reader was already promised');
  assert.ok(archived.includes('incident-three-from-another-tab'), 'and the one taken on the way out');
  assert.equal(storage.getItem('mrt.state.salvage'), 'incident-one',
    'and the first incident is still in the main slot');
});

// ------------------------------------------------- what is kept, and how it stops being kept

// The reader can see what is held on their behalf. Everything before this item kept copies for
// ever and showed them nothing, so the first they would learn of the accumulation was a write
// failing. The list is read from storage on every call rather than cached, because another tab
// can have added or removed one since this one booted.
test('the copies being kept are listed newest first, with the undated one last', () => {
  const storage = fakeStorage({
    'mrt.state.salvage': 'first-incident',
    // A device whose clock never started reports the epoch, and it is the one stamp that separates
    // "no date recorded" from a date: null coerces to 0 in arithmetic, so every other value orders
    // an undated copy correctly by accident rather than by the sentinel that is written to do it.
    'mrt.state.salvage.0': 'dead-clock-incident',
    'mrt.state.salvage.2000': 'second-incident',
    'mrt.state.salvage.9000': 'third-incident',
    [KEY]: 'live',
    'mrt.state.prerestore': 'not-a-salvage-copy',
  });
  const copies = new Store({ storage }).salvageCopies();

  assert.deepEqual(copies.map((c) => c.key), [
    'mrt.state.salvage.9000',
    'mrt.state.salvage.2000',
    'mrt.state.salvage.0',
    'mrt.state.salvage',
  ], 'the pre-restore snapshot and the live key are not copies, and the undated one cannot claim to be newer than the epoch');
  assert.deepEqual(copies.map((c) => c.at), [9000, 2000, 0, null]);
  assert.equal(copies[0].chars, 'third-incident'.length);
});

// A collision suffix is still that copy's timestamp. Reporting the whole suffix as the date would
// have produced a date in the far future for the one case freeArchiveKey exists to handle.
test('a copy whose name carries a collision suffix still reports its own date', () => {
  const storage = fakeStorage({ 'mrt.state.salvage.1700000000000.3': 'collided' });
  assert.equal(new Store({ storage }).salvageCopies()[0].at, 1700000000000);
});

// Three answers, not two. "This browser will not say" is not "there is nothing", and a reader
// whose copies are all still on disk must never be shown an empty list.
test('a storage that cannot be enumerated is distinguished from one holding nothing', () => {
  const empty = fakeStorage();
  assert.deepEqual(new Store({ storage: empty }).salvageCopies(), [], 'nothing kept');

  const opaque = fakeStorage({ 'mrt.state.salvage': 'held' });
  Object.defineProperty(opaque, 'length', { get() { throw new Error('denied'); } });
  assert.equal(new Store({ storage: opaque }).salvageCopies(), null, 'declined to say, which is not the same answer');
});

// Listing what is kept must not spend the budget it is reporting on. This is the one screen whose
// subject is running out of room, so a write here would be the defect it exists to describe.
test('listing the copies writes nothing', () => {
  const storage = fakeStorage({ 'mrt.state.salvage': 'held', 'mrt.state.salvage.4000': 'also-held' });
  const store = new Store({ storage });
  storage.writes.length = 0;
  store.salvageCopies();
  store.salvageRawAt('mrt.state.salvage');
  assert.deepEqual(storage.writes, []);
});

// The key arrives from the screen rather than from inside the module, so both readers of it guard
// the family. Without the guard these two methods hand back and delete the live state.
test('a key outside the salvage family is neither read back nor removed', () => {
  const storage = fakeStorage({ [KEY]: 'live', 'mrt.state.prerestore': 'snapshot' });
  const store = new Store({ storage });

  assert.equal(store.salvageRawAt(KEY), null);
  assert.equal(store.salvageRawAt('mrt.state.prerestore'), null);
  assert.equal(store.forgetSalvage(KEY), false);
  assert.equal(store.forgetSalvage('mrt.state.prerestore'), false);
  assert.equal(store.forgetSalvage(null), false);
  assert.equal(storage.getItem(KEY), 'live', 'the live state is untouched');
  assert.equal(storage.getItem('mrt.state.prerestore'), 'snapshot', 'so is the undo snapshot');
});

test('a copy the reader asks to remove is removed, and the rest are left alone', () => {
  const storage = fakeStorage({ 'mrt.state.salvage': 'keep-me', 'mrt.state.salvage.5000': 'remove-me' });
  const store = new Store({ storage });

  assert.equal(store.forgetSalvage('mrt.state.salvage.5000'), true);
  assert.equal(storage.getItem('mrt.state.salvage.5000'), null);
  assert.equal(storage.getItem('mrt.state.salvage'), 'keep-me');
});

// The copy of the incident that is blocking saving right now is the one the banner is telling the
// reader to download or start fresh from. Removing it is the only action on this screen that could
// leave them with nothing, so it is refused here as a backstop and not offered on screen at all.
test('the copy of the incident still blocking saving is refused', () => {
  const storage = fakeStorage({ [KEY]: 'unreadable' });
  const store = new Store({ storage });
  store.load();

  assert.equal(store.blocked, true);
  const live = store.salvageKey;
  assert.equal(store.salvageCopies().find((c) => c.key === live).live, true, 'and the screen is told which one it is');
  assert.equal(store.forgetSalvage(live), false);
  assert.equal(storage.getItem(live), 'unreadable', 'the reader is not left with nothing');
});

// Once the block is resolved that same copy is the reader's to remove. Refusing it for ever would
// have made the only copy the item is about the one copy that can never be cleared.
test('the same copy can be removed once the block is resolved', () => {
  const storage = fakeStorage({ [KEY]: 'unreadable' });
  const store = new Store({ storage });
  store.load();
  const live = store.salvageKey;
  assert.equal(store.startFresh(), true);

  assert.equal(store.blocked, false);
  assert.equal(store.forgetSalvage(live), true);
  assert.equal(storage.getItem(live), null);
  assert.equal(store.salvageKey, null, 'and the store stops naming a copy that is gone');
});

// removeItem can be a no-op behind a storage that reports a success it did not have. Telling the
// reader a copy is gone when it is still there is the one error this screen must not make.
test('a removal that did not take is reported as a failure', () => {
  const storage = fakeStorage({ 'mrt.state.salvage': 'stubborn' });
  storage.removeItem = () => {};
  assert.equal(new Store({ storage }).forgetSalvage('mrt.state.salvage'), false);

  const throwing = fakeStorage({ 'mrt.state.salvage': 'stubborn' });
  throwing.removeItem = () => { throw new Error('denied'); };
  assert.equal(new Store({ storage: throwing }).forgetSalvage('mrt.state.salvage'), false);
});

// Two tabs are two Store instances over one storage, and blocked and salvageKey are per instance.
// A tab that read the data before it went bad has neither set, so before this was derived from
// storage that tab alone offered Remove on the copy the other tab was blocked on, and its next
// ordinary edit overwrote the original the copy was the last record of.
test('a tab that is not blocked still protects the copy another tab is blocked on', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const readable = new Store({ storage });
  readable.load();
  assert.equal(readable.blocked, false, 'this tab read the data and knows nothing of what follows');

  const unreadable = JSON.stringify({ schemaVersion: 99 });
  storage.setItem(KEY, unreadable);
  const blocked = new Store({ storage });
  blocked.load();
  const live = blocked.salvageKey;
  assert.equal(blocked.blocked, true);

  assert.equal(readable.salvageCopies().find((c) => c.key === live).live, true, 'the screen in the other tab must not offer it');
  assert.equal(readable.forgetSalvage(live), false, 'and the backstop must not agree with a screen that did');
  assert.equal(storage.getItem(live), unreadable, 'the copy survives the tab that could not see why it mattered');
});

// The protection is the copy matching what the main slot holds, so it lifts by itself the moment
// the main slot holds something else. Any tab starting fresh or restoring achieves that, which is
// why no tab has to be told that another one resolved the block.
test('the protection lifts for a bystander tab once the main slot holds something else', () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify({ schemaVersion: 99 }) });
  const blocked = new Store({ storage });
  blocked.load();
  const live = blocked.salvageKey;

  // Never loaded, so blocked is false and salvageKey is null: the shape a tab open since before
  // the data went bad is in, and the only shape the in-memory check cannot speak for.
  const bystander = new Store({ storage });
  assert.equal(bystander.forgetSalvage(live), false, 'while the unreadable data is still in the main slot');

  assert.equal(blocked.startFresh(), true);
  assert.equal(bystander.salvageCopies().find((c) => c.key === live).live, false, 'it needed no telling');
  assert.equal(bystander.forgetSalvage(live), true);
  assert.equal(storage.getItem(live), null);
});

test('update reports whether the change was actually saved', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();

  store.update((s) => createList(s, { name: 'Saved' }));
  assert.equal(store.lastUpdateOk, true);

  storage.failWrites = true;
  const before = store.state;
  store.update((s) => createList(s, { name: 'Not saved' }));
  assert.equal(store.lastUpdateOk, false, 'callers must be able to suppress the success message');
  assert.equal(store.state, before, 'and the change must be rolled back');
});

test('a clean load leaves the store writable', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, false);
  assert.equal(store.lastError, null);
  assert.ok(isRead(store.state, 1), 'existing progress must survive a normal load');
});

test('an empty storage is a first run, not a failure', () => {
  const store = new Store({ storage: fakeStorage() });
  store.load();
  assert.equal(store.blocked, false);
  assert.equal(store.lastError, null);
});

// ---------------------------------------------------------------- failed writes are reported

test('a failed write is rolled back and reported, not silently swallowed', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const seen = [];
  const store = new Store({ storage, onChange: (_s, err) => seen.push(err) });
  store.load();

  storage.failWrites = true;
  const before = store.state;
  const after = store.update((s) => markRead(s, 2, true));

  assert.equal(after, before, 'in-memory state must roll back');
  assert.equal(isRead(store.state, 2), false, 'the UI must not show progress that was not saved');
  assert.match(seen.at(-1), /storage is full/i, 'the reason must reach the caller');
});

test('the change handler receives null when a write succeeds', () => {
  const seen = [];
  const store = new Store({ storage: fakeStorage(), onChange: (_s, err) => seen.push(err) });
  store.load();
  store.update((s) => createList(s, { name: 'A' }));
  assert.equal(seen.at(-1), null);
});

// ---------------------------------------------------------------- the reason saving is paused

// The banner's explanation line used to be painted from lastError, which holds whatever failed
// most recently. Every write attempted while blocked is refused, so the first thing the reader
// did after arriving on that screen replaced the reason they were on it. Measured in Edge before
// the fix: adding one reading order while blocked left neither the banner nor the save report
// saying why saving was paused.
test('the reason saving is paused survives a write refused while it is paused', () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify({ schemaVersion: 99, lists: {} }) });
  const store = new Store({ storage });
  store.load();

  const reason = store.blockedReason;
  assert.match(reason, /Unsupported schema version 99/, 'the read failure is the reason');

  store.update((s) => createList(s, { name: 'carrying on regardless' }));

  assert.match(store.lastError, /That change was not saved/, 'the refusal is news of its own');
  assert.equal(store.blockedReason, reason, 'but it must not become the reason saving is paused');
});

// Said once. The reason reached the banner and the assertive save pane together on the first
// render, because boot reported lastError and the banner read the same slot. Leaving lastError
// unset at load makes the duplication impossible rather than guarded by a condition a later edit
// could drop. The boot report has since gone too: onChange already notifies every error in the
// step that sets it, so the line could only ever repeat what was on screen.
test('a failed load leaves nothing for the boot notice to repeat', () => {
  const store = new Store({ storage: fakeStorage({ [KEY]: 'corrupt' }) });
  store.load();
  assert.equal(store.blocked, true);
  assert.equal(store.lastError, null, 'the reason belongs to the banner alone');
});

// The recovery failing is the case this repository has twice been bitten by. Starting fresh
// clears the block on the way in and re-latches if the empty state cannot be written, and the
// data is still unreadable at that point, so the reason must be exactly what it was.
test('a start fresh that cannot write keeps the reason, because the data is still unreadable', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt-and-precious' });
  const store = new Store({ storage });
  store.load();
  const reason = store.blockedReason;
  // Asserted for what it is, not merely for staying equal to itself: comparing it to a value
  // read before the attempt passes trivially when there is no such value at all.
  assert.match(reason, /^Could not read your saved data \(.+\)\.$/);

  storage.failWrites = true;
  assert.equal(store.startFresh(), false, 'the write of the empty state must fail');
  assert.equal(store.blocked, true, 'so the store stays latched');
  assert.equal(store.blockedReason, reason, 'and the banner still has a reason to show');
  assert.match(store.lastError, /storage is full/i, 'while the save report carries the attempt');
  assert.equal(storage.getItem(KEY), 'corrupt-and-precious', 'the original must survive');
});

// A store can only be latched by a failed read or by that re-latch, so this pairs with the test
// above: neither route may leave the banner up with nothing in it.
test('a latched store always has a reason, even with no read failure to keep', () => {
  const storage = fakeStorage();
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, false, 'an empty storage is a first run');

  storage.failWrites = true;
  assert.equal(store.startFresh(), false);
  assert.equal(store.blocked, true);
  assert.match(store.blockedReason, /storage is full/i, 'the write that latched it is the reason');
});

// The fourth task of BL-075: clearing the reason must take the banner with it. The store half of
// that is the value; renderBlocked hides the banner in the same paint, which is verified in the
// browser because there is no DOM here.
test('resolving the block clears the reason, by either route out', () => {
  const viaFresh = new Store({ storage: fakeStorage({ [KEY]: 'corrupt' }) });
  viaFresh.load();
  assert.ok(viaFresh.blockedReason, 'the fixture must actually reach the blocked state');
  assert.equal(viaFresh.startFresh(), true);
  assert.equal(viaFresh.blockedReason, null);

  const viaRestore = new Store({ storage: fakeStorage({ [KEY]: 'corrupt' }) });
  viaRestore.load();
  assert.ok(viaRestore.blockedReason);
  assert.equal(viaRestore.restore(goodBackup()).ok, true);
  assert.equal(viaRestore.blockedReason, null);
});

// The remaining way out is a read that simply works. Nothing in the app re-reads today, so this
// pairing would hold on call-site discipline alone, and discipline is the thing a later caller
// has no way of knowing it is relying on.
test('a read that works clears a reason the previous read left behind', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt' });
  const store = new Store({ storage });
  store.load();
  assert.ok(store.blockedReason, 'the fixture must actually reach the blocked state');

  storage.setItem(KEY, goodBackup());
  store.load();
  assert.equal(store.blocked, false, 'the data reads now');
  assert.equal(store.blockedReason, null, 'so no reason may outlive the block it explained');
});

// ---------------------------------------------------------------- restore

test('a malformed backup changes nothing', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  const before = storage.getItem(KEY);

  assert.equal(store.restore('not json').ok, false);
  assert.equal(store.restore(JSON.stringify({ schemaVersion: 99 })).ok, false);
  assert.equal(storage.getItem(KEY), before, 'disk must be untouched by a rejected restore');
  assert.ok(isRead(store.state, 1), 'in-memory state must be untouched too');
});

test('a restore can be undone once, and the snapshot survives a reload', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();

  let other = createList(createEmptyState(), { name: 'Replacement' });
  other = addIssuesToList(other, other.listOrder[0], [{ issueId: 42, title: 'Different' }]).state;

  assert.equal(store.restore(JSON.stringify(exportBackup(other))).ok, true);
  assert.equal(isRead(store.state, 1), false, 'the restore took effect');
  assert.equal(store.hasPreRestoreSnapshot(), true);

  // A fresh Store, as after a page reload, must still see the snapshot.
  const reloaded = new Store({ storage });
  reloaded.load();
  assert.equal(reloaded.hasPreRestoreSnapshot(), true,
    'the undo affordance must be recoverable after a reload');

  assert.equal(reloaded.undoRestore().ok, true);
  assert.ok(isRead(reloaded.state, 1), 'the original progress is back');
});

test('legacy synopsis prose stays exact in recovery copies and is clean when promoted', () => {
  const legacyState = JSON.parse(goodBackup());
  legacyState.issues['1'].description = 'Legacy synopsis.';
  const legacyRaw = JSON.stringify(legacyState);
  const storage = fakeStorage({
    [KEY]: legacyRaw,
    'mrt.state.prerestore': legacyRaw,
    'mrt.state.salvage': legacyRaw,
  });
  const store = new Store({ storage });

  store.load();
  assert.equal(store.persist(), true);
  assert.equal('description' in JSON.parse(storage.getItem(KEY)).issues['1'], false);
  assert.equal(storage.getItem('mrt.state.prerestore'), legacyRaw, 'pre-restore bytes changed during upgrade');
  assert.equal(storage.getItem('mrt.state.salvage'), legacyRaw, 'salvage bytes changed during upgrade');

  assert.equal(store.undoRestore().ok, true);
  assert.equal('description' in store.state.issues['1'], false, 'promotion repopulated live prose');
  assert.equal('description' in JSON.parse(storage.getItem(KEY)).issues['1'], false);
  assert.equal(storage.getItem('mrt.state.salvage'), legacyRaw, 'undo removed or rewrote salvage');
});

test('a successful restore clears a blocked store', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt' });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true);

  assert.equal(store.restore(goodBackup()).ok, true);
  assert.equal(store.blocked, false);
  store.update((s) => createList(s, { name: 'works again' }));
  assert.equal(JSON.parse(storage.getItem(KEY)).listOrder.length, 2);
});

// ------------------------------------------------- restore failures, told apart from each other

function replacementBackup() {
  let other = createList(createEmptyState(), { name: 'Replacement' });
  other = addIssuesToList(other, other.listOrder[0], [{ issueId: 42, title: 'Different' }]).state;
  return JSON.stringify(exportBackup(other));
}

// Many lists rather than one, because the two renders BL-114 is about paint a node per list. The
// count is small: what the tests below vary is the room, not the size, and a fixture large enough
// to be slow would be measuring the test rather than the store.
function wideBackup(lists) {
  let s = createEmptyState();
  for (let i = 0; i < lists; i += 1) s = createList(s, { name: `Order ${i}` });
  return JSON.stringify(exportBackup(s));
}

// restore() re-serialises through exportBackup(), so the saved copy carries the moment of the
// restore rather than the moment the backup was taken. Comparing the two strings whole therefore
// asserts something the code never promised, and it passed only because both stamps usually land
// in the same millisecond. On CI they did not: one run differed by exactly 1 ms and reddened the
// build for a reason no reader could act on.
//
// The write token is dropped for the same reason and is the same kind of thing: metadata the store
// stamps on the value it saves, naming that write so another tab can tell it apart from its own. It
// is absent from the backup being compared against because it is absent from every backup file, by
// construction. What this comparison is for is the content, and neither field is content.
function withoutStamp(json) {
  const parsed = JSON.parse(json);
  delete parsed.exportedAt;
  delete parsed.writeToken;
  return parsed;
}

// The defect this section exists for. The swap had already landed and the removal of the staging
// key was what threw, and every caller was told nothing had changed.
test('a restore whose cleanup fails reports the data that is actually saved', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  const replacement = replacementBackup();
  storage.failRemoveKey = 'mrt.state.restore.tmp';

  const res = store.restore(replacement);

  assert.equal(res.ok, true, 'the reader asked for their backup and their backup is what is saved');
  assert.equal(res.changed, true);
  assert.deepEqual(withoutStamp(storage.getItem(KEY)), withoutStamp(replacement),
    'the saved data holds the backup');
  assert.equal(isRead(store.state, 1), false, 'the screen holds the restored data, not the replaced data');
  assert.equal(store.state.listOrder.length, 1);
});

// The stale screen is the harm, not the wrong sentence: an unreconciled store writes what it is
// still showing over the restore on the reader's next ordinary edit.
test('a cleanup failure does not leave the next edit writing the replaced data back', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  storage.failRemoveKey = 'mrt.state.restore.tmp';
  store.restore(replacementBackup());

  store.update((s) => createList(s, { name: 'an ordinary edit' }));

  const saved = JSON.parse(storage.getItem(KEY));
  assert.equal(saved.listOrder.length, 2, 'the edit landed on the restored data');
  assert.equal(Object.keys(saved.read ?? {}).length, 0, 'the replaced data did not come back');
});

test('a restore that could not be written does not spend the undo an earlier one earned', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);

  storage.failKey = KEY;
  const res = store.restore(JSON.stringify(exportBackup(createEmptyState())));
  assert.equal(res.ok, false);
  assert.equal(res.changed, false);
  storage.failKey = null;

  assert.equal(store.undoRestore().ok, true);
  assert.ok(isRead(store.state, 1), 'the undo still reaches the data the first restore replaced');
});

test('a restore that could not be written offers no undo where there was none', () => {
  const original = goodBackup();
  const storage = fakeStorage({ [KEY]: original });
  const store = new Store({ storage });
  store.load();
  storage.failKey = KEY;

  assert.equal(store.restore(replacementBackup()).ok, false);

  assert.equal(store.hasPreRestoreSnapshot(), false,
    'a restore that did not happen has nothing to undo');
  assert.equal(storage.getItem(KEY), original, 'the saved data is untouched');
  assert.ok(isRead(store.state, 1), 'and so is the screen');
});

test('a browser that will not say what it holds latches the store instead of guessing', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  // The staging removal is the last stage, so failing the read from inside it is how storage stops
  // answering at exactly the moment the outcome has to be established.
  const removeItem = storage.removeItem.bind(storage);
  storage.removeItem = (k) => {
    storage.failReadKey = KEY;
    removeItem(k);
    throw new Error('locked');
  };

  const res = store.restore(replacementBackup());

  assert.equal(res.ok, false);
  assert.equal(res.changed, null, 'unknown is its own answer, distinct from unchanged');
  assert.equal(store.blocked, true, 'nothing may be written over a value that cannot be read');
  assert.match(store.blockedReason, /Could not read your saved data/);
});

// ------------------------------------------ the same failures, put to the app's own observers

// A review of the five tests above found the fault they inject is narrower than the sentence they
// are written about, and the difference is where the defect lives. `failReadKey` stops one key
// answering; a browser that stops answering reads stops for all of them, and the repaint that
// follows a latch reads a second key. The store below is wired the way the app wires it.
const PRERESTORE_KEY = 'mrt.state.prerestore';

test('a browser that stops answering reads still gets its answer back to the reader', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  // renderAll() asks the store whether to offer an undo, which is another read of the storage that
  // has just stopped answering. That throw unwound out of the observer, out of settleAfterSwap()
  // and out of restore() itself, so the handler never ran its notify and the reader was told
  // nothing at all about a restore that had already changed their saved data.
  let repaints = 0;
  store.onChange = () => {
    repaints += 1;
    store.hasPreRestoreSnapshot();
  };
  const removeItem = storage.removeItem.bind(storage);
  storage.removeItem = (k) => {
    storage.failReads = true;
    removeItem(k);
    throw new Error('locked');
  };

  const res = store.restore(replacementBackup());

  assert.equal(res.changed, null, 'the caller is told, rather than the throw reaching it');
  assert.equal(store.blocked, true);
  assert.equal(repaints, 1, 'and the repaint that carries the block to the screen still ran');
});

// The branch a genuine quota failure takes first, which none of the five reached: `failKey` fails
// writes to the main key only, so both the staging write and the snapshot write succeeded and every
// one of them landed on the swap. `failWrites` refuses all three, so the staging write is the one
// that trips here. Which write a real quota refuses first is not fixed: the staging copy is the
// first full-size allocation, but on an empty tracker it is one copy where the swap is the second,
// so near quota the swap is the likelier casualty. BL-114 measured that shape.
test('a quota failure at the first staging write changes nothing and mints no undo', () => {
  const original = goodBackup();
  const storage = fakeStorage({ [KEY]: original });
  const store = new Store({ storage });
  store.load();
  storage.failWrites = true;

  const res = store.restore(replacementBackup());

  assert.equal(res.ok, false);
  assert.equal(res.changed, false);
  assert.equal(storage.getItem(KEY), original, 'the saved data is untouched');
  assert.equal(storage.getItem('mrt.state.restore.tmp'), null, 'nothing was staged');
  assert.equal(store.hasPreRestoreSnapshot(), false, 'and no undo was minted for a restore that did not happen');
});

// setItem can report a success it did not have, which is why salvage() reads its own write back.
// The swap was the one write in this path still taking the absence of a throw as proof.
test('a swap this browser accepted without storing is not reported as a restore', () => {
  const original = goodBackup();
  const storage = fakeStorage({ [KEY]: original });
  const store = new Store({ storage });
  store.load();
  storage.silentKey = KEY;

  const res = store.restore(replacementBackup());

  assert.equal(res.ok, false, 'no throw is not the same as a write that landed');
  assert.equal(res.changed, false);
  assert.equal(storage.getItem(KEY), original, 'the saved data is what it always was');
  assert.ok(isRead(store.state, 1), 'and the screen was reconciled back to agree with it');
});

// The repair rewindSnapshot() makes runs in the storage that has just refused a write, so it is the
// operation most likely to be refused in turn. Left alone it puts live data in the undo slot, and
// the button then announced "Restore undone" for a swap of the data already on screen.
test('a rewind this browser refused withdraws the undo rather than offering a no-op', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);
  const earned = storage.getItem(PRERESTORE_KEY);
  assert.ok(earned, 'the first restore earned an undo');

  let snapshotWrites = 0;
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (k, v) => {
    if (k === KEY) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    // The repair is the second write to this slot in one restore. The first is the snapshot the
    // swap was about to earn, and it succeeded before the room ran out.
    if (k === PRERESTORE_KEY && ++snapshotWrites === 2) throw new Error('quota');
    setItem(k, v);
  };

  const res = store.restore(JSON.stringify(exportBackup(createEmptyState())));

  assert.equal(res.changed, false);
  assert.equal(store.hasPreRestoreSnapshot(), false, 'an offer it cannot honour is withdrawn');
  const undo = store.undoRestore();
  assert.equal(undo.ok, false, 'rather than reported as undone when nothing was');
  assert.match(undo.errors.join(' '), /No pre-restore snapshot available/);
});

// undefined is the third answer, "this storage would not say", and it is not the absence null
// means. Deleting the slot on it would destroy an undo on the strength of a failed read.
test('a snapshot slot that would not be read is neither deleted nor announced as an undo', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);

  storage.failReadKey = PRERESTORE_KEY;
  storage.failKey = KEY;
  const res = store.restore(JSON.stringify(exportBackup(createEmptyState())));
  storage.failReadKey = null;
  storage.failKey = null;

  assert.equal(res.changed, false);
  assert.notEqual(storage.getItem(PRERESTORE_KEY), null, 'a slot nobody could read is not deleted');
  const undo = store.undoRestore();
  assert.equal(undo.ok, false, 'and a snapshot of the live data is refused, not announced as undone');
  assert.match(undo.errors.join(' '), /nothing to undo/);
});

// ------------------------------------------------ what a render can be handed

// BL-114's decision, held to a test rather than argued.
//
// The item asked whether the two per-list renders need a bound of their own, on the reading that a
// restore can carry 250,000 lists and the rail paints a node per list. Measured in headless Edge at
// 1280x900 against the app's own file input, the premise does not hold: a backup too large to store
// never reaches `adoptRestored`, so it is never the state a render is handed. At 12,000 lists the
// restore landed and painted in 619 ms end to end; at 13,000 the swap was refused in 62 ms and what
// repainted was the empty tracker that was already there, leaving the rail at 0 nodes and the origin
// untouched. What bounds the paint is therefore what storage accepted, and this is the property that
// makes bounding the render unnecessary.
//
// A budgeted storage rather than `failWrites`, because the shape that matters is not a storage that
// refuses everything. It is one that would take the backup on its own and will not take it beside
// the second full-size copy the swap needs, which is what puts the reachable ceiling at half the
// origin rather than all of it.
function budgetedStorage(seed = {}, budget = Infinity) {
  const storage = fakeStorage(seed);
  const occupancy = (skip) => {
    let total = 0;
    for (const [k, v] of storage.map) if (k !== skip) total += k.length + v.length;
    return total;
  };
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (k, v) => {
    if (occupancy(k) + k.length + String(v).length > budget) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    setItem(k, v);
  };
  return storage;
}

test('a restore refused for want of room paints nothing at all', () => {
  const original = goodBackup();
  const replacement = wideBackup(40);
  // Room for the tracker that is here and one copy of the replacement, and not for the snapshot of
  // the tracker that restore() writes beside them. A budget that refused the replacement outright
  // would prove only that a refusal refuses.
  const budget = original.length + replacement.length + 200;
  const storage = budgetedStorage({ [KEY]: original }, budget);

  const handed = [];
  const store = new Store({ storage, onChange: (s) => handed.push(s.listOrder.length) });
  store.load();

  const res = store.restore(replacement);

  assert.equal(res.ok, false, 'the backup does not fit beside a snapshot of what it replaces');
  assert.equal(storage.getItem(KEY), original, 'and the tracker that is here is untouched');
  // Which of the three writes a refusal lands on is a property of the sizes, not of the code: here
  // the staging copy fits and the snapshot does not. What matters is that both precede `swapReached`,
  // and that branch returns before any observer is notified. Nothing on screen changes and nothing is
  // repainted: the reader is told by the call site's message rather than by a render.
  assert.deepEqual(handed, [], 'a restore that never reached the swap repainted nothing');
});

// The other refusal, and the one where a render does run. Both writes before the swap landed and the
// swap did not, so the store reconciles and notifies. What it hands over is the assertion BL-114
// rests on. This is the shape a real quota takes on a tracker small enough that one copy of the
// backup fits and two do not, which is what BL-114 measured at 13,000 lists.
test('a restore whose swap is refused repaints the tracker that is here, not the backup', () => {
  const original = goodBackup();
  const storage = fakeStorage({ [KEY]: original });

  const handed = [];
  const store = new Store({ storage, onChange: (s) => handed.push(s.listOrder.length) });
  store.load();
  const before = store.state.listOrder.length;
  storage.failKey = KEY;

  const res = store.restore(wideBackup(40));

  assert.equal(res.ok, false);
  assert.ok(handed.length > 0, 'a swap that failed after staging is news, so a render does run');
  for (const count of handed) {
    assert.equal(count, before, 'a render was handed a state storage refused to keep');
  }
});

// The other half of the same decision, and the reason the reachable ceiling is not the count
// ceiling. Both restores below are well under MAX_LISTS and under the file size guard; what
// separates them is the second copy, so removing the staging write would double what a render can
// be asked to paint without any ceiling changing.
test('what a restore can land is bounded by two copies of it, not one', () => {
  const replacement = wideBackup(40);
  const fits = (budget) => {
    const storage = budgetedStorage({}, budget);
    const store = new Store({ storage });
    store.load();
    return store.restore(replacement).ok;
  };

  assert.equal(fits(replacement.length * 2 + 400), true, 'room for two copies is enough');
  assert.equal(fits(Math.round(replacement.length * 1.5)), false, 'room for one and a half is not');
});

// ------------------------------------------------ erasing everything, and the offer that outlived it

// The defect BL-101 records. The erase dialog says it clears everything this browser has stored
// and that it cannot be undone, and the pre-restore snapshot is written by restore() alone, so
// nothing on the erase route ever touched it. Measured against the shipped store before the fix:
// the slot still held the whole tracker, hasPreRestoreSnapshot() was true so the button was on
// screen, and undoRestore() answered ok true and put the erased lists back.
test('erasing everything takes the undo-restore snapshot with it', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);
  assert.equal(store.hasPreRestoreSnapshot(), true, 'the fixture must actually create a snapshot');

  const res = store.eraseAll();

  assert.equal(res.ok, true);
  assert.equal(res.snapshotKept, false);
  assert.equal(store.hasPreRestoreSnapshot(), false, 'which is the question the screen asks');
  assert.equal(storage.getItem(PRERESTORE_KEY), null, 'and the copy itself is gone, not just the offer');
  assert.equal(store.undoRestore().ok, false, 'so the promise is not contradicted by a working undo');
  assert.equal(JSON.parse(storage.getItem(KEY)).listOrder.length, 0);
});

// The order is the whole point. A refused write leaves the tracker exactly where it was, and an
// undo offered against data that is still there is truthful, so withdrawing it would destroy a
// copy on behalf of an erase that never happened.
test('an erase that could not be written keeps the snapshot it did not earn', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);
  const snapshot = storage.getItem(PRERESTORE_KEY);

  storage.failWrites = true;
  const res = store.eraseAll();
  storage.failWrites = false;

  assert.equal(res.ok, false);
  assert.equal(res.snapshotKept, true);
  assert.equal(storage.getItem(PRERESTORE_KEY), snapshot, 'untouched, byte for byte');
  assert.equal(store.undoRestore().ok, true, 'and the offer still does what it says');
});

// Reported rather than assumed, because the caller has to describe this case and cannot see it.
// A storage that accepts removeItem and keeps the value leaves a whole copy of the tracker behind
// a live button after a dialog promising nothing would survive.
test('an erase whose withdrawal does not land says the snapshot is still held', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.restore(replacementBackup()).ok, true);

  storage.failRemoveKey = PRERESTORE_KEY;
  const res = store.eraseAll();
  storage.failRemoveKey = null;

  assert.equal(res.ok, true, 'the erase itself landed');
  assert.equal(res.snapshotKept, true, 'and the caller is told the copy did not go');
  assert.equal(store.hasPreRestoreSnapshot(), true);
});

// The decision BL-101 asks for, held as behaviour rather than as prose. Start fresh is the other
// route that replaces the whole state, and it must not withdraw: its dialog promises to replace
// the unreadable saved data and nothing wider, the snapshot is a different key that is still
// readable, and the undo it leaves standing hands the reader their lists back.
test('starting fresh keeps the snapshot, because the undo it offers still recovers data', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const first = new Store({ storage });
  first.load();
  assert.equal(first.restore(replacementBackup()).ok, true);

  storage.setItem(KEY, '{ not json');
  const second = new Store({ storage });
  second.load();
  assert.equal(second.blocked, true, 'the fixture must actually reach the blocked state');
  assert.equal(second.startFresh(), true);

  assert.equal(second.hasPreRestoreSnapshot(), true);
  const undone = second.undoRestore();
  assert.equal(undone.ok, true);
  const back = JSON.parse(storage.getItem(KEY));
  assert.equal(back.listOrder.length, 1);
  assert.equal(Object.values(back.lists)[0].name, 'Hickman', 'the tracker from before the restore');
});

// Read back for the same reason every other write in this module is. A storage that reports a
// removal it did not perform must not be believed, because the answer decides whether an offer
// the reader has just been told is gone stays on screen.
test('withdrawing the snapshot reports what storage actually holds', () => {
  const storage = fakeStorage({ [KEY]: goodBackup(), [PRERESTORE_KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();

  storage.failRemoveKey = PRERESTORE_KEY;
  assert.equal(store.forgetPreRestore(), false, 'a removal that threw is not a withdrawal');
  storage.failRemoveKey = null;

  assert.equal(store.forgetPreRestore(), true);
  assert.equal(storage.getItem(PRERESTORE_KEY), null);
  assert.equal(store.forgetPreRestore(), true, 'and an empty slot is already withdrawn');
});

// The read-back in forgetPreRestore() is what this holds in place. A removeItem that throws is
// caught before the read-back can run, so the only shape that reaches it is a storage reporting a
// removal it did not perform. Without the read-back the method answers true and the caller is told
// a copy is gone while it is still there.
test('a removal that silently does not happen is not reported as a withdrawal', () => {
  const storage = fakeStorage({ [KEY]: goodBackup(), [PRERESTORE_KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();

  storage.silentRemoveKey = PRERESTORE_KEY;
  assert.equal(store.forgetPreRestore(), false, 'because the value is still there to read');
  assert.notEqual(storage.getItem(PRERESTORE_KEY), null);
  assert.equal(store.eraseAll().snapshotKept, true, 'and the caller is told, so the page can say so');
});

// The other leftover the erase promise covers. A restore whose own cleanup removal threw leaves the
// staging key holding a whole serialized tracker, which the suite pins as reachable above. Nothing
// in the app offers it, so it is an undisclosed copy rather than a false offer, but the dialog says
// this browser has nothing left and that is the sentence it makes wrong.
test('erasing everything discards the staging copy a failed restore cleanup left behind', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  storage.failRemoveKey = 'mrt.state.restore.tmp';
  assert.equal(store.restore(replacementBackup()).ok, true);
  storage.failRemoveKey = null;
  assert.notEqual(storage.getItem('mrt.state.restore.tmp'), null, 'the fixture must actually strand it');

  assert.equal(store.eraseAll().ok, true);

  assert.equal(storage.getItem('mrt.state.restore.tmp'), null);
  assert.deepEqual([...storage.map.keys()], [KEY], 'nothing but the empty tracker is left');
});

// Same guard as the snapshot has, for the same reason. A refused erase leaves the tracker where it
// was, and the staging copy is the only remaining trace of the restore that produced it.
test('an erase that could not be written keeps the staging copy too', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  storage.failRemoveKey = 'mrt.state.restore.tmp';
  assert.equal(store.restore(replacementBackup()).ok, true);
  storage.failRemoveKey = null;
  const staged = storage.getItem('mrt.state.restore.tmp');

  storage.failWrites = true;
  assert.equal(store.eraseAll().ok, false);
  storage.failWrites = false;

  assert.equal(storage.getItem('mrt.state.restore.tmp'), staged, 'untouched, byte for byte');
});

// BL-113's decision, held the same way and for the opposite outcome. Erasing everything reaches
// the two restore-family keys and stops there: a salvage copy is a copy of data this app could
// not read, and the module states at its own removal that nothing but the reader takes one away,
// because no rule here can know whether they still want it. So the dialog was narrowed to say
// what it does not reach rather than the route widened to reach it.
//
// The block has to be cleared first, which is the whole reason this needs a fixture rather than a
// glance: a blocked store refuses the write, and nothing behind that guard runs at all, so an
// erase attempted straight after the failed read never touches anything and would pass this test
// while proving nothing.
test('erasing everything leaves the salvage copies, because only the reader removes one', () => {
  const storage = fakeStorage({ [KEY]: 'corrupt-and-precious' });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true, 'the fixture must actually block, or the erase below is not the one shipped');
  assert.equal(storage.getItem('mrt.state.salvage'), 'corrupt-and-precious', 'and must actually salvage');
  assert.equal(store.startFresh(), true, 'the block has to go before an erase can land');

  const res = store.eraseAll();

  assert.equal(res.ok, true);
  assert.equal(storage.getItem('mrt.state.salvage'), 'corrupt-and-precious', 'untouched, byte for byte');
  assert.equal(store.salvageCopies().length, 1, 'and still offered to the reader who alone can remove it');
  assert.equal(JSON.parse(storage.getItem(KEY)).listOrder.length, 0, 'while the erase itself did land');
});

// Why the erase route repaints the salvage list, which no other whole-state route has to do.
//
// One of two reasons, and the one the first version of this comment denied. It said an erase
// cannot land while a copy is live, on the grounds that live means the main key holds the bytes
// the copy was taken of, so the write is refused either at the latch or at the compare. The
// compare half is wrong: persist() compares write tokens, not bytes, and tokenOf() reads only the
// head of the value, so a tab that wrote it still matches after something shortens the tail past
// that head. The test below this one holds that shape. The first attempt failed for a narrower
// reason than the one written down, which was that its fixture used a single blocked store.
//
// The other reason is a refusal. A conflict rolls back by re-reading, that read
// fails on the bytes that caused the conflict, and the failure salvages. So pressing Erase can
// create the very first salvage copy this browser has ever held, on a screen that is at that
// moment displaying "Nothing is being kept aside", and the erase it was pressed for did not
// happen. Nothing announces, because nothing was saved, so the list is the only surface that can
// carry the news besides the banner.
test('an erase refused by another tab can leave behind the first salvage copy there has been', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, false, 'this tab read its data fine');
  assert.equal(store.salvageCopies().length, 0, 'and nothing is being kept aside yet');
  // One ordinary edit, because a conflict is a disagreement about write tokens and an exported
  // backup carries none. Until this tab has written once, its token and an untokened value both
  // read as null and compare equal, which is deliberate and is what lets a fresh install save at
  // all. So without this line the erase below is accepted and the test proves nothing.
  store.update((s) => markRead(s, 2, true));
  assert.equal(store.lastUpdateOk, true, 'and that edit has to land, or no token was stamped');

  storage.map.set(KEY, 'corrupt-from-somewhere-else');
  const res = store.eraseAll();

  assert.equal(res.ok, false, 'the erase is refused, because the key holds bytes this tab did not write');
  assert.equal(store.blocked, true, 'and the re-read that rolls it back cannot read them either');
  assert.equal(store.salvageCopies().length, 1, 'so a copy now exists that did not when the screen was painted');
  assert.equal(storage.getItem('mrt.state.salvage'), 'corrupt-from-somewhere-else');
});

// The other direction, and the one a comment here used to call impossible. An erase that lands
// replaces the bytes a live copy was taken of, so the copy stops being live and the row it sits
// on trades the note renderSalvage() shows for a Remove button that was not there when the
// screen was painted. That is a repaint the erase route has to do itself, for the same reason as
// the refusal above: this button is on the screen the list is already showing.
//
// Two stores over one storage, because it takes two tabs to reach. The value is shortened from
// the end, which leaves the write token at its head intact, so tab A still matches on the token
// persist() actually compares while tab B cannot parse what it reads. A schema downgrade is the
// everyday shape of this: an older build writes a value a newer one cannot read, and the tab
// that wrote it is not the tab that fails on it.
test('an erase that lands turns a live copy into one the reader can remove', () => {
  const storage = fakeStorage({ [KEY]: goodBackup() });
  const tabA = new Store({ storage });
  tabA.load();
  tabA.update((s) => markRead(s, 2, true));
  assert.equal(tabA.lastUpdateOk, true, 'tab A has to have written once, or it has no token to match on');

  const whole = storage.getItem(KEY);
  storage.map.set(KEY, whole.slice(0, whole.length - 12));

  const tabB = new Store({ storage });
  tabB.load();
  assert.equal(tabB.blocked, true, 'the shortened value has to be unreadable, or nothing is salvaged');
  assert.deepEqual(
    tabA.salvageCopies().map((c) => c.live),
    [true],
    'and the copy has to read as live in tab A, which is the state the old comment called a dead end',
  );

  const res = tabA.eraseAll();

  assert.equal(res.ok, true, 'tab A is not blocked and its token survived the truncation, so this lands');
  assert.deepEqual(
    tabA.salvageCopies().map((c) => c.live),
    [false],
    'so the copy is removable now and was not a moment ago, which is a row that has to be repainted',
  );
});
