import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ratio } from './check-palette.mjs';
import { decodePng } from './lib/painted-contrast.mjs';
import { createEmptyState, createList, addIssuesToList, exportBackup, markRead, setDeferred } from '../src/js/lib/model.js';

const listId = 'phone-layout';
const listName = 'Avengers: Doomsday & Avengers: Secret Wars';
const longListName = 'W'.repeat(200);
const items = [1, 2, 3].map((number) => ({
  issueId: 900000 + number, title: `${number === 3 ? 'Later phone layout' : 'Phone layout'} (2026) #${number}`, number: String(number),
  seriesId: number === 3 ? 990001 : 990000, seriesName: `${number === 3 ? 'Later phone layout' : 'Phone layout'} (2026)`,
  digitalId: 700000 + number, source: 'curated',
}));
const actualCatalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const catalogList = actualCatalog.lists.find((list) => list.id === 'house-of-m');
const catalog = { lists: [{ ...catalogList, name: listName }], paths: [] };
const reflowCatalog = {
  lists: ['house-of-m', 'house-of-m-essential', 'marvel-knights-to-planet-x-73']
    .map((id) => actualCatalog.lists.find((list) => list.id === id)),
  paths: [],
};
if (reflowCatalog.lists.some((list) => !list)) throw new Error('The reflow catalog fixtures are missing.');
let state = createList(createEmptyState(), { id: listId, name: listName, catalogId: catalogList.id });
state = addIssuesToList(state, listId, items).state;
state = markRead(state, items[0].issueId, true, 1767225600000);
state = setDeferred(state, listId, items[2].issueId, true);
const initial = exportBackup(state);
const longInitial = exportBackup({
  ...state,
  lists: { ...state.lists, [listId]: { ...state.lists[listId], name: longListName } },
});
const mobileCss = readFileSync(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
const iosCss = readFileSync(new URL('../packaging/ios/web/ios.css', import.meta.url), 'utf8');
const mobileUiScript = readFileSync(new URL('../packaging/android/web/mobile-ui.js', import.meta.url), 'utf8');
const baseline = process.env.MRT_PHONE_LAYOUT_BASELINE === '1';
const evidence = process.env.MRT_PHONE_LAYOUT_SCREENSHOTS;
const profiles = [
  { width: 1280, height: 900, platform: 'desktop' },
  { width: 375, height: 667, platform: 'ios' },
  { width: 393, height: 852, platform: 'ios' },
];
export const androidPhoneProfiles = [
  { width: 360, height: 800, platform: 'android' },
  { width: 412, height: 915, platform: 'android' },
];
const click = (page, selector) => page.$eval(selector, (node) => node.click());
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function open(page, view) {
  await page.evaluate((next) => { location.hash = next; }, `#/${view}`);
  await page.waitForSelector(`#view-${view.split('/')[0]}:not([hidden])`);
  await settle(page);
}

async function setup(page, profile, theme, fixtureCatalog = catalog, fixtureState = initial) {
  await page.goto('about:blank');
  await page.setBypassCSP(true);
  await page.setViewport({ width: profile.width, height: profile.height, isMobile: profile.platform !== 'desktop', hasTouch: profile.platform !== 'desktop', deviceScaleFactor: 1 });
  const { identifier } = await page.evaluateOnNewDocument((seed, chosen, fixtureCatalog) => {
    localStorage.clear();
    localStorage.setItem('mrt.state.v2', JSON.stringify(seed));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: chosen }));
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify(fixtureCatalog)));
      return url.origin === location.origin ? realFetch(input, init)
        : Promise.reject(new TypeError('Phone layout fixture blocks external requests'));
    };
    window.open = () => null;
  }, fixtureState, theme, fixtureCatalog);
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
  await page.waitForSelector('#home-continue:not([hidden])');
  const needsOverlay = profile.platform === 'ios' || (profile.platform === 'android'
    && !await page.evaluate(() => document.documentElement.classList.contains('android-mobile-ui')));
  if (needsOverlay) {
    await page.addStyleTag({ content: mobileCss });
    if (profile.platform === 'ios') await page.addStyleTag({ content: iosCss });
    await page.evaluate(`${mobileUiScript.replace('export function', 'function')}\nwireMobileUi({ arrivalHeading: () => document.querySelector('.view:not([hidden]) h1') });`);
  }
  await settle(page);
  return async () => page.removeScriptToEvaluateOnNewDocument(identifier);
}

async function capture(page, profile, theme, surface) {
  if (!evidence || page.__mutation) return;
  const dir = join(evidence, baseline ? 'before' : 'after');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${profile.platform}-${profile.width}x${profile.height}-${theme}-${surface}.png`) });
}

async function capturePhoneContent(page, profile, theme, surface, selector) {
  if (!evidence || page.__mutation) return;
  await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
  await settle(page);
  await page.evaluate(() => scrollBy(0, -24));
  await page.waitForFunction(() => {
    const nav = document.querySelector('.rail-header');
    return !nav.classList.contains('mobile-nav-hidden')
      && Math.abs(nav.getBoundingClientRect().bottom - innerHeight) <= 1;
  });
  await capture(page, profile, theme, surface);
}

async function largeText(page, profile) {
  await page.evaluate((platform) => {
    if (platform === 'ios') {
      document.documentElement.style.setProperty('--ios-text-scale', '3.117647');
      document.documentElement.dataset.iosLargestText = 'true';
    } else {
      for (const token of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
        document.documentElement.style.setProperty(token, `${parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) * 2}px`);
      }
    }
  }, profile.platform);
  await settle(page);
}

async function previewControls(page, t, label) {
  const controls = await page.$$eval('#preview-add :is(a,button), #preview-secondary :is(a,button), #preview-offline button',
    (nodes) => [...new Set(nodes)].filter((node) => node.getClientRects().length).map((node) => ({
      name: node.getAttribute('aria-label') || node.textContent,
      role: node.tagName === 'A' ? 'link' : 'button',
    })));
  const session = await page.createCDPSession();
  try {
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    checked(t, `${label}: Preview actions retain individual accessible names`, controls.length > 0
      && controls.every((control) => nodes.some((node) => !node.ignored
        && node.role?.value === control.role && node.name?.value === control.name)), controls);
  } finally {
    await session.detach();
  }
}

function checked(t, name, ok, detail) {
  if (!baseline) t.check(name, ok, JSON.stringify(detail));
}

async function forProfiles(page, t, run, selected, fixtureCatalog, fixtureState) {
  for (const profile of selected ?? profiles) {
    for (const theme of ['light', 'dark']) {
      let cleanup;
      try { cleanup = await setup(page, profile, theme, fixtureCatalog, fixtureState); } catch (error) {
        console.error(`Setup ${profile.platform} ${profile.width} ${theme}: ${error.stack}`);
        throw error;
      }
      try { await run(profile, theme); } catch (error) {
        console.error(`${profile.platform} ${profile.width} ${theme}: ${error.stack}`);
        throw error;
      } finally { await cleanup(); }
    }
  }
}

export const phoneBack = {
  id: 'phone-back',
  title: 'Back belongs at the leading edge of secondary screens, with history positions intact',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      await capture(page, profile, theme, 'home');
      for (const view of ['library', 'add', 'home']) {
        await open(page, 'home');
        await click(page, '#btn-chero-open');
        await page.waitForSelector('#view-read:not([hidden])');
        await click(page, `.rail-header [data-view="${view}"]`);
        await page.waitForSelector(`#view-${view}:not([hidden])`);
        checked(t, `${label}: ${view} has no Back`, await page.$('.view:not([hidden]) .app-back') === null);
        if (profile.platform !== 'desktop') checked(t, `${label}: ${view} shows no back-style breadcrumb on a phone`,
          await page.$('.view:not([hidden]) .breadcrumb') === null);
      }
      await page.evaluate(() => scrollTo(0, 300));
      const position = await page.evaluate(() => scrollY);
      const homeHash = await page.evaluate(() => location.hash);
      await click(page, '#btn-chero-open');
      await page.waitForSelector('#view-read:not([hidden])');
      const back = await page.$eval('#view-read .app-back', (node) => {
        const box = node.getBoundingClientRect();
        const panel = document.querySelector('#view-read').getBoundingClientRect();
        return { left: box.left, panelLeft: panel.left, width: box.width, height: box.height, name: node.getAttribute('aria-label') };
      });
      checked(t, `${label}: secondary Back is top left and target-sized`, back.left <= back.panelLeft + 1
        && back.width >= (profile.platform === 'android' ? 48 : 44) && back.height >= (profile.platform === 'android' ? 48 : 44)
        && back.name === 'Back', back);
      await capture(page, profile, theme, 'secondary-back');
      await click(page, '#view-read .app-back');
      await page.waitForSelector('#view-home:not([hidden])');
      await settle(page);
      const returned = await page.evaluate(() => ({ hash: location.hash, y: scrollY }));
      checked(t, `${label}: Back restores route and scroll`, returned.hash === homeHash && Math.abs(returned.y - position) <= 1, returned);
      await open(page, 'data');
      checked(t, `${label}: desktop rail roots have no Back`, profile.platform !== 'desktop'
        || await page.$('#view-data .app-back') === null);
    }, selected);
  },
};

export const phoneContinue = {
  id: 'phone-continue',
  title: 'Continue centers its cover and keeps primary and quiet actions reachable',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      const homeBand = await page.evaluate(() => {
        const read = document.querySelector('#btn-chero-read').getBoundingClientRect();
        const head = document.querySelector('#view-home > .head').getBoundingClientRect();
        const notice = document.querySelector('#reader-closure-notice').getBoundingClientRect();
        const card = document.querySelector('#home-continue').getBoundingClientRect();
        const rail = document.querySelector('.rail-header').getBoundingClientRect();
        const noticeAfterCard = notice.top >= card.bottom;
        return { readBottom: read.bottom, fold: rail.top > innerHeight / 2 ? rail.top : innerHeight,
          noticeVisible: notice.height > 0, noticeAfterCard,
          headGap: (noticeAfterCard ? card.top : notice.top) - head.bottom,
          noticeGap: noticeAfterCard ? notice.top - card.bottom : card.top - notice.bottom };
      });
      console.log(`PHONE-HOME-BAND ${JSON.stringify({ ...profile, theme, ...homeBand })}`);
      checked(t, `${label}: Home notices and Continue have token spacing`, homeBand.headGap >= 7 && homeBand.noticeGap >= 7, homeBand);
      if (profile.platform !== 'desktop') checked(t, `${label}: Read clears the bar with the Marvel Unlimited notice shown`,
        homeBand.noticeVisible && homeBand.readBottom <= homeBand.fold, homeBand);
      await page.$eval('#home-continue', (node) => node.scrollIntoView({ block: 'center' }));
      const card = await page.evaluate((target) => {
        const root = document.querySelector('#home-continue').getBoundingClientRect();
        const art = document.querySelector('#home-continue .art').getBoundingClientRect();
        const primary = document.querySelector('.chero-primary-actions');
        return {
          center: Math.abs(art.left + art.width / 2 - root.left - root.width / 2),
          primary: !!primary && getComputedStyle(primary).display === 'flex'
            && primary.contains(document.querySelector('#btn-chero-read'))
            && primary.contains(document.querySelector('#btn-chero-done')),
          quiet: ['open', 'deferred'].every((id) => {
            const node = document.querySelector(`#btn-chero-${id}`);
            const style = getComputedStyle(node);
            return !node.hidden && style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.textDecorationLine === 'underline'
              && node.getBoundingClientRect().height >= target;
          }),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, profile.platform === 'android' ? 48 : 44);
      if (profile.width <= 620) checked(t, `${label}: centered cover, paired primary actions and two quiet actions`,
        card.center <= 1 && card.primary && card.quiet && !card.overflow, card);
      await capture(page, profile, theme, 'continue');
      await click(page, '#btn-chero-deferred');
      await page.waitForSelector('#view-read:not([hidden]) #full[open]');
      checked(t, `${label}: Review deferred still opens the list`, await page.$eval('input[name="filter"][value="deferred"]', (node) => node.checked));
      await open(page, 'home');
      await click(page, '#btn-chero-done');
      await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('mrt.state.v2')).read[900002]);
      checked(t, `${label}: Done retains saved progress behavior`, true);
    }, selected);
  },
};

export const phoneNotices = {
  id: 'phone-notices',
  title: 'action notices and short action labels stay readable at phone widths and large text',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      if (profile.platform === 'android') {
        await open(page, 'issue/900002');
        await page.waitForSelector('#issue-rating-trigger:not([disabled])');
        await click(page, '#issue-rating-trigger');
        await page.waitForSelector('#issue-rating-dialog[open]');
        const number = await page.$eval('#issue-rating-input', (node) => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height };
        });
        checked(t, `${label}: number input keeps a 48dp touch target`, number.width >= 48 && number.height >= 48, number);
        await capture(page, profile, theme, 'rating-target');
        await page.$eval('#issue-rating-dialog', (dialog) => dialog.close());
      }
      await open(page, 'add-search');
      await page.$eval('#search-q', (node) => { node.value = 'Avengers'; node.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForSelector('#search-lists-results .catalog-card-preview');
      await click(page, '#search-lists-results .catalog-card-preview');
      await page.waitForSelector('#preview[open]');
      await settle(page);
      checked(t, `${label}: ordinary Preview retains held actions and a semantic-free wrapper`,
        await page.$eval('#preview-secondary', (node) => node.parentElement.id === 'preview-add'
          && !['role', 'aria-label', 'tabindex'].some((attribute) => node.hasAttribute(attribute))));
      const head = await page.evaluate(() => {
        const title = document.querySelector('#preview-h').getBoundingClientRect();
        const close = document.querySelector('#preview-close').getBoundingClientRect();
        return { titleTop: title.top, closeTop: close.top, closeBottom: close.bottom, titleBottom: title.bottom,
          inHead: document.querySelector('#preview-h').parentElement.classList.contains('preview-head') };
      });
      checked(t, `${label}: ordinary Preview keeps Close on the title's row`,
        head.inHead && head.closeTop < head.titleBottom && head.closeBottom > head.titleTop, head);
      await previewControls(page, t, `${label} ordinary`);
      await capture(page, profile, theme, 'preview');
      await click(page, '#preview-close');
      await open(page, 'add-search');
      await page.$eval('#search-q', (node) => {
        node.value = 'Avengers';
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForSelector('#search-lists-results .catalog-row > .btn');
      const search = await page.$eval('#search-lists-results .catalog-row > .btn', (node) => {
        const range = document.createRange(); range.selectNodeContents(node);
        const lines = [...range.getClientRects()];
        return { lines: new Set(lines.map((box) => Math.round(box.top))).size, width: node.getBoundingClientRect().width };
      });
      checked(t, `${label}: Search Open stays one line`, search.lines === 1, search);
      await capture(page, profile, theme, 'search-results');
      await open(page, 'home');
      await click(page, '#btn-chero-open');
      await page.waitForSelector('#view-read:not([hidden])');
      const sheet = await page.$('#android-list-options');
      if (sheet && await sheet.evaluate((node) => node.getClientRects().length > 0)) await click(page, '#android-list-options');
      else await page.$eval('#list-actions', (node) => { node.open = true; });
      const ordinaryStyle = await page.evaluate(() => document.documentElement.style.cssText);
      await largeText(page, profile);
      if (sheet && await sheet.evaluate((node) => node.getClientRects().length > 0)) {
        const close = await page.$eval('#android-list-sheet .android-sheet-header button', (node) => {
          const range = document.createRange(); range.selectNodeContents(node);
          return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
        });
        checked(t, `${label}: list options Close stays one line at large text`, close === 1, close);
      }
      await capture(page, profile, theme, 'list-options-large-text');
      await click(page, '#btn-delete-list');
      await page.waitForSelector('#ask[open]');
      await click(page, '#ask-ok');
      await page.waitForSelector('.notice-act .grow');
      const notice = await page.$eval('.notice-act:has(.grow)', (node) => {
        const message = node.querySelector('.grow').getBoundingClientRect();
        const root = node.getBoundingClientRect();
        const actions = [...node.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        return { width: message.width, root: root.width, messageBottom: message.bottom,
          actionsTop: Math.min(...actions.map((box) => box.top)), wrap: getComputedStyle(node.querySelector('.grow')).overflowWrap };
      });
      checked(t, `${label}: notice has a full-width whole-word message above actions`, notice.width >= notice.root - 65
        && notice.actionsTop >= notice.messageBottom && notice.wrap === 'normal', notice);
      await page.$eval('.notice-act:has(.grow)', (node) => node.scrollIntoView({ block: 'center' }));
      await capture(page, profile, theme, 'removal-notice-large-text');
      const scaledStyle = await page.evaluate((ordinary) => {
        const scaled = document.documentElement.style.cssText;
        document.documentElement.style.cssText = ordinary;
        delete document.documentElement.dataset.iosLargestText;
        return scaled;
      }, ordinaryStyle);
      await settle(page);
      const ordinaryNotice = await page.$eval('.notice-act:has(.grow)', (node) => {
        const message = node.querySelector('.grow');
        const text = message.getBoundingClientRect();
        return { width: text.width, available: node.clientWidth,
          actionsBelow: [...node.querySelectorAll('button')].every((button) => button.getBoundingClientRect().top >= text.bottom),
          noExtraStop: message.scrollWidth <= message.clientWidth && message.scrollHeight <= message.clientHeight
            && !message.hasAttribute('tabindex') };
      });
      checked(t, `${label}: ordinary removal message fills its row above actions`,
        ordinaryNotice.width >= ordinaryNotice.available - 65 && ordinaryNotice.actionsBelow && ordinaryNotice.noExtraStop, ordinaryNotice);
      await capture(page, profile, theme, 'removal-notice');
      await page.evaluate((scaled, platform) => {
        document.documentElement.style.cssText = scaled;
        if (platform === 'ios') document.documentElement.dataset.iosLargestText = 'true';
      }, scaledStyle, profile.platform);
      await settle(page);
      await page.evaluate(() => [...document.querySelectorAll('.notice-act button')].find((node) => node.textContent === 'Undo removal').click());
      await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('mrt.state.v2')).lists['phone-layout']);
      checked(t, `${label}: Undo restores the removed list`, true);
      await open(page, 'home');
      await click(page, '#home-updates-toggle');
      const close = await page.$eval('#home-updates-close', (node) => {
        const range = document.createRange(); range.selectNodeContents(node);
        return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
      });
      checked(t, `${label}: What's new Close stays one line at large text`, close === 1, close);
      await capture(page, profile, theme, 'whats-new-large-text');
      await click(page, '#home-updates-close');
      checked(t, `${label}: What's new still closes`, await page.$eval('#home-updates', (node) => !node.open));
      if (profile.platform !== 'desktop') {
        await click(page, '#btn-chero-done');
        await page.waitForSelector('#home-continue #done-result');
        await settle(page);
        const done = await page.$eval('#home-continue #done-result', (node) => {
          const box = node.getBoundingClientRect();
          const message = node.querySelector('.grow');
          const undo = node.querySelector('button');
          const action = undo.getBoundingClientRect();
          const rail = document.querySelector('.rail-header').getBoundingClientRect();
          return {
            height: box.height, available: visualViewport.height - rail.height,
            wholeWords: getComputedStyle(message).overflowWrap === 'normal',
            focusable: (message.scrollHeight <= message.clientHeight && message.scrollWidth <= message.clientWidth)
              || message.getAttribute('tabindex') === '0',
            undoVisible: action.top >= box.top && action.bottom <= box.bottom,
          };
        });
        checked(t, `${label}: Done leaves a readable content band and usable Undo`, done.height < done.available / 2
          && done.wholeWords && done.focusable && done.undoVisible, done);
        await capture(page, profile, theme, 'done-large-text');
        const doneMessage = await page.$eval('#done-result .grow', (node, word) => {
          const previous = node.textContent;
          node.textContent = `${previous} ${word}`;
          return previous;
        }, longListName);
        await page.waitForFunction(() => {
          const message = document.querySelector('#done-result .grow');
          return message.scrollWidth > message.clientWidth && message.getAttribute('tabindex') === '0';
        });
        const longDone = await page.$eval('#done-result', (node) => {
          const message = node.querySelector('.grow');
          const undo = node.querySelector('button').getBoundingClientRect();
          const bar = node.getBoundingClientRect();
          return {
            page: document.documentElement.scrollWidth, visual: visualViewport.width,
            height: bar.height, available: visualViewport.height - document.querySelector('.rail-header').offsetHeight,
            undoVisible: undo.top >= bar.top && undo.bottom <= bar.bottom,
            focusable: message.getAttribute('tabindex') === '0',
          };
        });
        checked(t, `${label}: a long Done message stays scrollable without covering Undo or widening the page`,
          longDone.page <= longDone.visual + 1 && longDone.height < longDone.available / 2
          && longDone.undoVisible && longDone.focusable, longDone);
        await page.$eval('#done-result .grow', (node, original) => { node.textContent = original; }, doneMessage);
        await settle(page);
        await click(page, '#done-result button');
        await page.waitForFunction(() => !JSON.parse(localStorage.getItem('mrt.state.v2')).read[900002]);
        checked(t, `${label}: bounded Done Undo preserves its outcome`, true);
      }
      await open(page, 'home');
      await page.$eval('#cloud-sync-notice', (node) => { node.hidden = false; });
      await page.$eval('#cloud-sync-message', (node, word) => { node.textContent = word; }, longListName);
      await page.waitForFunction(() => {
        const message = document.querySelector('#cloud-sync-message');
        return message.scrollWidth > message.clientWidth && message.getAttribute('tabindex') === '0';
      });
      checked(t, `${label}: the shared cloud message receives keyboard scrolling when its text overflows`,
        await page.$eval('#cloud-sync-message', (node) => getComputedStyle(node).overflowX === 'auto'));
      await page.$eval('#cloud-sync-message', (node) => { node.textContent = 'Your progress differs between devices.'; });
      await page.waitForFunction(() => {
        const message = document.querySelector('#cloud-sync-message');
        return message.scrollWidth <= message.clientWidth && message.scrollHeight <= message.clientHeight
          && !message.hasAttribute('tabindex');
      });
      checked(t, `${label}: the cloud message loses the extra tab stop when its text fits`, true);
      await page.$eval('#cloud-sync-notice', (node) => { node.hidden = true; });
      for (const view of ['progress', 'new-to-comics', 'about', 'add-search']) {
        await open(page, view);
        const viewport = await page.evaluate(() => {
          const nav = document.querySelector('.rail-header').getBoundingClientRect();
          return { visual: visualViewport.width, layout: innerWidth, page: document.documentElement.scrollWidth,
            navLeft: nav.left, navRight: nav.right };
        });
        checked(t, `${label}: ${view} fits the visual viewport and all bottom tabs`, Math.abs(viewport.layout - viewport.visual) <= 1
          && viewport.page <= viewport.visual + 1 && (profile.platform === 'desktop'
            || (viewport.navLeft >= 0 && viewport.navRight <= viewport.visual + 1)), viewport);
        if (view === 'progress') checked(t, `${label}: Progress exercises a populated intrinsic grid`,
          await page.$$eval('#series-progress .lgroup', (nodes) => nodes.length > 0));
        await capture(page, profile, theme, `${view}-large-text`);
      }
      await open(page, 'add-search');
      await page.$eval('#search-q', (node) => { node.value = 'Avengers'; node.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForSelector('#search-lists-results .catalog-card-preview');
      await click(page, '#search-lists-results .catalog-card-preview');
      await page.waitForSelector('#preview[open]');
      await settle(page);
      const chrome = await page.$eval('#preview', (dialog) => {
        const head = dialog.querySelector('.dialog-head').getBoundingClientRect();
        const foot = dialog.querySelector('.dialog-foot').getBoundingClientRect();
        return { head: head.height, foot: foot.height, available: dialog.clientHeight, bodyBand: foot.top - head.bottom };
      });
      checked(t, `${label}: Preview keeps readable body between Close and actions`, chrome.head + chrome.foot < chrome.available * .7
        && chrome.bodyBand > 0, chrome);
      await capture(page, profile, theme, 'preview-large-text');
      await previewControls(page, t, `${label} large text`);
      await page.$eval('#preview', (dialog) => { dialog.scrollTop = dialog.scrollHeight; });
      await settle(page);
      const closeVisible = await page.$eval('#preview-close', (node) => {
        const r = node.getBoundingClientRect();
        const dialog = node.closest('dialog').getBoundingClientRect();
        return r.top >= dialog.top && r.bottom <= dialog.bottom;
      });
      checked(t, `${label}: Preview Close remains visible after scroll`, closeVisible);
      await capture(page, profile, theme, 'preview-large-text-scrolled');
      await click(page, '#preview-close');
      await page.waitForSelector('#preview:not([open])');
    }, selected ?? (process.argv.includes('--prove') ? [...profiles, androidPhoneProfiles[0]] : profiles));
  },
};

export const phoneLongNotice = {
  id: 'phone-long-notice',
  title: 'an unbroken list name stays readable without widening the phone viewport',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      for (const size of ['ordinary', 'largest']) {
        if (size === 'largest') await largeText(page, profile);
        await open(page, 'read');
        if (profile.platform === 'desktop') await page.$eval('#list-actions', (node) => { node.open = true; });
        else await click(page, '#android-list-options');
        await click(page, '#btn-delete-list');
        await page.waitForSelector('#ask[open]');
        await click(page, '#ask-ok');
        await page.waitForFunction((name) => [...document.querySelectorAll('.notice-act .grow')]
          .some((node) => node.textContent.includes(name)), {}, longListName);
        await settle(page);
        const notice = await page.evaluate((name) => {
          const message = [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name));
          const box = message.getBoundingClientRect();
          const parent = message.parentElement.getBoundingClientRect();
          const word = document.createRange();
          const text = message.firstChild;
          const start = text.textContent.indexOf(name);
          word.setStart(text, start);
          word.setEnd(text, start + name.length);
          const rail = document.querySelector('.rail-header').getBoundingClientRect();
          return {
            visual: visualViewport.width, layout: innerWidth, page: document.documentElement.scrollWidth,
            rail: { left: rail.left, right: rail.right, width: rail.width },
            message: {
              width: box.width, height: box.height, parentWidth: parent.width, scrollWidth: message.scrollWidth,
              overflowX: getComputedStyle(message).overflowX, overflowWrap: getComputedStyle(message).overflowWrap,
              wordBreak: getComputedStyle(message).wordBreak, tabIndex: message.getAttribute('tabindex'),
              wordLines: new Set([...word.getClientRects()].map((rect) => Math.round(rect.top))).size,
            },
            actions: [...message.parentElement.querySelectorAll('button')].map((button) => {
              const action = button.getBoundingClientRect();
              return { name: button.textContent.trim(), below: action.top >= box.bottom - 0.5 };
            }),
          };
        }, longListName);
        checked(t, `${label} ${size}: the whole word stays inside a scrollable message without widening the page`,
          Math.abs(notice.visual - notice.layout) <= 1 && notice.page <= notice.visual + 1
          && (profile.platform === 'desktop' || (notice.rail.width > 0 && notice.rail.left >= 0
            && notice.rail.right <= notice.visual + 1))
          && notice.message.width > notice.message.parentWidth * .8
          && notice.message.scrollWidth > notice.message.width
          && notice.message.overflowX === 'auto' && notice.message.overflowWrap === 'normal'
          && notice.message.wordBreak === 'normal' && notice.message.wordLines === 1
          && notice.message.height >= (profile.platform === 'android' ? 48 : 44),
          notice);
        checked(t, `${label} ${size}: Undo and Dismiss remain below the message`,
          ['Undo removal', 'Dismiss'].every((name) => notice.actions.some((action) => action.name === name && action.below)),
          notice.actions);
        await page.evaluate((name) => {
          const message = [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name));
          message.scrollLeft = 0;
          message.focus();
        }, longListName);
        await page.keyboard.press('ArrowRight');
        await settle(page);
        const keyboard = await page.evaluate((name) => {
          const message = [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name));
          return { focus: document.activeElement === message, tabIndex: message.getAttribute('tabindex'), scrollLeft: message.scrollLeft };
        }, longListName);
        checked(t, `${label} ${size}: keyboard focus scrolls the complete message`,
          keyboard.focus && keyboard.tabIndex === '0' && keyboard.scrollLeft > 0, keyboard);
        if (profile.platform !== 'desktop') {
          const touch = await page.evaluate((name) => {
            const message = [...document.querySelectorAll('.notice-act .grow')]
              .find((node) => node.textContent.includes(name));
            message.scrollIntoView({ block: 'center' });
            message.scrollLeft = 0;
            const box = message.getBoundingClientRect();
            return { start: box.left + box.width * .8, end: box.left + box.width * .2, y: box.top + box.height / 2 };
          }, longListName);
          await page.touchscreen.touchStart(touch.start, touch.y);
          await page.touchscreen.touchMove(touch.end, touch.y);
          await page.touchscreen.touchEnd();
          await settle(page);
          const scrolled = await page.evaluate((name) => [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name)).scrollLeft, longListName);
          checked(t, `${label} ${size}: a touch swipe scrolls the complete message`, scrolled > 0, { ...touch, scrolled });
        }
        const tailVisible = await page.evaluate((name) => {
          const message = [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name));
          message.scrollLeft = message.scrollWidth;
          const text = message.firstChild;
          const end = text.textContent.indexOf(name) + name.length;
          const tail = document.createRange();
          tail.setStart(text, end - 1);
          tail.setEnd(text, end);
          const char = tail.getBoundingClientRect();
          const box = message.getBoundingClientRect();
          return char.left >= box.left && char.right <= box.right + 0.5;
        }, longListName);
        checked(t, `${label} ${size}: the end of the unbroken name is reachable`, tailVisible);
        const accessibility = await page.createCDPSession();
        const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
        await accessibility.detach();
        checked(t, `${label} ${size}: the complete message remains in the accessibility tree`,
          nodes.some((node) => !node.ignored && node.name?.value?.includes(longListName)));
        await page.waitForFunction((name) => document.querySelector('#announcer').textContent.includes(name), {}, longListName);
        const announcement = await page.$eval('#announcer', (node) => node.textContent);
        checked(t, `${label} ${size}: the removal and both choices are announced`,
          announcement.includes(longListName) && announcement.includes('Undo removal') && announcement.includes('Dismiss'),
          announcement);
        const choice = size === 'ordinary' ? 'Undo removal' : 'Dismiss';
        await page.evaluate((name, action) => {
          const message = [...document.querySelectorAll('.notice-act .grow')]
            .find((node) => node.textContent.includes(name));
          const button = [...message.parentElement.querySelectorAll('button')]
            .find((candidate) => candidate.textContent.trim() === action);
          button.click();
        }, longListName, choice);
        await page.waitForFunction((id, restored) =>
          Boolean(JSON.parse(localStorage.getItem('mrt.state.v2')).lists[id]) === restored, {}, listId, size === 'ordinary');
        checked(t, `${label} ${size}: ${choice} ${size === 'ordinary' ? 'restores the list' : 'leaves it removed'}`, true);
      }
    }, selected ?? [profiles[0], profiles[1]], catalog, longInitial);
  },
};

async function phoneViewport(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.rail-header').getBoundingClientRect();
    return {
      visual: visualViewport.width, visualHeight: visualViewport.height, layout: innerWidth,
      page: document.documentElement.scrollWidth,
      nav: { left: nav.left, top: nav.top, right: nav.right, bottom: nav.bottom, width: nav.width, height: nav.height },
    };
  });
}

function phoneViewportFits(viewport) {
  return Math.abs(viewport.layout - viewport.visual) < 0.5
    && viewport.page <= viewport.visual
    && viewport.nav.width > 0 && viewport.nav.height > 0 && viewport.nav.left >= 0 && viewport.nav.top >= 0
    && viewport.nav.right <= viewport.visual + 0.5
    && viewport.nav.bottom <= viewport.visualHeight + 0.5;
}

export const phoneSearchReflow = {
  id: 'phone-search-reflow',
  title: 'saved and unsaved Search results fit the phone viewport at ordinary and largest text',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      await open(page, 'add-search');
      await page.$eval('#search-q', (node) => {
        node.value = 'House of M';
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForSelector('#search-lists-results [data-story="list:house-of-m-essential"] > .btn');
      for (const size of ['ordinary', 'largest']) {
        if (size === 'largest') await largeText(page, profile);
        const viewport = await phoneViewport(page);
        const rows = await page.$$eval('#search-lists-results .catalog-row', (nodes) => nodes.map((row) => {
          const action = row.querySelector(':scope > .btn');
          const rowBox = row.getBoundingClientRect();
          const buttonBox = action?.getBoundingClientRect();
          const text = document.createRange();
          if (action) text.selectNodeContents(action);
          return {
            story: row.dataset.story, width: row.clientWidth, scroll: row.scrollWidth,
            action: action?.textContent.trim(), name: action?.getAttribute('aria-label'),
            inside: Boolean(buttonBox) && buttonBox.left >= rowBox.left
              && buttonBox.right <= rowBox.right + 0.5 && action.scrollWidth <= action.clientWidth + 1,
            lines: new Set([...text.getClientRects()].filter((rect) => rect.width > 0)
              .map((rect) => Math.round(rect.top))).size,
          };
        }));
        const saved = rows.find((row) => row.story === 'list:house-of-m');
        const unsaved = rows.find((row) => row.story === 'list:house-of-m-essential');
        checked(t, `${label} ${size}: Search rows and bottom tabs fit the visual viewport`,
          phoneViewportFits(viewport) && rows.length >= 2
          && rows.every((row) => row.scroll <= row.width + 1 && row.inside), { viewport, rows });
        checked(t, `${label} ${size}: saved Open and unsaved Add retain their names and Open stays whole`,
          saved?.action === 'Open →' && saved.name?.startsWith('Open')
          && saved.lines === 1 && unsaved?.action === '+ Add to library'
          && unsaved.name?.startsWith('Add to library:'), { saved, unsaved });
        if (size === 'largest') {
          await capturePhoneContent(page, profile, theme, `search-reflow-${size}`,
            '#search-lists-results [data-story="list:house-of-m-essential"] > .btn');
        }
      }
      for (const id of ['house-of-m', 'house-of-m-essential']) {
        const selector = `#search-lists-results [data-story="list:${id}"] > .btn`;
        await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
        await settle(page);
        const target = await page.$eval(selector, (node) => {
          node.focus({ preventScroll: true });
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { focused: document.activeElement === node, hit: node.contains(hit), width: box.width, height: box.height };
        });
        checked(t, `${label} largest: ${id} action is focusable and under its pointer target`,
          target.focused && target.hit && target.width >= 44 && target.height >= 44, target);
      }
    }, selected ?? [profiles[1]], reflowCatalog);
  },
};

// At the largest iOS text a long series or creator name could not wrap past Open, so Search widened
// a 390 wide page to as much as 535 CSS pixels (#1240), and every query here went past the edge on
// the prepared iOS bundle. Aaron is the one that reaches the creator rows. At ordinary text many of
// these rows squeezed Open onto two lines or more on every phone, and onto four on Android 360.
// Removing both rules failed 92 of these 136 checks on iOS 390 and 375, with the phone stylesheets
// injected into the web page, and 82 of 136 on the prepared Android build at 360 and 412. Removing
// only the phone list row rule still failed 2, Annihilation: Conquest running 12.8 pixels too wide
// for its row at the largest text on the 375 wide iPhone.
const searchRowCases = [
  { query: 'Secret', scope: 'series' },
  { query: 'Extraordinary', scope: 'series' },
  { query: 'Annihilation', scope: 'series' },
  { query: 'Aaron', scope: 'creators' },
];

async function searchRows(page) {
  return page.evaluate(() => {
    const shown = (node) => node.getClientRects().length > 0;
    const reach = (rects) => Math.max(-Infinity, ...[...rects].filter((rect) => rect.width > 0).map((rect) => rect.right));
    const lines = (range) => new Set([...range.getClientRects()].filter((rect) => rect.width > 0)
      .map((rect) => Math.round(rect.top))).size;
    const texts = (node) => {
      const found = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) found.push(text);
      return found;
    };
    const textReach = (node) => Math.max(-Infinity, ...texts(node).map((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return reach(range.getClientRects());
    }));
    // A word is a run of letters or digits, so a line break after a hyphen or a colon is not a split.
    const split = (node) => texts(node).flatMap((text) => [...text.data.matchAll(/[\p{L}\p{N}]+/gu)]
      .filter((match) => {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        return lines(range) > 1;
      }).map((match) => match[0]));
    const round = (value) => Math.round(value * 10) / 10;
    const rows = [];
    for (const group of document.querySelectorAll('#search-panes .search-group')) {
      if (group.hidden || !shown(group)) continue;
      const pane = group.getBoundingClientRect();
      for (const row of group.querySelectorAll('.search-row')) {
        if (!shown(row)) continue;
        const box = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const inner = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
        const main = row.querySelector('.result-main');
        const title = row.querySelector('.result-title');
        const action = row.querySelector(':scope > .btn');
        const words = document.createRange();
        if (action) words.selectNodeContents(action);
        rows.push({
          group: group.id.replace('search-', ''), list: row.classList.contains('catalog-row'),
          title: title?.textContent.trim(), pane: round(box.right - pane.right),
          elements: round(Math.max(-Infinity, ...[...row.querySelectorAll('*')].map((node) => reach(node.getClientRects()))) - inner),
          text: main ? round(textReach(main) - main.getBoundingClientRect().right) : null,
          scroll: row.scrollWidth - row.clientWidth,
          action: action?.textContent.trim(), actionLines: action ? lines(words) : 0,
          actionClipped: !action || action.scrollWidth > action.clientWidth + 1,
          actionSplit: action ? split(action) : [], titleSplit: title ? split(title) : [],
        });
      }
    }
    return rows;
  });
}

export const phoneSearchRowsFit = {
  id: 'phone-search-rows-fit',
  title: 'Search list, series and creator rows fit the phone at ordinary and largest text',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      await open(page, 'add-search');
      for (const size of ['ordinary', 'largest']) {
        if (size === 'largest') await largeText(page, profile);
        let lists = 0;
        for (const { query, scope } of searchRowCases) {
          await page.$eval('#search-q', (node, value) => {
            node.value = value;
            node.dispatchEvent(new Event('input', { bubbles: true }));
          }, query);
          await page.waitForFunction((value) =>
            document.querySelector('#search-count').textContent === `Top results for \u201c${value}\u201d`, {}, query);
          await settle(page);
          for (const shownScope of ['top', scope]) {
            if (shownScope !== 'top') {
              await click(page, `#search-scopes [data-scope="${shownScope}"]`);
              await settle(page);
            }
            const viewport = await phoneViewport(page);
            const rows = await searchRows(page);
            if (shownScope === 'top') lists += rows.filter((row) => row.list).length;
            const named = rows.filter((row) => !row.list).length;
            const outside = rows.filter((row) => row.pane > 0.5 || row.elements > 0.5 || row.text > 0.5
              || row.scroll > 1 || row.actionClipped);
            const name = `${label} ${size}, ${shownScope} for ${query}`;
            checked(t, `${name}: every row and its text stay inside the pane and the page does not scroll sideways`,
              phoneViewportFits(viewport) && rows.length > 0 && (shownScope === 'top' || named > 0) && outside.length === 0,
              { viewport, rows: rows.length, named, outside });
            const broken = rows.filter((row) => row.actionSplit.length > 0
              || (!row.list && (row.action !== 'Open' || row.actionLines !== 1))
              || (size === 'ordinary' && row.titleSplit.length > 0));
            checked(t, `${name}: Open stays whole on one line and no action${size === 'ordinary' ? ' or title' : ''} splits a word`,
              broken.length === 0, broken);
          }
          await click(page, '#search-scopes [data-scope="top"]');
          await settle(page);
        }
        checked(t, `${label} ${size}: Top showed Reading List rows for at least one query`, lists > 0, { lists });
      }
    }, selected ?? [{ width: 390, height: 844, platform: 'ios' }, profiles[1]], actualCatalog);
  },
};

export const phoneCatalogReflow = {
  id: 'phone-catalog-reflow',
  title: 'the catalog description fits the phone viewport at ordinary and largest text',
  async run(page, t, selected) {
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      await open(page, 'catalog');
      await page.$eval('#catalog-q', (node) => {
        node.value = 'New X-Men: Assault on Weapon Plus';
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const selector = '#catalog-results [data-story="list:marvel-knights-to-planet-x-73"] .catalog-card-desc';
      await page.waitForSelector(selector);
      for (const size of ['ordinary', 'largest']) {
        if (size === 'largest') await largeText(page, profile);
        const viewport = await phoneViewport(page);
        const description = await page.$eval(selector, (node) => {
          const box = node.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(node);
          const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
          return {
            text: node.textContent, width: node.clientWidth, scroll: node.scrollWidth,
            lines: lines.length, inside: lines.every((rect) => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5),
          };
        });
        checked(t, `${label} ${size}: the real catalog description and bottom tabs fit the visual viewport`,
          phoneViewportFits(viewport) && description.text.includes('mutant experimentation')
          && description.scroll <= description.width + 1 && description.lines > 0 && description.inside,
          { viewport, description });
        if (size === 'largest') {
          await capturePhoneContent(page, profile, theme, `catalog-reflow-${size}`, selector);
        }
      }
    }, selected ?? [profiles[1]], reflowCatalog);
  },
};

export function dataReflowScenario({ cloudFixtureHost, installCloudFixture, seedFixtureState, open }) {
  return {
    id: 'narrow-data-reflow',
    title: 'backup file controls fit a narrow Windows window with and without cloud backup',
    async run(page, t) {
      await page.setViewport({ width: 480, height: 800 });
      await seedFixtureState(page);
      const noCloud = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/__recap_cloud__/v1/status' && response.status() === 404);
      await open(page, '/#/data');
      await noCloud;
      await page.waitForSelector('#view-data:not([hidden])');
      const tokens = await page.evaluate(() => Object.fromEntries(
        ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']
          .map((token) => [token, parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token))]),
      ));
      const measure = async (state) => {
        for (const theme of ['light', 'dark']) {
          for (const size of ['ordinary', 'largest']) {
            await page.evaluate(({ values, chosen, scaled }) => {
              document.documentElement.dataset.theme = chosen;
              for (const [token, value] of Object.entries(values)) {
                document.documentElement.style.setProperty(token, `${value * (scaled ? 2 : 1)}px`);
              }
            }, { values: tokens, chosen: theme, scaled: size === 'largest' });
            await settle(page);
            const layout = await page.evaluate(() => {
              const inputs = ['restore-complete', 'restore-file', 'restore-draft']
                .map((id) => document.getElementById(id))
                .filter((node) => node && node.checkVisibility() && !node.closest('[hidden]'));
              return {
                visual: visualViewport.width, layout: innerWidth, page: document.documentElement.scrollWidth,
                files: inputs.map((node) => {
                  const box = node.getBoundingClientRect();
                  const row = node.closest('.field-row')?.getBoundingClientRect();
                  return {
                    id: node.id, label: node.labels?.[0]?.textContent.trim(), disabled: node.disabled,
                    left: box.left, right: box.right, rowLeft: row?.left, rowRight: row?.right,
                    width: box.width, height: box.height,
                  };
                }),
              };
            });
            checked(t, `${state} ${theme} ${size}: file controls and the page fit the 480px visual viewport`,
              layout.layout === layout.visual && layout.page <= layout.visual
              && ['restore-complete', 'restore-file', 'restore-draft'].every((id) => layout.files.some((input) => input.id === id))
              && layout.files.every((input) => input.label && !input.disabled && input.width > 0 && input.height >= 44
                && input.rowLeft !== undefined && input.rowRight !== undefined
                && input.left >= input.rowLeft - 0.5 && input.right <= input.rowRight + 0.5),
              layout);
            if (state === 'connected' && theme === 'dark' && size === 'largest') {
              await page.$eval('#restore-file', (node) => node.scrollIntoView({ block: 'center' }));
              await settle(page);
              await capture(page, { platform: 'desktop', width: 480, height: 800 }, theme, 'data-reflow-connected-largest');
            }
          }
        }
      };
      checked(t, 'the unconfigured build has no cloud card', await page.$eval('#cloud-backup', (node) => node.hidden));
      await measure('without cloud');

      const fixture = cloudFixtureHost();
      await installCloudFixture(page, fixture);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#cloud-backup:not([hidden]) #btn-cloud-sign-in:not([hidden])');
      await measure('signed out');
      await page.$eval('#btn-cloud-sign-in', (node) => node.click());
      await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.includes('Finish signing in'));
      fixture.signedIn();
      await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.startsWith('Connected to OneDrive'),
        { timeout: 15000 });
      await page.waitForSelector('#cloud-auto:not([hidden])');
      await measure('connected');
      for (const id of ['restore-complete', 'restore-file', 'restore-draft']) {
        await page.$eval(`#${id}`, (node) => node.scrollIntoView({ block: 'center' }));
        await settle(page);
        const target = await page.$eval(`#${id}`, (node) => {
          node.focus({ preventScroll: true });
          const box = node.getBoundingClientRect();
          return {
            focus: document.activeElement === node,
            hit: node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
          };
        });
        checked(t, `connected largest: ${id} is focusable and under its pointer target`, target.focus && target.hit, target);
      }
    },
  };
}

const referenceFiles = new Map();
function referenceFile(ref, path) {
  const key = `${ref}:${path}`;
  if (!referenceFiles.has(key)) {
    try {
      referenceFiles.set(key, execFileSync('git', ['show', key], { encoding: 'utf8', maxBuffer: 1 << 26 }));
    } catch (error) {
      throw new Error(`The Continue card comparison needs ${key}; fetch full history first. ${error.message}`, { cause: error });
    }
  }
  return referenceFiles.get(key);
}

// The card was centered for phones only (#1175). Above 620px every layer must still render main's card
// before #1178, so the reference is that commit's stylesheets and action classes swapped into the same page.
const MAIN_BEFORE_CARD = '4f6453e296ce15437c1ebd06be92ffef84f084ba';
const PHONE_CARD = 'a595e4090783e9a56ab329a4b36a306f2737f1b4';

async function measureContinueCard(page) {
  await settle(page);
  return page.evaluate(() => {
    const root = document.querySelector('#home-continue').getBoundingClientRect();
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return [box.left - root.left, box.top - root.top, box.width, box.height].map((value) => Math.round(value * 100) / 100);
    };
    const boxes = { card: [0, 0, root.width, root.height].map((value) => Math.round(value * 100) / 100) };
    for (const selector of ['.art', '.chero-body', '#chero-h', '#chero-count', '#chero-bar', '#chero-next', '#chero-actions']) {
      boxes[selector] = rect(document.querySelector(`#home-continue ${selector}`));
    }
    const styles = {};
    for (const node of document.querySelectorAll('#chero-actions .btn')) {
      boxes[node.id] = rect(node);
      const style = getComputedStyle(node);
      styles[node.id] = ['display', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'fontWeight',
        'backgroundColor', 'color', 'borderTopColor', 'borderTopLeftRadius', 'textDecorationLine', 'minHeight', 'lineHeight',
        'textAlign'].map((key) => `${key}=${style[key]}`).join(' ');
    }
    // Done's confirmation follows the actions and is fixed over the bottom bar on Android phones, so its
    // viewport box is compared too. A stand-in is used because the real one retires on a timer.
    const probe = document.createElement('p');
    probe.id = 'done-result';
    probe.className = 'notice notice-ok notice-act';
    probe.innerHTML = '<span class="grow">Marked as read.</span><button type="button" class="quiet">Undo</button>';
    document.querySelector('#chero-actions').after(probe);
    const bar = probe.getBoundingClientRect();
    boxes['done-result'] = [bar.left, bar.top, bar.width, bar.height].map((value) => Math.round(value * 100) / 100);
    probe.remove();
    return { boxes, styles, textAlign: getComputedStyle(document.querySelector('.chero-in')).textAlign };
  });
}

async function applyReferenceCard(page, ref) {
  const sheets = {
    styles: referenceFile(ref, 'src/styles.css'),
    mobile: referenceFile(ref, 'packaging/android/web/mobile.css'),
    ios: referenceFile(ref, 'packaging/ios/web/ios.css'),
  };
  const html = referenceFile(ref, 'src/index.html');
  const classes = Object.fromEntries(['read', 'done', 'open', 'deferred'].map((id) => {
    const match = html.match(new RegExp(`class="([^"]+)" id="btn-chero-${id}"`));
    if (!match) throw new Error(`${ref} has no class for btn-chero-${id}`);
    return [id, match[1]];
  }));
  const swapped = await page.evaluate((sheets, current, classes, wrapped) => {
    const swaps = [];
    const replace = (node, text, name) => {
      const style = document.createElement('style');
      style.textContent = text;
      node.replaceWith(style);
      swaps.push(name);
    };
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const path = new URL(link.href).pathname;
      if (path.endsWith('/styles.css')) replace(link, sheets.styles, 'styles');
      else if (path.endsWith('/mobile.css')) replace(link, sheets.mobile, 'mobile');
      else if (path.endsWith('/ios.css')) replace(link, sheets.ios, 'ios');
    }
    for (const style of document.querySelectorAll('style')) {
      if (style.textContent === current.mobile) replace(style, sheets.mobile, 'mobile overlay');
      else if (style.textContent === current.ios) replace(style, sheets.ios, 'ios overlay');
    }
    for (const [id, name] of Object.entries(classes)) document.querySelector(`#btn-chero-${id}`).className = name;
    const wrapper = document.querySelector('.chero-primary-actions');
    if (wrapper && !wrapped) wrapper.replaceWith(...wrapper.childNodes);
    return swaps;
  }, sheets, { mobile: mobileCss, ios: iosCss }, classes, html.includes('class="chero-primary-actions"'));
  return swapped;
}

function sameCard(now, then) {
  const drift = [];
  for (const [key, box] of Object.entries(then.boxes)) {
    const mine = now.boxes[key];
    if (!mine || mine.some((value, index) => Math.abs(value - box[index]) > 0.5)) drift.push({ key, now: mine, then: box });
  }
  for (const [key, style] of Object.entries(then.styles)) {
    if (now.styles[key] !== style) drift.push({ key, now: now.styles[key], then: style });
  }
  if (now.textAlign !== then.textAlign) drift.push({ key: 'text-align', now: now.textAlign, then: then.textAlign });
  return drift;
}

const wideCardProfiles = [
  { width: 1280, height: 900, platform: 'desktop', ref: MAIN_BEFORE_CARD },
  { width: 820, height: 1180, platform: 'desktop', ref: MAIN_BEFORE_CARD },
  { width: 844, height: 390, platform: 'desktop', ref: MAIN_BEFORE_CARD },
  { width: 820, height: 1180, platform: 'ios', ref: MAIN_BEFORE_CARD },
  { width: 844, height: 390, platform: 'ios', ref: MAIN_BEFORE_CARD },
  { width: 820, height: 1180, platform: 'android', ref: MAIN_BEFORE_CARD },
  { width: 844, height: 390, platform: 'android', ref: MAIN_BEFORE_CARD },
  { width: 393, height: 852, platform: 'ios', ref: PHONE_CARD },
  { width: 360, height: 800, platform: 'android', ref: PHONE_CARD },
  // A short phone landscape keeps a595's side-by-side card and its Done bar, and so does split screen.
  { width: 592, height: 360, platform: 'android', ref: PHONE_CARD },
  { width: 400, height: 480, platform: 'android', ref: PHONE_CARD },
];

export const continueWideMatchesMain = {
  id: 'continue-wide-matches-main',
  title: 'Continue keeps main\'s card above 620px on every layer and the phone card at 620px and below',
  async run(page, t, selected) {
    const androidOnly = selected?.every((profile) => profile.platform === 'android');
    const chosen = androidOnly ? wideCardProfiles.filter((profile) => profile.platform === 'android') : wideCardProfiles;
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width}x${profile.height} ${theme}`;
      await page.$eval('#home-continue', (node) => node.scrollIntoView({ block: 'center' }));
      await capture(page, profile, theme, 'continue-card');
      const now = await measureContinueCard(page);
      const swaps = await applyReferenceCard(page, profile.ref);
      const then = await measureContinueCard(page);
      // The desktop gap above the card deliberately differs from main's, which moves the in-flow
      // confirmation by that gap, so the Done bar is compared only against the phone reference.
      if (profile.ref !== PHONE_CARD) delete then.boxes['done-result'];
      const drift = sameCard(now, then);
      checked(t, `${label}: Continue card geometry and action styling match ${profile.ref.slice(0, 8)}`,
        swaps.length > 0 && drift.length === 0, { swaps, drift });
    }, chosen);
  },
};

const guidePillProfiles = [
  { width: 1280, height: 900, platform: 'desktop' },
  { width: 393, height: 852, platform: 'ios' },
  { width: 360, height: 800, platform: 'android' },
  { width: 320, height: 640, platform: 'android' },
];

// The pill sits whole beside Explore when both fit at natural widths, else whole on its own line,
// and only a row too narrow for the whole label may break it, between words. The heading is never
// squeezed or split, and the page never widens.
function guideLayout() {
  const link = document.querySelector('#home-categories .home-guide-link');
  const row = link.closest('.sec-h');
  const heading = row.querySelector('#home-cat-h');
  const lines = (node, start = 0, end = node.length) => {
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  const saved = link.getAttribute('style');
  link.style.whiteSpace = 'nowrap'; link.style.maxWidth = 'none';
  const natural = link.getBoundingClientRect().width;
  if (saved === null) link.removeAttribute('style'); else link.setAttribute('style', saved);
  const box = link.getBoundingClientRect();
  const head = heading.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const besideFits = head.width + gap + natural <= rowBox.width + 0.5;
  const beside = head.bottom > box.top && box.bottom > head.top && head.right <= box.left + 1;
  const below = box.top >= head.bottom - 1;
  const wholeFits = natural <= rowBox.width + 0.5;
  return { natural: Math.round(natural), row: Math.round(rowBox.width), heading: Math.round(head.width), besideFits, beside, below,
    pillLines: lines(link.firstChild), headingLines: lines(heading.firstChild),
    headingClipped: heading.scrollWidth > heading.clientWidth + 1,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ok: (besideFits ? beside : below) && (!wholeFits || lines(link.firstChild) === 1)
      && lines(heading.firstChild) === 1 && heading.scrollWidth <= heading.clientWidth + 1
      && document.documentElement.scrollWidth <= document.documentElement.clientWidth };
}

async function guidePillContrast(page, hover) {
  await page.$eval('#home-categories .home-guide-link', (node) => node.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('#home-categories .home-guide-link', (node) => {
    const rect = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const text = [...range.getClientRects()].find((part) => part.width && part.height);
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, textLeft: text.left, textTop: text.top };
  });
  await page.mouse.move(hover ? box.left + box.width / 2 : 0, hover ? box.top + box.height / 2 : 0);
  await settle(page);
  const colour = await page.$eval('#home-categories .home-guide-link', (node) => getComputedStyle(node).color);
  const clip = { x: Math.round(box.textLeft) - 3, y: Math.round(box.textTop) + 1, width: 1, height: 1 };
  const shot = decodePng(await page.screenshot({ clip: { ...clip, x: clip.x + await page.evaluate(() => scrollX), y: clip.y + await page.evaluate(() => scrollY) } }));
  const background = shot.pixel(0, 0);
  const text = colour.match(/\d+/g).slice(0, 3).map(Number);
  await page.mouse.move(0, 0);
  return { hover, text, background, ratio: Math.round(ratio(text, background) * 100) / 100 };
}

export const guideLinkPill = {
  id: 'guide-link-pill',
  title: 'The New to Marvel Comics? link is an accent pill that stays readable, sized and unwrapped mid-word',
  async run(page, t, selected) {
    const androidOnly = selected?.every((profile) => profile.platform === 'android');
    const chosen = androidOnly ? guidePillProfiles.filter((profile) => profile.platform === 'android') : guidePillProfiles;
    await forProfiles(page, t, async (profile, theme) => {
      const label = `${profile.platform} ${profile.width} ${theme}`;
      await page.$eval('#home-categories > .sec-h', (node) => node.scrollIntoView({ block: 'center' }));
      await settle(page);
      await capture(page, profile, theme, 'guide-link');
      const style = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.cssText = 'background: rgb(var(--accent-line) / 10%); color: var(--accent-text); border: 1px solid rgb(var(--accent-line) / 30%);';
        document.body.append(probe);
        const expected = getComputedStyle(probe);
        const want = { background: expected.backgroundColor, color: expected.color, border: expected.borderTopColor };
        probe.remove();
        return [...document.querySelectorAll('a[href="#/new-to-comics"].home-guide-link')].map((node) => {
          const css = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return { id: node.closest('section')?.id, want, background: css.backgroundColor, color: css.color,
            border: css.borderTopColor, borderWidth: css.borderTopWidth, radius: parseFloat(css.borderTopLeftRadius),
            underline: css.textDecorationLine, height: box.height, rendered: box.height > 0, name: node.textContent.trim() };
        });
      });
      const target = profile.platform === 'android' ? 48 : 44;
      checked(t, `${label}: Home and empty Library guide links are accent-tint pills without underline`,
        style.length === 2 && style.some((link) => link.id === 'library-empty')
        && style.every((link) => link.background === link.want.background && link.color === link.want.color
          && link.border === link.want.border && link.borderWidth === '1px' && link.radius >= 999 && link.underline === 'none')
        && style.filter((link) => link.rendered).every((link) => link.height >= target), style);
      const contrast = [await guidePillContrast(page, false)];
      if (profile.platform === 'desktop') contrast.push(await guidePillContrast(page, true));
      console.log(`GUIDE-PILL-CONTRAST ${JSON.stringify({ ...profile, theme, contrast })}`);
      checked(t, `${label}: painted guide pill text contrast is at least 4.5:1`, contrast.every((row) => row.ratio >= 4.5), contrast);
      const layout = await page.evaluate(guideLayout);
      checked(t, `${label}: the guide pill stays whole beside Explore when both fit, else on its own line, and the heading is never squeezed`,
        layout.ok, layout);
      await largeText(page, profile);
      const large = await page.evaluate(() => {
        const node = document.querySelector('#home-categories .home-guide-link');
        const words = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          for (const match of text.data.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(text, match.index);
            range.setEnd(text, match.index + match[0].length);
            words.push({ word: match[0], lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size });
          }
        }
        return { words, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          clipped: node.scrollWidth > node.clientWidth + 1 };
      });
      checked(t, `${label}: at the largest text the guide pill splits no word and does not widen the page`,
        large.words.length > 0 && large.words.every((word) => word.lines === 1) && !large.overflow && !large.clipped, large);
      const largeLayout = await page.evaluate(guideLayout);
      checked(t, `${label}: at the largest text the guide pill and Explore follow the same placement rule`, largeLayout.ok, largeLayout);
      await page.$eval('#home-categories > .sec-h', (node) => node.scrollIntoView({ block: 'center' }));
      await settle(page);
      await capture(page, profile, theme, 'guide-link-largest');
    }, chosen);
  },
};

export const phoneLayoutScenarios = [phoneBack, phoneContinue, continueWideMatchesMain, guideLinkPill, phoneNotices, phoneLongNotice, phoneSearchReflow, phoneSearchRowsFit, phoneCatalogReflow];
export const phoneLayoutMutations = [
  {
    id: 'phone-back-on-roots', breaks: 'phone-back', why: 'restoring Back on every history entry puts it on tab roots',
    rewriteMain: (source) => source.replace('const backAvailable = navigationPosition.canGoBack && !isRoot;', 'const backAvailable = navigationPosition.canGoBack;'),
  },
  {
    id: 'phone-notice-zero-basis', breaks: 'phone-notices', why: 'restoring zero-basis notices and unbounded phone chrome removes readable content space',
    rewriteDialogShell: (source) => source.replace('if (compact) {', 'if (false && compact) {'),
    script: () => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'body .notice-act .grow { flex: 1; } '
        + 'html body #home-continue #done-result .grow { max-height: none; } '
        + 'html body #series-progress, html body #series-progress .lgroup { grid-template-columns: 1fr; } '
        + 'html body .guide-copy, html body .keys td { overflow-wrap: normal; } '
        + 'html body .catalog-row { flex-wrap: nowrap; } html body .catalog-row .result-main { flex: 1 1 auto; } '
        + 'html body .catalog-row > .btn { flex: 1 1 0; overflow-wrap: anywhere; } '
        + 'html body .home-updates-head, html body .android-sheet-header { flex-wrap: nowrap; } '
        + 'html body .home-updates-head > button, html body .android-sheet-header > button { flex-shrink: 1; overflow-wrap: anywhere; } '
        + 'html body input[type="number"] { min-height: 44px; height: 44px; }';
      document.head.append(style);
    }),
  },
  {
    id: 'phone-cover-leading', breaks: 'phone-continue', why: 'the cover returns to the leading edge instead of the card center',
    script: () => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'body #home-continue .art { margin-inline: 0; justify-self: start; }';
      document.head.append(style);
    }),
  },
  {
    id: 'phone-card-everywhere', breaks: 'continue-wide-matches-main', why: 'the phone card restyle leaks above 620px',
    // Written into the served stylesheet rather than a separate style, so the reference swap replaces it
    // and only the measurement under test carries the leak.
    rewriteStyles: (source) => `${source}\nhtml body .chero-in { grid-template-columns: 1fr; text-align: center; }\n`
      + 'html body .chero-in .art { justify-self: center; margin-inline: auto; }\n'
      + 'html body #chero-actions > .btn-g { background: none; text-decoration: underline; }\n',
  },
];
