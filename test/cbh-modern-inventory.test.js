import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBatchNoDuplicates, validateInventory, validateLiveInventory } from '../scripts/lib/cbh-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const selectedExpansionIds = new Set([
  'generations',
  'x-men-extermination',
  'spider-geddon',
  'age-of-x-man',
  'iron-man-2020',
  'war-of-the-realms',
  'absolute-carnage',
  'empyre',
  'x-of-swords',
  'heroes-reborn-2021',
  'infinite-destinies',
  'last-annihilation',
  'x-men-inferno',
  'death-of-doctor-strange',
  'devils-reign',
  'reckoning-war',
  'judgment-day',
  'dark-web',
  'sins-of-sinister',
  'secret-empire',
  'hunt-for-wolverine',
  'fall-house-x-rise-powers-x',
  'one-world-under-doom',
]);

test('the maintained inventory matches the current lifecycle contract', () => {
  const counts = validateInventory(inventory);

  assert.equal(inventory.length, 86);
  assert.deepEqual(inventory.map((record) => record.position), Array.from({ length: 86 }, (_, index) => index + 1));

  const ids = inventory.map((record) => record.id);
  const urls = inventory.map((record) => record.url);
  assert.equal(new Set(ids).size, 86);
  assert.equal(new Set(urls).size, 86);

  assert.deepEqual(counts, {
    event: 42,
    era: 14,
    'sub-guide': 14,
    bridge: 10,
    'fast-track': 3,
    commerce: 3,
  });

  assert.ok(inventory.every((record) => record.reason && record.reason.trim().length > 0));
  assert.ok(inventory.every((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.sourceRetrievedAt)));
  assert.ok(inventory.filter((record) => record.guideType === 'commerce').every((record) => record.disposition === 'excluded'));
  assert.equal(inventory.find((record) => record.id === 'armageddon-2026')?.disposition, 'deferred');
  assert.ok(inventory.every((record) => (
    Array.isArray(record.overlapIds)
    && record.overlapIds.every((id) => typeof id === 'string')
    && new Set(record.overlapIds).size === record.overlapIds.length
  )));
  assert.ok(inventory.every((record) => (
    Array.isArray(record.catalogIds)
    && record.catalogIds.every((id) => typeof id === 'string')
    && new Set(record.catalogIds).size === record.catalogIds.length
  )));
  assert.ok(inventory.filter((record) => record.disposition === 'new-order').every((record) => (
    ['pending', 'ready', 'shipped', 'blocked'].includes(record.deliveryStatus)
  )));
  assert.ok(inventory.filter((record) => record.deliveryStatus === 'blocked').every((record) => (
    record.reason.startsWith('Blocked:')
  )));
  assert.ok(inventory.filter((record) => record.disposition !== 'new-order').every((record) => (
    ['not-applicable', 'ready', 'shipped', 'blocked'].includes(record.deliveryStatus)
  )));
  assert.equal(inventory.filter((record) => (
    selectedExpansionIds.has(record.id) && record.deliveryStatus === 'pending'
  )).length, 0);
});

test('batch duplicate guard rejects repeated ids, URLs, issue sequences, and catalog ids', () => {
  const existing = [{
    id: 'existing-guide',
    url: 'https://example.com/existing-guide',
    selectedIssueIds: ['1000', '1001'],
    catalogIds: ['catalog-1'],
  }];
  const peer = [{
    id: 'peer-guide',
    url: 'https://example.com/peer-guide',
    selectedIssueIds: ['2000', '2001'],
    catalogIds: ['catalog-2'],
  }];

  assert.doesNotThrow(() => validateBatchNoDuplicates([
    {
      id: 'new-guide',
      url: 'https://example.com/new-guide',
      selectedIssueIds: ['3000', '3001'],
      catalogIds: ['catalog-3'],
    },
  ], existing, peer));
  assert.doesNotThrow(() => validateBatchNoDuplicates([
    {
      id: 'new-guide',
      url: 'https://example.com/new-guide',
      selectedIssueIds: ['3000', '3001'],
      catalogIds: ['catalog-3'],
    },
  ], [
    existing[0],
    {
      id: 'existing-variant',
      url: existing[0].url,
      selectedIssueIds: ['1002', '1003'],
      catalogIds: ['catalog-variant'],
    },
  ], peer), 'pre-existing source variants must not block an unrelated batch');

  const duplicateIdBatch = [{
    id: 'existing-guide',
    url: 'https://example.com/brand-new',
    selectedIssueIds: ['4000', '4001'],
    catalogIds: ['catalog-4'],
  }];
  assert.throws(() => validateBatchNoDuplicates(duplicateIdBatch, existing, peer), /Duplicate batch id/i);

  const duplicateUrlBatch = [{
    id: 'duplicate-url-guide',
    url: 'https://example.com/existing-guide',
    selectedIssueIds: ['5000', '5001'],
    catalogIds: ['catalog-5'],
  }];
  assert.throws(() => validateBatchNoDuplicates(duplicateUrlBatch, existing, peer), /Duplicate source URL/i);

  const duplicateSequenceBatch = [{
    id: 'duplicate-sequence-guide',
    url: 'https://example.com/duplicate-sequence',
    selectedIssueIds: ['1000', '1001'],
    catalogIds: ['catalog-6'],
  }];
  assert.throws(() => validateBatchNoDuplicates(duplicateSequenceBatch, existing, peer), /Duplicate selected issue sequence/i);

  const duplicateCatalogBatch = [{
    id: 'duplicate-catalog-guide',
    url: 'https://example.com/duplicate-catalog',
    selectedIssueIds: ['6000', '6001'],
    catalogIds: ['catalog-1'],
  }];
  assert.throws(() => validateBatchNoDuplicates(duplicateCatalogBatch, existing, peer), /Duplicate catalog id/i);
});

test('batch duplicate guard keys a sectioned source by page and visible section', () => {
  const sharedPage = 'https://example.com/x-men-events';
  const records = [
    {
      id: 'divided-we-stand',
      url: sharedPage,
      sourceSection: 'X-Men: Divided We Stand',
      selectedIssueIds: ['7000'],
      catalogIds: ['catalog-divided'],
    },
    {
      id: 'manifest-destiny',
      url: sharedPage,
      sourceSection: 'X-Men: Manifest Destiny',
      selectedIssueIds: ['7001'],
      catalogIds: ['catalog-manifest'],
    },
  ];

  assert.doesNotThrow(() => validateBatchNoDuplicates(records));
  assert.throws(() => validateBatchNoDuplicates([
    records[0],
    {
      ...records[1],
      sourceSection: records[0].sourceSection,
    },
  ]), /Duplicate source page and section/i);
  assert.throws(() => validateBatchNoDuplicates([
    { ...records[0], sourceSection: undefined },
    { ...records[1], sourceSection: undefined },
  ]), /Duplicate source URL/i);
  assert.throws(() => validateBatchNoDuplicates([
    records[0],
    { ...records[1], sourceSection: undefined },
  ]), /Duplicate source URL/i);
  assert.throws(() => validateBatchNoDuplicates([
    records[0],
  ], [{
    ...records[1],
    sourceSection: undefined,
  }]), /Duplicate source URL/i);
});

test('live inventory validation accepts a guarded lifecycle and rejects invalid transitions', () => {
  const liveRecords = [
    {
      position: 1,
      id: 'ready-order',
      title: 'Ready Order',
      url: 'https://example.com/ready',
      guideType: 'event',
      window: 'Q1',
      disposition: 'new-order',
      reason: 'Awaiting approval',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: ['101'],
      catalogIds: ['catalog-1'],
      deliveryStatus: 'ready',
    },
    {
      position: 2,
      id: 'shipped-order',
      title: 'Shipped Order',
      url: 'https://example.com/shipped',
      guideType: 'event',
      window: 'Q1',
      disposition: 'new-order',
      reason: 'Approved and published',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: ['101', '102'],
      catalogIds: ['catalog-1', 'catalog-2'],
      deliveryStatus: 'shipped',
    },
    {
      position: 3,
      id: 'blocked-order',
      title: 'Blocked Order',
      url: 'https://example.com/blocked',
      guideType: 'event',
      window: 'Q1',
      disposition: 'new-order',
      reason: 'Blocked by unresolved overlap',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: [],
      catalogIds: ['catalog-3'],
      deliveryStatus: 'blocked',
    },
    {
      position: 4,
      id: 'reused-order',
      title: 'Reused Order',
      url: 'https://example.com/reused',
      guideType: 'era',
      window: 'Q2',
      disposition: 'reuse-existing',
      reason: 'Already published',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: [],
      catalogIds: [],
      deliveryStatus: 'not-applicable',
    },
    {
      position: 5,
      id: 'grouped-order',
      title: 'Grouped Order',
      url: 'https://example.com/grouped',
      guideType: 'era',
      window: 'Q2',
      disposition: 'grouped-variant',
      reason: 'Published as discrete child orders',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: [],
      catalogIds: ['catalog-4'],
      deliveryStatus: 'shipped',
    },
    {
      position: 6,
      id: 'section-one',
      title: 'Section One',
      url: 'https://example.com/shared-page',
      sourceSection: 'First Section',
      guideType: 'era',
      window: 'Q2',
      disposition: 'deferred',
      reason: 'Inventoried as a section of a larger source page.',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: [],
      catalogIds: [],
      deliveryStatus: 'not-applicable',
    },
    {
      position: 7,
      id: 'section-two',
      title: 'Section Two',
      url: 'https://example.com/shared-page',
      sourceSection: 'Second Section',
      guideType: 'era',
      window: 'Q2',
      disposition: 'deferred',
      reason: 'Inventoried as a separate section of the same source page.',
      sourceRetrievedAt: '2026-08-20',
      overlapIds: [],
      catalogIds: [],
      deliveryStatus: 'not-applicable',
    },
  ];

  assert.doesNotThrow(() => validateLiveInventory(liveRecords));

  const invalid = {
    ...liveRecords[0],
    deliveryStatus: 'not-applicable',
    disposition: 'new-order',
  };
  assert.throws(() => validateLiveInventory([invalid]), /deliveryStatus/i);
  assert.throws(() => validateLiveInventory([
    { ...liveRecords[5], position: 1 },
    { ...liveRecords[6], position: 2, sourceSection: liveRecords[5].sourceSection },
  ]), /Duplicate inventory source section/i);
  assert.throws(() => validateLiveInventory([
    { ...liveRecords[5], position: 1, sourceSection: undefined },
    { ...liveRecords[6], position: 2 },
  ]), /Duplicate inventory url/i);
});
