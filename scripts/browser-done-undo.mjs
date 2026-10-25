// UX-02 (#829): Done's visible result and its Undo, in a real browser. Undo is recovery code in the
// progress path, so this presses it in the states that make recovery dangerous: twice, after the
// list or the comic changed, when the save fails, at the end of the queue and after navigating.
// UX-05 (#829): what Done tells assistive technology it does, with D on and off.
// Both run on the ephemeral port like every scenario not listed for the app origin.
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { DONE_RESULT_MS } from '../src/js/views/reading.js';

const KEY = 'mrt.state.v2';
const ids = [829101, 829102, 829103, 829104];
const title = (n) => `Undo fixture (2026) #${n}`;
const row = (id, act) => `#rows [data-key="${id}"][data-act="${act}"]`;
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const press = (page, selector) => page.$eval(selector, (element) => { element.focus(); element.click(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const saved = async (page) => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), KEY));

function fixture() {
  const state = createList(createEmptyState(), { id: 'undo', name: 'Undo fixture' });
  return addIssuesToList(state, 'undo', ids.map((issueId, index) => ({
    issueId, title: title(index + 1), number: String(index + 1),
    seriesName: 'Undo fixture (2026)', seriesId: 829, digitalId: 829201 + index,
    url: `https://www.marvel.com/comics/issue/${issueId}/fixture`, source: 'manual',
  }))).state;
}

async function setup(page, width) {
  await page.setViewport({ width, height: 900 });
  await page.evaluateOnNewDocument((initial, key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, filter: 'all', theme: 'dark' }));
    window.open = (...args) => { (window.__undoOpened ??= []).push(args); return null; };
    // Every message the one announcer receives, so a second channel or a joined repeat shows up as
    // a count rather than as the last value written.
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
      if (url.pathname.endsWith('/catalog.json')) {
        return Promise.resolve(new Response(JSON.stringify({ lists: [], paths: [] })));
      }
      return url.origin === location.origin ? real(input, init)
        : Promise.reject(new TypeError('Undo fixture blocks external requests'));
    };
  }, exportBackup(fixture()), KEY);
  await page.goto(`${page.__origin}/#/read/undo`, { waitUntil: 'load' });
  await page.waitForSelector('#view-read:not([hidden])');
}

function observe(page) {
  return page.evaluate(() => {
    const node = document.querySelector('#done-result');
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left),
        right: Math.round(rect.right), height: Math.round(rect.height) };
    };
    const button = node?.querySelector('button') ?? null;
    return {
      hero: document.querySelector('#hero').hidden ? null : document.querySelector('#hero-title').textContent,
      focus: document.activeElement === button ? 'result button' : document.activeElement?.id || null,
      said: [...window.__said],
      done: document.querySelector('#btn-hero-done').getClientRects().length
        ? box(document.querySelector('#btn-hero-done')) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      result: node ? {
        text: node.querySelector('.grow')?.textContent ?? null,
        previous: node.previousElementSibling?.id ?? null,
        visible: node.checkVisibility(),
        live: !!node.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'),
        box: box(node),
        button: button ? { text: button.textContent, name: button.getAttribute('aria-label'), box: box(button) } : null,
      } : null,
    };
  });
}

async function heroIs(page, n) {
  await page.waitForFunction((expected) => document.querySelector('#hero-title').textContent === expected
    && !document.querySelector('#hero').hidden, {}, title(n));
}

async function full(page) {
  if (!await page.$eval('#full', (element) => element.open)) await click(page, '#full > summary');
  await page.waitForSelector('#rows .row');
}

async function rowAction(page, id, act) {
  const more = row(id, 'more');
  if (await page.$eval(more, (button) => button.getAttribute('aria-expanded') !== 'true')) await click(page, more);
  await click(page, row(id, act));
}

const said = (page, n) => page.evaluate((name) => window.__said.filter((text) => text.includes(name)), title(n));

export const doneUndo = {
  id: 'done-undo',
  title: 'Done shows what it marked and offers an Undo that refuses whenever it could not restore exactly',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page, 1280);
    // Boot can announce the metadata service's status, so announcements are counted per comic.
    await wait(500);
    const start = await observe(page);

    await press(page, '#btn-hero-done');
    await heroIs(page, 2);
    await page.waitForFunction((name) => window.__said.some((text) => text.includes(name)), {}, title(1));
    await wait(100);
    const offered = await observe(page);
    t.check('Done names the comic under Read and Done, with nothing above them moving',
      offered.result?.text === `Marked ${title(1)} read.` && offered.result.previous === 'hero-primary-actions'
      && offered.result.visible && offered.result.box.top >= offered.done.bottom
      && offered.done.top === start.done.top && offered.focus === 'btn-hero-done',
      JSON.stringify({ start: start.done, offered }));
    t.check('Undo is labelled with the comic, large enough to press, and the result is not a second live region',
      offered.result?.button?.text === 'Undo' && offered.result.button.name === `Undo: mark ${title(1)} unread`
      && offered.result.button.box.height >= 44 && !offered.result.live, JSON.stringify(offered.result));
    const doneSaid = await said(page, 1);
    t.check('one announcement says what Done did and that Undo is available, without the visible text again',
      doneSaid.length === 1 && doneSaid[0].startsWith(`${title(1)} marked read. Next up: ${title(2)}. Undo is available.`)
      && !doneSaid[0].includes(`Marked ${title(1)} read.`), JSON.stringify(doneSaid));

    await page.keyboard.press('Tab');
    t.check('the next Tab from Done reaches Undo', (await observe(page)).focus === 'result button');
    const marked = await saved(page);
    await page.keyboard.press('Enter');
    await heroIs(page, 1);
    await wait(100);
    const undone = await observe(page);
    const restored = await saved(page);
    t.check('Undo by keyboard restores the read map and leaves the list, comics and notes as they were',
      JSON.stringify(restored.read) === '{}' && JSON.stringify(restored.lists) === JSON.stringify(marked.lists)
      && JSON.stringify(restored.issues) === JSON.stringify(marked.issues)
      && JSON.stringify(restored.notes) === JSON.stringify(marked.notes), JSON.stringify(restored.read));
    t.check('focus returns to Done and a confirmation replaces the offer in place',
      undone.focus === 'btn-hero-done' && undone.result?.text === `Marked ${title(1)} unread. It is up next again.`
      && undone.result.button === null && undone.result.previous === 'hero-primary-actions',
      JSON.stringify(undone));
    const undoSaid = await said(page, 1);
    t.check('Undo is announced once', undoSaid.length === 2
      && undoSaid[1] === `Marked ${title(1)} unread. It is up next again.`, JSON.stringify(undoSaid));

    await page.keyboard.down('Enter');
    for (let i = 0; i < 3; i += 1) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await heroIs(page, 2);
    t.check('a held Enter on Done marks one comic, as a held D does',
      Object.keys((await saved(page)).read).join() === String(ids[0]));

    await press(page, '#btn-hero-read');
    const both = await page.evaluate(() => ({
      hint: document.querySelector('#reader-handoff-help')?.previousElementSibling?.id ?? null,
      result: document.querySelector('#done-result')?.previousElementSibling?.id ?? null,
      opened: window.__undoOpened?.length ?? 0,
    }));
    t.check('Read keeps the offer: its hint goes directly under the commands, above the result',
      both.opened === 1 && both.hint === 'hero-primary-actions' && both.result === 'reader-handoff-help',
      JSON.stringify(both));

    // A click runs its handler inside the evaluation and the Store repaints synchronously, so the
    // offer must be gone when the click returns. Waiting for it instead let the timer remove it.
    await full(page);
    await rowAction(page, ids[2], 'down');
    const reordered = await saved(page);
    t.check('reordering the list withdraws the offer on the same repaint',
      reordered.lists.undo.itemIds.join() === [ids[0], ids[1], ids[3], ids[2]].join()
      && !await page.$('#done-result') && Object.keys(reordered.read).join() === String(ids[0]),
      JSON.stringify(reordered.lists.undo.itemIds));

    await press(page, '#btn-hero-done');
    await page.waitForSelector('#done-result button');
    await click(page, row(ids[1], 'read'));
    await heroIs(page, 2);
    t.check('marking the comic unread another way withdraws the offer',
      !await page.$('#done-result') && !Object.hasOwn((await saved(page)).read, ids[1]));

    await press(page, '#btn-hero-done');
    await page.waitForSelector('#done-result button');
    await rowAction(page, ids[3], 'defer');
    t.check('deferring another comic in the list withdraws the offer', !await page.$('#done-result'));

    await press(page, '#btn-hero-done');
    await page.waitForFunction(() => !document.querySelector('#all-deferred').hidden);
    const end = await observe(page);
    t.check('finishing the queue puts the result under the heading that replaced the hero, with focus kept there',
      end.hero === null && end.result?.previous === 'all-deferred-h' && end.result.visible
      && end.focus === 'all-deferred-h' && end.result.text === `Marked ${title(3)} read.`, JSON.stringify(end));
    await press(page, '#done-result button');
    await heroIs(page, 3);
    const back = await observe(page);
    t.check('Undo from the end state brings the hero back with focus on Done and the deferral intact',
      back.focus === 'btn-hero-done' && back.result?.previous === 'hero-primary-actions'
      && JSON.stringify((await saved(page)).lists.undo.deferredIssueIds) === JSON.stringify([ids[3]]),
      JSON.stringify(back));

    await press(page, '#btn-hero-done');
    await page.waitForSelector('#done-result button');
    await click(page, '.ri[data-view="library"]');
    await page.waitForSelector('#view-library:not([hidden])');
    await page.goBack();
    await page.waitForSelector('#view-read:not([hidden])');
    t.check('navigating away and back leaves no result and keeps the mark',
      !await page.$('#done-result') && Object.hasOwn((await saved(page)).read, ids[2]));

    await full(page);
    await rowAction(page, ids[3], 'defer');
    await heroIs(page, 4);
    await press(page, '#btn-hero-done');
    await page.waitForSelector('#done-result button');
    // Done's own announcement lands 30 ms after the press; it must be counted before Undo is.
    await wait(100);
    const failing = await saved(page);
    await page.evaluate((key) => {
      const set = Storage.prototype.setItem;
      window.__undoRestoreSet = () => { Storage.prototype.setItem = set; };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Fixture save refused', 'QuotaExceededError');
        return set.call(this, name, value);
      };
    }, KEY);
    const spokenBefore = (await said(page, 4)).length;
    await press(page, '#done-result button');
    await wait(100);
    const failed = await observe(page);
    const refusal = {
      unchanged: JSON.stringify(await saved(page)) === JSON.stringify(failing),
      silent: (await said(page, 4)).length === spokenBefore,
      report: await page.$eval('#save-report', (node) => node.textContent),
    };
    t.check('a refused Undo save keeps the comic read, offers Try again in place and keeps focus on it',
      refusal.unchanged && refusal.silent && refusal.report.includes('not saved')
      && failed.result?.text === `${title(4)} is still marked read: that change could not be saved.`
      && failed.result.button?.text === 'Try again' && failed.focus === 'result button',
      JSON.stringify({ ...refusal, result: failed.result, focus: failed.focus }));
    await page.evaluate(() => window.__undoRestoreSet());
    await press(page, '#done-result button');
    await heroIs(page, 4);
    t.check('Try again succeeds once saving works again',
      !Object.hasOwn((await saved(page)).read, ids[3])
      && (await observe(page)).result?.text === `Marked ${title(4)} unread. It is up next again.`);

    // The exact lengths, restarts and holds are proved with a fake clock in the unit tests. Here the
    // real pointer and focus events of Edge hold it, and it retires on time once both have left.
    await press(page, '#btn-hero-done');
    await page.waitForSelector('#done-result button');
    await page.hover('#done-result .grow');
    await wait(DONE_RESULT_MS + 1000);
    const pointed = !!await page.$('#done-result');
    await page.mouse.move(1, 1);
    await page.focus('#done-result button');
    await wait(DONE_RESULT_MS + 1000);
    const focused = !!await page.$('#done-result');
    await page.focus('#all-read-h');
    await wait(DONE_RESULT_MS - 1500);
    const restarted = !!await page.$('#done-result');
    await wait(2500);
    t.check('pointing at or focusing the result holds it, and it retires on time once both have left',
      pointed && focused && restarted && !await page.$('#done-result')
      && Object.hasOwn((await saved(page)).read, ids[3]),
      JSON.stringify({ pointed, focused, restarted }));

    await page.setViewport({ width: 390, height: 844 });
    await full(page);
    await click(page, row(ids[3], 'read'));
    await click(page, row(ids[2], 'read'));
    await heroIs(page, 4);
    const narrowStart = await observe(page);
    await press(page, '#btn-hero-done');
    await heroIs(page, 3);
    await page.waitForSelector('#done-result button');
    const narrow = await observe(page);
    t.check('at 390px the result sits under Done within the screen, without page overflow',
      narrow.result?.visible && narrow.result.box.left >= 0 && narrow.result.box.right <= 390
      && narrow.result.button.box.height >= 44 && narrow.overflow <= 0
      && narrow.done.top === narrowStart.done.top, JSON.stringify({ narrowStart: narrowStart.done, narrow }));
    t.check('the journey raises no page errors', errors.length === 0, errors.join(' / '));
  },
};

// The owner kept the one-word label on 2026-10-24 and approved a description instead. The
// description says nothing about D, so turning D off, which strips the tooltip and the shortcut,
// must leave it in place. Its element is hidden rather than visually hidden: a hidden node that
// aria-describedby names directly still describes, and browse mode then reads it only once.
const DESCRIPTION = 'Marks this comic read and shows the next one.';

export const doneDescription = {
  id: 'done-description',
  title: 'Done keeps its short label and describes what it does to assistive technology, with D on or off',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page, 1280);
    const exposed = async () => {
      const done = await page.accessibility.snapshot({ root: await page.$('#btn-hero-done'), interestingOnly: false });
      const hero = await page.accessibility.snapshot({ root: await page.$('#hero'), interestingOnly: false });
      const repeated = [];
      const visit = (node) => {
        if (`${node.name ?? ''}`.includes('Marks this comic read')) repeated.push(node.role);
        for (const child of node.children ?? []) visit(child);
      };
      visit(hero);
      return {
        role: done?.role, name: done?.name, description: done?.description ?? null,
        keys: done?.keyshortcuts ?? null, repeated,
        label: await page.$eval('#btn-hero-done', (button) => button.textContent.trim()),
        boxes: await page.$$eval('#hero-done-help', (nodes) => nodes.map((node) => node.getClientRects().length)),
      };
    };
    const wide = await exposed();
    t.check('Done keeps the visible label Done and is described as marking the comic read and showing the next one',
      wide.role === 'button' && wide.name === 'Done' && wide.label === 'Done' && wide.keys === 'd'
      && wide.description === DESCRIPTION, JSON.stringify(wide));

    await click(page, '.ri[data-view="data"]');
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#opt-reading-shortcut');
    await page.goBack();
    await page.waitForSelector('#view-read:not([hidden])');
    const off = await exposed();
    t.check('turning D off removes the shortcut but keeps the description',
      off.keys === null && off.name === 'Done' && off.description === DESCRIPTION, JSON.stringify(off));

    await page.setViewport({ width: 390, height: 844 });
    const narrow = await exposed();
    t.check('the description draws nothing and is not read a second time in the hero, wide or narrow',
      [wide, narrow].every((seen) => seen.boxes.join() === '0' && seen.repeated.length === 0)
      && narrow.description === DESCRIPTION, JSON.stringify({ wide, narrow }));
    t.check('the checks raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const doneDescriptionMutations = [
  {
    id: 'done-description-dropped-with-d-off', breaks: 'done-description',
    why: 'turning D off also disconnects the description, though it says nothing about the key',
    rewriteMain: (source) => source.replace(
      "    done.removeAttribute('aria-keyshortcuts');",
      "    done.removeAttribute('aria-keyshortcuts');\n    done.removeAttribute('aria-describedby');",
    ),
  },
];

export const doneUndoMutations = [
  {
    id: 'done-undo-kept-after-reorder', breaks: 'done-undo',
    why: 'a reorder leaves Undo offered for a context it can no longer restore exactly',
    rewriteReading: (source) => source.replace(
      'if (doneResult && !doneResult.settling && !doneResultHolds(doneResult)) withdrawDoneResult(doneResult);',
      '// withdrawal on repaint removed',
    ),
  },
];
