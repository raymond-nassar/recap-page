// Starting Recap Page at sign-in, for the Microsoft Store package only (#1412, decisions 13 and 14). The
// package declares its startup task disabled, so nothing starts at sign-in until the reader answers the
// app's own question with Turn on. Windows shows no consent dialog of its own when a packaged desktop app
// asks to enable its task, so that question is the only consent there is, and this module is built so the
// task can be enabled through nothing else.
//
// It changes operating-system state on behalf of a web page, so it is a security boundary. Nothing a
// request sends reaches the launcher: the two commands below are fixed tokens the native launcher matches
// exactly, and the launcher itself refuses to act on DisabledByUser or DisabledByPolicy. A request must
// name this server, come from this origin as a same-origin fetch carrying the API header, come from a
// process in this Windows session, and present a consent value this module issued, once, to a state read
// that found the task Disabled and so able to show the question. Refusals carry codes and no reader-facing
// text, because the page never shows them.

import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createSessionCheck } from './cloudSession.mjs';

export const STARTUP_API_PREFIX = '/__recap_startup__/v1/';
export const STARTUP_API_HEADER = 'x-recap-startup';
// The StartupTaskState values in their enumeration order, which is how the launcher's exit code says them.
export const STARTUP_STATES = Object.freeze(['disabled', 'disabledByUser', 'enabled', 'disabledByPolicy', 'enabledByPolicy']);
export const STATE_TOKEN = '--recap-startup-state-v1';
export const ENABLE_TOKEN = '--recap-startup-enable-v1';
// The launcher gives up on Windows after 15 seconds and exits with its own code, so this only catches a
// launcher that never exits at all.
export const LAUNCHER_MS = 20_000;
// Long enough for a reader to read the question and decide, short enough that a value read from an old
// page cannot enable the task much later.
export const CONSENT_MS = 15 * 60_000;
const CONSENT = /^[0-9a-f]{64}$/;
const JSON_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
const BODY_LIMIT = 256;
export const BODY_MS = 5_000;

// The exit code as a state, or 'unavailable' for anything the launcher could not answer: no package
// identity (10), Windows did not answer in time (12), any other failure (13), or a launcher that could not
// be started or was stopped.
export function stateFromExit(code) {
  return Number.isInteger(code) && code >= 0 && code < STARTUP_STATES.length ? STARTUP_STATES[code] : 'unavailable';
}

function runLauncher(file, token) {
  return new Promise((resolve) => {
    execFile(file, [token], { windowsHide: true, timeout: LAUNCHER_MS }, (error) => {
      if (!error) resolve(0);
      else resolve(!error.killed && Number.isInteger(error.code) ? error.code : null);
    });
  });
}

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close',
  }).end(JSON.stringify(body));
}

// The body as text, or null when it is larger than any this host accepts, not all here by the deadline,
// or its caller has gone. Only one operation runs at a time, so a caller that stops sending must not be
// able to hold that turn.
function readBody(req, ms) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return Promise.resolve(null);
  if (req.socket?.destroyed) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let timer = null;
    const finish = (value) => {
      clearTimeout(timer);
      req.off('data', take);
      req.off('end', done);
      req.off('error', gone);
      req.off('close', gone);
      resolve(value);
    };
    const take = (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) finish(null);
      else chunks.push(chunk);
    };
    const done = () => finish(Buffer.concat(chunks).toString('utf8'));
    const gone = () => finish(null);
    timer = setTimeout(() => finish(null), ms);
    req.on('data', take);
    req.once('end', done);
    req.once('error', gone);
    req.once('close', gone);
  });
}

function sameConsent(held, offered) {
  if (typeof offered !== 'string' || !CONSENT.test(offered) || !held) return false;
  return timingSafeEqual(Buffer.from(held, 'hex'), Buffer.from(offered, 'hex'));
}

export function createStartupHost({
  launcher,
  run = runLauncher,
  sessionCheck = createSessionCheck(),
  now = Date.now,
  issue = () => randomBytes(32).toString('hex'),
  bodyMs = BODY_MS,
} = {}) {
  if (typeof launcher !== 'string' || launcher === '') throw new TypeError('createStartupHost needs the launcher path');
  let consent = null;
  let busy = false;

  const operations = {
    async state() {
      // A new read replaces any value issued before it, so only the question on screen can be answered.
      consent = null;
      const state = stateFromExit(await run(launcher, STATE_TOKEN));
      if (state !== 'disabled') return { state };
      consent = { value: issue(), expires: now() + CONSENT_MS };
      return { state, consent: consent.value };
    },
    async enable(input) {
      const held = consent;
      // Spent before anything runs, so a value is good for one attempt whatever that attempt does.
      consent = null;
      if (!held || now() > held.expires || !sameConsent(held.value, input.consent)) return null;
      return { state: stateFromExit(await run(launcher, ENABLE_TOKEN)) };
    },
  };

  async function handle(req, res) {
    const target = String(req.url ?? '');
    const operation = target.startsWith(STARTUP_API_PREFIX) ? target.slice(STARTUP_API_PREFIX.length) : '';
    const refuse = (status, code) => {
      req.resume();
      send(res, status, { ok: false, error: { code } });
    };
    const port = req.socket?.localPort;
    if (req.method !== 'POST') return refuse(405, 'method');
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(403, 'host');
    if (req.headers.origin !== `http://127.0.0.1:${port}`) return refuse(403, 'origin');
    // Required, not merely checked when present: every browser that can reach this page sends it to a
    // loopback origin, and its absence is what a request from outside a browser looks like.
    if (req.headers['sec-fetch-site'] !== 'same-origin') return refuse(403, 'site');
    if (req.headers[STARTUP_API_HEADER] !== '1') return refuse(403, 'header');
    if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) return refuse(415, 'type');
    if (!Object.hasOwn(operations, operation)) return refuse(404, 'operation');
    if (!(await sessionCheck(req.socket))) return refuse(403, 'session');
    if (busy) return refuse(429, 'busy');
    busy = true;
    try {
      const text = await readBody(req, bodyMs);
      if (text === null) {
        res.once('finish', () => req.socket?.destroy());
        return refuse(400, 'body');
      }
      let input;
      try { input = text === '' ? {} : JSON.parse(text); } catch { return refuse(400, 'json'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse(400, 'json');
      const result = await operations[operation](input);
      if (result === null) return refuse(403, 'consent');
      send(res, 200, { ok: true, ...result });
    } finally {
      busy = false;
    }
    return undefined;
  }

  return { handle };
}
