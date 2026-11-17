// #1412 mechanism 2: Home invites a Windows reader in Edge or Chrome to install Recap Page as an app,
// and tells a Firefox reader where it can be done. Nothing is installed here: the browser's offer is a
// synthetic beforeinstallprompt that settles after rendered frames, as Edge's own dialog does, and the
// browser is told which brands it is through user agent client hints. preparePage serves install.js
// with its fixed origin replaced by this ephemeral one, so the reading progress saved at :8787 is
// never touched.
const TITLE = 'Install Recap Page as an app';
const TEXT = 'Open Recap Page in its own window from the Start menu. Your saved progress stays where it is.';
const NOTICE = 'To use Recap Page in its own window, install it in Microsoft Edge or Chrome. Your saved progress stays in this browser. To use it in another browser, first export a backup here and then restore it there.';
const KEY = 'mrt.appWindowInvitation.dismissed.v1';
const EDGE_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
const FIREFOX_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
const EDGE_BRANDS = [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Microsoft Edge', version: '142' }, { brand: 'Chromium', version: '142' }];

async function identify(page, userAgent, brands) {
  page.__uaSession ??= await page.createCDPSession();
  await page.__uaSession.send('Emulation.setUserAgentOverride', {
    userAgent,
    userAgentMetadata: { brands, platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false },
  });
}

const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// A fresh Home with the saved answer and theme given, then the browser's install offer.
async function load(page, { answer = null, theme = 'light', width = 1280, offer = true } = {}) {
  await page.setViewport({ width, height: 900 });
  await page.goto('about:blank');
  const { identifier } = await page.evaluateOnNewDocument((key, value, chosen) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      localStorage.setItem('mrt.settings', JSON.stringify({ theme: chosen }));
    } catch { /* about:blank has no storage of its own */ }
  }, KEY, answer, theme);
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
  await page.removeScriptToEvaluateOnNewDocument(identifier);
  await page.waitForSelector('#home-h');
  await settle(page);
  if (offer) {
    await page.evaluate(() => {
      const frames = () => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)));
      });
      const event = new Event('beforeinstallprompt', { cancelable: true });
      let choose;
      event.userChoice = new Promise((resolve) => { choose = resolve; });
      event.prompt = () => frames().then(frames).then(() => choose({ outcome: 'dismissed' }));
      window.dispatchEvent(event);
    });
    await settle(page);
  }
}

// What a reader sees of the invitation or notice: its words, whether it fits, and its controls' reach.
function layout(page, id) {
  return page.evaluate((target) => {
    const root = document.getElementById(target);
    const box = root.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button')].map((button) => {
      const b = button.getBoundingClientRect();
      return { id: button.id, text: button.textContent.trim(), name: button.getAttribute('aria-label'), width: b.width, height: b.height,
        inside: b.left >= box.left - 0.5 && b.right <= box.right + 0.5 && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5,
        fits: button.scrollWidth <= button.clientWidth };
    });
    return {
      hidden: root.hidden, visible: box.height > 0,
      title: root.querySelector('h2')?.textContent ?? null,
      text: (root.querySelector('p') ?? root.querySelector('span'))?.textContent ?? null,
      controls, pageFits: document.documentElement.scrollWidth <= innerWidth,
      afterClosure: document.getElementById('reader-closure-notice').compareDocumentPosition(root) === Node.DOCUMENT_POSITION_FOLLOWING,
      // A line of text running under a control is text the reader cannot read.
      textClear: (() => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const buttons = [...root.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim() || node.parentElement.closest('button')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const clear = [...range.getClientRects()].every((line) => buttons.every((b) => line.right <= b.left + 0.5
            || line.left >= b.right - 0.5 || line.bottom <= b.top + 0.5 || line.top >= b.bottom - 0.5));
          if (!clear) return false;
        }
        return true;
      })(),
    };
  }, id);
}

function focusRing(page, id) {
  return page.evaluate((target) => {
    const node = document.getElementById(target);
    const style = getComputedStyle(node);
    return { focused: document.activeElement === node, visible: node.matches(':focus-visible'),
      outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
      distinct: style.color !== style.backgroundColor };
  }, id);
}

// Keyboard focus, so :focus-visible reflects a reader moving by Tab rather than a script.
async function keyboardFocus(page, selector) {
  await page.focus(selector);
  await page.keyboard.press('Tab');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
}

const answer = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const active = (page) => page.evaluate(() => document.activeElement?.id ?? null);

const replaceOnce = (source, from, to) => {
  if (!source.includes(from)) throw new Error(`mutation target missing: ${from}`);
  return source.replace(from, to);
};

export const appWindowInvitationMutations = [
  {
    id: 'app-window-answer-strands-focus',
    breaks: 'app-window-invitation',
    why: 'answering the invitation or notice leaves keyboard focus on a control that has just been hidden',
    rewriteInstall: (source) => replaceOnce(source, 'function toHome(control) {', 'function toHome(control) { return;'),
  },
  {
    id: 'app-window-firefox-unexplained',
    breaks: 'app-window-invitation',
    why: 'Firefox on Windows is no longer told where the app window can be installed',
    rewriteInstall: (source) => replaceOnce(source, "return 'unsupported';", "return 'other';"),
  },
  {
    id: 'app-window-notice-under-dismiss',
    breaks: 'app-window-invitation',
    why: 'the notice text no longer reserves room for its dismiss control and runs underneath it',
    rewriteStyles: (source) => replaceOnce(source, ':is(#reader-closure-text, #app-window-notice-text)::before', '#reader-closure-text::before'),
  },
];

export const appWindowInvitation = {
  id: 'app-window-invitation',
  title: 'Home invites Edge and Chrome on Windows to install the app window, and tells Firefox where it can be',
  async run(page, t) {
    await identify(page, EDGE_AGENT, EDGE_BRANDS);
    for (const width of [1280, 360]) {
      for (const theme of ['light', 'dark']) {
        await load(page, { width, theme });
        const shown = await layout(page, 'app-window-invitation');
        t.check(`${width}px ${theme}: Edge on Windows is invited below the reader notice, in the approved words`,
          !shown.hidden && shown.visible && shown.afterClosure && shown.title === TITLE && shown.text === TEXT
            && shown.controls.map(({ text }) => text).join('|') === 'Install Recap Page|Not now',
          JSON.stringify(shown));
        t.check(`${width}px ${theme}: the invitation and its controls fit, each at least a 24px target`,
          shown.pageFits && shown.textClear && shown.controls.every(({ width: w, height, inside, fits }) => w >= 24 && height >= 24 && inside && fits),
          JSON.stringify(shown));
        for (const control of ['btn-invitation-install', 'btn-invitation-later']) {
          await keyboardFocus(page, `#${control}`);
          const ring = await focusRing(page, control);
          t.check(`${width}px ${theme}: ${control} shows a keyboard focus ring`,
            ring.focused && ring.visible && ring.outline && ring.distinct, JSON.stringify(ring));
        }
      }
    }

    await load(page);
    await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
    await keyboardFocus(page, '#btn-invitation-install');
    const forced = await focusRing(page, 'btn-invitation-install');
    t.check('forced colors keep the invitation\'s install control legible and its focus visible',
      forced.focused && forced.visible && forced.outline && forced.distinct, JSON.stringify(forced));
    await page.emulateMediaFeatures([]);

    await load(page);
    await keyboardFocus(page, '#btn-invitation-later');
    await page.keyboard.press('Enter');
    await settle(page);
    t.check('Not now by keyboard withdraws the invitation, remembers it and moves focus to the Home heading',
      (await layout(page, 'app-window-invitation')).hidden && await answer(page) === 'dismissed'
        && await active(page) === 'home-h');
    await load(page, { answer: 'dismissed' });
    t.check('a declined invitation stays withdrawn on the next visit',
      (await layout(page, 'app-window-invitation')).hidden);
    await page.goto(`${page.__origin}/#/data`, { waitUntil: 'load' });
    await page.waitForSelector('#btn-install');
    await settle(page);
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = () => Promise.resolve();
      event.userChoice = new Promise(() => {});
      window.dispatchEvent(event);
    });
    await settle(page);
    t.check('installation is still offered in Settings after Home was declined',
      await page.$eval('#pwa-install', (card) => !card.hidden));

    for (const width of [1280, 360]) {
      await load(page, { width });
      await keyboardFocus(page, '#btn-invitation-install');
      await page.keyboard.press('Enter');
      await settle(page);
      const pending = await page.evaluate(() => {
        const button = document.getElementById('btn-invitation-install');
        return { focused: document.activeElement === button, unavailable: button.getAttribute('aria-disabled') === 'true',
          enabled: !button.disabled, waiting: button.textContent.startsWith('Waiting') };
      });
      t.check(`${width}px the invitation's pending prompt keeps focus on its unavailable control`,
        pending.focused && pending.unavailable && pending.enabled && pending.waiting, JSON.stringify(pending));
      await page.waitForFunction(() => document.getElementById('app-report').textContent.includes('canceled'));
      await settle(page);
      const after = await page.evaluate(() => {
        const report = document.getElementById('app-report');
        const box = report.getBoundingClientRect();
        return { hidden: document.getElementById('app-window-invitation').hidden, focus: document.activeElement?.id,
          inView: box.height > 0 && box.bottom >= 0 && box.top <= innerHeight,
          settings: document.getElementById('pwa-install-report').textContent };
      });
      t.check(`${width}px canceling the browser dialog withdraws the invitation, reports on Home and returns focus to its heading`,
        after.hidden && after.focus === 'home-h' && after.inView && after.settings === '' && await answer(page) === 'dismissed',
        JSON.stringify(after));
    }

    await identify(page, FIREFOX_AGENT, []);
    for (const width of [1280, 360]) {
      for (const theme of ['light', 'dark']) {
        await load(page, { width, theme, offer: false });
        const notice = await layout(page, 'app-window-notice');
        t.check(`${width}px ${theme}: Firefox on Windows sees the app window notice in the approved words, and no invitation`,
          !notice.hidden && notice.visible && notice.afterClosure && notice.text === NOTICE
            && (await layout(page, 'app-window-invitation')).hidden, JSON.stringify(notice));
        t.check(`${width}px ${theme}: the notice fits, clear of its dismiss control, a named target inside it`,
          notice.pageFits && notice.textClear && notice.controls.length === 1 && notice.controls[0].name === 'Dismiss the app window notice'
            && notice.controls[0].width >= 24 && notice.controls[0].height >= 24 && notice.controls[0].inside,
          JSON.stringify(notice));
        await keyboardFocus(page, '#app-window-notice-dismiss');
        const ring = await focusRing(page, 'app-window-notice-dismiss');
        t.check(`${width}px ${theme}: the notice's dismiss control shows a keyboard focus ring`,
          ring.focused && ring.visible && ring.outline, JSON.stringify(ring));
      }
    }
    await load(page, { offer: false });
    await keyboardFocus(page, '#app-window-notice-dismiss');
    await page.keyboard.press('Enter');
    await settle(page);
    t.check('dismissing the notice by keyboard hides it, remembers it and moves focus to the Home heading',
      (await layout(page, 'app-window-notice')).hidden && await answer(page) === 'dismissed' && await active(page) === 'home-h');
    await load(page, { answer: 'dismissed', offer: false });
    t.check('a dismissed notice stays hidden on the next visit', (await layout(page, 'app-window-notice')).hidden);
  },
};
