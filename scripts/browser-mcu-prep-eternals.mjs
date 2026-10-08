import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const id = 'mcu-prep-eternals';
const sourceUrl = 'https://github.com/raymond-nassar/recap-page/issues/684';
const selections = [
  {
    year: 1976,
    group: 'Eternals by Jack Kirby Vol. 1',
    ids: [8799, 8810, 8811, 8812, 8813, 8814, 8815, 8816, 8817, 8800, 8801],
  },
  {
    year: 2006,
    group: 'Eternals by Neil Gaiman and John Romita Jr.',
    ids: [4311, 4466, 4785, 5073, 5226, 5523, 5894],
  },
  {
    year: 2021,
    group: 'Eternals Vol. 1: Only Death Is Eternal',
    ids: [85560, 85561, 85562, 85563, 85564, 85565],
  },
];
let position = 0;
const expected = selections.flatMap(({ year, group, ids }) => ids.map((issueId, index) => ({
  position: ++position, issueId, title: `Eternals (${year}) #${index + 1}`, group,
})));
const groups = selections.map((selection) => selection.group);
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const payload = JSON.parse(readFileSync(new URL('../src/data/mcu_prep_eternals.json', import.meta.url), 'utf8'));
assert.deepEqual(payload.items.map((row) => row.issueId), expected.map((row) => row.issueId));
const screenNames = catalog.lists.filter((entry) => entry.type === 'screen-companion')
  .map((entry) => entry.name);

function checkVector(t, label, rows) {
  t.check(label, JSON.stringify(rows) === JSON.stringify(expected),
    JSON.stringify({ count: rows.length, firstMismatch: rows.find((row, index) =>
      JSON.stringify(row) !== JSON.stringify(expected[index])) }));
}

async function renderedRows(page, view) {
  return page.$$eval(view === 'preview' ? '#preview-body .preview-list > li' : '#rows > li', (nodes, kind) => {
    let group = null;
    const rows = [];
    const headings = [];
    for (const node of nodes) {
      const heading = node.querySelector(kind === 'preview' ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        group = heading.textContent.trim();
        headings.push(group);
        continue;
      }
      const issue = node.querySelector(kind === 'preview' ? '.preview-issue-link' : '.rt');
      if (!issue) continue;
      rows.push({
        position: kind === 'preview' ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
        issueId: Number(issue.dataset.issueId), title: issue.textContent.trim(), group,
      });
    }
    return { rows, headings };
  }, view);
}

async function savedRows(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = lists[0];
    return {
      matches: lists.length,
      listCount: state.listOrder.length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId]?.title,
        group: list.collectedIn[issueId] ?? null,
      })),
    };
  }, id);
}

async function resize(page, width, height = 900) {
  await page.setViewport({ width, height });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function overflow(page) {
  return page.evaluate(() => ({
    viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
  }));
}

export const eternalsActualData = {
  id: 'eternals-actual-data',
  title: 'owner-selected Eternals discovery, all 24 originals, three volumes and reload',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) externalRequests.push(request.url());
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });
    await resize(page, 1280);
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#home-primary-paths .home-path');
    await page.$eval('#home-more-paths', (node) => { node.open = true; });
    const homeSelector = '#view-home [data-category="marvel-on-screen"]';
    const home = await page.$$eval(homeSelector, (nodes) => ({
      count: nodes.length, text: nodes[0]?.textContent.replace(/\s+/g, ' ').trim(),
    }));
    t.check('Home exposes one populated MCU Prep gateway',
      home.count === 1 && home.text.includes('MCU Prep'), JSON.stringify(home));
    await page.$eval(homeSelector, (node) => node.click());
    await page.waitForSelector('#marvel-on-screen-results .catalog-card');
    const cardSelector = `#marvel-on-screen-results [data-story="list:${id}"]`;
    const screen = await page.evaluate((selector) => ({
      hash: location.hash,
      count: document.querySelector('#marvel-on-screen-count')?.textContent.trim(),
      names: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card-title')]
        .map((node) => node.textContent.trim()),
      matches: document.querySelectorAll(selector).length,
    }), cardSelector);
    t.check('Home reaches all MCU Prep cards, including Eternals exactly once',
      screen.hash === '#/marvel-on-screen'
      && screen.count === `${screenNames.length} Reading Lists`
      && JSON.stringify([...screen.names].sort()) === JSON.stringify([...screenNames].sort())
      && screen.matches === 1, JSON.stringify(screen));

    for (const width of [600, 390]) {
      await resize(page, width, width === 390 ? 844 : 900);
      const layout = await overflow(page);
      const names = await page.$$eval('#marvel-on-screen-results .catalog-card-title',
        (nodes) => nodes.map((node) => node.textContent.trim()));
      t.check(`MCU Prep retains every card without horizontal overflow at ${width}px`,
        JSON.stringify([...names].sort()) === JSON.stringify([...screenNames].sort()) && layout.scrollWidth <= layout.viewport,
        JSON.stringify({ ...layout, cards: names.length }));
    }
    await resize(page, 1280);
    await page.$eval('.ri[data-view="browse"]', (node) => node.click());
    await page.waitForSelector('#view-browse [data-category="marvel-on-screen"]');
    const browse = await page.$$eval('#view-browse [data-category="marvel-on-screen"]',
      (nodes) => nodes.length);
    t.check('Browse exposes the same single MCU Prep gateway', browse === 1, String(browse));
    await page.$eval('#view-browse [data-category="marvel-on-screen"]', (node) => node.click());
    await page.waitForSelector(cardSelector);
    const card = await page.$eval(cardSelector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="/issues/684"]')?.href,
      path: Boolean(node.querySelector('.result-path')),
    }));
    t.check('Browse discovers the owner-attributed 24-issue Eternals card without a reading path',
      card.name === 'Eternals' && card.text.includes('24 issues')
      && card.source === sourceUrl && !card.path, JSON.stringify(card));
    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 24);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview preserves the exact 24 originals, titles and collection order', preview.rows);
    t.check('Preview labels only the three verified first-volume/miniseries groups',
      JSON.stringify(preview.headings) === JSON.stringify(groups), JSON.stringify(preview.headings));
    await resize(page, 390, 844);
    const previewLayout = await overflow(page);
    t.check('the phone Preview retains all rows and headings without horizontal overflow',
      preview.rows.length === 24 && previewLayout.scrollWidth <= previewLayout.viewport,
      JSON.stringify(previewLayout));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await savedRows(page);
    t.check('import creates exactly one catalog-bound Eternals list',
      imported.matches === 1 && imported.listCount === 1, JSON.stringify(imported));
    checkVector(t, 'import saves every original and its verified collection label', imported.rows);
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === 'Eternals');
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 24);
    const reading = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List shows all 24 originals in owner selection order', reading.rows);
    t.check('Reading List retains the three collection headings',
      JSON.stringify(reading.headings) === JSON.stringify(groups), JSON.stringify(reading.headings));
    for (const width of [1280, 600, 390]) {
      await resize(page, width, width === 390 ? 844 : 900);
      const layout = await overflow(page);
      t.check(`Reading List has no horizontal overflow at ${width}px`,
        layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
      document.querySelector('#order-name')?.textContent.trim() === 'Eternals');
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 24);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload keeps the complete original identity, title and collection vector', reloaded.rows);
    t.check('reload retains the same three verified collection headings',
      JSON.stringify(reloaded.headings) === JSON.stringify(groups), JSON.stringify(reloaded.headings));
    const persisted = await savedRows(page);
    checkVector(t, 'reload persists every original without duplicates or substituted collections', persisted.rows);
    t.check('the actual-data journey makes no external request and raises no browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests, errors }));
  },
};

export const eternalsCollectionMutation = {
  id: 'eternals-kirby-group-lost',
  breaks: 'eternals-actual-data',
  why: 'the first volume loses its collection labels while retaining all 24 issue identities',
  script: () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = new URL(args[0]?.url ?? args[0], location.href);
      if (url.pathname === '/data/mcu_prep_eternals.json' && response.ok) {
        const data = await response.json();
        for (const row of data.items.slice(0, 11)) delete row.collectedIn;
        return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
      }
      return response;
    };
  },
};
