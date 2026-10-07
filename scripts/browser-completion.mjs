import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyState, createList, addIssuesToList, markRead, setDeferred, exportBackup,
} from '../src/js/lib/model.js';
import { LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';

const KEY = 'mrt.state.v2';
const SOURCE = 'completion-source-list';
const NEXT = 'completion-next-list';
const FEEDBACK_URL = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAMAAEys2uVUMkJLVFlNTUhaUFk0NERQQzYxT0xSSDAwVy4u';
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const raw = (page, key = KEY) => page.evaluate((name) => localStorage.getItem(name), key);
const reader = async (page) => JSON.parse(await raw(page));
const history = async (page) => JSON.parse(await raw(page, LIST_HISTORY_KEY));
const row = (id, action) => `#rows [data-key="${id}"][data-act="${action}"]`;
const focusHeading = (page) => page.$eval('#order-name', (element) => {
  element.tabIndex = -1;
  element.focus();
});

function item(issueId, date = '2005-01-01') {
  return {
    issueId, title: `Completion fixture #${issueId}`, number: String(issueId),
    seriesId: 880, seriesName: 'Fixture series (2005)', onSale: date,
    creators: [{ name: 'Fixture Writer', role: 'writer' }],
    digitalId: issueId + 100000, hydrated: true, source: 'curated',
  };
}

const orders = {
  'completion_source.json': { items: [item(610001), item(610002, '2005-02-01'), item(610003, '2005-03-01')] },
  'completion_next.json': { items: [item(620001, '2006-01-01'), item(620002, '2006-02-01')] },
  'completion_writer.json': { items: [item(630001, '2007-01-01')] },
  'completion_seen.json': { items: [item(640001, '2008-01-01')] },
  'completion_retry.json': { items: [item(650001, '2009-01-01')] },
};
const entry = (id, file, timeline, type = 'event') => ({
  id, file, name: id, description: 'Compiled fixture.', type, depth: 'essential',
  count: orders[file].items.length, timeline, keywords: ['Fixture Writer', 'Fixture series'],
  placeholderCount: 0, emptyRecordCount: 0,
});
const catalog = {
  lists: [
    entry('completion-source', 'completion_source.json', 2005),
    entry('completion-next', 'completion_next.json', 2006),
    entry('completion-writer', 'completion_writer.json', null, 'creator-run'),
    entry('completion-seen', 'completion_seen.json', 2008),
    entry('completion-retry', 'completion_retry.json', null, 'creator-run'),
  ],
  paths: [{
    id: 'completion-path', name: 'Fixture reading path', description: 'Two fixture stops.',
    sourceOrigin: 'Compiled fixture.', steps: ['completion-source', 'completion-next'],
  }],
};

function fixture() {
  let state = createList(createEmptyState(), {
    id: SOURCE, catalogId: 'completion-source', name: 'Private completion fixture', note: 'Keep this private note',
  });
  state = addIssuesToList(state, SOURCE, orders['completion_source.json'].items).state;
  state = markRead(state, 610001, true, 111);
  state = setDeferred(state, SOURCE, 610003, true);
  state = createList(state, { id: NEXT, catalogId: 'completion-next', name: 'Saved next fixture' });
  state = addIssuesToList(state, NEXT, orders['completion_next.json'].items).state;
  return markRead(state, 640001, true, 444);
}

async function setup(page) {
  await page.setViewport({ width: 1280, height: 900 });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.__completionErrors = failures;
  const initial = { writeToken: 'completion-fixture', ...exportBackup(fixture()) };
  await page.evaluateOnNewDocument((value, key, suppliedCatalog, suppliedOrders) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'all' }));
    window.__completionLoads = [];
    const real = window.fetch.bind(window);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(json(suppliedCatalog));
      const file = url.pathname.split('/').at(-1);
      if (Object.hasOwn(suppliedOrders, file)) {
        window.__completionLoads.push(file);
        const response = () => json(suppliedOrders[file], window.__completionMissing && file === 'completion_retry.json' ? 503 : 200);
        if (window.__completionSlow) return new Promise((resolve) => setTimeout(() => resolve(response()), 180));
        return Promise.resolve(response());
      }
      return url.origin === location.origin ? real(input, options)
        : Promise.reject(new TypeError('Completion fixture blocks external requests'));
    };
  }, initial, KEY, catalog, orders);
  await page.goto(`${page.__origin}/#/read/${SOURCE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#btn-complete-list').disabled
    && document.querySelector('#order-name').textContent === 'Private completion fixture');
}

async function complete(page, listId = SOURCE) {
  await click(page, '#btn-complete-list');
  await page.waitForFunction((key, id) => {
    const value = JSON.parse(localStorage.getItem(key));
    return value?.records.some((record) => record.listId === id && record.completedAt)
      && !document.querySelector('#btn-reopen-list').disabled;
  }, {}, LIST_HISTORY_KEY, listId);
}

async function full(page) {
  if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
  await page.waitForSelector('#rows .row');
}

async function confirm(page) {
  await page.waitForSelector('#ask[open]');
  await click(page, '#ask-ok');
  await page.waitForFunction(() => !document.querySelector('#ask').open);
}

async function go(page, view, id = SOURCE) {
  await page.evaluate((hash) => { location.hash = hash; }, `#/${view}${view === 'read' ? `/${id}` : ''}`);
  await page.waitForSelector(`#view-${view}:not([hidden])`);
}

export const completionLifecycle = {
  id: 'completion-lifecycle',
  title: 'Completion, enjoyment and reopening keep reader data and active discovery truthful',
  async run(page, t) {
    page.__denyExternal = true;
    const feedbackRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === 'forms.cloud.microsoft') feedbackRequests.push(request.url());
    });
    await setup(page);
    const before = await raw(page);
    await complete(page);
    t.check('partial completion keeps exact reader bytes, notes and deferred choices',
      await raw(page) === before && (await reader(page)).read[610001] === 111
      && (await reader(page)).lists[SOURCE].deferredIssueIds.join() === '610003'
      && (await reader(page)).lists[SOURCE].note === 'Keep this private note');
    t.check('completed wrap-up keeps actions without repeated progress or retention prose and hides queued surfaces',
      await page.evaluate(() => !document.querySelector('#list-completion-progress')
        && document.querySelector('#list-completion-status').hidden
        && document.querySelector('#list-completion-status').textContent === ''
        && !document.querySelector('#list-wrap-up').hidden
        && document.querySelector('#hero').hidden && document.querySelector('#shelf-sec').hidden));
    await page.waitForFunction(() => document.querySelector('#list-recommendation-status').hidden
      && document.querySelector('#list-suggestions [data-recommendation]'));
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 900 });
      const controls = await page.$$eval('#list-enjoyment button', (buttons) => buttons.map((button) => ({
        text: button.textContent.trim(), name: button.getAttribute('aria-label'),
        tooltip: button.dataset.tooltip, icon: Boolean(button.querySelector('svg')),
        width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
      })));
      t.check(`${width}px enjoyment actions are named icons with at least 44px targets`,
        controls.length === 2 && controls.every((button) => !button.text && button.icon
          && button.name === button.tooltip && button.width >= 44 && button.height >= 44)
        && controls[0].name === 'Enjoyed' && controls[1].name === 'Did not enjoy');
      t.check(`${width}px compact wrap-up keeps healthy status hidden and stays inside the viewport`,
        await page.evaluate(() => document.querySelector('#list-recommendation-status').hidden
          && document.querySelector('#list-enjoyment legend').classList.contains('visually-hidden')
          && document.documentElement.scrollWidth <= innerWidth));
      for (const [id, name] of [['btn-enjoyed-list', 'Enjoyed'], ['btn-disliked-list', 'Did not enjoy']]) {
        await page.$eval(`#${id}`, (button) => button.focus());
        await page.waitForFunction((label) => !document.querySelector('#action-tip').hidden
          && document.querySelector('#action-tip').textContent === label, {}, name);
        await page.keyboard.press('Escape');
        t.check(`${width}px ${name} tooltip is keyboard-readable and dismissible`,
          await page.$eval('#action-tip', (tip) => tip.hidden));
      }
    }
    await page.setViewport({ width: 1280, height: 900 });
    await focusHeading(page);
    await page.hover('#btn-enjoyed-list');
    await page.waitForFunction(() => !document.querySelector('#action-tip').hidden
      && document.querySelector('#action-tip').textContent === 'Enjoyed');
    t.check('enjoyment icon exposes its name on pointer hover', await page.$eval('#action-tip', (tip) => !tip.hidden));
    await click(page, '#btn-enjoyed-list');
    await page.waitForFunction(() => document.querySelector('#btn-enjoyed-list').getAttribute('aria-pressed') === 'true');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#btn-reopen-list:not([hidden])');
    t.check('completion and optional enjoyment survive reload without a reader write',
      await raw(page) === before && (await history(page)).records[0].rating === 'up');
    await click(page, '#btn-disliked-list');
    await page.waitForFunction(() => document.querySelector('#btn-disliked-list').getAttribute('aria-pressed') === 'true'
      && !document.querySelector('#btn-disliked-list').disabled);
    t.check('negative enjoyment saves without interrupting reading or opening reporting',
      !await page.$eval('#list-feedback', (dialog) => dialog.open)
      && (await history(page)).records[0].rating === 'down' && feedbackRequests.length === 0);
    await click(page, '#btn-list-feedback-guide');
    await page.waitForSelector('#list-feedback[open]');
    const feedback = await page.evaluate(() => ({
      href: document.querySelector('#list-feedback-link').href,
      target: document.querySelector('#list-feedback-link').target,
      rel: document.querySelector('#list-feedback-link').rel,
      referrer: document.querySelector('#list-feedback-link').referrerPolicy,
      privateHref: document.querySelector('#list-private-feedback-link').href,
      text: document.querySelector('#list-feedback').textContent,
    }));
    t.check('feedback is the approved static account-free form with protected links and a private security route',
      feedback.href === FEEDBACK_URL && feedback.target === '_blank'
      && feedback.rel === 'noopener noreferrer' && feedback.referrer === 'no-referrer'
      && feedback.privateHref.endsWith('/security/policy')
      && feedback.text.includes('No account, name or email required')
      && feedback.text.includes('Microsoft processes your form visit and submitted report')
      && feedback.text.includes('saved reading data and thumb choice are not attached')
      && !feedback.href.includes('Private') && !feedback.href.includes('610001'));
    t.check('opening instructions sends no form request or reader data',
      feedbackRequests.length === 0 && await raw(page) === before);
    const feedbackHistory = await raw(page, LIST_HISTORY_KEY);
    const feedbackRoute = page.url();
    await page.$eval('#list-feedback-link', (link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      window.__listFeedbackActivation = { trusted: event.isTrusted, href: link.href };
    }, { once: true }));
    await page.focus('#list-feedback-link');
    await page.keyboard.press('Enter');
    const activation = await page.evaluate(() => window.__listFeedbackActivation);
    t.check('explicit keyboard form activation is cancellable without receipt claims or reading/history writes',
      activation?.trusted === true && activation.href === FEEDBACK_URL && page.url() === feedbackRoute
      && feedbackRequests.length === 0 && await raw(page) === before
      && await raw(page, LIST_HISTORY_KEY) === feedbackHistory
      && await page.$eval('#announcer', (node) => !/report.*(?:received|submitted|sent)/i.test(node.textContent)));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#list-feedback').open
      && document.activeElement.id === 'btn-list-feedback-guide');
    t.check('feedback Escape restores visible explicit-report opener focus',
      await page.evaluate(() => !document.querySelector('#list-feedback').open
        && document.activeElement.id === 'btn-list-feedback-guide' && document.activeElement.checkVisibility()));
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      await page.setViewport({ width, height });
      await click(page, '#btn-list-feedback-guide');
      await page.waitForSelector('#list-feedback[open]');
      t.check(`${width}px standalone reporting preserves rating/history and has no horizontal overflow`,
        await raw(page) === before && await raw(page, LIST_HISTORY_KEY) === feedbackHistory
        && feedbackRequests.length === 0
        && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
          && document.querySelector('#list-feedback-link').checkVisibility()));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#list-feedback').open
        && document.activeElement.id === 'btn-list-feedback-guide');
      t.check(`${width}px standalone report Escape restores its visible opener`,
        await page.$eval('#btn-list-feedback-guide', (node) => node === document.activeElement && node.checkVisibility()));
    }
    await page.setViewport({ width: 1280, height: 900 });
    await click(page, '#btn-enjoyed-list');
    await go(page, 'completed');
    await click(page, 'input[name="completed-filter"][value="enjoyed"]');
    t.check('Enjoyed filters completed cards while showing actual partial comic progress',
      await page.$eval('#completed-list', (node) => node.querySelectorAll('a[href^="#/read/"]').length === 1
        && node.textContent.includes('1 / 3') && node.textContent.includes('1 deferred')
        && node.textContent.includes('Enjoyed')));
    await page.setViewport({ width: 320, height: 900 });
    t.check('narrow completed collection has no document-level horizontal overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.setViewport({ width: 1280, height: 900 });
    await click(page, '#completed-list a[href^="#/read/"]');
    await page.waitForSelector('#view-read:not([hidden])');
    await go(page, 'home');
    t.check('Home and sidebar continue the same active next list, not the completed source',
      await page.$eval('#chero-h', (node) => node.textContent === 'Saved next fixture')
      && await page.$eval('#list-nav', (node) => node.textContent.includes('Saved next fixture')
        && !node.textContent.includes('Private completion fixture'))
      && await page.$eval('#home-yours-list', (node) => node.querySelectorAll('a[href^="#/read/"]').length === 1)
      && await page.$eval('#home-first-run', (node) => node.hidden));
    await go(page, 'read');
    await click(page, '#btn-reopen-list');
    await page.waitForSelector('#btn-complete-list:not([hidden])');
    t.check('reopening restores queued reading and retains enjoyment without changing reader bytes',
      await raw(page) === before && (await history(page)).records[0].completedAt === null
      && (await history(page)).records[0].rating === 'up'
      && await page.$eval('#hero', (node) => !node.hidden));
    await complete(page);
    await go(page, 'read', NEXT);
    await complete(page, NEXT);
    const allCompletedReader = await raw(page);
    await go(page, 'home');
    const returningHome = await page.evaluate(() => document.querySelector('#home-first-run').hidden
      && document.querySelector('#home-yours').hidden
      && document.querySelector('#home-completed').textContent.includes('All your saved lists are completed'));
    await go(page, 'library');
    t.check('an all-completed library stays a returning-user library with a clear history gateway',
      returningHome && await page.evaluate(() => document.querySelector('#library-empty').hidden
        && document.querySelector('#library-yours').hidden
        && !document.querySelector('#library-completed').hidden)
      && await raw(page) === allCompletedReader);
    await go(page, 'completed');
    await click(page, 'input[name="completed-filter"][value="all"]');
    t.check('All completed shows both saved lists in recent-completion order without writing reader data',
      await page.$eval('#completed-list', (node) => node.querySelectorAll('a[href^="#/read/"]').length === 2
        && node.querySelector('a[href^="#/read/"]').textContent.includes('Saved next fixture'))
      && await raw(page) === allCompletedReader);
    const legacy = fixture();
    legacy.lists[SOURCE].created = 0;
    await page.evaluateOnNewDocument(() => {
      window.__completionClock = 1000;
      Date.now = () => window.__completionClock;
    });
    await page.evaluate((value, key, historyKey, listId) => {
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.removeItem(historyKey);
      window.history.replaceState(null, '', `#/read/${listId}`);
    }, { writeToken: 'legacy-completion-fixture', ...exportBackup(legacy) }, KEY, LIST_HISTORY_KEY, SOURCE);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('#btn-complete-list').disabled
      && document.querySelector('#order-name').textContent === 'Private completion fixture');
    await page.evaluate(() => {
      window.__completionClock = 2000;
      document.querySelector('#btn-complete-list').focus();
    });
    await complete(page);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 60)));
    t.check('same-ID legacy completion stabilizes safely and retains its live success announcement and Reopen focus',
      (await reader(page)).lists[SOURCE].created === 2000
      && (await reader(page)).lists[SOURCE].note === 'Keep this private note'
      && await page.evaluate(() => document.activeElement === document.querySelector('#btn-reopen-list')
        && document.querySelector('#announcer').textContent.includes('marked as completed')));
    t.check('lifecycle has no uncaught browser errors', page.__completionErrors.length === 0, page.__completionErrors.join('; '));
  },
};

export const completionKeyboard = {
  id: 'completion-keyboard',
  title: 'Completed lists ignore hidden queued actions while full-order controls and reopening work',
  async run(page, t) {
    await setup(page);
    await complete(page);
    const before = await raw(page);
    await page.evaluate(() => {
      window.__completionOpens = 0;
      window.open = () => { window.__completionOpens += 1; return { opener: null }; };
    });
    await focusHeading(page);
    await page.keyboard.press('d');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      for (const id of ['btn-hero-read', 'btn-hero-done', 'btn-hero-defer', 'btn-hero-inspect']) document.getElementById(id).click();
    });
    t.check('hidden D, Enter and direct hero controls cannot read, defer or open a completed list',
      await raw(page) === before && await page.evaluate(() => window.__completionOpens === 0)
      && (await history(page)).records.some((record) => record.listId === SOURCE && record.completedAt));
    await full(page);
    await click(page, row(610002, 'read'));
    await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('mrt.state.v2')).read[610002]);
    t.check('manual full-order progress remains available without reopening or clearing completion',
      !!(await reader(page)).read[610002]
      && (await history(page)).records.some((record) => record.listId === SOURCE && record.completedAt));
    await click(page, '#btn-reopen-list');
    await page.waitForSelector('#btn-complete-list:not([hidden])');
    await full(page);
    await click(page, row(610002, 'read'));
    await focusHeading(page);
    await page.keyboard.press('d');
    t.check('D resumes actual queued progress after reopening',
      !!(await reader(page)).read[610002] && !(await reader(page)).read[610003]
      && (await reader(page)).lists[SOURCE].deferredIssueIds.join() === '610003');
    t.check('keyboard path has no uncaught browser errors', page.__completionErrors.length === 0, page.__completionErrors.join('; '));
  },
};

export const completionRecommendations = {
  id: 'completion-recommendations',
  title: 'Wrap-up offers bounded evidenced next reading and drops stale asynchronous suggestions',
  async run(page, t) {
    await setup(page);
    await page.evaluate(() => { window.__completionMissing = true; });
    await complete(page);
    await page.waitForFunction(() => document.querySelector('#list-suggestions [data-recommendation]')
      && !document.querySelector('#btn-retry-recommendations').hidden);
    const suggested = await page.$$eval('#list-suggestions [data-recommendation]', (nodes) => nodes.map((node) => node.dataset.recommendation));
    const reasons = await page.$eval('#list-suggestions', (node) => node.textContent);
    const loads = await page.evaluate(() => window.__completionLoads);
    t.check('exact path/timeline and verified writer reasons are shown without source or known-read orders',
      suggested.includes('completion-next') && suggested.includes('completion-writer')
      && !suggested.includes('completion-source') && !suggested.includes('completion-seen')
      && reasons.includes('Fixture reading path') && reasons.includes('Fixture Writer'));
    t.check('cards and candidate file loads stay bounded, with an explicit optional failure and retry',
      suggested.length <= 6 && new Set(loads.filter((file) => file !== 'completion_source.json')).size <= 6
      && loads.filter((file) => file === 'completion_source.json').length <= 1
      && await page.$eval('#list-recommendation-status', (node) => !node.hidden && node.textContent.includes('could not')));
    await click(page, '#list-suggestions [data-recommendation="completion-next"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).active === 'completion-next-list');
    t.check('a saved suggestion opens the existing list without importing another copy',
      (await reader(page)).listOrder.length === 2);
    await go(page, 'read', SOURCE);
    await page.waitForSelector('#list-suggestions [data-recommendation="completion-writer"]');
    await click(page, '#list-suggestions [data-recommendation="completion-writer"]');
    await page.waitForSelector('#preview[open]');
    t.check('unsaved suggestions preview without automatic library writes', (await reader(page)).listOrder.length === 2);
    await click(page, '#preview-close');
    await page.evaluate(() => { window.__completionMissing = false; window.__completionSlow = true; });
    await click(page, '#btn-retry-recommendations');
    await click(page, '#btn-reopen-list');
    await page.waitForSelector('#btn-complete-list:not([hidden])');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
    t.check('a late retry cannot reshow suggestions after reopening',
      await page.$eval('#list-recommendations', (node) => node.hidden)
      && (await history(page)).records.length === 0);
    t.check('recommendations have no uncaught browser errors', page.__completionErrors.length === 0, page.__completionErrors.join('; '));
  },
};

export const completionPersistence = {
  id: 'completion-persistence',
  title: 'History restore, reader Undo, faulted erase, current-value events and offline reload preserve boundaries',
  async run(page, t) {
    await setup(page);
    await complete(page);
    const readerRaw = await raw(page);
    const good = await raw(page, LIST_HISTORY_KEY);
    const savedHistory = JSON.parse(good);
    delete savedHistory.writeToken;
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      window.__completionRestoreSet = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (name, value) { if (name !== key) original.call(this, name, value); };
    }, LIST_HISTORY_KEY);
    await click(page, '#btn-enjoyed-list');
    await page.waitForFunction(() => document.querySelector('#save-report').textContent.includes('did not match'));
    t.check('silent history writes neither change stored bytes nor announce an enjoyment save',
      await raw(page, LIST_HISTORY_KEY) === good && await raw(page) === readerRaw
      && await page.$eval('#btn-enjoyed-list', (node) => node.getAttribute('aria-pressed') === 'false'));
    await page.evaluate((key) => {
      window.__completionRestoreSet();
      localStorage.setItem(key, 'opaque unreadable history');
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'stale event' }));
    }, LIST_HISTORY_KEY);
    await go(page, 'data');
    t.check('corrupt current history disables normal export but preserves its copy and recovery controls',
      await raw(page, LIST_HISTORY_KEY) === 'opaque unreadable history'
      && await page.$eval('#btn-export-history', (node) => node.disabled)
      && await page.$eval('#btn-copy-history', (node) => !node.disabled)
      && await page.$eval('#history-status', (node) => node.textContent.includes('not valid JSON')));
    const dir = mkdtempSync(join(tmpdir(), 'recap-completion-'));
    try {
      const historyFile = join(dir, 'history.json');
      writeFileSync(historyFile, JSON.stringify(savedHistory));
      await (await page.$('#restore-history-file')).uploadFile(historyFile);
      await confirm(page);
      await page.waitForFunction(() => document.querySelector('#history-report').textContent.includes('history restored'));
      t.check('confirmed history-file restoration changes only its independent key',
        await raw(page) === readerRaw && (await history(page)).records[0].listId === SOURCE);
      const emptyFile = join(dir, 'reader.json');
      writeFileSync(emptyFile, JSON.stringify(exportBackup(createEmptyState())));
      const restoredHistory = await raw(page, LIST_HISTORY_KEY);
      await (await page.$('#restore-file')).uploadFile(emptyFile);
      await confirm(page);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length === 0);
      t.check('reader restore leaves history intact rather than replacing it with empty history',
        await raw(page, LIST_HISTORY_KEY) === restoredHistory);
      await click(page, '#btn-undo-restore');
      await confirm(page);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length === 2);
      t.check('reader Undo restores matching completed identity without rewriting history',
        await raw(page, LIST_HISTORY_KEY) === restoredHistory
        && (await reader(page)).lists[SOURCE].created === savedHistory.records[0].created);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await go(page, 'read');
    const peer = await page.browserContext().newPage();
    try {
      await peer.goto(`${page.__origin}/open.html`, { waitUntil: 'load' });
      const current = await raw(page, LIST_HISTORY_KEY);
      const updated = JSON.parse(current);
      updated.records[0].rating = 'up';
      await peer.evaluate((key, value) => localStorage.setItem(key, value), LIST_HISTORY_KEY, JSON.stringify(updated));
      await page.waitForFunction(() => document.querySelector('#btn-enjoyed-list').getAttribute('aria-pressed') === 'true');
      await page.evaluate((key) => window.dispatchEvent(new StorageEvent('storage', { key, newValue: null })), LIST_HISTORY_KEY);
      t.check('real same-origin adoption and a stale event retain the latest stored preference',
        (await history(page)).records[0].rating === 'up'
        && await page.$eval('#btn-enjoyed-list', (node) => node.getAttribute('aria-pressed') === 'true'));
    } finally { await peer.close(); }
    await page.setBypassServiceWorker(false);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find((name) => name.startsWith('mrt-offline-')) || 'mrt-offline-v2');
      return navigator.serviceWorker.controller && (await Promise.all([
        './js/lib/listHistory.js', './js/lib/listRecommendations.js', './js/views/completion.js',
      ].map((path) => cache.match(new URL(path, location.href).href)))).every(Boolean);
    });
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#btn-reopen-list:not([hidden])');
    t.check('ordinary offline warming includes all new modules and reload retains completion',
      (await history(page)).records[0].rating === 'up'
      && await page.$eval('#hero', (node) => node.hidden));
    await page.setOfflineMode(false);
    await page.setBypassServiceWorker(true);
    await go(page, 'data');
    const beforeErase = await raw(page);
    const historyBeforeErase = await raw(page, LIST_HISTORY_KEY);
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      window.__completionRestoreSet = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (name, value) { if (name !== key) original.call(this, name, value); };
    }, KEY);
    await click(page, '#btn-wipe');
    await confirm(page);
    await page.waitForFunction(() => document.querySelector('#save-report').textContent.includes('erase did not match'));
    t.check('an unverified silent reader erase preserves exact reader and history bytes',
      await raw(page) === beforeErase && await raw(page, LIST_HISTORY_KEY) === historyBeforeErase);
    await page.evaluate((key) => {
      window.__completionRestoreSet();
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (name) { if (name !== key) original.call(this, name); };
    }, LIST_HISTORY_KEY);
    await click(page, '#btn-wipe');
    await confirm(page);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length === 0
      && !document.querySelector('#btn-wipe').disabled);
    t.check('verified reader erase and silent history removal report partial cleanup, never all-data success',
      await raw(page, LIST_HISTORY_KEY) === historyBeforeErase
      && await page.$eval('#save-report', (node) => node.textContent.includes('Completion and enjoyment history is still saved')
        && !node.textContent.includes('All local data erased')));
    t.check('persistence has no uncaught browser errors', page.__completionErrors.length === 0, page.__completionErrors.join('; '));
  },
};
