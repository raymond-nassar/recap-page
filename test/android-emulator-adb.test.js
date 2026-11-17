import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runner = read('scripts/android-emulator-ci.sh');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';

// The fake adb is a file on PATH rather than a function so the script's real `timeout` can bound it.
const fakeAdb = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$EVENTS"
if [[ "$1" == -s ]]; then shift 2; fi
case "$SCENARIO:$1" in
  drop-once:root)
    if [[ ! -f "$STATE/dropped" ]]; then
      touch "$STATE/dropped"
      printf '%s\n' 'adb: unable to connect for root: closed' >&2
      exit 1
    fi
    touch "$STATE/root"; exit 0 ;;
  never:root) printf '%s\n' 'adb: unable to connect for root: closed' >&2; exit 1 ;;
  *:wait-for-device) exit 0 ;;
  *:shell)
    if [[ "$2 $3" == 'id -u' ]]; then
      if [[ -f "$STATE/root" ]]; then printf '0\r\n'; else printf '2000\r\n'; fi
      exit 0
    fi ;;
  hang:logcat|hang:pull|hang:emu) exec sleep 600 ;;
esac
exit 0
`;

async function harness(scenario, body) {
  const root = await mkdtemp(join(tmpdir(), 'recap-adb-root-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  await mkdir(bin);
  await mkdir(state);
  await writeFile(join(bin, 'adb'), fakeAdb, { mode: 0o755 });
  const events = join(root, 'events.txt');
  await writeFile(events, '');
  const script = join(root, 'harness.sh');
  await writeFile(script, `set -euo pipefail
to_shell_path() { if command -v cygpath >/dev/null; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
export EVENTS="$(to_shell_path "$TEST_EVENTS")" STATE="$(to_shell_path "$TEST_STATE")"
export PATH="$(to_shell_path "$TEST_BIN"):$PATH"
EVIDENCE="$(to_shell_path "$TEST_ROOT")"
ANDROID_SERIAL=emulator-5554
APP=io.github.raymondnassar.recappage.prototype
# Count the waits instead of spending them; the bounds under test are the ones passed to timeout.
sleep() { printf 'sleep %s\\n' "$*" >> "$EVENTS"; }
${body}
`);
  const started = Date.now();
  const result = spawnSync(bash, [script], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SCENARIO: scenario, TEST_EVENTS: events, TEST_STATE: state, TEST_BIN: bin, TEST_ROOT: root } });
  const elapsed = Date.now() - started;
  const trace = await readFile(events, 'utf8');
  await rm(root, { recursive: true, force: true }).catch(() => {});
  return { result, trace, elapsed };
}

function block(start, end) {
  const from = runner.indexOf(start);
  assert.ok(from >= 0, `${start} is present`);
  const to = runner.indexOf(end, from);
  assert.ok(to > from, `${end} follows ${start}`);
  return runner.slice(from, to);
}

test('adb root survives one dropped connection and fails boundedly when root never returns', async () => {
  const root = block('test "$booted" = true\n', '\nadb shell iptables -I OUTPUT');
  const body = `booted=true\n${root}\nprintf 'rooted\\n' >> "$EVENTS"`;
  const once = await harness('drop-once', body);
  assert.equal(once.result.status, 0, once.result.stderr);
  assert.match(once.trace, /rooted\n$/);
  assert.equal(once.trace.split('\n').filter((line) => line === 'root').length, 2);
  assert.match(once.result.stderr, /adb root attempt 1 left adbd without root \(uid 2000\)/);

  const never = await harness('never', body);
  assert.notEqual(never.result.status, 0);
  assert.doesNotMatch(never.trace, /rooted/);
  assert.equal(never.trace.split('\n').filter((line) => line === 'root').length, 3);
  assert.equal(never.trace.split('\n').filter((line) => line === 'sleep 5').length, 2);
  assert.match(never.result.stderr, /adb root failed after 3 attempts/);
});

test('debug cleanup keeps its evidence and ends when adb and the emulator stop answering', async () => {
  const cleanup = block('cleanup() {', '\ntrap cleanup EXIT');
  // These deadlines are the script's own; the harness waits them out once, so keep the sum honest.
  const bounds = [...cleanup.matchAll(/timeout --kill-after=(\d+) (\d+) adb/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(bounds, [[5, 60], [5, 60], [1, 2], [5, 20]]);
  const fast = cleanup.replaceAll('timeout --kill-after=5 60 adb', 'timeout --kill-after=1 1 adb')
    .replace('timeout --kill-after=5 20 adb', 'timeout --kill-after=1 1 adb');
  const { result, trace, elapsed } = await harness('hang', `MODE=debug
SOURCE_BACKUP=""
NATIVE_FAILURE_ACTIVE=0
command bash -c 'trap "" TERM; while :; do command sleep 1; done' &
EMULATOR_PID=$!
${fast}
trap cleanup EXIT
false`);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(elapsed < 30000, `cleanup took ${elapsed} ms`);
  assert.match(trace, /logcat -d -v threadtime/);
  assert.match(trace, /pull \/sdcard\/Android\/data\/io\.github\.raymondnassar\.recappage\.prototype\/files\/native-test-evidence/);
  assert.match(trace, /emu kill/);
  assert.equal(trace.split('\n').filter((line) => line === 'sleep 1').length, 30);
});

test('the Android cloud provider tests run wherever the policy tests run, under their own deadline', () => {
  const gradle = read('packaging/android/app/build.gradle');
  const cloud = gradle.slice(gradle.indexOf("tasks.register('cloudTest'"), gradle.indexOf("tasks.named('check')"));
  assert.match(cloud, /timeout = java\.time\.Duration\.ofMinutes\(3\)/);
  const sites = [
    ['scripts/android-emulator-ci.sh', runner],
    ['scripts/android-release-candidate.sh', read('scripts/android-release-candidate.sh')],
    ['docs/ANDROID.md', read('docs/ANDROID.md')],
  ];
  for (const [path, text] of sites) {
    const lines = text.split(/\r?\n/).filter((line) => /\bpolicyTest\b/.test(line));
    assert.ok(lines.length > 0, `${path} runs policyTest`);
    for (const line of lines) assert.match(line, /\bpolicyTest cloudTest\b/, `${path}: ${line}`);
  }
});
