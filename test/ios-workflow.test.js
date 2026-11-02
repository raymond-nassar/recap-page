import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertExportRun, assertInvocation, assertProtection, assertRunHistory } from '../scripts/ios-release.mjs';

// The iOS workflow builds and tests unsigned Simulator builds on every pull request. What makes it
// safe and useful is cheap to lose in a one-line edit: no path filter, no secret, no signing, a
// deadline on every step, and both the newest runtime and the app's oldest supported one. So each
// is held here rather than by the comments beside it. Deadlines follow ci.yml's rule, for its reason:
// a job-level deadline reports an overrun as cancelled, which this repository reads as superseded.

const workflow = readFileSync(new URL('../.github/workflows/ios.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const identity = JSON.parse(readFileSync(new URL('../packaging/ios/identity.json', import.meta.url), 'utf8'));
const RUNNER_OVERHEAD_MINUTES = 1;

function minutes(value) {
  const plain = /^(\d+)\s*(?:#.*)?$/.exec(value.trim());
  return plain ? Number(plain[1]) : { unreadable: value.trim() };
}

// YAML by hand, as ci-deadlines.test.js reads ci.yml, because a parser is a dependency. The last test
// holds this to the file's own count of steps and deadlines, read from the text.
function parseJobs(yml) {
  const jobs = [];
  let inJobs = false;
  let job = null;
  let inSteps = false;
  let step = null;
  const readStepKey = (text) => {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(text);
    if (!pair || !step) return;
    if (pair[1] === 'timeout-minutes') step.timeout = minutes(pair[2]);
    if ((pair[1] === 'name' || pair[1] === 'uses') && step.label === null) step.label = pair[2].trim();
  };
  for (const line of yml.split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    if (!inJobs) continue;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      job = { name: header[1], timeout: null, runsOn: null, env: {}, steps: [] };
      jobs.push(job);
      inSteps = false;
      step = null;
      continue;
    }
    if (!job) continue;
    const jobKey = /^ {4}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (jobKey) {
      inSteps = jobKey[1] === 'steps';
      step = null;
      if (jobKey[1] === 'timeout-minutes') job.timeout = minutes(jobKey[2]);
      if (jobKey[1] === 'runs-on') job.runsOn = jobKey[2].trim();
      continue;
    }
    const envEntry = /^ {6}([A-Z_]+):\s*(.*)$/.exec(line);
    if (!inSteps && envEntry) {
      job.env[envEntry[1]] = envEntry[2].trim();
      continue;
    }
    if (!inSteps) continue;
    const opener = /^ {6}- (.*)$/.exec(line);
    if (opener) {
      step = { label: null, timeout: null };
      job.steps.push(step);
      readStepKey(opener[1]);
      continue;
    }
    const body = /^ {8}(\S.*)$/.exec(line);
    if (body) readStepKey(body[1]);
  }
  return jobs;
}

const jobs = parseJobs(workflow);
const block = (key) => new RegExp(`^${key}:\\n((?: {2}.*\\n|\\s*\\n)*)`, 'm').exec(`${workflow}\n`)?.[1] ?? '';

test('the iOS workflow runs on every pull request with no path filter, on pushes to main and on demand', () => {
  const triggers = block('on').split('\n').filter((line) => line.trim() && !/^\s*#/.test(line));
  assert.deepEqual(triggers.filter((line) => /^ {2}\S/.test(line)).map((line) => line.trim()),
    ['pull_request:', 'push:', 'workflow_dispatch:']);
  assert.deepEqual(triggers.filter((line) => /^ {4}\S/.test(line)).map((line) => line.trim()),
    ['branches: [main]', 'inputs:']);
  assert.doesNotMatch(triggers.join('\n'), /paths|paths-ignore|branches-ignore|types:/);
});

test('the iOS workflow reads the repository and nothing more: no secret, no environment and no signing', () => {
  assert.equal(block('permissions').trim(), 'contents: read');
  assert.doesNotMatch(workflow, /secrets\.|\benvironment:|id-token|allowProvisioningUpdates|exportArchive|\barchive\b|authenticationKey/);
  const builds = [...workflow.matchAll(/xcodebuild (?:build-for-testing|build|test-without-building)[\s\S]*?CODE_SIGNING_ALLOWED=NO/g)];
  assert.equal(builds.length, [...workflow.matchAll(/xcodebuild (?:build-for-testing|build|test-without-building)/g)].length);
  assert.equal(builds.filter(([command]) => command.includes('build-for-testing')).length, 4, 'each job builds once');
  assert.equal(builds.filter(([command]) => command.includes('xcodebuild build\n') && command.includes('-configuration Release')).length, 1,
    'the newest runtime compiles the Release configuration');
  assert.equal(builds.filter(([command]) => command.includes('test-without-building')).length, 10,
    'the two unit tests, newest UI, minimum launch and presentation, iPad and SE presentation, CORS, fault-disabled mutation and the App Store capture run separately');
  assert.match(builds.find(([command]) => command.includes('-configuration Release'))[0],
    /-destination "\$DESTINATION"[\s\S]*CODE_SIGNING_ALLOWED=NO/);
  assert.equal(block('concurrency').trim(),
    "group: ios-${{ github.ref }}${{ inputs.app_store_screenshots && '-app-store-screenshots' || inputs.minimum_only && '-minimum-only' || '' }}\n  cancel-in-progress: true",
    'a minimum-only dispatch must not cancel the full run on the same ref');
});

test('live metadata CORS is off by default and runs only from an opted-in manual dispatch', () => {
  assert.match(workflow,
    /workflow_dispatch:\n {4}inputs:\n {6}live_cors:\n {8}description: Check whether the live metadata API permits the app origin\n {8}required: false\n {8}type: boolean\n {8}default: false/);
  assert.match(workflow,
    /- name: Check live metadata CORS from the app origin\n {8}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.live_cors \}\}\n {8}timeout-minutes: 10\n {8}env:\n {10}TEST_RUNNER_RECAP_RUN_LIVE_CORS: '1'/);
  assert.match(workflow, /-only-testing:RecapPageUITests\/LaunchUITests\/testManualLiveMetadataCorsFromTheAppOrigin/);
  assert.match(workflow,
    /if \[ -z "\$result" \]; then[\s\S]*The selected CORS test returned no probe result[\s\S]*exit 1/,
    'a skipped test cannot produce a green CORS step');
});

test('minimum-only dispatch runs just the lowest-runtime job', () => {
  assert.match(workflow,
    /minimum_only:\n {8}description: Run only the lowest iOS 18 runtime job\n {8}required: false\n {8}type: boolean\n {8}default: false/);
  assert.match(jobSource('newest'), /if: \$\{\{ !inputs\.app_store_screenshots && !inputs\.minimum_only \}\}/);
  assert.match(jobSource('ipad'), /if: \$\{\{ !inputs\.app_store_screenshots && !inputs\.minimum_only \}\}/);
  assert.match(jobSource('minimum'), /if: \$\{\{ !inputs\.app_store_screenshots \}\}/);
  // With both inputs set the capture wins, matching its concurrency group, so the run is never empty.
  assert.match(jobSource('screenshots'),
    /\n {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.app_store_screenshots \}\}\n/);
});

test('the fault-disabled restore mutation is opt-in and requires the done-row failure', async () => {
  assert.match(workflow,
    /prove_journal_fault_disabled:\n {8}description: Prove interrupted restore rejects a completed restore without the injected fault\n {8}required: false\n {8}type: boolean\n {8}default: false/);
  const newest = jobSource('newest');
  const step = stepScript(newest, 'Prove the interrupted-restore test rejects the done row');
  assert.match(newest,
    /- name: Prove the interrupted-restore test rejects the done row\n {8}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.prove_journal_fault_disabled \}\}\n {8}timeout-minutes: 10\n {8}env:\n {10}TEST_RUNNER_RECAP_IOS_DISABLE_FIFTH_JOURNAL_PUT: '1'/);
  assert.match(step, /-only-testing:RecapPageUITests\/LaunchUITests\/testFifthJournalPutFailureOffersRecoveryAfterForcedTermination/);
  assert.match(step, /if \[ "\$status" -eq 0 \]; then/);
  assert.match(step, /RECAP_PROBE_RESULT journal-fault-after-kill/);
  assert.match(step, /"stateTableRow":"done: \\\/ matching \\\/ any"/);
  assert.match(step, /the fault-disabled mutation must reach the done row/);
  // The record is written by JSONSerialization, which escapes every slash; run 41174081424 failed the
  // test on the done row and the step still reported it missing.
  const recorded = 'RECAP_PROBE_RESULT journal-fault-after-kill {"markerState":"done","stateTableRow":"done: \\/ matching \\/ any"}';
  const failure = 'LaunchUITests.swift:409: error: -[LaunchUITests testFifth] : XCTAssertEqual failed - '
    + 'the fault-disabled mutation must reach the done row: Optional(done: / matching / any)';
  for (const [name, log, code, exit] of [
    ['the recorded done row', `${recorded}\n${failure}`, 65, 0],
    ['an unrelated failure', failure.replace('done: / matching / any', 'nil'), 65, 1],
    ['an unexpected pass', recorded, 0, 1],
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'recap-ios-proof-'));
    try {
      await writeFile(join(root, 'fixture.log'), log + '\n');
      const result = await runScript(root, `xcodebuild() { cat "$RUNNER_TEMP/fixture.log"; return ${code}; }\n${step}`);
      assert.equal(result.status, exit, `${name}: ${result.stdout}${result.stderr}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  // Run 41169003243 kept neither, so the proof's failure could not be decoded.
  assert.match(newest, /\$\{\{ runner\.temp \}\}\/RecapPage-journal-fault-disabled\.xcresult\n/);
  assert.match(newest, /\$\{\{ runner\.temp \}\}\/journal-fault-disabled\.log\n/);
  // A finished restore reloads the page, which drops the probe's completion handler unless the
  // writer settles at the unload.
  const writer = readFileSync(new URL('../packaging/ios/RecapPageUITests/LaunchUITests.swift', import.meta.url), 'utf8')
    .split('private static let startInterruptedCompleteRestore = #"""')[1]?.split('"""#')[0] ?? '';
  assert.match(writer, /addEventListener\('beforeunload', settle, \{ once: true \}\)/);
  assert.match(writer, /addEventListener\('pagehide', settle, \{ once: true \}\)/);
  assert.match(writer, /report: null,\r?\n\s+unloadedAfterRestore: event\.type,/);
  assert.match(writer, /Promise\.race\(\[reported, unloaded\.then\(\(\) => null\)\]\)/);
});

test('newest, oldest, iPad and screenshot jobs use the intended Xcode runtimes', () => {
  assert.deepEqual(jobs.map(({ name, runsOn }) => [name, runsOn]),
    [['newest', 'macos-26'], ['ipad', 'macos-26'], ['minimum', 'macos-15'], ['screenshots', 'macos-26']]);
  const major = identity.minimumOS.split('.')[0];
  for (const job of jobs) {
    assert.match(job.env.DEVELOPER_DIR, /^\/Applications\/Xcode_26\.[\d.]+\.app\/Contents\/Developer$/, job.name);
    assert.ok(job.steps.some(({ label }) => label === 'Show the toolchain'), `${job.name} prints its Xcode version`);
  }
  assert.match(workflow, /xcodebuild -version/);
  assert.match(jobSource('newest'), /SIMULATOR_RUNTIME: latest/);
  assert.match(jobSource('minimum'), new RegExp(`SIMULATOR_RUNTIME: iOS-${major}-\\d+`));
  assert.match(jobSource('ipad'), /SIMULATOR_RUNTIME: latest/);
  assert.match(jobSource('screenshots'), /SIMULATOR_RUNTIME: latest/);
});

test('the App Store screenshot capture runs only from an opted-in manual dispatch, in place of the tests', async () => {
  assert.match(workflow,
    /app_store_screenshots:\n {8}description: Capture the App Store screenshots instead of running the tests\n {8}required: false\n {8}type: boolean\n {8}default: false/);
  assert.match(jobSource('newest'),
    /\n {4}if: \$\{\{ !inputs\.app_store_screenshots && !inputs\.minimum_only \}\}\n {4}runs-on:/);
  assert.match(jobSource('ipad'),
    /\n {4}if: \$\{\{ !inputs\.app_store_screenshots && !inputs\.minimum_only \}\}\n {4}runs-on:/);
  assert.match(jobSource('minimum'), /\n {4}if: \$\{\{ !inputs\.app_store_screenshots \}\}\n {4}runs-on:/);
  const source = jobSource('screenshots');
  assert.match(source,
    /\n {4}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.app_store_screenshots \}\}\n {4}runs-on: macos-26/);
  assert.doesNotMatch(source, /upload-app|altool|notarytool|xcrun.*upload|App Store Connect API/i);
  const capture = stepScript(source, 'Capture the screens');
  assert.match(capture, /for set in ipad-13 iphone-6\.3 iphone-6\.9; do/);
  assert.match(capture, /TEST_RUNNER_RECAP_APP_STORE_SET="\$set"/);
  assert.match(capture, /for appearance in dark light; do/);
  assert.match(capture, /TEST_RUNNER_RECAP_APP_STORE_APPEARANCE="\$appearance"/);
  assert.match(capture, /ios-app-store-screenshots\.mjs fixtures "\$set" "\$appearance"/);
  assert.match(capture, /xcrun simctl ui "\$udid" appearance "\$appearance"/);
  assert.match(capture, /-only-testing:RecapPageUITests\/AppStoreScreenshotUITests/);
  assert.match(capture, /xcrun simctl status_bar "\$udid" override --time 9:41/);
  assert.match(capture, /xcrun xcresulttool export attachments/);
  assert.match(stepScript(source, 'Check and flatten the images'), /ios-app-store-screenshots\.mjs finish/);
  assert.match(source, /ios-app-store-screenshots-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  // Every other run skips the capture test rather than failing on a missing screen list.
  const test = readFileSync(new URL('../packaging/ios/RecapPageUITests/AppStoreScreenshotUITests.swift', import.meta.url), 'utf8');
  assert.match(test, /throw XCTSkip\(/);
  assert.match(test, /environment\["RECAP_APP_STORE_SCREENS"\]/);
  assert.match(test, /environment\["RECAP_APP_STORE_SET"\]/);
  assert.match(test, /environment\["RECAP_APP_STORE_APPEARANCE"\]/);
  const root = await mkdtemp(join(tmpdir(), 'recap-ios-screens-'));
  try {
    // A failed phase still leaves the other phases captured, and the step still fails.
    // The device list is written late and the node stand-in drains it first, as the real
    // command's readFileSync(0) does; a stand-in that answers unread lost that race with
    // SIGPIPE and exit 141 on Node 20 CI (#1050).
    const result = await runScript(root, [
      'xcrun() { if [ "$1 $2" = "simctl list" ]; then sleep 0.2; echo "{\\"devices\\":{}}"; '
        + 'elif [ "$1 $2" = "simctl ui" ]; then echo "$TEST_RUNNER_RECAP_APP_STORE_SET $5" >> "$RUNNER_TEMP/appearances"; fi; return 0; }',
      'node() { if [ "$2" = device ]; then cat > /dev/null; echo "{\\"udid\\":\\"U-$3\\"}"; elif [ "$1" = -e ]; then echo "U"; else echo "[]"; fi; }',
      'xcodebuild() { if [ "$TEST_RUNNER_RECAP_APP_STORE_SET:$TEST_RUNNER_RECAP_APP_STORE_APPEARANCE" = "iphone-6.3:dark" ]; '
        + 'then return 65; fi; echo "captured"; }',
      capture,
    ].join('\n'));
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /::error::The iphone-6\.3 dark capture failed/);
    assert.equal((result.stdout.match(/captured/g) ?? []).length, 5);
    assert.equal(await readFile(join(root, 'appearances'), 'utf8'), [
      'ipad-13 dark', 'ipad-13 light', 'iphone-6.3 dark', 'iphone-6.3 light',
      'iphone-6.9 dark', 'iphone-6.9 light', '',
    ].join('\n'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('screenshot capture retries only recognized Xcode infrastructure failures and exports the last attempt', async () => {
  const capture = stepScript(jobSource('screenshots'), 'Capture the screens');
  for (const [scenario, exit, expectedAttempts] of [
    ['recover', 0, 2],
    ['mixed', 1, 1],
    ['twice', 1, 2],
    ['logfail', 1, 1],
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'recap-ios-screens-retry-'));
    try {
      // Same late writer and draining reader as the test above, so the race in #1050 cannot recur.
      const harness = `xcrun() {
  if [ "$1 $2" = "simctl list" ]; then
    sleep 0.2
    echo '{"devices":{}}'
  elif [ "$1 $2" = "xcresulttool export" ]; then
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/exports"
  fi
}
node() {
  if [ "$2" = device ]; then cat > /dev/null; echo '{"udid":"U"}'
  elif [ "$1" = -e ]; then echo "U"
  else echo "[]"; fi
}
tee() {
  if [ "$CASE" = logfail ] && [ "$TEST_RUNNER_RECAP_APP_STORE_SET:$TEST_RUNNER_RECAP_APP_STORE_APPEARANCE" = "iphone-6.3:dark" ]; then
    cat > /dev/null
    return 1
  fi
  command tee "$@"
}
xcodebuild() {
  set="$TEST_RUNNER_RECAP_APP_STORE_SET"
  appearance="$TEST_RUNNER_RECAP_APP_STORE_APPEARANCE"
  count=0
  if [ -f "$RUNNER_TEMP/count-$set-$appearance" ]; then read -r count < "$RUNNER_TEMP/count-$set-$appearance"; fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "$RUNNER_TEMP/count-$set-$appearance"
  if [ "$set:$appearance" = "iphone-6.3:dark" ]; then
    if [ "$CASE" = twice ] || [ "$CASE" = mixed ] || { [ "$CASE" = recover ] && [ "$count" = 1 ]; }; then
      echo "/repo/AppStoreScreenshotUITests.swift:55: error: Timed out while launching application via Xcode."
      if [ "$CASE" = mixed ]; then echo "/repo/AppStoreScreenshotUITests.swift:56: error: XCTAssertEqual failed - wrong screen"; fi
      return 65
    fi
  fi
  echo "captured $set $appearance attempt $count"
}
${capture}`;
      const result = await runScript(root, harness, { CASE: scenario });
      assert.equal(result.status, exit, `${scenario}: ${result.stdout}${result.stderr}`);
      assert.equal(Number((await readFile(join(root, 'count-iphone-6.3-dark'), 'utf8')).trim()), expectedAttempts, scenario);
      for (const phase of ['ipad-13-dark', 'ipad-13-light', 'iphone-6.3-light', 'iphone-6.9-dark', 'iphone-6.9-light']) {
        assert.equal(Number((await readFile(join(root, `count-${phase}`), 'utf8')).trim()), 1, `${scenario}: ${phase}`);
      }
      const exports = await readFile(join(root, 'exports'), 'utf8');
      assert.match(exports, new RegExp(`RecapPage-screenshots-iphone-6\\.3-dark-${expectedAttempts}\\.xcresult`), scenario);
      if (scenario === 'recover') assert.match(result.stdout, /retrying.*same Simulator/i);
      else assert.match(result.stdout, /::error::The iphone-6\.3 dark capture failed/);
      if (scenario === 'logfail') assert.match(result.stdout, /capture log could not be written/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('the newest runtime checks the 6.9-inch iPhone while iPad presentation runs in its own job', () => {
  const newest = jobSource('newest');
  const ipad = jobSource('ipad');
  assert.match(newest, /SIMULATOR_NAME: iPhone 17 Pro Max/);
  assert.doesNotMatch(newest, /iPad Pro 13-inch|IPAD_UDID|IPAD_DESTINATION/);
  assert.equal(jobs.find(({ name }) => name === 'ipad').runsOn, 'macos-26');
  assert.equal(ipad.match(/xcodebuild build-for-testing/g)?.length, 1);
  assert.match(ipad, /-only-testing:RecapPageUITests\/PresentationUITests/);
  assert.doesNotMatch(ipad, /-only-testing:RecapPageUITests\s|-only-testing:RecapPageTests|live_cors/);
  assert.match(ipad, /name: iPad presentation on the newest runtime/);
  assert.match(ipad, /timeout-minutes: 86/);
  assert.match(ipad, /timeout-minutes: 35\n {8}run: \|/);
  assert.match(ipad, /ios-results-ipad-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});

test('the separate iPad job starts only the iPad boot before building and waits afterward', async () => {
  const source = jobSource('ipad');
  const start = stepScript(source, 'Start the 13-inch iPad Simulator boot');
  const wait = stepScript(source, 'Wait for the 13-inch iPad Simulator after the build');
  assert.ok(source.indexOf('name: Prepare the bundled web app') <
    source.indexOf('Start the 13-inch iPad Simulator boot'));
  assert.ok(source.indexOf('Start the 13-inch iPad Simulator boot') < source.indexOf('name: Build for testing'));
  assert.ok(source.indexOf('name: Build for testing') < source.indexOf('Wait for the 13-inch iPad Simulator after the build'));
  assert.ok(source.indexOf('Wait for the 13-inch iPad Simulator after the build') <
    source.indexOf('name: Run presentation UI tests on iPad'));
  assert.match(start, /xcrun simctl boot "\$udid" > "\$RUNNER_TEMP\/ipad-boot\.log" 2>&1 &/);
  assert.match(start, /entry\.name\.startsWith\("iPad Pro 13-inch"\)/);
  assert.match(start, /IPAD_DESTINATION=platform=iOS Simulator,id=\$udid/);
  assert.match(wait, /xcrun simctl bootstatus "\$IPAD_UDID" -b/);
  assert.match(source, /- name: Wait for the 13-inch iPad Simulator after the build\n {8}timeout-minutes: 5/);
  assert.match(source, /\$RUNNER_TEMP\/ui-ipad-\$attempt\.log/);
  const root = await mkdtemp(join(tmpdir(), 'recap-ios-ipad-boot-'));
  try {
    const fixture = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [{ name: 'iPad Pro 13-inch (M4)', udid: 'older-ipad' }],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
          { name: 'iPhone 17 Pro Max', udid: 'newest-phone' },
          { name: 'iPad Pro 13-inch (M5)', udid: 'newest-ipad' },
        ],
      },
    };
    await writeFile(join(root, 'devices.json'), JSON.stringify(fixture));
    const stub = `xcrun() {
  if [ "$*" = "simctl list devices available --json" ]; then
    cat "$RUNNER_TEMP/devices.json"
  else
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  fi
}
`;
    const githubEnv = join(root, 'github-env');
    const result = await runScript(root, stub + start, { GITHUB_ENV: githubEnv });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'), 'simctl boot newest-ipad\n');
    assert.equal(await readFile(githubEnv, 'utf8'),
      'IPAD_UDID=newest-ipad\nIPAD_DESTINATION=platform=iOS Simulator,id=newest-ipad\n');
    const waited = await runScript(root, stub + wait, { IPAD_UDID: 'newest-ipad' });
    assert.equal(waited.status, 0, waited.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl boot newest-ipad\nsimctl bootstatus newest-ipad -b\n');
    await writeFile(join(root, 'devices.json'), JSON.stringify({ devices: {} }));
    const missing = await runScript(root, stub + start, { GITHUB_ENV: githubEnv });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Requested 13-inch iPad Simulator is not available/);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl boot newest-ipad\nsimctl bootstatus newest-ipad -b\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function jobSource(name) {
  return workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}\w+:\n/)[0] ?? '';
}

function stepScript(source, label) {
  const step = source.split(`      - name: ${label}\n`)[1]?.split(/\n {6}- /)[0];
  assert.ok(step, `found step ${label}`);
  const script = step.split('        run: |\n')[1];
  assert.ok(script, `${label} has an executable block`);
  return script.split('\n').filter((line) => line.startsWith('          '))
    .map((line) => line.slice(10)).join('\n') + '\n';
}

test('minimum runtime builds once and each UI group uses its exact test run and destination', async () => {
  const source = jobSource('minimum');
  const build = stepScript(source, 'Build for testing');
  assert.equal(source.match(/xcodebuild build-for-testing/g)?.length, 1);
  for (const [label, group, destination, result] of [
    ['Run the UI tests', 'LaunchUITests', '"$DESTINATION"', 'minimum-ui'],
    ['Run presentation UI tests on the minimum iPhone', 'PresentationUITests', '"$DESTINATION"', 'minimum-presentation'],
    ['Run presentation UI tests on iPhone SE (3rd generation)', 'PresentationUITests',
      '"platform=iOS Simulator,id=$IPHONE_375_UDID"', 'minimum-iphone-se-ui'],
  ]) {
    const script = stepScript(source, label);
    assert.match(script, /xcodebuild test-without-building/);
    assert.match(script, /-xctestrun "\$XCTESTRUN"/);
    assert.ok(script.includes(`-destination ${destination}`));
    assert.ok(script.includes(`-only-testing:RecapPageUITests/${group}`));
    assert.ok(script.includes(`RecapPage-${result}-$attempt.xcresult`));
    assert.doesNotMatch(script, /-project|-scheme|-derivedDataPath/);
  }
  const root = await mkdtemp(join(tmpdir(), 'recap-ios-test-run-'));
  try {
    const products = join(root, 'DerivedData', 'Build', 'Products');
    await mkdir(products, { recursive: true });
    const script = `xcodebuild() { return 0; }\n${build}`;
    const env = { GITHUB_ENV: join(root, 'github-env') };
    assert.notEqual((await runScript(root, script, env)).status, 0, 'missing test run fails');
    const chosen = join(products, 'RecapPage_iphonesimulator.xctestrun');
    await writeFile(chosen, '');
    assert.notEqual((await runScript(root, script, env)).status, 0, 'empty test run fails');
    await writeFile(chosen, 'built test run');
    const valid = await runScript(root, script, env);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(await readFile(env.GITHUB_ENV, 'utf8'),
      `XCTESTRUN=${root}/DerivedData/Build/Products/RecapPage_iphonesimulator.xctestrun\n`);
    await writeFile(join(products, 'stale.xctestrun'), 'other test run');
    assert.notEqual((await runScript(root, script, env)).status, 0, 'ambiguous test runs fail');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
const infrastructure = [
  'The test runner failed to initialize for UI testing.',
  'Failed to get background assertion for target app with pid 13819: Timed out while acquiring background assertion.',
  'Failed to launch application: Timed out while launching application via Xcode.',
  // Run 41174084511: launch could not end the previous test's instance before the test body ran.
  '/repo/LaunchUITests.swift:37: error: -[RecapPageUITests.LaunchUITests testFifthJournalPutFailureOffersRecoveryAfterForcedTermination] : '
    + 'Failed to terminate io.github.raymondnassar.recappage:19342: Failed to terminate io.github.raymondnassar.recappage:0',
];
const minimumInfrastructure = [
  ...infrastructure,
  'Failed to get matching snapshots: Error getting main window kAXErrorServerNotFound',
  'RecapPageUITests-Runner encountered an error (Early unexpected exit, operation never finished bootstrapping (Underlying Error: Test crashed with signal kill before establishing connection.))',
  // Run 41198453337, job 124529283379, verbatim: XCTest quotes the reason inside the parentheses.
  'Failure Reason: The request was denied by service delegate (SBMainWorkspace) for reason: '
    + 'Busy ("Application "io.github.raymondnassar.recappage" is installing or uninstalling, and cannot be launched").',
  'Audit failed to complete in time',
];
const terminate = infrastructure[3];
const otherTerminate = '/repo/LaunchUITests.swift:37: error: -[LaunchUITests testHome] : Failed to terminate com.apple.mobilesafari:4242';
const assertion = '/repo/LaunchUITests.swift:40: error: -[LaunchUITests testHome] : XCTAssertTrue failed';
// Run 41169003243: the passive-guard fixtures' anticipated failures, which XCTest reports without ": error:".
const anticipated = [
  'XCTExpectFailure: matcher accepted Assertion Failure at PresentationUITests.swift:1369: '
    + 'XCTAssertFalse failed - occlusion-mutant: above-navigation',
  'PresentationUITests.swift:1369: Expected failure in -[RecapPageUITests.PresentationUITests '
    + 'testPassiveGuardRejectsStructuralAndGlobalNegativeFixtures]: XCTAssertFalse failed - '
    + 'occlusion-mutant: above-navigationReason: (Ignoring the mutant.)',
].join('\n');

async function runScript(root, script, env = {}) {
  const path = join(root, 'step.sh');
  await writeFile(path, script);
  const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', path], {
    encoding: 'utf8', timeout: 15000,
    env: {
      ...process.env,
      RUNNER_TEMP: root,
      DESTINATION: 'platform=iOS Simulator,id=chosen-device',
      IPAD_DESTINATION: 'platform=iOS Simulator,id=chosen-ipad',
      XCTESTRUN: 'matching-runtime.xctestrun',
      ...env,
    },
  });
  assert.ifError(result.error);
  return result;
}

test('the iPhone jobs boot and wait for the chosen Simulator before building and keep all attempt bundles', async () => {
  for (const job of jobs.filter(({ name }) => ['newest', 'minimum'].includes(name))) {
    const source = jobSource(job.name);
    const boot = stepScript(source, 'Boot the Simulator before building');
    assert.ok(source.indexOf('Boot the Simulator before building') < source.indexOf('name: Build for testing'));
    const expectedBuilds = job.name === 'newest' ? 6 : 4;
    assert.equal((source.match(/-destination "\$DESTINATION"/g) ?? []).length, expectedBuilds);
    assert.doesNotMatch(source, /simctl erase|retry-tests-on-failure|continue-on-error/);
    if (job.name === 'newest') {
      assert.doesNotMatch(source, /simctl shutdown/);
    } else {
      assert.match(source, /simctl shutdown "\$DESTINATION_UDID"/);
      assert.doesNotMatch(source, /simctl shutdown "\$IPHONE_375_UDID"/);
    }
    assert.match(source, new RegExp(`runner.temp \\}\\}/RecapPage-${job.name}-\\*\\.xcresult`));
    assert.match(source, /runner.temp \}\}\/ui-\*\.log/);
    assert.match(source, /if: \$\{\{ !cancelled\(\) \}\}/);
    const root = await mkdtemp(join(tmpdir(), 'recap-ios-boot-'));
    try {
      const fixture = { devices: Object.fromEntries(['iOS-9-3', 'iOS-18-5', 'iOS-26-5', 'tvOS-99-0'].map((runtime) =>
        [`com.apple.CoreSimulator.SimRuntime.${runtime}`, [{ name: job.env.SIMULATOR_NAME, udid: runtime }]])) };
      await writeFile(join(root, 'devices.json'), JSON.stringify(fixture));
      const stub = `xcrun() {
  if [ "$*" = "simctl list devices available --json" ]; then
    cat "$RUNNER_TEMP/devices.json"
  else
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  fi
}
`;
      const env = { ...job.env, GITHUB_ENV: join(root, 'github-env') };
      const result = await runScript(root, stub + boot, env);
      assert.equal(result.status, 0, result.stderr);
      const expected = job.name === 'newest' ? 'iOS-26-5' : 'iOS-18-5';
      assert.equal(await readFile(join(root, 'calls'), 'utf8'), `simctl boot ${expected}\nsimctl bootstatus ${expected} -b\n`);
      const expectedEnv = `DESTINATION=platform=iOS Simulator,id=${expected}\n`;
      assert.equal(await readFile(env.GITHUB_ENV, 'utf8'),
        job.name === 'minimum' ? `${expectedEnv}DESTINATION_UDID=${expected}\n` : expectedEnv);
      await writeFile(join(root, 'devices.json'), '{"devices":{}}');
      const missing = await runScript(root, stub + boot, env);
      assert.notEqual(missing.status, 0, 'an unavailable Simulator fails before boot');
      assert.match(missing.stderr, /Requested iOS Simulator is not available/);
      assert.equal(await readFile(join(root, 'calls'), 'utf8'), `simctl boot ${expected}\nsimctl bootstatus ${expected} -b\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('the minimum runtime runs only one booted Simulator at a time', async () => {
  const minimum = jobs.find(({ name }) => name === 'minimum');
  const source = jobSource('minimum');
  const detect = stepScript(source, 'Find the iPhone SE (3rd generation) Simulator');
  const shutdown = stepScript(source, 'Shut down the minimum iPhone before starting the SE');
  const boot = stepScript(source, 'Boot iPhone SE (3rd generation) Simulator before presentation');
  const wait = stepScript(source, 'Wait for the 375-point iPhone SE Simulator before presentation');
  const test = stepScript(source, 'Run presentation UI tests on iPhone SE (3rd generation)');
  assert.match(source, /SIMULATOR_NAME: iPhone 16e/);
  assert.match(source, /- name: Find the iPhone SE \(3rd generation\) Simulator\n {8}id: iphone-se/);
  assert.match(source,
    /- name: Shut down the minimum iPhone before starting the SE\n {8}id: shutdown-minimum\n {8}if: \$\{\{ !cancelled\(\) && steps\.iphone-se\.outputs\.available == 'true' \}\}/);
  assert.match(source,
    /- name: Boot iPhone SE \(3rd generation\) Simulator before presentation\n {8}id: boot-iphone-se\n {8}if: \$\{\{ !cancelled\(\) && steps\.iphone-se\.outputs\.available == 'true' && steps\.shutdown-minimum\.outcome == 'success' \}\}/);
  assert.match(source,
    /- name: Wait for the 375-point iPhone SE Simulator before presentation\n {8}id: wait-iphone-se\n {8}if: \$\{\{ !cancelled\(\) && steps\.iphone-se\.outputs\.available == 'true' && steps\.boot-iphone-se\.outcome == 'success' \}\}/);
  assert.match(source,
    /- name: Run presentation UI tests on iPhone SE \(3rd generation\)\n {8}if: \$\{\{ !cancelled\(\) && steps\.iphone-se\.outputs\.available == 'true' && steps\.wait-iphone-se\.outcome == 'success' \}\}/);
  const minimumPresentation = source.indexOf('name: Run presentation UI tests on the minimum iPhone');
  const shutdownPosition = source.indexOf('name: Shut down the minimum iPhone before starting the SE');
  const bootPosition = source.indexOf('name: Boot iPhone SE (3rd generation) Simulator before presentation');
  const waitPosition = source.indexOf('name: Wait for the 375-point iPhone SE Simulator before presentation');
  const sePresentation = source.indexOf('name: Run presentation UI tests on iPhone SE (3rd generation)');
  assert.ok(source.indexOf('name: Build for testing') < source.indexOf('name: Run the unit tests'));
  assert.ok(source.indexOf('name: Find the iPhone SE (3rd generation) Simulator') < minimumPresentation);
  assert.ok(minimumPresentation < shutdownPosition && shutdownPosition < bootPosition &&
    bootPosition < waitPosition && waitPosition < sePresentation);
  assert.match(shutdown, /xcrun simctl shutdown "\$DESTINATION_UDID"/);
  assert.match(boot, /xcrun simctl boot "\$IPHONE_375_UDID" > "\$RUNNER_TEMP\/iphone-se-boot\.log" 2>&1/);
  assert.match(wait, /xcrun simctl bootstatus "\$IPHONE_375_UDID" -b/);
  // The change this job depends on: the SE never boots while the minimum iPhone is still running,
  // so an early or backgrounded SE boot (the earlier layout) must fail here.
  const seCommands = [...source.matchAll(/simctl (?:boot|bootstatus) "\$IPHONE_375_UDID"[^\n]*/g)];
  assert.equal(seCommands.length, 2, 'the SE is booted once and awaited once');
  for (const command of seCommands) {
    assert.ok(command.index > shutdownPosition, `"${command[0]}" runs before the minimum iPhone shuts down`);
    assert.doesNotMatch(command[0], /&\s*$/, 'the SE boot is not backgrounded');
  }
  assert.doesNotMatch(source, /simctl erase/);
  assert.match(source, /375-point iPhones are untested/);
  assert.match(stepScript(source, 'Run the UI tests'), /-destination "\$DESTINATION"/);
  assert.match(test, /-only-testing:RecapPageUITests\/PresentationUITests/);
  assert.match(test, /-destination "platform=iOS Simulator,id=\$IPHONE_375_UDID"/);
  assert.doesNotMatch(test, /-only-testing:RecapPageUITests\s/);

  const root = await mkdtemp(join(tmpdir(), 'recap-ios-iphone-se-'));
  try {
    const fixture = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          { name: 'iPhone SE (3rd generation)', udid: 'iOS-18-SE3' },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
          { name: 'iPhone SE (3rd generation)', udid: 'newest-SE3' },
        ],
      },
    };
    await writeFile(join(root, 'devices.json'), JSON.stringify(fixture));
    const stub = `xcrun() {
  if [ "$*" = "simctl list devices available --json" ]; then
    cat "$RUNNER_TEMP/devices.json"
  else
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  fi
}
`;
    const env = {
      ...minimum.env,
      GITHUB_ENV: join(root, 'github-env'),
      GITHUB_OUTPUT: join(root, 'github-output'),
    };
    const available = await runScript(root, stub + detect, env);
    assert.equal(available.status, 0, available.stderr);
    assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), 'available=true\n');
    assert.equal(await readFile(env.GITHUB_ENV, 'utf8'), 'IPHONE_375_UDID=iOS-18-SE3\nIPHONE_375_AVAILABLE=true\n');
    const shutDown = await runScript(root, stub + shutdown, { DESTINATION_UDID: 'iOS-18-16e' });
    assert.equal(shutDown.status, 0, shutDown.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'), 'simctl shutdown iOS-18-16e\n');
    const booted = await runScript(root, stub + boot, { IPHONE_375_UDID: 'iOS-18-SE3' });
    assert.equal(booted.status, 0, booted.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl shutdown iOS-18-16e\nsimctl boot iOS-18-SE3\n');
    const waited = await runScript(root, stub + wait, { IPHONE_375_UDID: 'iOS-18-SE3' });
    assert.equal(waited.status, 0, waited.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl shutdown iOS-18-16e\nsimctl boot iOS-18-SE3\nsimctl bootstatus iOS-18-SE3 -b\n');

    for (const [index, message] of minimumInfrastructure.entries()) {
      await writeFile(join(root, 'test-calls'), '');
      const tested = await runScript(root, `xcodebuild() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/test-calls"
  invocation=$(wc -l < "$RUNNER_TEMP/test-calls" | tr -d ' ')
  case "$invocation" in
    1) printf '%s\\n' ${JSON.stringify(message)}; return 65 ;;
    2) echo passed; return 0 ;;
    *) return 99 ;;
  esac
}
${test}`, { GITHUB_ENV: env.GITHUB_ENV, IPHONE_375_UDID: 'iOS-18-SE3' });
      assert.equal(tested.status, 0, tested.stderr + tested.stdout);
      const calls = (await readFile(join(root, 'test-calls'), 'utf8')).trim().split('\n');
      assert.equal(calls.length, 2, `signature ${index + 1} is retried once`);
      for (const call of calls) {
        assert.match(call, /-only-testing:RecapPageUITests\/PresentationUITests/);
        assert.match(call, /-destination platform=iOS Simulator,id=iOS-18-SE3/);
        assert.doesNotMatch(call, /-only-testing:RecapPageUITests(?:\s|$)/);
      }
      assert.match(calls[0], /RecapPage-minimum-iphone-se-ui-1\.xcresult/);
      assert.match(calls[1], /RecapPage-minimum-iphone-se-ui-2\.xcresult/);
      assert.equal((tested.stdout.match(/::warning::/g) ?? []).length, 1);
      assert.ok(tested.stdout.includes(`Matched: ${message}`), tested.stdout);
    }

    await writeFile(join(root, 'devices.json'), JSON.stringify({
      devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [] },
    }));
    await writeFile(env.GITHUB_OUTPUT, '');
    await writeFile(env.GITHUB_ENV, '');
    const unavailable = await runScript(root, stub + detect, env);
    assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), 'available=false\n');
    assert.equal(await readFile(env.GITHUB_ENV, 'utf8'), 'IPHONE_375_AVAILABLE=false\n');
    assert.match(unavailable.stdout, /375-point iPhones are untested/);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl shutdown iOS-18-16e\nsimctl boot iOS-18-SE3\nsimctl bootstatus iOS-18-SE3 -b\n',
      'an unavailable device is not booted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the iPhone SE presentation step runs after UI failure unless cancelled and retains job failure', () => {
  const source = jobSource('minimum');
  const mainUI = source.split('      - name: Run the UI tests\n')[1]?.split('      - name: Run presentation UI tests on iPhone SE')[0];
  const seUI = source.split('      - name: Run presentation UI tests on iPhone SE (3rd generation)\n')[1]
    ?.split('      - name: Summarize the probe results')[0];
  assert.match(source,
    /- name: Run presentation UI tests on iPhone SE \(3rd generation\)\n {8}if: \$\{\{ !cancelled\(\) && steps\.iphone-se\.outputs\.available == 'true' && steps\.wait-iphone-se\.outcome == 'success' \}\}\n {8}timeout-minutes: 60/);
  assert.ok(mainUI, 'the main iPhone UI step remains required');
  assert.ok(seUI, 'the independent SE step remains present');
  assert.doesNotMatch(mainUI, /continue-on-error/);
  assert.doesNotMatch(seUI, /continue-on-error/);
  assert.doesNotMatch(source, /continue-on-error/);
});

test('presentation probes select the live layout monitor by its accessible label', () => {
  const source = readFileSync(new URL('../packaging/ios/RecapPageUITests/PresentationUITests.swift', import.meta.url), 'utf8');
  const monitor = source.split('private func layoutMonitor(of app: XCUIApplication) -> XCUIElement {')[1]
    ?.split('\n    }')[0];
  assert.match(monitor ?? '', /matching\(NSPredicate\(format: "label BEGINSWITH %@", "recap-layout-probe "\)\)/);
  assert.doesNotMatch(monitor ?? '', /matching\(identifier:/);
  assert.match(source, /monitor\.setAttribute\('aria-label', `recap-layout-probe \$\{monitor\.textContent\}`\)/);
  assert.match(source, /widestOverflowingElements:/);
});

test('both iPhone jobs retry only recognized UI infrastructure failures once and require a complete passing retry', async (t) => {
  for (const job of jobs.filter(({ name }) => ['newest', 'minimum'].includes(name))) {
    const recognized = job.name === 'minimum' ? minimumInfrastructure : infrastructure;
    const scenarios = [
      { name: 'first pass', logs: ['passed'], codes: [0], calls: 1, exit: 0 },
      ...recognized.map((message, index) => ({
        name: `infrastructure ${index + 1} recovers`, logs: [message, 'passed'], codes: [65, 0], calls: 2, exit: 0,
      })),
      { name: 'infrastructure twice', logs: [recognized[0], recognized[0]], codes: [65, 65], calls: 2, exit: 1 },
      { name: 'retry assertion', logs: [recognized[0], assertion], codes: [65, 65], calls: 2, exit: 1 },
      ...recognized.map((message, index) => ({
        name: `infrastructure ${index + 1} with an assertion`,
        logs: [message + '\n' + assertion], codes: [65], calls: 1, exit: 1,
      })),
      { name: 'real assertion', logs: [assertion], codes: [65], calls: 1, exit: 1 },
      { name: 'mixed failure', logs: [recognized[1] + '\n' + assertion], codes: [65], calls: 1, exit: 1 },
      { name: 'anticipated failures with infrastructure recover',
        logs: [anticipated + '\n' + recognized[1], 'passed'], codes: [65, 0], calls: 2, exit: 0 },
      { name: 'anticipated failures with an assertion',
        logs: [anticipated + '\n' + recognized[1] + '\n' + assertion], codes: [65], calls: 1, exit: 1 },
      { name: 'unrecognized failure', logs: ['Simulator connection lost'], codes: [65], calls: 1, exit: 1 },
      { name: 'ambiguous app-not-running failure',
        logs: ['Failed to resolve query: Application io.github.raymondnassar.recappage is not running'],
        codes: [65], calls: 1, exit: 1 },
      { name: 'another app fails to terminate', logs: [otherTerminate], codes: [65], calls: 1, exit: 1 },
      { name: 'termination with an assertion', logs: [terminate + '\n' + assertion], codes: [65], calls: 1, exit: 1 },
      { name: 'log write failure', logs: [recognized[0]], codes: [65], calls: 1, exit: 23, teeFailure: true },
    ];
    const script = stepScript(jobSource(job.name), 'Run the UI tests');
    for (const scenario of scenarios) {
      await t.test(`${job.name}: ${scenario.name}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'recap-ios-retry-'));
        try {
          for (const [index, log] of scenario.logs.entries()) {
            await writeFile(join(root, `fixture-${index + 1}.log`), log + '\n');
          }
          const stub = `xcodebuild() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  invocation=$(wc -l < "$RUNNER_TEMP/calls" | tr -d ' ')
  cat "$RUNNER_TEMP/fixture-$invocation.log"
  case "$invocation" in
    1) return ${scenario.codes[0]} ;;
    2) return ${scenario.codes[1] ?? 99} ;;
    *) return 99 ;;
  esac
}
${scenario.teeFailure ? 'tee() { command tee "$@"; return 23; }\n' : ''}`;
          const result = await runScript(root, stub + script);
          assert.equal(result.status, scenario.exit, result.stderr + result.stdout);
          const calls = (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n');
          assert.equal(calls.length, scenario.calls);
          for (const [index, call] of calls.entries()) {
            assert.match(call, /^test-without-building /);
            assert.match(call, /-only-testing:RecapPageUITests/);
            assert.doesNotMatch(call, /-only-testing:RecapPageTests\b|-skip-testing/);
            assert.ok(call.includes('-destination platform=iOS Simulator,id=chosen-device'));
            assert.ok(call.includes(`RecapPage-${job.name}-ui-${index + 1}.xcresult`));
            assert.equal(await readFile(join(root, `ui-${index + 1}.log`), 'utf8'), scenario.logs[index] + '\n');
          }
          assert.equal((result.stdout.match(/::warning::/g) ?? []).length, scenario.calls - 1);
          if (scenario.calls === 2) {
            assert.ok(result.stdout.includes(`Matched: ${scenario.logs[0].split('\n').at(-1)}`), result.stdout);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('the separate presentation suites retry only the recognized UI infrastructure failures', async (t) => {
  for (const [job, label, bundle, log, destination] of [
    ['ipad', 'Run presentation UI tests on iPad', 'ipad-ui', 'ui-ipad', 'chosen-ipad'],
    ['minimum', 'Run presentation UI tests on the minimum iPhone',
      'minimum-presentation', 'ui-minimum-presentation', 'chosen-device'],
  ]) {
    const recognized = job === 'minimum' ? minimumInfrastructure : infrastructure;
    const scenarios = [
      { name: 'first pass', logs: ['passed'], codes: [0], calls: 1, exit: 0 },
      ...recognized.map((message, index) => ({
        name: `infrastructure ${index + 1} recovers`, logs: [message, 'passed'], codes: [65, 0], calls: 2, exit: 0,
      })),
      ...recognized.map((message, index) => ({
        name: `infrastructure ${index + 1} with an assertion`,
        logs: [message + '\n' + assertion], codes: [65], calls: 1, exit: 1,
      })),
      { name: 'another app fails to terminate', logs: [otherTerminate], codes: [65], calls: 1, exit: 1 },
      { name: 'ambiguous app-not-running failure',
        logs: ['Failed to resolve query: Application io.github.raymondnassar.recappage is not running'],
        codes: [65], calls: 1, exit: 1 },
      { name: 'real assertion', logs: [assertion], codes: [65], calls: 1, exit: 1 },
      { name: 'anticipated failures with infrastructure recover',
        logs: [anticipated + '\n' + recognized[1], 'passed'], codes: [65, 0], calls: 2, exit: 0 },
      { name: 'anticipated failures with an assertion',
        logs: [anticipated + '\n' + recognized[1] + '\n' + assertion], codes: [65], calls: 1, exit: 1 },
    ];
    const script = stepScript(jobSource(job), label);
    for (const scenario of scenarios) {
      await t.test(`${job}: ${scenario.name}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'recap-ios-ipad-retry-'));
        try {
          for (const [index, log] of scenario.logs.entries()) {
            await writeFile(join(root, `fixture-${index + 1}.log`), log + '\n');
          }
          const stub = `xcodebuild() {
  printf '%s\\n' "$*" >> "$RUNNER_TEMP/calls"
  invocation=$(wc -l < "$RUNNER_TEMP/calls" | tr -d ' ')
  cat "$RUNNER_TEMP/fixture-$invocation.log"
  case "$invocation" in
    1) return ${scenario.codes[0]} ;;
    2) return ${scenario.codes[1] ?? 99} ;;
    *) return 99 ;;
  esac
}
`;
          const result = await runScript(root, stub + script);
          assert.equal(result.status, scenario.exit, result.stderr + result.stdout);
          const calls = (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n');
          assert.equal(calls.length, scenario.calls);
          for (const [index, call] of calls.entries()) {
            assert.match(call, /^test-without-building /);
            assert.match(call, /-only-testing:RecapPageUITests\/PresentationUITests/);
            assert.ok(call.includes(`-destination platform=iOS Simulator,id=${destination}`));
            assert.ok(call.includes(`RecapPage-${bundle}-${index + 1}.xcresult`));
            assert.equal(await readFile(join(root, `${log}-${index + 1}.log`), 'utf8'), scenario.logs[index] + '\n');
          }
          assert.equal((result.stdout.match(/::warning::/g) ?? []).length, scenario.calls - 1);
          if (scenario.calls === 2) {
            assert.ok(result.stdout.includes(`Matched: ${scenario.logs[0].split('\n').at(-1)}`), result.stdout);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('unit failures stop each iOS job without entering the UI retry gate', async () => {
  for (const job of jobs.filter(({ name }) => ['newest', 'minimum'].includes(name))) {
    const source = jobSource(job.name);
    const unit = stepScript(source, 'Run the unit tests');
    const uiStep = source.split('      - name: Run the UI tests\n')[1]?.split('        run: |')[0];
    assert.ok(source.indexOf('name: Run the unit tests') < source.indexOf('name: Run the UI tests'));
    assert.ok(uiStep);
    assert.doesNotMatch(uiStep, /\bif:|continue-on-error/);
    assert.match(unit, /-only-testing:RecapPageTests\b/);
    assert.ok(unit.includes(`RecapPage-${job.name}-unit.xcresult`));
    const root = await mkdtemp(join(tmpdir(), 'recap-ios-unit-'));
    try {
      const result = await runScript(root,
        `xcodebuild() { echo '${infrastructure[0]}'; return 65; }\n${unit}\necho UNEXPECTED_CONTINUATION\n`);
      assert.equal(result.status, 65, result.stderr);
      assert.doesNotMatch(result.stdout, /UNEXPECTED_CONTINUATION|::warning::/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('every job and every step in the iOS workflow declares its own deadline', () => {
  for (const job of jobs) {
    assert.ok(Number.isInteger(job.timeout) && job.timeout > 0, `job ${job.name} has a deadline`);
    assert.ok(job.steps.length >= 6, `the parser found only ${job.steps.length} steps in ${job.name}`);
    for (const step of job.steps) {
      assert.ok(Number.isInteger(step.timeout) && step.timeout > 0,
        `step ${JSON.stringify(step.label)} in job ${job.name} has no plain deadline, so an overrun reports cancelled rather than failure`);
    }
  }
});

test('each iOS job deadline stays out of the way until every step has used its own', () => {
  for (const job of jobs) {
    const declared = job.steps.reduce((total, step) => total + (Number.isInteger(step.timeout) ? step.timeout : 0), 0);
    assert.ok(job.timeout >= declared + RUNNER_OVERHEAD_MINUTES,
      `job ${job.name} allows ${job.timeout} minutes but its steps allow ${declared}`);
  }
});

test('the parser accounts for every step and deadline the iOS workflow declares', () => {
  const lines = workflow.split('\n');
  const stepRegion = lines.slice(lines.findIndex((line) => /^jobs:/.test(line)));
  const declaredSteps = stepRegion.filter((line) => /^\s*- [A-Za-z0-9_-]+:/.test(line)).length;
  const declaredDeadlines = lines.filter((line) => /^\s*timeout-minutes:/.test(line)).length;
  const foundSteps = jobs.reduce((total, job) => total + job.steps.length, 0);
  const foundDeadlines = jobs.reduce(
    (total, job) => total + (job.timeout === null ? 0 : 1) + job.steps.filter((step) => step.timeout !== null).length, 0);
  assert.ok(declaredSteps > 0 && declaredDeadlines > 0);
  assert.equal(foundSteps, declaredSteps, 'the parser found every step opener in the file');
  assert.equal(foundDeadlines, declaredDeadlines, 'every deadline in the file belongs to a job or a step');
});

const testflight = readFileSync(new URL('../.github/workflows/ios-testflight.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const deliveryJobs = parseJobs(testflight);
const deliverySource = readFileSync(new URL('../scripts/ios-release.mjs', import.meta.url), 'utf8');

test('TestFlight is dispatch-only, serialized, read-only and refuses every job outside its main workflow', () => {
  const triggers = testflight.split('\non:\n')[1].split('\npermissions:')[0];
  assert.deepEqual(triggers.split('\n').filter((line) => /^ {2}\S/.test(line)), ['  workflow_dispatch:']);
  assert.match(triggers, /options: \[export, upload\]/);
  assert.match(triggers, /build_number:/);
  assert.match(triggers, /export_run:/);
  assert.match(testflight, /permissions:\n {2}contents: read\n {2}actions: read\n/);
  assert.match(testflight, /group: ios-testflight\n {2}cancel-in-progress: false/);
  assert.deepEqual(deliveryJobs.map((job) => job.name), ['preflight', 'deliver']);
  for (const job of deliveryJobs) {
    const source = testflight.split(`\n  ${job.name}:\n`)[1].split(/\n {2}\w+:\n/)[0];
    assert.match(source, /github\.event_name == 'workflow_dispatch'/);
    assert.match(source, /github\.ref == 'refs\/heads\/main'/);
    assert.match(source, /github\.workflow_ref == format\('\{0\}\/\.github\/workflows\/ios-testflight\.yml@refs\/heads\/main', github\.repository\)/);
    const total = job.steps.reduce((sum, step) => {
      assert.ok(Number.isInteger(step.timeout) && step.timeout > 0, `${job.name}: ${step.label}`);
      return sum + step.timeout;
    }, 0);
    assert.ok(job.timeout > total, `${job.name}: job deadline must exceed all steps' deadlines`);
  }
  assert.equal(deliveryJobs.flatMap((job) => job.steps).length,
    testflight.split('\n').filter((line) => /^ {6}- /.test(line)).length);
  for (const match of testflight.matchAll(/uses: ([^\s]+)([^\n]*)/g)) {
    assert.match(match[1], /@[0-9a-f]{40}$/);
    assert.match(match[2], /# v\d/);
  }
  assert.doesNotMatch(testflight, /continue-on-error|pull_request_target|write-all|contents: write/);
});

test('TestFlight secrets are confined to the owner-protected sign and upload steps and keys are always removed', () => {
  const preflight = testflight.split('\n  preflight:\n')[1].split('\n  deliver:\n')[0];
  const deliver = testflight.split('\n  deliver:\n')[1];
  assert.doesNotMatch(preflight, /secrets\.|^ {4}environment:/m);
  assert.match(deliver, /^ {4}environment: \$\{\{ needs.preflight.outputs.environment \}\}$/m);
  assert.match(deliver, /needs.preflight.outputs.environment == 'ios-testflight'/);
  assert.match(deliverySource, /environment=\$\{environment\}/);
  const secretSteps = deliver.split(/\n {6}- /).filter((step) => /secrets\./.test(step));
  assert.equal(secretSteps.length, 2);
  assert.match(secretSteps[0], /if: inputs.mode == 'export'/);
  assert.match(secretSteps[1], /if: inputs.mode == 'upload'/);
  for (const step of secretSteps) {
    assert.deepEqual([...step.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]).sort(),
      ['APPLE_TEAM_ID', 'ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY']);
  }
  const cleanup = deliver.split('name: Remove the private API key\n')[1].split(/\n {6}- /)[0];
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /rm -f "\$RUNNER_TEMP"\/ios-private-keys\/AuthKey_\*\.p8/);
  const artifactPaths = [...deliver.matchAll(/path: \|\n((?: {12}.*\n)+)/g)].map((match) => match[1]).join('');
  assert.doesNotMatch(artifactPaths, /private|archive|plist|log|xcarchive/);
  assert.match(artifactPaths, /ios-artifact\.json/);
  assert.match(artifactPaths, /build-numbers\.proposed\.json/);
  assert.match(deliver, /retention-days: 30/);
  assert.match(deliver, /retention-days: 90/);
  assert.ok(deliver.indexOf('Recheck current protection') < deliver.indexOf('Fetch the exact successful export packet'));
});

test('TestFlight export uses the iOS-18-tested toolchain and upload downloads and checks the sealed bytes', () => {
  const minimum = jobs.find((job) => job.name === 'minimum');
  assert.equal(deliveryJobs.find((job) => job.name === 'deliver').runsOn, minimum.runsOn);
  assert.equal(deliveryJobs.find((job) => job.name === 'deliver').env.DEVELOPER_DIR, minimum.env.DEVELOPER_DIR);
  assert.match(testflight, /ref: \$\{\{ needs.preflight.outputs.source_sha \}\}\n {10}path: application/);
  assert.match(testflight, /run-id: \$\{\{ inputs.export_run \}\}/);
  assert.match(testflight, /name: ios-export-\$\{\{ inputs.build_number \}\}-\$\{\{ inputs.export_run \}\}/);
  assert.match(deliverySource, /<key>destination<\/key><string>export<\/string>/);
  assert.match(deliverySource, /<key>manageAppVersionAndBuildNumber<\/key><false\/>/);
  assert.match(deliverySource, /'-configuration', 'Release'/);
  assert.match(deliverySource, /'-allowProvisioningUpdates', '-authenticationKeyPath'/);
  assert.match(deliverySource, /await verifyIosUpload\(path, record, ledger\);\s+run\('xcrun', \['altool', '--upload-app'/);
  assert.match(deliverySource, /git\('fetch', 'origin', 'main:refs\/remotes\/origin\/main'\)/);
  assert.match(deliverySource, /API_PRIVATE_KEYS_DIR: keyDir/);
  assert.doesNotMatch(deliverySource, /destination<\/key><string>upload|--upload-app[\s\S]*catch/);
});

test('TestFlight invocation refuses wrong refs, workflow copies, automatic events, reruns and unknown modes', () => {
  const env = {
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'raymond-nassar/recap-page',
    GITHUB_WORKFLOW_REF: 'raymond-nassar/recap-page/.github/workflows/ios-testflight.yml@refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1', IOS_MODE: 'export',
  };
  assertInvocation(env);
  assertInvocation({ ...env, IOS_MODE: 'upload' });
  for (const [field, value] of [
    ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_WORKFLOW_REF', env.GITHUB_WORKFLOW_REF.replace('@refs/heads/main', '@refs/heads/feature')],
    ['GITHUB_WORKFLOW_REF', env.GITHUB_WORKFLOW_REF.replace('ios-testflight.yml', 'copy.yml')],
    ['GITHUB_RUN_ATTEMPT', '2'], ['IOS_MODE', 'rehearsal'],
  ]) assert.throws(() => assertInvocation({ ...env, [field]: value }), /required|invalid/);
});

test('TestFlight protection refuses missing, bypassable, other-reviewer, team-reviewer or broad branch rules', () => {
  const value = { can_admins_bypass: false,
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [
      { type: 'User', reviewer: { login: 'raymond-nassar' } },
    ] }],
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } };
  const policies = { branch_policies: [{ name: 'main', type: 'branch' }] };
  assertProtection(value, policies);
  for (const change of [
    { protection_rules: [] }, { can_admins_bypass: true },
    { protection_rules: [{ ...value.protection_rules[0], prevent_self_review: true }] },
    { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'Team', reviewer: { login: 'raymond-nassar' } }] }] },
    { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'someone' } }] }] },
    { deployment_branch_policy: null },
  ]) assert.throws(() => assertProtection({ ...value, ...change }, policies), /environment/);
  for (const branch_policies of [[], [{ name: '*', type: 'branch' }], [{ name: 'main', type: 'tag' }],
    [...policies.branch_policies, { name: 'other', type: 'branch' }]]) {
    assert.throws(() => assertProtection(value, { branch_policies }), /main branch/);
  }
});

test('TestFlight refuses replayed export/upload attempts and uploading older allocations after newer attempts', () => {
  const env = { GITHUB_RUN_ID: '123', IOS_MODE: 'export' };
  const current = { id: 123, display_title: 'iOS export build 2' };
  assertRunHistory([current], env, 2);
  for (const status of ['completed', 'queued', 'in_progress']) {
    const previous = { ...current, id: 122, status, conclusion: 'failure' };
    assert.throws(() => assertRunHistory([previous, current], env, 2), /already attempted/);
  }
  const upload = { ...env, IOS_MODE: 'upload' };
  assertRunHistory([current, { id: 123, display_title: 'iOS upload build 2' }], upload, 2);
  assert.throws(() => assertRunHistory([{ id: 122, display_title: 'iOS upload build 2' }], upload, 2), /already attempted/);
  assert.throws(() => assertRunHistory([{ id: 124, display_title: 'iOS upload build 3' }], upload, 2), /newer build/);
  assertRunHistory([{ id: 122, display_title: 'iOS upload build 2' }], upload, 3);
});

test('TestFlight packet selection requires the same build from a successful manual main export of this workflow', () => {
  const run = { path: '.github/workflows/ios-testflight.yml', head_branch: 'main',
    event: 'workflow_dispatch', conclusion: 'success', display_title: 'iOS export build 2' };
  assertExportRun(run, 2);
  for (const [field, value] of [
    ['path', '.github/workflows/copy.yml'], ['head_branch', 'feature'], ['event', 'push'],
    ['conclusion', 'failure'], ['conclusion', null], ['display_title', 'iOS export build 3'],
    ['display_title', 'iOS upload build 2'],
  ]) assert.throws(() => assertExportRun({ ...run, [field]: value }, 2), /unsuccessful export/);
});
