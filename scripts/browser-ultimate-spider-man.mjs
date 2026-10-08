import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMarkdown, selectedIssueIds } from './author-cbh-packet.mjs';
import { placeholderId } from './lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'ultimate-spider-man-reading-order';
const name = 'Ultimate Spider-Man';
const gapId = -363711502;
const refusedIds = [113900, 113901, 129224, 129225, 129226, 129227, 129228, 127659];
const mapping = JSON.parse(readFileSync(
  new URL(`./data/cbh-mappings/${id}.json`, import.meta.url), 'utf8',
));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
const exactIds = selectedIssueIds(mapping).map(Number);
assert.equal(authored.length, 352);
assert.equal(parsed.entries.length, 351);
assert.deepEqual(parsed.entries.map((row) => row.issueId), exactIds);
assert.deepEqual(parsed.unresolved.map((row) => [row.index + 1, row.title]), [
  [44, 'Ultimate Spider-Man Super Special (2002) #1'],
]);
assert.equal(placeholderId(id, parsed.unresolved[0].title, '44'), gapId);
const expected = authored.map((row, index) => ({
  position: index + 1,
  issueId: row.issueId ?? gapId,
  title: row.title,
  section: row.section,
  placeholder: row.issueId == null,
  detailsRefused: row.issueId == null ? null : refusedIds.includes(row.issueId),
}));
assert.deepEqual(authored.map((row) => Number(row.sourceKey)), expected.map((row) => row.position));
assert.deepEqual(expected.slice(344).map((row) => row.issueId), refusedIds);
const groups = expected.filter((row, index) => index === 0 || row.section !== expected[index - 1].section)
  .map((row) => row.section);
assert.equal(groups.length, 47);
assert.deepEqual([0, 197, 269, 316].map((index) => expected[index].section.split(':')[0]), [
  'Peter Parker, original Ultimate universe',
  'Miles Morales Reading List',
  'All-New All-Different Miles Morales',
  'The New Ultimate Spider-Man (2024-2026)',
]);
assert.match(expected[334].section, /Ultimate Universe story only/);
assert.match(expected[351].section, /Spider-Man story only; after Ultimate Endgame #1-5/);
assert.match(expected[350].section, /Ultimate Endgame/);
assert.equal(expected[351].issueId, 127659);
assert.equal(mapping.rows.some((row) => row.seriesYear === 2009 && row.issueNumber === '15'), false);
assert.equal(mapping.rows.some((row) => row.seriesYear === 2000
  && Number(row.issueNumber) >= 47 && Number(row.issueNumber) <= 53), false);

const visible = (row) => ({
  position: row.position, issueId: row.issueId, title: row.title, section: row.section,
});
const expectedVisible = expected.map(visible);

function checkVector(t, label, actual, wanted) {
  const mismatches = actual.flatMap((row, index) => (
    JSON.stringify(row) === JSON.stringify(wanted[index])
      ? [] : [{ position: index + 1, expected: wanted[index], actual: row }]
  ));
  t.check(label, actual.length === wanted.length && mismatches.length === 0,
    JSON.stringify({ count: actual.length, mismatches: mismatches.slice(0, 3) }));
}

async function captureRows(page, selector, kind) {
  return page.$$eval(selector, (nodes, view) => {
    let section = null;
    const rows = [];
    const headings = [];
    for (const node of nodes) {
      const heading = node.querySelector(view === 'preview' ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        section = heading.textContent.trim();
        headings.push(section);
        continue;
      }
      const issue = node.querySelector(view === 'preview' ? '.preview-issue-link' : '.rt');
      if (!issue) continue;
      rows.push({
        position: view === 'preview' ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
        issueId: Number(issue.dataset.issueId),
        title: issue.textContent.trim(),
        section,
      });
    }
    return { rows, headings };
  }, kind);
}

async function savedRows(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = lists[0];
    const rows = (list?.itemIds ?? []).map((issueId, index) => {
      const issue = state.issues[issueId];
      return {
        position: index + 1,
        issueId,
        title: issue?.title,
        section: list.collectedIn[issueId] ?? null,
        placeholder: issueId < 0,
        detailsRefused: issueId < 0 ? null : issue?.detailsRefused === true,
      };
    });
    const refused = rows.filter((row) => row.issueId > 0 && row.detailsRefused).map((row) => row.issueId);
    const missingDetails = refused.map((issueId) => {
      const issue = state.issues[issueId];
      return [issue.seriesId, issue.digitalId, issue.cover];
    });
    return { matches: lists.length, rows, refused, missingDetails };
  }, id);
}

export const ultimateSpiderManActualData = {
  id: 'ultimate-spider-man-actual-data',
  title: 'the complete Ultimate Spider-Man guide survives Preview, import, Reading List and reload',
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
    await page.waitForSelector('#view-browse [data-category="character-spotlights"]');
    await page.$eval('#view-browse [data-category="character-spotlights"]', (node) => node.click());
    await page.waitForSelector('#spotlights-q');
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Ultimate Spider-Man';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const cardSelector = `#spotlights-results [data-story="list:${id}"]`;
    await page.waitForSelector(cardSelector);
    const card = await page.$eval(cardSelector, (node) => ({
      name: node.querySelector('.catalog-card-title')?.textContent.trim(),
      text: node.textContent,
      sourceHref: node.querySelector('a[href*="comicbookherald.com"]')?.href,
      addName: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
    }));
    t.check('the credited 352-issue character guide is discoverable without selecting a different Ultimate list',
      card.name === name && card.text.includes('352 issues')
      && card.sourceHref === mapping.sourceUrl
      && card.addName === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 352);
    const preview = await captureRows(page, '#preview-body .preview-list > li', 'preview');
    checkVector(t, 'Preview renders every approved original and the exact position-44 gap',
      preview.rows, expectedVisible);
    t.check('Preview retains all 47 groups across four distinct eras and both story qualifications',
      JSON.stringify(preview.headings) === JSON.stringify(groups),
      JSON.stringify({ count: preview.headings.length, first: preview.headings[0],
        fcbd: preview.headings.find((group) => group.includes('Ultimate Universe story only')),
        finale: preview.headings.at(-1) }));
    const previewGap = await page.$eval(
      `#preview-body .preview-issue-link[data-issue-id="${gapId}"]`,
      (node) => ({ position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        href: node.getAttribute('href') }),
    );
    t.check('the Super Special at position 44 has no fabricated external issue link',
      previewGap.position === 44 && !/^https?:/.test(previewGap.href ?? ''),
      JSON.stringify(previewGap));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('Open'));
    const imported = await savedRows(page);
    t.check('import creates exactly one curated Ultimate Spider-Man list', imported.matches === 1,
      JSON.stringify(imported.matches));
    checkVector(t, 'import persists all 352 exact positions, titles, groups, gap and refusal flags',
      imported.rows, expected);
    t.check('eight positive originals remain identified despite refused optional issue details',
      JSON.stringify(imported.refused) === JSON.stringify(refusedIds)
      && imported.missingDetails.every((fields) => fields.every((field) => field === null)),
      JSON.stringify({ refused: imported.refused, missingDetails: imported.missingDetails }));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 352);
    const rendered = await captureRows(page, '#rows > li', 'reading');
    checkVector(t, 'Reading List renders every position and original in the approved order',
      rendered.rows, expectedVisible);
    t.check('Reading List retains the four eras and the qualified FCBD and deferred Finale groups',
      JSON.stringify(rendered.headings) === JSON.stringify(groups),
      JSON.stringify({ count: rendered.headings.length, fcbd: rendered.headings.find(
        (group) => group.includes('Ultimate Universe story only'),
      ), finale: rendered.headings.at(-1) }));
    const renderedGap = await page.$eval(`#rows .row .rt[data-issue-id="${gapId}"]`, (node) => ({
      readHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
      hasInfo: Boolean(node.closest('.row')?.querySelector('.ract a[data-act="info"]')),
    }));
    t.check('the unresolved Super Special offers neither a reader nor a made-up issue page',
      renderedGap.readHidden && !renderedGap.hasInfo, JSON.stringify(renderedGap));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 352);
    const reloaded = await captureRows(page, '#rows > li', 'reading');
    checkVector(t, 'reloaded Reading List still renders all 352 positions and groups',
      reloaded.rows, expectedVisible);
    t.check('reload retains all 47 source-derived group headings',
      JSON.stringify(reloaded.headings) === JSON.stringify(groups),
      JSON.stringify({ count: reloaded.headings.length, finale: reloaded.headings.at(-1) }));
    const persisted = await savedRows(page);
    t.check('reload retains a single list and the eight known positive-ID detail refusals',
      persisted.matches === 1 && JSON.stringify(persisted.refused) === JSON.stringify(refusedIds)
      && persisted.missingDetails.every((fields) => fields.every((field) => field === null)),
      JSON.stringify({ matches: persisted.matches, refused: persisted.refused }));
    checkVector(t, 'reloaded storage retains every original, section, exact gap and refusal',
      persisted.rows, expected);
    t.check('the explicit Peter omissions stay omitted and Finale follows all five Endgame issues',
      !persisted.rows.some((row) =>
        /^Ultimate Spider-Man \(2000\) #(47|48|49|50|51|52|53)$/.test(row.title)
        || row.title === 'Ultimate Spider-Man (2009) #15')
      && JSON.stringify(persisted.rows.slice(346, 351).map((row) => row.issueId))
        === JSON.stringify(refusedIds.slice(2, 7))
      && persisted.rows[351]?.issueId === 127659,
      JSON.stringify(persisted.rows.slice(344).map((row) => [row.position, row.issueId])));
    t.check('the complete actual-data journey made no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
