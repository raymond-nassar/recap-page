import { readFileSync } from 'node:fs';

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
  title: 'the new owner No Way Home selection and existing guide remain independently discoverable and saved',
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
    });
    const goto = (route) => page.goto(`${page.__origin}/?catalog=actual#/${route}`, { waitUntil: 'load' });
    const card = (catalogId) => `#marvel-on-screen-results [data-story="list:${catalogId}"]`;
    const add = async (catalogId, count) => {
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((key, length) => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        const list = Object.values(state?.lists ?? {}).find((entry) => entry.catalogId === key);
        const button = document.querySelector('#preview-add [data-act="main"]');
        return list?.itemIds.length === length && button?.dataset.key === key && !button.disabled
          && /In library|Open/.test(button.textContent);
      }, {}, catalogId, count);
    };
    const preview = async (catalogId, wanted, width) => {
      await click(page, `${card(catalogId)} [data-act="preview"]`);
      await page.waitForFunction((count) =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === count, {}, wanted.length);
      const result = await rendered(page, 'preview');
      t.check(`${width}px Preview keeps the exact ${wanted.length}-original vector and collection positions`,
        same(result.rows, wanted), JSON.stringify(result));
      if (catalogId === id) t.check(`${width}px Preview retains all three standard collection headings`,
        same(result.headings, groups), JSON.stringify(result.headings));
    };
    let legacySaved;
    for (const width of [1280, 640, 360]) {
      await page.setViewport({ width, height: 900 });
      await goto('home');
      const home = '#view-home [data-category="marvel-on-screen"]';
      await page.waitForSelector(home, { visible: true });
      const homeCount = await page.$eval(`${home} .home-path-count`, (node) => node.textContent.trim());
      t.check(`${width}px Home exposes the existing MCU Prep gateway with all current companions`,
        homeCount === `${screenCount} Reading Lists`, homeCount);
      await click(page, home);
      await page.waitForSelector('#marvel-on-screen-results .catalog-card');
      const discovered = await page.evaluate((owner, original, viewport) => ({
        hash: location.hash,
        ownerCards: document.querySelectorAll(owner).length,
        originalCards: document.querySelectorAll(original).length,
        ownerName: document.querySelector(`${owner} .catalog-card-title`)?.textContent.trim(),
        ownerCredit: document.querySelector(owner)?.textContent,
        ownerSource: document.querySelector(`${owner} a[href*="/issues/686"]`)?.href,
        originalSource: document.querySelector(`${original} a[href*="comicbookherald.com"]`)?.href,
        overflow: document.documentElement.scrollWidth > viewport + 1,
        cardsFit: [...document.querySelectorAll(`${owner}, ${original}`)].every((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.right <= viewport + 1;
        }),
      }), card(id), card(legacyId), width);
      t.check(`${width}px the owner and existing companions appear once with distinct source credits`,
        discovered.hash.startsWith('#/marvel-on-screen')
          && discovered.ownerCards === 1 && discovered.originalCards === 1
          && discovered.ownerName === mapping.proposedManifest.name
          && discovered.ownerCredit.includes('Source: Recap Page')
          && discovered.ownerSource === mapping.sourceUrl && discovered.originalSource === legacy.source,
        JSON.stringify(discovered));
      if (discovered.ownerCards !== 1 || discovered.originalCards !== 1) return;
      t.check(`${width}px both companion cards wrap without page or card overflow`,
        !discovered.overflow && discovered.cardsFit, JSON.stringify(discovered));
      await goto('browse');
      const browse = '#view-browse [data-category="marvel-on-screen"]';
      await page.waitForSelector(browse, { visible: true });
      const browseCount = await page.$eval(`${browse} .home-path-count`, (node) => node.textContent.trim());
      t.check(`${width}px Browse exposes the same MCU Prep count`, browseCount === homeCount, browseCount);
      await click(page, browse);
      await page.waitForSelector(card(legacyId));
      await preview(legacyId, legacyExpected, width);
      if (width === 1280) {
        await add(legacyId, legacyExpected.length);
        await click(page, '#preview-add [data-act="main"]');
        await page.waitForSelector('#view-read:not([hidden])');
        await page.evaluate(() => { document.querySelector('#full').open = true; });
        t.check('the existing guide still opens all 17 unchanged originals',
          same((await rendered(page, 'reading')).rows, legacyExpected));
        await click(page, '#btn-hero-done');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).read[43170] > 0);
        legacySaved = (await saved(page)).legacy[0];
        const opened = await launch(page, legacy.items[0].issueId);
        const destination = new URL(opened[0]?.url ?? '', page.__origin);
        t.check('the existing guide retains synchronous independent new-tab Read',
          opened.length === 1 && opened[0].dispatching && opened[0].target === '_blank'
            && opened[0].features.includes('noopener') && destination.origin === page.__origin
            && destination.pathname === '/open.html'
            && destination.searchParams.get('i') === String(legacy.items[0].issueId)
            && destination.searchParams.get('d') === String(legacy.items[0].digitalId),
          JSON.stringify(opened));
        await goto('marvel-on-screen');
        await page.waitForSelector(card(id));
      } else {
        await click(page, '#preview-close');
      }
      await preview(id, expected, width);
      if (width === 1280) {
        await add(id, expected.length);
      }
      const imported = await saved(page);
      t.check(`${width}px both saved catalog identities remain independent and existing progress is preserved`,
        imported.count === 2 && imported.legacy.length === 1 && imported.owner.length === 1
          && same(imported.legacy[0], legacySaved) && imported.read[43170] > 0
          && same(imported.owner[0].itemIds, expected.map(({ issueId }) => issueId))
          && same(expected.map(({ issueId }) => imported.owner[0].collectedIn[issueId]), expected.map(({ section }) => section)),
        JSON.stringify({ count: imported.count, legacy: imported.legacy[0]?.catalogId, owner: imported.owner[0]?.catalogId }));
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction((name) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === name, {}, mapping.proposedManifest.name);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      const reading = await rendered(page, 'reading');
      t.check(`${width}px Reading keeps 18 originals and all three collection headings`,
        same(reading.rows, expected) && same(reading.headings, groups), JSON.stringify(reading));
      t.check(`${width}px the expanded Reading List has no horizontal overflow`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 1280) {
        const opened = await launch(page, payload.items[0].issueId);
        const destination = new URL(opened[0]?.url ?? '', page.__origin);
        t.check('the new selection retains synchronous independent new-tab Read with its exact digital identity',
          opened.length === 1 && opened[0].dispatching && opened[0].target === '_blank'
            && opened[0].features.includes('noopener') && destination.origin === page.__origin
            && destination.pathname === '/open.html'
            && destination.searchParams.get('i') === String(payload.items[0].issueId)
            && destination.searchParams.get('d') === String(payload.items[0].digitalId),
          JSON.stringify(opened));
      }
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-read:not([hidden])');
      const reloaded = await saved(page);
      t.check(`${width}px reload preserves both catalog-bound saved lists and earlier progress`,
        reloaded.count === 2 && same(reloaded.legacy[0], legacySaved)
          && reloaded.read[43170] > 0 && same(reloaded.owner, imported.owner),
        JSON.stringify({ count: reloaded.count, owner: reloaded.owner[0]?.catalogId }));
    }
    t.check('the real-data journeys perform no external request and raise no browser error',
      external.length === 0 && errors.length === 0, JSON.stringify({ external, errors }));
  },
};

export const ownerNoWayHomeHiddenMutation = {
  id: 'owner-no-way-home-misclassified',
  breaks: 'owner-no-way-home-actual-data',
  why: 'misclassifying the new owner companion removes its MCU Prep card without replacing the existing guide',
  script: () => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href);
      if (url.pathname !== '/data/catalog.json') return response;
      const catalog = await response.clone().json();
      const owner = catalog.lists.find(({ id }) => id === 'spider-man-no-way-home-owner-selected');
      if (!owner) throw new Error('Owner classification mutation has no target');
      owner.type = 'character-run';
      return new Response(JSON.stringify(catalog), {
        status: response.status, headers: response.headers,
      });
    };
  },
};
