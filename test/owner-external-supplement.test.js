import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import { registeredOwnerContracts } from './helpers/current-reading-library.mjs';
import {
  borrowedSupplement, supplementItemFields, supplementItemKind, validateOwnerExternalSupplement,
} from '../scripts/lib/owner-external-supplement.mjs';
import {
  gcdCreditNames, gcdSupplementFields, loadGcdRecords, validateGcdRecords,
} from '../scripts/lib/gcd-issue-records.mjs';
import { assertMappingMatchesPacketOccurrences } from '../scripts/lib/cbh-inventory.mjs';
import { addIssuesToList, createEmptyState, createList, mergeIssueMetadata } from '../src/js/lib/model.js';

const ID = 'captain-america-2025-our-secret-wars';
const json = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const supplementedRow = async () => {
  const mapping = await json(`scripts/data/owner-mappings/${ID}.json`);
  return { mapping, row: mapping.rows.find((row) => row.externalMetadataSupplement) };
};

test('a recorded supplement names one source for every field it supplies', async () => {
  const { mapping, row } = await supplementedRow();
  assert.equal(row.selectedIssueId, 123360);
  validateOwnerExternalSupplement(row);
  const exact = mapping.rows.find((candidate) => candidate.identityEvidenceKind !== 'owner-confirmed-identity');
  assert.throws(() => validateOwnerExternalSupplement({ ...exact, externalMetadataSupplement: row.externalMetadataSupplement }),
    /belongs only to an owner-confirmed identity/);
  const altered = (change) => {
    const copy = structuredClone(row);
    change(copy.externalMetadataSupplement);
    return () => validateOwnerExternalSupplement(copy);
  };
  assert.throws(altered((s) => { s.fields.cover.path = 'https://example.com/u/prod/marvel/i/mg/7/90/x'; }), /pinned cover host/);
  assert.throws(altered((s) => { s.fields.digitalId = 1; }), /may carry only/);
  assert.throws(altered((s) => { delete s.fields.creators; }), /both a cover and credits/);
  assert.throws(altered((s) => { delete s.fields.cover; }), /both a cover and credits/);
  assert.throws(altered((s) => { s.sources.pop(); }), /exactly one recorded source/);
  assert.throws(altered((s) => { s.sources[0].fields.push('creators'); }), /cannot supply/);
  assert.throws(altered((s) => { s.sources[0].url = 'https://read.marvel.com/#/book/1'; }), /own marvel.com issue page/);
  assert.throws(altered((s) => { s.sources[1].url = 'https://marvel.fandom.com/wiki/Captain_America_Vol_14_5'; }), /pinned page revision/);
});

// The Fandom-supplemented row reshaped into the Grand Comics Database form, so the cover source and
// every other field stay those of a real recorded supplement.
const gcdRow = async (gcdIssueId = 2839942) => {
  const { row } = await supplementedRow();
  const copy = structuredClone(row);
  const s = copy.externalMetadataSupplement;
  const derived = gcdSupplementFields(`https://www.comics.org/issue/${gcdIssueId}/`, '2026-11-17');
  s.retrievedAt = '2026-11-17';
  s.fields = { cover: s.fields.cover, onSale: derived.onSale, creators: derived.creators };
  s.sources = [s.sources[0], { kind: 'gcd-issue', url: `https://www.comics.org/issue/${gcdIssueId}/`, fields: ['onSale', 'creators'] }];
  return copy;
};

test('a Grand Comics Database supplement must equal its pinned record and never mixes with the wiki', async () => {
  const row = await gcdRow();
  validateOwnerExternalSupplement(row);
  assert.equal(supplementItemKind(row), 'owner-gcd-supplement');
  assert.equal(supplementItemKind((await supplementedRow()).row), 'owner-external-supplement');
  assert.equal(supplementItemFields(row).pageCount, null);
  assert.ok(row.externalMetadataSupplement.fields.creators.some((c) => c.name === 'Chip Zdarsky' && c.role === 'writer'));
  const altered = (change) => {
    const copy = structuredClone(row);
    change(copy.externalMetadataSupplement);
    return () => validateOwnerExternalSupplement(copy);
  };
  assert.throws(altered((s) => { s.fields.onSale = '2026-06-11T00:00:00+0000'; }), /pinned Grand Comics Database record/);
  assert.throws(altered((s) => { s.fields.creators = s.fields.creators.slice(1); }), /pinned Grand Comics Database record/);
  assert.throws(altered((s) => { s.retrievedAt = '2026-11-16'; }), /cannot predate/);
  assert.throws(altered((s) => { s.sources[1].url = 'https://www.comics.org/issue/1/'; }), /No pinned Grand Comics Database record/);
  assert.throws(altered((s) => { s.sources[1].url = 'https://www.comics.org/series/1/'; }), /one issue page/);
  assert.throws(altered((s) => { s.fields.pageCount = 32; s.sources[1].fields.push('pageCount'); }), /cannot supply/);
  assert.throws(altered((s) => { s.sources[1].fields.push('cover'); }), /cannot supply/);
  assert.throws(altered((s) => {
    s.fields.pageCount = 32;
    s.sources.push({ kind: 'marvel-fandom-wiki', url: 'https://marvel.fandom.com/wiki/X?oldid=1', fields: ['pageCount'] });
  }), /one outside source, not both/);
  assert.throws(altered((s) => {
    s.sources[1].fields = ['onSale'];
    s.sources.push({ kind: 'gcd-issue', url: 'https://www.comics.org/issue/999999999/', fields: ['creators'] });
    s.fields.creators = [{ name: 'Invented Person', role: 'writer' }];
  }), /one Grand Comics Database issue record/);
});

test('Grand Comics Database credits are read without their printing annotations', () => {
  assert.deepEqual(gcdCreditNames('Chip Zdarsky (credited)'), ['Chip Zdarsky']);
  assert.deepEqual(gcdCreditNames('Cafu (credited); Valerio Schiti (credited) (pages 1-10)'), ['Cafu', 'Valerio Schiti']);
  assert.deepEqual(gcdCreditNames('Ryan Stegman (signed as Stegman [scrawl]) (credited)'), ['Ryan Stegman']);
  assert.deepEqual(gcdCreditNames('None'), []);
  assert.deepEqual(gcdCreditNames('?'), []);
  assert.throws(() => gcdCreditNames('Someone (credited'), /Unbalanced/);
  assert.throws(() => gcdCreditNames('Someone [as X'), /Unbalanced/);
  const file = loadGcdRecords();
  assert.equal(file.records.length, 12);
  assert.throws(() => validateGcdRecords({ ...file, license: 'CC BY 4.0' }));
  const bad = structuredClone(file);
  bad.records[0].sequences[0].type = 'text story';
  assert.throws(() => validateGcdRecords(bad), /cover and comic story/);
  const twice = structuredClone(file);
  twice.records.push(twice.records[0]);
  assert.throws(() => validateGcdRecords(twice), /appears twice/);
});

test('a list that vendors no credits for a comic keeps the credits another list supplied', async () => {
  const doomsShadow = await json('src/data/captain_america_2025_dooms_shadow.json');
  const owud = await json('src/data/one_world_under_doom.json');
  const supplemented = doomsShadow.items.find((item) => item.issueId === 123361);
  const bare = owud.items.find((item) => item.issueId === 123361);
  assert.deepEqual(bare.creators, []);
  const merged = mergeIssueMetadata(supplemented, bare);
  assert.deepEqual(merged.creators, supplemented.creators);
  assert.ok(merged.creators.some((creator) => creator.name === 'Ben Harvey'));
});

test('saving lists in either order keeps the detailed record of a shared owner-confirmed comic', async () => {
  const doomsShadow = await json('src/data/captain_america_2025_dooms_shadow.json');
  const owud = await json('src/data/one_world_under_doom.json');
  const rich = doomsShadow.items.find((item) => item.issueId === 123361);
  const bare = owud.items.find((item) => item.issueId === 123361);
  assert.equal(bare.onSale, null);
  assert.equal(bare.cover, null);
  assert.equal(Object.hasOwn(bare, 'metadataSourceKind'), false);
  const save = (state, id, item) => addIssuesToList(createList(state, { id, name: id }), id, [{ ...item, source: 'curated' }]).state;
  const richFirst = save(save(createEmptyState(), 'rich', rich), 'bare', bare).issues[123361];
  const bareFirst = save(save(createEmptyState(), 'bare', bare), 'rich', rich).issues[123361];
  for (const stored of [richFirst, bareFirst]) {
    assert.equal(stored.onSale, rich.onSale);
    assert.equal(stored.pageCount, rich.pageCount);
    assert.equal(stored.cover.path, rich.cover.path);
    assert.deepEqual(stored.creators, rich.creators);
    assert.equal(stored.metadataSourceKind, rich.metadataSourceKind);
    assert.equal(stored.identityEvidenceKind, 'owner-confirmed-identity');
    assert.equal(stored.detailsRefused, true);
  }
  assert.deepEqual(richFirst, bareFirst);
});

test('a reused owner-confirmed comic borrows one agreed non-GCD supplement and nothing else', async () => {
  const names = ['avengers-armageddon', 'captain-america-2025-dooms-shadow', 'captain-america-2025-hells-angel',
    'captain-america-2025-our-secret-wars', 'one-world-under-doom'];
  const mappings = await Promise.all(names.map(async (listId) => ({
    listId, rows: (await json(`scripts/data/owner-mappings/${listId}.json`)).rows,
  })));
  const none = { ownMappedIds: new Set(), mappings };
  const ours = mappings.find((m) => m.listId === ID).rows.find((row) => row.selectedIssueId === 123360);
  assert.deepEqual(borrowedSupplement(123360, none), {
    supplement: supplementItemFields(ours), reason: 'borrowed', lenders: [ID],
  });
  // Two lists publish identical details for this one, so either may lend them.
  const shared = borrowedSupplement(123362, none);
  assert.equal(shared.reason, 'borrowed');
  assert.deepEqual(shared.lenders, ['avengers-armageddon', 'captain-america-2025-dooms-shadow']);
  // One World Under Doom reviewed it bare, and its own review wins over any lender.
  assert.deepEqual(borrowedSupplement(123361, { ownMappedIds: new Set(['123361']), mappings }),
    { supplement: undefined, reason: 'own-mapping-row' });
  // Grand Comics Database details are share-alike, so they are lent only to a licensed payload.
  assert.deepEqual(borrowedSupplement(134097, none), { supplement: undefined, reason: 'no-lender' });
  const gcd = mappings.find((m) => m.listId === 'avengers-armageddon').rows.find((row) => row.selectedIssueId === 134097);
  assert.deepEqual(borrowedSupplement(134097, { ...none, shareAlike: true }), {
    supplement: supplementItemFields(gcd), reason: 'borrowed', lenders: ['avengers-armageddon'],
  });
  assert.equal(supplementItemFields(gcd).metadataSourceKind, 'owner-gcd-supplement');
  const altered = structuredClone(mappings[1].rows.find((row) => row.selectedIssueId === 123362));
  altered.externalMetadataSupplement.fields.pageCount += 1;
  const conflict = borrowedSupplement(123362, { ownMappedIds: new Set(), mappings: [...mappings, { listId: 'other', rows: [altered] }] });
  assert.equal(conflict.reason, 'conflict');
  assert.equal(conflict.supplement, undefined);
});

test('the inventory refuses a supplement on a row the owner did not confirm', async () => {
  const [packet, { mapping, row }] = await Promise.all([json(`scripts/data/owner-packets/${ID}.json`), supplementedRow()]);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  const moved = structuredClone(mapping);
  moved.rows[0].externalMetadataSupplement = row.externalMetadataSupplement;
  assert.throws(() => assertMappingMatchesPacketOccurrences(packet, moved), /invalid external metadata supplement/);
});

test('the delivery contract holds a supplemented comic to exactly what its mapping records', async () => {
  const contract = registeredOwnerContracts.find((entry) => entry.id === ID);
  await assertOwnerDeliveryContract(contract);
  const payloadPath = 'src/data/captain_america_2025_our_secret_wars.json';
  const tampered = (change) => assertOwnerDeliveryContract(contract, {
    readJson: async (name) => {
      const value = await json(name);
      if (name === payloadPath) change(value.items.find((item) => item.issueId === 123360));
      return value;
    },
  });
  await assert.rejects(tampered((item) => { item.digitalId = 99999; }));
  await assert.rejects(tampered((item) => { item.mu = '2026-01-01'; }));
  await assert.rejects(tampered((item) => { item.cover = { ...item.cover, path: `${item.cover.path}0` }; }));
  await assert.rejects(tampered((item) => { delete item.metadataSourceKind; }));
  await assert.rejects(tampered((item) => { item.pageCount = 40; }));
});
