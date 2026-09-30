import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMarkdown } from './author-cbh-packet.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { MAX_COLLECTION } from '../src/js/lib/model.js';

const id = 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide';
const name = "Greg Pak's Hulk: Planet Hulk to Totally Awesome Hulk";
const mapping = JSON.parse(readFileSync(new URL(`./data/cbh-mappings/${id}.json`, import.meta.url), 'utf8'));
const payload = JSON.parse(readFileSync(new URL(
  '../src/data/planet_hulk_reading_order_and_greg_pak_hulk_comics_guide.json', import.meta.url,
), 'utf8'));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
assert.equal(parsed.entries.length, 107);
assert.equal(parsed.unresolved.length, 0);
assert.deepEqual(payload.items.map((item) => item.issueId),
  mapping.rows.map((row) => row.selectedIssueId));
const expected = parsed.entries.map((row, index) => ({
  position: index + 1,
  issueId: row.issueId,
  title: row.title,
  section: row.section,
}));
const groups = expected.filter((row, index) => index === 0 || row.section !== expected[index - 1].section)
  .map((row) => row.section);
const persistedExpected = expected.map((row) => ({
  ...row, section: row.section?.slice(0, MAX_COLLECTION) ?? null,
}));
const persistedGroups = groups.map((group) => group?.slice(0, MAX_COLLECTION) ?? null);
assert.equal(new Set(persistedGroups).size, new Set(groups).size);
const refusedIds = payload.items.filter((item) => item.detailsRefused === true)
  .map((item) => item.issueId);

function checkRows(t, label, actual, target = expected) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(target[index])
      ? [] : [{ position: index + 1, expected: target[index], actual: row }]);
  t.check(label, actual.length === target.length && mismatches.length === 0,
    JSON.stringify({ count: actual.length, mismatches: mismatches.slice(0, 3) }));
}

async function renderedRows(page, view) {
  return page.$$eval(view === 'preview' ? '#preview-body .preview-list > li' : '#rows > li',
    (nodes, mode) => {
      let section = null;
      const rows = [];
      const headings = [];
      for (const node of nodes) {
        const heading = node.querySelector(mode === 'preview' ? '.preview-group h4' : '.row-group .rg-name');
        if (heading) {
          section = heading.textContent.trim();
          headings.push(section);
          continue;
        }
        const issue = node.querySelector(mode === 'preview' ? '.preview-issue-link' : '.rt');
        if (!issue) continue;
        rows.push({
          position: mode === 'preview' ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
          issueId: Number(issue.dataset.issueId),
          title: issue.textContent.trim(),
          section,
        });
      }
      return { rows, headings };
    }, view);
}

async function storedRows(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = lists[0];
    const rows = (list?.itemIds ?? []).map((issueId, index) => ({
      position: index + 1,
      issueId,
      title: state.issues[issueId]?.title,
      section: list.collectedIn[issueId] ?? null,
    }));
    return {
      matches: lists.length,
      rows,
      refused: rows.filter((row) => state.issues[row.issueId]?.detailsRefused === true)
        .map((row) => row.issueId),
    };
  }, id);
}

export const gregPakHulkActualData = {
  id: 'greg-pak-hulk-actual-data',
  title: 'the complete Greg Pak Hulk creator route survives Preview, import, Reading List and reload',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) externalRequests.push(request.url());
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await page.$eval('.ri[data-view="browse"]', (node) => node.click());
    await page.waitForSelector('#view-browse [data-category="storylines"]');
    await page.$eval('#view-browse [data-category="storylines"]', (node) => node.click());
    await page.waitForSelector('#lines-q');
    await page.$eval('#lines-q', (input) => {
      input.value = 'Greg Pak';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const selector = `#lines-results [data-story="list:${id}"]`;
    await page.waitForSelector(selector);
    const card = await page.$eval(selector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="comicbookherald.com"]')?.href,
      importLabel: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
    }));
    t.check('the separate credited creator route is discoverable in Storylines',
      card.name === name && card.text.includes('107 issues')
      && card.source === mapping.sourceUrl && card.importLabel === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 107);
    const preview = await renderedRows(page, 'preview');
    checkRows(t, 'Preview renders all 107 originals, including the directed special interleaves', preview.rows);
    t.check('Preview preserves every source-derived group and Cho story qualification',
      JSON.stringify(preview.headings) === JSON.stringify(groups)
      && preview.rows[0]?.section?.includes('Amadeus Cho short-story recommendation'),
      JSON.stringify({ groupCount: preview.headings.length, first: preview.rows[0] }));
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await storedRows(page);
    t.check('import creates exactly one distinct creator guide', imported.matches === 1,
      JSON.stringify(imported.matches));
    checkRows(t, 'import persists all 107 positions, titles, original IDs and bounded groups',
      imported.rows, persistedExpected);
    t.check('import preserves actual metadata refusal flags without substituting issue IDs',
      JSON.stringify(imported.refused) === JSON.stringify(refusedIds), JSON.stringify(imported.refused));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 107);
    const reading = await renderedRows(page, 'reading');
    checkRows(t, 'Reading List renders every selected original in source-directed order',
      reading.rows, persistedExpected);
    t.check('Reading List retains the full ordered group vector',
      JSON.stringify(reading.headings) === JSON.stringify(persistedGroups),
      JSON.stringify({ actual: reading.headings.length, expected: groups.length }));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 107);
    const reloaded = await renderedRows(page, 'reading');
    checkRows(t, 'reload retains every selected original, title and bounded group',
      reloaded.rows, persistedExpected);
    t.check('reload retains the exact source-derived group headings',
      JSON.stringify(reloaded.headings) === JSON.stringify(persistedGroups),
      JSON.stringify({ actual: reloaded.headings.length, expected: groups.length }));
    const persisted = await storedRows(page);
    t.check('reload retains one separate creator guide and genuine detail-refusal flags',
      persisted.matches === 1 && JSON.stringify(persisted.refused) === JSON.stringify(refusedIds),
      JSON.stringify({ matches: persisted.matches, refused: persisted.refused }));
    checkRows(t, 'reload retains all 107 persisted identities and positions',
      persisted.rows, persistedExpected);
    t.check('actual-data journey made no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
