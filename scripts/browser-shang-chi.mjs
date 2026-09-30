import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMarkdown } from './author-cbh-packet.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'shang-chi-master-of-kung-fu-reading-order';
const name = 'Shang-Chi / Master of Kung Fu';
const fixture = JSON.parse(readFileSync(new URL(
  '../test/fixtures/shang-chi-browser-vector.json', import.meta.url,
), 'utf8'));
const mapping = JSON.parse(readFileSync(new URL(
  `./data/cbh-mappings/${id}.json`, import.meta.url,
), 'utf8'));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
assert.equal(authored.length, 298);
assert.deepEqual(authored.map((row) => Number(row.sourceKey)),
  fixture.rows.map((row) => row.sourcePosition));
const expected = fixture.rows.map((row, index) => ({
  position: index + 1,
  issueId: row.issueId,
  title: row.title,
  section: row.collectedIn,
}));
const groups = expected.filter((row, index) =>
  index === 0 || row.section !== expected[index - 1].section).map((row) => row.section);
const gaps = fixture.rows.filter((row) => row.gap);
assert.deepEqual(gaps.map((row) => row.sourcePosition), [42, 49, 165, 166, 167, 168, 169, 170]);
assert.deepEqual(fixture.repeatTargets.map((row) => [
  row.sourcePosition, row.canonicalSourcePosition,
]), [[12, 10], [207, 31], [208, 97], [209, 98]]);
const ironFist = fixture.rows.filter((row) =>
  row.sourcePosition >= 244 && row.sourcePosition <= 250);
assert.deepEqual(ironFist.map((row) => row.issueId),
  [64282, 64601, 64770, 65081, 65289, 65576, 66103]);
const correctedHeading = 'Iron Fist (2017) #6-7, #73-77 (corrected collection; source prints #72-76)';
assert.ok(groups.includes(correctedHeading));

function checkVector(t, label, actual) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(expected[index])
      ? [] : [{ position: index + 1, expected: expected[index], actual: row }]);
  t.check(label, actual.length === expected.length && mismatches.length === 0,
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

export const shangChiActualData = {
  id: 'shang-chi-actual-data',
  title: 'the complete Shang-Chi guide retains 298 source positions, eight gaps and its corrected range',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
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

    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await page.$eval('.ri[data-view="browse"]', (node) => node.click());
    await page.waitForSelector('#view-browse [data-category="character-spotlights"]');
    await page.$eval('#view-browse [data-category="character-spotlights"]', (node) => node.click());
    await page.waitForSelector('#spotlights-q');
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Shang-Chi';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const selector = `#spotlights-results [data-story="list:${id}"]`;
    await page.waitForSelector(selector);
    const card = await page.$eval(selector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      source: node.querySelector('a[href*="comicbookherald.com"]')?.href,
      importLabel: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
    }));
    t.check('the 298-position credited character guide is discoverable without substituting another list',
      card.name === name && card.text.includes('298 issues')
      && card.source === mapping.sourceUrl && card.importLabel === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 298);
    const preview = await renderedRows(page, 'preview');
    checkVector(t, 'Preview renders all 298 identities, titles, positions and source headings', preview.rows);
    t.check('Preview shows all 41 factual groups and the corrected seven-issue Iron Fist heading',
      JSON.stringify(preview.headings) === JSON.stringify(groups)
      && preview.headings.includes(correctedHeading)
      && !preview.headings.some((heading) => /unresolved|#72-76(?!\))/.test(heading)),
      JSON.stringify({ count: preview.headings.length, corrected: preview.headings.find((heading) =>
        heading.startsWith('Iron Fist (2017)')) }));
    const previewGaps = await page.$$eval('#preview-body .preview-issue-link', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        href: node.getAttribute('href'),
      })), gaps.map((row) => row.issueId));
    t.check('the eight printed originals lacking provider IDs have no fabricated issue links',
      previewGaps.length === 8 && previewGaps.every((row) =>
        row.position === expected.find((entry) => entry.issueId === row.issueId)?.position
        && !/^https?:/.test(row.href ?? '')),
      JSON.stringify(previewGaps));
    t.check('the anthology and story-specific source qualifications survive Preview',
      preview.rows.some((row) => row.title === 'Bizarre Adventures (1981) #25')
      && preview.rows.filter((row) => /^Marvel Comics Presents \(1988\) #[1-8]$/.test(row.title)).length === 8
      && preview.headings.some((heading) => heading.includes('Shang-Chi story'))
      && preview.rows.some((row) => row.title === "Marvel's Voices: Identity (2021) #1"),
      JSON.stringify({ anthology: preview.rows.filter((row) =>
        /Bizarre Adventures|Marvel Comics Presents|Voices: Identity/.test(row.title)).length }));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await storedRows(page);
    t.check('import creates one Shang-Chi list', imported.matches === 1,
      JSON.stringify(imported.matches));
    checkVector(t, 'import stores the full source-directed vector, including eight placeholders', imported.rows);
    t.check('four backward source references do not duplicate the selected originals',
      fixture.repeatTargets.every((repeat) =>
        !fixture.rows.some((row) => row.sourcePosition === repeat.sourcePosition)
        && fixture.rows.some((row) => row.sourcePosition === repeat.canonicalSourcePosition))
      && new Set(imported.rows.map((row) => row.issueId)).size === 298,
      JSON.stringify({ repeats: fixture.repeatTargets, count: imported.rows.length }));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 298);
    const reading = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List renders all 298 approved originals and gaps in order', reading.rows);
    t.check('Reading List preserves every group and the corrected collection heading',
      JSON.stringify(reading.headings) === JSON.stringify(groups)
      && reading.headings.includes(correctedHeading),
      JSON.stringify({ headings: reading.headings.length }));
    const gapActions = await page.$$eval('#rows .row .rt', (nodes, ids) =>
      nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
        issueId: Number(node.dataset.issueId),
        openHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
        hasInfo: Boolean(node.closest('.row')?.querySelector('.ract a[data-act="info"]')),
      })), gaps.map((row) => row.issueId));
    t.check('all eight unresolved originals offer neither a reader nor a fabricated issue page',
      gapActions.length === 8 && gapActions.every((row) => row.openHidden && !row.hasInfo),
      JSON.stringify(gapActions));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 298);
    const reloaded = await renderedRows(page, 'reading');
    checkVector(t, 'reload retains the full selected vector with corrected #73-77', reloaded.rows);
    t.check('reload keeps all 41 source-derived headings', JSON.stringify(reloaded.headings) === JSON.stringify(groups),
      JSON.stringify({ headings: reloaded.headings.length }));
    const persisted = await storedRows(page);
    t.check('reload retains exactly one Shang-Chi guide', persisted.matches === 1,
      JSON.stringify(persisted.matches));
    checkVector(t, 'reload retains all persisted positions, titles, sections and eight gaps',
      persisted.rows);
    t.check('the isolated journey made no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
