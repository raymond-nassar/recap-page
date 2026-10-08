import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote,
} from '../src/js/lib/model.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';
import { waitForSavedPreviewLink } from './browser-owner-guide.mjs';

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const fixture = readJson('../test/fixtures/mcu-prep-captain-america-brave-new-world-vector.json');
const payload = readJson('../src/data/mcu_prep_captain_america_brave_new_world.json');
const catalog = readJson('../src/data/catalog.json');
const hulkCard = catalog.lists.find((row) => row.id === 'question-of-the-week-do-you-have-a-hulk-reading-order');
const hulk = readJson(`../src/data/${hulkCard.file}`);
const houseCard = catalog.lists.find((row) => row.id === 'house-of-m');
const house = readJson(`../src/data/${houseCard.file}`);
const { id, name, description, sourceUrl, groups } = fixture;
const ownerCredit = 'Selected by raymond-nassar for MCU Prep';
const expected = fixture.rows.map(([position, issueId, title, group]) => ({
  position, issueId, title, group: groups[group],
}));
assert.equal(expected.length, 19);
assert.deepEqual(payload.items.map((row) => row.issueId), expected.map((row) => row.issueId));

let seed = createList(createEmptyState(), {
  id: 'brave-existing-hulk', name: hulk.name, catalogId: hulk.id,
  description: 'My saved Hulk description', note: 'Keep my prior list note',
});
seed = addIssuesToList(seed, 'brave-existing-hulk', hulk.items).state;
for (const item of hulk.items) seed = markRead(seed, item.issueId, true, 123456);
seed = setIssueNote(seed, 17623, 'Keep my Red Hulk issue note');
seed = createList(seed, { id: 'brave-existing-house', name: house.name, catalogId: house.id });
seed = addIssuesToList(seed, 'brave-existing-house', house.items).state;
seed = setDeferred(seed, 'brave-existing-house', house.items[2].issueId);
seed = { ...seed, overrides: { 17623: 'unavailable' } };
const historyText = JSON.stringify({
  format: LIST_HISTORY_FORMAT, version: 1,
  records: [{ listId: 'brave-existing-hulk', created: seed.lists['brave-existing-hulk'].created,
    catalogId: hulk.id, completedAt: 123457, rating: 'up' }],
});

async function click(page, selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (node) => node.click());
}

async function resize(page, width) {
  await page.setViewport({ width, height: 900 });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function rendered(page, preview) {
  return page.$$eval(preview ? '#preview-body .preview-list > li' : '#rows > li', (nodes, isPreview) => {
    let group = null;
    const headings = [];
    const rows = [];
    for (const node of nodes) {
      const heading = node.querySelector(isPreview ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        group = heading.textContent.trim();
        headings.push(group);
        continue;
      }
      const issue = node.querySelector(isPreview ? '.preview-issue-link' : '.rt');
      if (issue) rows.push({
        position: isPreview ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
        issueId: Number(issue.dataset.issueId), title: issue.textContent.trim(), group,
      });
    }
    return { rows, headings };
  }, preview);
}

function checkRows(t, label, actual) {
  t.check(label, isDeepStrictEqual(actual.rows, expected) && isDeepStrictEqual(actual.headings, groups),
    JSON.stringify(actual));
}

async function saved(page) {
  return page.evaluate((stateKey, historyKey, catalogId) => {
    const raw = localStorage.getItem(stateKey);
    const state = JSON.parse(raw);
    const matches = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = matches[0];
    return {
      raw, history: localStorage.getItem(historyKey), matches: matches.length,
      listCount: state.listOrder.length, priorHulk: state.lists['brave-existing-hulk'],
      priorHouse: state.lists['brave-existing-house'], schemaVersion: state.schemaVersion,
      read: state.read, notes: state.notes, overrides: state.overrides,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId].title, group: list.collectedIn[issueId],
      })),
      wholeIdentityCount: Object.keys(state.issues).filter((key) => key === '5815').length,
      globalCollection: Object.hasOwn(state.issues[5815] ?? {}, 'collectedIn'),
      storyId: Object.hasOwn(state.issues[5815] ?? {}, 'storyId'),
    };
  }, KEY, LIST_HISTORY_KEY, id);
}

function checkSaved(t, label, actual) {
  t.check(label, actual.matches === 1 && actual.listCount === 3 && actual.schemaVersion === 4
    && isDeepStrictEqual(actual.rows, expected)
    && isDeepStrictEqual(actual.priorHulk, seed.lists['brave-existing-hulk'])
    && isDeepStrictEqual(actual.priorHouse, seed.lists['brave-existing-house'])
    && isDeepStrictEqual(actual.read, seed.read) && isDeepStrictEqual(actual.notes, seed.notes)
    && isDeepStrictEqual(actual.overrides, seed.overrides) && actual.history === historyText
    && actual.wholeIdentityCount === 1 && !actual.globalCollection && !actual.storyId,
  JSON.stringify(actual));
}

export const braveNewWorldActualData = {
  id: 'mcu-prep-captain-america-brave-new-world-actual-data',
  title: 'Brave New World nineteen originals, whole5815 and existing reader/history compatibility',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.evaluateOnNewDocument((stateKey, existing, historyKey, history) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!localStorage.getItem(stateKey)) localStorage.setItem(stateKey, JSON.stringify(existing));
      if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, history);
      window.__mrtBlockExternal = true;
    }, KEY, seed, LIST_HISTORY_KEY, historyText);
    const card = `#marvel-on-screen-results [data-story="list:${id}"]`;
    for (const width of [1280, 360]) {
      await resize(page, width);
      await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
      await page.waitForSelector('#home-primary-paths .home-path');
      await page.$eval('#home-more-paths', (node) => { node.open = true; });
      const homeGateway = '#view-home [data-category="marvel-on-screen"]';
      t.check(`Home exposes exactly one MCU Prep gateway at ${width}px`,
        await page.$$eval(homeGateway, (nodes) => nodes.length) === 1);
      await click(page, homeGateway);
      await page.waitForSelector(card);
      t.check(`Home finds Brave New World exactly once at ${width}px`,
        await page.$$eval(card, (nodes) => nodes.length) === 1);
      await click(page, '.ri[data-view="browse"]');
      await click(page, '#view-browse [data-category="marvel-on-screen"]');
      await page.waitForSelector(card);
      const facts = await page.$eval(card, (node) => ({
        name: node.querySelector('.catalog-card-title')?.textContent.trim(), text: node.textContent,
        source: node.querySelector('a[href*="/issues/704"]')?.href,
        sourceName: node.querySelector('a[href*="/issues/704"]')?.getAttribute('aria-label'),
      }));
      t.check(`Browse finds one nineteen-original owner-linked card at ${width}px`,
        await page.$$eval(card, (nodes) => nodes.length) === 1
        && facts.name === name && facts.text.includes('19 issues') && facts.source === sourceUrl
        && facts.text.includes('Source: Recap Page')
        && facts.sourceName === `Source of ${name}: Recap Page`, JSON.stringify(facts));
      const beforePreview = await saved(page);
      await click(page, `${card} [data-act="preview"]`);
      await page.waitForFunction(() =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === 19);
      checkRows(t, `Preview keeps every original, whole5815 at position7 and7/6/6 at ${width}px`,
        await rendered(page, true));
      const preview = await page.evaluate(() => ({
        description: document.querySelector('#preview-desc')?.textContent.trim(),
        source: document.querySelector('#preview-source')?.textContent.trim(),
        sourceLink: document.querySelector('#preview-source a')?.href,
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      }));
      t.check(`Preview keeps exact user copy and owner attribution at ${width}px`,
        preview.description === description && preview.source.includes(ownerCredit)
        && preview.sourceLink === sourceUrl, JSON.stringify(preview));
      t.check(`Preview has no horizontal overflow at ${width}px`,
        preview.scrollWidth <= preview.viewport, JSON.stringify(preview));
      const afterPreview = await saved(page);
      t.check(`Preview leaves both saved reader and separate history bytes untouched at ${width}px`,
        afterPreview.raw === beforePreview.raw && afterPreview.history === beforePreview.history);
      if (width === 1280) await click(page, '#preview-close');
    }
    await click(page, '#preview-add [data-act="main"]');
    await waitForSavedPreviewLink(page, id);
    checkSaved(t, 'Import preserves prior lists, all read/notes/overrides, deferral and separate completion history',
      await saved(page));
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.$eval('#full', (node) => { node.open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 19);
    for (const width of [1280, 360]) {
      await resize(page, width);
      checkRows(t, `Reading List preserves all originals and whole Wolverine #50 at position7 at ${width}px`,
        await rendered(page, false));
      const layout = await page.evaluate(() => ({
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      }));
      t.check(`Reading List has no horizontal overflow at ${width}px`,
        layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.$eval('#full', (node) => { node.open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 19);
    checkRows(t, 'Reload retains all nineteen originals and their three collection groups', await rendered(page, false));
    checkSaved(t, 'Reload preserves original-level sharing, existing deferral and separate history', await saved(page));
    await page.evaluate(() => {
      window.__dispatching = true;
      document.querySelector('#btn-hero-read').click();
      document.querySelector('#btn-hero-read').click();
      window.__dispatching = false;
    });
    const opened = await page.evaluate(() => window.__opened);
    t.check('The next unread whole5815 opens separate synchronous launchers, never a per-story target',
      opened.length === 2 && opened.every((entry) => entry.dispatching && entry.target === '_blank'
        && entry.features === 'noopener' && new URL(entry.url).origin === page.__origin
        && new URL(entry.url).searchParams.get('d') === String(payload.items[6].digitalId)),
      JSON.stringify(opened));
    t.check('Brave New World uses only the isolated origin and reports no browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};
