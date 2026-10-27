// #830: what every dialog in the shared shell owes a reader, measured in the page, so the desktop check
// and the Android build's check hold the dialogs to one contract. Each function below that runs in the
// page is serialised into it by puppeteer, so it is self-contained.
//
// A shell dialog opens at its start, with its title in view and clear of what is held. It is the one
// thing in it that scrolls. Its answers are held in view at its foot, Preview's head with its only Close
// is held at its top, and every control between them is scrolled clear of them when it takes focus
// rather than under them (WCAG 2.4.11). Scrolled to its end, the last of its content sits above the
// answers rather than behind them, and a held head is still in view.

// The edges a dialog can hold, each found by its own component class as well as by the shell's, so a
// dialog without the shell is measured by what its edges do rather than missed.
export const EDGES = {
  head: '.dialog-head, .preview-head',
  foot: '.dialog-foot, .ask-foot, .preview-foot, .rating-footer',
};

// The dialog's state as it stands: what is visible, what has focus and what scrolls.
export function shellState(selector, edges) {
  const dialog = document.querySelector(selector);
  if (!dialog?.open) return { open: false };
  const box = dialog.getBoundingClientRect();
  const port = {
    top: Math.max(0, box.top + dialog.clientTop),
    left: Math.max(0, box.left + dialog.clientLeft),
    bottom: Math.min(innerHeight, box.top + dialog.clientTop + dialog.clientHeight),
    right: Math.min(innerWidth, box.left + dialog.clientLeft + dialog.clientWidth),
  };
  const sticky = (node) => !!node && getComputedStyle(node).position === 'sticky';
  const head = dialog.querySelector(edges.head);
  const foot = dialog.querySelector(edges.foot);
  const headBox = head?.getBoundingClientRect() ?? null;
  const footBox = foot?.getBoundingClientRect() ?? null;
  const headHeld = sticky(head);
  const held = sticky(foot);
  const top = headHeld ? Math.max(port.top, headBox.bottom) : port.top;
  const limit = held ? Math.min(port.bottom, footBox.top) : port.bottom;
  const shown = (node) => node.getClientRects().length > 0 && !node.closest('[hidden]');
  const within = (rect, upper, lower) => rect.height > 0 && rect.width > 0 && rect.top >= upper - 0.5
    && rect.bottom <= lower + 0.5 && rect.left >= port.left - 0.5 && rect.right <= port.right + 0.5;
  const clear = (rect) => within(rect, top, limit);
  const reachable = (node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && (hit === node || node.contains(hit));
  };
  const name = (node) => node.id || node.getAttribute('aria-label') || node.textContent.trim().slice(0, 40);
  const controls = (edge) => (edge ? [...edge.querySelectorAll('button, a[href]')].filter(shown)
    .map((node) => ({ name: name(node), reachable: reachable(node) })) : []);
  const focused = document.activeElement;
  const inDialog = !!focused && focused !== dialog && dialog.contains(focused);
  const inEdge = inDialog && (!!foot?.contains(focused) || (headHeld && head.contains(focused)));
  const title = dialog.querySelector('h2');
  // A title in a held head is clear of what scrolls by being held, so it need only be in view.
  const titleClear = !!title && shown(title) && (headHeld && head.contains(title)
    ? within(title.getBoundingClientRect(), port.top, limit) : clear(title.getBoundingClientRect()));
  const scrollers = [...dialog.querySelectorAll('*')].filter((node) => {
    if (node.matches('textarea, input, select')) return false;
    const style = getComputedStyle(node);
    return /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
  }).map(name);
  const style = getComputedStyle(dialog);
  return {
    open: true,
    viewport: [innerWidth, innerHeight],
    scrollTop: Math.round(dialog.scrollTop),
    overflows: dialog.scrollHeight > dialog.clientHeight + 1,
    held,
    footHeight: footBox ? Math.round(footBox.height) : null,
    padsFoot: foot ? parseFloat(style.scrollPaddingBottom) >= footBox.height - 0.5 : null,
    headHeld,
    headHeight: headBox ? Math.round(headBox.height) : null,
    padsHead: head ? parseFloat(style.scrollPaddingTop) >= headBox.height - 0.5 : null,
    title: titleClear,
    focus: {
      name: inDialog ? name(focused) : focused?.tagName,
      inDialog,
      inEdge,
      clear: inDialog && reachable(focused) && (inEdge || clear(focused.getBoundingClientRect())),
    },
    answers: controls(foot),
    headControls: controls(head),
    scrollers,
    surface: {
      background: style.backgroundColor,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      radius: style.borderTopLeftRadius,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
      backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
    },
  };
}

// Scrolled to its end, whether the last of the dialog's content sits above its answers, and whether a
// head that is held is still in view with its controls reachable. The dialog is put back where it was.
export function shellEnd(selector, edges) {
  const dialog = document.querySelector(selector);
  const before = dialog.scrollTop;
  dialog.scrollTop = dialog.scrollHeight;
  const head = dialog.querySelector(edges.head);
  const foot = dialog.querySelector(edges.foot);
  const box = dialog.getBoundingClientRect();
  const portTop = Math.max(0, box.top + dialog.clientTop);
  const portBottom = Math.min(innerHeight, box.top + dialog.clientTop + dialog.clientHeight);
  const limit = foot && getComputedStyle(foot).position === 'sticky' ? foot.getBoundingClientRect().top : portBottom;
  let last = null;
  const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || foot?.contains(node) || node.parentElement.closest('[hidden]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (rects.length) last = { text: node.textContent.trim().slice(-40), bottom: rects.at(-1).bottom };
  }
  const headBox = head?.getBoundingClientRect();
  const reachable = (node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && (hit === node || node.contains(hit));
  };
  const result = {
    last, limit, readable: !!last && last.bottom <= limit + 0.5, scrolled: Math.round(dialog.scrollTop),
    head: head ? headBox.top >= portTop - 0.5 && headBox.bottom <= portBottom + 0.5
      && [...head.querySelectorAll('button, a[href]')].every(reachable) : null,
  };
  dialog.scrollTop = before;
  return result;
}

// One step of a Tab walk: the focused control, and whether it is shown clear of what the dialog holds.
export function shellFocusStep(selector, edges) {
  const dialog = document.querySelector(selector);
  const focused = document.activeElement;
  const inDialog = !!dialog && !!focused && focused !== dialog && dialog.contains(focused);
  if (!inDialog) return { inDialog: false, name: focused?.tagName ?? null };
  const sticky = (node) => !!node && getComputedStyle(node).position === 'sticky';
  const head = dialog.querySelector(edges.head);
  const foot = dialog.querySelector(edges.foot);
  const box = dialog.getBoundingClientRect();
  const portTop = Math.max(0, box.top + dialog.clientTop);
  const portBottom = Math.min(innerHeight, box.top + dialog.clientTop + dialog.clientHeight);
  const top = sticky(head) ? Math.max(portTop, head.getBoundingClientRect().bottom) : portTop;
  const limit = sticky(foot) ? Math.min(portBottom, foot.getBoundingClientRect().top) : portBottom;
  const rect = focused.getBoundingClientRect();
  // A text field shows where typing goes: browsers reveal its caret on focus, not its whole box, so its
  // first lines are what must be clear. Every other control must be clear whole.
  const field = focused.matches('textarea, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"])');
  const line = Number.parseFloat(getComputedStyle(focused).lineHeight) || 20;
  const end = field ? rect.top + Math.min(rect.height, 2 * line) : rect.bottom;
  const probe = field ? rect.top + Math.min(rect.height, line) / 2 : rect.top + rect.height / 2;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, probe);
  const inEdge = !!foot?.contains(focused) || (sticky(head) && head.contains(focused));
  const path = [];
  for (let node = focused; node && node !== dialog; node = node.parentElement) {
    path.unshift(`${node.tagName}${node.id ? `#${node.id}` : ''}:${[...node.parentElement.children].indexOf(node)}`);
  }
  return {
    inDialog: true,
    key: path.join('>'),
    name: focused.id || focused.getAttribute('aria-label') || focused.textContent.trim().slice(0, 40),
    inEdge,
    clear: !!hit && (hit === focused || focused.contains(hit)) && (inEdge
      || (rect.top >= top - 0.5 && end <= limit + 0.5)),
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    limits: [Math.round(top), Math.round(limit)],
  };
}

// Tabs through a dialog from where focus stands, until focus leaves it or comes back round, and
// returns each stop. A bounded walk is enough: a long list repeats the same kind of stop.
export async function walkShellFocus(page, selector, max = 40) {
  const stops = [];
  for (let step = 0; step < max; step += 1) {
    const stop = await page.evaluate(shellFocusStep, selector, EDGES);
    if (!stop.inDialog || stops.some((seen) => seen.key === stop.key)) break;
    stops.push(stop);
    await page.keyboard.press('Tab');
  }
  return stops;
}

// Focuses the last control above the dialog's answers, and says whether there was one.
export function focusLastAboveAnswers(selector, edges) {
  const dialog = document.querySelector(selector);
  const foot = dialog.querySelector(edges.foot);
  const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea')]
    .filter((control) => !control.disabled && control.getClientRects().length && !control.closest('[hidden]')
      && !foot?.contains(control));
  controls.at(-1)?.focus();
  return controls.length > 0;
}

// Measures an open dialog: its state as it opened, its end, a Tab walk from its first focus, then the
// last control above its answers and the step from it into them, which a long list reaches only after
// more stops than the walk takes.
export async function measureShellDialog(page, selector) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await page.evaluate(shellState, selector, EDGES);
  const end = await page.evaluate(shellEnd, selector, EDGES);
  const walk = await walkShellFocus(page, selector);
  const tail = [];
  if (await page.evaluate(focusLastAboveAnswers, selector, EDGES)) {
    tail.push(await page.evaluate(shellFocusStep, selector, EDGES));
    await page.keyboard.press('Tab');
    // As in the walk, focus leaving the dialog ends it rather than being a stop.
    const into = await page.evaluate(shellFocusStep, selector, EDGES);
    if (into.inDialog) tail.push(into);
  }
  return { state, end, walk, tail };
}

// Escapes the dialog and waits for its close event, not just its open attribute. The attribute goes first,
// and the app's close handlers settle the question and hand focus back after it: a question asked before
// then is declined, and focus handed back late lands on the last opener, so the next Enter reopens that.
// Waiting on the attribute alone, the next dialog failed to open in three runs of about fifteen.
export async function escapeShellDialog(page, selector) {
  await page.evaluate((target) => {
    window.__shellClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${target} did not close`)), 15000);
      document.querySelector(target).addEventListener('close', () => {
        clearTimeout(timer);
        setTimeout(resolve, 0);
      }, { once: true });
    });
  }, selector);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__shellClosed);
}

// What a measured dialog owes its reader, as [claim, holds, detail] for either harness to record. A
// text or note question keeps its answers plain after its field. Preview, whose only Close is in its
// head, holds that head as well.
export function shellVerdicts({ state, end, walk, tail }, { plain = false, head = false } = {}) {
  const stops = [...walk, ...tail];
  return [
    ['opens at its start, its title clear of what it holds and its focus inside',
      state.open && state.scrollTop === 0 && state.title && state.focus.inDialog && state.focus.clear,
      { ...state, surface: undefined }],
    [plain ? 'keeps its plain answers after its field' : 'holds its answers in view and pads its scroll clear of them',
      (plain ? !state.held : state.held && state.padsFoot)
        && state.answers.length > 0 && state.answers.every((answer) => answer.reachable),
      { held: state.held, padsFoot: state.padsFoot, footHeight: state.footHeight, answers: state.answers }],
    ...(head ? [[
      'holds its head and its Close in view to its end and pads its scroll clear of them',
      state.headHeld && state.padsHead && end.head === true
        && state.headControls.length > 0 && state.headControls.every((control) => control.reachable),
      { headHeld: state.headHeld, padsHead: state.padsHead, headHeight: state.headHeight, atEnd: end.head,
        scrolled: end.scrolled, controls: state.headControls },
    ]] : []),
    ['is the one thing in it that scrolls', state.scrollers.length === 0, state.scrollers],
    ['reads to its end above its answers', end.readable, end],
    ['keeps every control it focuses clear of what it holds',
      walk.length > 1 && stops.every((stop) => stop.inDialog && stop.clear),
      { stops: stops.length, failing: stops.filter((stop) => !stop.inDialog || !stop.clear).slice(0, 3) }],
  ];
}
