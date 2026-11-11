import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';
import { createSourceCreditRevisions, sourceCreditRevisions } from '../scripts/lib/source-credit-revisions.mjs';

const expected = [
  'fab0f614f22e876910386a1baf26ea44c22a3c95568119849a5164d443c462b0',
  'f3fd0ecac4ef51e38fbb27187cf2e70a6c6b582b069696998c4743d080ad8ff6',
  '7b41f67b2db1af02ca15f201cd0fbea3d3a40668d597879debd2cd2ce42e38d7',
  'ab989e672fd357bf4a4ff36cb4080ce20a10376803347b5735775697da42dddc',
];
const read = (file) => JSON.parse(readFileSync(new URL(`../scripts/data/${file}`, import.meta.url), 'utf8'));
const ledger = read('source-credit-revisions.json');
const lock = read('source-credit-revisions.lock.json');
const seal = (entries) => {
  const digests = entries.map(digestCanonicalJson);
  return createSourceCreditRevisions({ schemaVersion: 1, entries }, { schemaVersion: 1, digests }, digests);
};
const payload = (entry, state) => ({
  id: entry.id,
  source: state.source,
  ...(state.section === null ? {} : { sourceSection: state.section }),
  sourceOrigin: entry.sourceOrigin,
  sourceLicense: entry.sourceLicense,
  items: [1, 2],
});

test('reviewed history pins all four complete records independently', () => {
  assert.deepEqual(lock.digests, expected);
  assert.deepEqual(ledger.entries.map(digestCanonicalJson), expected);
  for (const change of [
    (entries) => entries.pop(),
    (entries) => entries.reverse(),
    (entries) => { entries[0].after.source += '?changed'; },
    (entries) => entries.push(structuredClone(entries[0])),
  ]) {
    const entries = structuredClone(ledger.entries);
    change(entries);
    const resealed = { schemaVersion: 1, digests: entries.map(digestCanonicalJson) };
    assert.throws(() => createSourceCreditRevisions({ schemaVersion: 1, entries }, resealed));
  }
});

test('approved credit replays and reverses exact pairs without changing selection', () => {
  for (const entry of ledger.entries) {
    const original = payload(entry, entry.before);
    const revised = sourceCreditRevisions.apply(original, entry.file);
    assert.deepEqual(revised, payload(entry, entry.after));
    assert.deepEqual(sourceCreditRevisions.undo(revised, entry.file), original);
    assert.strictEqual(sourceCreditRevisions.apply(revised, entry.file), revised);
    assert.throws(() => sourceCreditRevisions.assertLatest(original, entry.file), /not latest/);
    assert.throws(() => sourceCreditRevisions.apply({ ...original, sourceSection: null }, entry.file));
    assert.throws(() => sourceCreditRevisions.apply({ ...original, source: entry.after.source, sourceSection: 'Unrecorded' }, entry.file));
    assert.throws(() => sourceCreditRevisions.apply({ ...original, sourceOrigin: 'Changed' }, entry.file));
    assert.throws(() => sourceCreditRevisions.apply({ ...original, id: 'another-list' }, entry.file));
  }
});

test('continuous revisions accept recorded intermediate states but reject discontinuity', () => {
  const first = structuredClone(ledger.entries[0]);
  const second = structuredClone(first);
  second.before = structuredClone(first.after);
  second.after = { source: 'https://example.test/next', section: null };
  second.evidence[0].url = second.after.source;
  second.evidence[0].section = null;
  const revisions = seal([first, second]);
  for (const state of [first.before, first.after, second.after]) {
    assert.deepEqual(revisions.apply(payload(first, state), first.file), payload(second, second.after));
  }
  assert.deepEqual(revisions.undo(payload(second, second.after), second.file), payload(first, first.before));
  second.before = structuredClone(first.before);
  assert.throws(() => seal([first, second]), /discontinuous/);
});

test('manifest validation rejects missing identities and filename collisions', () => {
  const entry = ledger.entries[0];
  const revisions = seal([entry]);
  const order = {
    id: entry.id, out: entry.file, sourcePage: entry.before.source,
    sourceSection: entry.before.section, sourceOrigin: entry.sourceOrigin, sourceLicense: entry.sourceLicense,
  };
  revisions.validateOrders([order]);
  assert.throws(() => revisions.validateOrders([]), /missing or duplicated/);
  assert.throws(() => revisions.validateOrders([order, { ...order, id: 'another' }]), /collision/);
  assert.throws(() => revisions.validateOrders([order], [entry.file]), /collision/);
  assert.throws(() => revisions.validateOrders([{ ...order, sourcePage: entry.after.source }]), /original approved credit/);
});

test('distinct selections can credit the same external guide without sharing an output', () => {
  const first = structuredClone(ledger.entries[0]);
  const second = structuredClone(first);
  second.id = 'different-selection';
  second.file = 'different_selection.json';
  second.before.source = 'https://github.com/raymond-nassar/recap-page/issues/1217';
  const revisions = seal([first, second]);
  assert.equal(revisions.apply(payload(first, first.before), first.file).source, first.after.source);
  assert.equal(revisions.apply(payload(second, second.before), second.file).source, first.after.source);
  second.file = first.file;
  assert.throws(() => seal([first, second]), /shared revision file/);
});

test('each published payload and raw catalog entry has the independently recorded latest credit', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  for (const entry of ledger.entries) {
    const matches = catalog.lists.filter(({ id }) => id === entry.id);
    assert.equal(matches.length, 1, entry.id);
    const currentPayload = JSON.parse(readFileSync(new URL(`../src/data/${entry.file}`, import.meta.url), 'utf8'));
    for (const value of [currentPayload, matches[0]]) {
      sourceCreditRevisions.assertLatest(value, entry.file);
      assert.equal(value.source, entry.after.source);
      if (entry.after.section === null) assert.equal(Object.hasOwn(value, 'sourceSection'), false);
      else assert.equal(value.sourceSection, entry.after.section);
      const original = sourceCreditRevisions.undo(value, entry.file);
      assert.equal(original.source, entry.before.source);
      if (entry.before.section === null) assert.equal(Object.hasOwn(original, 'sourceSection'), false);
      else assert.equal(original.sourceSection, entry.before.section);
      assert.equal(original.sourceOrigin, entry.sourceOrigin);
    }
  }
});
