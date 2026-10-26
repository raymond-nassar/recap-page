import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { glanceShare, paintGlance } from '../src/js/lib/progressGlance.js';
import { BODY, LARGE, PAIRS } from '../scripts/check-palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');

// #876. A stand-in for what the two views hand over: a node's text is the text of what it holds, as
// textContent is, and el builds what the app's el builds from the same arguments.
function node(tag) {
  return {
    tag, props: {}, children: [], style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
    get textContent() { return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join(''); },
    replaceChildren(...next) { this.children = next; },
  };
}
const el = (tag, props = {}) => Object.assign(node(tag), { props, children: props.text === undefined ? [] : [props.text] });

function paint(read, total, words = ` of ${total} issues read`) {
  const count = node('p');
  const fill = node('i');
  paintGlance(el, { count, fill }, { read, total }, words);
  return { count, fill, figure: count.children[0] };
}

test('the bar is filled to the share Home has always written, at none, some and all of a list', () => {
  assert.equal(glanceShare(0, 69), '0.0%');
  assert.equal(glanceShare(3, 69), '4.3%');
  assert.equal(glanceShare(1, 3), '33.3%');
  assert.equal(glanceShare(69, 69), '100.0%');
  // A list with no issues has nothing to divide by, and its bar is drawn empty.
  assert.equal(glanceShare(0, 0), '0%');
  assert.equal(paint(3, 12).fill.style.values['--glance-share'], '25.0%');
});

test('the read figure leads the count, and the words after it keep the count\'s exact text', () => {
  const { count, figure } = paint(3, 69, ' of 69 issues read. 2 deferred');
  assert.equal(figure.tag, 'b');
  assert.equal(figure.props.class, 'glance-n');
  assert.equal(figure.textContent, '3');
  assert.equal(count.children[1], ' of 69 issues read. 2 deferred');
  assert.equal(count.textContent, '3 of 69 issues read. 2 deferred');
  assert.equal(paint(0, 0).count.textContent, '0 of 0 issues read');
});

test('the line holds the room its figure will need, so it keeps one width from none read to all', () => {
  // The stylesheet reserves this many of the figure's digits at the line's end. The digits the figure
  // shows and the digits held back always add up to the total's, so a count reaching 10 or 100 takes
  // room the line already had instead of rewrapping it.
  for (const [readCount, total, spare] of [[0, 69, 1], [9, 69, 1], [10, 69, 0], [69, 69, 0], [5, 120, 2], [99, 120, 1], [100, 120, 0], [0, 0, 0]]) {
    assert.equal(paint(readCount, total).count.style.values['--glance-spare'], String(spare), `${readCount} of ${total}`);
  }
});

test('each bar repeats a count read once elsewhere, so the bars are hidden from assistive technology', () => {
  const html = read('src/index.html');
  const tag = (id) => html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
  // Home's count is the card's one reading. The bar after it was a named progress bar, read straight
  // before the identical count; it carries no role or value now.
  assert.match(tag('chero-bar'), /\baria-hidden="true"/);
  assert.doesNotMatch(tag('chero-bar'), /\brole=|aria-value|aria-label/);
  assert.doesNotMatch(tag('chero-count'), /aria-hidden/);
  assert.ok(html.indexOf('id="chero-count"') < html.indexOf('id="chero-bar"'), 'the figure leads its bar');
  // On the reading screen the header's ring is the reading, and it stays when the hero does not, so the
  // hero's row is hidden whole. It sits after Read and Done, which keeps them where #836 put them on a
  // phone, and before the comic's facts.
  assert.match(tag('hero-progress'), /\baria-hidden="true"/);
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('id="hero-primary-actions"') < at('id="hero-progress"') && at('id="hero-progress"') < at('id="hero-facts"'));
  assert.ok(at('id="hero-progress"') < at('id="hero-progress-count"') && at('id="hero-progress-count"') < at('id="hero-progress-fill"'));
  assert.doesNotMatch(html.slice(at('id="ring-wrap"'), at('id="reading-body"')), /aria-hidden="true"[^>]*>\s*<span class="ring-text"/);
});

test('the palette gate measures each paint progress at a glance puts on a card, at its own floor', () => {
  // The bar's outline and fill, and the read figure, are read from the rules that paint them, so a
  // token swapped in either place has to be one the gate already holds to the right floor.
  const css = read('src/styles.css');
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.>]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  const token = (declarations, property) => declarations.match(new RegExp(`${property}:[^;]*var\\((--[a-z0-9-]+)\\)`))?.[1];
  const paints = [
    [token(rule('.glance-bar'), 'box-shadow'), LARGE, 'the outline that shows the bar\'s extent'],
    [token(rule('.glance-bar > i'), 'background'), LARGE, 'the fill'],
    [token(rule('.glance-n'), 'color'), BODY, 'the read figure'],
  ];
  assert.deepEqual(paints.map(([name]) => name), ['--line-2', '--accent', '--accent-text']);
  for (const [name, floor, part] of paints) {
    assert.ok(PAIRS.some(([fg, bg, pairFloor]) => fg === name && bg === '--card' && pairFloor === floor),
      `${part} is painted in ${name}, which the gate does not hold to ${floor} on a card`);
  }
  // Only the fill moves, sliding rather than growing, and the shared reduced-motion rule stops that too.
  assert.match(rule('.glance-bar > i'), /transform: translateX\(calc\(var\(--glance-share, 0%\) - 100%\)\); transition: transform \.35s ease;/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Progress at a glance (#876)')), /animation|@keyframes/);
});
