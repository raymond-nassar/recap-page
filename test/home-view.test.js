import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHomeView } from '../src/js/views/home.js';

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
    replaceChildren(...next) { this.children = next; },
    setAttribute(name, value) { this.attributes[name] = value; },
    ...props,
  };
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('aria-')) result.attributes[name] = value;
  }
  return result;
}

function element(_tag, props = {}, children = []) {
  return node(props, children);
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
    continueRead: node({ text: 'Read next' }),
    continueOpen: node({ text: 'Open Reading List' }),
    yoursSection: node(),
    yoursList: node(),
    gateways: [firstGateway, secondGateway],
    copyrights: [node()],
  };
  const list = { id: 'a', name: 'Alpha order', itemIds: [7, 8] };
  const state = {
    listOrder: populated ? ['a'] : [],
    lists: populated ? { a: list } : {},
  };
  const calls = {
    covers: [],
    coverFallbacks: [],
    failures: [],
    navigate: [],
    open: 0,
    preview: [],
    read: [],
    saved: [],
    warnings: [],
  };
  const categories = [
    {
      key: 'timeline',
      route: 'catalog',
      tier: 'primary',
      icon: 'E8A5',
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
    clearCatalogNotice: () => {},
    el: element,
    elements: () => ({
      ...nodes,
      firstRun: findById(categoriesRoot, 'home-first-run'),
      recommendation: findById(categoriesRoot, 'home-recommended'),
      recommendationButton: findById(categoriesRoot, 'btn-home-recommended'),
    }),
    getActiveListId: () => 'a',
    getState: () => state,
    hueOf: () => 'hue',
    labelledName: (label, context) => `${label}: ${context}`,
    listProgress: () => ({ read: 1, total: 2 }),
    loadCatalog: catalogLoader ?? (async () => catalog),
    onCatalogDropped: (count) => calls.warnings.push(count),
    onCatalogLoadFailure: (options) => calls.failures.push(options),
    onNavigateCategory: (category) => calls.navigate.push(category.route),
    onOpen: () => { calls.open += 1; },
    onRead: (...args) => calls.read.push(args),
    openPreview: (entry) => calls.preview.push(entry.id),
    paintCover: (...args) => calls.covers.push(args),
    paintCoverUrl: (...args) => calls.coverFallbacks.push(args),
    recommendedList: () => catalog.lists[0],
    renderSavedLists: (...args) => calls.saved.push(args),
    seriesOnly: (name) => name.replace(/\s+\(.*/, ''),
    shortTitle: (name) => name,
    upNext: () => nextIssue,
  });
  return { calls, categories, nodes, state, view };
}

test('Home view owns first-run, saved-list, recommendation, and shared gateway presentation', async () => {
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

  const recommended = findById(firstRun, 'home-recommended');
  assert.equal(recommended.hidden, false);
  findById(firstRun, 'btn-home-recommended').onclick();
  assert.deepEqual(h.calls.preview, ['recommended']);
});

test('Home view paints populated Continue details and accessible actions', () => {
  const h = harness({ populated: true });
  h.view.render();

  assert.equal(h.nodes.categoriesHeading.classList.contains('visually-hidden'), false);
  assert.equal(findById(h.nodes.categoriesRoot, 'home-first-run').hidden, true);
  assert.equal(h.nodes.continueSection.hidden, false);
  assert.equal(h.nodes.continueHeading.textContent, 'Alpha order');
  assert.equal(h.nodes.continueBar.attributes['aria-valuemax'], '2');
  assert.equal(h.nodes.continueBar.attributes['aria-valuenow'], '1');
  assert.equal(h.nodes.continueBar.attributes['aria-valuetext'], '1 of 2 issues read');
  assert.equal(h.nodes.continueFill.style.width, '50.0%');
  assert.equal(h.nodes.continueNext.textContent, 'Next: Next issue');
  assert.equal(h.nodes.continueSeries.textContent, 'Series');
  assert.equal(h.nodes.continueNumber.textContent, '#3');
  assert.equal(h.nodes.continueRead.attributes['aria-label'], 'Read next: Next issue in Marvel Unlimited');
  assert.equal(h.nodes.continueOpen.attributes['aria-label'], 'Open Reading List: Alpha order');
  assert.equal(h.calls.covers.length, 1);
});

test('Home view completion state removes the read action without inventing a next issue', () => {
  const h = harness({ populated: true, nextIssue: null });
  h.view.render();

  assert.equal(h.nodes.continueNext.textContent, 'You have read every issue in this order.');
  assert.equal(h.nodes.continueRead.hidden, true);
  assert.equal(h.nodes.continueSeries.textContent, 'Alpha order');
  assert.equal(h.nodes.continueNumber.textContent, '');
  assert.equal(h.calls.coverFallbacks.length, 1);
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
  assert.match(main, /if \(next === 'browse'\) void homeView\.renderGateways\(\);/);
  assert.match(main, /homeView\.wire\(\);/);
  assert.match(main, /homeView\.categoryTile\(/);
  assert.doesNotMatch(main, /homeView\?\.(?:render|renderGateways|categoryTile|wire)|if \(homeView\)/);
  assert.doesNotMatch(source, /(?:main|storage)\.js|views\/(?:issue|library|progress)\.js/);
});
