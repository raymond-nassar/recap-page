import test from 'node:test';
import assert from 'node:assert/strict';

import { labelledName, labelWords, shownName } from '../src/js/lib/accname.js';

// Written against the success criterion rather than against the module, so it can disagree with
// it. SC 2.5.3 asks that the accessible name contain the visible label's text, and its
// Understanding document says capitalisation and punctuation are ignored, so both sides are
// reduced to lowercase words before the containment is checked. It has to be a contiguous run:
// a name holding the label's words scattered through it is not one a speech user can say.
function nameContainsLabel(name, label) {
  const reduce = (s) => String(s)
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff]+/)
    .filter(Boolean)
    .join(' ');
  const needle = reduce(label);
  if (!needle) return true;
  return reduce(name).includes(needle);
}

// The checker is only worth anything if it fails on the names this change replaced. These are the
// nine verbatim, as they read before the fix, each beside the label it was meant to answer to. The
// two tile entries are the ones a first pass excused as compositions: the tile prints a title with
// its year stripped and the count as "3 / 20", and each old name put the removed text back in the
// middle of the printed run, which is the same split as the rest and not a composition at all.
const HISTORICAL_FAILURES = [
  ['+ Add to library', 'Add House of M to library'],
  ['✓ In library', 'House of M is in your library'],
  ['See the full list', 'Preview the issue list for House of M'],
  ['Open the list', 'Open House of M'],
  ['Read next issue →', 'Read House of M (2005) #1 in Marvel Unlimited'],
  ['Issue page ↗', 'Open the marvel.com page for House of M (2005) #1'],
  ['Info', 'marvel.com page for House of M (2005) #1'],
  ['House of M #1 2005', 'Open House of M (2005) #1 in Marvel Unlimited'],
  ['House of M 3 / 20', 'Open House of M, 3 of 20 issues read'],
];

test('the containment check rejects every name this change replaced', () => {
  for (const [label, oldName] of HISTORICAL_FAILURES) {
    assert.equal(nameContainsLabel(oldName, label), false, `${oldName} should not contain ${label}`);
  }
});

test('the containment check accepts a name that already carried its label', () => {
  assert.equal(nameContainsLabel('Read House of M (2005) #1 in Marvel Unlimited', 'Read'), true);
  assert.equal(nameContainsLabel('Import Essential reading', 'Import'), true);
  assert.equal(nameContainsLabel('Add all issues of House of M', 'Add all issues'), true);
});

test('every name built from a label contains that label', () => {
  for (const [label] of HISTORICAL_FAILURES) {
    const name = labelledName(label, 'House of M');
    assert.equal(nameContainsLabel(name, label), true, `${name} should contain ${label}`);
  }
});

test('the context is kept, so the control still says which thing it acts on', () => {
  assert.equal(labelledName('+ Add to library', 'House of M'), 'Add to library: House of M');
  assert.equal(labelledName('Open →', 'House of M'), 'Open: House of M');
  assert.equal(labelledName('Issue page ↗', 'House of M (2005) #1 on marvel.com'), 'Issue page: House of M (2005) #1 on marvel.com');
});

// The three static buttons read their label out of the document, and textContent carries the
// indentation of the markup around it. #btn-hero-info spans three lines in index.html.
test('markup whitespace around a label is collapsed', () => {
  assert.equal(labelledName('\r\n      Issue page ↗\r\n    ', 'X'), 'Issue page: X');
  assert.equal(labelWords('  Read next issue →  '), 'Read next issue');
});

test('a label of nothing but symbols leaves the context to stand alone', () => {
  assert.equal(labelledName('→', 'House of M'), 'House of M');
  assert.equal(labelledName('', 'House of M'), 'House of M');
  assert.equal(labelledName(null, 'House of M'), 'House of M');
});

test('a label with no context is the label', () => {
  assert.equal(labelledName('Download', ''), 'Download');
  assert.equal(labelledName('Download', null), 'Download');
});

// Letters outside ASCII are letters. A title reduced to its ASCII run would drop words a reader
// can see and say, which is the same defect in a different alphabet.
test('non-ASCII letters and digits survive', () => {
  assert.equal(labelWords('Café #4'), 'Café 4');
  assert.equal(labelledName('Añejo →', 'Zoë'), 'Añejo: Zoë');
});

// #905. Three more names the rules pass found with their visible pieces out of order or broken up,
// each beside the text the control showed: a category card's eyebrow, title and count, a saved
// list's name, count and status, and the comic page's rating button.
const PIECEWISE_FAILURES = [
  [['Browse by year', 'Modern Timeline', '152 Reading Lists'], 'Modern Timeline. Browse by year. 152 Reading Lists.'],
  [['House of M: Main Series and Branded Tie-Ins', '3 / 20', 'Reading'],
    'House of M Main Series and Branded Tie Ins 3 20: issues read, Reading. Open this list'],
  [['Rate this issue'], 'Rate House of M (2005) #1'],
];

test('the containment check rejects the names #905 replaced', () => {
  for (const [parts, oldName] of PIECEWISE_FAILURES) {
    assert.equal(nameContainsLabel(oldName, parts.join(' ')), false, `${oldName} should not contain ${parts.join(' ')}`);
  }
});

test('a name built from shown pieces contains them in order, then its context', () => {
  for (const [parts] of PIECEWISE_FAILURES) {
    const name = shownName(parts, 'House of M');
    assert.equal(nameContainsLabel(name, parts.join(' ')), true, `${name} should contain ${parts.join(' ')}`);
    assert.ok(name.endsWith('House of M.'), name);
  }
  assert.equal(shownName(['Browse by year', 'Modern Timeline', '152 Reading Lists']),
    'Browse by year. Modern Timeline. 152 Reading Lists.');
  assert.equal(shownName(['Your rating: 4.5/5'], 'Edit rating for House of M (2005) #1'),
    'Your rating: 4.5/5. Edit rating for House of M (2005) #1.');
});

test('shown pieces keep their punctuation, and a piece that ends a sentence is not ended twice', () => {
  assert.equal(shownName(['First list', '1 / 2. 1 deferred', 'Completed', 'Enjoyed. Completed today'], 'Open this list'),
    'First list. 1 / 2. 1 deferred. Completed. Enjoyed. Completed today. Open this list.');
  assert.equal(shownName(['What If...?', '  spaced\n  out  ', '', null], ''), 'What If...? spaced out.');
  assert.equal(shownName([], 'Context only'), 'Context only.');
});
