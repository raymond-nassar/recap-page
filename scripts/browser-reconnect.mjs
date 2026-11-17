// #1412 decision 10: in the Microsoft Store app's window, when the engine is not running, the notice
// offers Reconnect, which asks Windows to start the engine through recap-page:. No package, engine or
// protocol is involved here. The page is told it is in an app window by answering its display-mode
// query, the health check and the startup host are stubs, and preparePage splices the one line that
// hands recap-page: to the browser so the run records the request instead of leaving the page. It also
// serves install.js with its fixed origin replaced by this ephemeral one and shortens the wait to three
// seconds, so the reading progress saved at :8787 is never touched and the timeout is reached.
const KEY = 'mrt.reconnect.storeEngine.v1';
const DECLINED = 'mrt.startupConsent.declined.v1';
const NOTICE = 'Reconnect to Recap Page.';
const READY = 'The local app connection is ready.';
const TODAY = 'The local app connection is not available.';
const STORE = 'c'.repeat(64);

const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// A fresh Home with the given engine, saved record and window. The startup question was declined, so
// the only way it comes back is through Reconnect.
async function load(page, { record = 'store', standalone = true, up = false, generation = STORE, width = 1280 } = {}) {
  await page.setViewport({ width, height: 900 });
  await page.goto('about:blank');
  const { identifier } = await page.evaluateOnNewDocument((key, value, declined, inWindow, running, engineGeneration) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      localStorage.setItem(declined, 'declined');
    } catch { /* about:blank has no storage of its own */ }
    const query = window.matchMedia.bind(window);
    window.matchMedia = (text) => (text === '(display-mode: standalone)'
      ? { matches: inWindow, media: text, addEventListener() {}, removeEventListener() {} }
      : query(text));
    const engine = { up: running, generation: engineGeneration, checks: 0, startup: [] };
    window.__engine = engine;
    const inner = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const path = typeof input === 'string' ? input : input.url;
      if (path === '/__recap_page_health__') {
        engine.checks += 1;
        if (!engine.up) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(new Response(null, { status: 204, headers: {
          'X-Recap-Page-Server': '1', 'X-Recap-Page-Generation': engine.generation,
        } }));
      }
      if (path.startsWith('/__recap_startup__/')) {
        engine.startup.push(path);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, state: 'disabled', consent: 'a'.repeat(64) }),
          { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return inner(input, init);
    };
  }, KEY, record, DECLINED, standalone, up, generation);
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
  await page.removeScriptToEvaluateOnNewDocument(identifier);
  await page.waitForSelector('#home-h');
  await page.waitForFunction(() => window.__engine.checks > 0);
  await settle(page);
  await settle(page);
}

function read(page) {
  return page.evaluate((key, declined) => {
    const notice = document.querySelector('#app-report .notice');
    const button = notice?.querySelector('button:not(.notice-dismiss)');
    const box = button?.getBoundingClientRect();
    return {
      notice: notice?.querySelector('.grow')?.textContent ?? null,
      button: button?.textContent.trim() ?? null,
      size: box ? { width: box.width, height: box.height } : null,
      fits: document.documentElement.scrollWidth <= innerWidth,
      ready: document.getElementById('local-connection-report')?.textContent.trim() ?? '',
      launches: window.__reconnectLaunches ?? [],
      record: localStorage.getItem(key),
      declined: localStorage.getItem(declined),
      question: !document.getElementById('startup-consent').hidden,
      startup: window.__engine.startup,
    };
  }, KEY, DECLINED);
}

async function pressReconnect(page) {
  await page.focus('#app-report .notice button:not(.notice-dismiss)');
  await page.keyboard.press('Enter');
  await settle(page);
}

const replaceOnce = (source, from, to) => {
  if (!source.includes(from)) throw new Error(`mutation target missing: ${from}`);
  return source.replace(from, to);
};

export const reconnectMutations = [
  {
    id: 'reconnect-early-success',
    breaks: 'reconnect',
    why: 'Reconnect says the connection is ready before the engine has answered',
    rewriteReconnect: (source) => replaceOnce(source, 'if (status === LOCAL_SERVER_STATUS.READY) return true;', 'return true;'),
  },
  {
    id: 'reconnect-in-a-tab',
    breaks: 'reconnect',
    why: 'a browser tab offers Reconnect, which only the Store app window can use',
    rewriteReconnect: (source) => replaceOnce(source, "&& scope.matchMedia('(display-mode: standalone)').matches", '&& true'),
  },
  {
    id: 'reconnect-forgets-the-question',
    breaks: 'reconnect',
    why: 'a declined startup question is not asked again after Reconnect, against decision 14',
    rewriteMain: (source) => replaceOnce(source, '  void askStartupConsentAgain();', ''),
  },
];

export const reconnect = {
  id: 'reconnect',
  title: 'The Store app window offers Reconnect in the approved words, and reports the connection only when the engine answers',
  async run(page, t) {
    for (const width of [1280, 360]) {
      await load(page, { width });
      const offered = await read(page);
      t.check(`${width}px the Store app window without its engine offers Reconnect in the approved words`,
        offered.notice === NOTICE && offered.button === 'Reconnect' && offered.fits
          && offered.size?.width >= 24 && offered.size?.height >= 24, JSON.stringify(offered));
    }

    await pressReconnect(page);
    let state = await read(page);
    t.check('Reconnect by keyboard asks Windows once, for recap-page: and nothing else',
      JSON.stringify(state.launches) === JSON.stringify(['recap-page:']) && state.notice === null, JSON.stringify(state));
    await new Promise((done) => setTimeout(done, 1500));
    state = await read(page);
    t.check('while the engine is still starting, nothing says the connection is ready',
      state.ready === '' && state.notice === null && !state.question, JSON.stringify(state));
    await page.evaluate(() => { window.__engine.up = true; });
    await page.waitForFunction((text) => document.getElementById('local-connection-report')?.textContent.includes(text), { timeout: 5000 }, READY)
      .catch(() => {});
    await settle(page);
    state = await read(page);
    t.check('once the engine answers ready, the connection is reported and the notice stays gone',
      state.ready === READY && state.notice === null && state.record === 'store', JSON.stringify(state));
    t.check('Reconnect asks the declined startup question again (decision 14)',
      state.declined === null && state.question && state.startup.some((path) => path.endsWith('/state')), JSON.stringify(state));

    await load(page);
    await pressReconnect(page);
    await page.waitForFunction((text) => document.querySelector('#app-report .notice .grow')?.textContent === text, { timeout: 8000 }, NOTICE)
      .catch(() => {});
    state = await read(page);
    t.check('when the engine never answers, the wait ends and Reconnect is offered again, never success',
      state.notice === NOTICE && state.ready === '' && !state.question, JSON.stringify(state));

    await load(page, { standalone: false });
    state = await read(page);
    t.check('a browser tab keeps today\'s notice and Check again',
      state.notice?.startsWith(TODAY) && state.button === 'Check again', JSON.stringify(state));

    await load(page, { record: null });
    state = await read(page);
    t.check('the portable download\'s window keeps today\'s notice and Check again',
      state.notice?.startsWith(TODAY) && state.button === 'Check again', JSON.stringify(state));

    await load(page, { up: true, generation: 'development' });
    state = await read(page);
    t.check('a ready answer from an engine that is not the Store package\'s forgets the record',
      state.record === null && state.notice === null, JSON.stringify(state));
    await load(page, { record: null, up: true });
    state = await read(page);
    t.check('a ready answer from the Store package\'s engine records it for the next time it is missing',
      state.record === 'store' && state.notice === null, JSON.stringify(state));
  },
};
