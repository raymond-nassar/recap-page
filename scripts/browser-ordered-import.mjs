import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';

const KEY = 'mrt.state.v2';
const DRAFT_KEY = 'mrt.import.draft.v1';
const click = (page, selector) => page.$eval(selector, (node) => node.click());
const source = '# Exact source\r\n\r\nprose stays\r\n- [x] [One](https://www.marvel.com/comics/issue/2092/)\r\n- [ ] Middle\r\n- [ ] [Three](https://www.marvel.com/comics/issue/2198/)\r\n';
const read = (page) => page.evaluate((readerKey, draftKey) => ({
  reader: JSON.parse(localStorage.getItem(readerKey)),
  draft: JSON.parse(localStorage.getItem(draftKey)),
}), KEY, DRAFT_KEY);

async function setup(page) {
  let initial = createList(createEmptyState(), { id: 'prefix', name: 'Prefix' });
  initial = addIssuesToList(initial, 'prefix', [{ issueId: 9, title: 'Original', collectedIn: 'Original edition' }]).state;
  initial = markRead(initial, 9, true, 20);
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((seed, draftKey) => {
    if (!localStorage.getItem('mrt.state.v2')) localStorage.setItem('mrt.state.v2', JSON.stringify(seed));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
    const real = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/search/issues')) {
        const q = url.searchParams.get('q');
        const id = q === 'Draft (2026) #4' ? 4 : q === 'Draft (2026) #5' ? 5 : 2093;
        const items = [{ id, title: q === 'Middle' ? 'Matched (2026) #2' : q, issueNumber: '2' }];
        if (q === 'Middle') items.push({ id: 22, title: 'Alternative (2026) #2', issueNumber: '2' });
        return Promise.resolve(new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.origin === location.origin) return real(input, options);
      return Promise.reject(new TypeError('Import fixture blocks other external requests'));
    };
    window.__importFault = null;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === draftKey && window.__importFault === 'prepare') return;
      if (key === draftKey && window.__importFault === 'checkpoint') {
        const old = JSON.parse(this.getItem(key) || 'null');
        const next = JSON.parse(value);
        if (old?.pending && next.pending === null) return;
      }
      return set.call(this, key, value);
    };
  }, exportBackup(initial), DRAFT_KEY);
  await page.goto(`${page.__origin}/#/add-import`, { waitUntil: 'load' });
  await page.waitForSelector('#view-add-import:not([hidden])');
}

async function submit(page, text = source, intoNew = false) {
  await page.evaluate((value, newList) => {
    const field = document.querySelector('#import-text');
    field.value = '';
    field.setSelectionRange(0, 0);
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', value);
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true }));
    field.value = value;
    document.querySelector('#import-text').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#import-new-list').checked = newList;
    document.querySelector('#import-report').replaceChildren();
    document.querySelector('#form-import').requestSubmit();
  }, text, intoNew);
  await page.waitForFunction(() => document.querySelector('#import-report').textContent.length > 0);
  await page.waitForFunction(() => document.querySelector('#import-report').textContent.includes('Import source is saved')
    || document.querySelector('#import-report').textContent.includes('Import draft was not saved')
    || document.querySelector('#import-report').textContent.includes('Comics were saved')
    || document.querySelector('#import-report').textContent.includes('changed'));
}

async function resolve(page, title, explicit = false) {
  await click(page, `#import-report button[aria-label="Find match: ${title}"]`);
  if (explicit) {
    await page.waitForSelector('#import-report button[aria-label="This one: Matched (2026) #2 for Middle"]');
    await click(page, '#import-report button[aria-label="This one: Matched (2026) #2 for Middle"]');
  }
  await page.waitForFunction((name, key) => {
    const draft = JSON.parse(localStorage.getItem(key));
    return draft?.occurrences.some((entry) => entry.title === name && entry.applied);
  }, {}, title, DRAFT_KEY);
}

async function discard(page) {
  await page.bringToFront();
  await click(page, '#import-report button:nth-of-type(2)');
  await page.waitForSelector('#ask[open]');
  await click(page, '#ask-ok');
  try {
    await page.waitForFunction((key) => localStorage.getItem(key) === null, {}, DRAFT_KEY);
  } catch (error) {
    console.error('IMPORT discard-report', await page.$eval('#import-report', (node) => node.textContent));
    throw error;
  }
}

export function importScenarios({ preparePage }) {
  return [
    {
      id: 'ordered-import',
      title: 'Pasted gaps resolve at exact original positions with explicit duplicate provenance',
      async run(page, t) {
        await setup(page);
        await submit(page);
        let saved = await read(page);
        t.check('linked first and third publish immediately after preserved prefix', saved.reader.lists.prefix.itemIds.join() === '9,2092,2198');
        t.check('exact raw source and all physical positions survive partial publication',
          saved.draft.rawText === source && saved.draft.occurrences.map((row) => row.line).join() === '4,5,6');
        await resolve(page, 'Middle', true);
        saved = await read(page);
        t.check('explicit middle selection fills #1/#2/#3 rather than appending', saved.reader.lists.prefix.itemIds.join() === '9,2092,2093,2198');
        t.check('blank flags preserve shared read markers and original edition', saved.reader.read[9] === 20
          && Boolean(saved.reader.read[2092]) && saved.reader.lists.prefix.collectedIn[9] === 'Original edition');
        t.check('async row replacement places focus on described report', await page.evaluate(() => document.activeElement.id === 'import-report'));
        await discard(page);
        const reverse = '## Early\r\n- [ ] Draft (2026) #4\r\n- [ ] Draft (2026) #5\r\n- [ ] [One](https://www.marvel.com/comics/issue/2092/)\r\n## Late\r\n- [ ] [Five](https://www.marvel.com/comics/issue/5/)\r\n- [ ] [Original](https://www.marvel.com/comics/issue/9/)';
        await submit(page, reverse, true);
        await resolve(page, 'Draft (2026) #5');
        await resolve(page, 'Draft (2026) #4');
        saved = await read(page);
        const list = saved.reader.lists[saved.draft.destination.id];
        t.check('two reverse-resolved gaps and earlier duplicate have exact eventual source order', list.itemIds.join() === '4,5,2092,9');
        t.check('duplicate provenance stays complete and first edition wins only for owned membership',
          saved.draft.occurrences.length === 5 && list.collectedIn[5] === 'Early' && saved.reader.read[9] === 20);
        t.check('existing destination order is not relocated by another import', saved.reader.lists.prefix.itemIds.join() === '9,2092,2093,2198');
      },
    },
    {
      id: 'import-draft-lifecycle',
      title: 'Import source survives failed checkpoints, reload, transfer, stale tabs and real offline arrival',
      async run(page, t) {
        await setup(page);
        await page.evaluate(() => { window.__importFault = 'prepare'; });
        await submit(page);
        let saved = await read(page);
        t.check('unverified source prepare does not publish comics', saved.draft === null && saved.reader.lists.prefix.itemIds.join() === '9');
        t.check('unsaved source remains exact, editable and departure-guarded', await page.evaluate((raw) => {
          const field = document.querySelector('#import-text');
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return field.value === raw.replace(/\r\n?/g, '\n') && !field.readOnly && event.defaultPrevented;
        }, source));
        await page.evaluate(() => { window.__importFault = null; });
        await submit(page);
        console.log('IMPORT lifecycle-stage=normal-submit');
        await page.reload({ waitUntil: 'load' });
        console.log('IMPORT lifecycle-stage=reloaded');
        await page.waitForSelector('#view-add-import:not([hidden])');
        t.check('fresh document resumes exact source without provider data', await page.$eval('#import-text', (node, raw) => node.value === raw.replace(/\r\n?/g, '\n') && node.readOnly, source)
          && (await read(page)).draft.rawText === source);
        saved = await read(page);
        const exported = JSON.stringify(saved.draft);
        const rawReader = await page.evaluate((key) => localStorage.getItem(key), KEY);
        await page.goto(`${page.__origin}/#/data`, { waitUntil: 'load' });
        await page.waitForSelector('#view-data:not([hidden])');
        t.check('complete transfer explicitly includes separately labeled draft file',
          await page.$eval('#view-data', (node) => node.textContent.includes('separate import-draft file') && node.textContent.includes('Reading-data and completion-history backups do not include it')));
        await page.evaluate((text) => {
          const input = document.querySelector('#restore-draft');
          const transfer = new DataTransfer();
          transfer.items.add(new File([text], 'import.json', { type: 'application/json' }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, exported);
        await page.waitForSelector('#ask[open]');
        await click(page, '#ask-ok');
        await page.waitForFunction(() => document.querySelector('#draft-transfer-report').textContent.includes('restored'));
        saved = await read(page);
        t.check('separate draft restore mints new permission and preserves old source without changing reader',
          JSON.stringify(saved.draft) !== exported && saved.draft.previousSources.includes(exported)
          && await page.evaluate((key, raw) => localStorage.getItem(key) === raw, KEY, rawReader));
        await page.goto(`${page.__origin}/#/add-import`, { waitUntil: 'load' });
        await page.waitForSelector('#view-add-import:not([hidden])');
        await click(page, '#import-report button:first-of-type');
        try {
          await page.waitForSelector('#import-report button[aria-label="Find match: Middle"]');
        } catch (error) {
          console.error('IMPORT resume-report', await page.$eval('#import-report', (node) => node.textContent));
          throw error;
        }
        const other = await page.browserContext().newPage();
        console.log('IMPORT lifecycle-stage=resumed-transfer');
        try {
          await preparePage(other, page.__origin, page.__mutation);
          await setup(other);
          console.log('IMPORT lifecycle-stage=other-tab');
          await discard(page);
          console.log('IMPORT lifecycle-stage=discarded');
          await other.waitForFunction((key) => localStorage.getItem(key) === null, {}, DRAFT_KEY);
          await other.bringToFront();
          await other.waitForFunction(() => !document.querySelector('#import-report button[aria-label^="Find match"]'));
          t.check('cross-tab removal withdraws durable gap actions', await other.$eval('#import-report', (node) => !node.querySelector('button[aria-label^="Find match"]')));
        } finally {
          await other.close();
          await page.bringToFront();
        }
        await page.evaluate(() => { window.__importFault = 'checkpoint'; });
        await submit(page, '- [x] [One](https://www.marvel.com/comics/issue/2092/)\n- [ ] Middle', true);
        saved = await read(page);
        t.check('saved comics plus failed checkpoint is reported distinctly with pending source', Boolean(saved.draft.pending)
          && await page.$eval('#import-report', (node) => node.textContent.includes('Comics were saved')));
        await page.evaluate(async (key) => {
          const { Store } = await import('/js/storage.js');
          const { markRead } = await import('/js/lib/model.js');
          const reader = new Store();
          reader.load();
          reader.update((state) => markRead(state, 2092, false));
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }));
        }, KEY);
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('#import-report button:first-of-type');
        await click(page, '#import-report button:first-of-type');
        await page.waitForFunction(() => document.querySelector('#import-report').textContent.includes('uncertain'));
        saved = await read(page);
        t.check('return-to-before after deliberate unread refuses historical marker replay', !saved.reader.read[2092]
          && Boolean(saved.draft.pending) && saved.draft.rawText.includes('Middle'));
        await discard(page);
        await submit(page, source, true);
        const offline = await page.browserContext().newPage();
        const responses = [];
        let workerSession;
        let pageSession;
        try {
          await offline.setViewport({ width: 1280, height: 900 });
          await offline.setBypassServiceWorker(false);
          await offline.setCacheEnabled(false);
          await offline.setRequestInterception(true);
          offline.on('request', (request) => new URL(request.url()).origin === page.__origin ? request.continue() : request.abort());
          console.log('IMPORT lifecycle-stage=real-worker');
          await offline.goto(`${page.__origin}/#/add-import`, { waitUntil: 'load' });
          await offline.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
          await offline.reload({ waitUntil: 'load' });
          await offline.waitForFunction(async () => {
            const names = await caches.keys();
            for (const name of names.filter((value) => value.startsWith('mrt-offline-'))) {
              const cache = await caches.open(name);
              if (await cache.match('/js/lib/importDraft.js')) return true;
            }
            return false;
          });
          const target = await page.browser().waitForTarget((candidate) => candidate.type() === 'service_worker'
            && candidate.browserContext() === page.browserContext() && candidate.url() === `${page.__origin}/sw.js`);
          workerSession = await target.createCDPSession();
          await workerSession.send('Network.enable');
          await workerSession.send('Network.emulateNetworkConditions', {
            offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
          });
          await offline.setOfflineMode(true);
          pageSession = await offline.createCDPSession();
          await pageSession.send('Network.enable');
          await pageSession.send('Network.setCacheDisabled', { cacheDisabled: true });
          pageSession.on('Network.responseReceived', ({ response }) => {
            if (response.fromServiceWorker === true) responses.push(new URL(response.url).pathname);
          });
          await offline.goto('about:blank');
          await offline.goto(`${page.__origin}/#/add-import`, { waitUntil: 'load' });
          await offline.waitForSelector('#import-report button[aria-label="Find match: Middle"]');
          const exactSource = await offline.$eval('#import-text', (node, raw) => node.value === raw.replace(/\r\n?/g, '\n'), source);
          t.check('fresh real-worker offline document retains exact draft with no network matching',
            exactSource && responses.includes('/') && responses.includes('/js/lib/importDraft.js'),
            JSON.stringify({ exactSource, responses }));
        } finally {
          if (workerSession) {
            await workerSession.send('Network.emulateNetworkConditions', {
              offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
            });
            await workerSession.detach();
          }
          if (pageSession) await pageSession.detach();
          await offline.close();
          await page.bringToFront();
        }
        await page.goto(`${page.__origin}/#/data`, { waitUntil: 'load' });
        await page.waitForSelector('#btn-wipe');
        await click(page, '#btn-wipe');
        await page.waitForSelector('#ask[open]');
        await click(page, '#ask-cancel');
        await page.waitForFunction(() => !document.querySelector('#ask').open && !document.querySelector('#btn-wipe').disabled);
        t.check('cancelled erase preserves draft and returns focus', Boolean((await read(page)).draft)
          && await page.evaluate(() => document.activeElement.id === 'btn-wipe'));
        await click(page, '#btn-wipe');
        await page.waitForSelector('#ask[open]');
        await click(page, '#ask-ok');
        await page.waitForFunction((key) => localStorage.getItem(key) === null, {}, DRAFT_KEY);
        t.check('verified erase removes source only after empty reader', Object.keys((await read(page)).reader.lists).length === 0);
      },
    },
  ];
}

export const importMutations = [
  {
    id: 'ordered-import-appends-gap', breaks: 'ordered-import',
    why: 'later matched source position appends instead of projecting original order',
    rewriteModel: (text) => text.replace('const itemIds = destination.prefix.concat(owned);', 'const itemIds = list.itemIds;'),
  },
  {
    id: 'import-draft-reload-omits-source', breaks: 'import-draft-lifecycle',
    why: 'fresh document discards the loaded source record',
    rewriteStorage: (text) => text.replace('const draft = raw === null ? null : validateImportDraft(raw);', 'const draft = null;'),
  },
  {
    id: 'import-draft-unverified-prepare', breaks: 'import-draft-lifecycle',
    why: 'unchanged storage falsely confirms saved source and withdraws the unsaved guard',
    rewriteStorage: (text) => text.replace('if (actual === raw) {', 'if (actual === raw || actual === previous) {'),
  },
];
