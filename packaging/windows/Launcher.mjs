import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://127.0.0.1:8787';
// Packaging moves this file to the app root, so tests bind these literals to the shared contract.
const SERVER_IDENTITY_HEADER = 'X-Recap-Page-Server';
const SERVER_IDENTITY = '1';
const SERVER_GENERATION_HEADER = 'X-Recap-Page-Generation';
const SERVER_PROCESS_HEADER = 'X-Recap-Page-Process';
const READY_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 750;

export const LAUNCH_RESULT = Object.freeze({
  OPENED: 'opened',
  FAILED: 'failed',
});

function pauseThenExit(code) {
  process.stdout.write('Press any key to close.');
  if (!process.stdin.isTTY) {
    // Packaged activation redirects stdin, so retain actionable failures before Windows closes it.
    process.stdout.write('\n');
    setTimeout(() => process.exit(code), 30000);
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once('data', () => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    process.exit(code);
  });
}

function fail(lines) {
  for (const line of lines) console.error(line);
  pauseThenExit(1);
}

export function readPackageGeneration(root = ROOT, readFile = readFileSync) {
  try {
    const marker = JSON.parse(readFile(join(root, 'src', 'msix-generation.json'), 'utf8'));
    return typeof marker.generation === 'string' && /^[0-9a-f]{64}$/.test(marker.generation)
      ? marker.generation
      : null;
  } catch {
    return null;
  }
}

export async function probeServer(
  generation,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = PROBE_TIMEOUT_MS,
    verifyProcess = verifyServerProcess,
  } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${ORIGIN}/__recap_page_health__`, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      return { status: 'unreachable' };
    }
    const identity = response?.headers?.get?.(SERVER_IDENTITY_HEADER);
    if (response?.status !== 204 || identity !== SERVER_IDENTITY) {
      return { status: 'foreign' };
    }
    const servedGeneration = response.headers.get(SERVER_GENERATION_HEADER);
    if (servedGeneration !== generation) {
      return { status: 'stale', generation: servedGeneration };
    }
    const processId = Number(response.headers.get(SERVER_PROCESS_HEADER));
    if (!Number.isInteger(processId) || processId <= 0) return { status: 'foreign' };
    let diagnostic;
    const ownership = await verifyProcess(processId, {
      onDiagnostic: (value) => { diagnostic = cleanVerificationDiagnostic(value); },
    });
    if (ownership === true) return { status: 'ready', processId };
    const detail = diagnostic ? { diagnostic } : {};
    if (ownership === false) return { status: 'foreign', ...detail };
    return { status: 'verifying', processId, ...detail };
  } finally {
    clearTimeout(timer);
  }
}

export const SERVER_OWNERSHIP_HELPER = join(ROOT, 'VerifyServer.ps1');
const VERIFIER_STAGES = new Set(['process', 'loader', 'interop', 'ip-size', 'ip-query', 'ip-decode', 'ip-owner', 'wmi', 'identity']);
const VERIFIER_REASONS = new Set(['spawn', 'timeout', 'exception', 'native-return', 'invalid-buffer', 'missing', 'mismatch', 'invalid-response', 'not-owned']);
const VERIFIER_ENTRY_STAGES = new Set(['loader', 'interop', 'ip-size', 'ip-query', 'ip-decode', 'wmi']);
const VERIFIER_LANGUAGES = new Set(['Unknown', 'FullLanguage', 'ConstrainedLanguage', 'RestrictedLanguage', 'NoLanguage']);

function diagnosticNumber(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 0xffffffff;
}

function cleanVerificationDiagnostic(value) {
  if (!value || !VERIFIER_STAGES.has(value.stage) || !VERIFIER_REASONS.has(value.reason)
      || !diagnosticNumber(value.exit) || !diagnosticNumber(value.code)
      || !Number.isInteger(value.elapsed) || value.elapsed < 0 || value.elapsed > 2147483647
      || ![-1, 0, 1].includes(value.node64) || ![-1, 0, 1].includes(value.ps64)
      || !VERIFIER_LANGUAGES.has(value.language ?? 'Unknown')) return undefined;
  const { stage, reason, exit, code, elapsed, node64, ps64 } = value;
  return { stage, reason, exit, code, elapsed, node64, ps64, language: value.language ?? 'Unknown' };
}

export function verificationDiagnosticLine(value) {
  const fact = cleanVerificationDiagnostic(value);
  return fact
    ? `Verification diagnostic: stage=${fact.stage} reason=${fact.reason} exit=${fact.exit} code=${fact.code} elapsed=${fact.elapsed} node64=${fact.node64} ps64=${fact.ps64} language=${fact.language}`
    : null;
}

function verificationDiagnosticLines(value) {
  const line = verificationDiagnosticLine(value);
  return line ? [line] : [];
}

function verifierPacket(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length > 128) return null;
    value = value.toString('utf8');
  }
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = /^RCPV1 ([a-z-]+) ([a-z-]+) (-?(?:0|[1-9]\d{0,9})) (-1|4|8)(?:\r?\n)?$/.exec(value);
  if (!match || match[0] !== value || !VERIFIER_STAGES.has(match[1])
      || !(VERIFIER_REASONS.has(match[2]) || match[2] === 'enter' && VERIFIER_ENTRY_STAGES.has(match[1]) && match[3] === '0')
      || !diagnosticNumber(Number(match[3])) || String(Number(match[3])) !== match[3]) return null;
  if (match[4] === '-1' && !(match[1] === 'loader'
      && (match[2] === 'enter' && match[3] === '0' || match[2] === 'exception' && match[3] === '-1'))) return null;
  return { stage: match[1], reason: match[2], code: Number(match[3]), ps64: match[4] === '8' ? 1 : match[4] === '4' ? 0 : -1 };
}

function verifierTranscript(value) {
  const result = { entry: null, failure: null };
  if (Buffer.isBuffer(value)) {
    if (value.length >= 1024) return result;
    value = value.toString('utf8');
  }
  if (typeof value !== 'string' || value.length >= 1024 || Buffer.byteLength(value, 'utf8') >= 1024) return result;
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > 7) return result;
  let valid = true;
  for (const [index, line] of lines.entries()) {
    const packet = verifierPacket(line);
    if (!packet) {
      valid = false;
    } else if (packet.reason === 'enter') {
      result.entry = packet;
    } else if (!result.failure && index === lines.length - 1) {
      result.failure = packet;
    } else {
      valid = false;
    }
  }
  if (!valid) result.failure = null;
  return result;
}

function verifierOutput(value) {
  const result = { valid: true, framed: false, payload: '', language: 'Unknown', entry: null, failure: null };
  if (value == null) return result;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value !== 'string') return { ...result, valid: false };
  let offset = 0;
  let frames = 0;
  let languages = 0;
  while (value.startsWith('RCPV1 ', offset)) {
    const end = value.indexOf('\n', offset);
    if (end < 0 || end - offset > 128 || ++frames > 4 || end + 1 >= 1024) return { ...result, valid: false };
    const line = value.slice(offset, end).replace(/\r$/, '');
    const mode = /^RCPV1 language (FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)$/.exec(line);
    if (mode && mode[0] === line && ++languages <= 2 && !result.failure) {
      result.language = mode[1];
    } else {
      const packet = verifierPacket(line);
      if (!packet || packet.stage !== 'loader' || packet.ps64 !== -1 || result.failure) return { ...result, valid: false };
      if (packet.reason === 'enter') result.entry = packet;
      else if (packet.reason === 'exception') result.failure = packet;
      else return { ...result, valid: false };
    }
    result.framed = true;
    offset = end + 1;
  }
  result.payload = value.slice(offset).trim();
  return result;
}

function validProcessId(processId) {
  return Number.isInteger(processId) && processId > 0 && processId <= 0xffffffff;
}

export function serverOwnershipCommand(processId, helperPath = SERVER_OWNERSHIP_HELPER) {
  if (!validProcessId(processId)) throw new RangeError('Invalid server process ID.');
  const literal = helperPath.replaceAll("'", "''");
  return `try { Write-Output ('RCPV1 language '+$ExecutionContext.SessionState.LanguageMode); Write-Output 'RCPV1 loader enter 0 -1'; & ([ScriptBlock]::Create([IO.File]::ReadAllText('${literal}'))) -recapProcessId ${processId} } catch { Write-Output 'RCPV1 loader exception -1 -1'; exit 1 }`;
}

export function verifyServerProcess(
  processId,
  {
    executable = process.execPath,
    server = join(ROOT, 'server.mjs'),
    execFile = execFileSync,
    onDiagnostic,
  } = {},
) {
  const started = performance.now();
  let language = 'Unknown';
  onDiagnostic?.(null);
  const report = (stage, reason, exit = -1, code = -1, ps64 = -1) => {
    onDiagnostic?.({
      stage, reason, exit: diagnosticNumber(exit) ? exit : -1,
      code: diagnosticNumber(code) ? code : -1,
      elapsed: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))),
      node64: ['x64', 'arm64'].includes(process.arch) ? 1 : ['ia32', 'arm'].includes(process.arch) ? 0 : -1,
      ps64, language,
    });
  };
  if (!validProcessId(processId)) {
    report('identity', 'invalid-response');
    return false;
  }
  const script = serverOwnershipCommand(processId);
  let raw;
  try {
    raw = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        stdio: 'pipe',
      },
    );
  } catch (error) {
    const output = verifierOutput(error?.stdout);
    language = output.language;
    const transcript = verifierTranscript(error?.stderr);
    const entry = transcript.entry ?? output.entry;
    const failure = transcript.failure ?? (output.valid ? output.failure : null);
    if (error?.code === 'ETIMEDOUT') {
      report(entry?.stage ?? 'process', 'timeout', error?.status, -1, entry?.ps64 ?? -1);
    } else if (['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'ENOTDIR'].includes(error?.code)) {
      report('process', 'spawn', error?.status, error?.errno);
    } else if (failure) {
      report(failure.stage, failure.reason, error?.status, failure.code, failure.ps64);
    } else if (entry) {
      report(entry.stage, 'exception', error?.status, -1, entry.ps64);
    } else {
      report('process', error?.stderr?.length || !output.valid ? 'invalid-response' : 'exception', error?.status);
    }
    return null;
  }
  const output = verifierOutput(raw);
  language = output.language;
  if (!output.valid || output.failure || output.framed && !output.payload) {
    report(output.failure?.stage ?? 'identity', output.failure?.reason ?? 'invalid-response', 0);
    return null;
  }
  raw = output.payload;
  if (!raw) {
    report('identity', 'missing', 0);
    return false;
  }
  try {
    const candidate = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid verifier response.');
    if (Object.hasOwn(candidate, 'VerifierDiagnostic')) {
      const packet = verifierPacket(candidate.VerifierDiagnostic);
      if (Object.keys(candidate).length !== 1 || !packet || packet.code !== 0
          || !(packet.stage === 'ip-owner' && packet.reason === 'not-owned'
            || packet.stage === 'wmi' && packet.reason === 'missing')) throw new Error('Invalid verifier response.');
      report(packet.stage, packet.reason, 0, packet.code, packet.ps64);
      return false;
    }
    const owned = candidate.ExecutablePath?.toLowerCase() === executable.toLowerCase()
      && candidate.CommandLine?.toLowerCase().includes(server.toLowerCase());
    if (owned === true) return true;
    const ps64 = candidate.VerifierPointerBytes === 8 ? 1 : candidate.VerifierPointerBytes === 4 ? 0 : -1;
    report('identity', candidate.ExecutablePath == null || candidate.CommandLine == null ? 'missing' : 'mismatch', 0, -1, ps64);
    return owned === false ? false : null;
  } catch {
    report('identity', 'invalid-response', 0);
    return null;
  }
}

export function isPortOccupied({
  connect = createConnection,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  return new Promise((resolveOccupied) => {
    let settled = false;
    const socket = connect({ host: '127.0.0.1', port: 8787 });
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveOccupied(occupied);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.unref?.();
  });
}

export function packageEnvironment(source = process.env) {
  const blocked = new Set(['MRT_PORT', 'MRT_NO_OPEN']);
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(([key]) => !blocked.has(key.toUpperCase())),
    ),
    MRT_NO_OPEN: '1',
  };
}

export function spawnServer(
  server,
  {
    root = ROOT,
    spawnImpl = spawn,
    executable = process.execPath,
    environment = packageEnvironment(),
  } = {},
) {
  return spawnImpl(executable, [server], {
    cwd: root,
    detached: true,
    env: environment,
    stdio: 'ignore',
    windowsHide: true,
  });
}

export function openDefaultBrowser(
  url = `${ORIGIN}/`,
  {
    spawnImpl = spawn,
    timeoutMs = 0,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Promise.reject(new Error('invalid browser-command timeout'));
  }
  return new Promise((resolveOpen, rejectOpen) => {
    let child;
    try {
      child = spawnImpl('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      rejectOpen(error);
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimer(timer);
      child.removeListener('exit', onExit);
      if (error) rejectOpen(error);
      else resolveOpen();
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(code === 0
      ? null
      : new Error(`the default browser command exited ${code ?? 'without a status'}`));
    child.on('error', onError);
    child.once('exit', onExit);
    child.once('close', () => child.removeListener('error', onError));
    if (timeoutMs > 0) {
      timer = setTimer(async () => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        child.removeListener('exit', onExit);
        const cleanup = await stopBrowserHelper(child, { setTimer, clearTimer });
        rejectOpen(new Error(
          'The default browser command did not finish in time.'
          + (cleanup ? ` ${cleanup}` : '')
          + ' The browser may still open later.',
        ));
      }, timeoutMs);
    }
  });
}

function stopBrowserHelper(child, { setTimer, clearTimer }) {
  if (child.exitCode !== null) return Promise.resolve('');
  return new Promise((resolveStop) => {
    let settled = false;
    let timer = null;
    const finish = (detail = '') => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimer(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      if (detail) child.unref();
      resolveStop(detail);
    };
    const onExit = () => finish();
    const onError = (error) => finish(`Browser-command cleanup could not be confirmed: ${error.message}`);
    child.once('exit', onExit);
    child.once('error', onError);
    timer = setTimer(() => finish('Browser-command cleanup could not be confirmed.'), 2000);
    try {
      if (!child.kill()) finish('Browser-command cleanup could not be confirmed.');
    } catch (error) {
      onError(error);
    }
  });
}

async function stopOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolveStop) => {
    const timer = setTimeout(resolveStop, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

export async function coordinateLaunch({
  root = ROOT,
  server = join(root, 'server.mjs'),
  exists = existsSync,
  generation = readPackageGeneration(root),
  probe = (expected) => probeServer(expected),
  startServer = () => spawnServer(server, { root }),
  openBrowser = () => openDefaultBrowser(),
  portOccupied = () => isPortOccupied(),
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  now = Date.now,
  readyTimeoutMs = READY_TIMEOUT_MS,
} = {}) {
  if (!exists(server)) {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Recap Page could not find its packaged server.',
        'Reinstall the app, then start it again.',
      ],
    };
  }
  if (!generation) {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Recap Page could not read its packaged generation.',
        'Reinstall the app, then start it again.',
      ],
    };
  }

  const settleVerification = async (candidate, deadline) => {
    let settled = candidate;
    while (settled.status === 'verifying' && now() < deadline) {
      await sleep(100);
      settled = await probe(generation);
    }
    return settled;
  };
  const classifyOccupied = async (
    candidate,
    deadline = now() + readyTimeoutMs,
  ) => {
    if (candidate.status !== 'unreachable' || !await portOccupied()) return candidate;
    let refreshed = await probe(generation);
    refreshed = await settleVerification(refreshed, deadline);
    if (refreshed.status === 'unreachable' && await portOccupied()) {
      return { status: 'foreign' };
    }
    return refreshed;
  };

  const initialDeadline = now() + readyTimeoutMs;
  let state = await settleVerification(await probe(generation), initialDeadline);
  let child = null;
  let childExited = false;
  let childExitCode = null;
  let childError = null;

  if (state.status === 'verifying') {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Recap Page answered, but Windows could not verify its server process.',
        'Try starting Recap Page again. If this continues, restart Windows.',
        ...verificationDiagnosticLines(state.diagnostic),
      ],
    };
  }
  state = await classifyOccupied(state);

  if (state.status === 'unreachable') {
    try {
      child = startServer();
    } catch (error) {
      childError = error;
    }
    if (child) {
      child.once('error', (error) => {
        childError = error;
      });
      child.once('exit', (code) => {
        childExited = true;
        childExitCode = code;
      });
      child.unref();

      const deadline = now() + readyTimeoutMs;
      while (now() < deadline) {
        state = await probe(generation);
        if (state.status === 'verifying' && state.processId === child.pid) {
          state = { status: 'ready', processId: child.pid };
        } else {
          state = await settleVerification(state, deadline);
        }
        if (state.status !== 'unreachable') break;
        if (childError || childExited) {
          // One final probe lets a concurrent activation win the port before this child exits.
          state = await classifyOccupied(await probe(generation), deadline);
          break;
        }
        await sleep(100);
      }
      if (state.status === 'unreachable') {
        state = await classifyOccupied(await probe(generation), deadline);
      }
      if (state.status === 'unreachable' && !childError && !childExited) {
        await stopOwnedChild(child);
        state = { status: 'timeout' };
      }
    }
  }

  if (state.status === 'ready') {
    try {
      await openBrowser();
      return {
        status: LAUNCH_RESULT.OPENED,
        generation,
        serverProcessId: child?.pid ?? null,
      };
    } catch (error) {
      return {
        status: LAUNCH_RESULT.FAILED,
        retainServer: true,
        lines: [
          'Recap Page is running, but its default browser could not be opened.',
          error.message,
          `Open ${ORIGIN}/ in your browser.`,
        ],
      };
    }
  }

  if (child && state.status !== 'timeout') await stopOwnedChild(child);
  if (state.status === 'verifying') {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Recap Page answered, but Windows could not verify its server process.',
        'Try starting Recap Page again. If this continues, restart Windows.',
        ...verificationDiagnosticLines(state.diagnostic),
      ],
    };
  }
  if (state.status === 'stale') {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Port 8787 is serving a different build of Recap Page.',
        'End the older Recap Page process in Task Manager, or restart Windows, then start it again.',
      ],
    };
  }
  if (state.status === 'foreign') {
    return {
      status: LAUNCH_RESULT.FAILED,
      lines: [
        'Port 8787 is already in use.',
        'It is not running this version of Recap Page.',
        'Close that program, then start Recap Page again.',
        'Do not start Recap Page on a different port. Your reading progress is stored at',
        `${ORIGIN}/ and another port opens a separate browser storage location.`,
        ...verificationDiagnosticLines(state.diagnostic),
      ],
    };
  }
  return {
    status: LAUNCH_RESULT.FAILED,
    lines: [
      'Recap Page could not start its packaged server.',
      childError?.message ?? (
        childExited
          ? `The server exited with status ${childExitCode ?? 'unknown'}.`
          : 'The server did not become ready in time.'
      ),
      'Reinstall the app, then start it again.',
    ],
  };
}

export const GUI_STARTUP_ARGUMENT = '--gui-startup-v1';
export const GUI_BODY_LIMIT = 16384;
export const GUI_BROWSER_TIMEOUT_MS = 30000;
const INVALID_GUI_DETAIL = [
  'Recap Page could not confirm startup.',
  'The startup error details were invalid or too large.',
  `If the app is running, open ${ORIGIN}/ in your browser.`,
].join('\n');

export function selectGuiStartup(args) {
  if (!args.some((arg) => arg.startsWith('--gui-startup-'))) return false;
  if (args.length !== 1 || args[0] !== GUI_STARTUP_ARGUMENT) {
    throw new Error('Recap Page received an unsupported startup request. Try starting the app again.');
  }
  return true;
}

function validGuiText(text) {
  if (!text.trim() || text.charCodeAt(0) === 0xfeff) {
    return false;
  }
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) return false;
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return Buffer.byteLength(text, 'utf8') <= GUI_BODY_LIMIT;
}

export function encodeGuiResult(result) {
  let opened = result?.status === LAUNCH_RESULT.OPENED;
  let text = '';
  if (!opened) {
    text = result?.status === LAUNCH_RESULT.FAILED
      && Array.isArray(result.lines) && result.lines.every((line) => typeof line === 'string')
      ? result.lines.join('\n').replace(/\r\n?/g, '\n')
      : INVALID_GUI_DETAIL;
    if (!validGuiText(text)) text = INVALID_GUI_DETAIL;
  } else if (Object.hasOwn(result, 'lines')) {
    opened = false;
    text = INVALID_GUI_DETAIL;
  }
  const body = Buffer.from(text, 'utf8');
  const frame = Buffer.alloc(12 + body.length);
  frame.write('RCPG', 0, 'ascii');
  frame[4] = 1;
  frame[5] = opened ? 0 : 1;
  frame.writeUInt32LE(body.length, 8);
  body.copy(frame, 12);
  return { frame, exitCode: opened ? 0 : 1 };
}

export function writeGuiFrame(stream, frame) {
  return new Promise((resolveWrite, rejectWrite) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      // A Writable can emit its error after invoking the failed write callback.
      if (!error) stream.removeListener('error', onError);
      if (error) rejectWrite(error);
      else resolveWrite();
    };
    const onError = (error) => finish(error);
    stream.once('error', onError);
    try {
      stream.write(frame, finish);
    } catch (error) {
      stream.removeListener('error', onError);
      finish(error);
    }
  });
}

export async function presentLaunch({
  args = process.argv.slice(2),
  coordinate = coordinateLaunch,
  output = process.stdout,
  errorOutput = process.stderr,
  environment = process.env,
  architecture = process.arch,
  consoleFail = fail,
  setExitCode = (code) => { process.exitCode = code; },
  openBrowser = () => openDefaultBrowser(`${ORIGIN}/`, { timeoutMs: GUI_BROWSER_TIMEOUT_MS }),
} = {}) {
  let gui;
  let requestError;
  try {
    gui = selectGuiStartup(args);
  } catch (error) {
    gui = true;
    requestError = error;
  }
  if (!gui) {
    if (environment.MRT_PACKAGE_ARCH_PROBE === '1') output.write(`launcher=${architecture}\n`);
    const result = await coordinate();
    if (result.status === LAUNCH_RESULT.FAILED) consoleFail(result.lines);
    return;
  }

  let encoded;
  try {
    const result = requestError
      ? { status: LAUNCH_RESULT.FAILED, lines: [requestError.message] }
      : await coordinate({ openBrowser });
    encoded = encodeGuiResult(result);
  } catch (error) {
    encoded = encodeGuiResult({
      status: LAUNCH_RESULT.FAILED,
      lines: ['Recap Page could not confirm startup.', String(error?.message ?? error)],
    });
  }
  try {
    await writeGuiFrame(output, encoded.frame);
    setExitCode(encoded.exitCode);
  } catch (error) {
    setExitCode(1);
    const detail = String(error?.message ?? error);
    await writeGuiFrame(errorOutput, Buffer.from(
      `Recap Page could not write its startup result: ${detail.slice(0, 2048)}`
      + `${detail.length > 2048 ? ' (additional diagnostic text omitted)' : ''}\n`,
      'utf8',
    ));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await presentLaunch();
}

export {
  ORIGIN, PROBE_TIMEOUT_MS, READY_TIMEOUT_MS, SERVER_GENERATION_HEADER,
  SERVER_IDENTITY, SERVER_IDENTITY_HEADER,
};
