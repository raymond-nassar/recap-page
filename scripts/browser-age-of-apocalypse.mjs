import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { placeholderId } from './lib/placeholder-id.mjs';

const id = 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order';
const name = 'Apocalypse / X-Men: Age of Apocalypse';
const packet = JSON.parse(readFileSync(new URL(`./data/cbh-packets/${id}.json`, import.meta.url)));
const mapping = JSON.parse(readFileSync(new URL(`./data/cbh-mappings/${id}.json`, import.meta.url)));
const ledger = JSON.parse(readFileSync(new URL(`./data/cbh-source-ledgers/${id}.json`, import.meta.url)));
const payload = JSON.parse(readFileSync(new URL(
  '../src/data/the_complete_marvel_reading_order_guide_age_of_apocalypse_reading_order.json',
  import.meta.url,
)));
const parsed = parseChecklist(readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8'));
const authored = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
const selected = ledger.selectedOccurrences.filter((entry) => entry.disposition !== 'backward-repeat');
const expected = authored.map((entry) => ({
  index: entry.index,
  issueId: entry.issueId ?? placeholderId(id, entry.title, entry.sourceKey),
  title: entry.title,
  section: entry.section,
  sourceKey: entry.sourceKey,
}));
const vector = (rows) => rows.map(({ index, issueId, title, section }) => ({
  index, issueId, title, section,
}));

assert.equal(ledger.printedProvenance.length, 281);
assert.equal(ledger.selectedOccurrences.length, 275);
assert.equal(packet.repeatedSourceReferences.length, 13);
assert.equal(selected.length, 262);
assert.equal(authored.length, 262);
assert.equal(parsed.unresolved.length, 16);
assert.deepEqual(mapping.rows.map((row) => row.sourcePosition),
  packet.rows.map((row) => row.sourcePosition));
assert.deepEqual(expected.map((row) => Number(row.sourceKey)), selected.map((row) => row.selectedPosition));
assert.deepEqual(vector(expected), payload.items.map((item, index) => ({
  index, issueId: item.issueId, title: item.title, section: item.collectedIn,
})));
assert.deepEqual(
  packet.repeatedSourceReferences.map((row) => row.sourcePosition),
  ledger.selectedOccurrences.filter((row) => row.disposition === 'backward-repeat')
    .map((row) => row.selectedPosition),
);

function checkVector(t, label, actual) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(vector(expected)[index])
      ? [] : [{ position: index + 1, expected: vector(expected)[index], actual: row }]);
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
          index: rows.length,
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
        index, issueId, title: state.issues[issueId]?.title,
        section: list.collectedIn[issueId] ?? null,
      })),
    };
  }, id);
}

export async function checkAgeOfApocalypseActualData(page, t) {
  const externalRequests = [];
  const browserErrors = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== page.__origin) {
      externalRequests.push(request.url());
    }
  });
  page.on('pageerror', (err) => browserErrors.push(err.message));
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
    input.value = 'Apocalypse';
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
  t.check('the 262-position credited AoA guide is discoverable as one character guide',
    card.name === name && card.text.includes('262 issues')
      && card.source === packet.sourceUrl && card.importLabel === `Add to library: ${name}`,
    JSON.stringify(card));

  await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
  await page.waitForFunction(() =>
    document.querySelectorAll('#preview[open] .preview-issue-link').length === 262);
  const preview = await renderedRows(page, 'preview');
  checkVector(t, 'Preview renders all 262 identities, titles, positions and groups', preview.rows);
  t.check('preview has neutral history and later-AoA group, not a false universal Earth-616 label',
    preview.headings.some((heading) => heading.includes('Apocalypse history and later Age of Apocalypse stories'))
      && !preview.headings.some((heading) => heading === 'Earth-616'));
  const gaps = expected.filter((row) => row.issueId < 0);
  const previewGaps = await page.$$eval('#preview-body .preview-issue-link', (nodes, ids) =>
    nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
      issueId: Number(node.dataset.issueId),
      index: Number(node.closest('li')?.querySelector('.pn')?.textContent) - 1,
      href: node.getAttribute('href'),
    })), gaps.map((row) => row.issueId));
  t.check('all 16 unresolved preview positions have no fabricated issue links',
    previewGaps.length === 16 && previewGaps.every((row) => (
      row.index === expected.find((entry) => entry.issueId === row.issueId)?.index
        && !/^https?:/.test(row.href ?? '')
    )), JSON.stringify(previewGaps));

  await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
    ?.textContent.includes('In library'));
  const imported = await storedRows(page);
  t.check('import creates exactly one AoA guide', imported.matches === 1);
  checkVector(t, 'import persists the exact 262-title, ID, position and group vector', imported.rows);

  await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
  await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
    && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
  await page.evaluate(() => { document.querySelector('#full').open = true; });
  await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 262);
  const reading = await renderedRows(page, 'reading');
  checkVector(t, 'Reading List renders all 262 originals and gaps in order', reading.rows);
  t.check('Reading List retains neutral history and later-AoA heading',
    reading.headings.some((heading) => heading.includes('Apocalypse history and later Age of Apocalypse stories')));
  const gapActions = await page.$$eval('#rows .row .rt', (nodes, ids) =>
    nodes.filter((node) => ids.includes(Number(node.dataset.issueId))).map((node) => ({
      issueId: Number(node.dataset.issueId),
      openHidden: node.closest('.row')?.querySelector('.ract button[data-act="open"]')?.hidden,
      hasInfo: !!node.closest('.row')?.querySelector('.ract a[data-act="info"]'),
    })), gaps.map((row) => row.issueId));
  t.check('all 16 unresolved originals offer neither a reader nor a fabricated issue page',
    gapActions.length === 16 && gapActions.every((row) => row.openHidden && !row.hasInfo),
    JSON.stringify(gapActions));

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction((title) =>
    document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
  await page.evaluate(() => { document.querySelector('#full').open = true; });
  await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 262);
  const reloaded = await renderedRows(page, 'reading');
  checkVector(t, 'reload preserves all 262 rendered positions and sections', reloaded.rows);
  const persisted = await storedRows(page);
  t.check('reload retains exactly one AoA guide', persisted.matches === 1);
  checkVector(t, 'reload retains all persisted identities, titles, groups and gaps', persisted.rows);

  const bySource = new Map(expected.map((row) => [Number(row.sourceKey), row.issueId]));
  t.check('all 13 backward references point to their actual imported and reloaded originals',
    packet.repeatedSourceReferences.every((repeat) => {
      const target = packet.rows[repeat.canonicalRow - 1];
      const mapped = mapping.rows[repeat.canonicalRow - 1];
      const occurrence = ledger.selectedOccurrences[repeat.sourcePosition - 1];
      const issueId = mapped?.selectedIssueId;
      return !!target && target.sourcePosition === mapped.sourcePosition
        && occurrence?.disposition === 'backward-repeat'
        && occurrence.firstSelectedPosition === target.sourcePosition
        && !bySource.has(repeat.sourcePosition)
        && bySource.get(target.sourcePosition) === issueId
        && imported.rows.filter((row) => row.issueId === issueId).length === 1
        && persisted.rows.filter((row) => row.issueId === issueId).length === 1;
    }));
  t.check('Ashcan stays unresolved and distinct from the final Chosen one-shot',
    bySource.get(15) < 0 && expected.at(-1).issueId === 17701
      && bySource.get(15) !== expected.at(-1).issueId);
  t.check('six 2025 X-Men of Apocalypse originals remain distinct unresolved positions',
    expected.slice(-7, -1).map((row) => row.title).every((title, index) => (
      title === `X-Men of Apocalypse (2025) #${index + 1}`
    )) && expected.slice(-7, -1).every((row) => row.issueId < 0));
  t.check('Tales and X-Men 2004 resolutions preserve their exact identities',
    bySource.get(18) === 18796 && bySource.get(19) === 18797
      && [3534, 3539, 3945, 4068, 4181, 4281].every(
        (issueId, index) => bySource.get(166 + index) === issueId,
      ));
  t.check('no external requests or page errors occur in the local-only journey',
    externalRequests.length === 0 && browserErrors.length === 0,
    JSON.stringify({ externalRequests, browserErrors }));
}
