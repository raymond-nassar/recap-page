import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeUpdatesView } from '../src/js/views/home-updates.js';
import { createHomeUpdatesSeen, HOME_UPDATES_SEEN_KEY } from '../src/js/lib/homeUpdatesSeen.js';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const catalog = { lists: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Guide ${id}`, file: `actual_${id}.json` })) };
const batch = { id: 50, features: ['Literal <b>benefit</b>', 'Two', 'Three', 'Four'], listIds: ['a', 'b', 'c', 'd'] };
const walk = (root) => [root, ...root.children.flatMap(walk)];

function harness({ content = { version: '1.0.0', batch }, locks = { request: async (_key, fn) => fn() } } = {}) {
  const listeners = () => ({
    listeners: {},
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); },
    async emit(name, event = {}) { for (const fn of this.listeners[name] ?? []) await fn(event); },
  });
  const doc = listeners();
  const host = listeners();
  const calls = { queries: 0, previews: [], focus: 0, current: true, covered: false };
  function node(tag, props = {}, children = []) {
    const value = {
      tag, children, attributes: {}, dataset: {}, textContent: '', hidden: false, open: false, disabled: false,
      ...listeners(),
      setAttribute(name, text) { this.attributes[name] = text; },
      replaceChildren(...next) { this.children = next; },
      focus() { calls.focus += 1; doc.activeElement = this; },
      contains(target) { return walk(this).includes(target); },
    };
    for (const [key, property] of Object.entries(props)) {
      if (key.startsWith('on')) value.addEventListener(key.slice(2), property);
      else if (key === 'text') value.textContent = property;
      else if (key.startsWith('aria-')) value.setAttribute(key, property);
      else value[key] = property;
    }
    return value;
  }
  const nodes = Object.fromEntries(['home', 'details', 'toggle', 'marker', 'content', 'close', 'status', 'retry']
    .map((name) => [name, node(name)]));
  nodes.details.children = [nodes.toggle, nodes.content, nodes.close, nodes.status, nodes.retry];
  const map = new Map([['mrt.state.v2', 'reading bytes'], ['mrt.state.salvage', 'recovery bytes']]);
  const storage = {
    writes: [],
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) { this.writes.push(key); map.set(key, value); },
  };
  const seen = createHomeUpdatesSeen({ storage, locks });
  const setup = { loader: async () => catalog };
  const view = createHomeUpdatesView({
    content, seen, el: node,
    elements: () => { calls.queries += 1; return nodes; },
    events: () => ({ document: doc, window: host }),
    isCurrent: () => calls.current,
    isCovered: () => calls.covered,
    loadCatalog: () => setup.loader(),
    onPreview: (entry) => calls.previews.push({ entry, opener: doc.activeElement }),
  });
  return {
    view, nodes, doc, host, calls, storage, map, setup, seen,
    async open() { nodes.details.open = true; await nodes.details.emit('toggle'); await settle(); },
    button: (id) => walk(nodes.content).find((item) => item.dataset.homeUpdatesList === id),
  };
}

test('construction is lazy and one-time wiring stays closed without acknowledging', () => {
  const h = harness();
  assert.equal(h.calls.queries, 0);
  h.view.wire();
  h.view.wire();
  assert.equal(h.nodes.details.open, false);
  assert.equal(h.nodes.details.listeners.toggle.length, 1);
  assert.equal(h.nodes.marker.hidden, false);
  assert.deepEqual(h.storage.writes, []);
});

test('explicit opening clears New, reports local faults and never acknowledges a null batch', async () => {
  const h = harness();
  h.view.wire();
  await h.open();
  assert.equal(h.nodes.marker.hidden, true);
  assert.equal(h.map.get(HOME_UPDATES_SEEN_KEY), '50');
  assert.equal(h.map.get('mrt.state.v2'), 'reading bytes');
  assert.equal(h.map.get('mrt.state.salvage'), 'recovery bytes');
  const failed = harness({ locks: null });
  failed.view.wire();
  await failed.open();
  assert.equal(failed.nodes.marker.hidden, true);
  assert.match(failed.nodes.status.textContent, /could not be remembered.*may return/);
  assert.equal(failed.map.has(HOME_UPDATES_SEEN_KEY), false);
  const empty = harness({ content: { version: '1.0.0', batch: null } });
  empty.view.wire();
  await empty.open();
  assert.equal(empty.nodes.marker.hidden, true);
  assert.match(walk(empty.nodes.content).map((item) => item.textContent).join(' '), /No new highlights/);
  assert.deepEqual(empty.storage.writes, []);
  const jobs = [];
  const reset = harness({ locks: { request: (_key, fn) => new Promise((resolve) => jobs.push({ fn, resolve })) } });
  reset.view.wire();
  reset.nodes.details.open = true;
  const opening = reset.nodes.details.emit('toggle');
  reset.map.delete(HOME_UPDATES_SEEN_KEY);
  await reset.host.emit('storage', { storageArea: reset.storage, key: HOME_UPDATES_SEEN_KEY });
  assert.equal(reset.nodes.marker.hidden, false);
  const retired = jobs.shift();
  retired.resolve(retired.fn());
  await opening;
  assert.equal(reset.nodes.marker.hidden, false);
  assert.match(reset.nodes.status.textContent, /Close and open again/);
  assert.equal(reset.map.has(HOME_UPDATES_SEEN_KEY), false);
});

test('Close and Escape restore summary focus while outside, navigation and hidden Home do not', async () => {
  const h = harness();
  h.view.wire();
  await h.open();
  await h.nodes.close.emit('click');
  assert.equal(h.nodes.details.open, false);
  assert.equal(h.doc.activeElement, h.nodes.toggle);
  await h.open();
  await h.doc.emit('pointerdown', { target: {} });
  assert.equal(h.nodes.details.open, false);
  assert.equal(h.calls.focus, 1);
  await h.open();
  const event = { key: 'Escape', preventDefault() { this.defaultPrevented = true; } };
  await h.doc.emit('keydown', event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.calls.focus, 2);
  await h.open();
  h.calls.covered = true;
  await h.doc.emit('keydown', { key: 'Escape' });
  assert.equal(h.nodes.details.open, true);
  h.calls.covered = false;
  h.view.close({ restoreFocus: false });
  assert.equal(h.calls.focus, 2);
  await h.open();
  h.nodes.home.hidden = true;
  assert.equal(h.view.close(), false);
  assert.equal(h.calls.focus, 2);
});

test('literal text and native More preserve all rows and expansion when catalog names arrive', async () => {
  const h = harness();
  h.view.wire();
  let resolve;
  h.setup.loader = () => new Promise((done) => { resolve = done; });
  await h.open();
  const sections = h.nodes.content.children.filter((item) => item.tag === 'section');
  assert.equal(sections.length, 2);
  for (const section of sections) {
    assert.equal(section.children[1].children.length, 3);
    assert.equal(section.children[2].tag, 'details');
    assert.equal(section.children[2].children[1].children.length, 1);
    section.children[2].open = true;
  }
  assert.ok(walk(h.nodes.content).some((item) => item.textContent === 'Literal <b>benefit</b>'));
  assert.ok(!walk(h.nodes.content).some((item) => item.tag === 'b'));
  resolve(catalog);
  await settle();
  for (const section of sections) assert.equal(section.children[2].open, true);
  assert.equal(h.button('d').disabled, false);
  assert.equal(h.button('d').attributes['aria-label'], 'Preview: Guide d');
});

test('Preview resolves the exact current catalog descriptor with a visible summary opener and local retry', async () => {
  const h = harness();
  h.view.wire();
  await h.open();
  await h.button('d').emit('click');
  await settle();
  assert.equal(h.calls.previews.length, 1);
  assert.equal(h.calls.previews[0].entry, catalog.lists[3]);
  assert.equal(h.calls.previews[0].entry.file, 'actual_d.json');
  assert.equal(h.calls.previews[0].opener, h.nodes.toggle);
  assert.equal(h.nodes.details.open, false);
  await h.open();
  h.setup.loader = async () => ({ lists: [] });
  await h.button('d').emit('click');
  await settle();
  assert.match(h.nodes.status.textContent, /not in this copy.*Retry/);
  assert.equal(h.nodes.details.open, true);
  assert.equal(h.nodes.retry.hidden, false);
  h.setup.loader = async () => { throw new Error('offline catalog'); };
  await h.nodes.retry.emit('click');
  await settle();
  assert.match(h.nodes.status.textContent, /offline catalog/);
  assert.equal(h.map.get('mrt.state.v2'), 'reading bytes');
});

test('late Preview work is retired by close, navigation or another selected action', async () => {
  for (const cancellation of ['close', 'navigation', 'another']) {
    const h = harness();
    h.view.wire();
    await h.open();
    let resolve;
    h.setup.loader = () => new Promise((done) => { resolve = done; });
    await h.button('a').emit('click');
    if (cancellation === 'close') h.view.close();
    else if (cancellation === 'navigation') {
      h.view.close({ restoreFocus: false });
      h.calls.current = false;
      h.nodes.home.hidden = true;
    } else {
      h.setup.loader = async () => catalog;
      await h.button('d').emit('click');
      await settle();
    }
    resolve(catalog);
    await settle();
    assert.equal(h.calls.previews.length, cancellation === 'another' ? 1 : 0);
    if (cancellation === 'another') assert.equal(h.calls.previews[0].entry.id, 'd');
  }
});
