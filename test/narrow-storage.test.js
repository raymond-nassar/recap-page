// Reading data stored at one byte per character where that is never dearer (#960). These tests hold
// the cost bound for every mix of characters, the round trip through every writer that narrows, and
// the identity rule: data saved by 4.5.0's serializer and by the narrowed one is the same data to
// every digest and comparison that decides a backup or a cross-device offer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Store, KEY, compactText, narrowJson, narrowCopy } from '../src/js/storage.js';
import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';
import { captureCompleteBackup } from '../src/js/lib/completeBackup.js';
import { personalDigest, materialDigest, compareCloudBackups } from '../src/js/lib/cloudSync.js';
import { canonicalReaderValue } from '../src/js/lib/listHistory.js';

// What WebKit and Chromium charge for a stored string: one byte per character when every code unit
// fits in one byte, two otherwise. This is the cheapest that today's spelling can ever be charged, so
// it is the bound narrowing must never exceed.
function charged(text) {
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) > 0xff) return 2 * text.length;
  return text.length;
}

function mapStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

// A deterministic generator, so a failing mix can be reproduced from its seed.
function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS = {
  ascii: () => 'abcdefghij KLMNOP 0123 .,:'.split(''),
  latin1: () => ['\u00e9', '\u00fc', '\u00a0', '\u00ff', '\u00c6'],
  c1: () => ['\u0080', '\u0085', '\u009f'],
  bmp: () => ['\u2019', '\u201c', '\u4e2d', '\u6587', '\uac00', '\u30c6'],
  astral: () => ['\ud83d\ude00', '\ud83e\udd8a'],
};

function readerText(notes, { issues = 40 } = {}) {
  let state = createList(createEmptyState(), { id: 'mix', name: 'Mix' });
  const inputs = Array.from({ length: issues }, (_, index) => ({
    issueId: index + 1, title: `Generated issue ${index + 1}`, seriesName: 'Generated series', pageCount: 32,
  }));
  state = addIssuesToList(state, 'mix', inputs).state;
  notes.forEach((note, index) => { state.notes[(index % issues) + 1] = note; });
  return JSON.stringify({ writeToken: 'token', ...exportBackup(state) });
}

function assertNeverDearer(text, label) {
  const narrow = narrowJson(text);
  assert.ok(charged(narrow) <= charged(text), `${label}: ${charged(narrow)} bytes against ${charged(text)} today`);
  assert.deepEqual(JSON.parse(narrow), JSON.parse(text), `${label}: the same content`);
  assert.equal(narrowJson(narrow), narrow, `${label}: narrowing twice changes nothing`);
  return narrow;
}

test('compactText keeps the same characters and leaves anything it cannot hold in one byte as it was', () => {
  assert.equal(compactText('plain ASCII'), 'plain ASCII');
  assert.equal(compactText('caf\u00e9 \u00a0\u00ff'), 'caf\u00e9 \u00a0\u00ff');
  for (const text of ['it\u2019s', '\u0085', '\ud83d\ude00', '\u4e2d']) assert.equal(compactText(text), text);
  assert.equal(compactText(null), null);
  const decoder = globalThis.TextDecoder;
  try {
    delete globalThis.TextDecoder;
    assert.equal(compactText('no decoder'), 'no decoder');
  } finally {
    globalThis.TextDecoder = decoder;
  }
});

test('narrowJson spells text above Latin-1 as escapes, and C1 controls with it, without changing the content', () => {
  const text = readerText(['It\u2019s caf\u00e9 \u4e2d\u6587 \ud83d\ude00 \u0085 end']);
  const narrow = assertNeverDearer(text, 'one note');
  assert.ok([...narrow].every((character) => character.charCodeAt(0) <= 0xff), 'every code unit fits in one byte');
  assert.match(narrow, /\\u2019/);
  assert.match(narrow, /\\ud83d\\ude00/, 'each surrogate half is escaped on its own and parses back to the pair');
  assert.match(narrow, /\\u0085/);
  assert.match(narrow, /caf\u00e9/, 'Latin-1 letters stay as they are');
  const latin1 = readerText(['caf\u00e9 \u00fc\u00ff \u0085']);
  assert.equal(narrowJson(latin1), latin1, 'with nothing above Latin-1 the text is only rebuilt, never escaped');
});

test('no mix of characters is ever stored in more bytes than today, from mostly ASCII to all CJK', () => {
  // Mostly ASCII, as cached issue metadata is, then notes heavy in CJK across the point where escaping
  // stops paying: 5m < L, about 20 percent of code units.
  const cjk = (length) => Array.from({ length }, (_, index) => String.fromCharCode(0x4e00 + (index % 2000))).join('');
  const base = readerText([]);
  for (const share of [0, 0.001, 0.01, 0.1, 0.19, 0.2, 0.21, 0.5, 0.9, 1]) {
    const units = share === 1 ? 0 : Math.round(share * base.length / (1 - share));
    const notes = units > 0 ? [cjk(units)] : [];
    const text = share === 1 ? JSON.stringify(cjk(4000)) : readerText(notes);
    const narrow = assertNeverDearer(text, `${share * 100} percent CJK`);
    const above = [...text].filter((character) => character.charCodeAt(0) > 0xff).length;
    if (5 * above >= text.length) assert.equal(narrow, text, `${share * 100} percent CJK keeps today's form exactly`);
    else if (above > 0) assert.ok(charged(narrow) < charged(text), `${share * 100} percent CJK is cheaper narrowed`);
  }
  for (let seed = 1; seed <= 300; seed += 1) {
    const next = random(seed);
    const weights = Object.fromEntries(Object.keys(POOLS).map((pool) => [pool, next() ** 3]));
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    const pick = () => {
      let point = next() * total;
      for (const [pool, weight] of Object.entries(weights)) {
        point -= weight;
        if (point <= 0) { const choices = POOLS[pool](); return choices[Math.floor(next() * choices.length)]; }
      }
      return 'z';
    };
    const notes = Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
      Array.from({ length: Math.floor(next() * 400) }, pick).join(''));
    assertNeverDearer(readerText(notes, { issues: 1 + Math.floor(next() * 30) }), `seed ${seed}`);
  }
});

test('narrowCopy escapes only bytes that parse as JSON, so an unreadable copy keeps every character', () => {
  const unreadable = '{ not json \u2019\u4e2d';
  assert.equal(narrowCopy(unreadable), unreadable);
  const readable = readerText(['It\u2019s']);
  assert.equal(narrowCopy(readable), narrowJson(readable));
  assert.equal(narrowCopy('ascii but not json {'), 'ascii but not json {');
});

function stateWithText() {
  let state = createList(createEmptyState(), { id: 'one', name: 'Caf\u00e9 \u2019s list' });
  state = addIssuesToList(state, 'one', [{ issueId: 1, title: 'One \u4e2d' }, { issueId: 2, title: 'Two' }]).state;
  state = markRead(state, 1, true);
  state.notes[2] = 'A note \ud83d\ude00 with it\u2019s';
  return state;
}

test('saving and the reading-data restore write the narrowed form, and loading reads it back unchanged', () => {
  const storage = mapStorage();
  const store = new Store({ storage });
  store.load();
  store.update(() => stateWithText());
  const saved = storage.getItem(KEY);
  assert.ok([...saved].every((character) => character.charCodeAt(0) <= 0xff), 'persist() writes one-byte text');
  assert.match(saved, /\\u2019/);
  const reloaded = new Store({ storage });
  reloaded.load();
  assert.deepEqual(exportBackup(reloaded.state).notes, exportBackup(stateWithText()).notes);
  assert.equal(reloaded.state.lists.one.name, 'Caf\u00e9 \u2019s list');

  const target = mapStorage();
  const restoring = new Store({ storage: target });
  restoring.load();
  const result = restoring.restore(JSON.stringify(exportBackup(stateWithText())));
  assert.equal(result.ok, true, result.errors?.join(' '));
  const restored = target.getItem(KEY);
  assert.ok([...restored].every((character) => character.charCodeAt(0) <= 0xff), 'Store.restore() writes one-byte text');
  const after = new Store({ storage: target });
  after.load();
  assert.equal(after.state.notes[2], 'A note \ud83d\ude00 with it\u2019s');
});

test('the list history accepts the reader value in either spelling as the same writer\'s bytes', () => {
  const state = stateWithText();
  const exportedAt = new Date(0).toISOString();
  const plain = JSON.stringify({ writeToken: 'token', ...exportBackup(state), exportedAt });
  assert.equal(canonicalReaderValue(plain, state, 'token'), true, 'as 4.5.0 wrote it');
  assert.equal(canonicalReaderValue(narrowJson(plain), state, 'token'), true, 'as this version writes it');
  assert.equal(canonicalReaderValue(narrowJson(plain).replace('\\u2019', '\\u2018'), state, 'token'), false);
});

test('the same data saved by 4.5.0 and by this version has one backup digest and is never offered as other progress', async () => {
  const state = stateWithText();
  const exportedAt = new Date(0).toISOString();
  const plain = JSON.stringify({ writeToken: 'token', ...exportBackup(state), exportedAt });
  assert.notEqual(narrowJson(plain), plain, 'the two spellings really differ');
  const capture = async (raw) => (await captureCompleteBackup({ storage: mapStorage({ [KEY]: raw }), cryptoProvider: webcrypto })).backup;
  const before = await capture(plain);
  const after = await capture(narrowJson(plain));
  assert.equal(after.digest, before.digest);
  const personal = await personalDigest(after, webcrypto);
  const material = await materialDigest(after, webcrypto);
  assert.equal(await personalDigest(before, webcrypto), personal);
  assert.equal(await materialDigest(before, webcrypto), material);
  // This device saved by this version; another saved the same data by 4.5.0 and uploaded it.
  const remote = { stream: 'b'.repeat(32), generation: 1, digest: before.digest, material: await materialDigest(before, webcrypto), createdAt: 1 };
  for (const [localDigest, localMaterial] of [[personal, material], [personal, null]]) {
    const result = compareCloudBackups({
      ownStream: 'a'.repeat(32), localDigest, localMaterial, localEmpty: false,
      remotes: [{ ...remote, digest: await personalDigest(before, webcrypto) }],
    });
    assert.equal(result.offer, null);
    assert.equal(result.kind, 'in-step');
  }
});
