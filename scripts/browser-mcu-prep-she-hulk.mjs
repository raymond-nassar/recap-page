import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { addIssuesToList, createEmptyState, createList } from '../src/js/lib/model.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';
import { waitForSavedPreviewLink } from './browser-owner-guide.mjs';

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const fixture = readJson('../test/fixtures/mcu-prep-she-hulk-vector.json');
const payload = readJson('../src/data/mcu_prep_she_hulk.json');
const { id, name, description, sourceUrl, groups } = fixture;
const ownerCredit = 'Selected by raymond-nassar for MCU Prep';
const expected = fixture.rows.map(([, issueId, title, group], index) => ({
  position: index + 1, issueId, title, group: groups[group],
}));
assert.equal(expected.length, 13);
assert.deepEqual(payload.items.map((row) => row.issueId), expected.map((row) => row.issueId));
const priorId = 'she-hulk-existing-hulk';
let seed = createList(createEmptyState(), { id: priorId, name: 'My previous Hulk list', note: 'Keep my list note' });
seed = addIssuesToList(seed, priorId, [{
  ...payload.items[0], collectedIn: 'My previous Hulk section',
}]).state;
seed = { ...seed, read: { 15256: 123456 }, notes: { 15256: 'Keep my Hulk note' },
  overrides: { 15256: 'unavailable' } };
const historyText = JSON.stringify({
  format: LIST_HISTORY_FORMAT, version: 1,
  records: [{ listId: priorId, created: seed.lists[priorId].created, catalogId: null,
    completedAt: 123457, rating: 'up' }],
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
  t.check(label, JSON.stringify(actual.rows) === JSON.stringify(expected)
    && JSON.stringify(actual.headings) === JSON.stringify(groups), JSON.stringify(actual));
}

async function saved(page) {
  return page.evaluate((stateKey, historyKey, catalogId, previousId) => {
    const state = JSON.parse(localStorage.getItem(stateKey));
    const matches = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = matches[0];
    return {
      matches: matches.length, listCount: state.listOrder.length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId].title,
        group: list.collectedIn[issueId],
      })),
      priorList: state.lists[previousId],
      read: state.read[15256], note: state.notes[15256], override: state.overrides[15256],
      history: localStorage.getItem(historyKey),
      sharedIdentityCount: Object.keys(state.issues).filter((key) => key === '15256').length,
      globalCollection: Object.hasOwn(state.issues[15256], 'collectedIn'),
    };
  }, KEY, LIST_HISTORY_KEY, id, priorId);
}

function checkSaved(t, label, actual) {
  t.check(label, actual.matches === 1 && actual.listCount === 2
    && JSON.stringify(actual.rows) === JSON.stringify(expected)
    && isDeepStrictEqual(actual.priorList, seed.lists[priorId])
    && actual.read === 123456 && actual.note === 'Keep my Hulk note'
    && actual.override === 'unavailable' && actual.history === historyText
    && actual.sharedIdentityCount === 1 && !actual.globalCollection, JSON.stringify(actual));
}

export const sheHulkActualData = {
  id: 'she-hulk-actual-data',
  title: 'She-Hulk thirteen exact originals, owner copy and protected saved data',
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
      t.check(`Home finds She-Hulk exactly once at ${width}px`,
        await page.$$eval(card, (nodes) => nodes.length) === 1);
      await click(page, '.ri[data-view="browse"]');
      await click(page, '#view-browse [data-category="marvel-on-screen"]');
      await page.waitForSelector(card);
      const facts = await page.$eval(card, (node) => ({
        name: node.querySelector('.catalog-card-title')?.textContent.trim(),
        text: node.textContent,
        source: node.querySelector('a[href*="/issues/699"]')?.href,
        sourceName: node.querySelector('a[href*="/issues/699"]')?.getAttribute('aria-label'),
      }));
      t.check(`Browse finds one thirteen-original owner-linked She-Hulk card at ${width}px`,
        await page.$$eval(card, (nodes) => nodes.length) === 1
        && facts.name === name && facts.text.includes('13 issues')
        && facts.source === sourceUrl && facts.text.includes('Source: Recap Page')
        && facts.sourceName === `Source of ${name}: Recap Page`, JSON.stringify(facts));
      await click(page, `${card} [data-act="preview"]`);
      await page.waitForFunction(() =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === 13);
      checkRows(t, `Preview keeps every original and the 1/6/6 groups at ${width}px`, await rendered(page, true));
      const preview = await page.evaluate(() => ({
        description: document.querySelector('#preview-desc')?.textContent.trim(),
        source: document.querySelector('#preview-source')?.textContent.trim(),
        sourceLink: document.querySelector('#preview-source a')?.href,
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      }));
      t.check(`Preview preserves exact user copy and full owner attribution at ${width}px`,
        preview.description === description && preview.source.includes(ownerCredit)
        && preview.sourceLink === sourceUrl, JSON.stringify(preview));
      t.check(`Preview has no horizontal overflow at ${width}px`,
        preview.scrollWidth <= preview.viewport, JSON.stringify(preview));
      if (width === 1280) await click(page, '#preview-close');
    }
    await click(page, '#preview-add [data-act="main"]');
    await waitForSavedPreviewLink(page, id);
    checkSaved(t, 'Import keeps thirteen originals and all prior reader/history state', await saved(page));
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.$eval('#full', (node) => { node.open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 13);
    for (const width of [1280, 360]) {
      await resize(page, width);
      checkRows(t, `The opened Reading List keeps all original/collection positions at ${width}px`,
        await rendered(page, false));
      const layout = await page.evaluate(() => ({
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      }));
      t.check(`The opened Reading List has no horizontal overflow at ${width}px`,
        layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.$eval('#full', (node) => { node.open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 13);
    checkRows(t, 'Reload keeps all thirteen originals and their three groups', await rendered(page, false));
    checkSaved(t, 'Reload preserves shared progress, notes, overrides, prior list and separate history', await saved(page));
    t.check('She-Hulk uses only the isolated origin and reports no browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};
