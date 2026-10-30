// #980 and #979: a comic's own page leads with its cover on phones and tablets, and the stand-in tile
// for a missing or switched-off cover keeps its series name, initials and number in three bands.
// Run through `node scripts/browser-android.mjs --only=issue-poster`, which serves the generated
// Android page, answers every cover request with the drawing below and counts each request.
import { createEmptyState, createList, markRead, normalizeIssue } from '../src/js/lib/model.js';
import { KEY } from '../src/js/storage.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { decodePng } from './lib/painted-contrast.mjs';

const LIST = 'lantern';
const SERIES = 'Fictional: Lantern Harbor (2026)';
const ISSUE = 9800006;
const HELD = 9800999;
const COVER_PATH = (n) => `https://i.annihil.us/u/prod/marvel/i/mg/9/80/recap980made${n}`;
const COMMANDS = ['btn-issue-read', 'btn-issue-mark-read', 'btn-issue-note', 'issue-rating-trigger'];
// Selectors only #980's rules use in the phone layer. `.issue-focus-note` is older and stays.
const POSTER_RULE = /#view-issue|#issue-focus-card|#issue-focus-status|#btn-issue-retry|\.issue-focus(?![\w-])/;
const POSTER_RULES = 6;

export const POSTER_COVER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#2b5d8a"/><circle cx="70" cy="90" r="34" fill="#f2e6b8"/><path d="M0 230q50-30 100 0t100 0v70H0z" fill="#16324f"/></svg>';

// Shapes: `poster` (portrait, cover above the title), `beside` (a phone on its side) and `wide` (wide
// windows) are #980's; `card` is a short narrow window, which keeps today's card, and `desktop` the
// page without the phone layer. The E profiles sit on each side of every step in the rules.
export const issuePosterProfiles = [
  { id: 'P01', width: 360, height: 800, theme: 'light', shape: 'poster', order: true, lifecycle: true, scope: true },
  { id: 'P02', width: 360, height: 800, theme: 'dark', covers: false, shape: 'poster', tiles: true },
  { id: 'P03', width: 412, height: 915, theme: 'dark', shape: 'poster' },
  { id: 'P04', width: 320, height: 740, theme: 'light', shape: 'poster' },
  { id: 'P05', width: 375, height: 667, theme: 'light', shape: 'poster' },
  { id: 'P06', width: 360, height: 800, theme: 'light', shape: 'poster', textScale: 1.5 },
  { id: 'P07', width: 360, height: 800, theme: 'dark', covers: false, shape: 'poster', textScale: 2 },
  { id: 'P08', width: 360, height: 800, theme: 'light', shape: 'poster', longTitle: true },
  { id: 'P09', width: 800, height: 360, theme: 'light', shape: 'beside', order: true },
  { id: 'P10', width: 800, height: 360, theme: 'dark', covers: false, shape: 'beside', tiles: true },
  { id: 'P11', width: 820, height: 1180, theme: 'light', shape: 'poster', order: true },
  { id: 'P12', width: 1180, height: 820, theme: 'light', shape: 'wide', order: true },
  { id: 'P13', width: 320, height: 480, theme: 'light', shape: 'card', order: true },
  { id: 'P14', width: 360, height: 800, theme: 'dark', shape: 'poster', forced: true, reducedMotion: true },
  { id: 'P15', width: 360, height: 800, theme: 'light', covers: false, shape: 'poster', forced: true, tiles: true },
  { id: 'E1', width: 559, height: 599, theme: 'light', shape: 'card', edge: true },
  { id: 'E2', width: 560, height: 599, theme: 'light', shape: 'beside', edge: true },
  { id: 'E3', width: 559, height: 600, theme: 'light', shape: 'poster', edge: true },
  { id: 'E4', width: 880, height: 600, theme: 'light', shape: 'poster', edge: true },
  { id: 'E5', width: 881, height: 600, theme: 'light', shape: 'wide', edge: true },
  { id: 'D01', width: 1280, height: 900, theme: 'light', shape: 'desktop', desktop: true },
  { id: 'D02', width: 1280, height: 900, theme: 'dark', covers: false, shape: 'desktop', desktop: true, tiles: true },
  { id: 'D03', width: 600, height: 900, theme: 'light', covers: false, shape: 'desktop', desktop: true, tiles: true },
];

function posterState(profile) {
  let state = createEmptyState();
  const itemIds = [];
  for (let n = 1; n <= 8; n += 1) {
    const issueId = 9800000 + n;
    itemIds.push(issueId);
    state.issues[issueId] = normalizeIssue({
      issueId, number: n, seriesName: SERIES, pageCount: 32, onSale: `2026-0${n}-14`,
      title: profile.longTitle && issueId === ISSUE ? `${SERIES} #${n}: The Keeper Who Stayed` : `${SERIES} #${n}`,
      creators: [{ name: 'Ada Writer', role: 'writer' }, { name: 'Ben Penciller', role: 'penciller' }],
      cover: { path: COVER_PATH(n), ext: 'jpg' }, source: 'api', hydrated: true,
    });
  }
  state = createList(state, {
    id: LIST, name: 'Fictional: Lantern Harbor', itemIds,
    description: 'Made-up issues for the issue page check. Not a published reading list.',
  });
  for (const id of itemIds.slice(0, 3)) state = markRead(state, id, true, Date.UTC(2026, 0, 2));
  return state;
}

export async function issuePosterFixtures(page, profile) {
  await page.evaluateOnNewDocument((key, state, settings, educationKey, educationValue, held) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('mrt.settings', JSON.stringify(settings));
    localStorage.setItem(educationKey, educationValue);
    const original = window.fetch.bind(window);
    const test = { held: [], unexpected: [] };
    window.__posterTest = test;
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) return original(input, options);
      if (url.pathname === '/v1/health') {
        return Promise.resolve(new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } }));
      }
      // The metadata request for the held comic waits until the check releases it as not found, so
      // the page can be measured while it loads.
      if (url.pathname === `/v1/issues/${held}`) {
        return new Promise((resolve, reject) => {
          test.held.push(() => resolve(new Response('{"code":404}', { status: 404, headers: { 'content-type': 'application/json' } })));
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      test.unexpected.push(url.href);
      return Promise.reject(new TypeError(`Unexpected issue poster request: ${url.href}`));
    };
  }, KEY, posterState(profile), { covers: profile.covers !== false, theme: profile.theme || 'light' },
  SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, HELD);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((image) => image.src && !image.complete && image.checkVisibility())
      .map((image) => new Promise((done) => { image.addEventListener('load', done, { once: true }); image.addEventListener('error', done, { once: true }); })));
    scrollTo(0, 0);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function openIssue(page) {
  await page.evaluate((id, list) => { location.hash = `#/issue/${id}?list=${list}`; }, ISSUE, LIST);
  await page.waitForFunction((id) => {
    const card = document.querySelector('#issue-focus-card');
    return !document.querySelector('#view-issue').hidden && !card.hidden
      && document.querySelector('#issue-focus-h').textContent.includes(`#${id % 100}`);
  }, {}, ISSUE);
  await settle(page);
}

async function posterGeometry(page) {
  return page.evaluate(() => {
    const box = (node) => {
      if (!node?.checkVisibility()) return null;
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const style = (node) => getComputedStyle(node);
    const view = document.querySelector('#view-issue');
    const card = document.querySelector('#issue-focus-card');
    const art = card.querySelector('.art');
    const image = document.querySelector('#issue-focus-img');
    const heading = document.querySelector('#issue-focus-h');
    const head = view.querySelector(':scope > .head');
    const nav = document.querySelector('.rail-header');
    const navTop = nav?.checkVisibility() && style(nav).position === 'fixed' ? nav.getBoundingClientRect().top : null;
    const range = document.createRange();
    range.selectNodeContents(heading);
    const root = style(document.documentElement);
    return {
      vw: innerWidth, vh: innerHeight, rem: parseFloat(root.fontSize), em: parseFloat(style(art).fontSize),
      navHeight: parseFloat(root.getPropertyValue('--mobile-nav-height')) || 80, navTop,
      view: box(view), viewDisplay: style(view).display, viewDirection: style(view).flexDirection,
      cardDisplay: style(card).display, innerDisplay: style(card.querySelector('.hero-in')).display,
      cardBorder: parseFloat(style(card).borderTopWidth),
      backdrop: style(card.querySelector('.hero-bg')).display, fade: style(card.querySelector('.hero-fade')).display,
      art: box(art), image: box(image), source: image.checkVisibility() ? image.currentSrc : null,
      fallback: box(document.querySelector('#issue-focus-fb')),
      crumb: box(view.querySelector(':scope > .breadcrumb')), head: box(head), heading: box(heading),
      headAlign: style(head).textAlign, headJustify: style(head).justifyContent,
      headingLines: new Set([...range.getClientRects()].filter((rect) => rect.width).map((rect) => Math.round(rect.top))).size,
      read: box(document.querySelector('#btn-issue-read')), mark: box(document.querySelector('#btn-issue-mark-read')),
      controls: box(card.querySelector('.issue-reading-controls')), body: box(card.querySelector('.hero-body')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      motion: document.getAnimations().filter((animation) => view.contains(animation.effect?.target)).length,
    };
  });
}

// The width each shape's rule in the phone layer gives the cover, recomputed from the page.
function coverWidth(shape, g) {
  const clamp = (low, value, high) => Math.min(Math.max(value, low), high);
  if (shape === 'poster') {
    return Math.max(Math.min(0.4 * g.vw, 8 * g.rem), Math.min((g.vh - g.navHeight - 25 * g.em) * 2 / 3, 0.62 * g.vw, 20 * g.rem));
  }
  if (shape === 'beside') return clamp(7 * g.rem, (g.vh - g.navHeight - 5 * g.em) * 2 / 3, 14 * g.rem);
  if (shape === 'wide') return clamp(13.5 * g.rem, (g.vh - 8 * g.rem) * 2 / 3, 20 * g.rem);
  return null;
}

function shapeMisses(shape, g) {
  const center = (rect) => (rect.left + rect.right) / 2;
  const dissolved = g.cardDisplay === 'contents' && g.innerDisplay === 'contents' && g.backdrop === 'none' && g.fade === 'none';
  if (shape === 'poster') {
    return [
      !(g.viewDisplay === 'flex' && g.viewDirection === 'column') && `view ${g.viewDisplay} ${g.viewDirection}`,
      !dissolved && `card ${g.cardDisplay}/${g.innerDisplay}, backdrop ${g.backdrop}/${g.fade}`,
      Math.abs(center(g.art) - center(g.view)) > 1 && `cover ${center(g.art) - center(g.view)}px off center`,
      g.crumb && g.art.top < g.crumb.bottom && 'cover above the parent link',
      g.art.bottom > g.head.top && 'cover not above the title',
      !(g.headAlign === 'center' && g.headJustify === 'center') && `title aligned ${g.headAlign} ${g.headJustify}`,
      Math.abs(center(g.heading) - center(g.view)) > 1 && 'title off center',
      g.controls.top < g.head.bottom && 'commands above the title',
      g.body.top < g.controls.bottom && 'details above the commands',
    ].filter(Boolean);
  }
  if (shape === 'beside' || shape === 'wide') {
    return [
      g.viewDisplay !== 'grid' && `view ${g.viewDisplay}`,
      !dissolved && `card ${g.cardDisplay}/${g.innerDisplay}, backdrop ${g.backdrop}/${g.fade}`,
      Math.abs(g.art.left - g.view.left) > 1 && 'cover not at the start',
      Math.abs(g.art.top - g.head.top) > 1 && `cover top ${g.art.top} beside a title at ${g.head.top}`,
      [g.head, g.controls, g.body].some((rect) => rect.left < g.art.right) && 'text column overlaps the cover',
      g.body.top < g.controls.bottom && 'details above the commands',
      g.headAlign === 'center' && 'title centered beside the cover',
    ].filter(Boolean);
  }
  if (shape === 'card') {
    return [
      g.viewDisplay !== 'block' && `view ${g.viewDisplay}`,
      !(g.cardDisplay === 'block' && g.cardBorder >= 1 && g.backdrop === 'block') && `card ${g.cardDisplay}, border ${g.cardBorder}, backdrop ${g.backdrop}`,
      !(g.read && g.read.top < g.art.top) && 'commands not ahead of the cover',
      g.headAlign === 'center' && 'title centered',
    ].filter(Boolean);
  }
  return [
    g.viewDisplay !== 'block' && `view ${g.viewDisplay}`,
    !(g.cardDisplay === 'block' && g.innerDisplay === 'grid' && g.backdrop === 'block') && `card ${g.cardDisplay}/${g.innerDisplay}, backdrop ${g.backdrop}`,
    g.vw > 700 && g.art.right > g.controls.left && 'cover not in its own column',
    g.headAlign === 'center' && 'title centered',
  ].filter(Boolean);
}

// Removes exactly #980's rules from the phone layer in this document, for a comparison with the
// page without them. A count other than six means the rules changed and the comparison is stale.
async function withoutPosterRules(page) {
  return page.evaluate((source) => {
    const pattern = new RegExp(source);
    const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/android/mobile.css'));
    let removed = 0;
    for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
      const rule = sheet.cssRules[index];
      const inner = rule instanceof CSSMediaRule ? [...rule.cssRules] : [rule];
      if (inner.length && inner.every((entry) => pattern.test(entry.selectorText ?? ''))) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
    return removed;
  }, POSTER_RULE.source);
}

async function readingOrder(page) {
  await page.evaluate(() => {
    const heading = document.querySelector('#issue-focus-h');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  });
  const tab = [];
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    tab.push(await page.evaluate(() => {
      const node = document.activeElement;
      return node?.id || `${node?.tagName}:${node?.textContent.trim().slice(0, 24)}`;
    }));
  }
  const client = await page.createCDPSession();
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#view-issue' });
  const { node } = await client.send('DOM.describeNode', { nodeId });
  await client.detach();
  const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
  const walk = (entry) => (entry ? [
    ...(!entry.ignored && !['generic', 'none', 'InlineTextBox', 'LineBreak'].includes(entry.role?.value)
      ? [`${entry.role?.value}:${entry.name?.value ?? ''}`] : []),
    ...(entry.childIds || []).flatMap((key) => walk(byId.get(key))),
  ] : []);
  return { tab, ax: walk(nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId)) };
}

// The stand-in's initials against its text, from the painted page. A tile is captured as drawn, with
// its initials hidden, and with them unclipped. Every pixel the initials change is initial, and none
// may fall on the series name or the number. At normal text nothing may be clipped either, so the tile
// as drawn must match its unclipped copy. Both the tile's own initials and a single initial are drawn,
// since a one-word series shows one larger letter. The initials are hidden rather than removed, since
// a tile whose height follows its content would otherwise move its text between the captures.
const INITIALS = '.cover-fallback.cover-fallback::before, .cover-fallback.cover-fallback::after';
const UNCLIPPED = `${INITIALS} { overflow: visible !important; }`;
const HIDDEN = `${INITIALS} { visibility: hidden !important; }`;

async function frames(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

// The app's content security policy refuses inline styles, so the comparison edits the shared
// stylesheet through the CSS object model, which the policy leaves alone.
async function withRule(page, rule, run) {
  await page.evaluate((text) => {
    const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/styles.css'));
    sheet.insertRule(text, sheet.cssRules.length);
  }, rule);
  await frames(page);
  try {
    return await run();
  } finally {
    await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/styles.css'));
      sheet.deleteRule(sheet.cssRules.length - 1);
    });
    await frames(page);
  }
}

const differs = (a, b) => Math.max(...a.map((value, channel) => Math.abs(value - b[channel]))) > 8;

async function setInitials(handle, [first, second]) {
  await handle.evaluate((tile, [one, two]) => {
    tile.dataset.initialFirst = one;
    tile.dataset.initialSecond = two;
    tile.classList.toggle('one-initial', !two);
  }, [first, second]);
}

async function tileLayout(handle) {
  return handle.evaluate((tile) => {
    const box = tile.getBoundingClientRect();
    const style = getComputedStyle(tile);
    const texts = [];
    for (const part of tile.children) {
      const bounds = part.getBoundingClientRect();
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) {
          const left = Math.max(rect.left, bounds.left), right = Math.min(rect.right, bounds.right);
          const top = Math.max(rect.top, bounds.top), bottom = Math.min(rect.bottom, bounds.bottom);
          if (right - left > 2 && bottom - top > 2) texts.push({ left: left - box.left, right: right - box.left, top: top - box.top, bottom: bottom - box.top });
        }
      }
    }
    const name = tile.querySelector('.fs, .s, .ofs');
    return {
      display: style.display, rows: style.gridTemplateRows.split(' ').map(parseFloat), texts,
      nameLines: name ? name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight) : 0,
      own: [tile.dataset.initialFirst, tile.dataset.initialSecond],
    };
  });
}

async function drawInitials(page, handle, letters) {
  await setInitials(handle, letters);
  await frames(page);
  const { texts } = await tileLayout(handle);
  const capture = async () => decodePng(await handle.screenshot());
  const painted = await capture();
  const free = await withRule(page, UNCLIPPED, capture);
  const bare = await withRule(page, HIDDEN, capture);
  let ink = 0, collisions = 0, clipped = 0;
  for (let y = 0; y < painted.height; y += 1) {
    for (let x = 0; x < painted.width; x += 1) {
      const drawn = painted.pixel(x, y);
      if (differs(drawn, free.pixel(x, y))) clipped += 1;
      if (!differs(drawn, bare.pixel(x, y))) continue;
      ink += 1;
      if (texts.some((rect) => x + 0.5 > rect.left + 1 && x + 0.5 < rect.right - 1 && y + 0.5 > rect.top + 1 && y + 0.5 < rect.bottom - 1)) collisions += 1;
    }
  }
  return { letters: letters.join(''), ink, collisions, clipped };
}

async function tileBands(page, selector, label, check, normalText) {
  const handle = await page.$(selector);
  if (!handle || !(await handle.isVisible())) {
    check(false, `${label}: stand-in ${selector} is shown`);
    return;
  }
  await handle.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await settle(page);
  await handle.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const layout = await tileLayout(handle);
  const drawn = [];
  for (const letters of [layout.own, [layout.own[0], '']]) drawn.push(await drawInitials(page, handle, letters));
  await setInitials(handle, layout.own);
  check(layout.display === 'grid' && layout.rows.length === 3, `${label}: ${selector} lays its parts in three bands (${layout.display} ${layout.rows.join(' ')})`);
  check(Math.abs(layout.nameLines - Math.round(layout.nameLines)) < 0.05,
    `${label}: ${selector} series name ends on a whole line (${layout.nameLines.toFixed(2)} lines)`);
  for (const result of drawn) {
    check(result.collisions === 0,
      `${label}: ${selector} initials ${result.letters} stay off the series name and number (${result.collisions} of ${result.ink} initial pixels on text)`);
    if (normalText) {
      check(result.ink > 0 && result.clipped === 0,
        `${label}: ${selector} initials ${result.letters} are drawn whole at normal text (${result.clipped} of ${result.ink} pixels clipped)`);
    }
  }
  console.log(`TILE ${label} ${selector}: bands ${layout.rows.map((row) => Math.round(row)).join('/')}, name ${Math.round(layout.nameLines)} lines, ${drawn.map((result) => `${result.letters} ${result.ink} pixels, ${result.collisions} on text, ${result.clipped} clipped`).join('; ')}`);
}
async function staleContent(page, check, label) {
  const measure = (byline) => page.evaluate((text) => {
    const view = document.querySelector('#view-issue');
    const card = document.querySelector('#issue-focus-card');
    return {
      heading: document.querySelector('#issue-focus-h').textContent,
      cardHidden: card.hidden, cardDisplay: getComputedStyle(card).display,
      viewDisplay: getComputedStyle(view).display,
      rendered: [...card.querySelectorAll('*')].filter((node) => node.getClientRects().length > 0).map((node) => node.id || node.className),
      stale: view.innerText.includes(text),
    };
  }, byline);
  const byline = await page.$eval('#issue-focus-by', (node) => node.textContent);
  const quiet = (state) => state.cardHidden && state.cardDisplay === 'none' && !state.rendered.length && !state.stale;
  await page.evaluate((id) => { location.hash = `#/issue/${id}`; }, HELD);
  await page.waitForFunction(() => document.querySelector('#issue-focus-h').textContent === 'Loading issue details', { polling: 50 });
  const loading = await measure(byline);
  check(quiet(loading) && loading.viewDisplay !== 'none',
    `${label}: a loading comic shows nothing of the last one ${JSON.stringify(loading)}`);
  await page.waitForFunction(() => window.__posterTest.held.length > 0, { polling: 50 });
  await page.evaluate(() => window.__posterTest.held.splice(0).forEach((release) => release()));
  await page.waitForFunction(() => document.querySelector('#issue-focus-h').textContent === 'Issue unavailable', { polling: 50 });
  const unavailable = await measure(byline);
  check(quiet(unavailable), `${label}: an unavailable comic shows nothing of the last one ${JSON.stringify(unavailable)}`);
  await openIssue(page);
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForSelector('#view-library:not([hidden])');
  const away = await page.evaluate(() => {
    const view = document.querySelector('#view-issue');
    return {
      hidden: view.hidden, display: getComputedStyle(view).display,
      rendered: [...view.querySelectorAll('*')].filter((node) => node.getClientRects().length > 0).length,
    };
  });
  check(away.hidden && away.display === 'none' && away.rendered === 0,
    `${label}: leaving the page hides all of it ${JSON.stringify(away)}`);
}

async function headingScope(page, check, label) {
  for (const [route, view] of [['read/lantern', '#view-read'], ['library', '#view-library']]) {
    await page.evaluate((hash) => { location.hash = `#/${hash}`; }, route);
    await page.waitForSelector(`${view}:not([hidden])`);
    const head = await page.$eval(`${view} > .head`, (node) => ({
      align: getComputedStyle(node).textAlign, justify: getComputedStyle(node).justifyContent,
    }));
    check(head.align !== 'center' && head.justify !== 'center',
      `${label}: ${view} keeps its heading at the start ${JSON.stringify(head)}`);
  }
}

async function heroGeometry(page) {
  await page.evaluate(() => { location.hash = '#/read/lantern'; });
  await page.waitForSelector('#view-read:not([hidden]) #hero:not([hidden])');
  await settle(page);
  return page.evaluate(() => Object.fromEntries(['#hero', '#hero .art', '#hero-title', '#hero-by', '#btn-hero-read', '#btn-hero-done']
    .map((selector) => {
      const node = document.querySelector(selector);
      const { left, top, width, height } = node.getBoundingClientRect();
      return [selector, [left, top, width, height].map((value) => Math.round(value))];
    })));
}

export async function issuePosterCheck({ page, profile, check, imageRequests }) {
  const label = `${profile.id} ${profile.width}x${profile.height}${profile.textScale ? ` ${profile.textScale * 100}% text` : ''}`;
  const features = [];
  if (profile.forced) features.push({ name: 'forced-colors', value: 'active' });
  if (profile.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  if (features.length) await page.emulateMediaFeatures(features);
  const covers = profile.covers !== false;
  await openIssue(page);
  const g = await posterGeometry(page);
  const misses = shapeMisses(profile.shape, g);
  check(!misses.length, `${label}: ${profile.shape} layout (${misses.join('; ')})`);
  const width = coverWidth(profile.shape, g);
  if (width != null) {
    check(Math.abs(g.art.width - width) <= 1, `${label}: cover ${g.art.width}px wide, its rule gives ${width.toFixed(1)}px`);
  }
  const shown = covers ? g.image : g.fallback;
  // Up to 700px wide, the desktop page's stand-in has no set proportion and grows with its text, as
  // it did before #980.
  const proportioned = covers || !(profile.desktop && g.vw <= 700);
  check(!!shown && Math.abs(shown.width - g.art.width) <= 1 && (!proportioned || Math.abs(shown.height - 1.5 * g.art.width) <= 1),
    `${label}: ${covers ? 'cover' : 'stand-in'} fills the cover's ${proportioned ? '2:3 ' : ''}box ${JSON.stringify({ art: g.art?.width, shown })}`);
  check(g.overflow <= 1, `${label}: no sideways scrolling (${g.overflow}px)`);
  check(g.motion === 0, `${label}: nothing on the page animates (${g.motion})`);
  if (!profile.edge && !profile.desktop && profile.shape !== 'card' && (profile.textScale ?? 1) <= 1.5) {
    const limit = g.navTop ?? g.vh;
    const both = profile.shape !== 'poster' || g.headingLines <= 2;
    check(g.read && g.read.bottom <= limit && (!both || (g.mark && g.mark.bottom <= limit)),
      `${label}: Read${both ? ' and Mark as read' : ''} end above the bar at ${limit} (${JSON.stringify({ read: g.read?.bottom, mark: g.mark?.bottom, lines: g.headingLines })})`);
    if (profile.shape === 'beside') check(g.art.bottom <= limit, `${label}: the cover ends above the bar (${g.art.bottom} of ${limit})`);
  }
  if (profile.longTitle) check(g.headingLines === 3, `${label}: the long title takes three lines (${g.headingLines})`);
  const own = imageRequests.filter((url) => url.startsWith(`${COVER_PATH(ISSUE % 100)}/`));
  if (!covers) {
    check(imageRequests.length === 0, `${label}: cover art off requests no image (${imageRequests.join(', ')})`);
  } else if (profile.desktop) {
    check(g.source?.endsWith('/portrait_uncanny.jpg') && own.filter((url) => url.endsWith('/portrait_uncanny.jpg')).length === 1,
      `${label}: desktop keeps the 300px cover (${g.source}; ${own.join(', ')})`);
  } else {
    const detail = own.filter((url) => url.endsWith('/detail.jpg')).length;
    check(g.source?.endsWith('/detail.jpg') && !own.some((url) => url.endsWith('/portrait_uncanny.jpg'))
      && (profile.shape === 'card' ? detail >= 1 : detail === 1),
    `${label}: the cover is Marvel's 500px image, requested once with no backdrop (${g.source}; ${own.join(', ')})`);
  }
  const unexpected = await page.evaluate(() => window.__posterTest.unexpected);
  check(!unexpected.length, `${label}: no metadata requests beyond the held one (${unexpected.join(', ')})`);
  if (!covers && !profile.desktop) {
    await tileBands(page, '#issue-focus-fb', label, check, !profile.textScale);
  }
  if (profile.lifecycle) await staleContent(page, check, label);
  if (profile.order) {
    await openIssue(page);
    const withPoster = await readingOrder(page);
    const removed = await withoutPosterRules(page);
    check(removed === POSTER_RULES, `${label}: found the ${POSTER_RULES} rules to compare against (${removed})`);
    await settle(page);
    const without = await readingOrder(page);
    check(JSON.stringify(withPoster.tab.slice(0, 4)) === JSON.stringify(COMMANDS),
      `${label}: Tab from the title reaches Read, Mark as read, Add note and Rate in turn (${withPoster.tab.join(', ')})`);
    check(JSON.stringify(withPoster.tab) === JSON.stringify(without.tab),
      `${label}: Tab order matches the page without #980's rules (${withPoster.tab.join(', ')} | ${without.tab.join(', ')})`);
    check(withPoster.ax.length > 10 && JSON.stringify(withPoster.ax) === JSON.stringify(without.ax),
      `${label}: accessibility tree order matches the page without #980's rules (${withPoster.ax.length} nodes)`);
    console.log(`ORDER ${label}: Tab ${withPoster.tab.join(' > ')}; ${withPoster.ax.length} accessibility nodes, the same without #980's rules`);
    await page.reload({ waitUntil: 'networkidle0' });
  }
  if (profile.scope) {
    await headingScope(page, check, label);
    const heroWith = await heroGeometry(page);
    check(await withoutPosterRules(page) === POSTER_RULES, `${label}: found the ${POSTER_RULES} rules for the next-issue card comparison`);
    await settle(page);
    const heroWithout = await heroGeometry(page);
    check(JSON.stringify(heroWith) === JSON.stringify(heroWithout),
      `${label}: the Reading List's next-issue card is unchanged ${JSON.stringify(heroWith)} ${JSON.stringify(heroWithout)}`);
    await page.reload({ waitUntil: 'networkidle0' });
  }
  if (profile.tiles) {
    const normal = !profile.textScale;
    if (profile.desktop) await tileBands(page, '#issue-focus-fb', label, check, normal);
    await page.evaluate(() => { location.hash = '#/read/lantern'; });
    await page.waitForSelector('#view-read:not([hidden]) #hero:not([hidden])');
    await tileBands(page, '#hero-fb', label, check, normal);
    await tileBands(page, '#shelf .tile .tf', label, check, normal);
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForSelector('#view-home:not([hidden]) #home-continue:not([hidden])');
    await tileBands(page, '#chero-fb', label, check, normal);
    await page.evaluate(() => { location.hash = '#/catalog'; });
    await page.waitForSelector('#view-catalog:not([hidden]) .ocard-art .of');
    const longest = await page.$$eval('.ocard-art .of', (tiles) => {
      const shown = tiles.filter((tile) => tile.checkVisibility()).slice(0, 40);
      const pick = shown.reduce((best, tile) => (tile.textContent.length > best.textContent.length ? tile : best), shown[0]);
      pick.dataset.posterCheck = 'longest';
      return pick.textContent;
    });
    await tileBands(page, '.ocard-art .of[data-poster-check="longest"]', `${label} "${longest}"`, check, normal);
  }
  console.log(`CHECKED ${label}: ${profile.shape}, cover ${Math.round(g.art.width)}px at ${Math.round(g.art.top)}, Read ${Math.round(g.read?.top ?? -1)}-${Math.round(g.read?.bottom ?? -1)}, bar ${g.navTop ?? 'none'}`);
}
