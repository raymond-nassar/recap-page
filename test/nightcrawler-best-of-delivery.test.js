import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'nightcrawler-best-of';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const range = (start, end) => Array.from(
  { length: end - start + 1 },
  (_, index) => String(start + index),
);

// Series ids are the configured provider's. Section 2, Nightcrawler (1985) #1-4, has no series
// there, so it is held as source positions 38 to 41 in the checklist's unresolved table.
const sections = [
  {
    heading: "1. Giant-Size X-Men and Uncanny X-Men by Chris Claremont (Kurt's debut)",
    runs: [
      { seriesId: 2016, numbers: ['1'] },
      { seriesId: 2258, numbers: [...range(94, 108), ...range(129, 138), '141', '142',
        ...range(151, 153), ...range(162, 167)] },
    ],
  },
  {
    heading: '3. Excalibur by Chris Claremont',
    runs: [{ issueId: 20042 }, { seriesId: 2011, numbers: range(1, 34) }],
  },
  { heading: '4. Excalibur by Alan Davis', runs: [{ seriesId: 2011, numbers: range(42, 67) }] },
  { heading: '5. Excalibur by Warren Ellis', runs: [{ seriesId: 2011, numbers: range(83, 103) }] },
  { heading: '6. Uncanny X-Men by Joe Casey', runs: [{ seriesId: 2258, numbers: range(394, 409) }] },
  { heading: '7. Nightcrawler (2004)', runs: [{ seriesId: 717, numbers: range(1, 12) }] },
  { heading: '8. Amazing X-Men', runs: [{ seriesId: 18142, numbers: range(1, 19) }] },
  { heading: '9. Nightcrawler (2014)', runs: [{ seriesId: 18875, numbers: range(1, 12) }] },
  { heading: '10. Uncanny Spider-Man', runs: [{ seriesId: 37091, numbers: range(1, 5) }] },
  {
    heading: '11. Favorite one-shots',
    runs: [
      { seriesId: 3751, numbers: ['9'] },
      { seriesId: 19453, numbers: ['6'] },
      { seriesId: 3637, numbers: ['49'] },
      { seriesId: 31393, numbers: ['12'] },
    ],
  },
];

test('Nightcrawler best-of publishes 187 exact issues from 191 source positions', async () => {
  const [markdown, payload, manifest, catalog, ratedGuideIndex] = await Promise.all([
    readFile('src/data/orders/nightcrawler-best-of.md', 'utf8'),
    readJson('src/data/nightcrawler_best_of.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/rated-guide-index.json'),
  ]);
  const parsed = parseChecklist(markdown);
  const source = manifest.lists.find((entry) => entry.id === id);
  const catalogEntry = catalog.lists.find((entry) => entry.id === id);

  const expected = sections.flatMap((section) => section.runs.flatMap((run) => {
    if (run.issueId) {
      const rows = payload.items.filter((item) => item.issueId === run.issueId);
      assert.equal(rows.length, 1);
      return [{ ...rows[0], section: section.heading }];
    }
    return run.numbers.map((number) => {
      const rows = payload.items.filter((item) => item.seriesId === run.seriesId
        && String(item.number) === number);
      assert.equal(rows.length, 1, `expected one issue for series ${run.seriesId} #${number}`);
      return { ...rows[0], section: section.heading };
    });
  }));
  const sourcePositions = [...range(1, 37), ...range(42, 191)];

  assert.equal(expected.length, 187);
  assert.equal(parsed.entries.length, 187);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.headings.slice(1, -1), sections.map(({ heading }) => heading));
  assert.deepEqual(parsed.entries.map((entry) => [entry.issueId, entry.section, entry.sourceKey]),
    expected.map((item, index) => [item.issueId, item.section, sourcePositions[index]]));
  assert.deepEqual(payload.items.map((item) => [item.issueId, item.collectedIn]),
    expected.map((item) => [item.issueId, item.section]));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 187);
  assert.equal(payload.count, 187);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 0);

  const gapRows = [...markdown.matchAll(/^\| (\d+) \| (Nightcrawler \(1985\) #\d) \|$/gm)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(gapRows, range(1, 4).map((n) => [String(37 + Number(n)), `Nightcrawler (1985) #${n}`]));
  assert.match(markdown, /issues\/1422\)/);

  assert.equal(source.name, 'Best Nightcrawler Comics Reading List');
  assert.equal(source.type, 'character-run');
  assert.equal(source.spotlightKind, 'best-of');
  assert.equal(source.depth, 'selected');
  assert.equal(source.sourceFile, 'nightcrawler-best-of.md');
  assert.equal(source.sourcePage, 'https://www.reddit.com/r/marvelcomics/s/hHJ4rVgM9v');
  assert.equal(source.sourceLicense, null);
  assert.equal(source.expect, 187);
  assert.ok(source.description.endsWith(
    " 4 comics from the source order aren't in the app's comic data yet, so they don't appear among this order's issues.",
  ));
  assert.equal(catalogEntry.file, 'nightcrawler_best_of.json');
  assert.equal(catalogEntry.count, 187);
  assert.equal(catalogEntry.spotlightKind, 'best-of');
  assert.equal(catalogEntry.sourceOrigin, source.sourceOrigin);
  assert.equal(catalogEntry.source, source.sourcePage);

  const ordinal = ratedGuideIndex.guides.findIndex(([guideId]) => guideId === id);
  assert.ok(ordinal >= 0);
  const indexed = new Map(ratedGuideIndex.issueGuides.map(([issueId, ordinals]) => [issueId, ordinals]));
  for (const item of expected) {
    assert.ok(indexed.get(item.issueId)?.includes(ordinal), `rated-guide index is missing ${item.issueId}`);
  }
});
