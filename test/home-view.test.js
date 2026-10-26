import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHomeView } from '../src/js/views/home.js';
import { createCatalogPresentation } from '../src/js/views/shared/catalog-presentation.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function classList(value = '') {
  const names = new Set(value.split(/\s+/).filter(Boolean));
  return {
    contains: (name) => names.has(name),
    remove: (name) => names.delete(name),
    toggle(name, force) {
      if (force ?? !names.has(name)) names.add(name);
      else names.delete(name);
    },
  };
}

function node(props = {}, children = []) {
  const result = {
    attributes: {},
    children: [].concat(children),
    classList: classList(props.class),
    dataset: props.dataset ?? {},
    hidden: props.hidden ?? false,
    id: props.id,
    listeners: {},
    style: { setProperty(name, value) { this[name] = value; } },
    textContent: props.text ?? '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    prepend(child) { this.children.unshift(child); },
    // As the DOM does, the text is what the node now holds, so a count built from parts reads whole.
    replaceChildren(...next) {
      this.children = next;
      this.textContent = next.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    ...props,
  };
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('aria-')) result.attributes[name] = value;
  }
  return result;
}

function element(_tag, props = {}, children = []) {
  return { ...node(props, children), tag: _tag };
}

function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    if (typeof child !== 'string') {
      const found = findById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function gateway() {
  const nodes = {
    primary: node(),
    secondary: node(),
    more: node({ hidden: true }),
    status: node({ class: 'visually-hidden', hidden: false }),
  };
  return {
    nodes,
    querySelector(selector) {
      return {
        '[data-primary-paths]': nodes.primary,
        '[data-secondary-paths]': nodes.secondary,
        '[data-more-paths]': nodes.more,
        '[data-paths-status]': nodes.status,
      }[selector];
    },
  };
}

function harness({
  catalogLoader = null,
  populated = false,
  nextIssue = { issueId: 7, title: 'Next issue', seriesName: 'Series (2026)', number: '3' },
  progress = { read: 1, total: 2 },
  readerPresentation,
} = {}) {
  const firstGateway = gateway();
  const secondGateway = gateway();
  const categoriesRoot = node();
  const nodes = {
    home: node({ hidden: false }),
    categoriesHeading: node({ class: populated ? '' : 'visually-hidden' }),
    categoriesRoot,
    continueSection: node(),
    continueHeading: node({ text: 'Continue reading' }),
    continueBar: node(),
    continueFill: node(),
    continueCount: node(),
    continueNext: node(),
    continueImage: node(),
    continueFallback: node(),
    continueSeries: node(),
    continueNumber: node(),
    continueRead: node({ text: 'Read' }),
    continueDone: node({ text: 'Done' }),
    continueOpen: node({ text: 'Open Reading List' }),
    continueReview: node(),
    continueDeferred: node(),
    yoursSection: node(),
    yoursList: node(),
    gateways: [firstGateway, secondGateway],
    copyrights: [node()],
  };
  const list = { id: 'a', name: 'Alpha order', itemIds: [7, 8] };
  const state = {
    read: {},
    listOrder: populated ? ['a'] : [],
    lists: populated ? { a: list } : {},
  };
  const calls = {
    covers: [],
    coverFallbacks: [],
    done: 0,
    failures: [],
    navigate: [],
    open: 0,
    read: [],
    saved: [],
    warnings: [],
  };
  const categories = [
    {
      key: 'timeline',
      route: 'catalog',
      tier: 'primary',
      icon: 'E736',
      heading: 'Modern Timeline',
      label: 'Browse by year',
      count: 2,
    },
    {
      key: 'reading-paths',
      route: 'reading-paths',
      tier: 'secondary',
      icon: 'E8FD',
      heading: 'Reading paths',
      label: 'Follow connected stories',
      count: 1,
      singular: 'Reading path',
      plural: 'Reading paths',
    },
  ];
  const catalog = {
    dropped: 0,
    lists: [{ id: 'recommended', name: 'Recommended' }],
    paths: [],
  };
  const view = createHomeView({
    categoriesForCatalog: () => categories,
    createIcon: (name, className) => node({
      class: className, 'aria-hidden': 'true', focusable: 'false', symbol: name,
    }),
    clearCatalogNotice: () => {},
    el: element,
    elements: () => ({
      ...nodes,
      firstRun: findById(categoriesRoot, 'home-first-run'),
    }),
    getActiveListId: () => 'a',
    getState: () => state,
    hueOf: () => 'hue',
    labelledName: (label, context) => `${label}: ${context}`,
    listProgress: () => progress,
    loadCatalog: catalogLoader ?? (async () => catalog),
    onCatalogDropped: (count) => calls.warnings.push(count),
    onCatalogLoadFailure: (options) => calls.failures.push(options),
    onDone: () => { calls.done += 1; },
    onNavigateCategory: (category) => calls.navigate.push(category.route),
    onNavigateHub: (viewName) => calls.navigate.push(viewName),
    onOpen: () => { calls.open += 1; },
    onReview: () => calls.navigate.push('review'),
    onReviewDeferred: () => calls.navigate.push('deferred'),
    onRead: (...args) => calls.read.push(args),
    readerPresentation,
    paintCover: (...args) => calls.covers.push(args),
    paintCoverUrl: (...args) => calls.coverFallbacks.push(args),
    renderSavedLists: (...args) => calls.saved.push(args),
    seriesOnly: (name) => name.replace(/\s+\(.*/, ''),
    shortTitle: (name) => name,
    upNext: () => nextIssue,
  });
  return { calls, categories, nodes, state, view };
}

test('510 Home distinguishes deferred work from completion and exposes a separate review action', () => {
  const h = harness({ populated: true, nextIssue: null, progress: { read: 1, total: 2 } });
  h.state.read[7] = 510;
  h.state.lists.a.deferredIssueIds = [7, 8];
  h.view.wire();
  h.view.render();
  assert.equal(h.nodes.continueCount.textContent, '1 of 2 issues read. 1 deferred');
  assert.equal(h.nodes.continueNext.textContent, 'Nothing queued. 1 unread issue is deferred.');
  assert.equal(h.nodes.continueRead.hidden, true);
  assert.equal(h.nodes.continueDeferred.hidden, false);
  assert.equal(h.nodes.continueCount.children[0].textContent, '1');
  h.nodes.continueDeferred.listeners.click();
  assert.deepEqual(h.calls.navigate, ['deferred']);
  assert.deepEqual(h.calls.read, []);
  h.state.read[8] = 511;
  h.view.render();
  assert.equal(h.nodes.continueDeferred.hidden, true);
});

test('Home gateways and Continue expose native destinations without changing reading action callbacks', async () => {
  const h = harness({ populated: true });
  h.view.wire();
  h.view.render();
  await new Promise((resolve) => setImmediate(resolve));
  const link = h.nodes.gateways[0].nodes.primary.children[0].children[0];
  assert.equal(link.tag, 'a');
  assert.equal(link.href, '#/catalog');
  link.onclick({ button: 0, ctrlKey: true, preventDefault() { assert.fail('native default intercepted'); } });
  assert.deepEqual(h.calls.navigate, []);
  assert.equal(h.nodes.continueOpen.attributes.href, '#/read/a');
  h.nodes.continueOpen.listeners.click({ button: 0, metaKey: true, preventDefault() { assert.fail('native default intercepted'); } });
  assert.equal(h.calls.open, 0);
  h.nodes.continueOpen.listeners.click({ button: 0, preventDefault() {} });
  assert.equal(h.calls.open, 1);
  assert.equal(typeof h.nodes.continueRead.listeners.click, 'function');
});

test('Home view owns focused first-run choices, saved lists, and shared gateways', async () => {
  const h = harness();
  h.view.render();
  await new Promise((resolve) => setImmediate(resolve));

  const firstRun = findById(h.nodes.categoriesRoot, 'home-first-run');
  assert.equal(firstRun.hidden, false);
  assert.equal(firstRun.attributes['aria-labelledby'], 'home-first-run-h');
  assert.equal(findById(firstRun, 'home-first-run-h').textContent, 'Where do you want to start?');
  assert.equal(h.nodes.continueSection.hidden, true);
  assert.equal(h.nodes.continueHeading.textContent, 'Continue reading');
  assert.equal(h.calls.saved.length, 1);

  for (const gatewayEntry of h.nodes.gateways) {
    assert.equal(gatewayEntry.nodes.primary.children.length, 1);
    assert.equal(gatewayEntry.nodes.secondary.children.length, 1);
    assert.equal(gatewayEntry.nodes.more.hidden, false);
    assert.equal(gatewayEntry.nodes.status.textContent, '2 ways to read available.');
    assert.equal(gatewayEntry.nodes.status.classList.contains('visually-hidden'), true);
  }
  const tile = h.nodes.gateways[0].nodes.primary.children[0].children[0];
  assert.equal(tile.attributes['aria-label'], 'Modern Timeline. Browse by year. 2 Reading Lists.');
  tile.onclick();
  assert.deepEqual(h.calls.navigate, ['catalog']);

  assert.equal(findById(firstRun, 'home-recommended'), null);
  assert.equal(findById(firstRun, 'btn-home-recommended'), null);
  findById(firstRun, 'btn-home-browse').onclick();
  findById(firstRun, 'btn-home-add').onclick();
  assert.deepEqual(h.calls.navigate, ['catalog', 'catalog', 'add']);
});

test('first-run Home offers only Browse and Add without waiting for catalog load', () => {
  const h = harness({ catalogLoader: () => new Promise(() => {}) });
  const before = structuredClone(h.state);
  h.view.render();
  const firstRun = findById(h.nodes.categoriesRoot, 'home-first-run');
  const browse = findById(firstRun, 'btn-home-browse');
  const add = findById(firstRun, 'btn-home-add');
  assert.equal(firstRun.hidden, false);
  assert.equal(findById(firstRun, 'home-recommended'), null);
  assert.equal(browse.children[0], 'Browse Reading Lists');
  assert.equal(browse.href, '#/catalog');
  assert.equal(browse.class, 'btn');
  assert.equal(add.children[0], 'Add comics');
  assert.equal(add.class, 'btn btn-g');
  browse.onclick();
  add.onclick();
  assert.deepEqual(h.calls.navigate, ['catalog', 'add']);
  assert.deepEqual(h.state, before);
  h.state.listOrder.push('a');
  h.state.lists.a = { id: 'a', name: 'Alpha order', itemIds: [] };
  h.view.render();
  assert.equal(firstRun.hidden, true);
});

test('453 Home refresh uses effective launchability and saved provenance without repainting gateways', () => {
  let temporary = false;
  const h = harness({
    populated: true,
    nextIssue: { issueId: -7, title: 'Manual comic', seriesName: '' },
    readerPresentation: (_issue, source) => {
      assert.equal(source, 'saved');
      return { launchable: temporary, temporary };
    },
  });
  h.view.wire();
  h.view.render();
  assert.equal(h.nodes.continueRead.hidden, false);
  assert.equal(h.nodes.continueRead.disabled, true);
  temporary = true;
  h.view.refreshReader();
  assert.equal(h.nodes.continueRead.hidden, false);
  assert.equal(h.nodes.continueRead.disabled, false);
  assert.equal(h.nodes.continueRead.textContent, 'Read');
  assert.equal(h.nodes.continueRead.attributes['aria-label'], 'Read: Manual comic in Marvel Unlimited with temporary link');
  assert.equal(h.nodes.continueNext.textContent, 'Next: Manual comic (temporary reader link)');
  h.nodes.continueRead.listeners.click({});
  assert.equal(h.calls.read.at(-1)[2], 'saved');
  assert.equal(h.calls.read.at(-1)[0].digitalId, undefined);
  temporary = false;
  h.view.refreshReader();
  assert.equal(h.nodes.continueRead.disabled, true);
  assert.doesNotMatch(h.nodes.continueNext.textContent, /temporary/);
});

test('Home view paints populated Continue details and accessible actions', () => {
  const h = harness({ populated: true });
  h.view.render();

  assert.equal(h.nodes.categoriesHeading.classList.contains('visually-hidden'), false);
  assert.equal(findById(h.nodes.categoriesRoot, 'home-first-run').hidden, true);
  assert.equal(h.nodes.continueSection.hidden, false);
  assert.equal(h.nodes.continueHeading.textContent, 'Alpha order');
  // The count is the card's one reading of its progress (#876): the read figure leads it, and the bar
  // repeats it for the eye with no progress semantics of its own, which the markup hides.
  assert.equal(h.nodes.continueCount.textContent, '1 of 2 issues read');
  assert.equal(h.nodes.continueCount.children[0].textContent, '1');
  assert.equal(h.nodes.continueCount.children[0].classList.contains('glance-n'), true);
  assert.deepEqual(Object.keys(h.nodes.continueBar.attributes), []);
  assert.equal(h.nodes.continueBar.hidden, false);
  assert.equal(h.nodes.continueFill.style['--glance-share'], '50.0%');
  assert.equal(h.nodes.continueNext.textContent, 'Next: Next issue');
  assert.equal(h.nodes.continueSeries.textContent, 'Series');
  assert.equal(h.nodes.continueNumber.textContent, '#3');
  assert.equal(h.nodes.continueRead.textContent, 'Read');
  assert.equal(h.nodes.continueRead.attributes['aria-label'], 'Read: Next issue in Marvel Unlimited');
  assert.equal(h.nodes.continueOpen.attributes['aria-label'], 'Open Reading List: Alpha order');
  assert.equal(h.calls.covers.length, 1);
});

test('446 Setup stays on contextual browse pages without gating direct entry from Home', async () => {
  const h = harness();
  h.view.render();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findById(h.nodes.categoriesRoot, 'home-recommended'), null);
  const timeline = h.nodes.gateways[0].nodes.primary.children[0].children[0];
  timeline.onclick();
  assert.deepEqual(h.calls.navigate, ['catalog']);
  assert.deepEqual(h.state.listOrder, []);

  const list = {
    id: 'setup-to-modern-timeline',
    name: 'Setup to Modern Timeline',
    description: 'Earlier stories.',
    count: 21,
  };
  let feature;
  const presentation = createCatalogPresentation({
    el: element,
    elements: { query: (selector) => selector.endsWith('-results')
      ? { before: (value) => { feature = value; } }
      : null },
    hueOf: () => 0,
    isInLibrary: () => false,
    onPreview: () => {},
    paintCoverUrl: () => {},
    shortTitle: (title) => title,
  });
  for (const surface of ['catalog', 'age-marvel-knights-heroes-return']) {
    presentation.ensureSetupGuideFeature([list], surface, (lists) => lists[0]);
    const intro = feature.children[0].children[1].textContent;
    assert.match(intro, /^An optional guide to earlier stories\..*directly\./);
    const help = feature.children[0].children[2];
    assert.notEqual(help.open, true);
    assert.equal(help.children[0].textContent, 'About this starting point');
    const copy = help.children[1].textContent;
    assert.match(copy, /^New to Marvel\? .*historical context.*characters and events/);
    assert.match(copy, /optional;/);
    if (surface === 'catalog') {
      assert.match(copy, /1998.*not an official Marvel editorial-era boundary/);
    } else {
      assert.match(copy, /you can enter this age directly\./);
      assert.doesNotMatch(copy, /Read this orientation guide first/);
    }
    assert.equal(feature.dataset.featuredList, list.id);
    assert.equal(findById(feature, `${feature.id}-h`).textContent, list.name);
  }
});

test('Home view completion state removes the read action without inventing a next issue', () => {
  const h = harness({ populated: true, nextIssue: null, progress: { read: 2, total: 2 } });
  h.view.render();

  assert.equal(h.nodes.continueNext.textContent, 'You have read every issue in this order.');
  assert.equal(h.nodes.continueRead.hidden, true);
  assert.equal(h.nodes.continueSeries.textContent, 'Alpha order');
  assert.equal(h.nodes.continueNumber.textContent, '');
  assert.equal(h.nodes.continueCount.textContent, '2 of 2 issues read');
  assert.equal(h.nodes.continueFill.style['--glance-share'], '100.0%');
  assert.equal(h.calls.coverFallbacks.length, 1);
});

test('Home Review is withdrawn only when the active saved list has no issues', () => {
  const progress = { read: 0, total: 0 };
  const h = harness({ populated: true, nextIssue: null, progress });
  h.state.lists.a.itemIds = [];
  const before = structuredClone(h.state);
  h.view.render();
  assert.equal(h.nodes.continueReview.hidden, true);
  assert.equal(h.nodes.continueOpen.hidden, false);
  progress.total = 1;
  h.view.refreshReader();
  assert.equal(h.nodes.continueReview.hidden, false);
  progress.total = 0;
  h.view.render();
  assert.equal(h.nodes.continueReview.hidden, true);
  assert.deepEqual(h.state, before);
});

test('441 Home describes an empty saved list without claiming completion or changing its contents', () => {
  const h = harness({ populated: true, nextIssue: null, progress: { read: 0, total: 0 } });
  h.state.lists.a.itemIds = [];
  const before = structuredClone(h.state);
  h.view.wire();
  h.view.render();

  assert.equal(h.nodes.continueSection.hidden, false);
  assert.equal(h.nodes.continueNext.textContent, 'No issues in this Reading List yet. Open it to add comics.');
  assert.equal(h.nodes.continueSection.classList.contains('continue-empty'), true);
  assert.equal(h.nodes.continueRead.hidden, true);
  assert.equal(h.nodes.continueCount.textContent, '0 of 0 issues read');
  // An empty list has no progress to draw, so its bar goes, as it always has.
  assert.equal(h.nodes.continueFill.style['--glance-share'], '0%');
  assert.equal(h.nodes.continueBar.hidden, true);
  assert.equal(h.nodes.continueOpen.attributes['aria-label'], 'Open Reading List: Alpha order');
  assert.equal(h.nodes.continueReview.hidden, true);
  h.nodes.continueRead.listeners.click({});
  h.nodes.continueOpen.listeners.click();
  assert.equal(h.calls.read.length, 0);
  assert.equal(h.calls.open, 1);
  assert.deepEqual(h.calls.navigate, []);
  assert.deepEqual(h.state, before);
});

test('Home view wires only local controls and delegates controller effects', () => {
  const h = harness({ populated: true });
  h.view.wire();
  const event = {};
  h.nodes.continueRead.listeners.click(event);
  h.nodes.continueOpen.listeners.click();

  assert.equal(h.calls.read.length, 1);
  assert.equal(h.calls.read[0][0].title, 'Next issue');
  assert.equal(h.calls.read[0][1], event);
  assert.equal(h.calls.open, 1);
});

test('a newer gateway render makes an earlier catalog failure stale', async () => {
  let rejectCatalog;
  const catalogLoad = new Promise((resolve, reject) => {
    rejectCatalog = reject;
  });
  const h = harness({ catalogLoader: () => catalogLoad });

  const firstRender = h.view.renderGateways();
  const secondRender = h.view.renderGateways();
  rejectCatalog(new Error('catalog failed'));
  await Promise.all([firstRender, secondRender]);

  assert.equal(h.calls.failures.length, 2);
  assert.equal(h.calls.failures[0].isCurrent(), false);
  assert.equal(h.calls.failures[1].isCurrent(), true);
});

test('main constructs Home once while the view has no controller or concrete-view dependency', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const source = readFileSync(join(ROOT, 'src/js/views/home.js'), 'utf8');

  assert.match(main, /const homeView = createHomeView\(\{/);
  assert.match(main, /if \(next === 'home'\) homeView\.render\(\);/);
  assert.doesNotMatch(main, /next === 'browse'/, 'Browse returned as a view with a gateway of its own');
  assert.match(main, /homeView\.wire\(\);/);
  assert.match(main, /homeView\.categoryTile\(/);
  assert.doesNotMatch(main, /homeView\?\.(?:render|renderGateways|categoryTile|wire)|if \(homeView\)/);
  assert.doesNotMatch(source, /(?:main|storage)\.js|views\/(?:issue|library|progress)\.js/);
});

// UX-41 (#829). Continue reading offered Read but not Done, so finishing the loop from Home meant
// opening the list. Done now sits beside Read for the comic the card names, sharing the reading
// view's result and Undo; Home only shows it and hands the press on.
test('UX-41 Continue reading offers Done beside Read whenever a comic is next, even when Read cannot launch', () => {
  let launchable = false;
  const h = harness({ populated: true, readerPresentation: () => ({ launchable, temporary: false }) });
  h.view.wire();
  h.view.render();
  assert.equal(h.nodes.continueRead.disabled, true, 'Read waits for a reader link');
  assert.equal(h.nodes.continueDone.hidden, false, 'Done shows with Read');
  assert.notEqual(h.nodes.continueDone.disabled, true, 'marking a comic read needs no reader link');
  launchable = true;
  h.view.refreshReader();
  assert.equal(h.nodes.continueDone.hidden, false);
  for (const [name, options, setup] of [
    ['finished', { nextIssue: null, progress: { read: 2, total: 2 } }],
    ['only deferred left', { nextIssue: null, progress: { read: 1, total: 2 } }, (state) => { state.lists.a.deferredIssueIds = [8]; }],
    ['empty', { nextIssue: null, progress: { read: 0, total: 0 } }, (state) => { state.lists.a.itemIds = []; }],
  ]) {
    const quiet = harness({ populated: true, ...options });
    setup?.(quiet.state);
    quiet.view.render();
    assert.equal(quiet.nodes.continueRead.hidden, true, `${name}: no Read`);
    assert.equal(quiet.nodes.continueDone.hidden, true, `${name}: no Done either`);
  }
});

test('UX-41 Done on Continue reading hands on one press and ignores a held Enter', () => {
  const h = harness({ populated: true });
  h.view.wire();
  h.view.render();
  h.nodes.continueDone.listeners.click({});
  assert.equal(h.calls.done, 1, 'one press, one Done');
  assert.deepEqual(h.calls.read, [], 'Done does not launch the reader');
  const press = (key, repeat) => ({ key, repeat, preventDefault() { this.prevented = true; } });
  const held = press('Enter', true);
  h.nodes.continueDone.listeners.keydown(held);
  assert.equal(held.prevented, true, 'an auto-repeated Enter does not activate Done again');
  for (const fresh of [press('Enter', false), press(' ', true)]) {
    h.nodes.continueDone.listeners.keydown(fresh);
    assert.equal(fresh.prevented, undefined, `${JSON.stringify(fresh.key)} keeps its native activation`);
  }
});

test('UX-41 Home\'s Done follows Read as a secondary command, named and described as the hero\'s is', () => {
  const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
  const card = html.match(/<section id="home-continue"[\s\S]*?\n {12}<\/section>/)?.[0] ?? '';
  assert.match(card, /<h2 id="chero-h" tabindex="-1">/, 'the card heading can take focus when Done goes');
  const row = card.match(/<div class="cta" id="chero-actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const buttons = [...row.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .map(([, attributes, label]) => ({ attributes, label: label.trim() }));
  assert.deepEqual(buttons.slice(0, 2).map(({ label }) => label), ['Read', 'Done'], 'Done sits directly after Read');
  const [read, done] = buttons;
  assert.match(read.attributes, /class="btn"/, 'Read stays the primary command');
  assert.equal(buttons.filter(({ attributes }) => /class="btn"/.test(attributes)).length, 1, 'and the only one');
  assert.match(done.attributes, /id="btn-chero-done"/);
  assert.match(done.attributes, /class="btn btn-g"/, 'Done is secondary');
  assert.match(done.attributes, /aria-describedby="chero-done-help"/);
  // The hero's hint names the D shortcut and goes when D is off; D never acts on Home.
  assert.doesNotMatch(done.attributes, /has-tooltip|data-tooltip|aria-keyshortcuts/);
  const help = (id) => html.match(new RegExp(`<span id="${id}" hidden>([^<]*)</span>`))?.[1];
  assert.ok(help('chero-done-help'), 'the description is present and hidden');
  assert.equal(help('chero-done-help'), help('hero-done-help'), 'the same description as the hero\'s Done');
});
