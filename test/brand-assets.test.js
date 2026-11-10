import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the app and website ship the same transparent adaptive wordmark without a font', () => {
  const svg = read('src/icons/wordmark.svg');
  assert.equal(svg, read('pages/assets/wordmark.svg'));
  assert.match(svg, /width="1000" height="168" viewBox="0 0 1000 167\.86"/);
  assert.match(svg, /\.st1\{fill:#6D28D9;stroke:#EE0874;stroke-width:3;/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\) \{ \.st1\{fill:#FFFFFF;\} \}/);
  assert.equal((svg.match(/<path\b/g) ?? []).length, 9);
  assert.doesNotMatch(svg, /<rect|class="st0"|<text|<image|<script|href=|@font-face|@import/);
});

test('the app uses the SVG with its original accessible heading and forced-colors text', () => {
  assert.match(read('src/index.html'), /<h1 id="home-h" class="home-brand"><img class="home-wordmark" src="\.\/icons\/wordmark\.svg" alt="" aria-hidden="true" width="1000" height="168" \/><span class="home-brand-text">Recap Page<\/span><\/h1>/);
  const css = read('src/styles.css');
  assert.match(css, /:root, :root\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light;/);
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dark"\]\) \{\s*color-scheme: light;/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*#view-home \.home-brand \{ color: CanvasText; \}\s*\.home-wordmark \{ display: none; \}\s*\.home-brand-text \{ position: static;/);
});

test('the public mission is the approved sentence beneath the existing website description', () => {
  assert.match(read('pages/index.html'), /Find Marvel reading lists and keep track of what you've read\.\s*<\/p>\s*<p>\s*Our mission is to make Marvel reading orders easier to follow, so you can keep your place and enjoy the story\.\s*<\/p>/);
});
