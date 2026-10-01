import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, open, rename } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateIdentity } from './lib/release-identity.mjs';

export const NATIVE_CLASS = 'io.github.raymondnassar.recappage.prototype.NativeIntegrationTest';
export const NATIVE_METHODS = [
  'startupAndPersistence',
  'systemPickerSaveAndCancel',
  'providerRoundTripAndWriteFailure',
  'readerPopupAndExternalIntent',
  'backAndRecreation',
  'fontRotationAndKeyboard',
];
export const NATIVE_FAILURE_FILE = 'android-native-failure.json';
const FAILURE_LIMIT = 256 * 1024;
const LOG_LIMIT = 64 * 1024;
const PHASES = ['suite', 'restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe'];
const TARGETS = {
  official: 'io.github.raymondnassar.recappage',
  prototype: 'io.github.raymondnassar.recappage.prototype',
};
const LOG_MARKERS = [
  ['FATAL_EXCEPTION', /FATAL EXCEPTION/i], ['SECURITY_EXCEPTION', /SecurityException/],
  ['ILLEGAL_STATE', /IllegalStateException/], ['ASSERTION', /AssertionError/],
  ['CLASS_NOT_FOUND', /NoClassDefFoundError|ClassNotFoundException/], ['KOTLIN', /\bkotlin[./]/],
  ['UI_AUTOMATION', /UiAutomation/], ['ACTIVITY_SCENARIO', /ActivityScenario/],
  ['ACTIVITY_NOT_FOUND', /ActivityNotFoundException|Unable to resolve activity/],
  ['PERMISSION_DENIED', /Permission Denial|Permission denied/i],
  ['PROCESS_CRASH', /Process crashed|Process .* has died/i], ['BINDER_DEATH', /DeadObjectException|binder.*died/i],
  ['TIMED_OUT', /timed? out|timeout/i], ['DEVICE_OFFLINE', /device offline|device not found|no devices/i],
  ['CONNECTION_CLOSED', /connection.*closed|connection.*reset|disconnected/i],
  ['RENDERER_EXIT', /Renderer process.*crash|onRenderProcessGone/],
  ['EMULATOR_FATAL', /PANIC|FATAL|fatal error/], ['EMULATOR_KILLED', /killing emulator|Killed|SIGKILL/],
  ['INSTRUMENTATION_FAILED', /INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED/],
  ['TEST_STARTED', /INSTRUMENTATION_STATUS_CODE: 1$/],
  ['TEST_PASSED', /INSTRUMENTATION_STATUS_CODE: 0$/],
  ['TEST_FAILED', /INSTRUMENTATION_STATUS_CODE: -[1-4]$/],
  ['INSTRUMENTATION_TERMINAL', /INSTRUMENTATION_CODE: -?\d+$/],
];
const REASONS = ['none', 'missing', 'not-regular', 'oversized', 'read-failed', 'command-failed',
  'timed-out', 'not-attempted', 'device-unavailable', 'transport-lost', 'invalid-response', 'uid-unavailable'];
const keys = (value, expected) => assert.ok(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...expected].sort().join(), 'Unexpected native failure fields');
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const exitCode = (value) => integer(value, 255);
const choice = (value, values) => assert.ok(values.includes(value), 'Unsupported native failure value');

function excerpt(raw, { bytes = Buffer.byteLength(raw), truncated = false, exitCode: status = null } = {}) {
  const lines = raw.split(/\r?\n/).map((line) => LOG_MARKERS.filter(([, pattern]) => pattern.test(line))
    .map(([label]) => label).join(' | ')).filter(Boolean);
  return { availability: 'available', reason: 'none', exitCode: status, bytes,
    truncated: truncated || lines.length > 12, excerpts: lines.slice(-12) };
}
const unavailable = (reason, status = null) => ({ availability: 'unavailable', reason, exitCode: status,
  bytes: 0, truncated: reason === 'oversized', excerpts: [] });

async function regularPath(root, path) {
  const child = relative(root, path);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Native failure path is outside owned work');
  for (let current = path; current !== root; current = dirname(current)) {
    const info = await lstat(current);
    assert.ok(!info.isSymbolicLink(), 'Native failure path contains a symlink');
  }
}

export async function nativeFailureContext(env = process.env) {
  assert.equal(env.RECAP_ANDROID_MODE, 'Rehearsal', 'Failure capsules are Rehearsal only');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'raymond-nassar/recap-page');
  assert.match(env.GITHUB_SHA || '', /^[0-9a-f]{40}$/);
  assert.equal(env.RECAP_ANDROID_SOURCE_SHA, env.GITHUB_SHA);
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA);
  assert.match(env.GITHUB_RUN_ID || '', /^[1-9]\d*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^[1-9]\d*$/);
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  assert.ok(integer(runId) && integer(attempt));
  assert.ok(env.RUNNER_TEMP && isAbsolute(env.RUNNER_TEMP), 'Owned runner temporary root required');
  const temporary = resolve(env.RUNNER_TEMP);
  const work = join(temporary, `recap-aab-${runId}-${attempt}`);
  await regularPath(temporary, join(work, '.owner'));
  assert.equal(await readFile(join(work, '.owner'), 'utf8'), `${runId}:${attempt}`);
  const versionPath = join(work, 'version.json');
  await regularPath(work, versionPath);
  assert.ok((await lstat(versionPath)).size <= LOG_LIMIT);
  const version = JSON.parse(await readFile(versionPath, 'utf8'));
  const identity = validateIdentity(version.identity);
  assert.equal(identity.platform, 'android');
  assert.equal(identity.channel, 'development');
  assert.equal(identity.sourceRevision, env.GITHUB_SHA);
  assert.equal(identity.sourceDirty, false);
  const workflow = ['ci.yml', 'android-release-candidate.yml'].find((name) =>
    env.GITHUB_WORKFLOW_REF === `raymond-nassar/recap-page/.github/workflows/${name}@${env.GITHUB_REF}`);
  assert.ok(workflow && (env.GITHUB_REF || '').startsWith('refs/heads/'), 'Unknown failure workflow identity');
  return { work, path: join(work, NATIVE_FAILURE_FILE),
    source: { revision: env.GITHUB_SHA, tree: identity.sourceTree, runId, attempt, workflow } };
}

async function boundedFile(root, path, limit = LOG_LIMIT) {
  try {
    await regularPath(root, path);
    const info = await lstat(path);
    if (!info.isFile()) return { ...unavailable('not-regular'), raw: '' };
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size, limit));
      await handle.read(buffer, 0, buffer.length, Math.max(0, info.size - buffer.length));
      return { ...excerpt(buffer.toString('utf8'), { bytes: info.size, truncated: info.size > limit }),
        raw: buffer.toString('utf8'), rawTruncated: info.size > limit };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return { ...unavailable(error.code === 'ENOENT' ? 'missing' : 'read-failed'), raw: '' };
  }
}

function captureCommand(args, milliseconds, deadline) {
  const remaining = Math.min(milliseconds, deadline - Date.now());
  if (remaining <= 0) return { status: null, reason: 'not-attempted', output: '', lost: true };
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/TOKEN|PASSWORD|KEYSTORE|CREDENTIAL|SECRET|KEY_ALIAS/.test(name)));
  const result = spawnSync('adb', ['-s', 'emulator-5554', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: remaining, maxBuffer: 32768, env,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const ok = result.status === 0 && !result.error;
  const offline = /device offline|device .*not found|no devices|device disconnected/i.test(result.stderr || '');
  return { status: exitCode(result.status) ? result.status : null,
    reason: ok ? 'none' : timedOut ? 'timed-out' : offline ? 'device-unavailable'
      : result.error?.code === 'ENOBUFS' ? 'oversized' : 'command-failed',
    output: ok ? result.stdout : '', lost: offline || timedOut || result.status === 255 || Boolean(result.error) };
}

function processState(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'unavailable';
  try {
    process.kill(pid, 0);
    return 'present';
  } catch (error) {
    return error.code === 'ESRCH' ? 'absent' : 'unavailable';
  }
}

function instrumentationFacts(log, methods) {
  const count = (pattern) => Math.min(100, [...log.raw.matchAll(pattern)].length);
  let checker = 'unavailable';
  if (log.availability === 'available' && !log.rawTruncated) {
    try {
      verifyInstrumentation(log.raw, { methods });
      checker = 'passed';
    } catch {
      checker = 'rejected';
    }
  }
  const summary = { availability: log.availability, reason: log.reason, exitCode: log.exitCode,
    bytes: log.bytes, truncated: log.truncated, excerpts: log.excerpts };
  return { ...summary, starts: count(/^INSTRUMENTATION_STATUS_CODE: 1\r?$/gm),
    passed: count(/^INSTRUMENTATION_STATUS_CODE: 0\r?$/gm),
    failed: count(/^INSTRUMENTATION_STATUS_CODE: -[1-4]\r?$/gm),
    terminal: /^INSTRUMENTATION_CODE: -1\r?$/m.test(log.raw), checker };
}

function receiptFacts(raw, phase, method) {
  const absent = { phase, method, availability: 'unavailable', reason: 'missing',
    stateMatched: null, settingsMatched: null, storageCleared: null };
  if (Buffer.byteLength(raw) > 16384) return { ...absent, reason: 'oversized' };
  try {
    const value = JSON.parse(raw);
    const execution = value.execution;
    const target = phase.startsWith('prototype') ? TARGETS.prototype : TARGETS.official;
    assert.ok(execution && execution.phase === phase && execution.method === method && execution.packageName === target
      && execution.status === 'passed' && execution.tests === 1 && execution.skipped === 0
      && ['stateMatched', 'settingsMatched', 'storageCleared'].every((key) => typeof execution[key] === 'boolean'));
    return { phase, method, availability: 'available', reason: 'none',
      stateMatched: execution.stateMatched, settingsMatched: execution.settingsMatched, storageCleared: execution.storageCleared };
  } catch {
    return { ...absent, reason: 'invalid-response' };
  }
}

function validateLog(value) {
  choice(value.availability, ['available', 'unavailable']);
  choice(value.reason, REASONS);
  assert.equal(value.reason === 'none', value.availability === 'available');
  assert.ok(integer(value.bytes) && typeof value.truncated === 'boolean');
  assert.ok(value.exitCode === null || exitCode(value.exitCode));
  assert.ok(Array.isArray(value.excerpts) && value.excerpts.length <= 12);
  for (const line of value.excerpts) {
    assert.ok(typeof line === 'string' && line.length <= 1024 && line.length > 0);
    assert.ok(line.split(' | ').every((marker) => LOG_MARKERS.some(([known]) => marker === known)));
  }
}

export function validateNativeFailure(value, source) {
  keys(value, ['schemaVersion', 'kind', 'qualified', 'source', 'phase', 'method', 'target', 'targetMatchesPhase', 'primary',
    'captureBudgetSeconds', 'instrumentation', 'device', 'host', 'receipts', 'shutdown']);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, 'android-native-failure');
  assert.equal(value.qualified, false);
  keys(value.source, ['revision', 'tree', 'runId', 'attempt', 'workflow']);
  assert.match(value.source.revision, /^[0-9a-f]{40}$/);
  assert.match(value.source.tree, /^[0-9a-f]{40}$/);
  assert.ok(integer(value.source.runId) && value.source.runId > 0 && integer(value.source.attempt) && value.source.attempt > 0);
  choice(value.source.workflow, ['ci.yml', 'android-release-candidate.yml']);
  assert.deepEqual(value.source, source);
  choice(value.phase, PHASES);
  assert.equal(value.method, value.phase === 'suite' ? 'all' : 'startupAndPersistence');
  choice(value.target, ['official', 'prototype']);
  assert.equal(value.targetMatchesPhase, value.target === (value.phase.startsWith('prototype') ? 'prototype' : 'official'));
  keys(value.primary, ['operation', 'exitCode', 'instrumentExit', 'teeExit', 'checkerExit', 'pullExit']);
  const p = value.primary;
  assert.ok(exitCode(p.instrumentExit) && exitCode(p.teeExit)
    && [p.checkerExit, p.pullExit].every((code) => code === null || exitCode(code)));
  const failure = p.instrumentExit ? ['instrumentation', p.instrumentExit] : p.teeExit ? ['tee', p.teeExit]
    : p.checkerExit ? ['checker', p.checkerExit] : ['receipt', p.pullExit];
  assert.ok(failure[1] > 0 && p.exitCode === failure[1] && p.operation === failure[0]);
  assert.equal(value.captureBudgetSeconds, 45);
  keys(value.instrumentation, ['availability', 'reason', 'exitCode', 'bytes', 'truncated', 'excerpts', 'starts', 'passed', 'failed', 'terminal', 'checker']);
  validateLog(value.instrumentation);
  assert.ok(['starts', 'passed', 'failed'].every((key) => integer(value.instrumentation[key], 100)));
  assert.equal(typeof value.instrumentation.terminal, 'boolean');
  choice(value.instrumentation.checker, ['passed', 'rejected', 'unavailable']);
  keys(value.device, ['state', 'probe', 'liveness', 'bootComplete', 'targetRunning', 'instrumentationPresent', 'ownedUidCount', 'crash']);
  choice(value.device.state, ['device', 'unavailable']);
  for (const key of ['probe', 'liveness', 'crash']) {
    keys(value.device[key], ['availability', 'reason', 'exitCode', 'bytes', 'truncated', 'excerpts']);
    validateLog(value.device[key]);
  }
  for (const key of ['bootComplete', 'targetRunning', 'instrumentationPresent']) choice(value.device[key], ['yes', 'no', 'unavailable']);
  assert.ok(integer(value.device.ownedUidCount, 2));
  if (value.device.crash.availability === 'available') {
    assert.ok(value.device.state === 'device' && value.device.ownedUidCount > 0);
  }
  keys(value.host, ['process', 'emulatorLog']);
  choice(value.host.process, ['present', 'absent', 'unavailable']);
  keys(value.host.emulatorLog, ['availability', 'reason', 'exitCode', 'bytes', 'truncated', 'excerpts']);
  validateLog(value.host.emulatorLog);
  assert.ok(Array.isArray(value.receipts) && value.receipts.length <= 12);
  const seen = new Set();
  for (const receipt of value.receipts) {
    keys(receipt, ['phase', 'method', 'availability', 'reason', 'stateMatched', 'settingsMatched', 'storageCleared']);
    choice(receipt.phase, PHASES);
    assert.ok(PHASES.indexOf(receipt.phase) <= PHASES.indexOf(value.phase));
    assert.ok(NATIVE_METHODS.includes(receipt.method)
      && (receipt.phase === 'suite' || receipt.method === 'startupAndPersistence'));
    const key = `${receipt.phase}/${receipt.method}`;
    assert.ok(!seen.has(key)); seen.add(key);
    choice(receipt.availability, ['available', 'unavailable']);
    choice(receipt.reason, REASONS);
    assert.equal(receipt.reason === 'none', receipt.availability === 'available');
    for (const field of ['stateMatched', 'settingsMatched', 'storageCleared']) {
      assert.ok(receipt.availability === 'available' ? typeof receipt[field] === 'boolean' : receipt[field] === null);
    }
  }
  keys(value.shutdown, ['state', 'adbExit', 'termSent', 'killSent', 'process']);
  choice(value.shutdown.state, ['pending', 'attempted']);
  assert.ok(value.shutdown.adbExit === null || exitCode(value.shutdown.adbExit));
  assert.ok(typeof value.shutdown.termSent === 'boolean' && typeof value.shutdown.killSent === 'boolean');
  choice(value.shutdown.process, ['present', 'absent', 'unavailable']);
  if (value.shutdown.state === 'pending') {
    assert.ok(value.shutdown.adbExit === null && !value.shutdown.termSent && !value.shutdown.killSent
      && value.shutdown.process === 'unavailable');
  } else assert.ok(exitCode(value.shutdown.adbExit));
  assert.ok(Buffer.byteLength(JSON.stringify(value, null, 2) + '\n') <= FAILURE_LIMIT);
  return value;
}

export async function captureNativeFailure(args, env = process.env) {
  const context = await nativeFailureContext(env);
  assert.equal(args.length, 7, 'Native failure arguments required');
  const [phase, method, ...codes] = args;
  choice(phase, PHASES);
  assert.equal(method, phase === 'suite' ? 'all' : 'startupAndPersistence');
  const parseCode = (code, optional = false) => {
    if (optional && code === '-') return null;
    assert.match(code, /^(0|[1-9]\d{0,2})$/);
    const result = Number(code);
    assert.ok(exitCode(result));
    return result;
  };
  const [primaryExit, instrumentExit, teeExit] = codes.slice(0, 3).map((code) => parseCode(code));
  const checkerExit = parseCode(codes[3], true);
  const pullExit = parseCode(codes[4], true);
  const operation = instrumentExit ? 'instrumentation' : teeExit ? 'tee' : checkerExit ? 'checker' : 'receipt';
  const target = Object.keys(TARGETS).find((role) => TARGETS[role] === env.RECAP_NATIVE_TARGET);
  assert.ok(target, 'Failure capture needs the actual owned instrumentation target');
  const app = TARGETS[target];
  const methods = method === 'all' ? NATIVE_METHODS : [method];
  const log = await boundedFile(context.work, join(context.work, 'native-evidence', `${phase}.log`));
  const instrumentation = instrumentationFacts(log, methods);
  const device = { state: 'unavailable', probe: unavailable('not-attempted'), liveness: unavailable('device-unavailable'),
    bootComplete: 'unavailable', targetRunning: 'unavailable', instrumentationPresent: 'unavailable',
    ownedUidCount: 0, crash: unavailable('device-unavailable') };
  const deadline = Date.now() + 28000;
  const state = captureCommand(['get-state'], 2000, deadline);
  let lost = state.lost;
  if (state.status === 0 && state.output.trim() === 'device') {
    device.state = 'device';
    device.probe = excerpt('', { exitCode: state.status });
    const script = `printf 'BOOT\\n'; getprop sys.boot_completed; printf 'PIDS\\n'; pidof ${app}; `
      + `printf 'UIDS\\n'; cmd package list packages -U ${app}; printf 'INSTRUMENTATION\\n'; dumpsys activity instrumentation`;
    const live = captureCommand(['shell', script], 5000, deadline);
    lost = live.lost;
    device.liveness = live.reason === 'none' ? excerpt(live.output, { exitCode: live.status }) : unavailable(live.reason, live.status);
    const fields = live.output.match(/^BOOT\r?\n([\s\S]*?)^PIDS\r?\n([\s\S]*?)^UIDS\r?\n([\s\S]*?)^INSTRUMENTATION\r?\n([\s\S]*)$/m);
    if (live.reason === 'none' && fields) {
      const boot = fields[1].trim();
      const pids = fields[2].trim();
      device.bootComplete = boot === '1' ? 'yes' : boot === '0' || boot === '' ? 'no' : 'unavailable';
      device.targetRunning = /^[0-9]+(?: +[0-9]+)*$/.test(pids) ? 'yes' : pids === '' ? 'no' : 'unavailable';
      const targetIdentity = new RegExp(`(^|[^A-Za-z0-9_.$])${app.replaceAll('.', '\\.')}(?:\\.test)?(?=$|[^A-Za-z0-9_.$])`);
      device.instrumentationPresent = targetIdentity.test(fields[4]) ? 'yes' : 'no';
      const uids = new Set();
      for (const line of fields[3].split(/\r?\n/)) {
        const match = /^package:(\S+) uid:([1-9]\d*)$/.exec(line);
        if (match && [app, `${app}.test`].includes(match[1]) && integer(Number(match[2]))) uids.add(Number(match[2]));
      }
      device.ownedUidCount = uids.size;
      if (uids.size > 0 && uids.size <= 2 && !lost) {
        const crash = captureCommand(['logcat', '-d', '-b', 'main', '-b', 'system', '-b', 'crash',
          '-v', 'threadtime', '-t', '160', `--uid=${[...uids].sort((a, b) => a - b).join(',')}`,
          'AndroidRuntime:E', 'TestRunner:V', 'chromium:W', '*:S'], 5000, deadline);
        lost = crash.lost;
        device.crash = crash.reason === 'none' ? excerpt(crash.output, { exitCode: crash.status }) : unavailable(crash.reason, crash.status);
      } else device.crash = unavailable('uid-unavailable');
    } else if (live.reason === 'none') {
      device.liveness = unavailable('invalid-response');
    }
  } else device.probe = unavailable(state.reason === 'none' ? 'invalid-response' : state.reason, state.status);
  const hostLog = await boundedFile(context.work, join(context.work, 'native-evidence', 'emulator.log'), 8192);
  const host = { process: processState(Number(env.RECAP_NATIVE_EMULATOR_PID)),
    emulatorLog: { availability: hostLog.availability, reason: hostLog.reason, exitCode: hostLog.exitCode, bytes: hostLog.bytes,
      truncated: hostLog.truncated, excerpts: hostLog.excerpts } };
  const receipts = [];
  for (const current of PHASES.slice(0, PHASES.indexOf(phase) + 1)) {
    for (const selected of current === 'suite' ? NATIVE_METHODS : ['startupAndPersistence']) {
      const path = join(context.work, 'native-receipts', current, `${selected}.json`);
      const local = await boundedFile(context.work, path, 16384);
      let facts = local.availability === 'available' && !local.rawTruncated
        ? receiptFacts(local.raw, current, selected)
        : { phase: current, method: selected, availability: 'unavailable', reason: local.rawTruncated ? 'oversized' : local.reason,
          stateMatched: null, settingsMatched: null, storageCleared: null };
      if (current === phase && facts.reason === 'missing') {
        if (device.state === 'device' && !lost) {
          const pull = captureCommand(['shell', 'cat',
            `/sdcard/Android/data/${app}/files/native-test-evidence/candidate-${phase}-${selected}.json`], 2000, deadline);
          lost = pull.lost;
          facts = pull.reason === 'none' ? receiptFacts(pull.output, current, selected) : { ...facts, reason: pull.reason };
        } else facts.reason = lost ? 'transport-lost' : 'device-unavailable';
      }
      receipts.push(facts);
    }
  }
  const capsule = { schemaVersion: 1, kind: 'android-native-failure', qualified: false, source: context.source,
    phase, method, target, targetMatchesPhase: target === (phase.startsWith('prototype') ? 'prototype' : 'official'),
    primary: { operation, exitCode: primaryExit, instrumentExit, teeExit, checkerExit, pullExit },
    captureBudgetSeconds: 45, instrumentation, device, host, receipts,
    shutdown: { state: 'pending', adbExit: null, termSent: false, killSent: false, process: 'unavailable' } };
  validateNativeFailure(capsule, context.source);
  await writeFile(context.path, JSON.stringify(capsule, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return capsule;
}

export async function readNativeFailure(env = process.env) {
  const context = await nativeFailureContext(env);
  await regularPath(context.work, context.path);
  const info = await lstat(context.path);
  assert.ok(info.isFile() && info.size <= FAILURE_LIMIT, 'Native failure capsule exceeds its file bound');
  const text = await readFile(context.path, 'utf8');
  const capsule = validateNativeFailure(JSON.parse(text), context.source);
  assert.equal(text, JSON.stringify(capsule, null, 2) + '\n', 'Native failure capsule must be canonical');
  return { context, capsule };
}

export async function finalizeNativeFailure(args, env = process.env) {
  assert.equal(args.length, 3);
  assert.ok(args.every((value) => /^(0|[1-9]\d{0,2})$/.test(value)));
  const [adbExit, termSent, killSent] = args.map(Number);
  assert.ok(exitCode(adbExit) && [0, 1].includes(termSent) && [0, 1].includes(killSent));
  const { context, capsule } = await readNativeFailure(env);
  capsule.shutdown = { state: 'attempted', adbExit, termSent: termSent === 1, killSent: killSent === 1,
    process: processState(Number(env.RECAP_NATIVE_EMULATOR_PID)) };
  validateNativeFailure(capsule, context.source);
  const temporary = join(context.work, 'android-native-failure.finalizing');
  await writeFile(temporary, JSON.stringify(capsule, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, context.path);
}

export function parseInstrumentation(source) {
  const results = [];
  const started = new Set();
  const finished = new Set();
  let status = {};
  let field = null;
  let exitCode = null;
  for (const line of source.split(/\r?\n/)) {
    const pair = /^INSTRUMENTATION_STATUS: ([^=]+)=(.*)$/.exec(line);
    const code = /^INSTRUMENTATION_STATUS_CODE: (-?\d+)$/.exec(line);
    const exit = /^INSTRUMENTATION_CODE: (-?\d+)$/.exec(line);
    if (pair) {
      field = pair[1];
      status[field] = pair[2];
    } else if (code) {
      const value = Number(code[1]);
      const id = `${status.class}#${status.test}`;
      if (value === 1) {
        assert.ok(status.class && status.test && !started.has(id), `Invalid or duplicate test start: ${id}`);
        started.add(id);
      } else {
        assert.ok([0, -1, -2, -3, -4].includes(value), `Unsupported instrumentation status: ${value}`);
        assert.ok(started.has(id) && !finished.has(id), `Test completion without one start: ${id}`);
        finished.add(id);
        results.push({ className: status.class, name: status.test, code: value, message: status.stack || status.stream || '', declaredCount: Number(status.numtests) });
      }
      status = {};
      field = null;
    } else if (exit) {
      assert.equal(exitCode, null, 'Multiple instrumentation terminal results');
      exitCode = Number(exit[1]);
      field = null;
    } else if (field && !line.startsWith('INSTRUMENTATION_')) {
      status[field] += `\n${line}`;
    }
  }
  assert.equal(exitCode, -1, 'Instrumentation did not finish successfully');
  assert.ok(results.length > 0, 'Instrumentation ran no tests');
  assert.equal(started.size, finished.size, 'Instrumentation left a test incomplete');
  return results;
}

export function verifyInstrumentation(source, { methods = NATIVE_METHODS, expectedFailure = null } = {}) {
  const results = parseInstrumentation(source);
  assert.deepEqual(results.map((test) => `${test.className}#${test.name}`).sort(),
    methods.map((name) => `${NATIVE_CLASS}#${name}`).sort(), 'Discovered native tests differ from the requested exact method set');
  for (const test of results) {
    assert.equal(test.declaredCount, methods.length, 'Runner discovery count differs from expected method count');
    if (expectedFailure) {
      assert.ok(test.code === -1 || test.code === -2, 'The native negative control unexpectedly passed or skipped');
      assert.ok(test.message.includes(expectedFailure), `Negative control failed for the wrong reason: ${test.message}`);
    } else {
      assert.equal(test.code, 0, `${test.name} failed or skipped: ${test.message}`);
    }
  }
  return results;
}

const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[character]));

async function main() {
  const [input, output, selected = 'all', marker] = process.argv.slice(2);
  if (['--capture-native-failure', '--validate-native-failure', '--finalize-native-failure'].includes(input)) {
    try {
      if (input === '--capture-native-failure') await captureNativeFailure(process.argv.slice(3));
      else if (input === '--finalize-native-failure') await finalizeNativeFailure(process.argv.slice(3));
      else {
        assert.equal(process.argv.length, 3);
        await readNativeFailure();
        console.log('failure_capsule=true');
      }
    } catch {
      console.error('Native failure capsule operation rejected; no raw input retained in this message.');
      process.exitCode = 1;
    }
    return;
  }
  if (!input || !output) throw new Error('Usage: check-android-instrumentation.mjs input.log output.json [method|all] [expected-failure-marker]');
  const source = await readFile(input, 'utf8');
  const methods = selected === 'all' ? NATIVE_METHODS : [selected];
  assert.ok(methods.every((method) => NATIVE_METHODS.includes(method)), 'Unknown requested native method');
  const results = parseInstrumentation(source);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify({ mode: marker ? 'negative-control' : 'positive', tests: results }, null, 2)}\n`);
  const cases = results.map((test) => `<testcase classname="${xml(test.className)}" name="${xml(test.name)}">${test.code === 0 ? '' : `<failure message="${xml(test.message)}"/>`}</testcase>`).join('\n');
  await writeFile(`${output}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Android native integration" tests="${results.length}" failures="${results.filter((test) => test.code !== 0).length}" errors="0" skipped="0">\n${cases}\n</testsuite>\n`);
  verifyInstrumentation(source, { methods, expectedFailure: marker || null });
  console.log(`${marker ? 'Expected negative control observed' : 'Native tests passed'}: ${results.map((test) => test.name).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
