import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';

import {
  LOCAL_SERVER_GENERATION_HEADER_NAME,
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
  LOCAL_SERVER_PROCESS_HEADER_NAME,
} from '../src/js/lib/localServer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'packaging', 'windows', 'Package.appxmanifest');
const LAUNCHER = join(ROOT, 'packaging', 'windows', 'Launcher.mjs');
const PACK = join(ROOT, 'scripts', 'pack-msix.mjs');
const INSPECT = join(ROOT, 'scripts', 'inspect-msix.mjs');
const PROOF = join(ROOT, 'scripts', 'msix-proof.mjs');

const read = (path) => readFileSync(path, 'utf8');

const observationBinding = {
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), captureId: 'c'.repeat(32), architecture: 'x64',
  proofInputDigest: 'd'.repeat(64), creationReceiptDigest: 'e'.repeat(64), startupInputsDigest: 'f'.repeat(64),
  deployment: { kind: 'installed', family: 'PanelStackLabs.RecapPage_we33aa8nvkpcc', architecture: 'x64', packageDigest: '1'.repeat(64) },
};
function observationText() {
  const b = observationBinding;
  return ['begin', 'end'].flatMap((phase) => [0, 1].map((slot) => (
    `DIAG host-sample phase=${phase} slot=${slot} registryView=native64 open=2 query=0 type=0 bytes=0 literalEmpty=0 registryClosed=1 helperKnown=1 helperMachine=34404 helperError=0`
  ))).join('\n') + '\n' + `DIAG app-capture-v2 profile=installed-functionality captureId=${b.captureId} commit=${b.commit} tree=${b.tree} architecture=x64 proofInputDigest=${b.proofInputDigest} creationReceiptDigest=${b.creationReceiptDigest} startupInputsDigest=${b.startupInputsDigest} hostState=satisfied hostReason=none actorState=satisfied actorReason=none captureState=satisfied captureReason=none roots=3 coordinators=3 verifiers=1 servers=1 commands=3 visible=0 unresolved=0 rawUnknown=19 unassessed=19 externalRequests=1`;
}
async function observationFixture(overrides = {}) {
  const contract = await import('../scripts/lib/startup-contract.mjs');
  const definition = read(PROOF).match(/^async function withNativeObservation\([\s\S]*?^\}/m)?.[0];
  assert.ok(definition, 'the installed observation boundary must exist');
  const child = new EventEmitter();
  child.pid = 91;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => queueMicrotask(() => { child.emit('exit', 1); child.emit('close'); });
  const context = {
    process: { env: { GITHUB_ACTIONS: 'true' } },
    ROOT: 'fixture-root', join, tmpdir: () => 'fixture-temp', mkdtempSync: () => 'fixture-capture',
    verifyNativeArtifact: async () => ({ root: 'fixture-tools' }),
    createSemanticCapture: () => ({}),
    spawn: () => child,
    existsSync: () => true,
    statSync: () => ({ size: 1000 }),
    readFileSync: () => 'PASS installed-functionality\n',
    writeFileSync: () => queueMicrotask(() => { child.emit('exit', 0); child.emit('close'); }),
    publishSemanticRecord: () => {},
    startupCaptureInputs: () => observationBinding,
    closingStartupInputs: () => ({ digest: observationBinding.startupInputsDigest }),
    captureRequest: contract.captureRequest,
    parseCaptureReport: contract.parseCaptureReport,
    composeCapture: contract.composeCapture,
    demandCapturePass: contract.demandCapturePass,
    rmSync: () => {},
    waitFor: async (predicate) => {
      await Promise.resolve();
      const value = predicate();
      assert.ok(value, 'the inert observation predicate must settle');
      return value;
    },
    console: { log: () => {} },
    ...overrides,
  };
  return runInNewContext(`let activeSemanticCapture = null;\n${definition}
    withNativeObservation({ InstallLocation: 'fixture-package' }, 'x64', 'package',
      'functionality', async () => ({ startupBodyCompleted: true }));`, context);
}

test('installed startup rejects legacy success without mandatory evidence', async () => {
  const nested = (text) => (error) => (error.errors ?? [error]).some((failure) => failure.message.includes(text));
  await assert.rejects(observationFixture(), nested('report-invalid'));
  const valid = () => observationFixture({ readFileSync: () => observationText() });
  assert.equal((await valid()).startupBodyCompleted, true);
  await assert.rejects(observationFixture({ readFileSync: () => observationText()
    .replace('actorState=satisfied actorReason=none', 'actorState=unknown actorReason=actor-missing') }), /actor-missing/);
  await assert.rejects(observationFixture({ readFileSync: () => observationText() + '\nDIAG path=C:\\private' }), nested('report-invalid'));
  await assert.rejects(observationFixture({ readFileSync: () => observationText(), rmSync: () => { throw new Error('capture-cleanup'); } }),
    nested('capture-cleanup'));
  const scenario = read(PROOF).match(/^async function runInstalledScenario\([\s\S]*?^\}/m)?.[0];
  const failure = new Error('late-installed-cleanup');
  await assert.rejects(runInNewContext(`${scenario}
    runInstalledScenario(async (context) => { context.cleanupAuthorized = true; return await capture(); });`, {
    capture: valid, cleanupPackage: () => { throw failure; }, AggregateError,
  }), (error) => error.errors[0] === failure);
});

test('GUI default creation contracts call the real browser adapter and default server environment', async () => {
  const production = await import('../packaging/windows/Launcher.mjs');
  const present = read(LAUNCHER).match(/^export async function presentLaunch\([\s\S]*?^\}$/m)[0].replace('export ', '');
  let browserCall;
  let exit;
  const output = capturedStream();
  await runInNewContext(`${present}\npresentLaunch({
    args: ['--gui-startup-v1'], output, errorOutput: output, environment: {},
    coordinate: async (options) => { await options.openBrowser(); return { status: 'opened' }; },
    setExitCode: setExit
  });`, {
    selectGuiStartup: production.selectGuiStartup, coordinateLaunch: production.coordinateLaunch,
    openDefaultBrowser: (url, options) => {
      browserCall = { url, options };
      const child = fakeChild();
      queueMicrotask(() => child.emit('exit', 0));
      return production.openDefaultBrowser(url, { ...options, spawnImpl: () => child });
    },
    encodeGuiResult: production.encodeGuiResult, writeGuiFrame: production.writeGuiFrame,
    LAUNCH_RESULT: production.LAUNCH_RESULT, GUI_BROWSER_TIMEOUT_MS: production.GUI_BROWSER_TIMEOUT_MS,
    ORIGIN: production.ORIGIN, output, setExit: (code) => { exit = code; },
    process: { argv: [], stdout: output, stderr: output, env: {}, arch: 'x64' },
    fail: () => { throw new Error('GUI called console failure'); },
    Buffer,
  });
  assert.equal(exit, 0);
  assert.equal(browserCall.url, 'http://127.0.0.1:8787/');
  assert.equal(browserCall.options.timeoutMs, 30000);
  assert.equal(output.frames.length, 1);
});

function startupLayoutFixture() {
  const root = mkdtempSync(join(tmpdir(), 'recap-startup-inputs-'));
  return {
    root,
    put(path, bytes) {
      const file = join(root, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    },
    close() { rmSync(root, { recursive: true, force: true }); },
  };
}
async function populateStartupLayout(fixture, architecture = 'x64', version = '2.0.3.0') {
  const { SOURCE_FILES, startupSourceInputs, hashBytes, buildStartupVariant } = await import('../scripts/lib/startup-contract.mjs');
  for (const [path, source] of SOURCE_FILES) fixture.put(path, readFileSync(join(ROOT, ...source.split('/'))));
  fixture.put('AppxManifest.xml', read(MANIFEST).replace(/Version="[^"]+"/, `Version="${version}"`)
    .replace(/ProcessorArchitecture="[^"]+"/, `ProcessorArchitecture="${architecture}"`));
  fixture.put('RecapPageLauncher.exe', 'native-fixture');
  fixture.put('runtime/node.exe', 'node-fixture');
  const nativeBytes = Buffer.from('native-record');
  fixture.put('native-build.json', nativeBytes);
  fixture.put('src/msix-generation.json', JSON.stringify({ packageVersion: version, generation: 'a'.repeat(64) }));
  const native = { digest: hashBytes(nativeBytes), record: { outputs: [{ architecture, sha256: hashBytes(Buffer.from('native-fixture')) }] } };
  return buildStartupVariant({ layout: fixture.root, architecture, version, native,
    nodeHash: hashBytes(Buffer.from('node-fixture')), sourceInputs: startupSourceInputs(ROOT) });
}

test('startup expectations bind three package variants and reject an unlisted executable import', async (t) => {
  const { startupSourceInputs } = await import('../scripts/lib/startup-contract.mjs');
  for (const [architecture, version] of [['x64', '2.0.3.0'], ['arm64', '2.0.3.0'], ['x64', '2.0.3.1']]) {
    const fixture = startupLayoutFixture();
    try {
      const variant = await populateStartupLayout(fixture, architecture, version);
      assert.equal(variant.identity.architecture, architecture);
      assert.equal(variant.identity.version, version);
      assert.equal(variant.files.length, 9);
    } finally { fixture.close(); }
  }
  const fixture = startupLayoutFixture();
  try {
    for (const path of ['packaging/windows/Launcher.mjs', 'server.mjs', 'src/js/lib/coverHost.js', 'src/js/lib/localServer.js']) {
      fixture.put(path, readFileSync(join(ROOT, ...path.split('/'))));
    }
    fixture.put('server.mjs', read(join(ROOT, 'server.mjs')) + "\nimport './unexpected.mjs';\n");
    assert.throws(() => startupSourceInputs(fixture.root), /input-mismatch/);
    fixture.put('server.mjs', read(join(ROOT, 'server.mjs')));
    const localServer = read(join(ROOT, 'src', 'js', 'lib', 'localServer.js'));
    fixture.put('src/js/lib/unlisted-helper.js', "throw new Error('analyzed source must not execute');\nexport const injected = 1;\n");
    fixture.put('src/js/lib/localServer.js', `${localServer}\nexport * from './unlisted-helper.js';\n`);
    let rejection = null;
    try { startupSourceInputs(fixture.root); } catch (error) { rejection = error; }
    t.diagnostic(`FR-002 actual-source reexport-rejected=${rejection !== null}`);
    assert.ok(rejection, 'the actual fixed source closure must reject an unlisted re-export dependency');
    assert.match(rejection.message, /input-mismatch/);
    for (const syntax of [
      "export { injected as hidden } from './unlisted-helper.js';",
      "  import './unlisted-helper.js';",
      "import /* between */ { injected } /* clause */ from /* source */ './unlisted-helper.js';",
      "import /* call */ ('./unlisted-helper.js');",
      "import('node:' + 'child_process');",
      "require /* call */ ('./unlisted-helper.js');",
    ]) {
      fixture.put('src/js/lib/localServer.js', `${localServer}\n${syntax}\n`);
      assert.throws(() => startupSourceInputs(fixture.root), /input-mismatch/);
    }
    fixture.put('src/js/lib/localServer.js', `${localServer}
// import './comment-is-not-an-edge.js';
const apparentImport = "export * from './string-is-not-an-edge.js';";
const apparentRequire = /require\\('not-a-call'\\)/;
export { apparentImport, apparentRequire };
`);
    fixture.put('server.mjs', read(join(ROOT, 'server.mjs'))
      .replace(/^import /gm, '  import /* declaration */ ')
      .replace("import('node:child_process')", "import /* dynamic */ ('node:child_process')")
      + "\nexport { readFile as nativeRead } from 'node:fs/promises';\n");
    assert.equal(startupSourceInputs(fixture.root).length, 4);
    t.diagnostic('startup-source-syntax fixtures=8 rejected=7 allowed=1 modules-executed=0');
  } finally { fixture.close(); }
});

test('installed startup bindings reject altered inputs activation ambiguity and stale expectations', async () => {
  const { bindInstalledInputs, boundedFile, validateActivationManifest, validateExpectations } = await import('../scripts/lib/startup-contract.mjs');
  const fixture = startupLayoutFixture();
  try {
    const variant = await populateStartupLayout(fixture);
    assert.equal(bindInstalledInputs(fixture.root, variant).files, 9);
    for (const input of variant.files) {
      const file = join(fixture.root, ...input.path.split('/'));
      const bytes = readFileSync(file);
      fixture.put(input.path, Buffer.concat([bytes, Buffer.from('changed')]));
      assert.throws(() => bindInstalledInputs(fixture.root, variant), /input-mismatch/);
      fixture.put(input.path, bytes);
    }
    assert.throws(() => validateActivationManifest(read(MANIFEST) + '<Application Id="extra">', 'x64', '2.0.2.0'), /input-mismatch/);
    assert.throws(() => boundedFile(fixture.root, '../escaped'), /input-mismatch/);
    assert.throws(() => validateExpectations({ schemaVersion: 2 }, {
      commit: 'a'.repeat(40), tree: 'b'.repeat(40), nativeDigest: 'c'.repeat(64), sourceInputs: [],
    }));
    assert.throws(() => bindInstalledInputs(fixture.root, { ...variant, files: variant.files.slice(1) }));
  } finally { fixture.close(); }
});

function capturedStream() {
  const stream = new EventEmitter();
  stream.frames = [];
  stream.write = (bytes, callback) => {
    stream.frames.push(Buffer.from(bytes));
    queueMicrotask(() => callback?.());
    return true;
  };
  return stream;
}

function browserClock() {
  let next = 0;
  const timers = new Map();
  return {
    timers,
    setTimer(callback, delay) {
      const id = ++next;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `no timer for ${delay}`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test('GUI serialization matches independent literal frame goldens', async () => {
  const { encodeGuiResult } = await import('../packaging/windows/Launcher.mjs');
  const goldens = new Map(read(join(ROOT, 'test', 'native', 'startup-frames.txt'))
    .trim().split(/\r?\n/).map((line) => line.split(' ')));
  for (const [status, lines, exitCode] of [
    ['opened', undefined, 0],
    ['failed', ['Problem.', 'Retry.'], 1],
  ]) {
    const result = encodeGuiResult(lines ? { status, lines } : { status });
    assert.equal(result.frame.toString('hex'), goldens.get(status));
    assert.equal(result.exitCode, exitCode);
  }
});

test('GUI error text preserves valid scalars and fails closed at byte and control boundaries', async () => {
  const { encodeGuiResult, GUI_BODY_LIMIT } = await import('../packaging/windows/Launcher.mjs');
  const encode = (lines) => encodeGuiResult({ status: 'failed', lines });
  const valid = encode(['Room \u03a9.\r\nNext\rLast\titem']);
  assert.equal(valid.frame.subarray(12).toString('utf8'), 'Room \u03a9.\nNext\nLast\titem');
  for (const text of ['x'.repeat(GUI_BODY_LIMIT), '\u00e9'.repeat(GUI_BODY_LIMIT / 2)]) {
    const result = encode([text]);
    assert.equal(result.frame.length, 12 + GUI_BODY_LIMIT);
    assert.equal(result.frame.readUInt32LE(8), GUI_BODY_LIMIT);
    assert.equal(result.frame.subarray(12).toString('utf8'), text);
  }
  for (const lines of [
    ['x'.repeat(GUI_BODY_LIMIT + 1)], ['\ud800'], ['\udfff'], ['x\0y'],
    ['x\u000by'], ['x\u007fy'], ['\ufeffproblem'], [' \n\t'], [], null, [42],
  ]) {
    const result = encode(lines);
    assert.equal(result.exitCode, 1);
    assert.match(result.frame.subarray(12).toString('utf8'), /invalid or too large/);
  }
  assert.equal(encodeGuiResult({ status: 'unexpected' }).exitCode, 1);
  assert.equal(encodeGuiResult({ status: 'opened', lines: ['Problem.'] }).exitCode, 1);
});

test('GUI reserved arguments refuse coordination without changing ordinary argument selection', async () => {
  const { selectGuiStartup, presentLaunch } = await import('../packaging/windows/Launcher.mjs');
  assert.equal(selectGuiStartup([]), false);
  assert.equal(selectGuiStartup(['ignored-legacy-argument']), false);
  assert.equal(selectGuiStartup(['--gui-startup-v1']), true);
  for (const args of [
    ['--gui-startup-v2'], ['--gui-startup-v1', 'extra'], ['extra', '--gui-startup-v1'],
  ]) {
    assert.throws(() => selectGuiStartup(args), /unsupported startup request/);
    let calls = 0;
    let code;
    const output = capturedStream();
    await presentLaunch({
      args, output, setExitCode: (value) => { code = value; },
      coordinate: async () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal(code, 1);
    assert.equal(output.frames.length, 1);
    assert.equal(output.frames[0][5], 1);
  }
});

test('GUI presentation waits for one complete backpressured write before successful exit', async () => {
  const { presentLaunch } = await import('../packaging/windows/Launcher.mjs');
  const output = capturedStream();
  const exits = [];
  let release;
  output.write = (bytes, callback) => {
    output.frames.push(bytes);
    release = callback;
    return false;
  };
  const pending = presentLaunch({
    args: ['--gui-startup-v1'], output,
    coordinate: async () => ({ status: 'opened' }),
    setExitCode: (code) => exits.push(code),
  });
  await new Promise(setImmediate);
  assert.equal(typeof release, 'function');
  assert.deepEqual(exits, []);
  release();
  await pending;
  assert.deepEqual(exits, [0]);
  assert.equal(output.frames.length, 1);
  assert.equal(output.frames[0].length, 12);
});

test('GUI exceptions and result write races never retry a frame or appear successful', async () => {
  const { presentLaunch } = await import('../packaging/windows/Launcher.mjs');
  for (const coordinate of [
    async () => { throw new Error('fixture launch error'); },
    async () => null,
    async () => ({ status: 'unknown' }),
    async () => ({ get status() { throw new Error('invalid result'); } }),
  ]) {
    const output = capturedStream();
    let code;
    await presentLaunch({
      args: ['--gui-startup-v1'], coordinate, output,
      setExitCode: (value) => { code = value; },
    });
    assert.equal(code, 1);
    assert.equal(output.frames.length, 1);
    assert.equal(output.frames[0][5], 1);
  }
  const output = capturedStream();
  const diagnostics = capturedStream();
  output.write = (bytes, callback) => {
    output.frames.push(bytes);
    queueMicrotask(() => {
      const error = new Error('fixture broken output');
      callback(error);
      output.emit('error', error);
    });
    return false;
  };
  let code;
  await presentLaunch({
    args: ['--gui-startup-v1'], output, errorOutput: diagnostics,
    coordinate: async () => ({ status: 'opened' }),
    setExitCode: (value) => { code = value; },
  });
  assert.equal(code, 1);
  assert.equal(output.frames.length, 1);
  assert.match(diagnostics.frames[0].toString('utf8'), /could not write.*fixture broken output/);
});

test('GUI diagnostics stay out of the frame while console probe and failure presentation remain', async () => {
  const { presentLaunch } = await import('../packaging/windows/Launcher.mjs');
  for (const gui of [false, true]) {
    const output = capturedStream();
    const failures = [];
    const calls = [];
    await presentLaunch({
      args: gui ? ['--gui-startup-v1'] : ['ignored'],
      output, environment: { MRT_PACKAGE_ARCH_PROBE: '1' }, architecture: 'arm64',
      coordinate: async (...args) => {
        calls.push(args);
        return { status: 'failed', lines: ['fixture failure'] };
      },
      consoleFail: (lines) => failures.push(lines),
      setExitCode: () => {},
    });
    assert.equal(calls.length, 1);
    if (gui) {
      assert.equal(typeof calls[0][0].openBrowser, 'function');
      assert.equal(output.frames.length, 1);
      assert.equal(output.frames[0].subarray(0, 4).toString(), 'RCPG');
      assert.deepEqual(failures, []);
    } else {
      assert.deepEqual(calls[0], []);
      assert.equal(output.frames[0].toString(), 'launcher=arm64\n');
      assert.deepEqual(failures, [['fixture failure']]);
    }
  }
});

test('the browser helper settles once and keeps the legacy no-timeout default', async () => {
  const { openDefaultBrowser } = await import('../packaging/windows/Launcher.mjs');
  for (const timeoutMs of [undefined, 30000]) {
    const clock = browserClock();
    const child = fakeChild();
    const pending = openDefaultBrowser(undefined, {
      spawnImpl: (...args) => {
        assert.deepEqual(args, ['cmd', ['/c', 'start', '', 'http://127.0.0.1:8787/'], { stdio: 'ignore', windowsHide: true }]);
        return child;
      }, ...clock, ...(timeoutMs ? { timeoutMs } : {}),
    });
    assert.equal(clock.timers.size, timeoutMs ? 1 : 0);
    child.emit('exit', 0);
    child.emit('error', new Error('late event'));
    await pending;
    assert.equal(clock.timers.size, 0);
    assert.equal(child.killCalls, 0);
  }
  const child = fakeChild();
  const pending = openDefaultBrowser(undefined, { spawnImpl: () => child });
  child.emit('exit', 7);
  await assert.rejects(pending, /exited 7/);
  await assert.rejects(openDefaultBrowser(undefined, { timeoutMs: -1 }), /invalid.*timeout/);
});

test('GUI browser timeout retains the healthy server and reports uncertain cleanup with manual guidance', async () => {
  const {
    coordinateLaunch, openDefaultBrowser, GUI_BROWSER_TIMEOUT_MS,
  } = await import('../packaging/windows/Launcher.mjs');
  const child = fakeChild();
  child.kill = () => { child.killCalls += 1; return true; };
  const clock = browserClock();
  const pending = coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'ready', processId: 99 }),
    startServer: () => { throw new Error('a healthy server must not be replaced'); },
    openBrowser: () => openDefaultBrowser(undefined, {
      spawnImpl: () => child, timeoutMs: GUI_BROWSER_TIMEOUT_MS, ...clock,
    }),
  });
  await new Promise(setImmediate);
  clock.fire(30000);
  clock.fire(2000);
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.equal(result.retainServer, true);
  assert.equal(child.killCalls, 1);
  assert.equal(child.unrefCalls, 1);
  assert.equal(clock.timers.size, 0);
  assert.match(result.lines.join('\n'), /cleanup could not be confirmed/);
  assert.match(result.lines.join('\n'), /browser may still open later/);
  assert.match(result.lines.join('\n'), /Open http:\/\/127\.0\.0\.1:8787\//);
});

function element(source, name) {
  return source.match(new RegExp(`<${name}\\b[^>]*>`, 'i'))?.[0] ?? '';
}

function nativeImage(machine = 0x8664) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 0x3c);
  bytes.write('PE\0\0', 64, 'ascii');
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(2, 86);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt16LE(2, 156);
  return bytes;
}

test('native PE policy requires complete architecture-matched GUI executable headers', async () => {
  const { nativePe, NATIVE_TARGETS } = await import('../scripts/lib/native-launcher.mjs');
  for (const target of NATIVE_TARGETS) {
    const bytes = nativeImage(target.machine);
    assert.deepEqual(nativePe(bytes, target), { machine: target.machine, subsystem: 2, imports: [] });
    for (const mutate of [
      (image) => image.writeUInt16LE(0x14c, 68),
      (image) => image.writeUInt16LE(3, 156),
      (image) => image.writeUInt16LE(0x2002, 86),
      (image) => image.writeUInt16LE(0, 86),
      (image) => image.writeUInt16LE(0x10b, 88),
      (image) => image.writeUInt16LE(2, 84),
      (image) => image.writeUInt32LE(0xffffffff, 0x3c),
    ]) {
      const invalid = Buffer.from(bytes);
      mutate(invalid);
      assert.throws(() => nativePe(invalid, target), /native launcher:/);
    }
    assert.throws(() => nativePe(bytes.subarray(0, 90), target), /truncated/);
  }
});

test('native package policy permits only the exact two executable relative paths', async () => {
  const { exactExecutablePayloads } = await import('../scripts/lib/native-launcher.mjs');
  const expected = ['RecapPageLauncher.exe', 'runtime\\node.exe', 'Launcher.mjs'];
  assert.deepEqual(exactExecutablePayloads(expected), ['recappagelauncher.exe', 'runtime/node.exe']);
  for (const paths of [
    expected.slice(1), [...expected, 'extra.exe'], [...expected, 'runtime/addon.node'],
    [...expected, 'extra.dll'], [...expected, 'node.exe'], [...expected, 'RUNTIME/NODE.EXE'],
    ['nested/RecapPageLauncher.exe', 'runtime/node.exe'],
  ]) assert.throws(() => exactExecutablePayloads(paths), /unexpected executable payloads/);
});

test('native artifact records reject stale inputs and changed or ambiguous outputs', async () => {
  const {
    validateNativeRecord, inputDigest, NATIVE_INPUTS, NATIVE_TARGETS,
  } = await import('../scripts/lib/native-launcher.mjs');
  const inputs = NATIVE_INPUTS.map((path) => ({ path, bytes: 1, sha256: 'a'.repeat(64) }));
  const outputs = NATIVE_TARGETS.map((target) => ({
    architecture: target.id, path: `${target.id}/RecapPageLauncher.exe`,
    bytes: 512, sha256: 'b'.repeat(64), machine: target.machine, subsystem: 2, imports: [],
  }));
  const record = {
    schemaVersion: 1, commit: 'a'.repeat(40), inputs, inputDigest: inputDigest(inputs), outputs,
    productionDigest: null,
    toolchain: {
      image: 'win22 2026', sdk: '10.0.26100.0', compilerVersion: '19.44.35217.0',
      targets: NATIVE_TARGETS.map(({ id }) => ({
        architecture: id, compiler: 'c'.repeat(64), linker: 'd'.repeat(64), resources: 'e'.repeat(64),
      })),
    },
  };
  const expected = { commit: record.commit, inputs, outputs };
  assert.equal(validateNativeRecord(record, expected), record);
  for (const change of [
    (value) => { value.commit = 'b'.repeat(40); },
    (value) => { value.inputs[0].sha256 = 'f'.repeat(64); },
    (value) => { value.outputs[0].sha256 = 'f'.repeat(64); },
    (value) => { value.inputs.pop(); },
    (value) => { value.inputs.push(value.inputs[0]); },
    (value) => { value.inputs[0].path = 'unknown.cpp'; },
    (value) => { value.outputs.reverse(); },
    (value) => { value.unexpected = true; },
    (value) => { value.toolchain.sdk = 'unreviewed'; },
  ]) {
    const invalid = structuredClone(record);
    change(invalid);
    assert.throws(() => validateNativeRecord(invalid, expected), /native launcher:/);
  }
});

test('package generation covers staged native bytes and their build input record', async () => {
  const { layoutGeneration } = await import('../scripts/pack-msix.mjs');
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'recap-native-generation-'));
  try {
    await writeFile(join(root, 'RecapPageLauncher.exe'), 'native-a');
    await writeFile(join(root, 'native-build.json'), '{"inputDigest":"a"}');
    const before = await layoutGeneration(root);
    await writeFile(join(root, 'RecapPageLauncher.exe'), 'native-b');
    const changedBinary = await layoutGeneration(root);
    assert.notEqual(changedBinary, before);
    await writeFile(join(root, 'native-build.json'), '{"inputDigest":"b"}');
    assert.notEqual(await layoutGeneration(root), changedBinary);
    const source = read(PACK);
    const hash = source.indexOf('const generation = await layoutGeneration(layout)');
    assert.ok(source.indexOf('copyFile(join(native.root') < hash);
    assert.ok(source.indexOf("join(layout, 'native-build.json')") < hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null;
}

test('the maintained MSIX inputs exist outside the browser application', async () => {
  assert.ok(existsSync(MANIFEST), 'the package manifest is missing');
  assert.ok(existsSync(LAUNCHER), 'the package launcher is missing');
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
  assert.ok(existsSync(INSPECT), 'the MSIX inspector is missing');
  assert.ok(existsSync(PROOF), 'the installed proof runner is missing');
  assert.equal(existsSync(join(ROOT, 'src', 'Package.appxmanifest')), false);
  const { PROOF_INPUTS } = await import('../scripts/lib/native-launcher.mjs');
  for (const path of PROOF_INPUTS) assert.ok(existsSync(join(ROOT, ...path.split('/'))), `${path} is missing`);
});

test('the manifest uses the exact Partner Center identity', () => {
  const source = read(MANIFEST);
  const identity = element(source, 'Identity');
  const properties = source.match(/<Properties>[\s\S]*?<\/Properties>/i)?.[0] ?? '';

  assert.equal(attribute(identity, 'Name'), 'PanelStackLabs.RecapPage');
  assert.equal(attribute(identity, 'Publisher'), 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472');
  assert.equal(attribute(identity, 'Version'), '2.0.2.0');
  assert.equal(attribute(identity, 'ProcessorArchitecture'), 'x64');
  assert.match(properties, /<DisplayName>Recap Page<\/DisplayName>/);
  assert.match(properties, /<PublisherDisplayName>PanelStack Labs<\/PublisherDisplayName>/);
});

test('Start activation uses the architecture-matched native GUI', () => {
  const source = read(MANIFEST);
  const application = element(source, 'Application');

  assert.equal(attribute(application, 'Id'), 'App');
  assert.equal(attribute(application, 'Executable'), 'RecapPageLauncher.exe');
  assert.equal(attribute(application, 'uap10:RuntimeBehavior'), 'packagedClassicApp');
  assert.equal(attribute(application, 'uap10:TrustLevel'), 'mediumIL');
  assert.equal(attribute(application, 'uap10:Subsystem'), 'windows');
  assert.equal(attribute(application, 'uap10:SupportsMultipleInstances'), 'true');
  assert.equal(
    attribute(application, 'uap10:Parameters'),
    null,
  );
});

test('the package declares only runFullTrust', () => {
  const source = read(MANIFEST);
  const capabilities = source.match(/<Capabilities>[\s\S]*?<\/Capabilities>/i)?.[0] ?? '';
  const declared = [...capabilities.matchAll(/<[\w]+:Capability\b[^>]*\bName="([^"]+)"/gi)]
    .map((match) => match[1]);

  assert.deepEqual(declared, ['runFullTrust']);
  assert.match(source, /xmlns:rescap="http:\/\/schemas\.microsoft\.com\/appx\/manifest\/foundation\/windows10\/restrictedcapabilities"/);
  assert.match(source, /xmlns:uap10="http:\/\/schemas\.microsoft\.com\/appx\/manifest\/uap\/windows10\/10"/);
});

test('the packer separates the Store bundle from its proof-only update', async () => {
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
  const packer = await import('../scripts/pack-msix.mjs');
  const inspector = await import('../scripts/inspect-msix.mjs');
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const storeVersion = `${pkg.version}.0`;
  const proofVersion = `${pkg.version}.1`;
  const storePattern = storeVersion.replaceAll('.', '\\.');
  const proofPattern = proofVersion.replaceAll('.', '\\.');

  assert.deepEqual(packer.PACKAGE_VERSIONS, [storeVersion, proofVersion]);
  assert.equal(packer.STORE_PACKAGE_VERSION, storeVersion);
  assert.equal(packer.PROOF_UPDATE_VERSION, proofVersion);
  assert.deepEqual(
    packer.PACKAGE_ARCHITECTURES.map(({ id, node }) => ({ id, node })),
    [
      { id: 'x64', node: 'win-x64' },
      { id: 'arm64', node: 'win-arm64' },
    ],
  );
  assert.equal(packer.PACKAGE_NAME, 'PanelStackLabs.RecapPage');
  assert.equal(packer.PACKAGE_FAMILY, 'PanelStackLabs.RecapPage_we33aa8nvkpcc');
  assert.equal(packer.AUMID, 'PanelStackLabs.RecapPage_we33aa8nvkpcc!App');
  assert.equal(packer.LAUNCHER_NAME, 'Launcher.mjs');
  assert.equal(packer.winAppCliVersion([
    'Windows App Development CLI - Version 0.6.0',
    '0.6.0',
  ].join('\n')), '0.6.0');
  assert.equal(packer.winAppCliVersion('Windows App Development CLI - Version 0.6.0'), null);
  assert.match(
    packer.packagePath('x64'),
    new RegExp(`dist[\\\\/]msix[\\\\/]RecapPage_${storePattern}_x64\\.msix$`),
  );
  assert.match(
    packer.packagePath('arm64'),
    new RegExp(`dist[\\\\/]msix[\\\\/]RecapPage_${storePattern}_arm64\\.msix$`),
  );
  assert.match(
    packer.bundlePath(),
    new RegExp(`RecapPage_${storePattern}_x64_arm64\\.msixbundle$`),
  );
  assert.match(
    packer.proofPackagePath(proofVersion),
    new RegExp(`dist[\\\\/]msix-proof[\\\\/]RecapPage_${proofPattern}_x64\\.msix$`),
  );
  assert.deepEqual(inspector.parseInspectArguments([]), { measureRuntimes: true });
  assert.deepEqual(inspector.parseInspectArguments(['--structural']), { measureRuntimes: false });
  assert.throws(() => inspector.parseInspectArguments(['--unknown']), /unknown argument/);
});

test('the MSIX inspector rejects every external updater marker', async () => {
  const { externalUpdaterFindings } = await import('../scripts/inspect-msix.mjs');
  const findings = externalUpdaterFindings([
    { path: 'src/js/lib/updateCheck.js', bytes: '' },
    {
      path: 'src/js/main.js',
      bytes: [
        'api.github.com/repos/raymond-nassar/recap-page/releases',
        'github.com/raymond-nassar/recap-page/releases',
        'marvel-reading-tracker-windows.zip',
        'runAutomaticUpdateCheck',
        'runExplicitUpdateCheck',
        'opt-update-checks',
        'btn-check-updates',
        'update-check-report',
        'Unzip it anywhere',
        'delete the old folder',
        'ms-appinstaller:',
      ].join('\n'),
    },
    { path: 'RecapPage.appinstaller', bytes: '<AppInstaller />' },
  ]);

  assert.deepEqual(
    new Set(findings.map(({ reason }) => reason)),
    new Set([
      'retired updater module',
      'GitHub release API',
      'GitHub release page',
      'standalone Windows archive',
      'automatic update function',
      'manual update function',
      'update preference control',
      'manual update control',
      'update result region',
      'standalone extraction instruction',
      'standalone replacement instruction',
      'App Installer URI',
      'App Installer file',
    ]),
  );
});

test('the MSIX inspector permits legitimate GitHub provenance and Store-neutral update words', async () => {
  const { externalUpdaterFindings } = await import('../scripts/inspect-msix.mjs');
  assert.deepEqual(externalUpdaterFindings([
    {
      path: 'src/index.html',
      bytes: 'https://github.com/emreparker/marvel-comics',
    },
    {
      path: 'src/js/storage.js',
      bytes: 'function updateStoredReadingProgress() {}',
    },
  ]), []);
});

test('the MSIX lane adds ARM64 without changing the ZIP runtime target', () => {
  const source = read(PACK);
  const zip = read(join(ROOT, 'scripts', 'pack-windows.mjs'));

  assert.match(source, /from '\.\/pack-windows\.mjs'/);
  assert.match(source, /\bNODE_VERSION\b/);
  assert.match(source, /\bNODE_ARCH\b/);
  assert.match(source, /\bfetchRuntime\b/);
  assert.match(source, /win-arm64/);
  assert.match(source, /Launcher\.mjs/);
  assert.doesNotMatch(source, /Launcher\.cs|Framework64|platform:x64/);
  assert.match(zip, /const NODE_ARCH = 'win-x64'/);
  assert.match(zip, /marvel-reading-tracker-windows\.zip/);
});

test('the package coordinator clears origin-changing environment values case-insensitively', async () => {
  const { packageEnvironment } = await import('../packaging/windows/Launcher.mjs');
  for (const blocked of [
    { MRT_PORT: '8788', MRT_NO_OPEN: '1' },
    { mrt_port: '8788', mrt_no_open: '1' },
    { Mrt_Port: '8788', Mrt_No_Open: '1' },
  ]) {
    const env = packageEnvironment({ ...blocked, KEEP_ME: 'yes' });
    assert.deepEqual(
      Object.keys(env).filter((key) => /^(MRT_PORT|MRT_NO_OPEN)$/i.test(key)),
      ['MRT_NO_OPEN'],
    );
    assert.equal(env.MRT_NO_OPEN, '1');
    assert.equal(env.KEEP_ME, 'yes');
  }
});

function fakeChild(pid = 41) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.unrefCalls = 0;
  child.killCalls = 0;
  child.unref = () => { child.unrefCalls += 1; };
  child.kill = () => {
    child.killCalls += 1;
    child.exitCode = 1;
    queueMicrotask(() => child.emit('exit', 1));
    return true;
  };
  return child;
}

test('the coordinator starts a hidden detached server with independent stdio', async () => {
  const { spawnServer } = await import('../packaging/windows/Launcher.mjs');
  let call;
  const child = fakeChild();
  const returned = spawnServer('C:\\Package\\server.mjs', {
    root: 'C:\\Package',
    executable: 'C:\\Package\\runtime\\node.exe',
    environment: { MRT_NO_OPEN: '1' },
    spawnImpl: (...args) => {
      call = args;
      return child;
    },
  });

  assert.equal(returned, child);
  assert.deepEqual(call, [
    'C:\\Package\\runtime\\node.exe',
    ['C:\\Package\\server.mjs'],
    {
      cwd: 'C:\\Package',
      detached: true,
      env: { MRT_NO_OPEN: '1' },
      stdio: 'ignore',
      windowsHide: true,
    },
  ]);
  const source = read(LAUNCHER);
  const environment = source.match(/^export function packageEnvironment\([\s\S]*?^\}/m)[0].replace('export ', '');
  const spawn = source.match(/^export function spawnServer\([\s\S]*?^\}/m)[0].replace('export ', '');
  const inherited = { mrt_port: '9999', MRT_NO_OPEN: '0', KEEP_ME: 'yes' };
  let defaultOptions;
  runInNewContext(`${environment}\n${spawn}\nspawnServer('C:\\\\Package\\\\server.mjs');`, {
    process: { execPath: 'C:\\Package\\runtime\\node.exe', env: inherited }, ROOT: 'C:\\Package',
    spawn: (exe, args, options) => { defaultOptions = JSON.parse(JSON.stringify({ exe, args, options })); return child; },
  });
  assert.deepEqual(defaultOptions, {
    exe: 'C:\\Package\\runtime\\node.exe', args: ['C:\\Package\\server.mjs'],
    options: { cwd: 'C:\\Package', detached: true, env: { KEEP_ME: 'yes', MRT_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true },
  });
});

test('the coordinator accepts only a full package-input generation digest', async () => {
  const { readPackageGeneration } = await import('../packaging/windows/Launcher.mjs');
  const digest = 'a'.repeat(64);
  assert.equal(readPackageGeneration('C:\\Package', () => JSON.stringify({
    packageVersion: '2.0.2.0',
    generation: digest,
  })), digest);
  assert.equal(readPackageGeneration('C:\\Package', () => JSON.stringify({
    packageVersion: '2.0.2.0',
    generation: 'proof-2.0.2.0',
  })), null);
});

test('the coordinator health probe requires identity and exact generation', async () => {
  const { probeServer } = await import('../packaging/windows/Launcher.mjs');
  const response = (status, identity, generation, processId = '41') => ({
    status,
    headers: {
      get(name) {
        if (name === LOCAL_SERVER_HEADER_NAME) return identity;
        if (name === LOCAL_SERVER_GENERATION_HEADER_NAME) return generation;
        if (name === LOCAL_SERVER_PROCESS_HEADER_NAME) return processId;
        return null;
      },
    },
  });
  let requestedUrl;

  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async (url) => {
        requestedUrl = url;
        return response(204, LOCAL_SERVER_HEADER_VALUE, 'current-build');
      },
      verifyProcess: (pid) => pid === 41,
    }),
    { status: 'ready', processId: 41 },
  );
  assert.equal(requestedUrl, `http://127.0.0.1:8787${LOCAL_SERVER_HEALTH_PATH}`);
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'older-build',
      ),
      verifyProcess: () => true,
    }),
    { status: 'stale', generation: 'older-build' },
  );
  assert.deepEqual(
    await probeServer('current-build', { fetchImpl: async () => response(204, null, null) }),
    { status: 'foreign' },
  );
  assert.deepEqual(
    await probeServer('current-build', { fetchImpl: async () => { throw new Error('refused'); } }),
    { status: 'unreachable' },
  );
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'current-build',
      ),
      verifyProcess: () => false,
    }),
    { status: 'foreign' },
  );
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'current-build',
      ),
      verifyProcess: () => null,
    }),
    { status: 'verifying', processId: 41 },
  );
});

test('server ownership requires the listening packaged executable and server command', async () => {
  const { verifyServerProcess } = await import('../packaging/windows/Launcher.mjs');
  let invocation;
  const options = {
    executable: 'C:\\Package\\runtime\\node.exe',
    server: 'C:\\Package\\server.mjs',
  };
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: (...args) => {
      invocation = args;
      return JSON.stringify({
        ExecutablePath: 'C:\\Package\\runtime\\node.exe',
        CommandLine: '"C:\\Package\\runtime\\node.exe" C:\\Package\\server.mjs',
      });
    },
  }), true);
  assert.equal(invocation[0], 'powershell');
  assert.deepEqual(invocation[1].slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(invocation[1].join(' '), /OwningProcess -eq 41/);
  assert.deepEqual(invocation[2], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => JSON.stringify({
      ExecutablePath: 'C:\\Other\\node.exe',
      CommandLine: '"C:\\Other\\node.exe" C:\\Package\\server.mjs',
    }),
  }), false);
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => {
      const error = new Error('PowerShell timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  }), null);
});

test('the coordinator detaches the server and opens only after matching readiness', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const events = [];
  const child = fakeChild();
  const states = [{ status: 'unreachable' }, { status: 'ready' }];
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      const state = states.shift() ?? { status: 'ready' };
      events.push(`probe:${state.status}`);
      return state;
    },
    startServer: () => {
      events.push('spawn');
      return child;
    },
    openBrowser: async () => events.push('open'),
    portOccupied: async () => false,
    sleep: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.deepEqual(events, ['probe:unreachable', 'spawn', 'probe:ready', 'open']);
  assert.equal(child.unrefCalls, 1);
  assert.equal(child.killCalls, 0);
});

test('the coordinator reuses only the matching packaged generation', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  let opens = 0;
  const ready = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'ready' }),
    startServer: () => { starts += 1; return fakeChild(); },
    openBrowser: async () => { opens += 1; },
  });
  const stale = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'stale', generation: 'older-build' }),
    startServer: () => { starts += 1; return fakeChild(); },
    openBrowser: async () => { opens += 1; },
  });

  assert.equal(ready.status, LAUNCH_RESULT.OPENED);
  assert.equal(stale.status, LAUNCH_RESULT.FAILED);
  assert.match(stale.lines.join('\n'), /different build of Recap Page/);
  assert.equal(starts, 0);
  assert.equal(opens, 1);
});

test('overlapping coordinators converge without reporting the winning server as foreign', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  let opens = 0;
  const children = [];
  const probe = async () => (starts >= 2 ? { status: 'ready' } : { status: 'unreachable' });
  const startServer = () => {
    starts += 1;
    const child = fakeChild(40 + starts);
    children.push(child);
    return child;
  };
  const options = {
    exists: () => true,
    generation: 'current-build',
    probe,
    startServer,
    openBrowser: async () => { opens += 1; },
    portOccupied: async () => false,
    sleep: async () => Promise.resolve(),
  };

  const results = await Promise.all([coordinateLaunch(options), coordinateLaunch(options)]);
  assert.deepEqual(results.map(({ status }) => status), [LAUNCH_RESULT.OPENED, LAUNCH_RESULT.OPENED]);
  assert.equal(starts, 2);
  assert.equal(opens, 2);
  assert.equal(children.every((child) => child.unrefCalls === 1), true);
  assert.equal(children.every((child) => child.killCalls === 0), true);
});

test('a silent listener receives actionable busy-port guidance without spawning', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'unreachable' }),
    portOccupied: async () => true,
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
  });

  assert.equal(result.status, LAUNCH_RESULT.FAILED);
  assert.equal(starts, 0);
  assert.match(result.lines.join('\n'), /Port 8787 is already in use/);
  assert.match(result.lines.join('\n'), /Do not start Recap Page on a different port/);
});

test('a matching server that binds during the port check is re-probed before refusal', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let probes = 0;
  let starts = 0;
  let opens = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      probes += 1;
      return probes === 1
        ? { status: 'unreachable' }
        : { status: 'ready', processId: 41 };
    },
    portOccupied: async () => true,
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
    openBrowser: async () => {
      opens += 1;
    },
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(probes, 2);
  assert.equal(starts, 0);
  assert.equal(opens, 1);
});

test('an inconclusive ownership check cannot kill the server just started', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const child = fakeChild(41);
  const states = [
    { status: 'unreachable' },
    { status: 'verifying', processId: 41 },
  ];
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => states.shift() ?? { status: 'verifying', processId: 41 },
    portOccupied: async () => false,
    startServer: () => child,
    openBrowser: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(result.serverProcessId, 41);
  assert.equal(child.killCalls, 0);
});

test('an existing server with inconclusive ownership is retried without being replaced', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let probes = 0;
  let starts = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      probes += 1;
      return probes === 1
        ? { status: 'verifying', processId: 41 }
        : { status: 'ready', processId: 41 };
    },
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
    openBrowser: async () => {},
    sleep: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(probes, 2);
  assert.equal(starts, 0);
});

test('browser handoff failure keeps the healthy server available with manual guidance', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'ready' }),
    openBrowser: async () => { throw new Error('no browser association'); },
  });

  assert.equal(result.status, LAUNCH_RESULT.FAILED);
  assert.equal(result.retainServer, true);
  assert.match(result.lines.join('\n'), /Open http:\/\/127\.0\.0\.1:8787\//);
});

test('the MSIX inspector reads x64 and ARM64 PE machine values', async () => {
  const { peMachine } = await import('../scripts/inspect-msix.mjs');
  for (const expected of [0x8664, 0xaa64]) {
    const bytes = Buffer.alloc(128);
    bytes.write('MZ');
    bytes.writeUInt32LE(64, 0x3c);
    bytes.write('PE\0\0', 64, 'ascii');
    bytes.writeUInt16LE(expected, 68);
    assert.equal(peMachine(bytes), expected);
  }
});

test('the MSIX inspector cannot miss a short-lived runtime exit', async () => {
  const { measureRuntime } = await import('../scripts/inspect-msix.mjs');
  const child = new EventEmitter();
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const measured = measureRuntime('C:\\Package', 'x64', {
    spawnImpl: () => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('runtime=x64\n'));
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      return child;
    },
  });

  const result = await Promise.race([
    measured,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('runtime inspection missed the child exit')),
      500,
    )),
  ]);
  assert.deepEqual(result, {
    runtime: 'x64',
    output: 'runtime=x64',
  });
});

test('generated package and trust material stay under the ignored output boundary', () => {
  const ignored = read(join(ROOT, '.gitignore'));
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

  assert.match(ignored, /^dist\/$/m);
  assert.deepEqual(tracked.filter((path) => path.startsWith('dist/')), []);
  assert.deepEqual(tracked.filter((path) => /\.(?:pfx|cer|msix|msixbundle)$/i.test(path)), []);
});

test('package scripts expose build and independently invocable proof scenarios', async () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const proof = await import('../scripts/msix-proof.mjs');
  const houseOfM = JSON.parse(read(join(ROOT, 'src', 'data', 'catalog.json'))).lists
    .find((list) => list.id === 'house-of-m');

  assert.equal(pkg.scripts['msix:pack'], 'node scripts/pack-msix.mjs');
  assert.equal(pkg.scripts['msix:inspect'], 'node scripts/inspect-msix.mjs');
  assert.equal(pkg.scripts['msix:prove'], 'node scripts/msix-proof.mjs');
  assert.deepEqual(proof.SCENARIOS, [
    'certification-functionality',
    'busy-port-refusal',
    'update-state-continuity',
  ]);
  assert.match(read(PROOF), /const CATALOG_ROUTE = '#\/catalog'/);
  assert.match(read(PROOF), /const CATALOG_RESULTS = '#catalog-results'/);
  assert.equal(houseOfM?.type, 'event');
  assert.equal(houseOfM?.count, 20);
  assert.match(
    read(PROOF),
    /input\[data-act="path-preview"\]\[data-key="\$\{CATALOG_LIST_ID\}"\]/,
  );
  assert.doesNotMatch(read(PROOF), /#\/storylines/);
  assert.equal(
    [...read(PROOF).matchAll(/waitForCatalogCard\(page, 'House of M'\)/g)].length,
    2,
  );
});

test('busy-port proof captures the installed supervisor without Windows Terminal', async (t) => {
  const { startInstalledLauncher } = await import('../scripts/msix-proof.mjs');
  const installLocation = 'C:\\Program Files\\WindowsApps\\RecapPage';
  const stagingRoot = 'C:\\Temp\\recap-page-installed-launcher';
  const child = fakeChild(73);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const launched = startInstalledLauncher(
    { InstallLocation: installLocation },
    {
      environment: { PATH: 'C:\\Windows' },
      stageLauncher: (installed) => {
        assert.equal(installed.InstallLocation, installLocation);
        return {
          root: stagingRoot,
          executable: join(stagingRoot, 'runtime', 'node.exe'),
          launcher: join(stagingRoot, 'Launcher.mjs'),
          files: ['runtime\\node.exe', 'Launcher.mjs', 'server.mjs', 'src\\msix-generation.json'],
        };
      },
      spawnImpl: (...args) => {
        invocation = args;
        return child;
      },
    },
  );
  child.stderr.emit('data', Buffer.from('Port 8787 is already in use.\n'));

  assert.deepEqual(invocation, [
    join(stagingRoot, 'runtime', 'node.exe'),
    [join(stagingRoot, 'Launcher.mjs')],
    {
      cwd: stagingRoot,
      env: { PATH: 'C:\\Windows' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  ]);
  assert.equal(launched.child, child);
  assert.equal(launched.output.join(''), 'Port 8787 is already in use.\n');
  assert.equal(launched.error(), null);
  assert.equal(launched.stagingRoot, stagingRoot);

  const source = read(PROOF);
  const definition = (name) => {
    const value = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
    assert.ok(value, `actual ${name} definition is required`);
    return value;
  };
  const entry = source.match(/^if \(process\.argv\[1\] && fileURLToPath\(import\.meta\.url\) === process\.argv\[1\]\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(entry, 'the actual installed proof CLI entry is required');
  const scratch = mkdtempSync(join(tmpdir(), 'recap-busy-cli-'));
  try {
    for (const mode of ['unsettled', 'sockets', 'cleanup-failure', 'close-deadline']) {
      const main = definition('main');
      const busy = mode === 'unsettled'
        ? 'async function busyPortRefusal() { await new Promise(() => {}); }'
        : `${definition('createBusyHolder')}\n${definition('runInstalledScenario')}\n${definition('busyPortRefusal')}`;
      const fixture = `
import assert from 'node:assert/strict';
import { createServer as realCreateServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
const mode = ${JSON.stringify(mode)};
const SCENARIOS = ['certification-functionality', 'busy-port-refusal', 'update-state-continuity'];
const ARCHITECTURES = ['x64', 'arm64'];
const STORE_PACKAGE_VERSION = '2.0.3.0', AUMID = 'inert-aumid';
let server, queued, accepted = 0, peerClosed = 0, serverClosed = 0, responseBytes = 0;
let acceptedChanged = () => {};
const sockets = [];
function createServer(handler) {
  server = realCreateServer((socket) => {
    ++accepted; sockets.push(socket);
    if (mode === 'sockets' && accepted === 3) queued = socket;
    else handler(socket);
    acceptedChanged();
  });
  const listen = server.listen.bind(server);
  server.listen = (port, host, callback) => {
    assert.equal(port, 8787); assert.equal(host, '127.0.0.1');
    return listen(0, '127.0.0.1', callback);
  };
  server.once('close', () => { ++serverClosed; });
  const close = server.close.bind(server);
  server.close = (callback) => {
    const result = close((error) => { if (mode !== 'close-deadline') callback(error); });
    if (queued) { handler(queued); queued = null; }
    return result;
  };
  return server;
}
async function withNativeObservation(installed, architecture, source, kind, body) {
  assert.equal(server.maxConnections, 64);
  await body();
  const count = mode === 'sockets' ? 3 : 1;
  for (let index = 0; index < count; index++) {
    await new Promise((resolve, reject) => {
      const client = createConnection({ host: '127.0.0.1', port: server.address().port });
      client.once('connect', () => { client.write('inert foreign-port probe'); resolve(); });
      client.on('data', (data) => { responseBytes += data.length; });
      client.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
      client.once('close', () => { ++peerClosed; });
    });
  }
  await new Promise((resolve) => {
    acceptedChanged = () => { if (accepted === count) resolve(); };
    acceptedChanged();
  });
}
async function loadStartupEvidence() {}
function assertNoPreexistingPackage() {}
function installPackage() { return { InstallLocation: 'inert-installation' }; }
function browserSnapshotDigest() { return 'unchanged'; }
function packageProcesses() { return []; }
function activate() {}
function cleanupPackage() {}
async function waitFor(predicate) { return predicate(); }
function startInstalledLauncher() {
  return { child: { pid: 42 }, error: () => null, stagedFiles: [],
    output: ['Port 8787 is already in use. It is not running this version of Recap Page. '
      + 'Do not start Recap Page on a different port. another port opens a separate browser storage location.'] };
}
function removeStagedLauncher() {
  if (mode === 'cleanup-failure') {
    sockets[0].destroy(Object.assign(new Error('synthetic-private-socket-detail'), { code: 'EIO', errno: -5 }));
    throw new Error('inert-staged-cleanup-failure');
  }
}
process.once('exit', () => {
  if (mode === 'unsettled') return;
  assert.equal(accepted, mode === 'sockets' ? 3 : 1);
  assert.equal(peerClosed, accepted);
  assert.equal(serverClosed, 1);
  assert.equal(responseBytes, 0);
  console.log('DIAG busy-cli-sockets accepted=' + accepted + ' peers_closed=' + peerClosed
    + ' server_closed=' + serverClosed + ' response_bytes=' + responseBytes);
});
${busy}
${main}
${definition('formatProofError')}
${entry}
`;
      const path = join(scratch, `${mode}.mjs`);
      writeFileSync(path, fixture);
      const result = spawnSync(process.execPath, [path, '--scenario=busy-port-refusal',
        '--architecture=x64', '--source=package'], {
        cwd: scratch, encoding: 'utf8', windowsHide: true, timeout: 7000, maxBuffer: 65536,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      t.diagnostic(`busy-cli case=${mode} exit=${result.status} final_marker=${result.stdout.includes('PASS installed-journey')}`);
      assert.equal(result.status, mode === 'sockets' ? 0 : 1);
      if (mode === 'unsettled') {
        assert.match(result.stderr, /^FAIL installed-journey code=main-incomplete\r?\n$/);
      } else {
        assert.match(result.stdout, /DIAG busy-cli-sockets accepted=[13] peers_closed=[13] server_closed=1 response_bytes=0/);
        assert.match(result.stdout, /"phase": "behavior"/);
        if (mode === 'sockets') {
          assert.match(result.stdout, /DIAG busy-holder-cleanup phase=completed accepted=3 open=0 closed=3/);
          assert.equal(result.stdout.match(/^PASS installed-journey scenario=busy-port-refusal architecture=x64 source=package cleanup=complete$/gm)?.length, 1);
          assert.equal(result.stderr, '');
        } else {
          assert.match(result.stdout, /DIAG busy-holder-cleanup phase=failed/);
          assert.match(result.stderr, mode === 'close-deadline' ? /busy-holder-close-deadline/ : /inert-staged-cleanup-failure/);
          assert.doesNotMatch(result.stderr, /synthetic-private-socket-detail/);
        }
      }
      if (mode !== 'sockets') assert.doesNotMatch(result.stdout, /^PASS installed-journey/m);
    }
    t.diagnostic('busy-cli-children=4 package-native-operations=inert socket-origin=owned-ephemeral');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('busy-port proof stages only the exact installed launcher inputs', async () => {
  const { stageInstalledLauncher } = await import('../scripts/msix-proof.mjs');
  const installLocation = 'C:\\Program Files\\WindowsApps\\RecapPage';
  const stagingRoot = 'C:\\Temp\\recap-page-installed-launcher';
  const copies = [];
  const directories = [];
  const staged = stageInstalledLauncher(
    { InstallLocation: installLocation },
    {
      createTemp: () => stagingRoot,
      makeDirectory: (...args) => directories.push(args),
      copyFile: (...args) => copies.push(args),
    },
  );

  const relativeFiles = [
    ['runtime', 'node.exe'],
    ['Launcher.mjs'],
    ['server.mjs'],
    ['src', 'msix-generation.json'],
  ];
  assert.deepEqual(copies, relativeFiles.map((parts) => [
    join(installLocation, ...parts),
    join(stagingRoot, ...parts),
  ]));
  assert.equal(directories.length, relativeFiles.length);
  assert.equal(staged.root, stagingRoot);
  assert.equal(staged.executable, join(stagingRoot, 'runtime', 'node.exe'));
  assert.equal(staged.launcher, join(stagingRoot, 'Launcher.mjs'));
});

test('staged installed launcher cleanup stops the child before removing its files', async () => {
  const { removeStagedLauncher } = await import('../scripts/msix-proof.mjs');
  const calls = [];
  removeStagedLauncher(
    { child: { pid: 73 }, stagingRoot: 'C:\\Temp\\recap-page-installed-launcher' },
    {
      stopProcesses: (processIds) => calls.push(['stop', processIds]),
      removeTree: (path, options) => calls.push(['remove', path, options]),
    },
  );
  assert.deepEqual(calls, [
    ['stop', [73]],
    [
      'remove',
      'C:\\Temp\\recap-page-installed-launcher',
      { recursive: true, force: true },
    ],
  ]);
});

test('certification proof selects the process that actually owns port 8787', async () => {
  const { selectListenerServer } = await import('../scripts/msix-proof.mjs');
  const losingServer = {
    ProcessId: 81,
    CommandLine: '"node.exe" "C:\\Package\\server.mjs"',
  };
  const listener = {
    ProcessId: 82,
    CommandLine: '"node.exe" "C:\\Package\\server.mjs"',
  };

  assert.equal(selectListenerServer([losingServer, listener], 82), listener);
  assert.equal(selectListenerServer([losingServer, listener], 83), null);
  assert.throws(
    () => selectListenerServer([{ ProcessId: 82, CommandLine: '"node.exe" "Launcher.mjs"' }], 82),
    /did not run the package server/,
  );
});

test('proof cleanup force-stops only its exact recorded process IDs', async () => {
  const { stopPids } = await import('../scripts/msix-proof.mjs');
  const scripts = [];
  stopPids([41, 41, 0, null], (script) => {
    scripts.push(script);
    return '';
  });

  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /Get-Process -Id 41/);
  assert.match(scripts[0], /Stop-Process -Id 41 -Force -ErrorAction Stop/);
  assert.match(scripts[0], /\$p\.WaitForExit\(10000\)/);
  assert.doesNotMatch(scripts[0], /if \(Get-Process -Id 41.*remains after stop/);
  assert.doesNotMatch(scripts[0], /Stop-Process -Name|taskkill/);
});

test('listener lookup treats an absent exact endpoint as a normal null result', async () => {
  const { listenerPid } = await import('../scripts/msix-proof.mjs');
  let script;
  assert.equal(listenerPid((value) => {
    script = value;
    return '';
  }), null);
  assert.match(script, /Get-NetTCPConnection -State Listen -ErrorAction Stop/);
  assert.match(script, /Where-Object .*LocalAddress.*LocalPort/);
  assert.doesNotMatch(script, /-LocalPort 8787|-ExpandProperty OwningProcess/);
  assert.equal(listenerPid(() => '41'), 41);
});

test('the proof refuses a foreign package identity before invoking PowerShell', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  let calls = 0;
  assert.throws(
    () => removePackage('Foreign.Package', 'Foreign.Package_family', {
      runPowerShell: () => { calls += 1; },
      getPackageInfo: () => { calls += 1; },
    }),
    /outside the exact Recap Page identity/,
  );
  assert.equal(calls, 0);
});

test('package removal fails if the exact identity remains registered', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  const remaining = {
    Name: 'PanelStackLabs.RecapPage',
    PackageFamilyName: 'PanelStackLabs.RecapPage_we33aa8nvkpcc',
    PackageFullName: 'PanelStackLabs.RecapPage_2.0.2.1_x64__we33aa8nvkpcc',
  };
  let removalCalls = 0;
  assert.throws(
    () => removePackage(remaining.Name, remaining.PackageFamilyName, {
      runPowerShell: () => {
        removalCalls += 1;
        return '';
      },
      getPackageInfo: () => remaining,
    }),
    (error) => error instanceof AggregateError
      && error.errors.some((failure) => /package identity remains registered/.test(failure.message)),
  );
  assert.equal(removalCalls, 1);
});

test('package absence is verified even when the removal command fails', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  const calls = [];
  assert.throws(
    () => removePackage(
      'PanelStackLabs.RecapPage',
      'PanelStackLabs.RecapPage_we33aa8nvkpcc',
      {
        runPowerShell: () => {
          calls.push('remove');
          throw new Error('removal failed');
        },
        getPackageInfo: () => {
          calls.push('verify');
          return null;
        },
      },
    ),
    (error) => error instanceof AggregateError
      && /removal or absence verification failed/.test(error.message),
  );
  assert.deepEqual(calls, ['remove', 'verify']);
});

test('aggregate proof failures retain every scenario and cleanup cause', async () => {
  const { formatProofError } = await import('../scripts/msix-proof.mjs');
  const error = new AggregateError(
    [
      new Error('scenario failed'),
      new AggregateError([new Error('cleanup failed')], 'cleanup aggregate'),
    ],
    'scenario and cleanup failed',
  );

  const output = formatProofError(error);
  assert.match(output, /scenario and cleanup failed/);
  assert.match(output, /scenario failed/);
  assert.match(output, /cleanup aggregate/);
  assert.match(output, /cleanup failed/);

  const source = read(PROOF);
  const actualFunction = (name) => {
    const definition = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}$`, 'm'))?.[0];
    assert.ok(definition, `${name} must be the actual proof function`);
    return definition.replace('fileURLToPath(import.meta.url)', 'proofModule');
  };
  const invokeFailure = (name, invocation, dependencies) => {
    let caught;
    try {
      runInNewContext(`${actualFunction(name)}\n${invocation}`, {
        Error, AggregateError, Buffer, join, ROOT: 'inert-root', ...dependencies,
      });
    } catch (failure) {
      caught = failure;
    }
    assert.ok(caught instanceof Error, 'the actual wrapper must throw');
    return caught;
  };
  const privateMarker = 'SYNTHETIC-PRIVATE-CAUSE-NOT-PUBLIC';
  const publicationCause = new Error(`${privateMarker} publication-path`);
  publicationCause.errno = -5;
  const publication = invokeFailure('publishSemanticRecord',
    "publishSemanticRecord('inert-root', 'record.txt', 'fixed');", {
      existsSync: () => false,
      writeFileSync: () => { throw publicationCause; },
      renameSync: () => { throw new Error('rename must not follow a failed write'); },
    });
  assert.equal(publication.cause, publicationCause);
  assert.equal(publication.message, 'semantic record publication failed errno=-5');
  assert.doesNotMatch(formatProofError(publication), new RegExp(privateMarker));

  const acknowledgementCause = new Error(`${privateMarker} acknowledgement-path`);
  acknowledgementCause.errno = -2;
  const acknowledgement = invokeFailure('createSemanticCapture',
    "createSemanticCapture('inert-root', 'x64', 'functionality', 'package').begin('listener-query', 'fixed');", {
      process: { pid: 123, execPath: 'inert-node' }, proofModule: 'inert-proof-module',
      resolveEdge: () => '', publishSemanticRecord: () => {}, existsSync: () => true,
      performance: { now: () => 0 },
      readFileSync: () => { throw acknowledgementCause; },
    });
  assert.equal(acknowledgement.cause, acknowledgementCause);
  assert.equal(acknowledgement.message, 'semantic acknowledgement read failed errno=-2');
  assert.doesNotMatch(formatProofError(acknowledgement), new RegExp(privateMarker));

  const helper = new Error('original helper failure', { cause: new Error(`${privateMarker} helper-command`) });
  const combined = invokeFailure('powershell', "powershell('fixed', 'listener-query');", {
    activeSemanticCapture: { begin: () => ({}), end: () => { throw acknowledgement; } },
    execFileSync: () => { throw helper; },
  });
  assert.ok(combined instanceof AggregateError);
  assert.deepEqual(combined.errors, [helper, acknowledgement]);
  assert.equal(combined.cause, acknowledgement);
  assert.equal(combined.message, 'helper and semantic reporting failed');
  const formatted = formatProofError(combined);
  assert.ok(formatted.indexOf('original helper failure') < formatted.indexOf('semantic acknowledgement read failed'));
  assert.doesNotMatch(formatted, new RegExp(privateMarker));
});

test('the proof distinguishes the Node supervisor from its server child', async () => {
  const { waitForProcess } = await import('../scripts/msix-proof.mjs');
  const processes = [
    { Name: 'node.exe', ProcessId: 41, CommandLine: 'node.exe Launcher.mjs' },
    { Name: 'node.exe', ProcessId: 42, CommandLine: 'node.exe server.mjs' },
  ];
  const original = await waitForProcess(
    { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
    new Date(0),
    'node.exe',
    'Launcher.mjs',
    () => processes,
  );
  assert.equal(original.ProcessId, 41);
});

test('busy-port exit uses supervisor-child ownership when CommandLine is unreadable', async () => {
  const { serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
    CommandLine: 'node.exe Launcher.mjs',
  };
  const child = {
    Name: 'NODE.EXE',
    ProcessId: 42,
    ParentProcessId: 41,
    ExecutablePath: supervisor.ExecutablePath.toUpperCase(),
    CommandLine: null,
  };

  assert.equal(serverChildExited([supervisor, child], supervisor), false);
  assert.equal(serverChildExited([supervisor], supervisor), true);
});

test('busy-port exit fails closed when package process ownership metadata is missing', async () => {
  const { serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
  };
  const unknown = {
    Name: 'node.exe',
    ProcessId: 42,
    ParentProcessId: null,
    ExecutablePath: supervisor.ExecutablePath,
    CommandLine: null,
  };

  assert.equal(serverChildExited([supervisor, unknown], supervisor), false);
});

test('package process enumeration applies package-root or direct-child retention behavior', async () => {
  const { packageProcesses, serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
  };
  const processes = packageProcesses(
    { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
    new Date(0),
    {
      parentProcessId: supervisor.ProcessId,
      runPowerShell: () => JSON.stringify([
        supervisor,
        {
          Name: 'node.exe',
          ProcessId: 42,
          ParentProcessId: supervisor.ProcessId,
          ExecutablePath: null,
          CommandLine: null,
        },
        {
          Name: 'unrelated.exe',
          ProcessId: 43,
          ParentProcessId: 9,
          ExecutablePath: null,
          CommandLine: null,
        },
        {
          Name: 'helper.exe',
          ProcessId: 44,
          ParentProcessId: 9,
          ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\helper.exe',
          CommandLine: null,
        },
      ]),
    },
  );

  assert.deepEqual(processes.map(({ ProcessId }) => ProcessId), [41, 42, 44]);
  assert.equal(serverChildExited(processes, supervisor), false);
});

test('cleanup still attempts package removal when process enumeration fails', async () => {
  const { cleanupPackage } = await import('../scripts/msix-proof.mjs');
  const calls = [];
  assert.throws(
    () => cleanupPackage({
      installed: { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
      since: new Date(0),
      owned: [41],
    }, {
      listProcesses: () => {
        calls.push('enumerate');
        throw new Error('enumeration failed');
      },
      stopProcesses: () => calls.push('stop'),
      removeOwnedPackage: () => calls.push('remove'),
    }),
    (error) => error instanceof AggregateError && /cleanup did not complete/.test(error.message),
  );
  assert.deepEqual(calls, ['enumerate', 'remove']);
});

test('cleanup stops only processes freshly verified inside the package', async () => {
  const { cleanupPackage } = await import('../scripts/msix-proof.mjs');
  let stopped;
  cleanupPackage({
    installed: { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
    since: new Date(0),
    owned: [41],
  }, {
    listProcesses: () => [{ ProcessId: 42 }],
    stopProcesses: (processIds) => {
      stopped = processIds;
    },
    removeOwnedPackage: () => {},
  });
  assert.deepEqual(stopped, [42]);
});

test('Windows packaging adds no browser runtime dependency', () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal(Object.keys(pkg.devDependencies ?? {}).some((name) => /winapp|msix|package.?support/i.test(name)), false);
});
