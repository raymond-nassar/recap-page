import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { issuePresentation } from '../src/js/lib/issueFocus.js';
import { homeUpdatesContent } from '../src/js/lib/homeUpdatesContent.js';
import { HOME_UPDATES_SEEN_KEY } from '../src/js/lib/homeUpdatesSeen.js';
import { availableHomeCategories, catalogEntries, groupCatalog, HOME_CATEGORIES, publishingAgeGroups, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { parseRoute } from '../src/js/lib/route.js';
import { catalogCardProfiles, catalogCardReadability } from './browser-android-catalog-cards.mjs';
import {
  catalogFacets, defaultPath, filterByFacet, filterBySpotlightKind, modernTimelineLists,
  parseCatalog, pathPlacements, searchCatalog, shelfLists, sortSpotlightStories,
  sourceLabel, sourceLink, spotlightKindLabel, spotlightSortLabel,
} from '../src/js/lib/catalog.js';

const onlyArgs = process.argv.filter((arg) => arg === '--only' || arg.startsWith('--only='));
const allowedModes = new Set([
  'mobile-ui', 'phone-header', 'launcher', 'series-readability', 'note-readability', 'category-readability',
  'marvel-ages-target', 'catalog-cards', 'alignment', 'reading-facts-ax', 'reading-composition', 'spotlight-controls', 'home-updates',
  'done-hint', 'completion-focus', 'long-list-name', 'selection-bar', 'milestones', 'save-notice', 'home-continue',
]);
if (onlyArgs.length > 1 || (onlyArgs.length && !allowedModes.has(onlyArgs[0].slice('--only='.length)))) {
  throw new Error('Choose one exact supported Android --only selector; comma selections are not supported');
}
const homeUpdatesOnly = onlyArgs[0] === '--only=home-updates';
if (homeUpdatesOnly && process.argv.includes('--without-mobile-style')) throw new Error('Home updates requires normal Android styles');
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
const phoneHeader = process.argv.includes('--only=phone-header');
const launcherOnly = process.argv.includes('--only=launcher');
const seriesReadability = process.argv.includes('--only=series-readability');
const noteReadability = process.argv.includes('--only=note-readability');
const categoryReadability = process.argv.includes('--only=category-readability');
const marvelAgesTarget = process.argv.includes('--only=marvel-ages-target');
const doneHint = process.argv.includes('--only=done-hint');
const completionFocus = process.argv.includes('--only=completion-focus');
const milestoneMode = process.argv.includes('--only=milestones');
const saveNotice = process.argv.includes('--only=save-notice');
const homeContinue = process.argv.includes('--only=home-continue');
const longListName = process.argv.includes('--only=long-list-name');
const selectionBar = process.argv.includes('--only=selection-bar');
const catalogReadability = process.argv.includes('--only=catalog-cards');
const alignment = process.argv.includes('--only=alignment');
const alignmentBaseline = process.argv.includes('--alignment-baseline');
const alignmentMutation = process.argv.includes('--alignment-without-centering');
if (alignment || alignmentBaseline || alignmentMutation) {
  assert.ok(alignment && process.argv.filter((arg) => arg.startsWith('--only=')).length === 1
    && process.env.MRT_ALIGNMENT_OUTPUT && !noStyle, 'Alignment requires one mode, normal styles and MRT_ALIGNMENT_OUTPUT');
  assert.ok(alignmentBaseline || process.env.MRT_ALIGNMENT_BASELINE, 'Alignment comparison requires MRT_ALIGNMENT_BASELINE');
  assert.ok(!alignmentMutation || (!alignmentBaseline && process.argv.includes('--case=A03')
    && !process.env.MRT_ANDROID_SCREENSHOTS), 'Alignment mutation requires only A03 without screenshots');
}
const placeholderAx = process.argv.includes('--catalog-placeholder-ax');
if (placeholderAx) {
  assert.ok(catalogReadability && process.argv.filter((arg) => arg.startsWith('--only=')).length === 1
    && !noStyle, 'Placeholder AX proof requires only the catalog-cards mode with normal styles');
}
const readingFactsAx = process.argv.includes('--only=reading-facts-ax');
const readingComposition = process.argv.includes('--only=reading-composition') || readingFactsAx;
const spotlightControls = process.argv.includes('--only=spotlight-controls');
const spotlightCase = process.argv.find((arg) => arg.startsWith('--spotlight-case='))?.split('=')[1];
if (spotlightCase) {
  assert.ok(spotlightControls && ['baseline', 'density', 'summary', 'lifecycle', 'native-keyboard', 'geometry'].includes(spotlightCase),
    'Unknown spotlight case');
}
if (spotlightCase === 'native-keyboard') {
  assert.ok(process.argv.includes('--viewport=360x800') && !process.env.MRT_ANDROID_SCREENSHOTS,
    'Native keyboard comparison requires the single360 profile and no screenshots');
}
if (spotlightCase === 'geometry') {
  assert.ok(process.argv.includes('--viewport=320x740@2'),
    'Geometry confirmation requires the existing320x740@2 profile');
}
const spotlightEvidence = [];
const spotlightGeometry = [];
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

async function homeUpdatesCheck(page, label) {
  await route(page, 'home');
  const batch = homeUpdatesContent.batch;
  const before = await page.evaluate((key) => ({
    hash: location.hash,
    entries: Object.fromEntries(Object.keys(localStorage).filter((name) => name !== key)
      .sort().map((name) => [name, localStorage.getItem(name)])),
  }), HOME_UPDATES_SEEN_KEY);
  const initial = await page.evaluate(() => ({
    open: document.querySelector('#home-updates').open,
    new: !document.querySelector('#home-updates-new').hidden,
    center: (() => {
      const heading = document.querySelector('#home-h').getBoundingClientRect();
      const head = document.querySelector('#view-home > .head').getBoundingClientRect();
      return Math.abs(heading.x + heading.width / 2 - head.x - head.width / 2);
    })(),
  }));
  check(!initial.open && initial.new === Boolean(batch) && initial.center <= 1,
    `${label}: quiet news stays closed beside a full-width centered phone heading`);
  await click(page, '#home-updates-toggle');
  await page.waitForFunction(() => document.querySelector('#home-updates').open);
  if (batch) {
    await page.waitForFunction((key) => localStorage.getItem(key) !== null, {}, HOME_UPDATES_SEEN_KEY);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-home-updates-list]')].every((node) => !node.disabled));
    for (const summary of await page.$$('#home-updates .home-updates-more > summary')) {
      await summary.evaluate((node) => node.click());
    }
    const all = await page.evaluate(() => ({
      features: [...(document.querySelector('[data-home-updates-section="features"]')?.querySelectorAll('li') ?? [])].map((node) => node.textContent),
      ids: [...document.querySelectorAll('[data-home-updates-list]')].map((node) => node.dataset.homeUpdatesList),
      new: document.querySelector('#home-updates-new').hidden,
      bounds: (() => {
        const panel = document.querySelector('#home-updates-panel');
        const box = panel.getBoundingClientRect();
        return { left: box.left, right: box.right, height: box.height, scroll: panel.scrollHeight > panel.clientHeight };
      })(),
      targets: [...document.querySelectorAll('#home-updates button, #home-updates summary')]
        .filter((node) => node.getClientRects().length).map((node) => {
          const box = node.getBoundingClientRect();
          return { text: node.textContent.trim(), width: box.width, height: box.height };
        }),
    }));
    check(JSON.stringify(all.features) === JSON.stringify(batch.features)
        && JSON.stringify(all.ids) === JSON.stringify(batch.listIds) && all.new,
    `${label}: More exposes every generated feature and exact guide while New clears`);
    check(all.bounds.left >= -1 && all.bounds.right <= 391 && all.bounds.height <= 844 * .7 + 1
        && (batch.features.length + batch.listIds.length < 10 || all.bounds.scroll)
        && all.targets.every((target) => target.width >= 48 && target.height >= 48),
    `${label}: the bounded panel wraps with internal scroll and every target at least 48px (${JSON.stringify(all)})`);
    if (batch.listIds.length) {
      const last = batch.listIds.at(-1);
      await click(page, `[data-home-updates-list="${last}"]`);
      await page.waitForFunction(() => document.querySelector('#preview').open);
      const entry = catalog.lists.find((list) => list.id === last);
      check(await page.$eval('#preview-h', (node) => node.textContent) === entry.name,
        `${label}: the final guide opens existing Preview by its real catalog identity`);
      await backDialog(page);
      check(await page.evaluate(() => document.activeElement.id === 'home-updates-toggle'),
        `${label}: Preview restores a visible summary, not its hidden panel child`);
    }
  } else {
    check(await page.$eval('#home-updates-content', (node) => node.textContent.includes('No new highlights'))
        && await page.evaluate((key) => localStorage.getItem(key) === null, HOME_UPDATES_SEEN_KEY),
    `${label}: null highlights show their explicit empty state without acknowledgment`);
  }
  if (await page.$eval('#home-updates', (node) => node.open)) await click(page, '#home-updates-close');
  await click(page, '#home-updates-toggle');
  await click(page, '#home-updates-close');
  check(await page.evaluate(() => document.activeElement.id === 'home-updates-toggle'),
    `${label}: explicit Close restores the summary`);
  await click(page, '#home-updates-toggle');
  await page.evaluate(() => {
    document.querySelector('#btn-rail-toggle').click();
    document.querySelector('#preview').showModal();
  });
  async function back() {
    const length = await page.evaluate(() => window.__androidTest.replies.length);
    await page.evaluate(() => window.__androidTest.back());
    await page.waitForFunction((count) => window.__androidTest.replies.length > count, {}, length);
    return page.evaluate(() => window.__androidTest.replies.at(-1).handled);
  }
  check(await back() && await page.evaluate(() => !document.querySelector('#preview').open
      && document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'true'
      && document.querySelector('#home-updates').open), `${label}: actual bridge Back consumes the dialog first`);
  check(await back() && await page.evaluate(() => document.querySelector('#btn-rail-toggle').getAttribute('aria-expanded') === 'false'
      && document.querySelector('#home-updates').open), `${label}: actual bridge Back consumes narrow navigation next`);
  check(await back() && await page.evaluate(() => !document.querySelector('#home-updates').open
      && document.activeElement.id === 'home-updates-toggle'), `${label}: actual bridge Back closes visible news synchronously`);
  check(await back() === false, `${label}: no overlay remains, so native Back is unhandled`);
  const after = await page.evaluate((key) => ({
    hash: location.hash,
    entries: Object.fromEntries(Object.keys(localStorage).filter((name) => name !== key)
      .sort().map((name) => [name, localStorage.getItem(name)])),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }), HOME_UPDATES_SEEN_KEY);
  check(JSON.stringify(after.entries) === JSON.stringify(before.entries) && after.hash === before.hash && !after.overflow,
    `${label}: news preserves all other storage, route and page width`);
}
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
      // Phone emulation widens innerWidth to fit an overflowing page, up to four times the screen:
      // measured in Edge 155 at 360px, a 1,360px page reported an innerWidth of 1,360, so comparing
      // with it passed. The root's client width stays the screen width, so overflow is measured there.
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
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

async function spotlightSnapshot(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const sheet = document.querySelector('#android-spotlight-sheet');
    const trigger = document.querySelector('#android-spotlight-options');
    const active = document.activeElement;
    const shown = (node) => !!node?.getClientRects().length;
    const roots = [sheet?.open ? sheet : document.querySelector('#view-spotlights')].filter(Boolean);
    const targets = roots.flatMap((root) => [...root.querySelectorAll(
      sheet?.open ? 'button, .fp > span' : '#android-spotlight-options, .spotlight-controls .fp > span, #spotlights-filters .fp > span',
    )])
      .filter(shown).map((node) => ({
        text: node.textContent.trim(), box: box(node),
        clipped: node.scrollWidth > node.clientWidth + 1,
        align: getComputedStyle(node).textAlign,
      }));
    const values = (name) => [...document.querySelectorAll(`input[name="${name}"]`)]
      .map((node) => ({ value: node.value, checked: node.checked, visible: shown(node),
        label: node.nextElementSibling?.textContent.trim() }));
    return {
      hash: location.hash, active: active?.id || active?.outerHTML.slice(0, 180),
      viewport: { width: innerWidth, height: innerHeight },
      compact: document.documentElement.classList.contains('android-spotlight-compact'),
      focus: {
        tag: active?.tagName, id: active?.id, name: active?.getAttribute('name'),
        value: active?.getAttribute('value'),
        checked: active?.matches('input[type="radio"]') ? active.checked : null,
        documentFocused: document.hasFocus(),
      },
      body: parseFloat(getComputedStyle(document.body).fontSize),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      android: !!document.querySelector('link[href="./android/mobile.css"]'),
      heading: box(document.querySelector('#spotlights-h')),
      search: box(document.querySelector('#form-spotlights-search')),
      query: document.querySelector('#spotlights-q')?.value,
      trigger: box(trigger), triggerVisible: shown(trigger),
      summary: document.querySelector('#android-spotlight-summary')?.textContent,
      expanded: trigger?.getAttribute('aria-expanded'), sheet: box(sheet), open: !!sheet?.open,
      modal: sheet?.matches(':modal') === true,
      orientation: box(document.querySelector('#spotlights-results .shelf-orientation')),
      first: box(document.querySelector('#spotlights-results .catalog-card')),
      keys: [...document.querySelectorAll('#spotlights-results .catalog-card')].map((node) => node.dataset.story),
      report: document.querySelector('#spotlights-report')?.textContent,
      sorts: values('spotlights-sort'), kinds: values('spotlights-kind'), facets: values('spotlights-category'),
      targets, dialogs: [...document.querySelectorAll('dialog[open]')].map((node) => node.id),
    };
  });
}

async function spotlightKeyboardFocus(page, selector = '#android-spotlight-sheet') {
  return page.evaluate((selector) => {
    const node = document.activeElement;
    const sheet = document.querySelector(selector);
    const inside = sheet?.contains(node) === true;
    const ancestors = [];
    for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
      ancestors.push({ tag: parent.tagName, id: parent.id, class: parent.className });
    }
    return {
      tag: node?.tagName, name: node?.getAttribute('name'), value: node?.getAttribute('value'),
      id: node?.id, text: node?.tagName === 'BUTTON' ? node.textContent : null,
      role: node?.getAttribute('role') || (node?.matches('input[type="radio"]') ? 'radio'
        : node?.tagName === 'BUTTON' ? 'button' : node?.tagName === 'DIALOG' ? 'dialog'
          : node?.tagName === 'BODY' ? 'generic' : null),
      ancestors, documentFocused: document.hasFocus(),
      open: sheet?.open === true, modal: sheet?.matches(':modal') === true, inside,
      dialogId: sheet?.id,
      layout: sheet ? {
        overflowY: getComputedStyle(sheet).overflowY,
        clientHeight: sheet.clientHeight, scrollHeight: sheet.scrollHeight,
        tabindexAttribute: sheet.getAttribute('tabindex'), tabindexProperty: sheet.tabIndex,
      } : null,
      backgroundAppControl: !inside && !!node?.matches(
        'button, input, select, textarea, summary, a[href], [tabindex], [contenteditable="true"]',
      ),
    };
  }, selector);
}

async function spotlightGeometryCheckpoint(page, checkpoint) {
  const requested = page.viewport();
  assert.ok(requested, 'Geometry diagnostics require an explicit viewport');
  const result = await page.evaluate(({ checkpoint, requested }) => {
    const root = document.documentElement;
    const body = document.body;
    const box = (node) => {
      const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const identity = (node) => ({
      tag: node.tagName, id: node.id || null, class: node.getAttribute('class'),
    });
    const dimensions = (node) => ({
      clientWidth: node.clientWidth, clientHeight: node.clientHeight,
      scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
      scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
    });
    const css = (node) => {
      const style = getComputedStyle(node);
      return Object.fromEntries([
        'display', 'position', 'width', 'minWidth', 'maxWidth', 'height', 'maxHeight',
        'top', 'right', 'bottom', 'left', 'marginLeft', 'marginRight', 'transform',
        'flex', 'flexBasis', 'flexShrink', 'flexWrap', 'alignItems', 'justifyContent',
        'whiteSpace', 'overflowX', 'overflowY', 'overflowWrap', 'wordBreak', 'clip', 'clipPath',
        'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'boxSizing', 'direction', 'textAlign',
      ].map((name) => [name, style[name]]));
    };
    const inspect = (node) => node ? { ...identity(node), rect: box(node), ...dimensions(node), css: css(node) } : null;
    const clips = (style) => ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)
      || (style.clip && style.clip !== 'auto') || (style.clipPath && style.clipPath !== 'none');
    const offenders = [];
    for (const node of [root, ...document.querySelectorAll('body, body *')]) {
      const rect = box(node);
      if (!rect.width || !rect.height || getComputedStyle(node).visibility !== 'visible') continue;
      const style = css(node);
      const selfClips = !!clips(style);
      const contentRight = !selfClips && Number.isFinite(node.scrollWidth)
        ? Math.max(rect.right, rect.x + node.scrollWidth) : rect.right;
      const beyondConfigured = rect.x < -1 || contentRight > requested.width + 1;
      const beyondRootClient = rect.x < -1 || contentRight > root.clientWidth + 1;
      if (!beyondConfigured && !beyondRootClient) continue;
      const modal = node.closest('dialog:modal');
      let clippingAncestor = null;
      if (node !== modal) {
        for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const ancestorStyle = css(ancestor);
          if (clips(ancestorStyle)) { clippingAncestor = inspect(ancestor); break; }
          if (ancestor === modal) break;
        }
      }
      const horizontalScroller = ['auto', 'scroll'].includes(style.overflowX)
        && node.scrollWidth > node.clientWidth + 1;
      const inHorizontalScroller = clippingAncestor
        && ['auto', 'scroll'].includes(clippingAncestor.css.overflowX)
        && clippingAncestor.scrollWidth > clippingAncestor.clientWidth + 1;
      offenders.push({
        ...identity(node), rect, ...dimensions(node), css: style, contentRight,
        beyondConfigured, beyondRootClient, selfClips, clippingAncestor,
        horizontalScroller, inHorizontalScroller: !!inHorizontalScroller,
        outsideRequestedHeight: rect.bottom <= 0 || rect.y >= requested.height,
        whollyOffscreenX: rect.right <= 0 || rect.x >= requested.width,
        modalOwner: modal?.id || null, view: node.closest('.view')?.id || null,
        story: node.closest('[data-story]')?.getAttribute('data-story') || null,
        parent: node.parentElement ? identity(node.parentElement) : null,
      });
    }
    offenders.sort((a, b) => Number(!!a.clippingAncestor || a.horizontalScroller || a.selfClips)
      - Number(!!b.clippingAncestor || b.horizontalScroller || b.selfClips));
    const viewport = window.visualViewport;
    const bodyStyle = getComputedStyle(body);
    return {
      checkpoint, requestedPuppeteerViewport: requested,
      route: location.hash, currentView: document.querySelector('.view:not([hidden])')?.id,
      readyState: document.readyState, rootClass: root.className, bodyClass: body.className,
      inner: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      visualViewport: viewport ? {
        width: viewport.width, height: viewport.height, scale: viewport.scale,
        offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop,
        pageLeft: viewport.pageLeft, pageTop: viewport.pageTop,
      } : null,
      documentElement: inspect(root), body: inspect(body),
      screen: {
        width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight,
        orientation: screen.orientation?.type, angle: screen.orientation?.angle, devicePixelRatio,
        outerWidth, outerHeight,
      },
      metaViewport: document.querySelector('meta[name="viewport"]')?.content || null,
      bodyType: {
        fontSize: bodyStyle.fontSize, lineHeight: bodyStyle.lineHeight, fontFamily: bodyStyle.fontFamily,
        fontWeight: bodyStyle.fontWeight, textSizeAdjust: bodyStyle.getPropertyValue('text-size-adjust'),
        webkitTextSizeAdjust: bodyStyle.getPropertyValue('-webkit-text-size-adjust'),
      },
      components: {
        navigationHeader: inspect(document.querySelector('.rail-header')),
        currentHeading: inspect(document.querySelector('.view:not([hidden]) > .head')),
        searchForm: inspect(document.querySelector('#form-spotlights-search')),
        searchLabel: inspect(document.querySelector('#form-spotlights-search > label')),
        searchRow: inspect(document.querySelector('#form-spotlights-search .field-row')),
        searchInput: inspect(document.querySelector('#spotlights-q')),
        sheet: inspect(document.querySelector('#android-spotlight-sheet')),
        sheetHeader: inspect(document.querySelector('#android-spotlight-sheet .android-sheet-header')),
        sheetTitle: inspect(document.querySelector('#android-spotlight-sheet h2')),
        close: inspect(document.querySelector('#android-spotlight-sheet .android-sheet-header button')),
      },
      horizontalExtents: {
        total: offenders.length,
        beyondConfigured: offenders.filter((node) => node.beyondConfigured).length,
        beyondRootClient: offenders.filter((node) => node.beyondRootClient).length,
        sampled: offenders.slice(0, 15),
      },
    };
  }, { checkpoint, requested });
  spotlightGeometry.push(result);
  console.log(`SPOTLIGHT GEOMETRY ${JSON.stringify(result)}`);
}

function requireSpotlightCheck(value, message) {
  check(value, message);
  assert.ok(value, message);
}

async function spotlightKeyboardCycle(target, selector, background, record, label) {
  const identity = (focus) => focus.tag === 'BODY' ? 'viewport'
    : focus.tag === 'DIALOG' && focus.id === focus.dialogId ? 'dialog'
      : focus.role === 'button' && focus.text === 'Close' ? 'close'
        : `${focus.name}:${focus.value}`;
  const read = () => spotlightKeyboardFocus(target, selector);
  const safe = (focus) => focus.open && focus.modal && !focus.backgroundAppControl;
  record.background = { before: await read() };
  record.background.target = await target.$eval(background, (node) => {
    const { width, height } = node.getBoundingClientRect();
    const description = { tag: node.tagName, id: node.id, width, height };
    node.focus();
    return description;
  });
  record.background.after = await read();
  console.log(`SPOTLIGHT NATIVE BACKGROUND ${JSON.stringify({ label, ...record.background })}`);
  const layout = record.background.before.layout;
  requireSpotlightCheck(layout?.overflowY === 'auto' && layout.clientHeight > 0
    && layout.tabindexAttribute === null, `${label}: bounded native dialog without authored tabindex`);
  record.scrollable = layout.scrollHeight > layout.clientHeight;
  record.checked = await target.$$eval(`${selector} input:checked`, (nodes) => nodes
    .map((node) => ({ name: node.name, value: node.value, type: node.type })));
  const groups = ['spotlights-sort', 'spotlights-kind', 'spotlights-category'];
  requireSpotlightCheck(record.checked.length === groups.length && groups.every((name) => (
    record.checked.filter((node) => node.name === name && node.type === 'radio').length === 1
  )), `${label}: exactly the three original checked radio groups`);
  const order = ['close', ...groups.map((name) => `${name}:${record.checked.find((node) => node.name === name).value}`)];
  if (record.scrollable) order.unshift('dialog');
  record.order = order;
  const limit = order.length + 1;
  const startIndex = order.indexOf('close');
  requireSpotlightCheck(record.background.target.width > 0 && record.background.target.height > 0
    && safe(record.background.before) && safe(record.background.after)
    && record.background.before.inside && record.background.before.documentFocused
    && record.background.after.inside && record.background.after.documentFocused
    && identity(record.background.before) === 'close'
    && identity(record.background.before) === identity(record.background.after),
  `${label}: visible background control cannot take modal focus`);
  record.directionStarts = {};
  for (const direction of ['forward', 'reverse']) {
    const start = record.directionStarts[direction] = await read();
    requireSpotlightCheck(safe(start) && start.inside && start.documentFocused && identity(start) === 'close',
      `${label}: ${direction} starts naturally on Close with document focus`);
    const sequence = record[direction] = [];
    let current = startIndex;
    let fallback = false;
    let pending = false;
    let complete = false;
    for (let index = 0; index < limit; index++) {
      const step = { step: index + 1, key: direction === 'forward' ? 'Tab' : 'Shift+Tab', before: await read() };
      sequence.push(step);
      if (direction === 'reverse') await target.keyboard.down('Shift');
      await target.keyboard.press('Tab');
      if (direction === 'reverse') await target.keyboard.up('Shift');
      step.after = await read();
      step.identity = identity(step.after);
      console.log(`SPOTLIGHT NATIVE KEY ${JSON.stringify({ label, direction, ...step })}`);
      const expectedBefore = pending ? identity(step.before) === 'viewport' && !step.before.inside
        : step.before.inside && step.before.documentFocused && identity(step.before) === order[current];
      requireSpotlightCheck(expectedBefore && safe(step.before) && safe(step.after),
        `${label}: ${direction} ${index + 1} remains modal without background focus`);
      const next = (current + (direction === 'forward' ? 1 : order.length - 1)) % order.length;
      if (step.identity === 'viewport') {
        requireSpotlightCheck(!fallback && !pending && !step.after.inside
          && (direction === 'forward' ? current === order.length - 1 : current === 0),
        `${label}: ${direction} viewport fallback is confined to its single native boundary`);
        fallback = true;
        pending = true;
      } else {
        requireSpotlightCheck(step.after.inside && step.after.documentFocused && step.identity === order[next],
          `${label}: ${direction} ${index + 1} reaches the exact next native focus stop`);
        pending = false;
        current = next;
        if (current === startIndex) { complete = true; break; }
      }
    }
    requireSpotlightCheck(complete && !pending, `${label}: ${direction} completes its cycle and re-enters within ${limit} keys`);
  }
}

async function spotlightNativeKeyboardComparison(page, raw) {
  raw.nativeComparison = { reference: {}, app: {}, requests: [] };
  const record = raw.nativeComparison;
  const reference = await page.browserContext().newPage();
  const referenceUrl = `${origin}/__spotlight-native-reference.html`;
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Native dialog reference</title></head><body><input id="native-background" aria-label="Background search">'
    + '<button type="button">Background button</button><dialog id="native-sheet" aria-labelledby="native-title" style="max-height:160px;overflow-y:auto">'
    + '<h2 id="native-title">Native filters</h2><button type="button">Close</button></dialog></body></html>';
  record.html = html;
  record.groups = [
    { name: 'spotlights-sort', radios: raw.before.sorts },
    { name: 'spotlights-kind', radios: raw.before.kinds },
    { name: 'spotlights-category', radios: raw.before.facets },
  ];
  try {
    await reference.setViewport(page.viewport());
    await reference.setRequestInterception(true);
    reference.on('request', (request) => {
      record.requests.push(request.url());
      if (request.url() === referenceUrl) return request.respond({ status: 200, contentType: 'text/html', body: html });
      if (request.url() === `${origin}/favicon.ico`) return request.respond({ status: 204 });
      return request.abort();
    });
    await reference.goto(referenceUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await reference.evaluate((groups) => {
      const sheet = document.querySelector('#native-sheet');
      for (const group of groups) {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = group.name;
        fieldset.append(legend);
        for (const radio of group.radios) {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'radio'; input.name = group.name; input.value = radio.value; input.checked = radio.checked;
          label.append(input, document.createTextNode(radio.label));
          fieldset.append(label);
        }
        sheet.append(fieldset);
      }
      sheet.showModal();
      sheet.querySelector('button').focus();
    }, record.groups);
    await reference.bringToFront();
    await reference.focus('#native-sheet button');
    await spotlightKeyboardCycle(reference, '#native-sheet', '#native-background', record.reference, 'Native reference');
    requireSpotlightCheck(record.reference.scrollable, 'Native reference is genuinely scrollable');
    requireSpotlightCheck(record.reference.forward.some((step) => step.identity === 'viewport'),
      'Native reference reproduces the observed forward boundary fallback');
    requireSpotlightCheck(record.requests.every((url) => url === referenceUrl || url === `${origin}/favicon.ico`),
      'Native reference requests only its owned fixture and favicon');
  } finally {
    await reference.close();
  }
  await page.bringToFront();
  await page.focus('#android-spotlight-sheet .android-sheet-header button');
  await spotlightKeyboardCycle(page, '#android-spotlight-sheet', '#spotlights-q', record.app, 'Spotlight app');
  requireSpotlightCheck(record.app.scrollable, 'Spotlight app is genuinely scrollable for the paired confirmation');
  const signature = (steps) => steps.map((step) => ({
    identity: step.identity, documentFocused: step.after.documentFocused,
    open: step.after.open, modal: step.after.modal, background: step.after.backgroundAppControl,
  }));
  for (const direction of ['forward', 'reverse']) {
    requireSpotlightCheck(JSON.stringify(signature(record.reference[direction])) === JSON.stringify(signature(record.app[direction])),
      `Spotlight app matches native reference ${direction} boundary and checked-radio order`);
  }
  record.matched = true;
}

async function spotlightControlCheck(page, profile) {
  const label = `${profile.width}x${profile.height}@${profile.textScale || 1}${profile.desktop ? ' desktop' : ''}`;
  const parsed = parseCatalog(catalog);
  const mine = shelfLists(parsed.lists, 'spotlights');
  const facets = catalogFacets(mine);
  assert.ok(!parsed.dropped && groupCatalog(mine).length > 12 && facets.length > 1,
    'Spotlight fixture must parse completely and expose search/categories');
  const state = { kind: 'all', facet: 'all', query: '', sort: null };
  // Spotlight cards are keyed per reading since 2026-10-03, so a grouped story's key matched no card
  // and every settle waited out its five seconds.
  const stories = () => sortSpotlightStories(catalogEntries(searchCatalog(
    filterByFacet(filterBySpotlightKind(mine, state.kind), state.facet), state.query,
  )), state.sort);
  const summaryText = () => {
    const labels = [];
    if (state.kind !== 'all') labels.push(spotlightKindLabel(state.kind));
    if (state.facet !== 'all') {
      const facet = facets.find((entry) => entry.key === state.facet);
      labels.push(`${facet.label} (${facet.count})`);
    }
    return `${spotlightSortLabel(state.sort)}; ${labels.join('; ') || 'no filters'}`;
  };
  async function settled({ summary = true, announce = false } = {}) {
    const keys = stories().map((story) => story.key);
    await page.waitForFunction((expected) => {
      const root = document.querySelector('#spotlights-results');
      if (!root || root.textContent.includes('Loading the catalog')) return false;
      return JSON.stringify([...root.querySelectorAll('.catalog-card')].map((node) => node.dataset.story))
        === JSON.stringify(expected);
    }, { timeout: 5000 }, keys);
    const actual = await spotlightSnapshot(page);
    check(JSON.stringify(actual.keys) === JSON.stringify(keys), `${label}: exact helper-derived result order`);
    check(actual.sorts.find((radio) => radio.checked)?.value === (state.sort || 'current-order')
      && actual.kinds.find((radio) => radio.checked)?.value === state.kind
      && actual.facets.find((radio) => radio.checked)?.value === state.facet
      && actual.query === state.query, `${label}: original checked values and search agree`);
    if (summary && !profile.desktop) {
      check(actual.summary === summaryText(), `${label}: selected summary ${JSON.stringify(actual.summary)} equals ${JSON.stringify(summaryText())}`);
    }
    if (announce) {
      await page.waitForFunction((count) => {
        const text = document.querySelector('#announcer')?.textContent || '';
        return count ? text.includes(`shows ${count} Reading List`) : text.includes('No Reading Lists');
      }, { timeout: 5000 }, keys.length);
      check(true, `${label}: rendered result announcement reports ${keys.length} stories`);
    }
  }
  const open = async () => {
    await click(page, '#android-spotlight-options');
    await page.waitForSelector('#android-spotlight-sheet[open]', { timeout: 5000 });
  };
  const close = async () => {
    await click(page, '#android-spotlight-sheet .android-sheet-header button');
    await page.waitForFunction(() => document.querySelector('#android-spotlight-sheet')?.open === false, { timeout: 5000 });
  };
  const choose = async (name, value) => {
    await click(page, `input[name="${name}"][value=${JSON.stringify(value)}]`);
    if (name === 'spotlights-sort') state.sort = value === 'popularity' ? value : null;
    if (name === 'spotlights-kind') state.kind = value;
    if (name === 'spotlights-category') state.facet = value;
    await settled();
  };
  await route(page, 'spotlights');
  await page.waitForSelector('#spotlights-results .catalog-card', { timeout: 10000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await spotlightSnapshot(page);
  if (spotlightCase === 'geometry') await spotlightGeometryCheckpoint(page, 'spotlights settled closed');
  const cdp = await page.createCDPSession();
  const ax = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  const raw = { label, case: spotlightCase || 'full', before,
    ax: ax.nodes.filter((node) => !node.ignored && (['radio', 'dialog'].includes(node.role?.value)
      || (node.role?.value === 'button' && node.name?.value === 'Filters and sort')))
      .map((node) => ({ role: node.role?.value, name: node.name?.value, description: node.description?.value, properties: node.properties })) };
  spotlightEvidence.push(raw);
  console.log(`SPOTLIGHT RAW ${JSON.stringify(raw)}`);
  if (spotlightCase === 'baseline') return;
  if (profile.width === 360 && !profile.textScale) {
    check(before.first?.y <= 448, `${label}: density first card <=448px (actual ${before.first?.y})`);
  }
  if (spotlightCase === 'density') return;
  const saved = await page.evaluate(() => ({ progress: localStorage.getItem('mrt.state.v2'), settings: localStorage.getItem('mrt.settings') }));
  check(before.body === (profile.desktop ? 14 : 16 * (profile.textScale || 1))
    && before.rootSize === 16, `${label}: original readable type size`);
  check(before.android === !profile.desktop && !before.overflow, `${label}: correct shell and no page overflow`);
  check(before.search?.height > 0, `${label}: search remains discoverable outside the sheet`);
  check(JSON.stringify(before.facets.map(({ value, label: text }) => [value, text]))
    === JSON.stringify(facets.map((facet) => [facet.key, `${facet.label} (${facet.count})`])),
  `${label}: original runtime facet order and counts`);
  await settled();
  const first = stories()[0];
  const selected = defaultPath(first, () => false);
  const metadata = await page.$eval('#spotlights-results .catalog-card', (node) => ({
    title: node.querySelector('.catalog-card-title')?.textContent,
    count: node.querySelector('.catalog-card-meta')?.textContent,
    source: node.querySelector('.result-source')?.textContent,
    href: node.querySelector('.result-source a')?.getAttribute('href') || null,
    actions: [...node.querySelectorAll('.catalog-card-actions button')].map((button) => button.getAttribute('aria-label')),
  }));
  check(metadata.title === (first.name || first.lists[0].name)
    && metadata.count?.startsWith(`${selected.count} issue`)
    && metadata.actions.some((name) => name?.includes(selected.name)),
  `${label}: meaningful guide title, count and original actions retained`);
  check(sourceLink(selected) ? metadata.href === sourceLink(selected)
    : metadata.href === null && (!sourceLabel(selected) || metadata.source?.includes(sourceLabel(selected))),
  `${label}: linked or plain attribution follows sourceLink`);
  if (!spotlightCase && profile.width === 360 && !profile.textScale && !profile.desktop) {
    await screenshot(page, '360x800-default', 'spotlight-closed');
  }
  if (profile.desktop) {
    if (!spotlightCase) await screenshot(page, '1280x900-desktop', 'spotlights');
    check(!before.triggerVisible && before.sorts.every((radio) => radio.visible)
      && before.kinds.every((radio) => radio.visible), `${label}: actual desktop controls remain exposed`);
    await choose('spotlights-sort', 'popularity');
    await choose('spotlights-category', facets[1].key);
    return;
  }
  check(before.triggerVisible && before.sorts.every((radio) => !radio.visible)
    && before.kinds.every((radio) => !radio.visible) && before.facets.every((radio) => !radio.visible),
  `${label}: only compact entry exposed, no hidden focusable radio rows`);
  const triggerAx = raw.ax.find((node) => node.role === 'button' && node.name === 'Filters and sort');
  check(triggerAx?.description === summaryText(), `${label}: trigger name and selection description are nonduplicating`);
  await page.evaluate(() => {
    window.__spotlightNodes = {
      controls: document.querySelector('.spotlight-controls'), categories: document.querySelector('#spotlights-filters'),
      radios: [...document.querySelectorAll('input[name^="spotlights-"]')],
    };
  });
  await page.focus('#android-spotlight-options');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#android-spotlight-sheet[open]', { timeout: 5000 });
  const panel = await spotlightSnapshot(page);
  if (spotlightCase === 'geometry') await spotlightGeometryCheckpoint(page, 'spotlight panel open');
  raw.panel = panel;
  const panelCdp = await page.createCDPSession();
  const panelAx = await panelCdp.send('Accessibility.getFullAXTree');
  await panelCdp.detach();
  raw.panelAx = panelAx.nodes.filter((node) => !node.ignored && ['dialog', 'radio'].includes(node.role?.value))
    .map((node) => ({ role: node.role?.value, name: node.name?.value, properties: node.properties }));
  console.log(`SPOTLIGHT PANEL ${JSON.stringify({ label, panel, ax: raw.panelAx })}`);
  check(raw.panelAx.some((node) => node.role === 'dialog' && node.name === 'Filters and sort'),
    `${label}: named native dialog`);
  check(panel.open && panel.expanded === 'true'
    && Math.abs(panel.sheet.bottom - profile.height) <= 1 && panel.sheet.y >= 0
    && Math.abs(panel.sheet.x - (profile.width - panel.sheet.width) / 2) <= 1,
  `${label}: centered bottom sheet fits viewport`);
  if (spotlightCase === 'geometry') {
    if (failures.length) return;
    const closed = spotlightGeometry.find((point) => point.checkpoint === 'spotlights settled closed');
    const opened = spotlightGeometry.find((point) => point.checkpoint === 'spotlight panel open');
    for (const point of [closed, opened]) {
      requireSpotlightCheck(point?.inner.width === profile.width && point.inner.height === profile.height
        && point.visualViewport?.width === profile.width && point.visualViewport.height === profile.height
        && point.visualViewport.scale === 1 && point.documentElement.clientWidth === profile.width
        && point.documentElement.scrollWidth <= point.documentElement.clientWidth
        && point.body.scrollWidth <= point.documentElement.clientWidth,
      `${label}: ${point?.checkpoint}: requested, visual and root viewport stay bounded without zoom`);
    }
    const form = closed.components.searchForm.rect;
    for (const key of ['searchLabel', 'searchRow', 'searchInput']) {
      const node = closed.components[key];
      requireSpotlightCheck(node.rect.x >= form.x - 1 && node.rect.right <= form.right + 1
        && node.rect.width > 0, `${label}: ${key} stays within the search form`);
    }
    raw.geometryLabels = await page.evaluate(() => {
      const sheet = document.querySelector('#android-spotlight-sheet');
      const viewport = window.visualViewport;
      const rows = [...sheet.querySelectorAll('h2, button, legend, .fp > span')]
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          const box = node.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(node);
          const textRects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
          return {
            tag: node.tagName, text: node.textContent.trim(),
            rect: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
            visible: box.x >= viewport.offsetLeft - 1 && box.right <= viewport.offsetLeft + viewport.width + 1
              && box.y >= viewport.offsetTop - 1 && box.bottom <= viewport.offsetTop + viewport.height + 1,
            fullText: textRects.length > 0 && textRects.every((rect) => rect.left >= box.left - 1
              && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1),
          };
        });
      sheet.scrollTop = 0;
      return rows;
    });
    console.log(`SPOTLIGHT GEOMETRY LABELS ${JSON.stringify(raw.geometryLabels)}`);
    requireSpotlightCheck(raw.geometryLabels.length > 0 && raw.geometryLabels.every((row) => row.visible && row.fullText),
      `${label}: Close, headings and every option label are fully readable within the viewport when scrolled into view`);
    await screenshot(page, '320x740-text200-fixed', 'spotlight-open');
    return;
  }
  check(panel.targets.every((target) => target.box.width >= 47.5 && target.box.height >= 47.5 && !target.clipped),
    `${label}: all panel controls have unclipped 48px hit rectangles`);
  check(panel.active?.includes('Close') && panel.targets.every((target) => target.box.right <= panel.sheet.right + 1),
    `${label}: focus enters Close and labels fit the sheet`);
  if (!spotlightCase && profile.width === 360 && !profile.textScale) {
    await screenshot(page, '360x800-default', 'spotlight-open');
  }
  if (!spotlightCase && profile.width === 320 && profile.textScale === 2) {
    await screenshot(page, '320x740-text200', 'spotlight-open');
  }
  if (spotlightCase === 'native-keyboard') {
    await spotlightNativeKeyboardComparison(page, raw);
    return;
  }
  raw.keyboard = {};
  await spotlightKeyboardCycle(page, '#android-spotlight-sheet', '#spotlights-q', raw.keyboard, label);
  await page.focus('input[name="spotlights-sort"][value="current-order"]');
  await page.keyboard.press('ArrowRight');
  state.sort = 'popularity';
  await settled();
  const lastFacet = facets.at(-1).key;
  await page.focus(`input[name="spotlights-category"][value=${JSON.stringify(lastFacet)}]`);
  await page.keyboard.press('Space');
  state.facet = lastFacet;
  await settled();
  check(await page.$eval('input[name="spotlights-category"]:checked', (input) => {
    const box = input.closest('.fp').getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight + 1;
  }), `${label}: final category is reachable by keyboard within the scrolling sheet`);
  const longFacet = [...facets].filter((facet) => facet.key !== 'all').sort((a, b) => b.label.length - a.label.length)[0];
  if (profile.textScale) {
    await choose('spotlights-kind', 'complete-guide');
    await choose('spotlights-category', longFacet.key);
  }
  await close();
  const closed = await spotlightSnapshot(page);
  check(closed.active === 'android-spotlight-options' && !closed.open
    && closed.expanded === 'false' && closed.summary === summaryText(),
  `${label}: close preserves selections and returns focus`);
  check(closed.trigger.width >= 48 && closed.trigger.height >= 48 && !closed.overflow,
    `${label}: long summary grows without clipping or width loss`);
  check(closed.targets.every((target) => !target.clipped), `${label}: entire selection summary remains readable`);
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => !document.activeElement?.matches('input[name^="spotlights-"]')
    && document.activeElement !== document.body), `${label}: collapsed choice rows are skipped by Tab`);
  if (profile.width !== 360 || profile.textScale) return;

  if (!spotlightCase || spotlightCase === 'summary') {
    const compound = ['best-of', 'complete-guide'].flatMap((kind) => facets
      .filter((facet) => facet.key !== 'all')
      .map((facet) => ({ kind, facet: facet.key, lists: filterByFacet(filterBySpotlightKind(mine, kind), facet.key) })))
      .find((candidate) => candidate.lists.length);
    assert.ok(compound, 'A nonempty compound kind/category selection is required');
    await open();
    await choose('spotlights-kind', compound.kind);
    await choose('spotlights-category', compound.facet);
    await close();
    state.query = compound.lists[0].name;
    await page.$eval('#spotlights-q', (input, value) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, state.query);
    await settled();
    assert.ok(stories().length, 'The compound query must render at least one guide before reset');
    const placements = pathPlacements(parsed.paths, parsed.lists);
    const originStory = groupCatalog(modernTimelineLists(parsed.lists))
      .find((story) => placements.get(story.key)?.first.shelf === 'spotlights');
    assert.ok(originStory, 'A real timeline path link back to a spotlight stop is required');
    await route(page, 'catalog');
    const pathRoot = `#catalog-results [data-story=${JSON.stringify(originStory.key)}] .result-path`;
    await click(page, `${pathRoot} > summary`);
    await click(page, `${pathRoot} a[href^="#/spotlights"]`);
    state.kind = 'all'; state.facet = 'all'; state.query = '';
    await settled({ summary: false });
    const reset = await spotlightSnapshot(page);
    check(reset.summary === summaryText(), `${label}: event-free reset refreshes summary while retaining popularity`);
    raw.eventFreeReset = reset;
    if (spotlightCase === 'summary') return;
  }
  if (!spotlightCase) {
    await open();
    for (const kind of ['all', 'best-of', 'complete-guide']) await choose('spotlights-kind', kind);
    await choose('spotlights-kind', 'all');
    for (const facet of facets) await choose('spotlights-category', facet.key);
    await choose('spotlights-category', 'all');
    await choose('spotlights-sort', 'current-order');
    await close();
    state.query = mine[0].name;
    await page.$eval('#spotlights-q', (input, value) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, state.query);
    await settled({ announce: true });
    state.query = '';
    await click(page, '#spotlights-clear');
    await settled();
    state.query = 'no-such-spotlight-618-fixture';
    await page.$eval('#spotlights-q', (input, value) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, state.query);
    await settled({ announce: true });
    state.query = '';
    await click(page, '#spotlights-clear');
    await settled();
    console.log(`SPOTLIGHT AXES ${JSON.stringify({ sorts: 2, kinds: 3, facets: facets.length, queries: 3 })}`);
  }

  async function restored() {
    const result = await page.evaluate(() => {
      const old = window.__spotlightNodes;
      const all = [...document.querySelectorAll('input[name^="spotlights-"]')];
      return {
        nodes: old.controls === document.querySelector('#view-spotlights .spotlight-controls')
          && old.categories === document.querySelector('#view-spotlights > #spotlights-filters'),
        radios: all.length === old.radios.length && old.radios.every((node) => all.includes(node)),
      };
    });
    requireSpotlightCheck(result.nodes && result.radios, `${label}: original controls and category restored exactly once`);
  }
  raw.responsive = [];
  raw.responsiveHistory = { before: await page.evaluate(() => ({ hash: location.hash, length: history.length })) };
  async function rememberResize(checkpoint) {
    const snapshot = await spotlightSnapshot(page);
    raw.responsive.push({ checkpoint, snapshot });
    console.log(`SPOTLIGHT RESPONSIVE ${JSON.stringify({
      label, checkpoint, viewport: snapshot.viewport, compact: snapshot.compact,
      focus: snapshot.focus, open: snapshot.open, summary: snapshot.summary,
    })}`);
    return snapshot;
  }
  await open();
  await rememberResize('open narrow sheet');
  await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => document.querySelector('#android-spotlight-sheet')?.open === false, { timeout: 5000 });
  await restored();
  const wide = await rememberResize('wide after sheet closes');
  check(!wide.triggerVisible && wide.sorts.every((radio) => radio.visible)
    && wide.facets.every((radio) => radio.visible), `${label}: widening exposes every original control`);
  requireSpotlightCheck(await page.$eval('input[name="spotlights-sort"]:checked', (node) => document.activeElement === node),
    `${label}: widening the open sheet focuses the checked sort`);
  await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
  await rememberResize('narrow before trigger focus wait');
  await page.waitForFunction(() => document.activeElement?.id === 'android-spotlight-options', { timeout: 5000 });
  await rememberResize('narrow trigger focused');
  await settled();

  await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
  await rememberResize('closed trigger widened before focus wait');
  await page.waitForFunction(() => {
    const radio = document.querySelector('input[name="spotlights-sort"]:checked');
    return radio !== null && document.activeElement === radio;
  }, { timeout: 5000 });
  await rememberResize('closed trigger handed focus to wide checked sort');
  requireSpotlightCheck(await page.$eval('input[name="spotlights-sort"]:checked', (node) => document.activeElement === node),
    `${label}: widening the closed focused trigger focuses the checked sort`);
  await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => document.activeElement?.id === 'android-spotlight-options', { timeout: 5000 });
  await rememberResize('closed controls returned to narrow trigger');

  await page.focus('#spotlights-q');
  await rememberResize('unrelated narrow search focused');
  await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => !document.documentElement.classList.contains('android-spotlight-compact'), { timeout: 5000 });
  await rememberResize('unrelated search after widening');
  requireSpotlightCheck(await page.$eval('#spotlights-q', (node) => document.activeElement === node),
    `${label}: widening does not steal search focus`);
  await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('android-spotlight-compact'), { timeout: 5000 });
  await rememberResize('unrelated search after narrowing');
  requireSpotlightCheck(await page.$eval('#spotlights-q', (node) => document.activeElement === node),
    `${label}: narrowing does not steal search focus`);
  await restored();
  await settled();
  raw.responsiveHistory.after = await page.evaluate(() => ({ hash: location.hash, length: history.length }));
  requireSpotlightCheck(JSON.stringify(raw.responsiveHistory.after) === JSON.stringify(raw.responsiveHistory.before),
    `${label}: responsive focus handoffs preserve route and history`);
  if (spotlightCase === 'lifecycle') return;
  for (const action of ['Escape', 'backdrop', 'bridge']) {
    await open();
    if (action === 'Escape') await page.keyboard.press('Escape');
    if (action === 'backdrop') {
      const top = await page.$eval('#android-spotlight-sheet', (node) => node.getBoundingClientRect().top);
      assert.ok(top > 2, 'Backdrop fixture must expose a point outside the dialog');
      await page.touchscreen.tap(2, top / 2);
    }
    if (action === 'bridge') {
      const count = await page.evaluate(() => window.__androidTest?.replies.length || 0);
      await page.evaluate(() => window.__androidTest.back());
      await page.waitForFunction((length) => {
        const reply = window.__androidTest?.replies[length];
        return reply?.kind === 'back-result' && reply.handled === true;
      }, { timeout: 5000 }, count);
    }
    await page.waitForFunction(() => document.querySelector('#android-spotlight-sheet')?.open === false, { timeout: 5000 });
    await restored();
    check(await page.evaluate(() => document.activeElement?.id === 'android-spotlight-options'),
      `${label}: ${action} returns focus without undoing choices`);
  }
  await open();
  await route(page, 'browse');
  await page.waitForFunction(() => document.activeElement?.id === 'browse-h', { timeout: 5000 });
  check(!(await spotlightSnapshot(page)).open, `${label}: hash departure closes before destination focus`);
  await route(page, 'spotlights');
  state.sort = null;
  await settled();
  await open();
  await page.$eval('.brand[data-view="home"]', (node) => node.click());
  await page.waitForFunction(() => {
    const home = document.querySelector('#view-home');
    return home && !home.hidden && home.querySelector('h1') === document.activeElement;
  }, { timeout: 5000 });
  check(!(await spotlightSnapshot(page)).open, `${label}: no-hash navigation recovers destination focus`);
  await route(page, 'spotlights');
  await settled();
  await open();
  const history = await page.evaluate(() => window.history.length);
  await choose('spotlights-sort', 'popularity');
  check(await page.evaluate(() => window.history.length) === history + 1, `${label}: one sort change pushes history once`);
  await choose('spotlights-sort', 'current-order');
  await page.goBack();
  state.sort = 'popularity';
  await settled();
  check(!(await spotlightSnapshot(page)).open
    && await page.evaluate(() => document.activeElement?.id === 'spotlights-h'),
  `${label}: sort-only Back restores summary/results and unobstructed heading focus`);
  await open();
  await page.goForward();
  state.sort = null;
  await settled();
  check(!(await spotlightSnapshot(page)).open
    && await page.evaluate(() => document.activeElement?.id === 'spotlights-h'),
  `${label}: sort-only Forward retains focus semantics`);
  await restored();
  const after = await page.evaluate(() => ({ progress: localStorage.getItem('mrt.state.v2'), settings: localStorage.getItem('mrt.settings') }));
  check(JSON.stringify(after) === JSON.stringify(saved), `${label}: filters leave progress and settings unchanged`);
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
const seriesComics = (issues) => (issues === 1 ? '1 comic' : `${issues} comics`);

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

async function seriesResultReadability(page, label, desktop, scale) {
  // #871: both name searches kept their field's own width, so with 200 per cent text tokens a 360px
  // phone page measured 422px across before anything was searched, and 378px in the shared styles.
  for (const [view, form, name] of [['add-creator', '#form-creator', 'Browse a creator'], ['add-series', '#form-series', 'Find a series']]) {
    await route(page, view);
    const fit = await page.evaluate((selector) => {
      const box = (node) => {
        const { left, right } = node.getBoundingClientRect();
        return { left: Math.round(left * 10) / 10, right: Math.round(right * 10) / 10 };
      };
      const owner = document.querySelector(selector);
      return {
        screen: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        field: box(owner.querySelector('input[type="search"]')),
        button: box(owner.querySelector('button[type="submit"]')),
      };
    }, form);
    check(fit.page <= fit.screen + 1 && [fit.field, fit.button].every((edge) => edge.left >= -1 && edge.right <= fit.screen + 1),
      `${label}: the ${name} field and its button stay inside the screen ${JSON.stringify(fit)}`);
  }
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
      // Since 9416c7de the match count shares a row with its About these results tooltip.
      summary: document.querySelector('#series-results > .field-row > .rail-hint').textContent,
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
  check(rendered.body === (desktop ? 14 : 16 * scale),
    `${label}: existing body scale retained (${rendered.body}px)`);
  for (const [index, row] of rendered.rows.entries()) {
    // Counts read in comics since 71a4f445, and since c117cb9e a series is browsed, not added whole.
    check(row.count === seriesComics(SERIES[index][2]) && row.label === 'Browse comics'
      && row.name === `Browse comics in ${row.title}`,
    `${label}: ${row.title}: comic count and action names retained`);
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
    return { broken, clipped, measured, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  // Every word of every row, counted from the fixtures; "Browse comics" is a word shorter than the
  // retired "Add all issues", which is why a floor of 30 stopped fitting the current copy.
  const expectedWords = SERIES.reduce((total, [, title, issues]) => (
    total + `${title} ${seriesComics(issues)} Browse comics`.split(/\s+/).length), 0);
  check(words.measured === expectedWords,
    `${label}: measured ordinary words in every result (${words.measured} of ${expectedWords})`);
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

  // Selection-first saving: browsing the series writes nothing until the selected comics are saved.
  const unsaved = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  await click(page, `#series-results button[aria-label="Browse comics in ${SERIES[1][1]}"]`);
  await page.waitForFunction((count) => document.querySelectorAll('#series-results input[data-comic-id]').length === count,
    {}, SERIES_ISSUES.length);
  check(await page.evaluate(() => localStorage.getItem('mrt.state.v2')) === unsaved,
    `${label}: browsing a series saves nothing before a selection is saved`);
  await click(page, '#series-results [data-act="select-all"]');
  await click(page, '#series-selection-form .comic-save-toggle');
  await click(page, '#series-selection-form button[type="submit"]');
  await page.waitForSelector('#series-selection-report .notice');
  const saved = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2') || '{}');
    return {
      notice: document.querySelector('#series-selection-report .notice').className
        + ` ${document.querySelector('#series-selection-report .notice').textContent}`,
      requests: window.__seriesRequests,
      lists: state.listOrder?.length ?? 0,
      ids: state.lists?.[state.active]?.itemIds ?? null,
      read: Object.keys(state.read ?? {}),
    };
  });
  check(saved.notice.startsWith('notice notice-ok ')
    && saved.notice.includes(`Created “${SERIES[1][1]}” with ${seriesComics(SERIES_ISSUES.length)}.`)
    && JSON.stringify(saved.requests) === JSON.stringify(['/v1/health', '/v1/series/900002/issues'])
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
      tag: node.tagName, href: node.getAttribute('href'), tabIndex: node.tabIndex,
      font: parseFloat(style.fontSize), padding: style.padding,
      minHeight: style.minHeight, direction: getComputedStyle(node.parentElement).flexDirection,
      androidStyle: !!document.querySelector('link[href="./android/mobile.css"]'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  // Marvel Ages counts each reading since 2026-10-03, as the app's own publishing index does.
  const { modern } = publishingAgeGroups(catalogEntries(catalog.lists));
  assert.ok(modern, 'Bundled catalog must expose the Modern Age navigation action');
  check(result.text === 'Browse all Modern Age Reading Lists'
    && result.name === `${result.text}: ${modern.label}, ${modern.count} Reading Lists`,
  `${label}: exact visible and accessible labels`);
  // A destination, so since 2026-10-06 it is a native hash link that keeps browser navigation gestures.
  check(result.tag === 'A' && parseRoute(result.href)?.view === 'age-modern' && result.tabIndex === 0,
    `${label}: native link to the Modern Age destination`);
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
  // Home counts each reading since 2026-10-03, as the app's own categoriesForCatalog does.
  const categories = availableHomeCategories(catalogEntries(catalog.lists), HOME_CATEGORIES,
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
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        cards: [...document.querySelectorAll(`#view-${id} .home-path`)].map((card) => {
          const copy = card.querySelector('.home-path-copy');
          const outer = bounds(card);
          const cardStyle = getComputedStyle(card);
          const content = {
            left: outer.left + parseFloat(cardStyle.borderLeftWidth) + parseFloat(cardStyle.paddingLeft),
            right: outer.right - parseFloat(cardStyle.borderRightWidth) - parseFloat(cardStyle.paddingRight),
            top: outer.top + parseFloat(cardStyle.borderTopWidth) + parseFloat(cardStyle.paddingTop),
            bottom: outer.bottom - parseFloat(cardStyle.borderBottomWidth) - parseFloat(cardStyle.paddingBottom),
          };
          // Since #873 the gateway's copy lends its eyebrow, title and count to the card's own grid and
          // has no box of its own, so their words are held to the card's content box instead.
          const frame = getComputedStyle(copy).display === 'contents' ? content : bounds(copy);
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
                if (rects.some((rect) => !fitsWidth(rect, bounds(node)) || !fitsWidth(rect, frame)
                  || !inside(rect, bounds(card)))) clipped.push(match[0]);
              }
            }
            return {
              text: node.textContent, font: parseFloat(style.fontSize), box: bounds(node),
              family: style.fontFamily, transform: style.textTransform, tracking: parseFloat(style.letterSpacing),
            };
          });
          const icon = bounds(card.querySelector('.home-path-icon'));
          const arrow = bounds(card.querySelector('.home-path-arrow'));
          const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
            && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          const marks = [['icon', icon], ['arrow', arrow], ...parts.map((part, index) => [['label', 'title', 'count'][index], part.box])];
          const overlaps = [];
          marks.forEach(([one, a], index) => marks.slice(index + 1).forEach(([other, b]) => {
            if (meets(a, b)) overlaps.push(`${one}/${other}`);
          }));
          return {
            key: card.dataset.category, name: card.getAttribute('aria-label'), parts,
            box: outer, content, icon, arrow, overlaps,
            symbol: card.querySelector('.home-path-icon use')?.getAttribute('href'),
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
      // #873: the icon is the card's emblem, larger than the 1.45rem glyph it replaces and at the
      // card's top right above the text, with the arrow at the bottom right beside the count.
      check(card.icon.width >= 40 && card.icon.height >= 40
        && Math.abs(card.icon.right - card.content.right) <= 1 && card.icon.top <= card.content.top + 1
        && card.icon.left >= card.box.left + card.box.width / 2
        && card.parts.every((part) => card.icon.bottom <= part.box.top + 0.5)
        && Math.abs(card.arrow.right - card.content.right) <= 1,
      `${label} ${view}: ${category.key}: large icon at the card's top right above its text ${JSON.stringify({ icon: card.icon, arrow: card.arrow, content: card.content })}`);
      check(card.overlaps.length === 0,
        `${label} ${view}: ${category.key}: icon, arrow and text do not overlap ${JSON.stringify(card.overlaps)}`);
      if (viewport.desktop) {
        check(card.parts[0].transform === 'uppercase'
          && Math.abs(card.parts[0].tracking - caption * 0.16) < 0.01,
        `${label} ${view}: ${category.key}: desktop eyebrow treatment retained`);
      }
    }
    check(new Set(result.cards.map((card) => card.symbol)).size === result.cards.length,
      `${label} ${view}: the ${result.cards.length} categories draw ${result.cards.length} different glyphs ${JSON.stringify(result.cards.map((card) => card.symbol))}`);
    if (viewport.width === 800) {
      // Discover More keeps its row of three at normal text and widens to two columns at 200% (#873).
      const rows = new Set(result.cards.slice(3).map((card) => Math.round(card.box.top))).size;
      check(rows === (scale === 1 ? 1 : 2), `${label} ${view}: Discover More takes ${rows} rows`);
    }
    if (view === 'browse') {
      // The credit names its metadata source as one unbroken domain, which at 200% text on a 320px
      // phone ran past its paragraph and widened Browse (#841).
      const credit = await page.$eval('#view-browse .attribution', (node) => {
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
        return {
          exact: node.textContent === `Marvel metadata via marvel.emreparker.com. © ${new Date().getFullYear()} MARVEL`,
          width: box.width, lines: rects.length, widest: Math.max(...rects.map((rect) => rect.right)) - box.left,
          inside: rects.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1),
          onScreen: box.left >= 0 && box.right <= document.documentElement.clientWidth,
        };
      });
      check(credit.exact && credit.lines > 0 && credit.inside && credit.onScreen,
        `${label} browse: metadata credit wraps inside its paragraph ${JSON.stringify(credit)}`);
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
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
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
const READING_ISSUE_POSITION = 4;
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
let readingIssue;
if (readingComposition || alignment || saveNotice || homeContinue) {
  const entry = catalog.lists.find((list) => list.id === 'hickman-minimal');
  assert.ok(entry, 'Reading composition requires the measured Hickman order');
  readingOrder = JSON.parse(await readFile(new URL(`../src/data/${entry.file}`, import.meta.url)));
  assert.equal(readingOrder.items.length, 69);
  readingIssue = readingOrder.items[READING_ISSUE_POSITION - 1];
  assert.deepEqual(
    [readingIssue.issueId, readingIssue.digitalId, readingIssue.title],
    [10586, 3443, 'Secret Wars (1984) #4'],
  );
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
    state.issues[readingIssue.issueId].title = `${readingIssue.title}: a long issue title with each word kept and room to read at a larger text size`;
  }
  return state;
}

async function readingFixtures(page, profile) {
  await page.evaluateOnNewDocument((state, key, educationKey, educationValue, synopsis, allowSynopsis, fixtureIssueId) => {
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
      if (allowSynopsis && match && Number(match[1]) === fixtureIssueId) {
        window.__readingTest.requests.push(Number(match[1]));
        return json({ ...state.issues[fixtureIssueId], description: synopsis });
      }
      throw new Error(`Unexpected reading fixture request: ${url.href}`);
    };
  }, readingState(profile), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE,
  READING_SYNOPSIS, profile.id === 'M05', readingIssue.issueId);
}

async function readingGeometry(page) {
  return page.evaluate(() => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const hero = document.querySelector('#hero');
    const art = hero.querySelector('.art');
    // Chromium still lays out the content of a closed disclosure, so its rectangles alone would
    // count Defer and Issue page as shown while More comic actions (9bb3a427) keeps them closed.
    const visible = (node) => node.checkVisibility() && !node.closest('[hidden]');
    const inside = (rect, bounds) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1
      && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const parts = [...document.querySelectorAll('#order-name, #order-sub, #ring-label, #ring-sub, #hero .eyebrow, #hero-title, #hero-by, #hero-desc, #hero-facts dt, #hero-facts dd, #hero-fb > span, #hero :is(.btn, summary)')];
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
    const controls = [...hero.querySelectorAll('.btn, summary')].filter(visible).map((node) => ({
      id: node.id, selector: node.id ? `#${node.id}` : `#${node.parentElement.id} > summary`,
      primary: !!node.closest('#hero-primary-actions'), text: node.textContent.trim(), box: box(node),
      font: parseFloat(getComputedStyle(node).fontSize),
    }));
    for (const [index, control] of controls.entries()) {
      if (controls.slice(index + 1).some((other) => intersects(control.box, other.box))) overlaps.push(control.selector);
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
      ranges, clipped, overlaps, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      image: { shown: visible(document.querySelector('#hero-img')), loaded: document.querySelector('#hero-img').naturalWidth > 0 },
    };
  });
}

async function readingEvidence(page, profile, id = profile.id) {
  // Every existing action is measured. Defer and Issue page have been behind More comic actions
  // since 9bb3a427, so it is opened for the measurement and left as it was found.
  const disclosed = await page.$eval('#hero-more-actions', (node) => node.open);
  if (!disclosed) await click(page, '#hero-more-actions > summary');
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const result = await readingGeometry(page);
  result.sourceRevision = JSON.parse(await readFile(join(ANDROID_ASSET_DIR, 'build-info.json'), 'utf8')).sourceRevision;
  const state = readingState(profile);
  const presentation = issuePresentation(state.issues[readingIssue.issueId], {
    position: READING_ISSUE_POSITION, total: readingOrder.items.length,
  });
  assert.ok(result.readCount === 1 && result.readVisible && !result.readDisabled
    && Number.isFinite(result.read.bottom) && result.read.height > 0, `${id}: positive Read measurement`);
  assert.equal(result.issue, state.issues[readingIssue.issueId].title, `${id}: exact fixture issue`);
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
    && result.count === `3 of ${readingOrder.items.length} read`, `${id}: full title, byline and progress preserved`);
  check(JSON.stringify(result.facts) === JSON.stringify(presentation.facts.map(({ key, value }) => ({ key, value }))),
    `${id}: every exact factual value retained`);
  const scale = profile.textScale || 1;
  check(result.body === (profile.desktop ? 14 : 16 * scale) && result.titleFont === 28 * scale
    && result.issueFont === (profile.desktop ? 40 : 32 * scale) && result.android === !profile.desktop,
  `${id}: actual platform and unchanged text scale`);
  check(result.ranges > 15 && !result.clipped.length && !result.overlaps.length && !result.overflow,
    `${id}: measured text/control containment ${JSON.stringify({ clipped: result.clipped, overlaps: result.overlaps })}`);
  // Read, Done, About this comic, the More comic actions summary and the two actions it discloses.
  check(result.controls.length === 6 + (id.startsWith('M05') ? 1 : 0)
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
  if (!disclosed) await click(page, '#hero-more-actions > summary');
  return result;
}

async function readingAccessibility(page, result, id) {
  // The order is read with More comic actions open so that it covers the two actions it discloses.
  const disclose = !readingFactsAx && !await page.$eval('#hero-more-actions', (node) => node.open);
  if (disclose) await click(page, '#hero-more-actions > summary');
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
    // Read and Done have come before the facts since 9bb3a427 put reading actions first.
    for (const control of readingFactsAx ? [] : result.controls.filter((entry) => entry.primary)) {
      const index = tree.findIndex((entry, at) => at > previous && entry.name?.startsWith(control.text));
      check(index > previous, `${id}: meaningful accessibility sequence includes ${control.text}`);
      previous = index;
    }
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
    for (const { text: name } of result.controls.filter((control) => !control.primary)) {
      const index = tree.findIndex((entry, at) => at > previous && entry.name?.startsWith(name));
      check(index > previous, `${id}: meaningful accessibility sequence includes ${name}`);
      previous = index;
    }
  } finally {
    await client.detach();
  }
  if (disclose) await click(page, '#hero-more-actions > summary');
  await page.focus('#order-name');
  const expected = ['#order-desc > summary', '#android-list-options',
    ...result.controls.map((control) => control.selector)];
  for (const selector of expected) {
    await page.keyboard.press('Tab');
    check(await page.$eval(selector, (node) => document.activeElement === node), `${id}: native Tab reaches ${selector}`);
    check(await page.$eval(selector, (node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && (node === hit || node.contains(hit))
        && node.matches(':focus-visible') && style.outlineStyle !== 'none';
    }), `${id}: focused control visible and unobscured`);
    // A keyboard reader reaches Defer and Issue page by opening More comic actions from its summary.
    if (selector === '#hero-more-actions > summary'
      && await page.$eval(selector, (node) => document.activeElement === node && !node.parentElement.open)) {
      await page.keyboard.press('Enter');
      check(await page.$eval('#hero-more-actions', (node) => node.open), `${id}: Enter opens More comic actions`);
    }
  }
  if (await page.$eval('#hero-more-actions', (node) => node.open)) await click(page, '#hero-more-actions > summary');
}

async function readingReplaceState(page, state) {
  await page.evaluate((key, value) => localStorage.setItem(key, JSON.stringify(value)), KEY, state);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#view-read:not([hidden])');
}

async function readingSemantics(page) {
  const nextIssue = readingOrder.items[READING_ISSUE_POSITION];
  const followingIssue = readingOrder.items[READING_ISSUE_POSITION + 1];
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
  await page.waitForFunction((title) => document.querySelector('#view-issue')?.hidden === false
    && document.querySelector('#issue-focus-h')?.textContent === title, {}, readingIssue.title);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#view-read')?.hidden === false
    && document.activeElement?.id === 'btn-hero-inspect');
  await click(page, '#btn-hero-read');
  check(await page.evaluate((key, before) => localStorage.getItem(key) === before
    && window.__readingTest.opens.length === 1 && window.__readingTest.requests.length === 0, KEY, saved),
  'M01: inspect/disclosure/inert Read preserve state and do not fetch or launch a real reader');
  await click(page, '#btn-hero-done');
  await page.waitForFunction((title) => document.querySelector('#hero-title')?.textContent === title, {}, nextIssue.title);
  check(await page.evaluate((key, issueId) => {
    const state = JSON.parse(localStorage.getItem(key));
    return Object.keys(state.read).length === 4 && Object.hasOwn(state.read, issueId);
  }, KEY, readingIssue.issueId), 'M01: Done marks exactly the current issue');
  await click(page, '#hero-more-actions > summary');
  await click(page, '#btn-hero-defer');
  await page.waitForFunction((title) => document.querySelector('#hero-title')?.textContent === title, {}, followingIssue.title);
  check(await page.evaluate((key, list, issueId) => {
    const state = JSON.parse(localStorage.getItem(key));
    return Object.keys(state.read).length === 4 && state.lists[list].deferredIssueIds.includes(issueId)
      && !Object.hasOwn(state.read, issueId);
  }, KEY, READING_LIST, nextIssue.issueId), 'M01: Defer changes queue without marking read');

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
      // Defer is reached through More comic actions, so it is opened before reachability is measured.
      await click(page, '#hero-more-actions > summary');
      for (const control of ['inspect', 'done', 'defer']) check(await page.$eval(`#btn-hero-${control}`,
        (node) => node.checkVisibility()), `M01 manual: ${control} remains reachable`);
    }
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    await route(page, 'read');
    check(await page.evaluate((key) => localStorage.getItem(key), KEY) === before, `M01 ${kind}: render preserves saved state`);
  }
  // Since fbb55575 the fact is named Unlimited availability and its five values carry no short badge.
  for (const [mu, override, label] of [
    [null, null, 'Availability unknown'], ['2999-01-01', null, 'Scheduled 2999-01-01'],
    ['2014-02-27', null, 'Expected in Unlimited'], [null, 'available', 'You marked available'],
    [null, 'unavailable', 'You marked unavailable'],
  ]) {
    let state = readingState();
    state.issues[readingIssue.issueId].mu = mu;
    if (override) state = setOverride(state, readingIssue.issueId, override);
    await readingReplaceState(page, state);
    await page.waitForFunction((expected) => document.querySelector('#hero-facts dd')?.textContent === expected, {}, label);
    check(await page.$eval('#hero-facts dt', (node) => node.textContent === 'Unlimited availability'),
      `M01 ${label}: factual label retained`);
    const geometry = await readingGeometry(page);
    check(!geometry.clipped.length && !geometry.overlaps.length && !geometry.overflow, `M01 ${label}: readable status, not a boolean`);
  }
}

async function readingCompositionCheck(page, profile) {
  await route(page, 'read');
  await page.waitForFunction((expected) => document.querySelector('#hero-title')?.textContent === expected,
    {}, readingState(profile).issues[readingIssue.issueId].title);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  if (profile.id === 'M05') {
    await page.focus('#btn-hero-inspect');
    await click(page, '#btn-hero-inspect');
    await page.waitForFunction((title) => document.querySelector('#view-issue')?.hidden === false
      && document.querySelector('#issue-focus-h')?.textContent === title, {}, readingIssue.title);
    await click(page, '#btn-issue-synopsis');
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-ok');
    await page.waitForFunction((text) => document.querySelector('#issue-focus-desc')?.textContent === text
      && document.querySelector('#btn-issue-description')?.getAttribute('aria-expanded') === 'true',
    {}, READING_SYNOPSIS);
    assert.deepEqual(await page.evaluate(() => window.__readingTest.requests), [readingIssue.issueId],
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
    const presentation = issuePresentation(state.issues[readingIssue.issueId], {
      position: READING_ISSUE_POSITION, total: readingOrder.items.length,
    });
    await readingAccessibility(page, { ...presentation, issue: state.issues[readingIssue.issueId].title }, profile.id);
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

const alignmentProfiles = [
  { id: 'A01', width: 320, height: 740, theme: 'light' },
  { id: 'A02', width: 360, height: 800, theme: 'dark', populated: true },
  { id: 'A03', width: 412, height: 915, theme: 'light' },
  { id: 'A04', width: 360, height: 800, theme: 'light', textScale: 1.5, populated: true },
  { id: 'A05', width: 320, height: 740, theme: 'dark', textScale: 2 },
  { id: 'A06', width: 800, height: 360, theme: 'light', populated: true },
  { id: 'A07', width: 1280, height: 900, theme: 'light', populated: true },
  { id: 'A08', width: 1280, height: 900, theme: 'light', populated: true, desktop: true },
];

async function alignmentFixtures(page, profile) {
  await categoryFixtures(page);
  await page.evaluateOnNewDocument((state, key, educationKey, educationValue, theme) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem(educationKey, educationValue);
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme }));
  }, profile.populated ? readingState() : createEmptyState(), KEY,
  SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, profile.theme);
}

async function alignmentGeometry(page, selectors) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    // Two frames sampled different intermediate widths in the rail's 150ms grid transition.
    await Promise.all(document.querySelector('#shell').getAnimations()
      .filter((animation) => animation.playState === 'running' && Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map((animation) => animation.finished));
  });
  return page.evaluate((selectors) => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const nodes = selectors.map((selector) => {
      const matches = document.querySelectorAll(selector);
      if (matches.length !== 1) throw new Error(`${selector}: expected exactly one element, got ${matches.length}`);
      const node = matches[0], bounds = box(node), style = getComputedStyle(node);
      if (!bounds.width || !bounds.height || node.closest('[hidden]')) throw new Error(`${selector}: no visible geometry`);
      const content = {
        left: bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      };
      const words = [], clipped = [], broken = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const textTarget = node.matches('#home-h, .home-action, #hero-title, #hero-by, #hero-facts, .rail-hint, label, .sub');
      while (textTarget && walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.parentElement.getClientRects().length || text.parentElement.closest('[hidden], .visually-hidden')) continue;
        for (const match of text.textContent.matchAll(/[A-Za-z]+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index);
          range.setEnd(text, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
          if (!rects.length) continue;
          words.push(match[0]);
          // A rotated logo has sloping word boxes, so compare the word's single range, not letter baselines.
          if (rects.length > 1) broken.push(match[0]);
          const viewport = window.visualViewport;
          for (const rect of rects) {
            if (rect.left < viewport.offsetLeft - 1 || rect.right > viewport.offsetLeft + viewport.width + 1) clipped.push(match[0]);
            for (let ancestor = text.parentElement; ancestor; ancestor = ancestor.parentElement) {
              const css = getComputedStyle(ancestor), edge = box(ancestor);
              if (/(hidden|clip)/.test(css.overflowX) && (rect.left < edge.left - 1 || rect.right > edge.right + 1)) clipped.push(match[0]);
              if (/(hidden|clip)/.test(css.overflowY) && (rect.top < edge.top - 1 || rect.bottom > edge.bottom + 1)) clipped.push(match[0]);
            }
          }
        }
      }
      return { selector, box: bounds, content, text: node.textContent.trim(), words: words.length,
        clipped, broken, font: style.fontSize, family: style.fontFamily, weight: style.fontWeight,
        transform: style.transform, align: style.textAlign, display: style.display,
        name: node.getAttribute('aria-label'), current: node.getAttribute('aria-current') };
    });
    const viewport = window.visualViewport;
    return {
      nodes, rootWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      inner: { width: innerWidth, height: innerHeight },
      visual: { width: viewport.width, height: viewport.height, scale: viewport.scale, left: viewport.offsetLeft },
      android: !!document.querySelector('link[href="./android/mobile.css"]'),
      active: document.activeElement.id, body: getComputedStyle(document.body).fontSize,
    };
  }, selectors);
}

async function alignmentCheck(page, profile) {
  const { id } = profile;
  const compactHome = !profile.desktop && profile.width <= 880;
  const snapshots = {};
  const baseline = alignmentBaseline ? null
    : JSON.parse(await readFile(join(process.env.MRT_ALIGNMENT_BASELINE, `${id}.json`), 'utf8'));
  const record = async (name, selectors) => {
    const value = await alignmentGeometry(page, selectors);
    snapshots[name] = value;
    const absoluteFit = ['home', 'reading', 'sheet', 'spotlights'].includes(name);
    check(value.rootWidth === profile.width && Math.abs(value.visual.width - profile.width) <= 1
      && Math.abs(value.visual.scale - 1) < 0.001 && (!absoluteFit || value.scrollWidth <= value.rootWidth + 1),
    `${id} ${name}: actual root/visual viewport bounds ${JSON.stringify({ root: value.rootWidth, visual: value.visual, scroll: value.scrollWidth, inner: value.inner })}`);
    check(value.android === !profile.desktop, `${id} ${name}: actual platform entry`);
    if (baseline) {
      for (const key of ['rootWidth', 'scrollWidth', 'inner', 'visual', 'active', 'body']) {
        assert.deepEqual(value[key], baseline.snapshots[name][key], `${id} ${name}: exact baseline ${key}`);
      }
    }
    for (const node of value.nodes) {
      if (absoluteFit) check(node.clipped.length === 0, `${id} ${name} ${node.selector}: no clipped words ${node.clipped}`);
      if (node.selector === '#home-h' || node.selector === '.home-action') {
        check(node.words > 0 && !node.broken.length, `${id} ${node.selector}: visible whole words`);
      }
      if (baseline) {
        const previous = baseline.snapshots[name].nodes.find((entry) => entry.selector === node.selector);
        assert.ok(previous, `${id}: baseline node ${name} ${node.selector}`);
        assert.deepEqual(node.clipped, previous.clipped, `${id} ${name}: existing clipping unchanged`);
        for (const key of ['text', 'font', 'family', 'weight', 'transform', 'align', 'display', 'name', 'current']) {
          check(node[key] === previous[key], `${id} ${name} ${node.selector}: unchanged ${key}`);
        }
        const moving = name === 'home' && ['.home-lockup', '#home-h', '.home-action'].includes(node.selector)
          && profile.width <= 880 && !profile.desktop;
        for (const key of moving ? ['top', 'bottom', 'width', 'height'] : Object.keys(node.box)) {
          check(Math.abs(node.box[key] - previous.box[key]) <= (name === 'about' ? 0 : 1), `${id} ${name} ${node.selector}: unchanged ${key}`);
        }
      }
    }
    return value;
  };
  await route(page, 'home');
  await page.waitForSelector('#home-primary-paths:not([hidden])');
  await page.waitForFunction((populated) => document.querySelector('#home-continue').hidden === !populated, {}, !!profile.populated);
  check(await page.$eval('#view-home', (node) => !node.hidden), `${id}: actual Home route`);
  if (profile.populated) {
    check(await page.$eval('#chero-count', (node, total) => node.textContent === `3 of ${total} issues read`,
      readingOrder.items.length),
    `${id}: populated reading fixture on Home`);
  } else {
    check(await page.$eval('#btn-home-add', (node) => !!node.getClientRects().length), `${id}: current fresh Home actions`);
  }
  const home = await record('home', ['#view-home > .head', '.home-lockup', '#home-h', ...(compactHome ? [] : ['.home-action']),
    '#home-categories', '.brand[data-view="home"]']);
  const [head, lockup, logo] = home.nodes;
  const gutters = { left: lockup.box.left - head.content.left, right: head.content.right - lockup.box.right };
  const centerError = Math.abs((lockup.box.left + lockup.box.right - head.content.left - head.content.right) / 2);
  check(logo.text === 'RECAP PAGE!'
    && (compactHome || home.nodes.find((node) => node.selector === '.home-action').text === 'Browse. Choose. Read.'),
  `${id}: exact Home heading copy for the platform`);
  check(home.body === `${(profile.desktop ? 14 : 16) * (profile.textScale || 1)}px`, `${id}: retained body scale`);
  check(Math.abs(parseFloat(logo.font) - profile.logoBase * (profile.textScale || 1)) < 0.1,
    `${id}: effective logo font grows with text stress`);
  if (!alignmentBaseline) check(centerError <= 1 && Math.abs(gutters.left - gutters.right) <= 2,
    `${id}: Home group centered in usable content (${JSON.stringify(gutters)})`);
  if (!alignmentMutation && process.env.MRT_ANDROID_SCREENSHOTS) {
    const image = join(process.env.MRT_ANDROID_SCREENSHOTS, `${id}-home.png`);
    if (existsSync(image)) console.log(`Retained existing Home image without overwriting: ${image}`);
    else await screenshot(page, id, 'home');
  }
  if (['A01', 'A06', 'A07', 'A08'].includes(id)) {
    await click(page, '#btn-rail-toggle');
    await record('navigation', ['.rail-header', '#btn-rail-toggle', '.brand[data-view="home"]']);
    await click(page, '#btn-rail-toggle');
    await page.focus('.brand[data-view="home"]');
    check(await page.$eval('.brand[data-view="home"]', (node) => node === document.activeElement),
      `${id}: Home navigation remains focusable`);
  }
  if (['A02', 'A06', 'A08'].includes(id)) {
    await route(page, 'read');
    await page.waitForFunction((title) => document.querySelector('#hero-title').textContent === title,
      {}, readingIssue.title);
    const reading = await record('reading', ['#hero', '#hero-title', '#hero-by', '#hero-facts', '#btn-hero-read']);
    check(reading.nodes.slice(1, 4).every((node) => ['start', 'left'].includes(node.align)), `${id}: reading copy stays start-aligned`);
    if (id === 'A02') {
      const button = reading.nodes.at(-1).box;
      check(button.top >= 0 && button.bottom <= profile.height && button.left >= 0 && button.right <= profile.width,
        `${id}: full Read within default viewport (${button.bottom})`);
      check(await page.$eval('#btn-hero-read', (node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }), `${id}: primary Read not occluded`);
      if (!alignmentBaseline) await screenshot(page, id, 'reading');
    }
  }
  if (id === 'A03') {
    await page.evaluate((key, state) => {
      localStorage.setItem(key, JSON.stringify(state));
      location.hash = '#/read';
    }, KEY, readingState());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.waitForSelector('#android-list-options', { visible: true });
    await page.focus('#android-list-options');
    await click(page, '#android-list-options');
    const panel = await record('sheet', ['#android-list-sheet', '#android-list-sheet .android-sheet-header', '#android-list-sheet .list-tools']);
    check(Math.abs(panel.nodes[0].box.left + panel.nodes[0].box.right - profile.width) <= 2, `${id}: centered list sheet`);
    if (!alignmentBaseline && !alignmentMutation) await screenshot(page, id, 'sheet');
    await backDialog(page);
    check(await page.$eval('#android-list-options', (node) => node === document.activeElement), `${id}: Back returns sheet focus`);
    await page.evaluate((key, state) => {
      localStorage.setItem(key, JSON.stringify(state));
      location.hash = '#/library';
    }, KEY, createEmptyState());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#view-library:not([hidden])');
    await record('empty', ['#view-library']);
  }
  if (['A04', 'A08'].includes(id)) {
    await route(page, 'add-manual');
    const form = await record('form', ['#sec-manual > .rail-hint', 'label[for="manual-title"]', '#manual-title']);
    check(form.nodes.every((node) => ['start', 'left'].includes(node.align)), `${id}: form prose/labels/input start-aligned`);
    if (id === 'A04' && !alignmentBaseline) await screenshot(page, id, 'form');
    await route(page, 'data');
    await record('settings', ['#view-data > .head .sub', '#opt-theme']);
    await route(page, 'about');
    await record('about', ['#view-about .head']);
  }
  if (id === 'A05') {
    await route(page, 'spotlights');
    await page.waitForSelector('#android-spotlight-options', { visible: true });
    await page.focus('#android-spotlight-options');
    await click(page, '#android-spotlight-options');
    const panel = await record('spotlights', ['#android-spotlight-sheet', '#android-spotlight-sheet .android-sheet-header']);
    check(Math.abs(panel.nodes[0].box.left + panel.nodes[0].box.right - profile.width) <= 2, `${id}: centered spotlight sheet`);
    if (!alignmentBaseline) await screenshot(page, id, 'spotlights');
    await backDialog(page);
    check(await page.$eval('#android-spotlight-options', (node) => node === document.activeElement), `${id}: spotlight focus restored`);
  }
  const evidence = { profile, centerError, gutters, snapshots,
    sourceRevision: JSON.parse(await readFile(join(ANDROID_ASSET_DIR, 'build-info.json'), 'utf8')).sourceRevision,
    mobileCssSha256: createHash('sha256').update(await readFile('packaging/android/web/mobile.css')).digest('hex') };
  await mkdir(process.env.MRT_ALIGNMENT_OUTPUT, { recursive: true });
  await writeFile(join(process.env.MRT_ALIGNMENT_OUTPUT, `${id}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  console.log(`ALIGNMENT ${id}: center error ${centerError}; gutters ${JSON.stringify(gutters)}; ${Object.keys(snapshots).length} states`);
}

// #870 replaced the compact tagline heading with the Windows masthead at 6.5% of the screen's
// shorter side. That is the size decision recorded on the Issue: it gives the wordmark the footprint,
// width times capital height, of the reference the owner chose, 118 by 28px on a 412px phone.
const WORDMARK_SHARE = 0.065;
const WORDMARK_FOOTPRINT = 118 * 28 / 412 ** 2;

async function homeWordmark(page) {
  return page.evaluate(() => {
    const view = document.querySelector('#view-home');
    const heading = document.querySelector('#home-h');
    const head = view.querySelector(':scope > .head');
    const style = getComputedStyle(heading);
    const rect = (node) => {
      const { left, right, top, bottom } = node.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const box = rect(heading);
    const headBox = head.getBoundingClientRect();
    const headStyle = getComputedStyle(head);
    const center = (headBox.left + parseFloat(headStyle.paddingLeft)
      + headBox.right - parseFloat(headStyle.paddingRight)) / 2;
    const text = document.createRange();
    text.selectNodeContents(heading);
    // The canvas reports the glyphs' own height, which the line box does not.
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const nearby = [...view.querySelectorAll('#home-updates-toggle, :scope > :not(.head)')]
      .filter((node) => node.checkVisibility());
    return {
      headings: [...view.querySelectorAll('h1')].filter((node) => node.checkVisibility()).map((node) => node.id),
      labelledBy: view.getAttribute('aria-labelledby'),
      text: heading.textContent,
      tagline: !!document.querySelector('.home-action').getClientRects().length,
      family: style.fontFamily, upper: style.textTransform, transform: style.transform,
      stroke: style.webkitTextStrokeWidth, paint: style.paintOrder, shadow: style.textShadow,
      font: parseFloat(style.fontSize), width: heading.offsetWidth,
      cap: context.measureText(heading.textContent).actualBoundingBoxAscent,
      lines: [...text.getClientRects()].filter((line) => line.width && line.height).length,
      box, top: box.top - view.getBoundingClientRect().top, offCenter: Math.abs((box.left + box.right) / 2 - center),
      screen: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlapping: nearby.filter((node) => {
        const other = rect(node);
        return box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
      }).map((node) => node.id || node.className),
    };
  });
}

async function homeWordmarkCheck(page, label, viewport) {
  await page.waitForSelector('#view-home:not([hidden])');
  if (viewport.desktop || viewport.width > 880) {
    const masthead = await homeWordmark(page);
    check(masthead.text === 'RECAP PAGE!' && masthead.tagline && masthead.font >= 48,
      `${label}: wider Home keeps the full masthead and its tagline ${JSON.stringify(masthead)}`);
    return;
  }
  // WebView multiplies every font size by the system font scale, viewport units included, and the
  // token stress reaches only token sizes, so large text scales the wordmark here the same way.
  const scale = viewport.textScale || 1;
  if (scale !== 1) {
    await page.$eval('#home-h', (node, factor) => {
      node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) * factor}px`;
    }, scale);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  const shorter = Math.min(viewport.width, viewport.height);
  const shown = await homeWordmark(page);
  const shadow = shown.shadow.match(/\) (-?[\d.]+)px (-?[\d.]+)px/);
  const footprint = shown.width * shown.cap / (shorter * scale) ** 2 / WORDMARK_FOOTPRINT;
  const misses = [
    JSON.stringify(shown.headings) !== '["home-h"]' && `page headings ${JSON.stringify(shown.headings)}`,
    shown.labelledBy !== 'home-h' && `Home named by ${shown.labelledBy}`,
    shown.text !== 'RECAP PAGE!' && `text ${JSON.stringify(shown.text)}`,
    shown.tagline && 'tagline shown',
    !/^Impact,/.test(shown.family) && `family ${shown.family}`,
    shown.upper !== 'uppercase' && `case ${shown.upper}`,
    shown.transform === 'none' && 'no skew',
    shown.stroke !== '1px' && `stroke ${shown.stroke}`,
    // Edge draws Impact, whose letters have no overlapping outlines for the stroke to trace, so the
    // white lines this order keeps out of Android's fallback can only be guarded by the order itself.
    !/^stroke/.test(shown.paint) && `paint order ${shown.paint}`,
    !(shadow && [1, 2].every((index) => Math.abs(Number(shadow[index]) - shown.font * 0.0625) < 0.01))
      && `shadow ${shown.shadow}`,
    Math.abs(shown.font - WORDMARK_SHARE * shorter * scale) > 0.05 && `font ${shown.font}px`,
    Math.abs(footprint - 1) > 0.15 && `footprint ${footprint.toFixed(2)} of the reference`,
    shown.lines !== 1 && `${shown.lines} lines`,
    (shown.box.left < 0 || shown.box.right > shown.screen || shown.overflow) && 'outside the screen',
    shown.offCenter > 1 && `${shown.offCenter.toFixed(1)}px off center`,
    (shown.top < -1 || shown.top > 16) && `${shown.top.toFixed(1)}px below the top of Home`,
    shown.overlapping.length && `overlaps ${shown.overlapping.join(', ')}`,
  ].filter(Boolean);
  check(!misses.length, `${label}: Home opens with the masthead as one centered wordmark line of the decided size (${misses.join('; ')})`);
  await screenshot(page, label, 'home-wordmark');
  if (scale !== 1) await page.$eval('#home-h', (node) => node.style.removeProperty('font-size'));
  if (viewport.forced) {
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    const forced = await page.$eval('#home-h', (node) => {
      const probe = document.createElement('span');
      probe.style.color = 'CanvasText';
      document.body.append(probe);
      const system = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(node);
      return { active: matchMedia('(forced-colors: active)').matches, color: style.color, system,
        stroke: style.webkitTextStrokeWidth, shadow: style.textShadow };
    });
    await screenshot(page, label, 'home-wordmark-forced');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.detach();
    check(forced.active && forced.color === forced.system && forced.stroke === '0px' && forced.shadow === 'none',
      `${label}: forced colors draw the wordmark in CanvasText without its stroke or shadow ${JSON.stringify(forced)}`);
  }
  console.log(`WORDMARK ${label}: ${shown.width}x${shown.cap.toFixed(1)}px at ${shown.font}px, footprint ${footprint.toFixed(2)} of the reference`);
}

async function phoneHeaderCheck(page, label, viewport) {
  const narrow = viewport.width <= 880;
  const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  if (narrow) {
    await page.focus('#btn-rail-toggle');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#sidebar-panel').hidden);
    check(await page.$eval('#btn-rail-toggle', (node) => node.getAttribute('aria-expanded') === 'true'),
      `${label}: icon-only navigation opens its panel`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#sidebar-panel').hidden);
    check(await page.$eval('#btn-rail-toggle', (node) => node.getAttribute('aria-expanded') === 'false'
      && document.activeElement === node), `${label}: Escape closes navigation and retains focus`);
  }
  await page.focus('.app-footer [data-view="about"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-about:not([hidden])');
  check(await page.$$eval('#view-about a', (links) => [
    'https://www.comicbookherald.com/',
    'https://comicbookreadingorders.com/',
    'https://github.com/emreparker/marvel-comics',
  ].every((href) => links.some((link) => link.href === href && link.checkVisibility()
    && link.target === '_blank' && link.rel === 'noopener noreferrer'))),
  `${label}: the compact footer opens About with every source credit visible`);
  await page.focus('.brand[data-view="home"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-home:not([hidden])');
  check(await page.$eval('#home-h', (node) => {
    const bounds = node.getBoundingClientRect();
    return document.activeElement === node && bounds.width > 1 && bounds.height > 1
      && getComputedStyle(node).outlineStyle !== 'none';
  }), `${label}: Home returns to a visible heading with keyboard focus`);
  check(await page.evaluate(() => localStorage.getItem('mrt.state.v2')) === before,
    `${label}: header navigation leaves saved reading data unchanged`);
  if (!viewport.desktop && narrow) {
    const masthead = () => page.evaluate(() => {
      const heading = document.querySelector('#home-h');
      return { text: heading.textContent, font: parseFloat(getComputedStyle(heading).fontSize),
        tagline: !!document.querySelector('.home-action').getClientRects().length };
    });
    await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => !!document.querySelector('.home-action').getClientRects().length);
    const wide = await masthead();
    check(wide.text === 'RECAP PAGE!' && wide.tagline && wide.font >= 48,
      `${label}: widening restores the full Home masthead and tagline ${JSON.stringify(wide)}`);
    await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => !document.querySelector('.home-action').getClientRects().length);
    const narrowed = await masthead();
    check(narrowed.text === 'RECAP PAGE!' && !narrowed.tagline
      && Math.abs(narrowed.font - WORDMARK_SHARE * Math.min(viewport.width, viewport.height)) <= 0.05,
    `${label}: narrowing returns to the wordmark without the tagline ${JSON.stringify(narrowed)}`);
  }
}

async function mobileLayout(page, label, narrow) {
  await page.waitForSelector('#home-first-run:not([hidden]) #btn-home-browse');
  // Home's start actions became native hash links on 2026-10-06, so links are collected; buttons still
  // are, so an extra start action of either kind is reported, as the phone-header owner does.
  const home = await page.$eval('#home-first-run', (region) => ({
    recommended: !!region.querySelector('#home-recommended'),
    actions: [...region.querySelectorAll(':is(a[href], button)')].map((action) => action.textContent.trim()),
  }));
  check(!home.recommended && JSON.stringify(home.actions) === JSON.stringify(['Browse Reading Lists', 'Add comics']),
    `${label}: Home contains only the Browse and Add starting choices ${JSON.stringify(home)}`);
  await measure(page, `${label} focused Home`);
  await screenshot(page, label, 'home');
  if (narrow) await click(page, '#btn-rail-toggle');
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
  // #825: the reader hint goes beside the Read that was pressed. Chromium anchored this shell's
  // scrolling to the hero's scaled background, so the hint growing the hero scrolled the page up under
  // the reader, 13px at 800x360. Focus first, as a reader arriving at Read would, then press. The
  // stand-in for window.open keeps the press from opening a launcher page outside this harness.
  const hint = await page.evaluate(() => {
    window.open = () => null;
    const read = document.querySelector('#btn-hero-read');
    read.focus();
    const before = [scrollY, read.getBoundingClientRect().top];
    read.click();
    return {
      beside: document.querySelector('#reader-handoff-help')?.previousElementSibling?.id === 'hero-primary-actions',
      moved: [scrollY - before[0], read.getBoundingClientRect().top - before[1]].map(Math.round),
    };
  });
  check(hint.beside && hint.moved.every((delta) => delta === 0),
    `${label}: the reader hint sits beside Read without scrolling the page under it ${JSON.stringify(hint)}`);
  // #829: a tap on Done names the comic under the stacked Read and Done, and a tap on Undo puts it
  // back. This first Done also retires the one-time save note above the hero, which moves the hero
  // (UX-10, #836), so placement and restoration are checked here rather than stillness.
  const readCount = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length);
  const beforeDone = { title: await page.$eval('#hero-title', (node) => node.textContent), read: await readCount() };
  await page.tap('#btn-hero-done');
  const shown = await page.waitForSelector('#done-result button', { timeout: 5000 }).then(() => true, () => false);
  const offered = shown ? await page.evaluate((title) => {
    const result = document.querySelector('#done-result');
    const box = result.getBoundingClientRect();
    const undo = result.querySelector('button').getBoundingClientRect();
    return {
      beside: result.previousElementSibling?.id === 'hero-primary-actions',
      named: result.querySelector('.grow')?.textContent === `Marked ${title} read.`,
      fits: box.left >= 0 && box.right <= document.documentElement.clientWidth,
      target: [Math.round(undo.width), Math.round(undo.height)],
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, beforeDone.title) : { shown };
  check(shown && offered.beside && offered.named && offered.fits && offered.target.every((side) => side >= 48) && !offered.overflow,
    `${label}: a tap on Done names the comic under the stacked commands with a 48px Undo ${JSON.stringify(offered)}`);
  if (shown) {
    await page.tap('#done-result button');
    await page.waitForFunction((title) => document.querySelector('#hero-title')?.textContent === title, {}, beforeDone.title);
    const undone = {
      read: await readCount(),
      focus: await page.evaluate(() => document.activeElement?.id ?? null),
      text: await page.$eval('#done-result .grow', (node) => node.textContent),
    };
    check(undone.read === beforeDone.read && undone.focus === 'btn-hero-done'
      && undone.text === `Marked ${beforeDone.title} unread. It is up next again.`,
    `${label}: a tap on Undo puts the comic back as next with focus on Done ${JSON.stringify(undone)}`);
  }
  // #829 item 3: Home's Continue reading has its own Done, sharing that result and Undo. On a phone
  // the card's commands stack, so the result goes under the whole stack and Undo keeps a 48px target.
  await route(page, 'home');
  const homeReady = await page.waitForSelector('#home-continue:not([hidden]) #btn-chero-done', { timeout: 5000 })
    .then(() => true, () => false);
  let homeBefore = null;
  let homeShown = false;
  let homeOffered = { homeReady };
  if (homeReady) {
    // Done is brought to the middle first, as a reader would scroll to it, so the result and Undo are
    // checked wherever the card starts. Before #857 it started under the fixed bottom bar at 800x360,
    // where a tap landed on the bar's Browse link; home-continue now checks where Home opens with it.
    // The tap must then reach Done itself.
    await page.$eval('#btn-chero-done', (node) => node.scrollIntoView({ block: 'center' }));
    homeBefore = await page.evaluate(() => {
      const done = document.querySelector('#btn-chero-done');
      const rect = done.getBoundingClientRect();
      const [x, y] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      const describe = (node) => (node ? `${node.tagName}#${node.id}.${String(node.className).slice(0, 40)}` : null);
      return {
        next: document.querySelector('#chero-next').textContent,
        read: Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length,
        rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round), scrollY: Math.round(scrollY),
        hit: describe(document.elementFromPoint(x, y)),
        covers: [...document.querySelectorAll('body *')].filter((node) => {
          if (!['fixed', 'sticky'].includes(getComputedStyle(node).position) || !node.getClientRects().length) return false;
          const box = node.getBoundingClientRect();
          return box.left <= x && box.right >= x && box.top <= y && box.bottom >= y;
        }).map(describe),
      };
    });
    await page.tap('#btn-chero-done');
    homeShown = await page.waitForSelector('#done-result button', { timeout: 5000 }).then(() => true, () => false);
    homeOffered = homeShown ? await page.evaluate(() => {
      const result = document.querySelector('#done-result');
      const box = result.getBoundingClientRect();
      const size = (node) => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)];
      return {
        beside: result.previousElementSibling?.id === 'chero-actions',
        fits: box.left >= 0 && box.right <= document.documentElement.clientWidth,
        undo: size(result.querySelector('button')),
        done: size(document.querySelector('#btn-chero-done')),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    }) : await page.evaluate(() => {
      const done = document.querySelector('#btn-chero-done');
      const rect = done.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        shown: false, hidden: done.hidden, rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round),
        hit: hit ? `${hit.tagName}#${hit.id}.${String(hit.className).slice(0, 40)}` : null,
        viewport: [innerWidth, innerHeight], scrollY: Math.round(scrollY), hash: location.hash,
        next: document.querySelector('#chero-next')?.textContent, focus: document.activeElement?.id ?? null,
      };
    });
  }
  check(homeShown && homeBefore?.hit?.startsWith('BUTTON#btn-chero-done') && homeOffered.beside && homeOffered.fits
    && homeOffered.undo.every((side) => side >= 48) && homeOffered.done[1] >= 48 && !homeOffered.overflow,
  `${label}: a tap on Home's Done puts the result under the card's commands with a 48px Undo ${JSON.stringify({ homeBefore, homeOffered })}`);
  if (homeShown) {
    await page.tap('#done-result button');
    await page.waitForFunction((next) => document.querySelector('#chero-next')?.textContent === next, {}, homeBefore.next);
    const homeUndone = { read: await readCount(), focus: await page.evaluate(() => document.activeElement?.id ?? null) };
    check(homeUndone.read === homeBefore.read && homeUndone.focus === 'btn-chero-done',
      `${label}: a tap on Undo on Home puts the comic back with focus on Home's Done ${JSON.stringify(homeUndone)}`);
  }
  await route(page, 'read');
  await page.waitForSelector('#reading-body:not([hidden])');
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
  // Add saves the order file's own name, and this reading was renamed on 2026-10-03.
  const minimal = catalog.lists.find((entry) => entry.id === 'hickman-minimal');
  const minimalName = JSON.parse(await readFile(new URL(`../src/data/${minimal.file}`, import.meta.url))).name;
  check(await page.evaluate((name) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return state.listOrder.length === 1 && state.lists[state.listOrder[0]].name === name;
  }, minimalName), `${label}: cancelling management leaves the list intact`);
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

// #855: no visual hint may cover Done's result, the confirmation or the failure of the change just
// made. On a phone Done spans the screen, so with it near the top the only room left for its hint is
// below, over the result, and there the hint gives way. It was reported at 412x915 with text at 200
// per cent, where the first Done retires the save note above the hero and lifts Done to the top.
// Home is not visited: its commands carry no hints, and the rail's show only on wide screens.
const hintTitle = (n) => `Hint fixture (2026) #${n}`;
async function doneHintFixtures(page) {
  let state = createList(createEmptyState(), { id: 'hint', name: 'Hint fixture' });
  state = addIssuesToList(state, 'hint', [1, 2, 3, 4].map((n) => ({
    issueId: 855100 + n, title: hintTitle(n), number: String(n), seriesName: 'Hint fixture (2026)', seriesId: 855,
    digitalId: 855200 + n, url: `https://www.marvel.com/comics/issue/${855100 + n}/fixture`, source: 'manual',
  }))).state;
  await page.evaluateOnNewDocument((saved, key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    // Read's launch is counted rather than opened (#860).
    window.open = (...args) => { (window.__hintOpened ??= []).push(args); return null; };
    // The fallback below answers any outside request with another order's comic, which could
    // retitle a fixture comic mid-check, so outside requests fail here as they do offline.
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      return url.origin === location.origin ? original(input, options)
        : Promise.reject(new TypeError('Hint fixture blocks outside requests'));
    };
  }, state, KEY);
}

async function doneHintGeometry(page, label) {
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const look = () => page.evaluate(() => {
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
    };
    const node = document.querySelector('#done-result');
    const result = node?.getClientRects().length ? box(node) : null;
    const tips = [...document.querySelectorAll('.visual-tooltip')]
      .filter((tip) => !tip.hidden && tip.getClientRects().length)
      .map((tip) => ({ id: tip.id, side: tip.dataset.side ?? null, box: box(tip) }));
    const done = document.querySelector('#btn-hero-done');
    return {
      text: node?.querySelector('.grow')?.textContent ?? null, result, tips,
      covered: !!result && tips.some(({ box: tip }) => tip.left < result.right && result.left < tip.right
        && tip.top < result.bottom && result.top < tip.bottom),
      done: done.getClientRects().length ? box(done) : null,
    };
  });
  // The fixed bottom bar can sit over a control, so a target is brought to the middle only when a
  // finger could not reach it where the app left it, and the tap must then reach it.
  const tap = async (selector) => {
    const reachable = () => page.$eval(selector, (node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    });
    if (!await reachable()) {
      await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
      await settle();
    }
    check(await reachable(), `${label}: a tap on ${selector} reaches it`);
    await page.tap(selector);
  };
  // Done 12px from the top, where its hint has no room above, raised again by keyboard focus.
  const focusAtTop = async () => {
    await page.$eval('#btn-hero-done', (done) => scrollBy(0, done.getBoundingClientRect().top - 12));
    await page.evaluate(() => document.activeElement?.blur());
    await page.focus('#btn-hero-done');
    await settle();
    return look();
  };
  await page.evaluate(() => { location.hash = '#/read/hint'; });
  await page.waitForSelector('#view-read:not([hidden]) #btn-hero-done');
  await settle();
  const clear = await focusAtTop();
  check(clear.result === null && clear.done?.top <= 20
    && clear.tips.some((tip) => tip.id === 'action-tip' && tip.side === 'bottom'),
  `${label}: with nothing to keep clear, Done's hint at the top shows below Done as before ${JSON.stringify(clear)}`);

  const rows = [];
  await page.evaluate(() => scrollTo(0, 0));
  await tap('#btn-hero-done');
  await page.waitForSelector('#done-result button');
  await settle();
  rows.push({ step: 'offer after a tap on Done', ...(await look()) });
  rows.push({ step: 'offer at the top', ...(await focusAtTop()) });
  await tap('#done-result button');
  await page.waitForFunction(() => document.querySelector('#done-result') && !document.querySelector('#done-result button'));
  await settle();
  rows.push({ step: 'confirmation after a tap on Undo', ...(await look()) });
  rows.push({ step: 'confirmation at the top', ...(await focusAtTop()) });
  await tap('#btn-hero-done');
  await page.waitForSelector('#done-result button');
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    window.__hintRestoreSet = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Fixture save refused', 'QuotaExceededError');
      return set.call(this, name, value);
    };
  }, KEY);
  await tap('#done-result button');
  await page.waitForFunction(() => document.querySelector('#done-result button')?.textContent === 'Try again');
  await page.evaluate(() => window.__hintRestoreSet());
  rows.push({ step: 'Try again at the top', ...(await focusAtTop()) });
  const wrong = rows.filter((row) => !row.result || row.covered || (row.step.endsWith('at the top') && !(row.done?.top <= 20)));
  check(rows.length === 5 && !wrong.length,
    `${label}: no hint covers Done's result after a tap on Done or Undo, or after a refused save ${JSON.stringify(wrong)}`);
  console.log(`CHECKED ${label}: Done's hint and result ${JSON.stringify(rows.map((row) => [row.step, row.tips.map((tip) => tip.side).join() || 'none']))}`);

  // #860: on a phone Read is stacked above Done, and each one's hint covered part of the other button
  // and took taps meant for it: about half of Read at its natural place, and with 200 per cent text
  // nearly all of it. Leaving the reading view retires the refused save's result, so the pair is
  // checked with nothing to keep clear. In landscape the two sit side by side.
  if (page.viewport().width > page.viewport().height) return;
  await page.evaluate(() => { location.hash = '#/home'; });
  await page.waitForSelector('#view-home:not([hidden])');
  await page.evaluate(() => { location.hash = '#/read/hint'; });
  await page.waitForSelector('#view-read:not([hidden]) #btn-hero-done');
  await settle();
  const retired = await page.$('#done-result') === null;
  // Where the hints are, and every point of the other button a finger could reach, 3px apart.
  const pair = (trigger, other) => page.evaluate((triggerSelector, otherSelector) => {
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const tips = [...document.querySelectorAll('.visual-tooltip')]
      .filter((tip) => !tip.hidden && tip.getClientRects().length)
      .map((tip) => ({ id: tip.id, side: tip.dataset.side ?? null, box: box(tip) }));
    const near = box(document.querySelector(otherSelector));
    let points = 0;
    let taken = 0;
    for (let y = Math.ceil(near.top) + 1; y < near.bottom - 1; y += 3) {
      for (let x = Math.ceil(near.left) + 1; x < near.right - 1; x += 3) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        points += 1;
        if (document.elementFromPoint(x, y)?.closest('.visual-tooltip')) taken += 1;
      }
    }
    return {
      box: box(document.querySelector(triggerSelector)), points, taken,
      side: tips.find((tip) => tip.id === 'action-tip')?.side ?? 'none',
      covers: tips.some(({ box: tip }) => tip.left < near.right && near.left < tip.right
        && tip.top < near.bottom && near.top < tip.bottom),
    };
  }, trigger, other);
  const place = async (selector, position) => {
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
    await settle();
    if (position === 'top') {
      await page.$eval(selector, (node) => scrollBy(0, node.getBoundingClientRect().top - 12));
      await settle();
    }
    await page.focus(selector);
    await settle();
  };
  const pairRows = [];
  for (const [trigger, other] of [['#btn-hero-read', '#btn-hero-done'], ['#btn-hero-done', '#btn-hero-read']]) {
    for (const position of ['natural', 'top']) {
      await place(trigger, position);
      pairRows.push({ step: `${trigger === '#btn-hero-read' ? 'Read' : 'Done'} ${position}`, ...(await pair(trigger, other)) });
    }
  }
  const expected = { 'Read natural': 'top', 'Read top': 'none', 'Done natural': 'bottom', 'Done top': 'bottom' };
  const misplaced = pairRows.filter((row) => row.covers || row.taken > 0 || row.side !== expected[row.step]
    || (row.step.endsWith('top') && !(row.box.top <= 20)) || (row.step.endsWith('natural') && row.points === 0));
  check(retired && pairRows.length === 4 && !misplaced.length,
    `${label}: neither Read's hint nor Done's covers the other button or answers a point of it, raised by keyboard focus at the natural place or near the top ${JSON.stringify(misplaced.length ? misplaced : pairRows)}`);

  // A finger on the edge of one button nearest the other, where the other's hint used to sit.
  const tapBeside = async (target, from) => {
    const point = await page.evaluate((targetSelector, fromSelector) => {
      const near = document.querySelector(targetSelector).getBoundingClientRect();
      const far = document.querySelector(fromSelector).getBoundingClientRect();
      const x = (near.left + near.right) / 2;
      return near.bottom <= far.top ? { x, y: near.bottom - 3 } : { x, y: near.top + 3 };
    }, target, from);
    const under = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('.visual-tooltip')?.id ?? hit?.closest('button')?.id ?? hit?.tagName ?? null;
    }, point);
    await page.touchscreen.tap(point.x, point.y);
    await settle();
    return { point, under };
  };
  await place('#btn-hero-done', 'natural');
  const shown = (await pair('#btn-hero-done', '#btn-hero-read')).side;
  const opened = await page.evaluate(() => window.__hintOpened?.length ?? 0);
  const onRead = await tapBeside('#btn-hero-read', '#btn-hero-done');
  const launched = await page.evaluate(() => window.__hintOpened?.length ?? 0) === opened + 1;
  const afterRead = await pair('#btn-hero-read', '#btn-hero-done');
  await place('#btn-hero-read', 'top');
  const before = await page.$eval('#hero-title', (node) => node.textContent);
  const onDone = await tapBeside('#btn-hero-done', '#btn-hero-read');
  const marked = await page.$eval('#hero-title', (node) => node.textContent) !== before;
  const afterDone = await pair('#btn-hero-done', '#btn-hero-read');
  check(shown === 'bottom' && launched && onRead.under !== 'action-tip' && !afterRead.covers
    && marked && onDone.under !== 'action-tip' && !afterDone.covers,
  `${label}: a tap on Read's edge beside Done's hint opens the reader, a tap on Done's edge beside Read marks the comic, and neither tap leaves a hint over the other button ${JSON.stringify({ shown, onRead, launched, afterRead, onDone, marked, afterDone })}`);
  console.log(`CHECKED ${label}: Read and Done hints ${JSON.stringify(pairRows.map((row) => [row.step, row.side]))}`);
}

// #864: Complete and Reopen keep keyboard focus while their completion-history save is held, and after
// another tab's write refuses it. On a narrow Android screen Complete lives in the List options sheet,
// which closes as Complete is pressed and gives focus to its own trigger, so Complete is pressed
// through the sheet and List options is where focus belongs while it saves. Reopen stays on the page,
// and when it succeeds the view heading takes focus, Complete being in the closed sheet. Measured on
// main in Edge phone emulation on 2026-10-26: Reopen's held and refused saves left focus on the page,
// and so did its success.
const focusTitle = (n) => `Focus fixture (2026) #${n}`;
async function completionFocusFixtures(page) {
  let state = createList(createEmptyState(), { id: 'focus', name: 'Focus fixture' });
  state = addIssuesToList(state, 'focus', [1, 2, 3, 4].map((n) => ({
    issueId: 864100 + n, title: focusTitle(n), number: String(n), seriesName: 'Focus fixture (2026)', seriesId: 864,
    digitalId: 864200 + n, url: `https://www.marvel.com/comics/issue/${864100 + n}/fixture`, source: 'manual',
  }))).state;
  await page.evaluateOnNewDocument((saved, key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    window.open = () => null;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      return url.origin === location.origin ? original(input, options)
        : Promise.reject(new TypeError('Focus fixture blocks outside requests'));
    };
  }, state, KEY);
}

async function completionFocusJourney(page, label) {
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.evaluate(() => { location.hash = '#/read/focus'; });
  await page.waitForFunction(() => !document.querySelector('#view-read').hidden
    && !document.querySelector('#btn-complete-list').disabled
    && document.querySelector('#android-list-options')?.checkVisibility());
  // Every rendered frame records where focus is, so a frame with focus on the page shows up.
  await page.evaluate((key) => {
    const request = navigator.locks.request.bind(navigator.locks);
    window.__focusHold = () => new Promise((held) => {
      request(key, () => new Promise((release) => { window.__focusRelease = release; held(); }));
    });
    window.__focusFrames = null;
    const sample = () => {
      window.__focusFrames?.push(document.activeElement?.id || document.activeElement?.tagName);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, LIST_HISTORY_KEY);
  const focusNow = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  // The fixed bottom bar can sit over a control, so a target is brought to the middle only when a
  // finger could not reach it where the app left it, and the tap must then reach it.
  const reachable = (selector) => page.$eval(selector, (node) => {
    const rect = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  });
  const press = async (selector, how) => {
    if (how === 'keyboard') {
      await page.focus(selector);
      await page.keyboard.press('Enter');
      return;
    }
    if (!await reachable(selector)) {
      await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
      await settle();
    }
    check(await reachable(selector), `${label}: a tap on ${selector} reaches it`);
    await page.tap(selector);
  };
  const pressComplete = async (how) => {
    await press('#android-list-options', how);
    await page.waitForFunction(() => document.querySelector('#android-list-sheet')?.open
      && document.querySelector('#btn-complete-list').checkVisibility());
    await press('#btn-complete-list', how);
  };
  // Another tab's save while this one waits: the same records under a new write token.
  const refuse = async (selector, token) => {
    await page.evaluate((key, format, writeToken) => {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') ?? { format, version: 1, records: [] };
      localStorage.setItem(key, JSON.stringify({ ...value, writeToken }));
    }, LIST_HISTORY_KEY, LIST_HISTORY_FORMAT, token);
    await page.evaluate(() => window.__focusRelease());
    await page.waitForFunction((target) => document.querySelector('#save-report').textContent.includes('Another tab changed')
      && !document.querySelector(target).hasAttribute('aria-disabled'), {}, selector);
    await settle();
  };
  const expected = {
    'Complete held': 'android-list-options', 'Complete refused': 'android-list-options',
    'Complete succeeded': 'btn-reopen-list', 'Reopen held': 'btn-reopen-list',
    'Reopen refused': 'btn-reopen-list', 'Reopen succeeded': 'order-name',
  };
  for (const how of ['keyboard', 'tap']) {
    const rows = [];
    await page.evaluate(() => window.__focusHold());
    await pressComplete(how);
    await page.evaluate(() => { window.__focusFrames = []; });
    await settle();
    rows.push({ step: 'Complete held', focus: await focusNow() });
    await refuse('#btn-complete-list', `foreign-864-${how}-complete`);
    rows.push({ step: 'Complete refused', focus: await focusNow() });
    await page.evaluate(() => window.__focusHold());
    await pressComplete(how);
    await settle();
    await page.evaluate(() => window.__focusRelease());
    await page.waitForFunction(() => !document.querySelector('#btn-reopen-list').hidden
      && !document.querySelector('#btn-reopen-list').hasAttribute('aria-disabled'));
    await settle();
    rows.push({ step: 'Complete succeeded', focus: await focusNow() });
    await page.evaluate(() => window.__focusHold());
    await press('#btn-reopen-list', how);
    await settle();
    rows.push({ step: 'Reopen held', focus: await focusNow() });
    await refuse('#btn-reopen-list', `foreign-864-${how}-reopen`);
    rows.push({ step: 'Reopen refused', focus: await focusNow() });
    await page.evaluate(() => window.__focusHold());
    await press('#btn-reopen-list', how);
    await settle();
    await page.evaluate(() => window.__focusRelease());
    await page.waitForFunction(() => document.querySelector('#btn-reopen-list').hidden
      && !document.querySelector('#btn-complete-list').hasAttribute('aria-disabled'));
    await settle();
    rows.push({ step: 'Reopen succeeded', focus: await focusNow() });
    const frames = await page.evaluate(() => {
      const sampled = window.__focusFrames;
      window.__focusFrames = null;
      return sampled;
    });
    const wrong = rows.filter((row) => row.focus !== expected[row.step]);
    check(rows.length === 6 && !wrong.length,
      `${label} ${how}: focus stays on the command or List options through a held and a refused save, and a success hands it to Reopen or the heading ${JSON.stringify(wrong.length ? wrong : rows)}`);
    check(frames.length > 0 && !frames.includes('BODY'),
      `${label} ${how}: no rendered frame from the first press to the last had focus on the page ${JSON.stringify({ frames: frames.length, onPage: frames.filter((entry) => entry === 'BODY').length })}`);
    console.log(`CHECKED ${label} ${how}: completion focus ${JSON.stringify(rows.map((row) => [row.step, row.focus]))}`);
  }
}

// #836 item 1 (UX-10): a first visit to a Reading List, with the one-time note that saving is automatic
// still showing. The note used to lead the reading card, and on a phone it was 238px tall at 360 by 800
// and put Read under the bottom bar. It now follows the card, so Read is where it would be without the
// note. Tab keeps the note's link clear of the bar, and the first Done retires the note without moving
// anything above the card.
async function saveNoticeFixtures(page, viewport) {
  await page.evaluateOnNewDocument((saved, key, educationKey, education, settings) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    if (!localStorage.getItem(educationKey)) localStorage.setItem(educationKey, education);
    localStorage.setItem('mrt.settings', JSON.stringify(settings));
    window.open = () => null;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) return original(input, options);
      if (url.pathname === '/v1/health') {
        return Promise.resolve(new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } }));
      }
      return Promise.reject(new TypeError('Save notice fixture blocks outside requests'));
    };
  }, readingState(), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.EXPLAINING,
  { covers: viewport.covers === true, theme: viewport.theme || 'light' });
}

async function saveNoticeCheck(page, label, viewport) {
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.waitForFunction(() => !document.querySelector('#view-read').hidden
    && document.querySelector('#hero-title').textContent !== 'Nothing up next');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle();
  const measure = () => page.evaluate((educationKey) => {
    const hero = document.querySelector('#hero');
    const notice = document.querySelector('#save-education');
    const box = (node) => {
      const { top, bottom } = node.getBoundingClientRect();
      return { top: Math.round(top), bottom: Math.round(bottom), page: Math.round(top + scrollY) };
    };
    // The bar slides while focus moves, so content is measured against where it rests when shown.
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    return {
      shown: !notice.hidden && notice.getClientRects().length > 0,
      follows: Boolean(hero.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING),
      hero: box(hero), notice: notice.hidden ? null : box(notice), read: box(document.querySelector('#btn-hero-read')),
      fold: barred ? Math.round(innerHeight - bar.height) : innerHeight, scrollY: Math.round(scrollY),
      education: localStorage.getItem(educationKey),
      cover: document.querySelector('#hero-img').checkVisibility(),
    };
  }, SAVE_EDUCATION_KEY);
  const first = await measure();
  check(first.shown && first.follows && first.notice.top >= first.hero.bottom && first.cover === (viewport.covers === true),
    `${label}: a first visit shows the save note after the reading card ${JSON.stringify(first)}`);
  if (viewport.readAbove) {
    check(first.scrollY === 0 && first.read.top >= 0 && first.read.bottom <= first.fold,
      `${label}: Read is fully visible above the bottom bar on a first visit ${JSON.stringify({ read: first.read, fold: first.fold })}`);
  }
  // Tab from the card's last control onto the note's link, parked first inside the band the bottom bar
  // covers. Focus scrolls a control that is off screen to the middle anyway, so that band is the one
  // place focus could leave the link hidden (WCAG 2.4.11, focus not obscured).
  await page.evaluate(() => {
    const link = document.querySelector('#save-education-settings');
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    const { top, height } = link.getBoundingClientRect();
    window.scrollBy(0, top - (barred ? innerHeight - bar.height / 2 - height / 2 : innerHeight - height - 8));
  });
  await settle();
  await page.$eval('#hero-more-actions > summary', (node) => node.focus({ preventScroll: true }));
  const path = [];
  for (let step = 0; step < 8 && await page.evaluate(() => document.activeElement?.id) !== 'save-education-settings'; step += 1) {
    await page.keyboard.press('Tab');
    path.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  }
  await settle();
  const link = await page.evaluate(() => {
    const node = document.querySelector('#save-education-settings');
    const { top, bottom } = node.getBoundingClientRect();
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const fold = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2 ? innerHeight - bar.height : innerHeight;
    return { focused: document.activeElement === node, top: Math.round(top), bottom: Math.round(bottom), fold: Math.round(fold) };
  });
  check(link.focused && link.top >= 0 && link.bottom <= link.fold,
    `${label}: Tab reaches the note's Backup & settings link in view, clear of the bottom bar ${JSON.stringify({ link, path })}`);
  // Done is brought to the middle first, as a reader would scroll to it, so the bar cannot take the tap.
  await page.$eval('#btn-hero-done', (node) => node.scrollIntoView({ block: 'center' }));
  await settle();
  const point = await page.$eval('#btn-hero-done', (node) => {
    const { left, top, width, height } = node.getBoundingClientRect();
    const [x, y] = [left + width / 2, top + height / 2];
    const hit = document.elementFromPoint(x, y);
    return { x, y, reached: hit === node || node.contains(hit) };
  });
  check(point.reached, `${label}: Done can be reached where it is ${JSON.stringify(point)}`);
  if (viewport.desktop) await page.mouse.click(point.x, point.y);
  else await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('#save-education').hidden, { timeout: 5000 });
  await settle();
  const after = await measure();
  check(after.education === SAVE_EDUCATION_STATE.COMPLETE && !after.shown && Math.abs(after.hero.page - first.hero.page) <= 1,
    `${label}: the first Done retires the note without moving the reading card ${JSON.stringify({ before: first.hero, after: after.hero, education: after.education })}`);
  console.log(`CHECKED ${label}: first-visit save note ${JSON.stringify({ notice: first.notice, read: first.read, fold: first.fold, link })}`);
}

// #857: Home's Continue reading on a phone, opened from the bar as a reader leaving a list does. The
// Issue's Read at y 843 in a 360 by 800 portrait came from a probe server that did not answer the
// app's health path, so the notice that the local connection is missing stood 354px tall above Home.
// The native shell answers that path, as this harness's server does, and in portrait Read already
// cleared the bar. Landscape did not: at 800 by 360 the two-row head left the last 36px of Read and Done
// under it.
async function homeContinueFixtures(page, viewport) {
  const base = readingState();
  const state = viewport.listName ? {
    ...base, lists: { ...base.lists, [READING_LIST]: { ...base.lists[READING_LIST], name: viewport.listName } },
  } : base;
  await page.evaluateOnNewDocument((saved, key, educationKey, education, settings) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    localStorage.setItem(educationKey, education);
    localStorage.setItem('mrt.settings', JSON.stringify(settings));
    window.open = () => null;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) return original(input, options);
      if (url.pathname === '/v1/health') {
        return Promise.resolve(new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } }));
      }
      return Promise.reject(new TypeError('Home continue fixture blocks outside requests'));
    };
  }, state, KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE,
  { covers: viewport.covers === true, theme: viewport.theme || 'light' });
}

async function homeContinueCheck(page, label, viewport) {
  const name = `${label} ${viewport.theme}${viewport.listName ? ' two-line name' : ''}`;
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const tap = async (point) => {
    if (viewport.desktop) await page.mouse.click(point.x, point.y);
    else await page.touchscreen.tap(point.x, point.y);
  };
  // Where a finger would land on a control, and whether the control is what is there.
  const target = (selector) => page.$eval(selector, (node) => {
    const { left, top, width, height } = node.getBoundingClientRect();
    const [x, y] = [left + width / 2, top + height / 2];
    const hit = document.elementFromPoint(x, y);
    return { x, y, reached: hit === node || node.contains(hit) };
  });
  const readCount = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length);
  await page.waitForSelector('#view-read:not([hidden])');
  // WebView multiplies every font size by the system font scale, viewport units included, and the
  // token stress reaches only token sizes, so large text scales the wordmark here as phone-header does.
  if (viewport.textScale) {
    await page.$eval('#home-h', (node, factor) => {
      node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) * factor}px`;
    }, viewport.textScale);
  }
  await click(page, '.brand[data-view="home"]');
  await page.waitForSelector('#home-continue:not([hidden]) #btn-chero-done');
  await page.evaluate(() => document.fonts.ready);
  await settle();
  const measure = () => page.evaluate(() => {
    const box = (node) => {
      if (!node || !node.getClientRects().length) return null;
      const { left, top, right, bottom } = node.getBoundingClientRect();
      return { left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) };
    };
    const reaches = (node) => {
      const { left, top, width, height } = node.getBoundingClientRect();
      const hit = document.elementFromPoint(left + width / 2, top + height / 2);
      return hit === node || node.contains(hit);
    };
    // The bar slides while the page moves, so content is measured against where it rests when shown.
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    const head = document.querySelector('#view-home > .head');
    const headBox = head.getBoundingClientRect();
    const headStyle = getComputedStyle(head);
    const heading = document.querySelector('#home-h').getBoundingClientRect();
    const center = (headBox.left + parseFloat(headStyle.paddingLeft) + headBox.right - parseFloat(headStyle.paddingRight)) / 2;
    const read = document.querySelector('#btn-chero-read');
    const done = document.querySelector('#btn-chero-done');
    return {
      scrollY: Math.round(scrollY), fold: barred ? Math.round(innerHeight - bar.height) : innerHeight,
      read: box(read), done: box(done), reachRead: reaches(read), reachDone: reaches(done),
      heading: box(document.querySelector('#home-h')), toggle: box(document.querySelector('#home-updates-toggle')),
      panel: document.querySelector('#home-updates').open ? box(document.querySelector('#home-updates-panel')) : null,
      offCenter: Math.round(Math.abs((heading.left + heading.right) / 2 - center) * 10) / 10,
      width: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      focus: document.activeElement?.id || null,
    };
  });
  const opened = await measure();
  await screenshot(page, name, 'home-continue');
  if (viewport.readAbove) {
    // The Issue requires Read fully visible above the bar. Done, stacked under Read on a portrait phone,
    // must start above it and take a tap there; its last 5px stay under the bar at 320 by 740.
    check(opened.scrollY === 0 && opened.read.top >= 0 && opened.read.bottom <= opened.fold && opened.reachRead
      && opened.done.top < opened.fold && opened.reachDone,
    `${name}: Home opens with Continue reading's Read fully above the bottom bar and Done starting above it, each reached by a tap ${JSON.stringify(opened)}`);
  } else {
    console.log(`LIMIT ${name}: Read ends at ${opened.read.bottom} against the bar at ${opened.fold}`);
  }
  if (!viewport.desktop) {
    const sameRow = opened.toggle.top < opened.heading.bottom && opened.toggle.bottom > opened.heading.top;
    if (viewport.oneRow) {
      check(sameRow && opened.offCenter <= 1 && opened.toggle.left >= opened.heading.right
        && opened.toggle.right <= opened.width && !opened.overflow,
      `${name}: on a short screen What's new shares the centered wordmark's row ${JSON.stringify(opened)}`);
    } else {
      check(!sameRow && opened.toggle.top >= opened.heading.bottom && opened.offCenter <= 1,
        `${name}: a taller screen keeps What's new on its own row under the centered wordmark ${JSON.stringify(opened)}`);
    }
  }
  if (viewport.oneRow) {
    // What's new opens where it is, as the Windows panel below it, instead of jumping to a row of its
    // own; with large text the taller row puts the panel's end under the bar, and the page scrolls.
    // Opening clears New, which can shorten the summary and, with large text, unwrap it, so the corner
    // it is anchored by is compared, and it may narrow but not spread along its row as it used to.
    const anchored = (a, b) => !!a && !!b && a.top === b.top && a.right === b.right && a.left >= b.left - 1;
    const settled = (open) => page.waitForFunction((expected) => document.querySelector('#home-updates').open === expected,
      { timeout: 5000 }, open).then(() => true, () => false);
    const toggle = await target('#home-updates-toggle');
    await tap(toggle);
    const opening = await settled(true);
    await settle();
    const shown = await measure();
    await screenshot(page, name, 'home-updates-open');
    check(opening && toggle.reached && anchored(shown.toggle, opened.toggle) && shown.panel
      && shown.panel.top >= shown.toggle.bottom - 1 && shown.panel.left >= 0 && shown.panel.right <= shown.width
      && (viewport.textScale || shown.panel.bottom <= shown.fold) && !shown.overflow,
    `${name}: What's new opens in place, its panel inside the screen and above the bottom bar ${JSON.stringify({ opening, toggle: shown.toggle, before: opened.toggle, panel: shown.panel, fold: shown.fold })}`);
    if (opening) await tap(await target('#home-updates-close'));
    const closing = opening && await settled(false);
    const closed = await measure();
    check(closing && closed.focus === 'home-updates-toggle' && anchored(closed.toggle, opened.toggle),
      `${name}: Close restores focus to What's new where it was ${JSON.stringify({ closing, focus: closed.focus, toggle: closed.toggle })}`);
    await tap(await target('#home-updates-toggle'));
    const reopened = await settled(true);
    const replies = await page.evaluate(() => window.__androidTest.replies.length);
    await page.evaluate(() => window.__androidTest.back());
    const replied = await page.waitForFunction((count) => window.__androidTest.replies.length > count, { timeout: 5000 }, replies)
      .then(() => true, () => false);
    const backed = await page.evaluate(() => ({
      handled: window.__androidTest.replies.at(-1)?.handled,
      open: document.querySelector('#home-updates').open, focus: document.activeElement?.id || null,
    }));
    check(reopened && replied && backed.handled && !backed.open && backed.focus === 'home-updates-toggle',
      `${name}: Android Back closes What's new and restores its focus ${JSON.stringify({ reopened, replied, ...backed })}`);
  }
  // From the heading Home focuses on arrival, Tab passes What's new and reaches Read, then Done. Focus
  // keeps each clear of the bar, including where the card does not fit (WCAG 2.4.11).
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement?.id !== 'home-updates-toggle') document.querySelector('#home-h').focus({ preventScroll: true });
  });
  await settle();
  const path = [];
  for (const id of ['btn-chero-read', 'btn-chero-done']) {
    for (let step = 0; step < 4 && await page.evaluate(() => document.activeElement?.id) !== id; step += 1) {
      await page.keyboard.press('Tab');
      path.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
    }
    await settle();
    const focused = await measure();
    const control = id === 'btn-chero-read' ? focused.read : focused.done;
    check(focused.focus === id && control.top >= 0 && control.bottom <= focused.fold,
      `${name}: Tab brings ${id === 'btn-chero-read' ? 'Read' : 'Done'} into view clear of the bottom bar ${JSON.stringify({ control, fold: focused.fold, path })}`);
  }
  if (!viewport.readAbove) {
    console.log(`CHECKED ${name}: Continue reading reached by focus ${JSON.stringify({ read: opened.read, fold: opened.fold })}`);
    return;
  }
  // Done is tapped where Home opens with it, which at 800 by 360 used to be the bar's Browse link. On a
  // phone its result is a bar above the bottom navigation (#892): it shows in full there and moves
  // nothing, except at 320 by 740, where the owner chose to scroll just enough to keep Done in view.
  // Windows keeps it inline after the card's commands, as #856 placed it. Either way Undo is tapped
  // where it shows.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.activeElement?.blur();
  });
  // The Tab checks scrolled the page, which slides the bar away, and it slides back as the page
  // returns to the top. A finger meets the bar where it rests, so the tap waits for it to settle there.
  await page.waitForFunction(() => {
    const rail = document.querySelector('.rail-header');
    if (getComputedStyle(rail).position !== 'fixed') return true;
    return !rail.classList.contains('mobile-nav-hidden') && Math.abs(rail.getBoundingClientRect().bottom - innerHeight) < 1
      && !rail.getAnimations().some((animation) => animation.playState === 'running');
  }, { timeout: 5000 }).catch(() => {});
  await settle();
  const before = {
    read: await readCount(), next: await page.$eval('#chero-next', (node) => node.textContent),
    done: (await measure()).done,
  };
  const done = await target('#btn-chero-done');
  check(done.reached, `${name}: Done is reached by a tap where Home opens with it ${JSON.stringify(done)}`);
  await tap(done);
  const shown = await page.waitForSelector('#done-result button', { timeout: 5000 }).then(() => true, () => false);
  await settle();
  const placed = shown ? await page.evaluate(() => {
    const box = (node) => {
      const { left, top, right, bottom } = node.getBoundingClientRect();
      return { left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) };
    };
    const result = document.querySelector('#done-result');
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    return {
      follows: result.previousElementSibling?.id === 'chero-actions', position: getComputedStyle(result).position,
      read: Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length,
      result: box(result), readBox: box(document.querySelector('#btn-chero-read')), doneBox: box(document.querySelector('#btn-chero-done')),
      fold: barred ? Math.round(innerHeight - bar.height) : innerHeight, width: document.documentElement.clientWidth,
      scrollY: Math.round(scrollY), focus: document.activeElement?.id || null,
    };
  }) : { shown };
  check(shown && placed.follows && placed.read === before.read + 1,
    `${name}: a tap on Done marks the comic and offers Undo, the result following the card's commands in the page ${JSON.stringify(placed)}`);
  await screenshot(page, name, 'home-done');
  if (!shown) return;
  if (viewport.desktop) {
    check(placed.position !== 'fixed' && placed.result.top >= placed.doneBox.bottom && placed.scrollY === 0,
      `${name}: Windows keeps the result inline under the card's commands ${JSON.stringify(placed)}`);
  } else {
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const gap = placed.fold - placed.result.bottom;
    const same = (a, b) => ['left', 'top', 'right', 'bottom'].every((side) => Math.abs(a[side] - b[side]) <= 1);
    // At 320 by 740 the page moves by the overlap and the bar's own gap, so Done ends that gap above it.
    const moved = viewport.scrollToClear
      ? placed.scrollY > 0 && Math.abs(placed.result.top - placed.doneBox.bottom - gap) <= 1
      : placed.scrollY === 0 && same(placed.doneBox, before.done);
    check(placed.position === 'fixed' && placed.result.left >= 0 && placed.result.right <= placed.width
      && placed.result.top >= 0 && placed.result.bottom <= placed.fold && gap > 0
      && !overlaps(placed.result, placed.readBox) && !overlaps(placed.result, placed.doneBox) && moved,
    `${name}: Done's result shows in full in a bar above the bottom navigation, clear of Read and Done, ${viewport.scrollToClear ? 'the page scrolled just enough to keep Done in view' : 'with nothing moved'} ${JSON.stringify({ ...placed, before: before.done, gap })}`);
    if (viewport.scrollToClear) console.log(`SCROLL ${name}: ${placed.scrollY}px keeps Done ${gap}px clear of the result bar`);
    // Focus clears the bar by its height while it shows, so Tab on from Done never lands under it: the
    // focused control's scroll margin must cover the navigation and the bar, which the overlay measures.
    await page.$eval('#btn-chero-done', (node) => node.focus({ preventScroll: true }));
    await page.keyboard.press('Tab');
    await settle();
    const onward = await page.evaluate(() => {
      const focused = document.activeElement;
      const { left, top, right, bottom } = focused.getBoundingClientRect();
      const bar = document.querySelector('#done-result').getBoundingClientRect();
      return { focus: focused.id, top: Math.round(top), bottom: Math.round(bottom), barTop: Math.round(bar.top),
        beside: left >= bar.right || right <= bar.left, margin: parseFloat(getComputedStyle(focused).scrollMarginBottom),
        clearance: Math.round(document.querySelector('.rail-header').offsetHeight + bar.height) };
    });
    check(onward.focus === 'btn-chero-open' && onward.top >= 0 && (onward.beside || onward.bottom <= onward.barTop)
      && onward.margin >= onward.clearance,
    `${name}: Tab on from Done brings Open the list into view clear of the result bar ${JSON.stringify(onward)}`);
    // The bar gives way to the More panel while it is open.
    await click(page, '#btn-rail-toggle');
    const covered = await page.$eval('#done-result', (node) => getComputedStyle(node).visibility);
    await click(page, '#btn-rail-toggle');
    const restored = await page.$eval('#done-result', (node) => getComputedStyle(node).visibility);
    check(covered === 'hidden' && restored === 'visible',
      `${name}: the result bar gives way while More is open ${JSON.stringify({ covered, restored })}`);
  }
  const undo = await target('#done-result button');
  await tap(undo);
  await page.waitForFunction((next) => document.querySelector('#chero-next')?.textContent === next, { timeout: 5000 }, before.next)
    .catch(() => {});
  const undone = { reached: undo.reached, read: await readCount(), focus: await page.evaluate(() => document.activeElement?.id ?? null) };
  check(undone.reached && undone.read === before.read && undone.focus === 'btn-chero-done',
    `${name}: a tap on Undo where it shows puts the comic back with focus on Done ${JSON.stringify(undone)}`);
  console.log(`CHECKED ${name}: Continue reading on Home ${JSON.stringify({ read: opened.read, done: opened.done, fold: opened.fold })}`);
}

// #874: the Reading Journey milestones in the Android build, at the phone sizes and text scales the
// Issue names. A finished section's Complete badge and Done's longer result stay inside the screen, and
// the line the wrap-up opens with stays inside its card with each word whole, its display size scaled
// with the text like every other step of the ramp.
const milestoneTitle = (n) => `Milestone fixture (2026) #${n}`;
async function milestoneFixtures(page, theme) {
  let state = createList(createEmptyState(), { id: 'journey', name: 'Milestone fixture' });
  state = addIssuesToList(state, 'journey', [1, 2, 3].map((n) => ({
    issueId: 874100 + n, title: milestoneTitle(n), number: String(n), seriesName: 'Milestone fixture (2026)', seriesId: 874,
    digitalId: 874200 + n, url: `https://www.marvel.com/comics/issue/${874100 + n}/fixture`, source: 'manual',
    collectedIn: n < 3 ? 'Book One' : 'Book Two',
  }))).state;
  state = markRead(state, 874101, true, 1000);
  await page.evaluateOnNewDocument((saved, key, chosen) => {
    // Home first, so the harness's own Home checks run on Home before the journey opens the list.
    if (!location.hash) history.replaceState(null, '', '#/home');
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'all', theme: chosen }));
    window.open = () => null;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      return url.origin === location.origin ? original(input, options)
        : Promise.reject(new TypeError('Milestone fixture blocks outside requests'));
    };
  }, state, KEY, theme || 'light');
}

async function milestoneJourney(page, label) {
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.evaluate(() => { location.hash = '#/read/journey'; });
  await page.waitForFunction((name) => !document.querySelector('#view-read').hidden
    && document.querySelector('#hero-title').textContent === name, {}, milestoneTitle(2));
  if (!await page.$eval('#full', (node) => node.open)) await click(page, '#full > summary');
  await page.waitForSelector('#rows .row');
  await click(page, '#btn-hero-done');
  await page.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, milestoneTitle(3));
  // Measured and captured once the moment has settled, so the scale it starts from is not taken for the
  // layout. A transition replaced before it ends rejects its promise, and has settled all the same.
  const still = () => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  await still();
  await page.$eval('#done-result', (node) => node.scrollIntoView({ block: 'center' }));
  await settle();
  await screenshot(page, label, 'milestone-result');
  await page.$eval('#rows .row-group.is-done', (node) => node.scrollIntoView({ block: 'center' }));
  await settle();
  const section = await page.evaluate(() => {
    const badge = document.querySelector('#rows .row-group.is-done .rg-done');
    const result = document.querySelector('#done-result');
    return {
      badge: badge?.textContent ?? null, right: badge?.getBoundingClientRect().right ?? null,
      result: result?.querySelector('.grow')?.textContent ?? null, resultRight: result?.getBoundingClientRect().right ?? null,
      width: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(section.badge === '✓Complete' && section.right <= section.width && section.resultRight <= section.width
    && section.result === `Marked ${milestoneTitle(2)} read. Section complete: Book One.` && section.overflow <= 0,
  `${label}: a finished section's badge and Done's result stay inside the screen ${JSON.stringify(section)}`);
  await screenshot(page, label, 'milestone-section');
  await page.$eval('#rows [data-key="874103"][data-act="read"]', (node) => node.click());
  // The line is what is under test, so a missing one is reported by the check below, not a timeout.
  await page.waitForSelector('#list-wrap-up-cheer:not([hidden])', { timeout: 5000 }).catch(() => {});
  await still();
  await page.$eval('#list-wrap-up', (node) => node.scrollIntoView({ block: 'start' }));
  await settle();
  const list = await page.evaluate(() => {
    const cheer = document.querySelector('#list-wrap-up-cheer');
    if (!cheer?.checkVisibility()) return null;
    const card = cheer.closest('#list-wrap-up').getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(cheer);
    // The text's own extent, skew and shadow included, rather than the block it sits in, which is as
    // wide as the card whatever the words do.
    const box = range.getBoundingClientRect();
    let at = 0;
    const words = cheer.textContent.split(' ').map((word) => {
      range.setStart(cheer.firstChild, at);
      range.setEnd(cheer.firstChild, at + word.length);
      at += word.length + 1;
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    return {
      text: cheer.textContent, left: box.left, right: box.right, cardLeft: card.left, cardRight: card.right, words,
      font: parseFloat(getComputedStyle(cheer).fontSize),
      token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-title-lg')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  // The display size is the ramp's largest step, which the Android overlay sets and the text scale above
  // multiplies, so following the token is what proves the line grows with the reader's text.
  check(list?.text === 'All read!' && list.left >= list.cardLeft && list.right <= list.cardRight
    && list.words.every((lines) => lines === 1) && list.font === list.token && list.overflow <= 0,
  `${label}: the wrap-up opens with All read! inside its card, each word whole, at the scaled display size ${JSON.stringify(list)}`);
  await screenshot(page, label, 'milestone-list');
  console.log(`CHECKED ${label}: milestones ${JSON.stringify({ badge: section.right, cheer: list && [list.left, list.right, list.font] })}`);
}

// #866: the More menu's link to the Reading List keeps the list's name on one line, and below 880px
// the shell's single column grew to fit it, so opening the menu widened the whole page. Measured on
// main in Edge phone emulation on 2026-10-26 with this 79-character name, the page reached 181px past
// the screen at 360x800, 129px at 412x915 and 690px at 360x800 with 200 per cent text tokens.
const longListTitle = 'My long-running reread of every Avengers crossover from 1963 to the present day';
async function longListNameFixtures(page) {
  let state = createList(createEmptyState(), { id: 'long', name: longListTitle });
  state = addIssuesToList(state, 'long', [1, 2].map((n) => ({
    issueId: 866100 + n, title: `Name fixture (2026) #${n}`, number: String(n), seriesName: 'Name fixture (2026)', seriesId: 866,
    digitalId: 866200 + n, url: `https://www.marvel.com/comics/issue/${866100 + n}/fixture`, source: 'manual',
  }))).state;
  await page.evaluateOnNewDocument((saved, key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    window.open = () => null;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      return url.origin === location.origin ? original(input, options)
        : Promise.reject(new TypeError('Name fixture blocks outside requests'));
    };
  }, state, KEY);
}

async function longListNameMenu(page, label, viewport) {
  await page.evaluate(() => { location.hash = '#/read/long'; });
  await page.waitForFunction(() => !document.querySelector('#view-read').hidden
    && document.querySelector('#list-nav .rail-list-name'));
  await click(page, '#btn-rail-toggle');
  await page.waitForFunction(() => !document.querySelector('#sidebar-panel').hidden);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await measure(page, `${label} navigation with a 79-character list name`);
  const opened = await page.evaluate((full) => {
    const root = document.documentElement;
    const panel = document.querySelector('#sidebar-panel');
    const link = document.querySelector('#list-nav .ri');
    const text = link.querySelector('.rail-list-name');
    const style = getComputedStyle(text);
    const edges = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10 };
    };
    return {
      screen: root.clientWidth,
      page: root.scrollWidth,
      menu: { client: panel.clientWidth, scroll: panel.scrollWidth },
      offscreen: [...panel.querySelectorAll('a[href], button')]
        .filter((node) => node.getClientRects().length)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > root.clientWidth + 1;
        })
        .map((node) => node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
      row: edges(link),
      name: {
        ...edges(text), client: text.clientWidth, scroll: text.scrollWidth,
        cut: text.scrollWidth > text.clientWidth, textOverflow: style.textOverflow,
        full: text.textContent === full && link.textContent.includes(full),
      },
    };
  }, longListTitle);
  check(opened.menu.scroll <= opened.menu.client + 1 && !opened.offscreen.length,
    `${label}: the open menu and every link and button in it fit the screen with a 79-character list name ${JSON.stringify(opened)}`);
  // Every phone width here is too narrow for the whole name, and landscape is wide enough for it.
  const cut = viewport.width <= 412;
  check(opened.name.cut === cut && (!cut || opened.name.textOverflow === 'ellipsis')
    && opened.name.left >= opened.row.left - 1 && opened.name.right <= opened.row.right + 1
    && opened.name.right <= opened.screen + 1 && opened.name.full,
  `${label}: the list name ${cut ? 'ends in an ellipsis' : 'shows whole'} inside its row and keeps its full text ${JSON.stringify(opened.name)}`);
  console.log(`CHECKED ${label}: menu open with a 79-character list name ${JSON.stringify({ page: opened.page, screen: opened.screen, name: [opened.name.client, opened.name.scroll] })}`);
}

// #833: an issue search long enough that its 50 rendered comics run well past a phone screen.
const BAR_ISSUES = Array.from({ length: 50 }, (_, index) => ({
  id: 900400 + index + 1,
  title: `Selection bar fixture (2026) #${index + 1}`,
  seriesId: 900300,
  seriesName: 'Selection bar fixture (2026)',
  issueNumber: String(index + 1),
  digitalId: 900500 + index + 1,
}));
async function selectionBarFixtures(page, theme) {
  await page.evaluateOnNewDocument((issues, value) => {
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: value }));
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/data/catalog.json') return json({ lists: [] });
      if (url.origin !== location.origin) {
        if (url.pathname === '/v1/health') return json({ status: 'ok' });
        if (url.pathname === '/v1/search/issues') return json({ items: issues });
        throw new Error(`Unexpected fixture request: ${url.href}`);
      }
      return original(input, options);
    };
  }, BAR_ISSUES, theme);
}

// #833: Save selected comics stays in view above the bottom bar at every scroll position, keeps its
// 48px target, and the list name field stays in view with the on-screen keyboard open. The shell
// resizes the WebView for the keyboard (adjustResize, with the keyboard inset applied as padding in
// MainActivity), so the keyboard is modeled here by shortening the viewport while the field has
// focus, then scrolling it into view as the platform does. That is a model, not the keyboard.
async function selectionBarCheck(page, label, viewport) {
  const BAR = '#view-add-search .comic-builder';
  const frames = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  // A tap where the control actually is, checked first, because the bottom bar or the selection
  // bar can lie over a point that scrolling has not cleared.
  const tap = async (selector, scroll = true) => {
    if (scroll) await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
    await frames();
    const point = await page.$eval(selector, (node) => {
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, reached: hit === node || node.contains(hit) || hit === node.closest('label') };
    });
    check(point.reached, `${label}: ${selector} can be tapped where it is drawn`);
    await page.touchscreen.tap(point.x, point.y);
    await frames();
  };
  const geometry = () => page.evaluate((selector) => {
    const box = (node) => {
      const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    const reached = (node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === node || node.contains(hit);
    };
    const bar = document.querySelector(selector);
    const nav = document.querySelector('.rail-header').getBoundingClientRect();
    const toggle = bar.querySelector('.comic-save-toggle');
    const clear = bar.querySelector('.comic-clear');
    // Each word of the two commands on one line and inside its button: the shared narrow rule
    // lets button labels break anywhere, which is what to rule out here.
    const words = [toggle, clear].flatMap((node) => {
      const bounds = node.getBoundingClientRect();
      const text = node.firstChild;
      return [...text.textContent.matchAll(/\S+/g)].map((match) => {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
        return {
          word: match[0],
          whole: rects.length === 1 && rects[0].left >= bounds.left - 1 && rects[0].right <= bounds.right + 1,
        };
      });
    });
    return {
      bar: box(bar), toggle: { ...box(toggle), reached: reached(toggle) }, clear: { ...box(clear), reached: reached(clear) },
      nav: { top: nav.top, onScreen: nav.top < innerHeight - 1 },
      words, height: innerHeight, max: document.documentElement.scrollHeight - innerHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, BAR);

  await route(page, 'add-search');
  await page.type('#search-q', 'Selection');
  await page.$eval('#form-search', (form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelectorAll('#search-results input[data-comic-id]').length === 50);
  check(await page.$eval(BAR, (bar) => bar.hidden), `${label}: no bar before anything is selected`);
  await tap('#search-results input[data-comic-id="900445"]');
  check(await page.evaluate((selector) => !document.querySelector(selector).hidden
    && document.querySelector(`${selector} .comic-selection-count`).textContent === '1 comic selected', BAR),
  `${label}: tapping a comic far down the list opens the bar with its count`);

  // Long enough for the bottom bar's slide and the selection bar's move with it, both 150ms.
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 250); });
  // Off the checkbox, because the bottom bar steps aside while any input has focus.
  await page.evaluate(() => document.activeElement.blur());
  const { max } = await geometry();
  const positions = [];
  for (const fraction of [0, 0.5, 1, 0.5, 0]) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(max * fraction));
    await frames();
    await settle();
    positions.push({ fraction, ...await geometry() });
  }
  const inView = (rect, height) => rect.top >= -0.5 && rect.bottom <= height + 0.5;
  check(positions.every((at) => inView(at.toggle, at.height) && at.toggle.reached && inView(at.clear, at.height) && at.clear.reached),
    `${label}: Save selected comics and Clear selection stay in view and tappable at every scroll position ${JSON.stringify(positions.map(({ fraction, toggle, clear }) => ({ fraction, toggle, clear })))}`);
  check(positions.some((at) => at.nav.onScreen) && positions.every((at) => !at.nav.onScreen || at.bar.bottom <= at.nav.top + 0.5),
    `${label}: whenever the bottom bar shows, the selection bar sits above it ${JSON.stringify(positions.map(({ fraction, bar, nav }) => ({ fraction, bar: bar.bottom, nav })))}`);
  const at = positions[0];
  check(at.toggle.width >= 47.5 && at.toggle.height >= 47.5 && at.clear.width >= 47.5 && at.clear.height >= 47.5,
    `${label}: both commands keep 48px targets ${JSON.stringify({ toggle: at.toggle, clear: at.clear })}`);
  check(at.words.every((word) => word.whole) && !at.overflow,
    `${label}: every word of both commands stays whole inside its button, with no page overflow ${JSON.stringify(at.words.filter((word) => !word.whole))}`);
  await screenshot(page, label, 'selection-bar');

  await tap(`${BAR} .comic-save-toggle`, false);
  check(await page.evaluate((selector) => document.querySelector(`${selector} .comic-save-toggle`).getAttribute('aria-expanded') === 'true'
    && document.querySelector('#search-save-panel').checkVisibility()
    && document.querySelector(selector).getBoundingClientRect().height <= innerHeight * 0.6 + 1, BAR),
  `${label}: tapping Save selected comics opens the destination form inside the bar, within its height cap`);
  await screenshot(page, label, 'selection-bar-form');
  await page.$eval('#search-list-name', (input) => input.scrollIntoView({ block: 'nearest' }));
  await tap('#search-list-name', false);
  check(await page.evaluate(() => document.activeElement?.id === 'search-list-name'),
    `${label}: tapping the list name gives it focus`);
  const keyboard = Math.round(viewport.height * (viewport.width > viewport.height ? 0.55 : 0.42));
  await page.setViewport({ width: viewport.width, height: viewport.height - keyboard, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.evaluate(() => document.activeElement.scrollIntoView({ block: 'nearest' }));
  await frames();
  await settle();
  const typing = await page.evaluate((selector) => {
    const field = document.activeElement;
    const bar = document.querySelector(selector);
    const r = field.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const nav = document.querySelector('.rail-header').getBoundingClientRect();
    return {
      field: field.id, height: innerHeight, top: r.top, bottom: r.bottom, barTop: b.top, barBottom: b.bottom,
      reached: hit === field,
      navAway: nav.top >= innerHeight - 1,
      capped: b.height <= innerHeight * 0.6 + 1,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, BAR);
  check(typing.field === 'search-list-name' && typing.top >= Math.max(0, typing.barTop) - 0.5
    && typing.bottom <= Math.min(typing.height, typing.barBottom) + 0.5 && typing.reached
    && typing.navAway && typing.capped && !typing.overflow,
  `${label}: with the keyboard open (${keyboard}px) the list name field stays in view inside the bar ${JSON.stringify(typing)}`);
  await screenshot(page, label, 'selection-bar-keyboard');
  await page.setViewport({ ...viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  console.log(`CHECKED ${label}: selection bar at ${positions.length} scroll positions, form open and keyboard ${keyboard}px`);
}

try {
  browser = await puppeteer.launch({ executablePath: edge, headless: !process.env.MRT_HEADED, args: ['--no-first-run', '--no-default-browser-check'] });
  let viewports = [{ width: 360, height: 800 }, { width: 412, height: 915 }, { width: 800, height: 360 }];
  if (mobileUi) viewports.push({ width: 360, height: 800, textScale: 1.3 }, { width: 1280, height: 900 });
  if (phoneHeader) viewports = [
    { width: 320, height: 740, textScale: 2, theme: 'light' },
    { width: 360, height: 800, theme: 'light', forced: true },
    { width: 390, height: 844, theme: 'light' },
    { width: 412, height: 915, theme: 'dark' },
    { width: 800, height: 360, theme: 'light' },
    { width: 800, height: 360, textScale: 2, theme: 'dark' },
    { width: 880, height: 900, theme: 'light' },
    { width: 881, height: 900, theme: 'light' },
    { width: 1280, height: 900, desktop: true, theme: 'light' },
    { width: 390, height: 844, desktop: true, theme: 'light' },
  ];
  if (seriesReadability) viewports = [
    { width: 320, height: 740 },
    { width: 360, height: 800 },
    { width: 412, height: 915 },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 360, height: 800, textScale: 2 },
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
    { width: 412, height: 915 },
    { width: 412, height: 915, textScale: 1.5 },
    { width: 412, height: 915, textScale: 2 },
    { width: 800, height: 360 },
    { width: 800, height: 360, textScale: 2 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (marvelAgesTarget) viewports = [
    { width: 320, height: 740 }, { width: 360, height: 800 }, { width: 412, height: 915 },
    { width: 320, height: 740, textScale: 1.5 },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 412, height: 915, textScale: 1.5 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (catalogReadability) viewports = placeholderAx
    ? catalogCardProfiles.filter((profile) => ['M11', 'M16'].includes(profile.id))
    : catalogCardProfiles;
  if (readingComposition) viewports = readingFactsAx ? readingProfiles.filter((profile) => !profile.desktop) : readingProfiles;
  if (spotlightControls) viewports = [
    { width: 320, height: 740 },
    { width: 360, height: 800 },
    { width: 412, height: 915, theme: 'dark' },
    { width: 360, height: 800, textScale: 1.5 },
    { width: 320, height: 740, textScale: 2 },
    { width: 800, height: 360 },
    { width: 1280, height: 900, desktop: true },
  ];
  if (alignment) viewports = alignmentProfiles;
  if (doneHint) viewports = [
    { width: 412, height: 915, textScale: 2 },
    { width: 360, height: 800, textScale: 2 },
    { width: 412, height: 915 },
    { width: 360, height: 800 },
    { width: 800, height: 360 },
  ];
  if (completionFocus) viewports = [{ width: 412, height: 915 }, { width: 800, height: 360 }];
  if (milestoneMode) viewports = [
    { width: 360, height: 800, theme: 'dark' },
    { width: 360, height: 800, textScale: 2, theme: 'light' },
    { width: 320, height: 740, textScale: 2, theme: 'dark' },
    { width: 800, height: 360, theme: 'light' },
  ];
  // Read is required above the bottom bar where it fits without the note: the portrait phones at
  // normal text. In landscape and with 200% text the card alone is taller than the screen.
  if (saveNotice) viewports = [
    { width: 360, height: 800, theme: 'light', readAbove: true },
    { width: 412, height: 915, theme: 'dark', covers: true, readAbove: true },
    { width: 800, height: 360, theme: 'light' },
    { width: 360, height: 800, textScale: 2, theme: 'dark' },
    { width: 1280, height: 900, desktop: true, theme: 'light', readAbove: true },
  ];
  // Read is required fully above the bar, and Done to start above it, where the card fits: the portrait
  // phones, a taller landscape screen, and the short landscape screens #857 is about, with a list name
  // on one line, as 302 of the 316 curated names are at 800 by 360. A name on two lines, 640px of width
  // and 200% text are measured limits, where Tab must still bring each command clear of the bar. Only
  // at 320 by 740 may Done's result bar scroll the page, to keep Done in view (#892).
  if (homeContinue) viewports = [
    { width: 360, height: 800, theme: 'light', readAbove: true },
    { width: 412, height: 915, theme: 'dark', covers: true, readAbove: true },
    { width: 320, height: 740, theme: 'light', readAbove: true, scrollToClear: true },
    { width: 800, height: 600, theme: 'dark', readAbove: true },
    { width: 800, height: 360, theme: 'light', readAbove: true, oneRow: true },
    { width: 732, height: 412, theme: 'dark', covers: true, readAbove: true, oneRow: true },
    { width: 640, height: 360, theme: 'light', oneRow: true },
    { width: 800, height: 360, theme: 'dark', oneRow: true, listName: 'New Ultimate Universe: Single-Issue Reading Order' },
    { width: 800, height: 360, textScale: 2, theme: 'light', oneRow: true },
    { width: 360, height: 800, textScale: 2, theme: 'dark' },
    { width: 1280, height: 900, desktop: true, theme: 'light', readAbove: true },
  ];
  if (longListName) viewports = [
    { width: 360, height: 800 },
    { width: 412, height: 915 },
    { width: 320, height: 740 },
    { width: 800, height: 360 },
    { width: 360, height: 800, textScale: 2 },
    { width: 412, height: 915, textScale: 2 },
  ];
  if (selectionBar) viewports = [
    { width: 360, height: 800, theme: 'light' },
    { width: 412, height: 915, theme: 'dark' },
    { width: 800, height: 360, theme: 'light' },
    { width: 360, height: 800, textScale: 2, theme: 'dark' },
    { width: 412, height: 915, textScale: 2, theme: 'light' },
    { width: 800, height: 360, textScale: 2, theme: 'dark' },
  ];
  const newsProfiles = [
    { width: 390, height: 844, theme: 'light', homeUpdates: true },
    { width: 390, height: 844, theme: 'dark', homeUpdates: true },
    { width: 390, height: 844, theme: 'light', textScale: 2, homeUpdates: true },
  ];
  if (homeUpdatesOnly) viewports = newsProfiles;
  else if (!onlyArgs.length && !noStyle) viewports.push(...newsProfiles);
  const onlyCase = process.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
  if ((catalogReadability || alignment) && onlyCase) viewports = viewports.filter((viewport) => onlyCase.split(',').includes(viewport.id));
  const onlyViewport = process.argv.find((arg) => arg.startsWith('--viewport='))?.slice('--viewport='.length);
  if (onlyViewport) viewports = viewports.filter((viewport) => (
    `${viewport.width}x${viewport.height}${viewport.textScale ? `@${viewport.textScale}` : ''}` === onlyViewport
  ));
  assert.ok(viewports.length, `Unknown viewport: ${onlyViewport}`);
  if (placeholderAx) assert.deepEqual(viewports.map((profile) => profile.id), ['M11', 'M16'],
    'Placeholder AX proof requires exactly M11 and M16');
  for (const viewport of viewports) {
    const homeUpdates = viewport.homeUpdates === true;
    const failuresBefore = failures.length;
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
    if (alignment) await alignmentFixtures(page, viewport);
    if (categoryReadability || marvelAgesTarget || catalogReadability || spotlightControls) await categoryFixtures(page);
    if (doneHint) await doneHintFixtures(page);
    if (completionFocus) await completionFocusFixtures(page);
    if (milestoneMode) await milestoneFixtures(page, viewport.theme);
    if (saveNotice) await saveNoticeFixtures(page, viewport);
    if (homeContinue) await homeContinueFixtures(page, viewport);
    if (longListName) await longListNameFixtures(page);
    if (selectionBar) await selectionBarFixtures(page, viewport.theme);
    if (spotlightControls || phoneHeader || homeUpdates) {
      await page.evaluateOnNewDocument((theme) => {
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme }));
      }, viewport.theme || 'light');
    }
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (homeUpdates && new URL(request.url()).origin !== origin) return request.abort();
      if ((readingComposition || placeholderAx || saveNotice || homeContinue) && request.resourceType() === 'image' && new URL(request.url()).host === 'i.annihil.us') {
        return request.respond({
          status: 200, contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#73579b"/><path d="M0 300L200 0" stroke="#fff" stroke-width="8"/></svg>',
        });
      }
      if ((seriesReadability || noteReadability || categoryReadability || marvelAgesTarget || catalogReadability || readingComposition || spotlightControls || alignment || selectionBar || saveNotice || homeContinue) && new URL(request.url()).origin !== origin) {
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
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mobileUi || phoneHeader || homeUpdates || categoryReadability || marvelAgesTarget || catalogReadability || spotlightControls || alignment ? catalog : { ...catalog, lists: [orderEntry] }) });
        }
        return request.continue();
      }
      return request.respond({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'ok', ...order.items[0], items: [], data: [] }),
      });
    });
    await page.evaluateOnNewDocument((reading, spotlight) => {
      if (!spotlight) localStorage.setItem('mrt.settings', JSON.stringify(reading ? { covers: false, theme: 'light' } : { covers: false }));
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
    }, readingComposition, spotlightControls || alignment || phoneHeader || homeUpdates || selectionBar || milestoneMode || saveNotice || homeContinue);
    await page.goto(origin, { waitUntil: 'networkidle0' });
    if (alignment) viewport.logoBase = await page.$eval('#home-h', (node) => parseFloat(getComputedStyle(node).fontSize));
    if (spotlightCase === 'geometry') await spotlightGeometryCheckpoint(page, 'unscaled postboot');
    if (viewport.textScale) {
      await page.evaluate((scale) => {
        for (const name of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
          const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
          document.documentElement.style.setProperty(name, `${value * scale}px`);
        }
      }, viewport.textScale);
    }
    if (alignment && viewport.textScale) {
      await page.$eval('#home-h', (node, font) => { node.style.fontSize = `${font}px`; }, viewport.logoBase * viewport.textScale);
    }
    if (spotlightCase === 'geometry') await spotlightGeometryCheckpoint(page, 'after existing text scaling');
    const label = `${viewport.width}x${viewport.height}${viewport.textScale ? ` ${viewport.textScale * 100}% text` : ''}`;
    const navigationToggle = await page.$eval('#btn-rail-toggle', (node) => {
      const { width, height } = node.getBoundingClientRect();
      return {
        labelVisible: !!node.querySelector('.rail-toggle-label').getClientRects().length,
        iconVisible: !!node.querySelector('svg').getClientRects().length,
        name: node.getAttribute('aria-label'), controls: node.getAttribute('aria-controls'),
        width, height,
      };
    });
    check(navigationToggle.labelVisible === (!!viewport.desktop && viewport.width <= 880),
      `${label}: Android navigation is icon-only; desktop label visibility is unchanged`);
    // The narrow toggle opens the bottom bar's More panel, so main.js names it More, as the
    // shared browser suite asserts. Each property is named on failure so a miss says which one.
    const navigationMisses = [
      !navigationToggle.iconVisible && 'icon hidden',
      navigationToggle.controls !== 'sidebar-panel' && `controls ${navigationToggle.controls}`,
      !(viewport.width <= 880 ? navigationToggle.name === 'More'
        : /^(Expand|Collapse) sidebar$/.test(navigationToggle.name)) && `name ${navigationToggle.name}`,
      !(viewport.desktop || (navigationToggle.width >= 48 && navigationToggle.height >= 48))
        && `target ${navigationToggle.width}x${navigationToggle.height}`,
    ].filter(Boolean);
    check(!navigationMisses.length,
      `${label}: navigation retains its icon, accessible name, controlled panel and touch target (${navigationMisses.join('; ')})`);
    const compactHome = !viewport.desktop && viewport.width <= 880;
    const homeBranding = await page.evaluate((key) => {
      const heading = document.querySelector('#home-h');
      const tagline = document.querySelector('.home-action');
      const brand = document.querySelector('.brand[data-view="home"]');
      const mark = brand.querySelector('.mark');
      const bounds = mark.getBoundingClientRect();
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      return {
        homeShown: !document.querySelector('#view-home').hidden,
        resumed: {
          hash: location.hash, active: saved?.active ?? null,
          saved: Object.hasOwn(saved?.lists ?? {}, saved?.active ?? ''),
          readShown: !document.querySelector('#view-read').hidden,
        },
        heading: heading.textContent, transform: getComputedStyle(heading).transform,
        taglineDisplay: getComputedStyle(tagline).display,
        marker: getComputedStyle(brand, '::before').content,
        iconLoaded: mark.complete && mark.naturalWidth > 0 && mark.naturalHeight > 0,
        iconWidth: bounds.width, iconHeight: bounds.height,
        iconInside: (() => {
          const box = brand.getBoundingClientRect();
          return bounds.left >= box.left && bounds.right <= box.right
            && bounds.top >= box.top && bounds.bottom <= box.bottom;
        })(),
      };
    }, KEY);
    // The app resumes an active Reading List at launch instead of showing Home, so a mode whose
    // fixture saves one starts on that list's reading view, where Home has no box. Edge then reports
    // the masthead's transform as none whatever its rule says, which failed every such profile in
    // seven modes (#882). The masthead is checked wherever a mode starts on Home. Elsewhere the check
    // is that resuming the fixture's list is the only reason Home is hidden, so a mode that lands
    // anywhere else still fails here.
    if (homeBranding.homeShown) {
      check(homeBranding.heading === 'RECAP PAGE!' && homeBranding.transform !== 'none'
        && (compactHome ? homeBranding.taglineDisplay === 'none' : homeBranding.taglineDisplay !== 'none'),
      `${label}: Home keeps the skewed masthead text at every width, without the tagline on compact Android (${JSON.stringify(homeBranding)})`);
    } else {
      const route = parseRoute(homeBranding.resumed.hash);
      check(homeBranding.resumed.saved && homeBranding.resumed.readShown
        && route?.view === 'read' && route.listId === homeBranding.resumed.active,
      `${label}: Home is hidden only because the app resumed the fixture's active Reading List (${JSON.stringify(homeBranding.resumed)})`);
    }
    // At 880px and below the brand is a bottom-bar destination, and styles.css sizes its mark
    // with the other bar icons at 20px; wider windows keep the 28px rail mark.
    const markSize = viewport.width <= 880 ? 20 : 28;
    const markMisses = [
      !homeBranding.iconLoaded && 'not loaded',
      (homeBranding.iconWidth !== markSize || homeBranding.iconHeight !== markSize)
        && `size ${homeBranding.iconWidth}x${homeBranding.iconHeight}, expected ${markSize}`,
      !homeBranding.iconInside && 'clipped by its control',
    ].filter(Boolean);
    check(!markMisses.length, `${label}: the full app icon remains visible (${markMisses.join('; ')})`);
    check(!compactHome || homeBranding.marker === 'none',
      `${label}: the compact brand has no stray selected-page stripe`);
    if (homeUpdates) {
      await homeUpdatesCheck(page, `${label} ${viewport.theme}`);
      check(errors.length === 0, `${label}: Home updates page errors ${errors.join('; ')}`);
      console.log(`CHECKED ${label} ${viewport.theme}: Home updates layout and actual bridge Back`);
      await context.close();
      continue;
    }
    if (phoneHeader) {
      const sharedCopy = await page.evaluate(() => {
        const footer = document.querySelector('.app-footer');
        return {
          recommendation: !!document.querySelector('#home-recommended'),
          // Home's start actions and the footer About became native hash links so browser
          // navigation gestures work, so both are found as links; buttons are still collected
          // so an extra start action of either kind is reported.
          startActions: [...document.querySelectorAll('#home-first-run :is(a[href], button)')]
            .map((action) => action.textContent.trim()),
          footer: footer.textContent.replace(/\s+/g, ' ').trim(),
          expectedFooter: `Unofficial fan project. Metadata and links only. \u00a9 ${new Date().getFullYear()} MARVEL`,
          footerHeight: footer.getBoundingClientRect().height,
          aboutAction: !!footer.querySelector('a[href="#/about"][data-view="about"]'),
        };
      });
      // Each property is named on failure, as the navigation and mark checks above do, so a miss
      // says which measurement disagreed rather than only that the combined check did.
      const homeMisses = [
        sharedCopy.recommendation && 'Setup recommendation present',
        JSON.stringify(sharedCopy.startActions) !== JSON.stringify(['Browse Reading Lists', 'Add comics'])
          && `start actions ${JSON.stringify(sharedCopy.startActions)}`,
      ].filter(Boolean);
      check(!homeMisses.length,
        `${label}: every platform keeps Home focused on Browse and Add without a Setup recommendation (${homeMisses.join('; ')})`);
      const footerMisses = [
        sharedCopy.footer !== sharedCopy.expectedFooter
          && `footer ${JSON.stringify(sharedCopy.footer)}, expected ${JSON.stringify(sharedCopy.expectedFooter)}`,
        !sharedCopy.aboutAction && 'About link to #/about missing',
      ].filter(Boolean);
      check(!footerMisses.length,
        `${label}: every platform keeps only the requested footer text and its About action (${footerMisses.join('; ')})`);
      if (!viewport.desktop && !viewport.textScale && viewport.width >= 360 && viewport.width <= 412) {
        check(sharedCopy.footerHeight <= 90,
          `${label}: the compact footer is at most 90px tall (${sharedCopy.footerHeight})`);
      }
      if (failures.length > failuresBefore) {
        await context.close();
        break;
      }
      if (!viewport.desktop) await measure(page, `${label} phone header`);
      await homeWordmarkCheck(page, label, viewport);
      await phoneHeaderCheck(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      console.log(`CHECKED ${label}${viewport.desktop ? ' desktop' : ''}: phone header and Home branding`);
      await context.close();
      continue;
    }
    if (alignment) {
      if (alignmentMutation) {
        await page.evaluate(() => {
          const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/android/mobile.css'));
          const media = [...sheet.cssRules].find((rule) => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 880px)');
          const rule = [...media.cssRules].find((entry) => entry.selectorText === '#view-home > .head');
          if (rule.style.justifyContent !== 'center') throw new Error('Mutation requires the actual Home centering declaration');
          rule.style.removeProperty('justify-content');
        });
      }
      await alignmentCheck(page, viewport);
      check(errors.length === 0, `${viewport.id}: page errors ${errors.join('; ')}`);
      await context.close();
      if (failures.length > failuresBefore) break;
      continue;
    }
    if (spotlightControls) {
      try {
        await spotlightControlCheck(page, viewport);
      } catch (error) {
        const diagnostics = await spotlightSnapshot(page);
        spotlightEvidence.push({ label, error: error.message, stack: error.stack, diagnostics, pageErrors: errors });
        console.error(`SPOTLIGHT INTERRUPTED ${JSON.stringify(spotlightEvidence.at(-1))}`);
        check(false, `${label}: spotlight scenario completed (${error.message})`);
      }
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      if (failures.length > failuresBefore) break;
      continue;
    }
    if (readingComposition) {
      await readingCompositionCheck(page, viewport);
      if (readingFactsAx) assert.deepEqual(errors, [], `${viewport.id}: no page errors`);
      else check(errors.length === 0, `${viewport.id}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (catalogReadability) {
      await catalogCardReadability({ page, viewport, catalog, check, route, click, placeholderAx });
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
    if (doneHint) {
      await doneHintGeometry(page, label);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (completionFocus) {
      await completionFocusJourney(page, label);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (saveNotice) {
      await saveNoticeCheck(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (homeContinue) {
      await homeContinueCheck(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (milestoneMode) {
      await milestoneJourney(page, `${label} ${viewport.theme}`);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (longListName) {
      await longListNameMenu(page, label, viewport);
      check(errors.length === 0, `${label}: page errors ${errors.join('; ')}`);
      await context.close();
      continue;
    }
    if (selectionBar) {
      await selectionBarCheck(page, `${label} ${viewport.theme}`, viewport);
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
      await seriesResultReadability(page, label, !!viewport.desktop, viewport.textScale || 1);
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
        // The shared launch page has offered "Back to Recap Page" since d6a995d1. It is a same-origin
        // route to Home, not a Marvel Unlimited action, so it is allowed only in exactly that form.
        const links = await page.$$eval('a', (nodes) => nodes.filter((node) => node.getClientRects().length)
          .map((node) => ({ id: node.id, href: node.href, target: node.target })));
        check(links.every((link) => link.id === 'fallback'
          || (link.id === 'return' && link.href === `${origin}/#/home` && !link.target)),
        `${label} ${mode}: no app action without a validated identifier ${JSON.stringify(links)}`);
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
      fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
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
  if (spotlightControls && process.env.MRT_SPOTLIGHT_EVIDENCE) {
    await writeFile(process.env.MRT_SPOTLIGHT_EVIDENCE,
      `${JSON.stringify({
        assertions, failures, profiles: spotlightEvidence,
        ...(spotlightCase === 'geometry' ? { geometry: spotlightGeometry } : {}),
      }, null, 2)}\n`);
  }
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
