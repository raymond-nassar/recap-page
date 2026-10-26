import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiIcon } from '../src/js/lib/uiIcon.js';
import { createHomeView } from '../src/js/views/home.js';
import { HOME_CATEGORIES, PUBLISHING_CATEGORIES } from '../src/js/lib/catalog.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../src/index.html');
const css = read('../src/styles.css');
const sprite = read('../src/icons/ui.svg');
const expected = [
  'menu', 'books', 'search', 'settings', 'info',
  'check', 'progress', 'edit', 'star', 'search', 'series', 'creator', 'paste', 'issue-add',
  'search', 'series', 'creator', 'characters', 'timeline', 'paste', 'issue-add', 'search', 'search',
];

test('all navigation/search glyphs use the selected local symbols, not font characters', () => {
  const icons = [...html.matchAll(/<svg class="gi"([^>]*)>(.*?)<\/svg>/g)];
  const mobile = [...html.matchAll(/<a href="#\/(?:library|add)" class="mobile-link"[^>]*>[\s\S]*?<use href="\.\/icons\/ui\.svg#([\w-]+)"\/>/g)]
    .map(([, name]) => name);
  assert.deepEqual(mobile, ['books', 'search']);
  assert.equal(icons.length, 25);
  assert.deepEqual(icons.map(([, , content]) => {
    const match = /^<use href="\.\/icons\/ui\.svg#([\w-]+)"\/>$/.exec(content);
    assert.ok(match, 'each icon contains only a local symbol reference');
    return match[1];
  }), [expected[0], ...mobile, ...expected.slice(1)]);
  assert.doesNotMatch(html, /&#xE[0-9A-F]{3};/i);
  assert.doesNotMatch(css, /Segoe (?:Fluent Icons|MDL2 Assets)/);
  for (const [, attributes] of icons) {
    assert.match(attributes, /aria-hidden="true"/);
    assert.match(attributes, /focusable="false"/);
    assert.doesNotMatch(attributes, /tabindex|aria-label|role=/);
  }
});

test('the authored symbol set has exactly the used names and no remote or active content', () => {
  const ids = [...sprite.matchAll(/<symbol id="([\w-]+)" viewBox="0 0 24 24">/g)]
    .map(([, id]) => id);
  assert.deepEqual(ids.sort(), [...new Set([...expected, 'storylines', 'screen', 'ages', 'arrow-right', 'thumb-up', 'thumb-down', 'star'])].sort());
  assert.equal(ids.length, 21);
  assert.doesNotMatch(sprite, /<(?:script|image|foreignObject|style|text)\b|\bhref=|\bon\w+=/i);
  assert.doesNotMatch(sprite, /[\uE000-\uF8FF]/);
  assert.match(css, /\.gi \{\s*fill: none; stroke: currentColor;/);
  assert.match(css, /\.btn-icon \.gi \{ width: 1em; \}/);
});

test('generated icons use SVG namespaces and the same decorative local sprite contract', () => {
  const created = [];
  const icon = uiIcon('arrow-right', 'gi home-path-arrow', {
    createElementNS(namespace, tag) {
      const node = {
        namespace, tag, attributes: {}, children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        append(child) { this.children.push(child); },
      };
      created.push(node);
      return node;
    },
  });
  assert.deepEqual(created.map((node) => [node.namespace, node.tag]), [
    ['http://www.w3.org/2000/svg', 'svg'], ['http://www.w3.org/2000/svg', 'use'],
  ]);
  assert.deepEqual(icon.attributes, {
    class: 'gi home-path-arrow', 'aria-hidden': 'true', focusable: 'false',
  });
  assert.deepEqual(icon.children[0].attributes, { href: './icons/ui.svg#arrow-right' });
  const home = read('../src/js/views/home.js');
  assert.doesNotMatch(home, /String\.fromCodePoint/);
  assert.match(home, /createIcon\(CATEGORY_ICONS\[category\.icon\], 'gi home-path-icon'\)/);
  assert.match(home, /createIcon\('arrow-right', 'gi home-path-arrow'\)/);
  const names = [];
  const view = createHomeView({
    el: (tag, props, children) => ({ tag, props, children }),
    createIcon: (name) => { names.push(name); return { name }; },
  });
  for (const category of [...HOME_CATEGORIES, ...PUBLISHING_CATEGORIES]) {
    view.categoryTile({ ...category, count: 1 });
  }
  for (const name of names) {
    assert.ok(typeof name === 'string' && sprite.includes(`id="${name}"`),
      `every home and publishing category maps to an existing symbol: ${name}`);
  }
});

test('sprite provenance and source distribution preserve zero runtime dependencies', () => {
  const provenance = read('../src/icons/README.md');
  assert.match(provenance, /original generic line drawings/);
  assert.match(provenance, /\.\.\/\.\.\/LICENSE/);
  assert.deepEqual(JSON.parse(read('../package.json')).dependencies ?? {}, {});
  assert.match(read('../server.mjs'), /'\.svg': 'image\/svg\+xml'/);
  assert.match(read('../scripts/pack-windows.mjs'), /path\.startsWith\('src\/'\)/);
});

test('the six Home category cards draw six different symbols', () => {
  // #873: Modern Timeline and Marvel Ages both drew the open book, so two of the six looked alike.
  const names = [];
  const view = createHomeView({
    el: (tag, props, children) => ({ tag, props, children }),
    createIcon: (name, className) => {
      if (className.includes('home-path-icon')) names.push(name);
      return { name };
    },
  });
  for (const category of HOME_CATEGORIES) view.categoryTile({ ...category, count: 1 });
  assert.equal(names.length, 6);
  assert.equal(new Set(names).size, 6, JSON.stringify(names));
});

test('the provenance table lists exactly the symbols the sprite draws', () => {
  const rows = [...read('../src/icons/README.md').matchAll(/^\| ([a-z][\w-]*) \| [^|\n]+ \| [^|\n]+ \|$/gm)].map(([, name]) => name);
  const ids = [...sprite.matchAll(/<symbol id="([\w-]+)"/g)].map(([, id]) => id);
  assert.deepEqual(rows.sort(), ids.sort());
});

test('each glyph names one meaning wherever it is drawn, as the icons README records', () => {
  // #831: the magnifier labelled Browse, the books meant Library and two ways to find comics, and
  // Character spotlights drew a different figure on Home than on Search. Every use is read from the
  // source rather than listed here, so a control that borrows a glyph for something else fails.
  const uses = [];
  for (const match of html.matchAll(/<svg class="gi"[^>]*><use href="\.\/icons\/ui\.svg#([\w-]+)"\/><\/svg>/g)) {
    const before = html.slice(0, match.index);
    const owner = before.slice(Math.max(before.lastIndexOf('<a '), before.lastIndexOf('<button ')));
    assert.doesNotMatch(owner, /<\/(?:a|button)>/, `${match[1]} is drawn outside the control it marks`);
    uses.push({
      symbol: match[1],
      destination: /^<a [^>]*href="(#\/[\w-]+)"/.exec(owner)?.[1] ?? null,
      submit: /^<button type="submit"/.test(owner),
    });
  }
  let route = null;
  const view = createHomeView({
    el: (tag, props, children) => ({ tag, props, children }),
    createIcon: (name, className) => {
      if (className.includes('home-path-icon')) uses.push({ symbol: name, destination: `#/${route}`, submit: false });
      return { name };
    },
  });
  for (const category of [...HOME_CATEGORIES, ...PUBLISHING_CATEGORIES]) {
    route = category.route;
    view.categoryTile({ ...category, count: 1 });
  }

  const bySymbol = new Map();
  const byDestination = new Map();
  const add = (map, key, value) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(value);
  for (const { symbol, destination } of uses.filter((use) => use.destination)) {
    add(bySymbol, symbol, destination);
    add(byDestination, destination, symbol);
  }
  for (const [destination, symbols] of byDestination) {
    assert.equal(symbols.size, 1, `${destination} is drawn with ${[...symbols].join(' and ')}`);
  }
  // One meaning can reach more than one address: searching is Search and the page where an issue
  // title is typed, and Marvel Ages is its card and the ages inside it. Reading paths borrows the
  // Library's glyph until #897 retires the page.
  const ages = PUBLISHING_CATEGORIES.map((category) => `#/${category.route}`);
  const shared = {
    search: ['#/add', '#/add-search'],
    ages: ['#/marvel-ages', ...ages],
    books: ['#/library', '#/reading-paths'],
  };
  for (const [symbol, destinations] of bySymbol) {
    if (shared[symbol]) {
      assert.deepEqual([...destinations].filter((d) => !shared[symbol].includes(d)), [], `${symbol} is drawn for a second meaning`);
    } else {
      assert.equal(destinations.size, 1, `${symbol} is drawn for ${[...destinations].join(' and ')}`);
    }
  }
  for (const use of uses.filter(({ symbol }) => symbol === 'search')) {
    assert.ok(use.submit || shared.search.includes(use.destination), `the magnifier marks ${use.destination}`);
  }

  const table = new Map([...read('../src/icons/README.md').matchAll(/^\| ([a-z][\w-]*) \| [^|\n]+ \| ([^|\n]+) \|$/gm)]
    .map(([, symbol, where]) => [symbol, [...where.matchAll(/`(#\/[\w-]+)`/g)].map(([, d]) => d).sort()]));
  for (const symbol of new Set([...table.keys(), ...bySymbol.keys()])) {
    const drawn = [...(bySymbol.get(symbol) ?? [])].filter((d) => !ages.includes(d)).sort();
    assert.deepEqual(table.get(symbol) ?? [], drawn, `the icons README's ${symbol} row`);
  }
});
