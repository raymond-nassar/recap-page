import { readFileSync } from 'node:fs';
import { importedNoWayHomeFixture } from '../test/helpers/owner-no-way-home-import.mjs';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const id = 'spider-man-no-way-home-owner-selected';
const legacyId = 'spider-man-no-way-home';
const mapping = readJson(new URL(`./data/owner-mcu-prep/${id}.mapping.json`, import.meta.url));
const legacy = readJson(new URL('../src/data/spider_man_no_way_home.json', import.meta.url));
const payload = readJson(new URL('../src/data/spider_man_no_way_home_owner_selected.json', import.meta.url));
const catalog = readJson(new URL('../src/data/catalog.json', import.meta.url));
const screenCount = catalog.lists.filter(({ type }) => type === 'screen-companion').length;
const expected = mapping.rows.map((row) => ({
  position: row.row, issueId: row.selectedIssueId, title: row.selectedTitle, section: row.collectionTitle,
}));
const legacyExpected = legacy.items.map((row, index) => ({
  position: index + 1, issueId: row.issueId, title: row.title, section: null,
}));
const groups = [...new Set(expected.map(({ section }) => section))];
const click = (page, selector) => page.$eval(selector, (node) => node.click());
const same = (actual, wanted) => JSON.stringify(actual) === JSON.stringify(wanted);

async function rendered(page, mode) {
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
        } else {
          const issue = node.querySelector(view === 'preview' ? '.preview-issue-link' : '.rt');
          if (issue) rows.push({
            position: view === 'preview' ? Number(node.querySelector('.pn')?.textContent) : rows.length + 1,
            issueId: Number(issue.dataset.issueId),
            title: issue.textContent.trim(), section,
          });
        }
      }
      return { rows, headings };
    }, mode);
}

async function saved(page) {
  return page.evaluate((ids) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const byCatalog = (catalogId) => Object.values(state?.lists ?? {})
      .filter((list) => list.catalogId === catalogId);
    return {
      legacy: byCatalog(ids[0]), owner: byCatalog(ids[1]),
      count: state?.listOrder.length, read: state?.read,
    };
  }, [legacyId, id]);
}

async function launch(page, issueId) {
  return page.evaluate((key) => {
    const button = document.querySelector(`#rows button[data-act="open"][data-key="${key}"]`);
    if (!button) throw new Error(`Missing Read control for original issue ${key}`);
    window.__opened = [];
    window.__dispatching = true;
    button.click();
    window.__dispatching = false;
    return window.__opened;
  }, issueId);
}

export const ownerNoWayHomeActualData = {
  id: 'owner-no-way-home-actual-data',
  title: 'withdrawn No Way Home discovery preserves the original guide and every existing saved copy',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
      window.__withdrawalStateWrites = [];
      for (const method of ['setItem', 'removeItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (String(key).startsWith('mrt.state.')) window.__withdrawalStateWrites.push({ method, key });
          return original.call(this, key, ...args);
        };
      }
    });
    await page.evaluateOnNewDocument((entry) => { window.__withdrawalRetiredCard = entry; }, {
      ...mapping.proposedManifest,
      file: mapping.proposedManifest.out,
      count: expected.length,
      placeholderCount: 0,
      emptyRecordCount: 0,
      collections: groups.length,
      source: mapping.sourceUrl,
      cover: null,
      updatedAt: payload.updatedAt,
    });
    const goto = (route) => page.goto(`${page.__origin}/?catalog=actual#/${route}`, { waitUntil: 'load' });
    const card = (catalogId) => `#marvel-on-screen-results [data-story="list:${catalogId}"]`;
    const add = async (catalogId, count) => {
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((key, length) => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        const list = Object.values(state?.lists ?? {}).find((entry) => entry.catalogId === key);
        const open = document.querySelector('#preview-add a[data-act="main"]');
        return list?.itemIds.length === length && state.lists[list.id] === list
          && open?.dataset.key === key
          && open.getAttribute('href') === `#/read/${encodeURIComponent(list.id)}`
          && /In library|Open/.test(open.textContent);
      }, {}, catalogId, count);
    };
    const preview = async (catalogId, wanted, width) => {
      await click(page, `${card(catalogId)} [data-act="preview"]`);
      await page.waitForFunction((count) =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === count, {}, wanted.length);
      const result = await rendered(page, 'preview');
      t.check(`${width}px Preview keeps the exact ${wanted.length}-original vector and collection positions`,
        same(result.rows, wanted), JSON.stringify(result));
    };
    for (const width of [1280, 360]) {
      await page.setViewport({ width, height: 900 });
      await goto('home');
      const home = '#view-home [data-category="marvel-on-screen"]';
      await page.waitForSelector(home, { visible: true });
      const homeCount = await page.$eval(`${home} .home-path-count`, (node) => node.textContent.trim());
      t.check(`${width}px Home exposes the existing MCU Prep gateway with all current companions`,
        homeCount === `${screenCount} Reading Lists`, homeCount);
      await click(page, home);
      await page.waitForSelector('#marvel-on-screen-results .catalog-card');
      const discovered = await page.evaluate((owner, original, retiredId, viewport) => ({
        hash: location.hash,
        retiredCards: document.querySelectorAll(owner).length,
        originalCards: document.querySelectorAll(original).length,
        retiredImportControls: document.querySelectorAll(`button[data-act="import"][data-key="${retiredId}"]`).length,
        originalSource: document.querySelector(`${original} a[href*="comicbookherald.com"]`)?.href,
        overflow: document.documentElement.scrollWidth > viewport + 1,
        cardsFit: [...document.querySelectorAll(original)].every((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.right <= viewport + 1;
        }),
      }), card(id), card(legacyId), id, width);
      t.check(`${width}px only the original No Way Home guide is offered with its unchanged source`,
        discovered.hash.startsWith('#/marvel-on-screen')
          && discovered.retiredCards === 0 && discovered.retiredImportControls === 0
          && discovered.originalCards === 1 && discovered.originalSource === legacy.source,
        JSON.stringify(discovered));
      if (discovered.retiredCards !== 0 || discovered.originalCards !== 1) return;
      t.check(`${width}px the original companion wraps without page or card overflow`,
        !discovered.overflow && discovered.cardsFit, JSON.stringify(discovered));
      await goto('browse');
      const browse = '#view-browse [data-category="marvel-on-screen"]';
      await page.waitForSelector(browse, { visible: true });
      const browseCount = await page.$eval(`${browse} .home-path-count`, (node) => node.textContent.trim());
      t.check(`${width}px Browse exposes the same MCU Prep count`, browseCount === homeCount, browseCount);
      await click(page, browse);
      await page.waitForSelector(card(legacyId));
      await preview(legacyId, legacyExpected, width);
      await click(page, '#preview-close');
      await goto('lines');
      await page.waitForSelector('#view-lines:not([hidden]) .catalog-card');
      const storylines = await page.evaluate((retiredId) => ({
        choices: document.querySelectorAll('#view-lines .catalog-card').length,
        retiredCards: document.querySelectorAll(`#view-lines [data-story="list:${retiredId}"]`).length,
        retiredImports: document.querySelectorAll(`#view-lines button[data-act="import"][data-key="${retiredId}"]`).length,
      }), id);
      t.check(`${width}px populated Storylines offers no retired card or import control`,
        storylines.choices > 0 && storylines.retiredCards === 0 && storylines.retiredImports === 0,
        JSON.stringify(storylines));
    }
    await page.setViewport({ width: 1280, height: 900 });
    await goto('marvel-on-screen');
    await page.waitForSelector(card(legacyId));
    await preview(legacyId, legacyExpected, 1280);
    await add(legacyId, legacyExpected.length);
    const originalImport = await saved(page);
    t.check('fresh import adds only the original unchanged 17-comic guide',
      originalImport.count === 1 && originalImport.legacy.length === 1 && originalImport.owner.length === 0
        && same(originalImport.legacy[0].itemIds, legacyExpected.map(({ issueId }) => issueId)),
      JSON.stringify(originalImport));
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForSelector('#view-read:not([hidden])');
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    t.check('fresh original import remains readable in its exact 17-comic order',
      same((await rendered(page, 'reading')).rows, legacyExpected));
    const originalOpened = await launch(page, legacy.items[0].issueId);
    const originalDestination = new URL(originalOpened[0]?.url ?? '', page.__origin);
    t.check('the original guide retains synchronous independent new-tab Read',
      originalOpened.length === 1 && originalOpened[0].dispatching && originalOpened[0].target === '_blank'
        && originalOpened[0].features.includes('noopener') && originalDestination.origin === page.__origin
        && originalDestination.pathname === '/open.html'
        && originalDestination.searchParams.get('i') === String(legacy.items[0].issueId)
        && originalDestination.searchParams.get('d') === String(legacy.items[0].digitalId),
      JSON.stringify(originalOpened));
    const fixture = importedNoWayHomeFixture({ owner: payload, legacy });
    await page.evaluate((keys) => {
      for (const [key, value] of Object.entries(keys)) localStorage.setItem(key, value);
    }, fixture.keys);
    // Same-window storage writes leave the running Store untouched.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((name) =>
      document.querySelector('#order-name')?.textContent.trim() === name, {}, payload.name);
    for (const width of [1280, 360]) {
      await page.setViewport({ width, height: 900 });
      await goto('library');
      await page.waitForSelector('#library-yours-list a[href="#/read/retired-import"]');
      const library = await page.$$eval('#library-yours-list a[href^="#/read/"]', (nodes) =>
        nodes.map((node) => ({ name: node.textContent.trim(), href: node.getAttribute('href') })));
      t.check(`${width}px Library still offers the previously imported retired guide`,
        library.some((entry) => entry.name.includes(payload.name) && entry.href === '#/read/retired-import'),
        JSON.stringify(library));
      await goto('read/retired-import?full=1&filter=all');
      await page.waitForFunction((name) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === name
        && document.querySelectorAll('#rows .rt').length === 18, {}, payload.name);
      const reading = await rendered(page, 'reading');
      t.check(`${width}px the retired saved copy retains all 18 originals and three collection headings`,
        same(reading.rows, expected) && same(reading.headings, groups), JSON.stringify(reading));
      t.check(`${width}px the retired saved Reading List has no horizontal overflow`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-read:not([hidden])');
      const reloadedReading = await rendered(page, 'reading');
      const preserved = await page.evaluate((keys) => ({
        keys: Object.fromEntries(Object.keys(keys).map((key) => [key, localStorage.getItem(key)])),
        writes: window.__withdrawalStateWrites,
        active: JSON.parse(localStorage.getItem('mrt.state.v2')).active,
      }), fixture.keys);
      t.check(`${width}px same-active reload preserves every saved byte and backup with no state write`,
        same(preserved.keys, fixture.keys) && preserved.writes.length === 0
          && preserved.active === 'retired-import' && same(reloadedReading, reading),
        JSON.stringify({ active: preserved.active, writes: preserved.writes, keyCount: Object.keys(preserved.keys).length }));
      if (width === 1280) {
        const opened = await launch(page, payload.items[0].issueId);
        const destination = new URL(opened[0]?.url ?? '', page.__origin);
        t.check('the retired saved copy retains synchronous independent new-tab Read and its exact digital identity',
          opened.length === 1 && opened[0].dispatching && opened[0].target === '_blank'
            && opened[0].features.includes('noopener') && destination.origin === page.__origin
            && destination.pathname === '/open.html'
            && destination.searchParams.get('i') === String(payload.items[0].issueId)
            && destination.searchParams.get('d') === String(payload.items[0].digitalId),
          JSON.stringify(opened));
      }
    }
    t.check('the real-data journeys perform no external request and raise no browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};

export const ownerNoWayHomeHiddenMutation = {
  id: 'owner-no-way-home-retired-card-reintroduced',
  breaks: 'owner-no-way-home-actual-data',
  why: 'reintroducing only the retired catalog card must fail the new-discovery withdrawal contract',
  script: () => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href);
      if (url.pathname !== '/data/catalog.json') return response;
      const catalog = await response.clone().json();
      if (catalog.lists.some(({ id }) => id === 'spider-man-no-way-home-owner-selected')) {
        throw new Error('Retired-card mutation requires the withdrawn catalog');
      }
      if (window.__withdrawalRetiredCard?.id !== 'spider-man-no-way-home-owner-selected') {
        throw new Error('Retired-card mutation fixture is missing');
      }
      catalog.lists.push(window.__withdrawalRetiredCard);
      return new Response(JSON.stringify(catalog), {
        status: response.status, headers: response.headers,
      });
    };
  },
};
