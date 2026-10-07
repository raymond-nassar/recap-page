import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote,
} from '../src/js/lib/model.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';

const json = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const click = async (page, selector) => {
  await page.waitForSelector(selector);
  await page.$eval(selector, (element) => element.click());
};

export function ownerGuideScenario(contract) {
  const catalog = json('../src/data/catalog.json');
  const card = catalog.lists.find((entry) => entry.id === contract.id);
  assert.ok(card, 'The registered owner guide must be visible before browser validation.');
  const payload = json(`../src/data/${card.file}`);
  const expected = contract.rows.map((row, index) => ({
    position: index + 1, issueId: row[1], title: row[2],
    group: row[3] == null ? null : contract.groups[row[3]],
  }));
  assert.ok(expected.length);
  assert.deepEqual(payload.items.map((entry) => entry.issueId), expected.map((entry) => entry.issueId));
  const houseCard = catalog.lists.find((entry) => entry.id === 'house-of-m');
  const house = json(`../src/data/${houseCard.file}`);
  let seed = createList(createEmptyState(), {
    id: 'owner-existing', name: house.name, catalogId: house.id,
    note: 'Preserve my existing list note', description: 'Preserve my saved description',
  });
  seed = addIssuesToList(seed, 'owner-existing', house.items).state;
  const priorControl = house.items.find((item) => !expected.some((row) => row.issueId === item.issueId)) ?? house.items[0];
  seed = markRead(seed, priorControl.issueId, true, 123456);
  seed = setDeferred(seed, 'owner-existing', house.items[2].issueId);
  seed = createList(seed, { id: 'owner-shared', name: 'An existing selection' });
  seed = addIssuesToList(seed, 'owner-shared', [payload.items[0]]).state;
  if (expected.length > 1) seed = markRead(seed, payload.items[0].issueId, true, 123456);
  seed = setIssueNote(seed, payload.items[0].issueId, 'Preserve the original-level note');
  seed.overrides[priorControl.issueId] = 'unavailable';
  const nextOriginal = payload.items.find((item) => !seed.read[item.issueId]);
  assert.ok(nextOriginal, 'The shared owner journey needs one unread original.');
  const history = JSON.stringify({
    format: LIST_HISTORY_FORMAT, version: 1,
    records: [{ listId: 'owner-shared', created: seed.lists['owner-shared'].created,
      completedAt: 123457, rating: 'up' }],
  });
  const headings = expected.reduce((result, row, index) => {
    if (row.group && row.group !== expected[index - 1]?.group) result.push(row.group);
    return result;
  }, []);
  const readSaved = (page) => page.evaluate((stateKey, historyKey, id) => {
    const raw = localStorage.getItem(stateKey);
    const state = JSON.parse(raw);
    const matches = Object.values(state.lists).filter((entry) => entry.catalogId === id);
    const list = matches[0];
    return {
      raw, history: localStorage.getItem(historyKey), matches: matches.length,
      prior: state.lists['owner-existing'], shared: state.lists['owner-shared'],
      read: state.read, notes: state.notes, overrides: state.overrides, schemaVersion: state.schemaVersion,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1, issueId, title: state.issues[issueId].title,
        group: list.collectedIn?.[issueId] ?? null,
      })),
    };
  }, KEY, LIST_HISTORY_KEY, contract.id);
  const rendered = (page, preview) => page.$$eval(preview ? '#preview-body .preview-list > li' : '#rows > li', (nodes, preview) => {
    let group = null;
    const rows = [];
    const headings = [];
    for (const node of nodes) {
      const heading = node.querySelector(preview ? '.preview-group h4' : '.row-group .rg-name');
      if (heading) {
        group = heading.textContent.trim();
        headings.push(group);
      }
      const issue = node.querySelector(preview ? '.preview-issue-link' : '.rt');
      if (issue) rows.push({ position: rows.length + 1, issueId: Number(issue.dataset.issueId),
        title: issue.textContent.trim(), group });
    }
    return { rows, headings };
  }, preview);
  const checkSaved = (t, actual) => {
    t.check('import/reload keeps every accepted original and existing reader/history fact',
      actual.matches === 1 && actual.schemaVersion === seed.schemaVersion
      && isDeepStrictEqual(actual.rows, expected) && actual.history === history
      && isDeepStrictEqual(actual.prior, seed.lists['owner-existing'])
      && isDeepStrictEqual(actual.shared, seed.lists['owner-shared'])
      && isDeepStrictEqual(actual.read, seed.read) && isDeepStrictEqual(actual.notes, seed.notes)
      && isDeepStrictEqual(actual.overrides, seed.overrides), JSON.stringify(actual));
  };
  return {
    id: `owner-guide-${contract.id}`,
    title: `Registered owner guide: ${contract.name}`,
    async run(page, t) {
      const errors = [];
      const external = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(url.origin);
      });
      await page.evaluateOnNewDocument((stateKey, state, historyKey, savedHistory) => {
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
        if (!localStorage.getItem(stateKey)) localStorage.setItem(stateKey, JSON.stringify(state));
        if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, savedHistory);
        window.__mrtBlockExternal = true;
      }, KEY, seed, LIST_HISTORY_KEY, history);
      const selector = `#marvel-on-screen-results [data-story="list:${contract.id}"]`;
      for (const width of [1280, 360]) {
        await page.setViewport({ width, height: 900 });
        await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
        await page.waitForSelector('#home-primary-paths .home-path');
        await page.$eval('#home-more-paths', (node) => { node.open = true; });
        await click(page, '#view-home [data-category="marvel-on-screen"]');
        await page.waitForSelector(selector);
        t.check(`Home exposes the accepted card once at ${width}px`, await page.$$eval(selector, (nodes) => nodes.length) === 1);
        await click(page, '.ri[data-view="browse"]');
        await click(page, '#view-browse [data-category="marvel-on-screen"]');
        await page.waitForSelector(selector);
        const cardFacts = await page.$eval(selector, (node, url) => ({
          name: node.querySelector('.catalog-card-title')?.textContent.trim(),
          source: [...node.querySelectorAll('a')].find((link) => link.href === url)?.href,
        }), contract.sourceUrl);
        t.check(`Browse retains the independent name and owner source at ${width}px`,
          cardFacts.name === contract.name && cardFacts.source === contract.sourceUrl, JSON.stringify(cardFacts));
        const before = await readSaved(page);
        await click(page, `${selector} [data-act="preview"]`);
        await page.waitForFunction((count) =>
          document.querySelectorAll('#preview[open] .preview-issue-link').length === count, {}, expected.length);
        t.check(`Preview preserves the independent whole-original vector and groups at ${width}px`,
          isDeepStrictEqual(await rendered(page, true), { rows: expected, headings }));
        const preview = await page.evaluate(() => ({
          description: document.querySelector('#preview-desc')?.textContent.trim(),
          source: document.querySelector('#preview-source a')?.href,
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        }));
        t.check(`Preview preserves approved copy, source and narrow layout at ${width}px`,
          preview.description === contract.description && preview.source === contract.sourceUrl
          && preview.scrollWidth <= preview.width, JSON.stringify(preview));
        const after = await readSaved(page);
        t.check(`Preview does not write reader or completion history at ${width}px`,
          before.raw === after.raw && before.history === after.history);
        if (width === 1280) await click(page, '#preview-close');
      }
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() =>
        document.querySelector('#preview-add [data-act="main"]')?.textContent.includes('In library'));
      checkSaved(t, await readSaved(page));
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((name) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === name, {}, contract.name);
      for (const width of [1280, 360]) {
        await page.setViewport({ width, height: 900 });
        await page.$eval('#full', (node) => { node.open = true; });
        await page.waitForFunction((count) => document.querySelectorAll('#rows .row').length === count, {}, expected.length);
        t.check(`Reading List retains all originals and groups at ${width}px`,
          isDeepStrictEqual(await rendered(page, false), { rows: expected, headings }));
        t.check(`Reading List fits at ${width}px`,
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction((name) => document.querySelector('#order-name')?.textContent.trim() === name, {}, contract.name);
      checkSaved(t, await readSaved(page));
      await page.evaluate(() => {
        window.__dispatching = true;
        document.querySelector('#btn-hero-read').click();
        document.querySelector('#btn-hero-read').click();
        window.__dispatching = false;
      });
      const opened = await page.evaluate(() => window.__opened);
      t.check('reader launch remains synchronous with separate tabs and no per-story identity',
        opened.length === 2 && opened.every((entry) => entry.dispatching && entry.target === '_blank'
          && entry.features === 'noopener' && new URL(entry.url).origin === page.__origin
          && (new URL(entry.url).searchParams.get('i') === String(nextOriginal.issueId)
            || (nextOriginal.digitalId != null
              && new URL(entry.url).searchParams.get('d') === String(nextOriginal.digitalId)))), JSON.stringify(opened));
      t.check('the owner journey stays isolated with no browser errors', errors.length === 0 && external.length === 0,
        JSON.stringify({ errors, external }));
    },
  };
}
