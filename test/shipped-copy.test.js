import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// BL-061 made Constraint 11 machine-checked by putting the rule in ESLint, which reads
// JavaScript and nothing else. Every word the app puts on screen that is not in a .js file
// was therefore green over a region no check looked at, which is the shape of defect this
// repository has been caught by before. This closes that gap for markup and styling.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// `server.mjs:20` resolves the served root to src/, so src/ is what "shipped" means here.
// Walked rather than listed: the six files that exist today would be an enumeration someone
// has to keep complete, and a seventh added later is exactly what would be missed.
const SHIPPED = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(html|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Comments are stripped because the rule this extends does the same. An em dash in a JS
// comment passes ESLint and an em dash in a JS string does not, measured by running both
// through it, so catching an HTML comment while ignoring a JS one would apply Constraint 11
// more strictly to markup than to the source it was written for. `index.html` carries 31
// HTML comments and `styles.css` 46, so the distinction decides real lines rather than
// hypothetical ones. Replaced with a newline rather than removed so line numbers survive.
function stripComments(text, file) {
  // Every edge case tried errs towards over-reporting, which is the safe direction here: an
  // unterminated marker matches nothing and so strips nothing, and choosing the pattern by
  // extension can only leave a comment standing. The one exception is an opener inside one
  // string literal closing against a marker in a later one, which would blank the copy
  // between them. No stylesheet here holds such a string.
  const pattern = file.endsWith('.html') ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\//g;
  return text.replace(pattern, (m) => m.replace(/[^\n]/g, ' '));
}

const DASH = /[\u2013\u2014]/;

test('current shipped identity and short attribution use Recap Page', () => {
  const html = readFileSync(join(SHIPPED, 'index.html'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(SHIPPED, 'manifest.webmanifest'), 'utf8'));
  const main = readFileSync(join(SHIPPED, 'js', 'main.js'), 'utf8');

  assert.match(html, /<title>Recap Page<\/title>/);
  assert.match(html, /<b class="lbl">Recap&nbsp;Page<\/b>/);
  assert.match(html, /<h1 id="home-h" class="home-brand">RECAP PAGE!<\/h1>/);
  assert.match(html, /<h1 id="order-name">Recap Page<\/h1>/);
  assert.equal(manifest.name, 'Recap Page');
  assert.equal(manifest.short_name, 'Recap');
  assert.equal([...html.matchAll(/Marvel metadata via marvel\.emreparker\.com\./g)].length, 3);
  assert.match(
    html,
    /<footer class="app-footer">[\s\S]*Unofficial fan project\. Metadata and links only\.[\s\S]*Read the full disclaimers[\s\S]*Marvel metadata via marvel\.emreparker\.com\./,
  );
  assert.match(main, /download\('recap-page-backup\.json'/);
  assert.match(main, /textContent = 'Recap Page'/);
});

test('no en or em dash reaches the screen through markup or styling', () => {
  const files = walk(SHIPPED);
  // A walk that finds nothing would pass this test while checking nothing at all.
  assert.ok(files.length >= 6, `expected the shipped surfaces to be found, got ${files.length}`);

  const offences = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8'), file).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (DASH.test(line)) {
        offences.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offences, [], `Constraint 11: dash in shipped copy\n${offences.join('\n')}`);
});

// Scanning what is left after the comments go means every remaining construct is in scope,
// including the ones a rule written against text nodes would forget. A CSS `content` value
// puts a glyph on screen with no text node behind it at all, and `src/styles.css` already
// ships one, so it is copy by the only test that matters: the reader sees it.
test('the sweep covers attribute values and CSS content, not just text nodes', () => {
  const cases = [
    ['page.html', '<p title="a dash \u2014 here">ok</p>'],
    ['page.html', '<p>a dash \u2014 in a text node</p>'],
    ['page.css', '.x::before { content: "a dash \u2014 here"; }'],
  ];
  for (const [file, source] of cases) {
    assert.match(stripComments(source, file), DASH, `missed a dash in ${source}`);
  }
});

test('a dash inside a comment is not shipped copy', () => {
  assert.doesNotMatch(stripComments('<!-- a dash \u2014 here -->', 'page.html'), DASH);
  assert.doesNotMatch(stripComments('/* a dash \u2014 here */', 'page.css'), DASH);
  // Stripping must not swallow the code around it, or the check above would go quiet.
  assert.match(stripComments('<!-- c -->\n<p>\u2014</p>', 'page.html'), DASH);
});
