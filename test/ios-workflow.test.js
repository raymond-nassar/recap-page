import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  assert.equal(builds.filter(([command]) => command.includes('build-for-testing')).length, 2, 'each job builds once');
  assert.equal(builds.filter(([command]) => command.includes('xcodebuild build\n') && command.includes('-configuration Release')).length, 1,
    'the newest runtime compiles the Release configuration');
  assert.equal(builds.filter(([command]) => command.includes('test-without-building')).length, 6,
    'the two unit tests, two iPhone UI suites, the iPad presentation suite and one opt-in CORS test each run separately');
  assert.match(builds.find(([command]) => command.includes('-configuration Release'))[0],
    /-destination "\$DESTINATION"[\s\S]*CODE_SIGNING_ALLOWED=NO/);
  assert.match(block('concurrency'), /group: ios-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
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

test('the newest runtime and the app\'s oldest supported system are both tested, with Xcode chosen by path', () => {
  assert.deepEqual(jobs.map(({ name, runsOn }) => [name, runsOn]), [['newest', 'macos-26'], ['minimum', 'macos-15']]);
  const major = identity.minimumOS.split('.')[0];
  for (const job of jobs) {
    assert.match(job.env.DEVELOPER_DIR, /^\/Applications\/Xcode_26\.[\d.]+\.app\/Contents\/Developer$/, job.name);
    assert.ok(job.steps.some(({ label }) => label === 'Show the toolchain'), `${job.name} prints its Xcode version`);
  }
  assert.match(workflow, /xcodebuild -version/);
  assert.equal(jobs[0].env.SIMULATOR_RUNTIME, 'latest');
  assert.match(jobs[1].env.SIMULATOR_RUNTIME, new RegExp(`^iOS-${major}-\\d+$`));
});

test('the newest runtime checks the 6.9-inch iPhone and the 13-inch iPad presentation matrix', () => {
  const newest = jobSource('newest');
  assert.equal(jobs[0].env.SIMULATOR_NAME, 'iPhone 17 Pro Max');
  assert.match(newest, /Boot the 13-inch iPad Simulator before building/);
  assert.match(newest, /entry\.name\.startsWith\("iPad Pro 13-inch"\)/);
  assert.match(newest, /IPAD_DESTINATION=platform=iOS Simulator,id=\$udid/);
  assert.match(newest, /-only-testing:RecapPageUITests\/PresentationUITests/);
  assert.match(newest, /RecapPage-newest-ipad-ui-\$attempt\.xcresult/);
  assert.match(newest, /timeout-minutes: 35\n {8}run: \|/);
  assert.match(newest, /\$RUNNER_TEMP\/ui-\$attempt\.log/);
  assert.match(newest, /\$RUNNER_TEMP\/ui-ipad-\$attempt\.log/);
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

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
const infrastructure = [
  'The test runner failed to initialize for UI testing.',
  'Failed to get background assertion for target app with pid 13819: Timed out while acquiring background assertion.',
  'Failed to launch application: Timed out while launching application via Xcode.',
];
const assertion = '/repo/LaunchUITests.swift:40: error: -[LaunchUITests testHome] : XCTAssertTrue failed';

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
      ...env,
    },
  });
  assert.ifError(result.error);
  return result;
}

test('both iOS jobs boot and wait for the chosen Simulator before building and keep all attempt bundles', async () => {
  for (const job of jobs) {
    const source = jobSource(job.name);
    const boot = stepScript(source, 'Boot the Simulator before building');
    assert.ok(source.indexOf('Boot the Simulator before building') < source.indexOf('name: Build for testing'));
    const expectedBuilds = job.name === 'newest' ? 5 : 3;
    assert.equal((source.match(/-destination "\$DESTINATION"/g) ?? []).length, expectedBuilds);
    assert.doesNotMatch(source, /simctl (?:shutdown|erase)|retry-tests-on-failure|continue-on-error/);
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
      assert.equal(await readFile(env.GITHUB_ENV, 'utf8'), `DESTINATION=platform=iOS Simulator,id=${expected}\n`);
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

test('the newest runtime boots the available 13-inch iPad before presentation tests', async () => {
  const boot = stepScript(jobSource('newest'), 'Boot the 13-inch iPad Simulator before building');
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
    const result = await runScript(root, stub + boot, { GITHUB_ENV: githubEnv });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl boot newest-ipad\nsimctl bootstatus newest-ipad -b\n');
    assert.equal(await readFile(githubEnv, 'utf8'),
      'IPAD_DESTINATION=platform=iOS Simulator,id=newest-ipad\n');
    await writeFile(join(root, 'devices.json'), JSON.stringify({ devices: {} }));
    const missing = await runScript(root, stub + boot, { GITHUB_ENV: githubEnv });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Requested 13-inch iPad Simulator is not available/);
    assert.equal(await readFile(join(root, 'calls'), 'utf8'),
      'simctl boot newest-ipad\nsimctl bootstatus newest-ipad -b\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('both iOS jobs retry only recognized UI infrastructure failures once and require a complete passing retry', async (t) => {
  const scenarios = [
    { name: 'first pass', logs: ['passed'], codes: [0], calls: 1, exit: 0 },
    ...infrastructure.map((message, index) => ({
      name: `infrastructure ${index + 1} recovers`, logs: [message, 'passed'], codes: [65, 0], calls: 2, exit: 0,
    })),
    { name: 'infrastructure twice', logs: [infrastructure[0], infrastructure[0]], codes: [65, 65], calls: 2, exit: 1 },
    { name: 'retry assertion', logs: [infrastructure[0], assertion], codes: [65, 65], calls: 2, exit: 1 },
    { name: 'real assertion', logs: [assertion], codes: [65], calls: 1, exit: 1 },
    { name: 'mixed failure', logs: [infrastructure[1] + '\n' + assertion], codes: [65], calls: 1, exit: 1 },
    { name: 'unrecognized failure', logs: ['Simulator connection lost'], codes: [65], calls: 1, exit: 1 },
    { name: 'log write failure', logs: [infrastructure[0]], codes: [65], calls: 1, exit: 23, teeFailure: true },
  ];
  for (const job of jobs) {
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
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('the iPad presentation suite retries only the recognized UI infrastructure failures', async (t) => {
  const script = stepScript(jobSource('newest'), 'Run presentation UI tests on iPad');
  const scenarios = [
    { name: 'first pass', logs: ['passed'], codes: [0], calls: 1, exit: 0 },
    { name: 'infrastructure recovers', logs: [infrastructure[0], 'passed'], codes: [65, 0], calls: 2, exit: 0 },
    { name: 'real assertion', logs: [assertion], codes: [65], calls: 1, exit: 1 },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
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
          assert.ok(call.includes('-destination platform=iOS Simulator,id=chosen-ipad'));
          assert.ok(call.includes(`RecapPage-newest-ipad-ui-${index + 1}.xcresult`));
          assert.equal(await readFile(join(root, `ui-ipad-${index + 1}.log`), 'utf8'), scenario.logs[index] + '\n');
        }
        assert.equal((result.stdout.match(/::warning::/g) ?? []).length, scenario.calls - 1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('unit failures stop each iOS job without entering the UI retry gate', async () => {
  for (const job of jobs) {
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
