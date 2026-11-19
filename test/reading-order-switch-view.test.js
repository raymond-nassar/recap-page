import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingOrderSwitch } from '../src/js/views/reading-order-switch.js';
import { bookOrderOf, READING_ORDER_CHOICES } from '../src/js/lib/readingOrderChoices.js';
import { readingOrderArrangement } from '../src/js/lib/listCorrection.js';

const [choice] = READING_ORDER_CHOICES;
const settle = () => new Promise((resolve) => setImmediate(resolve));

function node(id, extra = {}) {
  return {
    id, hidden: false, disabled: false, textContent: '', attributes: {}, events: {}, dataset: {}, ...extra,
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(name, callback) { this.events[name] = callback; },
    contains(other) { return other === this || (this.children ?? []).includes(other); },
    focus() { globalThis.document.activeElement = this; },
    click() { this.events.click?.(); },
  };
}

function fixture({ read = [], itemIds = choice.issueOrder, catalogId = choice.catalogId, answer = true, save } = {}) {
  const issue = node('reading-order-issue', { dataset: { order: 'issue' } });
  const book = node('reading-order-book', { dataset: { order: 'book' } });
  const nodes = {
    'reading-order': node('reading-order', { children: [issue, book] }),
    'reading-order-issue': issue,
    'reading-order-book': book,
    'reading-order-hint': node('reading-order-hint'),
    'reading-order-status': node('reading-order-status'),
    'order-name': node('order-name'),
  };
  globalThis.document = { activeElement: null };
  const issues = Object.fromEntries(choice.issueOrder.map((id) => [id, { issueId: id, title: `Comic ${id}` }]));
  let state = {
    lists: { wotr: { id: 'wotr', catalogId, itemIds: [...itemIds], collectedIn: {}, deferredIssueIds: [] } },
    issues, read: Object.fromEntries(read.map((id) => [id, 1])), notes: {}, ratings: {},
  };
  let writable = true;
  let questions = [];
  let respond = () => answer;
  const saves = [];
  const view = createReadingOrderSwitch({
    $: (selector) => nodes[selector.replace(/^#/, '')],
    getState: () => state, activeListId: () => 'wotr', isCurrent: () => true,
    canSave: () => writable, getDatasetEpoch: () => 0,
    askConfirm: async (options) => { questions.push(options); return respond(options); },
    saveSwitch: (id, signature, order) => {
      saves.push({ id, signature, order });
      if (save) return save();
      const list = state.lists[id];
      state = { ...state, lists: { ...state.lists, [id]: readingOrderArrangement(list, choice, order) } };
      view.render();
      return { ok: true, changed: true };
    },
  });
  view.wire();
  view.render();
  return {
    nodes, view, saves, questions: () => questions,
    state: () => state, setState: (next) => { state = next; view.render(); },
    setWritable: (value) => { writable = value; view.render(); },
    respondWith: (fn) => { respond = fn; questions = []; },
  };
}

test('the switch shows only on a list with both orders and marks the order the list is in', () => {
  try {
    const plain = fixture({ catalogId: 'house-of-m' });
    assert.equal(plain.nodes['reading-order'].hidden, true);
    const f = fixture();
    assert.equal(f.nodes['reading-order'].hidden, false);
    assert.equal(f.nodes['reading-order-issue'].attributes['aria-pressed'], 'true');
    assert.equal(f.nodes['reading-order-book'].attributes['aria-pressed'], 'false');
    assert.equal(f.nodes['reading-order-hint'].textContent,
      'Every comic in the order it happens in the story. Switching keeps everything you have read, your notes and your ratings.');
    f.setWritable(false);
    assert.equal(f.nodes['reading-order-book'].disabled, true);
  } finally { delete globalThis.document; }
});

test('a switch that leaves the next comic in place saves without asking', async () => {
  try {
    const f = fixture({ read: choice.issueOrder.filter((id) => id !== 71271) });
    f.nodes['reading-order-book'].click();
    await settle();
    assert.equal(f.questions().length, 0);
    assert.deepEqual(f.saves.map(({ order }) => order), ['book']);
    assert.deepEqual(f.state().lists.wotr.itemIds, bookOrderOf(choice));
    assert.equal(f.nodes['reading-order-book'].attributes['aria-pressed'], 'true');
    assert.equal(f.nodes['reading-order-status'].textContent, 'Your list is now book by book.');
  } finally { delete globalThis.document; }
});

test('a switch that moves the next comic asks first, and saves nothing when declined', async () => {
  try {
    const f = fixture({ answer: false });
    f.nodes['reading-order-book'].click();
    await settle();
    assert.equal(f.questions().length, 1);
    assert.equal(f.questions()[0].title, 'Switch to book by book?');
    assert.equal(f.questions()[0].body,
      'Your next comic changes from Comic 69970 to Comic 71271. Switching keeps everything you have read, your notes and your ratings.');
    assert.equal(f.saves.length, 0);
    assert.deepEqual(f.state().lists.wotr.itemIds, choice.issueOrder);
  } finally { delete globalThis.document; }
});

test('a list the reader arranged themselves asks before it is put back in order', async () => {
  try {
    const ids = [...choice.issueOrder];
    [ids[3], ids[4]] = [ids[4], ids[3]];
    const f = fixture({ itemIds: ids, read: choice.issueOrder.filter((id) => id !== 69970) });
    assert.equal(f.nodes['reading-order-issue'].attributes['aria-pressed'], 'false');
    assert.equal(f.nodes['reading-order-book'].attributes['aria-pressed'], 'false');
    f.nodes['reading-order-issue'].click();
    await settle();
    assert.match(f.questions()[0].body, /^You arranged this list yourself\. Switching puts every comic in issue by issue order\./);
    assert.deepEqual(f.state().lists.wotr.itemIds, choice.issueOrder);
  } finally { delete globalThis.document; }
});

test('a list that changes while the question is open is not switched', async () => {
  try {
    const f = fixture();
    let release;
    f.respondWith(() => new Promise((resolve) => { release = resolve; }));
    f.nodes['reading-order-book'].click();
    await settle();
    const list = f.state().lists.wotr;
    f.setState({ ...f.state(), lists: { wotr: { ...list, itemIds: list.itemIds.slice(1) } } });
    release(true);
    await settle();
    assert.equal(f.saves.length, 0);
    assert.equal(f.nodes['reading-order-status'].textContent, 'Your list changed. Choose the order again.');
  } finally { delete globalThis.document; }
});

test('a failed save says so and leaves the list as it was', async () => {
  try {
    const f = fixture({
      read: choice.issueOrder.filter((id) => id !== 71271),
      save: () => ({ ok: false, error: 'The update was not saved. Your list is unchanged.' }),
    });
    f.nodes['reading-order-book'].click();
    await settle();
    assert.equal(f.saves.length, 1);
    assert.equal(f.nodes['reading-order-status'].textContent, 'The update was not saved. Your list is unchanged.');
    assert.equal(f.nodes['reading-order-issue'].attributes['aria-pressed'], 'true');
  } finally { delete globalThis.document; }
});
