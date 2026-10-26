// UX-02 (#829): Done's visible result and its Undo, in a real browser. Undo is recovery code in the
// progress path, so this presses it in the states that make recovery dangerous: twice, after the
// list or the comic changed, when the save fails, at the end of the queue and after navigating.
// UX-05 (#829): what Done tells assistive technology it does, with D on and off.
// UX-41 (#829): Done on Home's Continue reading, sharing that result and Undo.
// #855: no visual hint covers that result, in either place.
// #860: neither Read's hint nor Done's covers the other button or takes a click meant for it.
// All run on the ephemeral port like every scenario not listed for the app origin.
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

async function setup(page, width, route = '#/read/undo') {
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
  await page.goto(`${page.__origin}/${route}`, { waitUntil: 'load' });
  await page.waitForSelector(route.startsWith('#/home') ? '#view-home:not([hidden])' : '#view-read:not([hidden])');
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

// UX-41 (#829): Home's Continue reading has a Done of its own for the comic its card names, sharing
// the result and Undo above with their withdrawal and focus rules. Its offer stands only while Home
// shows, so leaving Home ends it, and another tab's save withdraws it as it does in the reading view.
function observeHome(page) {
  return page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left),
        right: Math.round(rect.right), height: Math.round(rect.height) };
    };
    const shown = (selector) => {
      const element = document.querySelector(selector);
      return element?.getClientRects().length ? box(element) : null;
    };
    const node = document.querySelector('#done-result');
    const button = node?.querySelector('button') ?? null;
    return {
      next: document.querySelector('#chero-next').textContent,
      count: document.querySelector('#chero-count').textContent,
      read: shown('#btn-chero-read'),
      done: shown('#btn-chero-done'),
      actions: shown('#chero-actions'),
      focus: document.activeElement === button ? 'result button' : document.activeElement?.id || null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      result: node ? {
        text: node.querySelector('.grow')?.textContent ?? null,
        previous: node.previousElementSibling?.id ?? null,
        inCard: !!node.closest('#home-continue'),
        visible: node.checkVisibility(),
        box: box(node),
        button: button ? { text: button.textContent, name: button.getAttribute('aria-label'), box: box(button) } : null,
      } : null,
    };
  });
}

const nextIs = (page, text, timeout = 30000) => page.waitForFunction(
  (expected) => document.querySelector('#chero-next').textContent === expected, { timeout }, text);

export const doneHome = {
  id: 'done-home',
  title: 'Done on Home\'s Continue reading marks the comic its card names and shares the result, Undo and their rules',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The other tab starts first, so anything it writes while starting lands before the offer exists.
    const other = await page.browserContext().newPage();
    other.__origin = page.__origin;
    await setup(other, 1280);
    await setup(page, 1280, '#/home');
    const ready = await page.waitForSelector('#home-continue:not([hidden]) #btn-chero-done', { timeout: 5000 })
      .then(() => true, () => false);
    await wait(500);
    const start = await observeHome(page);
    const ax = ready ? await page.accessibility.snapshot({ root: await page.$('#btn-chero-done'), interestingOnly: false }) : null;
    const commands = await page.$$eval('#chero-actions > .btn', (nodes) => nodes
      .filter((node) => node.getClientRects().length).map((node) => [node.id, node.className]));
    t.check('Done sits beside Read as a secondary command, named and described as on the hero',
      ready && commands[0]?.[0] === 'btn-chero-read' && commands[1]?.join() === 'btn-chero-done,btn btn-g'
      && commands.filter(([, name]) => name === 'btn').length === 1
      && ax?.name === 'Done' && ax.description === DESCRIPTION && !ax.keyshortcuts
      && start.done?.height === start.read?.height, JSON.stringify({ commands, ax, start }));
    if (!ready) {
      await other.close();
      return;
    }

    await press(page, '#btn-chero-done');
    await nextIs(page, `Next: ${title(2)}`);
    await wait(100);
    const offered = await observeHome(page);
    const doneSaid = await said(page, 1);
    t.check('Done on Home marks the comic the card named, updates Next and the count, and keeps focus on Done',
      Object.keys((await saved(page)).read).join() === String(ids[0]) && offered.count === '1 of 4 issues read'
      && offered.focus === 'btn-chero-done' && offered.done?.top === start.done.top,
      JSON.stringify({ start: start.done, offered }));
    t.check('the same result sits in the card under its commands, and one announcement says Undo is available',
      offered.result?.text === `Marked ${title(1)} read.` && offered.result.previous === 'chero-actions'
      && offered.result.inCard && offered.result.visible && offered.result.button?.name === `Undo: mark ${title(1)} unread`
      && doneSaid.length === 1 && doneSaid[0].startsWith(`${title(1)} marked read. Next up: ${title(2)}. Undo is available.`),
      JSON.stringify({ result: offered.result, doneSaid }));

    let tabs = 0;
    while ((await observeHome(page)).focus !== 'result button' && tabs < 6) {
      await page.keyboard.press('Tab');
      tabs += 1;
    }
    await page.keyboard.press('Enter');
    // A refused Undo leaves Next where it was, so the check below says so instead of a timeout.
    await nextIs(page, `Next: ${title(1)}`, 5000).catch(() => {});
    await wait(100);
    const undone = await observeHome(page);
    t.check('Undo by keyboard on Home puts the comic back as next and returns focus to Home\'s Done',
      tabs < 6 && JSON.stringify((await saved(page)).read) === '{}' && undone.focus === 'btn-chero-done'
      && undone.result?.text === `Marked ${title(1)} unread. It is up next again.` && undone.result.button === null
      && undone.result.previous === 'chero-actions', JSON.stringify({ tabs, undone }));

    await press(page, '#btn-chero-done');
    await page.waitForSelector('#done-result button');
    await wait(300);
    const standing = !!await page.$('#done-result button');
    await other.waitForFunction((name) => document.querySelector('#hero-title').textContent === name, {}, title(2));
    await press(other, '#btn-hero-done');
    await page.waitForFunction(() => !document.querySelector('#done-result'), { timeout: 5000 }).catch(() => {});
    const foreign = await saved(page);
    t.check('another tab\'s save withdraws the Home offer on the repaint it causes',
      standing && !await page.$('#done-result') && Object.hasOwn(foreign.read, ids[0]) && Object.hasOwn(foreign.read, ids[1]),
      JSON.stringify({ standing, read: Object.keys(foreign.read) }));
    await other.close();

    await nextIs(page, `Next: ${title(3)}`);
    await press(page, '#btn-chero-done');
    await page.waitForSelector('#done-result button');
    await click(page, '.ri[data-view="library"]');
    await page.waitForSelector('#view-library:not([hidden])');
    await page.goBack();
    await page.waitForSelector('#view-home:not([hidden])');
    t.check('leaving Home retires the offer: back on Home there is no result and the mark stays',
      !await page.$('#done-result') && Object.hasOwn((await saved(page)).read, ids[2]));

    await nextIs(page, `Next: ${title(4)}`);
    await press(page, '#btn-chero-done');
    await nextIs(page, 'You have read every issue in this order.');
    await wait(100);
    const end = await observeHome(page);
    t.check('Done on the last comic keeps the result under the card\'s commands, hides Done with Read and focuses the card heading',
      end.done === null && end.read === null && end.focus === 'chero-h' && end.result?.previous === 'chero-actions'
      && end.result.text === `Marked ${title(4)} read.` && end.result.visible, JSON.stringify(end));
    await press(page, '#done-result button');
    await nextIs(page, `Next: ${title(4)}`);
    const back = await observeHome(page);
    t.check('Undo from there brings Done back with focus on it',
      back.focus === 'btn-chero-done' && !!back.done && !Object.hasOwn((await saved(page)).read, ids[3]), JSON.stringify(back));

    await page.setViewport({ width: 390, height: 844 });
    const narrowStart = await observeHome(page);
    await press(page, '#btn-chero-done');
    await nextIs(page, 'You have read every issue in this order.');
    const narrow = await observeHome(page);
    t.check('at 390px the result sits in the card under its commands, within the screen, without page overflow',
      narrow.result?.visible && narrow.result.box.left >= 0 && narrow.result.box.right <= 390
      && narrow.result.button?.box.height >= 44 && narrow.overflow <= 0
      && narrow.actions?.top === narrowStart.actions?.top, JSON.stringify({ narrowStart: narrowStart.actions, narrow }));
    t.check('the journey raises no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const doneHomeMutations = [
  {
    id: 'done-home-held-to-reading-view', breaks: 'done-home',
    why: 'the Home offer is held to the reading view\'s check, so on Home its own Undo can only refuse',
    rewriteReading: (source) => source.replace(
      "current: () => !$('#view-home').hidden,",
      'current: () => isCurrent(),',
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

// #855: Done's result is the confirmation, or the failure, of the change just made, so no visual
// hint may sit over it. With Done near the top of the window a hint has no room above it, and the
// next side it tries, below, is over the result: measured on main, Done's hint and Read's both
// landed there, and on a short window Home's result scrolls level with the collapsed rail's first
// destination, whose hint then covers its start. There the hint gives way. Where it fits clear of
// the result it shows as before, which is checked too, so giving way cannot pass by hiding every hint.
function hints(page, trigger = '#btn-hero-done') {
  return page.evaluate((selector) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left),
        right: Math.round(rect.right) };
    };
    const node = document.querySelector('#done-result');
    const result = node?.getClientRects().length ? box(node) : null;
    const tips = [...document.querySelectorAll('.visual-tooltip')]
      .filter((tip) => !tip.hidden && tip.getClientRects().length)
      .map((tip) => ({ id: tip.id, side: tip.dataset.side, text: tip.textContent, box: box(tip) }));
    const anchor = document.querySelector(selector);
    return {
      text: node?.querySelector('.grow')?.textContent ?? null, result, tips,
      covered: !!result && tips.some(({ box: tip }) => tip.left < result.right && result.left < tip.right
        && tip.top < result.bottom && result.top < tip.bottom),
      anchor: anchor.getClientRects().length ? box(anchor) : null,
    };
  }, trigger);
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

// The control 12px from the top of the window, where its hint has no room above it. Read sits
// beside Done when wide and above it when narrow, so each is put there in turn.
async function toTop(page, selector) {
  await page.$eval(selector, (control) => scrollBy(0, control.getBoundingClientRect().top - 12));
  await settle(page);
}

// A hint raised as a reader raises it, by keyboard focus or by pointer, from a start with neither.
async function raise(page, selector, how) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement?.blur());
  if (how === 'focus') await page.focus(selector);
  else await page.hover(selector);
  await settle(page);
}

async function refuseSaves(page) {
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    window.__hintRestoreSet = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Fixture save refused', 'QuotaExceededError');
      return set.call(this, name, value);
    };
  }, KEY);
}

async function heroHints(page, t, width) {
  await full(page);
  await wait(500);
  await toTop(page, '#btn-hero-done');
  await raise(page, '#btn-hero-done', 'focus');
  const clear = await hints(page);
  t.check(`${width}px: with nothing to keep clear, Done's hint at the top of the window shows below Done as before`,
    clear.result === null && clear.anchor?.top <= 20
    && clear.tips.some((tip) => tip.id === 'action-tip' && tip.side === 'bottom'), JSON.stringify(clear));

  // Each pass starts wherever the last left the list, so Done is followed by the hero changing
  // rather than by a particular comic.
  const heroChanges = async (action) => {
    const before = await page.$eval('#hero-title', (node) => node.textContent);
    await action();
    await page.waitForFunction((was) => document.querySelector('#hero-title').textContent !== was, {}, before);
  };
  const rows = [];
  for (const phase of ['offer', 'confirmation', 'Try again']) {
    if (phase === 'offer') {
      await heroChanges(() => press(page, '#btn-hero-done'));
    } else if (phase === 'confirmation') {
      await heroChanges(() => press(page, '#done-result button'));
    } else {
      await heroChanges(() => press(page, '#btn-hero-done'));
      await page.waitForSelector('#done-result button');
      await refuseSaves(page);
      await press(page, '#done-result button');
      await page.waitForFunction(() => document.querySelector('#done-result button')?.textContent === 'Try again');
      await page.evaluate(() => window.__hintRestoreSet());
    }
    await page.waitForSelector('#done-result');
    for (const selector of ['#btn-hero-done', '#btn-hero-read']) {
      for (const how of ['focus', 'pointer']) {
        await toTop(page, selector);
        await raise(page, selector, how);
        rows.push({ phase, trigger: selector, how, ...(await hints(page, selector)) });
      }
    }
  }
  const wrong = rows.filter((row) => !row.result || !(row.anchor?.top <= 20) || row.covered);
  t.check(`${width}px: no hint raised by focus or pointer on Done or Read covers the offer, the confirmation after Undo, or Try again after a refused save`,
    rows.length === 12 && wrong.length === 0, JSON.stringify(wrong.length ? wrong : rows));

  await page.evaluate(() => scrollTo(0, 0));
  await raise(page, '#btn-hero-done', 'focus');
  const natural = await hints(page);
  const stacked = await page.evaluate(() => document.querySelector('#btn-hero-read').getBoundingClientRect().bottom
    <= document.querySelector('#btn-hero-done').getBoundingClientRect().top);
  if (stacked) {
    // #860: Read sits above Done and the result below it, and a hint may cover neither, so it gives way.
    t.check(`${width}px stacked: with Read above Done and the result below it, Done's hint gives way, no side being clear of both`,
      !!natural.result && !natural.covered && !natural.tips.some((tip) => tip.id === 'action-tip'), JSON.stringify(natural));
  } else {
    t.check(`${width}px: where Done's hint fits clear of the result it still shows, above Done`,
      !!natural.result && !natural.covered && natural.tips.some((tip) => tip.id === 'action-tip' && tip.side === 'top'),
      JSON.stringify(natural));
  }
}

export const doneHint = {
  id: 'done-hint',
  title: 'No visual hint covers Done\'s result, in the reading view or on Home, wide or narrow',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page, 1280);
    await heroHints(page, t, 1280);
    await page.setViewport({ width: 390, height: 900 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-read:not([hidden])');
    await heroHints(page, t, 390);

    await page.setViewport({ width: 1280, height: 700 });
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForSelector('#home-continue:not([hidden]) #btn-chero-done');
    if (await page.$eval('#btn-rail-toggle', (toggle) => toggle.getAttribute('aria-expanded') === 'true')) {
      await click(page, '#btn-rail-toggle');
    }
    await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width < 60);
    await wait(500);
    await press(page, '#btn-chero-done');
    await page.waitForSelector('#done-result button');
    await page.$eval('#done-result', (result) => {
      const item = document.querySelector('#list-nav .ri').getBoundingClientRect();
      const box = result.getBoundingClientRect();
      scrollBy(0, (box.top + box.height / 2) - (item.top + item.height / 2));
    });
    await settle(page);
    await raise(page, '#list-nav .ri', 'pointer');
    const level = await hints(page, '#list-nav .ri');
    await page.evaluate(() => scrollTo(0, 0));
    await settle(page);
    await raise(page, '#list-nav .ri', 'pointer');
    const apart = await hints(page, '#list-nav .ri');
    t.check('on Home, the collapsed rail\'s hint gives way to the result scrolled level with it, and shows once it is not',
      !!level.result && !!level.anchor && level.result.top < level.anchor.bottom && level.anchor.top < level.result.bottom
      && !level.covered && !!apart.result && !apart.covered
      && apart.tips.some((tip) => tip.id === 'rail-tip' && tip.text.startsWith('Continue reading')),
      JSON.stringify({ level, apart }));
    t.check('the checks raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const doneHintMutations = [
  {
    id: 'done-hint-unmarked', breaks: 'done-hint',
    why: 'without the marker the result is not kept clear, so hints take their usual spot over it',
    rewriteReading: (source) => source.replace("dataset: { keepUncovered: '' },", ''),
  },
];

// #860: stacked on a narrow screen, Read's hint and Done's each landed over the other button. A hint
// takes pointer events so that it stays hoverable, so the covered strip answered clicks with the hint.
// Measured on main on 2026-10-25: at its natural place Done's hint covered a third of Read at 390 and
// 640px, and with Read near the top of the window Read's hint covered the top of Done. The pair is one
// hint group now, so a hint moves to a side clear of the other button or gives way.
const READ = '#btn-hero-read';
const DONE = '#btn-hero-done';

// A fresh copy of the fixture with the full list open, so the page is tall enough to bring either
// button near the top of the window. A reload restores the scroll position, so it starts at the top.
async function fresh(page) {
  await page.evaluate((key) => localStorage.removeItem(key), KEY);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#view-read:not([hidden]) #btn-hero-done');
  await full(page);
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
}

// Where the hints are, and every point of the other button a pointer could reach, 3px apart. A point
// answered by a hint is a click the hint would take.
function pairHints(page, trigger, other) {
  return page.evaluate((triggerSelector, otherSelector) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    };
    const tips = [...document.querySelectorAll('.visual-tooltip')]
      .filter((tip) => !tip.hidden && tip.getClientRects().length)
      .map((tip) => ({ id: tip.id, side: tip.dataset.side, ariaHidden: tip.getAttribute('aria-hidden'), box: box(tip) }));
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
      box: box(document.querySelector(triggerSelector)), other: near, tips, points, taken,
      covers: tips.some(({ box: tip }) => tip.left < near.right && near.left < tip.right
        && tip.top < near.bottom && near.top < tip.bottom),
    };
  }, trigger, other);
}

// A real click on the edge of one button nearest the other, where the other's hint used to sit.
async function clickBeside(page, target, from) {
  const point = await page.evaluate((targetSelector, fromSelector) => {
    const near = document.querySelector(targetSelector).getBoundingClientRect();
    const far = document.querySelector(fromSelector).getBoundingClientRect();
    const middle = { x: (near.left + near.right) / 2, y: (near.top + near.bottom) / 2 };
    if (near.bottom <= far.top) return { x: middle.x, y: near.bottom - 3 };
    if (near.top >= far.bottom) return { x: middle.x, y: near.top + 3 };
    return near.right <= far.left ? { x: near.right - 3, y: middle.y } : { x: near.left + 3, y: middle.y };
  }, target, from);
  const under = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('.visual-tooltip')?.id ?? hit?.closest('button')?.id ?? hit?.tagName ?? null;
  }, point);
  await page.mouse.click(point.x, point.y);
  await settle(page);
  return { point, under };
}

export const readDoneHints = {
  id: 'read-done-hints',
  title: 'Neither Read\'s hint nor Done\'s covers the other button or takes a click meant for it',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const name = (selector) => (selector === READ ? 'Read' : 'Done');
    await setup(page, 390);
    for (const width of [390, 640, 1280]) {
      await page.setViewport({ width, height: 900 });
      await fresh(page);
      const rows = [];
      for (const [trigger, other] of [[READ, DONE], [DONE, READ]]) {
        for (const position of ['natural', 'top']) {
          for (const how of ['focus', 'pointer']) {
            await page.evaluate(() => scrollTo(0, 0));
            await settle(page);
            if (position === 'top') await toTop(page, trigger);
            await raise(page, trigger, how);
            rows.push({ step: `${name(trigger)} ${position} ${how}`, ...(await pairHints(page, trigger, other)) });
          }
        }
      }
      const wrong = rows.filter((row) => row.covers || row.taken > 0
        || (row.step.includes(' top ') && !(row.box.top <= 20)) || (row.step.includes(' natural ') && row.points === 0));
      t.check(`${width}px: no hint raised by focus or pointer on Read or Done, at its natural place or near the top, covers the other button or answers a point of it`,
        rows.length === 8 && wrong.length === 0, JSON.stringify(wrong.length ? wrong : rows));

      const stacked = rows[0].box.bottom <= rows[0].other.top;
      const expected = stacked
        ? { 'Read natural': 'top', 'Read top': 'none', 'Done natural': 'bottom', 'Done top': 'bottom' }
        : { 'Read natural': 'top', 'Read top': 'bottom', 'Done natural': 'top', 'Done top': 'bottom' };
      const sides = rows.map((row) => [row.step, row.tips.find((tip) => tip.id === 'action-tip')?.side ?? 'none']);
      t.check(stacked
        ? `${width}px stacked: Done's hint shows below Done and Read's above Read, and near the top Read's gives way, its only room being over Done`
        : `${width}px side by side: each hint keeps the place it had`,
      sides.every(([step, side]) => expected[step.replace(/ (focus|pointer)$/, '')] === side), JSON.stringify(sides));

      if (width === 390) {
        await fresh(page);
        await page.mouse.move(1, 1);
        await page.hover(DONE);
        await settle(page);
        const moved = await pairHints(page, DONE, READ);
        const tip = moved.tips.find((item) => item.id === 'action-tip');
        const visible = () => page.$eval('#action-tip', (node) => !node.hidden);
        let gap = false;
        let over = false;
        if (tip) {
          await page.mouse.move((moved.box.left + moved.box.right) / 2, (moved.box.bottom + tip.box.top) / 2, { steps: 12 });
          await settle(page);
          gap = await visible();
          await page.mouse.move((tip.box.left + tip.box.right) / 2, (tip.box.top + tip.box.bottom) / 2, { steps: 12 });
          await settle(page);
          over = await visible();
        }
        await raise(page, DONE, 'focus');
        await page.keyboard.press('Escape');
        await settle(page);
        const after = await page.evaluate(() => ({
          hidden: document.querySelector('#action-tip').hidden, focus: document.activeElement?.id,
          described: document.querySelector('#btn-hero-done').getAttribute('aria-describedby'),
        }));
        t.check('390px: the hint moved below Done stays visual only, holds through the gap and onto itself, and Escape dismisses it with focus kept on Done',
          tip?.side === 'bottom' && tip.ariaHidden === 'true' && gap && over
          && after.hidden && after.focus === 'btn-hero-done' && after.described === 'hero-done-help',
          JSON.stringify({ tip, gap, over, after }));
      }

      const clicks = [];
      for (const how of ['focus', 'pointer']) {
        await fresh(page);
        await raise(page, DONE, how);
        const shown = (await pairHints(page, DONE, READ)).tips.map((item) => item.side);
        const opened = await page.evaluate(() => window.__undoOpened?.length ?? 0);
        const onRead = await clickBeside(page, READ, DONE);
        clicks.push({ step: `Read, with Done's hint raised by ${how}`, shown, ...onRead,
          landed: await page.evaluate(() => window.__undoOpened?.length ?? 0) === opened + 1 });
        await fresh(page);
        await toTop(page, READ);
        await raise(page, READ, how);
        const before = await page.$eval('#hero-title', (node) => node.textContent);
        const onDone = await clickBeside(page, DONE, READ);
        clicks.push({ step: `Done, with Read near the top and its hint raised by ${how}`, ...onDone,
          landed: await page.$eval('#hero-title', (node) => node.textContent) !== before });
      }
      t.check(`${width}px: a click on the edge of either button nearest the other lands on it once the other has raised its hint, by focus or pointer`,
        clicks.every((row) => row.landed && row.under !== 'action-tip')
        && clicks.filter((row) => row.step.startsWith('Read')).every((row) => row.shown.length === 1),
        JSON.stringify(clicks));
    }
    t.check('the checks raise no page errors', errors.length === 0, errors.join(' / '));
  },
};

export const readDoneHintsMutations = [
  {
    id: 'read-done-hints-ungrouped', breaks: 'read-done-hints',
    why: 'without the group each hint takes its usual spot, over the other button where they are stacked',
    rewriteReading: (source) => source.replace(
      "    $('#btn-hero-read').addEventListener('click', (e) => {",
      "    $('#hero-primary-actions').removeAttribute('data-tooltip-group');\n    $('#btn-hero-read').addEventListener('click', (e) => {",
    ),
  },
];
