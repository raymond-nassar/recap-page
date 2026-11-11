import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';
import { createSourceCreditRevisions, sourceCreditRevisions } from '../scripts/lib/source-credit-revisions.mjs';

const expected = [
  'fab0f614f22e876910386a1baf26ea44c22a3c95568119849a5164d443c462b0',
  'f3fd0ecac4ef51e38fbb27187cf2e70a6c6b582b069696998c4743d080ad8ff6',
  '7b41f67b2db1af02ca15f201cd0fbea3d3a40668d597879debd2cd2ce42e38d7',
  'ab988659f374ab74ffb0d0e1df58bf794e25bbd8992fb60cb59b6b81cd3dc9e6',
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

// A list may be revised more than once, so every check reads the whole chain for its id: the
// approved selection is the first entry's before and the published credit is the last entry's after.
const chainsOf = (entries) => {
  const chains = new Map();
  for (const entry of entries) chains.set(entry.id, [...(chains.get(entry.id) ?? []), entry]);
  return chains;
};
const hasCredit = (value, state) => {
  assert.equal(value.source, state.source);
  if (state.section === null) assert.equal(Object.hasOwn(value, 'sourceSection'), false);
  else assert.equal(value.sourceSection, state.section);
};
function assertPublishedChains(revisions, valuesFor) {
  for (const [id, chain] of chainsOf(revisions.entries)) {
    for (const value of valuesFor(id, chain[0].file)) {
      revisions.assertLatest(value, chain[0].file);
      hasCredit(value, chain.at(-1).after);
      const original = revisions.undo(value, chain[0].file);
      hasCredit(original, chain[0].before);
      assert.equal(original.sourceOrigin, chain[0].sourceOrigin);
    }
  }
}
const nextCredit = (entry, source) => {
  const next = structuredClone(entry);
  next.before = structuredClone(entry.after);
  next.after = { source, section: null };
  next.evidence = [{ ...entry.evidence[0], url: source, section: null }];
  return next;
};

test('approved credit replays and reverses exact chains without changing selection', () => {
  for (const chain of chainsOf(ledger.entries).values()) {
    const entry = chain[0];
    const original = payload(entry, entry.before);
    const revised = sourceCreditRevisions.apply(original, entry.file);
    assert.deepEqual(revised, payload(entry, chain.at(-1).after));
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
  assertPublishedChains(sourceCreditRevisions, (id, file) => {
    const matches = catalog.lists.filter((list) => list.id === id);
    assert.equal(matches.length, 1, id);
    return [JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8')), matches[0]];
  });
});

test('published checks follow a two-entry chain where a per-entry check would not', async () => {
  const { ownerGuideSource } = await import('../scripts/browser-owner-guide.mjs');
  const strange = ledger.entries.find(({ id }) => id === 'mcu-prep-doctor-strange-2016');
  const moved = nextCredit(strange, 'https://github.com/raymond-nassar/recap-page/issues/766');
  const revisions = seal([...ledger.entries, moved]);
  const published = { ...payload(strange, moved.after), file: strange.file };
  const valuesFor = (id) => (id === strange.id ? [published] : []);
  assertPublishedChains(revisions, valuesFor);
  assert.throws(() => {
    for (const entry of revisions.entries) {
      for (const value of valuesFor(entry.id)) hasCredit(value, entry.after);
    }
  });
  const contract = { id: strange.id, sourceUrl: strange.before.source };
  assert.equal(ownerGuideSource(contract, published, published, revisions), moved.after.source);
  const legacy = revisions.entries.find((entry) => entry.id === contract.id);
  assert.notEqual(legacy.after.source, moved.after.source);
});

test('each credit guard rejects the one change it owns', () => {
  const base = () => structuredClone(ledger.entries[0]);
  const chained = (change) => {
    const first = base();
    const second = nextCredit(first, 'https://example.test/next');
    change(second);
    return [first, second];
  };
  const single = (change) => {
    const entry = base();
    change(entry);
    return [entry];
  };
  for (const [entries, message] of [
    [single((e) => { e.evidence = e.evidence.map((item) => ({ ...item, url: 'https://example.test/other' })); }),
      /published credit needs matching evidence/],
    [single((e) => { e.evidence = []; }), /evidence is required/],
    [single((e) => { e.evidence[0].retrieved = '2026-02-30'; }), /invalid retrieval date/],
    [single((e) => { e.after = structuredClone(e.before); }), /revision changes nothing/],
    [single((e) => { e.after.source = e.after.source.replace('https:', 'http:'); }), /expected HTTPS/],
    [single((e) => { e.after.source = e.after.source.replace('https://', 'https://user:secret@'); }),
      /credentials are forbidden/],
    [chained((e) => { e.file = 'another_file.json'; }), /revision file changed/],
    [chained((e) => { e.sourceOrigin = 'Changed curation'; }), /owner curation changed/],
    [chained((e) => { e.sourceLicense = 'CC BY 4.0'; }), /licence changed/],
  ]) {
    assert.throws(() => seal(entries), message);
  }

  const entry = base();
  const revisions = seal([entry]);
  assert.throws(() => revisions.apply(payload(entry, entry.before), 'another_file.json'), /credit file changed/);
  const order = {
    id: entry.id, out: entry.file, sourcePage: entry.before.source,
    sourceSection: entry.before.section, sourceOrigin: entry.sourceOrigin, sourceLicense: entry.sourceLicense,
  };
  for (const [change, message] of [
    [{ out: 'another_file.json' }, /manifest output changed/],
    [{ sourceOrigin: 'Changed curation' }, /manifest origin changed/],
    [{ sourceLicense: 'CC BY 4.0' }, /manifest licence changed/],
  ]) {
    assert.throws(() => revisions.validateOrders([{ ...order, ...change }]), message);
  }
});
