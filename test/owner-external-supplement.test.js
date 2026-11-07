import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import { registeredOwnerContracts } from './helpers/current-reading-library.mjs';
import { validateOwnerExternalSupplement } from '../scripts/lib/owner-external-supplement.mjs';
import { assertMappingMatchesPacketOccurrences } from '../scripts/lib/cbh-inventory.mjs';

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
  assert.throws(altered((s) => { s.sources.pop(); }), /exactly one recorded source/);
  assert.throws(altered((s) => { s.sources[0].fields.push('creators'); }), /cannot supply/);
  assert.throws(altered((s) => { s.sources[0].url = 'https://read.marvel.com/#/book/1'; }), /own marvel.com issue page/);
  assert.throws(altered((s) => { s.sources[1].url = 'https://marvel.fandom.com/wiki/Captain_America_Vol_14_5'; }), /pinned page revision/);
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
