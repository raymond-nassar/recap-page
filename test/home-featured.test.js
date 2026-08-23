import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pickFeatured } from '../src/js/main.js';

// The landing page offers one reading order by name to a reader who has nothing yet. That offer is
// only honest if it is the same order every time, chosen by a rule anyone can check, and if it is
// withdrawn the moment the reader tells us something more specific than "I do not know where to
// start". Both halves are what these check.
//
// The rule is the beginner-friendly order with the fewest issues, ties broken by catalog order.
// Smallest commitment first, because "how much am I signing up for" is the question a first-time
// reader is actually asking, and an editor's pick would answer a different one.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const markup = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
const script = readFileSync(join(ROOT, 'src', 'js', 'main.js'), 'utf8');
const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'));

test('the featured order is the shortest beginner-friendly one', () => {
  const pick = pickFeatured([
    { id: 'long', beginner: true, count: 40 },
    { id: 'short', beginner: true, count: 5 },
    { id: 'shorter-but-not-beginner', beginner: false, count: 2 },
  ]);
  assert.equal(pick.id, 'short');
});

test('a tie is broken by catalog order, so the pick does not move on its own', () => {
  // Two orders of equal length must not swap places between renders, or the landing page offers a
  // different starting point each time it is opened and neither is the one the reader remembers.
  const lists = [
    { id: 'first', beginner: true, count: 12 },
    { id: 'second', beginner: true, count: 12 },
  ];
  assert.equal(pickFeatured(lists).id, 'first');
  assert.equal(pickFeatured([...lists].reverse()).id, 'second', 'the tie-break is not reading catalog order');
});

test('nothing is featured when nothing in the catalog is beginner-friendly', () => {
  assert.equal(pickFeatured([{ id: 'a', beginner: false, count: 3 }]), null);
  assert.equal(pickFeatured([]), null);
});

test('the shipped catalog has something to feature', () => {
  // A rule that cannot fire against the data we ship is a rule nobody exercises. This is the one
  // assertion here that is about the catalog rather than about the function.
  const lists = catalog.lists ?? catalog.orders ?? [];
  assert.ok(lists.length > 0, 'the catalog carries no reading orders');
  const pick = pickFeatured(lists);
  assert.ok(pick, 'no bundled reading order is marked beginner-friendly, so the landing page can offer nothing');
  const beginners = lists.filter((l) => l.beginner);
  assert.equal(pick.count, Math.min(...beginners.map((l) => l.count)), 'the pick is not the shortest beginner-friendly order');
});

test('the offer is withdrawn as soon as the reader has said something more specific', () => {
  // Three conditions, and each one is a case where the reader has already answered the question the
  // panel exists to ask. Read off the source rather than rendered, because the render needs a
  // document; what matters is that all three are still in the guard and none has been dropped.
  const guard = script.match(/const pick = ([^;]+);/);
  assert.ok(guard, 'the featured panel no longer decides its pick in one place');
  assert.match(guard[1], /populated/, 'a reader with a library is still offered a starting point');
  assert.match(guard[1], /homeFacet !== 'all'/, 'a reader who has chosen a facet is still offered a starting point');
  assert.match(guard[1], /homeQuery/, 'a reader who is searching is still offered a starting point');
});

test('the featured panel is hidden rather than emptied, and keeps its name', () => {
  // An emptied heading would cost the section its accessible name, so the section is hidden whole.
  assert.match(script, /sec\.hidden = !pick;/, 'the featured panel is no longer hidden as a whole');
  assert.match(script, /FEATURE_NO_PICK/, 'the featured heading has no fallback text');
});

test('the featured panel is a labelled region with real controls', () => {
  const section = markup.match(/<section id="home-featured"[\s\S]*?<\/section>/);
  assert.ok(section, 'the featured panel is missing from the landing page');
  const html = section[0];
  assert.match(html, /aria-labelledby="feature-h"/, 'the featured panel is not named by its own heading');
  assert.match(html, /id="btn-feature-start"/, 'the featured panel offers no way to start reading');
  assert.match(html, /id="btn-feature-preview"/, 'the featured panel offers no way to look first');
  assert.match(html, /id="feature-facts"/, 'the featured panel does not say what the commitment is');
});

test('the first-run heading stands alone and the feature uses its decision column', () => {
  assert.match(markup, /<h1 id="home-h">Start Here<\/h1>/);
  assert.doesNotMatch(markup, /id="home-sub"/);
  assert.match(markup, /class="feature-copy"/);
  assert.match(markup, /class="feature-decision"/);
  assert.match(script, /populated \? 'Continue reading' : 'Start Here'/);
});

test('the featured panel is above the returning reader s own progress', () => {
  // Order matters on the landing page: a reader who already has a list wants Continue Reading
  // first, and the featured panel is hidden for them, so it can sit above it without cost. A reader
  // with nothing sees the offer at the top, which is where the question is asked.
  const featured = markup.indexOf('id="home-featured"');
  const cont = markup.indexOf('id="home-continue"');
  assert.ok(featured > 0 && cont > 0, 'one of the two landing panels is missing');
  assert.ok(featured < cont, 'the featured panel has fallen below the continue-reading panel');
});
