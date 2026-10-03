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
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { issuePresentation } from '../src/js/lib/issueFocus.js';
import { availableHomeCategories, groupCatalog, HOME_CATEGORIES, publishingAgeGroups, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { parseRoute } from '../src/js/lib/route.js';
import { catalogCardProfiles, catalogCardReadability } from './browser-android-catalog-cards.mjs';
import {
  catalogFacets, defaultPath, filterByFacet, filterBySpotlightKind, modernTimelineLists,
  parseCatalog, pathPlacements, searchCatalog, shelfLists, sortSpotlightStories,
  sourceLabel, sourceLink, spotlightKindLabel, spotlightSortLabel,
} from '../src/js/lib/catalog.js';

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
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
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
  const stories = () => sortSpotlightStories(groupCatalog(searchCatalog(
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
if (readingComposition || alignment) {
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
  await click(page, '#hero-more-actions > summary');
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
    check(await page.$eval('#chero-count', (node) => node.textContent === '3 of 89 issues read'), `${id}: populated reading fixture on Home`);
  } else {
    check(await page.$eval('#btn-home-add', (node) => !!node.getClientRects().length), `${id}: current fresh Home actions`);
  }
  const home = await record('home', ['#view-home > .head', '.home-lockup', '#home-h', ...(compactHome ? [] : ['.home-action']),
    '#home-categories', '.brand[data-view="home"]']);
  const [head, lockup, logo] = home.nodes;
  const gutters = { left: lockup.box.left - head.content.left, right: head.content.right - lockup.box.right };
  const centerError = Math.abs((lockup.box.left + lockup.box.right - head.content.left - head.content.right) / 2);
  check(compactHome ? logo.text === 'Browse. Choose. Read.'
    : logo.text === 'RECAP PAGE!' && home.nodes.find((node) => node.selector === '.home-action').text === 'Browse. Choose. Read.',
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
    await page.waitForFunction(() => document.querySelector('#hero-title').textContent === 'Avengers (2012) #4');
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
    await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => document.querySelector('#home-h').textContent === 'RECAP PAGE!');
    check(await page.$eval('.home-action', (node) => !!node.getClientRects().length),
      `${label}: widening restores the original Home masthead and tagline`);
    await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => document.querySelector('#home-h').textContent === 'Browse. Choose. Read.');
    check(await page.$eval('.home-action', (node) => !node.getClientRects().length),
      `${label}: narrowing restores one visible tagline heading`);
  }
}

async function mobileLayout(page, label, narrow) {
  await page.waitForSelector('#home-first-run:not([hidden]) #btn-home-browse');
  check(await page.$eval('#home-first-run', (region) => (
    !region.querySelector('#home-recommended')
      && region.querySelectorAll('button').length === 2
  )), `${label}: Home contains only the Browse and Add starting choices`);
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
  if (phoneHeader) viewports = [
    { width: 320, height: 740, textScale: 2, theme: 'light' },
    { width: 360, height: 800, theme: 'light' },
    { width: 390, height: 844, theme: 'light' },
    { width: 412, height: 915, theme: 'dark' },
    { width: 800, height: 360, theme: 'light' },
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
    if (spotlightControls || phoneHeader) {
      await page.evaluateOnNewDocument((theme) => {
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme }));
      }, viewport.theme || 'light');
    }
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if ((readingComposition || placeholderAx) && request.resourceType() === 'image' && new URL(request.url()).host === 'i.annihil.us') {
        return request.respond({
          status: 200, contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#73579b"/><path d="M0 300L200 0" stroke="#fff" stroke-width="8"/></svg>',
        });
      }
      if ((seriesReadability || noteReadability || categoryReadability || marvelAgesTarget || catalogReadability || readingComposition || spotlightControls || alignment) && new URL(request.url()).origin !== origin) {
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
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mobileUi || phoneHeader || categoryReadability || marvelAgesTarget || catalogReadability || spotlightControls || alignment ? catalog : { ...catalog, lists: [orderEntry] }) });
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
    }, readingComposition, spotlightControls || alignment || phoneHeader);
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
    check(navigationToggle.iconVisible && navigationToggle.controls === 'sidebar-panel'
      && (viewport.width <= 880 ? navigationToggle.name === 'Navigation'
        : /^(Expand|Collapse) sidebar$/.test(navigationToggle.name))
      && (viewport.desktop || (navigationToggle.width >= 48 && navigationToggle.height >= 48)),
    `${label}: navigation retains its icon, accessible name, controlled panel and touch target`);
    const compactHome = !viewport.desktop && viewport.width <= 880;
    const homeBranding = await page.evaluate(() => {
      const heading = document.querySelector('#home-h');
      const tagline = document.querySelector('.home-action');
      const brand = document.querySelector('.brand[data-view="home"]');
      const mark = brand.querySelector('.mark');
      const bounds = mark.getBoundingClientRect();
      return {
        heading: heading.textContent, transform: getComputedStyle(heading).transform,
        taglineDisplay: getComputedStyle(tagline).display,
        marker: getComputedStyle(brand, '::before').content,
        iconLoaded: mark.complete && mark.naturalWidth > 0 && mark.naturalHeight > 0,
        iconWidth: bounds.width, iconHeight: bounds.height,
      };
    });
    check(homeBranding.heading === (compactHome ? 'Browse. Choose. Read.' : 'RECAP PAGE!')
      && (compactHome ? homeBranding.taglineDisplay === 'none' && homeBranding.transform === 'none'
        : homeBranding.taglineDisplay !== 'none'),
    `${label}: compact Android keeps top-only branding and one tagline; other mastheads are unchanged`);
    check(homeBranding.iconLoaded && homeBranding.iconWidth === 28 && homeBranding.iconHeight === 28,
      `${label}: the full app icon remains visible`);
    check(!compactHome || homeBranding.marker === 'none',
      `${label}: the compact brand has no stray selected-page stripe`);
    if (phoneHeader) {
      const sharedCopy = await page.evaluate(() => {
        const footer = document.querySelector('.app-footer');
        return {
          recommendation: !!document.querySelector('#home-recommended'),
          startActions: [...document.querySelectorAll('#home-first-run button')]
            .map((button) => button.textContent.trim()),
          footer: footer.textContent.replace(/\s+/g, ' ').trim(),
          expectedFooter: `Unofficial fan project. Metadata and links only. \u00a9 ${new Date().getFullYear()} MARVEL`,
          footerHeight: footer.getBoundingClientRect().height,
          aboutAction: !!footer.querySelector('button[data-view="about"]'),
        };
      });
      check(!sharedCopy.recommendation
        && JSON.stringify(sharedCopy.startActions) === JSON.stringify(['Browse Reading Lists', 'Add comics']),
      `${label}: every platform keeps Home focused on Browse and Add without a Setup recommendation`);
      check(sharedCopy.footer === sharedCopy.expectedFooter && sharedCopy.aboutAction,
        `${label}: every platform keeps only the requested footer text and its About action`);
      if (!viewport.desktop && !viewport.textScale && viewport.width >= 360 && viewport.width <= 412) {
        check(sharedCopy.footerHeight <= 90,
          `${label}: the compact footer is at most 90px tall (${sharedCopy.footerHeight})`);
      }
      if (failures.length > failuresBefore) {
        await context.close();
        break;
      }
      if (!viewport.desktop) await measure(page, `${label} phone header`);
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
