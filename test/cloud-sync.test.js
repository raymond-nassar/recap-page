import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { captureCompleteBackup, parseCompleteBackup } from '../src/js/lib/completeBackup.js';
import { createEmptyState, createList, exportBackup } from '../src/js/lib/model.js';
import { KEY, SETTINGS_KEY } from '../src/js/storage.js';
import { compareCloudBackups, materialDigest, personalDigest } from '../src/js/lib/cloudSync.js';

const digest = (character) => character.repeat(64);
const stream = (character) => character.repeat(32);
const A = digest('a');
const B = digest('b');
const C = digest('c');
const D = digest('d');
const E = digest('e');
const OWN = stream('0');
const PHONE = stream('1');
const TABLET = stream('2');
const LAPTOP = stream('3');

function remote(deviceStream, generation, personalDigest, createdAt = generation) {
  return Object.freeze({ stream: deviceStream, generation, digest: personalDigest, createdAt });
}

function compare(input) {
  return compareCloudBackups({
    ownStream: OWN,
    localDigest: A,
    matchedDigest: A,
    declinedDigest: null,
    keptDigest: null,
    lastUploadedDigest: null,
    localEmpty: false,
    remotes: [],
    ...input,
  });
}

test('comparison distinguishes a shared match, local changes, remote changes and two changed sides', () => {
  const same = compare({ remotes: [remote(PHONE, 1, A)] });
  assert.deepEqual(same, { kind: 'in-step', offer: null, othersDiffering: 0, observedMatch: true });

  const local = compare({ localDigest: B, remotes: [remote(PHONE, 1, A)] });
  assert.deepEqual(local, { kind: 'no-offer', offer: null, othersDiffering: 0, observedMatch: false });

  const phone = remote(PHONE, 2, B);
  assert.deepEqual(compare({ remotes: [phone] }), {
    kind: 'remote-ahead', offer: phone, othersDiffering: 0, observedMatch: false,
  });

  const both = remote(PHONE, 2, C);
  assert.deepEqual(compare({ localDigest: B, remotes: [both] }), {
    kind: 'both-changed', offer: both, othersDiffering: 0, observedMatch: false,
  });
});

test('a first comparison never claims a nonempty device is behind without a shared match', () => {
  const phone = remote(PHONE, 1, B);
  assert.equal(compare({ matchedDigest: null, remotes: [phone] }).kind, 'first-match');
  assert.equal(compare({ matchedDigest: null, localEmpty: true, remotes: [phone] }).kind, 'remote-ahead');
  assert.deepEqual(compare({ matchedDigest: null, remotes: [remote(PHONE, 1, A)] }), {
    kind: 'in-step', offer: null, othersDiffering: 0, observedMatch: true,
  });
  assert.equal(compare({ matchedDigest: null, remotes: [] }).kind, 'no-offer');
  assert.equal(compare({ matchedDigest: null, localEmpty: true, remotes: [] }).kind, 'no-offer');
});

test('an upload does not make an unchanged older remote look like new progress', () => {
  const olderPhone = remote(PHONE, 1, A);
  const result = compare({ localDigest: B, matchedDigest: A, lastUploadedDigest: B, remotes: [olderPhone] });
  assert.equal(result.kind, 'no-offer');
  assert.equal(result.offer, null);
});

test('local ahead is never reported without an explicit newest-backup echo', () => {
  for (const localDigest of [A, B, C]) {
    for (const matchedDigest of [null, A, B]) {
      for (const lastUploadedDigest of [null, A, B]) {
        for (const remotes of [[], [remote(PHONE, 1, A)], [remote(PHONE, 1, B)], [remote(PHONE, 1, C)]]) {
          const result = compare({ localDigest, matchedDigest, lastUploadedDigest, remotes });
          if (result.kind === 'local-ahead') {
            assert.ok(lastUploadedDigest !== null && lastUploadedDigest !== localDigest
              && remotes.some((backup) => backup.digest === lastUploadedDigest),
            'local ahead requires a newest remote with the last-uploaded personal digest');
          }
        }
      }
    }
  }
});

test('an echoed upload is explicitly local ahead, without hiding another device', () => {
  const echo = remote(PHONE, 2, B, 20);
  const input = { localDigest: C, matchedDigest: A, lastUploadedDigest: B, remotes: [echo] };
  assert.deepEqual(compare(input), { kind: 'local-ahead', offer: null, othersDiffering: 0, observedMatch: false });

  const returnedToMatch = compare({ ...input, localDigest: A });
  assert.deepEqual(returnedToMatch, { kind: 'local-ahead', offer: null, othersDiffering: 0, observedMatch: false },
    'a known echo is local ahead even when current data again equals the shared match');

  const unseen = remote(TABLET, 3, D, 1);
  const divergent = compare({ ...input, remotes: [echo, unseen] });
  assert.equal(divergent.kind, 'both-changed');
  assert.equal(divergent.offer, unseen, 'an echo cannot hide content not already known here');

  const equal = compare({ ...input, localDigest: B });
  assert.equal(equal.kind, 'in-step', 'an echo that also matches current data is in step');
  assert.equal(equal.offer, null);
});

test('an independently identical change offers the later divergence on the other device', () => {
  const sameChange = remote(TABLET, 2, B);
  const phone = compare({ ownStream: PHONE, localDigest: C, matchedDigest: A, lastUploadedDigest: B, remotes: [sameChange] });
  assert.equal(phone.kind, 'local-ahead');
  assert.equal(phone.offer, null);

  const laterUpload = remote(PHONE, 3, C);
  const tablet = compare({ ownStream: TABLET, localDigest: B, matchedDigest: A, lastUploadedDigest: B, remotes: [laterUpload] });
  assert.equal(tablet.kind, 'both-changed');
  assert.equal(tablet.offer, laterUpload);
});

test('a declined backup is a kept choice, not proof this device is ahead', () => {
  const declined = remote(PHONE, 2, B);
  const input = {
    localDigest: C, matchedDigest: A, declinedDigest: B, lastUploadedDigest: A, remotes: [declined],
  };
  assert.deepEqual(compare(input), {
    kind: 'kept-choice', offer: null, othersDiffering: 0, observedMatch: false,
  });

  const echo = remote(TABLET, 2, A);
  assert.equal(compare({ ...input, remotes: [declined, echo] }).kind, 'kept-choice',
    'a known echo cannot turn an unseen declined backup into proof of local progress');

  const novel = remote(PHONE, 3, D);
  const changed = compare({ ...input, remotes: [declined, echo, novel] });
  assert.equal(changed.kind, 'both-changed');
  assert.equal(changed.offer, novel, 'a later different backup receives the normal choice');

  assert.equal(compare({ ...input, localDigest: B }).kind, 'in-step',
    'a previously declined backup that now matches is in step');
  assert.equal(compare({ ...input, lastUploadedDigest: B }).kind, 'local-ahead',
    'an exact last-upload echo is known here even if its digest was previously declined');

  for (const localDigest of [A, C]) {
    for (const matchedDigest of [null, A, C]) {
      for (const lastUploadedDigest of [null, A, C]) {
        const result = compare({ localDigest, matchedDigest, lastUploadedDigest, declinedDigest: B, remotes: [declined] });
        assert.equal(result.kind, 'kept-choice', 'never claim local progress over a declined, never-held backup');
        assert.equal(result.offer, null);
      }
    }
  }
});

test('declined progress is remembered for its own stream, not another device', () => {
  const phone = remote(PHONE, 1, B);
  const tablet = remote(TABLET, 1, C);
  const kept = compare({
    declinedByStream: [{ stream: PHONE, digest: B }, { stream: TABLET, digest: C }],
    remotes: [phone, tablet],
  });
  assert.equal(kept.kind, 'kept-choice');
  assert.equal(kept.offer, null);

  const changedTablet = remote(TABLET, 2, B);
  const changed = compare({
    declinedByStream: [{ stream: PHONE, digest: B }, { stream: TABLET, digest: C }],
    remotes: [phone, changedTablet],
  });
  assert.equal(changed.offer, changedTablet, 'a different stream does not inherit the phone decision');
});

test('an active-list-only difference is an echo under the personal digest, not a complete-copy match', async () => {
  let state = createList(createEmptyState(), { id: 'one', name: 'One' });
  state = createList(state, { id: 'two', name: 'Two' });
  const values = new Map([[KEY, JSON.stringify(exportBackup(state))]]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  const uploaded = (await captureCompleteBackup({ storage, cryptoProvider: webcrypto })).backup;
  state = { ...state, active: 'two' };
  values.set(KEY, JSON.stringify(exportBackup(state)));
  const remoteBackup = (await captureCompleteBackup({ storage, cryptoProvider: webcrypto })).backup;
  values.set(SETTINGS_KEY, JSON.stringify({ covers: false }));
  const current = (await captureCompleteBackup({ storage, cryptoProvider: webcrypto })).backup;

  const uploadedDigest = await personalDigest(uploaded, webcrypto);
  const remoteDigest = await personalDigest(remoteBackup, webcrypto);
  const currentDigest = await personalDigest(current, webcrypto);
  assert.notEqual(remoteBackup.digest, uploaded.digest, 'complete backups retain the chosen active list');
  assert.equal(remoteDigest, uploadedDigest, 'the comparison ignores only that active-list difference');
  assert.notEqual(currentDigest, uploadedDigest);
  const result = compare({
    localDigest: currentDigest, matchedDigest: A, lastUploadedDigest: uploadedDigest,
    remotes: [remote(TABLET, 1, remoteDigest)],
  });
  assert.equal(result.kind, 'local-ahead');
  assert.equal(result.offer, null);
});

test('the device ignores its own, shared, kept, uploaded and declined copies until a different one arrives', () => {
  const remotes = [
    remote(OWN, 10, D),
    remote(PHONE, 1, A),
    remote(TABLET, 2, B),
    remote(LAPTOP, 2, C),
    remote(stream('4'), 2, D),
  ];
  const ignored = {
    localDigest: E, matchedDigest: A, keptDigest: B, lastUploadedDigest: C, declinedDigest: D,
    remotes,
  };
  assert.equal(compare(ignored).kind, 'kept-choice');
  const different = remote(stream('4'), 3, digest('f'));
  const result = compare({ ...ignored, remotes: [...remotes, different] });
  assert.equal(result.kind, 'both-changed');
  assert.equal(result.offer, different);
});

test('a stream uses its highest generation even if an older file has a later device clock', () => {
  const older = remote(PHONE, 1, B, 10_000);
  const newest = remote(PHONE, 2, A, 1);
  assert.equal(compare({ remotes: [older, newest] }).kind, 'in-step');

  const different = remote(PHONE, 3, C, 0);
  assert.equal(compare({ remotes: [older, newest, different] }).offer, different);
});

test('different streams are counted once and times only choose which backup to show first', () => {
  const phone = remote(PHONE, 2, B, 15);
  const tablet = remote(TABLET, 3, C, 10);
  const laptop = remote(LAPTOP, 1, D, 20);
  const result = compare({ localDigest: E, remotes: [tablet, phone, laptop, remote(PHONE, 1, D, 99)] });
  assert.deepEqual(result, { kind: 'both-changed', offer: laptop, othersDiffering: 2, observedMatch: false });
  assert.equal(compare({ matchedDigest: null, remotes: [laptop] }).kind, 'first-match');
});

test('a shared match on one device does not hide a different device', () => {
  const tablet = remote(TABLET, 1, C, 10);
  const result = compare({ localDigest: B, remotes: [remote(PHONE, 1, B), tablet] });
  assert.deepEqual(result, { kind: 'both-changed', offer: tablet, othersDiffering: 0, observedMatch: true });
});

test('invalid input or two different copies under one stream and generation is refused', () => {
  for (const input of [
    { localDigest: 'not-a-digest' },
    { matchedDigest: 'bad' },
    { localEmpty: 'yes' },
    { remotes: [remote('wrong', 1, B)] },
    { remotes: [remote(PHONE, 0, B)] },
    { remotes: [remote(PHONE, 1, 'bad')] },
    { remotes: [remote(PHONE, 1, B, Infinity)] },
    { remotes: [remote(PHONE, 1, B), remote(PHONE, 1, C)] },
  ]) {
    assert.throws(() => compare(input), TypeError);
  }
});

test('conflicting duplicate generations are refused regardless of listing order', () => {
  for (const remotes of [
    [remote(PHONE, 2, A), remote(PHONE, 1, B), remote(PHONE, 1, C)],
    [remote(PHONE, 1, B), remote(PHONE, 2, A), remote(PHONE, 1, C)],
  ]) {
    assert.throws(() => compare({ remotes }), /same device and generation/);
  }
});

// ------------------------------------------------------------------ material progress (#1176)

const V430 = JSON.parse(readFileSync(new URL('./fixtures/cloud-material-v4.3.0.json', import.meta.url), 'utf8'));

async function currentCapture(saved = V430.saved) {
  const storage = { getItem: (key) => saved[key] ?? null };
  return (await captureCompleteBackup({ storage, cryptoProvider: webcrypto })).backup;
}

const material = (backup) => materialDigest(backup, webcrypto);

function variant(backup, change) {
  const copy = structuredClone(backup);
  change(copy.components);
  return copy;
}

test('a 4.3.0 backup and this build\'s backup of the same saved data have one material digest', async () => {
  const older = await parseCompleteBackup(V430.backupText, { cryptoProvider: webcrypto });
  const current = await currentCapture();
  assert.equal(await material(older), await material(current));
  assert.notEqual(await material(current), await personalDigest(current, webcrypto),
    'the tagged material space never names a personal digest');
});

test('absent and empty collections give the same material digest', async () => {
  const older = await parseCompleteBackup(V430.backupText, { cryptoProvider: webcrypto });
  const sparse = variant(older, (components) => {
    delete components.reader.ratings;
    components.reader.ratings = undefined;
    delete components.reader.lists.empty.collectedIn;
    delete components.reader.lists.empty.deferredIssueIds;
    delete components.reader.lists.empty.itemIds;
    components.reader.lists.two.collectedIn = { 21: null };
  });
  const emptied = variant(older, (components) => {
    components.reader.ratings = {};
    components.history = { ...components.history, records: [] };
  });
  const absentHistory = variant(older, (components) => {
    components.reader.ratings = {};
    components.history = null;
  });
  assert.equal(await material(sparse), await material(variant(older, (components) => {
    delete components.reader.ratings;
  })));
  assert.equal(await material(emptied), await material(absentHistory));
});

test('only reading progress changes the material digest: settings, times, order of lists, notes and details do not', async () => {
  const base = await currentCapture();
  const same = {
    settings: (c) => { c.settings = { ...c.settings, theme: 'light', covers: false, sidebarCollapsed: true }; },
    'read times': (c) => { c.reader.read = { 11: 1, 21: 2 }; },
    'sidebar list order': (c) => { c.reader.listOrder = [...c.reader.listOrder].reverse(); },
    'active list': (c) => { c.reader.active = 'two'; },
    'list description and note': (c) => { c.reader.lists.one.description = 'Other'; c.reader.lists.one.note = 'Other'; },
    'issue notes': (c) => { c.reader.notes = { 11: 'Changed' }; },
    'availability overrides': (c) => { c.reader.overrides = { 12: true }; },
    'saved comic details': (c) => { c.reader.issues = {}; },
    'import draft': (c) => { c.draft = null; },
    'finished time': (c) => { c.history.records[0].completedAt += 1000; },
    'an unfinished, unrated history entry': (c) => {
      c.history.records.push({ listId: 'empty', created: 1, catalogId: null, completedAt: null, rating: null });
    },
  };
  for (const [label, change] of Object.entries(same)) {
    assert.equal(await material(variant(base, change)), await material(base), `${label} is not progress`);
  }
  const different = {
    'read set': (c) => { c.reader.read = { ...c.reader.read, 12: 5 }; },
    'list membership': (c) => { c.reader.lists.two.itemIds = [21, 22]; },
    'order within a list': (c) => { c.reader.lists.one.itemIds = [13, 12, 11]; },
    deferrals: (c) => { c.reader.lists.one.deferredIssueIds = []; },
    rename: (c) => { c.reader.lists.one.name = 'Renamed'; },
    'rating value': (c) => { c.reader.ratings = { 11: 3 }; },
    'finished list rating': (c) => { c.history.records[0].rating = 'down'; },
    'list finished': (c) => {
      c.history.records.push({ listId: 'one', created: c.reader.lists.one.created, catalogId: null, completedAt: 9, rating: null });
    },
    'list no longer finished': (c) => { c.history.records[0].completedAt = null; c.history.records[0].rating = null; },
  };
  for (const [label, change] of Object.entries(different)) {
    assert.notEqual(await material(variant(base, change)), await material(base), `${label} is progress`);
  }
});

function remoteWith(deviceStream, generation, personal, materialValue, createdAt = generation) {
  return Object.freeze({ stream: deviceStream, generation, digest: personal, material: materialValue, createdAt });
}

const M = digest('7');
const N = digest('8');

test('a remote whose progress matches is not offered even when its personal digest differs', () => {
  const settingsOnly = remoteWith(PHONE, 2, B, M);
  assert.deepEqual(compare({ localMaterial: M, remotes: [settingsOnly] }), {
    kind: 'in-step', offer: null, othersDiffering: 0, observedMatch: true,
  });
  const progressed = remoteWith(PHONE, 3, B, N);
  assert.equal(compare({ localMaterial: M, remotes: [progressed] }).offer, progressed);
  assert.equal(compare({ remotes: [settingsOnly] }).offer, settingsOnly,
    'without a local material digest the personal comparison is unchanged');
});

test('stored references written before #1176 hold personal digests and are still honored', () => {
  const phone = remoteWith(PHONE, 2, B, N);
  for (const record of [{ matchedDigest: B }, { declinedDigest: B }, { keptDigest: B },
    { declinedByStream: [{ stream: PHONE, digest: B }] }]) {
    const result = compare({ localMaterial: M, ...record, remotes: [phone] });
    assert.equal(result.offer, null, `${Object.keys(record)[0]} holding a personal digest is honored`);
  }
  for (const record of [{ matchedDigest: N }, { declinedDigest: N }, { keptDigest: N },
    { declinedByStream: [{ stream: PHONE, digest: N }] }]) {
    const result = compare({ localMaterial: M, ...record, remotes: [phone] });
    assert.equal(result.offer, null, `${Object.keys(record)[0]} holding a material digest is honored`);
  }
  assert.equal(compare({ localMaterial: M, declinedDigest: N, remotes: [remoteWith(PHONE, 3, C, digest('9'))] }).offer?.generation, 3,
    'a decision names its backup, not a later one with different progress');
});

test('a match recorded by material digest makes later remote progress remote-ahead', () => {
  const phone = remoteWith(PHONE, 2, B, N);
  assert.equal(compare({ localDigest: A, localMaterial: M, matchedDigest: M, remotes: [phone] }).kind, 'remote-ahead');
  assert.equal(compare({ localDigest: A, localMaterial: M, matchedDigest: digest('9'), remotes: [phone] }).kind, 'both-changed');
});
