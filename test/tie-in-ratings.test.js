import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECRET_WARS_2015_EVENT_ID } from '../src/js/lib/catalog.js';
import { TIE_IN_RATINGS_SOURCE, hasTieInRatings, tieInRating } from '../src/js/lib/tieInRatings.js';
import { tieInRatingCredit, tieInRatingLabels } from '../src/js/views/shared/tie-in-ratings.js';

const el = (tag, props, children = []) => ({ tag, ...props, children: [].concat(children).filter(Boolean) });
const words = (node) => (node ? [node.text, ...node.children.flatMap(words)].filter(Boolean) : []);
const EVENT = SECRET_WARS_2015_EVENT_ID;
// One series from each group, the main event, an unranked series, and Howard the Duck, which the
// article lists while saying it is not a tie-in.
const favorite = { issueId: 1, seriesId: 18310 };
const average = { issueId: 2, seriesId: 19591 };
const lower = { issueId: 3, seriesId: 19658 };
const mainEvent = { issueId: 4, seriesId: 19648 };
const unranked = { issueId: 5, seriesId: 2063 };
const howard = { issueId: 6, seriesId: 19241 };

test('a lower-rated tie-in in the 2015 event reading shows its group and one Optional', () => {
  const node = tieInRatingLabels(el, EVENT, lower);
  assert.deepEqual(words(node), ['Lower rated', 'Optional']);
  assert.equal(node.children.filter((child) => child.text === 'Optional').length, 1);
  assert.match(node.children[0].class, /\brating-lower\b/);
});

test('higher-rated tie-ins show their group without Optional', () => {
  assert.deepEqual(words(tieInRatingLabels(el, EVENT, favorite)), ['Favorite']);
  assert.deepEqual(words(tieInRatingLabels(el, EVENT, average)), ['Average to good']);
  assert.equal(tieInRating(EVENT, favorite).optional, false);
  assert.equal(tieInRating(EVENT, average).optional, false);
});

test('the main event, unranked series and Howard the Duck carry no label at all', () => {
  for (const item of [mainEvent, unranked, howard, {}, null]) {
    assert.equal(tieInRating(EVENT, item), null, JSON.stringify(item));
    assert.equal(tieInRatingLabels(el, EVENT, item), null, JSON.stringify(item));
  }
});

test('the same series outside the 2015 event reading is neither rated nor Optional', () => {
  for (const catalogId of ['hickman-full', 'hickman-minimal', 'avengers-doomsday-secret-wars', null, undefined]) {
    for (const item of [favorite, average, lower]) {
      assert.equal(tieInRatingLabels(el, catalogId, item), null, `${catalogId} ${item.seriesId}`);
    }
    assert.equal(hasTieInRatings(catalogId, [favorite, average, lower]), false);
  }
});

test('the credit appears only for a reading holding a rated tie-in, and links the article', () => {
  assert.equal(hasTieInRatings(EVENT, [mainEvent, unranked]), false);
  assert.equal(hasTieInRatings(EVENT, [mainEvent, lower]), true);
  assert.equal(hasTieInRatings(EVENT, undefined), false);
  const credit = tieInRatingCredit(el);
  const link = credit.children[0];
  assert.equal(link.href, TIE_IN_RATINGS_SOURCE.url);
  assert.equal(link.text, 'Rated by Comic Book Herald');
  assert.equal(link.rel, 'noopener noreferrer');
});

test('labelling a reading leaves its comics untouched, so progress and counts cannot move', () => {
  const items = [favorite, average, lower, mainEvent, unranked].map((item) => ({ ...item, read: false }));
  const before = JSON.stringify(items);
  for (const item of items) tieInRatingLabels(el, EVENT, item);
  hasTieInRatings(EVENT, items);
  assert.equal(JSON.stringify(items), before);
});

test('both the reading view and the preview render the labels beside each comic and the credit once', () => {
  for (const [path, id, items] of [
    ['src/js/views/reading.js', 'list.catalogId', 'items'],
    ['src/js/views/preview.js', 'list.id', 'order.items'],
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`tieInRatingLabels(el, ${id}, item)`), `${path} never labels a comic`);
    assert.ok(source.includes(`hasTieInRatings(${id}, ${items})`), `${path} never credits the ratings`);
    assert.ok(source.includes('tieInRatingCredit(el)'), `${path} never renders the credit`);
  }
});
