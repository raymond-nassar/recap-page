import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { listLinkCoverage } from '../src/js/lib/libraryLinks.js';
import { LENDING_NOTE } from '../src/js/views/shared/library-link-filter.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const listOf = (id) => {
  const list = catalog.lists.find((entry) => entry.id === id);
  if (!list) throw new Error(`Missing library-link fixture: ${id}`);
  return { list, items: JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8')).items };
};
const linkedList = listOf('civil-war');
const plainList = listOf('house-of-m');
const linkedCount = listLinkCoverage(linkedList.list.id, linkedList.items).either;
if (!linkedCount || linkedCount === linkedList.items.length) throw new Error('The in-list fixture needs a partly linked order');
if (listLinkCoverage(plainList.list.id, plainList.items).either) throw new Error('The unlinked fixture gained links; choose another');

let state = createEmptyState();
for (const { list, items } of [linkedList, plainList]) {
  state = createList(state, { id: `links-${list.id}`, name: list.name, catalogId: list.id });
  state = addIssuesToList(state, `links-${list.id}`, items).state;
}
const seed = exportBackup(state);
const KEY = 'mrt.library-links.v1';
const click = (page, selector) => page.$eval(selector, (node) => node.click());
const cardTexts = (page, route) => page.$$eval(`#${route}-results .catalog-card`, (cards) =>
  cards.map((card) => card.querySelector('.catalog-card-links')?.textContent ?? null));

export const libraryLinksMutations = [
  {
    id: 'library-links-toggle-ignored',
    breaks: 'library-links',
    why: 'the in-list toggle stops filtering, so unlinked comics stay listed while it is on',
    rewriteReading: (source) => source.replace('&& (!linksOnly || linked.has(item.issueId))', ''),
  },
  {
    id: 'library-links-toggle-always-offered',
    breaks: 'library-links',
    why: 'the toggle is offered on a list with no checked links, where it could only empty the list',
    rewriteReading: (source) => source.replace('linksToggle.hidden = !linked.size;', 'linksToggle.hidden = false;'),
  },
  {
    id: 'library-links-category-offers-off',
    breaks: 'library-links',
    why: 'the Library links category gains an Off choice and stops filtering by default',
    rewriteMain: (source) => source.replace('always: category.route === LIBRARY_LINKS_ROUTE,', 'always: false,'),
  },
];

export const libraryLinks = {
  id: 'library-links',
  title: 'library-link filters, the Library links category and the in-list linked-comics toggle',
  async run(page, t) {
    page.__denyExternal = true;
    await page.evaluateOnNewDocument((saved) => {
      if (sessionStorage.getItem('links-seeded')) return;
      sessionStorage.setItem('links-seeded', '1');
      localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      localStorage.setItem('mrt.catalog.fixture', 'actual');
      window.__mrtBlockExternal = true;
    }, seed);

    await page.goto(`${page.__origin}/#/library-links`, { waitUntil: 'load' });
    await page.waitForSelector('#library-links-results .catalog-card');
    const always = await page.$$eval('#library-links-links input', (inputs) => inputs.map((input) => [input.name.split('-').at(-1), input.value, input.checked]));
    t.check('the category offers no Off choice and opens on any checked link',
      !always.some(([, value]) => value === 'off') && always.some(([group, value, checked]) => group === 'coverage' && value === 'any' && checked),
      JSON.stringify(always));
    const anyTexts = await cardTexts(page, 'library-links');
    t.check('every card in the category names its checked-link count against its full order',
      anyTexts.length > 0 && anyTexts.every((text) => /^[1-9]\d* of \d+ comics? with a checked .+ link/.test(text ?? '')),
      JSON.stringify(anyTexts.slice(0, 5)));
    const summary = await page.$eval('#library-links-links .link-filter-summary', (node) => ({
      hidden: node.hidden, text: node.textContent, reset: !!node.querySelector('button'),
    }));
    t.check('the summary carries the lending note and the category offers no Show all',
      !summary.hidden && summary.text.includes(LENDING_NOTE) && !summary.reset, JSON.stringify(summary));

    await page.setOfflineMode(true);
    await click(page, '#library-links-links input[value="every"]');
    await page.waitForFunction(() => document.querySelector('#library-links-links input[value="every"]')?.checked);
    const everyTexts = await cardTexts(page, 'library-links');
    t.check('offline, choosing every comic keeps only fully linked lists',
      everyTexts.length < anyTexts.length && everyTexts.every((text) => {
        const [, linked, total] = /^(\d+) of (\d+)/.exec(text ?? '') ?? [];
        return linked && linked === total;
      }), JSON.stringify({ any: anyTexts.length, every: everyTexts }));
    await page.setOfflineMode(false);
    const stored = await page.evaluate((key) => localStorage.getItem(key), KEY);
    t.check('the choice is remembered on this device under its own key',
      JSON.parse(stored ?? '{}').coverage === 'every', stored);

    await page.goto(`${page.__origin}/#/young-readers`, { waitUntil: 'load' });
    await page.waitForSelector('#young-readers-links .link-filter-summary button');
    const empty = await page.evaluate(() => ({
      cards: document.querySelectorAll('#young-readers-results .catalog-card').length,
      text: document.querySelector('#young-readers-results').textContent,
      every: document.querySelector('#young-readers-links input[value="every"]').checked,
    }));
    t.check('Young readers carries the remembered filter and explains its empty result',
      empty.every && empty.cards === 0 && /No Reading Lists/.test(empty.text), JSON.stringify(empty));
    await click(page, '#young-readers-links .link-filter-summary button');
    await page.waitForSelector('#young-readers-results .catalog-card');
    const reset = await page.evaluate(() => ({
      focus: document.activeElement?.value,
      inLinks: !!document.activeElement?.closest('#young-readers-links'),
      summaryHidden: document.querySelector('#young-readers-links .link-filter-summary').hidden,
    }));
    t.check('Show all clears the filter and keeps keyboard focus on the first coverage choice',
      reset.focus === 'off' && reset.inLinks && reset.summaryHidden, JSON.stringify(reset));

    for (const [id, linked] of [[linkedList.list.id, true], [plainList.list.id, false]]) {
      await page.goto(`${page.__origin}/#/read/links-${id}`, { waitUntil: 'load' });
      await page.waitForSelector('#full');
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForSelector('#rows .row');
      const toggle = await page.$eval('input[name="library-links-only"]', (input) => ({
        hidden: input.closest('label').hidden, checked: input.checked,
      }));
      t.check(`${id}: the linked-comics toggle is ${linked ? 'offered, off' : 'withheld'} on opening`,
        toggle.hidden === !linked && !toggle.checked, JSON.stringify(toggle));
      if (!linked) continue;
      const before = await page.$$eval('#rows .row', (rows) => rows.length);
      await click(page, 'input[name="library-links-only"]');
      await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, {}, linkedCount);
      const note = await page.$eval('#rows .link-only-note', (node) => node.textContent);
      t.check(`${id}: only linked comics show and the hidden gaps are named`,
        before > linkedCount && note.startsWith(`${before - linkedCount} `), JSON.stringify({ before, note }));
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#full');
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForSelector('#rows .row');
      const after = await page.evaluate(() => ({
        rows: document.querySelectorAll('#rows .row').length,
        checked: document.querySelector('input[name="library-links-only"]').checked,
      }));
      t.check(`${id}: reopening the list shows every comic again`,
        after.rows === before && !after.checked, JSON.stringify(after));
    }
  },
};
