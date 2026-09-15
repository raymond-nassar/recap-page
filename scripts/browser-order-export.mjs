import { createEmptyState, createList, addIssuesToList } from '../src/js/lib/model.js';
import { parseChecklist, readerIssueId } from '../src/js/lib/markdown.js';

const bookId = readerIssueId(129648);
const sourceUrl = 'https://example.test/synthetic-order?edition=one#exact';
const items = [
  { issueId: 900001, title: 'Synthetic first ] issue', collectedIn: 'Volume one', source: 'manual', hydrated: true },
  { issueId: -12345, title: 'Synthetic unresolved position', collectedIn: 'Volume one', source: 'manual', hydrated: true },
  { issueId: bookId, digitalId: 129648, title: 'Synthetic future book', collectedIn: 'Volume two', source: 'manual', hydrated: true },
  { issueId: 900003, title: 'Synthetic last issue', url: 'https://www.marvel.com/comics/issue/900003/exact', source: 'manual', hydrated: true },
];
let state = createList(createEmptyState(), {
  id: 'order-export', name: 'Synthetic shareable order', catalogId: 'synthetic-order',
  description: 'PRIVATE DESCRIPTION', note: 'PRIVATE LIST NOTE',
});
state = addIssuesToList(state, 'order-export', items).state;
state.read = { 900001: 1777777777777, [bookId]: 1777777777777 };
state.overrides = { 900001: 'available', 900003: 'unavailable' };
state.notes = { 900001: 'PRIVATE ISSUE NOTE' };

async function click(page, selector) {
  await page.$eval(selector, (node) => node.click());
}

async function downloaded(page, count) {
  await page.waitForFunction((n) => window.__mrtDownloads.length === n, {}, count);
  return page.evaluate(() => window.__mrtDownloads.at(-1).text);
}

export const orderOnlyExport = {
  id: 'order-only-export',
  title: 'order-only files exclude personal data without altering personal exports or saved state',
  async run(page, t) {
    await page.evaluateOnNewDocument((seed, source) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      if (!sessionStorage.getItem('export-seeded')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(seed));
        sessionStorage.setItem('export-seeded', 'yes');
      }
      window.__exportFetches = 0;
      window.__exportFilenames = [];
      document.addEventListener('click', (event) => {
        if (event.target.matches('a[download]')) window.__exportFilenames.push(event.target.download);
      }, true);
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        window.__exportFetches += 1;
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const response = await real(input, init);
        if (url.pathname.endsWith('/catalog.json')) {
          const catalog = await response.json();
          return new Response(JSON.stringify({
            lists: [{
              ...catalog.lists[0], id: 'synthetic-order', source,
              sourceOrigin: 'Synthetic curator', sourceSection: 'Synthetic section',
            }],
            paths: [],
          }));
        }
        return response;
      };
    }, state, sourceUrl);

    await page.goto(`${page.__origin}/#/home`, { waitUntil: 'networkidle0' });
    await click(page, '#list-nav button[data-act="open"]');
    await page.waitForSelector('#view-read:not([hidden])');
    await page.focus('#list-export > summary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#btn-export-order', { visible: true });
    t.check('Reading export choices open from a keyboard-reachable disclosure',
      await page.$eval('#list-export', (node) => node.open));
    const before = await page.evaluate(() => ({
      state: localStorage.getItem('mrt.state.v2'), calls: window.__exportFetches,
    }));
    const external = [];
    const observeRequest = (request) => {
      if (!request.url().startsWith(page.__origin)) external.push(request.url());
    };
    page.on('request', observeRequest);

    await click(page, '#btn-export-order');
    await page.waitForSelector('#ask[open]');
    const disclosure = await page.$eval('#ask', (node) => node.textContent);
    t.check('the pre-download dialog names exclusions, local behavior and the lossless backup',
      /excludes notes, descriptions, read marks, timestamps and availability overrides/.test(disclosure)
      && /every checkbox starts unread/.test(disclosure)
      && /Nothing is uploaded or changed/.test(disclosure)
      && /notes do not re-import/.test(disclosure)
      && /JSON backup for lossless/.test(disclosure), disclosure);
    t.check('opening the dialog has not downloaded a file',
      await page.evaluate(() => window.__mrtDownloads.length === 0));
    await click(page, '#ask-cancel');
    await page.waitForSelector('#ask:not([open])');
    t.check('cancelling leaves downloads and saved state untouched',
      await page.evaluate((raw) => window.__mrtDownloads.length === 0
        && localStorage.getItem('mrt.state.v2') === raw, before.state));

    await click(page, '#btn-export-md');
    const personal = await downloaded(page, 1);
    t.check('personal export still contains private notes, description and read checkboxes',
      personal.includes('PRIVATE LIST NOTE') && personal.includes('PRIVATE ISSUE NOTE')
      && personal.includes('PRIVATE DESCRIPTION') && personal.includes('- [x]'), personal);

    await click(page, '[data-view="data"]');
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#btn-export-json');
    const backupBefore = JSON.parse(await downloaded(page, 2));
    await click(page, '#btn-export-order-2');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    const markdown = await downloaded(page, 3);
    const parsed = parseChecklist(markdown);
    const rows = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
    t.check('the downloaded order excludes personal data and starts every row unread',
      !/PRIVATE|1777777777777|\[x\]|override/i.test(markdown)
      && rows.length === 4 && rows.every((row) => row.read === false), markdown);
    t.check('mixed official, manual and unresolved positions retain their exact order and labels',
      JSON.stringify(rows.map((row) => [row.issueId ?? null, row.title, row.section])) === JSON.stringify([
        [900001, items[0].title, 'Volume one'], [null, items[1].title, 'Volume one'],
        [bookId, items[2].title, 'Volume two'], [900003, items[3].title, null],
      ]), JSON.stringify(rows));
    t.check('the loaded exact-catalog credit and source URL survive',
      markdown.includes('Source: Synthetic curator') && markdown.includes(sourceUrl)
      && markdown.includes('Source section: Synthetic section'), markdown);
    t.check('the filename distinguishes order-only Markdown from a personal checklist',
      await page.evaluate(() => window.__exportFilenames.at(-1) === 'synthetic-shareable-order-order-only.md'));

    await click(page, '#btn-export-json');
    const backupAfter = JSON.parse(await downloaded(page, 4));
    delete backupBefore.exportedAt;
    delete backupAfter.exportedAt;
    t.check('JSON reader-data backup contents are unchanged by exporting',
      JSON.stringify(backupBefore) === JSON.stringify(backupAfter));
    t.check('all export actions leave the original stored bytes and network counters unchanged',
      await page.evaluate((snapshot) => localStorage.getItem('mrt.state.v2') === snapshot.state
        && window.__exportFetches === snapshot.calls, before), JSON.stringify(external));
    t.check('export sent zero external requests', external.length === 0, JSON.stringify(external));
    page.off('request', observeRequest);

    await click(page, '#list-nav button[data-act="open"]');
    await click(page, '#btn-export-order');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    t.check('Reading and Backup export exactly the same order', await downloaded(page, 5) === markdown);

    await page.evaluate(() => localStorage.removeItem('mrt.state.v2'));
    await page.goto(`${page.__origin}/#/add-import`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-add-import:not([hidden])');
    await page.evaluate((text) => {
      document.querySelector('#import-text').value = text;
      document.querySelector('#import-new-list').checked = true;
      document.querySelector('#form-import').requestSubmit();
    }, markdown);
    await page.waitForFunction(() => /Imported 3 issues/.test(document.querySelector('#import-report').textContent));
    const imported = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('mrt.state.v2'));
      return { saved, report: document.querySelector('#import-report').textContent };
    });
    const list = imported.saved.lists[imported.saved.active];
    t.check('fresh import keeps supported identities and sections in their original order',
      JSON.stringify(list.itemIds) === JSON.stringify([900001, bookId, 900003])
      && list.collectedIn[900001] === 'Volume one'
      && list.collectedIn[bookId] === 'Volume two'
      && !list.collectedIn[900003], JSON.stringify(list));
    t.check('fresh import keeps the official detail link and reserved reader identity',
      imported.saved.issues[900003].url === items[3].url
      && imported.saved.issues[bookId].digitalId === 129648
      && imported.saved.issues[bookId].source === 'manual');
    t.check('fresh import contains no read marks, notes or overrides',
      Object.keys(imported.saved.read).length === 0 && Object.keys(imported.saved.notes).length === 0
      && Object.keys(imported.saved.overrides).length === 0 && !list.note, JSON.stringify(imported.saved));
    t.check('the unresolved manual position remains explicitly offered for resolution',
      imported.report.includes('1 line had no Marvel issue link')
      && imported.report.includes(items[1].title), imported.report);

    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('mrt.state.v2'));
      saved.lists[saved.active].itemIds = [];
      saved.lists[saved.active].collectedIn = {};
      localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
    });
    await page.goto(`${page.__origin}/#/data`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#btn-export-order-2');
    await page.waitForSelector('#ask[open]');
    const emptyDialog = await page.$eval('#ask', (node) => node.textContent);
    t.check('missing attribution is disclosed before downloading', /attribution is unavailable/.test(emptyDialog));
    await click(page, '#ask-ok');
    const empty = await downloaded(page, 1);
    t.check('an empty order downloads with no fabricated rows or attribution',
      /^# Synthetic shareable order/m.test(empty) && empty.includes('Source attribution is unavailable.')
      && parseChecklist(empty).entries.length === 0 && parseChecklist(empty).unresolved.length === 0, empty);

    await page.evaluate(() => {
      URL.createObjectURL = () => { throw new Error('Synthetic download refusal'); };
    });
    await click(page, '#btn-export-order-2');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#app-report').textContent.includes('Synthetic download refusal'));
    t.check('a failed download is reported explicitly without a success-shaped file',
      await page.evaluate(() => window.__mrtDownloads.length === 1
        && document.querySelector('#app-report').textContent.includes('Could not export the reading order')));

    await page.evaluate(() => localStorage.removeItem('mrt.state.v2'));
    await page.goto(`${page.__origin}/#/data`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#btn-export-order-2');
    t.check('no selected list produces an explicit notice instead of an invented export',
      await page.evaluate(() => document.querySelector('#app-report').textContent.includes('No list is selected.')
        && window.__mrtDownloads.length === 0 && !document.querySelector('#ask').open));
  },
};
