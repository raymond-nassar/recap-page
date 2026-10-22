import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CREATION_TESTS, creationReceipt } from '../scripts/lib/startup-contract.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILDER = readFileSync(new URL('../scripts/build-native-launcher.ps1', import.meta.url), 'utf8');

function tapCount(tap, name) {
  const matches = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
  assert.equal(matches.length, 1, `TAP output must contain one ${name} summary`);
  return Number(matches[0][1]);
}

test('native creation receipt matches the actual fixed test selection', (t) => {
  const declaration = BUILDER.match(/^[ \t]*\$arguments = '([^'\r\n]+)'$/m);
  assert.ok(declaration, 'the builder must declare its test arguments on one line');
  const args = declaration[1].split(/[ \t]+/);
  assert.deepEqual(args.slice(0, 2), ['--test', '--test-reporter=tap']);

  const selected = args.slice(2).map((path) => path.replaceAll('\\', '/'));
  assert.deepEqual(selected, CREATION_TESTS);
  assert.ok(!selected.includes('test/creation-receipt-sync.test.js'));

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'the selected suite must settle normally');
  assert.equal(result.status, 0, result.stderr);

  const tests = tapCount(result.stdout, 'tests');
  const passed = tapCount(result.stdout, 'pass');
  const receipt = creationReceipt({
    tap: result.stdout,
    exitCode: result.status,
    nodeVersion: 'v24.0.0',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    proofInputDigest: 'c'.repeat(64),
    sources: [],
  });

  assert.equal(receipt.tests, tests);
  assert.equal(receipt.passed, passed);
  t.diagnostic(`creation-receipt-tests=${tests} creation-receipt-passes=${passed}`);
});
