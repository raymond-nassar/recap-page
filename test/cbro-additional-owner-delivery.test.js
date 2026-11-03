import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  catalogEntries, firstSentence, parseCatalog, PUBLISHING_CATEGORIES, publishingCategoryStories,
  STORY_TYPES, STORY_TONES, storyTypeStories,
} from '../src/js/lib/catalog.js';
import { descriptionRevisions } from '../scripts/lib/description-revisions.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const range = (seriesId, start, end) => Array.from({ length: end - start + 1 },
  (_, index) => [seriesId, String(start + index)]);
const guides = [
  {
    id: 'marvel-1602', timeline: 2003,
    source: [...range(489, 1, 8), ...range(783, 1, 5), ...range(1102, 1, 5), ...range(8298, 1, 5)],
    issueIds: [20630, 50114, 377, 148, 147, 146, 145, 440, 2292, 2969, 2393, 2394, 2995,
      5103, 5257, 5428, 5684, 5823, 26384, 26385, 26386, 26387, 26388],
  },
  {
    id: 'blood-and-thunder', timeline: 1993,
    issueIds: [11796, 15226, 23488, 18428, 11797, 15227, 23489, 18429, 11798, 15228, 18430, 11799],
    source: [
      [2083, '468'], [2288, '86'], [6686, '6'], [3654, '23'],
      [2083, '469'], [2288, '87'], [6686, '7'], [3654, '24'],
      [2083, '470'], [2288, '88'], [6686, '8'], [3654, '25'], [2083, '471'],
    ],
  },
];

test('all four owner additions remain discoverable through Genres and truthful Marvel Ages', async () => {
  const { lists, dropped } = parseCatalog(await json('src/data/catalog.json'));
  assert.equal(dropped, 0);
  const stories = catalogEntries(lists);
  const ages = new Map([
    ['mc2', null],
    ['second-clone-saga', 'early-modern'],
    ['marvel-1602', 'marvel-knights-heroes-return'],
    ['blood-and-thunder', 'early-modern'],
  ]);
  for (const [id, age] of ages) {
    const list = lists.find((row) => row.id === id);
    for (const type of list.storyTypes) {
      assert.ok(storyTypeStories(stories, { type })
        .some((story) => story.lists.some((row) => row.id === id)), `${id}: ${type}`);
    }
    if (age) {
      assert.ok(PUBLISHING_CATEGORIES.some((category) => category.key === age));
      assert.ok(publishingCategoryStories(stories, age)
        .some((story) => story.lists.some((row) => row.id === id)), `${id}: ${age}`);
    } else {
      assert.equal(list.timeline, null, 'MC2 does not invent a main-continuity publication period.');
    }
  }
});

test('the description revision record leaves the four new guide descriptions untouched', async () => {
  const manifest = await json('src/data/curated-lists.json');
  for (const id of ['mc2', 'second-clone-saga', ...guides.map((guide) => guide.id)]) {
    assert.ok(!descriptionRevisions.entries.some((entry) => entry.id === id));
    const entry = manifest.lists.find((row) => row.id === id);
    assert.equal(descriptionRevisions.undoEntry(entry), entry);
    const file = `src/data/${id.replaceAll('-', '_')}.json`;
    const source = await readFile(file, 'utf8');
    assert.equal(descriptionRevisions.undoPayloadText(entry.out, source), source);
  }
});

for (const guide of guides) {
  test(`${guide.id} retains every source position and publishes only exact originals`, async () => {
    const [ledger, payload, markdown, catalog] = await Promise.all([
      json(`scripts/data/curated-source-ledgers/${guide.id}.json`),
      json(`src/data/${guide.id.replaceAll('-', '_')}.json`),
      readFile(`src/data/orders/${guide.id}.md`, 'utf8'),
      json('src/data/catalog.json'),
    ]);
    assert.deepEqual(ledger.sourceRows.map((row) => [row.seriesId, row.issueNumber]), guide.source);
    assert.deepEqual(ledger.sourceRows.map((row) => row.sourcePosition),
      guide.source.map((_, index) => index + 1));
    const resolved = ledger.sourceRows.filter((row) => row.selectedIssueId);
    const gaps = ledger.sourceRows.filter((row) => !row.selectedIssueId);
    assert.equal(ledger.counts.sourcePositions, guide.source.length);
    assert.equal(ledger.counts.resolved, resolved.length);
    assert.equal(ledger.counts.gaps, gaps.length);
    assert.equal(ledger.counts.repeats, 0);
    assert.deepEqual(payload.items.map((row) => [row.issueId, row.seriesId, row.number]),
      resolved.map((row) => [row.selectedIssueId, row.seriesId, row.issueNumber]));
    assert.deepEqual(payload.items.map((row) => row.issueId), ledger.resolvedVector);
    assert.deepEqual(ledger.resolvedVector, guide.issueIds);
    assert.equal(new Set(ledger.resolvedVector).size, resolved.length);
    const parsed = parseChecklist(markdown);
    assert.deepEqual(parsed.entries.map((row) => [row.issueId, Number(row.sourceKey)]),
      resolved.map((row) => [row.selectedIssueId, row.sourcePosition]));
    assert.ok(parsed.entries.every((row) => !row.section));
    assert.equal(payload.count, resolved.length);
    assert.equal(payload.collections, 0);
    assert.equal(payload.placeholders, 0);
    for (const gap of gaps) {
      assert.equal(gap.resolutionStatus, 'metadata-gap');
      assert.match(gap.gapIssue, /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/\d+$/);
      assert.ok(gap.failedLookups.every((lookup) => lookup.status === 200
        && lookup.exactMatchCount === 0 && /^[0-9a-f]{64}$/.test(lookup.responseSha256)));
      assert.ok(markdown.includes(gap.sourceIssueReference));
    }

    for (const item of payload.items) {
      assert.equal(item.description, null);
      assert.ok(item.digitalId === null || (Number.isInteger(item.digitalId) && item.digitalId > 0));
      assert.ok(!item.cover || item.cover.path.startsWith('https:'));
    }
    const { lists, dropped } = parseCatalog(catalog);
    assert.equal(dropped, 0);
    const card = lists.find((row) => row.id === guide.id);
    assert.equal(card.count, resolved.length);
    assert.equal(card.source, ledger.source.url);
    assert.equal(card.type, 'event');
    assert.equal(card.timeline, guide.timeline);
    assert.equal(card.depth, gaps.length ? 'partial' : 'complete');
    assert.equal(card.group, null);
    assert.ok(card.storyTypes.length > 0 && card.storyTypes.length <= 3);
    assert.ok(card.storyTypes.every((type) => Object.hasOwn(STORY_TYPES, type)));
    assert.ok(card.tones.length <= 2 && card.tones.every((tone) => Object.hasOwn(STORY_TONES, tone)));
    assert.ok(firstSentence(card.description).length <= 140);
    assert.doesNotMatch(firstSentence(card.description), /\d|reading order|\bpath\b|\blist\b|CBRO/i);
    assert.doesNotMatch(card.description, /[\u2013\u2014]|source notes/i);
    assert.equal(ledger.editorial.evidenceSources.length, 2);
  });
}

test('all four descriptions keep reader-gap-notices conditional and preserve their card premises', async () => {
  const catalog = await json('src/data/catalog.json');
  const manifest = await json('src/data/curated-lists.json');
  for (const id of ['mc2', 'second-clone-saga', ...guides.map((guide) => guide.id)]) {
    const [ledger, payload] = await Promise.all([
      json(`scripts/data/curated-source-ledgers/${id}.json`),
      json(`src/data/${id.replaceAll('-', '_')}.json`),
    ]);
    const card = catalog.lists.find((entry) => entry.id === id);
    assert.equal(card.description, manifest.lists.find((entry) => entry.id === id).description);
    assert.equal(payload.description, card.description);
    assert.equal(firstSentence(card.description), firstSentence(ledger.editorial.description));
    assert.doesNotMatch(card.description, /source notes|notes under About/i);
    const count = ledger.counts.gaps;
    if (count) {
      const expected = `${count} comic${count === 1 ? '' : 's'} from the source order ${count === 1 ? "isn't" : "aren't"} in the app's comic data yet, so ${count === 1 ? "it doesn't" : "they don't"} appear among this order's issues.`;
      assert.ok(card.description.endsWith(expected), id);
    } else {
      assert.equal(card.description, ledger.editorial.description);
      assert.doesNotMatch(card.description, /source order/i);
    }
  }
});
