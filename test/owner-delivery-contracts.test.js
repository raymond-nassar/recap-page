import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import {
  assertCurrentReadingRoster, currentReadingCensus, registeredCuratedPeerContracts, registeredOwnerContracts,
} from './helpers/current-reading-library.mjs';
import { assertCuratedGuidePeerReview } from './helpers/curated-guide-peer-review.mjs';

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

for (const contract of registeredOwnerContracts) {
  test(`${contract.id}: accepted input, public source, authority and generated surfaces agree`,
    () => assertOwnerDeliveryContract(contract));
}

for (const contract of registeredCuratedPeerContracts) {
  test(`${contract.id}: local curated peer review binds the complete current library`,
    async () => assertCuratedGuidePeerReview(contract));
}
