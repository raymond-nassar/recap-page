import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote,
} from '../src/js/lib/model.js';
import { parseRoute } from '../src/js/lib/route.js';

const id = 'mcu-prep-deadpool-and-wolverine';
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const source = readJson('./data/owner-mcu-prep-deadpool-and-wolverine-source.json');
const catalog = readJson('../src/data/catalog.json');
const card = catalog.lists.find((entry) => entry.id === id);
const payload = readJson(`../src/data/${card.file}`);
const houseCard = catalog.lists.find((entry) => entry.id === 'house-of-m');
const house = readJson(`../src/data/${houseCard.file}`);
const expected = source.selections.flatMap((selection) => selection.contents.flatMap((range) => (
  range.issueIds.map((issueId) => ({
    issueId,
    title: payload.items.find((item) => item.issueId === issueId).title,
    section: selection.collectionTitle,
  }))
)));
const expectedTitles = catalog.lists.filter((entry) => entry.type === 'screen-companion')
  .map((entry) => entry.name);
const expectedGroups = source.selections.map((selection) => selection.collectionTitle);
const existingId = 'existing-house-of-m';
const readAt = Date.UTC(2026, 9, 3);
let baseline = createList(createEmptyState(), {
  id: existingId, name: house.name, catalogId: houseCard.id, note: 'Keep the existing list note',
});
baseline = addIssuesToList(baseline, existingId, house.items.map((item) => ({ ...item, source: 'curated' }))).state;
baseline = markRead(baseline, house.items[0].issueId, true, readAt);
baseline = setIssueNote(baseline, house.items[1].issueId, 'Keep the existing issue note');
baseline = setDeferred(baseline, existingId, house.items[2].issueId);
baseline = { ...baseline, overrides: { [house.items[1].issueId]: 'unavailable' } };

assert.equal(house.items.length, 20);
assert.equal(expected.length, 43);
assert.equal(expectedGroups.length, 5);
assert.equal(expectedTitles.length, 8);
assert.deepEqual(payload.items.map((item) => item.issueId), expected.map((item) => item.issueId));
assert.deepEqual(expectedTitles.slice(-2), ['MCU Prep: Thunderbolts*', 'MCU Prep: Deadpool & Wolverine']);

async function click(page, selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (node) => node.click());
}

async function renderedRows(page, preview) {
  return page.$$eval(preview ? '#preview-body .preview-list > li' : '#rows > li', (nodes, isPreview) => {
    let section = null;
    const rows = [];
    const groups = [];
    for (const node of nodes) {
      const heading = node.querySelector(isPreview ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        section = heading.textContent.trim();
        groups.push(section);
      } else {
        const issue = node.querySelector(isPreview ? '.preview-issue-link' : '.rt');
        if (issue) rows.push({ issueId: Number(issue.dataset.issueId), title: issue.textContent.trim(), section });
      }
    }
    return { rows, groups };
  }, preview);
}

async function stored(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const matches = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = matches[0];
    return {
      state,
      matches: matches.length,
      rows: (list?.itemIds ?? []).map((issueId) => ({
        issueId, title: state.issues[issueId].title, section: list.collectedIn[issueId] ?? null,
      })),
    };
  }, id);
}

export const deadpoolWolverineActualData = {
  id: 'mcu-prep-deadpool-and-wolverine',
  title: 'the owner-selected companion preserves all 43 originals across Home, Browse, import and reload',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) externalRequests.push(request.url());
    });
    await page.evaluateOnNewDocument((initial) => {
      if (!localStorage.getItem('mrt.state.v2')) localStorage.setItem('mrt.state.v2', JSON.stringify(initial));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    }, baseline);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const label = `${viewport.width}x${viewport.height}`;
      await page.setViewport(viewport);
      await click(page, '.brand[data-view="home"]');
      const homeGateway = '#view-home [data-category="marvel-on-screen"]';
      await page.waitForSelector(homeGateway, { visible: true });
      t.check(`${label} Home exposes MCU Prep with all eight companions`,
        await page.$eval(homeGateway, (node) => node.textContent.includes('8 Reading Lists')));
      await click(page, homeGateway);
      await page.waitForSelector('#marvel-on-screen-results .catalog-card');
      const homeTitles = await page.$$eval('#marvel-on-screen-results .catalog-card-title',
        (nodes) => nodes.map((node) => node.textContent.trim()));
      t.check(`${label} Home reaches every MCU card once in manifest order`,
        JSON.stringify(homeTitles) === JSON.stringify(expectedTitles), JSON.stringify(homeTitles));

      await click(page, '.ri[data-view="browse"]');
      const browseGateway = '#view-browse [data-category="marvel-on-screen"]';
      await page.waitForSelector(browseGateway, { visible: true });
      t.check(`${label} Browse exposes the same eight-companion gateway`,
        await page.$eval(browseGateway, (node) => node.textContent.includes('8 Reading Lists')));
      await click(page, browseGateway);
      const selector = `#marvel-on-screen-results [data-story="list:${id}"]`;
      await page.waitForSelector(selector);
      const facts = await page.evaluate((target) => ({
        hash: location.hash,
        activeListId: JSON.parse(localStorage.getItem('mrt.state.v2')).active,
        count: document.querySelectorAll(target).length,
        titles: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card-title')]
          .map((node) => node.textContent.trim()),
        columns: new Set([...document.querySelectorAll('#marvel-on-screen-results .catalog-card')]
          .map((node) => Math.round(node.getBoundingClientRect().left))).size,
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        source: document.querySelector(`${target} a[href*="issues/680"]`)?.href,
        addLabel: document.querySelector(`${target} [data-act="import"]`)?.getAttribute('aria-label') ?? null,
      }), selector);
      const route = parseRoute(facts.hash);
      t.check(`${label} Browse reaches the exact owner card once on the generated route`,
        route?.view === 'marvel-on-screen' && route.listId === facts.activeListId && facts.count === 1
          && JSON.stringify(facts.titles) === JSON.stringify(expectedTitles),
        JSON.stringify(facts));
      t.check(`${label} the card links the owner intake, not a CBH guide`,
        facts.source === source.sourceUrl, JSON.stringify(facts));
      t.check(`${label} cards do not overflow and narrow cards use one column`,
        facts.scrollWidth <= facts.viewport && (viewport.width !== 390 || facts.columns === 1),
        JSON.stringify(facts));
      if (viewport.width === 1280) {
        t.check('the first import action names the full owner-authored title',
          facts.addLabel === `Add to library: ${payload.name}`, JSON.stringify(facts));
      }
      await click(page, `${selector} [data-act="preview"]`);
      await page.waitForFunction(() => document.querySelectorAll('#preview[open] .preview-issue-link').length === 43);
      const preview = await renderedRows(page, true);
      t.check(`${label} Preview preserves every original ID, title and collection`,
        JSON.stringify(preview.rows) === JSON.stringify(expected), JSON.stringify(preview.rows));
      t.check(`${label} Preview preserves the five source-selection headings`,
        JSON.stringify(preview.groups) === JSON.stringify(expectedGroups), JSON.stringify(preview.groups));
      t.check(`${label} Preview credits the owner's selection`,
        await page.$eval('#preview', (node, credit) => node.textContent.includes(credit), payload.sourceOrigin));
      if ((await stored(page)).matches === 0) {
        await click(page, '#preview-add [data-act="main"]');
        await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
          ?.textContent.includes('In library'));
      }
      const imported = await stored(page);
      t.check(`${label} import or reopening retains one exact guide and the existing library`,
        imported.matches === 1 && imported.state.listOrder.length === 2
          && JSON.stringify(imported.rows) === JSON.stringify(expected),
        JSON.stringify({ matches: imported.matches, lists: imported.state.listOrder.length }));
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === title, {}, payload.name);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 43);
      const reading = await renderedRows(page, false);
      t.check(`${label} the Reading List keeps all 43 originals in collection order`,
        JSON.stringify(reading.rows) === JSON.stringify(expected)
          && JSON.stringify(reading.groups) === JSON.stringify(expectedGroups),
        JSON.stringify(reading));
      await page.evaluate(() => {
        window.__dispatching = true;
        document.querySelector('#btn-hero-read').click();
        document.querySelector('#btn-hero-read').click();
        window.__dispatching = false;
      });
      const opened = await page.evaluate(() => window.__opened);
      const readerIssue = payload.items[viewport.width === 1280 ? 0 : 1];
      t.check(`${label} each Read action opens a separate launcher synchronously`,
        opened.length === 2 && opened.every((entry) => entry.dispatching
          && entry.target === '_blank' && entry.features === 'noopener'
          && new URL(entry.url).origin === page.__origin
          && new URL(entry.url).searchParams.get('d') === String(readerIssue.digitalId)),
        JSON.stringify(opened));
      if (viewport.width === 1280) {
        await click(page, '#rows [data-act="read"][data-key="10155"]');
        await page.waitForFunction(() => Object.hasOwn(JSON.parse(localStorage.getItem('mrt.state.v2')).read, 10155));
      }
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction((title) => document.querySelector('#order-name')?.textContent.trim() === title,
        {}, payload.name);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 43);
      const reloaded = await stored(page);
      t.check(`${label} reload preserves one guide, its vector and its new read mark`,
        reloaded.matches === 1 && JSON.stringify(reloaded.rows) === JSON.stringify(expected)
          && Number.isFinite(reloaded.state.read[10155]));
      t.check(`${label} existing progress, issue note and availability override remain unchanged`,
        reloaded.state.read[house.items[0].issueId] === readAt
          && JSON.stringify(reloaded.state.notes) === JSON.stringify(baseline.notes)
          && JSON.stringify(reloaded.state.overrides) === JSON.stringify(baseline.overrides));
      t.check(`${label} the existing list, note, edition labels and deferred issue are untouched`,
        isDeepStrictEqual(reloaded.state.lists[existingId], baseline.lists[existingId]));
    }
    t.check('the companion journey makes no external request and raises no browser error',
      errors.length === 0 && externalRequests.length === 0,
      JSON.stringify({ errors, externalRequests }));
  },
};
