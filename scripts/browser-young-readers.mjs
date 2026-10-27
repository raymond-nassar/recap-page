import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { waitForSavedPreviewLink } from './browser-owner-guide.mjs';
import { KEY } from '../src/js/storage.js';

const json = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const click = async (page, selector) => {
  await page.waitForSelector(selector);
  await page.$eval(selector, (element) => element.click());
};
const GUIDE = 'https://www.comicbookherald.com/best-marvel-comics-for-kids/';

// #898. The seven young readers' lists from Comic Book Herald's guide, through the journey a reader
// takes: find the card on Young readers, its own page since #897, preview it, add it, open it and reload. Expected
// order comes from the independent vectors the delivery's unit test also uses, not from the payloads
// being checked. The owner's eight picks are covered by their registered owner-guide scenarios.
const catalog = json('../src/data/catalog.json');
const guides = json('../test/fixtures/young-readers-vectors.json').lists
  .filter((vector) => vector.source === 'comic-book-herald')
  .map((vector) => {
    const card = catalog.lists.find((entry) => entry.id === vector.id);
    const gaps = new Map(vector.gaps);
    const ids = [...vector.issueIds];
    const expected = Array.from({ length: ids.length + gaps.size }, (_, index) => (gaps.has(index + 1)
      ? `${index + 1}:gap:${gaps.get(index + 1)}` : `${index + 1}:${ids.shift()}`));
    return { id: vector.id, name: card.name, gaps: gaps.size, expected };
  });
// A gap is a placeholder with a synthetic negative id, so it is matched by its position and title.
const keyOf = ({ position, issueId, title }) => (issueId < 0 ? `${position}:gap:${title}` : `${position}:${issueId}`);

export const youngReadersActualData = {
  id: 'young-readers-actual-data',
  title: 'the seven Comic Book Herald young readers\' lists keep their accepted order and gaps through preview, import and reload',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(url.origin);
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#home-primary-paths .home-path');
    t.check('the seven Comic Book Herald lists are under test', guides.length === 7, JSON.stringify(guides.map(({ id }) => id)));

    // #897. Young readers is the one screen for every young readers' list, so Character spotlights,
    // where these were found before it existed, no longer shows any of them.
    const everyYoung = json('../test/fixtures/young-readers-vectors.json').lists.map(({ id }) => `list:${id}`).sort();
    const homeCard = await page.$eval('#view-home [data-category="young-readers"]', (node) => ({
      title: node.querySelector('.home-path-title')?.textContent.trim(),
      count: node.querySelector('.home-path-count')?.textContent.trim(),
    }));
    await click(page, '#view-home:not([hidden]) [data-category="young-readers"]');
    await page.waitForSelector('#young-readers-results .catalog-card');
    const youngShelf = await page.evaluate(() => ({
      heading: document.querySelector('#young-readers-h')?.textContent.trim(),
      cards: [...document.querySelectorAll('#young-readers-results .catalog-card')].map((card) => card.dataset.story),
    }));
    await click(page, '.brand[data-view="home"]');
    await click(page, '#view-home:not([hidden]) [data-category="character-spotlights"]');
    await page.waitForSelector('#spotlights-results .catalog-card');
    const spotlightCards = await page.$$eval('#spotlights-results .catalog-card', (cards) => cards.map((card) => card.dataset.story));
    t.check('Young readers is the one screen for all fifteen young readers\' lists',
      homeCard.title === 'Young readers' && homeCard.count === '15 Reading Lists'
      && youngShelf.heading === 'Young readers' && isDeepStrictEqual([...youngShelf.cards].sort(), everyYoung)
      && spotlightCards.length === 71 && !spotlightCards.some((story) => everyYoung.includes(story)),
      JSON.stringify({ homeCard, young: youngShelf.cards.length, spotlights: spotlightCards.length }));

    const stored = (catalogId) => page.evaluate((key, id) => {
      const state = JSON.parse(localStorage.getItem(key));
      const matches = Object.values(state.lists).filter((list) => list.catalogId === id);
      return {
        matches: matches.length,
        rows: (matches[0]?.itemIds ?? []).map((issueId, index) => ({
          position: index + 1, issueId, title: state.issues[issueId]?.title,
        })),
      };
    }, KEY, catalogId);
    const rendered = () => page.$$eval('#rows .row', (nodes) => nodes.map((node, index) => ({
      position: index + 1,
      issueId: Number(node.querySelector('.rt')?.dataset.issueId),
      title: node.querySelector('.rt')?.textContent.trim(),
    })));
    const matches = (guide, rows) => isDeepStrictEqual(rows.map(keyOf), guide.expected);

    for (const guide of guides) {
      const total = guide.expected.length;
      await click(page, '.brand[data-view="home"]');
      await click(page, '#view-home:not([hidden]) [data-category="young-readers"]');
      await page.waitForSelector('#young-readers-q');
      await page.$eval('#young-readers-q', (input, name) => {
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, guide.name);
      const selector = `#young-readers-results [data-story="list:${guide.id}"]`;
      await page.waitForSelector(selector, { timeout: 15000 });
      const card = await page.$eval(selector, (node, url) => ({
        name: node.querySelector('.catalog-card-title')?.textContent.trim(),
        text: node.textContent,
        source: [...node.querySelectorAll('a')].find((link) => link.href === url)?.getAttribute('aria-label'),
        add: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
      }), GUIDE);
      t.check(`${guide.name} is found on Young readers with ${total} issues and Comic Book Herald credit`,
        card.name === guide.name && card.text.includes(`${total} issues`)
        && card.source === `Source of ${guide.name}: Comic Book Herald` && card.add === `Add to library: ${guide.name}`
        && card.text.includes('no Marvel Unlimited links yet') === (guide.gaps > 0), JSON.stringify({ ...card, text: undefined }));

      await click(page, `${selector} [data-act="preview"]`);
      await page.waitForFunction((count) =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === count, {}, total);
      const preview = await page.$$eval('#preview-body .preview-issue-link', (nodes) => nodes.map((node) => ({
        position: Number(node.closest('li')?.querySelector('.pn')?.textContent),
        issueId: Number(node.dataset.issueId),
        title: node.textContent.trim(),
        external: Number(node.dataset.issueId) < 0 && /^https?:/.test(node.getAttribute('href') ?? ''),
      })));
      const previewSource = await page.$eval('#preview-source a', (node) => node.href).catch(() => null);
      t.check(`${guide.name} Preview shows the accepted order with its gaps in place, credited to the guide`,
        matches(guide, preview) && preview.every((row) => !row.external) && previewSource === GUIDE,
        JSON.stringify({ first: preview.slice(0, 2), previewSource }));

      await click(page, '#preview-add [data-act="main"]');
      await waitForSavedPreviewLink(page, guide.id);
      const imported = await stored(guide.id);
      t.check(`${guide.name} import saves one Reading List with every position and gap`,
        imported.matches === 1 && matches(guide, imported.rows), JSON.stringify({ matches: imported.matches, count: imported.rows.length }));

      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((name) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === name, {}, guide.name);
      await page.$eval('#full', (node) => { node.open = true; });
      await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, {}, total);
      t.check(`${guide.name} Reading List renders every position in order`, matches(guide, await rendered()));
      const gapActions = await page.$$eval('#rows .row', (nodes) => nodes
        .filter((node) => Number(node.querySelector('.rt')?.dataset.issueId) < 0)
        .map((node) => ({
          readHidden: node.querySelector('.ract button[data-act="open"]')?.hidden,
          hasInfo: Boolean(node.querySelector('.ract a[data-act="info"]')),
        })));
      t.check(`${guide.name} gaps offer neither Read nor Info`, gapActions.length === guide.gaps
        && gapActions.every((row) => row.readHidden && !row.hasInfo), JSON.stringify(gapActions));

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction((name) =>
        document.querySelector('#order-name')?.textContent.trim() === name, {}, guide.name);
      await page.$eval('#full', (node) => { node.open = true; });
      await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, {}, total);
      const reloaded = await stored(guide.id);
      t.check(`${guide.name} reload keeps one saved list and every rendered position`,
        reloaded.matches === 1 && matches(guide, reloaded.rows) && matches(guide, await rendered()),
        JSON.stringify({ matches: reloaded.matches }));
    }
    t.check('the young readers\' journeys make no external request and raise no browser error',
      errors.length === 0 && external.length === 0, JSON.stringify({ errors: errors.slice(0, 3), external: external.slice(0, 3) }));
  },
};
