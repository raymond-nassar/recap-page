import { readFile } from 'node:fs/promises';
import { RECORD_HEADING, RECORD_NOTE } from '../src/js/lib/availability.js';
import { HOME_UPDATES_SEEN_KEY } from '../src/js/lib/homeUpdatesSeen.js';

const APPROVED_NOTICE = 'Read opens a comic directly in the Marvel Comics app. If there\u2019s no direct link, use Find on Marvel Comics to open the website.';

export async function dismissClosureNotice(page, t, { seedFixtureState, click, savedStateDifference }) {
  await localClock(page);
  // A reload resets the injected clock to the day before the cutoff, so a later day that must
  // survive a reload is carried in session storage.
  await page.evaluateOnNewDocument(() => {
    const later = sessionStorage.getItem('marvel-clock');
    if (later) window.__marvelClock = Number(later);
  });
  await seedFixtureState(page);
  await route(page, '#/home', '#view-home:not([hidden])');
  const button = '#reader-closure-dismiss';
  await page.waitForSelector(button, { timeout: 5000 });
  const snapshot = () => page.evaluate(() => ({
    reader: localStorage.getItem('mrt.state.v2'),
    history: localStorage.getItem('mrt.list-history.v1'),
    settings: localStorage.getItem('mrt.settings'),
  }));
  const before = await snapshot();
  const key = 'mrt.readerClosure.dismissed.v1';
  const identity = 'marvel-comics-app-viewer';
  const ax = await page.createCDPSession();
  const { nodes } = await ax.send('Accessibility.getFullAXTree');
  await ax.detach();
  t.check('screen-reader tree names one button without speaking the decorative glyph',
    nodes.filter((node) => !node.ignored && node.role?.value === 'button'
      && node.name?.value === 'Dismiss reading link notice').length === 1);
  t.check('the notice no longer exposes the retired Marvel FAQ link',
    await page.$(button) !== null && await page.$('#reader-closure-faq') === null);
  t.check('the approved notice is announced with the app and Find on Marvel Comics',
    nodes.some((node) => !node.ignored && node.role?.value === 'StaticText'
      && node.name?.value === APPROVED_NOTICE));
  await page.focus(button);
  for (const theme of ['light', 'dark', 'system']) {
    for (const width of [1280, 320]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate((theme) => {
        if (theme === 'system') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.dataset.theme = theme;
      }, theme);
      t.check(`${theme} at ${width}px keeps the corner control clear of the text and inside the notice`,
        await page.$eval(button, (node) => {
          const box = node.getBoundingClientRect(), notice = node.parentElement.getBoundingClientRect();
          const prose = document.createRange();
          prose.selectNodeContents(document.querySelector('#reader-closure-text'));
          return box.left >= notice.left && box.right <= notice.right && box.top >= notice.top
            && box.bottom <= notice.bottom && box.width >= 44 && box.height >= 44
            && [...prose.getClientRects()].every((rect) =>
              rect.right <= box.left || rect.top >= box.bottom || rect.bottom <= box.top)
            && document.documentElement.scrollWidth <= innerWidth;
        }));
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  t.check('reader destination refresh preserves the dismiss control', await page.$(button) !== null);
  await page.focus(button);
  const focus = await page.$eval(button, (node) => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
      width: box.width, height: box.height, hint: node.dataset.tooltip };
  });
  t.check('keyboard focus and target size use shared icon-button conventions',
    focus.ring && focus.width >= 24 && focus.height >= 24 && focus.hint === 'Dismiss reading link notice', JSON.stringify(focus));
  const scroll = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  t.check('Enter hides the notice and orients focus without scrolling', await page.evaluate((y) =>
    document.querySelector('#reader-closure-notice').hidden && document.activeElement.id === 'home-h'
    && scrollY === y, scroll));
  const afterDismissal = await snapshot();
  t.check('dismissal leaves saved reader facts unchanged', JSON.stringify(afterDismissal) === JSON.stringify(before),
    JSON.stringify(savedStateDifference(JSON.stringify(before), JSON.stringify(afterDismissal))));
  await page.reload({ waitUntil: 'load' });
  t.check('dismissal survives reload', await page.$eval('#reader-closure-notice', (node) => node.hidden));
  t.check('the dismissal is remembered under the approved notice identity',
    await page.evaluate((key) => localStorage.getItem(key), key) === identity);
  const shown = () => page.$eval('#reader-closure-notice', (node, text) => !node.hidden
    && node.querySelector('#reader-closure-text').textContent === text, APPROVED_NOTICE);
  // #1601: the notice no longer changes on December 7, 2026, so a dismissal holds across that day.
  await page.evaluate(() => {
    window.__marvelClock = new Date(2026, 11, 7).getTime();
    dispatchEvent(new Event('focus'));
  });
  t.check('a page left open across the old cutoff keeps the dismissed notice hidden',
    await page.$eval('#reader-closure-notice', (node) => node.hidden));
  await page.evaluate(() => sessionStorage.setItem('marvel-clock', String(new Date(2026, 11, 7).getTime())));
  await page.reload({ waitUntil: 'load' });
  t.check('the dismissal still hides the notice after the old cutoff and a reload',
    await page.$eval('#reader-closure-notice', (node) => node.hidden)
    && await page.evaluate((key) => localStorage.getItem(key), key) === identity);
  await page.evaluate(() => sessionStorage.removeItem('marvel-clock'));
  // Both identities the phased notice stored dismissed different words, so neither hides this one.
  for (const legacy of ['marvel-comics-app-unlimited', 'marvel-comics-app-comics']) {
    await page.evaluate((key, value) => localStorage.setItem(key, value), key, legacy);
    await page.reload({ waitUntil: 'load' });
    t.check(`a legacy ${legacy} dismissal cannot hide the approved notice`, await shown());
    t.check('the notice refresh still has no FAQ link', await page.$('#reader-closure-faq') === null);
  }
  await page.evaluate((key) => localStorage.setItem(key, '{malformed'), key);
  await page.reload({ waitUntil: 'load' });
  t.check('malformed dismissal shows the notice', await page.$eval('#reader-closure-notice', (node) => !node.hidden));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.setViewport({ width: 320, height: 900 });
  const largeNoticeFont = await page.evaluate(() => {
    const size = parseFloat(getComputedStyle(document.querySelector('#reader-closure-notice')).fontSize) * 2;
    document.documentElement.style.setProperty('--t-body', `${size}px`);
    return size;
  });
  for (const forced of [true, false]) {
    await media.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    t.check(`320px at 200% text${forced ? ' in forced colors' : ''} wraps below the button without overlap`,
      await page.$eval(button, (node, expectedFont) => {
        const box = node.getBoundingClientRect(), notice = node.parentElement;
        const prose = document.createRange();
        prose.selectNodeContents(document.querySelector('#reader-closure-text'));
        const rects = [...prose.getClientRects()];
        const height = notice.getBoundingClientRect().height;
        const previous = notice.style.paddingInlineEnd;
        notice.style.paddingInlineEnd = 'calc(var(--space-11) + var(--space-5))';
        const columnHeight = notice.getBoundingClientRect().height;
        notice.style.paddingInlineEnd = previous;
        return getComputedStyle(notice).display === 'block'
          && parseFloat(getComputedStyle(notice).fontSize) === expectedFont
          && rects.every((rect) => rect.right <= box.left || rect.top >= box.bottom || rect.bottom <= box.top)
          && rects.some((rect) => rect.top >= box.bottom && rect.right > box.left)
          && height < columnHeight
          && document.documentElement.scrollWidth <= innerWidth;
      }, largeNoticeFont));
  }
  await media.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.focus(button);
  t.check('forced colors retains a visible focus outline', await page.$eval(button, (node) => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  }));
  await media.send('Emulation.setEmulatedMedia', { features: [] });
  await media.detach();
  await page.emulateMediaFeatures([]);
  await page.evaluate(() => document.documentElement.style.removeProperty('--t-body'));
  await page.setViewport({ width: 1280, height: 900 });
  for (const fault of ['read', 'write']) {
    const faulty = await page.browserContext().newPage();
    try {
      await faulty.setViewport({ width: 1280, height: 900 });
      await faulty.evaluateOnNewDocument((key, fault) => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (name) {
          if (name === key && fault === 'read') throw new Error('read refused');
          return get.call(this, name);
        };
        Storage.prototype.setItem = function (name, value) {
          if (name === key && fault === 'write') throw new Error('write refused');
          return set.call(this, name, value);
        };
      }, key, fault);
      await page.evaluate((key, identity) => localStorage.setItem(key, identity), key, identity);
      if (fault === 'write') await page.evaluate((key) => localStorage.removeItem(key), key);
      await faulty.goto(new URL('/#/home', page.url()).href, { waitUntil: 'load' });
      await faulty.waitForSelector(button);
      t.check(`${fault} failure shows the notice`, await faulty.$eval('#reader-closure-notice', (node) => !node.hidden));
      await click(faulty, button);
      t.check(`${fault} failure still dismisses for this page without an alarming notice`,
        await faulty.evaluate(() => document.querySelector('#reader-closure-notice').hidden
          && !document.querySelector('#app-report .notice-error')));
      await faulty.reload({ waitUntil: 'load' });
      t.check(`${fault} failure shows again on reload`, await faulty.$eval('#reader-closure-notice', (node) => !node.hidden));
    } finally { await faulty.close(); }
  }
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await iosClosureTargets(page, t);
  await route(page, '#/about', '#view-about:not([hidden])');
  t.check('About keeps the approved reading-link notice without a cutoff date', await page.$eval('#view-about',
    (node, text) => node.textContent.includes(text) && !node.textContent.includes('December 7, 2026'), APPROVED_NOTICE));
}

async function iosClosureTargets(page, t) {
  const mobile = await readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../packaging/ios/web/ios.css', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../packaging/ios/RecapPage/WebViewController.swift', import.meta.url), 'utf8');
  const adapter = controller.match(/private static let accessibleTargetScript = #"""([\s\S]*?)"""#/)[1];
  const ios = await page.browserContext().newPage();
  try {
    for (const [width, height, largest, theme] of [
      [390, 844, false, 'light'], [390, 844, false, 'dark'],
      [812, 375, true, 'dark'], [844, 390, true, 'light'],
      [844, 390, true, 'dark'], [880, 390, true, 'light'],
    ]) {
      await ios.setViewport({ width, height });
      await ios.goto(new URL('/#/home', page.url()).href, { waitUntil: 'load' });
      await ios.waitForSelector('#reader-closure-notice', { visible: true });
      // The seed's empty first load can remember this batch after the fixture clears that record
      // (#1447). About reveals the real control regardless of that earlier write.
      await route(ios, '#/about', '#view-about:not([hidden])');
      await ios.$eval('#about-whats-new', (node) => node.click());
      await ios.waitForSelector('#view-home:not([hidden])');
      await ios.$eval('#home-updates-close', (node) => node.click());
      await ios.evaluate((styles) => {
        document.adoptedStyleSheets = styles.map((text) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(text);
          return sheet;
        });
      }, [mobile, overlay]);
      await ios.evaluate(({ largest, theme }) => {
        document.documentElement.dataset.iosLargestText = String(largest);
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ios-text-scale', largest ? String(53 / 17) : '1');
      }, { largest, theme });
      await ios.evaluate(adapter);
      await ios.evaluate(() => {
        document.activeElement.blur();
        scrollTo(0, 0);
      });
      const observed = await ios.evaluate((seenKey) => {
        const dismiss = document.querySelector('#reader-closure-dismiss');
        const image = [...document.querySelectorAll('.home-wordmark')].find((node) => node.checkVisibility()).getBoundingClientRect();
        const updates = document.querySelector('#home-updates');
        const toggleNode = document.querySelector('#home-updates-toggle');
        const toggle = toggleNode.getBoundingClientRect();
        const hit = document.elementFromPoint((image.left + image.right) / 2, (image.top + image.bottom) / 2);
        return {
          dismissName: dismiss.getAttribute('aria-label'),
          dismissWidth: dismiss.getBoundingClientRect().width,
          dismissHeight: dismiss.getBoundingClientRect().height,
          noOverlap: toggle.top >= image.bottom,
          updatesVisible: toggleNode.checkVisibility() && toggle.width > 0 && toggle.height > 0,
          updates: {
            hidden: updates.hidden, open: updates.open, display: getComputedStyle(updates).display,
            seen: localStorage.getItem(seenKey), aboutHidden: document.querySelector('#about-whats-new').hidden,
          },
          toggleTop: toggle.top,
          imageBottom: image.bottom,
          boxes: ['.head', '.home-lockup', '#home-h', '#home-updates', '#home-updates-toggle'].map((selector) => {
            const node = document.querySelector(selector);
            const box = node?.getBoundingClientRect();
            return box && [selector, getComputedStyle(node).display, box.left, box.top, box.width, box.height];
          }),
          wordmarks: [...document.querySelectorAll('.home-wordmark')].map((node) => [
            node.currentSrc.split('/').pop(), node.checkVisibility(), node.complete, node.naturalWidth, node.naturalHeight,
            node.getBoundingClientRect().height]),
          imageHit: Boolean(hit?.closest('#home-h')),
          hit: hit?.id || hit?.tagName,
          scrollY,
          hasFocus: document.hasFocus(),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      }, HOME_UPDATES_SEEN_KEY);
      const label = `iOS overlay ${width}x${height} ${largest ? 'largest' : 'default'} ${theme}`;
      t.check(`${label} keeps the reading-link dismissal named and large enough to use`,
        observed.dismissName === 'Dismiss reading link notice'
          && observed.dismissWidth >= 24 && observed.dismissHeight >= 24, JSON.stringify(observed));
      t.check(`${label} stacks updates clear of the wordmark without horizontal overflow`,
        observed.updatesVisible && observed.noOverlap && observed.imageHit && !observed.overflow, JSON.stringify(observed));
    }
  } finally {
    await ios.close();
  }
}

async function localClock(page) {
  await page.evaluateOnNewDocument(() => {
    const Clock = Date;
    window.__marvelClock = new Clock(2026, 11, 6, 23, 59, 59, 999).getTime();
    window.Date = class extends Clock {
      constructor(...args) { super(...(args.length ? args : [window.__marvelClock])); }
      static now() { return window.__marvelClock; }
    };
    window.__marvelOpens = [];
    window.open = (...args) => { window.__marvelOpens.push(args); return null; };
  });
}

async function route(page, hash, selector) {
  await page.evaluate((next) => {
    history.pushState(null, '', next);
    dispatchEvent(new HashChangeEvent('hashchange'));
  }, hash);
  await page.waitForSelector(selector);
}

// #1601: a comic whose only place is its Marvel Comics app link needs no disclosure, because Read
// already goes there. Reading options appear only beside a verified library book.
async function singlePlaceReadingOptions(page, t, { listId, unlinkedId }) {
  await route(page, `#/read/${encodeURIComponent(listId)}`, '#view-read:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#hero-title')?.textContent === 'Linked browser fixture');
  const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  t.check('a comic with only its app link shows Read and no Reading options in the hero',
    await page.evaluate(() => document.querySelector('#hero-reading-options').hidden
      && document.querySelector('#btn-hero-read').textContent === 'Read'
      && document.querySelector('#btn-hero-read').getAttribute('aria-label')
        === 'Read Linked browser fixture in the Marvel Comics app'));
  await page.$eval('#btn-hero-read', (node) => node.click());
  t.check('hero Read opens the bundled viewer in a fresh window',
    await page.evaluate(() => {
      const call = window.__marvelOpens.at(-1), url = new URL(call[0]);
      return url.searchParams.get('a') === '18255' && url.searchParams.get('r') === 'comics'
        && call[1] === '_blank' && call[2] === 'noopener';
    }));
  await page.$eval('#full > summary', (node) => { if (!node.parentElement.open) node.click(); });
  await page.waitForSelector('#rows [data-key="12459"][data-act="more"]');
  t.check('linked and unlinked rows without a library book add no Reading options',
    await page.evaluate((unlinked) => [12459, unlinked].every((id) => document.querySelector(`#rows [data-key="${id}"]`)
      && !document.querySelector(`#rows [data-key="${id}"][data-act="reading-options"]`)), unlinkedId));
  t.check('single-place Read leaves saved data unchanged',
    await page.evaluate((saved) => localStorage.getItem('mrt.state.v2') === saved, before));
}

async function listReadingOptions(page, t, { listId, unlinkedId }) {
  const key = 71308;
  const title = 'Asgardians fixture';
  const heroToggle = '#btn-hero-reading-options';
  const heroList = '#hero-reading-options-list';
  const rowMore = `#rows [data-key="${key}"][data-act="more"]`;
  const rowToggle = `#rows [data-key="${key}"][data-act="reading-options"]`;
  const rowList = `#row-reading-options-list-${key}`;
  const options = ['Marvel Comics app'];
  await route(page, `#/read/${encodeURIComponent(listId)}`, '#view-read:not([hidden])');
  await page.waitForFunction((title) => document.querySelector('#hero-title')?.textContent === title, {}, title);
  const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  t.check('the hero offers a closed Reading options disclosure in its primary actions',
    await page.$eval(heroToggle, (node, title) => !node.parentElement.hidden
      && node.closest('#hero-primary-actions') !== null && !node.closest('[data-tooltip-group]')
      && node.getAttribute('aria-expanded') === 'false'
      && node.getAttribute('aria-controls') === 'hero-reading-options-list'
      && node.getAttribute('aria-label') === `Reading options for ${title}`, title));
  await page.focus(heroToggle);
  await page.keyboard.press('Enter');
  t.check('hero Enter reveals the app choice before the two library books',
    await page.$$eval(`${heroList} button`, (nodes) => nodes.map((node) => node.textContent))
      .then((labels) => JSON.stringify(labels) === JSON.stringify(options))
      && await page.$$eval(`${heroList} li > *`, (nodes) => nodes.map((node) => node.tagName).join() === 'BUTTON,A,A'));
  const ax = await page.createCDPSession();
  async function accessibleButton(selector, name) {
    const { root } = await ax.send('DOM.getDocument');
    const { nodeId } = await ax.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const result = await ax.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return result.nodes.some((node) => !node.ignored && node.role?.value === 'button' && node.name?.value === name);
  }
  t.check('the hero button has its comic-specific name in the browser accessibility tree',
    await accessibleButton(heroToggle, `Reading options for ${title}`));
  await page.keyboard.press('Tab');
  t.check('hero Tab reaches the named Marvel Comics app choice',
    await page.evaluate((title) => document.activeElement?.dataset.readingOption === 'app'
      && document.activeElement.getAttribute('aria-label') === `Read ${title} in the Marvel Comics app`, title));
  await page.keyboard.press('Enter');
  t.check('hero app choice opens the bundled viewer in a fresh window',
    await page.evaluate(() => {
      const call = window.__marvelOpens.at(-1), url = new URL(call[0]);
      return url.searchParams.get('a') === '30068' && call[1] === '_blank' && call[2] === 'noopener';
    }));
  await page.keyboard.press('Tab');
  t.check('hero Tab then reaches the first library book',
    await page.evaluate(() => document.activeElement?.tagName === 'A'
      && document.activeElement.closest('#hero-reading-options-list') !== null));
  await page.keyboard.press('Escape');
  t.check('hero Escape closes the list and returns focus to its button',
    await page.evaluate(() => document.querySelector('#hero-reading-options-list').hidden
      && document.activeElement?.id === 'btn-hero-reading-options'
      && document.activeElement.getAttribute('aria-expanded') === 'false'));
  await page.keyboard.press('Enter');
  await page.focus('#btn-hero-read');
  t.check('leaving the hero disclosure closes it', await page.$eval(heroList, (node) => node.hidden));

  for (const width of [1280, 320, 360]) {
    await page.setViewport({ width, height: 900, isMobile: width === 360, hasTouch: width === 360 });
    await route(page, `#/read/${encodeURIComponent(listId)}`, '#view-read:not([hidden])');
    await page.waitForFunction((title) => document.querySelector('#hero-title')?.textContent === title, {}, title);
    if (await page.$eval(heroList, (node) => node.hidden)) await page.$eval(heroToggle, (node) => node.click());
    const geometry = await page.evaluate(() => {
      const read = document.querySelector('#btn-hero-read').getBoundingClientRect();
      const done = document.querySelector('#btn-hero-done').getBoundingClientRect();
      const nodes = [...document.querySelectorAll('#hero-reading-options button, #hero-reading-options a')];
      const options = nodes[0].getBoundingClientRect();
      const android = Boolean(document.querySelector('link[href="./android/mobile.css"]'));
      return {
        viewport: innerWidth, page: document.documentElement.scrollWidth,
        paired: Math.abs(read.top - done.top) < 1,
        followsPair: options.top >= Math.max(read.bottom, done.bottom) - 1,
        besidePair: options.left >= done.right && options.top < Math.min(read.bottom, done.bottom)
          && options.bottom > Math.max(read.top, done.top),
        controls: nodes.map((node) => ({
          height: node.getBoundingClientRect().height, scroll: node.scrollWidth, client: node.clientWidth,
        })),
        minimum: android ? 48 : 44,
      };
    });
    t.check(`hero options fit at ${width}px and follow Read and Done on phones`,
      geometry.controls.length === 4 && geometry.page <= geometry.viewport
        && (width > 700 ? geometry.besidePair : geometry.followsPair && (width < 360 || geometry.paired))
        && geometry.controls.every((node) => node.height >= geometry.minimum && node.scroll <= node.client),
      JSON.stringify(geometry));
    await page.$eval(heroToggle, (node) => node.click());
  }

  await page.$eval('#full > summary', (node) => { if (!node.parentElement.open) node.click(); });
  await page.waitForSelector(rowMore);
  await page.focus(rowMore);
  await page.keyboard.press('Enter');
  await page.waitForSelector(rowToggle, { visible: true });
  t.check('row Reading options belongs to its Open group and starts closed',
    await page.$eval(rowToggle, (node, title) => node.closest('[role="group"]')?.getAttribute('aria-label') === 'Open'
      && node.getAttribute('aria-label') === `Reading options for ${title}`
      && node.getAttribute('aria-controls') === 'row-reading-options-list-71308'
      && node.getAttribute('aria-expanded') === 'false', title));
  t.check('the row button has its comic-specific name in the browser accessibility tree',
    await accessibleButton(rowToggle, `Reading options for ${title}`));
  await ax.detach();
  await page.focus(rowToggle);
  await page.keyboard.press('Enter');
  t.check('row Enter reveals the same ordered options',
    await page.$$eval(`${rowList} button`, (nodes) => nodes.map((node) => node.textContent))
      .then((labels) => JSON.stringify(labels) === JSON.stringify(options))
      && await page.$$eval(`${rowList} a`, (nodes) => nodes.length === 2));
  await page.keyboard.press('Tab');
  t.check('row Tab reaches the comic-specific app choice',
    await page.evaluate((title) => document.activeElement?.dataset.readingOption === 'app'
      && document.activeElement.getAttribute('aria-label') === `Read ${title} in the Marvel Comics app`, title));
  await page.evaluate(() => {
    window.__marvelClock = new Date(2026, 11, 5, 12).getTime();
    dispatchEvent(new Event('focus'));
  });
  t.check('a row rebuild keeps both disclosures open and preserves the focused choice',
    await page.evaluate(() => document.activeElement?.dataset.readingOption === 'app'
      && document.querySelector('#rows [data-key="71308"][data-act="reading-options"]').getAttribute('aria-expanded') === 'true'
      && document.querySelector('#rows [data-key="71308"][data-act="more"]').getAttribute('aria-expanded') === 'true'));
  await page.keyboard.press('Escape');
  t.check('the first Escape closes only the nested disclosure and restores its toggle',
    await page.evaluate(() => document.querySelector('#row-reading-options-list-71308').hidden
      && document.activeElement?.dataset.act === 'reading-options'
      && document.querySelector('#rows [data-key="71308"][data-act="more"]').getAttribute('aria-expanded') === 'true'));
  await page.keyboard.press('Escape');
  t.check('the second Escape closes More actions and restores its button',
    await page.evaluate(() => document.activeElement?.dataset.act === 'more'
      && document.activeElement?.dataset.key === '71308'
      && document.activeElement.getAttribute('aria-expanded') === 'false'));
  await page.$eval(rowMore, (node) => node.click());
  await page.focus(rowToggle);
  await page.keyboard.press('Enter');
  await page.focus(`${rowList} [data-reading-option="app"]`);
  await page.keyboard.press('Enter');
  t.check('row app choice opens the bundled viewer', await page.evaluate(() => {
    const url = new URL(window.__marvelOpens.at(-1)[0]);
    return url.searchParams.get('a') === '30068' && url.searchParams.get('r') === 'comics';
  }));
  await page.focus('#rows [data-key="71308"][data-act="info"]');
  t.check('moving within More actions closes only Reading options', await page.evaluate(() =>
    document.querySelector('#row-reading-options-list-71308').hidden
      && document.querySelector('#rows [data-key="71308"][data-act="more"]').getAttribute('aria-expanded') === 'true'));
  t.check('rows without a library book, shelf tiles and the Continue card add no Reading options',
    await page.evaluate((unlinked) => [12459, unlinked].every((id) => !document.querySelector(`#rows [data-key="${id}"][data-act="reading-options"]`))
      && !document.querySelector('#shelf .reading-options, #home-continue .reading-options'), unlinkedId));
  t.check('list options and handoffs preserve saved data',
    await page.evaluate((saved) => localStorage.getItem('mrt.state.v2') === saved, before));
  await page.evaluate(() => {
    window.__marvelClock = new Date(2026, 11, 6, 12).getTime();
    dispatchEvent(new Event('focus'));
  });
  await page.setViewport({ width: 1280, height: 900 });
}

// The note sits inside the record's term so it is read with its label, and there it took on the
// label's capitals (#978). Edge put those capitals in the accessibility tree as well, so the
// rendered text and the term's accessible name are both read here, not only the computed style.
async function recordNote(page, t, facts) {
  const seen = await page.$eval(facts, (node) => {
    const term = node.querySelector('dt');
    const note = term.querySelector('.rail-hint');
    const label = getComputedStyle(term), sentence = getComputedStyle(note);
    return {
      label: [term.firstChild.textContent, label.textTransform],
      note: [note.innerText, sentence.textTransform, sentence.letterSpacing, sentence.fontWeight],
    };
  });
  t.check(`${facts} keeps the record label in capitals and sets its note as a sentence`,
    JSON.stringify(seen) === JSON.stringify({
      label: [RECORD_HEADING, 'uppercase'], note: [RECORD_NOTE, 'none', 'normal', '400'],
    }), JSON.stringify(seen));
  const ax = await page.createCDPSession();
  const { nodes } = await ax.send('Accessibility.getFullAXTree');
  await ax.detach();
  const terms = nodes.filter((node) => !node.ignored && node.role?.value === 'term'
    && node.name?.value?.toLowerCase().startsWith(RECORD_HEADING.toLowerCase()));
  t.check(`${facts} names the record's term with its label and then the note as a sentence`,
    terms.length === 1 && terms[0].name.value === `${RECORD_HEADING.toUpperCase()} ${RECORD_NOTE}`,
    JSON.stringify(terms.map((node) => node.name.value)));
}

export async function linkedReadingOptions(page, t, { listId, sourceIssueId }) {
  // Once the MU-number route was approved, every comic of the Android reading list gained an app
  // link, so the unlinked row is a negative stand-in, which can never carry one.
  const unlinkedId = -950950;
  await localClock(page);
  await page.evaluate(({ listId, sourceIssueId, unlinkedId }) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    state.issues[12459] = {
      ...state.issues[sourceIssueId], issueId: 12459, title: 'Linked browser fixture',
      digitalId: 700001, url: 'https://www.marvel.com/comics/issue/12459/fixture',
    };
    state.issues[unlinkedId] = { ...state.issues[sourceIssueId], issueId: unlinkedId, title: 'Unlinked browser fixture' };
    state.lists[listId].itemIds = [12459, unlinkedId,
      ...state.lists[listId].itemIds.filter((id) => id !== 12459 && id !== unlinkedId)];
    delete state.read[12459];
    delete state.read[unlinkedId];
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, { listId, sourceIssueId, unlinkedId });
  await page.reload({ waitUntil: 'load' });
  await singlePlaceReadingOptions(page, t, { listId, unlinkedId });
  await route(page, '#/issue/12459', '#issue-focus-card:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#issue-focus-h').textContent === 'Linked browser fixture');
  const saved = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  const toggle = '#btn-issue-reading-options';
  const list = '#issue-reading-options-list';
  const read = '#btn-issue-read';
  t.check('a comic whose only place is its app link needs no disclosure on Comic details',
    await page.$eval('#issue-reading-options', (node) => node.hidden));
  await page.$eval(read, (node) => node.click());
  t.check('Read opens the linked comic through the synchronous app launcher',
    await page.evaluate(() => {
      const url = new URL(window.__marvelOpens.at(-1)[0]);
      return url.searchParams.get('a') === '18255' && url.searchParams.get('r') === 'comics';
    }));
  t.check('single-place Comic details Read leaves saved data unchanged',
    await page.evaluate((before) => localStorage.getItem('mrt.state.v2') === before, saved));

  await page.evaluate(({ listId, sourceIssueId }) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    state.issues[71308] = {
      ...state.issues[sourceIssueId], issueId: 71308, seriesId: 25996, number: '1',
      title: 'Asgardians fixture', url: 'https://www.marvel.com/comics/issue/71308/fixture',
    };
    state.lists[listId].catalogId = 'nebula-reading-order';
    state.lists[listId].itemIds = [71308, ...state.lists[listId].itemIds.filter((id) => id !== 71308)];
    delete state.read[71308];
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, { listId, sourceIssueId });
  await page.reload({ waitUntil: 'load' });
  await listReadingOptions(page, t, { listId, unlinkedId });
  await route(page, `#/issue/71308?list=${encodeURIComponent(listId)}`, '#issue-focus-card:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#issue-focus-h').textContent === 'Asgardians fixture');
  const linkedSaved = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  t.check('a linked comic with library books offers Reading options with the list initially closed',
    await page.evaluate(() => {
      const button = document.querySelector('#btn-issue-reading-options');
      return !button.parentElement.hidden && button.getAttribute('aria-expanded') === 'false'
        && button.getAttribute('aria-controls') === 'issue-reading-options-list'
        && document.querySelector('#issue-reading-options-list').hidden;
    }));
  await page.focus(toggle);
  await page.keyboard.press('Enter');
  t.check('keyboard opens the app option before the library books',
    await page.$$eval(`${list} button`, (buttons) => (
      JSON.stringify(buttons.map((button) => button.textContent)) === JSON.stringify(['Marvel Comics app'])
    )) && await page.$$eval(`${list} a`, (links) => links.length === 2)
      && await page.$eval(toggle, (node) => node.getAttribute('aria-expanded') === 'true'));
  await page.keyboard.press('Tab');
  t.check('Tab reaches the first option with a comic-specific accessible name',
    await page.evaluate(() => document.activeElement?.dataset.readingOption === 'app'
      && document.activeElement.getAttribute('aria-label') === 'Read Asgardians fixture in the Marvel Comics app'));
  await page.keyboard.press('Escape');
  t.check('Escape closes Reading options and returns focus to its button',
    await page.evaluate(() => document.querySelector('#issue-reading-options-list').hidden
      && document.activeElement?.id === 'btn-issue-reading-options'
      && document.activeElement.getAttribute('aria-expanded') === 'false'));
  await page.keyboard.press('Enter');
  await page.$eval(`${list} [data-reading-option="app"]`, (node) => node.click());
  t.check('choosing the app option opens the bundled viewer',
    await page.evaluate(() => {
      const url = new URL(window.__marvelOpens.at(-1)[0]);
      return url.searchParams.get('a') === '30068' && url.searchParams.get('r') === 'comics';
    }));
  await page.focus(read);
  t.check('moving focus outside closes the disclosure', await page.$eval(list, (node) => node.hidden));
  for (const width of [320, 360]) {
    await page.setViewport({ width, height: 800, isMobile: width === 360, hasTouch: width === 360 });
    await page.$eval(toggle, (node) => node.click());
    t.check(`Reading options fit at ${width}px with full-size targets`, await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#issue-reading-options button')];
      return document.documentElement.scrollWidth <= innerWidth
        && nodes.every((node) => node.getBoundingClientRect().height >= 44);
    }));
    await page.$eval(toggle, (node) => node.click());
  }
  t.check('Reading options and the app handoff leave saved data unchanged',
    await page.evaluate((before) => localStorage.getItem('mrt.state.v2') === before, linkedSaved));
  await page.setViewport({ width: 1280, height: 900 });
  await page.$eval(toggle, (node) => node.click());
  const title = 'Asgardians of the Galaxy Vol. 1: The Infinity Armada';
  t.check('library options visibly name their book and retain their accessible labels',
    await page.$$eval(`${list} a`, (links, title) => links.length === 2
      && links.every((link, index) => {
        const label = `Look for ${title} ${index === 0 ? 'on Hoopla' : 'in Libby'}`;
        const spoken = label.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return link.textContent === label
          && link.getAttribute('aria-label') === `${spoken}: opens outside Recap Page`;
      }), title));
  for (const width of [320, 360]) {
    await page.setViewport({ width, height: 800, isMobile: width === 360, hasTouch: width === 360 });
    await page.waitForFunction(() => document.querySelector('#issue-focus-h')?.textContent === 'Asgardians fixture'
      && !document.querySelector('#issue-reading-options')?.hidden);
    if (await page.$eval(list, (node) => node.hidden)) await page.$eval(toggle, (node) => node.click());
    await page.waitForFunction(() => !document.querySelector('#issue-reading-options-list')?.hidden);
    const geometry = await page.evaluate(() => {
      const links = [...document.querySelectorAll('#issue-reading-options-list a')];
      return {
        viewport: innerWidth, page: document.documentElement.scrollWidth,
        links: links.map((link) => ({
          height: link.getBoundingClientRect().height, scroll: link.scrollWidth, client: link.clientWidth,
        })),
      };
    });
    t.check(`long library book labels fit at ${width}px with full-size targets`,
      geometry.links.length === 2 && geometry.page <= geometry.viewport
        && geometry.links.every((link) => link.height >= 44 && link.scroll <= link.client),
      JSON.stringify(geometry));
  }
  await route(page, `#/read/${encodeURIComponent(listId)}`, '#view-read:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#hero-title')?.textContent === 'Asgardians fixture');
  await page.$eval('#full > summary', (node) => { if (!node.parentElement.open) node.click(); });
  const rowToggle = '#rows [data-key="71308"][data-act="reading-options"]';
  await page.waitForSelector('#rows [data-key="71308"][data-act="more"]');
  await page.$eval('#rows [data-key="71308"][data-act="more"]', (node) => node.click());
  for (const [label, toggle, list] of [
    ['hero', '#btn-hero-reading-options', '#hero-reading-options-list'],
    ['row', rowToggle, '#row-reading-options-list-71308'],
  ]) {
    await page.waitForSelector(toggle, { visible: true });
    await page.$eval(toggle, (node) => node.click());
    t.check(`${label} options use the saved list's verified library book`,
      await page.$$eval(`${list} a`, (links, title) => links.length === 2
        && links.every((link, index) => {
          const text = `Look for ${title} ${index === 0 ? 'on Hoopla' : 'in Libby'}`;
          const spoken = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          return link.textContent === text && link.getAttribute('aria-label') === `${spoken}: opens outside Recap Page`
            && link.target === '_blank' && link.rel === 'noopener noreferrer'
            && link.referrerPolicy === 'no-referrer';
        }), title));
    const geometry = await page.evaluate((selector) => ({
      viewport: innerWidth, page: document.documentElement.scrollWidth,
      minimum: document.querySelector('link[href="./android/mobile.css"]') ? 48 : 44,
      links: [...document.querySelectorAll(`${selector} a`)].map((link) => ({
        height: link.getBoundingClientRect().height, scroll: link.scrollWidth, client: link.clientWidth,
      })),
    }), list);
    t.check(`${label} long book labels wrap at 360px without overflow`,
      geometry.links.length === 2 && geometry.page <= geometry.viewport
        && geometry.links.every((link) => link.height >= geometry.minimum && link.scroll <= link.client),
      JSON.stringify(geometry));
  }
  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', { features: [
    { name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--t-caption', '24px');
    document.documentElement.style.setProperty('--t-body', '32px');
    document.documentElement.style.setProperty('--t-body-lg', '36px');
  });
  for (const [label, toggle, list] of [
    ['hero', '#btn-hero-reading-options', '#hero-reading-options-list'],
    ['row', rowToggle, '#row-reading-options-list-71308'],
  ]) {
    if (await page.$eval(list, (node) => node.hidden)) await page.$eval(toggle, (node) => node.click());
    await page.focus(toggle);
    await page.keyboard.press('Tab');
    const accessible = await page.evaluate((selector) => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return {
        viewport: innerWidth, page: document.documentElement.scrollWidth,
        minimum: document.querySelector('link[href="./android/mobile.css"]') ? 48 : 44,
        focus: active?.dataset.readingOption, outline: style.outlineStyle, width: parseFloat(style.outlineWidth),
        links: [...document.querySelectorAll(`${selector} a`)].map((link) => ({
          height: link.getBoundingClientRect().height, scroll: link.scrollWidth, client: link.clientWidth,
        })),
      };
    }, list);
    t.check(`${label} options remain readable and keyboard focus is visible with large text and forced colors`,
      accessible.viewport >= accessible.page && accessible.focus === 'app'
        && accessible.outline !== 'none' && accessible.width >= 2
        && accessible.links.length === 2
        && accessible.links.every((link) => link.height >= accessible.minimum && link.scroll <= link.client),
      JSON.stringify(accessible));
  }
  await page.evaluate(() => {
    for (const name of ['--t-caption', '--t-body', '--t-body-lg']) document.documentElement.style.removeProperty(name);
  });
  await media.send('Emulation.setEmulatedMedia', { features: [] });
  await media.detach();
  await page.evaluate(() => {
    window.__marvelClock = new Date(2026, 11, 7).getTime();
    dispatchEvent(new Event('focus'));
  });
  t.check('a later date keeps both list placements on the app and verified library choices',
    await page.evaluate(() => ['#hero-reading-options-list', '#row-reading-options-list-71308'].every((selector) => {
      const list = document.querySelector(selector);
      return list && list.querySelector('[data-reading-option="app"]') && list.querySelectorAll('a').length === 2;
    })));
}

export async function retiredReaderHelp(page, t, { seedFixtureState, click, openFullOrder, order, savedStateDifference }) {
  await localClock(page);
  await seedFixtureState(page);
  // Startup saves the seeded issues without their old descriptions after the tab lock answers.
  // Delaying that answer 1.5 s reproduced #1278's comparison failure before any handoff.
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('mrt.state.v2')).issues)
    .every((issue) => !Object.prototype.hasOwnProperty.call(issue, 'description')));
  const first = order.items[0];
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
  // #1601: these fixture comics have no Marvel Comics app link, so every placement offers the
  // website before and after the former December 7, 2026 cutoff alike.
  const read = async (selector) => {
    const label = await page.$eval(selector, (node) => ({ text: node.textContent, name: node.getAttribute('aria-label') }));
    t.check(`${selector} names the website as its visible and accessible destination`,
      label.text === 'Find on Marvel Comics' && label.name.includes('not a single-comic link'), JSON.stringify(label));
    await click(page, selector);
    const opened = await page.evaluate(() => window.__marvelOpens.at(-1));
    const query = new URL(opened[0]).searchParams;
    t.check(`${selector} selects the website before a fresh noopener window`,
      query.get('r') === 'comics' && !query.has('a') && !query.has('d') && !query.has('i')
        && opened[1] === '_blank' && opened[2] === 'noopener',
      JSON.stringify(opened));
  };
  for (const date of ['before', 'after']) {
    if (date === 'after') {
      await page.evaluate(() => {
        window.__marvelClock = new Date(2026, 11, 7).getTime();
        dispatchEvent(new Event('focus'));
      });
    }
    await route(page, '#/home', '#view-home:not([hidden])');
    await read('#btn-chero-read');
    t.check(`Home shows the approved notice without the old FAQ ${date} the former cutoff`, await page.$eval('#reader-closure-notice',
      (node, text) => node.querySelector('#reader-closure-text').textContent === text
        && node.querySelector('#reader-closure-dismiss').getAttribute('aria-label') === 'Dismiss reading link notice'
        && !node.querySelector('#reader-closure-faq'), APPROVED_NOTICE));
    await route(page, '#/read/fixture', '#view-read:not([hidden])');
    await read('#btn-hero-read');
    await openFullOrder(page);
    const more = `#rows [data-key="${first.issueId}"][data-act="more"]`;
    if (await page.$eval(more, (node) => node.getAttribute('aria-expanded') !== 'true')) await click(page, more);
    await read(`#rows [data-key="${first.issueId}"][data-act="open"]`);
    const shelf = '#shelf [data-act="open"]';
    await read(shelf);
    await route(page, `#/issue/${first.issueId}`, '#issue-focus-card:not([hidden])');
    await read('#btn-issue-read');
    await click(page, '#reader-link-heading');
    t.check('reader help exposes no retired editor or report action', await page.evaluate(() => (
      !document.querySelector('[id^="reader-link-"] input, #reader-link-form, #reader-link-edit, #reader-link-reportLink')
      && document.querySelector('#reader-link-summary').textContent.length > 0
    )));
  }
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
  const savedFacts = (state) => JSON.stringify({ issues: state.issues, read: state.read, overrides: state.overrides });
  t.check('all handoffs leave saved references, overrides and reading progress unchanged',
    savedFacts(before) === savedFacts(after), JSON.stringify(savedStateDifference(savedFacts(before), savedFacts(after))));
  await page.setViewport({ width: 390, height: 900 });
  t.check('the website action and historical facts stay inside the phone viewport', await page.evaluate(() => {
    const node = document.querySelector('#btn-issue-read');
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  }));
  await page.setViewport({ width: 1280, height: 900 });
  await recordNote(page, t, '#issue-focus-facts');
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  t.check('#1061 the reading card leaves the record to Comic details', await page.$eval('#hero-facts',
    (node, heading) => !node.textContent.includes(heading), RECORD_HEADING));
  const historical = [
    'No recorded Unlimited date',
    'Unlimited date: 2027-01-01 (future)',
    'Unlimited date: 2026-01-01 (passed)',
    'You marked it available in Unlimited',
    'You marked it unavailable in Unlimited',
  ];
  await page.evaluate((ids) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    while (ids.length < 5) {
      const id = 900000090 + ids.length;
      state.issues[id] = { ...state.issues[ids[0]], issueId: id, title: `Historical state ${ids.length + 1}` };
      state.lists.fixture.itemIds.push(id);
      ids.push(id);
    }
    ids.forEach((id, index) => {
      state.issues[id].mu = index === 1 ? '2027-01-01' : index === 2 ? '2026-01-01' : null;
      delete state.overrides[id];
      if (index >= 3) state.overrides[id] = index === 3 ? 'available' : 'unavailable';
    });
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, order.items.slice(0, 5).map((item) => item.issueId));
  await page.reload({ waitUntil: 'load' });
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  await openFullOrder(page);
  const labels = await page.$$eval('#rows .availability-record', (nodes) => nodes.slice(0, 5).map((node) => node.textContent));
  t.check('all five full historical states use the exact approved distinct labels',
    JSON.stringify(labels) === JSON.stringify(historical), JSON.stringify(labels));
  const ax = await page.createCDPSession();
  const tree = await ax.send('Accessibility.getFullAXTree');
  for (const label of historical) {
    t.check(`browser accessibility tree distinguishes ${label}`,
      tree.nodes.some((node) => !node.ignored && node.name?.value === label));
  }
  await ax.detach();
  for (const width of [640, 390]) {
    await page.setViewport({ width, height: 900 });
    t.check(`historical labels wrap without page overflow at ${width}px`, await page.evaluate(() => (
      document.documentElement.scrollWidth <= innerWidth
      && [...document.querySelectorAll('#rows .availability-record')].slice(0, 5).every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
      })
    )));
  }
  await page.setViewport({ width: 1280, height: 900 });
  await linkedReadingOptions(page, t, { listId: 'fixture', sourceIssueId: first.issueId });
}

export async function manualLinkFeedback(page, t, { addByHand, manualReport, readState }) {
  const before = await readState(page);
  await addByHand(page, 'Secret Wars (2015) #1', 'https://www.marvel.com/comics/issue/52447/secret_wars');
  const linkedReport = await manualReport(page);
  const after = await readState(page);
  t.check('a comic details URL still saves without inventing a reader reference',
    after?.issues?.['52447']?.url.includes('/comics/issue/52447')
      && after.issues['52447'].digitalId == null, JSON.stringify(after?.issues?.['52447']));
  t.check('the saved linked comic receives the app explanation instead of the older reference note',
    linkedReport.includes('Read opens this comic in the Marvel Comics app. It does not mark the comic read.')
      && !linkedReport.includes('Read uses the recorded comic reference.'), linkedReport);
  t.check('adding the linked comic does not change read markers or availability overrides',
    JSON.stringify(after?.read ?? {}) === JSON.stringify(before?.read ?? {})
      && JSON.stringify(after?.overrides ?? {}) === JSON.stringify(before?.overrides ?? {}));

  await addByHand(page, 'Unlinked fixture', 'https://www.marvel.com/comics/issue/129648/fixture');
  const unlinkedReport = await manualReport(page);
  const unlinked = await readState(page);
  t.check('an unlinked comic details URL still saves without a Read explanation',
    Boolean(unlinked?.issues?.['129648']) && unlinkedReport.includes('Added')
      && !unlinkedReport.includes('Read opens this comic')
      && !unlinkedReport.includes('Read uses the recorded comic reference.'), unlinkedReport);
}

export async function retiredManualLink(page, t, { open, click, addByHand, manualReport, readState }) {
  await open(page, '/');
  await click(page, '[data-view="add-manual"]');
  const before = await readState(page);
  await addByHand(page, 'Old reader comic', 'https://read.marvel.com/#/book/129648');
  t.check('reader paste is explicitly refused', /reader links are no longer accepted/.test(await manualReport(page)));
  t.check('the invalid URL and title remain, with an associated focused field error', await page.evaluate(() => {
    const field = document.querySelector('#manual-url');
    return field.value === 'https://read.marvel.com/#/book/129648'
      && field.getAttribute('aria-invalid') === 'true' && document.activeElement === field
      && field.getAttribute('aria-describedby').includes('manual-url-hint')
      && field.closest('details').open && document.querySelector('#manual-title').value === 'Old reader comic';
  }));
  const refused = await readState(page);
  t.check('refused reader paste writes no comic or list', JSON.stringify(refused) === JSON.stringify(before));
  await page.$eval('#manual-url', (node) => node.dispatchEvent(new Event('input', { bubbles: true })));
  await manualLinkFeedback(page, t, { addByHand, manualReport, readState });
}

export async function legacyReaderBackup(page, t, { seedFixtureState, click, openFullOrder, readerId, digitalId }) {
  await localClock(page);
  await seedFixtureState(page);
  await page.evaluate((id, book) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    state.issues[id] = { issueId: id, title: 'Legacy reader comic #1', digitalId: book, url: null, source: 'manual', hydrated: true, mu: '2026-01-01' };
    state.lists.fixture.itemIds = [id];
    state.lists.fixture.collectedIn = { [id]: 'Saved section' };
    state.read[id] = 1234;
    state.overrides[id] = 'unavailable';
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, readerId, digitalId);
  await page.reload({ waitUntil: 'load' });
  const backup = await page.evaluate(async () => {
    const { exportBackup } = await import('/js/lib/model.js');
    return JSON.stringify(exportBackup(JSON.parse(localStorage.getItem('mrt.state.v2'))));
  });
  await route(page, '#/data', '#view-data:not([hidden])');
  await page.evaluate((raw) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([raw], 'legacy-json-backup.json', { type: 'application/json' }));
    const input = document.querySelector('#restore-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, backup);
  await page.waitForSelector('#ask[open]');
  await click(page, '#ask-ok');
  await page.waitForFunction(() => /Reading data restored/.test(document.querySelector('#restore-report').textContent));
  t.check('JSON restore preserves legacy identity, digital ID, date, read mark, override and section', await page.evaluate((id, book) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return state.issues[id].issueId === id && state.issues[id].digitalId === book
      && state.issues[id].mu === '2026-01-01' && state.read[id] === 1234
      && state.overrides[id] === 'unavailable' && state.lists.fixture.collectedIn[id] === 'Saved section';
  }, readerId, digitalId));
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  await openFullOrder(page);
  await click(page, '#list-export > summary');
  await click(page, '#btn-export-md');
  await page.waitForSelector('#markdown-export[open]');
  for (const name of ['includeLinks', 'includeSections']) {
    const selector = `#markdown-export input[name="${name}"]`;
    if (!await page.$eval(selector, (node) => node.checked)) await click(page, selector);
  }
  await click(page, '#markdown-export button[type="submit"]');
  await page.waitForFunction(() => (window.__mrtDownloads ?? []).length > 0);
  const markdown = await page.evaluate(() => window.__mrtDownloads.at(-1).text);
  t.check('historical Markdown export keeps the canonical recorded link',
    markdown.includes(`https://read.marvel.com/#/book/${digitalId}`) && markdown.includes('[x]'));
  await route(page, '#/add-import', '#view-add-import:not([hidden])');
  await page.evaluate((text) => {
    document.querySelector('#import-text').value = text;
    document.querySelector('#import-new-list').checked = true;
    document.querySelector('#form-import').requestSubmit();
  }, markdown);
  await page.waitForFunction(() => document.querySelector('#import-report').textContent.includes('reader links are no longer accepted'));
  t.check('previously exported reader rows remain explicit review positions with title and read mark', await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('mrt.import.draft.v1'));
    const row = draft.occurrences[0];
    return row.title === 'Legacy reader comic #1' && row.read && row.index === 0 && row.issueId == null
      && row.section === 'Saved section' && document.querySelector('#import-report').textContent.includes('Find match');
  }));
}
