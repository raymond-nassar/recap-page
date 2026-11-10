import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the app and website ship identical fixed colorways without embedded theme media or a font', () => {
  const purple = read('src/icons/wordmark.svg');
  assert.doesNotMatch(purple, /@media/);
  for (const [file, fill] of [['wordmark.svg', '#6D28D9'], ['wordmark-white.svg', '#FFFFFF']]) {
    const svg = read(`src/icons/${file}`);
    assert.deepEqual(readFileSync(new URL(`../src/icons/${file}`, import.meta.url)),
      readFileSync(new URL(`../pages/assets/${file}`, import.meta.url)));
    assert.equal(svg, read(`pages/assets/${file}`));
    assert.equal(svg, purple.replace('fill:#6D28D9;', `fill:${fill};`));
    assert.match(svg, /width="1000" height="168" viewBox="0 0 1000 167\.86"/);
    assert.ok(svg.includes(`.st1{fill:${fill};stroke:#EE0874;stroke-width:3;`));
    assert.equal((svg.match(/<path\b/g) ?? []).length, 9);
    assert.doesNotMatch(svg, /@media|<rect|class="st0"|<text|<image|<script|href=|@font-face|@import/);
  }
});

test('the app uses the SVG with its original accessible heading and forced-colors text', () => {
  const html = read('src/index.html');
  for (const [color, file] of [['light', 'wordmark.svg'], ['dark', 'wordmark-white.svg']]) {
    assert.ok(html.includes(`<img class="home-wordmark home-wordmark--${color}" src="./icons/${file}" alt="" aria-hidden="true" width="1000" height="168" />`));
  }
  assert.match(html, /<span class="home-brand-text">Recap Page<\/span><\/h1>/);
  const css = read('src/styles.css');
  assert.match(css, /:root, :root\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light;/);
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dark"\]\) \{\s*color-scheme: light;/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*#view-home \.home-brand \{ color: CanvasText; \}\s*\.home-wordmark \{ display: none; \}\s*\.home-brand-text \{ position: static;/);
});

test('the public mission is the approved sentence beneath the existing website description', () => {
  assert.match(read('pages/index.html'), /Find Marvel reading lists and keep track of what you've read\.\s*<\/p>\s*<p>\s*Our mission is to make Marvel reading orders easier to follow, so you can keep your place and enjoy the story\.\s*<\/p>/);
});
