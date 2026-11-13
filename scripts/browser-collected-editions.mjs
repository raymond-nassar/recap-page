import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { editionEvidence } from '../src/js/lib/collectedEditions.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const ids = ['civil-war-avengers', 'nebula-reading-order', 'avengers-doomsday-secret-wars', 'realm-of-kings',
  'the-unbeatable-squirrel-girl', 'marvel-knights-to-planet-x-04', 'marvel-knights-to-planet-x-15'];
const lists = catalog.lists.filter((list) => ids.includes(list.id));
if (lists.length !== ids.length) throw new Error('Collected-edition browser fixtures require the chosen pilot and timeline lists');
const orders = Object.fromEntries(lists.map((list) => [list.file,
  JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8'))]));
let state = createEmptyState();
for (const list of lists) {
  state = createList(state, { id: `edition-${list.id}`, name: list.name, catalogId: list.id });
  state = addIssuesToList(state, `edition-${list.id}`, orders[list.file].items).state;
}
const seed = exportBackup(state);
const click = (page, selector) => page.$eval(selector, (node) => node.click());

const destinations = [
  'https://www.hoopladigital.com/title/123456789',
  'https://share.libbyapp.com/title/123456',
];

const isProviderRequest = (url) => {
  const host = new URL(url).hostname;
  return ['hoopladigital.com', 'libbyapp.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
};

async function waitForValue(read, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  return null;
}

async function verifyNetworkIsolation(page, t) {
  const browser = page.browser();
  const cdp = await browser.target().createCDPSession();
  const control = await browser.newPage();
  try {
    const args = (await cdp.send('Browser.getBrowserCommandLine')).arguments;
    const resolver = args.find((arg) => arg.startsWith('--host-resolver-rules='));
    const protectedLaunch = args.includes('--no-proxy-server')
      && !args.some((arg) => arg.startsWith('--proxy-server='))
      && resolver?.replace(/\s+/g, '') === '--host-resolver-rules=MAP*~NOTFOUND,EXCLUDE127.0.0.1';
    const path = '/__provider_network_isolation_probe__';
    const local = await control.goto(`${page.__origin}${path}`, { waitUntil: 'domcontentloaded' });
    let blocked = false;
    try {
      await control.goto(`${page.__origin.replace('127.0.0.1', 'localhost')}${path}`,
        { waitUntil: 'domcontentloaded', timeout: 5000 });
    } catch (error) {
      blocked = error.message.includes('net::ERR_NAME_NOT_RESOLVED');
    }
    t.check('Edge resolves only the loopback server and has no proxy', protectedLaunch && !!local && blocked,
      JSON.stringify({ resolver, protectedLaunch, local: !!local, blocked }));
    if (!protectedLaunch || !local || !blocked) throw new Error('Provider link test requires network-wide isolation');
  } finally {
    await control.close();
    await cdp.detach();
  }
}

async function monitorProviderRequests(page) {
  const browser = page.browser();
  const sourceCdp = await page.createCDPSession();
  const sourceId = (await sourceCdp.send('Target.getTargetInfo')).targetInfo.targetId;
  await sourceCdp.detach();
  const cdp = await browser.target().createCDPSession();
  const existing = new Set((await cdp.send('Target.getTargets')).targetInfos.map((target) => target.targetId));
  const attempts = [];
  const completed = [];
  const failures = [];
  const errors = [];
  const tabs = new Map();
  const noteSourceRequest = (request) => {
    if (isProviderRequest(request.url())) attempts.push({ target: 'source', url: request.url() });
  };
  const noteSourceFinish = (request) => {
    if (isProviderRequest(request.url())) completed.push({ target: 'source', url: request.url() });
  };
  const noteSourceFailure = (request) => {
    if (isProviderRequest(request.url())) {
      failures.push({ target: 'source', url: request.url(), error: request.failure()?.errorText });
    }
  };
  page.on('request', noteSourceRequest);
  page.on('requestfinished', noteSourceFinish);
  page.on('requestfailed', noteSourceFailure);
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    const session = cdp.connection().session(sessionId);
    if (existing.has(targetInfo.targetId)) {
      void session.send('Runtime.runIfWaitingForDebugger').catch((error) => errors.push(error.message));
      return;
    }
    const tab = { targetInfo, paused: [], requests: new Map(), closed: false };
    tabs.set(targetInfo.targetId, tab);
    session.on('Network.requestWillBeSent', ({ requestId, request }) => {
      if (!isProviderRequest(request.url)) return;
      const referer = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'referer')?.[1] || '';
      const observed = { target: targetInfo.targetId, url: request.url, referer,
        referrerPolicy: request.referrerPolicy, received: false, failed: false };
      tab.requests.set(requestId, observed);
      attempts.push(observed);
    });
    session.on('Network.responseReceived', ({ requestId, response }) => {
      const observed = tab.requests.get(requestId);
      if (observed && isProviderRequest(response.url)) observed.received = true;
    });
    session.on('Network.loadingFailed', ({ requestId, errorText }) => {
      const observed = tab.requests.get(requestId);
      if (observed) {
        observed.failed = true;
        failures.push({ target: targetInfo.targetId, url: observed.url, error: errorText });
      }
    });
    // Chromium can finish its internal error page after a failed request using the same request ID.
    session.on('Network.loadingFinished', ({ requestId }) => {
      const observed = tab.requests.get(requestId);
      if (observed?.received && !observed.failed) completed.push({ target: targetInfo.targetId, url: observed.url });
    });
    session.on('Fetch.requestPaused', ({ requestId, request }) => {
      const referer = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'referer')?.[1] || '';
      void session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
        .then(() => tab.paused.push({ url: request.url, referer }))
        .catch((error) => errors.push(error.message));
    });
    tab.ready = session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
      .then(() => Promise.all([session.send('Network.enable'), session.send('Runtime.runIfWaitingForDebugger')]))
      .catch((error) => errors.push(error.message));
  });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'page', exclude: false }],
  });
  return {
    attempts, completed, failures, errors, tabs, sourceId, cdp,
    async close() {
      for (const tab of tabs.values()) {
        await tab.ready;
        if (!tab.closed) await cdp.send('Target.closeTarget', { targetId: tab.targetInfo.targetId });
      }
      await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
      await cdp.detach();
      page.off('request', noteSourceRequest);
      page.off('requestfinished', noteSourceFinish);
      page.off('requestfailed', noteSourceFailure);
    },
  };
}

async function proveSameTabBlock(page, t, monitor) {
  await page.setContent('<a id="provider-same-tab-probe">Probe</a>');
  await page.$eval('#provider-same-tab-probe', (link, url) => { link.href = url; }, destinations[0]);
  await page.focus('#provider-same-tab-probe');
  await page.keyboard.press('Enter');
  const failure = await waitForValue(() => monitor.failures.find((entry) => entry.target === 'source'));
  const attempts = monitor.attempts.filter((entry) => entry.target === 'source');
  const blocked = failure?.url === destinations[0] && failure.error === 'net::ERR_FAILED'
    && attempts.length === 1 && attempts[0].url === destinations[0] && monitor.completed.length === 0;
  t.check('same-tab provider navigation is counted and blocked before a response', blocked,
    JSON.stringify({ attempts, failure, completed: monitor.completed }));
  if (!blocked) throw new Error('Provider request counter or page-level navigation block failed');
}

async function checkProviderTabs(page, t, monitor) {
  for (let index = 0; index < destinations.length; index++) {
    const destination = destinations[index];
    const selector = `#book-handoff-fixture a:nth-of-type(${index + 1})`;
    const originalUrl = page.url();
    await page.$eval(selector, (link) => {
      link.addEventListener('click', (event) => { window.__bookLinkWasTrusted = event.isTrusted; }, { once: true });
    });
    await page.focus(selector);
    await page.keyboard.press('Enter');
    const observed = await waitForValue(() => {
      for (const tab of monitor.tabs.values()) {
        const request = tab.paused.find((entry) => entry.url === destination);
        if (request) return { tab, request };
      }
      return null;
    });
    if (!observed) {
      t.check(`${destination}: trusted activation opens a separate protected tab`, false,
        JSON.stringify({ attempts: monitor.attempts, failures: monitor.failures, errors: monitor.errors }));
      return false;
    }
    const { tab, request } = observed;
    await tab.ready;
    const failure = await waitForValue(() => monitor.failures.find((entry) =>
      entry.target === tab.targetInfo.targetId && entry.url === destination));
    const matching = monitor.attempts.filter((entry) => entry.target === tab.targetInfo.targetId);
    const trusted = await page.evaluate(() => window.__bookLinkWasTrusted);
    t.check(`${destination}: trusted activation opens a separate protected tab`,
      page.url() === originalUrl && trusted && tab.targetInfo.openerId === monitor.sourceId
      && tab.targetInfo.canAccessOpener === false && request.referer === ''
      && matching.length === 1 && matching[0].url === destination
      && matching[0].referer === '' && matching[0].referrerPolicy === 'no-referrer' && !!failure,
      JSON.stringify({ target: tab.targetInfo, request, matching, failure, trusted, source: page.url() }));
    await monitor.cdp.send('Target.closeTarget', { targetId: tab.targetInfo.targetId });
    tab.closed = true;
  }
  return true;
}

export const collectedEditions = {
  id: 'collected-editions',
  title: 'verified issue labels and approval-gated book destinations in Preview and saved lists',
  async run(page, t) {
    page.__denyExternal = true;
    await verifyNetworkIsolation(page, t);
    const monitor = await monitorProviderRequests(page);
    try {
      await proveSameTabBlock(page, t, monitor);
      await collectedEditions.exercise(page, t, monitor);
    } finally {
      await monitor.close();
      t.check('no Hoopla or Libby request completed in the source page or any new tab',
        monitor.attempts.length === destinations.length + 1 && monitor.failures.length === destinations.length + 1
        && monitor.completed.length === 0 && monitor.errors.length === 0,
        JSON.stringify({ attempts: monitor.attempts, failures: monitor.failures,
          completed: monitor.completed, errors: monitor.errors }));
    }
  },
  async exercise(page, t, monitor) {
    const external = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.evaluateOnNewDocument((saved, chosen, fixtureOrders) => {
      localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: chosen, paths: [] })));
        const file = url.pathname.split('/').at(-1);
        if (fixtureOrders[file]) return Promise.resolve(new Response(JSON.stringify(fixtureOrders[file])));
        return real(input, init);
      };
    }, seed, lists, orders);

    for (const list of lists) {
      const expected = editionEvidence.relations.filter((relation) => relation.catalogId === list.id);
      await page.goto(`${page.__origin}/#/preview/${list.id}`, { waitUntil: 'load' });
      await page.waitForSelector('#preview[open] .preview-list li');
      const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      t.check(`${list.id}: Preview labels exactly the eligible issue count`,
        await page.$$eval('#preview .collected-edition', (nodes) => nodes.length) === expected.length);
      if (list.id === 'marvel-knights-to-planet-x-04' || list.id === 'marvel-knights-to-planet-x-15') {
        const title = list.id.endsWith('-04') ? 'X-Treme X-Men Vol. 1: Destiny' : 'New X-Men Vol. 2: Imperial';
        t.check(`${list.id}: heading-free Preview names the selected book on four issues`,
          await page.$$eval('#preview .collected-edition', (nodes, title) =>
            nodes.length === 4 && nodes.every((node) => node.textContent.includes(`Collected in ${title}`)), title));
      }
      t.check(`${list.id}: Preview shows credit exactly when relations are displayed`,
        await page.$$eval('#preview .edition-credit', (nodes) => nodes.length) === (expected.length ? 1 : 0));
      await page.keyboard.press('Escape');
      await page.evaluate((id) => { location.hash = `#/read/edition-${id}`; }, list.id);
      await page.waitForSelector('#view-read:not([hidden])');
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForSelector('#rows .row');
      t.check(`${list.id}: saved list labels match Preview`,
        await page.$$eval('#rows .collected-edition', (nodes) => nodes.length) === expected.length);
      t.check(`${list.id}: saved list has one shared credit, not a row of repeated links`,
        await page.$$eval('#rows .edition-credit', (nodes) => nodes.length) === (expected.length ? 1 : 0));
      if (expected.length) {
        for (const index of [0, 1]) {
          const retained = await page.evaluate((index) => {
            const link = document.querySelectorAll('#rows .edition-credit a')[index];
            link.focus();
            const focused = document.activeElement === link;
            window.dispatchEvent(new Event('focus'));
            return focused && link.isConnected && document.activeElement === link;
          }, index);
          t.check(`${list.id}: credit link ${index + 1} retains the same focused element after window focus`, retained);
        }
      }
      // Route traversal may change the active list, but rendering must not change its contents.
      const changed = await page.evaluate((snapshot) => {
        const a = JSON.parse(snapshot), b = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return JSON.stringify(a.issues) !== JSON.stringify(b.issues)
          || JSON.stringify(a.lists) !== JSON.stringify(b.lists);
      }, before);
      t.check(`${list.id}: inspecting labels preserves saved comics and custom headings`, !changed);
    }

    const list = lists.find((entry) => entry.id === 'civil-war-avengers');
    for (const profile of [
      { width: 1280, forced: false, large: false, theme: 'light' },
      { width: 390, forced: false, large: true, theme: 'dark' },
      { width: 1280, forced: true, large: true, theme: 'system' },
      { width: 390, forced: true, large: true, theme: 'system' },
    ]) {
      await page.setViewport({ width: profile.width, height: 900 });
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: profile.forced ? 'active' : 'none' }] });
      for (const surface of ['preview', 'saved']) {
        const root = surface === 'preview' ? '#preview' : '#rows';
        await page.goto(`${page.__origin}/#/${surface === 'preview' ? `preview/${list.id}` : `read/edition-${list.id}`}`, { waitUntil: 'load' });
        if (surface === 'saved') {
          await page.waitForSelector('#view-read:not([hidden])');
          await page.evaluate(() => { document.querySelector('#full').open = true; });
        }
        await page.waitForSelector(`${root} .collected-edition`);
        await page.evaluate(({ large, theme }) => {
          document.documentElement.removeAttribute('style');
          document.documentElement.dataset.theme = theme;
          if (large) for (const name of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
            const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
            document.documentElement.style.setProperty(name, `${value * 2}px`);
          }
        }, profile);
        const result = await page.$eval(root, (container) => {
          const labels = [...container.querySelectorAll('.collected-edition')];
          return {
            count: labels.length,
            fits: labels.every((node) => {
              const rect = node.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1;
            }),
            rowStops: labels.some((node) => node.querySelector('a,button,[tabindex]')),
            issue: labels.every((node) => node.closest('li')?.querySelector('[data-issue-id]')),
            credit: container.querySelectorAll('.edition-credit a').length,
            bodyOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const name = `${surface} ${profile.width}px forced=${profile.forced} large=${profile.large}`;
        t.check(`${name}: all 13 labels wrap with their issues and no row tab stop`,
          result.count === 13 && result.fits && !result.rowStops && result.issue && !result.bodyOverflow, JSON.stringify(result));
        t.check(`${name}: required credit retains both licence/source links`, result.credit === 2);
        const ax = await cdp.send('Accessibility.getFullAXTree');
        t.check(`${name}: label text is exposed in the accessibility tree`,
          ax.nodes.some((node) => node.name?.value === 'Collected in Civil War'));
        const keepFixture = surface === 'saved' && profile.width === 390 && profile.forced;
        const policyResult = await page.evaluate(async (root, keepFixture) => {
          const { collectedEditionLabels } = await import('./js/views/shared/collected-editions.js');
          const make = (tag, props, children = []) => {
            const node = document.createElement(tag);
            for (const [key, value] of Object.entries(props)) {
              if (key === 'text') node.textContent = value;
              else if (key === 'class') node.className = value;
              else node.setAttribute(key, value);
            }
            node.append(...[].concat(children));
            return node;
          };
          const issue = { issueId: 7, seriesId: 8, number: '1' };
          const evidence = { relations: [{ ...issue, catalogId: 'fixture', editionId: 'book',
            status: 'verified', portion: 'full', conflicts: [], source: 'fixture', checkedAt: '2026-11-10' }] };
          const catalog = { providers: {
            hoopla: { name: 'Hoopla', basis: 'owner-approval',
              basisEvidence: 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560' },
            libby: { name: 'Libby', basis: 'owner-approval',
              basisEvidence: 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560' } },
          editions: { book: { title: 'Stand-in book', destinations: [
            { provider: 'hoopla', checkedAt: '2026-11-12', url: 'https://www.hoopladigital.com/title/123456789' },
            { provider: 'libby', checkedAt: '2026-11-12', url: 'https://share.libbyapp.com/title/123456' }] } } };
          const unconfirmed = collectedEditionLabels(make, 'fixture', issue, catalog, evidence);
          const hidden = unconfirmed.querySelectorAll('a').length === 0;
          for (const destination of catalog.editions.book.destinations) destination.confirmedBy = 'owner';
          const shown = collectedEditionLabels(make, 'fixture', issue, catalog, evidence);
          const host = document.querySelector(`${root} .collected-editions`);
          host.append(shown);
          const links = [...shown.querySelectorAll('a')];
          links[1].focus();
          const rects = links.map((link) => link.getBoundingClientRect());
          const result = { hidden, count: links.length, focused: document.activeElement === links[1],
            targets: links.map((link) => link.target), rels: links.map((link) => link.rel),
            policies: links.map((link) => link.referrerPolicy),
            texts: links.map((link) => link.textContent), names: links.map((link) => link.getAttribute('aria-label')),
            fits: rects.every((rect) => rect.width <= host.clientWidth + 1),
            height: Math.min(...rects.map((rect) => rect.height)) };
          if (keepFixture) shown.id = 'book-handoff-fixture';
          else shown.remove();
          return result;
        }, root, keepFixture);
        t.check(`${name}: only owner-confirmed stand-in destinations expose accessible hedged book links`,
          policyResult.hidden && policyResult.count === 2 && policyResult.focused
          && policyResult.targets.every((target) => target === '_blank')
          && policyResult.rels.every((rel) => rel === 'noopener noreferrer')
          && policyResult.policies.every((policy) => policy === 'no-referrer')
          && policyResult.texts.join('|') === 'Look for this book on Hoopla|Look for this book in Libby'
          && policyResult.names.every((label) => label.includes('Stand-in book') && label.includes('opens outside'))
          && policyResult.fits && policyResult.height >= 24,
          JSON.stringify(policyResult));
        if (surface === 'preview') await page.keyboard.press('Escape');
      }
      await cdp.detach();
    }
    await page.setViewport({ width: 1280, height: 900 });
    if (!await checkProviderTabs(page, t, monitor)) return;
    await page.$eval('#book-handoff-fixture', (node) => node.remove());
    t.check('edition display makes no external network requests', external.length === 0, JSON.stringify(external));
    t.check('production DOM shows only owner-confirmed provider addresses from the bundled catalog',
      await page.evaluate(async () => {
        const { editionCatalog } = await import('./data/collectedEditionCatalog.js');
        const allowed = new Set(Object.values(editionCatalog.editions).flatMap((book) => book.destinations)
          .filter((destination) => destination.confirmedBy === 'owner').map((destination) => destination.url));
        return [...document.querySelectorAll('a[href*="hoopladigital"], a[href*="libbyapp"]')]
          .every((link) => allowed.has(link.href));
      }));
    await click(page, '.brand[data-view="home"]');
  },
};
