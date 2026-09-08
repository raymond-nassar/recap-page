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
  'menu', 'books', 'search', 'add', 'settings', 'info',
  'check', 'progress', 'edit', 'search', 'books', 'person', 'paste', 'issue-add',
  'search', 'books', 'person', 'characters', 'guide', 'paste', 'issue-add', 'search', 'search',
];

test('all navigation/search glyphs use the selected local symbols, not font characters', () => {
  const icons = [...html.matchAll(/<svg class="gi"([^>]*)>(.*?)<\/svg>/g)];
  assert.equal(icons.length, 23);
  assert.deepEqual(icons.map(([, , content]) => {
    const match = /^<use href="\.\/icons\/ui\.svg#([\w-]+)"\/>$/.exec(content);
    assert.ok(match, 'each icon contains only a local symbol reference');
    return match[1];
  }), expected);
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
  assert.deepEqual(ids.sort(), [...new Set([...expected, 'storylines', 'screen', 'arrow-right'])].sort());
  assert.equal(ids.length, 17);
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
