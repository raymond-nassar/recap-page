import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { listLinkCoverage } from '../src/js/lib/libraryLinks.js';
import { LENDING_NOTE, PAGE_LINK_TEXT } from '../src/js/views/shared/library-link-filter.js';

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
const cardCounts = (page, route) => page.$$eval(`#${route}-results .catalog-card`, (cards) =>
  cards.map((card) => [card.dataset.story, card.querySelector('.catalog-card-links')?.textContent ?? null]));
const listCount = new Map(catalog.lists.map((list) => [`list:${list.id}`, list.count]));

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
  {
    id: 'library-links-toggle-survives-return',
    breaks: 'library-links',
    why: 'the in-list switch stays on when the reader leaves the list and comes back in the app',
    rewriteMain: (source) => source.replace("if (next === 'read' && view !== 'read') readingView.resetLinksOnly();", ''),
  },
  {
    id: 'library-links-strip-ignores-toggle',
    breaks: 'library-links',
    why: 'the order strip keeps counting the full order while the switch hides unlinked comics',
    rewriteReading: (source) => source.replace('linksOnly ? items.length : null', 'null'),
  },
  {
    id: 'library-links-toggle-silent',
    breaks: 'library-links',
    why: 'the switch hides comics without announcing how many',
    rewriteReading: (source) => source.replace('if (linksOnly && linksHidden) announce(hiddenSentence(linksHidden));', ''),
  },
  {
    id: 'library-links-page-unreachable',
    breaks: 'library-links',
    why: 'the browsing filters lose their link, leaving the Library links page with no way in',
    rewriteMain: (source) => source.replace('pageLink: (text) =>', 'unusedPageLink: (text) =>'),
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

    await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#view-home [data-category]');
    const homeEntry = await page.evaluate(() => [...document.querySelectorAll('#view-home a, #view-home button')]
      .filter((node) => node.dataset.category === 'library-links' || node.getAttribute('href') === '#/library-links').length);
    t.check('Home offers no way into the Library links page', homeEntry === 0, String(homeEntry));

    await page.goto(`${page.__origin}/#/catalog`, { waitUntil: 'load' });
    await page.waitForSelector('#catalog-links .link-filter-more a');
    const entry = await page.$eval('#catalog-links .link-filter-more a', (link) => ({
      text: link.textContent, hash: link.hash, visible: !!link.getClientRects().length,
      off: document.querySelector('#catalog-links input[value="off"]')?.checked,
    }));
    t.check('the unfiltered Modern Timeline links to the Library links page from its filter',
      entry.text === PAGE_LINK_TEXT && entry.hash === '#/library-links' && entry.visible && entry.off, JSON.stringify(entry));
    await page.evaluate(() => document.querySelector('#catalog-links .link-filter-more a').click());
    await page.waitForSelector('#library-links-results .catalog-card');
    const arrival = await page.evaluate(() => {
      const view = document.querySelector('.view:not([hidden])');
      const heading = view?.querySelector('h1, h2');
      return {
        hash: location.hash,
        heading: heading?.textContent.trim(),
        focused: !!heading && document.activeElement === heading,
        crumbs: [...(view?.querySelectorAll('.breadcrumb li') ?? [])].map((item) => item.textContent.trim()),
        link: !!view?.querySelector('.link-filter-more'),
      };
    });
    t.check('following the link opens the Library links page with focus on its heading, under Home',
      arrival.hash.startsWith('#/library-links') && arrival.heading === 'Browse Library links' && arrival.focused
        && JSON.stringify(arrival.crumbs) === '["Home","Library links"]' && !arrival.link, JSON.stringify(arrival));
    const always = await page.$$eval('#library-links-links input', (inputs) => inputs.map((input) => [input.name.split('-').at(-1), input.value, input.checked]));
    t.check('the category offers no Off choice and opens on any checked link',
      !always.some(([, value]) => value === 'off') && always.some(([group, value, checked]) => group === 'coverage' && value === 'any' && checked),
      JSON.stringify(always));
    const anyCards = await cardCounts(page, 'library-links');
    const anyTexts = anyCards.map(([, text]) => text);
    const miscounted = anyCards.filter(([story, text]) => {
      const [, linked, total] = /^(\d+) of (\d+) comics? with a checked .+ link/.exec(text ?? '') ?? [];
      return !linked || Number(linked) < 1 || Number(total) !== listCount.get(story);
    });
    t.check('every card in the category counts its checked links against its own list',
      anyCards.length > 0 && !miscounted.length
        && anyCards.some(([story, text]) => story === 'list:civil-war-essential' && text?.startsWith('7 of 7 '))
        && !anyCards.some(([story]) => story === 'list:secret-invasion-essential'),
      JSON.stringify({ miscounted: miscounted.slice(0, 5), cards: anyCards.length }));
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
    t.check('a coverage choice on the category is not saved for other pages',
      JSON.parse(stored ?? '{"coverage":"off"}').coverage === 'off', stored);
    await click(page, '#library-links-links input[value="any"]');

    await page.goBack();
    const back = await page.waitForFunction(() => location.hash.startsWith('#/catalog')
      && !document.querySelector('#view-catalog').hidden, { timeout: 5000 }).then(() => true, () => false);
    t.check('Back returns from the Library links page to the Modern Timeline', back);

    await page.goto(`${page.__origin}/#/young-readers`, { waitUntil: 'load' });
    await page.waitForSelector('#young-readers-results .catalog-card');
    const optIn = await page.$eval('#young-readers-links input[value="off"]', (input) => input.checked);
    t.check('other pages still open unfiltered after a choice on the category', optIn, String(optIn));
    await click(page, '#young-readers-links input[value="every"]');
    await page.waitForSelector('#young-readers-links .link-filter-summary button');
    const empty = await page.evaluate(() => ({
      cards: document.querySelectorAll('#young-readers-results .catalog-card').length,
      text: document.querySelector('#young-readers-results').textContent,
      every: document.querySelector('#young-readers-links input[value="every"]').checked,
    }));
    t.check('Young readers explains its empty result with the page heading',
      empty.every && empty.cards === 0
        && empty.text.includes('No Reading Lists in Young readers where every comic has a checked'),
      JSON.stringify(empty));
    const remembered = await page.evaluate((key) => localStorage.getItem(key), KEY);
    t.check('a choice on an opt-in page is remembered on this device under its own key',
      JSON.parse(remembered ?? '{}').coverage === 'every', remembered);
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
      await page.focus('input[name="library-links-only"]');
      await page.keyboard.press('Space');
      await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, {}, linkedCount);
      const note = await page.$eval('#rows .link-only-note', (node) => node.textContent);
      t.check(`${id}: only linked comics show and the hidden gaps are named`,
        before > linkedCount && note.startsWith(`${before - linkedCount} `), JSON.stringify({ before, note }));
      const hiddenSentence = `${before - linkedCount} comics without a checked library link are hidden.`;
      await page.waitForFunction((text) => document.querySelector('#announcer')?.textContent === text, { timeout: 3000 }, hiddenSentence)
        .catch(() => {});
      const spoken = await page.evaluate(() => ({
        announced: document.querySelector('#announcer')?.textContent,
        focus: document.activeElement?.name,
        strip: document.querySelector('#full .order-shown')?.textContent ?? null,
      }));
      t.check(`${id}: the switch announces the hidden comics, keeps focus and counts what it shows`,
        spoken.announced === hiddenSentence && spoken.focus === 'library-links-only'
          && spoken.strip === `Showing ${linkedCount} of ${before} comics.`, JSON.stringify(spoken));

      // In-app navigation rather than a reload, so state held by the view is what is tested.
      await page.evaluate(() => { window.__sameDocument = true; });
      await click(page, '.brand[data-view="home"]');
      await page.waitForFunction(() => !document.querySelector('#view-home')?.hidden);
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, { timeout: 5000 }, before)
        .catch(() => {});
      const after = await page.evaluate(() => ({
        sameDocument: window.__sameDocument === true,
        rows: document.querySelectorAll('#rows .row').length,
        checked: document.querySelector('input[name="library-links-only"]').checked,
      }));
      t.check(`${id}: coming back to the list in the app shows every comic again`,
        after.sameDocument && after.rows === before && !after.checked, JSON.stringify(after));
    }

    await page.evaluate(async () => {
      const { editionEvidence } = await import('/data/collectedEditionEvidence.js');
      window.__linkedCoverage = editionEvidence.linkCoverage;
      editionEvidence.linkCoverage = {};
      location.hash = '#/catalog';
    });
    try {
      await page.waitForFunction(() => !document.querySelector('#view-catalog')?.hidden);
      await click(page, '#catalog-links .link-filter-more a');
      await page.waitForFunction(() => !document.querySelector('#view-library-links')?.hidden);
      const emptyCoverage = await page.evaluate(() => ({
        cards: document.querySelectorAll('#library-links-results .catalog-card').length,
        text: document.querySelector('#library-links-results').textContent.trim(),
        coverageVisible: !!document.querySelector('#library-links-links input[value="any"]')?.getClientRects().length,
        providerVisible: !!document.querySelector('#library-links-links input[value="either"]')?.getClientRects().length,
      }));
      t.check('with no checked links anywhere, the page keeps its filters and its headed linked empty result',
        emptyCoverage.cards === 0
          && emptyCoverage.text === 'No Reading Lists in Library links with at least one checked Hoopla or Libby link.'
          && emptyCoverage.coverageVisible && emptyCoverage.providerVisible, JSON.stringify(emptyCoverage));
    } finally {
      await page.evaluate(async () => {
        const { editionEvidence } = await import('/data/collectedEditionEvidence.js');
        editionEvidence.linkCoverage = window.__linkedCoverage;
        delete window.__linkedCoverage;
      });
    }
  },
};
