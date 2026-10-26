// #846: keyboard focus near the foot of the reading card moved the card's own content. The card was
// overflow: hidden, which made it a scroll container, and its decorative layer, scaled 1.3, reached
// past its foot by 15 per cent of its height. At 880px and below, focus keeps clear of the bottom bar
// by scrolling every container in its chain, so Tab onto More comic actions scrolled the card itself
// and cut off "Read this next" at its top, which stayed cut off after a visit to Settings. The Android
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

function fixture() {
  let state = createList(createEmptyState(), { id: 'card', name: order.name, description: order.description, catalogId: order.id });
  state = addIssuesToList(state, 'card', order.items).state;
  for (const item of order.items.slice(0, 3)) state = markRead(state, item.issueId, true, 1767225600000);
  return state;
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

// A list under way, past the one-time save note, so the card is the first thing in the reading view.
async function setup(page, { width, height, theme, text }) {
  await page.goto('about:blank');
  await page.setViewport({ width, height });
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
  }, exportBackup(fixture()), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, theme);
  await page.goto(`${page.__origin}/#/read/card`, { waitUntil: 'load' });
  await page.waitForFunction((name) => !document.querySelector('#view-read').hidden
    && document.querySelector('#hero-title').textContent === name, {}, next);
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
      eyebrow: Math.round((hero.querySelector('.eyebrow').getBoundingClientRect().top - card.top) * 10) / 10,
      focus: focused?.id || focused?.tagName || null, inCard,
      control: control ? [Math.round(control.top), Math.round(control.bottom)] : null,
      fold: Math.round(barred ? innerHeight - bar.height : innerHeight),
    };
  });
}

export const readingCardFocus = {
  id: 'reading-card-focus',
  title: 'keyboard focus moves the page, never the reading card\'s own content, so "Read this next" stays whole',
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
        if (pass.open && !opened && now.focus === 'SUMMARY') {
          await page.keyboard.press('Enter');
          opened = true;
          await settle(page);
          now = await measure(page);
        }
        steps.push(now);
      }
      const moved = steps.filter((step) => step.scrollTop !== 0 || step.eyebrow !== rest.eyebrow);
      t.check(`${pass.name}: Tab through the card's controls leaves its content where it was`,
        steps.length >= 3 && steps.some((step) => step.focus === 'SUMMARY') && opened === !!pass.open && !moved.length,
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
        back.scrollTop === 0 && back.eyebrow === rest.eyebrow, JSON.stringify({ rest, back }));
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
    t.check('the passes raise no page errors', errors.length === 0, errors.join(' / '));
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
];
