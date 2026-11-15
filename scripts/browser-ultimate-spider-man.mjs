import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMarkdown, selectedIssueIds } from './author-cbh-packet.mjs';
import { placeholderId } from './lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { addIssuesToList, createEmptyState, createList, markRead } from '../src/js/lib/model.js';
import { selectedUltimateRows } from './lib/ultimate-spider-man-selection.mjs';
import { readUltimateSelectionBaseline } from './correct-ultimate-spider-man.mjs';

const id = 'ultimate-spider-man-reading-order';
const name = 'Ultimate Spider-Man';
const gapId = -363711502;
const refusedIds = [];
const mapping = JSON.parse(readFileSync(
  new URL(`./data/cbh-mappings/${id}.json`, import.meta.url), 'utf8',
));
const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
const parsed = parseChecklist(markdown);
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
const exactIds = selectedUltimateRows(mapping).map((row) => row.selectedIssueId);
assert.equal(selectedIssueIds(mapping).length, 351);
assert.equal(authored.length, 316);
assert.equal(parsed.entries.length, 315);
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
assert.deepEqual(expected.filter((row) => row.detailsRefused).map((row) => row.issueId), refusedIds);
const groups = expected.filter((row, index) => index === 0 || row.section !== expected[index - 1].section)
  .map((row) => row.section);
assert.equal(groups.length, 39);
assert.deepEqual([0, 197, 269].map((index) => expected[index].section.split(':')[0]), [
  'Peter Parker, original Ultimate universe',
  'Miles Morales Reading List',
  'All-New All-Different Miles Morales',
]);
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
    await page.$eval('.brand[data-view="home"]', (node) => node.click());
    await page.waitForSelector('#view-home [data-category="character-spotlights"]');
    await page.$eval('#view-home [data-category="character-spotlights"]', (node) => node.click());
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
    t.check('the credited 316-issue character guide is discoverable without selecting a different Ultimate list',
      card.name === name && card.text.includes('316 comics')
      && card.sourceHref === mapping.sourceUrl
      && card.addName === `Add to library: ${name}`,
      JSON.stringify(card));

    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 316);
    const preview = await captureRows(page, '#preview-body .preview-list > li', 'preview');
    checkVector(t, 'Preview renders every approved original and the exact position-44 gap',
      preview.rows, expectedVisible);
    t.check('Preview retains all 39 groups across the three retained eras',
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
    checkVector(t, 'import persists all 316 exact positions, titles, groups and the original gap',
      imported.rows, expected);
    t.check('the removed eight optional-detail refusals no longer appear in a new import',
      JSON.stringify(imported.refused) === JSON.stringify(refusedIds)
      && imported.missingDetails.every((fields) => fields.every((field) => field === null)),
      JSON.stringify({ refused: imported.refused, missingDetails: imported.missingDetails }));

    await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 316);
    const rendered = await captureRows(page, '#rows > li', 'reading');
    checkVector(t, 'Reading List renders every position and original in the approved order',
      rendered.rows, expectedVisible);
    t.check('Reading List retains the three original and later Miles eras without new-universe groups',
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
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 316);
    const reloaded = await captureRows(page, '#rows > li', 'reading');
    checkVector(t, 'reloaded Reading List still renders all 316 positions and groups',
      reloaded.rows, expectedVisible);
    t.check('reload retains all 39 selected source-derived group headings',
      JSON.stringify(reloaded.headings) === JSON.stringify(groups),
      JSON.stringify({ count: reloaded.headings.length, finale: reloaded.headings.at(-1) }));
    const persisted = await savedRows(page);
    t.check('reload retains a single corrected list without the removed detail refusals',
      persisted.matches === 1 && JSON.stringify(persisted.refused) === JSON.stringify(refusedIds)
      && persisted.missingDetails.every((fields) => fields.every((field) => field === null)),
      JSON.stringify({ matches: persisted.matches, refused: persisted.refused }));
    checkVector(t, 'reloaded storage retains every original, section, exact gap and refusal',
      persisted.rows, expected);
    t.check('the explicit Peter omissions and the entire new-universe tail stay omitted',
      !persisted.rows.some((row) =>
        /^Ultimate Spider-Man \(2000\) #(47|48|49|50|51|52|53)$/.test(row.title)
        || row.title === 'Ultimate Spider-Man (2009) #15')
      && persisted.rows.length === 316
      && persisted.rows.at(-1)?.issueId === expected.at(-1).issueId);

    const prior = readUltimateSelectionBaseline().payload;
    const legacyId = 'legacy-ultimate-spider-man';
    const priorIds = prior.items.map((item) => item.issueId);
    let legacy = createList(createEmptyState(), { id: legacyId, name, catalogId: id });
    legacy = addIssuesToList(legacy, legacyId, prior.items).state;
    legacy = markRead(legacy, priorIds[0], true, 123456);
    legacy = markRead(legacy, priorIds.at(-1), true, 123457);
    await page.evaluateOnNewDocument((state) => {
      if (!sessionStorage.getItem('ultimate-legacy-seeded')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(state));
        sessionStorage.setItem('ultimate-legacy-seeded', 'yes');
      }
    }, legacy);
    await page.goto(`${page.__origin}/?catalog=actual&legacy=1#/read/${legacyId}`, { waitUntil: 'load' });
    await page.waitForSelector('#hero-progress-count .glance-n');
    t.check('the saved-copy fixture opens at its own saved progress',
      await page.$eval('#hero-progress-count', (node) => node.textContent === '2 of 352 read'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#hero-progress-count .glance-n');
    const savedLegacy = await savedRows(page);
    t.check('an existing saved copy keeps all 352 comics after opening and reloading the update',
      savedLegacy.matches === 1
      && JSON.stringify(savedLegacy.rows.map((row) => row.issueId)) === JSON.stringify(priorIds));
    const readMarkers = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')).read);
    t.check('saved progress includes both a retained comic and the removed Finale',
      readMarkers[priorIds[0]] === 123456 && readMarkers[priorIds.at(-1)] === 123457);
    t.check('the saved Reading List counts its own 352 comics, not the corrected catalog count',
      await page.$eval('#hero-progress-count', (node) => node.textContent.includes('2 of 352 read')));
    await page.$eval('.brand[data-view="home"]', (node) => node.click());
    await page.waitForSelector('#view-home [data-category="character-spotlights"]');
    await page.$eval('#view-home [data-category="character-spotlights"]', (node) => node.click());
    await page.waitForSelector('#spotlights-q');
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Ultimate Spider-Man';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForSelector(cardSelector);
    const savedCard = await page.$eval(cardSelector, (node) => node.textContent);
    t.check('discovery distinguishes the corrected 316-comic guide from a saved 352-comic copy',
      savedCard.includes('316 comics') && savedCard.includes('Saved copy: 352 comics'), savedCard);
    await page.$eval(`${cardSelector} [data-act="preview"]`, (node) => node.click());
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 316);
    const deletionNotice = await page.evaluate(() => ({
      notice: Boolean(document.querySelector('.preview-saved-difference')),
      copy: Boolean(document.querySelector('#preview-add [data-act="add-copy"]')),
      main: document.querySelector('#preview-add [data-act="main"]')?.textContent,
    }));
    t.check('a deletion-only update offers Open without a missing-comic notice or an updated-copy action',
      !deletionNotice.notice && !deletionNotice.copy && deletionNotice.main?.includes('Open'),
      JSON.stringify(deletionNotice));
    const unchangedLegacy = await savedRows(page);
    t.check('previewing the corrected guide never shortens the existing saved copy',
      unchangedLegacy.matches === 1
      && JSON.stringify(unchangedLegacy.rows.map((row) => row.issueId)) === JSON.stringify(priorIds));
    t.check('the complete actual-data journey made no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
