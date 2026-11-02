// #846: keyboard focus near the foot of the reading card moved the card's own content. The card was
// overflow: hidden, which made it a scroll container, and its decorative layer, scaled 1.3, reached
// past its foot by 15 per cent of its height. At 880px and below, focus keeps clear of the bottom bar
// by scrolling every container in its chain, so Tab onto More comic actions scrolled the card itself
// and cut off "Read this next" at its top, which stayed cut off after a visit to Settings. That label
// went in #1061, so the measure is now the cover, the card's first thing. The Android
// build has its own owner, --only=reading-composition. Runs on the ephemeral port like every scenario
// not listed for the app origin.
import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';

const KEY = 'mrt.state.v2';
// The order the Android reading owner measures, so the card carries real titles, creators and facts.
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const order = JSON.parse(readFileSync(new URL(`../src/data/${catalog.lists.find((list) => list.id === 'hickman-minimal').file}`, import.meta.url), 'utf8'));
const next = order.items[3].title;

function fixture(note = '', other = false, { empty = false, single = false } = {}) {
  let state = createList(createEmptyState(), { id: 'card', name: order.name, description: order.description, catalogId: order.id, note });
  const items = empty ? [] : single ? order.items.slice(3, 4) : order.items;
  state = addIssuesToList(state, 'card', items).state;
  if (!single) for (const item of order.items.slice(0, empty ? 0 : 3)) state = markRead(state, item.issueId, true, 1767225600000);
  if (other) {
    state = createList(state, { id: 'other', name: 'Another reading list' });
    state = addIssuesToList(state, 'other', order.items.slice(3, 6)).state;
  }
  return state;
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

// A list under way, past the one-time save note, so the card is the first thing in the reading view.
async function setup(page, { width, height, theme, text, note, touch = false, other = false, empty = false, single = false }) {
  await page.goto('about:blank');
  await page.setViewport({ width, height, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  const { identifier } = await page.evaluateOnNewDocument((initial, key, educationKey, education, chosen) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    localStorage.setItem(educationKey, education);
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: chosen }));
    window.open = () => null;
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Reading card fixture blocks external requests'));
    };
  }, exportBackup(fixture(note, other, { empty, single })), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, theme);
  await page.goto(`${page.__origin}/#/read/card`, { waitUntil: 'load' });
  await page.waitForFunction((name, isEmpty) => !document.querySelector('#view-read').hidden
    && (isEmpty ? !document.querySelector('#reading-empty').hidden
      : document.querySelector('#hero-title').textContent === name), {}, next, empty);
  if (text) await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, text);
  await settle(page);
  return async () => {
    await page.evaluate(() => localStorage.clear());
    await page.removeScriptToEvaluateOnNewDocument(identifier);
  };
}

// The card's own scroll, where its first line sits inside it, and the focused control against the
// fold. At 880px and below the rail is a bar fixed to the bottom of the window, which slides while
// focus moves, so the fold is where the bar rests when shown.
function measure(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('#hero');
    const card = hero.getBoundingClientRect();
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    const focused = document.activeElement;
    const inCard = hero.contains(focused);
    const control = inCard ? focused.getBoundingClientRect() : null;
    return {
      scrollTop: hero.scrollTop,
      first: Math.round((hero.querySelector('.hero-in > .art').getBoundingClientRect().top - card.top) * 10) / 10,
      focus: focused?.id || focused?.tagName || null, focusParent: focused?.parentElement?.id || null, inCard,
      control: control ? [Math.round(control.top), Math.round(control.bottom)] : null,
      fold: Math.round(barred ? innerHeight - bar.height : innerHeight),
    };
  });
}

export const readingCardFocus = {
  id: 'reading-card-focus',
  title: 'keyboard focus moves the page, never the reading card\'s own content, so its cover stays whole',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const pass of [
      { name: '390px, light', width: 390, height: 844, theme: 'light' },
      { name: '390px at 150% text, dark, More comic actions opened', width: 390, height: 844, theme: 'dark', text: '150%', open: true },
      { name: '1280px, dark, More comic actions opened', width: 1280, height: 900, theme: 'dark', open: true },
    ]) {
      const undo = await setup(page, pass);
      const rest = await measure(page);
      const options = await page.evaluate(() => {
        const row = document.querySelector('#hero-primary-actions');
        const summary = document.querySelector('#list-actions > summary');
        return {
          afterRow: !!row.nextElementSibling?.contains(summary),
          label: summary.textContent.trim(),
          comicLabel: document.querySelector('#hero-more-actions > summary').textContent.trim(),
        };
      });
      t.check(`${pass.name}: Reading List options follow Read and Done`, options.afterRow, JSON.stringify(options));
      t.check(`${pass.name}: Reading List options and More comic actions have distinct names`,
        options.label === 'Reading List options' && options.comicLabel === 'More comic actions', JSON.stringify(options));
      if (pass.width === 1280) {
        const openOptions = await page.evaluate(() => {
          const details = document.querySelector('#list-actions');
          details.open = true;
          const column = document.querySelector('#hero .hero-body').getBoundingClientRect();
          const body = details.querySelector('.list-actions-body').getBoundingClientRect();
          const result = {
            inColumn: document.querySelector('#hero .hero-body').contains(details),
            column: [column.left, column.right], body: [body.left, body.right],
            visible: details.querySelector('#btn-rename-list').checkVisibility(),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
          details.open = false;
          return result;
        });
        t.check(`${pass.name}: open Reading List options fit the hero text column`,
          openOptions.inColumn && openOptions.visible && !openOptions.overflow
            && openOptions.body[0] >= openOptions.column[0] - 1
            && openOptions.body[1] <= openOptions.column[1] + 1, JSON.stringify(openOptions));
      }
      // Tab from Read through every control the card holds, opening More comic actions on the way
      // where the pass asks, as the Issue's keyboard pass did, until focus leaves the card.
      await page.$eval('#btn-hero-read', (node) => node.focus({ preventScroll: true }));
      const steps = [];
      let opened = false;
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('Tab');
        await settle(page);
        let now = await measure(page);
        if (!now.inCard) break;
        if (pass.open && !opened && now.focus === 'SUMMARY' && now.focusParent === 'hero-more-actions') {
          await page.keyboard.press('Enter');
          opened = true;
          await settle(page);
          now = await measure(page);
        }
        steps.push(now);
      }
      const moved = steps.filter((step) => step.scrollTop !== 0 || step.first !== rest.first);
      t.check(`${pass.name}: Tab through the card's controls leaves its content where it was`,
        steps.length >= 3 && steps.some((step) => step.focusParent === 'hero-more-actions') && opened === !!pass.open && !moved.length,
        JSON.stringify({ rest, moved, path: steps.map((step) => step.focus) }));
      t.check(`${pass.name}: each control the card holds comes into view clear of the bottom bar as it takes focus`,
        steps.every((step) => step.control[0] >= 0 && step.control[1] <= step.fold),
        JSON.stringify(steps.map((step) => [step.focus, step.control, step.fold])));
      // The Issue found the offset still there after a visit to Settings.
      await page.evaluate(() => { location.hash = '#/data'; });
      await page.waitForSelector('#view-data:not([hidden])');
      await page.evaluate(() => { location.hash = '#/read/card'; });
      await page.waitForFunction(() => !document.querySelector('#view-read').hidden);
      await settle(page);
      const back = await measure(page);
      t.check(`${pass.name}: back from Settings, the card's first line is still whole`,
        back.scrollTop === 0 && back.first === rest.first, JSON.stringify({ rest, back }));
      // Nothing else can scroll it either: the card clips its decorative layer without becoming a
      // scroll container, which is what let focus move its content.
      const forced = await page.evaluate(() => {
        const hero = document.querySelector('#hero');
        hero.scrollTop = 40;
        const top = hero.scrollTop;
        hero.scrollTop = 0;
        return { top, overflow: getComputedStyle(hero).overflowY };
      });
      t.check(`${pass.name}: the card cannot be scrolled from inside`, forced.top === 0, JSON.stringify(forced));
      await undo();
    }
    let undo = await setup(page, { width: 1280, height: 900, theme: 'dark', empty: true });
    const empty = await page.evaluate(() => ({
      heroHidden: document.querySelector('#hero').hidden,
      optionsShown: document.querySelector('#list-actions > summary').checkVisibility(),
      optionsOutsideHero: !document.querySelector('#hero').contains(document.querySelector('#list-actions')),
    }));
    t.check('an empty list keeps Reading List options reachable without a hero',
      empty.heroHidden && empty.optionsShown && empty.optionsOutsideHero, JSON.stringify(empty));
    await undo();

    undo = await setup(page, { width: 1280, height: 900, theme: 'dark', single: true });
    await page.evaluate(() => { document.querySelector('#list-actions').open = true; });
    await page.focus('#btn-rename-list');
    const other = await page.browserContext().newPage();
    await other.goto(`${page.__origin}/icons/ui.svg`);
    await other.evaluate((key, issueId) => {
      const state = JSON.parse(localStorage.getItem(key));
      state.read[issueId] = Date.now();
      localStorage.setItem(key, JSON.stringify(state));
    }, KEY, order.items[3].issueId);
    await other.close();
    await page.waitForFunction(() => document.querySelector('#hero').hidden);
    const completed = await page.evaluate(() => ({
      optionsShown: document.querySelector('#list-actions > summary').checkVisibility(),
      optionsOutsideHero: !document.querySelector('#hero').contains(document.querySelector('#list-actions')),
      open: document.querySelector('#list-actions').open,
      focus: document.activeElement?.id,
    }));
    t.check('another tab finishing the list keeps its open options reachable and preserves command focus',
      completed.optionsShown && completed.optionsOutsideHero && completed.open && completed.focus === 'btn-rename-list',
      JSON.stringify(completed));
    await undo();
    t.check('the passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const readingCardPhoneOverview = {
  id: 'reading-card-phone-overview',
  title: 'phone Reading List context follows the comic and the options group is distinct',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const theme of ['dark', 'light']) {
      const clean = await setup(page, {
        width: 390, height: 844, theme, note: 'Read the Avengers issues first.',
      });
      const layout = await page.evaluate(() => {
        const selectors = [
          '#order-name', '#hero', '#order-sub', '#ring-wrap', '#hero-progress', '#order-desc', '#list-note',
        ];
        const nodes = selectors.map((selector) => document.querySelector(selector));
        const boxes = nodes.map((node) => {
          const { top, bottom } = node.getBoundingClientRect();
          return [top, bottom];
        });
        const row = document.querySelector('#hero-primary-actions');
        const options = document.querySelector('#list-actions > summary');
        const done = document.querySelector('#btn-hero-done');
        const read = document.querySelector('#btn-hero-read');
        const rowBox = row.getBoundingClientRect(), optionsBox = options.getBoundingClientRect();
        const rowStyle = getComputedStyle(row), optionStyle = getComputedStyle(options), doneStyle = getComputedStyle(done);
        const readBox = read.getBoundingClientRect(), doneBox = done.getBoundingClientRect();
        return {
          dom: nodes.every((node, at) => at === 0 || !!(nodes[at - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
          visual: boxes.every((box, at) => at === 0 || boxes[at - 1][0] <= box[0]),
          boxes,
          afterCard: boxes[2][0] >= boxes[1][1],
          optionGroup: {
            gap: optionsBox.top - rowBox.bottom,
            rowGap: readBox.right <= doneBox.left ? doneBox.left - readBox.right : parseFloat(rowStyle.columnGap),
            edges: [rowBox.left, rowBox.right, optionsBox.left, optionsBox.right],
            optionBackground: optionStyle.backgroundColor, doneBackground: doneStyle.backgroundColor,
            optionBorder: optionStyle.borderTopColor, doneBorder: doneStyle.borderTopColor,
          },
        };
      });
      t.check(`${theme}: the phone's title, comic and moved list context share DOM and visual order`,
        layout.dom && layout.visual && layout.afterCard, JSON.stringify(layout));
      const group = layout.optionGroup;
      t.check(`${theme}: Reading List options form a quieter, edge-aligned group with a larger gap`,
        group.gap > group.rowGap && Math.abs(group.edges[0] - group.edges[2]) <= 1
          && Math.abs(group.edges[1] - group.edges[3]) <= 1
          && group.optionBackground !== group.doneBackground && group.optionBorder !== group.doneBorder,
        JSON.stringify(group));

      const status = await page.evaluate(() => {
        const status = document.querySelector('#hydration-status');
        const stop = document.querySelector('#btn-cancel-hydrate');
        status.hidden = false;
        status.textContent = 'Fetching details';
        stop.hidden = false;
        const result = {
          status: status.checkVisibility(), stop: stop.checkVisibility(),
          beforeHero: stop.compareDocumentPosition(document.querySelector('#hero')) & Node.DOCUMENT_POSITION_FOLLOWING,
        };
        status.hidden = true;
        stop.hidden = true;
        return result;
      });
      t.check(`${theme}: pending work and Stop stay visible before the comic`,
        status.status && status.stop && !!status.beforeHero, JSON.stringify(status));

      await page.$eval('#order-desc > summary', (summary) => {
        summary.parentElement.open = true;
        summary.focus({ preventScroll: true });
      });
      const saved = await page.evaluate((key) => localStorage.getItem(key), KEY);
      for (const [width, height, phone] of [[1024, 900, false], [390, 844, true]]) {
        await page.setViewport({ width, height });
        await settle(page);
        const restored = await page.evaluate((key) => {
          const hero = document.querySelector('#hero');
          const sub = document.querySelector('#order-sub');
          const note = document.querySelector('#list-note');
          const glance = document.querySelector('#hero-progress');
          const details = document.querySelector('#order-desc');
          return {
            after: !!(hero.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING),
            noteAfter: !!(hero.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING),
            glanceInHero: hero.contains(glance), open: details.open,
            focused: document.activeElement === details.querySelector('summary'),
            saved: localStorage.getItem(key),
          };
        }, KEY);
        t.check(`${theme}: ${phone ? 'phone' : 'wide'} resize restores order without losing focus, expansion or saved data`,
          restored.after === phone && restored.noteAfter === phone && restored.glanceInHero !== phone
            && restored.open && restored.focused && restored.saved === saved, JSON.stringify(restored));
      }
      await page.evaluate(() => {
        document.querySelector('#list-actions').open = true;
        document.querySelector('#btn-rename-list').focus({ preventScroll: true });
      });
      for (const [width, height] of [[1024, 900], [390, 844]]) {
        await page.setViewport({ width, height });
        await settle(page);
        t.check(`${theme}: ${width}px resize keeps the open Reading List options and their focused action`,
          await page.evaluate(() => document.activeElement === document.querySelector('#btn-rename-list')
            && document.querySelector('#list-actions').open), 'focus or expansion lost');
      }
      await clean();
    }
    t.check('the phone overview passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

// #1061, the owner's request on 2026-11-01: the cover is centered and takes more of the screen, Read
// and Done stay visible without scrolling, and the Marvel Unlimited record moves to Issue details. Before
// it, a phone showed the cover floated left at 96px. The owner's 2026-11-02 choices then put Read and
// Done side by side on phones and made the list's heading compact on short screens, so at default text
// both open above the bottom bar on every phone here, 375x667 and 360x800 included, where before #1061
// Done opened 171px and 38px under it. Placing Reading List options after the buttons also clears them
// at 375x667 with a list note and the cover at its 96px floor. The covers are held to no smaller than
// this branch measured before those choices. Read and Done are then checked with the card scrolled to
// its top, as the owner's screenshot shows it.
const posterCoverBefore = {
  '360x800': [96, 96], '375x667': [96, 96], '390x844': [109, 96], '393x851': [114, 96],
  '412x915': [157, 119], '414x896': [144, 107], '430x932': [168, 131],
};
export const readingCardPoster = {
  id: 'reading-card-poster',
  title: 'the reading card centers a larger cover with Read and Done above the fold, and leaves the record to Issue details',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [width, height] of [[360, 800], [375, 667], [390, 844], [393, 851], [412, 915], [414, 896], [430, 932], [820, 1180], [1024, 1366], [1280, 900]]) {
      for (const { text, note } of [{}, { text: '200%' }, ...(width <= 700 ? [{ note: 'Read the Avengers issues first.' }] : [])]) {
        const name = `${width}x${height}${text ? ` at ${text} text` : ''}${note ? ' with a list note' : ''}`;
        const undo = await setup(page, { width, height, theme: 'dark', text, note });
        if (!text) {
          const opened = await page.evaluate(() => {
            const rail = document.querySelector('.rail-header');
            const bar = rail.getBoundingClientRect();
            const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
            const note = document.querySelector('#list-note');
            const read = document.querySelector('#btn-hero-read').getBoundingClientRect();
            const done = document.querySelector('#btn-hero-done').getBoundingClientRect();
            const clipped = ['#view-read > .head h1', '#order-sub', '#btn-hero-read', '#btn-hero-done']
              .filter((selector) => { const node = document.querySelector(selector);
                return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1; });
            return { scrollY: Math.round(scrollY), fold: Math.round(barred ? innerHeight - bar.height : innerHeight),
              read: Math.round(read.bottom), done: Math.round(done.bottom), rows: [Math.round(read.top), Math.round(done.top)],
              art: Math.round(document.querySelector('#hero .hero-in > .art').getBoundingClientRect().width),
              note: note.hidden ? 0 : Math.round(note.getBoundingClientRect().height), clipped };
          });
          t.check(`${name}: Read and Done are above the fold when the screen opens`,
            opened.scrollY === 0 && !!opened.note === !!note && opened.clipped.length === 0
              && opened.read <= opened.fold && opened.done <= opened.fold
              && opened.art >= 96,
            JSON.stringify(opened));
          if (width <= 700) {
            t.check(`${name}: Read and Done open side by side in one row`,
              opened.rows[0] === opened.rows[1], JSON.stringify(opened));
          }
        }
        if (width === 375 && height === 667 && !text) {
          const gap = await page.evaluate(() => {
            const art = document.querySelector('#hero .hero-in > .art').getBoundingClientRect();
            return { art: Math.round(art.width), rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
              gap: Math.round(document.querySelector('#hero-title').getBoundingClientRect().top - art.bottom) };
          });
          t.check(`${name}: the cover keeps at least 96px and its half-rem gap`,
            gap.art >= 96 && gap.gap <= gap.rem / 2 + 1, JSON.stringify(gap));
        }
        await page.evaluate(() => {
          const hero = document.querySelector('#hero');
          window.scrollTo(0, hero.getBoundingClientRect().top + scrollY - 8);
        });
        await settle(page);
        const seen = await page.evaluate(() => {
          const box = (selector) => document.querySelector(selector).getBoundingClientRect();
          const rail = document.querySelector('.rail-header');
          const bar = rail.getBoundingClientRect();
          const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
          const art = box('#hero .hero-in > .art'), inner = box('#hero .hero-in');
          const style = getComputedStyle(document.querySelector('#hero .hero-in'));
          const left = inner.left + parseFloat(style.paddingLeft), right = inner.right - parseFloat(style.paddingRight);
          return {
            fold: Math.round(barred ? innerHeight - bar.height : innerHeight),
            read: Math.round(box('#btn-hero-read').bottom), done: Math.round(box('#btn-hero-done').bottom),
            art: Math.round(art.width), offset: Math.round((art.left + art.right) / 2 - (left + right) / 2),
            overflow: document.documentElement.scrollWidth > innerWidth,
            facts: document.querySelector('#hero-facts').textContent,
            alignment: ['#hero-title', '#hero-by', '#hero-facts']
              .map((selector) => getComputedStyle(document.querySelector(selector)).textAlign),
          };
        });
        t.check(`${name}: Read and Done sit above the fold with the card at its top`,
          seen.read <= seen.fold && seen.done <= seen.fold && !seen.overflow, JSON.stringify(seen));
        t.check(`${name}: the comic title, series and facts stay start-aligned`,
          seen.alignment.every((alignment) => ['start', 'left'].includes(alignment)), JSON.stringify(seen.alignment));
        if (width <= 700) {
          t.check(`${name}: the cover is centered`, Math.abs(seen.offset) <= 2, JSON.stringify(seen));
          if (!text) {
            const before = posterCoverBefore[`${width}x${height}`][note ? 1 : 0];
            t.check(`${name}: the cover is no smaller than the ${before}px it was`,
              seen.art >= before, JSON.stringify(seen));
          }
        }
        t.check(`${name}: the card leaves the Unlimited record to Issue details and shows no position`,
          !/Unlimited|Position/.test(seen.facts), seen.facts);
        await undo();
      }
    }
    await setup(page, { width: 390, height: 844, theme: 'dark' });
    await page.$eval('#btn-hero-inspect', (node) => node.click());
    await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
    const details = await page.$eval('#issue-focus-facts', (node) => node.textContent);
    const context = await page.$eval('#issue-focus-context', (node) => node.textContent);
    t.check('Issue details shows the Unlimited record and, by the owner\'s 2026-11-02 choice, no position',
      /Marvel Unlimited record/.test(details) && !/Position|\d+ of \d+/.test(details) && !/\d+ of \d+/.test(context),
      JSON.stringify({ details, context }));
    await page.evaluate(() => localStorage.clear());
    t.check('the passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

const phoneSizes = [[360, 800], [375, 667], [390, 844], [393, 851], [412, 915], [414, 896], [430, 932]];

async function readyDone(page, clearance = 8) {
  await page.evaluate((gap) => {
    const done = document.querySelector('#btn-hero-done').getBoundingClientRect();
    const bar = document.querySelector('.rail-header').getBoundingClientRect();
    const shift = done.bottom - (innerHeight - bar.height - gap);
    if (shift > 0) window.scrollBy({ top: shift, behavior: 'instant' });
  }, clearance);
  await settle(page);
  await page.evaluate(() => {
    document.querySelector('.rail-header .brand').focus({ preventScroll: true });
    document.querySelector('#btn-hero-done').focus({ preventScroll: true });
  });
  await page.waitForFunction(() => {
    const rail = document.querySelector('.rail-header');
    return !rail.classList.contains('mobile-nav-hidden')
      && !rail.getAnimations().some((animation) => animation.playState === 'running');
  }, { timeout: 5000 });
  return page.$eval('#btn-hero-done', (button) => {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reached: hit === button || button.contains(hit), focus: document.activeElement?.id, scrollY };
  });
}

async function watchOffer(page, intervention = '') {
  await page.evaluate((action) => {
    const after = Element.prototype.after;
    const scroll = Element.prototype.scrollIntoView;
    window.__cardOffer = { calls: [], inserted: null, intervention: null };
    Element.prototype.scrollIntoView = function (options) {
      const notice = document.querySelector('#done-result');
      if (notice && (this === notice || notice.contains(this))) {
        window.__cardOffer.calls.push({ options, scrollY, focus: document.activeElement?.id });
      }
      return scroll.call(this, options);
    };
    Element.prototype.after = function (...nodes) {
      const value = after.apply(this, nodes);
      const notice = nodes.find((node) => node.id === 'done-result');
      if (!notice) return value;
      Element.prototype.after = after;
      const box = notice.getBoundingClientRect();
      const rail = document.querySelector('.rail-header').getBoundingClientRect();
      const covered = box.left < rail.right && box.right > rail.left && box.top < rail.bottom && box.bottom > rail.top;
      window.__cardOffer.inserted = {
        covered, bottom: box.bottom, barTop: rail.top, scrollY,
        padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0,
      };
      if (action === 'scroll') {
        window.scrollBy({ top: 12, behavior: 'instant' });
        window.__cardOffer.intervention = { scrollY };
      } else if (action === 'list' || action === 'view') {
        location.hash = action === 'list' ? '#/read/other' : '#/home';
        window.dispatchEvent(new Event('hashchange'));
        window.__cardOffer.intervention = {
          scrollY, active: JSON.parse(localStorage.getItem('mrt.state.v2')).active,
          home: !document.querySelector('#view-home').hidden,
        };
        queueMicrotask(() => {
          window.__cardOffer.stale = !!document.querySelector('#done-result button');
        });
      }
      return value;
    };
  }, intervention);
}

function offerState(page) {
  return page.evaluate(() => {
    const notice = document.querySelector('#done-result');
    const button = notice?.querySelector('button');
    const rect = notice?.getBoundingClientRect();
    const target = button?.getBoundingClientRect();
    const rail = document.querySelector('.rail-header').getBoundingClientRect();
    const x = target && target.left + target.width / 2, y = target && target.top + target.height / 2;
    const hit = target ? document.elementFromPoint(x, y) : null;
    return {
      ...window.__cardOffer, scrollY, focus: document.activeElement?.id,
      fold: innerHeight - rail.height, bottom: rect?.bottom, x, y,
      reached: !!button && (hit === button || button.contains(hit)),
      title: document.querySelector('#hero-title').textContent,
      read: JSON.parse(localStorage.getItem('mrt.state.v2')).read,
    };
  });
}

async function checkPhoneUndo(page, t, { width, height, note = '', reduced = false, clearance = 8, opensClear = false }) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  const clean = await setup(page, { width, height, theme: 'dark', note, touch: true });
  const name = `${width}x${height}${note ? ' with a list note' : ''}${reduced ? ' with reduced motion' : ''}`;
  const before = await readyDone(page, clearance);
  const read = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('mrt.state.v2')).read));
  await watchOffer(page);
  if (before.reached) await page.touchscreen.tap(before.x, before.y);
  await settle(page);
  const offered = await offerState(page);
  const covered = clearance === 8 && !opensClear;
  const expectedScroll = offered.inserted
    ? Math.max(0, offered.inserted.bottom - (height - offered.inserted.padding)) : 0;
  const minimal = offered.calls.length === 1 && offered.calls[0].options?.block === 'nearest'
    && offered.calls[0].options?.behavior === 'instant'
    && Math.abs(offered.scrollY - offered.inserted.scrollY - expectedScroll) <= 2;
  const still = offered.calls.length === 0 && Math.abs(offered.scrollY - before.scrollY) <= 1;
  t.check(`${name}: ${covered ? 'the covered offer moves only to the nearest clear position' : 'an uncovered offer does not scroll'}`,
    before.reached && before.focus === 'btn-hero-done' && offered.inserted?.covered === covered
      && (covered ? minimal : still) && offered.bottom <= offered.fold + 1
      && offered.focus === before.focus && offered.reached, JSON.stringify({ before, offered, expectedScroll }));

  if (offered.reached) await page.touchscreen.tap(offered.x, offered.y);
  await settle(page);
  const after = await page.evaluate(() => ({
    title: document.querySelector('#hero-title').textContent,
    focus: document.activeElement?.id,
    read: JSON.stringify(JSON.parse(localStorage.getItem('mrt.state.v2')).read),
    message: document.querySelector('#done-result .grow')?.textContent,
  }));
  t.check(`${name}: tapping Undo restores the comic and the saved read marks`,
    offered.reached && after.title === next && after.read === read && after.focus === 'btn-hero-done'
      && after.message === `Marked ${next} unread. It is up next again.`, JSON.stringify(after));
  await clean();
}

export const readingCardUndo = {
  id: 'reading-card-undo',
  title: 'Done keeps a covered Undo reachable at phone sizes and with reduced motion',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [width, height] of phoneSizes) {
      for (const note of ['', 'Read the Avengers issues first.']) {
        // After moving the context below the card, the two shortest profiles still cover the offer.
        await checkPhoneUndo(page, t, { width, height, note, opensClear: height > 800 });
      }
    }
    await checkPhoneUndo(page, t, { width: 360, height: 800, reduced: true });
    await page.emulateMediaFeatures([]);
    t.check('the Undo visibility passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const readingCardUndoStill = {
  id: 'reading-card-undo-still',
  title: 'Done never scrolls an uncovered result or pulls the reader back after their context changes',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await checkPhoneUndo(page, t, { width: 390, height: 844, clearance: 180 });

    const hidden = await setup(page, { width: 360, height: 800, theme: 'dark', touch: true });
    const visible = await readyDone(page);
    await page.$eval('.rail-header', (rail) => { rail.style.visibility = 'hidden'; });
    await watchOffer(page);
    await page.$eval('#btn-hero-done', (button) => button.click());
    const unobstructed = await offerState(page);
    t.check('an invisible bar does not trigger a reveal even when its rectangle overlaps the offer',
      visible.reached && unobstructed.inserted?.covered && unobstructed.calls.length === 0
        && unobstructed.scrollY === visible.scrollY && unobstructed.focus === visible.focus,
      JSON.stringify({ visible, unobstructed }));
    await hidden();

    for (const intervention of ['scroll', 'list', 'view']) {
      const clean = await setup(page, { width: 360, height: 800, theme: 'dark', touch: true, other: intervention === 'list' });
      const before = await readyDone(page);
      await watchOffer(page, intervention);
      await page.$eval('#btn-hero-done', (button) => button.click());
      const after = await offerState(page);
      const change = { scroll: 'reader scroll', list: 'different Reading List', view: 'different view' }[intervention];
      t.check(`a ${change} before reveal prevents automatic scrolling`,
        before.reached && after.inserted?.covered && !!after.intervention && after.calls.length === 0
          && after.scrollY === after.intervention.scrollY
          && (intervention !== 'list' || (after.intervention.active === 'other' && !after.stale))
          && (intervention !== 'view' || (after.intervention.home && !after.stale)),
        JSON.stringify({ before, after }));
      await clean();
    }
    const clean = await setup(page, { width: 390, height: 844, theme: 'dark', touch: true });
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      document.querySelector('.rail-header .brand').focus({ preventScroll: true });
    });
    await settle(page);
    const away = await page.evaluate(() => ({
      scrollY, doneBottom: document.querySelector('#btn-hero-done').getBoundingClientRect().bottom,
      read: Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length,
      focus: document.activeElement === document.querySelector('.rail-header .brand'),
    }));
    await watchOffer(page);
    await page.keyboard.press('d');
    const after = await offerState(page);
    t.check('the D shortcut does not pull the reader back when Done is offscreen',
      away.doneBottom < 0 && away.focus && after.inserted && after.calls.length === 0 && after.scrollY >= away.scrollY
        && Object.keys(after.read).length === away.read + 1
        && await page.evaluate(() => document.activeElement === document.querySelector('.rail-header .brand')),
      JSON.stringify({ away, after }));
    await clean();
    await page.emulateMediaFeatures([]);
    t.check('the no-scroll passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const readingCardMutations = [
  {
    id: 'reading-card-scroll-container', breaks: 'reading-card-focus',
    why: 'the reading card is a scroll container again, so focus near its foot scrolls its own content and cuts off its first line',
    // The app's content security policy refuses an injected style element, so the rule goes into the
    // stylesheet the page loaded. Each pass starts from about:blank, which has none.
    script: () => window.addEventListener('load', () => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/styles.css'));
      sheet?.insertRule('.hero { overflow: hidden !important; }', sheet.cssRules.length);
    }),
  },
  {
    id: 'reading-card-small-cover', breaks: 'reading-card-poster',
    why: 'the phone cover is floated left at 96px again, as it was before #1061',
    script: () => window.addEventListener('load', () => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/styles.css'));
      sheet?.insertRule('@media (max-width: 700px) { #hero .hero-in > .art { float: left !important; width: 96px !important; margin: 0 20px 16px 0 !important; } }', sheet.cssRules.length);
    }),
  },
  {
    id: 'reading-card-undo-no-reveal', breaks: 'reading-card-undo',
    why: 'a covered Undo offer remains under the bottom bar',
    rewriteReading: (source) => source.replace(
      '    revealCoveredDone(result, scrollContext);',
      '',
    ),
  },
  {
    id: 'reading-card-undo-reduced-motion', breaks: 'reading-card-undo',
    why: 'the reveal animates when reduced motion is requested',
    rewriteReading: (source) => source.replace(
      "result.node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });",
      "result.node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });",
    ),
  },
  {
    id: 'reading-card-undo-always-scroll', breaks: 'reading-card-undo-still',
    why: 'every Done result scrolls even when it is already visible or the reader has moved away',
    rewriteReading: (source) => source.replace(
      '    Object.assign(result, { node, button, holds: new Set() });',
      '    node.scrollIntoView({ block: "center", behavior: "instant" });\n    Object.assign(result, { node, button, holds: new Set() });',
    ),
  },
  {
    id: 'reading-card-undo-stale-offer', breaks: 'reading-card-undo-still',
    why: 'a list or view change during insertion leaves a stale Undo offer',
    rewriteReading: (source) => source.replace(
      '    if (surfaceWasCurrent && !doneResultHolds(result)) {',
      '    if (false) {',
    ),
  },
];
