import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'captain-america-reading-order-modern-marvel-era';
const sourceLabels = [
  'Captain America: The New Deal (#1 – #6)',
  'Truth: Red, White, and Black (#1 – #7)',
  'Captain America (#7 – #28) – Vol 2, Vol 3, Vol 4, Vol 5',
  'Captain America: Disassembled (#29 – #32)',
  'Captain America and the Falcon (#5 – #7)',
  'Avengers Disassembled (#1 – #4)',
  'Secret War (#1 – #5)',
  'Captain America – The Winter Solider Through Civil War',
  'Captain America: The Winter Soldier (#1 – #8)',
  'New Avengers: Breakout (#1 – #6)',
  'Young Avengers (#1 – #6)',
  'Captain America (#9) + House of M',
  'Captain America (#10 – #14)',
  'New Avengers: Sentry (#7 – #10) & New Avengers: Secrets & Lies (#11 – #15)',
  'Captain America: Red Menace (#15 – #21)',
  'New Avengers: The Collective (#17 – #20)',
  'Civil War + Captain America: Civil War (#22 – #24) + Winter Soldier: Winter Kills + New Avengers: Civil War (#21 – #25)',
  'Captain America #25',
  'Civil War: The Confession + Fallen Son',
  'Captain America (#26 – 42)',
  'Captain America: The Man With No Face (#43 – #48)',
  'New Avengers (#48 – #50)',
  'Captain America: Road to Reborn (#48 – #49, #600 – #601)',
  'Captain America: Reborn (#1 – #6)',
  'New Avengers (#51 – #60) + Siege',
  'Avengers Prime (#1 – #5)',
  'Captain America: Two Americas (#602 – #605) + Captain America: Who Will Wield the Shield?',
  'Captain America (#606 – #619)',
  'Avengers (#1 – #12)',
  'Steve Rogers: Super Soldier (#1 – #4)',
  'Captain America and Bucky: The Life Story of Bucky Barnes',
  'Captain America and Bucky: Old Wounds',
  'Secret Avengers: Mission to Mars (#1- #5)',
  'Captain America: Shattered Heroes (#1 – #10)',
  'Winter Soldier: The Longest Winter + Fear Itself #7.1: Captain America',
  'Winter Soldier: Broken Arrows (#6 – #9) + Winter Soldier: Black Widow Hunt (#10 – #14)',
  'Avengers: X-Sanction (#1 – #4)',
  'Avengers vs. X-Men (#1 – #12)',
  'All-New Captain America: Fear Him',
  'All-New Captain America Vol. 1: Hydra Ascendant',
  'Captain America & the Mighty Avengers Vol. 1: Open for Business',
  'Captain America & the Mighty Avengers Vol. 2: Last Days',
  'Uncanny Avengers: Unity Vol. 1: Lost Future (Uncanny Avengers #1 to #6)',
  'All-New All-Different Avengers Vol. 1: The Magnificent Seven (All-New All-Different Avengers #1 to #6)',
  'Captain America: Sam Wilson Vol. 1: Not My Captain America (Captain America: Sam Wilson #1 to #6)',
  'Captain America: Steve Rogers Vol. 1 (Captain America: Steve Rogers #1 to #6)',
  'Captain America: Steve Rogers Vol. 2: The Trial of Maria Hill',
  'Captain America: Sam Wilson Vol. 4: #TakeBackTheShield',
  'Captain America: Steve Rogers Vol. 3 (Secret Empire tie-ins)',
  'Captain America: Sam Wilson Vol. 5',
  'Uncanny Avengers: Unity Vol. 4: Red Skull',
  'Captain America: Steve Rogers Vol. 3 (After Secret Empire)',
  'Secret Empire',
  'Captain America by Waid & Samnee: Home of the Brave',
  'Captain America by Mark Waid: Promised Land',
  'Captain America by Ta-Nehisi Coates Vol. 1: Winter in America',
  'Captain America by Ta-Nehisi Coates Vol. 2: Captain of Nothing',
  'Captain America by Ta-Nehisi Coates Vol. 3: The Legend of Steve',
  'Captain America by Ta-Nehisi Coates Vol. 4',
  'Captain America by Ta-Nehisi Coates Vol. 5',
  'The United States of Captain America',
  'Captain America/Iron Man Vol. 1: The Armor and The Shield',
  'Captain America: Sentinel of Liberty Vol. 1: Revolution',
  'Captain America: Sentinel of Liberty Vol. 2: The Invader',
  'Captain America: Symbol of Truth Vol. 1: Homeland',
  'Captain America: Symbol of Truth Vol. 2: Pax Mohannda',
  'Captain America: Cold War',
  'Uncanny Avengers (2023)',
  'Captain America (2023)',
];

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

test('Captain America modern publishes its one atomic issue and preserves 68 semantic exclusions', async () => {
  const [markdown, payload, manifest, catalog, inventory] = await Promise.all([
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
    readJson('src', 'data', 'captain_america_reading_order_modern_marvel_era.json'),
    readJson('src', 'data', 'curated-lists.json'),
    readJson('src', 'data', 'catalog.json'),
    readJson('scripts', 'data', 'cbh-character-inventory.json'),
  ]);
  const quotedLabels = markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('> '))
    .map((line) => line.slice(2));
  const parsed = parseChecklist(markdown);
  const manifestRecord = manifest.lists.find((entry) => entry.id === id);
  const catalogRecord = catalog.lists.find((entry) => entry.id === id);
  const inventoryRecord = inventory.find((entry) => entry.id === id);

  assert.deepEqual(quotedLabels, sourceLabels);
  assert.equal(parsed.sourcePositions.length, 69);
  assert.deepEqual(parsed.sourcePositions.map((position) => position.ordinal), (
    Array.from({ length: 69 }, (_, index) => index + 1)
  ));
  assert.deepEqual(
    parsed.sourcePositions.filter((position) => position.count > 0)
      .map((position) => [position.ordinal, position.count]),
    [[18, 1]],
  );
  assert.equal(parsed.sourcePositions.filter((position) => position.count === 0).length, 68);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(
    parsed.entries.map(({ issueId, title, sourceKey }) => ({ issueId, title, sourceKey })),
    [{ issueId: 6010, title: 'Captain America (2004) #25', sourceKey: '18' }],
  );
  assert.notEqual(sourceLabels[48], sourceLabels[51]);

  assert.deepEqual(
    {
      count: payload.count,
      placeholders: payload.placeholders,
      unresolved: payload.unresolved,
      items: payload.items.map(({ issueId, seriesId, digitalId, title, url }) => ({
        issueId, seriesId, digitalId, title, url,
      })),
    },
    {
      count: 1,
      placeholders: 0,
      unresolved: [],
      items: [{
        issueId: 6010,
        seriesId: 832,
        digitalId: 8054,
        title: 'Captain America (2004) #25',
        url: 'https://www.marvel.com/comics/issue/6010/captain_america_2004_25',
      }],
    },
  );
  assert.equal(manifestRecord.expect, 1);
  assert.equal(manifestRecord.coverIssueId, 6010);
  assert.equal(catalogRecord.count, 1);
  assert.equal(catalogRecord.placeholderCount, 0);
  assert.equal(catalogRecord.emptyRecordCount, 0);
  assert.equal(catalogRecord.coverIssueId, 6010);

  const peersWithIssue = [];
  for (const entry of manifest.lists) {
    if (entry.id === id) continue;
    const peer = await readJson('src', 'data', entry.out);
    if (peer.items.some((item) => item.issueId === 6010 && item.placeholder !== true)) {
      peersWithIssue.push(entry.id);
    }
  }
  assert.deepEqual(peersWithIssue, ['captain-america-best-of']);
  assert.deepEqual(inventoryRecord.overlapIds, peersWithIssue);
  assert.match(
    inventoryRecord.reason,
    /one atomic issue as an exact metadata row and preserves the other 68 .* as source-semantic exclusions/i,
  );
  assert.match(
    inventoryRecord.reason,
    /zero canonical repeats, zero unavailable exclusions, and zero open metadata gaps/i,
  );

  for (const relativePath of [
    path.join('scripts', 'data', 'cbh-packets', `${id}.json`),
    path.join('scripts', 'data', 'cbh-mappings', `${id}.json`),
  ]) {
    await assert.rejects(access(path.join(root, relativePath)), { code: 'ENOENT' });
  }
});
