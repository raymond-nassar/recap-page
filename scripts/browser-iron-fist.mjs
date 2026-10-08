import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMarkdown } from './author-cbh-packet.mjs';
import { digestCanonicalJson } from './lib/cbh-inventory.mjs';
import { MAX_COLLECTION } from '../src/js/lib/model.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'iron-fist-reading-order';
const name = 'Iron Fist';
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const fixture = readJson(new URL('../test/fixtures/iron-fist-browser-vector.json', import.meta.url));
const packet = readJson(new URL(`./data/cbh-packets/${id}.json`, import.meta.url));
const mapping = readJson(new URL(`./data/cbh-mappings/${id}.json`, import.meta.url));
const ledger = readJson(new URL(`./data/cbh-source-ledgers/${id}.json`, import.meta.url));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
const parsed = parseChecklist(markdown);
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
const expected = fixture.rows;
const visible = ({ position, issueId, title, section }) => ({ position, issueId, title, section });
const previewExpected = expected.map(visible);
const savedExpected = expected.map((row) => ({
  ...row, section: row.section?.slice(0, MAX_COLLECTION) ?? null,
  detailsRefused: row.placeholder ? null : row.detailsRefused,
}));
const savedVisible = savedExpected.map(visible);
const groups = expected.filter((row, index) => index === 0 || row.section !== expected[index - 1].section)
  .map((row) => row.section);
const savedGroups = groups.map((section) => section?.slice(0, MAX_COLLECTION) ?? null);
const gaps = expected.filter((row) => row.placeholder);
const gapIds = gaps.map((row) => row.issueId);

assert.equal(mapping.reviewStatus, 'approved');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
assert.equal(fixture.packetDigest, packet.packetDigest);
assert.equal(fixture.mappingDigest, mapping.mappingDigest);
assert.equal(fixture.sourceOnlyDigest, digestCanonicalJson(ledger.sourceOnlyProjection));
assert.equal(fixture.selectedDigest, digestCanonicalJson(ledger.selectedOccurrences));
assert.equal(fixture.sourceOccurrenceCount, 430);
assert.equal(fixture.repeatTargets.length, 16);
assert.equal(expected.length, 414);
assert.equal(authored.length, 414);
assert.deepEqual(expected.map((row) => row.sourcePosition),
  authored.map((row) => Number(row.sourceKey)));
assert.deepEqual(expected.map((row) => row.position),
  Array.from({ length: 414 }, (_, index) => index + 1));
assert.deepEqual(fixture.repeatTargets, ledger.selectedOccurrences.filter((row) => row.repeatOf != null)
  .map((row) => ({ sourcePosition: row.sourcePosition, firstSelectedPosition: row.repeatOf })));
for (const repeat of ledger.selectedOccurrences.filter((row) => row.repeatOf != null)) {
  const first = ledger.selectedOccurrences.find((row) => row.sourcePosition === repeat.repeatOf);
  assert.deepEqual([repeat.originalTitle, repeat.originalSeriesYear, repeat.issue],
    [first.originalTitle, first.originalSeriesYear, first.issue]);
  assert.ok(!expected.some((row) => row.sourcePosition === repeat.sourcePosition));
}
assert.equal(gaps.length, 38);
assert.deepEqual(expected.filter((row) => row.detailsRefused).map((row) => row.issueId), [59301]);
assert.deepEqual(expected.filter((row) => row.sourcePosition >= 140 && row.sourcePosition <= 155)
  .map((row) => row.placeholder), Array(16).fill(true));
assert.match(expected.find((row) => row.sourcePosition === 140).section,
  /Iron Fist-relevance continuation.*outside named Volume 2/i);
assert.match(expected.find((row) => row.sourcePosition === 179).section,
  /whole original; Heroes for Hire story material/i);
assert.deepEqual(expected.filter((row) => row.sourcePosition >= 405 && row.sourcePosition <= 407)
  .map((row) => row.issueId), [71267, 71268, 71269]);
assert.ok(Math.max(...groups.map((section) => section?.length ?? 0)) <= MAX_COLLECTION);
assert.deepEqual(groups, savedGroups);

function checkVector(t, label, actual, wanted) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(wanted[index])
      ? [] : [{ position: index + 1, expected: wanted[index], actual: row }]);
  t.check(label, actual.length === wanted.length && mismatches.length === 0,
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
          issueId: Number(issue.dataset.issueId), title: issue.textContent.trim(), section,
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
        position: index + 1, issueId,
        title: state.issues[issueId]?.title,
        section: list.collectedIn[issueId] ?? null,
        placeholder: issueId < 0,
        detailsRefused: issueId < 0 ? null : state.issues[issueId]?.detailsRefused === true,
      })),
      refused: state.issues[59301],
    };
  }, id);
}

export const ironFistActualData = {
  id: 'iron-fist-actual-data',
  title: 'all 414 Iron Fist originals and qualified gaps survive discovery, import and reload',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (target.protocol.startsWith('http') && target.origin !== page.__origin) externalRequests.push(request.url());
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await page.$eval('.ri[data-view="browse"]', (node) => node.click());
    await page.waitForSelector('#view-browse [data-category="character-spotlights"]');
    await page.$eval('#view-browse [data-category="character-spotlights"]', (node) => node.click());
    await page.waitForSelector('#spotlights-q');
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Iron Fist';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const selector = `#spotlights-results [data-story="list:${id}"]`;
    await page.waitForSelector(selector);
    const card = await page.$eval(selector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="comicbookherald.com"]')?.href,
      addName: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
    }));
    t.check('the credited 414-original Iron Fist guide is discoverable once',
      card.name === name && card.text.includes('414 issues')
        && card.source === packet.sourceUrl && card.addName === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 414);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview renders every source-derived ID, cache-backed title and qualified section',
      preview.rows, previewExpected);
    t.check('Preview retains all collection headings including both visible qualifications',
      JSON.stringify(preview.headings) === JSON.stringify(groups),
      JSON.stringify({ count: preview.headings.length, qualifications: preview.headings.filter(
        (section) => /Iron Fist-relevance continuation|Heroes for Hire story material/.test(section)) }));
    const previewGaps = await page.$$eval('#preview-body .preview-issue-link', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        href: node.getAttribute('href'),
      })), gapIds);
    t.check('all 38 exact source gaps have no fabricated Preview issue URL',
      JSON.stringify(previewGaps.map((row) => row.issueId)) === JSON.stringify(gapIds)
        && previewGaps.every((row) => row.position === expected.find((entry) =>
          entry.issueId === row.issueId)?.position && !/^https?:/.test(row.href ?? '')),
      JSON.stringify(previewGaps));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('Open'));
    const imported = await storedRows(page);
    t.check('import creates one guide with a positive detail-refused original',
      imported.matches === 1 && imported.refused?.detailsRefused === true
        && imported.refused?.issueId === 59301 && imported.refused?.digitalId == null
        && imported.refused?.cover == null,
      JSON.stringify({ matches: imported.matches, refused: imported.refused?.issueId }));
    checkVector(t, 'import persists every source position, title, group, gap and refusal',
      imported.rows,
      savedExpected.map(({ sourcePosition: _unused, ...row }) => row));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 414);
    const rendered = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List renders 414 originals once with all 16 backward repeats omitted',
      rendered.rows, savedVisible);
    t.check('Reading List keeps all 48 section headings within persisted collection length',
      JSON.stringify(rendered.headings) === JSON.stringify(savedGroups)
        && rendered.headings.every((section) => section.length <= MAX_COLLECTION),
      JSON.stringify({ count: rendered.headings.length }));
    const gapActions = await page.$$eval('#rows .row .rt', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        openHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
        hasInfo: Boolean(node.closest('.row')?.querySelector('.ract a[data-act="info"]')),
      })), gapIds);
    t.check('all 38 unresolved originals lack reader and fabricated info actions',
      JSON.stringify(gapActions.map((row) => row.issueId)) === JSON.stringify(gapIds)
        && gapActions.every((row) => row.openHidden && !row.hasInfo),
      JSON.stringify(gapActions));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 414);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload retains every ID, title and qualified section', reloaded.rows, savedVisible);
    const persisted = await storedRows(page);
    t.check('reload retains one guide and the positive #9 detail refusal',
      persisted.matches === 1 && persisted.refused?.detailsRefused === true
        && persisted.refused?.issueId === 59301,
      JSON.stringify({ matches: persisted.matches, refused: persisted.refused?.issueId }));
    checkVector(t, 'reload persists all 414 independent source-derived identities',
      persisted.rows,
      savedExpected.map(({ sourcePosition: _unused, ...row }) => row));
    t.check('the actual-data journey makes no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
