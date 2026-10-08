import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcuPrepView } from '../src/js/views/mcu-prep.js';

const metadata = {
  schemaVersion: 1, region: 'US', seriesDateKind: 'premiere',
  sources: [{ id: 'source', url: 'https://example.com/releases', retrievedAt: '2026-10-08' }],
  releases: [
    { id: 'first', title: 'First Film', date: '2021-01-15', phase: 4, format: 'movie', status: 'released', sources: ['source'] },
    { id: 'last', title: 'Future Film', date: '2027', phase: 6, format: 'movie', status: 'scheduled', sources: ['source'] },
  ],
  guides: [{ id: 'both', releases: ['last', 'first'] }],
};
const catalog = {
  paths: [],
  lists: ['general', 'both'].map((id) => ({
    id, name: id, type: 'screen-companion', characters: [], keywords: [],
  })),
};

function descendants(node) {
  return typeof node === 'object' && node !== null
    ? [node, ...(node.children ?? []).flatMap(descendants)] : [];
}

function harness(loadMetadata = async () => metadata) {
  const byId = new Map();
  let active = true;
  let loads = 0;
  let clears = 0;
  const failures = [];
  const cards = [];
  const el = (tag, props = {}, children = []) => {
    const node = {
      tag, children: [], value: '', hidden: false,
      append(...next) {
        for (const child of next) {
          this.children.push(child);
          if (typeof child === 'object') child.parent = this;
        }
      },
      replaceChildren(...next) { this.children = []; this.append(...next); },
      querySelector(selector) {
        return descendants(this).find((child) => child.class === selector.slice(1));
      },
      after(next) {
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, next);
        next.parent = this.parent;
      },
      focus() { this.focused = true; },
      ...props,
    };
    node.append(...[].concat(children));
    if (tag === 'select') node.value = node.children[0]?.value ?? '';
    if (node.id) byId.set(node.id, node);
    return node;
  };
  const nodes = { count: el('span'), results: el('div') };
  const view = createMcuPrepView({
    el,
    elements: () => nodes,
    isCurrent: () => active,
    loadMetadata: () => { loads += 1; return loadMetadata(); },
    clearLoadNotice: () => { clears += 1; },
    onLoadFailure: async (failure) => { if (failure.isCurrent()) failures.push(failure.error.message); },
    presentation: {
      catalogCard: (story, placement, options) => {
        cards.push({ story, placement, options });
        return el('article', { dataset: { story: story.key } }, [
          el('h3', { class: 'catalog-card-title', text: story.lists[0].name }),
        ]);
      },
    },
  });
  return {
    view, nodes, byId, cards, failures,
    loads: () => loads,
    clears: () => clears,
    setActive: (value) => { active = value; },
    ids: () => descendants(nodes.results).filter((node) => node.tag === 'article')
      .map((node) => node.dataset.story),
  };
}

const control = (h, name) => h.byId.get(`marvel-on-screen-${name}`);
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('MCU view constructs no DOM until mounted and keeps labeled native controls mounted', async () => {
  const h = harness();
  assert.equal(h.byId.size, 0);
  const controls = h.view.controls();
  assert.equal(h.view.controls(), controls);
  await h.view.render(catalog);
  assert.equal(h.nodes.count.textContent, '2 Reading Lists');
  assert.deepEqual(h.ids(), ['list:both', 'list:general']);
  assert.equal(control(h, 'sort').disabled, false);
  const labels = descendants(controls).filter((node) => node.tag === 'label');
  assert.deepEqual(labels.map((node) => node.for), ['marvel-on-screen-q', 'marvel-on-screen-sort']);
  const releaseRows = descendants(h.nodes.results).filter((node) => node.dataset?.release);
  assert.equal(releaseRows.length, 2);
  assert.match(releaseRows[1].text, /Future Film.*Scheduled: 2027 \(year only\)/);
  assert.ok(h.cards.every(({ options }) => options.surface === 'marvel-on-screen' && options.level === 'h3'));
});

test('MCU query, clear and direction repaint results without reloads or persistence', async () => {
  const h = harness();
  await h.view.render(catalog);
  const controls = h.view.controls();
  control(h, 'q').value = 'Future Film';
  control(h, 'q').oninput();
  assert.deepEqual(h.ids(), ['list:both']);
  assert.equal(h.nodes.count.textContent, '1 of 2 Reading Lists');
  control(h, 'sort').value = 'newest';
  control(h, 'sort').onchange();
  await h.view.render(catalog);
  assert.deepEqual(h.ids(), ['list:both']);
  assert.equal(control(h, 'sort').value, 'newest');
  assert.equal(h.view.controls(), controls);
  control(h, 'q').value = 'not a match';
  control(h, 'q').oninput();
  assert.equal(h.nodes.count.textContent, '0 of 2 Reading Lists');
  assert.match(h.nodes.results.children[0].text, /No Reading Lists match/);
  control(h, 'clear').onclick();
  assert.equal(control(h, 'q').focused, true);
  assert.equal(control(h, 'q').value, '');
  assert.equal(control(h, 'clear').hidden, true);
  assert.deepEqual(h.ids(), ['list:both', 'list:general']);
  assert.equal(h.loads(), 1);
});

test('MCU metadata failure retains searchable guides and retries only on an explicit request', async () => {
  let fail = true;
  const h = harness(async () => {
    if (fail) throw new Error('Fixture metadata unavailable');
    return metadata;
  });
  await h.view.render(catalog);
  assert.deepEqual(h.ids(), ['list:general', 'list:both']);
  assert.equal(h.nodes.count.textContent, '2 Reading Lists');
  assert.deepEqual(h.failures, ['Fixture metadata unavailable']);
  assert.equal(control(h, 'sort').disabled, true);
  assert.equal(control(h, 'retry').hidden, false);
  control(h, 'q').value = 'both';
  control(h, 'q').oninput();
  assert.deepEqual(h.ids(), ['list:both']);
  assert.equal(h.loads(), 1);
  assert.equal(h.failures.length, 1);
  control(h, 'clear').onclick();
  control(h, 'q').focused = false;
  fail = false;
  control(h, 'retry').onclick();
  await tick();
  assert.equal(h.loads(), 2);
  assert.equal(h.clears(), 2);
  assert.equal(control(h, 'retry').hidden, true);
  assert.equal(control(h, 'sort').disabled, false);
  assert.equal(control(h, 'q').focused, true);
  assert.deepEqual(h.ids(), ['list:both', 'list:general']);
});

test('MCU pending loads use the latest query and do not paint or report after navigation', async () => {
  for (const reject of [false, true]) {
    let finish;
    const pending = new Promise((resolve, fail) => { finish = reject ? fail : resolve; });
    const h = harness(() => pending);
    const load = h.view.render(catalog);
    control(h, 'q').value = 'Future';
    control(h, 'q').oninput();
    h.setActive(false);
    finish(reject ? new Error('Stale failure') : metadata);
    await load;
    assert.deepEqual(h.ids(), []);
    assert.deepEqual(h.failures, []);
    h.setActive(true);
    await h.view.render(catalog);
    assert.deepEqual(h.ids(), reject ? [] : ['list:both']);
    assert.equal(h.failures.length, reject ? 1 : 0);
  }
});

test('MCU empty catalogs remain empty and stale concurrent renders cannot replace newer results', async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }));
  const first = h.view.render(catalog, { isCurrent: () => false });
  const second = h.view.render({ paths: [], lists: [] });
  await tick();
  finish(metadata);
  await Promise.all([first, second]);
  assert.equal(h.nodes.count.textContent, '0 Reading Lists');
  assert.deepEqual(h.ids(), []);
  assert.equal(h.cards.length, 0);
  assert.match(h.nodes.results.children[0].text, /No MCU Prep Reading Lists are published/);
});
