import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_SHELVES,
  groupCatalog,
  inHomeAge,
  parseCatalog,
  shelfSections,
} from '../src/js/lib/catalog.js';

// The landing grid used to cap at twelve and hand the rest to a second screen through a "See all"
// control. The cap is gone, and with it the jar it created: the control promised more of the same
// and delivered rows on a differently shaped screen.
//
// These replace the checks that guarded the cap. They are the same relationships pointed the other
// way. Where the old file asserted that a reader was told what was held back and could act on it,
// these assert that nothing is held back, that no control offers to reveal what is already on
// screen, and that the grid is divided rather than being one undifferentiated wall.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const markup = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
const source = readFileSync(join(ROOT, 'src', 'js', 'main.js'), 'utf8');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));

const home = markup.slice(markup.indexOf('id="home-catalog"'), markup.indexOf('id="view-catalog"'));

// The bounds of the element carrying an id, by balancing its own tag. Used to tell a control that is
// put away from one that is put away by a container, which is the same thing to a reader and the
// difference the branch check would otherwise trip over.
function elementRange(html, id) {
  const open = new RegExp(`<(\\w+)[^>]*\\bid="${id}"`).exec(html);
  if (!open) return null;
  const tag = open[1];
  const scan = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  scan.lastIndex = open.index;
  let depth = 0;
  for (let m = scan.exec(html); m; m = scan.exec(html)) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return [open.index, m.index + m[0].length];
  }
  // A void element such as <input> never closes; it spans its own tag alone.
  return [open.index, html.indexOf('>', open.index) + 1];
}

// The body of one top-level function. Written CRLF-tolerantly: main.js uses CRLF, so a closing
// brace is followed by \r\n and a pattern anchored on \n}\n matches nothing and silently returns
// the rest of the file.
function functionBody(text, opener) {
  const start = text.indexOf(opener);
  if (start < 0) return null;
  const end = /\r?\n\}\r?\n/.exec(text.slice(start));
  return end ? text.slice(start, start + end.index) : null;
}

test('the landing grid holds back nothing it could show', () => {
  const shown = shelfSections(groupCatalog(catalog.lists).filter(inHomeAge))
    .reduce((n, section) => n + section.stories.length, 0);
  const eligible = groupCatalog(catalog.lists).filter(inHomeAge).length;
  assert.equal(shown, eligible, 'the landing page drew fewer stories than it was given');
  assert.ok(shown > 12, 'the catalog has shrunk below the old cap, so this proves nothing');
});

// The cap was a constant, and a constant is the thing that comes back. Asserted against the source
// rather than the render because a reintroduced cap would be correct at every size below it, so a
// behavioural check would pass until the catalog grew past whatever number was chosen.
test('no cap constant is left in the landing page render', () => {
  assert.doesNotMatch(source, /HOME_GRID_CAP/, 'the landing grid cap is back');
  const body = functionBody(source, 'async function renderHomeCatalog');
  assert.ok(body, 'renderHomeCatalog has moved or gone');
  assert.doesNotMatch(body, /\.slice\(/, 'the landing grid slices what it was given');
});

// The jar itself. A control offering to show the rest of a grid that is already whole is worse than
// useless: it promises a screen the reader has no reason to visit, and the screen it promised was
// the one shaped differently.
test('nothing on the landing page offers to reveal what is already on it', () => {
  for (const id of ['home-overflow', 'home-more', 'home-see-all']) {
    assert.equal(markup.includes(`id="${id}"`), false, `${id} still offers to expand a complete grid`);
  }
  assert.doesNotMatch(home, /See all/i, 'the landing page still promises a second copy of itself');
  assert.doesNotMatch(source, /overflowState/, 'the overflow rule outlived the controls it drove');
});

// Grouped rather than capped, which is what keeps fifty-nine cards from being a wall. The headings
// come from the shelf table, so the three names on the landing page are the three the rail offers
// as screens rather than a second vocabulary a reader has to learn.
test('the landing grid is divided under the same names the screens carry', () => {
  const sections = shelfSections(groupCatalog(catalog.lists).filter(inHomeAge));
  assert.ok(sections.length > 1, 'the landing grid drew a single undivided group');
  for (const section of sections) {
    assert.ok(
      CATALOG_SHELVES.some((shelf) => shelf.key === section.key && shelf.heading === section.heading),
      `the landing page drew "${section.heading}", which no screen is called`,
    );
  }
  assert.match(markup, /class="ogrid-groups" id="home-grid"/, 'the grid container cannot hold groups');
});

// Fifty-nine covers on the landing page rather than twelve, so an eager fetch is the difference
// between twelve requests and fifty-nine before anything below the fold is wanted. Derived from
// every image the app builds rather than from a list of the ones that matter, because a list is a
// thing someone has to remember to add to.
test('every cover the app builds is fetched lazily', () => {
  const images = [...source.matchAll(/el\('img',\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(images.length >= 5, `expected the app to build at least five images, saw ${images.length}`);
  const eager = images.filter((attrs) => !/loading:\s*'lazy'/.test(attrs));
  assert.deepEqual(eager, [], `these images are fetched before they are wanted: ${eager.join(' | ')}`);
});

// The empty catalog returns before the block that reveals the landing page's controls, so it has to
// put every one of them away itself. This is the relationship the cap-era file asserted, pointed at
// the controls that replaced the overflow ones: a rule applied in one place and not the other agrees
// only while something incidental stays true, and here the incidental truth is that the catalog is
// memoized and never emptied after a successful load, so the markup's own hidden attribute happens
// to cover the gap.
test('a catalog with nothing in it puts away every control the full render reveals', () => {
  const start = source.indexOf('if (!all.length) {');
  assert.ok(start > -1, 'the empty-catalog branch has moved or gone');
  const branch = source.slice(start, source.indexOf('\n  }', start));

  const body = functionBody(source, 'async function renderHomeCatalog');
  assert.ok(body, 'renderHomeCatalog has moved or gone');

  const ids = (text, pattern) => new Set([...text.matchAll(pattern)].map((m) => m[1]));
  // Anything whose visibility the render computes, as opposed to the branches that only ever hide.
  const revealed = [...ids(body, /\$\('#([\w-]+)'\)\.hidden = (?!true;)/g)];
  const putAway = ids(branch, /\$\('#([\w-]+)'\)\.hidden = true;/g);

  assert.ok(revealed.length >= 2, `expected the render to own at least two controls, saw ${revealed.length}`);

  const leftShowing = revealed.filter((id) => {
    if (putAway.has(id)) return false;
    // Or put away by a container, which a reader cannot tell apart from being put away itself.
    return ![...putAway].some((outer) => {
      const range = elementRange(markup, outer);
      const at = markup.indexOf(`id="${id}"`);
      return range && at > range[0] && at < range[1];
    });
  });
  assert.deepEqual(leftShowing, [], `left showing on an empty catalog: ${leftShowing.join(', ')}`);
});

// The same branch also has to say why the grid is empty. An empty container with every control put
// away is indistinguishable from a page that failed to load.
test('an empty catalog says so rather than showing a blank grid', () => {
  const start = source.indexOf('if (!all.length) {');
  const branch = source.slice(start, source.indexOf('\n  }', start));
  assert.match(branch, /grid\.replaceChildren\(/, 'the empty branch leaves whatever was there before');
  assert.match(branch, /No curated Reading Lists/, 'the empty branch draws nothing a reader can read');
});
