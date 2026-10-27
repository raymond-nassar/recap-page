import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOOT_HEIGHT, HEAD_HEIGHT, holdDialogEdges } from '../src/js/lib/dialogShell.js';

// #830: every dialog that asks or shows something wears one shell. The `dialog-shell` browser owner
// measures what the shell does in a real page. These pin the markup and the stylesheet it rests on,
// so a dialog added or rewritten without its held answers fails here before it reaches a browser.
const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
const EXPORT = readFileSync(new URL('../src/js/views/markdown-export.js', import.meta.url), 'utf8');

function dialogMarkup(id) {
  const start = HTML.indexOf(`<dialog id="${id}"`);
  assert.ok(start >= 0, `${id} is in the page`);
  return HTML.slice(start, HTML.indexOf('</dialog>', start));
}

const held = (markup, edge) => markup.match(new RegExp(`class="[^"]*\\bdialog-${edge}\\b`, 'g'))?.length ?? 0;

test('every shell dialog wears the shell and holds one row of answers', () => {
  for (const id of ['preview', 'ask', 'issue-rating-dialog', 'list-feedback']) {
    const markup = dialogMarkup(id);
    assert.match(markup, /^<dialog [^>]*class="(?:ask|preview)\b/, `${id} wears the shell`);
    assert.equal(held(markup, 'foot'), 1, `${id} holds one row of answers`);
    // Only Preview keeps a control in its head: its only Close.
    assert.equal(held(markup, 'head'), id === 'preview' ? 1 : 0, `${id} holds its head only where its Close is`);
  }
  assert.match(dialogMarkup('preview'), /<div class="preview-head dialog-head">[\s\S]*?<button [^>]*id="preview-close"/);
  // List feedback's Close stood alone after its link, so nothing held it in view.
  assert.match(dialogMarkup('list-feedback'), /<div class="ask-foot dialog-foot"><button [^>]*id="list-feedback-close"/);
  assert.match(MAIN, /for \(const dialog of document\.querySelectorAll\('dialog\.ask, dialog\.preview'\)\) holdDialogEdges\(dialog\);/);
  // The export is built when it is asked for and removed when it closes, so it measures its own foot.
  assert.match(EXPORT, /dialog\.className = 'ask markdown-export';/);
  assert.equal(held(EXPORT, 'foot'), 1, 'the export holds one row of answers');
  assert.match(EXPORT, /const footObserver = holdDialogEdges\(dialog\);/);
  assert.equal(EXPORT.match(/footObserver\?\.disconnect\(\);/g)?.length, 2, 'the export stops measuring on close and on a failed open');
});

// Preview's foot is held while its list scrolls, so it holds the dialog's actions and nothing else.
// Measured at 360x800 with the offline status and the metadata credit held too, it was 311px tall.
test('Preview holds only its actions, with its notes just above them', () => {
  const preview = dialogMarkup('preview');
  assert.match(preview, /<div class="preview-notes">\s*<div id="preview-offline-status"><\/div>\s*<span class="grow"><\/span>\s*<span class="rail-hint">Marvel metadata via marvel\.emreparker\.com\.<\/span>\s*<\/div>\s*<div class="preview-foot dialog-foot">\s*<div id="preview-add"><\/div>\s*<div id="preview-offline" class="preview-offline"><\/div>\s*<\/div>\s*$/);
  assert.match(MAIN, /offlineStatus: \$\('#preview-offline-status'\),/);
});

// What keeps an answer in view while a long dialog scrolls is the held foot, and what keeps Preview's
// Close in view is its held head. Their offsets are the dialog's padding and a question's paragraph
// spacing, so all of them are pinned together: moving one without the others shows a strip of
// scrolling text beyond a held edge, or shifts what is held in a dialog that fits (#849).
test('the held edges reach the dialog sides by exactly the dialog padding', () => {
  const shell = CSS.match(/\n\.ask, \.preview \{([^}]*)\}/)?.[1] ?? '';
  assert.match(shell, /max-height: calc\(100dvh - 2rem\); overflow-y: auto; overscroll-behavior: contain;/);
  assert.ok(shell.includes(`scroll-padding-top: calc(var(${HEAD_HEIGHT}, 0px) + var(--space-4));`)
    && shell.includes(`scroll-padding-bottom: calc(var(${FOOT_HEIGHT}, 0px) + var(--space-4));`),
  'the dialog pads its scroll by the heights the script keeps current');
  assert.match(shell, /border-radius: var\(--radius-xl\); padding: var\(--space-7\) var\(--space-8\);/);
  const head = CSS.match(/\n\.dialog-head \{([^}]*)\}/)?.[1] ?? '';
  assert.match(head, /position: sticky; top: calc\(-1 \* var\(--space-7\)\); background: var\(--card\);/);
  assert.match(head, /margin-inline: calc\(-1 \* var\(--space-8\)\); margin-top: calc\(-1 \* var\(--space-7\)\);/);
  assert.match(head, /padding-inline: var\(--space-8\); padding-top: var\(--space-7\);/);
  const foot = CSS.match(/\n\.dialog-foot \{([^}]*)\}/)?.[1] ?? '';
  assert.match(foot, /position: sticky; bottom: calc\(-1 \* var\(--space-7\)\); background: var\(--card\);/);
  assert.match(foot, /margin-inline: calc\(-1 \* var\(--space-8\)\); margin-bottom: calc\(-1 \* var\(--space-7\)\);/);
  assert.match(foot, /padding-inline: var\(--space-8\); padding-bottom: var\(--space-7\);/);
  assert.match(CSS, /\n\.ask \.dialog-foot \{ margin-top: calc\(-1 \* var\(--space-6\)\); padding-top: var\(--space-6\); \}/);
  assert.match(CSS, /\n\.ask p \{ margin: 0 0 var\(--space-6\);/);
  assert.match(CSS, /@media \(max-width: 420px\) \{\s*:is\(\.ask, \.preview\) \{ padding-inline: var\(--space-7\); \}\s*:is\(\.dialog-head, \.dialog-foot\) \{ margin-inline: calc\(-1 \* var\(--space-7\)\); padding-inline: var\(--space-7\); \}\s*\}/);
  // At 800x360 with doubled text the answers took two rows of a 480px dialog and hid the first line.
  assert.match(CSS, /@media \(max-height: 480px\) and \(min-width: 560px\) \{\s*\.ask \{ width: min\(40rem, calc\(100vw - 2rem\)\); \}\s*\}/);
});

test('one scrim, the dialog is the one scroller, and a field keeps its plain answers', () => {
  const scrims = (CSS.match(/[^\n{}]*::backdrop \{/g) ?? []).map((rule) => rule.trim())
    .filter((rule) => !rule.startsWith('.more-sheet'));
  assert.deepEqual(scrims, [':is(.ask, .preview)::backdrop {'], 'one scrim rule serves every dialog');
  assert.doesNotMatch(CSS, /\n\.(?:rating-dialog|list-feedback) \{[^}]*(?:max-height|overflow-y)/,
    'the rating and the list feedback note no longer scroll inside the dialog');
  // A text or note question focuses its field, which a held foot could cover on a phone with its
  // keyboard up (#849).
  assert.match(CSS, /\n#ask:is\(\[data-question="text"\], \[data-question="note"\]\) \.dialog-foot \{ position: static; margin: 0; padding: 0; \}/);
});

class FakeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    FakeObserver.last = this;
  }

  observe(node) { this.observed.push(node); }
}

function fakeDialog(heights) {
  const props = new Map();
  const edge = (key) => (key in heights ? { getBoundingClientRect: () => ({ height: heights[key] }) } : null);
  const head = edge('head');
  const foot = edge('foot');
  const dialog = {
    querySelector: (selector) => ({ '.dialog-head': head, '.dialog-foot': foot })[selector] ?? null,
    style: { setProperty: (name, value) => props.set(name, value) },
  };
  return { dialog, head, foot, props };
}

test('held edges pad their dialog by their own heights, kept current as they change', () => {
  const heights = { head: 64, foot: 84 };
  const { dialog, head, foot, props } = fakeDialog(heights);
  const observer = holdDialogEdges(dialog, FakeObserver);
  assert.equal(observer, FakeObserver.last);
  assert.deepEqual(observer.observed, [head, foot]);
  observer.callback();
  assert.deepEqual([props.get(HEAD_HEIGHT), props.get(FOOT_HEIGHT)], ['64px', '84px']);
  // Larger text, a title that wraps, or answers wrapped to a second row make an edge taller after it opens.
  heights.head = 96;
  heights.foot = 128.5;
  observer.callback();
  assert.deepEqual([props.get(HEAD_HEIGHT), props.get(FOOT_HEIGHT)], ['96px', '128.5px']);
});

test('a dialog with a foot alone measures only its foot', () => {
  const { dialog, foot, props } = fakeDialog({ foot: 84 });
  const observer = holdDialogEdges(dialog, FakeObserver);
  assert.deepEqual(observer.observed, [foot]);
  observer.callback();
  assert.deepEqual([...props.keys()], [FOOT_HEIGHT]);
});

test('a dialog that holds nothing, or a browser without ResizeObserver, is left alone', () => {
  const { dialog: bare, props } = fakeDialog({});
  assert.equal(holdDialogEdges(bare, FakeObserver), null);
  assert.equal(holdDialogEdges(null, FakeObserver), null);
  assert.equal(holdDialogEdges(fakeDialog({ foot: 84 }).dialog, null), null);
  assert.equal(props.size, 0);
});
