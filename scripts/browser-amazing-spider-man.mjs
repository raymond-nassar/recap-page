import { readFileSync } from 'node:fs';

import {
  addIssuesToList, createEmptyState, createList, markRead, setIssueNote, setIssueRating, setOverride,
} from '../src/js/lib/model.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const id = 'amazing-spider-man-reading-order-modern-marvel-era';
const payload = readJson(new URL('../src/data/amazing_spider_man_reading_order_modern_marvel_era.json', import.meta.url));
const ledger = readJson(new URL('./data/owner-selections/amazing-spider-man-early-supplement.json', import.meta.url));
const addedIds = new Set(ledger.rows.map((row) => row.issueId));
const original = payload.items.filter((item) => !addedIds.has(item.issueId));
const expected = payload.items.map((item) => item.issueId);
const originalIds = original.map((item) => item.issueId);
const customizedIds = [originalIds[1], originalIds[0], ...originalIds.slice(2)];
const firstAdded = payload.items.find((item) => item.issueId === 14542);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const click = (page, selector) => page.$eval(selector, (node) => node.click());

async function closePreview(page) {
  await page.evaluate(() => {
    window.__spiderPreviewClosed = false;
    document.querySelector('#preview').addEventListener('close', () => {
      window.__spiderPreviewClosed = true;
    }, { once: true });
  });
  await click(page, '#preview-close');
  await page.waitForFunction(() => window.__spiderPreviewClosed);
}

let oldState = createList(createEmptyState(), {
  id: 'legacy-copy', name: payload.name, catalogId: id, itemIds: customizedIds,
  note: 'My personal list note', collectedIn: { [originalIds[0]]: 'My edition' },
  deferredIssueIds: [originalIds[1]],
});
oldState = addIssuesToList(oldState, 'legacy-copy', original).state;
oldState = createList(oldState, { id: 'other-copy', name: 'Another reading list' });
oldState = addIssuesToList(oldState, 'other-copy', [{
  issueId: firstAdded.issueId, title: 'My hand-entered Spectacular comic',
  url: firstAdded.url, number: '1', pageCount: 19, source: 'manual', hydrated: true,
}]).state;
oldState = markRead(oldState, original[0].issueId, true, 123456);
oldState = markRead(oldState, firstAdded.issueId, true, 123457);
oldState = setIssueNote(oldState, original[0].issueId, 'Keep my place');
oldState = setIssueNote(oldState, firstAdded.issueId, 'Already read');
oldState = setOverride(oldState, firstAdded.issueId, 'unavailable');
oldState = setIssueRating(oldState, firstAdded.issueId, 4.5);
const oldHistory = {
  format: 'recap-page-list-history',
  version: 1,
  records: [{
    listId: 'legacy-copy', created: oldState.lists['legacy-copy'].created, catalogId: id,
    completedAt: 123450, rating: 'up',
  }],
};

async function saved(page) {
  return page.evaluate((catalogId, manualId) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    const lists = Object.values(state.lists).filter((list) => list.catalogId === catalogId);
    const history = JSON.parse(localStorage.getItem('mrt.list-history.v1'));
    return {
      lists, allLists: Object.values(state.lists), read: state.read, notes: state.notes,
      overrides: state.overrides, ratings: state.ratings, manualIssue: state.issues[manualId], history,
    };
  }, id, firstAdded.issueId);
}

async function openSpotlight(page) {
  await click(page, '.brand[data-view="home"]');
  await page.waitForSelector('#view-home [data-category="character-spotlights"]');
  await click(page, '#view-home [data-category="character-spotlights"]');
  await page.waitForSelector('#spotlights-q');
  await page.$eval('#spotlights-q', (input) => {
    input.value = 'Amazing Spider-Man';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const card = `#spotlights-results [data-story="list:${id}"]`;
  await page.waitForSelector(card);
  return card;
}

export const amazingSpiderManActualData = {
  id: 'amazing-spider-man-supplement-actual-data',
  title: 'the expanded Spider-Man guide preserves saved copies and imports every issue',
  async run(page, t) {
    const errors = [];
    const external = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument((state, history) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
      if (!sessionStorage.getItem('spider-supplement-seeded')) {
        localStorage.setItem('mrt.state.v2', JSON.stringify(state));
        localStorage.setItem('mrt.list-history.v1', JSON.stringify(history));
        sessionStorage.setItem('spider-supplement-seeded', 'yes');
      }
    }, oldState, oldHistory);
    await page.goto(`${page.__origin}/?catalog=actual#/read/legacy-copy`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#order-name')?.textContent.trim() === 'Amazing Spider-Man');
    await page.waitForFunction(() => document.querySelector('#btn-enjoyed-list')?.getAttribute('aria-pressed') === 'true');
    let persisted = await saved(page);
    t.check('opening an existing saved copy leaves its 2,041 issue positions unchanged',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, customizedIds),
      JSON.stringify({ lists: persisted.lists.length, count: persisted.lists[0]?.itemIds.length }));
    t.check('the original remains completed and keeps its enjoyment choice',
      same(persisted.history, oldHistory)
      && await page.$eval('#btn-reopen-list', (node) => !node.hidden)
      && await page.$eval('#btn-enjoyed-list', (node) => node.getAttribute('aria-pressed') === 'true'));
    t.check('the existing copy and another list keep their global read markers and notes',
      persisted.read[originalIds[0]] === 123456 && persisted.read[firstAdded.issueId] === 123457
      && persisted.notes[originalIds[0]] === 'Keep my place' && persisted.notes[firstAdded.issueId] === 'Already read',
      JSON.stringify({ read: persisted.read, notes: persisted.notes }));
    await page.reload({ waitUntil: 'load' });
    persisted = await saved(page);
    t.check('reload does not silently expand the earlier saved copy',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, customizedIds),
      JSON.stringify({ count: persisted.lists[0]?.itemIds.length }));

    const card = await openSpotlight(page);
    const cardText = await page.$eval(card, (node) => node.textContent);
    t.check('the existing Character Spotlight offers the expanded 2,144-comic guide',
      /2,?144 comics/.test(cardText), cardText);
    t.check('the card distinguishes the saved 2,041-comic copy from the expanded guide',
      /Saved copy: 2,?041 comics/.test(cardText), cardText);
    t.check('the compact source names both Comic Book Herald and the owner selections',
      cardText.includes('Source: Comic Book Herald, with owner-selected additions'), cardText);
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.__restorePreviewFetch = () => { window.fetch = originalFetch; };
      window.fetch = (input, init) => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        if (path === '/data/amazing_spider_man_reading_order_modern_marvel_era.json') {
          return new Promise((resolve) => {
            window.__releasePreview = () => resolve(originalFetch(input, init));
          });
        }
        return originalFetch(input, init);
      };
    });
    await click(page, `${card} [data-act="preview"]`);
    await page.waitForFunction(() => typeof window.__releasePreview === 'function');
    await page.focus('#preview-add [data-act="main"]');
    await page.evaluate(() => { window.__restorePreviewFetch(); window.__releasePreview(); });
    await page.waitForFunction(() => document.querySelectorAll('#preview[open] .preview-issue-link').length > 0);
    t.check('loading the comparison retains focus on the original Open list action',
      await page.evaluate(() => document.activeElement?.dataset.act === 'main'));
    const previewIds = await page.$$eval('#preview-body .preview-issue-link',
      (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('Preview presents every original and owner-selected issue in the intended order',
      same(previewIds, expected), JSON.stringify({ expected: expected.length, actual: previewIds.length }));
    const notice = await page.$eval('#preview-body .preview-saved-difference', (node) => node.textContent);
    t.check('Preview distinguishes the older copy and describes how to preserve it',
      notice.includes('missing 103 comics') && notice.includes('Add an updated copy to keep both lists')
      && notice.includes('read progress, comic notes') && notice.includes('deferred comics, customized editions')
      && notice.includes('completion date or enjoyment choice'), notice);
    await page.setViewport({ width: 360, height: 800 });
    const phone = await page.evaluate(() => {
      const notice = document.querySelector('#preview-body .preview-saved-difference');
      const rect = notice.getBoundingClientRect();
      const actions = [...document.querySelectorAll('#preview-add [data-act]')].map((node) => {
        const bounds = node.getBoundingClientRect();
        return {
          action: node.dataset.act, visible: node.checkVisibility(), x: bounds.x, y: bounds.y,
          right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
        };
      });
      return {
        visible: notice.checkVisibility(), width: rect.width, viewport: innerWidth,
        height: innerHeight, pageWidth: document.documentElement.scrollWidth, actions,
      };
    });
    t.check('the saved-copy guidance fits a phone-width Preview without horizontal page overflow',
      phone.visible && phone.width <= phone.viewport && phone.pageWidth <= phone.viewport, JSON.stringify(phone));
    t.check('both phone-width Preview actions remain visible and meet the minimum target size',
      phone.actions.length === 2 && phone.actions.every((action) => action.visible
        && action.width >= 24 && action.height >= 24 && action.x >= 0 && action.y >= 0
        && action.right <= phone.viewport && action.bottom <= phone.height), JSON.stringify(phone.actions));
    await page.setViewport({ width: 1280, height: 900 });
    const beforeFailedSave = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__copyFailedWrites = 0;
      window.__restoreCopySetItem = () => { Storage.prototype.setItem = originalSetItem; };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mrt.state.v2') {
          window.__copyFailedWrites += 1;
          throw new DOMException('Injected quota failure', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.focus('#preview-add [data-act="add-copy"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#preview-report')?.textContent.includes('could not be saved'));
    persisted = await saved(page);
    const failedWrites = await page.evaluate(() => {
      window.__restoreCopySetItem();
      return window.__copyFailedWrites;
    });
    t.check('a persistently refused save leaves no copy, and retains the original and its history',
      failedWrites === 1 && await page.evaluate((raw) => localStorage.getItem('mrt.state.v2') === raw, beforeFailedSave)
      && persisted.allLists.length === 2 && same(persisted.lists[0].itemIds, customizedIds)
      && same(persisted.history, oldHistory)
      && await page.$('#preview-add [data-act="add-copy"]') !== null
      && await page.$('#preview-add [data-act="open-copy"]') === null, JSON.stringify({ failedWrites }));
    t.check('a keyboard user returns to the updated-copy action after a failed save',
      await page.evaluate(() => document.activeElement?.dataset.act === 'add-copy'));

    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.__copyConnectionDown = true;
      window.fetch = (input, init) => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        if (window.__copyConnectionDown && (path === '/__recap_page_health__'
          || path === '/data/amazing_spider_man_reading_order_modern_marvel_era.json')) {
          return Promise.reject(new TypeError('Injected local connection failure'));
        }
        return originalFetch(input, init);
      };
    });
    await click(page, '#preview-add [data-act="add-copy"]');
    await page.waitForSelector('#preview-report .notice button');
    persisted = await saved(page);
    t.check('a failed local connection offers retry without creating a copy',
      persisted.allLists.length === 2 && same(persisted.history, oldHistory));

    await closePreview(page);
    const closedRetry = await page.evaluate(() => [...document.querySelectorAll('.report')]
      .some((node) => node.textContent.includes('Amazing Spider-Man') && node.querySelector('button')));
    t.check('closing Preview withdraws its updated-copy retry', !closedRetry);

    await page.evaluate(() => { window.__copyConnectionDown = false; });
    await click(page, `${card} [data-act="preview"]`);
    await page.waitForSelector('#preview-add [data-act="add-copy"]');
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.__restoreLateCopyFetch = originalFetch;
      window.__copyConnectionDown = true;
      window.fetch = (input, init) => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        if (path === '/data/amazing_spider_man_reading_order_modern_marvel_era.json') {
          return new Promise((_, reject) => {
            window.__rejectLateCopy = () => reject(new TypeError('Injected delayed connection failure'));
          });
        }
        return originalFetch(input, init);
      };
    });
    await click(page, '#preview-add [data-act="add-copy"]');
    await page.waitForFunction(() => typeof window.__rejectLateCopy === 'function');
    await closePreview(page);
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Adam Warlock';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const otherCard = '#spotlights-results [data-story="list:adam-warlock-reading-order"]';
    await page.waitForSelector(otherCard);
    await click(page, `${otherCard} [data-act="preview"]`);
    await page.waitForFunction(() => document.querySelector('#preview').open
      && document.querySelector('#preview-h').textContent.includes('Adam Warlock'));
    await page.evaluate(() => window.__rejectLateCopy());
    await page.waitForFunction(() => [...document.querySelectorAll('.report')]
      .some((node) => node.textContent.includes('Amazing Spider-Man')
        && /could not be loaded|Could not load/.test(node.textContent)));
    const lateNotice = await page.evaluate(() => [...document.querySelectorAll('.report')]
      .filter((node) => node.textContent.includes('Amazing Spider-Man'))
      .map((node) => ({ text: node.textContent, retry: Boolean(node.querySelector('button')) })));
    t.check('a copy failure after another Preview opens is reported without a stale retry',
      lateNotice.length === 1 && !lateNotice[0].retry
      && await page.$eval('#preview-h', (node) => node.textContent.includes('Adam Warlock')),
      JSON.stringify(lateNotice));

    await page.evaluate(() => {
      window.__copyConnectionDown = false;
      window.fetch = window.__restoreLateCopyFetch;
    });
    await closePreview(page);
    await page.$eval('#spotlights-q', (input) => {
      input.value = 'Amazing Spider-Man';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForSelector(card);
    await click(page, `${card} [data-act="preview"]`);
    await page.waitForSelector('#preview-add [data-act="add-copy"]');
    await page.evaluate(() => { window.__copyConnectionDown = true; });
    await click(page, '#preview-add [data-act="add-copy"]');
    await page.waitForSelector('#preview-report .notice button');
    await page.evaluate(() => {
      window.__copyConnectionDown = false;
      const originalSetItem = Storage.prototype.setItem;
      window.__copyWriteSizes = [];
      window.__restoreCopySetItem = () => { Storage.prototype.setItem = originalSetItem; };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'mrt.state.v2') {
          const state = JSON.parse(value);
          const copy = Object.values(state.lists).find((list) => list.name === 'Amazing Spider-Man (copy)');
          if (copy) window.__copyWriteSizes.push(copy.itemIds.length);
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.focus('#preview-report .notice button');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
      return Object.values(state.lists).some((list) => list.name === 'Amazing Spider-Man (copy)'
        && list.itemIds.length === 2144);
    });
    const copyLink = await page.$('#preview-add [data-act="open-copy"]');
    t.check('retry reports the saved updated copy and offers to open it', copyLink !== null);
    if (!copyLink) return;
    t.check('a keyboard user reaches the updated copy after retry succeeds',
      await page.evaluate(() => document.activeElement?.dataset.act === 'open-copy'));
    const writeSizes = await page.evaluate(() => {
      window.__restoreCopySetItem();
      return window.__copyWriteSizes;
    });
    t.check('the updated copy is first persisted with its complete membership', same(writeSizes, [2144]),
      JSON.stringify(writeSizes));
    persisted = await saved(page);
    const updated = persisted.allLists.find((list) => list.name === 'Amazing Spider-Man (copy)');
    t.check('the updated copy saves the complete expanded issue vector without claiming the catalog identity',
      updated && updated.catalogId === null && same(updated.itemIds, expected),
      JSON.stringify({ count: updated?.itemIds.length, catalogId: updated?.catalogId }));
    t.check('the original retains its custom order, list note, edition, deferred issue and completion history',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, customizedIds)
      && persisted.lists[0].note === 'My personal list note'
      && persisted.lists[0].collectedIn[originalIds[0]] === 'My edition'
      && same(persisted.lists[0].deferredIssueIds, [originalIds[1]])
      && same(persisted.history, oldHistory));
    t.check('adding the updated copy keeps progress and notes for old and newly added issues',
      persisted.read[originalIds[0]] === 123456 && persisted.read[firstAdded.issueId] === 123457
      && persisted.notes[originalIds[0]] === 'Keep my place' && persisted.notes[firstAdded.issueId] === 'Already read',
      JSON.stringify({ read: persisted.read, notes: persisted.notes }));
    t.check('the updated copy preserves a hand-entered shared comic and its rating and availability choice',
      same(persisted.manualIssue, oldState.issues[firstAdded.issueId])
      && persisted.overrides[firstAdded.issueId] === 'unavailable'
      && persisted.ratings[firstAdded.issueId] === 4.5,
      JSON.stringify({ issue: persisted.manualIssue, override: persisted.overrides[firstAdded.issueId],
        rating: persisted.ratings[firstAdded.issueId] }));
    await click(page, '#preview-add [data-act="open-copy"]');
    await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden);
    t.check('the updated copy does not claim the original completion or enjoyment',
      await page.$eval('#btn-reopen-list', (node) => node.hidden)
      && await page.$eval('#list-enjoyment', (node) => node.hidden));
    await page.evaluate(() => { document.querySelector('#full').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#rows .row .rt').length > 0);
    const readingIds = await page.$$eval('#rows .row .rt',
      (nodes) => nodes.map((node) => Number(node.dataset.issueId)));
    t.check('the Reading List renders the complete expanded issue vector',
      same(readingIds, expected), JSON.stringify({ expected: expected.length, actual: readingIds.length }));
    await page.reload({ waitUntil: 'load' });
    persisted = await saved(page);
    t.check('both the original and expanded copy survive reload in their respective orders',
      persisted.lists.length === 1 && same(persisted.lists[0].itemIds, customizedIds)
      && persisted.allLists.some((list) => list.id === updated.id && same(list.itemIds, expected))
      && same(persisted.history, oldHistory));
    await page.evaluate(() => { location.hash = '#/completed'; });
    await page.waitForSelector('#completed-list a[href="#/read/legacy-copy"]');
    await click(page, '#completed-list a[href="#/read/legacy-copy"]');
    await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden);
    t.check('the original remains accessible from Completed lists with its enjoyment choice',
      await page.$eval('#btn-enjoyed-list', (node) => node.getAttribute('aria-pressed') === 'true'));
    t.check('the browser journey makes no external request or console error',
      external.length === 0 && errors.length === 0,
      JSON.stringify({ external: external.slice(0, 3), errors: errors.slice(0, 3) }));
  },
};

export const amazingSpiderManMissingIssueMutation = {
  id: 'amazing-spider-man-supplement-missing-issue',
  breaks: 'amazing-spider-man-supplement-actual-data',
  why: 'dropping a requested Spectacular issue must fail preview, import and saved-order checks',
  script: () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href);
      if (url.pathname !== '/data/amazing_spider_man_reading_order_modern_marvel_era.json') return response;
      const order = await response.clone().json();
      order.items = order.items.filter((item) => item.issueId !== 14542);
      return new Response(JSON.stringify(order), { status: response.status, headers: response.headers });
    };
  },
};
