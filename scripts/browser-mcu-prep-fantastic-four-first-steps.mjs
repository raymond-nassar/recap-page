import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addIssuesToList, createEmptyState, createList } from '../src/js/lib/model.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT } from '../src/js/lib/listHistory.js';
import { parseRoute } from '../src/js/lib/route.js';

const input = JSON.parse(readFileSync(new URL(
  '../test/fixtures/mcu-prep-fantastic-four-first-steps-vector.json', import.meta.url,
), 'utf8'));
const { id, sourceUrl, groups, rows: expected, sharedOriginal } = input;
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const payload = JSON.parse(readFileSync(new URL('../src/data/mcu_prep_fantastic_four_first_steps.json', import.meta.url), 'utf8'));
assert.equal(expected.length, 28);
assert.equal(groups.length, 5);
assert.deepEqual(payload.items.map((row, index) => ({
  position: index + 1, issueId: row.issueId, title: row.title, group: row.collectedIn,
})), expected);
const screenNames = catalog.lists.filter((entry) => entry.type === 'screen-companion')
  .map((entry) => entry.name);
let seed = createList(createEmptyState(), { id: 'existing-anthology', name: 'Existing anthology reading' });
seed = addIssuesToList(seed, 'existing-anthology', [{
  ...payload.items.at(-1), collectedIn: 'Existing anthology collection',
}]).state;
seed = {
  ...seed,
  read: { [sharedOriginal.issueId]: sharedOriginal.readTimestamp },
  notes: { [sharedOriginal.issueId]: sharedOriginal.note },
  overrides: { [sharedOriginal.issueId]: 'unavailable' },
};
const history = JSON.stringify({
  format: LIST_HISTORY_FORMAT,
  version: 1,
  records: [{
    listId: 'existing-anthology',
    created: seed.lists['existing-anthology'].created,
    catalogId: null,
    completedAt: 123457,
    rating: 'up',
  }],
});

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
  return page.evaluate((catalogId, historyKey) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const matches = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = matches[0];
    return {
      matches: matches.length,
      listCount: state.listOrder.length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId]?.title,
        group: list.collectedIn[issueId] ?? null,
      })),
      sharedRead: state.read[49846],
      sharedNote: state.notes[49846],
      sharedOverride: state.overrides[49846],
      history: localStorage.getItem(historyKey),
      priorCollection: state.lists['existing-anthology'].collectedIn[49846],
      globalOriginalCount: Object.keys(state.issues).filter((key) => key === '49846').length,
      globalIssueHasCollection: Object.hasOwn(state.issues[49846], 'collectedIn'),
    };
  }, id, LIST_HISTORY_KEY);
}

function checkSharedOriginal(t, label, snapshot) {
  t.check(label,
    snapshot.sharedRead === sharedOriginal.readTimestamp
    && snapshot.sharedNote === sharedOriginal.note
    && snapshot.sharedOverride === 'unavailable'
    && snapshot.history === history
    && snapshot.priorCollection === 'Existing anthology collection'
    && snapshot.globalOriginalCount === 1 && !snapshot.globalIssueHasCollection,
    JSON.stringify(snapshot));
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

export const firstStepsActualData = {
  id: 'fantastic-four-first-steps-actual-data',
  title: 'First Steps exact 28 originals, five source groups and shared anthology compatibility',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) externalRequests.push(request.url());
    });
    await page.evaluateOnNewDocument((existing, historyKey, historyText) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!localStorage.getItem('mrt.state.v2')) localStorage.setItem('mrt.state.v2', JSON.stringify(existing));
      if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, historyText);
      window.__mrtBlockExternal = true;
    }, seed, LIST_HISTORY_KEY, history);
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
      activeListId: JSON.parse(localStorage.getItem('mrt.state.v2')).active,
      count: document.querySelector('#marvel-on-screen-count')?.textContent.trim(),
      names: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card-title')]
        .map((node) => node.textContent.trim()),
      matches: document.querySelectorAll(selector).length,
      retired: document.querySelectorAll('[data-story="list:spider-man-no-way-home-owner-selected"]').length,
    }), cardSelector);
    const screenRoute = parseRoute(screen.hash);
    t.check('MCU Prep preserves every current independent card and First Steps exactly once',
      screenRoute?.view === 'marvel-on-screen' && screenRoute.listId === screen.activeListId
      && screen.matches === 1 && screen.retired === 0
      && screen.count === `${screenNames.length} Reading Lists`
      && JSON.stringify(screen.names) === JSON.stringify(screenNames), JSON.stringify(screen));
    for (const width of [600, 390]) {
      await resize(page, width, width === 390 ? 844 : 900);
      const layout = await overflow(page);
      const names = await page.$$eval('#marvel-on-screen-results .catalog-card-title',
        (nodes) => nodes.map((node) => node.textContent.trim()));
      t.check(`MCU Prep keeps every independent choice without horizontal overflow at ${width}px`,
        JSON.stringify(names) === JSON.stringify(screenNames) && layout.scrollWidth <= layout.viewport,
        JSON.stringify({ ...layout, cards: names.length }));
    }
    await resize(page, 1280);
    await page.goto(`${page.__origin}/?catalog=actual#/lines`, { waitUntil: 'load' });
    const storylineCard = `#lines-results [data-story="list:${id}"]`;
    await page.waitForSelector(storylineCard);
    t.check('Storylines has exactly one independent First Steps card',
      await page.$$eval(storylineCard, (nodes) => nodes.length) === 1);
    await page.$eval('.ri[data-view="browse"]', (node) => node.click());
    await page.waitForSelector('#view-browse [data-category="marvel-on-screen"]');
    await page.$eval('#view-browse [data-category="marvel-on-screen"]', (node) => node.click());
    await page.waitForSelector(cardSelector);
    const card = await page.$eval(cardSelector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="/issues/701"]')?.href,
      path: Boolean(node.querySelector('.result-path')),
    }));
    t.check('Browse discovers the owner-attributed 28-original companion without a reading path',
      card.name === payload.name && card.text.includes('28 issues') && card.source === sourceUrl
      && !card.path, JSON.stringify(card));
    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 28);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview binds every position to the exact original and guide-owned collection', preview.rows);
    t.check('Preview retains five groups and scopes the whole Point One qualification to New Dawn',
      JSON.stringify(preview.headings) === JSON.stringify(groups), JSON.stringify(preview.headings));
    for (const width of [600, 390]) {
      await resize(page, width, width === 390 ? 844 : 900);
      const layout = await overflow(page);
      const narrowPreview = await renderedRows(page, 'preview');
      checkVector(t, `Preview preserves the exact vector at ${width}px`, narrowPreview.rows);
      t.check(`Preview retains five headings without horizontal overflow at ${width}px`,
        JSON.stringify(narrowPreview.headings) === JSON.stringify(groups)
        && layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
    }
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await savedRows(page);
    t.check('import adds one catalog-bound companion without replacing the existing anthology list',
      imported.matches === 1 && imported.listCount === 2, JSON.stringify(imported));
    checkVector(t, 'import saves the complete ordered original/collection vector', imported.rows);
    checkSharedOriginal(t, 'import preserves shared read, note, override and private completion history', imported);
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === 'MCU Prep: The Fantastic Four: First Steps');
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 28);
    const reading = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List retains all 28 exact originals in delegated source order', reading.rows);
    t.check('Reading List retains all five guide-specific collection headings',
      JSON.stringify(reading.headings) === JSON.stringify(groups), JSON.stringify(reading.headings));
    for (const width of [1280, 600, 390]) {
      await resize(page, width, width === 390 ? 844 : 900);
      const layout = await overflow(page);
      checkVector(t, `Reading List preserves the exact vector at ${width}px`,
        (await renderedRows(page, 'reading')).rows);
      t.check(`Reading List has no horizontal overflow at ${width}px`,
        layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
      document.querySelector('#order-name')?.textContent.trim() === 'MCU Prep: The Fantastic Four: First Steps');
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 28);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload preserves the entire independent original/collection vector', reloaded.rows);
    const persisted = await savedRows(page);
    checkVector(t, 'reload retains the saved ordered originals and guide-owned labels', persisted.rows);
    checkSharedOriginal(t, 'reload preserves shared progress, personal note, override, enjoyment and prior label', persisted);
    t.check('actual-data journey makes no external request and reports no browser error',
      externalRequests.length === 0 && errors.length === 0, JSON.stringify({ externalRequests, errors }));
  },
};
