import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The workflow had no deadline of any kind, so every job inherited the platform default of
// six hours. A hung install or a wedged step would have burned that before anyone was told.
// The fix is deadlines, and the interesting part is where they go.
//
// Measured on a probe workflow run on 2026-08-11 rather than read anywhere: the same overrun
// under a job-level `timeout-minutes` ends the job with conclusion `cancelled`, and under a
// step-level one it ends with `failure` and marks the step. That difference decides the whole
// design here, because this repository's concurrency group cancels superseded runs and its own
// contributor guide teaches readers that a cancelled job means nothing is broken. A deadline
// reporting `cancelled` would be a real failure wearing the one costume everyone here is
// trained to dismiss.
//
// So the deadline that fires has to be the step's, and the job's exists only as a backstop for
// time spent outside any step. That ordering is not visible in the file; it is an arithmetic
// relationship between numbers written eighty lines apart, which is exactly the kind of thing
// that decays quietly. Hence this.

// YAML by hand, because a parser is a dependency and runtime dependencies stay at zero here.
// It only has to read one file that this repository controls, and the last test below is what
// keeps that honest: it holds the parser to the file's own count of steps and of deadlines, both
// derived from the text rather than from the parse. Counting deadlines alone was not enough. A
// step written at the parent's indentation, which is valid YAML and the commoner style in
// GitHub's own documentation, is missed by the openers regex below, and a missed step that
// declares no deadline moves neither count. Counting the openers too is what closes that.
function parseWorkflow(yml) {
  const jobs = [];
  let inJobs = false;
  let job = null;
  let inSteps = false;
  let step = null;

  for (const line of yml.split(/\r?\n/)) {
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
      job = { name: header[1], timeout: null, steps: [] };
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
      continue;
    }
    if (!inSteps) continue;

    const opener = /^ {6}- (.*)$/.exec(line);
    if (opener) {
      step = { label: null, timeout: null };
      job.steps.push(step);
      readStepKey(step, opener[1]);
      continue;
    }

    const body = /^ {8}(\S.*)$/.exec(line);
    if (body && step) readStepKey(step, body[1]);
  }

  return jobs;
}

function readStepKey(step, text) {
  const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(text);
  if (!pair) return;
  if (pair[1] === 'timeout-minutes') step.timeout = minutes(pair[2]);
  if ((pair[1] === 'name' || pair[1] === 'uses') && step.label === null) step.label = pair[2].trim();
}

// A deadline that is present but unreadable is a different fault from one that is absent, and
// telling a reader the line is missing when it is sitting there with a trailing comment on it
// sends them looking in the wrong place. Almost every decision in that workflow carries a
// comment, so this is the likely edit rather than an exotic one. NaN would have survived the
// null filter in the accounting test and surfaced as "has no deadline".
function minutes(value) {
  const plain = /^(\d+)\s*(?:#.*)?$/.exec(value.trim());
  return plain ? Number(plain[1]) : { unreadable: value.trim() };
}

function describeBadValue(value) {
  return value && typeof value === 'object' && 'unreadable' in value
    ? `is not a plain number of minutes, it reads ${JSON.stringify(value.unreadable)}`
    : 'is absent, so the six hour platform default applies';
}

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const jobs = parseWorkflow(workflow);

// Time the runner spends inside the job but outside any declared step: setting the job up,
// running each action's post phase, and cleaning up. Measured across 676 successful jobs it
// totals eight seconds at its worst, so a minute is roughly seven times that, and the two and
// four minutes actually written are fifteen and thirty times it. The point of the margin is not
// the eight seconds though; it is that the job deadline must be unreachable while a step still
// has allowance left, and any positive margin buys that.
const RUNNER_OVERHEAD_MINUTES = 1;

test('every job in the workflow declares a deadline', () => {
  assert.deepEqual(
    jobs.map((j) => j.name),
    ['test', 'lint', 'android-emulator'],
    'the parser found exactly the jobs this test knows about. A job added since belongs in this list, '
      + 'and a job missing from the parse is a parser fault rather than a workflow fault',
  );
  for (const job of jobs) {
    assert.ok(
      Number.isInteger(job.timeout) && job.timeout > 0,
      `the deadline on job ${job.name} ${describeBadValue(job.timeout)}`,
    );
  }
});

test('every step in every job declares its own deadline', () => {
  for (const job of jobs) {
    assert.ok(
      job.steps.length >= 4,
      `the parser found only ${job.steps.length} step(s) in job ${job.name}. If the job really is `
        + 'that small, lower this floor; otherwise the parser is missing steps',
    );
    for (const step of job.steps) {
      assert.ok(
        Number.isInteger(step.timeout) && step.timeout > 0,
        `the deadline on step ${JSON.stringify(step.label)} in job ${job.name} `
          + `${describeBadValue(step.timeout)}, so an overrun there reports cancelled rather than failure`,
      );
    }
  }
});

test('each job deadline stays out of the way until every step has used its own', () => {
  for (const job of jobs) {
    const declared = job.steps.reduce((total, step) => total + (Number.isInteger(step.timeout) ? step.timeout : 0), 0);
    assert.ok(
      Number.isInteger(job.timeout) && job.timeout >= declared + RUNNER_OVERHEAD_MINUTES,
      `job ${job.name} allows ${JSON.stringify(job.timeout)} minutes but its steps allow ${declared}, `
        + 'so the job deadline can fire first and report the overrun as cancelled',
    );
  }
});

// The three tests above are only worth their run time if the parser sees the whole file. A parser
// that quietly dropped a step would report every step it found as compliant and say nothing about
// the rest, which is the shape of vacuity that has already cost this repository one test. Both
// counts here are read off the text rather than the parse, which is the only way to notice
// something the parse never produced.
//
// The step count is the half that matters most, and it was missing when this test was first
// written. A step opener written at the parent's indentation is dropped by the parser and, if it
// carries no deadline, moves the deadline count not at all, so the whole suite stayed green over a
// step it had never examined.
test('the parser accounts for every step and every deadline the file declares', () => {
  const lines = workflow.split(/\r?\n/);
  // Any first key, not just the three this file happens to use. The parser's own opener accepts
  // any key, so a narrower rule here turns an ordinary `- id:` or `- if:` step into a red build
  // that blames the parser for a step the parser got right. Both were tried and both did that.
  // Counting starts at `jobs:` for the same reason: a sequence item under `on:`, such as the
  // `- cron:` of a schedule trigger, is a mapping in a sequence exactly as a step is, and nothing
  // about the line itself says otherwise. Measured: adding one takes the count to 13 against 12.
  const stepRegion = lines.slice(lines.findIndex((line) => /^jobs:/.test(line)));
  const declaredSteps = stepRegion.filter((line) => /^\s*- [A-Za-z0-9_-]+:/.test(line)).length;
  const declaredDeadlines = lines.filter((line) => /^\s*timeout-minutes:/.test(line)).length;

  const foundSteps = jobs.reduce((total, job) => total + job.steps.length, 0);
  const foundDeadlines = jobs.reduce(
    (total, job) => total + (job.timeout === null ? 0 : 1) + job.steps.filter((s) => s.timeout !== null).length,
    0,
  );

  assert.ok(declaredSteps > 0 && declaredDeadlines > 0, 'the file declares steps and deadlines at all');
  // Which side is short decides who is wrong, so the message has to say. Short on the parse is the
  // fault this test exists for. Short on the text is this check's own known limit: a line inside a
  // block scalar can look like a step opener, and no rule that reads the file as text can tell.
  assert.equal(
    foundSteps,
    declaredSteps,
    foundSteps < declaredSteps
      ? `the parser found ${foundSteps} steps where the file writes ${declaredSteps} step openers, so it `
        + 'is missing one and the three tests above never examined it. If the extra opener is a line '
        + 'inside a block scalar rather than a real step, this counting rule is what needs narrowing'
      : `the parser found ${foundSteps} steps where the file writes ${declaredSteps} step openers, so `
        + 'the parser is seeing something the counting rule does not recognise as a step opener',
  );
  assert.equal(foundDeadlines, declaredDeadlines, 'every deadline written in the file was attributed to a job or a step');
});
