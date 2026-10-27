import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIssueRatingView } from '../src/js/views/issue-rating.js';
import { createEmptyState, setIssueRating, issueRating } from '../src/js/lib/model.js';

function node(document) {
  let value = '';
  return {
    ownerDocument: document, hidden: false, disabled: false, open: false,
    textContent: '', dataset: {}, attributes: {}, listeners: {},
    get value() { return value; },
    set value(next) { value = String(next); },
    classList: { toggle() {} },
    setAttribute(key, val) { this.attributes[key] = val; },
    addEventListener(key, listener) { this.listeners[key] = listener; },
    focus() { document.activeElement = this; },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); },
  };
}

function harness({ source = 'saved', score = null } = {}) {
  const doc = { activeElement: null };
  const nodes = Object.fromEntries([
    'root', 'trigger', 'label', 'status', 'dialog', 'form', 'comic', 'input',
    'decrease', 'increase', 'save', 'cancel', 'remove', 'error',
  ].map((key) => [key, node(doc)]));
  nodes.stars = Array.from({ length: 5 }, (_value, index) => ({
    ...node(doc), dataset: { rating: String(index + 1) },
  }));
  nodes.radios = Array.from({ length: 10 }, (_value, index) => ({
    ...node(doc), value: String((index + 1) / 2), checked: false,
  }));
  const issue = { issueId: 42, title: 'Comic', seriesName: 'Series', number: '1' };
  const h = { state: createEmptyState(), blocked: false, failure: null, announcements: [], saves: [], nodes, issue, doc };
  if (source === 'saved') h.state.issues[42] = issue;
  if (score !== null) h.state = setIssueRating(h.state, 42, score);
  h.view = createIssueRatingView({
    elements: () => nodes,
    getState: () => h.state,
    isBlocked: () => h.blocked,
    saveRating: (id, value) => {
      h.saves.push([id, value]);
      if (h.failure) return { ok: false, error: h.failure };
      h.state = setIssueRating(h.state, id, value);
      h.view.refresh();
      return { ok: true };
    },
    announce: (message) => h.announcements.push(message),
  });
  h.view.wire();
  h.view.show(issue, { source });
  h.click = (name) => nodes[name].listeners.click();
  h.submit = () => nodes.form.listeners.submit({ preventDefault() {} });
  // What a press on a star's label or an arrow key does: the browser checks one radio of the group,
  // clears the others, and fires change on the one it checked.
  h.choose = (value) => {
    const chosen = nodes.radios.find((radio) => Number(radio.value) === value);
    for (const radio of nodes.radios) radio.checked = radio === chosen;
    chosen.listeners.change();
  };
  h.checked = () => nodes.radios.filter((radio) => radio.checked).map((radio) => radio.value);
  return h;
}

test('Issue rating summary stays compact and opens an initially unselected editor', () => {
  const h = harness();
  assert.equal(h.nodes.label.textContent, 'Rate this issue');
  // #905: the button's words first, then the comic it rates.
  assert.equal(h.nodes.trigger.attributes['aria-label'], 'Rate this issue: Comic');
  h.click('trigger');
  assert.equal(h.nodes.dialog.open, true);
  assert.equal(h.nodes.comic.textContent, 'Comic');
  assert.equal(h.nodes.input.value, '');
  assert.equal(h.nodes.save.disabled, true);
  assert.equal(h.nodes.remove.hidden, true);
  assert.deepEqual(h.saves, []);
});

test('whole-star shortcuts plus half-step controls save only the explicit score', () => {
  const h = harness();
  const read = h.state.read;
  h.click('trigger');
  h.choose(4);
  h.click('decrease');
  assert.equal(h.nodes.input.value, '3.5');
  assert.equal(h.nodes.stars[3].dataset.fill, 'half');
  assert.deepEqual(h.checked(), ['3.5'], 'the stepper moves the checked radio with it');
  assert.deepEqual(h.saves, []);
  h.submit();
  assert.deepEqual(h.saves, [[42, 3.5]]);
  assert.equal(h.nodes.label.textContent, 'Your rating: 3.5/5');
  assert.equal(h.nodes.trigger.attributes['aria-label'], 'Your rating: 3.5/5. Edit rating for Comic.');
  assert.equal(h.nodes.dialog.open, false);
  assert.strictEqual(h.doc.activeElement, h.nodes.trigger);
  assert.strictEqual(h.state.read, read);
  assert.match(h.announcements[0], /saved: 3.5/);
});

test('Cancel and Escape preserve the old score and return focus', () => {
  const h = harness({ score: 4 });
  h.click('trigger');
  h.click('decrease');
  h.click('cancel');
  assert.equal(issueRating(h.state, 42), 4);
  assert.strictEqual(h.doc.activeElement, h.nodes.trigger);
  h.click('trigger');
  h.click('increase');
  h.nodes.dialog.listeners.cancel();
  h.nodes.dialog.close();
  assert.equal(issueRating(h.state, 42), 4);
  assert.deepEqual(h.saves, []);
  assert.strictEqual(h.doc.activeElement, h.nodes.trigger);
});

test('Remove clears to unrated rather than zero and remains separate from cancellation', () => {
  const h = harness({ score: 0.5 });
  h.click('trigger');
  assert.equal(h.nodes.decrease.disabled, true);
  assert.equal(h.nodes.remove.hidden, false);
  h.click('remove');
  assert.equal(h.nodes.label.textContent, 'Rate this issue');
  assert.equal(issueRating(h.state, 42), null);
  assert.deepEqual(h.saves, [[42, null]]);
});

test('failed saves retain the open draft and previous summary without a success announcement', () => {
  const h = harness({ score: 2 });
  h.click('trigger');
  h.click('increase');
  h.failure = 'Saving failed: quota.';
  h.submit();
  assert.equal(h.nodes.dialog.open, true);
  assert.equal(h.nodes.input.value, '2.5');
  assert.equal(h.nodes.label.textContent, 'Your rating: 2/5');
  assert.match(h.nodes.error.textContent, /quota/);
  assert.deepEqual(h.announcements, []);
});

test('rating conflicts withdraw Save and Remove without discarding the draft', () => {
  const h = harness({ score: 2 });
  h.click('trigger');
  h.click('increase');
  h.state = setIssueRating(h.state, 42, 5);
  h.view.refresh();
  assert.equal(h.nodes.input.value, '2.5');
  assert.equal(h.nodes.save.disabled, true);
  assert.equal(h.nodes.remove.disabled, true);
  assert.match(h.nodes.error.textContent, /changed/);
  h.submit();
  assert.deepEqual(h.saves, []);
  assert.equal(issueRating(h.state, 42), 5);
});

test('unrelated progress remains compatible while removed or replaced saved identities invalidate editing', () => {
  const h = harness({ score: 3 });
  h.click('trigger');
  h.state = { ...h.state, read: { 99: 1 } };
  h.view.refresh();
  assert.equal(h.nodes.save.disabled, false);
  h.state = { ...h.state, issues: { 42: { ...h.issue, title: 'Different comic' } } };
  h.view.refresh();
  assert.equal(h.nodes.save.disabled, true);
  assert.equal(h.nodes.trigger.disabled, true);
  const removed = harness();
  removed.click('trigger');
  removed.state.issues = {};
  removed.view.refresh();
  assert.equal(removed.nodes.save.disabled, true);
});

test('blocked data is unavailable, never displayed as an unrated personal choice', () => {
  const h = harness();
  h.blocked = true;
  h.view.refresh();
  h.click('trigger');
  assert.equal(h.nodes.label.textContent, 'Rating unavailable');
  assert.equal(h.nodes.trigger.disabled, true);
  assert.equal(h.nodes.dialog.open, false);
  assert.match(h.nodes.status.textContent, /Backup/);
});

test('navigation closes an obsolete editor without returning focus to a hidden issue', () => {
  const h = harness();
  h.click('trigger');
  const destination = {};
  h.doc.activeElement = destination;
  h.view.leave();
  assert.equal(h.nodes.dialog.open, false);
  assert.equal(h.nodes.root.hidden, true);
  assert.strictEqual(h.doc.activeElement, destination);
  h.submit();
  assert.deepEqual(h.saves, []);
});

test('bundled and API-only comics can be rated without adding a list or issue metadata', () => {
  for (const source of ['bundled', 'api']) {
    const h = harness({ source });
    h.click('trigger');
    h.nodes.input.value = '4.5';
    h.nodes.input.listeners.input();
    h.submit();
    assert.equal(issueRating(h.state, 42), 4.5);
    assert.deepEqual(h.state.issues, {});
    assert.deepEqual(h.state.listOrder, []);
  }
});

test('invalid numeric drafts disable Save and cannot commit through submission', () => {
  const h = harness();
  h.click('trigger');
  for (const value of ['', '0', '3.25', '6', 'no']) {
    h.nodes.input.value = value;
    h.nodes.input.listeners.input();
    assert.equal(h.nodes.save.disabled, true);
    h.submit();
    assert.deepEqual(h.saves, []);
    assert.match(h.nodes.error.textContent, /half-star/);
  }
  h.nodes.input.value = '5';
  h.nodes.input.listeners.input();
  assert.equal(h.nodes.increase.disabled, true);
});

test('UX-26 the checked radio holds the draft value, and the editor opens focused on it', () => {
  const h = harness({ score: 3.5 });
  h.click('trigger');
  assert.deepEqual(h.checked(), ['3.5']);
  assert.strictEqual(h.doc.activeElement, h.nodes.radios[6], 'focus starts on the saved score, so an arrow key moves from it');
  h.choose(4);
  assert.equal(h.nodes.input.value, '4');
  assert.equal(h.nodes.stars[3].dataset.fill, 'full');
  h.click('increase');
  assert.deepEqual(h.checked(), ['4.5']);
  h.nodes.input.value = '3.25';
  h.nodes.input.listeners.input();
  assert.deepEqual(h.checked(), [], 'a typed value off the half-star scale checks no radio');
  h.choose(1);
  assert.equal(h.nodes.input.value, '1');
  h.submit();
  assert.deepEqual(h.saves, [[42, 1]]);
});

test('UX-26 an unrated editor opens on the first radio with none checked, and a stale draft disables every radio', () => {
  const h = harness();
  h.click('trigger');
  assert.deepEqual(h.checked(), []);
  assert.strictEqual(h.doc.activeElement, h.nodes.radios[0]);
  h.choose(2.5);
  assert.equal(h.nodes.input.value, '2.5');
  h.state = setIssueRating(h.state, 42, 5);
  h.view.refresh();
  assert.ok(h.nodes.radios.every((radio) => radio.disabled), 'a stale draft cannot be changed from the stars');
  assert.equal(h.nodes.input.value, '2.5');
});

test('UX-26 the star group is ten native radios from 0.5 to 5, each whole star the label of its own value', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const group = html.match(/<div id="issue-rating-stars" class="rating-stars" role="radiogroup" aria-label="Choose a rating">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group, 'the stars are one named radio group');
  assert.doesNotMatch(group, /<button/);
  const values = Array.from({ length: 10 }, (_value, index) => String((index + 1) / 2));
  const radios = [...group.matchAll(/<input type="radio" class="visually-hidden" name="issue-rating" id="([^"]+)" value="([^"]+)" aria-label="([^"]+)" \/>/g)];
  assert.deepEqual(radios.map((match) => match[2]), values);
  assert.deepEqual(radios.map((match) => match[3]), values.map((value) => (value === '1' ? '1 star' : `${value} stars`)));
  const labels = [...group.matchAll(/<label for="([^"]+)" data-rating="(\d)">/g)];
  assert.deepEqual(labels.map((match) => match[2]), ['1', '2', '3', '4', '5']);
  for (const [, target, rating] of labels) {
    assert.equal(radios.find((match) => match[1] === target)?.[2], rating, `star ${rating} chooses its whole value`);
  }
  // Each star follows its half and whole radios, which is what draws the ring on the star holding focus.
  const sequence = [...group.matchAll(/<(input|label)\b[^>]*?(?:value|data-rating)="([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.deepEqual(sequence, [1, 2, 3, 4, 5].flatMap((star) => [`input ${star - 0.5}`, `input ${star}`, `label ${star}`]));
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.rating-stars input:focus-visible \+ label, \.rating-stars input:focus-visible \+ input \+ label \{ outline: var\(--focus-width\) solid var\(--blue\); outline-offset: var\(--focus-offset\); \}/);
  assert.match(css, /\.rating-stars label \{ width: var\(--target-touch\); height: var\(--target-touch\);/, 'stars keep their 48px targets');
  assert.match(readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8'),
    /stars: document\.querySelectorAll\('#issue-rating-stars label'\),\s*radios: document\.querySelectorAll\('#issue-rating-stars input'\),/);
});
