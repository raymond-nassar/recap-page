// Sign-in plumbing every provider shares: the PKCE, state and nonce values, the one-shot loopback listener
// the provider's redirect returns to, the launch of the person's default browser, and bounded reads of
// provider responses.
//
// The redirect never touches the app's origin (P02-T01 section 3.7). The installed Edge app's scope and the
// service worker's both cover http://127.0.0.1:8787/, and current Edge opens an in-scope link in the
// installed app window whenever link handling is on, which it is by default. A listener on a port of its
// own is another origin, so the callback lands in an ordinary tab with link handling on or off, and the
// worker never sees the authorization code.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { systemDirectory } from './cloudSession.mjs';

export const SIGN_IN_MS = 5 * 60_000;
const CALLBACK_HEADERS = Object.freeze({
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
});
const MAX_STRAY_CALLBACKS = 32;
const MAX_WAIT_MS = 60 * 60_000;

// One kind of failure for everything a provider or a sign-in can do, carrying the code the page and the
// coordinator act on: 'needs-sign-in' and 'refused' stop backups, anything else is retried.
export class ProviderError extends Error {
  constructor(code, message, { retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function newAuthorization(random = randomBytes) {
  const secret = () => Buffer.from(random(32)).toString('base64url');
  const verifier = secret();
  return Object.freeze({
    state: secret(), nonce: secret(), verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
}

function sameSecret(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// On Windows the URL goes to the shell's protocol handler, the person's default browser, without passing
// through cmd. The launcher's cmd /c start cannot carry it: measured 2026-10-28, cmd cut a URL at its first
// ampersand and then tried to run the rest as a command, which would drop the state and every parameter
// after it.
export function browserLaunch(url, { platform = process.platform, system = systemDirectory() } = {}) {
  if (platform === 'win32') return { command: join(system, 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

export function openBrowser(url, { spawnImpl = spawn, platform = process.platform, system } = {}) {
  const { command, args } = browserLaunch(url, { platform, system });
  const failed = () => new ProviderError('failed', 'The browser could not be opened for sign-in.');
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(command, args, { detached: true, stdio: 'ignore' }); }
    catch { reject(failed()); return; }
    child.once('error', () => reject(failed()));
    child.once('spawn', () => {
      child.unref?.();
      resolve();
    });
  });
}

function listen(server, port, address) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off('listening', ready);
      reject(error);
    };
    const ready = () => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, address);
  });
}

// One sign-in's redirect target: http://localhost:<port>/ for five minutes at most, answering the first
// request that carries this sign-in's state and nothing after it. "localhost" because Microsoft ignores the
// port only for that host name (its reply URL rules, retrieved 2026-10-28), so one registered entry serves
// every port the operating system hands out. The same port is held on IPv6 loopback too, because a browser
// can try ::1 first for localhost, and another program listening there would otherwise receive the code.
//
// Resolves to { redirectUri, result, close }, where result settles to { code } or { error }.
export async function startCallback({
  authorization, timeoutMs = SIGN_IN_MS, host = 'localhost', createServerImpl = createServer,
} = {}) {
  let port = null;
  let claimed = false;
  let finished = false;
  let stray = 0;
  let timer = null;
  let settle;
  const result = new Promise((resolve) => { settle = resolve; });
  const servers = [];
  const finish = (outcome) => {
    if (finished) return;
    finished = true;
    claimed = true;
    clearTimeout(timer);
    for (const server of servers) {
      server.close();
      server.closeIdleConnections?.();
    }
    settle(outcome);
  };
  const handle = (req, res) => {
    const respond = (status, text, then) => {
      res.writeHead(status, CALLBACK_HEADERS);
      if (then) {
        // A browser that closes the tab before the answer is written must not strand a sign-in whose
        // code has already been taken.
        res.once('close', then);
        res.end(text, then);
      } else {
        res.end(text);
      }
    };
    if (claimed) { respond(410, 'This sign-in has already finished. Return to Recap Page.'); return; }
    const target = String(req.url ?? '');
    const mark = target.indexOf('?');
    const path = mark < 0 ? target : target.slice(0, mark);
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      respond(405, 'Only a sign-in is accepted here.');
      return;
    }
    if (path === '/favicon.ico') { respond(404, 'Not found.'); return; }
    const params = new URLSearchParams(mark < 0 ? '' : target.slice(mark + 1));
    if (req.headers.host !== `${host}:${port}` || req.headers.origin !== undefined || path !== '/'
      || !sameSecret(params.get('state'), authorization.state)) {
      stray += 1;
      if (stray > MAX_STRAY_CALLBACKS) finish({ error: 'invalid' });
      respond(400, 'This is not a sign-in Recap Page is waiting for.');
      return;
    }
    claimed = true;
    const code = params.get('code');
    const error = params.get('error');
    if (error || !code) {
      respond(200, 'The sign-in was not completed. Return to Recap Page to try again.',
        () => finish({ error: error === 'access_denied' ? 'declined' : 'refused' }));
      return;
    }
    respond(200, 'Recap Page received the sign-in. You can close this tab and return to Recap Page.', () => finish({ code }));
  };
  for (let attempt = 0; attempt < 3 && port === null; attempt += 1) {
    const ipv4 = createServerImpl({ maxHeaderSize: 16 * 1024 }, handle);
    try { await listen(ipv4, 0, '127.0.0.1'); }
    catch { throw new ProviderError('failed', 'The sign-in could not start listening for its answer.'); }
    const candidate = ipv4.address().port;
    const ipv6 = createServerImpl({ maxHeaderSize: 16 * 1024 }, handle);
    try {
      await listen(ipv6, candidate, '::1');
      servers.push(ipv4, ipv6);
      port = candidate;
    } catch (error) {
      if (error?.code === 'EADDRINUSE') {
        ipv4.close();
        continue;
      }
      // No IPv6 loopback on this computer, so no browser will try it either.
      servers.push(ipv4);
      port = candidate;
    }
  }
  if (port === null) throw new ProviderError('failed', 'The sign-in could not find a free port to listen on.');
  for (const server of servers) {
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 1_000;
    server.on('error', () => finish({ error: 'failed' }));
  }
  timer = setTimeout(() => finish({ error: 'expired' }), timeoutMs);
  return { redirectUri: `http://${host}:${port}/`, result, close: () => finish({ error: 'cancelled' }) };
}

// A capability URL a provider handed back, an upload session or a download. It must be https to an
// ordinary host name; it is never checked against a list of hosts, because the list the stopped session
// used refused the host OneDrive actually returned, my.microsoftpersonalcontent.com, on 2026-10-22.
export function capabilityUrl(text) {
  let url;
  try { url = new URL(String(text)); }
  catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')
    || !host.includes('.') || host.endsWith('.') || host.startsWith('[') || /^[\d.]+$/.test(host)
    || host === 'localhost' || host.endsWith('.localhost')) return null;
  return url;
}

// At most `limit` bytes of a response body, or null when it is longer, so neither a provider nor anything
// between can make the host hold more than a backup can be.
export async function readBounded(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await discard(response);
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJson(response, limit = 1024 * 1024) {
  const bytes = await readBounded(response, limit).catch(() => null);
  if (!bytes) return null;
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { return null; }
}

export async function discard(response) {
  try { await response.body?.cancel(); } catch { /* nothing left to read */ }
}

// Seconds or an HTTP date, as the providers send it, held to an hour.
export function retryAfterMs(response, now = Date.now()) {
  const value = String(response.headers.get('retry-after') ?? '').trim();
  if (!value) return 0;
  const wait = /^\d{1,7}$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(wait) ? Math.min(Math.max(0, Math.round(wait)), MAX_WAIT_MS) : 0;
}

export function networkFailure(error, what) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    ? new ProviderError('timeout', `${what} did not answer in time.`)
    : new ProviderError('transient', `${what} could not be reached.`);
}
