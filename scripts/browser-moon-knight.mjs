import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createEmptyState, createList, MAX_COLLECTION } from '../src/js/lib/model.js';
import { expectedMcuTitles } from '../test/helpers/current-reading-library.mjs';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const fixture = readJson(new URL('../test/fixtures/mcu-prep-moon-knight-browser-vector.json', import.meta.url));
const prior = readJson(new URL('../src/data/moon_knight_reading_order.json', import.meta.url));
const { id, name, rows: expected } = fixture;
const groups = [...new Set(expected.map((row) => row.section))];
const screenTitles = expectedMcuTitles();
const priorId = 'prior-moon-knight';
const issueNote = 'My existing Moon Knight issue note';
const guideNote = 'My existing complete-guide note';
const initial = createEmptyState();
initial.issues = Object.fromEntries(prior.items.map(({ collectedIn: _unused, ...item }) => [
  item.issueId, { ...item, source: 'curated' },
]));
initial.read[49077] = 1234;
initial.notes[49077] = issueNote;
initial.overrides[49078] = 'available';
initial.overrides[55575] = 'unavailable';
const seed = createList(initial, {
  id: priorId,
  name: prior.name,
  catalogId: prior.id,
  description: prior.description,
  note: guideNote,
  itemIds: prior.items.map((item) => item.issueId),
  collectedIn: Object.fromEntries(prior.items.map((item) => [item.issueId, item.collectedIn])),
});
assert.equal(expected.length, 17);
assert.equal(groups.length, 3);
assert.equal(new Set(expected.map((row) => row.issueId)).size, 17);
assert.ok(groups.every((group) => group.length <= MAX_COLLECTION));
assert.ok(expected.every((row) => seed.lists[priorId].itemIds.includes(row.issueId)));

async function click(page, selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (node) => node.click());
}

async function renderedRows(page, mode) {
  return page.$$eval(mode === 'preview' ? '#preview-body .preview-list > li' : '#rows > li',
    (nodes, view) => {
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
    }, mode);
}

async function stored(page) {
  return page.evaluate((catalogId, oldId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const matches = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = matches[0];
    return {
      matches: matches.length,
      listCount: state.listOrder.length,
      issueCount: Object.keys(state.issues).length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId].title,
        section: list.collectedIn[issueId] ?? null,
      })),
      prior: state.lists[oldId],
      read: state.read,
      notes: state.notes,
      overrides: state.overrides,
    };
  }, id, priorId);
}

function checkVector(t, label, actual) {
  const mismatches = actual.flatMap((row, index) => (
    JSON.stringify(row) === JSON.stringify(expected[index])
      ? [] : [{ position: index + 1, expected: expected[index], actual: row }]
  ));
  t.check(label, actual.length === 17 && mismatches.length === 0,
    JSON.stringify({ count: actual.length, mismatches: mismatches.slice(0, 3) }));
}

function checkPrior(t, label, snapshot) {
  t.check(label,
    JSON.stringify(snapshot.prior.itemIds) === JSON.stringify(seed.lists[priorId].itemIds)
      && JSON.stringify(snapshot.prior.collectedIn) === JSON.stringify(seed.lists[priorId].collectedIn)
      && snapshot.prior.note === guideNote
      && snapshot.read[49077] === 1234
      && snapshot.notes[49077] === issueNote
      && snapshot.overrides[49078] === 'available'
      && snapshot.overrides[55575] === 'unavailable',
    JSON.stringify({ priorCount: snapshot.prior.itemIds.length, read: snapshot.read, overrides: snapshot.overrides }));
}

export const moonKnightActualData = {
  id: 'mcu-prep-moon-knight-actual-data',
  title: 'Moon Knight owner shortlist preserves 17 originals, three volumes and existing shared progress',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) externalRequests.push(url.href);
    });
    await page.evaluateOnNewDocument((state) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!localStorage.getItem('mrt.state.v2')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(state));
      }
      window.__mrtBlockExternal = true;
    }, seed);
    const card = `#marvel-on-screen-results [data-story="list:${id}"]`;
    for (const viewport of [
      { width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 800 },
    ]) {
      await page.setViewport(viewport);
      for (const gateway of ['home', 'browse']) {
        const label = `${gateway} at ${viewport.width}x${viewport.height}`;
        await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
        if (gateway === 'browse') await click(page, '.ri[data-view="browse"]');
        const target = `#view-${gateway} [data-category="marvel-on-screen"]`;
        await page.waitForSelector(target, { visible: true });
        const tile = await page.$eval(target, (node) => ({
          text: node.textContent.trim(), name: node.getAttribute('aria-label'),
        }));
        t.check(`${label}: MCU Prep exposes every independent reading choice`,
          tile.text.includes('MCU Prep') && tile.name.includes(`${screenTitles.length} Reading Lists`),
          JSON.stringify(tile));
        await click(page, target);
        await page.waitForSelector(card);
        const actual = await page.$eval(card, (node) => ({
          title: node.querySelector('.catalog-card-title')?.textContent.trim(),
          text: node.textContent,
          credit: node.querySelector('a[href="https://github.com/raymond-nassar/recap-page/issues/685"]')?.href,
          path: Boolean(node.querySelector('.result-path')),
          action: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
          count: document.querySelectorAll('[data-story="list:mcu-prep-moon-knight"]').length,
          titles: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card-title')]
            .map((title) => title.textContent.trim()),
          hash: location.hash,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        t.check(`${label}: the owner-credited shortlist appears once without a reading path or horizontal overflow`,
          actual.title === name && actual.text.includes('17 issues') && actual.count === 1
            && actual.credit === 'https://github.com/raymond-nassar/recap-page/issues/685'
            && actual.action === `Add to library: ${name}` && !actual.path
            && actual.hash === `#/marvel-on-screen/${priorId}` && !actual.overflow
            && JSON.stringify([...actual.titles].sort()) === JSON.stringify([...screenTitles].sort()),
          JSON.stringify(actual));
        await click(page, `${card} [data-act="preview"]`);
        await page.waitForFunction(() =>
          document.querySelectorAll('#preview[open] .preview-issue-link').length === 17);
        const preview = await renderedRows(page, 'preview');
        checkVector(t, `${label}: Preview has every original in approved collection order`, preview.rows);
        t.check(`${label}: Preview retains all three collection headings`,
          JSON.stringify(preview.headings) === JSON.stringify(groups), JSON.stringify(preview.headings));
        await click(page, '#preview-close');
      }
    }
    const before = await stored(page);
    t.check('six discovery and Preview journeys do not import or change existing reading state',
      before.matches === 0 && before.listCount === 1 && before.issueCount === prior.items.length);
    checkPrior(t, 'discovery preserves the complete guide, read timestamp, note and both explicit overrides', before);

    await page.setViewport({ width: 390, height: 844 });
    await click(page, `${card} [data-act="preview"]`);
    await page.waitForFunction(() =>
      document.querySelectorAll('#preview[open] .preview-issue-link').length === 17);
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
      ?.textContent.includes('In library'));
    const imported = await stored(page);
    checkVector(t, 'import saves the exact independent 17-original, three-volume vector', imported.rows);
    t.check('import creates one new list without duplicating shared issue metadata',
      imported.matches === 1 && imported.listCount === 2 && imported.issueCount === prior.items.length);
    checkPrior(t, 'import leaves the complete guide and all prior shared reading choices intact', imported);

    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
      && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 17);
    const reading = await renderedRows(page, 'reading');
    checkVector(t, 'Reading List renders all 17 originals in the approved order', reading.rows);
    t.check('Reading List keeps all three full collection labels',
      JSON.stringify(reading.headings) === JSON.stringify(groups), JSON.stringify(reading.headings));
    await page.waitForSelector('#rows [data-act="read"][data-key="49077"][aria-pressed="true"]');

    await page.evaluate(() => {
      window.__opened = [];
      const button = document.querySelector('#rows [data-act="open"][data-key="49078"]');
      window.__dispatching = true;
      try {
        button.click();
        button.click();
      } finally {
        window.__dispatching = false;
      }
    });
    const opened = await page.evaluate(() => window.__opened);
    t.check('both Read gestures synchronously request separate blank-target local launcher tabs',
      opened.length === 2 && opened.every((entry) => entry.dispatching && entry.target === '_blank'
        && entry.features.includes('noopener')
        && new URL(entry.url).origin === page.__origin
        && new URL(entry.url).pathname === '/open.html'
        && new URL(entry.url).searchParams.get('i') === '49078'
        && new URL(entry.url).searchParams.get('d') === '33482'),
      JSON.stringify(opened));
    const launched = await stored(page);
    t.check('Read does not mark any comic complete',
      JSON.stringify(launched.read) === JSON.stringify(imported.read), JSON.stringify(launched.read));
    await click(page, '#rows [data-act="read"][data-key="49078"]');
    await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('mrt.state.v2')).read[49078]));
    const marked = await stored(page);
    t.check('explicit completion updates the shared original while preserving both list vectors',
      Boolean(marked.read[49078]) && marked.prior.itemIds.includes(49078)
        && JSON.stringify(marked.rows) === JSON.stringify(expected));
    checkPrior(t, 'completion preserves earlier progress, notes, overrides and the complete-guide layout', marked);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((title) =>
      document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 17);
    checkVector(t, 'reload renders all 17 originals and three collection groups', (await renderedRows(page, 'reading')).rows);
    const reloaded = await stored(page);
    checkVector(t, 'reload retains the complete persisted shortlist vector', reloaded.rows);
    checkPrior(t, 'reload preserves the original guide, issue note and distinct Unlimited overrides', reloaded);
    t.check('reload keeps one shortlist and the explicitly completed shared original',
      reloaded.matches === 1 && reloaded.listCount === 2 && Boolean(reloaded.read[49078]));
    const blocked = await page.evaluate(() => window.__mrtBlockedExternal ?? []);
    t.check('the actual-data journey has no external request, blocked lookup or browser error',
      externalRequests.length === 0 && blocked.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests, blocked, errors }));
  },
};
