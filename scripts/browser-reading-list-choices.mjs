import { readFileSync } from 'node:fs';
import { createEmptyState, createList } from '../src/js/lib/model.js';

const data = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
const catalog = data('catalog.json');
const fastId = 'hickman-minimal';
const movieId = 'avengers-doomsday-secret-wars';
const retainedLines = [
  fastId, 'hickman-full', movieId, 'new-ultimate-universe', 'new-ultimate-universe-trades',
];
const eligibleEvents = [
  'house-of-m', 'house-of-m-essential', 'civil-war', 'civil-war-essential', 'civil-war-avengers',
  'secret-invasion', 'secret-invasion-essential',
];
const expectedLines = new Set([...retainedLines, ...eligibleEvents].map((id) => `list:${id}`));
const wanted = new Set([
  ...retainedLines, ...eligibleEvents, 'xmen-claremont', 'xmen-claremont-complete',
]);
const lists = catalog.lists.filter(({ id }) => wanted.has(id));
const orders = Object.fromEntries(lists.map((list) => [list.file, data(list.file)]));
const legacyIds = [
  43528, 43532, 43533, 43534, 43535, 43536, 43537, 43538, 43539, 43540, 43541, 43542, 43543, 43544,
  43545, 43546, 43547, 43548, 43549, 43550, 46927, 46928, 46930, 46931, 46933, 46934, 48381, 48382,
  48383, 48384, 48385, 48386, 48387, 48388, 48389, 48390, 48391, 48392, 48393, 48394, 48395, 48396,
  48397, 48398, 43512, 43516, 43517, 43518, 43519, 43520, 43521, 43522, 43523, 43524, 43525, 43526,
  43527, 48784, 48785, 48786, 48787, 48788, 48789, 48790, 48791, 48792, 50095, 50096, 50973, 52257,
  52259, 51172, 52261, 52263, 52265, 52266, 52267, 50951, 51410, 52986, 52447, 52450, 52451, 52452,
  52453, 52454, 52455, 52456, 57620,
];
let legacy = createEmptyState();
legacy.issues = Object.fromEntries(data('hickman_full.json').items.map((item) => [item.issueId, item]));
legacy.read = { 43528: 1, 52986: 1 };
legacy.notes = { 43528: 'Keep this personal issue note.' };
legacy = createList(legacy, {
  id: 'legacy', catalogId: fastId, name: 'My original Hickman reading list',
  description: 'My saved 89-issue version.', itemIds: legacyIds, note: 'Keep my original list note.',
});

const cardSelector = (surface, id) => `#${surface}-results [data-story="list:${id}"]`;
const click = (page, selector) => page.$eval(selector, (button) => button.click());
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));

export const readingListChoices = {
  id: 'reading-list-choices',
  title: 'explicit reading choices, the exact Secret Wars trades and shared MCU progress',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(page.__origin)) external.push(request.url());
    });
    await page.evaluateOnNewDocument((fixtureLists, fixtureOrders, paths, saved) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!sessionStorage.getItem('reading-list-choices-seeded')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
        sessionStorage.setItem('reading-list-choices-seeded', '1');
      }
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) {
          return Promise.resolve(new Response(JSON.stringify({ lists: fixtureLists, paths })));
        }
        const file = url.pathname.split('/').at(-1);
        if (Object.hasOwn(fixtureOrders, file)) {
          return Promise.resolve(new Response(JSON.stringify(fixtureOrders[file])));
        }
        return real(input, init);
      };
    }, lists, orders, catalog.paths, legacy);

    await page.goto(`${page.__origin}/#/catalog`, { waitUntil: 'load' });
    await page.waitForSelector('#catalog-results .catalog-card');
    const firstCount = await page.$$eval('#catalog-results .catalog-card', (cards) => cards.length);
    t.check('seven event choices have seven independent cards instead of three default choices', firstCount === 7, firstCount);
    if (firstCount !== 7) return;

    for (const [surface, expected] of [
      ['catalog', 7], ['lines', expectedLines.size], ['spotlights', 2], ['age-event-era', 7], ['marvel-on-screen', 1],
    ]) {
      await page.goto(`${page.__origin}/#/${surface}`, { waitUntil: 'load' });
      await page.waitForSelector(`#${surface}-results .catalog-card`);
      const cards = await page.$$eval(`#${surface}-results .catalog-card`, (nodes) => nodes.map((card) => ({
        key: card.dataset.story,
        title: card.querySelector('.catalog-card-title').textContent.trim(),
        preview: card.querySelector('[data-act="preview"]').textContent.trim(),
        previewTag: card.querySelector('[data-act="preview"]').tagName,
      })));
      t.check(`${surface}: every choice has its own title and ordinary Preview button`,
        cards.length === expected && new Set(cards.map(({ key }) => key)).size === expected
        && (surface !== 'lines' || cards.every(({ key }) => expectedLines.has(key)))
        && cards.every(({ key, title, preview, previewTag }) => preview === 'Preview' && previewTag === 'BUTTON'
          && lists.some((list) => `list:${list.id}` === key && list.name === title)),
        JSON.stringify(cards));
      for (const width of [1280, 640, 360]) {
        await page.setViewport({ width, height: 900 });
        const layout = await page.$$eval(`#${surface}-results .catalog-card-title`, (headings) => {
          const visible = headings.every((heading) => {
            const range = document.createRange();
            range.selectNodeContents(heading);
            const text = range.getBoundingClientRect();
            const box = heading.getBoundingClientRect();
            return text.left >= box.left - 1 && text.right <= box.right + 1
              && text.height <= box.height + 1 && box.left >= 0 && box.right <= innerWidth;
          });
          return { visible, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        t.check(`${surface} at ${width}px: the full distinctive titles wrap without clipping`,
          layout.visible && !layout.overflow, JSON.stringify(layout));
      }
      await page.setViewport({ width: 1280, height: 900 });
    }

    await page.goto(`${page.__origin}/#/lines`, { waitUntil: 'load' });
    const fastCard = cardSelector('lines', fastId);
    await page.waitForSelector(fastCard);
    t.check('the renamed fast-track card opens the original saved copy rather than offering another Add',
      await page.$eval(`${fastCard} [data-act="open"]`, (button) => button.dataset.key) === fastId);
    await click(page, `${fastCard} [data-act="preview"]`);
    await page.waitForSelector('#preview[open] .preview-group');
    const preview = await page.evaluate(() => ({
      title: document.querySelector('#preview-h').textContent.trim(),
      choices: document.querySelectorAll('#preview-paths input').length,
      groups: document.querySelectorAll('#preview .preview-group').length,
      rows: document.querySelectorAll('#preview .preview-issue-link').length,
      source: document.querySelector('#preview-source a')?.href,
    }));
    t.check('Preview shows only the selected 69-issue guide with ten sections and its exact source',
      preview.title === 'Secret Wars Fast Track Trade Reading Order'
      && preview.choices === 0 && preview.groups === 10 && preview.rows === 69
      && preview.source.endsWith('#secretwars0'), JSON.stringify(preview));
    await click(page, '#preview-close');
    await page.waitForFunction(() => !document.querySelector('#preview').open);

    const before = await stored(page);
    t.check('browsing and Preview do not rename, reorder or regroup the legacy 89-issue saved copy',
      before.lists.legacy.name === legacy.lists.legacy.name
      && JSON.stringify(before.lists.legacy.itemIds) === JSON.stringify(legacyIds)
      && JSON.stringify(before.lists.legacy.collectedIn) === '{}'
      && before.lists.legacy.note === legacy.lists.legacy.note
      && JSON.stringify(before.read) === JSON.stringify(legacy.read)
      && JSON.stringify(before.notes) === JSON.stringify(legacy.notes), JSON.stringify(before.lists.legacy));

    await page.goto(`${page.__origin}/#/marvel-on-screen`, { waitUntil: 'load' });
    const movieCard = cardSelector('marvel-on-screen', movieId);
    await page.waitForSelector(`${movieCard} [data-act="import"]`);
    await click(page, `${movieCard} [data-act="import"]`);
    await page.waitForSelector('#view-read:not([hidden])');
    const withMovie = await stored(page);
    const savedMovie = Object.values(withMovie.lists).find(({ catalogId }) => catalogId === movieId);
    t.check('MCU Prep creates its own named list and shares the already-read Secret Wars zero issue',
      savedMovie.name === 'Avengers: Doomsday & Avengers: Secret Wars'
      && savedMovie.itemIds.length === 69 && savedMovie.itemIds.includes(52986)
      && savedMovie.itemIds.filter((id) => withMovie.read[id]).length === 1,
      JSON.stringify({ name: savedMovie.name, count: savedMovie.itemIds.length }));
    t.check('adding the MCU list leaves the original saved list and personal notes untouched',
      JSON.stringify(withMovie.lists.legacy) === JSON.stringify(before.lists.legacy)
      && JSON.stringify(withMovie.notes) === JSON.stringify(before.notes)
      && JSON.stringify(withMovie.read) === JSON.stringify(before.read));

    await page.evaluate(() => localStorage.removeItem('mrt.state.v2'));
    await page.goto(`${page.__origin}/#/lines`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(`${fastCard} [data-act="import"]`);
    await click(page, `${fastCard} [data-act="import"]`);
    await page.waitForSelector('#view-read:not([hidden])');
    await click(page, '#full > summary');
    await page.waitForSelector('#rows [data-act="read"][data-key="10580"]', { visible: true });
    await click(page, '#rows [data-act="read"][data-key="10580"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).read[10580]);
    await page.goto(`${page.__origin}/#/marvel-on-screen`, { waitUntil: 'load' });
    await page.waitForSelector(`${movieCard} [data-act="import"]`);
    await click(page, `${movieCard} [data-act="import"]`);
    await page.waitForSelector('#view-read:not([hidden])');
    const both = await stored(page);
    const savedFast = Object.values(both.lists).find(({ catalogId }) => catalogId === fastId);
    const secondMovie = Object.values(both.lists).find(({ catalogId }) => catalogId === movieId);
    t.check('fresh imports have two independent names but identical ordered originals and book sections',
      both.listOrder.length === 2 && savedFast.id !== secondMovie.id
      && savedFast.name === 'Secret Wars Fast Track Trade Reading Order'
      && secondMovie.name === 'Avengers: Doomsday & Avengers: Secret Wars'
      && savedFast.itemIds.length === 69
      && JSON.stringify(savedFast.itemIds) === JSON.stringify(secondMovie.itemIds)
      && JSON.stringify(savedFast.collectedIn) === JSON.stringify(secondMovie.collectedIn)
      && new Set(Object.values(savedFast.collectedIn)).size === 10);
    t.check('a read mark made in the fast track remains read in the independently saved MCU list',
      both.read[10580] && secondMovie.itemIds.filter((id) => both.read[id]).length === 1);
    await page.reload({ waitUntil: 'load' });
    const reloaded = await stored(page);
    t.check('both named copies, shared progress and collected sections survive reload',
      JSON.stringify(reloaded.lists) === JSON.stringify(both.lists)
      && JSON.stringify(reloaded.read) === JSON.stringify(both.read));
    t.check('the scenario makes no external request or browser error',
      errors.length === 0 && external.length === 0, JSON.stringify({ errors, external }));
  },
};
