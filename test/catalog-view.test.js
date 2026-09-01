import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCatalogView } from '../src/js/views/catalog.js';

function node(props = {}) {
  return {
    children: [],
    hidden: false,
    listeners: {},
    value: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...children) { this.children.push(...children); },
    querySelectorAll() { return []; },
    replaceChildren(...children) { this.children = children; },
    ...props,
  };
}

test('Catalog owns shelf narrowing and delegates presentation through its injected contract', async () => {
  const nodes = {
    clear: node(),
    filters: node(),
    query: node(),
    results: node(),
    search: node(),
  };
  const rendered = [];
  const view = createCatalogView({
    announce: () => {},
    clearLoadNotice: () => {},
    el: (_tag, props = {}) => node(props),
    elements: {
      shelf: () => nodes,
      spotlightKinds: () => [],
      spotlightSorts: () => [],
    },
    loadCatalog: async () => ({ dropped: 0, lists: [], paths: [] }),
    notifyDropped: () => {},
    onLoadFailure: () => {},
    onSortChange: () => {},
    presentation: {
      chosenPath: () => null,
      ensureSetupGuideFeature: () => {},
      renderTimelineSections: (...args) => rendered.push(args),
    },
  });

  view.wire('catalog');
  nodes.query.value = '  avengers  ';
  nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes.clear.hidden, false);
  assert.equal(nodes.results.children.length, 1);
  assert.equal(rendered.length, 0);
});

test('Catalog-family modules have constructed boundaries without concrete controller imports', () => {
  const main = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  for (const name of ['CatalogView', 'PreviewView', 'ReadingPathsView', 'CatalogPresentation']) {
    assert.equal((main.match(new RegExp(`create${name}\\(\\{`, 'g')) ?? []).length, 1);
  }
  for (const path of [
    '../src/js/views/catalog.js',
    '../src/js/views/preview.js',
    '../src/js/views/reading-paths.js',
    '../src/js/views/shared/catalog-presentation.js',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(?:main|storage|views\/(?:catalog|preview|reading-paths))\.js['"]/);
  }
});
