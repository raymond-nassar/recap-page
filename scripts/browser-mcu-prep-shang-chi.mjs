import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL(
  '../test/fixtures/mcu-prep-shang-chi-vector.json', import.meta.url,
), 'utf8'));
const { id, name } = fixture;
const source = 'https://github.com/raymond-nassar/recap-page/issues/683#issuecomment-5971742989';
const titles = fixture.series.flatMap((series) => Array.from(
  { length: series.last - series.first + 1 },
  (_, index) => `${series.title} (${series.year}) #${series.first + index}`,
));
const sections = fixture.blockCounts.flatMap((count, index) =>
  Array(count).fill(fixture.collectedInByBlock[index]));
const headings = fixture.collectedInByBlock.map((section) => section ?? 'Individual issues');
const expected = fixture.issueIds.map((issueId, index) => ({
  position: index + 1, issueId, title: titles[index], section: sections[index],
}));

async function renderedRows(page, mode) {
  return page.$$eval(mode === 'preview' ? '#preview-body .preview-list > li' : '#rows > li',
    (nodes, view) => {
      let section = null;
      const rows = [];
      const headings = [];
      for (const node of nodes) {
        const heading = node.querySelector(view === 'preview' ? '.preview-group h4' : '.row-group .rg-name');
        if (heading) {
          const label = heading.textContent.trim();
          section = label === 'Individual issues' ? null : label;
          headings.push(label);
          continue;
        }
        const issue = node.querySelector(view === 'preview' ? '.preview-issue-link' : '.rt');
        if (issue) rows.push({
          position: rows.length + 1,
          issueId: Number(issue.dataset.issueId),
          title: issue.textContent.trim(),
          section,
        });
      }
      return { rows, headings };
    }, mode);
}

function checkVector(t, label, actual) {
  const mismatches = actual.flatMap((row, index) =>
    JSON.stringify(row) === JSON.stringify(expected[index])
      ? [] : [{ position: index + 1, expected: expected[index], actual: row }]);
  t.check(label, actual.length === 37 && mismatches.length === 0,
    JSON.stringify({ count: actual.length, mismatches: mismatches.slice(0, 3) }));
}

async function storedRows(page) {
  return page.evaluate((catalogId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const list = lists[0];
    return {
      matches: lists.length,
      rows: (list?.itemIds ?? []).map((issueId, index) => ({
        position: index + 1,
        issueId,
        title: state.issues[issueId]?.title,
        section: list.collectedIn[issueId] ?? null,
      })),
    };
  }, id);
}

export const mcuPrepShangChiActualData = {
  id: 'mcu-prep-shang-chi-actual-data',
  title: 'the owner-selected Shang-Chi MCU companion preserves 37 originals and qualified material',
  async run(page, t) {
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) {
        externalRequests.push(request.url());
      }
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
    });

    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${page.__origin}/?catalog=actual#/home`, { waitUntil: 'load' });
      await page.evaluate(() => localStorage.removeItem('mrt.state.v2'));
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#btn-home-browse');
      await page.$eval('#btn-home-browse', (node) => node.click());
      await page.waitForSelector('#view-browse [data-category="marvel-on-screen"]');
      await page.$eval('#view-browse [data-category="marvel-on-screen"]', (node) => node.click());
      const selector = `#marvel-on-screen-results [data-story="list:${id}"]`;
      await page.waitForSelector(selector);
      const discovery = await page.$eval(selector, (node) => ({
        name: node.querySelector('.catalog-card-title')?.textContent.trim(),
        text: node.textContent,
        sources: [...node.querySelectorAll('a[href]')].map((link) => link.href),
        importLabel: node.querySelector('[data-act="import"]')?.getAttribute('aria-label'),
        matches: document.querySelectorAll(`#marvel-on-screen-results [data-story="${node.dataset.story}"]`).length,
        hash: location.hash,
        fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      }));
      t.check(`${width}px Home Browse reaches the exact 37-issue MCU Prep card once`,
        discovery.name === name && discovery.text.includes('37 issues')
        && discovery.sources.includes(source) && discovery.importLabel === `Add to library: ${name}`
        && discovery.matches === 1 && discovery.hash === '#/marvel-on-screen' && discovery.fits,
        JSON.stringify(discovery));

      await page.$eval(`${selector} [data-act="preview"]`, (node) => node.click());
      await page.waitForFunction(() =>
        document.querySelectorAll('#preview[open] .preview-issue-link').length === 37);
      const preview = await renderedRows(page, 'preview');
      checkVector(t, `${width}px Preview preserves all original identities and seven block positions`,
        preview.rows);
      t.check(`${width}px Preview keeps anthology story selection and whole-issue progress explicit`,
        JSON.stringify(preview.headings) === JSON.stringify(headings)
        && preview.rows[16].issueId === 92003 && preview.rows[16].section === null
        && preview.rows[29].issueId === 95679
        && preview.rows[29].section.includes('Shang-Chi story only; progress is whole-issue'),
        JSON.stringify(preview.headings));
      const provenance = await page.$eval('#preview', (node) => node.textContent);
      t.check(`${width}px Preview discloses the owner-selected Comic Book Herald compilation`,
        provenance.includes("owner's selected Comic Book Herald excerpt"), provenance);

      await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
      await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
        ?.textContent.includes('Open'));
      const imported = await storedRows(page);
      t.check(`${width}px import creates one catalog-bound companion`, imported.matches === 1,
        JSON.stringify(imported.matches));
      checkVector(t, `${width}px import stores all 37 originals in approved order`, imported.rows);
      await page.$eval('#preview-add [data-act="main"]', (node) => node.click());
      await page.waitForFunction((title) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 37);
      const reading = await renderedRows(page, 'reading');
      checkVector(t, `${width}px Reading List preserves original identities and qualified headings`,
        reading.rows);
      t.check(`${width}px Reading List distinguishes six collections from the standalone boundary`,
        JSON.stringify(reading.headings) === JSON.stringify(headings)
        && reading.rows[16].issueId === 92003 && reading.rows[16].section === null,
        JSON.stringify(reading.headings));

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction((title) =>
        document.querySelector('#order-name')?.textContent.trim() === title, {}, name);
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 37);
      const reloaded = await renderedRows(page, 'reading');
      checkVector(t, `${width}px reload retains all 37 originals and source qualifications`,
        reloaded.rows);
      const persisted = await storedRows(page);
      t.check(`${width}px reload keeps exactly one companion`, persisted.matches === 1,
        JSON.stringify(persisted.matches));
      checkVector(t, `${width}px reload retains the full saved original vector`, persisted.rows);

      await page.$eval('.brand[data-view="home"]', (node) => node.click());
      await page.waitForSelector('#btn-home-browse');
      await page.$eval('#btn-home-browse', (node) => node.click());
      await page.waitForSelector('#view-browse [data-category="marvel-on-screen"]');
      await page.$eval('#view-browse [data-category="marvel-on-screen"]', (node) => node.click());
      await page.waitForSelector(`${selector} [data-act="open"]`);
      t.check(`${width}px Browse returns to the saved companion without duplicate import`,
        await page.$$eval(selector, (nodes) => nodes.length) === 1);
    }
    t.check('the isolated desktop and narrow journey makes no external request or browser error',
      externalRequests.length === 0 && errors.length === 0,
      JSON.stringify({ externalRequests: externalRequests.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};
