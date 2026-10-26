import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AXE_VERSION } from '../scripts/browser-axe.mjs';

// #832 item 1 (UX-33). What the UI owners job must keep doing for its result to mean anything: run
// the four owners the audit named against installed Edge, gate the alignment owner on a baseline
// from its own tree, and record the comparison with the base without ever failing on it. Each of
// those is one edited line away from a job that stays green while checking less.

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const job = /\n {2}ui-owners:\n([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:\n|$)/.exec(workflow)?.[1] ?? '';
const steps = job.split(/\n(?= {6}- )/).slice(1);
const step = (pattern) => steps.filter((text) => pattern.test(text));
const literal = (text) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

test('the UI owners job runs on Windows for every trigger, so a pull request cannot skip it', () => {
  assert.ok(job, 'ci.yml has a ui-owners job');
  assert.match(job, /^ {4}runs-on: windows-2022$/m);
  assert.doesNotMatch(job, /^ {4}if:/m, 'the job itself has no condition');
  assert.doesNotMatch(job, /^ {4}continue-on-error:/m, 'the job can fail');
});

test('each owner the audit named runs in its own step, after the driver installed', () => {
  const owners = [
    ['browser-check.mjs', 'responsive-reflow'],
    ['browser-check.mjs', 'narrow-navigation'],
    ['browser-android.mjs', 'catalog-cards'],
    ['browser-android.mjs', 'alignment'],
  ];
  for (const [runner, owner] of owners) {
    const found = step(new RegExp(`node scripts/${literal(runner)} --only=${literal(owner)}(\\s|$)`));
    assert.ok(found.length >= 1, `a step runs ${owner}`);
    const gate = found[0];
    assert.match(gate, /if: \$\{\{ !cancelled\(\) && steps\.install\.outcome == 'success' \}\}/,
      `${owner} runs after an earlier owner fails, but not without a driver`);
    assert.doesNotMatch(gate, /continue-on-error/, `${owner} fails the job`);
  }
});

test('the alignment gate compares with a baseline recorded from the same tree', () => {
  const [gate] = step(/^ {6}- name: Android owner alignment$/m);
  assert.ok(gate, 'the alignment gate step exists');
  const lines = gate.split('\n').map((line) => line.trim());
  const baseline = lines.findIndex((line) => line === 'node scripts/browser-android.mjs --only=alignment --alignment-baseline');
  const adopt = lines.indexOf('$env:MRT_ALIGNMENT_BASELINE = $env:MRT_ALIGNMENT_OUTPUT');
  const compare = lines.findIndex((line, index) => index > adopt && line === 'node scripts/browser-android.mjs --only=alignment');
  assert.ok(baseline >= 0 && baseline < adopt && adopt < compare, 'baseline, then that output as the baseline, then the comparison');
  assert.equal(lines.filter((line) => /^if \(\$LASTEXITCODE -ne 0\) \{ throw /.test(line)).length, 2, 'either pass failing fails the step');
});

test('the comparison with the base runs on pull requests only and never fails the job', () => {
  const record = step(/github\.event_name == 'pull_request'/);
  assert.equal(record.length, 2, 'the base checkout and the record');
  for (const text of record) assert.match(text, /^ {8}continue-on-error: true$/m);
  const [checkout, compare] = record;
  assert.match(checkout, /uses: actions\/checkout@/);
  assert.match(checkout, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(checkout, /persist-credentials: false/);
  assert.match(compare, /node scripts\/alignment-moves\.mjs /);
  assert.match(compare, /GITHUB_STEP_SUMMARY/);
  assert.ok(compare.trimEnd().endsWith('\n          exit 0'), 'the record ends successful whatever the passes before it returned');
});

test('the driver and axe-core install outside the checkout, at the versions the harness pins', () => {
  const [install] = step(/^ {8}id: install$/m);
  assert.ok(install, 'the install step exists');
  assert.match(install, /Copy-Item -LiteralPath \.\/\.github\/browser-proof -Destination \$driver/);
  assert.match(install, /\$driver = Join-Path \$env:RUNNER_TEMP /);
  assert.match(install, /npm ci --prefix \$driver --ignore-scripts --no-audit/);
  assert.match(install, /\$axe = Join-Path \$env:RUNNER_TEMP /);
  assert.match(install, new RegExp(`npm install --prefix \\$axe --ignore-scripts .*axe-core@${literal(AXE_VERSION)}$`, 'm'),
    'axe-core is installed at exactly the version the harness pins its file hash for');
  const [axe] = step(/node scripts\/browser-check\.mjs --axe /);
  assert.ok(axe, 'the rules pass runs');
  assert.match(axe, /"--axe-core=\$axe"/);
  assert.match(axe, /\$axe = Join-Path \$env:RUNNER_TEMP 'recap-ui-owners-axe'/);
  assert.match(install, /\$axe = Join-Path \$env:RUNNER_TEMP 'recap-ui-owners-axe'/);
});
