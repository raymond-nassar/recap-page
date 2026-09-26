import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NATIVE_CLASS, NATIVE_METHODS, verifyInstrumentation,
} from '../scripts/check-android-instrumentation.mjs';

function output(methods = NATIVE_METHODS, { code = 0, marker = '', declared = methods.length } = {}) {
  return methods.map((name) => [
    `INSTRUMENTATION_STATUS: class=${NATIVE_CLASS}`,
    `INSTRUMENTATION_STATUS: test=${name}`,
    `INSTRUMENTATION_STATUS: numtests=${declared}`,
    'INSTRUMENTATION_STATUS_CODE: 1',
    `INSTRUMENTATION_STATUS: class=${NATIVE_CLASS}`,
    `INSTRUMENTATION_STATUS: test=${name}`,
    `INSTRUMENTATION_STATUS: numtests=${declared}`,
    ...(marker ? [`INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: ${marker}`, '    at NativeIntegrationTest.test(NativeIntegrationTest.java:1)'] : []),
    `INSTRUMENTATION_STATUS_CODE: ${code}`,
  ].join('\n')).join('\n') + '\nINSTRUMENTATION_CODE: -1\n';
}

test('native result verification requires the exact complete six-method suite', () => {
  assert.equal(verifyInstrumentation(output()).length, 6);
  assert.equal(verifyInstrumentation(output([...NATIVE_METHODS].reverse())).length, 6);
  for (const invalid of [
    '',
    'INSTRUMENTATION_CODE: -1\n',
    output(NATIVE_METHODS.slice(1)),
    output([...NATIVE_METHODS, NATIVE_METHODS[0]]),
    output().replaceAll(NATIVE_CLASS, 'some.other.Test'),
    output().replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'),
    output().replace('INSTRUMENTATION_CODE: -1\n', ''),
    output(NATIVE_METHODS, { declared: 5 }),
    output().replace('INSTRUMENTATION_STATUS_CODE: 0', 'INSTRUMENTATION_STATUS_CODE: 1'),
  ]) assert.throws(() => verifyInstrumentation(invalid));
});

test('native result verification refuses failure, error, ignored and assumption-skipped cases', () => {
  for (const code of [-1, -2, -3, -4, 2]) {
    assert.throws(() => verifyInstrumentation(output(NATIVE_METHODS, { code })));
  }
});

test('the negative control must fail its one aimed native completion assertion', () => {
  const methods = ['providerRoundTripAndWriteFailure'];
  const options = { methods, expectedFailure: 'NATIVE_SAVE_COMPLETION' };
  assert.equal(verifyInstrumentation(output(methods, { code: -2, marker: 'NATIVE_SAVE_COMPLETION' }), options).length, 1);
  assert.throws(() => verifyInstrumentation(output(methods), options), /unexpectedly passed/);
  assert.throws(() => verifyInstrumentation(output(methods, { code: -2, marker: 'Unrelated setup failure' }), options), /wrong reason/);
  assert.throws(() => verifyInstrumentation(output(methods, { code: -3, marker: 'NATIVE_SAVE_COMPLETION' }), options));
  assert.throws(() => verifyInstrumentation(output(['startupAndPersistence'], { code: -2, marker: 'NATIVE_SAVE_COMPLETION' }), options));
});

test('Android CI stays explicitly opt-in and uses real offline Android with bounded evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/android-emulator-ci.sh', import.meta.url), 'utf8');
  assert.match(workflow, /android_emulator:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(workflow, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.android_emulator == true \}\}/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(runner, /system-images;android-36;google_apis;x86_64/);
  assert.match(runner, /iptables -C OUTPUT '!' -o lo -j REJECT/);
  assert.match(runner, /ip6tables -C OUTPUT '!' -o lo -j REJECT/);
  assert.match(runner, /am force-stop "\$APP"/);
  assert.match(runner, /restartProbe true/);
  assert.match(runner, /instrument negative providerRoundTripAndWriteFailure/);
  assert.match(runner, /check-android-instrumentation\.mjs "\$EVIDENCE\/suite\.log"/);
  assert.doesNotMatch(workflow, /path:[\s\S]*outputs\/apk\/debug\/app-debug\.apk/);
  assert.ok(runner.indexOf('cp "$APK" "$EVIDENCE/verified-apk/') > runner.indexOf('node scripts/check-android-instrumentation.mjs "$EVIDENCE/restart-probe.log"'));
  assert.doesNotMatch(runner, /google-atd|aosp-atd|continue-on-error/);
});
