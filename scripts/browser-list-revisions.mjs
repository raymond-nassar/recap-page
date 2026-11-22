import { readFileSync } from 'node:fs';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, markRead, setIssueNote, setListNote,
} from '../src/js/lib/model.js';
import { revisedOrderKeepingExtras } from '../src/js/lib/listCorrection.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';

const KEY = 'mrt.state.v2';
const click = (page, selector) => page.$eval(selector, (node) => node.click());
const legacyFixtures = [
  { id: 'xmen-claremont', saved: 'saved-core', file: 'xmen_claremont.json' },
  { id: 'xmen-claremont-complete', saved: 'saved-expanded', file: 'xmen_claremont_complete.json' },
];

function legacyBackup() {
  let state = createEmptyState();
  for (const fixture of legacyFixtures) {
    const order = JSON.parse(readFileSync(new URL(`../src/data/${fixture.file}`, import.meta.url), 'utf8'));
    state = createList(state, { id: fixture.saved, name: `Saved ${fixture.saved}`, catalogId: fixture.id });
    state = addIssuesToList(state, fixture.saved, order.items.slice(0, 2)).state;
    state = markRead(state, order.items[0].issueId, true, 123);
    state = setIssueNote(state, order.items[0].issueId, 'Personal comic note');
    state = setListNote(state, fixture.saved, 'Personal list note');
  }
  return exportBackup(state);
}

async function removeGenericPayload(page, file) {
  return page.evaluate(async (name) => {
    let removed = 0;
    for (const key of await caches.keys()) {
      if (!key.startsWith('mrt-offline-') || key.startsWith('mrt-offline-content-v1-')) continue;
      const cache = await caches.open(key);
      if (await cache.delete(`${location.origin}/data/${name}`)) removed += 1;
    }
    return removed;
  }, file);
}

async function bundleInventory(page) {
  return page.evaluate(async () => {
    const result = [];
    for (const key of await caches.keys()) {
      if (!key.startsWith('mrt-offline-content-v1-')) continue;
      const cache = await caches.open(key);
      const response = await cache.match(`${location.origin}/__mrt_offline_content__/manifest.json`);
      if (!response) continue;
      const manifest = await response.json();
      const payload = await cache.match(`${location.origin}/data/${manifest.file}`);
      result.push({ listId: manifest.listId, file: manifest.file, complete: manifest.complete,
        payloadId: (await payload?.json())?.id ?? null });
    }
    return result;
  });
}
// Phones replace the options disclosure with a button that opens them in a sheet.
const openOptions = (page) => page.evaluate(() => {
  const phone = document.querySelector('#android-list-options');
  if (phone?.getClientRects().length) {
    if (!document.querySelector('#android-list-sheet')?.open) phone.click();
  } else document.querySelector('#list-actions').open = true;
});

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
      // The desktop harness serves a small fixture catalog without this, and it has no Wolverine entry.
      localStorage.setItem('mrt.catalog.fixture', 'actual');
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
        if (name === key && window.__revisionFault === 'preflight' && stack.includes('saveListRevision')) {
          window.__revisionFault = 'observed';
          throw new Error('test preflight read unavailable');
        }
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

    await page.waitForFunction(() => !document.querySelector('#btn-mark-all-read').disabled);
    await page.$eval('#list-revision-review', (node) => node.focus());
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.waitForFunction(() => document.querySelector('#btn-mark-all-read').disabled);
    t.check('a restore pause withdraws the offer, controls and open review', await page.evaluate(() => (
      document.querySelector('#list-revision-offer').hidden
      && ['review', 'check', 'choose'].every((name) => document.querySelector(`#list-revision-${name}`).disabled)
      && !document.querySelector('#ask').open
    )));
    const pausedFocus = await page.evaluate(() => ({
      id: document.activeElement?.id,
      visible: Boolean(document.activeElement?.getClientRects().length),
      successor: document.activeElement?.matches('#list-actions > summary, #android-list-options'),
    }));
    t.check('a withdrawn review leaves focus on a visible successor', pausedFocus.visible && pausedFocus.successor, JSON.stringify(pausedFocus));
    await click(page, '.brand[data-view="home"]');
    await page.waitForSelector('#view-home:not([hidden])');
    await page.goto(`${page.__origin}/#/read/saved`, { waitUntil: 'load' });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#list-revision-offer').hidden
      && ['review', 'check', 'choose'].every((name) => document.querySelector(`#list-revision-${name}`).disabled));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => !document.querySelector('#btn-mark-all-read').disabled);
    t.check('the offer and controls return when saving resumes without a reload', await page.evaluate((key, original) => (
      !document.querySelector('#list-revision-offer').hidden
      && ['review', 'check', 'choose'].every((name) => !document.querySelector(`#list-revision-${name}`).disabled)
      && localStorage.getItem(key) === original
    ), KEY, before));
    await openOptions(page);
    await page.$eval('#list-revision-check', (node) => node.focus());
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.waitForFunction(() => document.querySelector('#btn-mark-all-read').disabled);
    const optionsFocus = await page.evaluate(() => {
      const sheet = document.querySelector('#android-list-sheet');
      const active = document.activeElement;
      return {
        id: active?.id, tag: active?.tagName,
        successor: sheet?.open
          ? active === sheet.querySelector('.android-sheet-header button')
          : active?.matches('#list-actions > summary'),
      };
    });
    t.check('a pause keeps focus in the open options', optionsFocus.successor, JSON.stringify(optionsFocus));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => !document.querySelector('#btn-mark-all-read').disabled);
    // Keep the remaining fault cases independent if the resume check fails.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#list-revision-offer:not([hidden])');

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
      && document.activeElement?.matches('#list-actions > summary, #android-list-options')
      && document.activeElement.getClientRects().length > 0
    )));
    await openOptions(page);
    await click(page, '#list-revision-check');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('already includes'));
    t.check('a repeated manual check makes no second update', await page.$eval('#list-revision-status', (node) => node.textContent.includes('unchanged')));
    await openOptions(page);
    await click(page, '#btn-duplicate-list');
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).active !== 'saved', {}, KEY);
    await openOptions(page);
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

    // A hash-only goto stays in the same document, so reload to reseed the pre-update list.
    await page.goto(`${page.__origin}/#/read/saved`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
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
    t.check('a verification pause withdraws the offer and disables all comparison controls', await page.evaluate(() => (
      document.querySelector('#list-revision-offer').hidden
      && ['review', 'check', 'choose'].every((name) => document.querySelector(`#list-revision-${name}`).disabled)
    )));
    await page.evaluate(() => { sessionStorage.setItem('revision-keep-saved', '1'); });
    await page.reload({ waitUntil: 'load' });
    const reopened = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    t.check('reopening shows the saved update and clears the uncertain warning',
      JSON.stringify(reopened.lists.saved.itemIds) === JSON.stringify(expected)
      && await page.$eval('#list-revision-uncertain-banner', (node) => node.hidden));

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#list-revision-offer:not([hidden])');
    const preflightBefore = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await page.evaluate(() => { window.__revisionFault = 'preflight'; });
    await click(page, '#list-revision-review');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('Could not read the saved data'));
    t.check('a pre-write pause does not claim that a list update may have happened', await page.evaluate((key, original) => (
      localStorage.getItem(key) === original
      && document.querySelector('#list-revision-uncertain-banner').hidden
      && document.querySelector('#blocked-banner').hidden
      && document.querySelector('#list-revision-offer').hidden
      && ['review', 'check', 'choose'].every((name) => document.querySelector(`#list-revision-${name}`).disabled)
    ), KEY, preflightBefore));
  },
};

export const legacyOffline = {
  id: 'legacy-offline',
  title: 'restored legacy orders can be prepared and compared offline without changing saved data',
  async run(harnessPage, t) {
    const browser = harnessPage.browser();
    const origin = harnessPage.__origin;
    const context = await browser.createBrowserContext();
    let workerSession;
    let pageSession;
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewport({ width: 1280, height: 900 });
      await page.setCacheEnabled(false);
      await page.setBypassServiceWorker(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin || url.protocol === 'blob:' || url.protocol === 'data:') return request.continue();
        return request.abort('blockedbyclient');
      });
      await page.evaluateOnNewDocument((expectedOrigin, ids) => {
        if (location.origin !== expectedOrigin) return;
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: 'light' }));
        const realFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url, location.href);
          if (url.origin !== expectedOrigin) throw new Error('External requests are blocked by this test.');
          if (url.pathname === window.__heldOfflineFile) {
            window.__heldOfflineStarted = true;
            return new Promise((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) return reject(new Error('The held request has no cancellation signal.'));
              const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
              if (signal.aborted) abort();
              else signal.addEventListener('abort', abort, { once: true });
            });
          }
          const response = await realFetch(input, init);
          if (url.pathname !== '/data/catalog.json' || !response.ok) return response;
          const catalog = await response.json();
          catalog.lists = catalog.lists.filter((entry) => !ids.includes(entry.id));
          return new Response(JSON.stringify(catalog), { status: response.status, headers: response.headers });
        };
      }, origin, legacyFixtures.map(({ id }) => id));

      await page.goto(`${origin}/#/data`, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 });
      await page.waitForSelector('#view-data:not([hidden])');
      const worker = await browser.waitForTarget((candidate) => candidate.type() === 'service_worker'
        && candidate.browserContext() === context && candidate.url() === `${origin}/sw.js`);
      workerSession = await worker.createCDPSession();
      await workerSession.send('Network.enable');
      pageSession = await page.createCDPSession();
      await pageSession.send('Network.enable');
      const responses = [];
      pageSession.on('Network.responseReceived', ({ response }) => {
        responses.push({ url: response.url, worker: response.fromServiceWorker === true });
      });

      const backup = legacyBackup();
      await page.evaluate((value) => {
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(value)], 'legacy-backup.json', { type: 'application/json' }));
        const input = document.querySelector('#restore-file');
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, backup);
      await page.waitForSelector('#ask[open]');
      await click(page, '#ask-ok');
      await page.waitForFunction(() => document.querySelector('#restore-report').textContent.includes('Reading data restored'));
      const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
      t.check('a real backup restore keeps both saved legacy lists, notes and progress',
        ['lists', 'listOrder', 'read', 'notes'].every((field) => JSON.stringify(restored[field]) === JSON.stringify(backup[field])));
      const catalogIds = await page.evaluate(async () => (await (await fetch('/data/catalog.json')).json()).lists.map(({ id }) => id));
      t.check('neither old guide is discoverable in the active catalog',
        legacyFixtures.every(({ id }) => !catalogIds.includes(id)));
      t.check('restoring the backup did not automatically prepare any offline bundle',
        (await bundleInventory(page)).length === 0);

      for (const [index, fixture] of legacyFixtures.entries()) {
        await page.setViewport(index ? { width: 412, height: 915, isMobile: true, hasTouch: true }
          : { width: 1280, height: 900 });
        await page.goto(`${origin}/#/read/${fixture.saved}`, { waitUntil: 'load' });
        await page.waitForFunction((id) => location.hash === `#/read/${id}` && !document.querySelector('#view-read').hidden, {}, fixture.saved);
        await page.waitForSelector('#list-offline-action:not([hidden])', { timeout: 15000 });
        await page.$eval('#list-actions', (node) => { node.open = true; });
        await page.waitForFunction(() => document.querySelector('#list-offline-action').dataset.state === 'idle', { timeout: 30000 });
        const control = await page.$eval('#list-offline-action', (node) => {
          const box = node.getBoundingClientRect();
          return { text: node.textContent.trim(), name: node.getAttribute('aria-label'), width: box.width, height: box.height,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
        t.check(`${fixture.id}: the offline action is visible, named and usable at this browser width`,
          control.text === 'Make published order available offline' && control.name.includes(control.text)
          && control.width >= 24 && control.height >= 24 && !control.overflow, JSON.stringify(control));

        if (index === 1) {
          for (const [theme, width, zoom] of [
            ['light', 320, 1], ['dark', 320, 1], ['system', 320, 1], ['forced', 320, 1], ['light', 640, 2],
          ]) {
            await page.setViewport({ width, height: 900, isMobile: true, hasTouch: true });
            await page.evaluate((choice, scale) => {
              if (choice === 'system') document.documentElement.removeAttribute('data-theme');
              else document.documentElement.setAttribute('data-theme', choice === 'forced' ? 'light' : choice);
              document.documentElement.style.zoom = String(scale);
            }, theme, zoom);
            await pageSession.send('Emulation.setEmulatedMedia', { features: [
              { name: 'forced-colors', value: theme === 'forced' ? 'active' : 'none' },
              { name: 'prefers-reduced-motion', value: 'reduce' },
              { name: 'prefers-color-scheme', value: theme === 'system' ? 'dark' : 'light' },
            ] });
            await page.focus('#list-offline-action');
            await page.keyboard.press('Tab');
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            const layout = await page.$eval('#list-offline-action', (node) => {
              const box = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return {
                focused: document.activeElement === node && node.matches(':focus-visible'),
                outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
                fits: box.left >= 0 && box.right <= innerWidth && box.width >= 24 && box.height >= 24,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
                forced: matchMedia('(forced-colors: active)').matches,
              };
            });
            t.check(`${fixture.id}: ${theme} at ${width}px and ${zoom * 100}% keeps focus and the action visible`,
              layout.focused && layout.outline && layout.fits && !layout.overflow && layout.reduced
              && layout.forced === (theme === 'forced'), JSON.stringify(layout));
          }
          await pageSession.send('Emulation.setEmulatedMedia', { features: [] });
          await page.evaluate(() => {
            document.documentElement.setAttribute('data-theme', 'light');
            document.documentElement.style.zoom = '';
          });
          await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
        }

        const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
        await removeGenericPayload(page, fixture.file);
        await workerSession.send('Network.emulateNetworkConditions', {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
        });
        await page.setOfflineMode(true);
        await click(page, '#list-revision-check');
        await page.waitForFunction(() => document.querySelector('#list-revision-status').textContent.includes('Your list is unchanged.'));
        t.check(`${fixture.id}: an unavailable offline comparison leaves every saved byte unchanged`,
          await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, before));
        await workerSession.send('Network.emulateNetworkConditions', {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        await page.setOfflineMode(false);

        await click(page, '#list-offline-action');
        await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#list-offline-action').dataset.state), { timeout: 30000 });
        const ready = await page.$eval('#list-offline-action', (node) => node.dataset.state === 'ready');
        const inventory = await bundleInventory(page);
        t.check(`${fixture.id}: deliberate preparation verifies the original published order`,
          ready && inventory.some((item) => item.listId === fixture.id && item.file === fixture.file
            && item.complete && item.payloadId === fixture.id), JSON.stringify(inventory));
        if (!ready) throw new Error('Legacy offline preparation did not complete.');
        t.check(`${fixture.id}: preparing does not change saved reading data`,
          await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, before));

        await page.evaluate((file) => { window.__heldOfflineFile = `/data/${file}`; window.__heldOfflineStarted = false; }, fixture.file);
        await page.focus('#list-offline-action');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__heldOfflineStarted, { timeout: 30000 });
        const pending = await page.evaluate(() => ({
          actionDisabled: document.querySelector('#list-offline-action').disabled,
          cancelVisible: document.querySelector('#list-offline-cancel').checkVisibility(),
          cancelFocused: document.activeElement === document.querySelector('#list-offline-cancel'),
          status: document.querySelector('#list-offline-status').textContent,
        }));
        t.check(`${fixture.id}: refresh shows progress and moves keyboard focus to Cancel`,
          pending.actionDisabled && pending.cancelVisible && pending.cancelFocused && /Fetched|Verified/.test(pending.status),
          JSON.stringify(pending));
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#list-offline-status').textContent.includes('earlier completed offline copy is unchanged'));
        await page.evaluate(() => { window.__heldOfflineFile = null; });
        t.check(`${fixture.id}: cancelling refresh retains the verified copy and saved data`,
          (await bundleInventory(page)).some((item) => item.listId === fixture.id && item.payloadId === fixture.id)
          && await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, before));

        await page.waitForFunction(async (file) => {
          for (const name of await caches.keys()) {
            if (!name.startsWith('mrt-offline-') || name.startsWith('mrt-offline-content-v1-')) continue;
            if (await (await caches.open(name)).match(`${location.origin}/data/${file}`)) return true;
          }
          return false;
        }, { timeout: 15000 }, fixture.file);
        const removed = await removeGenericPayload(page, fixture.file);
        responses.length = 0;
        await workerSession.send('Network.emulateNetworkConditions', {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
        });
        await page.setOfflineMode(true);
        await click(page, '#list-revision-check');
        await page.waitForSelector('#ask[open]', { timeout: 15000 });
        await click(page, '#ask-cancel');
        await page.waitForSelector('#ask:not([open])');
        t.check(`${fixture.id}: the verified bundle alone supports an offline comparison`,
          removed > 0 && responses.some((response) => response.url === `${origin}/data/${fixture.file}` && response.worker)
          && await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, before));
        await workerSession.send('Network.emulateNetworkConditions', {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        await page.setOfflineMode(false);
      }
      t.check('the real-worker journey has no page errors', errors.length === 0, JSON.stringify(errors));
    } finally {
      if (workerSession) {
        await workerSession.send('Network.emulateNetworkConditions', {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
      }
      if (pageSession) await pageSession.detach();
      if (workerSession) await workerSession.detach();
      await context.close();
    }
  },
};

export const legacyPackagedOrders = {
  async run(page, t) {
    const backup = legacyBackup();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      return url.origin === page.__origin || url.protocol === 'blob:' || url.protocol === 'data:'
        ? request.continue() : request.abort('blockedbyclient');
    });
    await page.evaluateOnNewDocument((seed, key) => {
      if (location.protocol === 'about:') return;
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
    }, backup, KEY);
    for (const fixture of legacyFixtures) {
      await page.goto(`${page.__origin}/#/read/${fixture.saved}`, { waitUntil: 'load' });
      await page.waitForSelector('#view-read:not([hidden])');
      const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
      await openOptions(page);
      const state = await page.evaluate(async (file) => ({
        actionHidden: document.querySelector('#list-offline-action').hidden,
        statusHidden: document.querySelector('#list-offline-status').hidden,
        cancelHidden: document.querySelector('#list-offline-cancel').hidden,
        controlled: Boolean(navigator.serviceWorker?.controller),
        payloadId: (await (await fetch(`/data/${file}`)).json()).id,
      }), fixture.file);
      t.check(`${fixture.id}: packaged Android keeps the original order but hides the unavailable offline action`,
        state.actionHidden && state.statusHidden && state.cancelHidden && !state.controlled
        && state.payloadId === fixture.id, JSON.stringify(state));
      await click(page, '#list-revision-check');
      await page.waitForSelector('#ask[open]');
      await click(page, '#ask-cancel');
      await page.waitForSelector('#ask:not([open])');
      t.check(`${fixture.id}: packaged comparison cancellation preserves saved bytes`,
        await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, before));
    }
    t.check('the packaged legacy journey has no page errors', errors.length === 0, JSON.stringify(errors));
  },
};
