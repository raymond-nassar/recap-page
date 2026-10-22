import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import { readOwnerGuideRegistry } from '../scripts/lib/owner-guide-registry.mjs';
import {
  assertCurrentReadingRoster, currentReadingCensus, registeredCatalogAdditionIds, registeredOwnerContracts,
} from './helpers/current-reading-library.mjs';

const json = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));

test('the live source and visible rosters match an independent baseline plus explicit owner registrations', async () => {
  const [manifest, catalog] = await Promise.all([json('src/data/curated-lists.json'), json('src/data/catalog.json')]);
  assertCurrentReadingRoster(manifest, catalog);
  assert.equal(manifest.lists.length, currentReadingCensus.sources);
  assert.equal(catalog.lists.length, currentReadingCensus.visible);
  const absent = structuredClone(catalog);
  absent.lists.pop();
  assert.throws(() => assertCurrentReadingRoster(manifest, absent), /visible roster/);
  const replaced = structuredClone(catalog);
  replaced.lists[0].id = 'synthetic-unregistered-card';
  assert.throws(() => assertCurrentReadingRoster(manifest, replaced), /visible roster/);
  const futureManifest = structuredClone(manifest);
  const futureCatalog = structuredClone(catalog);
  futureManifest.lists.unshift({ id: 'synthetic-future-owner' });
  futureCatalog.lists.unshift({ id: 'synthetic-future-owner' });
  assert.throws(() => assertCurrentReadingRoster(futureManifest, futureCatalog), /source roster/);
  assertCurrentReadingRoster(futureManifest, futureCatalog, [
    ...registeredOwnerContracts,
    { id: 'synthetic-future-owner', insertionAnchor: { beforeId: manifest.lists[0].id } },
  ]);
});

test('Brand New Day registration preserves its baseline rows, display groups and roster count', async () => {
  const id = 'mcu-prep-spider-man-brand-new-day';
  const registration = readOwnerGuideRegistry().guides.find((entry) => entry.id === id);
  assert.deepEqual(registration, {
    id,
    contract: `test/fixtures/owner-delivery/${id}.json`,
    baselineRowCount: 19,
  });
  assert.equal(registeredCatalogAdditionIds.includes(id), false);
  const contract = registeredOwnerContracts.find((entry) => entry.id === id);
  assert.ok(contract, 'The existing baseline guide must have an owner-delivery contract.');
  const [manifest, catalog, payload] = await Promise.all([
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    json('src/data/mcu_prep_spider_man_brand_new_day.json'),
  ]);
  assertCurrentReadingRoster(manifest, catalog);
  assert.equal(currentReadingCensus.sources, manifest.lists.length);
  assert.equal(currentReadingCensus.visible, catalog.lists.length);
  assert.deepEqual(contract.groups, [...new Set(payload.items.map((item) => item.collectedIn))]);
  assert.equal(contract.rows.length - registration.baselineRowCount,
    payload.items.filter((item) => item.identityEvidenceKind === 'owner-confirmed-identity').length);
});

for (const contract of registeredOwnerContracts) {
  test(`${contract.id}: accepted input, public source, authority and generated surfaces agree`,
    () => assertOwnerDeliveryContract(contract));
}
