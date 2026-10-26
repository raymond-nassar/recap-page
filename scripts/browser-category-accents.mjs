// #875: every Marvel era tile wears its own accent, and no category tile's wash reaches far enough under
// its text to take it below 4.5:1. Runs on the ephemeral port like every scenario not listed for the
// app origin.
import { readFileSync } from 'node:fs';

import { ERA_TILES } from './check-palette.mjs';
import { TILE_PARTS, tileContrast } from './lib/painted-contrast.mjs';
import { PUBLISHING_CATEGORIES, isPublishingCategoryLeaf } from '../src/js/lib/catalog.js';
import { formatRoute } from '../src/js/lib/route.js';

const bundled = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
// The bundled catalog has no Golden Age Reading List yet, so one fixture entry stands in for it. That
// puts all eleven era tiles and all six Home categories on screen at once.
const CATALOG = {
  ...bundled,
  lists: [...bundled.lists, {
    id: 'golden-age-fixture', file: 'golden-age-fixture.json', name: 'Golden Age Fixture', count: 3,
    placeholderCount: 0, emptyRecordCount: 0, type: 'event', depth: 'complete', timeline: 1941,
  }],
};
const ERAS = PUBLISHING_CATEGORIES.filter(isPublishingCategoryLeaf);
const ERA_SELECTOR = '.marvel-ages-group .home-path';
const VIEWS = [
  ['home', '#view-home .home-path'],
  ['browse', '#view-browse .home-path'],
  ['marvel-ages', ERA_SELECTOR],
  ['age-modern', '#age-modern-category-list .home-path'],
];

async function open(page, { width = 1280, root = 100, forced = false } = {}) {
  if (!page.__categoryAccents) {
    page.__categoryAccents = await page.createCDPSession();
    await page.evaluateOnNewDocument((catalog) => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.endsWith('/data/catalog.json')) return real(input, init);
        return Promise.resolve(new Response(JSON.stringify(catalog), { headers: { 'content-type': 'application/json' } }));
      };
    }, CATALOG);
  }
  // Hover lifts a tile through a transition, which reduced motion settles at once.
  await page.__categoryAccents.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'forced-colors', value: forced ? 'active' : 'none' },
  ] });
  await page.setViewport({ width, height: 900 });
  // From a blank page, so the app always loads afresh: moving to #/home from another of its routes
  // is a navigation within the document, which would keep the root size and theme set before it.
  await page.goto('about:blank');
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'networkidle0' });
  await page.evaluate((size) => { document.documentElement.style.fontSize = size === 100 ? '' : `${size}%`; }, root);
}

async function show(page, view, selector) {
  await page.evaluate((name) => { location.hash = `#/${name}`; }, view);
  await page.waitForFunction((tiles) => {
    const found = [...document.querySelectorAll(tiles)];
    return found.length > 0 && found.every((tile) => tile.getClientRects().length > 0);
  }, { timeout: 15000 }, selector);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

const theme = (page, name) => page.evaluate((value) => { document.documentElement.dataset.theme = value; }, name);

async function point(page, selector) {
  const centre = await page.$eval(selector, (node) => {
    node.scrollIntoView({ block: 'center' });
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.mouse.move(centre.x, centre.y);
}

// What each era tile paints, beside what its own era's channel resolves to in the current theme.
function painted(page, selector, hover = false) {
  return page.$$eval(selector, (tiles, eras, pointed) => tiles.map((tile) => {
    const token = eras.find(([key]) => key === tile.dataset.category)?.[2];
    const channel = token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : '';
    const rgb = channel.split(/\s+/).join(', ');
    const style = getComputedStyle(tile);
    return {
      key: tile.dataset.category,
      edge: getComputedStyle(tile, '::before').backgroundColor,
      icon: getComputedStyle(tile.querySelector('.home-path-icon')).color,
      tint: style.backgroundImage.match(/rgba?\([^)]*\)/)?.[0] ?? style.backgroundImage,
      border: style.borderTopColor,
      expected: channel ? {
        edge: `rgb(${rgb})`,
        tint: `rgba(${rgb}, ${pointed ? 0.19 : 0.13})`,
        border: pointed ? `rgba(${rgb}, 0.68)` : null,
      } : null,
    };
  }), ERA_TILES, hover);
}

export const eraAccents = {
  id: 'era-accents',
  title: 'every Marvel era tile wears its own accent as edge, tint and icon, in every theme',
  async run(page, t) {
    for (const width of [1280, 390]) {
      await open(page, { width });
      await show(page, 'marvel-ages', ERA_SELECTOR);
      const tiles = await page.$$eval(ERA_SELECTOR, (nodes) => nodes.map((node) => ({
        key: node.dataset.category,
        list: node.closest('ul')?.id,
        title: node.querySelector('.home-path-title')?.textContent,
        href: node.getAttribute('href'),
      })));
      t.check(`${width}px: the eleven era tiles keep their order, lists, names and links`,
        JSON.stringify(tiles) === JSON.stringify(ERAS.map(({ key, parent, heading, route }) => ({
          key,
          list: parent === null ? 'marvel-ages-earlier-list' : 'marvel-ages-modern-list',
          title: heading,
          href: formatRoute({ view: route }),
        }))), JSON.stringify(tiles));
      for (const name of ['dark', 'light']) {
        await theme(page, name);
        const rest = await painted(page, ERA_SELECTOR);
        t.check(`${width}px ${name}: each era tile draws its edge, tint and icon from its own era's channel`,
          rest.length === ERAS.length && rest.every(({ edge, icon, tint, expected }) => expected
            && edge === expected.edge && icon === expected.edge && tint === expected.tint),
          JSON.stringify(rest));
        t.check(`${width}px ${name}: the eleven era tiles show eleven different accents`,
          new Set(rest.map(({ edge }) => edge)).size === ERAS.length, JSON.stringify(rest.map(({ key, edge }) => [key, edge])));
        const pointed = [];
        for (const { key } of rest) {
          const tile = `${ERA_SELECTOR}[data-category="${key}"]`;
          await point(page, tile);
          pointed.push({ ...(await painted(page, tile, true))[0], pointed: await page.$eval(tile, (node) => node.matches(':hover')) });
        }
        await page.mouse.move(0, 0);
        t.check(`${width}px ${name}: pointing at an era tile deepens its own tint and borders it in its own accent`,
          pointed.every(({ tint, border, expected, pointed: hovered }) => hovered && expected
            && tint === expected.tint && border === expected.border),
          JSON.stringify(pointed));
        const icons = await tileContrast(page, ERA_SELECTOR, { hover: true, parts: TILE_PARTS.filter(([part]) => part === 'icon') });
        const low = icons.filter((row) => row.ratio < row.floor || !row.pointed);
        t.check(`${width}px ${name}: every era icon clears 3:1 against the painted wash it sits on, pointed at`,
          icons.length === ERAS.length && low.length === 0,
          JSON.stringify(icons.map(({ key, ratio, background, pointed: hovered }) => [key, Number(ratio.toFixed(2)), background, hovered])));
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      t.check(`${width}px: Marvel Ages does not scroll sideways`, !overflow);
    }

    await open(page, { width: 1280 });
    await show(page, 'age-modern', '#age-modern-category-list .home-path');
    for (const name of ['dark', 'light']) {
      await theme(page, name);
      const modern = await painted(page, '#age-modern-category-list .home-path');
      t.check(`${name}: Modern Age draws each period in the accent it wears on Marvel Ages`,
        modern.length === ERAS.filter(({ parent }) => parent === 'modern').length
        && modern.every(({ edge, icon, tint, expected }) => expected && edge === expected.edge && icon === expected.edge
          && tint === expected.tint), JSON.stringify(modern));
    }

    await open(page, { width: 1280, forced: true });
    await show(page, 'marvel-ages', ERA_SELECTOR);
    const forced = await painted(page, ERA_SELECTOR);
    t.check('forced colors give every era tile one system color for its edge and one for its icon, with no tint',
      forced.length === ERAS.length && new Set(forced.map(({ edge }) => edge)).size === 1
      && new Set(forced.map(({ icon }) => icon)).size === 1
      && forced.every(({ tint }) => tint.split(',').every((layer) => layer.trim() === 'none')),
      JSON.stringify(forced.map(({ key, edge, icon, tint }) => ({ key, edge, icon, tint }))));
    await open(page, { width: 1280 });
  },
};

// Hover is the wash at its strongest, deepest and furthest reaching, so a line that clears 4.5:1 there
// clears it at rest. 620px is the widest a tile gets in the single column, where the wash's diagonal
// is longest, and before #875 capped the wash it took the count on five of Home's six cards below the
// floor in the dark theme.
export const categoryWashContrast = {
  id: 'category-wash-contrast',
  title: 'no category tile\'s hover wash takes its eyebrow or count below 4.5:1',
  async run(page, t) {
    const text = TILE_PARTS.filter(([part]) => part !== 'icon');
    for (const [width, root] of [[1280, 100], [760, 100], [620, 100], [390, 100], [1280, 200], [760, 200], [390, 200]]) {
      await open(page, { width, root });
      for (const [view, selector] of VIEWS) {
        await show(page, view, selector);
        for (const name of ['dark', 'light']) {
          await theme(page, name);
          const rows = await tileContrast(page, selector, { hover: true, parts: text });
          const low = rows.filter((row) => row.ratio < row.floor || !row.pointed);
          t.check(`${view} ${name} ${width}px at ${root}% text: every eyebrow and count clears 4.5:1 on the hover wash`,
            rows.length > 0 && low.length === 0,
            JSON.stringify(low.map(({ key, part, ratio, background, pointed }) => [key, part, Number(ratio.toFixed(2)), background, pointed])));
        }
      }
    }
    await open(page, { width: 1280 });
  },
};

// Each script is handed to the page as source text, so it carries its rules inside it: a closure over a
// variable here would arrive in the page without that variable. It also runs on the blank page every
// scenario here opens from, which has no stylesheet to change.
export const categoryAccentMutations = [
  {
    id: 'era-accents-shared', breaks: 'era-accents',
    why: 'every era tile falls back to the one purple accent all of them used to share',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('styles.css'));
        if (!sheet) return;
        sheet.insertRule('.marvel-ages-group .home-path, #age-modern-category-list .home-path { --home-path-line: var(--accent-line) !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'era-metals-swapped', breaks: 'era-accents',
    why: 'the Golden Age and Silver Age tiles wear each other\'s metal',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('styles.css'));
        if (!sheet) return;
        sheet.insertRule('.home-path[data-category="golden"] { --home-path-line: var(--silver-line) !important; }', sheet.cssRules.length);
        sheet.insertRule('.home-path[data-category="silver"] { --home-path-line: var(--gold-line) !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'category-wash-uncapped', breaks: 'category-wash-contrast',
    why: 'the wash fades over a share of each tile\'s diagonal again, so on a wide tile it reaches the count',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('styles.css'));
        if (!sheet) return;
        sheet.insertRule('.home-path { background: linear-gradient(145deg, rgb(var(--home-path-line) / 13%), transparent 62%), var(--card); }', sheet.cssRules.length);
        sheet.insertRule('.home-path:hover { background: linear-gradient(145deg, rgb(var(--home-path-line) / 19%), transparent 68%), var(--card-2); }', sheet.cssRules.length);
      });
    },
  },
];
