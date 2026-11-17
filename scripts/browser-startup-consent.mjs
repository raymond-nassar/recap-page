// #1412 decision 13: the Microsoft Store app's window asks before Recap Page starts itself at sign-in.
// No package and no host is involved here. The page is told it is in an app window by answering its
// display-mode query, and the package's host is a stub that answers the two startup requests the way
// host/startupTask.mjs does, recording what the page sent. preparePage serves install.js with its fixed
// origin replaced by this ephemeral one, so the reading progress saved at :8787 is never touched.
const TITLE = 'Start Recap Page automatically?';
const TEXT = 'Have Recap Page ready when you sign in.';
const KEY = 'mrt.startupConsent.declined.v1';
const ONE = 'a'.repeat(64);

const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// A fresh Home in an app window (or a tab), with the saved answer, theme and host replies given.
async function load(page, { answer = null, theme = 'light', width = 1280, standalone = true, enable = 'enabled', hold = false } = {}) {
  await page.setViewport({ width, height: 900 });
  await page.goto('about:blank');
  const { identifier } = await page.evaluateOnNewDocument((key, value, chosen, inWindow, consent, enableState, holdEnable) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      localStorage.setItem('mrt.settings', JSON.stringify({ theme: chosen }));
    } catch { /* about:blank has no storage of its own */ }
    const query = window.matchMedia.bind(window);
    window.matchMedia = (text) => (text === '(display-mode: standalone)'
      ? { matches: inWindow, media: text, addEventListener() {}, removeEventListener() {} }
      : query(text));
    const host = { requests: [], release: null };
    window.__startupHost = host;
    const inner = window.fetch.bind(window);
    const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = (input, init = {}) => {
      const path = typeof input === 'string' ? input : input.url;
      if (!path.startsWith('/__recap_startup__/')) return inner(input, init);
      host.requests.push({ path, method: init.method, headers: init.headers, body: init.body });
      if (path.endsWith('/state')) return Promise.resolve(reply({ ok: true, state: 'disabled', consent: consent }));
      const answer = () => reply({ ok: true, state: enableState });
      if (!holdEnable) return Promise.resolve(answer());
      return new Promise((resolve) => { host.release = () => resolve(answer()); });
    };
  }, KEY, answer, theme, standalone, ONE, enable, hold);
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
  await page.removeScriptToEvaluateOnNewDocument(identifier);
  await page.waitForSelector('#home-h');
  await settle(page);
  await settle(page);
}

function layout(page) {
  return page.evaluate(() => {
    const root = document.getElementById('startup-consent');
    const box = root.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button')].map((button) => {
      const b = button.getBoundingClientRect();
      return { id: button.id, text: button.textContent.trim(), width: b.width, height: b.height,
        inside: b.left >= box.left - 0.5 && b.right <= box.right + 0.5 && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5,
        fits: button.scrollWidth <= button.clientWidth };
    });
    const text = root.querySelector('p');
    const first = root.querySelector('button').getBoundingClientRect();
    return {
      hidden: root.hidden, visible: box.height > 0,
      title: root.querySelector('h2')?.textContent ?? null, text: text?.textContent ?? null,
      controls, pageFits: document.documentElement.scrollWidth <= innerWidth,
      afterInvitation: document.getElementById('app-window-notice').compareDocumentPosition(root) === Node.DOCUMENT_POSITION_FOLLOWING,
      // The same rhythm as the invitation above it: room under the words and under the card.
      gap: first.top - text.getBoundingClientRect().bottom,
      spaced: getComputedStyle(root).marginBottom === getComputedStyle(document.getElementById('app-window-invitation')).marginBottom
        && getComputedStyle(text).marginBottom === getComputedStyle(document.querySelector('#app-window-invitation p')).marginBottom,
    };
  });
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

async function keyboardFocus(page, selector) {
  await page.focus(selector);
  await page.keyboard.press('Tab');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
}

const answer = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const active = (page) => page.evaluate(() => document.activeElement?.id ?? null);
const requests = (page) => page.evaluate(() => window.__startupHost.requests);

const replaceOnce = (source, from, to) => {
  if (!source.includes(from)) throw new Error(`mutation target missing: ${from}`);
  return source.replace(from, to);
};

export const startupConsentMutations = [
  {
    id: 'startup-consent-strands-focus',
    breaks: 'startup-consent',
    why: 'answering the automatic startup question leaves keyboard focus on a control that has just been hidden',
    rewriteStartupConsent: (source) => replaceOnce(source, "homeHeading.setAttribute('tabindex', '-1');", 'return;'),
  },
  {
    id: 'startup-consent-scripted-click',
    breaks: 'startup-consent',
    why: 'a click the page made itself turns automatic startup on, which is not the reader agreeing',
    rewriteStartupConsent: (source) => replaceOnce(source, '!event?.isTrusted || ', ''),
  },
  {
    id: 'startup-consent-crowded',
    breaks: 'startup-consent',
    why: 'the question loses the invitation\'s spacing, so its words sit on its buttons and it touches what follows',
    rewriteStyles: (source) => replaceOnce(source, ':is(#app-window-invitation, #startup-consent) p', '#app-window-invitation p'),
  },
];

export const startupConsent = {
  id: 'startup-consent',
  title: 'The Store app window asks before starting at sign-in, in the approved words, and only on the reader\'s own answer',
  async run(page, t) {
    for (const width of [1280, 360]) {
      for (const theme of ['light', 'dark']) {
        await load(page, { width, theme });
        const shown = await layout(page);
        t.check(`${width}px ${theme}: the app window asks below the app window notices, in the approved words`,
          !shown.hidden && shown.visible && shown.afterInvitation && shown.title === TITLE && shown.text === TEXT
            && shown.controls.map(({ text }) => text).join('|') === 'Turn on|Not now', JSON.stringify(shown));
        t.check(`${width}px ${theme}: the question and its controls fit and are spaced like the invitation, each at least a 24px target`,
          shown.pageFits && shown.spaced && shown.gap >= 8
            && shown.controls.every(({ width: w, height, inside, fits }) => w >= 24 && height >= 24 && inside && fits),
          JSON.stringify(shown));
        for (const control of ['btn-startup-on', 'btn-startup-later']) {
          await keyboardFocus(page, `#${control}`);
          const ring = await focusRing(page, control);
          t.check(`${width}px ${theme}: ${control} shows a keyboard focus ring`,
            ring.focused && ring.visible && ring.outline && ring.distinct, JSON.stringify(ring));
        }
      }
    }

    await load(page);
    await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
    await keyboardFocus(page, '#btn-startup-on');
    const forced = await focusRing(page, 'btn-startup-on');
    t.check('forced colors keep Turn on legible and its focus visible',
      forced.focused && forced.visible && forced.outline && forced.distinct, JSON.stringify(forced));
    await page.emulateMediaFeatures([]);

    await load(page);
    await keyboardFocus(page, '#btn-startup-on');
    await page.keyboard.press('Tab');
    t.check('Tab moves from Turn on to Not now', await active(page) === 'btn-startup-later');

    await load(page);
    await page.evaluate(() => document.getElementById('btn-startup-on').click());
    await settle(page);
    t.check('a click the page makes itself is not an answer: nothing is turned on and the question stays',
      !(await layout(page)).hidden && (await requests(page)).every(({ path }) => path.endsWith('/state')),
      JSON.stringify(await requests(page)));

    for (const width of [1280, 360]) {
      await load(page, { width, hold: true });
      await keyboardFocus(page, '#btn-startup-on');
      await page.keyboard.press('Enter');
      await settle(page);
      const pending = await page.evaluate(() => {
        const on = document.getElementById('btn-startup-on');
        const later = document.getElementById('btn-startup-later');
        return { focused: document.activeElement === on, shown: !document.getElementById('startup-consent').hidden,
          unavailable: on.getAttribute('aria-disabled') === 'true' && later.getAttribute('aria-disabled') === 'true',
          words: on.textContent.trim() === 'Turn on' };
      });
      t.check(`${width}px while Windows answers, the question stays with focus on its unavailable Turn on`,
        pending.focused && pending.shown && pending.unavailable && pending.words, JSON.stringify(pending));
      await page.keyboard.press('Enter');
      await page.evaluate(() => window.__startupHost.release());
      await settle(page);
      const sent = await requests(page);
      const enable = sent.filter(({ path }) => path.endsWith('/enable'));
      t.check(`${width}px Turn on by keyboard sends one request with the host header and the value it was given`,
        enable.length === 1 && enable[0].method === 'POST' && enable[0].headers['x-recap-startup'] === '1'
          && JSON.parse(enable[0].body).consent === 'a'.repeat(64), JSON.stringify(sent));
      t.check(`${width}px once the task is on, the question is withdrawn and focus moves to the Home heading`,
        (await layout(page)).hidden && await active(page) === 'home-h');
    }

    await load(page);
    await keyboardFocus(page, '#btn-startup-later');
    await page.keyboard.press('Enter');
    await settle(page);
    t.check('Not now by keyboard withdraws the question, remembers it and moves focus to the Home heading',
      (await layout(page)).hidden && await answer(page) === 'declined' && await active(page) === 'home-h'
        && (await requests(page)).length === 1);
    await load(page, { answer: 'declined' });
    t.check('a declined question stays withdrawn on the next visit, without asking Windows',
      (await layout(page)).hidden && (await requests(page)).length === 0);

    await load(page, { standalone: false });
    t.check('a browser tab is never asked, and never asks Windows',
      (await layout(page)).hidden && (await requests(page)).length === 0);
  },
};
