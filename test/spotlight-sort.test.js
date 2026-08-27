import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  groupCatalog,
  parseCatalog,
  shelfLists,
  sortSpotlightStories,
  spotlightRankForStory,
  spotlightSortLabel,
} from '../src/js/lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const spotlights = groupCatalog(shelfLists(catalog.lists, 'spotlights'));
const title = (story) => story.name ?? story.lists[0].name;

test('the spotlight sort labels the default and popularity states', () => {
  assert.equal(spotlightSortLabel(null), 'Current order');
  assert.equal(spotlightSortLabel('popularity'), 'Popularity');
});

test('the shipped spotlight stories resolve the owner-supplied Top 30 ranks exactly', () => {
  const expected = new Map([
    ['The Best of Spider-Man', 1],
    ['Wolverine', 2],
    ['The Best of Captain America', 4],
    ['The Best of Thor', 6],
    ['Black Panther', 8],
    ['Doctor Strange', 9],
    ['Daredevil', 10],
    ['Venom', 11],
    ['The Best of the Scarlet Witch', 12],
    ['Magneto', 15],
    ['Loki', 16],
    ['Phoenix', 17],
    ['Silver Surfer', 18],
    ['Moon Knight', 20],
    ['Essential Avengers', 21],
    ['X-Men: Silver Age to Claremont', 22],
  ]);

  for (const story of spotlights) {
    const rank = spotlightRankForStory(story);
    assert.equal(rank, expected.get(title(story)) ?? null, title(story));
  }

  assert.equal(spotlightRankForStory(spotlights.find((story) => title(story) === 'Ant-Man')), null);
  assert.equal(spotlightRankForStory(spotlights.find((story) => title(story) === 'There is Only Doom')), null);
});

test('popularity sorting keeps the ranked stories first and the rest in their current order', () => {
  const sorted = sortSpotlightStories(spotlights, 'popularity').map(title);
  assert.deepEqual(sorted, [
    'The Best of Spider-Man',
    'Wolverine',
    'The Best of Captain America',
    'The Best of Thor',
    'Black Panther',
    'Doctor Strange',
    'Daredevil',
    'Venom',
    'The Best of the Scarlet Witch',
    'Magneto',
    'Loki',
    'Phoenix',
    'Silver Surfer',
    'Moon Knight',
    'Essential Avengers',
    'X-Men: Silver Age to Claremont',
    'Amazing Spider-Man',
    'Agents of Atlas',
    'White Tiger: Ava Ayala',
    'Phalanx',
    'Agatha Harkness',
    'Punisher',
    'Rocket Raccoon',
    'Abomination',
    'Groot',
    'Star-Lord',
    'Thanos',
    'Ant-Man',
    'Hulk (and She-Hulk, Red Hulk)',
    'Captain Marvel / Ms. Marvel',
    'Captain America: Modern Marvel Era',
    'There is Only Doom',
    'The Best Deadpool Comics To Start With!',
  ]);
});
