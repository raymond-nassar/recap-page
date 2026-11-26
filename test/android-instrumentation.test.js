import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import {
  NATIVE_CLASS, NATIVE_METHODS, verifyInstrumentation, captureNativeFailure, nativeFailureContext,
  readNativeFailure, validateNativeFailure, finalizeNativeFailure, NATIVE_FAILURE_FILE,
} from '../scripts/check-android-instrumentation.mjs';

async function failureFixture(root, runId = 123) {
  const sha = 'a'.repeat(40);
  const env = { ...process.env, RUNNER_TEMP: root, RECAP_ANDROID_MODE: 'Rehearsal',
    GITHUB_REPOSITORY: 'raymond-nassar/recap-page', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha, RECAP_ANDROID_SOURCE_SHA: sha,
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: 'refs/heads/failure-fixture',
    GITHUB_WORKFLOW_REF: 'raymond-nassar/recap-page/.github/workflows/ci.yml@refs/heads/failure-fixture',
    RECAP_NATIVE_EMULATOR_PID: String(process.pid), RECAP_NATIVE_TARGET: 'io.github.raymondnassar.recappage.prototype' };
  const work = join(root, `recap-aab-${runId}-1`);
  await mkdir(join(work, 'native-evidence'), { recursive: true });
  await writeFile(join(work, '.owner'), `${runId}:1`);
  await writeFile(join(work, 'version.json'), JSON.stringify({ identity: { schemaVersion: 1,
    productVersion: '3.1.0', platform: 'android', packageVersion: 3000002, channel: 'development',
    sourceRevision: sha, sourceTree: 'b'.repeat(40), sourceDirty: false } }));
  return { env, work };
}

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

test('native result verification requires the exact complete suite', () => {
  assert.equal(verifyInstrumentation(output()).length, NATIVE_METHODS.length);
  assert.equal(verifyInstrumentation(output([...NATIVE_METHODS].reverse())).length, NATIVE_METHODS.length);
  for (const invalid of [
    '',
    'INSTRUMENTATION_CODE: -1\n',
    output(NATIVE_METHODS.slice(1)),
    output([...NATIVE_METHODS, NATIVE_METHODS[0]]),
    output().replaceAll(NATIVE_CLASS, 'some.other.Test'),
    output().replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'),
    output().replace('INSTRUMENTATION_CODE: -1\n', ''),
    output(NATIVE_METHODS, { declared: NATIVE_METHODS.length - 1 }),
    output().replace('INSTRUMENTATION_STATUS_CODE: 0', 'INSTRUMENTATION_STATUS_CODE: 1'),
  ]) assert.throws(() => verifyInstrumentation(invalid));
});

test('native result verification refuses failure, error, ignored and assumption-skipped cases', async (t) => {
  for (const code of [-1, -2, -3, -4, 2]) {
    assert.throws(() => verifyInstrumentation(output(NATIVE_METHODS, { code })));
  }
  const root = await mkdtemp(join(tmpdir(), 'recap-native-capsule-'));
  const original = childProcess.spawnSync;
  try {
    const { env, work } = await failureFixture(root);
    const app = 'io.github.raymondnassar.recappage.prototype';
    const phase = 'prototype-seed';
    await writeFile(join(work, 'native-evidence', `${phase}.log`),
      `INSTRUMENTATION_STATUS: class=${NATIVE_CLASS}\nINSTRUMENTATION_STATUS: test=startupAndPersistence\n`
      + 'INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: 1\n'
      + 'PRIVATE_TOKEN /home/private/keystore.p12\u001b[31m\n');
    await writeFile(join(work, 'native-evidence', 'emulator.log'), 'PANIC: PRIVATE_HOST_PATH');
    const calls = [];
    childProcess.spawnSync = (file, args, options) => {
      assert.equal(file, 'adb');
      assert.deepEqual(args.slice(0, 2), ['-s', 'emulator-5554']);
      assert.ok(options.timeout <= 5000);
      calls.push(args);
      if (args[2] === 'get-state') return { status: 0, stdout: 'device\n' };
      if (args[2] === 'shell' && args[3].startsWith("printf 'BOOT")) return { status: 0,
        stdout: `BOOT\n1\nPIDS\n321\nUIDS\npackage:${app} uid:10001\npackage:${app}.test uid:10002\nINSTRUMENTATION\n${app}\n` };
      if (args[2] === 'logcat') {
        assert.ok(args.includes('--uid=10001,10002'));
        return { status: 0, stdout: 'FATAL EXCEPTION: PRIVATE_THREAD\njava.lang.IllegalStateException: UiAutomation PRIVATE_SECRET /private/file\n' };
      }
      assert.deepEqual(args.slice(2, 4), ['shell', 'cat']);
      assert.ok(args[4].endsWith('candidate-prototype-seed-startupAndPersistence.json'));
      return { status: 1, stdout: '', stderr: 'PRIVATE_PATH' };
    };
    syncBuiltinESMExports();
    const capsule = await captureNativeFailure([phase, 'startupAndPersistence', '255', '255', '0', '-', '-'], env);
    assert.equal(capsule.qualified, false);
    assert.equal(capsule.primary.exitCode, 255);
    assert.equal(capsule.instrumentation.starts, 1);
    assert.equal(capsule.instrumentation.terminal, false);
    assert.equal(capsule.instrumentation.checker, 'rejected');
    assert.equal(capsule.device.ownedUidCount, 2);
    assert.equal(capsule.device.targetRunning, 'yes');
    assert.ok(capsule.device.crash.excerpts.some((line) => line.includes('UI_AUTOMATION')));
    assert.equal(calls.length, 4);
    assert.doesNotMatch(JSON.stringify(capsule), /PRIVATE_|\/home\/|\/private\/|keystore|signerSha256/);
    const { context } = await readNativeFailure(env);
    for (const change of [
      (v) => { v.qualified = true; },
      (v) => { v.password = 'PRIVATE_SECRET'; },
      (v) => { v.source.revision = 'c'.repeat(40); },
      (v) => { v.primary.exitCode = 0; },
      (v) => { v.targetMatchesPhase = false; },
      (v) => { v.device.ownedUidCount = 0; },
      (v) => { v.shutdown.adbExit = 0; },
      (v) => { v.device.crash.excerpts = ['PRIVATE_SECRET']; },
      (v) => { v.receipts[0].certificate = 'PRIVATE_SECRET'; },
      (v) => { v.instrumentation.excerpts = ['x'.repeat(256 * 1024)]; },
    ]) {
      const changed = structuredClone(capsule);
      change(changed);
      assert.throws(() => validateNativeFailure(changed, context.source));
    }
    await assert.rejects(nativeFailureContext({ ...env, RECAP_ANDROID_MODE: 'Candidate' }), /Rehearsal only/);
    await assert.rejects(nativeFailureContext({ ...env, RUNNER_TEMP: 'relative' }), /temporary root/);
    await finalizeNativeFailure(['0', '1', '0'], env);
    assert.equal((await readNativeFailure(env)).capsule.shutdown.state, 'attempted');
    const validBytes = await readFile(context.path);
    await writeFile(context.path, Buffer.alloc(256 * 1024 + 1));
    await assert.rejects(readNativeFailure(env), /file bound/);
    await writeFile(context.path, validBytes);
    await writeFile(join(work, '.owner'), 'wrong-owner');
    await assert.rejects(readNativeFailure(env));
    await writeFile(join(work, '.owner'), '123:1');
    const moved = join(root, 'moved-owned-work');
    await rename(work, moved);
    await symlink(moved, work, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(readNativeFailure(env), /symlink/);

    const offline = await failureFixture(root, 124);
    await writeFile(join(offline.work, 'native-evidence', `${phase}.log`), '');
    let probes = 0;
    childProcess.spawnSync = () => { probes += 1; return { status: 255, stdout: '', stderr: 'PRIVATE_TRANSPORT' }; };
    syncBuiltinESMExports();
    const absent = await captureNativeFailure([phase, 'startupAndPersistence', '124', '124', '0', '-', '-'], offline.env);
    assert.equal(probes, 1, 'Unavailable device must not trigger repeated adb waits');
    assert.equal(absent.device.state, 'unavailable');
    assert.equal(absent.primary.exitCode, 124);
    const lost = await failureFixture(root, 125);
    let lossCalls = 0;
    childProcess.spawnSync = () => {
      lossCalls += 1;
      return lossCalls === 1 ? { status: 0, stdout: 'device\n' }
        : { status: 1, stdout: '', stderr: 'error: device offline PRIVATE_VALUE' };
    };
    syncBuiltinESMExports();
    const disconnected = await captureNativeFailure([phase, 'startupAndPersistence', '255', '255', '0', '-', '-'], lost.env);
    assert.equal(lossCalls, 2, 'Device loss during capture must stop later guest requests');
    assert.equal(disconnected.device.liveness.reason, 'device-unavailable');
    assert.doesNotMatch(JSON.stringify(disconnected), /PRIVATE_/);
    t.diagnostic('Reporter: targeted capture 4 adb calls; unavailable device 1; mid-capture device loss 2; schema/path/size/redaction rejected invalid inputs.');
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
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

test('native restore confirms the current reading-data dialog before checking success', () => {
  const source = readFileSync(new URL('../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/NativeIntegrationTest.java', import.meta.url), 'utf8');
  const restore = source.slice(source.indexOf('tap(web, "#restore-file");'), source.indexOf('assertFixture();', source.indexOf('tap(web, "#restore-file");')));
  assert.match(restore, /#ask\[open\][\s\S]*Replace reading data with this backup\?/);
  assert.match(restore, /assertEquals\([^;]*0,[^;]*listOrder\.length/);
  assert.match(restore, /tap\(web, "#ask-ok"\);[\s\S]*Reading data restored\./);
  assert.doesNotMatch(restore, /includes\('Restored\.'\)/);
});

test('native Back journey reveals auto-hidden navigation before the trusted More tap', () => {
  const source = readFileSync(new URL('../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/NativeIntegrationTest.java', import.meta.url), 'utf8');
  const back = source.slice(source.indexOf('public void backAndRecreation()'), source.indexOf('public void fontRotationAndKeyboard()'));
  assert.match(back, /window\.scrollTo\(0, ?0\)[\s\S]*waitFor\([^;]*mobile-nav-hidden[^;]*;[\s\S]*tap\(web, "#btn-rail-toggle"\)/);
  assert.match(back, /device\.pressBack\(\);[\s\S]*Navigation dismissal does not consume history/);
});

const INSTRUMENTATION_SOURCE = new URL('../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/NativeIntegrationTest.java', import.meta.url);
const ACTIVITY_SOURCE = new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java', import.meta.url);

function between(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) return null;
  const to = source.indexOf(end, from + start.length);
  return to < 0 ? null : source.slice(from, to);
}

// Candidate 44984763193 failed when the generic tap helper asked a popup the tap had just closed whether
// it saw a click: a destroyed WebView never answers. These checks keep the expected close confined to
// the two browser handoffs that cause it, and keep every other tap proving its click from the page.
function popupHandoffFindings(java, activity) {
  const findings = [];
  const require = (ok, finding) => { if (!ok) findings.push(finding); };
  const tapBody = between(java, 'private void tap(WebView target, String selector, PopupHandoff handoff)',
    'private void recordDeliveredTap(');
  const verify = between(java, 'private void verifyPopupHandoff(', 'private void tap(WebView target, String selector, PopupHandoff handoff)');
  const closingTap = between(java, 'private void tapClosingPopup(', 'private void observePopupNavigations(');
  const observer = between(java, 'private void observePopupNavigations(', 'private void verifyPopupHandoff(');
  const diagnostics = between(java, 'private void captureTapDiagnostics()', '\n    }\n');
  if (!tapBody || !verify || !closingTap || !observer || !diagnostics) return ['closing-tap helpers are missing'];
  const poll = between(tapBody, 'waitFor(handoff == null', '\n            });');
  const after = between(tapBody, 'if (handoff == null) {', '} catch (Exception | Error error)');
  const ordinary = after && after.slice(0, after.indexOf('} else {'));
  const closing = after && after.slice(after.indexOf('} else {'));
  if (!poll || !ordinary || !closing || !after.includes('} else {')) {
    return ['tap does not separate ordinary taps from the popup-closing handoff'];
  }

  require(/private void tap\(WebView target, String selector\) throws Exception \{\s*tap\(target, selector, null\);\s*\}/.test(java),
    'ordinary taps do not take the ordinary path');
  // Both kinds of tap must first prove one short touchscreen DOWN and UP. Only then may a closing tap
  // look for its popup to go, and every other tap must still hear a trusted click from the page.
  require(/recordDeliveredTap\(delivered\);\s*if \(!delivered\.complete\(\)\) return false;\s*assertTrue\([^;]*delivered\.shorterThan\(longPressThreshold\)\);\s*if \(handoff != null\) return !popupViews\(\)\.contains\(target\);\s*return truth\(target, "window\.__nativeTap\.events\.some\(e=>e\.type==='click' && e\.trusted && e\.onTarget\)"\);\s*$/.test(poll),
    'the tap wait no longer proves delivery before the closing check and a trusted click otherwise');
  require(/assertTrue\("Real pointer DOWN and UP reach " \+ selector, truth\(target,\s*"\['pointerdown','pointerup'\]\.every\(type=>window\.__nativeTap\.events\.some\("\s*\+ "e=>e\.type===type && e\.trusted && e\.onTarget\)\)"\)\);/.test(ordinary),
    'ordinary taps no longer require trusted pointer DOWN and UP');
  require(/assertFalse\("A short tap must not open text selection", truth\(target,\s*"window\.__nativeTap\.events\.some\(e=>e\.type==='contextmenu'\)"\)\);/.test(ordinary),
    'ordinary taps no longer reject a context menu');
  require(!/isAttachedToWindow/.test(tapBody), 'the tap accepts a detached WebView in place of evidence');
  require(!/return true;/.test(poll), 'a tap can succeed without evidence');
  require((tapBody.match(/setSource\(InputDevice\.SOURCE_TOUCHSCREEN\)/g) || []).length === 2
    && /injectInputEvent\(down, false\)/.test(tapBody) && /injectInputEvent\(up, false\)/.test(tapBody)
    && /MotionEvent\.obtain\(downTime, upTime, MotionEvent\.ACTION_UP, x, y, 0\)/.test(tapBody),
  'the tap no longer injects one touchscreen DOWN and UP at the measured point');
  require(/^\} else \{\s*verifyPopupHandoff\(target, handoff, delivered\);\s*\}\s*$/.test(closing)
    && !/\b(evaluate|truth|asyncJs|text)\(/.test(verify),
  'the closing tap questions a WebView it has closed or skips the handoff check');
  const verifyChecks = [
    [/assertEquals\([^;]*1, seen\.size\(\)\)/, 'exactly one navigation'],
    [/assertEquals\([^;]*handoff\.url, navigation\.url\)/, 'the exact navigation address'],
    [/assertTrue\([^;]*navigation\.mainFrame\)/, 'a main-frame navigation'],
    [/assertTrue\([^;]*navigation\.gesture\)/, 'the user gesture of a trusted tap'],
    [/navigation\.at >= delivered\.snapshot\(\)\[1\]/, 'a navigation after the delivered UP'],
    [/assertEquals\([^;]*1, added\.size\(\)\)/, 'exactly one new intent'],
    [/assertEquals\([^;]*Intent\.ACTION_VIEW, intent\.getAction\(\)\)/, 'a view intent'],
    [/assertEquals\([^;]*handoff\.url, intent\.getDataString\(\)\)/, 'the exact handed-off address'],
    [/assertEquals\([^;]*handoff\.browserPackage, intent\.getPackage\(\)\)/, 'the expected browser package'],
    [/assertNull\([^;]*intent\.getComponent\(\)\)/, 'no explicit app component'],
    [/assertTrue\([^;]*intent\.hasCategory\(Intent\.CATEGORY_BROWSABLE\)\)/, 'a browsable intent'],
    [/assertFalse\([^;]*popupViews\(\)\.contains\(popup\)\)/, 'a closed popup'],
    [/assertFalse\([^;]*popup\.isAttachedToWindow\(\)\)/, 'a detached popup'],
    [/assertEquals\([^;]*handoff\.stateBefore, stateSummary\(\)\)/, 'unchanged saved reading data'],
  ];
  for (const [pattern, what] of verifyChecks) require(pattern.test(verify), `the handoff check no longer requires ${what}`);
  const order = ['assertTrue("A closing tap starts on a live popup", popupViews().contains(popup));',
    'observePopupNavigations(popup, handoff.navigations);', 'handoff.intentsBefore = Intents.getIntents().size();',
    'handoff.stateBefore = stateSummary();', 'tap(popup, selector, handoff);'].map((step) => closingTap.indexOf(step));
  require(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
    'the closing tap does not record its baseline on a live popup before tapping');
  const client = between(activity, 'private final class AssetClient extends WebViewClient', '\n    }\n');
  const overrides = [...(client || '').matchAll(/@Override\s+public \w+ (\w+)\(/g)].map((match) => match[1]);
  require(overrides.length > 0, 'the production WebView client was not found');
  for (const name of overrides) {
    require(new RegExp(`public \\w+ ${name}\\([\\s\\S]*?delegate\\.${name}\\(view, `).test(observer),
      `the navigation observer does not forward ${name}`);
  }
  require(/seen\.add\(new PopupNavigation\(request\)\);\s*return delegate\.shouldOverrideUrlLoading\(view, request\);/.test(observer),
    'the navigation observer does not record the navigation before the app decides it');
  require(tapBody.includes('if (handoff != null) lastTapRecord.put("closesPopupTo", handoff.url);'),
    'diagnostics cannot tell a closing tap from an ordinary one');
  const quietDiagnostics = between(diagnostics, 'if (lastTapRecord.has("closesPopupTo")) {', '} else if (onMain(() -> lastTapTarget.isAttachedToWindow())) {');
  require(quietDiagnostics !== null && !/\bevaluate\(/.test(quietDiagnostics),
    'diagnostics question a popup the tap closed');
  const threeArgumentTaps = [...java.matchAll(/\btap\(\w+, \w+, \w+\);/g)].map((match) => match[0]).sort();
  require(JSON.stringify(threeArgumentTaps) === JSON.stringify(['tap(popup, selector, handoff);', 'tap(target, selector, null);']),
    `only the closing helper may pass a handoff: ${threeArgumentTaps.join(' ')}`);
  const closingCalls = [...java.matchAll(/(?<!void )\btapClosingPopup\(([^;{]*)\);/g)].map((match) => match[1]);
  require(JSON.stringify(closingCalls) === JSON.stringify([
    'popup, "#fallback", "https://marvel.webtoon.com/", defaultBrowser',
    'popup, "#fallback", escape, "com.android.chrome"',
  ]), `exactly the two browser fallbacks may close their popup: ${closingCalls.join(' | ')}`);
  require(!/\btap\(popup, "#fallback"\)/.test(java), 'a browser fallback still uses an ordinary tap');
  return findings;
}

test('only the two browser fallbacks may close the popup they tap, and they prove the handoff natively', () => {
  const java = readFileSync(INSTRUMENTATION_SOURCE, 'utf8').replace(/\r\n/g, '\n');
  const activity = readFileSync(ACTIVITY_SOURCE, 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(popupHandoffFindings(java, activity), []);
  const mutate = (from, to) => {
    assert.ok(java.includes(from), `mutation anchor is missing: ${from}`);
    return java.replace(from, to);
  };
  const ordinaryClick = 'return truth(target, "window.__nativeTap.events.some(e=>e.type===\'click\' && e.trusted && e.onTarget)");';
  const broken = {
    // The shape of fc077e8c: any detached WebView counts as a delivered click.
    'detachment blessed': mutate('                if (!delivered.complete()) return false;\n                assertTrue(',
      '                if (!delivered.complete()) return false;\n                if (!onMain(() -> target.isAttachedToWindow())) return true;\n                assertTrue('),
    'ordinary click unproved': mutate(ordinaryClick, 'return true;'),
    'closing tap questions the page': mutate('if (handoff != null) return !popupViews().contains(target);',
      'if (handoff != null) return truth(target, "true") && !popupViews().contains(target);'),
    'closing check before delivery': mutate('                if (!delivered.complete()) return false;\n',
      '                if (handoff != null) return !popupViews().contains(target);\n                if (!delivered.complete()) return false;\n'),
    'closing tap skips the handoff check': mutate('verifyPopupHandoff(target, handoff, delivered);\n            }', '}'),
    'ordinary pointers unchecked': mutate('assertTrue("Real pointer DOWN and UP reach " + selector, truth(target,', 'assertTrue("Real pointer DOWN and UP reach " + selector, true || truth(target,'),
    'gesture unchecked': mutate('assertTrue("The navigation carries the user gesture of a trusted tap", navigation.gesture);', ''),
    'any intent count': mutate('1, added.size());', 'added.size(), added.size());'),
    'package unchecked': mutate('assertEquals("The handoff is pinned to the expected browser", handoff.browserPackage, intent.getPackage());', ''),
    'state unchecked': mutate('assertEquals("The handoff does not change saved reading data", handoff.stateBefore, stateSummary());', ''),
    'fallback tapped ordinarily': mutate('tapClosingPopup(popup, "#fallback", escape, "com.android.chrome");', 'tap(popup, "#fallback");'),
    'another tap may close': mutate('tap(web, "#native-app-read");', 'tapClosingPopup(web, "#native-app-read", escape, "com.android.chrome");'),
    'render loss not forwarded': mutate('return delegate.onRenderProcessGone(view, detail);', 'return false;'),
    'diagnostics question the closed popup': mutate('lastTapRecord.put("targetAttached", onMain(() -> lastTapTarget.isAttachedToWindow()));',
      'lastTapRecord.put("observed", evaluate(lastTapTarget, "1"));'),
    'no baseline before the tap': mutate('        handoff.intentsBefore = Intents.getIntents().size();\n        handoff.stateBefore = stateSummary();\n        tap(popup, selector, handoff);',
      '        tap(popup, selector, handoff);\n        handoff.intentsBefore = Intents.getIntents().size();\n        handoff.stateBefore = stateSummary();'),
  };
  for (const [name, source] of Object.entries(broken)) {
    assert.notDeepEqual(popupHandoffFindings(source, activity), [], name);
  }
});

test('Android CI stays explicitly opt-in and uses real offline Android with bounded evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/android-emulator-ci.sh', import.meta.url), 'utf8');
  assert.match(workflow, /android_emulator:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(workflow, /native_mode:[\s\S]*?options: \[none, debug, rehearsal\][\s\S]*?default: none/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' &&\s+\(\(inputs\.native_mode != '' && inputs\.native_mode != 'none'\) \|\|\s+inputs\.android_emulator == true \|\| inputs\.android_rehearsal == true \|\|\s+inputs\.android_rehearsal_source_sha != ''\)/);
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

test('registered CI keeps mutually exclusive manual rehearsal and original debug retention', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const native = workflow.slice(workflow.indexOf('\n  android-emulator:'));
  assert.match(workflow, /android_rehearsal:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(native, /id: native_mode[\s\S]*run: node scripts\/android-candidate\.mjs native-mode/);
  assert.ok(native.indexOf('run: node scripts/android-candidate.mjs native-mode') < native.indexOf('test -c /dev/kvm'));
  assert.match(native, /RECAP_ANDROID_SOURCE_SHA: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(native, /RECAP_ANDROID_MODE: Rehearsal/);
  const env = native.match(/^ {4}env:\r?\n([\s\S]*?)^ {4}steps:/m)?.[1];
  assert.ok(env);
  assert.doesNotMatch(env, /\$\{\{\s*runner\./);
  assert.match(native, /if: always\(\) && steps\.native_mode\.outputs\.mode == 'debug'/);
  assert.match(native, /if: success\(\) && steps\.native_mode\.outputs\.mode == 'rehearsal'/);
  assert.match(native, /run: bash scripts\/android-release-candidate\.sh rehearsal/);
  assert.doesNotMatch(native, /secrets\.|environment:|workflow_call|secrets: inherit/);
  assert.equal([...workflow.matchAll(/^ {2}[\w-]+:\r?$/gm)].filter((match) =>
    ['  test:', '  lint:', '  android-emulator:'].includes(match[0].trimEnd())).length, 3);
});

test('emulator setup retries SDK downloads and installs only the verified tested archive',
  { skip: process.platform === 'win32' }, async () => {
    const runner = readFileSync(new URL('../scripts/android-emulator-ci.sh', import.meta.url), 'utf8');
    const setup = runner.slice(runner.indexOf('SDKMANAGER='), runner.indexOf('{\n  git rev-parse HEAD'));
    const root = await mkdtemp(join(tmpdir(), 'recap-emulator-setup-'));
    try {
      const script = `
set -euo pipefail
SDK="$RUNNER_TEMP/sdk"
rm -rf -- "$SDK/.temp" "$SDK/.downloadIntermediates"
mkdir -p "$SDK/emulator" "$SDK/system-images/android-36/google_apis/x86_64"
printf 'Pkg.Revision = 37.2.11\\n' > "$SDK/emulator/source.properties"
touch "$SDK/emulator/stale-file"
printf 'Pkg.Revision = %s\\n' "$IMAGE_REVISION" > "$SDK/system-images/android-36/google_apis/x86_64/source.properties"
EMULATOR_DOWNLOAD=""
trap 'if [[ -n "$EMULATOR_DOWNLOAD" ]]; then rm -rf -- "$EMULATOR_DOWNLOAD"; fi' EXIT
curl() {
  [[ "$*" == *'--proto =https --tlsv1.2 https://dl.google.com/android/repository/emulator-linux_x64-15917651.zip --output '* ]]
  printf archive > "\${@: -1}"
}
sha256sum() {
  [[ "$*" == '--check --status' ]] || return 1
  read -r checksum archive
  [[ "$checksum" == 95771e0ae431897b2a4bd2d97fa095f29a8b0624a7b216baf529f9306161c266 && -f "$archive" ]] || return 1
  [[ "$CHECKSUM_OK" == true ]] || return 1
  touch "$RUNNER_TEMP/verified"
}
unzip() {
  [[ -f "$RUNNER_TEMP/verified" ]]
  mkdir -p "\${@: -1}/emulator"
  printf 'Pkg.Revision = %s\\n' "$EMULATOR_REVISION" > "\${@: -1}/emulator/source.properties"
}
SDK_ATTEMPTS=0
SDK_SLEEPS=0
sleep() {
  [[ "$*" == 5 ]]
  SDK_SLEEPS=$((SDK_SLEEPS + 1))
}
SDKMANAGER() {
  [[ "$*" == '--channel=0 platforms;android-36 build-tools;35.0.0 system-images;android-36;google_apis;x86_64' ||
     "$*" == '--channel=0 emulator platforms;android-36 build-tools;35.0.0 system-images;android-36;google_apis;x86_64' ]] || return 1
  test ! -e "$SDK/.temp" && test ! -e "$SDK/.downloadIntermediates" || return 24
  SDK_ATTEMPTS=$((SDK_ATTEMPTS + 1))
  printf '%s\\n' "$SDK_ATTEMPTS" > "$RUNNER_TEMP/sdk-attempts"
  printf '%s\\n' "$SDK_SLEEPS" > "$RUNNER_TEMP/sdk-sleeps"
  if [[ "$SDK_ATTEMPTS" -le "$SDK_FAILURES" ]]; then
    mkdir -p "$SDK/.temp" "$SDK/.downloadIntermediates"
    printf '%s\\n' 'Error on ZipFile unknown archive' >&2
    return 23
  fi
}
${setup.replace('"$SDKMANAGER" --channel=0', 'SDKMANAGER --channel=0')}
test ! -e "$SDK/emulator/stale-file"
grep -Fx 'Pkg.Revision = 37.1.11' "$SDK/emulator/source.properties"
`;
      for (const [checksumOk, emulatorRevision, imageRevision, error, sdkFailures = 0] of [
        ['true', '37.1.11', '7', null],
        ['true', '37.1.11', '7', null, 2],
        ['true', '37.1.11', '7', 'Android SDK installation failed after 3 attempts', 3],
        ['false', '37.1.11', '7', 'Android Emulator archive checksum verification failed'],
        ['true', '37.2.11', '7', 'Expected Android Emulator revision 37.1.11'],
        ['true', '37.1.11', '8', 'Expected API 36 Google APIs x86_64 image revision 7'],
      ]) {
        await rm(join(root, 'verified'), { force: true });
        const result = childProcess.spawnSync('bash', ['-c', script], {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: root, CHECKSUM_OK: checksumOk,
            EMULATOR_REVISION: emulatorRevision, IMAGE_REVISION: imageRevision,
            SDK_FAILURES: String(sdkFailures) },
        });
        assert.ifError(result.error);
        assert.equal(result.status, sdkFailures === 3 ? 23 : error ? 1 : 0, result.stderr);
        const attempts = Math.min(sdkFailures + 1, 3);
        assert.equal(await readFile(join(root, 'sdk-attempts'), 'utf8'), `${attempts}\n`);
        assert.equal(await readFile(join(root, 'sdk-sleeps'), 'utf8'), `${attempts - 1}\n`);
        if (!error) {
          const metadata = await readFile(join(root, 'sdk/emulator/package.xml'), 'utf8');
          assert.match(metadata, /<localPackage path="emulator">/);
          assert.match(metadata, /xsi:type="generic:genericDetailsType"/);
          assert.match(metadata, /<revision><major>37<\/major><minor>1<\/minor><micro>11<\/micro><\/revision>/);
        } else {
          assert.ok(result.stderr.includes(error), result.stderr);
          if (sdkFailures === 3) {
            assert.equal(await readFile(join(root, 'verified'), 'utf8').catch(() => null), null,
              'SDK failure must stop before downloading or installing the emulator');
          }
          assert.equal(await readFile(join(root, 'sdk/emulator/source.properties'), 'utf8'), 'Pkg.Revision = 37.2.11\n');
          await readFile(join(root, 'sdk/emulator/stale-file'));
        }
      }
      assert.match(setup, /emulator-linux_x64-15917651\.zip/);
      assert.match(setup, /95771e0ae431897b2a4bd2d97fa095f29a8b0624a7b216baf529f9306161c266/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('derived native mode observes installed packages and probes before any ordinary reseeding', async (t) => {
  const root = '../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/';
  const source = readFileSync(new URL(`${root}NativeIntegrationTest.java`, import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/android-emulator-ci.sh', import.meta.url), 'utf8');
  const nativeTests = [...source.matchAll(/^ {4}@Test\r?\n {4}public void (\w+)\(/gm)].map((match) => match[1]);
  assert.deepEqual(nativeTests.sort(), [...NATIVE_METHODS].sort());
  const tap = source.slice(source.indexOf('private void tap(WebView'), source.indexOf('private JSONObject tapGeometry('));
  const appSource = readFileSync(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /setOnTouchListener/, 'The temporary observer must not replace an application touch listener');
  assert.match(tap, /target\.setOnTouchListener\(/);
  const observer = tap.slice(tap.indexOf('target.setOnTouchListener((view, event)'), tap.indexOf('\n                });', tap.indexOf('target.setOnTouchListener((view, event)')));
  assert.match(observer, /return false;/);
  assert.doesNotMatch(observer, /return true;/);
  assert.match(tap, /event\.isFromSource\(InputDevice\.SOURCE_TOUCHSCREEN\)/);
  assert.match(tap, /SystemClock\.uptimeMillis\(\)/);
  assert.match(tap, /delivered\.shorterThan\(longPressThreshold\)/);
  assert.match(tap, /longPressThreshold = ViewConfiguration\.getLongPressTimeout\(\)/);
  assert.match(tap, /target\.setOnTouchListener\(null\)/);
  assert.match(tap, /return false;/);
  assert.match(tap, /injectInputEvent\(down, false\)/);
  assert.match(tap, /injectInputEvent\(up, false\)/);
  assert.doesNotMatch(tap, /upTime - downTime <=|SystemClock\.sleep|Thread\.sleep|getDeclaredMethod|performClick\(/);
  assert.equal([...tap.matchAll(/\bwaitFor\(/g)].length, 3, 'No additional wait or retry is added to a tap');
  assert.match(tap, /getBoolean\("hitTarget"\)[\s\S]*getBoolean\("windowFocused"\)/);
  assert.match(tap, /\['pointerdown','pointerup'\][\s\S]*e\.trusted && e\.onTarget/);
  assert.match(tap, /assertFalse\("A short tap must not open text selection"/);
  const startup = source.slice(source.indexOf('public void startupAndPersistence()'), source.indexOf('public void systemPickerSaveAndCancel()'));
  assert.ok(startup.indexOf('assertInstallation(role);') < startup.indexOf('if (!restartProbe) seed(false);'));
  assert.match(startup, /if \(installationPhase\.endsWith\("-seed"\)\) seedInstallation\(role\)/);
  const probe = source.slice(source.indexOf('private void assertInstallation('), source.indexOf('private void assertFixture('));
  assert.doesNotMatch(probe, /localStorage\.clear|sessionStorage\.clear|setItem|seedInstallation\(/);
  assert.match(probe, /Independent expected installation state/);
  assert.match(source, /getApkContentsSigners\(\)/);
  assert.match(source, /target\.getApplicationInfo\(\)\.splitSourceDirs/);
  assert.match(source, /protected void succeeded[\s\S]*writeJson\(candidateEvidenceName\(\), candidateReceipt\)/);
  const derived = runner.slice(runner.indexOf('if [[ "$MODE" == derived ]]; then\n  CLASS='), runner.indexOf('SOURCE_BACKUP="$(mktemp)"'));
  assert.match(derived, /install-apks --apks="\$APKS" --device-id="\$ANDROID_SERIAL"/);
  assert.match(runner, /CHECKER="\$ROOT\/scripts\/check-android-instrumentation\.mjs"/);
  assert.match(runner, /timeout --kill-after=1 3 node "\$CHECKER" "\$EVIDENCE\/\$phase\.log"/);
  assert.match(derived, /candidate_instrument official-seed[\s\S]*candidate_instrument prototype-seed[\s\S]*install_derived[\s\S]*candidate_instrument official-probe[\s\S]*candidate_instrument prototype-probe/);
  assert.match(derived, /node "\$CANDIDATE" native-report/);
  assert.doesNotMatch(derived, /\bgradle\b|assembleDebug|pm clear|uninstall/);
  const functions = runner.slice(runner.indexOf('instrument() {'), runner.indexOf('\nif [[ "$MODE" == derived ]]; then\n  CLASS='));
  const cleanup = runner.slice(runner.indexOf('cleanup() {'), runner.indexOf('\ntrap cleanup EXIT'));
  assert.match(functions, /then\n {4}statuses=\("\$\{PIPESTATUS\[@\]\}"\)/);
  assert.match(functions, /else\n {4}statuses=\("\$\{PIPESTATUS\[@\]\}"\)/);
  assert.match(functions, /timeout --kill-after=1 33 node/);
  assert.ok((33 + 1) + (2 + 1) + (3 + 1) + (3 + 1) <= 45);
  const scratch = await mkdtemp(join(tmpdir(), 'recap-native-shell-'));
  const reportUrl = new URL('../scripts/check-android-instrumentation.mjs', import.meta.url).href;
  const shim = join(scratch, 'capture-fixture.mjs');
  await writeFile(shim, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { captureNativeFailure } from ${JSON.stringify(reportUrl)};
childProcess.spawnSync = () => ({ status: 255, stdout: '', stderr: 'synthetic device unavailable' });
syncBuiltinESMExports();
try { await captureNativeFailure(process.argv.slice(2)); }
catch { console.error('Actual capture helper rejected the fixture'); process.exitCode = 1; }
`);
  const fullLog = join(scratch, 'complete.log');
  const partialLog = join(scratch, 'partial.log');
  const receipt = join(scratch, 'receipt.json');
  await writeFile(fullLog, output(['startupAndPersistence']));
  await writeFile(partialLog, `INSTRUMENTATION_STATUS: class=${NATIVE_CLASS}\nINSTRUMENTATION_STATUS: test=startupAndPersistence\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: 1\n`);
  await writeFile(receipt, JSON.stringify({ execution: { phase: 'prototype-seed', method: 'startupAndPersistence',
    packageName: 'io.github.raymondnassar.recappage.prototype', status: 'passed', tests: 1, skipped: 0,
    stateMatched: true, settingsMatched: true, storageCleared: true } }));
  const harness = String.raw`set -euo pipefail
to_shell_path() { if command -v cygpath >/dev/null; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
ROOT="$(to_shell_path "$TEST_ROOT")"
WORK="$(to_shell_path "$TEST_WORK")"
EVIDENCE="$WORK/native-evidence"
NODE_EXE="$(to_shell_path "$TEST_NODE")"
SHIM="$(to_shell_path "$TEST_SHIM")"
FULL_LOG="$(to_shell_path "$TEST_FULL_LOG")"
PARTIAL_LOG="$(to_shell_path "$TEST_PARTIAL_LOG")"
RECEIPT="$(to_shell_path "$TEST_RECEIPT")"
EVENTS="$(to_shell_path "$TEST_EVENTS")"
CHECKER="$ROOT/scripts/check-android-instrumentation.mjs"
MODE=derived
APP=io.github.raymondnassar.recappage.prototype
CLASS="$APP.NativeIntegrationTest"
RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
ANDROID_SERIAL=emulator-5554
SOURCE_BACKUP=""
EMULATOR_PID="$TEST_HOST_PID"
NATIVE_FAILURE_ACTIVE=0
INSTRUMENT_EXIT=0
TEE_EXIT=0
NATIVE_METHODS=(${NATIVE_METHODS.join(' ')})
trace() { printf '%s\n' "$1" >> "$EVENTS"; }
timeout() {
  if [[ "$1" == --kill-after=* ]]; then shift; fi
  local seconds=$1
  shift
  trace "bound:$seconds"
  if [[ "$TEST_SCENARIO" == timeout && "$seconds" == 420 ]]; then return 124; fi
  "$@"
}
adb() {
  if [[ "$1" == -s ]]; then shift 2; fi
  if [[ "$1" == shell && "$2" == am ]]; then
    trace instrument
    if [[ "$TEST_SCENARIO" == exit255 || "$TEST_SCENARIO" == capture ]]; then
      command cat "$PARTIAL_LOG"; return 255
    fi
    command cat "$FULL_LOG"; return 0
  fi
  if [[ "$1" == pull ]]; then
    trace pull
    if [[ "$TEST_SCENARIO" == pull ]]; then return 19; fi
    local destination
    for destination in "$@"; do :; done
    command cp "$RECEIPT" "$destination"; return 0
  fi
  if [[ "$1" == emu && "$2" == kill ]]; then trace cleanup; printf 'OK\n'; return 0; fi
  return 97
}
tee() { command tee "$@"; if [[ "$TEST_SCENARIO" == tee ]]; then return 23; fi; }
node() {
  if [[ "$2" == --capture-native-failure ]]; then
    trace capture
    if [[ "$TEST_SCENARIO" == capture ]]; then return 31; fi
    shift 2
    "$NODE_EXE" "$SHIM" "$@"
    return $?
  fi
  if [[ "$2" == --finalize-native-failure ]]; then trace finalize; "$NODE_EXE" "$@"; return $?; fi
  trace checker
  if [[ "$TEST_SCENARIO" == checker ]]; then return 7; fi
  "$NODE_EXE" "$@"
}
kill() { trace "signal:$*"; return 0; }
wait() { trace wait; return 0; }
sleep() { return 0; }
`;
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
  const outcomes = [['exit255', 255], ['timeout', 124], ['tee', 23], ['checker', 7], ['pull', 19], ['capture', 255], ['success', 0]];
  try {
    for (const [index, [scenario, expectedExit]] of outcomes.entries()) {
      const { env, work } = await failureFixture(scratch, 200 + index);
      const events = join(work, 'events.txt');
      const script = join(work, 'harness.sh');
      await writeFile(script, `${harness}\n${cleanup}\n${functions}\ntrap cleanup EXIT\ncandidate_instrument prototype-seed startupAndPersistence -e installationPhase prototype-seed\ntrace next\n`);
      const result = childProcess.spawnSync(bash, [script], { encoding: 'utf8', timeout: 20000,
        env: { ...env, TEST_SCENARIO: scenario, TEST_ROOT: fileURLToPath(new URL('../', import.meta.url)),
          TEST_WORK: work, TEST_NODE: process.execPath, TEST_SHIM: shim, TEST_FULL_LOG: fullLog,
          TEST_PARTIAL_LOG: partialLog, TEST_RECEIPT: receipt, TEST_EVENTS: events, TEST_HOST_PID: String(process.pid) } });
      assert.equal(result.status, expectedExit, `${scenario}: ${result.stderr}`);
      const trace = await readFile(events, 'utf8');
      assert.equal(trace.includes('next\n'), expectedExit === 0, 'Failure must stop before any next phase');
      assert.equal(trace.split('\n').filter((line) => line === 'cleanup').length, 1);
      assert.ok(trace.split('\n').filter((line) => line === 'instrument').length <= 1);
      if (scenario === 'success' || scenario === 'capture') {
        await assert.rejects(readFile(join(work, NATIVE_FAILURE_FILE)), { code: 'ENOENT' });
        if (scenario === 'capture') assert.match(result.stderr, /capture exit 31.*primary exit remains 255/);
      } else {
        const { capsule } = await readNativeFailure(env);
        assert.equal(capsule.primary.exitCode, expectedExit);
        assert.equal(capsule.qualified, false);
        assert.equal(capsule.shutdown.state, 'attempted');
        assert.equal(capsule.primary.instrumentExit, scenario === 'exit255' ? 255 : scenario === 'timeout' ? 124 : 0);
        assert.equal(capsule.primary.teeExit, scenario === 'tee' ? 23 : 0);
      }
      t.diagnostic(`${scenario}: primary exit ${result.status}; cleanup once; next phase ${expectedExit === 0}; capsule ${scenario !== 'success' && scenario !== 'capture'}`);
    }
    const { env, work } = await failureFixture(scratch, 299);
    const events = join(work, 'events.txt');
    const mutant = functions.replace('    capture_native_failure "$phase" "$method" "$primary" "$checker_exit" "$pull_exit"\n', '');
    assert.notEqual(mutant, functions);
    const script = join(work, 'harness.sh');
    await writeFile(script, `${harness}\n${cleanup}\n${mutant}\ntrap cleanup EXIT\ncandidate_instrument prototype-seed startupAndPersistence\ntrace next\n`);
    const result = childProcess.spawnSync(bash, [script], { encoding: 'utf8', timeout: 20000,
      env: { ...env, TEST_SCENARIO: 'exit255', TEST_ROOT: fileURLToPath(new URL('../', import.meta.url)),
        TEST_WORK: work, TEST_NODE: process.execPath, TEST_SHIM: shim, TEST_FULL_LOG: fullLog,
        TEST_PARTIAL_LOG: partialLog, TEST_RECEIPT: receipt, TEST_EVENTS: events, TEST_HOST_PID: String(process.pid) } });
    assert.equal(result.status, 255);
    await assert.rejects(readNativeFailure(env), { code: 'ENOENT' }, 'Removing failure capture falsifies the required capsule check');
    t.diagnostic('Aimed omission control: removing the failure-capture call breaks the capsule assertion while retaining exit 255.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('native restart evidence ignores the retired summary setting and checks the other settings', async () => {
  const { runInNewContext } = await import('node:vm');
  const root = '../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/';
  const source = readFileSync(new URL(`${root}NativeIntegrationTest.java`, import.meta.url), 'utf8');
  const start = source.indexOf('settingsMatched = truth(web,');
  const end = source.indexOf('assertTrue("Restart preserves', start);
  assert.ok(start >= 0 && end > start);
  const expression = [...source.slice(start, end).matchAll(/"([^"\r\n]*)"/g)]
    .map((match) => match[1]).join('');
  const settings = { covers: false, theme: 'dark', apiBase: 'http://127.0.0.1:9/v1' };
  const matches = (value) => runInNewContext(expression, {
    localStorage: { getItem: (key) => {
      assert.equal(key, 'mrt.settings');
      return JSON.stringify(value);
    } },
  });
  for (const choice of [undefined, true, false, 'unrecognized']) {
    const saved = choice === undefined ? settings : { ...settings, hideDescriptions: choice };
    assert.equal(matches(saved), true, `retired choice ${String(choice)}`);
  }
  for (const changed of [{ covers: true }, { theme: 'light' }, { apiBase: 'http://127.0.0.1:8/v1' }]) {
    assert.equal(matches({ ...settings, ...changed }), false, JSON.stringify(changed));
  }
});
