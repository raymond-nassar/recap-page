import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildModule, excludedPage, INPUT_PATH, inputFrom, MODULE_PATH, selectLinks, validateInput,
} from '../scripts/marvel-comics-app-links.mjs';
import { appViewerFor } from '../src/js/lib/marvelComicsApp.js';
import { appViewerUrl, viewerNumber } from '../src/js/lib/marvelComicsAppUrl.js';

// Rows written for this project in the shape of the offline match file; no site markup is used.
const page = (slug) => `https://comicbookreadingorders.com/marvel/events/${slug}/`;
const viewer = (n) => `https://www.marvelcomicsapp.com/viewer/${n}`;
const row = (issueId, status, links, extra = {}) => ({
  issueId, status, appLinks: links.map(viewer), pageUrl: page('fixture-event-reading-order'), ...extra,
});

test('950 selection keeps exact links and lone one-year-shift links, one number per comic', () => {
  const shift = { ambiguity: 'cover-year-shift' };
  const { links, left, refused } = selectLinks({
    rows: [
      row(1, 'exact', [101]),
      row(1, 'exact', [101], { pageUrl: page('second-fixture-reading-order') }),
      row(2, 'exact', [102]),
      row(2, 'ambiguous', [902], shift),
      row(3, 'ambiguous', [103], shift),
      row(4, 'ambiguous', [104], shift),
      row(4, 'ambiguous', [904], shift),
      row(5, 'exact', [105]),
      row(6, 'ambiguous', [106], shift),
      row(6, 'ambiguous', [], { ambiguity: 'several-candidates' }),
      row(7, 'exact', [107], { pageUrl: 'https://comicbookreadingorders.com/marvel/marvel-master-reading-order-part-1/' }),
      row(8, 'exact', [108], { pageUrl: page('marvel-legacy-reading-order') }),
      { ...row(9, 'exact', []), appLinks: ['https://www.marvelcomicsapp.com/issues/109'] },
      row(10, 'exact', [110]),
      row(11, 'exact', [110]),
      row(12, 'conflict', [112]),
      row(13, 'exact', [113]),
    ],
    conflicts: [{ issueId: 5 }],
  });
  assert.deepEqual(links.map(({ issueId, viewer: v, basis }) => [issueId, v, basis]), [
    [1, 101, 'exact'], [2, 102, 'exact'], [3, 103, 'cover-year-shift'], [13, 113, 'exact'],
  ]);
  assert.equal(links[0].pages.length, 2, 'both source pages are kept for the credit');
  assert.deepEqual(left, { conflict: 1, severalNumbers: 1, shiftedWithExact: 1, shiftedWithOtherRows: 1, sharedNumber: 2 });
  assert.deepEqual(refused, { badLink: 1, excludedPage: 2, badPage: 0 });
});

test('950 the permission exclusions cover the Master Reading Order and its four era pages', () => {
  for (const path of ['marvel/marvel-master-reading-order/', 'marvel/marvel-master-reading-order-part-3/',
    'marvel/events/marvel-now-reading-order/', 'marvel/all-new-all-different-marvel-reading-order-part-2/',
    'marvel/events/marvel-legacy-reading-order/', 'marvel/events/a-fresh-start-reading-order/']) {
    assert.equal(excludedPage(`https://comicbookreadingorders.com/${path}`), true, path);
  }
  assert.equal(excludedPage(page('civil-war-reading-order')), false);
});

test('950 validation refuses a link that is not a published viewer link', () => {
  const good = { pages: [page('fixture-event-reading-order')], links: [{ issueId: 1, viewer: 5, basis: 'exact', pages: [0] }] };
  assert.deepEqual(validateInput(good), []);
  for (const links of [
    [{ issueId: 1, viewer: 0, basis: 'exact', pages: [0] }],
    [{ issueId: 1, viewer: 5, basis: 'guess', pages: [0] }],
    [{ issueId: 1, viewer: 5, basis: 'exact', pages: [1] }],
    [{ issueId: 2, viewer: 5, basis: 'exact', pages: [0] }, { issueId: 1, viewer: 6, basis: 'exact', pages: [0] }],
    [{ issueId: 1, viewer: 5, basis: 'exact', pages: [0] }, { issueId: 2, viewer: 5, basis: 'exact', pages: [0] }],
  ]) {
    assert.notDeepEqual(validateInput({ ...good, links }), [], JSON.stringify(links));
    assert.throws(() => buildModule({ ...good, links }), /Refusing/);
  }
  assert.notDeepEqual(validateInput({ ...good, pages: [page('marvel-legacy-reading-order')] }), []);
  assert.equal(inputFrom({ rows: [] }).counts.total, 0);
});

test('950 the bundled module is current with its input and every comic resolves to its own link', () => {
  const input = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
  assert.deepEqual(validateInput(input), []);
  assert.equal(readFileSync(MODULE_PATH, 'utf8').replace(/\r\n/g, '\n'), buildModule(input));
  assert.equal(input.counts.total, input.links.length);
  assert.equal(input.counts.exact + input.counts.coverYearShift, input.counts.total);
  for (const link of input.links) assert.equal(appViewerFor(link.issueId), String(link.viewer));
  assert.equal(appViewerFor('12459'), appViewerFor(12459), 'saved comics are keyed by string');
  assert.equal(appViewerFor(42), null);
  for (const value of [null, undefined, '012459', 0, -1, 1.5, {}]) assert.equal(appViewerFor(value), null);
});

test('950 viewer numbers only ever rebuild the published link shape', () => {
  assert.equal(appViewerUrl(18255), viewer(18255));
  assert.equal(appViewerUrl('18255'), viewer(18255));
  for (const value of ['0', '012', '1/2', '1234567890', 'https://evil.example', null, '', ' 5']) {
    assert.equal(appViewerUrl(value), null, String(value));
    assert.equal(viewerNumber(value), null, String(value));
  }
});
