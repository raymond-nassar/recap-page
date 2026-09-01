// A notice the reader cannot close.
//
// The undo offered after a list is deleted is held for the whole session on purpose: a timer would
// take the only way back while the reader was still deciding, which is what BL-035 was filed to
// fix. Nothing withdrew it except taking it, though, so the banner and its button sat above every
// view for as long as the tab stayed open. Reported after hours of it, on a delete the reader had
// long since finished with.
//
// These hold the shape of the answer: the reader ends the offer, not a clock. So every message
// raised under that key carries a way out, taking it spends the undo rather than only hiding the
// words, and the way out is spoken as well as drawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { noticeEl, spoken } from '../src/js/main.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'src', 'js', 'views', 'reading.js'), 'utf8');

// Enough of a document for el() to build with, and no more. The repository has no DOM in tests and
// deliberately does not take one on, so the parts el() actually touches are stood up by hand.
function stubDocument() {
  const make = (tag) => ({
    tag,
    className: '',
    textContent: '',
    attrs: {},
    children: [],
    handlers: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    append(child) { this.children.push(child); },
    // Every notice built here is built outside a dialog, which is the case the focus move applies
    // to. querySelector answering null then stops focusViewHeading before it reaches a heading.
    closest: () => null,
  });
  return { createElement: make, createTextNode: (text) => ({ text }), querySelector: () => null };
}

function build(note) {
  globalThis.document = stubDocument();
  try {
    return noticeEl(note);
  } finally {
    delete globalThis.document;
  }
}

const buttons = (p) => p.children.filter((c) => c.tag === 'button');
const labelOf = (b) => b.children.map((c) => c.text ?? '').join('');

const UNDO = { label: 'Undo delete', onClick: () => {} };
const DISMISS = { label: 'Dismiss', onClick: () => {} };

test('a notice offering an undo also offers a way to be finished with it', () => {
  const p = build({ msg: 'Deleted Essential Avengers. Reading progress was kept.', kind: 'ok', action: UNDO, dismiss: DISMISS });
  assert.deepEqual(buttons(p).map(labelOf), ['Undo delete', 'Dismiss']);
});

// The offer comes first. It is what the message is for, and a reader tabbing into the notice to
// take it should not have to pass the control that throws it away to get there.
test('the way out sits after the offer, not in front of it', () => {
  const p = build({ msg: 'Deleted Essential Avengers.', kind: 'ok', action: UNDO, dismiss: DISMISS });
  const [first, second] = buttons(p);
  assert.equal(labelOf(first), 'Undo delete');
  assert.equal(labelOf(second), 'Dismiss');
  assert.match(second.className, /notice-dismiss/);
});

// Two of the four messages under this key report something that has already happened and offer
// nothing to do about it. Those are the ones a reader is most likely to want gone, and they used to
// be the ones with no control at all, so the layout that makes room for a button has to reach them.
test('a message with nothing to offer is still closable, and still laid out for a button', () => {
  const p = build({ msg: 'Essential Avengers is back from the catalog.', kind: 'ok', action: null, dismiss: DISMISS });
  assert.deepEqual(buttons(p).map(labelOf), ['Dismiss']);
  assert.match(p.className, /notice-act/);
});

test('a message with no controls at all is left as a plain notice', () => {
  const p = build({ msg: 'Saved.', kind: 'ok', action: null, dismiss: null });
  assert.equal(buttons(p).length, 0);
  assert.doesNotMatch(p.className, /notice-act/);
});

test('pressing the way out runs the handler it was given', () => {
  let closed = 0;
  const p = build({ msg: 'Deleted Essential Avengers.', kind: 'ok', action: UNDO, dismiss: { label: 'Dismiss', onClick: () => { closed += 1; } } });
  const btn = buttons(p)[1];
  globalThis.document = stubDocument();
  try {
    btn.handlers.click({ currentTarget: btn });
  } finally {
    delete globalThis.document;
  }
  assert.equal(closed, 1);
});

// Dismissing destroys the button that had focus, and a focused node leaving the document drops
// focus to <body> at the top of the page. The landing is the heading of the view being read, except
// inside an open dialog, where the page behind is inert and focus() on it does nothing.
//
// The guard has to be asked before the click, because closing the notice detaches the button and
// closest() on a detached node walks up to null. The stub detaches as the handler runs, which is
// what clearing a notice does, so a guard read in the wrong order answers "not in a dialog" here.
// That is the answer it must never give, and it is the one answer it could give every time.
function pressDismiss({ inDialog }) {
  const aimedAt = [];
  globalThis.document = stubDocument();
  globalThis.document.querySelector = (sel) => { aimedAt.push(sel); return null; };
  try {
    let attached = true;
    const p = noticeEl({
      msg: 'Essential Avengers is back from the catalog.',
      kind: 'ok',
      action: null,
      dismiss: { label: 'Dismiss', onClick: () => { attached = false; } },
    });
    const btn = buttons(p)[0];
    btn.closest = (sel) => (attached && inDialog && sel === 'dialog[open]' ? { tag: 'dialog' } : null);
    btn.handlers.click({ currentTarget: btn });
  } finally {
    delete globalThis.document;
  }
  return aimedAt;
}

test('closing a notice puts the reader on the heading of the view they are looking at', () => {
  assert.deepEqual(pressDismiss({ inDialog: false }), ['#view-read']);
});

test('closing one inside an open dialog leaves focus where the dialog keeps it', () => {
  assert.deepEqual(pressDismiss({ inDialog: true }), []);
});

// A button nobody is told about is a button a screen reader user cannot know to look for, which is
// the argument that put the undo into the spoken message. It reaches the dismiss for the opposite
// reason: this is the one notice that stays until it is closed, so not knowing it can be closed is
// what leaves it read out on every screen for the rest of the session.
test('both controls are spoken, not only the offer', () => {
  const said = spoken('Deleted Essential Avengers. Reading progress was kept.', UNDO, DISMISS);
  assert.match(said, /Undo delete and Dismiss are available\.$/);
});

test('a lone control is spoken in the singular', () => {
  assert.match(spoken('Essential Avengers is back from the catalog.', null, DISMISS), /Dismiss is available\.$/);
  assert.match(spoken('Deleted Essential Avengers.', UNDO, null), /Undo delete is available\.$/);
});

test('a message with nothing to press is spoken as itself', () => {
  assert.equal(spoken('Saved.', null, null), 'Saved.');
});

// Quote-aware, because the calls being measured hold template strings and those hold no parentheses
// today but are prose and may tomorrow. Balancing through a string literal would run a call on into
// the next one and silently measure the wrong text.
function callsTo(text, name) {
  const open = `${name}(`;
  const found = [];
  for (let i = text.indexOf(open); i > -1; i = text.indexOf(open, i + 1)) {
    let depth = 0;
    let quote = null;
    for (let j = i + open.length - 1; j < text.length; j += 1) {
      const ch = text[j];
      if (quote) {
        if (ch === '\\') j += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (!depth) { found.push(text.slice(i, j + 1)); break; }
      }
    }
  }
  return found;
}

// Split a call at its top-level commas, so an object literal or a template string holding one
// cannot be read as an argument boundary. Position is the whole point here: a way out handed to
// the fifth argument still sits last in the call and still reads as "the call mentions it".
function argsOf(call) {
  const inner = call.slice(call.indexOf('(') + 1, -1);
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && !depth) { parts.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

// The defect was never in one message. It was in the key: everything raised under it outlives the
// screen it was raised on, and a fifth message added later with no way out puts the reader back
// where they started. Asserted against the calls rather than against a count, so adding one is what
// turns this red rather than forgetting to update a number.
//
// The argument position is asserted, not merely the name. `dismiss` is the sixth parameter and
// `action` the fifth, so a way out written into the fifth is accepted by the call, sits last in it,
// and is wrong twice over: it draws as the primary control without the class that marks it
// secondary, and it fills the `action` slot placeNotices reads to decide whether a notice may
// follow the reader into an open dialog.
const WAYS_OUT = new Set(['dismissUndoDelete', 'giveUpUndoDelete']);
const wayOutOf = (call) => argsOf(call)[5] ?? '';

test('every message held above the views carries the way out of it', () => {
  const calls = callsTo(source, 'notify').filter((c) => c.includes('UNDO_DELETE'));
  assert.ok(calls.length >= 4, `expected the undo family to raise at least four messages, saw ${calls.length}`);
  const silent = calls.filter((c) => !WAYS_OUT.has(wayOutOf(c)));
  assert.deepEqual(silent, [], `raised with no way to close it, or with one in the wrong argument: ${silent.join(' | ')}`);
});

// A word that promises to clear the screen must not also spend the last copy of a list. The reader
// looking at this message has already pressed Undo, so the buffer behind the retry is the only
// place that list still exists, and closing the message throws it away. Every other message under
// the key reports something already settled, where one word can honestly carry both.
test('the message offering a retry names what its way out costs', () => {
  const [failed] = callsTo(source, 'notify')
    .filter((c) => c.includes('UNDO_DELETE') && c.includes('could not be put back'));
  assert.ok(failed, 'the message raised when a restore fails has moved or gone');
  assert.equal(wayOutOf(failed), 'giveUpUndoDelete', 'a recoverable failure is closed by a word that promises only to close it');

  const control = source.match(/const giveUpUndoDelete = \{[^}]*\}/);
  assert.ok(control, 'the way out of a failed restore has moved or gone');
  assert.doesNotMatch(control[0], /label: 'Dismiss'/, 'the two ways out are named the same and cannot be told apart');
  assert.match(control[0], /onClick: forgetDeleted\b/, 'giving up leaves the deleted list buffered behind it');
});

// Hiding the words while the buffer lives on is the failure mode that looks fixed. The offer would
// be gone from the screen and still be taken by anything that consults it, so putting the same
// order back from the catalog would raise a message about a deletion the reader had already closed.
test('closing the message spends the undo rather than hiding it', () => {
  const handler = source.match(/const dismissUndoDelete = \{[^}]*\}/);
  assert.ok(handler, 'the shared way out of the undo family has moved or gone');
  assert.match(handler[0], /onClick: forgetDeleted\b/, 'closing the message leaves the deleted list buffered behind it');

  const forget = source.slice(source.indexOf('function forgetDeleted()'));
  const body = forget.slice(0, forget.indexOf('\n}'));
  assert.match(body, /lastDeleted = null/, 'the buffer survives the dismiss');
  assert.match(body, /clearNotice\(UNDO_DELETE\)/, 'the notice survives the dismiss');
});
