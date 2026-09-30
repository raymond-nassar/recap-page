import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CSP } from '../server.mjs';
import { prepareAndroid, ANDROID_ASSET_DIR } from './prepare-android.mjs';
import { LOCAL_SERVER_HEALTH_PATH, LOCAL_SERVER_HEADER_NAME, LOCAL_SERVER_HEADER_VALUE } from '../src/js/lib/localServer.js';
import { createEmptyState, createList, addIssuesToList, setIssueNote, markRead, setDeferred, setOverride } from '../src/js/lib/model.js';
import { KEY } from '../src/js/storage.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { issuePresentation } from '../src/js/lib/issueFocus.js';
import { availableHomeCategories, groupCatalog, HOME_CATEGORIES, publishingAgeGroups, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { parseRoute } from '../src/js/lib/route.js';
import { catalogCardProfiles, catalogCardReadability } from './browser-android-catalog-cards.mjs';

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
const noteReadability = process.argv.includes('--only=note-readability');
const categoryReadability = process.argv.includes('--only=category-readability');
const marvelAgesTarget = process.argv.includes('--only=marvel-ages-target');
const catalogReadability = process.argv.includes('--only=catalog-cards');
const readingFactsAx = process.argv.includes('--only=reading-facts-ax');
const readingComposition = process.argv.includes('--only=reading-composition') || readingFactsAx;
const readingCaseArg = process.argv.find((arg) => arg.startsWith('--reading-composition-case='));
const readingCase = readingCaseArg?.slice('--reading-composition-case='.length);
if (readingCaseArg !== undefined) {
  assert.ok(readingComposition && !readingFactsAx && readingCase === 'M01' && process.argv.includes('--viewport=360x800'),
    'Reading case selection must be M01 with --only=reading-composition --viewport=360x800');
}
if (readingFactsAx) {
  assert.ok(process.env.MRT_READING_AX_EVIDENCE && !process.env.MRT_ANDROID_SCREENSHOTS
    && !process.argv.some((arg) => arg.startsWith('--viewport=') || arg.startsWith('--case=')),
  'Factual AX confirmation requires MRT_READING_AX_EVIDENCE, all five mobile profiles, and no screenshots');
}
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

async function categoryFixtures(page) {
  await page.evaluateOnNewDocument(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin !== location.origin) {
        if (url.pathname === '/v1/health') return new Response('{"status":"ok"}', {
          headers: { 'content-type': 'application/json' },
        });
        throw new Error(`Unexpected category fixture request: ${url.href}`);
      }
      return original(input, options);
    };
  });
}

async function marvelAgesTouchTarget(page, label, viewport) {
  await route(page, 'marvel-ages');
  const selector = '#marvel-ages-modern-all';
  await page.waitForSelector(selector, { visible: true });
  const result = await page.$eval(selector, (node) => {
    const { width, height, left, right, top, bottom } = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const words = [], broken = [], clipped = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      for (const match of text.textContent.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
        words.push(match[0]);
        if (rects.length !== 1) broken.push(match[0]);
        if (rects.some((rect) => rect.left < left || rect.right > right
          || rect.top < top || rect.bottom > bottom)) clipped.push(match[0]);
      }
    }
    return {
      width, height, words, broken, clipped,
      text: node.textContent, name: node.getAttribute('aria-label'),
      tag: node.tagName, type: node.type, tabIndex: node.tabIndex, disabled: node.disabled,
      font: parseFloat(style.fontSize), padding: style.padding,
      minHeight: style.minHeight, direction: getComputedStyle(node.parentElement).flexDirection,
      androidStyle: !!document.querySelector('link[href="./android/mobile.css"]'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  const { modern } = publishingAgeGroups(groupCatalog(catalog.lists));
  assert.ok(modern, 'Bundled catalog must expose the Modern Age navigation action');
  check(result.text === 'Browse all Modern Age Reading Lists'
    && result.name === `${result.text}: ${modern.label}, ${modern.count} Reading Lists`,
  `${label}: exact visible and accessible labels`);
  check(result.tag === 'BUTTON' && result.type === 'button' && result.tabIndex === 0 && !result.disabled,
    `${label}: incumbent native navigation button semantics`);
  check(result.androidStyle === !viewport.desktop, `${label}: actual platform entry stylesheet`);
  check(result.font === (viewport.desktop ? 14 : 16 * (viewport.textScale || 1)) && result.padding === '4px 12px',
    `${label}: unchanged text scale and padding ${JSON.stringify(result)}`);
  check(result.width >= 48 && result.height >= (viewport.desktop ? 44 : 48),
    `${label}: actual browse-all hit rectangle ${result.width}x${result.height}`);
  check(result.words.length === 6 && result.broken.length === 0 && result.clipped.length === 0,
    `${label}: all label words stay whole and inside the control ${JSON.stringify(result)}`);
  check(!result.overflow, `${label}: no horizontal page overflow`);
  if (viewport.desktop) {
    check(result.height === 44 && result.minHeight === '44px' && result.direction === 'row',
      `${label}: shared desktop keeps its 44px control and horizontal heading layout`);
  }
  await page.focus('#marvel-ages-h');
  for (let step = 0; step < 20; step++) {
    await page.keyboard.press('Tab');
    if (await page.$eval(selector, (node) => document.activeElement === node)) break;
  }
  assert.ok(await page.$eval(selector, (node) => document.activeElement === node),
    `${label}: browse-all is reachable in the existing tab order`);
  check(await page.$eval(selector, (node) => {
    const style = getComputedStyle(node);
    return node.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  }), `${label}: keyboard focus remains visible`);
  await screenshot(page, label, 'marvel-ages-target');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-age-modern:not([hidden])');
  check(await page.evaluate(() => location.hash === '#/age-modern' && document.activeElement.id === 'age-modern-h'),
    `${label}: keyboard activation preserves route and destination focus`);
  if (!viewport.desktop) {
    await route(page, 'marvel-ages');
    await page.waitForSelector(selector, { visible: true });
    await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
    const point = await page.$eval(selector, (node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForSelector('#view-age-modern:not([hidden])');
    check(await page.evaluate(() => location.hash === '#/age-modern' && document.activeElement.id === 'age-modern-h'
      && !document.documentElement.classList.contains('android-keyboard')),
    `${label}: touch activation preserves route and destination focus without keyboard modality`);
  }
  console.log(`CHECKED ${label}: Marvel Ages browse-all ${JSON.stringify(result)}`);
}

async function categoryLabelReadability(page, label, viewport) {
  const categories = availableHomeCategories(groupCatalog(catalog.lists), HOME_CATEGORIES,
    resolveReadingPaths(catalog.paths, catalog.lists));
  assert.equal(categories.length, HOME_CATEGORIES.length, 'Bundled fixture must expose every Home category');
  const scale = viewport.textScale || 1;
  for (const view of ['home', 'browse']) {
    await route(page, view);
    await page.waitForFunction((id, count) => document.querySelectorAll(`#view-${id} .home-path`).length === count,
      {}, view, categories.length);
    const result = await page.evaluate((id) => {
      const bounds = (node) => {
        const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const inside = (rect, box) => rect.left >= box.left - 1 && rect.right <= box.right + 1
        && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
      const fitsWidth = (rect, box) => rect.left >= box.left - 1 && rect.right <= box.right + 1;
      return {
        androidStyle: !!document.querySelector('link[href="./android/mobile.css"]'),
        body: parseFloat(getComputedStyle(document.body).fontSize),
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        cards: [...document.querySelectorAll(`#view-${id} .home-path`)].map((card) => {
          const copy = card.querySelector('.home-path-copy');
          const words = [], broken = [], clipped = [];
          const parts = ['label', 'title', 'count'].map((role) => {
            const node = card.querySelector(`.home-path-${role}`);
            const style = getComputedStyle(node);
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const text = walker.currentNode;
              for (const match of text.textContent.matchAll(/\S+/g)) {
                const range = document.createRange();
                range.setStart(text, match.index);
                range.setEnd(text, match.index + match[0].length);
                const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
                words.push(match[0]);
                if (rects.length !== 1) broken.push({ word: match[0], lines: rects.length });
                if (rects.some((rect) => !fitsWidth(rect, bounds(node)) || !fitsWidth(rect, bounds(copy))
                  || !inside(rect, bounds(card)))) clipped.push(match[0]);
              }
            }
            return {
              text: node.textContent, font: parseFloat(style.fontSize),
              family: style.fontFamily, transform: style.textTransform, tracking: parseFloat(style.letterSpacing),
            };
          });
          return {
            key: card.dataset.category, name: card.getAttribute('aria-label'), parts,
            box: bounds(card), copy: bounds(copy), icon: bounds(card.querySelector('.home-path-icon')),
            words, broken, clipped,
          };
        }),
      };
    }, view);
    check(result.androidStyle === !viewport.desktop, `${label} ${view}: correct platform stylesheet`);
    check(result.root === 16 && result.body === (viewport.desktop ? 14 : 16 * scale),
      `${label} ${view}: text-only scaling leaves root spacing unchanged`);
    check(!result.overflow, `${label} ${view}: no horizontal page overflow`);
    for (const [index, card] of result.cards.entries()) {
      const category = categories[index];
      const count = `${category.count} ${category.count === 1
        ? (category.singular ?? 'Reading List') : (category.plural ?? 'Reading Lists')}`;
      check(card.key === category.key && card.name === `${category.heading}. ${category.label}. ${count}.`
        && JSON.stringify(card.parts.map((part) => part.text)) === JSON.stringify([category.label, category.heading, count]),
      `${label} ${view}: ${category.key}: exact wording, order and accessible name`);
      const caption = (viewport.desktop ? 12 : 14) * scale;
      const title = category.tier === 'secondary' ? 28 * scale : viewport.desktop ? 28.8 : 20;
      check(card.parts[0].font === caption && Math.abs(card.parts[1].font - title) < 0.01
        && card.parts[2].font === caption && card.parts.every((part) => part.family === card.parts[0].family),
      `${label} ${view}: ${category.key}: existing computed type sizes ${JSON.stringify(card.parts)}`);
      check(card.box.width >= (viewport.desktop ? 44 : 48) && card.box.height >= (viewport.desktop ? 44 : 48),
        `${label} ${view}: ${category.key}: category touch target`);
      check(card.words.length >= 5 && card.broken.length === 0,
        `${label} ${view}: ${category.key}: whole rendered words ${JSON.stringify(card.broken)}`);
      check(card.clipped.length === 0,
        `${label} ${view}: ${category.key}: text stays inside copy and clipping card ${JSON.stringify(card.clipped)}`);
      if (viewport.desktop) {
        check(card.copy.left > card.icon.right && card.parts[0].transform === 'uppercase'
          && Math.abs(card.parts[0].tracking - caption * 0.16) < 0.01,
        `${label} ${view}: ${category.key}: desktop grid and eyebrow treatment retained`);
      }
    }
    await page.$eval(`#view-${view} [data-category="marvel-ages"]`, (node) => node.scrollIntoView());
    await screenshot(page, label, `${view}-categories`);
    console.log(`CHECKED ${label} ${view}: ${result.cards.length} categories, ${result.cards.reduce((n, card) => n + card.words.length, 0)} words; Publication ${JSON.stringify(result.cards.find((card) => card.key === 'marvel-ages'))}`);
  }
  if (viewport.width === 360 && scale === 2) {
    for (const category of categories) {
      await route(page, 'browse');
      await click(page, `#view-browse [data-category="${category.key}"]`);
      await page.waitForSelector(`#view-${category.route}:not([hidden])`);
      check(parseRoute(new URL(page.url()).hash)?.view === category.route,
        `${label}: ${category.key}: original destination`);
    }
  }
}

const NOTE_REFERENCE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const NOTE_CASES = [
  ['prose', 'Synthetic note with ordinary words that should wrap at spaces and stay fully readable.'],
  ['reference', `Synthetic note with ordinary words and an unbroken reference: ${NOTE_REFERENCE}`],
  ['url', `Synthetic note with a long URL: https://example.invalid/${NOTE_REFERENCE}`],
];
let noteState = createList(createEmptyState(), { id: 'note-fixture', name: 'Note readability' });
noteState = addIssuesToList(noteState, 'note-fixture', NOTE_CASES.map(([name], index) => ({
  issueId: -900100 - index, title: `Note fixture #${index + 1}`, issueNumber: String(index + 1),
  seriesName: `${name} note fixture`,
}))).state;
for (const [index, [, note]] of NOTE_CASES.entries()) {
  noteState = setIssueNote(noteState, -900100 - index, note);
}

async function noteFixtures(page) {
  await page.evaluateOnNewDocument((state) => {
    if (!localStorage.getItem('mrt.state.v2')) localStorage.setItem('mrt.state.v2', JSON.stringify(state));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const json = (value) => new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      });
      if (url.pathname === '/data/catalog.json') return json({ lists: [] });
      if (url.origin !== location.origin) {
        if (url.pathname === '/v1/health') return json({ status: 'ok' });
        throw new Error(`Unexpected note fixture request: ${url.href}`);
      }
      return originalFetch(input, options);
    };
    const originalBlobUrl = URL.createObjectURL.bind(URL);
    window.__noteExports = [];
    URL.createObjectURL = (blob) => {
      window.__noteExports.push(blob.text());
      return originalBlobUrl(blob);
    };
    document.addEventListener('click', (event) => {
      if (event.target.closest('a[download]')) event.preventDefault();
    }, true);
  }, noteState);
}

async function issueNoteReadability(page, label, desktop) {
  const saved = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  for (const [index, [name, note]] of NOTE_CASES.entries()) {
    await page.evaluate((id) => { location.hash = `#/issue/${id}?list=note-fixture`; }, -900100 - index);
    await page.waitForFunction((text) => {
      const node = document.querySelector('#issue-focus-note');
      return !document.querySelector('#view-issue').hidden && !node.hidden && node.textContent === text;
    }, {}, note);
    const result = await page.evaluate(() => {
      const node = document.querySelector('#issue-focus-note');
      const bounds = (element) => {
        const { left, right, top, bottom, width } = element.getBoundingClientRect();
        return { left, right, top, bottom, width };
      };
      let clip = node.parentElement;
      while (clip && !/(hidden|clip|auto|scroll)/.test(
        `${getComputedStyle(clip).overflowX} ${getComputedStyle(clip).overflowY}`,
      )) clip = clip.parentElement;
      const noteBox = bounds(node), clipBox = clip && bounds(clip);
      const inside = (rect, box) => box && rect.left >= box.left - 1 && rect.right <= box.right + 1
        && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
      const textRects = [], brokenWords = [], tokenLines = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let words = 0;
      while (walker.nextNode()) {
        const text = walker.currentNode;
        const range = document.createRange();
        range.selectNodeContents(text);
        textRects.push(...[...range.getClientRects()].filter((rect) => rect.width && rect.height));
        for (const match of text.textContent.matchAll(/\S+/g)) {
          range.setStart(text, match.index);
          range.setEnd(text, match.index + match[0].length);
          const lines = [...range.getClientRects()].filter((rect) => rect.width && rect.height).length;
          if (match[0].length < 36) {
            words++;
            if (lines !== 1) brokenWords.push(match[0]);
          } else tokenLines.push(lines);
        }
      }
      return {
        text: node.textContent, noteBox, clipBox, clipId: clip?.id,
        textRight: Math.max(...textRects.map((rect) => rect.right)),
        lines: textRects.length, words, brokenWords, tokenLines,
        outsideNote: textRects.filter((rect) => !inside(rect, noteBox)).length,
        outsideClip: textRects.filter((rect) => !inside(rect, clipBox)).length,
        body: parseFloat(getComputedStyle(document.body).fontSize),
        wrap: getComputedStyle(node).overflowWrap,
        androidStyle: !!document.querySelector('link[href="./android/mobile.css"]'),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    const prefix = `${label} ${name}`;
    check(result.text === note, `${prefix}: exact complete note string retained`);
    check(result.androidStyle === !desktop && result.body === (desktop ? 14 : label.includes('150%') ? 24 : 16),
      `${prefix}: incumbent entry and body size retained (${result.body}px)`);
    check(result.lines > 0 && result.words > 5 && result.brokenWords.length === 0,
      `${prefix}: ordinary words retain natural wrapping ${JSON.stringify(result.brokenWords)}`);
    check(result.clipId === 'issue-focus-card', `${prefix}: measured nearest clipping hero, not just page width`);
    check((desktop || result.outsideNote === 0) && result.outsideClip === 0,
      `${prefix}: all descendant text rectangles fit ${desktop ? 'clipping hero' : 'note and clipping hero'} ${JSON.stringify(result)}`);
    check(!result.overflow, `${prefix}: no horizontal document overflow`);
    check(desktop ? result.wrap === 'normal' : name === 'prose' || result.tokenLines.some((lines) => lines > 1),
      `${prefix}: ${desktop ? 'desktop wrapping unchanged' : 'long reference or URL emergency wraps'}`);
    await page.$eval('#issue-focus-note', (node) => node.scrollIntoView({ block: 'center' }));
    await screenshot(page, label, `note-${name}`);
    console.log(`CHECKED ${prefix}: ${JSON.stringify(result)}`);
  }
  await route(page, 'data');
  await click(page, '#btn-export-json');
  await page.waitForFunction((isDesktop) => isDesktop
    ? window.__noteExports.length === 1 : window.__androidTest.requests.length === 1, {}, desktop);
  const exported = await page.evaluate(async (isDesktop) => JSON.parse(isDesktop
    ? await window.__noteExports[0] : window.__androidTest.requests[0].text), desktop);
  check(JSON.stringify(exported.notes) === JSON.stringify(noteState.notes),
    `${label}: actual backup payload preserves every complete note`);
  check(await page.evaluate(() => localStorage.getItem('mrt.state.v2')) === saved,
    `${label}: viewing and exporting leave saved state byte-for-byte unchanged`);
}

const READING_LIST = 'reading-composition';
const READING_SYNOPSIS = 'Original synthetic description for the reading composition check. It stays hidden until deliberately revealed, then wraps without covering any action.';
const readingProfiles = [
  { id: 'M01', width: 360, height: 800 },
  { id: 'M03', width: 412, height: 915 },
  { id: 'M04', width: 320, height: 740, long: true },
  { id: 'M05', width: 360, height: 800, textScale: 1.5 },
  { id: 'M06', width: 360, height: 800, textScale: 2, long: true },
  { id: 'D01', width: 1280, height: 900, desktop: true },
];
let readingOrder;
if (readingComposition) {
  const entry = catalog.lists.find((list) => list.id === 'hickman-minimal');
  assert.ok(entry, 'Reading composition requires the measured Hickman order');
  readingOrder = JSON.parse(await readFile(new URL(`../src/data/${entry.file}`, import.meta.url)));
  assert.equal(readingOrder.items.length, 89);
  const item = readingOrder.items[3];
  assert.deepEqual([item.issueId, item.digitalId, item.title], [43534, 28116, 'Avengers (2012) #4']);
}

function readingState(profile = {}) {
  let state = createList(createEmptyState(), {
    id: READING_LIST, name: readingOrder.name, description: readingOrder.description,
    catalogId: readingOrder.id,
  });
  state = addIssuesToList(state, READING_LIST, readingOrder.items).state;
  for (const item of readingOrder.items.slice(0, 3)) state = markRead(state, item.issueId, true, 1767225600000);
  if (profile.long) {
    state.lists[READING_LIST].name = 'Hickman to Secret Wars: a deliberately long Reading List title with every word retained';
    state.issues[43534].title = 'Avengers (2012) #4: a long issue title with each word kept and room to read at a larger text size';
  }
  return state;
}

async function readingFixtures(page, profile) {
  await page.evaluateOnNewDocument((state, key, educationKey, educationValue, synopsis, allowSynopsis) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem(educationKey, educationValue);
    const original = window.fetch.bind(window);
    window.__readingTest = { opens: [], requests: [] };
    window.open = (...args) => { window.__readingTest.opens.push(args); return {}; };
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const json = (value) => Promise.resolve(new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      }));
      if (url.origin === location.origin) return original(input, options);
      if (url.pathname === '/v1/health') return json({ status: 'ok' });
      const match = /^\/v1\/issues\/(\d+)$/.exec(url.pathname);
      if (allowSynopsis && match && Number(match[1]) === 43534) {
        window.__readingTest.requests.push(Number(match[1]));
        return json({ ...state.issues[Number(match[1])], description: synopsis });
      }
      throw new Error(`Unexpected reading fixture request: ${url.href}`);
    };
  }, readingState(profile), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE,
  READING_SYNOPSIS, profile.id === 'M05');
}

async function readingGeometry(page) {
  return page.evaluate(() => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const hero = document.querySelector('#hero');
    const art = hero.querySelector('.art');
    const visible = (node) => !!node.getClientRects().length && !node.closest('[hidden]');
    const inside = (rect, bounds) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1
      && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const parts = [...document.querySelectorAll('#order-name, #order-sub, #ring-label, #ring-sub, #hero .eyebrow, #hero-title, #hero-by, #hero-desc, #hero-facts dt, #hero-facts dd, #hero-fb > span, #hero .btn')];
    const clipped = [], overlaps = [];
    let ranges = 0;
    for (const node of parts.filter(visible)) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of [...range.getClientRects()].filter((entry) => entry.width && entry.height)) {
          ranges++;
          const bounds = box(node);
          // Text ink can exceed a non-clipping line box; clipping ancestors own vertical containment.
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1
            || (node.matches('.btn') && !inside(rect, bounds))) clipped.push(node.id || node.tagName);
          for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (/(hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`) && !inside(rect, box(ancestor))) {
              clipped.push(node.id || node.tagName);
            }
          }
          if (node.closest('.hero-body') && intersects(rect, box(art))) overlaps.push(node.id || node.tagName);
        }
      }
    }
    const read = document.querySelector('#btn-hero-read');
    const controls = [...hero.querySelectorAll('.btn')].filter(visible).map((node) => ({
      id: node.id, text: node.textContent.trim(), box: box(node),
      font: parseFloat(getComputedStyle(node).fontSize),
    }));
    for (const [index, control] of controls.entries()) {
      if (controls.slice(index + 1).some((other) => intersects(control.box, other.box))) overlaps.push(control.id);
    }
    return {
      title: document.querySelector('#order-name').textContent,
      issue: document.querySelector('#hero-title').textContent,
      byline: document.querySelector('#hero-by').textContent,
      count: document.querySelector('#ring-sub').textContent,
      facts: [...document.querySelectorAll('#hero-facts > div')].map((node) => ({
        key: node.querySelector('dt').textContent, value: node.querySelector('dd').textContent,
      })),
      scroll: scrollY, body: parseFloat(getComputedStyle(document.body).fontSize),
      titleFont: parseFloat(getComputedStyle(document.querySelector('#order-name')).fontSize),
      issueFont: parseFloat(getComputedStyle(document.querySelector('#hero-title')).fontSize),
      android: !!document.querySelector('link[href="./android/mobile.css"]'),
      header: box(document.querySelector('#view-read > .head')), hero: box(hero), art: box(art),
      issueBox: box(document.querySelector('#hero-title')), factsBox: box(document.querySelector('#hero-facts')),
      controls, read: box(read), readVisible: visible(read), readDisabled: read.disabled,
      readCount: document.querySelectorAll('#btn-hero-read').length,
      ranges, clipped, overlaps, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      image: { shown: visible(document.querySelector('#hero-img')), loaded: document.querySelector('#hero-img').naturalWidth > 0 },
    };
  });
}

async function readingEvidence(page, profile, id = profile.id) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const result = await readingGeometry(page);
  result.sourceRevision = JSON.parse(await readFile(join(ANDROID_ASSET_DIR, 'build-info.json'), 'utf8')).sourceRevision;
  const state = readingState(profile);
  const presentation = issuePresentation(state.issues[43534], { position: 4, total: 89 });
  assert.ok(result.readCount === 1 && result.readVisible && !result.readDisabled
    && Number.isFinite(result.read.bottom) && result.read.height > 0, `${id}: positive Read measurement`);
  assert.equal(result.issue, state.issues[43534].title, `${id}: exact fixture issue`);
  if (process.env.MRT_ANDROID_SCREENSHOTS) {
    const output = process.env.MRT_ANDROID_SCREENSHOTS;
    await mkdir(output, { recursive: true });
    assert.ok(!existsSync(join(output, `reading-${id}.png`)) && !existsSync(join(output, `reading-${id}.json`)),
      `${id}: use a fresh numbered evidence directory, never overwrite an earlier attempt`);
    await writeFile(join(output, `reading-${id}.json`), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    await page.screenshot({ path: join(output, `reading-${id}.png`), fullPage: !['M01', 'M02'].includes(id) });
  }
  console.log(`READING ${id}: ${JSON.stringify(result)}`);
  check(result.title === state.lists[READING_LIST].name && result.byline === presentation.byline
    && result.count === '3 of 89 read', `${id}: full title, byline and progress preserved`);
  check(JSON.stringify(result.facts) === JSON.stringify(presentation.facts.map(({ key, value }) => ({ key, value }))),
    `${id}: every exact factual value retained`);
  const scale = profile.textScale || 1;
  check(result.body === (profile.desktop ? 14 : 16 * scale) && result.titleFont === 28 * scale
    && result.issueFont === (profile.desktop ? 40 : 32 * scale) && result.android === !profile.desktop,
  `${id}: actual platform and unchanged text scale`);
  check(result.ranges > 15 && !result.clipped.length && !result.overlaps.length && !result.overflow,
    `${id}: measured text/control containment ${JSON.stringify({ clipped: result.clipped, overlaps: result.overlaps })}`);
  check(result.controls.length === 5 + (id.startsWith('M05') ? 1 : 0)
    && result.controls.every(({ box }) => box.width >= 48 && box.height >= (profile.desktop ? 44 : 48)),
  `${id}: all existing action hit rectangles`);
  if (['M01', 'M02'].includes(id)) {
    check(result.scroll === 0 && result.read.left >= 0 && result.read.right <= 360 && result.read.top >= 0
      && result.read.bottom <= 800, `${id}: complete primary Read bottom <=800 (actual ${result.read.bottom})`);
    check(result.image.shown === (id === 'M02') && (id !== 'M02' || result.image.loaded),
      `${id}: intended fallback or original synthetic-image geometry`);
  }
  if (profile.desktop && !process.argv.includes('--viewport=1280x900')) {
    assert.ok(process.env.MRT_READING_BASELINE, 'Full reading batch requires the retained desktop baseline directory');
    const baseline = JSON.parse(await readFile(join(process.env.MRT_READING_BASELINE, 'reading-D01.json'), 'utf8'));
    const signature = ({ header, hero, art, issueBox, factsBox, controls, body, titleFont, issueFont }) => (
      { header, hero, art, issueBox, factsBox, controls, body, titleFont, issueFont }
    );
    check(JSON.stringify(signature(result)) === JSON.stringify(signature(baseline)), 'D01: unchanged shared desktop geometry');
  }
  return result;
}

async function readingAccessibility(page, result, id) {
  const client = await page.createCDPSession();
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#hero' });
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
    const hero = nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId);
    assert.ok(hero, `${id}: hero accessibility node exists`);
    const walk = (entry) => entry ? [
      ...(!entry.ignored ? [{ role: entry.role.value, name: entry.name?.value }] : []),
      ...(entry.childIds || []).flatMap((key) => walk(byId.get(key))),
    ] : [];
    const tree = walk(hero);
    const domFacts = await page.$$eval('#hero-facts > div', (pairs) => pairs.map((pair) => {
      const term = pair.querySelector('dt'), definition = pair.querySelector('dd');
      return {
        termTag: term?.tagName, definitionTag: definition?.tagName,
        key: term?.textContent, value: definition?.textContent,
        renderedKey: term?.innerText, textTransform: term && getComputedStyle(term).textTransform,
      };
    }));
    if (readingFactsAx) {
      const output = process.env.MRT_READING_AX_EVIDENCE;
      await mkdir(output, { recursive: true });
      await writeFile(join(output, `${id}-facts-ax.json`), `${JSON.stringify({
        profile: id, expectedFacts: result.facts, domFacts, heroSequence: tree, rawAxNodes: nodes,
      }, null, 2)}\n`, { flag: 'wx' });
    }
    assert.equal(domFacts.length, result.facts.length, `${id}: original factual pair count`);
    let previous = tree.findIndex((entry) => entry.role === 'heading' && entry.name === result.issue);
    assert.ok(previous >= 0, `${id}: named issue heading retained in accessibility tree`);
    previous = tree.findIndex((entry, at) => at > previous && entry.role === 'StaticText' && entry.name === result.byline);
    assert.ok(previous >= 0, `${id}: exact byline precedes facts`);
    for (const [index, fact] of result.facts.entries()) {
      const dom = domFacts[index];
      assert.ok(dom.termTag === 'DT' && dom.definitionTag === 'DD'
        && dom.key === fact.key && dom.value === fact.value, `${id}: exact original dt/dd pair ${index}`);
      assert.ok(dom.textTransform === 'uppercase' && dom.renderedKey === fact.key.toUpperCase(),
        `${id}: only the inherited uppercase presentation may change the label spelling`);
      const term = tree.findIndex((entry, at) => at > previous
        && entry.role === 'StaticText' && entry.name === dom.renderedKey);
      const definition = tree.findIndex((entry, at) => at > term
        && entry.role === 'StaticText' && entry.name === fact.value);
      const matches = term > previous && definition > term;
      check(matches, `${id}: exact rendered AX label/value order for ${fact.key}`);
      assert.ok(matches, `${id}: unexpected factual AX mismatch; inspect retained raw evidence before proceeding`);
      previous = definition;
    }
    if (readingFactsAx) return;
    const names = result.controls.filter((control) => control.id !== 'btn-hero-description').map((control) => control.text);
    for (const name of names) {
      const index = tree.findIndex((entry, at) => at > previous && entry.name?.startsWith(name));
      check(index > previous, `${id}: meaningful accessibility sequence includes ${name}`);
      previous = index;
    }
  } finally {
    await client.detach();
  }
  await page.focus('#order-name');
  const expected = ['#order-desc > summary', '#android-list-options',
    ...result.controls.map((control) => `#${control.id}`)];
  for (const selector of expected) {
    await page.keyboard.press('Tab');
    check(await page.$eval(selector, (node) => document.activeElement === node), `${id}: native Tab reaches ${selector}`);
    check(await page.$eval(selector, (node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && (node === hit || node.contains(hit))
        && node.matches(':focus-visible') && style.outlineStyle !== 'none';
    }), `${id}: focused control visible and unobscured`);
  }
}

async function readingReplaceState(page, state) {
  await page.evaluate((key, value) => localStorage.setItem(key, JSON.stringify(value)), KEY, state);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#view-read:not([hidden])');
}

async function readingSemantics(page) {
  const saved = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await click(page, '#order-desc > summary');
  check(await page.$eval('#order-desc', (node) => node.open), 'M01: About expands normally');
  await click(page, '#order-desc > summary');
  await click(page, '#android-list-options');
  await backDialog(page);
  check(await page.$eval('#android-list-options', (node) => document.activeElement === node),
    'M01: list-sheet Back restores focus');
  await page.focus('#btn-hero-inspect');
  await click(page, '#btn-hero-inspect');
  await page.waitForFunction(() => document.querySelector('#view-issue')?.hidden === false
    && document.querySelector('#issue-focus-h')?.textContent === 'Avengers (2012) #4');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#view-read')?.hidden === false
    && document.activeElement?.id === 'btn-hero-inspect');
  await click(page, '#btn-hero-read');
  check(await page.evaluate((key, before) => localStorage.getItem(key) === before
    && window.__readingTest.opens.length === 1 && window.__readingTest.requests.length === 0, KEY, saved),
  'M01: inspect/disclosure/inert Read preserve state and do not fetch or launch a real reader');
  await click(page, '#btn-hero-done');
  await page.waitForFunction(() => document.querySelector('#hero-title')?.textContent === 'Avengers (2012) #5');
  check(await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    return Object.keys(state.read).length === 4 && Object.hasOwn(state.read, 43534);
  }, KEY), 'M01: Done marks exactly the current issue');
  await click(page, '#btn-hero-defer');
  await page.waitForFunction(() => document.querySelector('#hero-title')?.textContent === 'Avengers (2012) #6');
  check(await page.evaluate((key, list) => {
    const state = JSON.parse(localStorage.getItem(key));
    return Object.keys(state.read).length === 4 && state.lists[list].deferredIssueIds.includes(43535)
      && !Object.hasOwn(state.read, 43535);
  }, KEY, READING_LIST), 'M01: Defer changes queue without marking read');

  for (const kind of ['completed', 'all-deferred', 'empty', 'manual']) {
    let state = readingState();
    if (kind === 'completed') for (const item of readingOrder.items) state = markRead(state, item.issueId, true, 1767225600000);
    if (kind === 'all-deferred') for (const item of readingOrder.items.slice(3)) state = setDeferred(state, READING_LIST, item.issueId);
    if (kind === 'empty' || kind === 'manual') {
      state = createList(createEmptyState(), { id: READING_LIST, name: `Reading ${kind}` });
      if (kind === 'manual') state = addIssuesToList(state, READING_LIST, [{
        issueId: -620, title: 'Manual issue without a digital reference', number: '1', source: 'manual',
      }]).state;
    }
    await readingReplaceState(page, state);
    const selector = kind === 'completed' ? '#all-read' : kind === 'all-deferred' ? '#all-deferred'
      : kind === 'empty' ? '#reading-empty' : '#hero';
    await page.waitForSelector(selector, { visible: true });
    check(await page.$eval('#btn-hero-read', (node) => node.getClientRects().length === 0),
      `M01 ${kind}: no effective Read control`);
    check(await page.$eval('#hero', (node, expected) => node.hidden === expected, kind !== 'manual'),
      `M01 ${kind}: intended hero visibility`);
    if (kind === 'manual') {
      for (const control of ['inspect', 'done', 'defer']) check(await page.$eval(`#btn-hero-${control}`,
        (node) => node.getClientRects().length > 0), `M01 manual: ${control} remains reachable`);
    }
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await route(page, 'read');
    check(await page.evaluate((key) => localStorage.getItem(key), KEY) === before, `M01 ${kind}: render preserves saved state`);
  }
  for (const [mu, override, label] of [
    [null, null, '? Availability unknown'], ['2999-01-01', null, 'soon Scheduled 2999-01-01'],
    ['2014-02-27', null, 'MU Expected in Unlimited'], [null, 'available', 'MU\u2713 You marked available'],
    [null, 'unavailable', 'no You marked unavailable'],
  ]) {
    let state = readingState();
    state.issues[43534].mu = mu;
    if (override) state = setOverride(state, 43534, override);
    await readingReplaceState(page, state);
    await page.waitForFunction((expected) => document.querySelector('#hero-facts dd')?.textContent === expected, {}, label);
    check(await page.$eval('#hero-facts dt', (node) => node.textContent === 'In Unlimited'),
      `M01 ${label}: factual label retained`);
    const geometry = await readingGeometry(page);
    check(!geometry.clipped.length && !geometry.overlaps.length && !geometry.overflow, `M01 ${label}: readable status, not a boolean`);
  }
}

async function readingCompositionCheck(page, profile) {
  await route(page, 'read');
  await page.waitForFunction((expected) => document.querySelector('#hero-title')?.textContent === expected,
    {}, readingState(profile).issues[43534].title);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  if (profile.id === 'M05') {
    await page.focus('#btn-hero-inspect');
    await click(page, '#btn-hero-inspect');
    await page.waitForFunction(() => document.querySelector('#view-issue')?.hidden === false
      && document.querySelector('#issue-focus-h')?.textContent === 'Avengers (2012) #4');
    await click(page, '#btn-issue-synopsis');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction((text) => document.querySelector('#issue-focus-desc')?.textContent === text
      && document.querySelector('#btn-issue-description')?.getAttribute('aria-expanded') === 'true',
    {}, READING_SYNOPSIS);
    assert.ok(await page.evaluate(() => JSON.stringify(window.__readingTest.requests) === '[43534]'),
      'M05: exactly one on-demand issue request, no bulk synopsis run');
    await click(page, '#btn-issue-description');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#view-read')?.hidden === false
      && document.activeElement?.id === 'btn-hero-inspect');
    assert.ok(await page.$eval('#hero-desc', (node) => node.hidden && node.textContent === ''),
      'M05: fetched description remains hidden until explicit disclosure');
  }
  if (readingFactsAx) {
    const state = readingState(profile);
    const presentation = issuePresentation(state.issues[43534], { position: 4, total: 89 });
    await readingAccessibility(page, { ...presentation, issue: state.issues[43534].title }, profile.id);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), KEY), before,
      `${profile.id}: factual AX confirmation preserves saved state`);
    console.log(`FACTS AX ${profile.id}: four exact source/rendered/AX label-value pairs confirmed`);
    return;
  }
  const result = await readingEvidence(page, profile);
  if (readingCase === 'M01') return;
  if (!profile.desktop) await readingAccessibility(page, result, profile.id);
  if (profile.id === 'M05') {
    await page.focus('#btn-hero-description');
    await page.keyboard.press('Enter');
    await page.waitForFunction((text) => document.querySelector('#hero-desc')?.textContent === text, {}, READING_SYNOPSIS);
    check(await page.$eval('#btn-hero-description', (node) => node.getAttribute('aria-expanded') === 'true'
      && document.activeElement === node), 'M05: reveal retains focused disclosure');
    await readingEvidence(page, profile, 'M05-expanded');
    await page.keyboard.press('Enter');
    check(await page.$eval('#hero-desc', (node) => node.hidden && node.textContent === ''), 'M05: description hides again');
  }
  check(await page.evaluate((key) => localStorage.getItem(key), KEY) === before,
    `${profile.id}: layout, focus and disclosure preserve stored progress`);
  if (profile.id === 'M01') {
    await route(page, 'data');
    await click(page, '#opt-covers');
    await route(page, 'read');
    await page.waitForFunction(() => document.querySelector('#hero-img')?.naturalWidth > 0);
    await readingEvidence(page, profile, 'M02');
    await route(page, 'data');
    await click(page, '#opt-covers');
    await route(page, 'read');
    await readingSemantics(page);
  }
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
  if (noteReadability) viewports = [
    { width: 320, height: 740 }, { width: 360, height: 800 }, { width: 412, height: 915 },
    { width: 320, height: 740, textScale: 1.5 },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 412, height: 915, textScale: 1.5 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (categoryReadability) viewports = [
    { width: 360, height: 800 },
    { width: 320, height: 740, textScale: 1.5 },
    { width: 320, height: 740, textScale: 2 },
    { width: 360, height: 800, textScale: 2 },
    { width: 412, height: 915, textScale: 1.5 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (marvelAgesTarget) viewports = [
    { width: 320, height: 740 }, { width: 360, height: 800 }, { width: 412, height: 915 },
    { width: 320, height: 740, textScale: 1.5 },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 412, height: 915, textScale: 1.5 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (catalogReadability) viewports = catalogCardProfiles;
  if (readingComposition) viewports = readingFactsAx ? readingProfiles.filter((profile) => !profile.desktop) : readingProfiles;
  const onlyCase = process.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
  if (catalogReadability && onlyCase) viewports = viewports.filter((viewport) => onlyCase.split(',').includes(viewport.id));
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
    if (noteReadability) await noteFixtures(page);
    if (readingComposition) await readingFixtures(page, viewport);
    if (categoryReadability || marvelAgesTarget || catalogReadability) await categoryFixtures(page);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (readingComposition && request.resourceType() === 'image' && new URL(request.url()).host === 'i.annihil.us') {
        return request.respond({
          status: 200, contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#73579b"/><path d="M0 300L200 0" stroke="#fff" stroke-width="8"/></svg>',
        });
      }
      if ((seriesReadability || noteReadability || categoryReadability || marvelAgesTarget || catalogReadability || readingComposition) && new URL(request.url()).origin !== origin) {
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
        if (catalogReadability && new URL(request.url()).pathname === '/__catalog-cover.svg') {
          return request.respond({
            status: 200, contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="#73579b"/><path d="M0 138L92 0" stroke="#fff" stroke-width="4"/></svg>',
          });
        }
        if (request.url().endsWith('/data/catalog.json')) {
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mobileUi || categoryReadability || marvelAgesTarget || catalogReadability ? catalog : { ...catalog, lists: [orderEntry] }) });
        }
        return request.continue();
      }
      return request.respond({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'ok', ...order.items[0], items: [], data: [] }),
      });
    });
    await page.evaluateOnNewDocument((reading) => {
      localStorage.setItem('mrt.settings', JSON.stringify(reading ? { covers: false, theme: 'light' } : { covers: false }));
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
    }, readingComposition);
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
    if (readingComposition) {
      await readingCompositionCheck(page, viewport);
      if (readingFactsAx) assert.deepEqual(errors, [], `${viewport.id}: no page errors`);
      else check(errors.length === 0, `${viewport.id}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (catalogReadability) {
      await catalogCardReadability({ page, viewport, catalog, check, route, click });
      check(errors.length === 0, `${viewport.id}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (marvelAgesTarget) {
      await marvelAgesTouchTarget(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (categoryReadability) {
      await categoryLabelReadability(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (noteReadability) {
      await issueNoteReadability(page, label, !!viewport.desktop);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
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
} catch (error) {
  console.error(`Assertions recorded before exit: ${JSON.stringify({ assertions, failures })}`);
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
