import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildModule, buildMuModule, catalogComics, excludedPage, INPUT_PATH, inputFrom, MODULE_PATH,
  MU_INPUT_PATH, MU_MODULE_PATH, muInputFrom, selectLinks, validateInput,
  EXPORT_SOURCE, EXPORT_PROVENANCE, mergeExportInput,
  importNewCatalog, verifiedExportRows,
} from '../scripts/marvel-comics-app-links.mjs';
import { matchExportCsv, parseExportCsv } from '../scripts/lib/marvel-comics-app-export.mjs';
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

const exportRow = (issueId, status, numbers, extra = {}) => {
  const { pageUrl: ignored, ...record } = row(issueId, status, numbers, extra);
  void ignored;
  return record;
};

const csv = (records) => '\ufeffissue_id,series_id,series_title,title,issue_number,issue_sort,publication_date,url,sort_order\r\n'
  + records.map(([id, series, number, date]) => [id, 1, series, 'Fixture title', number, number, date, viewer(id), 1]
    .map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';

test('new catalog matcher reuses exact title, number and sale-year rules across the entire catalog', () => {
  const items = [
    { issueId: 1, seriesName: 'The Stars and Stripes (2020)', number: '1', onSale: '2020-03-01' },
    { issueId: 2, seriesName: 'Comma, "Hero" (2020)', number: '1.1', onSale: '2020-03-01' },
    { issueId: 3, seriesName: 'Volume (2020)', number: '1', onSale: '2020-03-01' },
    { issueId: 4, seriesName: 'Year (2020)', number: '1', onSale: '2020-10-01' },
    { issueId: 5, seriesName: 'Ambiguous (2020)', number: '1', onSale: '2020-03-01' },
    { issueId: 6, seriesName: 'Ambiguous (2019)', number: '1', onSale: '2020-05-01' },
    { issueId: -7, seriesName: 'Stand-in (2020)', number: '1', onSale: '2020-03-01' },
  ];
  const text = csv([
    [101, 'Stars & Stripes (2020 - 2021)', '01', '3/1/2020'],
    [102, 'Comma, "Hero" (2020)', '1.1', '3/1/2020'],
    [103, 'Volume Vol. 2 (2020)', '1', '3/1/2020'],
    [104, 'Year (2020)', '1', '1/1/2021'],
    [105, 'Ambiguous (2020)', '1', '3/1/2020'],
    [106, 'Stand-in (2020)', '1', '3/1/2020'],
    [107, 'Unknown (2020)', '1', '3/1/2020'],
    [108, 'Volume (2020)', '', '3/1/2020'],
    [109, 'Volume (2020)', '1', '3/1/2020'],
  ]);
  const rows = matchExportCsv(text, [...items, items[0]]);
  assert.deepEqual(rows.slice(0, 3).map(({ issueId, status }) => [issueId, status]),
    [[1, 'exact'], [2, 'exact'], [3, 'exact']]);
  assert.equal(rows[3].ambiguity, 'cover-year-shift');
  assert.equal(rows[4].status, 'ambiguous', 'an old and a new identity cannot be distinguished');
  assert.deepEqual(rows.slice(5, 8).map((record) => record.status), ['unmatched', 'unmatched', 'unmatched']);
  const selection = selectLinks({ source: EXPORT_SOURCE, rows });
  assert.deepEqual(selection.links.map((link) => link.issueId), [1, 2], 'multiple exact numbers remain a conflict');
  assert.equal(selection.left.severalNumbers, 1);
  for (const bad of [
    text.replace('issue_id,', 'unknown,'),
    text.replace('"101"', '"0"'),
    text.replace(viewer(101), 'https://example.invalid/viewer/101'),
    text.replace('"109"', '"103"').replace(viewer(109), viewer(103)),
    text.replace('"3/1/2020"', '"2/30/2020"'),
    text + '"unclosed',
    text.replace('"Fixture title"', '"closed"x'),
    text.replace('"Fixture title",', ''),
  ]) assert.throws(() => parseExportCsv(bad), /export|Export/);
});

test('new catalog import preserves old links and frozen fallbacks while holding unmatched additions', () => {
  const base = inputFrom({ rows: [row(1, 'exact', [101])] });
  const items = [
    { issueId: 1 }, { issueId: 2 }, { issueId: 3 }, { issueId: 4 }, { issueId: 5 }, { issueId: 6 },
  ];
  const mu = { status: 'owner-approved', asOf: '2026-11-18',
    approvedGroups: ['unknown-unlimited'], excludedIssueIds: [3], issueIds: [2] };
  const rows = [
    exportRow(1, 'exact', [901]), exportRow(2, 'exact', [902]), exportRow(3, 'exact', [903]),
    exportRow(4, 'exact', [104]), exportRow(5, 'ambiguous', [105], { ambiguity: 'cover-year-shift' }),
  ];
  assert.throws(() => buildMuModule(mu, items, base.links), /do not match/);
  const result = importNewCatalog(base, mu, items, rows);
  assert.deepEqual(result.input.links, [base.links[0],
    { issueId: 4, viewer: 104, basis: 'exact', source: EXPORT_SOURCE }]);
  assert.deepEqual(result.muInput, { ...mu, unapprovedIssueIds: [5, 6] });
  assert.equal(result.added, 1);
  assert.equal(result.unapproved, 2);
  assert.doesNotThrow(() => buildMuModule(result.muInput, items, result.input.links));
  assert.deepEqual(importNewCatalog(result.input, result.muInput, items, rows),
    { ...result, added: 0 }, 'repeated runs preserve input bytes and do not broaden approval');
  const next = importNewCatalog(result.input, result.muInput, items, [...rows, exportRow(6, 'exact', [106])]);
  assert.equal(next.added, 1);
  assert.deepEqual(next.muInput.unapprovedIssueIds, [5], 'a held comic can later obtain an exact match');
  assert.deepEqual(next.input.exportSelection, result.input.exportSelection, 'first import accounting is retained');
  assert.throws(() => importNewCatalog(base, mu, items, [exportRow(4, 'exact', [101])]), /used by two comics/);
  for (const pending of [[2], [3], [1], [999], [5, 5], [6, 5], ['5']]) {
    assert.throws(() => buildMuModule({ ...result.muInput, unapprovedIssueIds: pending },
      items, result.input.links), /Refusing/);
  }
  assert.throws(() => buildMuModule({ ...result.muInput, issueIds: [] }, items, result.input.links), /do not match/);
  assert.deepEqual(base.links.map((link) => link.viewer), [101], 'original viewer links are not mutated');
  assert.deepEqual(mu.issueIds, [2], 'fallback approval is not mutated');
});

test('new catalog import refuses a different private export before matching', () => {
  assert.throws(() => verifiedExportRows(Buffer.from(csv([[101, 'Fixture (2020)', '1', '3/1/2020']])), []),
    /SHA-256 differs/);
});

test('private export merges exact selections without extending the year-shift approval', () => {
  const base = inputFrom({ rows: [row(1, 'exact', [101]), row(2, 'exact', [102])] });
  const matches = {
    source: EXPORT_SOURCE,
    rows: [
      exportRow(1, 'exact', [201]), exportRow(3, 'exact', [203]),
      exportRow(2, 'ambiguous', [202], { ambiguity: 'cover-year-shift' }),
      exportRow(4, 'exact', [204]), exportRow(5, 'exact', [205]), exportRow(5, 'exact', [206]),
      exportRow(6, 'unmatched', [207]),
    ],
    conflicts: [{ issueId: 4 }],
  };
  const merged = mergeExportInput(base, matches);
  assert.deepEqual(merged.links, [
    { issueId: 1, viewer: 201, basis: 'exact', source: EXPORT_SOURCE },
    base.links[1],
    { issueId: 3, viewer: 203, basis: 'exact', source: EXPORT_SOURCE },
  ]);
  assert.deepEqual(base.links.map((link) => link.viewer), [101, 102], 'input is not mutated');
  assert.deepEqual(merged.sources[EXPORT_SOURCE], EXPORT_PROVENANCE);
  assert.deepEqual(validateInput(merged), []);
  assert.equal(merged.counts.total, 3);
  assert.equal(merged.exportSelection.leftOut.conflict, 1);
  assert.equal(merged.exportSelection.leftOut.severalNumbers, 1);
  assert.deepEqual(mergeExportInput(merged, matches), merged, 'reimport is deterministic');
  assert.throws(() => mergeExportInput(base, {
    source: EXPORT_SOURCE, rows: [exportRow(3, 'exact', [102])],
  }), /used by two comics/, 'cross-source collisions cannot replace a different comic');
});

test('private export preserves refusals and requires its own exact source record', () => {
  const base = inputFrom({ rows: [] });
  const input = mergeExportInput(base, { source: EXPORT_SOURCE, rows: [exportRow(1, 'exact', [101])] });
  for (const change of [
    { sources: {} },
    { sources: { [EXPORT_SOURCE]: { ...EXPORT_PROVENANCE, sha256: 'unverified' } } },
    { links: [{ ...input.links[0], source: 'invented' }] },
    { links: [{ ...input.links[0], basis: 'cover-year-shift' }] },
    { links: [{ ...input.links[0], pages: [0] }] },
  ]) assert.throws(() => buildModule({ ...input, ...change }), /Refusing/);
  for (const bad of [
    { ...exportRow(1, 'exact', []), appLinks: ['https://www.marvelcomicsapp.com/issues/101'] },
    { ...exportRow(1, 'exact', [101]), pageUrl: page('marvel-legacy-reading-order') },
  ]) assert.throws(() => mergeExportInput(base, { source: EXPORT_SOURCE, rows: [bad] }), /Refusing export rows/);
  const shared = mergeExportInput(base, {
    source: EXPORT_SOURCE, rows: [exportRow(1, 'exact', [101]), exportRow(2, 'exact', [101])],
  });
  assert.deepEqual(shared.links, []);
  assert.equal(shared.exportSelection.leftOut.sharedNumber, 2);
  assert.throws(() => selectLinks({ source: 'invented', rows: [] }), /Unknown/);
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
  assert.equal(approval.issueIds.length, 1781);
  assert.deepEqual(approval.excludedIssueIds, [11185]);
  assert.equal(appLinkFor(11185), null);
  for (const id of approval.issueIds) {
    assert.equal(appViewerFor(id), null);
    assert.equal(appLinkFor(String(id)), appMuIssuesUrl(id));
  }
  for (const link of input.links) assert.equal(appLinkFor(link.issueId), viewer(link.viewer));
  for (const id of [-1001, 999999999, '010441', undefined, {}]) assert.equal(appLinkFor(id), null);
});
