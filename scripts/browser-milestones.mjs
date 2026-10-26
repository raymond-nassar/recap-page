// #874 (UX-37): Reading Journey milestones in a real browser. Finishing a section of the full Reading
// List, or the whole list, by Done, D or the row toggle is said once in that action's own
// announcement, drawn on the section heading or as the line the wrap-up card opens with, and taken
// back by Undo or an unmark. The moment is under half a second, never flashes and does not play with
// reduced motion. Runs on the ephemeral port like every scenario not listed for the app origin.
import { createEmptyState, createList, addIssuesToList, markRead, exportBackup } from '../src/js/lib/model.js';
import { MILESTONE_MS } from '../src/js/lib/milestones.js';
import { SAVE_EDUCATION_KEY } from '../src/js/lib/saveEducation.js';

const KEY = 'mrt.state.v2';
const ids = [874101, 874102, 874103, 874104];
const title = (n) => `Milestone fixture (2026) #${n}`;
const book = (n) => (n <= 2 ? 'Book One' : 'Book Two');
const row = (id, act) => `#rows [data-key="${id}"][data-act="${act}"]`;
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const press = (page, selector) => page.$eval(selector, (element) => { element.focus(); element.click(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const saved = async (page) => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), KEY));

function fixture() {
  let state = createList(createEmptyState(), { id: 'journey', name: 'Milestone fixture' });
  state = addIssuesToList(state, 'journey', ids.map((issueId, index) => ({
    issueId, title: title(index + 1), number: String(index + 1),
    seriesName: 'Milestone fixture (2026)', seriesId: 874, digitalId: 874201 + index,
    url: `https://www.marvel.com/comics/issue/${issueId}/fixture`, source: 'manual', collectedIn: book(index + 1),
  }))).state;
  return markRead(state, ids[0], true, 1000);
}

// Starts from blank each time, so a scenario can take several passes over the one page that carries
// any mutation under proof, and returns what undoes the pass.
async function setup(page, { width = 1280, theme = 'dark', reduce = false, forced = false } = {}) {
  await page.goto('about:blank');
  await page.setViewport({ width, height: 900 });
  page.__cdp ??= await page.createCDPSession();
  await page.__cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
    { name: 'forced-colors', value: forced ? 'active' : 'none' },
  ] });
  const { identifier } = await page.evaluateOnNewDocument((initial, key, chosen) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'all', theme: chosen }));
    window.open = () => null;
    window.__said = [];
    document.addEventListener('DOMContentLoaded', () => {
      const announcer = document.querySelector('#announcer');
      new MutationObserver(() => {
        if (announcer.textContent) window.__said.push(announcer.textContent);
      }).observe(announcer, { childList: true, characterData: true, subtree: true });
    });
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Milestone fixture blocks external requests'));
    };
  }, exportBackup(fixture()), KEY, theme);
  await page.goto(`${page.__origin}/#/read/journey`, { waitUntil: 'load' });
  await page.waitForSelector('#view-read:not([hidden])');
  if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
  await page.waitForSelector('#rows .row');
  // Boot can announce the metadata service's status, so announcements are counted per comic.
  await wait(400);
  return async () => {
    await page.evaluate(() => localStorage.clear());
    await page.removeScriptToEvaluateOnNewDocument(identifier);
  };
}

// What the page shows of each milestone, and the animations a click starts: the Store repaints
// synchronously, so the moment has started by the time the click returns or it never will. An earlier
// moment can still be running, so only animations the click started are counted.
function act(page, selector) {
  return page.$eval(selector, (element) => {
    const earlier = new Set(document.getAnimations());
    element.focus();
    element.click();
    return document.getAnimations().filter((animation) => !earlier.has(animation)
      && animation.effect?.target?.matches?.('.rg-done, #list-wrap-up-cheer'))
      .map((animation) => ({
        target: animation.effect.target.id || 'badge',
        duration: animation.effect.getTiming().duration,
        opacity: animation.effect.getKeyframes().map((frame) => Number(frame.opacity)),
      }));
  });
}

function observe(page) {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll('#rows .row-group')].map((head) => {
      const badge = head.querySelector('.rg-done');
      return {
        name: head.querySelector('.rg-name').textContent, done: head.classList.contains('is-done'),
        bar: !!head.querySelector('progress'), badge: badge ? badge.textContent : null,
        glyphHidden: badge?.querySelector('[aria-hidden="true"]')?.textContent === '✓',
        within: badge ? badge.getBoundingClientRect().right <= document.documentElement.clientWidth : null,
      };
    });
    const cheer = document.querySelector('#list-wrap-up-cheer');
    const result = document.querySelector('#done-result');
    // The text's own extent rather than the block it sits in, which is as wide as the card whatever
    // the words do.
    const text = (() => {
      if (!cheer) return null;
      const range = document.createRange();
      range.selectNodeContents(cheer);
      return { box: range.getBoundingClientRect(), lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
    })();
    return {
      heads,
      cheer: cheer && cheer.checkVisibility() ? {
        text: cheer.textContent, first: cheer.parentElement.firstElementChild === cheer,
        card: cheer.closest('#list-wrap-up')?.checkVisibility() ?? false,
        left: Math.round(text.box.left), right: Math.round(text.box.right), lines: text.lines,
        cardLeft: Math.round(cheer.closest('#list-wrap-up').getBoundingClientRect().left),
        cardRight: Math.round(cheer.closest('#list-wrap-up').getBoundingClientRect().right),
      } : null,
      result: result ? result.querySelector('.grow')?.textContent ?? null : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      said: [...window.__said],
      keys: Object.keys(localStorage).sort(),
    };
  });
}

const spoken = (seen, n) => seen.said.filter((text) => text.includes(title(n)));

export const milestones = {
  id: 'milestones',
  title: 'Finishing a section or the whole list is said once, drawn in words and taken back by Undo or an unmark',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page);
    const start = await observe(page);
    const before = await saved(page);
    t.check('before: no section is complete, each heading has its bar, and the wrap-up has no line',
      start.heads.map((head) => `${head.name}:${head.done}:${head.bar}`).join() === 'Book One:false:true,Book Two:false:true'
      && start.cheer === null, JSON.stringify(start.heads));

    const doneMoment = await act(page, '#btn-hero-done');
    await page.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, title(3));
    await wait(100);
    const done = await observe(page);
    t.check('Done on the last unread comic of a section says so in its result and in its one announcement',
      done.result === `Marked ${title(2)} read. Section complete: Book One.`
      && spoken(done, 2).length === 1
      && spoken(done, 2)[0].startsWith(`${title(2)} marked read. Section complete: Book One. Next up: ${title(3)}. Undo is available.`),
      JSON.stringify({ result: done.result, said: spoken(done, 2) }));
    const [finished, open] = done.heads;
    t.check('the finished heading says Complete in words with the tick hidden, where its bar was; the other keeps its bar',
      finished.done && !finished.bar && finished.badge === '✓Complete' && finished.glyphHidden && finished.within
      && !open.done && open.bar && open.badge === null, JSON.stringify(done.heads));
    const ax = await page.accessibility.snapshot({ root: await page.$('#rows .row-group.is-done'), interestingOnly: false });
    const names = [];
    const visit = (node) => { if (node.name) names.push(node.name); for (const child of node.children ?? []) visit(child); };
    visit(ax);
    t.check('assistive technology reads the heading, the count and Complete, without the tick',
      names.includes('Book One') && names.includes('2 of 2 read') && names.includes('Complete') && !names.some((name) => name.includes('✓')),
      JSON.stringify(names));
    t.check('the moment plays once on the badge, under half a second, with opacity only ever rising',
      doneMoment.length === 1 && doneMoment[0].target === 'badge' && doneMoment[0].duration === MILESTONE_MS
      && MILESTONE_MS < 500 && doneMoment[0].opacity.every((value, index, all) => index === 0 || value >= all[index - 1]),
      JSON.stringify(doneMoment));

    await press(page, '#done-result button');
    await page.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, title(2));
    await wait(100);
    const undone = await observe(page);
    const restored = await saved(page);
    t.check('Undo takes the milestone back with every read mark, list and note as they were',
      !undone.heads[0].done && undone.heads[0].bar && undone.heads[0].badge === null
      && undone.result === `Marked ${title(2)} unread. It is up next again.`
      && JSON.stringify(restored.read) === JSON.stringify(before.read)
      && JSON.stringify(restored.lists) === JSON.stringify(before.lists)
      && JSON.stringify(restored.notes) === JSON.stringify(before.notes), JSON.stringify({ heads: undone.heads, read: restored.read }));

    await page.$eval('#full > summary', (summary) => summary.blur());
    await page.focus('#order-name').catch(() => {});
    await page.keyboard.press('d');
    await page.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, title(3));
    await wait(100);
    const keyed = await observe(page);
    t.check('D says the same once and draws the same heading',
      spoken(keyed, 2).length === 3 && spoken(keyed, 2)[2].startsWith(`${title(2)} marked read. Section complete: Book One.`)
      && keyed.heads[0].done && keyed.result === `Marked ${title(2)} read. Section complete: Book One.`,
      JSON.stringify(spoken(keyed, 2)));

    await act(page, row(ids[2], 'read'));
    await wait(100);
    const listMoment = await act(page, row(ids[3], 'read'));
    // The line is what is under test, so a missing one is reported by the check below, not a timeout.
    await page.waitForSelector('#list-wrap-up-cheer:not([hidden])', { timeout: 5000 }).catch(() => {});
    // Measured once the moment has settled, so the scale it starts from is not taken for the layout. A
    // transition replaced before it ends rejects its promise, and has settled all the same.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    const finishedList = await observe(page);
    t.check('the row toggle that finishes the list says so once, and that covers the section it finished',
      spoken(finishedList, 3).at(-1) === `${title(3)} marked read.`
      && spoken(finishedList, 4).length === 1 && spoken(finishedList, 4)[0] === `${title(4)} marked read. That is the whole order finished.`
      && finishedList.heads.every((head) => head.done), JSON.stringify({ three: spoken(finishedList, 3), four: spoken(finishedList, 4) }));
    t.check('the wrap-up card opens with the All read line, on one line, inside the card',
      finishedList.cheer?.text === 'All read!' && finishedList.cheer.first && finishedList.cheer.card && finishedList.cheer.lines === 1
      && finishedList.cheer.left >= finishedList.cheer.cardLeft && finishedList.cheer.right <= finishedList.cheer.cardRight,
      JSON.stringify(finishedList.cheer));
    t.check('the line and the section it finished each have their moment',
      listMoment.length === 2 && listMoment.some((moment) => moment.target === 'list-wrap-up-cheer')
      && listMoment.every((moment) => moment.duration < 500), JSON.stringify(listMoment));

    await act(page, row(ids[3], 'read'));
    await wait(100);
    const unmarked = await observe(page);
    t.check('an unmark takes the line and the heading back and says nothing more than the unmark',
      unmarked.cheer === null && !unmarked.heads[1].done && unmarked.heads[1].bar
      && spoken(unmarked, 4).at(-1) === `${title(4)} marked unread.`, JSON.stringify({ heads: unmarked.heads, said: spoken(unmarked, 4) }));

    await act(page, '#btn-hero-done');
    await page.waitForSelector('#list-wrap-up-cheer:not([hidden])', { timeout: 5000 }).catch(() => {});
    await wait(100);
    const doneList = await observe(page);
    t.check('Done that finishes the list keeps its one announcement and opens the wrap-up with the line',
      spoken(doneList, 4).at(-1).startsWith(`${title(4)} marked read. That is the whole order finished. Undo is available.`)
      && doneList.result === `Marked ${title(4)} read.` && doneList.cheer?.text === 'All read!', JSON.stringify(doneList.result));
    await press(page, '#done-result button');
    await page.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, title(4));
    const back = await observe(page);
    t.check('and Undo takes it back', back.cheer === null && !back.heads[1].done, JSON.stringify(back.heads));
    // The first saved mark has always recorded that the save explanation was given; that key is the
    // only one a mark may add. The reading data is compared without the two stamps every write renews.
    const added = back.keys.filter((key) => !start.keys.includes(key));
    const fields = (value) => JSON.stringify(Object.keys(value).filter((key) => !['writeToken', 'exportedAt'].includes(key)).sort());
    t.check('nothing new is saved: no storage key beyond the save explanation, and the reading data keeps its fields',
      added.join() === SAVE_EDUCATION_KEY && fields(await saved(page)) === fields(before),
      JSON.stringify({ start: start.keys, now: back.keys, fields: fields(await saved(page)) }));
    t.check('the journey raises no page errors', errors.length === 0, errors.join(' / '));
  },
};

// The preferences and widths the moment and the two drawn states must hold in. Each pass starts from
// the fixture with the first section one comic short, and the list one section short.
export const milestonePreferences = {
  id: 'milestone-preferences',
  title: 'Milestones hold in light, dark and forced colors, with reduced motion, and at 390px',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const pass of [
      { width: 1280, theme: 'light' },
      { width: 1280, theme: 'dark', reduce: true },
      { width: 1280, theme: 'dark', forced: true, reduce: true },
      { width: 390, theme: 'dark' },
      { width: 390, theme: 'light' },
    ]) {
      const label = `${pass.width}px ${pass.theme}${pass.reduce ? ' reduced motion' : ''}${pass.forced ? ' forced colors' : ''}`;
      const tab = page;
      const undo = await setup(tab, pass);
      const sectionMoment = await act(tab, '#btn-hero-done');
      await act(tab, row(ids[2], 'read'));
      const listMoment = await act(tab, row(ids[3], 'read'));
      await tab.waitForSelector('#list-wrap-up-cheer:not([hidden])', { timeout: 5000 }).catch(() => {});
      await wait(500);
      const seen = await observe(tab);
      const paint = await tab.evaluate(() => {
        const style = (selector) => {
          const node = document.querySelector(selector);
          return node ? getComputedStyle(node) : null;
        };
        const cheer = style('#list-wrap-up-cheer');
        const badge = style('.rg-done');
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('i');
        document.body.append(probe);
        const resolve = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
        const tokens = { logo: resolve('--logo-fill'), teal: resolve('--teal'), canvasText: (() => {
          probe.style.color = 'CanvasText'; return getComputedStyle(probe).color;
        })() };
        probe.remove();
        return {
          cheer: cheer && { color: cheer.color, stroke: cheer.webkitTextStrokeWidth, shadow: cheer.textShadow },
          badge: badge && { color: badge.color, border: badge.borderTopStyle, borderWidth: badge.borderTopWidth },
          scheme: root.colorScheme, tokens,
        };
      });
      const moved = sectionMoment.length + listMoment.length;
      t.check(`${label}: the heading badge and the All read line show, within the screen and without page overflow`,
        seen.heads.every((head) => head.done && head.badge === '✓Complete' && head.within)
        && seen.cheer?.text === 'All read!' && seen.cheer.left >= seen.cheer.cardLeft
        && seen.cheer.right <= seen.cheer.cardRight && seen.overflow <= 0,
        JSON.stringify({ heads: seen.heads, cheer: seen.cheer, overflow: seen.overflow }));
      t.check(`${label}: ${pass.reduce ? 'nothing moves' : 'each milestone has its moment'}`,
        pass.reduce ? moved === 0 : moved === 3, JSON.stringify({ sectionMoment, listMoment }));
      t.check(`${label}: ${pass.forced ? 'system colors, with no stroke or shadow, and the badge keeps its border'
        : 'the line in the masthead color and the badge in the positive color'}`,
      !!paint.cheer && !!paint.badge && (pass.forced
        ? paint.cheer.color === paint.tokens.canvasText && paint.cheer.stroke === '0px' && paint.cheer.shadow === 'none'
          && paint.badge.border === 'solid' && paint.badge.borderWidth === '1px'
        : paint.cheer.color === paint.tokens.logo && paint.badge.color === paint.tokens.teal && paint.cheer.shadow !== 'none'),
      JSON.stringify(paint));
      await undo();
    }
    t.check('the passes raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const milestoneMutations = [
  {
    id: 'milestone-section-unsaid', breaks: 'milestones',
    why: 'a finished section is drawn but left out of the announcement and Done\'s result',
    rewriteReading: (source) => source.replace(
      "const section = milestone.section && !milestone.list ? ` ${sectionSentence(milestone.section.name)}` : '';",
      "const section = '';",
    ),
  },
  {
    id: 'milestone-heading-color-only', breaks: 'milestones',
    why: 'a finished section keeps its full bar, so only the color it already had says it is done',
    rewriteReading: (source) => source.replace(
      'run.read === run.total ? el(\'span\', { class: \'badge badge-done rg-done\' }',
      'false ? el(\'span\', { class: \'badge badge-done rg-done\' }',
    ),
  },
  {
    id: 'milestone-motion-ignores-preference', breaks: 'milestone-preferences',
    why: 'the moment plays even when reduced motion is requested',
    rewriteMilestones: (source) => source.replace(
      "if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;",
      '',
    ),
  },
];
