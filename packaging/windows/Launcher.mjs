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
    const ownership = await verifyProcess(processId);
    if (ownership === true) return { status: 'ready', processId };
    if (ownership === false) return { status: 'foreign' };
    return { status: 'verifying', processId };
  } finally {
    clearTimeout(timer);
  }
}

export function verifyServerProcess(
  processId,
  {
    executable = process.execPath,
    server = join(ROOT, 'server.mjs'),
    execFile = execFileSync,
  } = {},
) {
  const script = [
    `$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq ${processId} | Select-Object -First 1`,
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}" -ErrorAction SilentlyContinue`,
    'if ($connection -and $process) {',
    '  $process | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    '}',
  ].join('; ');
  try {
    const raw = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      },
    ).trim();
    if (!raw) return false;
    const candidate = JSON.parse(raw);
    return candidate.ExecutablePath?.toLowerCase() === executable.toLowerCase()
      && candidate.CommandLine?.toLowerCase().includes(server.toLowerCase());
  } catch {
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
