import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/take-issue.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const script = workflow.match(/ {10}node --input-type=commonjs <<'NODE'\r?\n([\s\S]*?) {10}NODE/)?.[1]
  .replace(/^ {10}/gm, '');

test('Issue claiming grants only Issue write permission and handles created comments without checkout', () => {
  assert.equal(workflow.match(/^on:\r?\n([\s\S]*?)\r?\npermissions:/m)?.[1].trim(),
    'issue_comment:\n    types: [created]');
  assert.equal(workflow.match(/^permissions:\r?\n([\s\S]*?)\r?\njobs:/m)?.[1].trim(), 'issues: write');
  assert.equal((workflow.match(/^\s*permissions:/gm) ?? []).length, 1);
  assert.doesNotMatch(workflow, /^\s*(?:-\s*)?uses:|checkout|pull_request_target|workflow_dispatch/m);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /github\.event\.comment\.body == '\/take'/);
  assert.match(workflow, /github\.event\.comment\.user\.type == 'User'/);
  assert.match(workflow, /!github\.event\.issue\.pull_request/);
  assert.match(workflow, /github\.event\.issue\.state == 'open'/);
  assert.match(workflow, /!github\.event\.issue\.assignees\[0\]/);
  for (const label of ['good first issue', 'help wanted']) {
    assert.ok(workflow.includes(`contains(github.event.issue.labels.*.name, '${label}')`));
  }
});

test('eligible claim jobs queue in order without replacing pending claims', () => {
  assert.doesNotMatch(workflow, /^concurrency:/m);
  const claim = workflow.match(/^ {2}claim:\n((?: {4}[^\n]*\n|\n)*)/m)?.[1];
  assert.ok(claim, 'claim job must exist');
  assert.equal(claim.match(/^ {4}concurrency:\n((?: {6}.+\n)+)/m)?.[1],
    '      group: take-issue-${{ github.repository }}-${{ github.event.issue.number }}\n' +
    '      queue: max\n' +
    '      cancel-in-progress: false\n');
});

test('the claim run block contains no Actions expressions or downloaded code', () => {
  const run = workflow.split('        run: |')[1];
  assert.ok(run && script);
  assert.doesNotMatch(run, /\$\{\{|checkout|https?:|eval\(|exec\(/);
  assert.match(run, /execFileSync\('gh', args/);
  assert.match(run, /readFileSync\(process\.env\.GITHUB_EVENT_PATH/);
  assert.match(run, /process\.env\.GITHUB_REPOSITORY/);
});

test('the claim step has its own deadline below the job backstop', () => {
  const job = Number(workflow.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]);
  const steps = [...workflow.matchAll(/^ {6}- name:/gm)];
  const deadlines = [...workflow.matchAll(/^ {8}timeout-minutes: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.equal(steps.length, 1);
  assert.equal(deadlines.length, steps.length);
  assert.ok(deadlines.every((value) => value > 0));
  assert.ok(job > deadlines.reduce((sum, value) => sum + value, 0));
});

function issue(overrides = {}) {
  return { number: 42, state: 'open', assignees: [], labels: [{ name: 'good first issue' }], ...overrides };
}

function execute({ event = {}, current = issue(), response, failMethod } = {}) {
  const payload = {
    action: 'created',
    issue: issue(),
    comment: { body: '/take', user: { login: 'newcomer', type: 'User' } },
    ...event,
  };
  const calls = [];
  const logs = [];
  let error;
  const fs = { readFileSync: (path) => {
    assert.equal(path, 'event.json');
    return JSON.stringify(payload);
  } };
  const child = { execFileSync: (command, args, options) => {
    assert.equal(command, 'gh');
    assert.equal(options.shell, undefined);
    const method = args[2];
    calls.push({ method, endpoint: args[3], body: options.input && JSON.parse(options.input) });
    if (method === failMethod) throw new Error('API request failed');
    return JSON.stringify(method === 'GET' ? current : response ?? {
      assignees: [{ login: payload.comment.user.login }],
    });
  } };
  try {
    runInNewContext(script, {
      require: (name) => {
        assert.ok(['node:fs', 'node:child_process'].includes(name));
        return name === 'node:fs' ? fs : child;
      },
      process: { env: { GITHUB_EVENT_PATH: 'event.json', GITHUB_REPOSITORY: 'owner/repo' } },
      console: { log: (message) => logs.push(message) },
    });
  } catch (caught) {
    error = caught;
  }
  return { calls, logs, error };
}

test('either eligible label assigns only the human commenter on this repository Issue', () => {
  for (const label of ['good first issue', 'help wanted']) {
    const result = execute({
      event: { issue: issue({ labels: [{ name: label }] }) },
      current: issue({ labels: [{ name: label }] }),
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.calls, [
      { method: 'GET', endpoint: 'repos/owner/repo/issues/42', body: undefined },
      { method: 'POST', endpoint: 'repos/owner/repo/issues/42/assignees', body: { assignees: ['newcomer'] } },
    ]);
  }
});

test('invalid events never call GitHub even if comment text contains shell syntax', () => {
  const invalid = [
    { action: 'edited' },
    { comment: { body: '/take', user: { login: 'robot[bot]', type: 'Bot' } } },
    ...['/take\n', ' /take', '/take please', '/take; echo injected', '$(whoami)', '/TAKE'].map((body) => ({
      comment: { body, user: { login: 'newcomer', type: 'User' } },
    })),
    ...[
      { pull_request: {} }, { state: 'closed' }, { labels: [] },
      { labels: [{ name: 'bug' }] }, { assignees: [{ login: 'someone' }] },
    ].map((overrides) => ({ issue: issue(overrides) })),
  ];
  for (const event of invalid) {
    const result = execute({ event });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.calls, []);
    assert.match(result.logs[0], /^Skipped:/);
  }
});

test('live eligibility is checked again before assigning queued claims', () => {
  for (const overrides of [
    { pull_request: {} }, { state: 'closed' }, { labels: [] },
    { labels: [{ name: 'bug' }] }, { assignees: [{ login: 'someone' }] },
  ]) {
    const result = execute({ current: issue(overrides) });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.calls.map((call) => call.method), ['GET']);
    assert.match(result.logs[0], /^Skipped:/);
  }
});

test('API failures and ignored assignments fail explicitly without repeating a write', () => {
  for (const failMethod of ['GET', 'POST']) {
    const result = execute({ failMethod });
    assert.match(result.error?.message ?? '', /API request failed/);
    assert.equal(result.calls.filter((call) => call.method === 'POST').length, failMethod === 'POST' ? 1 : 0);
    assert.deepEqual(result.logs, []);
  }
  const ignored = execute({ response: { assignees: [] } });
  assert.match(ignored.error?.message ?? '', /GitHub did not assign the commenter/);
  assert.equal(ignored.calls.length, 2);
  assert.deepEqual(ignored.logs, []);
});
