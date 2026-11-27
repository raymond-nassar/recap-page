import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCatalogPresentation, PROJECT_HOME, sourceButton, visitButton } from '../src/js/views/shared/catalog-presentation.js';
import {
  catalogEntries, eraSections, groupCatalog, modernTimelineEventBadge, modernTimelineLists,
  parseCatalog, shelfKey, timelineCheckpointTargets, timelineDrawOrder, updatedLabel,
} from '../src/js/lib/catalog.js';

function el(tag, props = {}, children = []) {
  return {
    tag,
    children: [].concat(children),
    append(...more) { this.children.push(...more); },
    replaceChildren(...next) { this.children = next; },
    ...props,
  };
}

function descendants(node) {
  return typeof node === 'object' && node !== null
    ? [node, ...node.children.flatMap(descendants)] : [];
}

function text(node) {
  return typeof node === 'string' ? node
    : node?.textContent ?? node?.text ?? node?.children.map(text).join('') ?? '';
}

const presentation = createCatalogPresentation({
  el,
  hueOf: () => 0,
  isInLibrary: () => false,
  paintCoverUrl: () => {},
  shortTitle: (title) => title,
});
const list = {
  id: 'spider-man',
  name: 'Amazing Spider-Man',
  description: 'A reading list.',
  count: 3,
  source: 'https://www.comicbookherald.com/amazing-spider-man-reading-order-modern-marvel-era/',
  sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
  sourceSection: 'Modern Marvel era',
  updatedAt: '2026-09-07T00:00:00Z',
};

const controls = (card) => descendants(card)
  .filter((node) => node.tag === 'button' || (node.tag === 'a' && node.href));

test('Civil War II and Secret Empire parent cards carry Major event while Road and Standoff remain unbadged', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const sections = eraSections(catalogEntries(modernTimelineLists(parseCatalog(raw).lists)));
  const order = timelineDrawOrder(sections);
  for (const saved of [false, true]) {
    const shared = createCatalogPresentation({
      el, hueOf: () => 0, paintCoverUrl: () => {}, shortTitle: (title) => title,
      isInLibrary: (id) => saved ? { id: `saved-${id}`, itemIds: [] } : null,
    });
    const root = el('div');
    shared.renderTimelineSections(root, sections, {
      showEmptyYears: false, badgeFor: modernTimelineEventBadge,
    });
    const cards = descendants(root).filter((node) => node.class === 'catalog-card');
    for (const id of ['civil-war-ii', 'secret-empire-event', 'road-to-secret-empire', 'avengers-standoff']) {
      const story = order.find((entry) => entry.lists.some((list) => list.id === id));
      assert.ok(story, `${id} must occur in the production timeline`);
      const matching = cards.filter((card) => card.dataset.story === story.key);
      assert.equal(matching.length, 1, `${id} has one parent card`);
      const badges = descendants(matching[0]).filter((node) => node.class?.includes('event-badge'));
      assert.deepEqual(badges.map((node) => [node.class, node.text]),
        ['civil-war-ii', 'secret-empire-event'].includes(id)
          ? [['badge event-badge event-badge-major', 'Major event']] : [], id);
    }
  }
});

test('Road remains an Era and draws one direct unbadged timeline stop before Secret Empire', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const road = raw.lists.find(({ id }) => id === 'road-to-secret-empire');
  const event = raw.lists.find(({ id }) => id === 'secret-empire-event');
  assert.ok(road && event, 'both published forms must exist separately');
  const newIds = new Set(['avengers-standoff', 'civil-war-ii', road.id, event.id]);
  const baseline = timelineDrawOrder(eraSections(catalogEntries(
    modernTimelineLists(parseCatalog({ ...raw, lists: raw.lists.filter(({ id }) => !newIds.has(id)) }).lists),
  )));
  raw.lists.push({ ...road, id: 'unrelated-era', name: 'Unrelated era' });
  const parsed = parseCatalog(raw);
  assert.equal(parsed.dropped, 0);
  const grouped = groupCatalog(parsed.lists);
  const roadStory = grouped.find((story) => story.lists.some((entry) => entry.id === road.id));
  assert.equal(roadStory.lists[0].type, 'era');
  assert.equal(roadStory.lists[0].timeline, 2017);
  assert.equal(shelfKey(roadStory), 'lines');
  const sections = eraSections(catalogEntries(modernTimelineLists(parsed.lists)));
  const order = timelineDrawOrder(sections);
  const ids = order.flatMap((story) => story.lists.map((entry) => entry.id));
  const roadAt = ids.indexOf(road.id);
  assert.ok(roadAt >= 0, 'the Era guide must survive the real timeline selector');
  assert.deepEqual(ids.slice(roadAt, roadAt + 3), [road.id, event.id, 'venomverse']);
  assert.equal(ids.filter((id) => id === road.id).length, 1);
  assert.ok(!ids.includes('unrelated-era'));
  assert.deepEqual(timelineCheckpointTargets(order, order).map(({ key, start, before }) => ({ key, start, before })),
    timelineCheckpointTargets(baseline, baseline).map(({ key, start, before }) => ({ key, start, before })));

  for (const saved of [null, { id: 'saved-road', itemIds: [] }]) {
    const calls = [];
    const shared = createCatalogPresentation({
      el, hueOf: () => 0, paintCoverUrl: () => {}, shortTitle: (title) => title,
      isInLibrary: (id) => id === road.id ? saved : null,
      onPreview: (entry) => calls.push(['preview', entry.id]),
      onAdd: (entry) => calls.push(['add', entry.id]),
      onOpen: (entry, own) => calls.push(['open', entry.id, own.id]),
    });
    const box = el('div');
    shared.renderTimelineSections(box, sections, {
      showEmptyYears: false, badgeFor: modernTimelineEventBadge,
    });
    const cards = descendants(box).filter((node) => node.class === 'catalog-card');
    assert.deepEqual(cards.map((card) => card.dataset.story), order.map((story) => story.key));
    const roadCards = cards.filter((card) => card.dataset.story === roadStory.key);
    assert.equal(roadCards.length, 1);
    const [card] = roadCards;
    assert.equal(card.dataset.year, 2017);
    assert.equal(descendants(card).some((node) => node.class?.includes('event-badge')), false);
    assert.equal(descendants(card).some((node) => node.tag === 'summary'), false);
    const [preview, action] = controls(card).filter((node) => node.dataset?.act);
    assert.equal(preview.dataset.key, roadStory.key);
    preview.onclick();
    assert.equal(action.dataset.key, road.id);
    action.onclick({ button: 0, currentTarget: action, preventDefault() {} });
    assert.deepEqual(calls, [
      ['preview', road.id],
      saved ? ['open', road.id, saved.id] : ['add', road.id],
    ]);
    if (saved) assert.equal(action.href, '#/read/saved-road');
  }
});

test('hidden-position recovery keeps the whole-timeline label and accepts the followed-path Clear filters label', () => {
  for (const showFullLabel of [undefined, 'Clear filters']) {
    const root = el('div');
    root.querySelectorAll = () => [];
    root.prepend = (node) => {
      root.children.unshift(node);
      node.after = (next) => root.children.push(next);
    };
    const reveal = () => {};
    presentation.paintTimelinePosition(root, { kind: 'current', storyKey: 'list:hidden' }, {
      showFull: reveal, showFullLabel, message: 'Hidden stop.',
    });
    const [button] = controls(root);
    assert.equal(button.text, showFullLabel ?? 'Show full timeline');
    assert.equal(button.onclick, reveal);
  }
});

test('one 2007 bridge chooser previews and adds or opens individual parts, never their parent', () => {
  const first = { ...list, id: 'bridge-part-1', name: 'Bridge: Part 1', count: 18 };
  const second = { ...list, id: 'bridge-part-2', name: 'Bridge: Part 2', count: 20 };
  const calls = [];
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, paintCoverUrl: () => {}, shortTitle: (value) => value,
    isInLibrary: (id) => id === second.id ? { id: 'saved-part-2' } : null,
    onAdd: (item) => calls.push(['add', item.id]),
    onFollowSectional: (id) => calls.push(['preview', id]),
    onOpen: (item, saved) => calls.push(['open', item.id, saved.id]),
  });
  const card = shared.placementCard({
    key: 'placement:bridge', name: 'Bridge', year: 2007, placement: true, sectional: true,
    options: [first, second].map((item) => ({ label: item.name, list: item, savedAs: [] })),
  });
  assert.equal(card.dataset.year, 2007);
  assert.deepEqual(descendants(card).filter((node) => node.tag === 'summary').map(text), ['Bridge']);
  const [previewFirst, add, previewSecond, open] = controls(card);
  assert.equal(previewFirst.href, '#/preview/bridge-part-1');
  assert.equal(previewSecond.href, '#/preview/bridge-part-2');
  previewFirst.onclick({ button: 0, ctrlKey: true, preventDefault: () => assert.fail('native gesture intercepted') });
  previewFirst.onclick({ button: 0, preventDefault() {} });
  assert.equal(text(add), '+ Add to library');
  add.onclick({ currentTarget: add });
  assert.equal(open.href, '#/read/saved-part-2');
  open.onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(calls, [['preview', first.id], ['add', first.id], ['open', second.id, 'saved-part-2']]);
});

test('P04 list links carry the same visible related-realities qualifier and preserve native navigation', () => {
  const navigated = [];
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => false, paintCoverUrl: () => {},
    shortTitle: (title) => title, onUniverse: (id) => navigated.push(id),
  });
  const mixed = {
    ...list,
    universeIds: ['marvel-zombies'],
    universeScopes: {
      'marvel-zombies': { kind: 'related-realities', note: 'Includes stories in other realities.' },
    },
  };
  const [line] = shared.listUniverseLines(mixed);
  assert.match(text(line), /Marvel Zombies/);
  assert.match(text(line), /Spans related realities: Includes stories in other realities\./);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, '#/universe/marvel-zombies');
  link.onclick({ button: 0, ctrlKey: true, preventDefault: () => assert.fail('modified activation intercepted') });
  assert.deepEqual(navigated, []);
  link.onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(navigated, ['marvel-zombies']);
  const [relation] = shared.resolver.getListUniverseRelations(mixed);
  assert.match(text(shared.universeRelationLine(relation, { showUniverse: false })),
    /Spans related realities: Includes stories in other realities\./);
  assert.deepEqual(shared.listUniverseLines({ ...list }), []);
});

test('P04 issue and series links use reviewed identities and identify selected appearances', () => {
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => false, paintCoverUrl: () => {}, shortTitle: (title) => title,
  });
  const known = shared.issueUniverseLines({ issueId: 12460, seriesId: 2258 });
  assert.deepEqual(known.flatMap(descendants).filter((node) => node.tag === 'a').map((node) => node.href),
    ['#/universe/days-of-future-past', '#/universe/earth-616']);
  assert.deepEqual(shared.issueUniverseLines({ issueId: 12459, seriesId: 2258 }), []);
  const selected = shared.seriesUniverseLines('2258');
  assert.equal(selected.length, 1);
  assert.ok(selected.every((line) => /Selected comics/.test(text(line))));
  // The main universe is browsed through the timelines, so a series never lists it as a home.
  assert.deepEqual(selected.flatMap(descendants).filter((node) => node.tag === 'a').map((node) => node.dataset.key),
    ['series:2258:days-of-future-past']);
  assert.deepEqual(shared.seriesUniverseLines('2258x'), []);
});

test('list source pills name the curator and keep the exact private new-tab destination', () => {
  for (const [source, site] of [
    [list.source, 'Comic Book Herald'],
    ['https://comicbookreadingorders.com/marvel/events/house-of-m/', 'Comic Book Reading Orders'],
    ['https://github.com/emreparker/marvel-comics/blob/main/order.md', 'GitHub'],
    ['https://www.example.org/guide/?chapter=2#reading', 'example.org'],
    ['https://www.reddit.com/r/xmen/comments/abc/nightcrawler/', 'Reddit'],
    ['https://www.overdrive.com/collections/marvel', 'OverDrive'],
    ['https://en.wikipedia.org/wiki/House_of_M', 'Wikipedia'],
  ]) {
    const link = sourceButton(el, { ...list, source });
    assert.equal(link.tag, 'a');
    assert.equal(link.href, source);
    assert.equal(link.class, 'btn btn-g list-source-link');
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(text(link), `Visit ${site}`);
    assert.equal(link['aria-label'], `Visit ${site}, source of ${list.name} (opens in your browser)`);
    assert.equal(link.onclick, undefined, 'native link activation is not intercepted');
  }
});

test('missing, unsafe and project-owned sources do not invent a curator pill', () => {
  for (const source of [null, '', 'not a URL', 'javascript:alert(1)', 'http://example.org/',
    'https://github.com/raymond-nassar/recap-page/issues/759']) {
    assert.equal(sourceButton(el, { ...list, source }), null);
    const link = visitButton(el, { ...list, source });
    assert.equal(link.href, PROJECT_HOME, 'a list with no outside website links the project home page');
    assert.equal(link.class, 'btn btn-g list-home-link');
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(text(link), 'Visit the Recap Page website');
    assert.equal(link['aria-label'], 'Visit the Recap Page website (opens in your browser)', 'it claims to be no list\'s source');
  }
  assert.equal(visitButton(el, null).href, PROJECT_HOME, 'a retired list has no entry to read');
  assert.equal(visitButton(el, list).href, list.source);
  const mixed = { ...list, sourceOrigin: `${list.sourceOrigin}, with owner-selected additions` };
  assert.ok(text(presentation.attributionLine(mixed)).includes(mixed.sourceOrigin));
  assert.ok(sourceButton(el, mixed));
});

// The owner asked for the Visit button to stand out as a way to another website. The glyph is
// decorative, so the label and the spoken name stay exactly as approved.
test('Visit buttons carry the decorative external-link glyph after an unchanged label', () => {
  const createIcon = (name, className) => el('svg', { icon: name, class: className, text: '' });
  for (const link of [visitButton(el, list, createIcon), visitButton(el, null, createIcon)]) {
    const glyph = link.children.at(-1);
    assert.equal(glyph.icon, 'external');
    assert.equal(glyph.class, 'gi list-visit-glyph');
    assert.match(text(link), /^Visit (Comic Book Herald|the Recap Page website)$/);
    assert.match(link['aria-label'], /\(opens in your browser\)$/);
  }
});

// UX-11 (#830): one prominent action per card. The title opens Preview, named by the title it shows
// and then by what it does, and Add is the card's one action, a compact secondary button.
test('the title opens Preview, and Add is the card\'s one compact secondary action', () => {
  const previewed = [];
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => false, paintCoverUrl: () => {},
    shortTitle: (title) => title, onPreview: (chosen) => previewed.push(chosen.id),
  });
  const card = shared.catalogCard({ key: 'spider-man', lists: [list] });
  const nodes = descendants(card);
  const heading = nodes.find((node) => node.class === 'catalog-card-title');
  assert.equal(heading.tag, 'h3');
  const [preview] = heading.children;
  assert.equal(preview.tag, 'button');
  assert.equal(preview.type, 'button');
  assert.equal(preview.dataset.act, 'preview');
  assert.equal(text(preview), list.name, 'the button shows the title and nothing else');
  assert.equal(preview['aria-label'], 'Amazing Spider-Man. Preview.');
  preview.onclick();
  assert.deepEqual(previewed, ['spider-man']);
  const actions = nodes.find((node) => node.class === 'catalog-card-actions');
  assert.equal(actions.children.length, 1, 'the card offers one action');
  const [add] = actions.children;
  assert.equal(add.dataset.act, 'import');
  assert.equal(add.tag, 'button');
  assert.deepEqual(add.class.split(' '), ['btn', 'btn-g']);
  assert.equal(add['aria-label'], 'Add to library: Amazing Spider-Man');
  assert.equal(nodes.some((node) => node.tag === 'button' && text(node) === 'Preview'), false);
});

// The owner's choice on #830: the card keeps the credit the sources' permissions rest on, the linked
// site name, and the snapshot date and section move to Preview, which shows the full attribution.
test('cards keep the linked site credit and leave the snapshot and section to Preview', () => {
  const card = presentation.catalogCard({ key: 'spider-man', lists: [list] });
  const nodes = descendants(card);
  const line = nodes.find((node) => node.tag === 'p' && node.class.includes('result-source'));
  assert.ok(line);
  assert.equal(nodes.some((node) => node.tag === 'details'), false, 'a card carries no disclosure');
  assert.equal(text(line), 'Source: Comic Book Herald');
  assert.equal(text(card).includes('Snapshot taken'), false);
  assert.equal(text(card).includes(list.sourceSection), false);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, list.source);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(link['aria-label'].includes('Comic Book Herald'));
  assert.ok(link['aria-label'].includes(list.name));
});

test('source prefixes remain passive text separately from the source link', () => {
  const line = presentation.attributionLine(list, { compact: true });
  const [prefix, link] = line.children;
  assert.equal(prefix.tag, 'span');
  assert.equal(text(prefix), 'Source: ');
  assert.equal(controls(prefix).length, 0);
  assert.equal(link.tag, 'a');
  assert.equal(link.href, list.source);
  assert.equal(text(line), 'Source: Comic Book Herald');
});

test('mixed-source cards and search rows credit owner-selected additions separately', () => {
  const mixed = { ...list, sourceOrigin: `${list.sourceOrigin}, with owner-selected additions` };
  for (const surface of [
    presentation.catalogCard({ key: 'spider-man', lists: [mixed] }),
    presentation.catalogRow(mixed, { report: '#catalog-report' }),
  ]) {
    const line = descendants(surface).find((node) => node.tag === 'p' && node.class.includes('result-source'));
    assert.equal(text(line), 'Source: Comic Book Herald, with owner-selected additions');
    assert.equal(text(descendants(line).find((node) => node.tag === 'a')), 'Comic Book Herald');
  }
  const unlinked = presentation.attributionLine({ ...mixed, source: null }, { compact: true });
  assert.equal(text(unlinked), `Source: ${mixed.sourceOrigin}`);
  assert.equal(text(presentation.attributionLine(mixed)).includes(mixed.sourceOrigin), true);
});

test('cards and search rows distinguish a saved copy with a different comic count', () => {
  const saved = { id: 'existing', itemIds: [1, 2] };
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => saved, paintCoverUrl: () => {}, shortTitle: (title) => title,
  });
  for (const surface of [
    shared.catalogCard({ key: 'spider-man', lists: [list] }),
    shared.catalogRow(list, { report: '#catalog-report' }),
  ]) {
    const meta = descendants(surface).find((node) =>
      node.tag === 'p' && (node.class === 'catalog-card-meta' || node.class === 'result-meta'));
    assert.match(text(meta), /3 comics/);
    assert.match(text(meta), /Saved copy: 2 comics/);
  }
  const matching = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => ({ id: 'matching', itemIds: [1, 2, 3] }),
    paintCoverUrl: () => {}, shortTitle: (title) => title,
  });
  assert.doesNotMatch(text(matching.catalogCard({ key: 'spider-man', lists: [list] })), /Saved copy:/);
});

test('cards and search rows show the comic count without developer gap notes', () => {
  const gappy = {
    ...list,
    count: 157,
    placeholderCount: 1,
    emptyRecordCount: 2,
    ownerConfirmedIdentityCount: 3,
    ownerSupplementedCount: 2,
    ownerGcdSupplementedCount: 1,
  };
  for (const surface of [
    presentation.catalogCard({ key: 'spider-man', lists: [gappy] }),
    presentation.catalogRow(gappy, { report: '#catalog-report' }),
  ]) {
    const meta = descendants(surface).find((node) =>
      node.tag === 'p' && (node.class === 'catalog-card-meta' || node.class === 'result-meta'));
    assert.equal(text(meta), '157 comics');
  }
  const card = presentation.catalogCard({ key: 'spider-man', lists: [gappy] });
  assert.equal(text(descendants(card).find((node) => node.class === 'catalog-card-desc')), gappy.description);
});

test('a card has three keyboard stops with a linked source and two without one', () => {
  const linked = controls(presentation.catalogCard({ key: 'spider-man', lists: [list] }));
  assert.deepEqual(linked.map((node) => node.dataset?.act ?? 'source'), ['preview', 'source', 'import']);
  const unlinked = { ...list, source: null, sourceOrigin: 'Compiled for this project' };
  const card = presentation.catalogCard({ key: 'spider-man', lists: [unlinked] });
  assert.deepEqual(controls(card).map((node) => node.dataset.act), ['preview', 'import']);
  assert.equal(text(descendants(card).find((node) => node.tag === 'p' && node.class.includes('result-source'))),
    'Source: Compiled for this project');
});

test('compact source names credit the site in plain words, never a web address', () => {
  for (const [source, label] of [
    ['https://www.comicbookherald.com/guide/', 'Comic Book Herald'],
    ['https://comicbookherald.com/guide/', 'Comic Book Herald'],
    ['https://comicbookreadingorders.com/marvel/events/guide/', 'Comic Book Reading Orders'],
    ['https://www.comicbookreadingorders.com/guide/', 'Comic Book Reading Orders'],
    ['https://github.com/emreparker/marvel-comics/blob/main/data/hickman_full.md', 'GitHub'],
    ['https://github.com/raymond-nassar/recap-page/issues/303', 'Recap Page'],
    ['https://www.reddit.com/r/xmen/comments/abc/nightcrawler/', 'Reddit'],
    ['https://www.overdrive.com/collections/marvel', 'OverDrive'],
    ['https://en.wikipedia.org/wiki/House_of_M', 'Wikipedia'],
    ['https://www.example.com/reading-order', 'example.com'],
    ['https://comicbookherald.com.example.com/guide', 'comicbookherald.com.example.com'],
    ['https://en.wikipedia.org.example.com/wiki', 'en.wikipedia.org.example.com'],
  ]) {
    const line = presentation.attributionLine({ source }, { compact: true });
    assert.equal(text(line), `Source: ${label}`);
    assert.equal(descendants(line).find((node) => node.tag === 'a').href, source);
  }
});

// Owner direction on 2026-11-16: readers see a site's everyday name. A source added to the catalog
// from a site nobody has named yet would otherwise reach readers as a bare web address.
test('every catalog source shows readers a named site, never a web address', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  let named = 0;
  for (const entry of catalog.lists) {
    const link = sourceButton(el, entry);
    if (!link) continue;
    named++;
    assert.doesNotMatch(text(link), /[./]/, `${entry.id} reads ${JSON.stringify(text(link))}`);
    const compact = text(presentation.attributionLine(entry, { compact: true }));
    assert.doesNotMatch(compact, /[./]/, `${entry.id} card reads ${JSON.stringify(compact)}`);
  }
  assert.ok(named > 200, `expected the outside-source lists, found ${named}`);
});

test('Preview keeps full provenance and the exact section visible', () => {
  const line = presentation.attributionLine(list);
  assert.equal(line.tag, 'p');
  assert.equal(text(line),
    `Source: ${list.sourceOrigin} · Section: ${list.sourceSection} · Snapshot taken ${updatedLabel(list)}`);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, list.source);
  assert.ok(link['aria-label'].includes(list.sourceSection));
});

test('missing or unsafe source links retain credit without becoming clickable', () => {
  for (const source of [null, 'javascript:alert(1)', 'http://example.com/guide', 'not a URL']) {
    const line = presentation.attributionLine({ source, sourceOrigin: 'Compiled for this project' }, { compact: true });
    assert.equal(text(line), 'Source: Compiled for this project');
    assert.equal(descendants(line).some((node) => node.tag === 'a'), false);
  }
  assert.equal(text(presentation.attributionLine({ sourceLicense: 'Legacy credit' }, { compact: true })),
    'Source: Legacy credit');
  assert.equal(presentation.attributionLine({}), null);
  assert.equal(text(presentation.attributionLine({ sourceSection: 'Chapter one' })), 'Section: Chapter one');
  assert.equal(text(presentation.attributionLine({ updatedAt: list.updatedAt })),
    `Snapshot taken ${updatedLabel(list)}`);
});

test('saved catalog Open is a native actual-list destination while Add and Preview remain commands', () => {
  let opened = 0;
  const saved = { id: 'actual/list', name: 'Saved name' };
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => saved, paintCoverUrl: () => {},
    shortTitle: (title) => title, onOpen: () => { opened += 1; },
  });
  const nodes = descendants(shared.catalogCard({ key: 'spider-man', lists: [list] }));
  const open = nodes.find((node) => node.href === '#/read/actual%2Flist');
  assert.equal(open.tag, 'a');
  assert.equal(open.href, '#/read/actual%2Flist');
  assert.equal(open.class, 'btn', 'a saved list keeps its primary Open');
  open.onclick({ button: 0, metaKey: true, preventDefault() { assert.fail('native default intercepted'); } });
  assert.equal(opened, 0);
  open.onclick({ button: 0, preventDefault() {} });
  assert.equal(opened, 1);
  assert.equal(nodes.find((node) => node.dataset?.act === 'preview').tag, 'button');
  const unsaved = descendants(presentation.catalogCard({ key: 'spider-man', lists: [list] }));
  assert.equal(unsaved.find((node) => node.dataset?.act === 'import').tag, 'button');
});

test('expanded MCU guides render the team credit without changing source links or compact site labels', () => {
  const project = 'https://github.com/raymond-nassar/recap-page/issues/';
  const herald = 'https://www.comicbookherald.com/the-best-comics-to-read-with-doctor-strange-multiverse-of-madness/';
  const expected = [
    ['mcu-prep-ant-man-2015', `${project}765#ant-man-2015`],
    ['mcu-prep-avengers-infinity-war-endgame', `${project}766`],
    ['mcu-prep-black-panther-2018', `${project}766`],
    ['mcu-prep-captain-america-civil-war-2016', `${project}766`],
    ['mcu-prep-captain-america-the-first-avenger-2011', `${project}761`],
    ['mcu-prep-captain-america-the-winter-soldier-2014', `${project}765#captain-america-the-winter-soldier-2014`],
    ['mcu-prep-doctor-strange-2016', herald],
    ['mcu-prep-guardians-of-the-galaxy', `${project}700`],
    ['mcu-prep-iron-man-2-2010', `${project}761`],
    ['mcu-prep-iron-man-2008', `${project}761`],
    ['mcu-prep-iron-man-3-2013', `${project}761`],
    ['mcu-prep-the-avengers-2012', `${project}761`],
    ['mcu-prep-the-incredible-hulk-2008', `${project}761`],
    ['mcu-prep-thor-2011', `${project}761`],
    ['mcu-prep-thor-the-dark-world-2013', `${project}765#thor-the-dark-world-2013`],
  ];
  const credit = 'Reading list selected by Recap Page team';
  const data = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
  const manifest = data('curated-lists.json');
  const catalog = data('catalog.json');
  const expectedIds = expected.map(([id]) => id).sort();
  for (const lists of [manifest.lists, catalog.lists]) {
    assert.deepEqual(lists.filter(({ sourceOrigin }) => sourceOrigin === credit).map(({ id }) => id).sort(), expectedIds);
  }
  for (const [id, href] of expected) {
    const entry = manifest.lists.find((item) => item.id === id);
    const card = catalog.lists.find((item) => item.id === id);
    const payload = data(entry.out);
    assert.equal(entry.sourcePage, id === 'mcu-prep-doctor-strange-2016' ? `${project}766` : href, id);
    for (const value of [entry, payload, card]) {
      assert.equal(value.sourceOrigin, credit, id);
      assert.equal(value.sourceSection ?? null, null, id);
      assert.equal(value.sourceLicense ?? null, null, id);
    }
    assert.equal(payload.source, href, id);
    assert.equal(card.source, href, id);
    const full = presentation.attributionLine(card);
    const fullLink = descendants(full).find((node) => node.tag === 'a');
    assert.equal(fullLink.href, href, id);
    assert.equal(text(fullLink), credit, id);
    assert.ok(text(full).includes(`Snapshot taken ${updatedLabel(card)}`), id);
    const renderedCard = presentation.catalogCard({ key: `list:${id}`, lists: [card] });
    const compact = descendants(renderedCard).find((node) => node.class === 'result-meta result-source');
    assert.equal(text(compact), `Source: ${href === herald ? 'Comic Book Herald' : 'Recap Page'}`, id);
    assert.equal(descendants(compact).find((node) => node.tag === 'a').href, href, id);
  }
});

// #1603. A period that starts mid-year gets its own focusable marker between the year's cards, and
// an event's badge is drawn once on its own card, never on the readings a placement offers.
test('a section marker sits where its period starts, and an event badge only on the event\'s card', () => {
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => false, paintCoverUrl: () => {}, shortTitle: (value) => value,
  });
  const at = (id) => ({ key: `list:${id}`, lists: [{ ...list, id, name: id, timeline: 2008 }] });
  const placement = {
    key: 'placement:event', name: 'Event', year: 2008, placement: true,
    options: ['one', 'two'].map((id) => ({ label: id, list: { ...list, id, name: id }, savedAs: [] })),
  };
  const box = el('div');
  shared.renderTimelineSections(box, [{ key: 'era', name: 'Era', from: 2008, to: 2008, stories: [at('a'), placement, at('b')] }], {
    showEmptyYears: false,
    sectionBlurb: false,
    checkpoints: new Map([['list:a', { key: 'first', name: 'First' }], ['list:b', { key: 'second', name: 'Second' }]]),
    badgeFor: (story) => (story.key === 'placement:event' ? { kind: 'major', label: 'Major event' } : null),
  });
  const all = descendants(box);
  const markers = all.filter((node) => node.class === 'timeline-checkpoint');
  assert.deepEqual(markers.map((node) => [node.id, node.tabindex, node.text, node.tag]), [
    ['timeline-section-first', '-1', 'First', 'h4'], ['timeline-section-second', '-1', 'Second', 'h4'],
  ]);
  const body = all.find((node) => node.class === 'timeline-year-body');
  assert.deepEqual(body.children.map((node) => node.class), [
    'timeline-checkpoint', 'catalog-grid timeline-year-cards', 'timeline-checkpoint', 'catalog-grid timeline-year-cards',
  ], 'no empty grid is left before the first marker');
  const badges = all.filter((node) => typeof node.class === 'string' && node.class.startsWith('badge event-badge'));
  assert.deepEqual(badges.map((node) => [node.class, node.text]), [['badge event-badge event-badge-major', 'Major event']]);
  const card = all.find((node) => node.dataset?.placement === 'placement:event');
  assert.ok(descendants(card).includes(badges[0]), 'the badge is on the placement card');
  for (const option of descendants(card).filter((node) => node.class === 'placement-option')) {
    assert.ok(!descendants(option).includes(badges[0]), 'and on none of its readings');
  }
});
