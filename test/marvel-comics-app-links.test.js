import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildModule, buildMuModule, catalogComics, excludedPage, INPUT_PATH, inputFrom, MODULE_PATH,
  MU_INPUT_PATH, MU_MODULE_PATH, muInputFrom, selectLinks, validateInput,
} from '../scripts/marvel-comics-app-links.mjs';
import { appLinkFor, appViewerFor } from '../src/js/lib/marvelComicsApp.js';
import { appLaunchUrl, appMuIssuesUrl, appViewerUrl, viewerNumber } from '../src/js/lib/marvelComicsAppUrl.js';
import { marvelComicsAppMuIssueIds } from '../src/data/marvelComicsAppMuIssues.js';

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

test('950 MU addresses use only a checked issue number and cannot change the comic in the launch query', () => {
  const expected = 'https://www.marvelcomicsapp.com/mu/issues/10441';
  assert.equal(appMuIssuesUrl(10441), expected);
  assert.equal(appMuIssuesUrl('10441'), expected);
  for (const value of [0, -5, '012', '1234567890', '12a', '', null, undefined, {}, '12/', '%31']) {
    assert.equal(appMuIssuesUrl(value), null, String(value));
  }
  assert.equal(appLaunchUrl(new URLSearchParams('m=10441&i=10441')), expected);
  assert.equal(appLaunchUrl(new URLSearchParams('a=18255&m=10441&i=10441')), viewer(18255));
  for (const query of ['m=10441', 'm=10441&i=42', 'm=10441&m=10441&i=10441',
    'm=10441&i=10441&i=42', 'm=012&i=012', 'm=0&i=0']) {
    assert.equal(appLaunchUrl(new URLSearchParams(query)), null, query);
  }
});

test('950 MU selection freezes only approved positive unlinked comics and refuses other inputs', () => {
  const items = [
    { issueId: 10441, mu: '2008-04-30', digitalId: 10002 },
    { issueId: 4, mu: null, digitalId: null },
    { issueId: 5, mu: '1963-03-01', digitalId: 5 },
    { issueId: 6, mu: '2026-12-01', digitalId: 6 },
    { issueId: 7, mu: '2020-01-01', digitalId: null },
    { issueId: -8, mu: '2020-01-01', digitalId: 8 },
    { issueId: 12459, mu: '2020-01-01', digitalId: 9 },
  ];
  const links = [{ issueId: 12459, viewer: 18255 }];
  const asOf = '2026-11-18';
  const approved = muInputFrom(items, links, ['recorded-unlimited'], asOf);
  assert.deepEqual(approved.issueIds, [10441]);
  const all = muInputFrom([...items, items[0]], links, ['recorded-unlimited', 'unknown-unlimited'], asOf);
  assert.deepEqual(all.issueIds, [4, 5, 6, 7, 10441], 'sorted, unique, no stand-ins or viewer-linked comics');
  assert.match(buildMuModule(approved, items, links), /10441/);
  assert.deepEqual(muInputFrom(items, links, ['recorded-unlimited'], asOf, [10441]).issueIds, []);
  assert.throws(() => muInputFrom(items, links, ['unreviewed'], asOf), /Unknown/);
  for (const issueIds of [[-8], [12459], [999], [4], [10441, 10441], [7, 4], ['10441'], [1234567890]]) {
    assert.throws(() => buildMuModule({ ...approved, issueIds }, items, links), /Refusing/, JSON.stringify(issueIds));
  }
  assert.throws(() => buildMuModule({ ...approved, excludedIssueIds: [10441] }, items, links), /excluded/);
  assert.throws(() => buildMuModule({ ...approved, issueIds: [] }, items, links), /do not match/);
  assert.throws(() => buildMuModule({ ...approved, status: 'awaiting-owner-handcheck' }, items, links), /pending/);
  assert.throws(() => buildMuModule({ ...approved, approvedGroups: ['unreviewed'] }, items, links), /group/);
});

test('950 the bundled MU set is current, frozen to its approval record and never replaces viewer links', () => {
  const approval = JSON.parse(readFileSync(MU_INPUT_PATH, 'utf8'));
  const input = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
  assert.equal(readFileSync(MU_MODULE_PATH, 'utf8').replace(/\r\n/g, '\n'),
    buildMuModule(approval, catalogComics(), input.links));
  assert.deepEqual(marvelComicsAppMuIssueIds, approval.issueIds);
  assert.equal(approval.issueIds.length, 6043);
  assert.deepEqual(approval.excludedIssueIds, [11185]);
  assert.equal(appLinkFor(11185), null);
  for (const id of approval.issueIds) {
    assert.equal(appViewerFor(id), null);
    assert.equal(appLinkFor(String(id)), appMuIssuesUrl(id));
  }
  for (const link of input.links) assert.equal(appLinkFor(link.issueId), viewer(link.viewer));
  for (const id of [-1001, 999999999, '010441', undefined, {}]) assert.equal(appLinkFor(id), null);
});
