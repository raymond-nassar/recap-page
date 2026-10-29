import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.equal(builds.filter(([command]) => command.includes('test-without-building')).length, 3,
    'each job tests once, with one additional opt-in CORS test');
  assert.match(builds.find(([command]) => command.includes('-configuration Release'))[0],
    /-destination "\$DESTINATION"[\s\S]*CODE_SIGNING_ALLOWED=NO/);
  assert.match(block('concurrency'), /group: ios-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
});

test('live metadata CORS is off by default and runs only from an opted-in manual dispatch', () => {
  assert.match(workflow,
    /workflow_dispatch:\n {4}inputs:\n {6}live_cors:\n {8}description: Check whether the live metadata API permits the app origin\n {8}required: false\n {8}type: boolean\n {8}default: false/);
  assert.match(workflow,
    /- name: Check live metadata CORS from the app origin\n {8}if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.live_cors \}\}\n {8}timeout-minutes: 10\n {8}env:\n {10}RECAP_RUN_LIVE_CORS: '1'/);
  assert.match(workflow, /-only-testing:RecapPageUITests\/LaunchUITests\/testManualLiveMetadataCorsFromTheAppOrigin/);
});

test('the newest runtime and the app\'s oldest supported system are both tested, with Xcode chosen by path', () => {
  assert.deepEqual(jobs.map(({ name, runsOn }) => [name, runsOn]), [['newest', 'macos-26'], ['minimum', 'macos-15']]);
  const major = identity.minimumOS.split('.')[0];
  for (const job of jobs) {
    assert.match(job.env.DEVELOPER_DIR, /^\/Applications\/Xcode_26\.[\d.]+\.app\/Contents\/Developer$/, job.name);
    assert.ok(job.steps.some(({ label }) => label === 'Show the toolchain'), `${job.name} prints its Xcode version`);
  }
  assert.match(workflow, /xcodebuild -version/);
  assert.match(jobs[0].env.DESTINATION, /,OS=latest$/);
  assert.match(jobs[1].env.DESTINATION, new RegExp(`,OS=${major}\\.\\d+$`));
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
