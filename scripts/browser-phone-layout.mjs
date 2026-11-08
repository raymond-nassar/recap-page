import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyState, createList, addIssuesToList, exportBackup, markRead, setDeferred } from '../src/js/lib/model.js';

const listId = 'phone-layout';
const listName = 'Avengers: Doomsday & Avengers: Secret Wars';
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

async function setup(page, profile, theme, fixtureCatalog = catalog) {
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
  }, initial, theme, fixtureCatalog);
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

async function forProfiles(page, t, run, selected, fixtureCatalog) {
  for (const profile of selected ?? profiles) {
    for (const theme of ['light', 'dark']) {
      let cleanup;
      try { cleanup = await setup(page, profile, theme, fixtureCatalog); } catch (error) {
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
          primary: !!primary && primary.contains(document.querySelector('#btn-chero-read'))
            && primary.contains(document.querySelector('#btn-chero-done')),
          quiet: ['open', 'review', 'deferred'].every((id) => {
            const node = document.querySelector(`#btn-chero-${id}`);
            return !node.hidden && node.classList.contains('btn-link') && node.getBoundingClientRect().height >= target;
          }),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, profile.platform === 'android' ? 48 : 44);
      checked(t, `${label}: centered cover, paired primary actions and three quiet actions`, card.center <= 1 && card.primary && card.quiet && !card.overflow, card);
      await capture(page, profile, theme, 'continue');
      await click(page, '#btn-chero-deferred');
      await page.waitForSelector('#view-read:not([hidden]) #full[open]');
      checked(t, `${label}: Review deferred still opens the list`, await page.$eval('input[name="filter"][value="deferred"]', (node) => node.checked));
      await open(page, 'home');
      await click(page, '#btn-chero-review');
      await page.waitForSelector('#view-read:not([hidden]) #review-earlier:not([hidden])');
      checked(t, `${label}: Review earlier remains reachable`, true);
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
        const text = node.querySelector('.grow').getBoundingClientRect();
        return { width: text.width, available: node.clientWidth,
          actionsBelow: [...node.querySelectorAll('button')].every((button) => button.getBoundingClientRect().top >= text.bottom) };
      });
      checked(t, `${label}: ordinary removal message fills its row above actions`,
        ordinaryNotice.width >= ordinaryNotice.available - 65 && ordinaryNotice.actionsBelow, ordinaryNotice);
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
            focusable: message.scrollHeight <= message.clientHeight || message.getAttribute('tabindex') === '0',
            undoVisible: action.top >= box.top && action.bottom <= box.bottom,
          };
        });
        checked(t, `${label}: Done leaves a readable content band and usable Undo`, done.height < done.available / 2
          && done.wholeWords && done.focusable && done.undoVisible, done);
        await capture(page, profile, theme, 'done-large-text');
        await click(page, '#done-result button');
        await page.waitForFunction(() => !JSON.parse(localStorage.getItem('mrt.state.v2')).read[900002]);
        checked(t, `${label}: bounded Done Undo preserves its outcome`, true);
      }
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

export const phoneLayoutScenarios = [phoneBack, phoneContinue, phoneNotices, phoneSearchReflow, phoneCatalogReflow];
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
      for (const action of document.querySelectorAll('#chero-actions > .btn-link')) action.className = 'btn btn-g';
    }),
  },
];
