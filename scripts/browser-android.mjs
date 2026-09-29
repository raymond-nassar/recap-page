import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CSP } from '../server.mjs';
import { prepareAndroid, ANDROID_ASSET_DIR } from './prepare-android.mjs';
import { LOCAL_SERVER_HEALTH_PATH, LOCAL_SERVER_HEADER_NAME, LOCAL_SERVER_HEADER_VALUE } from '../src/js/lib/localServer.js';

const driver = process.env.MRT_PUPPETEER || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const edge = process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(driver) || !existsSync(edge)) {
  throw new Error('Set MRT_PUPPETEER to an external puppeteer-core entry file and MRT_EDGE to installed Edge. Do not install the driver in this repository.');
}
const puppeteer = (await import(pathToFileURL(driver).href)).default;
await prepareAndroid();
let root = resolve(ANDROID_ASSET_DIR);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const noStyle = process.argv.includes('--without-mobile-style');
const mobileUi = process.argv.includes('--only=mobile-ui');
const launcherOnly = process.argv.includes('--only=launcher');
const seriesReadability = process.argv.includes('--only=series-readability');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === LOCAL_SERVER_HEALTH_PATH) {
    res.writeHead(204, { [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE }).end();
    return;
  }
  try {
    const target = resolve(root, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
    if (!target.startsWith(root + sep)) throw new Error('Outside assets');
    const bytes = noStyle && path === '/android/mobile.css' ? '' : await readFile(target);
    res.writeHead(200, {
      'content-type': `${mime[extname(target)] || 'application/octet-stream'}; charset=utf-8`,
      'content-security-policy': `${CSP}; frame-src 'none'; worker-src 'none'`,
      'cache-control': 'no-store',
    }).end(bytes);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url)));
const orderEntry = catalog.lists.find((entry) => entry.id === 'house-of-m');
assert.ok(orderEntry, 'House of M fixture must exist');
const order = JSON.parse(await readFile(new URL(`../src/data/${orderEntry.file}`, import.meta.url)));
let browser;
let assertions = 0;
const failures = [];
function check(value, message) {
  if (!value) failures.push(message);
  assertions++;
}
async function click(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (node) => node.click());
}
async function route(page, name) {
  await page.evaluate((view) => { location.hash = `#/${view}`; }, name);
  await page.waitForSelector(`#view-${name}:not([hidden])`);
}
async function backDialog(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Android Back did not close the dialog')), 5000);
    document.querySelector('dialog[open]').addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    window.__androidTest.back();
  }));
}
async function screenshot(page, label, surface) {
  if (!process.env.MRT_ANDROID_SCREENSHOTS) return;
  await mkdir(process.env.MRT_ANDROID_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.MRT_ANDROID_SCREENSHOTS, `${label}-${surface}.png`) });
}
async function measure(page, label) {
  const result = await page.evaluate(() => {
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      return box.width && box.height && !node.closest('[hidden]') && getComputedStyle(node).visibility !== 'hidden';
    };
    const targets = [...document.querySelectorAll('button, .btn, select, summary, .checkbox, .fp > span')]
      .filter(visible)
      .filter((node) => !node.closest('dialog:not([open])'));
    return {
      body: parseFloat(getComputedStyle(document.body).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      small: targets.map((node) => {
        const box = node.getBoundingClientRect();
        return { name: node.id || node.textContent.trim().slice(0, 45), w: box.width, h: box.height };
      }).filter((box) => box.w < 47.5 || box.h < 47.5),
    };
  });
  check(result.body >= 16, `${label}: body text must be at least 16px (${result.body})`);
  check(!result.overflow, `${label}: no horizontal page overflow`);
  check(result.small.length === 0, `${label}: undersized targets ${JSON.stringify(result.small)}`);
}

const SERIES = [
  [900001, 'Avengers (2020)', 3],
  [900002, 'Avengers Unlimited Infinity Comic (2022 - 2024)', 2],
  [900003, 'Avengers: The Initiative Featuring the Extraordinary Academy (2020)', 1],
];
const SERIES_ISSUES = [1, 2].map((number) => ({
  id: 900010 + number,
  title: `Readability fixture #${number}`,
  seriesId: 900002,
  seriesName: SERIES[1][1],
  issueNumber: String(number),
  digitalId: 900020 + number,
}));

async function seriesFixtures(page) {
  await page.evaluateOnNewDocument((series, issues) => {
    const original = window.fetch.bind(window);
    window.__seriesRequests = [];
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const json = (value) => new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      });
      if (url.pathname === '/data/catalog.json') return json({ lists: [] });
      if (url.pathname === '/data/series-index.json') {
        return json({ kind: 'series', generatedAt: '2026-01-01', total: series.length, items: series });
      }
      if (url.origin !== location.origin) {
        window.__seriesRequests.push(url.pathname);
        if (url.pathname === '/v1/health') return json({ status: 'ok' });
        if (url.pathname === '/v1/series/900002/issues') {
          return json({ items: issues, total: issues.length, has_next: false });
        }
        throw new Error(`Unexpected fixture request: ${url.href}`);
      }
      return original(input, options);
    };
  }, SERIES, SERIES_ISSUES);
}

async function seriesResultReadability(page, label, desktop) {
  await route(page, 'add-series');
  await page.type('#series-q', 'Avengers');
  await page.$eval('#form-series', (form) => form.requestSubmit());
  await page.waitForSelector('#series-results .result');
  const rendered = await page.evaluate(() => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const rows = [...document.querySelectorAll('#series-results .result')];
    return {
      query: document.querySelector('#series-q').value,
      summary: document.querySelector('#series-results > .rail-hint').textContent,
      body: parseFloat(getComputedStyle(document.body).fontSize),
      androidStyle: !!document.querySelector('link[href="./android/mobile.css"]'),
      rows: rows.map((row) => ({
        title: row.querySelector('.result-title').textContent,
        count: row.querySelector('.result-meta').textContent,
        label: row.querySelector('button').textContent,
        name: row.querySelector('button').getAttribute('aria-label'),
        row: box(row), main: box(row.querySelector('.result-main')),
        button: box(row.querySelector('button')),
        padding: parseFloat(getComputedStyle(row).paddingLeft),
      })),
    };
  });
  check(rendered.query === 'Avengers' && rendered.summary === '3 matches.',
    `${label}: query and match count retained`);
  check(JSON.stringify(rendered.rows.map((row) => row.title)) === JSON.stringify(SERIES.map((row) => row[1])),
    `${label}: normal and long series titles retain their result order`);
  check(rendered.androidStyle === !desktop, `${label}: correct Android or shared desktop stylesheet`);
  check(rendered.body === (desktop ? 14 : label.includes('150%') ? 24 : 16),
    `${label}: existing body scale retained (${rendered.body}px)`);
  for (const [index, row] of rendered.rows.entries()) {
    check(row.count === `${SERIES[index][2]} issues` && row.label === 'Add all issues'
      && row.name === `Add all issues of ${row.title}`,
    `${label}: ${row.title}: issue count and action names retained`);
    check(row.button.width >= (desktop ? 44 : 48) && row.button.height >= (desktop ? 44 : 48),
      `${label}: ${row.title}: action hit rectangle ${row.button.width}x${row.button.height}`);
    check(desktop
      ? row.button.left >= row.main.right && row.button.top < row.main.bottom
      : row.button.top >= row.main.bottom
        && row.main.width >= row.row.width - 2 * row.padding - 3,
    `${label}: ${row.title}: ${desktop ? 'desktop row retained' : 'title uses full row width with action below'}`);
  }
  const words = await page.evaluate(() => {
    const broken = [], clipped = [];
    let measured = 0;
    for (const node of document.querySelectorAll('#series-results .result :is(.result-title, .result-meta, button)')) {
      const bounds = node.getBoundingClientRect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        for (const match of text.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index);
          range.setEnd(text, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
          measured++;
          if (rects.length !== 1) broken.push({ word: match[0], lines: rects.length, text: node.textContent });
          if (rects.some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1
            || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) {
            clipped.push({ word: match[0], text: node.textContent });
          }
        }
      }
    }
    return { broken, clipped, measured, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  check(words.measured > 30, `${label}: measured ordinary words in every result (${words.measured})`);
  check(words.broken.length === 0, `${label}: whole rendered words ${JSON.stringify(words.broken)}`);
  check(words.clipped.length === 0 && !words.overflow, `${label}: no hidden or overflowing result text ${JSON.stringify(words.clipped)}`);
  await page.$eval('#series-results', (node) => node.scrollIntoView());
  await screenshot(page, label, 'series-results');

  // A narrow instance of an existing user-content surface guards against a blanket nowrap fix.
  const emergency = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'reader-link';
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = `https://example.invalid/${'unbrokentext'.repeat(12)}`;
    button.style.width = '100%';
    host.append(button);
    document.querySelector('#view-add-series').append(host);
    const range = document.createRange();
    range.selectNodeContents(button);
    const rects = [...range.getClientRects()];
    const box = button.getBoundingClientRect();
    const wraps = rects.length > 1 && rects.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1);
    host.remove();
    return wraps;
  });
  check(emergency, `${label}: unrelated unbroken user content still wraps inside its control`);

  await click(page, `#series-results button[aria-label="Add all issues of ${SERIES[1][1]}"]`);
  await page.waitForFunction(() => document.querySelector('#series-results .notice-ok')?.textContent.includes('2 issues added.'));
  const saved = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return {
      requests: window.__seriesRequests,
      lists: state.listOrder.length,
      ids: state.lists[state.active].itemIds,
      read: Object.keys(state.read),
    };
  });
  check(JSON.stringify(saved.requests) === JSON.stringify(['/v1/health', '/v1/series/900002/issues'])
    && saved.lists === 1 && JSON.stringify(saved.ids) === JSON.stringify(SERIES_ISSUES.map((issue) => issue.id))
    && saved.read.length === 0, `${label}: Add imports exactly the selected fixture series without marking it read ${JSON.stringify(saved)}`);
  console.log(`CHECKED ${label}: ${rendered.rows.length} series results, ${words.measured} rendered words, Add behavior; hit rectangles ${JSON.stringify(rendered.rows.map((row) => row.button))}`);
}

async function mobileLayout(page, label, narrow) {
  await page.waitForSelector('#home-recommended:not([hidden])');
  if (narrow) {
    const home = await page.evaluate(() => {
      const card = document.querySelector('#home-recommended').getBoundingClientRect();
      const copy = document.querySelector('#home-recommended .grow').getBoundingClientRect();
      const button = document.querySelector('#btn-home-recommended').getBoundingClientRect();
      return { fullWidth: copy.width >= card.width * .8, stacked: button.top >= copy.bottom };
    });
    check(home.fullWidth && home.stacked, `${label}: recommendation copy uses card width, action below copy`);
  }
  await measure(page, `${label} recommended Home`);
  await screenshot(page, label, 'home');
  await click(page, '#btn-rail-toggle');
  await page.tap('#sidebar-panel [data-view="browse"]');
  await page.waitForSelector('#view-browse:not([hidden])');
  const focus = await page.$eval('#browse-h', (heading) => ({
    focused: document.activeElement === heading,
    outline: getComputedStyle(heading).outlineStyle,
  }));
  check(focus.focused && focus.outline === 'none', `${label}: touch navigation focuses heading without a rectangle`);
  await page.keyboard.press('Tab');
  await route(page, 'catalog');
  check(await page.$eval('#catalog-h', (heading) => (
    document.activeElement === heading && getComputedStyle(heading).outlineStyle !== 'none'
  )), `${label}: keyboard navigation retains visible heading focus`);
  await page.waitForSelector('#catalog-filters:not([hidden]) .fp');
  const navigation = await page.evaluate(() => ({
    parents: [...document.querySelectorAll('.breadcrumb a')].filter((link) => link.getClientRects().length).map((link) => link.hash),
    current: !!document.querySelector('.breadcrumb [aria-current]')?.getClientRects().length,
  }));
  check(narrow
    ? navigation.parents.length === 1 && navigation.parents[0] === '#/browse' && !navigation.current
    : navigation.parents.length === 2 && navigation.current,
  `${label}: ${narrow ? 'one parent destination without duplicated title' : 'wide breadcrumb hierarchy retained'}`);
  if (narrow) {
    const filters = await page.$eval('#catalog-filters', (group) => {
      const boxes = [...group.querySelectorAll('.fp')].map((node) => node.getBoundingClientRect());
      return { count: boxes.length, oneRow: boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1) };
    });
    check(filters.count > 2 && filters.oneRow, `${label}: catalog facets occupy one scrollable row`);
    await page.focus('#catalog-filters .fp:last-child input');
    check(await page.$eval('#catalog-filters .fp:last-child', (node) => {
      const box = node.getBoundingClientRect();
      const group = node.closest('.filters').getBoundingClientRect();
      return box.left >= group.left - 1 && box.right <= group.right + 1;
    }), `${label}: keyboard focus reveals the last offscreen filter`);
  }
  await measure(page, `${label} catalog filters`);
  await screenshot(page, label, 'catalog');
  const allCards = await page.$$eval('#catalog-results .catalog-card', (cards) => cards.length);
  await click(page, '#catalog-filters input[value="beginner"]');
  await page.waitForFunction((total) => {
    const count = document.querySelectorAll('#catalog-results .catalog-card').length;
    return count > 0 && count < total;
  }, {}, allCards);
  check(await page.$eval('#catalog-filters input[value="beginner"]', (node) => node.checked),
    `${label}: existing catalog filter still affects results`);
  await click(page, '#catalog-filters input[value="all"]');
  await page.type('#catalog-q', 'Secret Wars');
  await page.tap('.breadcrumb li:nth-last-child(2) a');
  await page.waitForSelector('#view-browse:not([hidden])');
  check(await page.$eval('#browse-h', (heading) => getComputedStyle(heading).outlineStyle === 'none'),
    `${label}: touch after typing also removes the heading rectangle`);
  await route(page, 'catalog');
  await click(page, '#catalog-clear');
  await route(page, 'lines');
  await click(page, 'button[data-act="import"][data-key="hickman-minimal"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2'))?.listOrder.length === 1, { timeout: 5000 })
    .catch(async (error) => {
      console.error(await page.evaluate(() => ({
        reports: [...document.querySelectorAll('.report')].map((node) => node.textContent).filter(Boolean),
        state: localStorage.getItem('mrt.state.v2'),
        route: location.hash,
      })));
      throw error;
    });
  await route(page, 'read');
  await page.waitForSelector('#reading-body:not([hidden])');
  await measure(page, `${label} Hickman Reading`);
  await screenshot(page, label, 'reading');
  const trigger = await page.$('#android-list-options');
  check(!!trigger, `${label}: list management has a compact entry point`);
  if (!trigger) return;
  if (!narrow) {
    check(!await trigger.isVisible() && await page.$eval('#btn-rename-list', (node) => !!node.getClientRects().length),
      `${label}: wide list actions remain inline`);
    return;
  }
  check(!await page.$eval('#btn-rename-list', (node) => !!node.getClientRects().length),
    `${label}: management actions are hidden until requested`);
  await click(page, '#android-list-options');
  await page.waitForSelector('#android-list-sheet[open]');
  await measure(page, `${label} list options sheet`);
  await screenshot(page, label, 'options');
  const sheet = await page.$eval('#android-list-sheet', (node) => {
    const box = node.getBoundingClientRect();
    return {
      bottom: Math.abs(box.bottom - innerHeight) <= 1,
      fits: box.top >= 0 && box.height <= innerHeight,
      labelled: !!document.getElementById(node.getAttribute('aria-labelledby'))?.textContent,
      vertical: getComputedStyle(node.querySelector('.list-tools')).flexDirection === 'column',
    };
  });
  check(sheet.bottom && sheet.fits && sheet.labelled && sheet.vertical, `${label}: named bottom sheet fits viewport and stacks actions`);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check(await page.$eval('#android-list-sheet', (node) => node.contains(document.activeElement)),
    `${label}: sheet retains keyboard focus`);
  await backDialog(page);
  await page.waitForFunction(() => !document.querySelector('#android-list-sheet').open);
  check(await page.$eval('#android-list-options', (node) => document.activeElement === node),
    `${label}: Android Back closes sheet and restores trigger focus`);
  for (const action of ['#btn-rename-list', '#btn-list-note', '#btn-delete-list']) {
    await click(page, '#android-list-options');
    await click(page, action);
    await page.waitForSelector('#ask[open]', { timeout: 5000 }).catch(async (error) => {
      console.error(action, await page.evaluate(() => ({
        dialogs: [...document.querySelectorAll('dialog[open]')].map((node) => node.id),
        focus: document.activeElement.id,
        tools: document.querySelector('.list-tools').parentElement.id,
      })));
      throw error;
    });
    const oneDialog = await page.$$eval('dialog[open]', (dialogs) => dialogs.length === 1);
    check(oneDialog, `${label}: ${action} closes sheet before its existing dialog`);
    if (!oneDialog) return;
    await backDialog(page);
    await page.waitForFunction(() => !document.querySelector('#ask').open);
    check(await page.$eval('#android-list-options', (node) => document.activeElement === node),
      `${label}: ${action} cancellation returns to visible list options`);
  }
  check(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return state.listOrder.length === 1 && state.lists[state.listOrder[0]].name === 'Hickman to Secret Wars: minimal';
  }), `${label}: cancelling management leaves the list intact`);
  await click(page, '#android-list-options');
  await click(page, '#list-export > summary');
  await click(page, '#btn-export-order');
  await page.waitForSelector('#ask[open]');
  check(await page.$$eval('dialog[open]', (dialogs) => dialogs.length === 1),
    `${label}: nested export opens only the existing confirmation`);
  await backDialog(page);
  await page.waitForFunction(() => !document.querySelector('#ask').open);
  await click(page, '#android-list-options');
  await click(page, '#list-export > summary');
  await click(page, '#btn-export-md');
  await page.waitForSelector('#markdown-export[open]');
  check(await page.$$eval('dialog[open]', (dialogs) => dialogs.length === 1),
    `${label}: personal checklist dialog does not stack over list options`);
  await backDialog(page);
  await click(page, '#android-list-options');
  const backdrop = await page.$eval('#android-list-sheet', (node) => node.getBoundingClientRect().top);
  await page.touchscreen.tap(2, Math.max(1, backdrop / 2));
  await page.waitForFunction(() => !document.querySelector('#android-list-sheet').open);
  check(await page.$eval('#android-list-options', (node) => document.activeElement === node),
    `${label}: tapping the backdrop closes the sheet without changing the list`);
  await click(page, '#android-list-options');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#android-list-sheet').open);
  await click(page, '#view-read details.full > summary');
  await page.waitForSelector('#rows .row');
  await click(page, '#btn-hero-done');
  await click(page, '#reading-filters input[value="read"]');
  check(await page.$$eval('#rows .row', (rows) => rows.length === 1), `${label}: original reading filter selects the one read issue`);
  check(await page.evaluate(() => location.hash.includes('filter=read')), `${label}: reading filter remains addressable`);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#reading-filters input[value="all"]').checked);
  check(await page.$$eval('#rows .row', (rows) => rows.length > 1), `${label}: Back restores the reading filter and rows`);
  await click(page, '#android-list-options');
  await route(page, 'browse');
  check(await page.$eval('#android-list-sheet', (node) => !node.open),
    `${label}: navigating away dismisses list options`);
  await route(page, 'read');
  await click(page, '#android-list-options');
  await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => !document.querySelector('#android-list-sheet').open);
  check(await page.$eval('#reading-body > .list-tools', (node) => !!node.getClientRects().length),
    `${label}: widening restores original actions outside the sheet`);
}

try {
  browser = await puppeteer.launch({ executablePath: edge, headless: !process.env.MRT_HEADED, args: ['--no-first-run', '--no-default-browser-check'] });
  let viewports = [{ width: 360, height: 800 }, { width: 412, height: 915 }, { width: 800, height: 360 }];
  if (mobileUi) viewports.push({ width: 360, height: 800, textScale: 1.3 }, { width: 1280, height: 900 });
  if (seriesReadability) viewports = [
    { width: 320, height: 740 },
    { width: 360, height: 800 },
    { width: 412, height: 915 },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 1280, height: 900, desktop: true },
  ];
  const onlyViewport = process.argv.find((arg) => arg.startsWith('--viewport='))?.slice('--viewport='.length);
  if (onlyViewport) viewports = viewports.filter((viewport) => (
    `${viewport.width}x${viewport.height}${viewport.textScale ? `@${viewport.textScale}` : ''}` === onlyViewport
  ));
  assert.ok(viewports.length, `Unknown viewport: ${onlyViewport}`);
  for (const viewport of viewports) {
    root = resolve(viewport.desktop ? 'src' : ANDROID_ASSET_DIR);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    let lookupMode = 'empty';
    let appLookups = 0;
    page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
    await page.setViewport({ ...viewport, isMobile: !viewport.desktop, hasTouch: !viewport.desktop, deviceScaleFactor: 1 });
    if (seriesReadability) await seriesFixtures(page);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (seriesReadability && new URL(request.url()).origin !== origin) {
        failures.push(`Unexpected external request: ${request.url()}`);
        return request.abort();
      }
      if (request.url().startsWith('https://bifrost.marvel.com/')) {
        appLookups++;
        if (lookupMode === 'offline') return request.abort('failed');
        return request.respond({
          status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ data: { dynamicQueryOrError: { entity: {
            contents: lookupMode === 'empty' ? [] : [{ content: { id: 'https://untrusted.example/' } }],
          } } } }),
        });
      }
      if (request.url().startsWith(origin)) {
        if (request.url().endsWith('/data/catalog.json')) {
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mobileUi ? catalog : { ...catalog, lists: [orderEntry] }) });
        }
        return request.continue();
      }
      return request.respond({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'ok', ...order.items[0], items: [], data: [] }),
      });
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.addEventListener('load', () => {
        const channel = new MessageChannel();
        const harness = { requests: [], replies: [], autoSave: true };
        window.__androidTest = harness;
        harness.reply = (request, status) => channel.port1.postMessage(JSON.stringify({
          v: 1, kind: 'save-result', id: request.id, status, message: 'Test document-provider failure.',
        }));
        harness.back = () => channel.port1.postMessage(JSON.stringify({ v: 1, kind: 'back', id: 'back-check' }));
        channel.port1.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.kind === 'save') {
            harness.requests.push(message);
            if (harness.autoSave) harness.reply(message, 'saved');
          } else harness.replies.push(message);
        };
        window.dispatchEvent(new MessageEvent('message', {
          data: 'recap:connect:v1', origin: '', source: null, ports: [channel.port2],
        }));
      });
    });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    if (viewport.textScale) {
      await page.evaluate((scale) => {
        for (const name of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
          const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
          document.documentElement.style.setProperty(name, `${value * scale}px`);
        }
      }, viewport.textScale);
    }
    const label = `${viewport.width}x${viewport.height}${viewport.textScale ? ` ${viewport.textScale * 100}% text` : ''}`;
    if (seriesReadability) {
      await seriesResultReadability(page, label, !!viewport.desktop);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (launcherOnly) {
      const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      for (const mode of ['empty', 'malformed', 'offline']) {
        lookupMode = mode;
        await page.goto(`${origin}/open.html?d=38811&i=52986&t=${encodeURIComponent('<img> fixture')}`,
          { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.querySelector('#p').textContent.includes('Could not resolve'));
        check(new URL(page.url()).pathname === '/open.html', `${label} ${mode}: failure retains launcher`);
        check(await page.$eval('#fallback', (node) => node.href === 'https://read.marvel.com/#/book/38811'
          && node.textContent === 'Open in browser' && node.getBoundingClientRect().height >= 48),
        `${label} ${mode}: readable browser escape preserves digital identity`);
        check(await page.$$eval('a:not(#fallback)', (links) => links.every((node) => !node.getClientRects().length)),
          `${label} ${mode}: no app action without a validated identifier`);
        check(await page.$eval('#h', (node) => node.textContent.includes('<img>') && !node.querySelector('img')),
          `${label} ${mode}: title remains text, not markup`);
        check(await page.evaluate(() => window.opener === null && !document.querySelector('#android-report')),
          `${label} ${mode}: isolated launcher disowns opener and has no main app bridge`);
        check(await page.evaluate(() => localStorage.getItem('mrt.state.v2')) === before,
          `${label} ${mode}: no progress or schema write`);
      }
      check(appLookups === 3, `${label}: one on-demand request per attempted issue, no retries`);
      check(errors.length === 0, `${label}: no uncaught launcher errors`);
      console.log(`CHECKED ${label}: launcher error/fallback/identity/privacy DOM`);
      await context.close();
      continue;
    }
    if (mobileUi) {
      await mobileLayout(page, label, viewport.width <= 880);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      console.log(`CHECKED ${label}: reported mobile layouts and interaction contracts`);
      await context.close();
      continue;
    }
    await measure(page, `${label} Home`);
    if (noStyle) {
      assert.equal(failures.length, 0, failures.join('\n'));
      throw new Error('The missing-style mutation did not fail the Home layout assertions.');
    }
    await click(page, '#btn-rail-toggle');
    check(await page.$eval('#sidebar-panel', (node) => !node.hidden), `${label}: navigation opens`);
    await measure(page, `${label} navigation`);
    await page.evaluate(() => window.__androidTest.back());
    await page.waitForFunction(() => document.querySelector('#sidebar-panel').hidden);
    await route(page, 'browse');
    await measure(page, `${label} Browse`);
    await route(page, 'catalog');
    await page.waitForSelector('button[aria-label^="Add to library:"]');
    await measure(page, `${label} catalog`);
    await click(page, 'button[aria-label^="Add to library:"]');
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('mrt.state.v2') || '{}');
      return state.listOrder?.length === 1;
    });
    await route(page, 'read');
    await page.waitForSelector('#hero-title');
    await measure(page, `${label} Reading`);
    await click(page, '#view-read details.full > summary');
    await measure(page, `${label} full Reading List`);
    const actions = await page.$('.row-actions-toggle');
    if (actions && await actions.isVisible()) {
      await click(page, '.row-actions-toggle');
      await measure(page, `${label} issue actions`);
    }
    await click(page, '#btn-hero-done');
    check(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 1), `${label}: Done preserves progress`);
    await page.reload({ waitUntil: 'networkidle0' });
    check(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 1), `${label}: progress survives reload`);
    await route(page, 'data');
    await measure(page, `${label} Backup & settings`);
    await page.select('#opt-theme', 'light');
    await measure(page, `${label} light theme`);
    await page.select('#opt-theme', 'dark');
    await click(page, '#btn-export-json');
    await page.waitForFunction(() => window.__androidTest.requests.length === 1);
    const exported = await page.evaluate(() => JSON.parse(window.__androidTest.requests[0].text));
    check(exported.state?.listOrder?.length === 1 || exported.listOrder?.length === 1, `${label}: actual backup reaches native transport`);
    await page.evaluate(() => { window.__androidTest.autoSave = false; });
    await click(page, '#btn-export-json');
    await page.waitForFunction(() => window.__androidTest.requests.length === 2);
    await page.evaluate(() => window.__androidTest.reply(window.__androidTest.requests[1], 'cancelled'));
    await page.waitForFunction(() => document.querySelector('#android-report').textContent.includes('cancelled'));
    check(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 1), `${label}: cancelled export does not mutate progress`);
    await click(page, '#btn-wipe');
    await page.waitForSelector('dialog[open]');
    await measure(page, `${label} dialog`);
    await page.evaluate(() => window.__androidTest.back());
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length === 1), `${label}: Android Back cancels destructive dialog`);
    for (const name of ['library', 'progress', 'reading-paths', 'add', 'add-search', 'add-series', 'add-creator', 'add-import', 'add-manual', 'about']) {
      await route(page, name);
      await measure(page, `${label} ${name}`);
    }
    if (process.env.MRT_ANDROID_SCREENSHOTS) {
      await mkdir(process.env.MRT_ANDROID_SCREENSHOTS, { recursive: true });
      await route(page, 'read');
      await page.screenshot({ path: join(process.env.MRT_ANDROID_SCREENSHOTS, `android-${label}.png`), fullPage: true });
    }
    await page.goto(`${origin}/open.html`, { waitUntil: 'networkidle0' });
    const launch = await page.evaluate(() => ({
      font: parseFloat(getComputedStyle(document.querySelector('#p')).fontSize),
      target: document.querySelector('#fallback').getBoundingClientRect().height,
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
    }));
    check(launch.font >= 16 && launch.target >= 48 && launch.fits, `${label}: launcher copy and manual fallback remain readable and tappable`);
    check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
    console.log(`PASS ${label}: layout, navigation, reading, reload, backup/cancel, theme and Back`);
    await context.close();
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log(`${assertions} Android web assertions passed. Native WebView/device behavior is not simulated proof.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
