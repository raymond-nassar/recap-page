import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECRET_WARS_2015_EVENT_ID } from '../src/js/lib/catalog.js';
import { TIE_IN_RATINGS_SOURCE, hasTieInRatings, tieInRating } from '../src/js/lib/tieInRatings.js';
import { tieInRatingCredit, tieInRatingLabels } from '../src/js/views/shared/tie-in-ratings.js';

const el = (tag, props, children = []) => ({ tag, ...props, children: [].concat(children).filter(Boolean) });
const words = (node) => (node ? [node.text, ...node.children.flatMap(words)].filter(Boolean) : []);
const EVENT = SECRET_WARS_2015_EVENT_ID;
// Real issues the guide lists: a withheld Favorite, one from each confirmed group, the main event,
// Howard the Duck, which the
// article lists while saying it is not a tie-in, and Secret Wars (1984) #1, an unranked series.
const favorite = { issueId: 52509, seriesId: 18310 }; // Silver Surfer #13
const average = { issueId: 52048, seriesId: 18340 }; // Loki: Agent of Asgard #14
const lower = { issueId: 52480, seriesId: 19658 }; // Battleworld: Ultimate End #1
const mainEvent = { issueId: 52447, seriesId: 19648 }; // Secret Wars #1
const unranked = { issueId: 10580, seriesId: 2063 };
const howard = { issueId: 51957, seriesId: 19241 };

test('a lower-rated tie-in in the 2015 event reading shows its group and one Optional', () => {
  const node = tieInRatingLabels(el, EVENT, lower);
  assert.deepEqual(words(node), ['Lower rated', 'Optional']);
  assert.equal(node.children.filter((child) => child.text === 'Optional').length, 1);
  assert.match(node.children[0].class, /\brating-lower\b/);
});

test('an average-rated tie-in shows its group without Optional', () => {
  assert.deepEqual(words(tieInRatingLabels(el, EVENT, average)), ['Average to good']);
  assert.equal(tieInRating(EVENT, average).optional, false);
});

test('a group the retained capture does not show is withheld, so its tie-ins carry no label', () => {
  // Silver Surfer was recorded as a Favorite, and Punisher #19 as average, beyond where the retained
  // capture of the article stops; neither is confirmed, so neither is labelled.
  for (const item of [favorite, { issueId: 52778, seriesId: 18572 }]) {
    assert.equal(tieInRating(EVENT, item), null, JSON.stringify(item));
  }
  assert.equal(hasTieInRatings(EVENT, [mainEvent, favorite]), false);
});

test('the main event, unranked series and Howard the Duck carry no label at all', () => {
  for (const item of [mainEvent, { issueId: 52986, seriesId: 19821 }, unranked, howard, {}, null]) {
    assert.equal(tieInRating(EVENT, item), null, JSON.stringify(item));
    assert.equal(tieInRatingLabels(el, EVENT, item), null, JSON.stringify(item));
  }
});

test('a rated series reaches only the issues the guide lists, not its other issues', () => {
  // Spider-Woman (2014) #1 shares a lower-rated series with the guide's #10, which has no exact
  // provider match, so the vendored #1 added to the reading is unlabelled. Ultimate End #2 is listed.
  const spiderWoman = { issueId: 50561, seriesId: 18894 };
  assert.equal(tieInRating(EVENT, spiderWoman), null);
  assert.equal(tieInRatingLabels(el, EVENT, spiderWoman), null);
  assert.equal(hasTieInRatings(EVENT, [mainEvent, spiderWoman]), false);
  assert.deepEqual(words(tieInRatingLabels(el, EVENT, { issueId: 52482, seriesId: 19658 })), ['Lower rated', 'Optional']);
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

test('light themes fill the dots with the approved yellow and light red, outlined in their darker shades', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const blocks = css.split('}').filter((block) => block.includes('--rating-favorite-bg: #e5f2df'));
  assert.equal(blocks.length, 2, 'the explicit light theme and the system light theme');
  for (const block of blocks) {
    assert.match(block, /--rating-average-dot: #f4ce37;/);
    assert.match(block, /--rating-average-line: #89701d;/);
    assert.match(block, /--rating-lower-dot: #ed9898;/);
    assert.match(block, /--rating-lower-line: #aa645f;/);
  }
  assert.match(css, /\.rating-badge::before \{[^}]*background: var\(--rating-dot\); border: [^;]*var\(--rating-line\)/);
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
