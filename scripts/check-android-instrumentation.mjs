import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_CLASS = 'io.github.raymondnassar.recappage.prototype.NativeIntegrationTest';
export const NATIVE_METHODS = [
  'startupAndPersistence',
  'systemPickerSaveAndCancel',
  'providerRoundTripAndWriteFailure',
  'readerPopupAndExternalIntent',
  'backAndRecreation',
  'fontRotationAndKeyboard',
];

export function parseInstrumentation(source) {
  const results = [];
  const started = new Set();
  const finished = new Set();
  let status = {};
  let field = null;
  let exitCode = null;
  for (const line of source.split(/\r?\n/)) {
    const pair = /^INSTRUMENTATION_STATUS: ([^=]+)=(.*)$/.exec(line);
    const code = /^INSTRUMENTATION_STATUS_CODE: (-?\d+)$/.exec(line);
    const exit = /^INSTRUMENTATION_CODE: (-?\d+)$/.exec(line);
    if (pair) {
      field = pair[1];
      status[field] = pair[2];
    } else if (code) {
      const value = Number(code[1]);
      const id = `${status.class}#${status.test}`;
      if (value === 1) {
        assert.ok(status.class && status.test && !started.has(id), `Invalid or duplicate test start: ${id}`);
        started.add(id);
      } else {
        assert.ok([0, -1, -2, -3, -4].includes(value), `Unsupported instrumentation status: ${value}`);
        assert.ok(started.has(id) && !finished.has(id), `Test completion without one start: ${id}`);
        finished.add(id);
        results.push({ className: status.class, name: status.test, code: value, message: status.stack || status.stream || '', declaredCount: Number(status.numtests) });
      }
      status = {};
      field = null;
    } else if (exit) {
      assert.equal(exitCode, null, 'Multiple instrumentation terminal results');
      exitCode = Number(exit[1]);
      field = null;
    } else if (field && !line.startsWith('INSTRUMENTATION_')) {
      status[field] += `\n${line}`;
    }
  }
  assert.equal(exitCode, -1, 'Instrumentation did not finish successfully');
  assert.ok(results.length > 0, 'Instrumentation ran no tests');
  assert.equal(started.size, finished.size, 'Instrumentation left a test incomplete');
  return results;
}

export function verifyInstrumentation(source, { methods = NATIVE_METHODS, expectedFailure = null } = {}) {
  const results = parseInstrumentation(source);
  assert.deepEqual(results.map((test) => `${test.className}#${test.name}`).sort(),
    methods.map((name) => `${NATIVE_CLASS}#${name}`).sort(), 'Discovered native tests differ from the requested exact method set');
  for (const test of results) {
    assert.equal(test.declaredCount, methods.length, 'Runner discovery count differs from expected method count');
    if (expectedFailure) {
      assert.ok(test.code === -1 || test.code === -2, 'The native negative control unexpectedly passed or skipped');
      assert.ok(test.message.includes(expectedFailure), `Negative control failed for the wrong reason: ${test.message}`);
    } else {
      assert.equal(test.code, 0, `${test.name} failed or skipped: ${test.message}`);
    }
  }
  return results;
}

const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[character]));

async function main() {
  const [input, output, selected = 'all', marker] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: check-android-instrumentation.mjs input.log output.json [method|all] [expected-failure-marker]');
  const source = await readFile(input, 'utf8');
  const methods = selected === 'all' ? NATIVE_METHODS : [selected];
  assert.ok(methods.every((method) => NATIVE_METHODS.includes(method)), 'Unknown requested native method');
  const results = parseInstrumentation(source);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify({ mode: marker ? 'negative-control' : 'positive', tests: results }, null, 2)}\n`);
  const cases = results.map((test) => `<testcase classname="${xml(test.className)}" name="${xml(test.name)}">${test.code === 0 ? '' : `<failure message="${xml(test.message)}"/>`}</testcase>`).join('\n');
  await writeFile(`${output}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Android native integration" tests="${results.length}" failures="${results.filter((test) => test.code !== 0).length}" errors="0" skipped="0">\n${cases}\n</testsuite>\n`);
  verifyInstrumentation(source, { methods, expectedFailure: marker || null });
  console.log(`${marker ? 'Expected negative control observed' : 'Native tests passed'}: ${results.map((test) => test.name).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
