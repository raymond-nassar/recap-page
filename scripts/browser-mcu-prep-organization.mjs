import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote } from '../src/js/lib/model.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { KEY } from '../src/js/storage.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalog = json('../src/data/catalog.json');
const expected = json('../test/fixtures/mcu-prep-release-order.json');
const companions = catalog.lists.filter((list) => list.type === 'screen-companion');
const allIds = companions.map((list) => list.id).sort();
const priorCard = companions.find((list) => list.id === 'spider-man-far-from-home');
const priorOrder = json(`../src/data/${priorCard.file}`);
let seed = createList(createEmptyState(), {
  id: 'mcu-organization-prior', catalogId: priorCard.id, name: priorCard.name,
  note: 'Keep my list note.', description: 'Keep my saved description.',
});
seed = addIssuesToList(seed, seed.active, priorOrder.items).state;
seed = markRead(seed, priorOrder.items[0].issueId, true, 123456);
seed = setDeferred(seed, seed.active, priorOrder.items[1].issueId);
seed = setIssueNote(seed, priorOrder.items[0].issueId, 'Keep my issue note.');
seed.overrides[priorOrder.items[2].issueId] = 'unavailable';
const history = JSON.stringify({
  format: LIST_HISTORY_FORMAT, version: 1,
  records: [{
    listId: seed.active, created: seed.lists[seed.active].created, catalogId: priorCard.id,
    completedAt: 123457, rating: 'up',
  }],
});
const root = '#marvel-on-screen-results';
const query = '#marvel-on-screen-q';
const sort = '#marvel-on-screen-sort';
const clear = '#marvel-on-screen-clear';
const cardSelector = (id) => `${root} [data-story="list:${id}"]`;
const click = async (page, selector) => {
  await page.waitForSelector(selector);
  await page.$eval(selector, (element) => element.click());
};
const visibleIds = (page) => page.$$eval(`${root} .catalog-card`,
  (cards) => cards.map((card) => card.dataset.story.slice('list:'.length)));
const saved = (page) => page.evaluate((key, historyKey) => ({
  state: localStorage.getItem(key), history: localStorage.getItem(historyKey),
  settings: localStorage.getItem('mrt.settings'),
}), KEY, LIST_HISTORY_KEY);

export const mcuPrepOrganization = {
  id: 'mcu-prep-organization',
  title: 'MCU phase and screen release discovery preserves every guide and saved reading fact',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(url.origin);
    });
    await page.evaluateOnNewDocument((key, state, historyKey, historyText) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
      if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, historyText);
      window.__mrtBlockExternal = true;
      window.__mcuReleaseFail = new URL(location.href).searchParams.has('mcu-release-failure');
      window.__mcuReleaseRequests = 0;
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input, location.href);
        if (url.pathname.endsWith('/data/mcu-prep.json')) {
          window.__mcuReleaseRequests += 1;
          if (window.__mcuReleaseFail) return Promise.reject(new TypeError('Fixture release metadata unavailable'));
        }
        return real(input, init);
      };
    }, KEY, seed, LIST_HISTORY_KEY, history);

    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
    await click(page, '#view-home [data-category="marvel-on-screen"]');
    await page.waitForSelector(`${root} .catalog-card`);
    const initial = await page.$eval(root, (node) => ({
      phases: [...node.querySelectorAll('.mcu-prep-phase')].map((section) => section.dataset.phase),
      sort: document.querySelector('#marvel-on-screen-sort')?.value,
      count: document.querySelector('#marvel-on-screen-count').textContent.trim(),
    }));
    t.check('phase sections and default oldest-first ordering replace the flat inventory grid',
      initial.phases.join('|') === 'phase-2|phase-3|phase-4|phase-5|phase-6|unassigned'
      && initial.sort === 'oldest' && initial.count === `${allIds.length} Reading Lists`, JSON.stringify(initial));
    if (!initial.phases.length) return;
    const before = await saved(page);
    const oldest = await visibleIds(page);
    t.check('every current guide appears once, with the independently recorded release sequence',
      isDeepStrictEqual([...oldest].sort(), allIds)
      && isDeepStrictEqual(oldest.filter((id) => expected.oldestFirst.includes(id)), expected.oldestFirst),
      JSON.stringify(oldest));
    const scheduled = await page.$eval(cardSelector('avengers-doomsday-secret-wars'), (node) => ({
      phase: node.closest('.mcu-prep-phase').dataset.phase,
      dates: [...node.querySelectorAll('.mcu-prep-releases li')].map((row) => row.textContent),
    }));
    t.check('the combined guide shows both releases once and never expands the supplied year-only date',
      scheduled.phase === 'phase-6' && scheduled.dates.length === 2
      && scheduled.dates[0].includes('Avengers: Doomsday') && scheduled.dates[0].includes('Scheduled: Dec 18, 2026')
      && scheduled.dates[1].includes('Avengers: Secret Wars') && scheduled.dates[1].endsWith('Scheduled: 2027 (year only)'),
      JSON.stringify(scheduled));
    const semantics = await page.evaluate(() => ({
      searchLabel: document.querySelector('label[for="marvel-on-screen-q"]')?.textContent,
      sortLabel: document.querySelector('label[for="marvel-on-screen-sort"]')?.textContent,
      status: document.querySelector('#marvel-on-screen-count')?.getAttribute('role'),
      sections: [...document.querySelectorAll('.mcu-prep-phase')].every((section) => (
        document.getElementById(section.getAttribute('aria-labelledby'))?.tagName === 'H2'
        && [...section.querySelectorAll('.catalog-card-title')].every((title) => title.tagName === 'H3')
      )),
    }));
    t.check('search, native sort, phase headings and one polite result count are labeled',
      semantics.searchLabel && semantics.sortLabel && semantics.status === 'status' && semantics.sections,
      JSON.stringify(semantics));

    await page.focus(sort);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelector('#marvel-on-screen-sort').value === 'newest');
    const newest = await visibleIds(page);
    t.check('keyboard newest-first reverses associated releases while unassigned guides remain last',
      isDeepStrictEqual(newest.filter((id) => expected.oldestFirst.includes(id)), [
        ...expected.oldestFirst.filter((id) => !expected.unassigned.includes(id)).reverse(),
        ...expected.unassigned,
      ]), JSON.stringify(newest));

    await page.type(query, 'Kamala Khan');
    t.check('character search finds the existing Ms. Marvel guide',
      isDeepStrictEqual(await visibleIds(page), ['mcu-prep-ms-marvel']));
    await click(page, clear);
    t.check('Clear restores results and keyboard focus without losing direction',
      await page.evaluate(() => document.activeElement.id === 'marvel-on-screen-q'
        && document.querySelector('#marvel-on-screen-sort').value === 'newest'));
    await page.type(query, 'Daredevil Born Again Season 1');
    t.check('the associated season title is searchable even when absent from the guide title',
      isDeepStrictEqual(await visibleIds(page), ['mcu-prep-daredevil-born-again']));
    await click(page, '.ri[data-view="browse"]');
    await page.evaluate(() => window.history.back());
    await page.waitForSelector(`${root} .catalog-card`);
    t.check('Back retains the page-local query and direction',
      await page.evaluate(() => document.querySelector('#marvel-on-screen-q').value === 'Daredevil Born Again Season 1'
        && document.querySelector('#marvel-on-screen-sort').value === 'newest')
      && isDeepStrictEqual(await visibleIds(page), ['mcu-prep-daredevil-born-again']));
    await click(page, clear);
    await page.type(query, 'not-a-real-mcu-guide');
    t.check('no-match search reports zero and remains clearable',
      await page.$eval('#marvel-on-screen-count', (node, total) => node.textContent === `0 of ${total} Reading Lists`, allIds.length)
      && (await visibleIds(page)).length === 0
      && await page.$eval(clear, (node) => !node.hidden));
    await click(page, clear);
    await page.type(query, 'Secret Wars');
    t.check('secondary Avengers release search keeps one shared guide, not a duplicate list',
      isDeepStrictEqual(await visibleIds(page), ['avengers-doomsday-secret-wars']));
    await click(page, clear);

    await page.setViewport({ width: 390, height: 844 });
    const narrow = await page.evaluate(() => {
      const fields = ['marvel-on-screen-q', 'marvel-on-screen-sort'].map((id) => document.getElementById(id));
      const boxes = fields.map((node) => node.getBoundingClientRect());
      return {
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        fields: boxes.every((box) => box.width > 0 && box.left >= 0 && box.right <= innerWidth),
        cards: document.querySelectorAll('#marvel-on-screen-results .catalog-card').length,
        columns: new Set([...document.querySelectorAll('#marvel-on-screen-results .catalog-card')]
          .map((node) => Math.round(node.getBoundingClientRect().left))).size,
      };
    });
    t.check('narrow controls and every card remain visible without horizontal overflow',
      narrow.fields && narrow.scroll <= narrow.width && narrow.cards === allIds.length && narrow.columns === 1,
      JSON.stringify(narrow));
    await page.setViewport({ width: 1280, height: 900 });
    t.check('the previously saved MCU guide still offers Open under its exact catalog identity',
      await page.$eval(`${cardSelector(priorCard.id)} [data-act="open"]`, (node) => node.dataset.key === 'spider-man-far-from-home'));
    await click(page, `${cardSelector(priorCard.id)} [data-act="preview"]`);
    await page.waitForSelector('#preview[open] .preview-issue-link');
    const preview = await page.$$eval('#preview .preview-issue-link', (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('Preview retains the complete original comic vector',
      isDeepStrictEqual(preview, priorOrder.items.map((item) => item.issueId)), JSON.stringify(preview));
    await click(page, '#preview-close');
    t.check('discovery, keyboard controls, Back and Preview leave saved state, history and settings byte-exact',
      isDeepStrictEqual(await saved(page), before));

    await page.goto(`${page.__origin}/?catalog=actual&mcu-release-failure=1#/marvel-on-screen`, { waitUntil: 'load' });
    await page.waitForSelector('#marvel-on-screen-retry:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#marvel-on-screen-report')
      .textContent.includes('Release details could not be loaded'));
    t.check('release metadata failure is explicit without removing a guide or enabling an untruthful sort',
      isDeepStrictEqual((await visibleIds(page)).sort(), allIds)
      && await page.$eval(sort, (node) => node.disabled));
    await page.type(query, 'Kamala');
    t.check('catalog character search remains usable when release details are unavailable',
      isDeepStrictEqual(await visibleIds(page), ['mcu-prep-ms-marvel'])
      && await page.evaluate(() => window.__mcuReleaseRequests === 1));
    await click(page, clear);
    await page.evaluate(() => { window.__mcuReleaseFail = false; });
    await page.focus('#marvel-on-screen-retry');
    await click(page, '#marvel-on-screen-retry');
    await page.waitForFunction(() => !document.querySelector('#marvel-on-screen-sort').disabled);
    t.check('explicit retry restores grouping and clears the failure without changing saved data',
      isDeepStrictEqual((await visibleIds(page)).filter((id) => expected.oldestFirst.includes(id)), expected.oldestFirst)
      && await page.evaluate(() => window.__mcuReleaseRequests === 2
        && document.querySelector('#marvel-on-screen-retry').hidden
        && document.activeElement.id === 'marvel-on-screen-q'
        && !document.querySelector('#marvel-on-screen-report').textContent.includes('Release details could not be loaded'))
      && isDeepStrictEqual(await saved(page), before));
    t.check('MCU discovery makes no external request and raises no page error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};

export const mcuPrepOrganizationMutation = {
  id: 'mcu-release-organization-missing',
  breaks: 'mcu-prep-organization',
  why: 'the MCU route falls through to the old flat inventory renderer instead of release organization',
  rewriteMain: (source) => source.replace(
    / {2}if \(route === 'marvel-on-screen'\) \{\r?\n {4}await mcuPrepView\.render\(catalog, \{ isCurrent: current \}\);\r?\n {4}return;\r?\n {2}\}\r?\n/,
    '',
  ),
};
