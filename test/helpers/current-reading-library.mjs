import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readOwnerGuideRegistry } from '../../scripts/lib/owner-guide-registry.mjs';
import { spiderManSelectionItemDelta } from './reading-choice-history.mjs';

const { captureSha256, ...baseline } = JSON.parse(readFileSync(
  new URL('../fixtures/reading-library-baseline.json', import.meta.url), 'utf8',
));
assert.equal(baseline.sourceCommit, 'de687692f4c42483d89ca7ddff5c199b603b3117');
assert.equal(createHash('sha256').update(JSON.stringify(baseline)).digest('hex'), captureSha256);
assert.equal(captureSha256, '3fce32e3d2bbd8617776704ce499fe4515eab5dc9c8e5826925a89ab991ad2a3');
const registrations = readOwnerGuideRegistry().guides;
export const registeredOwnerIds = registrations.map(({ id }) => id);
export const registeredOwnerContracts = registrations.map((entry) => {
  const contract = JSON.parse(readFileSync(new URL(`../../${entry.contract}`, import.meta.url), 'utf8'));
  assert.equal(contract.id, entry.id);
  assert.equal(contract.surface, entry.surface, 'A delivery contract must retain its registered surface.');
  assert.ok(Array.isArray(contract.rows) && contract.rows.length > 0);
  assert.equal(new Set(contract.rows.map((row) => row[1])).size, contract.rows.length);
  assert.equal(contract.vectorSha256,
    createHash('sha256').update(JSON.stringify(contract.rows.map((row) => row[1]))).digest('hex'));
  return contract;
});
const addedRows = registeredOwnerContracts.reduce((total, contract) => total + contract.rows.length, 0);
const mcuContracts = registeredOwnerContracts.filter((contract) => contract.surface !== 'modern-timeline');
export const registeredEventContracts = registeredOwnerContracts.filter((contract) => contract.surface === 'modern-timeline');
export const currentReadingCensus = Object.freeze({
  sources: baseline.sourceIds.length + registrations.length,
  visible: baseline.catalogIds.length + registrations.length,
  allOrders: new Set([...baseline.sourceIds, ...baseline.catalogIds]).size + registrations.length,
  peers: new Set([...baseline.sourceIds, ...baseline.catalogIds]).size + registrations.length - 1,
  mcu: baseline.mcuEntries.length + mcuContracts.length,
  // The qualified UX pool retains 46 non-MCU readings; new MCU guides share its canonical shelf.
  storylines: 46 + baseline.mcuEntries.length + mcuContracts.length,
  modernTimeline: 148 + registeredEventContracts.length,
  modernTimelineStories: 144 + registeredEventContracts.length,
  complete: baseline.payloadCounts.complete + addedRows + spiderManSelectionItemDelta,
  totalItems: baseline.payloadCounts.total + addedRows + spiderManSelectionItemDelta,
  itemFiles: 297 + registrations.length,
});

function expectedRosters(contracts) {
  const expectedSources = [...baseline.sourceIds];
  for (const contract of contracts) {
    const at = expectedSources.indexOf(contract.insertionAnchor?.beforeId);
    assert.ok(at >= 0, 'Registered source insertion needs its approved anchor.');
    expectedSources.splice(at, 0, contract.id);
  }
  const expectedVisible = expectedSources.flatMap((id) => baseline.families[id] ?? [id]);
  return { expectedSources, expectedVisible };
}

export function assertCurrentReadingRoster(manifest, catalog, contracts = registeredOwnerContracts) {
  const { expectedSources, expectedVisible } = expectedRosters(contracts);
  assert.equal(new Set(expectedSources).size, expectedSources.length, 'Registration cannot replace a baseline source.');
  assert.equal(new Set(expectedVisible).size, expectedVisible.length, 'Registration cannot replace a baseline card.');
  assert.deepEqual(manifest.lists.map(({ id }) => id), expectedSources,
    'Current source roster must contain every baseline source and every registered owner addition exactly once.');
  assert.deepEqual(catalog.lists.map(({ id }) => id), expectedVisible,
    'Current visible roster must retain generated children and omit hidden parents.');
}

export function legacyOwnerPeers(entries) {
  return entries.filter((entry) => !registeredOwnerIds.includes(
    typeof entry === 'string' ? entry : entry.id ?? entry.orderId,
  ));
}

export function expectedMcuTitles() {
  const names = new Map([...baseline.mcuEntries, ...mcuContracts].map(({ id, name }) => [id, name]));
  return expectedRosters(registeredOwnerContracts).expectedVisible.filter((id) => names.has(id)).map((id) => names.get(id));
}

export function assertLegacyMcuTitles(titles) {
  assert.deepEqual(titles, expectedMcuTitles());
  assert.equal(titles.length, currentReadingCensus.mcu);
}
