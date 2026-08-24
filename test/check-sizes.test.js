// The gate's whole job is deciding what counts as a claim, so these tests are mostly
// about the sentences it must ignore. A size checker that reads every number near a
// filename as a size would be worse than none: it would train a reader to reach for
// the frozen marker to silence it, which is how a marker stops meaning anything.
//
// Every fixture below names a path the repository does not track, and the tests
// declare those paths tracked locally. That is not cosmetic. This file is scanned by
// the gate like any other, so a fixture naming a real file would be a live claim about
// it, and the fixtures would go stale every time that file grew.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claimsIn, check, FROZEN, paragraphs, scanned } from '../scripts/check-sizes.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const VIEW = 'src/js/example-view.js';
const GUIDE = 'docs/EXAMPLE_GUIDE.md';
const MANIFEST = 'docs/example-manifest.json';
const TRACKED = new Set([VIEW, GUIDE, MANIFEST]);
const read = (text) => claimsIn(text, { tracked: TRACKED });

test('a size stated of a named file is a claim', () => {
  const found = read(`\`${VIEW}\` is 3,784 lines and carries every view.`);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, VIEW);
  assert.equal(found[0].stated, 3784);
});

test('the attributive spelling is read, and takes its file from the citation after it', () => {
  const found = read(`A single view file of 3,784 lines wires a store together at \`${VIEW}:67-80\`.`);
  assert.equal(found.length, 1, 'a size stated before its file is named is still a size');
  assert.equal(found[0].path, VIEW, 'the line range was not stripped off the citation');
  assert.equal(found[0].stated, 3784);
});

test('a list may elide the word after stating it once', () => {
  const found = read(`\`${GUIDE}\` is 211 lines, \`${MANIFEST}\` 34.`);
  assert.deepEqual(found.map((f) => [f.path, f.stated]), [[GUIDE, 211], [MANIFEST, 34]]);
});

// The elision is the riskiest rule here, because a filename followed by a number is an
// ordinary shape in a table row. It is allowed only inside a sentence that already
// stated a size in full, and these two are that boundary.
test('a bare number after a filename is not a size on its own', () => {
  assert.deepEqual(read(`\`${MANIFEST}\` 34 is where the scripts live.`), []);
});

test('and not once the sentence stating a size has ended', () => {
  const found = read(`\`${GUIDE}\` is 211 lines. Then \`${MANIFEST}\` 34 came up.`);
  assert.deepEqual(found.map((f) => f.path), [GUIDE], 'the elision did not stop at the full stop');
});

test('a delta is not a size', () => {
  assert.deepEqual(read(`\`${VIEW}\` grew by 997 lines while every statement stood still.`), []);
  assert.deepEqual(read(`Shipping grew \`${VIEW}\` from 409 lines to 450 without changing a rule.`), []);
});

test('a past measurement is not a claim about now', () => {
  assert.deepEqual(read(`That pass measured \`${VIEW}\` at 1,566 lines.`), []);
  assert.deepEqual(read(`\`${VIEW}\` was stated as 1,566 lines in three places.`), []);
});

test('a quantity of work is not a size', () => {
  assert.deepEqual(
    read(`That is two new tools for 1,626 lines, and \`${VIEW}\` is not one of them.`),
    [],
    'a count of lines a tool would read is not a claim about any one file',
  );
});

test('a size with no file named anywhere near it is left alone', () => {
  assert.deepEqual(read('Across the tracked Markdown the longest run is 41 lines.'), []);
});

test('a file the repository does not track is not measured', () => {
  assert.deepEqual(read('`some/other/thing.js` is 12 lines.'), [], 'an untracked path has no size to compare');
});

// A path written without backticks is not a claim, for the same reason the anchors gate
// collects only backticked citations outside Markdown: it is how a fixture says it is
// data rather than an assertion, and this file depends on that rule for itself.
test('a path named without backticks is not a subject', () => {
  assert.deepEqual(read(`${VIEW} is 3,784 lines.`), []);
});

test('the frozen marker exempts one line and not its paragraph', () => {
  const text = [
    `- \`${VIEW}\` is 1,566 lines and carries every view. ${FROZEN}`,
    '  Still open, and wider than audited: the file is 3,784 lines now.',
  ].join('\n');
  const found = read(text);
  assert.equal(found.length, 2, 'both statements are recognised; the marker decides which is checked');
  const [dated, live] = found;
  assert.ok(dated.source.includes(FROZEN), 'the audited figure carries the marker');
  assert.ok(!live.source.includes(FROZEN), 'the live figure beside it does not inherit it');
  assert.equal(live.stated, 3784);
});

test('a paragraph is a run of consecutive non-blank lines', () => {
  const p = paragraphs('a\nb\n\n\nc\n');
  assert.deepEqual(p.map((x) => [x.start, x.lines]), [[0, ['a', 'b']], [4, ['c']]]);
});

// The line a finding is reported against has to be the line the number is on, not the
// line the paragraph starts on, or the message sends a reader to the wrong place in a
// document that is nine thousand lines long.
test('a finding names the line the number is written on', () => {
  const found = read(`An opening line about nothing.\n\`${VIEW}\` is 3,784 lines.`);
  assert.equal(found[0].line, 2);
});

test('the tree agrees with every size stated in it', () => {
  const { claims, findings } = check(ROOT);
  assert.equal(
    findings.length,
    0,
    findings.map((f) => `${f.file}:${f.line} says ${f.path} ${f.text}, it is ${f.actual}`).join('\n'),
  );
  assert.ok(claims > 0, 'the gate found no size claims at all, which means it has stopped reading them');
});

// A size is compared against `(Get-Content).Count`, which is what the figures in the
// documents were measured with, so a trailing newline must not add a line.
test('a trailing newline is not counted as a line', () => {
  const guide = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
  assert.ok(guide.endsWith('\n'), 'the fixture for this only works on a file that ends in a newline');
  const { findings } = check(ROOT);
  assert.ok(
    !findings.some((f) => f.path === 'CONTRIBUTING.md'),
    'a file ending in a newline was measured one line long',
  );
});

// The gate reads the tracked tree, so a file nobody has added yet is invisible to it,
// exactly as it is to the anchors gate. Pinned because the failure mode is a local pass
// and a red build, which is the most expensive way to find out.
test('the file list comes from git rather than from a directory walk', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert.ok(tracked.includes('scripts/check-sizes.mjs'), 'this gate must be tracked to be scanned');
  assert.ok(!tracked.includes(VIEW), 'the fixtures above stop being fixtures the moment this path is real');
});

// The tracking artifacts are a dated record and are not ours to re-aim, which is the
// same exemption the lint configuration makes by glob. Nothing in them states a size in
// a spelling this reads today, so the rule is tested for what it does: a test that only
// asserted no finding came from there would pass with the rule deleted.
test('the tracking artifacts are out of scope', () => {
  assert.equal(scanned('.copilot-tracking/plans/2026-08-03/marvel-reading-tracker-plan.md'), false);
  assert.equal(scanned('.copilot-tracking/research/x.md'), false);
  assert.equal(scanned('docs/copilot-tracking-notes.md'), true, 'the rule anchors at the start of the path');
  const { findings } = check(ROOT);
  assert.ok(!findings.some((f) => f.file.startsWith('.copilot-tracking/')), 'a dated artifact was read as a live claim');
});

// The anchors lock stores truncated head text for fingerprinted lines, including generated
// copies of historical size statements that read as live claims. No prose edit can settle
// those copies because only a bless rewrites them. Unlike the exclusion above, this one is
// load-bearing today, so it is tested both ways.
test('generated data is not read as prose', () => {
  assert.equal(scanned('docs/anchors.lock.json'), false);
  assert.equal(scanned('package.json'), false);
  assert.equal(scanned('PRODUCT_BACKLOG.md'), true);

  const raw = readFileSync(join(ROOT, 'docs/anchors.lock.json'), 'utf8');
  const echoed = [...raw.matchAll(/\b(?:is|of)\s+([\d][\d,]*)\s+lines\b/g)];
  assert.ok(echoed.length > 0, 'the lock no longer echoes a size statement, so this exclusion has nothing to defend');
  assert.match(
    raw,
    /1,566 lines(?![^"]*sizes:frozen)[^"]*"/,
    'every echoed size statement now carries its frozen marker, so the exclusion has nothing to defend',
  );

  const { findings } = check(ROOT);
  assert.ok(!findings.some((f) => f.file.endsWith('.json')), 'a data file was read as prose');
});
