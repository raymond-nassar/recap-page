// #876: progress at a glance in a real browser. Home's Continue reading card and the reading screen's
// hero show the read count in larger numerals over a slim bar in the brand accent. The bar matches the
// text exactly at none, some and all of a list and follows Done, Undo and an unmark; its outline and
// fill clear 3:1 and the figure 4.5:1 against what is painted behind them, a worst-case cover included;
// each screen reads its progress out once; and a change of progress moves nothing but the fill, which
// is still with reduced motion. Runs on the ephemeral port like every scenario not listed for the app
// origin.
import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { ratio } from './check-palette.mjs';
import { decodePng } from './lib/painted-contrast.mjs';

const KEY = 'mrt.state.v2';
const TOTAL = 12;
const ids = Array.from({ length: TOTAL }, (_, index) => 876101 + index);
const title = (n) => `Glance fixture (2026) #${n}`;
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const still = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
const sameBox = (a, b) => ['left', 'top', 'width', 'height'].every((side) => near(a[side], b[side]));
const SCOPES = {
  home: { count: '#chero-count', bar: '#chero-bar', fill: '#chero-fill' },
  hero: { count: '#hero-progress-count', bar: '#hero-progress .glance-bar', fill: '#hero-progress-fill' },
};
const words = (scope, read) => (scope === 'home' ? `${read} of ${TOTAL} issues read` : `${read} of ${TOTAL} read`);

function fixture(read) {
  let state = createList(createEmptyState(), { id: 'glance', name: 'Glance fixture' });
  state = addIssuesToList(state, 'glance', ids.map((issueId, index) => ({
    issueId, title: title(index + 1), number: String(index + 1), seriesName: 'Glance fixture (2026)', seriesId: 876,
    digitalId: 876201 + index, url: `https://www.marvel.com/comics/issue/${issueId}/fixture`, source: 'manual',
    cover: { path: `https://i.annihil.us/u/prod/marvel/i/mg/8/76/glance${index + 1}`, ext: 'jpg' },
  }))).state;
  for (const issueId of ids.slice(0, read)) state = markRead(state, issueId, true, 1000);
  return state;
}

// Starts from blank each time, so one page can take every pass, and returns what undoes the pass. A
// cover, when asked for, is one flat colour, the brightest or darkest backdrop the hero can bleed in.
async function setup(page, { read = 3, width = 1280, theme = 'dark', route = 'read', covers = false, coverFill = null, reduce = false, forced = false } = {}) {
  await page.goto('about:blank');
  await page.setViewport({ width, height: 900 });
  page.__cdp ??= await page.createCDPSession();
  await page.__cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
    { name: 'forced-colors', value: forced ? 'active' : 'none' },
  ] });
  page.__cover = coverFill ? {
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${coverFill}"/></svg>`,
  } : undefined;
  const { identifier } = await page.evaluateOnNewDocument((initial, key, educationKey, education, settings) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    localStorage.setItem(educationKey, education);
    localStorage.setItem('mrt.settings', JSON.stringify(settings));
    window.open = () => null;
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Glance fixture blocks external requests'));
    };
  }, exportBackup(fixture(read)), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, { covers, filter: 'all', theme });
  await page.goto(`${page.__origin}/#/${route === 'home' ? 'home' : 'read/glance'}`, { waitUntil: 'load' });
  await page.waitForSelector(route === 'home' ? '#home-continue:not([hidden]) #chero-count .glance-n' : '#view-read:not([hidden]) #ring-sub');
  await page.evaluate(() => document.fonts.ready);
  await still(page);
  return async () => {
    page.__cover = undefined;
    await page.evaluate(() => localStorage.clear());
    await page.removeScriptToEvaluateOnNewDocument(identifier);
  };
}

async function showHome(page) {
  await click(page, '.brand[data-view="home"]');
  await page.waitForSelector('#home-continue:not([hidden]) #chero-count .glance-n');
  await still(page);
}

// What one surface shows: its count, its figure against its words, what share of the bar the fill
// covers, the paints, and whether the row is kept from assistive technology. The fill slides in from
// the left, so what shows of it ends where its own box ends.
function glance(page, scope) {
  return page.evaluate((selectors) => {
    const count = document.querySelector(selectors.count);
    if (!count?.checkVisibility()) return { shown: false };
    const bar = document.querySelector(selectors.bar);
    const fill = document.querySelector(selectors.fill);
    const figure = count.querySelector('.glance-n');
    const box = (node) => {
      const { left, top, width, height, right, bottom } = node.getBoundingClientRect();
      return { left, top, width, height, right, bottom };
    };
    const range = document.createRange();
    range.selectNodeContents(count);
    // Everything after the figure is set in one size, so its rectangles on a line share one bottom.
    const wordsRange = document.createRange();
    if (figure) wordsRange.setStartAfter(figure);
    else wordsRange.setStart(count, 0);
    wordsRange.setEnd(count, count.childNodes.length);
    const style = (node, pseudo) => getComputedStyle(node, pseudo);
    const barBox = box(bar);
    return {
      shown: true, text: count.textContent, figure: figure?.textContent ?? null,
      sizes: [parseFloat(style(figure ?? count).fontSize), parseFloat(style(count).fontSize)],
      share: Math.max(0, Math.min(box(fill).right, barBox.right) - barBox.left) / barBox.width,
      count: box(count), bar: barBox, lines: new Set([...wordsRange.getClientRects()].map((rect) => Math.round(rect.bottom))).size,
      // The text and the room held after its last word, which the last word's own box takes in.
      line: range.getBoundingClientRect().width,
      figureColour: style(figure ?? count).color, fillColour: style(fill).backgroundColor,
      outline: style(bar).boxShadow, border: [style(bar).borderTopWidth, style(bar).borderTopColor],
      transition: [style(fill).transitionProperty, style(fill).transitionDuration],
      hidden: !!count.closest('[aria-hidden="true"]'), barHidden: !!bar.closest('[aria-hidden="true"]'),
    };
  }, SCOPES[scope]);
}

const rgb = (value) => (value?.match(/rgba?\((\d+), (\d+), (\d+)/) ?? []).slice(1, 4).map(Number);

// The figure against the painted surface just left of it, and the fill and outline against the surface
// painted in the gap between the count and its bar, sampled from a capture that stays on screen.
async function contrast(page, scope) {
  const spots = await page.evaluate((selectors) => {
    const count = document.querySelector(selectors.count);
    count.scrollIntoView({ block: 'center' });
    const figure = count.querySelector('.glance-n').getBoundingClientRect();
    const bar = document.querySelector(selectors.bar).getBoundingClientRect();
    return {
      figure: { x: Math.round(figure.left) - 3, y: Math.round(figure.top + figure.height / 2) },
      gap: { x: Math.round(bar.left) + 24, y: Math.round(bar.top) - 2 },
      scrollX, scrollY,
    };
  }, SCOPES[scope]);
  const left = Math.min(spots.figure.x, spots.gap.x);
  const top = Math.min(spots.figure.y, spots.gap.y);
  const shot = decodePng(await page.screenshot({
    clip: { x: left + spots.scrollX, y: top + spots.scrollY, width: Math.max(spots.figure.x, spots.gap.x) - left + 1, height: Math.max(spots.figure.y, spots.gap.y) - top + 1 },
    captureBeyondViewport: false,
  }));
  const state = await glance(page, scope);
  const behindFigure = shot.pixel(spots.figure.x - left, spots.figure.y - top);
  const behindBar = shot.pixel(spots.gap.x - left, spots.gap.y - top);
  return {
    figure: ratio(rgb(state.figureColour), behindFigure),
    fill: ratio(rgb(state.fillColour), behindBar),
    outline: rgb(state.outline).length ? ratio(rgb(state.outline), behindBar) : 0,
    behindFigure, behindBar,
  };
}

// The accessibility tree under `root`: its text in document order, joined as a screen reader reads a
// line made of several inline pieces, and the roles and names of every node in it.
async function tree(page, root) {
  const snapshot = await page.accessibility.snapshot({ root: await page.$(root), interestingOnly: false });
  const text = [];
  const roles = [];
  const names = [];
  const visit = (node) => {
    if (!node) return;
    roles.push(node.role);
    names.push(node.name);
    if (node.role === 'StaticText') text.push(node.name);
    for (const child of node.children ?? []) visit(child);
  };
  visit(snapshot);
  return { said: text.join(' ').replace(/\s+/g, ' '), roles, names };
}
const times = (text, phrase) => text.split(phrase).length - 1;

function checkValues(t, label, scope, state, read) {
  t.check(`${label} ${scope}: the count reads ${words(scope, read)}, its figure set larger than its words`,
    state.shown && state.text === words(scope, read) && state.figure === String(read) && state.sizes[0] >= state.sizes[1] * 1.25,
    JSON.stringify(state));
  t.check(`${label} ${scope}: the bar is filled to exactly ${read} of ${TOTAL}`,
    state.shown && near(state.share * state.bar.width, (read / TOTAL) * state.bar.width), JSON.stringify(state));
}

export const progressGlance = {
  id: 'progress-glance',
  title: 'reading progress shows at a glance on Home and the reading screen, read out once and moving only the bar',
  async run(page, t) {
    try {
      // Some of a list, in both themes and at both widths: what each surface shows, how it measures
      // against what is painted behind it, and what assistive technology is given.
      for (const theme of ['dark', 'light']) {
        for (const width of [1280, 390]) {
          const label = `${theme} ${width}px`;
          const done = await setup(page, { read: 3, width, theme, route: 'home' });
          const home = await glance(page, 'home');
          checkValues(t, label, 'home', home, 3);
          const homeContrast = await contrast(page, 'home');
          t.check(`${label} home: the figure clears 4.5:1, and the fill and the outline that shows the bar's extent clear 3:1, against the card`,
            homeContrast.figure >= 4.5 && homeContrast.fill >= 3 && homeContrast.outline >= 3, JSON.stringify(homeContrast));
          const homeTree = await tree(page, '#home-continue');
          t.check(`${label} home: the count is read once, and the bar is no progress bar of its own`,
            !home.hidden && home.barHidden && times(homeTree.said, words('home', 3)) === 1
            && !homeTree.roles.includes('progressbar') && !homeTree.names.includes('Reading progress'), JSON.stringify({ home, homeTree }));
          await page.evaluate(() => { location.hash = '#/read/glance'; });
          await page.waitForSelector('#hero:not([hidden]) #hero-progress-count .glance-n');
          await still(page);
          const hero = await glance(page, 'hero');
          checkValues(t, label, 'hero', hero, 3);
          const heroContrast = await contrast(page, 'hero');
          t.check(`${label} hero: the figure clears 4.5:1, and the fill and outline 3:1, against the painted hero`,
            heroContrast.figure >= 4.5 && heroContrast.fill >= 3 && heroContrast.outline >= 3, JSON.stringify(heroContrast));
          const readTree = await tree(page, '#view-read');
          t.check(`${label} reading screen: progress is read once, from the header, and the hero's row is kept from assistive technology`,
            hero.hidden && times(readTree.said, words('hero', 3)) === 1 && !readTree.roles.includes('progressbar'),
            JSON.stringify({ said: readTree.said, roles: [...new Set(readTree.roles)] }));
          const order = await page.evaluate(() => {
            const at = (selector) => document.querySelector(selector).getBoundingClientRect();
            return { done: at('#btn-hero-done').bottom, row: at('#hero-progress').top, facts: at('#hero-facts').top };
          });
          t.check(`${label} hero: the row sits under Read and Done and over the comic's facts`,
            order.row >= order.done && order.facts >= order.row, JSON.stringify(order));
          await done();
        }
      }

      // None and all of a list. An empty bar still shows its extent; a finished list fills Home's bar
      // and the reading screen says All read in its header, the hero having nothing left to show.
      for (const theme of ['dark', 'light']) {
        let done = await setup(page, { read: 0, theme, route: 'home' });
        checkValues(t, `${theme} none read`, 'home', await glance(page, 'home'), 0);
        const empty = await contrast(page, 'home');
        t.check(`${theme} none read: the empty bar's outline still clears 3:1 against the card`, empty.outline >= 3, JSON.stringify(empty));
        await page.evaluate(() => { location.hash = '#/read/glance'; });
        await page.waitForSelector('#hero:not([hidden]) #hero-progress-count .glance-n');
        await still(page);
        checkValues(t, `${theme} none read`, 'hero', await glance(page, 'hero'), 0);
        await done();
        done = await setup(page, { read: TOTAL, theme, route: 'home' });
        const all = await glance(page, 'home');
        checkValues(t, `${theme} all read`, 'home', all, TOTAL);
        const finished = await page.evaluate(() => ({
          read: document.querySelector('#btn-chero-read').hidden, next: document.querySelector('#chero-next').textContent,
        }));
        t.check(`${theme} all read: Home's bar is full beside the finished list's own words`,
          near(all.share * all.bar.width, all.bar.width) && finished.read && finished.next === 'You have read every issue in this order.',
          JSON.stringify({ all, finished }));
        await page.evaluate(() => { location.hash = '#/read/glance'; });
        await page.waitForFunction(() => document.querySelector('#ring-sub').textContent === 'All read');
        t.check(`${theme} all read: the reading screen says All read in its header, with no hero to carry the row`,
          !(await glance(page, 'hero')).shown, await page.$eval('#ring-sub', (node) => node.textContent));
        await done();
      }

      // Done, Undo and an unmark, on both surfaces. Done's own result is placed after the commands it
      // answers (#856), so on the reading screen the row moves down with the facts while the result
      // shows; the row itself keeps its size.
      for (const width of [1280, 390]) {
        const label = `dark ${width}px`;
        let done = await setup(page, { read: 3, width, route: 'home' });
        const before = await glance(page, 'home');
        const commands = () => page.evaluate(() => ['#btn-chero-read', '#btn-chero-done'].map((selector) => {
          const { left, top, width: w, height } = document.querySelector(selector).getBoundingClientRect();
          return { left, top, width: w, height };
        }));
        const homeCommands = await commands();
        await click(page, '#btn-chero-done');
        await page.waitForFunction((text) => document.querySelector('#chero-count').textContent === text, {}, words('home', 4));
        await still(page);
        const marked = await glance(page, 'home');
        checkValues(t, `${label} after Done`, 'home', marked, 4);
        const moved = await commands();
        t.check(`${label} home: after Done the count, the bar, Read and Done stay exactly where they were`,
          sameBox(marked.count, before.count) && sameBox(marked.bar, before.bar) && sameBox(moved[0], homeCommands[0]) && sameBox(moved[1], homeCommands[1]),
          JSON.stringify({ before: [before.count, before.bar, homeCommands], after: [marked.count, marked.bar, moved] }));
        await click(page, '#done-result button');
        await page.waitForFunction((text) => document.querySelector('#chero-count').textContent === text, {}, words('home', 3));
        await still(page);
        checkValues(t, `${label} after Undo`, 'home', await glance(page, 'home'), 3);
        await done();

        done = await setup(page, { read: 3, width });
        const heroBefore = await glance(page, 'hero');
        await click(page, '#btn-hero-done');
        await page.waitForFunction((text) => document.querySelector('#hero-progress-count').textContent === text, {}, words('hero', 4));
        await still(page);
        const heroMarked = await glance(page, 'hero');
        checkValues(t, `${label} after Done`, 'hero', heroMarked, 4);
        t.check(`${label} hero: after Done the header and the row agree, and the row keeps its size`,
          await page.$eval('#ring-sub', (node) => node.textContent) === `4 of ${TOTAL} read`
          && near(heroMarked.count.width, heroBefore.count.width) && near(heroMarked.count.height, heroBefore.count.height)
          && near(heroMarked.bar.width, heroBefore.bar.width) && near(heroMarked.bar.height, heroBefore.bar.height),
          JSON.stringify({ before: heroBefore, after: heroMarked }));
        await click(page, '#done-result button');
        await page.waitForFunction((text) => document.querySelector('#hero-progress-count').textContent === text, {}, words('hero', 3));
        await still(page);
        checkValues(t, `${label} after Undo`, 'hero', await glance(page, 'hero'), 3);
        if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
        await page.waitForSelector('#rows .row');
        await click(page, `#rows [data-key="${ids[1]}"][data-act="read"]`);
        await page.waitForFunction((text) => document.querySelector('#hero-progress-count').textContent === text, {}, words('hero', 2));
        await still(page);
        checkValues(t, `${label} after an unmark`, 'hero', await glance(page, 'hero'), 2);
        await showHome(page);
        checkValues(t, `${label} after an unmark`, 'home', await glance(page, 'home'), 2);
        await done();

        // A change of progress alone: a later comic marked from the full list, so the next comic and
        // Done's result stay out of it, taking the count from 9 to 10. The figure gains a digit, the line
        // keeps its width, and the only thing that animates is the fill, besides the header's own ring.
        done = await setup(page, { read: 9, width });
        if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
        await page.waitForSelector('#rows .row');
        await still(page);
        const nine = await glance(page, 'hero');
        const around = () => page.evaluate(() => ['#hero-primary-actions', '#hero-facts'].map((selector) => document.querySelector(selector).getBoundingClientRect().top));
        const aroundNine = await around();
        const started = await page.$eval(`#rows [data-key="${ids[11]}"][data-act="read"]`, (element) => {
          const earlier = new Set(document.getAnimations());
          element.click();
          return document.getAnimations().filter((animation) => !earlier.has(animation)).map((animation) => ({
            kind: animation.constructor.name, property: animation.transitionProperty ?? null,
            target: animation.effect?.target?.id ?? null, duration: animation.effect?.getTiming().duration,
          }));
        });
        await still(page);
        const ten = await glance(page, 'hero');
        const aroundTen = await around();
        checkValues(t, `${label} 9 to 10`, 'hero', ten, 10);
        t.check(`${label} 9 to 10: the line keeps its width and wrap, and the row, the commands and the facts stay where they were`,
          sameBox(ten.count, nine.count) && sameBox(ten.bar, nine.bar) && near(ten.line, nine.line, 1) && ten.lines === nine.lines
          && near(aroundTen[0], aroundNine[0]) && near(aroundTen[1], aroundNine[1]),
          JSON.stringify({ nine, ten, aroundNine, aroundTen }));
        t.check(`${label} 9 to 10: only the fill moves, sliding for a third of a second, beside the header's ring`,
          started.some((entry) => entry.target === 'hero-progress-fill' && entry.property === 'transform' && entry.duration === 350)
          && started.every((entry) => entry.kind === 'CSSTransition'
            && ((entry.target === 'hero-progress-fill' && entry.property === 'transform') || (entry.target === 'ring-arc' && entry.property === 'stroke-dashoffset'))),
          JSON.stringify(started));
        await done();
      }

      // Reduced motion: the same change starts nothing at all, and the bar still lands on its value.
      let done = await setup(page, { read: 9, reduce: true });
      if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
      await page.waitForSelector('#rows .row');
      const reduced = await page.$eval(`#rows [data-key="${ids[11]}"][data-act="read"]`, (element) => {
        const earlier = new Set(document.getAnimations());
        element.click();
        return document.getAnimations().filter((animation) => !earlier.has(animation)).length;
      });
      const calm = await glance(page, 'hero');
      t.check('reduced motion: a change of progress starts no motion, and the bar lands on its value at once',
        reduced === 0 && calm.transition[1] === '0s', JSON.stringify({ reduced, transition: calm.transition }));
      checkValues(t, 'reduced motion', 'hero', calm, 10);
      await done();

      // Forced colours: the system's own colours, with the outline drawn as a border because the mode
      // drops shadows. The figure takes the text colour like the words around it.
      done = await setup(page, { read: 3, forced: true, route: 'home' });
      const system = await page.evaluate(() => {
        const probe = document.createElement('div');
        document.body.append(probe);
        const colours = Object.fromEntries(['Highlight', 'CanvasText'].map((name) => {
          probe.style.setProperty('color', name);
          return [name, getComputedStyle(probe).color];
        }));
        probe.remove();
        return colours;
      });
      for (const scope of ['home', 'hero']) {
        if (scope === 'hero') {
          await page.evaluate(() => { location.hash = '#/read/glance'; });
          await page.waitForSelector('#hero:not([hidden]) #hero-progress-count .glance-n');
          await still(page);
        }
        const forced = await glance(page, scope);
        t.check(`forced colors ${scope}: the fill is Highlight, the bar is bordered in CanvasText, and the figure is CanvasText`,
          forced.fillColour === system.Highlight && forced.border[0] === '1px' && forced.border[1] === system.CanvasText
          && forced.figureColour === system.CanvasText, JSON.stringify({ forced, system }));
      }
      await done();

      // Cover art on, at its worst: the hero's blurred backdrop is the cover itself, so it is given the
      // brightest cover in the dark theme and the darkest in the light one.
      for (const [theme, coverFill] of [['dark', '#ffffff'], ['light', '#000000']]) {
        for (const width of [1280, 390]) {
          done = await setup(page, { read: 3, width, theme, covers: true, coverFill });
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#hero-bg')).backgroundImage.includes('i.annihil.us'));
          // A background image paints once it has loaded, which the style alone does not say.
          await page.evaluate(async () => {
            const url = getComputedStyle(document.querySelector('#hero-bg')).backgroundImage.match(/url\("?(.*?)"?\)/)[1];
            const image = new Image();
            image.src = url;
            await image.decode().catch(() => {});
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const covered = await contrast(page, 'hero');
          const card = rgb(await page.evaluate(() => getComputedStyle(document.querySelector('#hero')).backgroundColor));
          t.check(`${theme} ${width}px covers on, a ${coverFill} cover: the cover shows through behind the row, and the figure still clears 4.5:1 and the fill and outline 3:1`,
            covered.behindBar.some((channel, index) => channel !== card[index])
            && covered.figure >= 4.5 && covered.fill >= 3 && covered.outline >= 3, JSON.stringify({ ...covered, card }));
          await done();
        }
      }
    } finally {
      page.__cover = undefined;
      if (page.__cdp) await page.__cdp.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      await page.setViewport({ width: 1280, height: 900 });
    }
  },
};

// Each breaks one promise of the change, and only the scenario above is aimed at.
export const progressGlanceMutations = [
  {
    id: 'glance-share-off', breaks: 'progress-glance',
    why: 'the bar is filled to a share of one more issue than the list holds, so it no longer matches the count',
    rewriteGlance: (source) => source.replace('((read / total) * 100)', '((read / (total + 1)) * 100)'),
  },
  {
    id: 'glance-read-twice', breaks: 'progress-glance',
    why: 'Home\'s bar is a named progress bar again and the hero\'s row is exposed, so each screen reads its progress twice',
    // Handed to the page as source text, so it carries everything it needs inside it.
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        const bar = document.querySelector('#chero-bar');
        bar?.removeAttribute('aria-hidden');
        bar?.setAttribute('role', 'progressbar');
        bar?.setAttribute('aria-label', 'Reading progress');
        document.querySelector('#hero-progress')?.removeAttribute('aria-hidden');
      });
    },
  },
  {
    id: 'glance-outline-dropped', breaks: 'progress-glance',
    why: 'the bar loses its outline, so an empty bar disappears against the card',
    script: () => addEventListener('load', () => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('styles.css'));
      if (!sheet) return;
      sheet.insertRule('.glance-bar { box-shadow: none !important; }', sheet.cssRules.length);
    }),
  },
];
