import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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
  assert.deepEqual(triggers.filter((line) => /^ {4}\S/.test(line)).map((line) => line.trim()), ['branches: [main]']);
  assert.doesNotMatch(triggers.join('\n'), /paths|paths-ignore|branches-ignore|types:/);
});

test('the iOS workflow reads the repository and nothing more: no secret, no environment and no signing', () => {
  assert.equal(block('permissions').trim(), 'contents: read');
  assert.doesNotMatch(workflow, /secrets\.|\benvironment:|id-token|allowProvisioningUpdates|exportArchive|\barchive\b|authenticationKey/);
  const builds = [...workflow.matchAll(/xcodebuild (?:build-for-testing|test-without-building)[\s\S]*?CODE_SIGNING_ALLOWED=NO/g)];
  assert.equal(builds.length, [...workflow.matchAll(/xcodebuild (?:build-for-testing|test-without-building)/g)].length);
  assert.equal(builds.length, 6, 'each job builds once and runs separate unsigned unit and UI invocations');
  assert.match(block('concurrency'), /group: ios-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
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
    env: { ...process.env, RUNNER_TEMP: root, DESTINATION: 'platform=iOS Simulator,id=chosen-device', ...env },
  });
  assert.ifError(result.error);
  return result;
}

test('both iOS jobs boot and wait for the chosen Simulator before building and keep all attempt bundles', async () => {
  for (const job of jobs) {
    const source = jobSource(job.name);
    const boot = stepScript(source, 'Boot the Simulator before building');
    assert.ok(source.indexOf('Boot the Simulator before building') < source.indexOf('name: Build for testing'));
    assert.equal((source.match(/-destination "\$DESTINATION"/g) ?? []).length, 3);
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
