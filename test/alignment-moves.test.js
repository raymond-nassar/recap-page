import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignmentMarkdown, alignmentMoves, profileLabel } from '../scripts/alignment-moves.mjs';

// #832 item 1 (UX-33). The record of what the alignment owner's watched elements did between a pull
// request's base and its head. It never gates, so its whole value is in listing every move with its
// size, and in saying so rather than staying quiet when the two sides cannot be compared.

const box = (top, left = 0) => ({ left, right: left + 100, top, bottom: top + 40, width: 100, height: 40 });
const node = (selector, top, extra = {}) => ({ selector, box: box(top), text: 'RECAP PAGE!', font: '28px', clipped: [], ...extra });
const evidence = (profile, snapshots) => ({ profile, snapshots });
const page = (nodes, extra = {}) => ({ nodes, rootWidth: 360, scrollWidth: 360, inner: { width: 360 }, visual: { width: 360 }, active: '', body: '16px', ...extra });
const A02 = { id: 'A02', width: 360, height: 800, theme: 'dark', populated: true };

test('a move larger than the owner\'s 1px tolerance is listed with its size, and a smaller one is not', () => {
  const base = { A02: evidence(A02, { home: page([node('.home-lockup', 100), node('#home-h', 120)]) }) };
  const head = { A02: evidence(A02, { home: page([node('.home-lockup', 106), node('#home-h', 120.8)]) }) };
  const result = alignmentMoves(base, head);
  assert.deepEqual(result.moves, [{ id: 'A02', state: 'home', selector: '.home-lockup', deltas: { top: 6, bottom: 6 } }]);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.unmatched, []);
  const markdown = alignmentMarkdown(result, { labels: { A02: profileLabel(base.A02) }, baseSha: 'abc123', baseExit: '0', headExit: '1' });
  assert.match(markdown, /^\| A02 \(360x800 dark\) \| home \| `\.home-lockup` \| top \+6, bottom \+6 \|$/m);
  assert.match(markdown, /compared with its base `abc123`/);
  assert.match(markdown, /The base's baseline pass exited 0, and the head's own comparison against it exited 1\./);
});

test('other watched properties are compared exactly, as the owner compares them', () => {
  const base = { A02: evidence(A02, { home: page([node('#home-h', 100)]) }) };
  const head = { A02: evidence(A02, { home: page([node('#home-h', 100, { font: '30px', clipped: ['PAGE'] })], { scrollWidth: 380 }) }) };
  const { moves, changes } = alignmentMoves(base, head);
  assert.deepEqual(moves, []);
  assert.deepEqual(changes.map(({ selector, key }) => `${selector} ${key}`), ['page scrollWidth', '#home-h font', '#home-h clipped']);
  assert.match(alignmentMarkdown({ moves, changes, unmatched: [] }), /^\| A02 \| home \| `#home-h` \| font \| 28px \| 30px \|$/m);
  // A backslash at the end of a cell would otherwise escape the bar that closes it.
  const family = [{ id: 'A02', state: 'home', selector: '#home-h', key: 'family', base: 'Impact\\', head: 'a|b' }];
  assert.match(alignmentMarkdown({ moves: [], changes: family, unmatched: [] }), /^\| A02 \| home \| `#home-h` \| family \| Impact\\\\ \| a\\\|b \|$/m);
});

test('anything only one side recorded is reported as not compared, never dropped', () => {
  const base = {
    A01: evidence({ id: 'A01' }, { home: page([]) }),
    A02: evidence(A02, { home: page([node('.home-lockup', 100)]), reading: page([]) }),
  };
  const head = { A02: evidence(A02, { home: page([node('#home-categories', 300)]) }) };
  const { moves, unmatched } = alignmentMoves(base, head);
  assert.deepEqual(moves, []);
  assert.deepEqual(unmatched, [
    { id: 'A01', what: 'recorded by the base only' },
    { id: 'A02', state: 'home', selector: '.home-lockup', what: 'recorded by the base only' },
    { id: 'A02', state: 'home', selector: '#home-categories', what: 'recorded by the head only' },
    { id: 'A02', state: 'reading', what: 'recorded by the base only' },
  ]);
  const markdown = alignmentMarkdown({ moves, changes: [], unmatched }, { baseExit: 'skipped' });
  assert.match(markdown, /No watched element moved more than 1px\./);
  assert.match(markdown, /- A02 home `#home-categories`: recorded by the head only/);
  assert.match(markdown, /The base's baseline pass did not run\./);
});

test('the command writes its record beside the summary it prints, and never fails', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'recap-moves-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [side, top] of [['base', 100], ['head', 104]]) {
    mkdirSync(join(dir, side));
    writeFileSync(join(dir, side, 'A02.json'), JSON.stringify(evidence(A02, { home: page([node('.home-lockup', top)]) })));
  }
  const script = fileURLToPath(new URL('../scripts/alignment-moves.mjs', import.meta.url));
  const printed = execFileSync(process.execPath, [script, `--base=${join(dir, 'base')}`, `--head=${join(dir, 'head')}`, `--out=${join(dir, 'record')}`], { encoding: 'utf8' });
  assert.match(printed, /`\.home-lockup` \| top \+4, bottom \+4 \|/);
  assert.equal(readFileSync(join(dir, 'record', 'alignment-moves.md'), 'utf8'), printed);
  assert.equal(JSON.parse(readFileSync(join(dir, 'record', 'alignment-moves.json'), 'utf8')).moves.length, 1);
  const missing = execFileSync(process.execPath, [script, `--base=${join(dir, 'absent')}`, `--head=${join(dir, 'head')}`], { encoding: 'utf8' });
  assert.match(missing, /The base recorded no alignment evidence, so nothing could be compared\./);
});
