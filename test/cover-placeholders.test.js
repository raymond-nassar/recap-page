import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fallbackInitials } from '../src/js/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(here, '..', path), 'utf8');
const html = read('src/index.html');
const css = read('src/styles.css');
const main = read('src/js/main.js');
const readingView = read('src/js/views/reading.js');
const libraryView = read('src/js/views/library.js');
const savedListsView = read('src/js/views/shared/saved-lists.js');
const catalogPresentation = read('src/js/views/shared/catalog-presentation.js');

test('fallback initials use the first two comic title words', () => {
  assert.equal(fallbackInitials('Avengers Disassembled'), 'AD');
  assert.equal(fallbackInitials('House of M'), 'HO');
  assert.equal(fallbackInitials('The Amazing Spider-Man (2025)'), 'TA');
  assert.equal(fallbackInitials('X-Men'), 'XM');
  assert.equal(fallbackInitials('Loki'), 'L');
});

test('fallback initials tolerate titles with no usable words', () => {
  assert.equal(fallbackInitials(''), '');
  assert.equal(fallbackInitials(null), '');
  assert.equal(fallbackInitials('---'), '');
});

test('every cover fallback opts into the shared split-initial artwork', () => {
  for (const className of ['fallback', 'tf', 'rf', 'of', 'rcov-f', 'mosaic-f']) {
    const pattern = new RegExp(`class(?::|=)[^\\n]*['"][^'"]*\\b${className}\\b[^'"]*\\bcover-fallback\\b`);
    assert.match(
      `${html}\n${main}\n${readingView}\n${libraryView}\n${savedListsView}\n${catalogPresentation}`,
      pattern,
      `${className} does not use the shared artwork`,
    );
  }
  assert.match(css, /linear-gradient\(117deg,[^;]*var\(--on-accent\)/);
  assert.match(css, /\.cover-fallback\.cover-fallback::before/);
  assert.match(css, /\.cover-fallback\.cover-fallback::after/);
  assert.doesNotMatch(css, /--fallback-(?:a|b|fg):\s*hsl\(var\(--h\)/);
  assert.match(css, /hsl\(var\(--h\) var\(--fallback-a\)\)/);
  assert.match(css, /hsl\(calc\(var\(--h\) \+ 60\) var\(--fallback-a\)\)/);
  assert.match(main, /setFallbackInitials\(fb, fallbackName\)/);
});

test('reading surfaces identify fallbacks from each comic rather than the reading order', () => {
  assert.match(readingView, /paintCover\(\$\('#hero-img'\), \$\('#hero-fb'\), issue, 'portrait_uncanny'\)/);
  // The shelf and the full order each paint their own tile fallback rather than sharing one, so
  // this call site is expected exactly twice: once per renderer.
  const tileCalls = readingView.match(/paintCover\(img, fb, item, 'portrait_incredible'\)/g) ?? [];
  assert.equal(tileCalls.length, 2, 'the shelf and the row renderer no longer both paint per-comic fallbacks');
  assert.doesNotMatch(readingView, /paintCover\(img, fb, item, 'portrait_incredible', (?:list|store\.state\.lists)/);
});
