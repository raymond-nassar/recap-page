import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogPresentation } from '../src/js/views/shared/catalog-presentation.js';
import { updatedLabel } from '../src/js/lib/catalog.js';

function el(tag, props = {}, children = []) {
  return {
    tag,
    children: [].concat(children),
    replaceChildren(...next) { this.children = next; },
    ...props,
  };
}

function descendants(node) {
  return typeof node === 'object' && node !== null
    ? [node, ...node.children.flatMap(descendants)] : [];
}

function text(node) {
  return typeof node === 'string' ? node
    : node?.textContent ?? node?.text ?? node?.children.map(text).join('') ?? '';
}

const presentation = createCatalogPresentation({
  el,
  hueOf: () => 0,
  isInLibrary: () => false,
  paintCoverUrl: () => {},
  shortTitle: (title) => title,
});
const list = {
  id: 'spider-man',
  name: 'Amazing Spider-Man',
  description: 'A reading list.',
  count: 3,
  source: 'https://www.comicbookherald.com/amazing-spider-man-reading-order-modern-marvel-era/',
  sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
  sourceSection: 'Modern Marvel era',
  updatedAt: '2026-09-07T00:00:00Z',
};

const controls = (card) => descendants(card)
  .filter((node) => node.tag === 'button' || (node.tag === 'a' && node.href));

// UX-11 (#830): one prominent action per card. The title opens Preview, named by the title it shows
// and then by what it does, and Add is the card's one action, a compact secondary button.
test('the title opens Preview, and Add is the card\'s one compact secondary action', () => {
  const previewed = [];
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => false, paintCoverUrl: () => {},
    shortTitle: (title) => title, onPreview: (chosen) => previewed.push(chosen.id),
  });
  const card = shared.catalogCard({ key: 'spider-man', lists: [list] });
  const nodes = descendants(card);
  const heading = nodes.find((node) => node.class === 'catalog-card-title');
  assert.equal(heading.tag, 'h3');
  const [preview] = heading.children;
  assert.equal(preview.tag, 'button');
  assert.equal(preview.type, 'button');
  assert.equal(preview.dataset.act, 'preview');
  assert.equal(text(preview), list.name, 'the button shows the title and nothing else');
  assert.equal(preview['aria-label'], 'Amazing Spider-Man. Preview.');
  preview.onclick();
  assert.deepEqual(previewed, ['spider-man']);
  const actions = nodes.find((node) => node.class === 'catalog-card-actions');
  assert.equal(actions.children.length, 1, 'the card offers one action');
  const [add] = actions.children;
  assert.equal(add.dataset.act, 'import');
  assert.equal(add.tag, 'button');
  assert.deepEqual(add.class.split(' '), ['btn', 'btn-g']);
  assert.equal(add['aria-label'], 'Add to library: Amazing Spider-Man');
  assert.equal(nodes.some((node) => node.tag === 'button' && text(node) === 'Preview'), false);
});

// The owner's choice on #830: the card keeps the credit the sources' permissions rest on, the linked
// site name, and the snapshot date and section move to Preview, which shows the full attribution.
test('cards keep the linked site credit and leave the snapshot and section to Preview', () => {
  const card = presentation.catalogCard({ key: 'spider-man', lists: [list] });
  const nodes = descendants(card);
  const line = nodes.find((node) => node.tag === 'p' && node.class.includes('result-source'));
  assert.ok(line);
  assert.equal(nodes.some((node) => node.tag === 'details'), false, 'a card carries no disclosure');
  assert.equal(text(line), 'Source: Comic Book Herald');
  assert.equal(text(card).includes('Snapshot taken'), false);
  assert.equal(text(card).includes(list.sourceSection), false);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, list.source);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(link['aria-label'].includes('Comic Book Herald'));
  assert.ok(link['aria-label'].includes(list.name));
});

test('a card has three keyboard stops with a linked source and two without one', () => {
  const linked = controls(presentation.catalogCard({ key: 'spider-man', lists: [list] }));
  assert.deepEqual(linked.map((node) => node.dataset?.act ?? 'source'), ['preview', 'source', 'import']);
  const unlinked = { ...list, source: null, sourceOrigin: 'Compiled for this project' };
  const card = presentation.catalogCard({ key: 'spider-man', lists: [unlinked] });
  assert.deepEqual(controls(card).map((node) => node.dataset.act), ['preview', 'import']);
  assert.equal(text(descendants(card).find((node) => node.tag === 'p' && node.class.includes('result-source'))),
    'Source: Compiled for this project');
});

test('compact source names credit the actual site or repository, not its hosting platform', () => {
  for (const [source, label] of [
    ['https://www.comicbookherald.com/guide/', 'Comic Book Herald'],
    ['https://comicbookherald.com/guide/', 'Comic Book Herald'],
    ['https://comicbookreadingorders.com/marvel/events/guide/', 'Comic Book Reading Orders'],
    ['https://www.comicbookreadingorders.com/guide/', 'Comic Book Reading Orders'],
    ['https://github.com/emreparker/marvel-comics/blob/main/data/hickman_full.md', 'emreparker/marvel-comics'],
    ['https://github.com/raymond-nassar/recap-page/issues/303', 'Recap Page'],
    ['https://www.example.com/reading-order', 'example.com'],
    ['https://comicbookherald.com.example.com/guide', 'comicbookherald.com.example.com'],
  ]) {
    const line = presentation.attributionLine({ source }, { compact: true });
    assert.equal(text(line), `Source: ${label}`);
    assert.equal(descendants(line).find((node) => node.tag === 'a').href, source);
  }
});

test('Preview keeps full provenance and the exact section visible', () => {
  const line = presentation.attributionLine(list);
  assert.equal(line.tag, 'p');
  assert.equal(text(line),
    `Source: ${list.sourceOrigin} · Section: ${list.sourceSection} · Snapshot taken ${updatedLabel(list)}`);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, list.source);
  assert.ok(link['aria-label'].includes(list.sourceSection));
});

test('missing or unsafe source links retain credit without becoming clickable', () => {
  for (const source of [null, 'javascript:alert(1)', 'http://example.com/guide', 'not a URL']) {
    const line = presentation.attributionLine({ source, sourceOrigin: 'Compiled for this project' }, { compact: true });
    assert.equal(text(line), 'Source: Compiled for this project');
    assert.equal(descendants(line).some((node) => node.tag === 'a'), false);
  }
  assert.equal(text(presentation.attributionLine({ sourceLicense: 'Legacy credit' }, { compact: true })),
    'Source: Legacy credit');
  assert.equal(presentation.attributionLine({}), null);
  assert.equal(text(presentation.attributionLine({ sourceSection: 'Chapter one' })), 'Section: Chapter one');
  assert.equal(text(presentation.attributionLine({ updatedAt: list.updatedAt })),
    `Snapshot taken ${updatedLabel(list)}`);
});

test('saved catalog Open is a native actual-list destination while Add and Preview remain commands', () => {
  let opened = 0;
  const saved = { id: 'actual/list', name: 'Saved name' };
  const shared = createCatalogPresentation({
    el, hueOf: () => 0, isInLibrary: () => saved, paintCoverUrl: () => {},
    shortTitle: (title) => title, onOpen: () => { opened += 1; },
  });
  const nodes = descendants(shared.catalogCard({ key: 'spider-man', lists: [list] }));
  const open = nodes.find((node) => node.href === '#/read/actual%2Flist');
  assert.equal(open.tag, 'a');
  assert.equal(open.href, '#/read/actual%2Flist');
  assert.equal(open.class, 'btn', 'a saved list keeps its primary Open');
  open.onclick({ button: 0, metaKey: true, preventDefault() { assert.fail('native default intercepted'); } });
  assert.equal(opened, 0);
  open.onclick({ button: 0, preventDefault() {} });
  assert.equal(opened, 1);
  assert.equal(nodes.find((node) => node.dataset?.act === 'preview').tag, 'button');
  const unsaved = descendants(presentation.catalogCard({ key: 'spider-man', lists: [list] }));
  assert.equal(unsaved.find((node) => node.dataset?.act === 'import').tag, 'button');
});
