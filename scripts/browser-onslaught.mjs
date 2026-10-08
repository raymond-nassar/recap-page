import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMarkdown } from './author-cbh-packet.mjs';
import { placeholderId } from './lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order';
const name = 'X-Men: Onslaught';
const packet = JSON.parse(readFileSync(new URL(`./data/cbh-packets/${id}.json`, import.meta.url)));
const mapping = JSON.parse(readFileSync(new URL(`./data/cbh-mappings/${id}.json`, import.meta.url)));
const ledger = JSON.parse(readFileSync(new URL(`./data/cbh-source-ledgers/${id}.json`, import.meta.url)));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
const selected = ledger.printedPositions.filter((row) => row.sourcePosition != null);
const sourceRows = [...mapping.rows, ...mapping.sourceGaps]
  .sort((a, b) => a.sourcePosition - b.sourcePosition);
const expected = authored.map((row) => ({
  position: row.index + 1,
  issueId: row.issueId ?? placeholderId(id, row.title, row.sourceKey),
  title: row.title,
  section: row.section,
}));
const groups = expected.filter((row, index) =>
  index === 0 || row.section !== expected[index - 1].section).map((row) => row.section);

assert.equal(ledger.printedPositions.length, 100);
assert.equal(packet.sourceOccurrenceCount, 74);
assert.equal(mapping.reviewStatus, 'approved');
assert.equal(authored.length, 74);
assert.equal(parsed.entries.length, 72);
assert.equal(parsed.unresolved.length, 2);
assert.deepEqual(authored.map((row) => Number(row.sourceKey)),
  Array.from({ length: 74 }, (_, index) => index + 1));
assert.deepEqual(selected.map((row) => row.sourcePosition),
  sourceRows.map((row) => row.sourcePosition));
assert.deepEqual(authored.map((row) => row.section),
  sourceRows.map((row) => row.sourceRangeReference ?? row.sourceGroup));
assert.deepEqual(parsed.entries.map((row) => row.issueId), mapping.rows.map((row) => row.selectedIssueId));
assert.deepEqual(parsed.unresolved.map((row) => Number(row.sourceKey)), [24, 27]);
assert.deepEqual([expected[23].issueId, expected[26].issueId], [-1915148978, -1931926597]);
assert.deepEqual(groups, [...new Set(selected.map((row) => row.sourceGroup))]);
assert.equal(expected[36].issueId, 52990);
assert.equal(selected[36].disposition, 'selected-qualified-companion');

function checkVector(t, label, actual) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(expected[index])
      ? [] : [{ position: index + 1, expected: expected[index], actual: row }]);
  t.check(label, actual.length === 74 && mismatches.length === 0,
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
    return {
      matches: lists.length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1,
        issueId,
        title: state.issues[issueId]?.title,
        section: list.collectedIn[issueId] ?? null,
      })),
    };
  }, id);
}

export const onslaughtActualData = {
  id: 'onslaught-actual-data',
  title: 'Onslaught retains 74 approved source positions, two unresolved originals and its reference companion',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) {
        externalRequests.push(request.url());
      }
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });

    await page.goto(`${page.__origin}/?catalog=actual#/age-early-modern`, { waitUntil: 'load' });
    const selector = `#age-early-modern-results [data-story="list:${id}"]`;
    await page.waitForSelector(selector);
    const card = await page.$eval(selector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="comicbookherald.com"]')?.href,
      importLabel: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
    }));
    t.check('the credited 74-position event is discoverable as one Onslaught guide',
      card.name === name && card.text.includes('74 issues')
        && card.source === packet.sourceUrl && card.importLabel === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 74);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview renders all 74 source positions, issue IDs, titles and sections', preview.rows);
    t.check('Preview retains all seven selected Road and Epic sections',
      JSON.stringify(preview.headings) === JSON.stringify(groups), JSON.stringify(preview.headings));
    const gapIds = [expected[23].issueId, expected[26].issueId];
    const previewGaps = await page.$$eval('#preview-body .preview-issue-link', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        href: node.getAttribute('href'),
      })), gapIds);
    t.check('both unresolved source originals have no fabricated issue links',
      previewGaps.length === 2 && previewGaps.every((row) =>
        row.position === expected.find((entry) => entry.issueId === row.issueId)?.position
          && !/^https?:/.test(row.href ?? '')), JSON.stringify(previewGaps));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('Open'));
    const imported = await storedRows(page);
    t.check('import creates exactly one Onslaught list', imported.matches === 1);
    checkVector(t, 'import persists all 74 source positions with two distinct gaps', imported.rows);

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 74);
    const reading = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List renders all 74 originals and gaps in source order', reading.rows);
    t.check('the verified Yearbook original and the two Onslaught finales stay distinct',
      [expected[36].issueId, expected[68].issueId, expected[72].issueId, expected[73].issueId]
        .join(',') === '52990,10453,23388,16337'
        && JSON.stringify(reading.headings) === JSON.stringify(groups));
    const gapActions = await page.$$eval('#rows .row .rt', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        openHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
        hasInfo: Boolean(node.closest('.row')?.querySelector('.ract a[data-act="info"]')),
      })), gapIds);
    t.check('both unresolved originals have neither reader nor fabricated issue page',
      gapActions.length === 2 && gapActions.every((row) => row.openHidden && !row.hasInfo),
      JSON.stringify(gapActions));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 74);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload retains every title, ID, section and source position', reloaded.rows);
    const persisted = await storedRows(page);
    t.check('reload retains exactly one Onslaught guide', persisted.matches === 1);
    checkVector(t, 'reload preserves the stored 74-position source vector', persisted.rows);
    t.check('the local-only journey has no external requests or browser errors',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors }));
  },
};
