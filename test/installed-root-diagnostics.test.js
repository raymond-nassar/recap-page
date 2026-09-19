import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForSettledRoots } from '../scripts/msix-proof.mjs';

test('installed lifecycle diagnostics retain exact count acceptance and the existing deadline', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'recap-root-counts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputs = [];
  const timeout = new Error('bounded fixture timeout');
  for (const [text, expected] of [
    [undefined, 'present=0 parsed=0 started=unknown ended=unknown'],
    ['started=1\nended=1\n', 'present=1 parsed=1 started=1 ended=1'],
    ['started=2\nended=1\n', 'present=1 parsed=1 started=2 ended=1'],
    ['PRIVATE untrusted text', 'present=1 parsed=0 started=unknown ended=unknown'],
  ]) {
    if (text !== undefined) writeFileSync(join(root, 'counts.txt'), text);
    const waiter = async (check, message, deadline) => {
      assert.equal(message, 'native activation lifecycle did not settle');
      assert.equal(deadline, 30000);
      assert.equal(await check(), false);
      throw timeout;
    };
    await assert.rejects(waitForSettledRoots(2, () => {}, root, waiter, (text) => outputs.push(text)),
      (error) => error === timeout);
    assert.equal(outputs.at(-1),
      `DIAG installed-root-wait expected=2 ${expected} observer_alive=1`);
  }
  writeFileSync(join(root, 'counts.txt'), 'started=2\nended=2\n');
  const before = outputs.length;
  assert.equal(await waitForSettledRoots(2, () => {}, root, async (check) => check(),
    (text) => outputs.push(text)), true);
  assert.equal(outputs.length, before);
  assert.doesNotMatch(outputs.join('\n'), /PRIVATE|counts\.txt|recap-root-counts/);
  const source = readFileSync(new URL('../scripts/msix-proof.mjs', import.meta.url), 'utf8');
  assert.match(source, /waitForSettledRoots: \(count\) => waitForSettledRoots\(count, assertAlive, root\)/);
});
