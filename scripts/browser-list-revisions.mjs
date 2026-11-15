import { readFileSync } from 'node:fs';
import { addIssuesToList, createEmptyState, createList, exportBackup, markRead } from '../src/js/lib/model.js';
import { revisedOrderKeepingExtras } from '../src/js/lib/listCorrection.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';

const KEY = 'mrt.state.v2';
const click = (page, selector) => page.$eval(selector, (node) => node.click());

export const listRevisions = {
  id: 'list-revisions',
  title: 'Earlier published orders can be reviewed and updated without losing saved identities',
  async run(page, t) {
    const record = READING_ORDER_REVISIONS.find((item) => item.catalogId === 'wolverine-reading-order');
    const payload = JSON.parse(readFileSync(new URL('../src/data/wolverine_reading_order.json', import.meta.url)));
    const byId = new Map(payload.items.map((item) => [item.issueId, item]));
    const old = record.previousOrders[0];
    let initial = createList(createEmptyState(), { id: 'saved', name: 'Wolverine', catalogId: record.catalogId });
    initial = addIssuesToList(initial, 'saved', old.map((issueId) => byId.get(issueId) ?? { issueId, title: `Issue ${issueId}` })).state;
    const retired = old.find((id) => !record.revisedOrder.includes(id));
    initial = markRead(initial, retired, true, 123);
    await page.setViewport(page.__revisionViewport ?? { width: 1280, height: 900 });
    await page.evaluateOnNewDocument((seed, key) => {
      if (sessionStorage.getItem('revision-keep-saved')) sessionStorage.removeItem('revision-keep-saved');
      else localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      const set = Storage.prototype.setItem;
      const get = Storage.prototype.getItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && window.__revisionFault === 'silent') return;
        const result = set.call(this, name, value);
        if (name === key && window.__revisionFault === 'unreadable') window.__revisionWritten = true;
        return result;
      };
      Storage.prototype.getItem = function (name) {
        const stack = new Error().stack ?? '';
        if (name === key && window.__revisionFault === 'unreadable' && window.__revisionWritten
          && stack.includes('saveListRevision') && !stack.includes('Store.update')) {
          window.__revisionFault = 'observed';
          throw new Error('test read unavailable');
        }
        return get.call(this, name);
      };
    }, exportBackup(initial), KEY);
    await page.goto(`${page.__origin}/#/read/saved`, { waitUntil: 'load' });
    await page.waitForSelector('#list-revision-offer:not([hidden])');
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    t.check('offer and review disclose the match and same-comic progress',
      await page.$eval('#list-revision-offer', (node) => node.textContent.includes('matches an earlier published order'))
      && await page.$eval('#ask-body', (node) => node.textContent.includes('progress stays on the same comics')
        && node.textContent.includes('custom order may change')));
    t.check('the review fits without horizontal page overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await click(page, '#ask-cancel');
    await page.waitForSelector('#ask:not([open])');
    await page.waitForFunction(() => document.querySelector('#list-revision-review').getAttribute('aria-disabled') === 'false');
    t.check('cancel does not change saved bytes', await page.evaluate((key, original) => localStorage.getItem(key) === original, KEY, before));

    await page.evaluate(() => { window.__revisionFault = 'silent'; });
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('not saved'));
    t.check('a silent failed save does not claim success or change storage',
      await page.evaluate((key, original) => localStorage.getItem(key) === original, KEY, before));
    await page.evaluate(() => { window.__revisionFault = null; });

    await page.$eval('#list-revision-review', (node) => node.focus());
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('updated'));
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const expected = revisedOrderKeepingExtras(old, record.revisedOrder);
    t.check('updated order retains every old comic and the corrected published order',
      JSON.stringify(saved.lists.saved.itemIds) === JSON.stringify(expected));
    t.check('read progress remains on the retired identity', saved.read[retired] === 123);
    t.check('the automatic offer is withdrawn and focus has a visible successor', await page.evaluate(() => (
      document.querySelector('#list-revision-offer').hidden
      && document.activeElement === document.querySelector('#list-actions > summary')
    )));
    await click(page, '#list-actions > summary');
    await click(page, '#list-revision-check');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('already includes'));
    t.check('a repeated manual check makes no second update', await page.$eval('#list-revision-status', (node) => node.textContent.includes('unchanged')));
    await click(page, '#btn-duplicate-list');
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).active !== 'saved', {}, KEY);
    await click(page, '#list-revision-check');
    await page.waitForSelector('#list-revision-chooser:not([hidden])');
    t.check('a duplicated list offers a labeled chooser without horizontal overflow', await page.evaluate(() => {
      const field = document.querySelector('#list-revision-select');
      const bounds = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      field.focus();
      return field.labels[0]?.textContent === 'Published order' && document.activeElement === field
        && bounds.width >= 24 && bounds.height >= 24 && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    }));
    await page.select('#list-revision-select', record.catalogId);
    await click(page, '#list-revision-choose');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('already includes'));
    t.check('the selected published order is compared without changing the duplicate',
      await page.$eval('#list-revision-status', (node) => node.textContent.includes('unchanged')));

    await page.goto(`${page.__origin}/#/read/saved`, { waitUntil: 'load' });
    await page.waitForSelector('#list-revision-offer:not([hidden])');
    await page.evaluate(() => { window.__revisionFault = 'unreadable'; });
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForSelector('#list-revision-uncertain-banner:not([hidden])');
    t.check('an uncertain save withdraws the destructive recovery offer', await page.evaluate(() => (
      document.querySelector('#blocked-banner').hidden
      && document.querySelector('#list-revision-uncertain-banner').textContent.includes('may or may not have changed')
      && document.querySelector('#list-revision-uncertain-banner').textContent.includes('reopen')
    )));
    await page.evaluate(() => { sessionStorage.setItem('revision-keep-saved', '1'); });
    await page.reload({ waitUntil: 'load' });
    const reopened = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    t.check('reopening shows the saved update and clears the uncertain warning',
      JSON.stringify(reopened.lists.saved.itemIds) === JSON.stringify(expected)
      && await page.$eval('#list-revision-uncertain-banner', (node) => node.hidden));
  },
};
