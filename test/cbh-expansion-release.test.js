import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCatalog, timelineLabel } from '../src/js/lib/catalog.js';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

test('Infinite Destinies uses the 2020 Black Cat volume for both crossover chapters', async () => {
  const mapping = await readJson('scripts/data/cbh-mappings/infinite-destinies.json');
  const payload = await readJson('src/data/infinite_destinies.json');
  const selectedIssueIds = mapping.rows.map((row) => Number(row.selectedIssueId));
  const payloadIssueIds = issueIdsFromValue(payload).map(Number);

  assert.equal(selectedIssueIds[5], 91374);
  assert.equal(selectedIssueIds[9], 91375);
  assert.equal(payloadIssueIds[5], 91374);
  assert.equal(payloadIssueIds[9], 91375);
  assert.equal(selectedIssueIds.includes(76159), false);
  assert.equal(selectedIssueIds.includes(76160), false);
});

test('the corrected event shelf follows each reading order first issue', async () => {
  const catalog = parseCatalog(await readJson('src/data/catalog.json')).lists;
  const ids = catalog.map((entry) => entry.id);

  assert.ok(ids.indexOf('venomverse') < ids.indexOf('generations'));
  assert.ok(ids.indexOf('hunt-for-wolverine') < ids.indexOf('spider-geddon'));
  assert.deepEqual(
    ids.filter((id) => [
      'heroes-reborn-2021',
      'infinite-destinies',
      'last-annihilation',
      'death-of-doctor-strange',
      'x-men-inferno',
    ].includes(id)),
    [
      'heroes-reborn-2021',
      'infinite-destinies',
      'last-annihilation',
      'death-of-doctor-strange',
      'x-men-inferno',
    ],
  );
});

test('event start labels use the year reading begins', async () => {
  const catalog = parseCatalog(await readJson('src/data/catalog.json')).lists;
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));

  assert.equal(timelineLabel(byId.get('devils-reign')), 'Starts 2021');
  assert.equal(timelineLabel(byId.get('sins-of-sinister')), 'Starts 2022');
});
