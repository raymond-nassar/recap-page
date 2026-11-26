import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modernTimelinePosition } from '../src/js/views/catalog.js';
import { currentReadingCensus } from './helpers/current-reading-library.mjs';
import { retiredXmenEntry, retiredXmenIds } from './helpers/xmen-era-history.mjs';
import { compareIssueSets, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { curatedLedgerDigestFor, curatedRelationshipReportDigestFor } from '../scripts/lib/owner-guide.mjs';
import { validateApprovalDigest } from '../scripts/lib/cbh-inventory.mjs';

import {
  MODERN_TIMELINE_CHECKPOINTS,
  MODERN_TIMELINE_FAMILY_ERAS,
  MODERN_TIMELINE_FEATURED_ID,
  MODERN_TIMELINE_FEATURED_ROUTES,
  MODERN_TIMELINE_CHAPTER_COUNT,
  MODERN_TIMELINE_CONTINUATION_YEAR,
  MODERN_TIMELINE_START_YEAR,
  catalogEntries,
  eraSections,
  groupCatalog,
  modernTimelineEventBadge,
  modernTimelineFeaturedList,
  modernTimelineFeaturedCard,
  modernTimelineLists,
  modernTimelinePlacements,
  modernTimelineStories,
  parseCatalog,
  publishingCategoryStories,
  isModernTimelineChapterId,
  shelfLists,
  timelineCheckpointTargets,
  timelineFamilyEraStops,
  timelineDrawOrder,
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
  // The sealed report predates the X-Men era replacement; its retired peers keep their payloads.
  for (const id of retiredXmenIds) if (!peers.has(id)) {
    peers.set(id, JSON.parse(readFileSync(join(ROOT, 'src', 'data', retiredXmenEntry(id).out), 'utf8')));
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
  const latestSection = sections.find(({ key }) => key === 'doom-armageddon');
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
  assert.deepEqual(
    selectedLists.filter(({ id }) =>
      ['world-war-hulk', 'secret-wars-2015-event-tie-ins'].includes(id)).map(({ id, timeline }) => [id, timeline]),
    [['world-war-hulk', 2007], ['secret-wars-2015-event-tie-ins', 2015]],
  );
  assert.equal(selectedLists.some(({ sectionalPart }) => sectionalPart), false);
  assert.equal(catalog.sectionalGroups.length, 1);
  assert.equal(catalog.sectionalGroups[0].options.length, 14);
  assert.deepEqual(selectedLists.slice(-5).map(({ id, timeline }) => [id, timeline]), [
    ['fall-house-x-rise-powers-x', 2024],
    ['captain-america-2025-our-secret-wars', 2025],
    ['one-world-under-doom', 2025],
    ['captain-america-2025-dooms-shadow', 2025],
    ['avengers-armageddon', 2026],
  ]);
  const doomStory = selectedStories.find(({ key }) => key === 'list:one-world-under-doom');
  assert.equal(selectedStories.at(-1).key, 'list:avengers-armageddon');
  assert.equal(doomStory.lists.length, 1);
  assert.equal(doomStory.lists[0].description.includes(
    'Doctor Strange of Asgard (2025) #1-5 is an optional tie-in.',
  ), true);
  assert.equal(doomStory.lists[0].description.includes(
    'Read Fantastic Four (2025) #1-3 together.',
  ), true);
  assert.equal(latestSection?.heading, 'From Doom to Armageddon');
  assert.ok(['list:one-world-under-doom', 'list:captain-america-2025-our-secret-wars',
    'list:captain-america-2025-dooms-shadow', 'list:avengers-armageddon']
    .every((key) => latestSection.stories.some((story) => story.key === key)));
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

test("Hell's Angel stays in Marvel Ages and Genres without becoming a timeline stop", () => {
  const id = 'captain-america-2025-hells-angel';
  assert.ok(catalog.lists.some((entry) => entry.id === id));
  assert.ok(!modernTimelineLists(catalog.lists).some((entry) => entry.id === id));
  for (const age of ['modern', 'current']) {
    assert.ok(publishingCategoryStories(stories, age)
      .some(({ lists }) => lists.some((entry) => entry.id === id)), age);
  }
  assert.ok(shelfLists(catalog.lists, 'catalog').some((entry) => entry.id === id));
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

// #1603. The whole timeline as the view draws it: every stop, Secret Wars (2015) as its one card, and
// the 2007 bridge as its own chooser rather than fourteen loose parts.
function wholeTimeline() {
  const mine = modernTimelineLists(catalog.lists);
  const stopIds = new Set(mine.map((entry) => entry.id));
  const placements = [...modernTimelinePlacements(catalog.lists), ...(catalog.sectionalGroups ?? [])];
  const placed = new Set(placements.flatMap((placement) => placement.options
    .filter((option) => stopIds.has(option.list.id)).map((option) => option.list.id)));
  return timelineDrawOrder(eraSections([
    ...catalogEntries(mine).filter((entry) => !entry.lists.some((item) => placed.has(item.id))),
    ...placements.map((placement) => ({ ...placement, lists: placement.options.map((option) => option.list) })),
  ]));
}
const readingIds = (entry) => [entry.key, ...entry.lists.map((item) => item.id)];

test('Jump to a section offers every CBH period in source order, each at its own stop on the timeline', () => {
  const whole = wholeTimeline();
  const targets = timelineCheckpointTargets(whole, whole);
  assert.deepEqual(targets.map((target) => [target.name, target.year]), [
    ['Marvel Knights to Planet X', 1998], ['Avengers Disassembled', 2004], ['Civil War', 2006],
    ['The Initiative', 2007], ['Secret Invasion', 2008], ['Dark Reign', 2008], ['The Heroic Age', 2010],
    ['Marvel NOW!', 2012], ['All-New, All-Different Marvel', 2016], ['Marvel NOW! 2.0', 2016],
    ['Marvel Legacy', 2018], ['Fresh Start', 2018],
  ]);
  assert.equal(targets.length, MODERN_TIMELINE_CHECKPOINTS.length, 'every period start is on the timeline');
  const rank = (key) => whole.findIndex((entry) => entry.key === key);
  const ranks = targets.map((target) => rank(target.before));
  assert.ok(ranks.every((value, index) => value >= 0 && (index === 0 || value > ranks[index - 1])),
    'each marker is a distinct real stop, later than the one before it');
  for (const target of targets) {
    const entry = whole[rank(target.before)];
    assert.ok(readingIds(entry).includes(target.start), `${target.name} starts at ${target.start}`);
    assert.equal(Number(entry.year ?? entry.lists[0].timeline), target.year, `${target.name} is drawn in its year`);
  }
  const dark = targets.find((target) => target.key === 'dark-reign');
  assert.ok(!readingIds(whole[rank(dark.before)]).includes('siege-dark-reign-prelude'), 'Siege is never called Dark Reign');
  const initiative = targets.find((target) => target.key === 'the-initiative');
  const bridge = rank('placement:civil-war-to-secret-invasion');
  assert.ok(bridge > rank(initiative.before) && bridge < rank(targets.find((t) => t.key === 'secret-invasion').before),
    'the 2007 bridge reads inside The Initiative');
  const fresh = rank(targets.at(-1).before);
  assert.ok(whole.slice(fresh).some((entry) => Number(entry.lists[0].timeline) >= 2025),
    'the timeline carries on past Fresh Start');
});

test('a search or filter moves a period\'s marker within it, or drops only that period', () => {
  const at = (key, year) => ({ key, year, lists: [{ id: key, timeline: year }] });
  const order = [at('a', 2007), at('b', 2007), at('c', 2008), at('d', 2008), at('e', 2008), at('f', 2025)];
  const checkpoints = [
    { key: 'one', name: 'One', year: 2007, start: 'a' },
    { key: 'two', name: 'Two', year: 2008, start: 'c' },
    { key: 'three', name: 'Three', year: 2008, start: 'e' },
  ];
  const keys = (drawn) => timelineCheckpointTargets(order, drawn, checkpoints).map((t) => [t.key, t.before]);
  assert.deepEqual(keys(order), [['one', 'a'], ['two', 'c'], ['three', 'e']]);
  assert.deepEqual(keys([order[1], order[3], order[5]]), [['one', 'b'], ['two', 'd']],
    'a marker moves to the next stop in its period, and an emptied period is left out');
  assert.deepEqual(keys([order[5]]), [], 'a stop past the last period never takes its marker');
  assert.deepEqual(timelineCheckpointTargets(order, order, [
    checkpoints[0], { ...checkpoints[1], start: 'missing' }, checkpoints[2],
  ]).map((t) => [t.key, t.before]), [['one', 'a'], ['three', 'e']], 'a period missing its start is no dead jump');
});

test('the two family eras are stops in the whole timeline, never jumps, and claim no event around them', () => {
  const whole = wholeTimeline();
  const eras = timelineFamilyEraStops(whole);
  assert.deepEqual(eras.map((era) => [era.name, era.year, era.after]), [
    ['Reign of X', 2020, 'list:king-in-black'],
    ['X-Men: Fall of X', 2023, null],
  ], 'Reign of X follows King in Black as the source lists it, and Fall of X leads 2023 after Sins of Sinister');
  const menu = new Set(MODERN_TIMELINE_CHECKPOINTS.flatMap((checkpoint) => [checkpoint.key, checkpoint.name]));
  assert.ok(MODERN_TIMELINE_FAMILY_ERAS.every((era) => !menu.has(era.key) && !menu.has(era.name)),
    'neither era is a jump destination');
  const ids = new Set(catalog.lists.map((entry) => entry.id));
  assert.ok(MODERN_TIMELINE_FAMILY_ERAS.every((era) => !ids.has(era.key)), 'neither era is a catalog id');
  assert.equal(whole.find((entry) => readingIds(entry).includes('fall-house-x-rise-powers-x'))?.lists[0].name,
    'Fall of the House of X & Rise of the Powers of X', 'the 2024 finale keeps its own name');
  assert.deepEqual(timelineFamilyEraStops(whole, { narrowed: true }), [], 'a search or filter draws no era');
  assert.deepEqual(timelineFamilyEraStops(whole.filter((entry) => !readingIds(entry).includes('king-in-black')))
    .map((era) => era.key), ['fall-of-x'], 'an era whose source neighbour is gone is dropped, not guessed at');
});

test('a family era draws as a named stop with no control, and the readings beside it stay cards', () => {
  const eraBlock = catalogPresentationSource.slice(
    catalogPresentationSource.indexOf('const eraStop = (era) =>'),
    catalogPresentationSource.indexOf('for (const section of sections)'),
  );
  assert.match(eraBlock, /class: 'timeline-family-era'/);
  assert.doesNotMatch(eraBlock, /era\.period|timeline-family-era-period/, 'periods stay in provenance, not visible copy');
  assert.doesNotMatch(eraBlock, /button|tabindex|catalog-card|href/, 'nothing in an era can be added, opened or focused');
  assert.match(styles, /\.timeline-family-era \{[^}]*dashed/);
});

test('an event carries its scale once, on its own card, and ordinary stops carry nothing', () => {
  const whole = wholeTimeline();
  const badgeOf = (id) => modernTimelineEventBadge(whole.find((entry) => readingIds(entry).includes(id)));
  assert.deepEqual(badgeOf('civil-war'), { kind: 'major', label: 'Major event' });
  assert.deepEqual(badgeOf('placement:secret-wars-2015'), { kind: 'major', label: 'Major event' });
  assert.deepEqual(badgeOf('siege-dark-reign-prelude'), { kind: 'major', label: 'Major event' });
  assert.deepEqual(badgeOf('x-of-swords'), { kind: 'family', label: 'X-Men event' });
  assert.deepEqual(badgeOf('spider-verse'), { kind: 'family', label: 'Spider-Man event' });
  assert.deepEqual(badgeOf('chaos-war'), { kind: 'major', label: 'Major event' });
  assert.deepEqual(badgeOf('monsters-unleashed'), { kind: 'major', label: 'Major event' });
  for (const id of ['war-of-kings', 'realm-of-kings']) {
    assert.equal(badgeOf(id), null, `${id} crosses several families, so a setting is not its family`);
  }
  assert.equal(badgeOf('placement:civil-war-to-secret-invasion'), null, 'the bridge is a transition, not an event');
  assert.equal(badgeOf('marvel-knights-to-planet-x-01'), null, 'an ordinary run is not an event');
  const placement = whole.find((entry) => entry.key === 'placement:secret-wars-2015');
  for (const option of placement.options) {
    assert.equal(modernTimelineEventBadge({ key: `list:${option.list.id}`, lists: [option.list] }), null,
      `${option.list.id} is a reading option, not the event`);
  }
  const labels = new Set(whole.map(modernTimelineEventBadge).filter(Boolean).map((badge) => badge.label));
  assert.ok(!labels.has('Family event'));
  assert.ok([...labels].every((label) => label === 'Major event' || / event$/.test(label)));
});
