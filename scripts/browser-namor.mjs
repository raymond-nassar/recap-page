import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildMarkdown } from './author-cbh-packet.mjs';
import { placeholderId } from './lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { MAX_COLLECTION } from '../src/js/lib/model.js';

const id = 'namor-sub-mariner-reading-order';
const name = 'Namor (Sub-Mariner)';
const ledger = JSON.parse(readFileSync(new URL(`./data/cbh-source-ledgers/${id}.json`, import.meta.url), 'utf8'));
const mapping = JSON.parse(readFileSync(new URL(`./data/cbh-mappings/${id}.json`, import.meta.url), 'utf8'));
const payload = JSON.parse(readFileSync(new URL('../src/data/namor_sub_mariner_reading_order.json', import.meta.url), 'utf8'));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
const source = ledger.blocks.flatMap((block) => block.originalIssueIds);
assert.equal(source.length, 705);
assert.equal(createHash('sha256').update(JSON.stringify(mapping.rows.map((row) => row.selectedIssueId))).digest('hex'),
  'f137877d574a6b77ee9a7d82711862d27dba3833727c0172e552c87a582c1034');
const repeatPositions = new Set(mapping.repeatedSourceReferences.map((row) => row.sourcePosition));
const gapByPosition = new Map(mapping.sourceGaps.map((row) => [row.sourcePosition, row]));
const approvedIds = source.flatMap((issueId, index) => {
  const position = index + 1;
  if (repeatPositions.has(position)) return [];
  return [issueId ?? placeholderId(id, gapByPosition.get(position).sourceIssueReference, String(position))];
});
const checklist = [...parsed.entries, ...parsed.unresolved].sort((left, right) => left.index - right.index);
assert.equal(approvedIds.length, 700);
assert.deepEqual(payload.items.map((row) => row.issueId), approvedIds);
assert.deepEqual(checklist.map((row) => Number(row.sourceKey)),
  Array.from({ length: 705 }, (_, index) => index + 1).filter((position) => !repeatPositions.has(position)));
assert.deepEqual(mapping.candidateMetadata.filter((row) => row.detailsRefused).map((row) => row.id),
  [56327]);
const refusedIds = [56327, 64259, 64285];
const refused = new Set(refusedIds);
const metadata = new Map(mapping.candidateMetadata.map((row) => [row.id, row]));
const providerDetailTitleOverrides = new Map([
  [42332, 'Avengers Vs. X-Men (2012)'],
  [62725, 'Secret Empire (2017)'],
]);
const expected = checklist.map((row, index) => ({
  position: index + 1,
  issueId: approvedIds[index],
  title: row.issueId == null ? row.title :
    providerDetailTitleOverrides.get(row.issueId) ?? metadata.get(row.issueId)?.issueTitle,
  section: row.section ?? null,
  placeholder: row.issueId == null,
  detailsRefused: row.issueId == null ? null : refused.has(row.issueId),
}));
assert.deepEqual(expected.map((row) => row.issueId),
  checklist.map((row) => row.issueId ?? placeholderId(id, row.title, row.sourceKey)));
assert.deepEqual(payload.items.map((row) => row.title), expected.map((row) => row.title));
assert.deepEqual(payload.items.map((row) => row.collectedIn ?? null),
  expected.map((row) => row.section));
const visible = ({ position, issueId, title, section }) => ({ position, issueId, title, section });
const expectedVisible = expected.map(visible);
const groups = expected.filter((row, index) => index === 0 || row.section !== expected[index - 1].section)
  .map((row) => row.section);
const persistedExpected = expected.map((row) => ({
  ...row, section: row.section?.slice(0, MAX_COLLECTION) ?? null,
}));
const persistedVisible = persistedExpected.map(visible);
const persistedGroups = groups.map((group) => group?.slice(0, MAX_COLLECTION) ?? null);
assert.equal(new Set(persistedGroups).size, groups.length);
const gapIds = expected.filter((row) => row.placeholder).map((row) => row.issueId);
assert.deepEqual(refusedIds, [56327, 64259, 64285]);
assert.deepEqual([...gapByPosition.keys()], [153, 339, 340, 341, 342, 369, 626, 663]);
assert.equal(gapIds.length, 8);

function checkVector(t, label, actual, wanted) {
  const mismatches = actual.flatMap((row, index) => (
    JSON.stringify(row) === JSON.stringify(wanted[index])
      ? [] : [{ position: index + 1, actual: row, expected: wanted[index] }]
  ));
  t.check(label, actual.length === wanted.length && mismatches.length === 0,
    JSON.stringify({ count: actual.length, mismatches: mismatches.slice(0, 3) }));
}

async function renderedRows(page, view) {
  return page.$$eval(view === 'preview' ? '#preview-body .preview-list > li' : '#rows > li', (nodes, kind) => {
    let section = null;
    const rows = [];
    const headings = [];
    for (const node of nodes) {
      const heading = node.querySelector(kind === 'preview' ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        section = heading.textContent.trim();
        headings.push(section);
        continue;
      }
      const issue = node.querySelector(kind === 'preview' ? '.preview-issue-link' : '.rt');
      if (!issue) continue;
      rows.push({
        position: kind === 'preview' ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
        issueId: Number(issue.dataset.issueId), title: issue.textContent.trim(), section,
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
    const rows = (list?.itemIds ?? []).map((issueId, index) => {
      const issue = state.issues[issueId];
      return {
        position: index + 1, issueId, title: issue?.title,
        section: list.collectedIn[issueId] ?? null,
        placeholder: issueId < 0,
        detailsRefused: issueId < 0 ? null : issue?.detailsRefused === true,
      };
    });
    return {
      matches: lists.length, rows,
      refused: rows.filter((row) => row.detailsRefused).map((row) => row.issueId),
      annual: state.issues[56327],
    };
  }, id);
}

export const namorActualData = {
  id: 'namor-actual-data',
  title: 'all 700 Namor source slots survive Browse, Preview, import, Reading List and reload',
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
    await page.$eval('#spotlights-q', (node) => {
      node.value = 'Namor';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const cardSelector = `#spotlights-results [data-story="list:${id}"]`;
    await page.waitForSelector(cardSelector);
    const card = await page.$eval(cardSelector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      label: node.textContent,
      source: node.querySelector('a[href*="comicbookherald.com"]')?.href,
    }));
    t.check('the credited 700-issue Namor guide is discoverable',
      card.name === name && card.label.includes('700 issues') && card.source === mapping.sourceUrl,
      JSON.stringify(card));
    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 700);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview renders the complete 700-slot original and gap vector',
      preview.rows, expectedVisible);
    const previewGaps = await page.$$eval('#preview-body .preview-issue-link', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        href: node.getAttribute('href'),
      })), gapIds);
    t.check('all eight unresolved Preview positions have no fabricated issue links',
      JSON.stringify(previewGaps.map((row) => row.issueId)) === JSON.stringify(gapIds)
        && previewGaps.every((row) => row.position === expected.find((entry) =>
          entry.issueId === row.issueId)?.position && !/^https?:/.test(row.href ?? '')),
      JSON.stringify(previewGaps));
    t.check('Preview retains every source group',
      JSON.stringify(preview.headings) === JSON.stringify(groups),
      JSON.stringify({ got: preview.headings.length, expected: groups.length }));
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await savedRows(page);
    t.check('import adds exactly one Namor list', imported.matches === 1, String(imported.matches));
    checkVector(t, 'import saves the exact 700 identities, titles, bounded groups and refusal flags',
      imported.rows, persistedExpected);
    t.check('the verified annual remains a known original with refused optional details',
      imported.annual?.detailsRefused === true
      && [imported.annual.seriesId, imported.annual.digitalId, imported.annual.cover]
        .every((field) => field === null)
      && JSON.stringify(imported.refused) === JSON.stringify(refusedIds),
      JSON.stringify({ annual: imported.annual?.issueId, refused: imported.refused }));
    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 700);
    const rendered = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List shows the complete approved order without duplicates',
      rendered.rows, persistedVisible);
    const gapActions = await page.$$eval('#rows .row .rt', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        openHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
        hasInfo: Boolean(node.closest('.row')?.querySelector('.ract a[data-act="info"]')),
      })), gapIds);
    t.check('all eight unresolved Reading List rows lack reader and fabricated issue-page actions',
      JSON.stringify(gapActions.map((row) => row.issueId)) === JSON.stringify(gapIds)
        && gapActions.every((row) => row.openHidden && !row.hasInfo),
      JSON.stringify(gapActions));
    t.check('Reading List retains every source group',
      JSON.stringify(rendered.headings) === JSON.stringify(persistedGroups),
      JSON.stringify({ got: rendered.headings.length, expected: groups.length }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 700);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload still renders every source original and gap', reloaded.rows, persistedVisible);
    const persisted = await savedRows(page);
    checkVector(t, 'reload persists all original identities, group and refusal flags',
      persisted.rows, persistedExpected);
    t.check('all eight unresolved originals remain placeholders rather than invented issue links',
      JSON.stringify(persisted.rows.filter((row) => row.placeholder).map((row) => row.issueId))
        === JSON.stringify(gapIds), JSON.stringify(gapIds));
    t.check('the complete actual-data journey makes no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
