import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { captureCompleteBackup } from '../src/js/lib/completeBackup.js';
import { createEmptyState, createList, exportBackup } from '../src/js/lib/model.js';
import { KEY, SETTINGS_KEY } from '../src/js/storage.js';
import { compareCloudBackups, personalDigest } from '../src/js/lib/cloudSync.js';

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
