// The reading path runs through all three catalogue screens, so a row can name a stop the reader
// cannot reach by scrolling. Two links answer that, and both are the same rule: draw a link only
// where pressing it takes the reader to a screen they are not on. "Next" carries them forward, and
// the path's own name carries them back to the start.
//
// Exercised rather than scanned. test/render-rows.test.js records why: source-text tests of a
// render matched the shape of the code, and every mutation tried against them changed exactly the
// text the scan read, so passing was close to tautological. These call the function and read what
// it built. The stand-in below is the smallest node pathLine actually uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupCatalog, parseCatalog, pathPlacements, shelfStories, CATALOG_SHELVES } from '../src/js/lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const stories = groupCatalog(catalog.lists);

function node(tag) {
  return {
    tag,
    attrs: {},
    children: [],
    className: '',
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    append(child) { this.children.push(child); },
  };
}

globalThis.document = {
  createElement: (tag) => node(tag),
  createTextNode: (text) => ({ tag: '#text', textContent: text }),
};

const { pathLine } = await import('../src/js/main.js');

const placed = pathPlacements(catalog.paths, catalog.lists);
const byPosition = new Map([...placed.values()].map((p) => [p.position, p]));
const shelfOf = (key) => CATALOG_SHELVES.find((shelf) => shelfStories(stories, shelf.key).some((s) => s.key === key)).key;
const keyAt = (position) => [...placed.entries()].find(([, p]) => p.position === position)[0];

function links(el) {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.tag === 'a') found.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(el);
  return found;
}

function words(el) {
  if (!el || typeof el !== 'object') return '';
  if (el.tag === '#text') return el.textContent;
  return (el.textContent || '') + (el.children ?? []).map(words).join('');
}

const NAME = [...placed.values()][0].pathName;

// The count the owner's choice rests on, measured rather than asserted from the design. Nine rows
// take a linked name and two take a linked "Next", and step five takes both, which is the only row
// in the app pointing at two different screens.
test('the two links are drawn on exactly the rows that cannot reach the stop by scrolling', () => {
  const rows = [];
  for (const surface of ['home', ...CATALOG_SHELVES.map((s) => s.key)]) {
    for (const [position, placement] of byPosition) {
      const key = keyAt(position);
      const drawn = surface === 'home' ? true : shelfOf(key) === surface;
      if (!drawn) continue;
      const line = pathLine(placement, surface);
      const drawnLinks = links(line);
      const named = drawnLinks.filter((a) => words(a) === NAME);
      rows.push({ surface, position, name: named.length, next: drawnLinks.length - named.length });
    }
  }
  const total = (field) => rows.reduce((n, r) => n + r[field], 0);
  assert.equal(total('name'), 9, 'the path name is not linked on the nine rows drawn away from its start');
  assert.equal(total('next'), 2, 'the forward link is not on the two hops that cross a screen');

  const both = rows.filter((r) => r.name && r.next);
  assert.deepEqual(both.map((r) => r.position), [5], 'step five is the only row carrying both links');

  const home = rows.filter((r) => r.surface === 'home');
  assert.equal(home.length, 10, 'the landing page draws every stop');
  assert.equal(total('name') - rows.filter((r) => r.surface !== 'home').reduce((n, r) => n + r.name, 0), 0,
    'the landing page draws the first stop, so nothing there needs a link to it');
});

// The basis of the whole decision. A backward stop link was declined because the path's name is
// already on the row, so linking it closes the same gap for nothing; an implementation that adds a
// visible word has spent what it was chosen to save.
test('linking the path name adds no visible word to the row', () => {
  const opener = byPosition.get(1);
  const away = byPosition.get(2);

  // The row the path starts on draws the name unlinked, because its start is the screen it is on.
  const plain = pathLine(opener, shelfOf(keyAt(1)));
  assert.deepEqual(links(plain).map(words), [opener.next.name], 'the opening row linked its own name');
  assert.equal(words(plain), 'Start here' + NAME + ' · Step 1 of ' + opener.total + ' · Next: ' + opener.next.name);

  // A row drawn away from the start says the same words, with one of them now pressable.
  const linked = pathLine(away, shelfOf(keyAt(2)));
  const [name] = links(linked);
  assert.equal(words(name), NAME, 'the link shows something other than the name already printed');
  assert.equal(
    words(linked),
    'Step ' + away.position + ' of ' + away.total + NAME + ' · Next: ' + away.next.name,
    'the linked row says more than the row it replaced',
  );
});

// A link announced as "The Modern Avengers" does not say that pressing it goes to the start, and
// nothing may be added on screen to say so. WCAG SC 2.5.3 wants the visible words inside the
// accessible name rather than beside it, which is the rule accname.js holds for every other control
// in the app.
test('the linked name says where it goes without saying it on screen', () => {
  const away = byPosition.get(2);
  const [link] = links(pathLine(away, shelfOf(keyAt(2))));
  const label = link.attrs['aria-label'];
  assert.ok(label, 'the link carries no accessible name, so it is announced as a bare title');
  assert.ok(label.startsWith(NAME), 'the accessible name does not contain the words on the control');
  assert.ok(label.includes(away.first.name), 'the accessible name does not say which stop it goes to');
  assert.notEqual(label, words(link), 'the accessible name says no more than the visible text');
});

// Same rule, one implementation. Both links resolve their destination the same way and clear the
// destination's narrowing the same way, so the href a name link writes is the href the forward link
// would write for the same stop.
test('both links address the screen the stop is actually drawn on', () => {
  for (const [position, placement] of byPosition) {
    for (const surface of CATALOG_SHELVES.map((s) => s.key)) {
      if (shelfOf(keyAt(position)) !== surface) continue;
      for (const a of links(pathLine(placement, surface))) {
        const stop = words(a) === NAME ? placement.first : placement.next;
        assert.equal(a.attrs.href, '#/' + stop.shelf, words(a) + ' links somewhere other than its own screen');
        assert.notEqual(stop.shelf, surface, words(a) + ' links to the screen the reader is already on');
      }
    }
  }
});
