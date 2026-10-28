import { createEmptyState, createList, addIssuesToList, markRead, setDeferred, exportBackup } from '../src/js/lib/model.js';

const KEY = 'mrt.state.v2';
const click = (page, selector) => page.$eval(selector, (node) => { node.focus(); node.click(); });
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

function fixture() {
  let state = createList(createEmptyState(), { id: 'bulk', name: 'Already-read fixture' });
  const comics = [95101, 95102, 95103].map((issueId) => ({
    issueId, title: `Bulk comic ${issueId}`, source: 'manual',
  }));
  state = addIssuesToList(state, 'bulk', comics).state;
  state = createList(state, { id: 'shared', name: 'Shared fixture' });
  state = addIssuesToList(state, 'shared', [comics[1]]).state;
  state = markRead(state, 95101, true, 123);
  return exportBackup(setDeferred(state, 'bulk', 95103, true));
}

async function question(page) {
  await page.waitForFunction(() => document.querySelector('#btn-mark-all-read').getAttribute('aria-disabled') === 'false');
  await page.$eval('#list-actions', (node) => { node.open = true; });
  await click(page, '#btn-mark-all-read');
  await page.waitForSelector('#ask[open]');
}

async function action(page, label) {
  await page.$$eval('#app-report button', (buttons, name) => {
    const button = buttons.find((node) => node.textContent === name);
    if (!button) throw new Error(`Missing bulk action: ${name}`);
    button.focus();
    button.click();
  }, label);
}

export const bulkRead = {
  id: 'mark-list-read',
  title: 'list-wide read progress is verified, undoable and separate from completion',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument((initial, key) => {
      if (!sessionStorage.getItem('bulk-fixture')) {
        localStorage.setItem(key, JSON.stringify(initial));
        sessionStorage.setItem('bulk-fixture', '1');
      }
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'read', theme: 'dark' }));
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
        return url.origin === location.origin ? fetch(input, init) : Promise.reject(new TypeError('Fixture blocks external requests'));
      };
    }, fixture(), KEY);
    await page.goto(`${page.__origin}/#/read/bulk`, { waitUntil: 'load' });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#ring-sub').textContent.includes('1 of 3'));
    await page.$eval('#full', (node) => { node.open = true; });
    await page.waitForSelector('#rows .row');
    t.check('read filter hides both unread comics before the whole-list action', await page.$$eval('#rows .row', (rows) => rows.length === 1));
    const history = await page.evaluate(() => localStorage.getItem('mrt.list-history.v1'));
    await question(page);
    t.check('both actions use Mark All Read and confirmation uses the concise shared-progress message',
      await page.$eval('#ask-body', (node) => node.textContent
        === 'This marks 2 unread issues as read. Read progress is shared with every list containing those comics.')
      && await page.$eval('#ask-ok', (node) => node.textContent === 'Mark All Read')
      && await page.$eval('#btn-mark-all-read', (node) => node.textContent === 'Mark All Read'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#ask').open);
    const cancelled = await page.evaluate(() => ({
      focus: document.activeElement.id, disabled: document.querySelector('#btn-mark-all-read').disabled,
      read: JSON.parse(localStorage.getItem('mrt.state.v2')).read,
    }));
    t.check('Escape restores the opener and keeps progress unchanged', Object.keys(cancelled.read).length === 1
      && cancelled.focus === 'btn-mark-all-read', JSON.stringify(cancelled));
    await question(page);
    await page.focus('#ask-ok');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#ring-sub').textContent === 'All read');
    let state = await saved(page);
    t.check('keyboard confirmation saves hidden and deferred comics, keeping the old read date',
      Object.keys(state.read).length === 3 && state.read[95101] === 123
      && state.lists.bulk.deferredIssueIds.includes(95103));
    t.check('all-read action is disabled and focus has a usable successor',
      await page.$eval('#btn-mark-all-read', (node) => node.disabled)
      && await page.evaluate(() => document.activeElement !== document.body));
    await page.evaluate(() => { window.__bulkSilent = true; window.__bulkSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mrt.state.v2' && window.__bulkSilent) return;
        return window.__bulkSet.call(this, key, value);
      };
    });
    await action(page, 'Undo mark all read');
    t.check('silent Undo repaints saved all-read progress and offers a safe retry',
      await page.$eval('#ring-sub', (node) => node.textContent === 'All read')
      && Object.keys((await saved(page)).read).length === 3
      && await page.$eval('#app-report', (node) => node.textContent.includes('Try Undo again')));
    await page.evaluate(() => { window.__bulkSilent = false; });
    await action(page, 'Try Undo again');
    t.check('Undo restores only new read marks, including the deferred comic',
      Object.keys((await saved(page)).read).length === 1
      && await page.$eval('#ring-sub', (node) => node.textContent.includes('1 of 3')));
    await page.evaluate(() => { window.__bulkSilent = true; });
    await question(page);
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#app-report').textContent.includes('could not be verified'));
    t.check('silent apply repaints actual saved progress rather than optimistic success',
      Object.keys((await saved(page)).read).length === 1
      && await page.$eval('#ring-sub', (node) => node.textContent.includes('1 of 3'))
      && await page.$eval('#app-report', (node) => node.textContent.includes('could not be verified')
        && !node.textContent.includes('Undo mark all read')));
    await page.evaluate(() => { window.__bulkSilent = false; });
    await page.setViewport({ width: 390, height: 844 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await question(page);
      const geometry = await page.$eval('#ask', (node) => {
        const r = node.getBoundingClientRect();
        const ok = document.querySelector('#ask-ok').getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && ok.height >= 24
          && document.documentElement.scrollWidth <= innerWidth;
      });
      t.check(`${theme} narrow confirmation fits and keeps the action target`, geometry);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#ask').open);
    }
    await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
    await question(page);
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#ring-sub').textContent === 'All read');
    t.check('touch-sized forced-colors operation leaves completion history unchanged',
      await page.evaluate(() => localStorage.getItem('mrt.list-history.v1')) === history);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#ring-sub').textContent === 'All read');
    t.check('read marks survive reload and remain shared with the other list',
      Object.keys((await saved(page)).read).length === 3);
    await page.goto(`${page.__origin}/#/read/shared`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#ring-sub').textContent === 'All read');
    state = await saved(page);
    t.check('the other saved list uses the same comic read mark', state.lists.shared.itemIds[0] === 95102
      && state.read[95102] > 0 && state.read[95101] === 123);
    t.check('the bulk-read journey has no page errors', errors.length === 0, errors.join('\n'));
  },
};
