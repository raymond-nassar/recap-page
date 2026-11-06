import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertOwnerDeliveryContract, recordedOwnerManifest } from './helpers/owner-delivery-contract.mjs';
import { readOwnerGuideRegistry } from '../scripts/lib/owner-guide-registry.mjs';
import { approvalDigestFor, libraryDigestFor, reportDigestFor } from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { withRetiredOrders } from './helpers/mcu-editorial-history.mjs';
import { beforeIdentityOrders, identityRevisions } from './helpers/owner-identity-history.mjs';
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

test('a Comic Book Herald baseline contract still refuses a later list nobody registered', async () => {
  // These contracts once compared the whole current library, so every list published after them
  // failed all five. They now compare the library they were reviewed against, which stays safe only
  // while each later list must be registered with its own reciprocal authority.
  const contract = registeredOwnerContracts.find(({ id }) => id === 'shang-chi-master-of-kung-fu-reading-order');
  await assertOwnerDeliveryContract(contract);
  await assert.rejects(assertOwnerDeliveryContract(contract, {
    contracts: registeredOwnerContracts.filter(({ id }) => id !== 'marvel-rising'),
  }), /marvel-rising: unregistered later peers require a new bounded relationship review/);
});

async function expandedReviewFixture(id) {
  const original = registeredOwnerContracts.find((entry) => entry.id === id);
  const contract = structuredClone(original);
  const mappingPath = `scripts/data/owner-mappings/${contract.id}.json`;
  const reportPath = `scripts/data/owner-overlaps/${contract.id}.json`;
  const [mapping, report, library] = await Promise.all([
    json(mappingPath), json(reportPath), loadCurrentOwnerLibrary(contract.id),
  ]);
  const recordedIds = new Set(report.comparisons.map(({ orderId }) => orderId));
  const cbh = contract.sourceProvider === 'comic-book-herald';
  const publication = identityRevisions.guides.filter((revision) =>
    revision.id === id && revision.placeholderReplacement).at(-1);
  const allOrders = cbh ? beforeIdentityOrders(library.orders, '',
    identityRevisions.guides.filter((revision) => revision.placeholderReplacement
      && revision.publicationOrder > (publication?.publicationOrder ?? 0))) : library.orders;
  const selected = allOrders.filter(({ orderId }) => recordedIds.has(orderId));
  const orders = cbh ? selected : withRetiredOrders(selected, recordedIds);
  const manifest = recordedOwnerManifest(library.manifest, recordedIds, { candidateId: contract.id });
  report.libraryDigest = libraryDigestFor(manifest, orders.map(({ orderId, issueIds }) => ({
    id: orderId, issueIds: issueIds.map(String),
  })));
  const candidateIds = cbh ? mapping.rows.map((row) => row.selectedIssueId) : contract.rows.map((row) => row[1]);
  Object.assign(report, buildComparisonReport({ candidateIds, orders }));
  report.reportDigest = reportDigestFor(report);
  const previous = new Map(mapping.relationshipReview.dispositions.map((entry) => [entry.orderId, entry]));
  mapping.relationshipReview.dispositions = report.comparisons.map((comparison) => ({
    ...previous.get(comparison.orderId), ...comparison,
    ...(comparison.relationship === 'none' ? {} : {
      authorityType: 'stronger-model', authorityIdentity: 'Synthetic test reviewer',
    }),
  }));
  mapping.relationshipReview.reportDigest = report.reportDigest;
  mapping.relationshipReview.libraryDigest = report.libraryDigest;
  mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
  contract.libraryDigest = report.libraryDigest;
  contract.approvalDigest = mapping.relationshipReview.approvalDigest;
  const readJson = async (name) => {
    if (name === mappingPath) return mapping;
    if (name === reportPath) return report;
    return json(name);
  };
  return { contract, mapping, report, readJson };
}

for (const id of ['mcu-prep-visionquest', 'shang-chi-master-of-kung-fu-reading-order']) {
  test(`${id}: an approval against the expanded Spider-Man guide keeps that exact library`, async () => {
    const { contract, mapping, report, readJson } = await expandedReviewFixture(id);
    await assertOwnerDeliveryContract(contract, { readJson });
    report.libraryDigest = 'f'.repeat(64);
    report.reportDigest = reportDigestFor(report);
    mapping.relationshipReview.libraryDigest = report.libraryDigest;
    mapping.relationshipReview.reportDigest = report.reportDigest;
    mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
    contract.libraryDigest = report.libraryDigest;
    contract.approvalDigest = mapping.relationshipReview.approvalDigest;
    await assert.rejects(assertOwnerDeliveryContract(contract, { readJson }), (error) => {
      const actual = typeof error.actual === 'object' ? error.actual.libraryDigest : error.actual;
      const expected = typeof error.expected === 'object' ? error.expected.libraryDigest : error.expected;
      assert.equal(expected, report.libraryDigest);
      assert.notEqual(actual, expected);
      return true;
    });
  });
}

for (const contract of registeredOwnerContracts) {
  test(`${contract.id}: accepted input, public source, authority and generated surfaces agree`,
    () => assertOwnerDeliveryContract(contract));
}
