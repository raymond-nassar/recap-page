import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  addIssuesToList, createEmptyState, createList, setDeferred,
} from '../src/js/lib/model.js';
import { firstSentence } from '../src/js/lib/catalog.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';

const json = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const identityRevisions = json('scripts/data/owner-identity-revisions.json');
const edits = json('scripts/data/mcu-prep-description-revision.json').entries.map((edit) => {
  const identity = identityRevisions.guides.find(({ id }) => id === edit.id);
  return { ...edit, after: identity?.publishedDescription ?? identity?.description ?? edit.after };
});
const catalog = json('src/data/catalog.json');
const orders = new Map(edits.map((edit) => [edit.id, json(`src/data/${edit.file}`)]));
const companions = catalog.lists.filter((row) => row.type === 'screen-companion');
const untouched = companions.filter((row) => !edits.some((edit) => edit.id === row.id));
const retiredOrder = json('src/data/marvel_multiverse.json');
const cardSelector = (id) => `#marvel-on-screen-results [data-story="list:${id}"]`;
let previous = createEmptyState();
for (const edit of edits) {
  const order = orders.get(edit.id);
  const id = `previous-${edit.id}`;
  previous = createList(previous, {
    id, catalogId: edit.id, name: order.name, description: edit.before, note: `My note for ${edit.id}`,
  });
  previous = addIssuesToList(previous, id, order.items).state;
}
previous = {
  ...previous,
  read: Object.fromEntries(Object.keys(previous.issues).map((id) => [id, 123456])),
  notes: { 43170: 'Keep my Spider-Man issue note.' },
  overrides: { 43170: 'unavailable' },
};
let personal = createList(createEmptyState(), {
  id: 'personal', name: 'My saved Spidey reading', description: 'Keep my personal saved description.',
  note: 'Keep my list note.',
});
personal = addIssuesToList(personal, 'personal', [
  { ...json('src/data/spider_man_no_way_home.json').items[0], collectedIn: 'My own section' },
]).state;
personal = { ...personal, read: { 43170: 123456 }, notes: previous.notes, overrides: previous.overrides };

const history = (state) => JSON.stringify({
  format: LIST_HISTORY_FORMAT, version: 1,
  records: Object.values(state.lists).map((list) => ({
    listId: list.id, created: list.created, catalogId: list.catalogId, completedAt: 123457, rating: 'up',
  })),
});
const previousHistory = history(previous);
const personalHistory = history(personal);
let retired = createList(personal, {
  id: 'saved-multiverse', catalogId: retiredOrder.id, name: 'My saved multiverse',
  description: 'My original saved description.', note: 'Keep my multiverse list note.',
});
retired = addIssuesToList(retired, 'saved-multiverse', retiredOrder.items).state;
retired = setDeferred(retired, 'saved-multiverse', retiredOrder.items[1].issueId);
retired = {
  ...retired, active: 'saved-multiverse',
  read: { ...retired.read, [retiredOrder.items[0].issueId]: 123456 },
  notes: { ...retired.notes, [retiredOrder.items[1].issueId]: 'Keep my future-past note.' },
  overrides: { ...retired.overrides, [retiredOrder.items[1].issueId]: 'unavailable' },
};
const retiredHistory = history(retired);
const click = async (page, selector) => {
  await page.waitForSelector(selector);
  await page.$eval(selector, (node) => node.click());
};
const stored = (page) => page.evaluate((key, historyKey) => ({
  state: JSON.parse(localStorage.getItem(key)), history: localStorage.getItem(historyKey),
}), KEY, LIST_HISTORY_KEY);

function checkProtected(t, label, actual, expected, expectedHistory) {
  for (const [id, list] of Object.entries(expected.lists)) {
    t.check(`${label}: ${id} retains its saved description and complete list`,
      isDeepStrictEqual(actual.state.lists[id], list), JSON.stringify(actual.state.lists[id]));
  }
  t.check(`${label}: read marks, issue notes, overrides and separate completion/enjoyment history stay unchanged`,
    isDeepStrictEqual(actual.state.read, expected.read)
    && isDeepStrictEqual(actual.state.notes, expected.notes)
    && isDeepStrictEqual(actual.state.overrides, expected.overrides)
    && actual.history === expectedHistory);
}

export const mcuPrepDescriptions = {
  id: 'mcu-prep-descriptions',
  title: 'exact MCU recommendations on cards, Preview and new imports without rewriting saved descriptions',
  operations: ['withdrawn-fixture-write', 'withdrawn-fixture-reload', 'withdrawn-route-open', 'withdrawn-route-ready'],
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.evaluateOnNewDocument((key, state, historyKey, historyText) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
      if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, historyText);
      window.__mrtBlockExternal = true;
    }, KEY, previous, LIST_HISTORY_KEY, previousHistory);
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    const homeGateway = '#view-home [data-category="marvel-on-screen"]';
    await click(page, homeGateway);
    await page.waitForSelector(cardSelector(edits[0].id));
    for (const [surface, width] of [['Home', 1280], ['Browse address', 360]]) {
      await page.setViewport({ width, height: 900 });
      if (surface === 'Browse address') {
        await page.evaluate(() => { location.hash = '#/browse'; });
        await click(page, '#view-home:not([hidden]) [data-category="marvel-on-screen"]');
        await page.waitForSelector(cardSelector(edits[0].id));
      }
      const cards = await page.$$eval('#marvel-on-screen-results .catalog-card', (nodes) => nodes.map((node) => ({
        id: node.dataset.story.slice('list:'.length),
        description: node.querySelector('.catalog-card-desc').textContent.trim(),
      })));
      t.check(`${surface}: all active MCU choices appear once without the retired owner guide`,
        isDeepStrictEqual(cards.map((row) => row.id).sort(), companions.map((row) => row.id).sort())
        && !cards.some((row) => row.id === 'spider-man-no-way-home-owner-selected'));
      for (const edit of edits) {
        const actual = cards.find((row) => row.id === edit.id)?.description;
        t.check(`${surface}: ${edit.id} shows the exact refreshed first sentence`,
          actual === firstSentence(edit.after), actual);
      }
      for (const entry of untouched) {
        t.check(`${surface}: ${entry.id} keeps its existing first sentence`,
          cards.find((row) => row.id === entry.id)?.description === firstSentence(entry.description));
      }
      const fit = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth <= window.innerWidth + 1,
        cards: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card')].every((card) => {
          const rect = card.getBoundingClientRect();
          return rect.width > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1;
        }),
      }));
      t.check(`${width}px generated recommendation cards wrap without page or card overflow`, fit.page && fit.cards);
      if (process.env.MRT_MCU_COPY_EVIDENCE) {
        await page.screenshot({ path: `${process.env.MRT_MCU_COPY_EVIDENCE}-${width}.png` });
      }
    }
    await page.setViewport({ width: 1280, height: 900 });
    for (const entry of companions) {
      const expected = edits.find((edit) => edit.id === entry.id)?.after ?? entry.description;
      await click(page, `${cardSelector(entry.id)} [data-act="preview"]`);
      await page.waitForSelector('#preview[open] .preview-issue-link');
      const actual = await page.$eval('#preview-desc', (node) => node.textContent.trim());
      t.check(`Preview: ${entry.id} shows the exact full description`, actual === expected, actual);
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview').open);
    }
    checkProtected(t, 'After browsing and Preview', await stored(page), previous, previousHistory);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(cardSelector(edits[0].id));
    checkProtected(t, 'After existing-list reload', await stored(page), previous, previousHistory);

    await page.evaluate((key, state, historyKey, historyText) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(historyKey, historyText);
    }, KEY, personal, LIST_HISTORY_KEY, personalHistory);
    await page.reload({ waitUntil: 'load' });
    for (const edit of edits) {
      await click(page, `${cardSelector(edit.id)} [data-act="import"]`);
      await page.waitForFunction((key, id) => {
        const state = JSON.parse(localStorage.getItem(key));
        return !document.querySelector('#view-read').hidden
          && state.lists[state.active]?.catalogId === id && state.lists[state.active].itemIds.length > 0;
      }, {}, KEY, edit.id);
      const actual = await stored(page);
      const matches = Object.values(actual.state.lists).filter((list) => list.catalogId === edit.id);
      const saved = matches[0];
      t.check(`${edit.id}: newly imported list uses the exact refreshed description`,
        matches.length === 1 && saved.description === edit.after, saved?.description);
      const order = orders.get(edit.id);
      t.check(`${edit.id}: new import retains the exact original issue and group vector`,
        isDeepStrictEqual(saved?.itemIds, order.items.map((item) => item.issueId))
        && isDeepStrictEqual(saved?.collectedIn, Object.fromEntries(order.items
          .filter((item) => item.collectedIn).map((item) => [item.issueId, item.collectedIn]))));
      await page.goto(`${page.__origin}/?catalog=actual#/marvel-on-screen`, { waitUntil: 'load' });
      await page.waitForSelector(cardSelector(edits[0].id));
    }
    const imported = await stored(page);
    t.check('The thirty fresh imports have independent saved-list identities',
      Object.keys(imported.state.lists).length === edits.length + 1);
    checkProtected(t, 'After new imports', imported, personal, personalHistory);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(cardSelector(edits[0].id));
    const reloaded = await stored(page);
    for (const edit of edits) {
      const saved = Object.values(reloaded.state.lists).find((list) => list.catalogId === edit.id);
      t.check(`${edit.id}: reloaded new import keeps the exact refreshed description`,
        saved?.description === edit.after, saved?.description);
    }
    t.check('All newly imported list fields survive reload',
      isDeepStrictEqual(reloaded.state.lists, imported.state.lists));
    checkProtected(t, 'After new-import reload', reloaded, personal, personalHistory);

    await t.step('withdrawn-fixture-write', () => page.evaluate((key, state, historyKey, historyText) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(historyKey, historyText);
    }, KEY, retired, LIST_HISTORY_KEY, retiredHistory));
    await t.step('withdrawn-fixture-reload', () => page.reload({ waitUntil: 'load' }));
    await t.step('withdrawn-route-open', () => page.goto(
      `${page.__origin}/?catalog=actual#/read/saved-multiverse?full=1&filter=all`, { waitUntil: 'load' },
    ));
    await t.step('withdrawn-route-ready', () => page.waitForFunction(
      (name) => document.querySelector('#order-name')?.textContent.trim() === name
        && document.querySelectorAll('#rows .rt').length === 2, {}, retired.lists['saved-multiverse'].name,
    ));
    const route = await page.evaluate((key) => ({
      hash: location.hash, active: JSON.parse(localStorage.getItem(key)).active,
      lists: Object.keys(JSON.parse(localStorage.getItem(key)).lists),
      rows: [...document.querySelectorAll('#rows .rt')].map((node) => Number(node.dataset.issueId)),
    }), KEY);
    t.check('The saved withdrawal fixture loads as the active reading route',
      route.active === 'saved-multiverse' && route.rows.includes(retiredOrder.items[0].issueId), JSON.stringify(route));
    checkProtected(t, 'Withdrawn list after startup', await stored(page), retired, retiredHistory);
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    const rendered = await page.$$eval('#rows .rt', (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('The withdrawn saved list still renders both exact originals in order',
      isDeepStrictEqual(rendered, retiredOrder.items.map((item) => item.issueId)), JSON.stringify(rendered));
    await page.goto(`${page.__origin}/?catalog=actual#/library`, { waitUntil: 'load' });
    await page.waitForSelector('a[href="#/read/saved-multiverse"]');
    await click(page, 'a[href="#/read/saved-multiverse"]');
    await page.goto(`${page.__origin}/?catalog=actual#/read/saved-multiverse?full=1&filter=all`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#rows .rt').length === 2);
    const issueId = retiredOrder.items[0].issueId;
    await click(page, `#rows [data-act="read"][data-key="${issueId}"]`);
    await page.waitForFunction((key, id) => !JSON.parse(localStorage.getItem(key)).read[id], {}, KEY, issueId);
    const edited = await stored(page);
    const expectedRetired = { ...retired, read: { ...retired.read } };
    delete expectedRetired.read[issueId];
    checkProtected(t, 'After editing withdrawn progress', edited, expectedRetired, retiredHistory);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-read:not([hidden])');
    checkProtected(t, 'Withdrawn list after reload', await stored(page), expectedRetired, retiredHistory);
    const backup = await page.evaluate(async (key) => {
      const { exportBackup, migrate } = await import('/js/lib/model.js');
      const state = JSON.parse(localStorage.getItem(key));
      return migrate(JSON.parse(JSON.stringify(exportBackup(state))));
    }, KEY);
    const expectedBackupLists = Object.fromEntries(Object.entries(expectedRetired.lists).map(([id, list]) => [
      id, { ...list, catalogId: list.catalogId ?? null, deferredIssueIds: list.deferredIssueIds ?? [] },
    ]));
    t.check('A withdrawn saved list and its progress remain portable through a backup round trip',
      isDeepStrictEqual(backup.lists, expectedBackupLists)
      && isDeepStrictEqual(backup.read, expectedRetired.read)
      && isDeepStrictEqual(backup.notes, expectedRetired.notes)
      && isDeepStrictEqual(backup.overrides, expectedRetired.overrides),
      JSON.stringify(backup.lists));
    for (const route of ['marvel-on-screen', 'lines']) {
      await page.goto(`${page.__origin}/?catalog=actual#/${route}`, { waitUntil: 'load' });
      await page.waitForSelector('.catalog-card');
      const withdrawal = await page.evaluate((id) => ({
        cards: document.querySelectorAll(`[data-story="list:${id}"]`).length,
        imports: document.querySelectorAll(`button[data-act="import"][data-key="${id}"]`).length,
      }), retiredOrder.id);
      t.check(`${route} offers no withdrawn card or import while its saved copy remains readable`,
        withdrawal.cards === 0 && withdrawal.imports === 0);
    }
    t.check('The description journey makes no external request or browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};
