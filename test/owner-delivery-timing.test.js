import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  beginDelivery, deliveryPhase, qualifyMergedDelivery, runDeliveryCommand, summarizeDelivery,
} from '../scripts/owner-guide.mjs';

const input = { name: 'owner-input.md', sha256: 'a'.repeat(64), bytes: 25 };
const merge = (at) => ({
  state: 'MERGED', mergedAt: at, url: 'https://github.com/raymond-nassar/recap-page/pull/1000',
  headRefOid: '1'.repeat(40), mergeCommit: { oid: '2'.repeat(40) },
});

test('the strict hour clock includes earlier preparation and every external wait through actual merge', () => {
  let clock = beginDelivery({ handedAt: '2026-10-07T00:00:00Z', recordedAt: '2026-10-07T00:05:00Z', input });
  clock = deliveryPhase(clock, { at: '2026-10-07T00:10:00Z', phase: 'authority', kind: 'metadata-or-clarification-wait' });
  clock = deliveryPhase(clock, { at: '2026-10-07T00:20:00Z', phase: 'validation', kind: 'active' });
  clock = deliveryPhase(clock, { at: '2026-10-07T00:30:00Z', phase: 'hosted-checks', kind: 'hosted-check-wait' });
  clock = deliveryPhase(clock, { at: '2026-10-07T00:40:00Z', phase: 'owner-merge-wait', kind: 'owner-or-app-wait' });
  const justUnder = summarizeDelivery(clock, merge('2026-10-07T00:59:59.999Z'));
  assert.equal(justUnder.targetMet, true);
  assert.equal(justUnder.elapsedSeconds, 3599.999);
  assert.deepEqual(justUnder.secondsByKind, {
    unclassified: 300, active: 900, 'metadata-or-clarification-wait': 600,
    'hosted-check-wait': 600, 'owner-or-app-wait': 1199.999,
  });
  assert.equal(summarizeDelivery(clock, merge('2026-10-07T01:00:00Z')).targetMet, false);
  assert.equal(summarizeDelivery(clock, merge('2026-10-07T01:00:01Z')).targetMet, false);
  const waiting = summarizeDelivery(clock, { state: 'OPEN' }, '2026-10-07T00:50:00Z');
  assert.equal(waiting.status, 'awaiting-actual-merge');
  assert.equal(waiting.targetMet, false, 'A sub-hour ready PR is not a merged guide.');
  assert.equal(waiting.elapsedSeconds, 3000);
  const differentMerge = qualifyMergedDelivery(justUnder, {
    validatedTree: 'a'.repeat(40), headTree: 'a'.repeat(40), mergedTree: 'b'.repeat(40),
  });
  assert.equal(differentMerge.status, 'merged-unverified');
  assert.equal(differentMerge.targetMet, false);
  assert.equal(differentMerge.elapsedSeconds, 3599.999, 'A verification blocker does not erase actual elapsed time.');
  assert.ok(differentMerge.blockers.length);
});

test('missing handoff, malformed merge and backwards event times cannot fabricate completion', () => {
  assert.throws(() => beginDelivery({ input }), /timestamp/);
  const clock = beginDelivery({ handedAt: '2026-10-07T00:00:00Z', recordedAt: '2026-10-07T00:05:00Z', input });
  assert.throws(() => deliveryPhase(clock, { at: '2026-10-06T23:59:00Z', phase: 'authoring', kind: 'active' }), /backwards/);
  assert.equal(summarizeDelivery(clock, { state: 'MERGED' }, '2026-10-07T00:10:00Z').targetMet, false);
});

test('native receipts preserve argv, stderr-writing success, failure and spawn failure without shell quoting', async (t) => {
  const logDir = await mkdtemp(path.join(tmpdir(), 'delivery-command-'));
  t.after(() => rm(logDir, { recursive: true, force: true }));
  const success = await runDeliveryCommand({
    name: 'success', executable: process.execPath,
    args: ['-e', 'process.stderr.write("routine warning"); process.stdout.write(process.argv[1]);', 'a spaced argument & literal'],
    cwd: logDir, logDir,
  });
  assert.equal(success.success, true);
  assert.equal(success.exitCode, 0);
  assert.equal(success.args.at(-1), 'a spaced argument & literal');
  const failure = await runDeliveryCommand({
    name: 'failure', executable: process.execPath, args: ['-e', 'process.exitCode = 7'], cwd: logDir, logDir,
  });
  assert.equal(failure.success, false);
  assert.equal(failure.exitCode, 7);
  const unavailable = await runDeliveryCommand({
    name: 'missing', executable: path.join(logDir, 'absent-executable'), args: [], cwd: logDir, logDir,
  });
  assert.equal(unavailable.success, false);
  assert.equal(unavailable.spawnError, 'ENOENT');
  assert.equal((await readdir(logDir)).filter((name) => name.endsWith('.json')).length, 3);
});

test('the actual intake CLI preserves private bytes, creates an unapproved request and refuses clock resets', async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'owner intake-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const markdown = path.join(work, 'a spaced & named input.md');
  const body = Buffer.from('# Selected originals\r\n\r\n1. Sample Comic (2020) #1\r\n');
  await writeFile(markdown, body);
  const script = fileURLToPath(new URL('../scripts/owner-guide.mjs', import.meta.url));
  const run = (extra = [], handedAt = '2000-01-01T00:00:00Z') => spawnSync(process.execPath, [
    script, 'intake', `--work=${work}`, `--markdown=${markdown}`,
    `--handed-at=${handedAt}`, ...extra,
  ], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'needs-resolution');
  assert.ok(!first.stdout.includes(work));
  const clockText = await readFile(path.join(work, 'clock.json'), 'utf8');
  const clock = JSON.parse(clockText);
  assert.deepEqual(await readFile(path.join(work, `original-${clock.input.sha256}.md`)), body);
  const request = JSON.parse(await readFile(path.join(work, 'request.json'), 'utf8'));
  assert.equal(request.id, null);
  assert.deepEqual(request.selections, []);
  assert.equal(run(['--scope=full']).status, 2, 'unknown options must not silently run a different workflow');
  assert.equal(run([], '2001-01-01T00:00:00Z').status, 2);
  assert.equal(await readFile(path.join(work, 'clock.json'), 'utf8'), clockText);
});
