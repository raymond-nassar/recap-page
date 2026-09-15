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

test('cards expose a concise source link and snapshot without a disclosure', () => {
  const card = presentation.catalogCard({ key: 'spider-man', lists: [list] }, null);
  const nodes = descendants(card);
  const line = nodes.find((node) => node.tag === 'p' && node.class.includes('result-source'));
  assert.ok(line);
  assert.equal(nodes.some((node) => node.tag === 'details'), false);
  assert.equal(text(line), `Source: Comic Book Herald · Snapshot taken ${updatedLabel(list)}`);
  const link = descendants(line).find((node) => node.tag === 'a');
  assert.equal(link.href, list.source);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(link['aria-label'].includes('Comic Book Herald'));
  assert.ok(link['aria-label'].includes(list.name));
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
