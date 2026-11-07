import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modernTimelinePosition } from '../src/js/views/catalog.js';
import { currentReadingCensus } from './helpers/current-reading-library.mjs';
import { compareIssueSets, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { curatedLedgerDigestFor, curatedRelationshipReportDigestFor } from '../scripts/lib/owner-guide.mjs';
import { validateApprovalDigest } from '../scripts/lib/cbh-inventory.mjs';

import {
  MODERN_TIMELINE_FEATURED_ID,
  MODERN_TIMELINE_FEATURED_ROUTES,
  MODERN_TIMELINE_CHAPTER_COUNT,
  MODERN_TIMELINE_CONTINUATION_YEAR,
  MODERN_TIMELINE_START_YEAR,
  eraSections,
  groupCatalog,
  modernTimelineFeaturedList,
  modernTimelineFeaturedCard,
  modernTimelineLists,
  modernTimelineStories,
  parseCatalog,
  publishingCategoryStories,
  isModernTimelineChapterId,
  shelfLists,
} from '../src/js/lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'),
));
const stories = groupCatalog(catalog.lists);
const styles = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
const catalogPresentationSource = readFileSync(
  join(ROOT, 'src', 'js', 'views', 'shared', 'catalog-presentation.js'),
  'utf8',
);
const mainSource = readFileSync(join(ROOT, 'src', 'js', 'main.js'), 'utf8');

const story = (key, ...lists) => ({ key, lists });
const list = (id, timeline, extra = {}) => ({
  id,
  name: id,
  type: 'event',
  timeline,
  ...extra,
});

test('Siege joins 2010 with the full approved Avengers and Thunderbolts reading and labeled earlier setup', () => {
  const id = 'siege-dark-reign-prelude';
  const selected = modernTimelineLists(catalog.lists);
  const entry = selected.find((item) => item.id === id);
  assert.ok(entry);
  assert.equal(entry.timeline, 2010);
  assert.equal(entry.collections, 0);
  assert.equal(entry.count, 107);
  assert.match(entry.description, /prelude beginning in 2008/);
  assert.deepEqual(selected.filter((item) => item.timeline === 2010).map((item) => item.id), [
    id, 'doomwar', 'second-coming', 'thanos-imperative', 'x-men-curse-of-the-mutants',
    'shadowland', 'wolverine-goes-to-hell', 'chaos-war',
  ]);
  assert.equal(selected.length, currentReadingCensus.modernTimeline);
  assert.equal(selected.filter((item) => item.id === id).length, 1);
  assert.ok(!selected.some((item) => item.id === 'dark-reign-avengers'));
  const payload = JSON.parse(readFileSync(join(ROOT, 'src', 'data', entry.file), 'utf8'));
  const vector = payload.items.map((item) => item.issueId);
  assert.equal(createHash('sha256').update(JSON.stringify(vector)).digest('hex'),
    'caae0c6f1f8b0e00adf52726862f387b6c814edfb1855a82e3111e3f347c2003');
  assert.deepEqual([vector[0], vector.at(-1)], [22980, 31473]);
  assert.equal(new Set(vector).size, 107);
  assert.equal(payload.placeholders, 0);
  assert.equal(payload.sectionKind, 'reading-blocks');
  assert.equal(new Set(payload.items.map((item) => item.collectedIn)).size, 7);
  assert.match(payload.items[0].collectedIn, /^Dark Reign prelude/);
  assert.match(payload.items.at(-1).collectedIn, /Siege aftermath/);
  for (const [seriesId, first, last] of [
    [6599, 1, 16], [753, 48, 64], [1866, 21, 36], [1945, 20, 35], [18527, 126, 143],
  ]) {
    const numbers = payload.items.filter((item) => item.seriesId === seriesId).map((item) => Number(item.number));
    assert.deepEqual([...numbers].sort((a, b) => a - b),
      Array.from({ length: last - first + 1 }, (_, index) => first + index), `series ${seriesId}`);
  }
  assert.deepEqual(payload.items.filter((item) => item.seriesId === 9178).map((item) => item.title), [
    'Siege (2009) #1', 'Siege (2009) #2', 'Siege (2009) #3', 'Siege (2009) #4',
  ]);
  const crossoverAt = vector.indexOf(23790);
  assert.deepEqual(vector.slice(crossoverAt, crossoverAt + 4), [23790, 23748, 23984, 23940]);
  const utopiaAt = vector.indexOf(27513);
  assert.deepEqual(vector.slice(utopiaAt, utopiaAt + 6), [27513, 26966, 24812, 26967, 24813, 27512]);
});

test('Siege retains exact source accounting and human authority for the complete approved library snapshot', () => {
  const ledger = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'curated-source-ledgers',
    'siege-dark-reign-prelude.json'), 'utf8'));
  assert.equal(ledger.ledgerDigest, curatedLedgerDigestFor(ledger));
  assert.equal(ledger.ledgerDigest, '2eedf17039c6e7092568c8ec01977d15ec2b62a7ab73aaa70594d02fb80775d9');
  assert.deepEqual(ledger.sourceRows.map((row) => row.sourcePosition),
    Array.from({ length: 107 }, (_, index) => index + 1));
  assert.deepEqual(ledger.sourceRows.map((row) => row.selectedIssueId), ledger.resolvedVector);
  assert.deepEqual(ledger.counts, { intendedPositions: 107, resolved: 107, gaps: 0, repeats: 1 });
  assert.equal(ledger.repeats[0].sourceReference, 'Avengers: The Initiative #31');
  assert.deepEqual(ledger.sourceGaps, []);
  const review = ledger.relationshipReview;
  const report = review.report;
  assert.equal(report.reportDigest, '840cdb966b2724af5b3b29afa3784c77d677b5151ede829dad23fb9741cbaa48');
  assert.equal(report.reportDigest, curatedRelationshipReportDigestFor(report));
  assert.equal(report.ledgerDigest, ledger.ledgerDigest);
  validateApprovalDigest(review, ledger.id);
  assert.equal(review.sourceReview.authorityType, 'human');
  assert.equal(review.sourceReview.authorityIdentity, 'raymond-nassar');
  assert.equal(review.sourceReview.ledgerDigest, ledger.ledgerDigest);
  assert.equal(review.sourceReview.reportDigest, report.reportDigest);
  const peers = new Map();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'curated-lists.json'), 'utf8'));
  for (const entry of manifest.lists) if (entry.id !== ledger.id) {
    peers.set(entry.id, JSON.parse(readFileSync(join(ROOT, 'src', 'data', entry.out), 'utf8')));
  }
  for (const entry of catalog.lists) if (entry.id !== ledger.id) {
    peers.set(entry.id, JSON.parse(readFileSync(join(ROOT, 'src', 'data', entry.file), 'utf8')));
  }
  assert.equal(report.comparisonCount, 340);
  assert.equal(report.comparisons.length, report.comparisonCount);
  assert.equal(new Set(report.comparisons.map((item) => item.orderId)).size, report.comparisonCount);
  assert.equal(report.comparisons.filter((item) => item.relationship === 'partial').length, 21);
  assert.equal(review.dispositions.length, report.comparisonCount);
  for (const comparison of report.comparisons) {
    const payload = peers.get(comparison.orderId);
    assert.ok(payload);
    assert.deepEqual(comparison, {
      orderId: comparison.orderId,
      ...compareIssueSets(ledger.resolvedVector.map(String), issueIdsFromValue(payload)),
    });
    const authority = review.dispositions.find((item) => item.orderId === comparison.orderId);
    assert.equal(authority.decision, 'approved');
    assert.equal(authority.ledgerDigest, ledger.ledgerDigest);
    assert.equal(authority.reportDigest, report.reportDigest);
    assert.equal(authority.authorityType, comparison.relationship === 'none' ? 'policy' : 'human');
    if (comparison.relationship === 'partial') assert.equal(authority.authority, 'raymond-nassar');
    assert.deepEqual(authority.sharedIds, comparison.sharedIds);
  }
});

test('intentional completion advances timeline positioning without changing actual partial comic progress', () => {
  const sequence = [story('first', list('one', 2004)), story('second', list('two', 2005))];
  const state = {
    lists: { saved: { id: 'saved', catalogId: 'one', itemIds: [1, 2] } },
    listOrder: ['saved'], read: { 1: 12345 },
  };
  const before = JSON.stringify(state);
  assert.equal(modernTimelinePosition(state, sequence).storyKey, 'list:one');
  const position = modernTimelinePosition(state, sequence, { isCompleted: (_state, id) => id === 'saved' });
  assert.equal(position.storyKey, 'list:two');
  assert.equal(position.completed, 1);
  assert.equal(position.total, 2);
  assert.equal(JSON.stringify(state), before);
});

test('explicit completion can finish saved empty stops while reopening restores default timeline positioning', () => {
  const sequence = [story('first', list('one', 2004))];
  const state = {
    lists: { saved: { id: 'saved', catalogId: 'one', itemIds: [] } },
    listOrder: ['saved'], read: {},
  };
  assert.equal(modernTimelinePosition(state, sequence).kind, 'current');
  assert.deepEqual(modernTimelinePosition(state, sequence, { isCompleted: () => true }), {
    kind: 'complete', completed: 1, total: 1,
  });
  assert.equal(modernTimelinePosition(state, sequence, { isCompleted: () => false }).kind, 'current');
  assert.deepEqual(state.read, {});
});

test('the app-selected Modern Timeline opens in 1998 and resumes in 2004', () => {
  const selected = modernTimelineStories([
    story('older', list('older', 1997)),
    story('opening', list('marvel-knights-to-planet-x-01', 1998)),
    story('other-1998', list('other-1998', 1998)),
    story('before-continuation', list('before-continuation', 2003)),
    story('continuation', list('continuation', 2004)),
    story('later', list('later', 2024)),
    story('undated', list('undated', null)),
    story('wrong-kind', list('wrong-kind', 2004, { type: 'creator-run' })),
    story('split', list('split-old', 1997), list('split-new', 1998)),
  ]);

  assert.equal(MODERN_TIMELINE_START_YEAR, 1998);
  assert.equal(MODERN_TIMELINE_CONTINUATION_YEAR, 2004);
  assert.deepEqual(selected.map(({ key }) => key), ['opening', 'continuation', 'later']);
});

test('list selection preserves order and never splits a grouped story', () => {
  const lists = [
    list('older', 1997),
    list('marvel-knights-to-planet-x-01', 1998),
    list('other-1998', 1998),
    list('split-old', 1997, { group: 'split' }),
    list('split-new', 1998, { group: 'split' }),
    list('continuation', 2004),
  ];

  assert.deepEqual(
    modernTimelineLists(lists).map(({ id }) => id),
    ['marvel-knights-to-planet-x-01', 'continuation'],
  );
});

test('the chapter family predicate is bounded to the 78 generated ids', () => {
  assert.equal(MODERN_TIMELINE_CHAPTER_COUNT, 78);
  assert.equal(isModernTimelineChapterId('marvel-knights-to-planet-x-01'), true);
  assert.equal(isModernTimelineChapterId('marvel-knights-to-planet-x-78'), true);
  for (const id of [
    'marvel-knights-to-planet-x',
    'marvel-knights-to-planet-x-00',
    'marvel-knights-to-planet-x-79',
    'marvel-knights-to-planet-x-1',
    'other-01',
  ]) {
    assert.equal(isModernTimelineChapterId(id), false, id);
  }
});

test('the featured guide resolves the existing catalog entry and no substitute', () => {
  const featured = modernTimelineFeaturedList(catalog.lists);
  assert.equal(MODERN_TIMELINE_FEATURED_ID, 'setup-to-modern-timeline');
  assert.equal(featured?.id, MODERN_TIMELINE_FEATURED_ID);
  assert.equal(featured?.type, 'era');
  assert.equal(featured?.timeline, null);
  assert.equal(catalog.lists.filter(({ id }) => id === MODERN_TIMELINE_FEATURED_ID).length, 1);
  assert.equal(modernTimelineFeaturedList([]), null);
});

test('both setup card placements resolve the same existing catalog identity', () => {
  const featured = modernTimelineFeaturedList(catalog.lists);
  assert.deepEqual(
    MODERN_TIMELINE_FEATURED_ROUTES,
    ['catalog', 'age-marvel-knights-heroes-return'],
  );
  for (const route of MODERN_TIMELINE_FEATURED_ROUTES) {
    assert.equal(modernTimelineFeaturedCard(catalog.lists, route), featured);
  }
  assert.equal(modernTimelineFeaturedCard(catalog.lists, 'age-event-era'), null);
  assert.equal(modernTimelineFeaturedCard([], 'catalog'), null);
});

test('the setup feature uses the shared card renderer instead of the old plain action', () => {
  assert.match(
    catalogPresentationSource,
    /catalogCard\(story, \{\s*surface,\s*report: `#\$\{surface\}-report`,/,
  );
  assert.doesNotMatch(catalogPresentationSource, /btn-modern-timeline-feature/);
  assert.doesNotMatch(catalogPresentationSource, /class: 'notice notice-act modern-timeline-feature'/);
});

test('the shipped Modern Timeline carries all chapters into the Avengers era', () => {
  const selectedLists = modernTimelineLists(catalog.lists);
  const selectedStories = modernTimelineStories(stories);
  const sections = eraSections(selectedStories);
  const datedSections = sections.filter(({ span, fallback }) => span && !fallback);
  const unplacedSection = sections.find(({ key }) => key === 'unplaced');
  const excluded = shelfLists(catalog.lists, 'catalog')
    .filter(({ id, timeline }) => (
      timeline >= MODERN_TIMELINE_START_YEAR
      && timeline < MODERN_TIMELINE_CONTINUATION_YEAR
      && !isModernTimelineChapterId(id)
    ));
  const periodIds = new Set(
    publishingCategoryStories(stories, 'marvel-knights-heroes-return')
      .flatMap(({ lists }) => lists.map(({ id }) => id)),
  );
  const olderEvents = shelfLists(catalog.lists, 'catalog')
    .filter(({ timeline }) => timeline < MODERN_TIMELINE_START_YEAR);

  const chapters = selectedLists.filter(({ id }) => isModernTimelineChapterId(id));
  assert.equal(selectedLists.length, currentReadingCensus.modernTimeline);
  assert.equal(selectedStories.length, currentReadingCensus.modernTimelineStories);
  assert.deepEqual(selectedLists.slice(-5).map(({ id, timeline }) => [id, timeline]), [
    ['fall-house-x-rise-powers-x', 2024],
    ['captain-america-2025-our-secret-wars', 2025],
    ['one-world-under-doom', 2025],
    ['captain-america-2025-dooms-shadow', 2025],
    ['captain-america-2025-hells-angel', 2026],
  ]);
  const doomStory = selectedStories.find(({ key }) => key === 'list:one-world-under-doom');
  assert.equal(selectedStories.at(-1).key, 'list:captain-america-2025-hells-angel');
  assert.equal(doomStory.lists.length, 1);
  assert.equal(doomStory.lists[0].description.includes(
    'Doctor Strange of Asgard (2025) #1-5 is an optional tie-in.',
  ), true);
  assert.equal(doomStory.lists[0].description.includes(
    'Read Fantastic Four (2025) #1-3 together.',
  ), true);
  assert.equal(unplacedSection?.heading, 'Not yet placed in an era');
  assert.ok(['list:one-world-under-doom', 'list:captain-america-2025-our-secret-wars',
    'list:captain-america-2025-dooms-shadow', 'list:captain-america-2025-hells-angel']
    .every((key) => unplacedSection.stories.some((story) => story.key === key)));
  assert.equal(olderEvents.length, 38);
  assert.deepEqual(
    selectedStories.slice(0, 2).map(({ lists: [first] }) => [first.name, first.timeline]),
    [
      ['Daredevil & Black Widow Opening Sequence', 1998],
      ['Punisher: Welcome Back Frank', 2000],
    ],
  );
  assert.ok(selectedLists.every(({ id, type, timeline }) => (
    type === 'event'
    && (
      timeline >= MODERN_TIMELINE_CONTINUATION_YEAR
      || (isModernTimelineChapterId(id) && timeline >= MODERN_TIMELINE_START_YEAR)
    )
  )));
  assert.equal(chapters.length, 78);
  assert.deepEqual(
    Object.fromEntries([1998, 1999, 2000, 2001, 2002, 2003, 2004].map((year) => [
      year,
      chapters.filter((list) => list.timeline === year).length,
    ])),
    {
      1998: 1, 1999: 0, 2000: 2, 2001: 16, 2002: 24, 2003: 32, 2004: 3,
    },
  );
  for (const year of [1998, 2000, 2001, 2002, 2003, 2004]) {
    const ordinals = chapters
      .filter((list) => list.timeline === year)
      .map((list) => Number(list.id.slice(-2)));
    assert.ok(ordinals.every((ordinal, index) => index === 0 || ordinal > ordinals[index - 1]));
  }
  assert.ok(selectedLists.some(({ id }) => id === 'avengers-disassembled'));
  assert.equal(selectedLists.some(({ id }) => id === 'operation-zero-tolerance'), false);
  assert.equal(selectedLists.some(({ id }) => id === MODERN_TIMELINE_FEATURED_ID), false);
  assert.deepEqual(
    excluded.map(({ id }) => id),
    ['spider-man-identity-crisis', 'hunt-for-xavier', 'eighth-day', 'magneto-war', 'maximum-security', 'marvel-1602'],
  );
  assert.ok(excluded.every(({ id }) => periodIds.has(id)));
  assert.equal(datedSections[0].from, MODERN_TIMELINE_START_YEAR);
  assert.equal(datedSections[0].to, 2003);
  assert.equal(datedSections[1].from, MODERN_TIMELINE_CONTINUATION_YEAR);
  assert.equal(datedSections[0].from, datedSections[0].span.from);
  assert.ok(datedSections.every(({ from, to, span }) => (
    from === span.from && to === span.to
  )), 'a rendered era includes empty years before its first or after its last selected story');
});

test('only Modern Timeline era descriptions opt out of the shared prose measure', () => {
  assert.match(
    styles,
    /\.shelf-section-blurb \{[^}]*max-width: 64ch;[^}]*\}/,
  );
  assert.match(
    styles,
    /#catalog-results \.timeline-era-head \.shelf-section-blurb \{ max-width: none; \}/,
  );
  assert.match(
    styles,
    /\.timeline-era-head \{ border-color: CanvasText; border-left-color: Highlight; \}/,
  );
  assert.match(
    styles,
    /\.timeline-era-head \.shelf-section-blurb \{ color: CanvasText; \}/,
  );
});

test('Modern Timeline position keeps visible semantics and joins the Store render path', () => {
  assert.match(catalogPresentationSource, /function paintTimelinePosition\(/);
  assert.match(catalogPresentationSource, /setAttribute\('aria-current', 'step'\)/);
  assert.match(catalogPresentationSource, /text: 'You are here'/);
  assert.match(styles, /\.timeline-position-current \{/);
  assert.match(styles, /\.timeline-position-status \{/);
  assert.match(styles, /\.timeline-position-label \{ border-color: Highlight; color: CanvasText; \}/);
  assert.match(styles, /\.timeline-position-status \{ border-color: Highlight; background: Canvas; color: CanvasText; \}/);

  const renderAll = mainSource.slice(
    mainSource.indexOf('function renderAll()'),
    mainSource.indexOf('// ------------------------------------------------------------------ boot'),
  );
  assert.match(renderAll, /catalogView\.refreshProgress\(\)/);
  assert.match(mainSource, /getState: \(\) => store\.state/);
  assert.match(mainSource, /isCurrent: \(key\) => view === key/);
});
