import { readFileSync } from 'node:fs';

import {
  addIssuesToList, createEmptyState, createList, deleteList, markRead, setIssueNote,
} from '../src/js/lib/model.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const id = 'amazing-spider-man-reading-order-modern-marvel-era';
const payload = readJson(new URL('../src/data/amazing_spider_man_reading_order_modern_marvel_era.json', import.meta.url));
const ledger = readJson(new URL('./data/owner-selections/amazing-spider-man-early-supplement.json', import.meta.url));
const addedIds = new Set(ledger.rows.map((row) => row.issueId));
const original = payload.items.filter((item) => !addedIds.has(item.issueId));
const expected = payload.items.map((item) => item.issueId);
const originalIds = original.map((item) => item.issueId);
const firstAdded = payload.items.find((item) => item.issueId === 14542);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const click = (page, selector) => page.$eval(selector, (node) => node.click());

let oldState = createList(createEmptyState(), { id: 'legacy-copy', name: payload.name, catalogId: id });
oldState = addIssuesToList(oldState, 'legacy-copy', original).state;
oldState = createList(oldState, { id: 'other-copy', name: 'Another reading list' });
oldState = addIssuesToList(oldState, 'other-copy', [firstAdded]).state;
oldState = markRead(oldState, original[0].issueId, true, 123456);
oldState = markRead(oldState, firstAdded.issueId, true, 123457);
oldState = setIssueNote(oldState, original[0].issueId, 'Keep my place');
oldState = setIssueNote(oldState, firstAdded.issueId, 'Already read');
const freshState = deleteList(oldState, 'legacy-copy');

async function saved(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    return { lists, read: state.read, notes: state.notes };
  }, id);
}

export const amazingSpiderManActualData = {
  id: 'amazing-spider-man-supplement-actual-data',
  title: 'the expanded Spider-Man guide preserves saved copies and imports every issue',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument((state) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
      if (!sessionStorage.getItem('spider-supplement-seeded')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(state));
        sessionStorage.setItem('spider-supplement-seeded', 'yes');
      }
    }, oldState);
    await page.goto(`${page.__origin}/?catalog=actual#/read/legacy-copy`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#order-name')?.textContent.trim() === 'Amazing Spider-Man');
    let persisted = await saved(page);
    t.check('opening an existing saved copy leaves its 2,041 issue positions unchanged',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, originalIds),
      JSON.stringify({ lists: persisted.lists.length, count: persisted.lists[0]?.itemIds.length }));
    t.check('the existing copy and another list keep their global read markers and notes',
      persisted.read[originalIds[0]] === 123456 && persisted.read[firstAdded.issueId] === 123457
      && persisted.notes[originalIds[0]] === 'Keep my place' && persisted.notes[firstAdded.issueId] === 'Already read',
      JSON.stringify({ read: persisted.read, notes: persisted.notes }));
    await page.reload({ waitUntil: 'load' });
    persisted = await saved(page);
    t.check('reload does not silently expand the earlier saved copy',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, originalIds),
      JSON.stringify({ count: persisted.lists[0]?.itemIds.length }));

    await page.evaluate((state) => localStorage.setItem('mrt.state.v2', JSON.stringify(state)), freshState);
    await page.goto(`${page.__origin}/?catalog=actual&fresh=1#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#view-home [data-category="character-spotlights"]');
    await click(page, '#view-home [data-category="character-spotlights"]');
    await page.waitForSelector('#spotlights-q');
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Amazing Spider-Man';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const card = `#spotlights-results [data-story="list:${id}"]`;
    await page.waitForSelector(card);
    const cardText = await page.$eval(card, (node) => node.textContent);
    t.check('the existing Character Spotlight offers the expanded 2,144-comic guide',
      /2,?144 comics/.test(cardText), cardText);
    await click(page, `${card} [data-act="preview"]`);
    await page.waitForFunction(() => document.querySelectorAll('#preview[open] .preview-issue-link').length > 0);
    const previewIds = await page.$$eval('#preview-body .preview-issue-link',
      (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('Preview presents every original and owner-selected issue in the intended order',
      same(previewIds, expected), JSON.stringify({ expected: expected.length, actual: previewIds.length }));

    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction((catalogId) => {
      const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
      return Object.values(state.lists).some((list) => list.catalogId === catalogId && list.itemIds.length > 0);
    }, {}, id);
    persisted = await saved(page);
    t.check('a fresh import saves the complete expanded issue vector',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, expected),
      JSON.stringify({ lists: persisted.lists.length, count: persisted.lists[0]?.itemIds.length }));
    t.check('fresh import keeps progress and notes already attached to both old and newly added issues',
      persisted.read[originalIds[0]] === 123456 && persisted.read[firstAdded.issueId] === 123457
      && persisted.notes[originalIds[0]] === 'Keep my place' && persisted.notes[firstAdded.issueId] === 'Already read',
      JSON.stringify({ read: persisted.read, notes: persisted.notes }));
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row .rt').length > 0);
    const readingIds = await page.$$eval('#rows .row .rt',
      (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('the Reading List renders the complete expanded issue vector',
      same(readingIds, expected), JSON.stringify({ expected: expected.length, actual: readingIds.length }));
    await page.reload({ waitUntil: 'load' });
    persisted = await saved(page);
    t.check('the expanded import survives reload in the same order',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, expected),
      JSON.stringify({ count: persisted.lists[0]?.itemIds.length }));
    t.check('the browser journey makes no external request or console error',
      external.length === 0 && errors.length === 0,
      JSON.stringify({ external: external.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};

export const amazingSpiderManMissingIssueMutation = {
  id: 'amazing-spider-man-supplement-missing-issue',
  breaks: 'amazing-spider-man-supplement-actual-data',
  why: 'dropping a requested Spectacular issue must fail preview, import and saved-order checks',
  script: () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href);
      if (url.pathname !== '/data/amazing_spider_man_reading_order_modern_marvel_era.json') return response;
      const order = await response.clone().json();
      order.items = order.items.filter((item) => item.issueId !== 14542);
      return new Response(JSON.stringify(order), { status: response.status, headers: response.headers });
    };
  },
};
