import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { addIssuesToList, createEmptyState, createList } from '../src/js/lib/model.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';

const json = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const { entries: edits } = json('test/fixtures/mcu-prep-description-refresh.json');
const catalog = json('src/data/catalog.json');
const orders = new Map(edits.map((edit) => [edit.id, json(`src/data/${edit.file}`)]));
const companions = catalog.lists.filter((row) => row.type === 'screen-companion');
const untouched = companions.filter((row) => !edits.some((edit) => edit.id === row.id));
const firstSentence = (description) => description.slice(0, description.indexOf('.') + 1);
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
  { ...orders.get('spider-man-no-way-home').items[0], collectedIn: 'My own section' },
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
    for (const surface of ['Home', 'Browse']) {
      if (surface === 'Browse') {
        await click(page, '.ri[data-view="browse"]');
        await click(page, '#view-browse [data-category="marvel-on-screen"]');
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
    }
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
    t.check('The ten fresh imports have independent saved-list identities',
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
    t.check('The description journey makes no external request or browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};
