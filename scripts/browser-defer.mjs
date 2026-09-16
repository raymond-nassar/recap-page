import {
  createEmptyState, createList, addIssuesToList, setDeferred, markRead, exportBackup,
} from '../src/js/lib/model.js';

const KEY = 'mrt.state.v2';
const ids = [510001, 510002, 510003];
const row = (id, act) => `#rows [data-key="${id}"][data-act="${act}"]`;
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const raw = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const saved = async (page) => JSON.parse(await raw(page));

function fixture() {
  let state = createList(createEmptyState(), { id: 'defer', name: 'Deferral fixture' });
  state = addIssuesToList(state, 'defer', ids.map((issueId, index) => ({
    issueId, title: `Deferral fixture #${index + 1}`, number: String(index + 1),
    seriesName: 'Deferral fixture', seriesId: 510, digitalId: 710001 + index,
    url: `https://www.marvel.com/comics/issue/${issueId}/fixture`,
    collectedIn: 'Fixture volume', source: 'manual',
  }))).state;
  return createList(state, { id: 'other', name: 'Other list', itemIds: ids });
}

async function setup(page, state = fixture()) {
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((initial, key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'all' }));
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) {
        return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      }
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Deferral fixture blocks external requests'));
    };
  }, exportBackup(state), KEY);
  await page.goto(`${page.__origin}/#/read/defer`, { waitUntil: 'load' });
  await page.waitForSelector('#view-read:not([hidden])');
}

async function full(page) {
  if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
  await page.waitForSelector('#rows .row');
}

async function filter(page, value) {
  await click(page, `input[name="filter"][value="${value}"]`);
}

async function deferredReview(page, t, trigger, label) {
  const history = await page.evaluate(() => window.history.length);
  await click(page, trigger);
  await page.waitForFunction(() => document.querySelector('#full').open
    && document.querySelector('input[name="filter"][value="deferred"]').checked);
  const result = await page.evaluate(() => ({
    history: window.history.length, hash: location.hash,
    keys: [...document.querySelectorAll('#rows [data-act="read"]')].map((e) => Number(e.dataset.key)),
    focus: document.activeElement.matches('input[name="filter"][value="deferred"]')
      && document.activeElement.checkVisibility(),
    earlier: document.querySelector('#review-earlier').hidden,
  }));
  t.check(`${label}: actual Deferred rows, one history entry and visible filter focus`,
    result.history === history + 1 && result.focus && result.earlier
    && result.hash.includes('filter=deferred') && result.keys.join() === `${ids[0]},${ids[2]}`,
    JSON.stringify(result));
}

export const deferNext = {
  id: 'defer-next',
  title: 'Per-list deferral keeps hero, shelf, Done and review truthful',
  async run(page, t) {
    await setup(page);
    const before = await saved(page);
    await click(page, '#btn-hero-defer');
    t.check('Defer advances the hero without reading or reordering either list',
      await page.$eval('#hero-title', (e) => e.textContent.endsWith('#2'))
      && JSON.stringify((await saved(page)).read) === JSON.stringify(before.read)
      && (await saved(page)).lists.defer.itemIds.join() === ids.join()
      && (await saved(page)).lists.other.deferredIssueIds.length === 0);
    t.check('Coming up omits deferred first issue and current hero',
      await page.$eval('#shelf', (e) => e.textContent.includes('#3') && !e.textContent.includes('#1')
        && !e.textContent.includes('#2')));
    await full(page);
    await click(page, row(ids[2], 'defer'));
    await filter(page, 'unread');
    t.check('Unread retains all deferred issues with explicit text',
      await page.$$eval('#rows .row', (rows) => rows.length === 3
        && rows.filter((e) => e.textContent.includes('Deferred in this list')).length === 2));
    await click(page, '#btn-hero-done');
    t.check('Done reads only queued issue and focuses Nothing queued, never all-read',
      Object.keys((await saved(page)).read).join() === String(ids[1])
      && await page.evaluate(() => !document.querySelector('#all-deferred').hidden
        && document.querySelector('#all-read').hidden && document.activeElement.id === 'all-deferred-h'));
    await click(page, '#full > summary');
    await deferredReview(page, t, '#btn-review-deferred', 'Reading');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !location.hash.includes('filter=deferred'));
    await click(page, '.brand[data-view="home"]');
    t.check('Home names actual read progress and separate deferred remainder',
      await page.$eval('#chero-count', (e) => e.textContent.includes('1 of 3 issues read')
        && e.textContent.includes('2 deferred'))
      && await page.$eval('#chero-next', (e) => e.textContent.includes('Nothing queued')));
    await deferredReview(page, t, '#btn-chero-deferred', 'Home');
    await click(page, row(ids[0], 'defer'));
    t.check('Resume returns the original first position, removes filtered row and preserves visible focus',
      await page.$eval('#hero-title', (e) => e.textContent.endsWith('#1'))
      && await page.evaluate(() => document.activeElement !== document.body
        && document.activeElement.isConnected && document.activeElement.checkVisibility())
      && (await saved(page)).lists.defer.itemIds.join() === ids.join());
    await page.evaluate(() => {
      window.__deferLaunch = [];
      window.open = (...args) => {
        window.__deferLaunch.push({ args, active: navigator.userActivation.isActive });
        return { opener: null };
      };
    });
    await page.focus('#btn-hero-read');
    await page.keyboard.press('Enter');
    t.check('Resumed issue still launches synchronously in its own reader tab',
      await page.evaluate(() => window.__deferLaunch.length === 1 && window.__deferLaunch[0].active
        && window.__deferLaunch[0].args[0].includes('open.html')
        && window.__deferLaunch[0].args[1] === '_blank'));
  },
};

export const deferLifecycle = {
  id: 'defer-lifecycle',
  title: 'Deferral removal Undo merges only the removed member and copies stay independent',
  async run(page, t) {
    await setup(page, setDeferred(fixture(), 'defer', ids[0]));
    await full(page);
    await click(page, row(ids[0], 'remove'));
    await click(page, row(ids[1], 'defer'));
    await page.evaluate(() => { location.hash = '#/read/other?full=1'; });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).active === 'other'
      && document.querySelector('#rows [data-key="510001"][data-act="read"]'));
    await click(page, row(ids[0], 'read'));
    const readAt = (await saved(page)).read[ids[0]];
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('#app-report button')].find((e) => e.textContent === 'Undo remove');
      if (!button) throw new Error('Missing removal Undo');
      button.click();
    });
    const restored = await saved(page);
    t.check('Undo restores A dormant intent and source position without changing B or current global read',
      restored.lists.defer.deferredIssueIds.join() === `${ids[0]},${ids[1]}`
      && restored.lists.defer.itemIds.join() === ids.join() && restored.read[ids[0]] === readAt && !!readAt);
    await click(page, row(ids[0], 'read'));
    await page.evaluate(() => { location.hash = '#/read/defer?full=1'; });
    await page.waitForFunction(() => document.querySelector('#hero-title').textContent.endsWith('#3'));
    t.check('Marking A unread reactivates its retained intent without changing the other list',
      !(await saved(page)).read[ids[0]] && (await saved(page)).lists.other.deferredIssueIds.length === 0);
    await click(page, '#btn-duplicate-list');
    const copied = await saved(page);
    const copyId = copied.active;
    t.check('Duplicate carries both choices under a new list identity',
      copyId !== 'defer' && copied.lists[copyId].deferredIssueIds.join() === `${ids[0]},${ids[1]}`);
    await full(page);
    await click(page, row(ids[0], 'defer'));
    t.check('Resuming a copied issue leaves the original choice intact',
      (await saved(page)).lists.defer.deferredIssueIds.includes(ids[0])
      && !(await saved(page)).lists[copyId].deferredIssueIds.includes(ids[0]));
    await page.reload({ waitUntil: 'load' });
    t.check('Reload preserves independent copied choices and both original positions',
      (await saved(page)).lists.defer.itemIds.join() === ids.join()
      && (await saved(page)).lists[copyId].deferredIssueIds.join() === String(ids[1]));
    await page.setViewport({ width: 320, height: 900 });
    await full(page);
    for (const [label, expected] of [['Resume', false], ['Defer', true]]) {
      await click(page, row(ids[1], 'more'));
      await page.focus(row(ids[1], 'defer'));
      await page.keyboard.press('Enter');
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const rect = active.getBoundingClientRect();
        return { act: active.dataset.act, key: active.dataset.key, tag: active.tagName,
          visible: active !== document.body && active.checkVisibility()
            && rect.top >= 0 && rect.bottom <= innerHeight };
      });
      t.check(`320px ${label} retains visible keyboard focus in the acted row`,
        focus.visible && focus.key === String(ids[1])
        && (await saved(page)).lists[copyId].deferredIssueIds.includes(ids[1]) === expected,
        JSON.stringify(focus));
    }
  },
};

export const deferPersistence = {
  id: 'defer-persistence',
  title: 'Deferral survives restore, refused saves and same-origin foreign writes',
  async run(page, t) {
    const state = markRead(setDeferred(setDeferred(fixture(), 'defer', ids[0]), 'defer', ids[1]), ids[0], true, 510);
    await setup(page, state);
    const before = await raw(page);
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      window.__restoreDeferSet = () => { Storage.prototype.setItem = set; };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mrt.state.v2') throw new DOMException('Fixture save refused', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await click(page, '#btn-hero-defer');
    t.check('Refused Defer leaves canonical bytes and the current hero unchanged',
      await raw(page) === before && await page.$eval('#hero-title', (e) => e.textContent.endsWith('#3')));
    await page.evaluate(() => window.__restoreDeferSet());
    await click(page, '.ri[data-view="data"]');
    await page.evaluate((backup) => {
      const files = new DataTransfer();
      files.items.add(new File([JSON.stringify(backup)], 'deferral.json', { type: 'application/json' }));
      const input = document.querySelector('#restore-file');
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, exportBackup(setDeferred(state, 'defer', ids[2])));
    await page.waitForFunction(() => document.querySelector('#restore-report').textContent.trim().length > 0);
    t.check('JSON restore preserves unread and dormant intent and read timestamp',
      (await saved(page)).lists.defer.deferredIssueIds.join() === ids.join()
      && (await saved(page)).read[ids[0]] === 510);
    await click(page, '#btn-undo-restore');
    t.check('Undo restore returns the previous exact list choices',
      (await saved(page)).lists.defer.deferredIssueIds.join() === `${ids[0]},${ids[1]}`);
    await page.evaluate(async () => {
      const { Store } = await import('./js/storage.js');
      window.__staleDeferStore = new Store();
      window.__staleDeferStore.load();
    });
    const other = await page.browserContext().newPage();
    try {
      await other.setViewport({ width: 1280, height: 900 });
      await other.evaluateOnNewDocument(() => {
        const real = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url, location.href);
          return url.origin === location.origin ? real(input, init)
            : Promise.reject(new TypeError('Deferral fixture blocks external requests'));
        };
      });
      await other.goto(`${page.__origin}/`, { waitUntil: 'load' });
      await other.evaluate(async (issueId) => {
        const { Store } = await import('./js/storage.js');
        const { setDeferred } = await import('./js/lib/model.js');
        const store = new Store();
        store.load();
        store.update((s) => setDeferred(s, 'defer', issueId));
      }, ids[2]);
      const foreign = await raw(other);
      const conflict = await page.evaluate(async (issueId) => {
        const { setDeferred } = await import('./js/lib/model.js');
        const store = window.__staleDeferStore;
        store.update((s) => setDeferred(s, 'defer', issueId, false));
        return { ok: store.lastUpdateOk, intent: store.state.lists.defer.deferredIssueIds };
      }, ids[1]);
      t.check('Stale ordinary save refuses and adopts, never overwriting foreign deferral',
        !conflict.ok && conflict.intent.join() === ids.join() && await raw(page) === foreign);
      await page.goto(`${page.__origin}/#/read/defer?full=1`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      t.check('Reload paints retained intent on read rows with an explicit Clear action',
        await page.$eval(row(ids[0], 'defer'), (e) => e.textContent === 'Clear deferral')
        && (await saved(page)).read[ids[0]] === 510);
      await click(page, row(ids[0], 'defer'));
      t.check('Clearing dormant intent preserves the global read timestamp',
        (await saved(page)).read[ids[0]] === 510
        && !(await saved(page)).lists.defer.deferredIssueIds.includes(ids[0]));
    } finally {
      await other.close();
    }
  },
};
