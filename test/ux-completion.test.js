import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWS } from '../src/js/lib/route.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const html = read('src/index.html');
const main = read('src/js/main.js');
const styles = read('src/styles.css');
const productCopy = [
  html.replace(/<!--[\s\S]*?-->/g, ''),
  main.replace(/^\s*\/\/.*$/gm, ''),
  read('src/js/lib/catalog.js').replace(/^\s*\/\/.*$/gm, ''),
  read('src/js/lib/library.js').replace(/^\s*\/\/.*$/gm, ''),
  read('src/data/catalog.json'),
  read('src/data/curated-lists.json'),
].join('\n');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText} after ${startText}`);
  return source.slice(start, end);
}

test('named Reading Lists and library summaries share one My Library rail group', () => {
  const rail = between(html, '<nav id="sidebar-nav"', '</nav>');
  const nav = between(html, '<div class="nav-scroll">', '<h2 class="rail-h">Start from</h2>');
  assert.match(nav, /<h2 id="rail-orders" class="rail-h">My Library<\/h2>/);
  assert.match(nav, /id="list-nav"/, 'named Reading Lists left My Library');
  for (const view of ['library-read', 'progress', 'library-manual']) {
    assert.match(nav, new RegExp(`data-view="${view}"`), `${view} left My Library`);
  }
  assert.doesNotMatch(rail, /<h2[^>]*>Reading Lists<\/h2>/);
  assert.doesNotMatch(rail, /<h2[^>]*>Library<\/h2>/);
});

test('product copy uses Reading List everywhere and capitalizes both words', () => {
  const terms = productCopy.match(/\breading (?:orders?|lists?)\b/gi) ?? [];
  assert.ok(terms.length > 0, 'the product no longer contains any Reading List labels to check');
  assert.deepEqual([...new Set(terms)].sort(), ['Reading List', 'Reading Lists']);
  assert.doesNotMatch(productCopy, /\breading\s+\$\{/i, 'a dynamic label can bypass the capitalization contract');
});

test('Search issues groups the destinations the app can actually open', () => {
  const page = between(html, 'id="view-add-search"', 'id="view-add-series"');
  assert.match(page, /<h2 id="search-browse-h">Browse by<\/h2>/);
  assert.match(page, /<h2 id="search-other-h">Other ways to add<\/h2>/);
  for (const view of ['add-series', 'add-creator', 'spotlights', 'catalog', 'add-import', 'add-manual']) {
    assert.ok(VIEWS.includes(view), `${view} is grouped on Search but is not a route`);
    assert.match(page, new RegExp(`data-view="${view}"`), `${view} is missing from the Search groups`);
  }
});

test('browse screens render safe cover-led cards with one-sentence summaries', () => {
  const start = main.indexOf('function catalogCard');
  const body = main.slice(start, main.indexOf('// Where this story sits', start));
  assert.match(body, /paintCoverUrl\(img, fallback, catalogCoverUrl\(list\)/);
  assert.match(body, /desc\.textContent = firstSentence\(list\.description\)/);
  assert.match(body, /class: 'catalog-card'/);
  assert.match(body, /attributionLine\(list\)/, 'Source disclosure left the clean card');
  assert.doesNotMatch(body, /pathChooser\(/, 'variant radios are still standing on every card');
});

test('the timeline spine is derived and has a focusable destination', () => {
  assert.match(html, /id="catalog-timeline"[^>]*aria-label="Jump to a year"/);
  assert.match(main, /const years = timelineYears\(stories\)/);
  assert.match(main, /await renderCatalogShelf\('catalog'\)/);
  assert.match(main, /heading\?\.focus\(\{ preventScroll: true \}\)/);
});

test('home cards size to their own content instead of stretching to their row', () => {
  assert.match(
    styles,
    /\.ogrid\s*\{[^}]*align-items:\s*start;/s,
    'the landing grid still stretches short cards to the tallest card in their row',
  );
});

test('saved Reading Lists use bounded responsive tiles instead of full-width rows', () => {
  assert.match(
    styles,
    /\.yours\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*18rem\),\s*24rem\)\)[^}]*align-items:\s*start;/s,
    'saved Reading Lists still expand into full-width rows',
  );
});

test('the featured reading panel stops widening once its content has enough room', () => {
  assert.match(
    styles,
    /\.feature\s*\{[^}]*max-width:\s*72rem;/s,
    'the featured panel still expands across every available pixel',
  );
});

test('the continue-reading panel uses the same bounded measure', () => {
  assert.match(
    styles,
    /\.chero\s*\{[^}]*max-width:\s*72rem;/s,
    'the continue-reading panel still expands across every available pixel',
  );
});

test('home group headings do not masquerade as Timeline era breaks', () => {
  assert.match(main, /shelfSectionHead\(section,\s*hasFirstStop,\s*\{[^}]*level:\s*'h3'[^}]*className:\s*'shelf-section home-shelf-section'[^}]*blurb:\s*false/s);
  assert.match(
    styles,
    /\.home-shelf-section\s*\{[^}]*background:\s*none;[^}]*border:\s*0;/s,
    'the Home categories still use the boxed era-break treatment',
  );
});

test('returning readers and Home group headings are not explained twice', () => {
  assert.match(main, /homeSub\.hidden = populated;/);
  assert.match(main, /homeSub\.textContent = populated\s*\?\s*''/);
  assert.match(main, /if \(blurb\) children\.push\(/);
});
