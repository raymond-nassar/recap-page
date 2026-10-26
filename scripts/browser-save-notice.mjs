// #836 item 1 (UX-10): the one-time note that saving is automatic follows the reading card. Above the
// card it pushed Read under a phone's bottom bar on a first visit, and when the first Done retired it,
// the card moved up under the pointer: 174px at 1280 by 900. Each pass is a fresh first visit. The
// Android build has its own owner, --only=save-notice. Runs on the ephemeral port like every scenario
// not listed for the app origin.
import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';

const KEY = 'mrt.state.v2';
// The order the Android reading owner measures, so the card carries real titles, creators and facts.
// A four-comic fixture with short titles left Read above the bar at 390px even with the note leading
// the card, so it could not show the note pushing Read down.
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const order = JSON.parse(readFileSync(new URL(`../src/data/${catalog.lists.find((list) => list.id === 'hickman-minimal').file}`, import.meta.url), 'utf8'));
const next = order.items[3].title;

function fixture() {
  let state = createList(createEmptyState(), { id: 'notice', name: order.name, description: order.description, catalogId: order.id });
  state = addIssuesToList(state, 'notice', order.items).state;
  for (const item of order.items.slice(0, 3)) state = markRead(state, item.issueId, true, 1767225600000);
  return state;
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

// A first saved list with no saved progress yet, which is when the note shows.
async function setup(page, { width, height, theme, text }) {
  await page.goto('about:blank');
  await page.setViewport({ width, height });
  const { identifier } = await page.evaluateOnNewDocument((initial, key, educationKey, education, chosen) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    if (!localStorage.getItem(educationKey)) localStorage.setItem(educationKey, education);
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: chosen }));
    window.open = () => null;
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Save notice fixture blocks external requests'));
    };
  }, exportBackup(fixture()), KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.EXPLAINING, theme);
  await page.goto(`${page.__origin}/#/read/notice`, { waitUntil: 'load' });
  await page.waitForFunction((name) => !document.querySelector('#view-read').hidden
    && document.querySelector('#hero-title').textContent === name, {}, next);
  if (text) await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, text);
  await settle(page);
  return async () => {
    await page.evaluate(() => localStorage.clear());
    await page.removeScriptToEvaluateOnNewDocument(identifier);
  };
}

function measure(page) {
  return page.evaluate((educationKey) => {
    const hero = document.querySelector('#hero');
    const notice = document.querySelector('#save-education');
    const box = (node) => {
      const { top, bottom } = node.getBoundingClientRect();
      return { top: Math.round(top), bottom: Math.round(bottom), page: Math.round(top + scrollY) };
    };
    // At 880px and below the rail is a bar fixed to the bottom of the window. It slides while focus
    // moves, so content is measured against where the bar rests when shown, not where it is mid-slide.
    const rail = document.querySelector('.rail-header');
    const bar = rail.getBoundingClientRect();
    const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
    return {
      shown: !notice.hidden && notice.getClientRects().length > 0,
      follows: Boolean(hero.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING),
      hero: box(hero), notice: notice.hidden ? null : box(notice), read: box(document.querySelector('#btn-hero-read')),
      fold: barred ? Math.round(innerHeight - bar.height) : innerHeight, scrollY: Math.round(scrollY),
      education: localStorage.getItem(educationKey), focus: document.activeElement?.id ?? null,
    };
  }, SAVE_EDUCATION_KEY);
}

export const saveNoticePlacement = {
  id: 'save-notice-placement',
  title: 'the one-time save note follows the reading card, so Read stays in place and the first Done moves nothing above it',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const pass of [
      { name: '1280px, light', width: 1280, height: 900, theme: 'light', readAbove: true },
      { name: '390px, dark', width: 390, height: 844, theme: 'dark', readAbove: true },
      { name: '390px at 200% text, light', width: 390, height: 844, theme: 'light', text: '200%', readAbove: false },
    ]) {
      const undo = await setup(page, pass);
      const first = await measure(page);
      t.check(`${pass.name}: a first visit shows the note after the reading card`,
        first.shown && first.follows && first.notice.top >= first.hero.bottom, JSON.stringify(first));
      // With 200% text the card alone is taller than the window, so Read cannot be above the fold; the
      // card staying put when the note retires is what shows the note no longer pushes it down.
      if (pass.readAbove) {
        t.check(`${pass.name}: Read is fully visible above the fold on a first visit`,
          first.scrollY === 0 && first.read.top >= 0 && first.read.bottom <= first.fold,
          JSON.stringify({ read: first.read, fold: first.fold }));
      }
      // Tab from the card's last control onto the note's link, parked first inside the band the bottom
      // bar covers. Focus scrolls a control that is off screen to the middle anyway, so that band is the
      // one place focus could leave the link hidden (WCAG 2.4.11, focus not obscured).
      await page.evaluate(() => {
        const link = document.querySelector('#save-education-settings');
        const rail = document.querySelector('.rail-header');
        const bar = rail.getBoundingClientRect();
        const barred = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2;
        const { top, height } = link.getBoundingClientRect();
        window.scrollBy(0, top - (barred ? innerHeight - bar.height / 2 - height / 2 : innerHeight - height - 8));
      });
      await settle(page);
      await page.$eval('#hero-more-actions > summary', (node) => node.focus({ preventScroll: true }));
      const path = [];
      for (let step = 0; step < 8 && await page.evaluate(() => document.activeElement?.id) !== 'save-education-settings'; step += 1) {
        await page.keyboard.press('Tab');
        path.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
      }
      await settle(page);
      const link = await page.evaluate(() => {
        const node = document.querySelector('#save-education-settings');
        const { top, bottom } = node.getBoundingClientRect();
        const rail = document.querySelector('.rail-header');
        const bar = rail.getBoundingClientRect();
        const fold = getComputedStyle(rail).position === 'fixed' && bar.top > innerHeight / 2 ? innerHeight - bar.height : innerHeight;
        return { focused: document.activeElement === node, top: Math.round(top), bottom: Math.round(bottom), fold: Math.round(fold) };
      });
      t.check(`${pass.name}: Tab reaches the note's Backup & settings link in view, clear of the bottom bar`,
        link.focused && link.top >= 0 && link.bottom <= link.fold, JSON.stringify({ link, path }));
      // D, Done's shortcut, from the note's own link: the note retires, focus goes to the view's
      // heading as it did above the card, and nothing above the card moves.
      await page.keyboard.press('d');
      await page.waitForFunction(() => document.querySelector('#save-education').hidden, { timeout: 5000 });
      await settle(page);
      const after = await measure(page);
      t.check(`${pass.name}: the first Done retires the note, moves focus to the view's heading and leaves the card where it was`,
        after.education === SAVE_EDUCATION_STATE.COMPLETE && !after.shown && after.focus === 'order-name'
          && Math.abs(after.hero.page - first.hero.page) <= 1,
        JSON.stringify({ before: first.hero, after: after.hero, education: after.education, focus: after.focus }));
      await undo();
    }
    t.check('the passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const saveNoticeMutations = [
  {
    id: 'save-notice-above-hero', breaks: 'save-notice-placement',
    why: 'the one-time save note leads the reading card again, pushing Read down until the first Done moves the card back up',
    script: () => document.addEventListener('DOMContentLoaded', () => {
      // Each pass starts from about:blank, which has neither.
      const body = document.querySelector('#reading-body');
      const note = document.querySelector('#save-education');
      if (body && note) body.before(note);
    }),
  },
];
