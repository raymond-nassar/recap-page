// The Windows host behind cloud backup (#810, P02-T04): its configuration, the session check, the token
// store and its PowerShell protection, sign-in, the OneDrive primitives and the control API, and the
// page's transport that speaks to it (P02-T05). Providers are fakes: a fetch that answers as Microsoft's
// endpoints do, and processes that answer as netstat, tasklist and PowerShell do, in English and in
// German. One case runs the real Windows PowerShell on Windows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { CLOUD_CLIENT_FORMAT, parseCloudClient } from '../host/cloudConfig.mjs';
import { callerProcess, createSessionCheck, processSession } from '../host/cloudSession.mjs';
import { CloudTokenError, PROTECT_SCRIPT, createProtector, createTokenStore, protectCommand, validRecord } from '../host/cloudTokens.mjs';
import {
  ProviderError, browserLaunch, capabilityUrl, newAuthorization, openBrowser, retryAfterMs, startCallback,
} from '../host/cloudSignIn.mjs';
import {
  GRAPH, MICROSOFT_LOGIN, authorizationUrl, createOneDrive, idTokenClaims, redeemCode, refreshTokens,
} from '../host/oneDrive.mjs';
import { CLOUD_API_HEADER, CLOUD_API_PREFIX, HOST_DEADLINES_MS, createCloudHost } from '../host/cloudHost.mjs';
import { CloudBackupError, CLOUD_TRANSPORT_DEADLINES_MS } from '../src/js/lib/cloudProtocol.js';
import { CLOUD_HOST_HEADER, CLOUD_HOST_PREFIX, createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';
import { createStaticServer } from '../server.mjs';

// Never a real registration, and never shaped like a GUID, which the publication gate would report.
const CLIENT = 'test-client.recap-page';
const CLIENT_TEXT = JSON.stringify({ format: CLOUD_CLIENT_FORMAT, version: 1, providers: { onedrive: { clientId: CLIENT, authority: 'consumers' } } });
const SYSTEM = 'C:\\Windows\\System32';
const UPLOAD = 'https://my.microsoftpersonalcontent.com/personal/upload/session-one';
const DOWNLOAD = 'https://public.ch.files.1drv.com/download/item-one';
const NAME = `recap-page-backup-v1-${'a'.repeat(32)}-7.json.gz`;

const settle = () => new Promise((resolve) => { setImmediate(resolve); });
// Bounded by time rather than by event-loop turns: sockets, PowerShell stand-ins, hashing and compression
// all finish on their own schedule, and on a loaded machine they can outlast any fixed number of turns.
async function until(check, message, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await settle();
  }
  assert.fail(message);
}

function json(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.signature`;
}

// Microsoft's endpoints in memory. A route matches on method and URL, and answers with a Response, an
// Error to throw as a network failure, or a function of the request. Every call is kept, with whether it
// carried an Authorization header.
function fakeFetch(routes = []) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    const call = { method, url: String(url), authorization: headers.get('authorization'), range: headers.get('content-range'), body, redirect: options.redirect };
    calls.push(call);
    const route = routes.find((entry) => entry.method === method
      && (typeof entry.url === 'string' ? entry.url === call.url : entry.url.test(call.url)));
    if (!route) return json(418, { error: 'unrouted' });
    const answer = typeof route.reply === 'function' ? await route.reply(call) : route.reply;
    if (answer instanceof Error) throw answer;
    return answer;
  }
  return { fetchImpl, calls, routes };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// ------------------------------------------------------------------ configuration

test('a client configuration is accepted only in the exact shape this version writes', () => {
  const valid = parseCloudClient(CLIENT_TEXT);
  assert.deepEqual(valid.providers.onedrive, { clientId: CLIENT, authority: 'consumers' });
  assert.ok(Object.isFrozen(valid) && Object.isFrozen(valid.providers.onedrive));
  assert.deepEqual(parseCloudClient(`\uFEFF${CLIENT_TEXT}`), valid, 'a byte order mark from a Windows editor is tolerated');
  const base = JSON.parse(CLIENT_TEXT);
  const variants = [
    { ...base, extra: true }, { ...base, format: 'other' }, { ...base, version: 2 },
    { ...base, providers: {} }, { ...base, providers: { ...base.providers, googledrive: { clientId: CLIENT } } },
    { ...base, providers: { onedrive: { clientId: CLIENT, authority: 'common' } } },
    { ...base, providers: { onedrive: { clientId: CLIENT } } },
    { ...base, providers: { onedrive: { clientId: 'has space', authority: 'consumers' } } },
    { ...base, providers: { onedrive: { clientId: '', authority: 'consumers' } } },
  ];
  for (const variant of variants) assert.throws(() => parseCloudClient(JSON.stringify(variant)), { code: 'invalid-config' }, JSON.stringify(variant));
  assert.throws(() => parseCloudClient('not json'), { code: 'invalid-config' });
  assert.throws(() => parseCloudClient(CLIENT_TEXT + ' '.repeat(5000)), { code: 'invalid-config' });
  assert.throws(() => parseCloudClient(null), { code: 'invalid-config' });
});

// ------------------------------------------------------------------ the session check

const NETSTAT_ENGLISH = [
  '', 'Active Connections', '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1144',
  '  TCP    127.0.0.1:8787         0.0.0.0:0              LISTENING       4100',
  '  TCP    127.0.0.1:8787         127.0.0.1:52017        ESTABLISHED     4100',
  '  TCP    127.0.0.1:52017        127.0.0.1:8787         ESTABLISHED     7310',
  '  TCP    127.0.0.1:52018        127.0.0.1:8787         TIME_WAIT       0',
  '  TCP    [::1]:52019            [::1]:8787             ESTABLISHED     9999',
].join('\r\n');
// The same table as a German Windows prints it: headings and states are words, the numbers are not.
const NETSTAT_GERMAN = [
  '', 'Aktive Verbindungen', '',
  '  Proto  Lokale Adresse         Remoteadresse          Status           PID',
  '  TCP    127.0.0.1:8787         0.0.0.0:0              ABH\u00d6REN         4100',
  '  TCP    127.0.0.1:8787         127.0.0.1:52017        HERGESTELLT      4100',
  '  TCP    127.0.0.1:52017        127.0.0.1:8787         HERGESTELLT      7310',
].join('\r\n');
const TASKLIST_ENGLISH = '"msedge.exe","7310","Console","1","212,344 K"\r\n';
const TASKLIST_GERMAN = '"msedge.exe","7310","Konsole","1","212.344 K"\r\n';

test('the session check reads only the numbers netstat and tasklist print, in English or German', () => {
  for (const table of [NETSTAT_ENGLISH, NETSTAT_GERMAN]) {
    assert.equal(callerProcess(table, { callerPort: 52017, serverPort: 8787 }), 7310);
    assert.equal(callerProcess(table, { callerPort: 8787, serverPort: 52017 }), 4100, 'the server end is a different row');
  }
  assert.equal(callerProcess(NETSTAT_ENGLISH, { callerPort: 52018, serverPort: 8787 }), null, 'a closed connection names no process');
  assert.equal(callerProcess(NETSTAT_ENGLISH, { callerPort: 52019, serverPort: 8787 }), null, 'only IPv4 loopback is served');
  assert.equal(callerProcess(NETSTAT_ENGLISH, { callerPort: 40000, serverPort: 8787 }), null);
  const twice = `${NETSTAT_ENGLISH}\r\n  TCP    127.0.0.1:52017        127.0.0.1:8787         ESTABLISHED     8000`;
  assert.equal(callerProcess(twice, { callerPort: 52017, serverPort: 8787 }), null, 'two processes for one port is no answer');

  for (const rows of [TASKLIST_ENGLISH, TASKLIST_GERMAN]) assert.equal(processSession(rows, 7310), 1);
  assert.equal(processSession('"odd, ""name"".exe","7310","Services","0","1,024 K"', 7310), 0, 'a comma or quote in an image name is still read');
  assert.equal(processSession('INFO: No tasks are running which match the specified criteria.\r\n', 7310), null);
  assert.equal(processSession('INFORMATION: Es werden keine Aufgaben ausgef\u00fchrt.\r\n', 7310), null);
  assert.equal(processSession(TASKLIST_ENGLISH, 7311), null, 'the row must be the process asked about');
});

function sessionRunner({ callerSession, ownSession = 1, table = NETSTAT_GERMAN, ownPid = 4100 }) {
  const calls = [];
  async function run(file, args) {
    calls.push([file, ...args]);
    if (file.endsWith('netstat.exe')) return table;
    const pid = Number(args[1].split(' ').at(-1));
    const session = pid === ownPid ? ownSession : callerSession;
    return session === null ? 'INFO: No tasks are running which match the specified criteria.\r\n'
      : `"process.exe","${pid}","Console","${session}","1.000 K"\r\n`;
  }
  return { run, calls, ownPid };
}

test('a caller in another Windows session is refused, the same session is allowed, and a verdict lasts the connection', async () => {
  const socket = (callerPort = 52017) => ({ remoteAddress: '127.0.0.1', remotePort: callerPort, localPort: 8787 });
  const other = sessionRunner({ callerSession: 2 });
  const check = createSessionCheck({ platform: 'win32', run: other.run, ownPid: other.ownPid, system: SYSTEM });
  assert.equal(await check(socket()), false, 'another person\'s browser through fast user switching');
  const same = sessionRunner({ callerSession: 1 });
  const allowed = createSessionCheck({ platform: 'win32', run: same.run, ownPid: same.ownPid, system: SYSTEM });
  const connection = socket();
  assert.equal(await allowed(connection), true);
  assert.equal(await allowed(connection), true);
  assert.equal(same.calls.filter(([file]) => file.endsWith('netstat.exe')).length, 1, 'once per connection');
  assert.deepEqual(same.calls[0], [join(SYSTEM, 'tasklist.exe'), '/FI', 'PID eq 4100', '/FO', 'CSV', '/NH']);
  assert.deepEqual(same.calls[1], [join(SYSTEM, 'netstat.exe'), '-ano', '-p', 'TCP']);

  const gone = sessionRunner({ callerSession: null });
  assert.equal(await createSessionCheck({ platform: 'win32', run: gone.run, ownPid: gone.ownPid, system: SYSTEM })(socket()), false);
  assert.equal(await allowed({ ...socket(40000) }), false, 'a port netstat does not show');
  assert.equal(await allowed({ remoteAddress: '::1', remotePort: 52017, localPort: 8787 }), false);
  const broken = createSessionCheck({ platform: 'win32', run: async () => { throw new Error('netstat failed'); }, ownPid: 4100, system: SYSTEM });
  assert.equal(await broken(socket()), false, 'a check that cannot run refuses');
  let ran = 0;
  const elsewhere = createSessionCheck({ platform: 'linux', run: async () => { ran += 1; return ''; } });
  assert.equal(await elsewhere(socket()), false);
  assert.equal(ran, 0, 'there is no session answer to ask for off Windows');
});

// ------------------------------------------------------------------ the token store

// PowerShell as the protector drives it: a child whose stdin is collected and whose answer is decided
// from it. The fake "protection" reverses the bytes, which is enough to tell sealed from plain.
function fakePowerShell(answer = ({ data }) => ({ code: 0, out: Buffer.from(data).reverse().toString('base64') })) {
  const runs = [];
  function spawnImpl(command, args, options) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    const input = [];
    child.stdin.on('data', (chunk) => input.push(chunk));
    child.stdin.on('end', () => {
      const text = Buffer.concat(input).toString('latin1');
      const [mode, encoded = ''] = text.split('\n');
      const run = { command, args, options, mode, input: text, data: Buffer.from(encoded, 'base64') };
      runs.push(run);
      const outcome = answer(run);
      if (outcome === 'hang') return;
      setImmediate(() => {
        if (outcome.out) child.stdout.write(outcome.out);
        child.stdout.end();
        child.emit('close', outcome.code);
      });
    });
    return child;
  }
  return { spawnImpl, runs };
}

const RECORD = Object.freeze({
  version: 1, provider: 'onedrive', connection: 'c'.repeat(32), account: { id: 'drive:drive-one', hint: 'reader@example.test' },
  folder: 'APP!1', refreshToken: 'refresh-token-never-in-plain-text', savedAt: 1_800_000_000_000,
});

test('the token store protects through a fixed PowerShell script, with the bytes on standard input only', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-cloud-tokens-'));
  try {
    const shell = fakePowerShell();
    const store = createTokenStore({ directory, protector: createProtector({ platform: 'win32', spawnImpl: shell.spawnImpl, system: SYSTEM }) });
    assert.equal(await store.exists(), false);
    assert.equal(await store.load(), null);
    assert.equal(shell.runs.length, 0, 'nothing stored, so PowerShell never starts');
    await store.probe();
    assert.deepEqual([shell.runs.length, shell.runs[0].mode, readdirSync(directory)], [1, 'protect', []], 'the probe protects a fixed value and writes nothing');
    shell.runs.length = 0;
    await store.save(RECORD);
    const [protect] = shell.runs;
    const { command, args } = protectCommand(SYSTEM);
    assert.equal(protect.command, join(SYSTEM, 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.deepEqual(protect.args, args);
    assert.equal(command, protect.command);
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), PROTECT_SCRIPT, 'the argument is the fixed script and nothing else');
    assert.ok(!args.join(' ').includes(RECORD.refreshToken), 'no token in any argument');
    assert.equal(protect.mode, 'protect');
    assert.deepEqual(JSON.parse(protect.data.toString('utf8')), RECORD, 'the record travels on standard input');
    assert.deepEqual(readdirSync(directory), ['onedrive.v1']);
    const sealed = readFileSync(join(directory, 'onedrive.v1'));
    assert.ok(!sealed.includes(Buffer.from(RECORD.refreshToken)), 'never plain text on disk');
    assert.equal(await store.exists(), true);
    assert.deepEqual(await store.load(), RECORD);
    assert.equal(shell.runs.at(-1).mode, 'unprotect');
    await store.clear();
    assert.equal(await store.exists(), false);
    assert.deepEqual(readdirSync(directory), []);
    await assert.rejects(store.save({ ...RECORD, connection: 'not hex' }), { code: 'invalid' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restricted PowerShell, an unreadable blob, a hung PowerShell and a non-Windows host refuse, and nothing is written', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-cloud-tokens-'));
  try {
    for (const [outcome, code] of [[{ code: 3 }, 'language'], [{ code: 4 }, 'unreadable'], [{ code: 1 }, 'failed'], [{ code: 0, out: 'not base64!' }, 'failed']]) {
      const shell = fakePowerShell(() => outcome);
      const store = createTokenStore({ directory, protector: createProtector({ platform: 'win32', spawnImpl: shell.spawnImpl, system: SYSTEM }) });
      await assert.rejects(store.save(RECORD), { code }, code);
      await assert.rejects(store.probe(), { code }, `${code}: the probe meets it too`);
      assert.deepEqual(readdirSync(directory), [], `${code}: nothing written`);
    }
    await assert.rejects(createTokenStore({ directory: null, protector: createProtector({ platform: 'win32' }) }).probe(), { code: 'location' },
      'no private folder to keep a sign-in in, which is not a matter of the platform');
    const hung = fakePowerShell(() => 'hang');
    let killed = null;
    const spawnImpl = (...args) => {
      const child = hung.spawnImpl(...args);
      killed = child;
      return child;
    };
    const slow = createProtector({ platform: 'win32', spawnImpl, system: SYSTEM, timeoutMs: 30 });
    await assert.rejects(slow.protect(Buffer.from('x')), { code: 'timeout' });
    assert.equal(killed.killed, true, 'a PowerShell that does not answer is stopped');
    let spawned = 0;
    const off = createProtector({ platform: 'linux', spawnImpl: () => { spawned += 1; } });
    await assert.rejects(off.protect(Buffer.from('x')), { code: 'platform' });
    assert.equal(spawned, 0);
    const error = new CloudTokenError('language');
    assert.match(error.message, /restricting PowerShell/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('on Windows the fixed script protects and unprotects through the real Windows PowerShell', { skip: process.platform !== 'win32' }, async () => {
  const protector = createProtector();
  const plain = Buffer.from(JSON.stringify(RECORD));
  const sealed = await protector.protect(plain);
  assert.ok(sealed.length > plain.length && !sealed.includes(Buffer.from(RECORD.refreshToken)));
  assert.deepEqual(await protector.unprotect(sealed), plain);
  await assert.rejects(protector.unprotect(Buffer.from('not a protected blob')), { code: 'unreadable' });
});

// ------------------------------------------------------------------ sign-in

test('the authorization request carries PKCE, state, nonce and the app-folder scope, and the browser receives the whole URL', async () => {
  let counter = 0;
  const random = (size) => Buffer.alloc(size, ++counter);
  const authorization = newAuthorization(random);
  assert.equal(authorization.challenge, createHash('sha256').update(authorization.verifier).digest('base64url'));
  assert.notEqual(authorization.state, authorization.nonce);
  const url = new URL(authorizationUrl({ clientId: CLIENT, redirectUri: 'http://localhost:51234/', authorization }));
  assert.equal(`${url.origin}${url.pathname}`, `${MICROSOFT_LOGIN}/authorize`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: CLIENT, response_type: 'code', redirect_uri: 'http://localhost:51234/', response_mode: 'query',
    scope: 'openid profile offline_access Files.ReadWrite.AppFolder', state: authorization.state, nonce: authorization.nonce,
    code_challenge: authorization.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  assert.ok(!url.href.includes('+'), 'spaces are encoded the way every endpoint reads them');

  const launch = browserLaunch(url.href, { platform: 'win32', system: SYSTEM });
  assert.deepEqual(launch, { command: join(SYSTEM, 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url.href] });
  assert.ok(url.href.includes('&state=') && !/cmd/i.test(launch.command), 'the ampersands reach the browser, never cmd');
  const spawned = [];
  await openBrowser(url.href, {
    platform: 'win32', system: SYSTEM,
    spawnImpl: (command, args, options) => {
      spawned.push({ command, args, options });
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  });
  assert.deepEqual(spawned[0].args, launch.args);
  assert.equal(spawned[0].options.shell, undefined, 'no shell parses the URL');
  await assert.rejects(openBrowser(url.href, {
    platform: 'win32', system: SYSTEM,
    spawnImpl: () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    },
  }), { code: 'failed' });
});

function callbackRequest(port, path, { method = 'GET', host = `localhost:${port}`, headers = {}, address = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: address, port, path, method, headers: { host, ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the callback answers only this sign-in\'s state, on its own host and path, and only once', async () => {
  const authorization = newAuthorization();
  const callback = await startCallback({ authorization, timeoutMs: 10_000 });
  try {
    const port = Number(new URL(callback.redirectUri).port);
    assert.equal(callback.redirectUri, `http://localhost:${port}/`);
    const good = `/?code=the-code&state=${authorization.state}`;
    assert.equal((await callbackRequest(port, good, { method: 'POST' })).status, 405);
    assert.equal((await callbackRequest(port, good, { host: `127.0.0.1:${port}` })).status, 400, 'the redirect\'s own host only');
    assert.equal((await callbackRequest(port, good, { headers: { origin: 'https://attacker.example' } })).status, 400, 'navigations carry no Origin');
    assert.equal((await callbackRequest(port, `/other${good.slice(1)}`)).status, 400);
    assert.equal((await callbackRequest(port, '/?code=the-code&state=guessed')).status, 400);
    assert.equal((await callbackRequest(port, '/?code=the-code')).status, 400);
    assert.equal((await callbackRequest(port, '/favicon.ico')).status, 404);
    const answered = await callbackRequest(port, good);
    assert.equal(answered.status, 200);
    assert.match(answered.text, /return to Recap Page/);
    assert.equal(answered.headers['cache-control'], 'no-store');
    assert.equal(answered.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
    assert.match(answered.headers['content-type'], /^text\/plain/);
    assert.deepEqual(await callback.result, { code: 'the-code' });
    const again = await callbackRequest(port, good).catch((error) => ({ status: error.code }));
    assert.ok([410, 'ECONNREFUSED', 'ECONNRESET'].includes(again.status), `a code is taken once (${again.status})`);
  } finally {
    callback.close();
  }
});

test('a declined sign-in, an expired one and a cancelled one each end without a code, and the port is held on IPv6 too', async () => {
  const declined = newAuthorization();
  const first = await startCallback({ authorization: declined, timeoutMs: 10_000 });
  const port = Number(new URL(first.redirectUri).port);
  const ipv6 = await callbackRequest(port, '/favicon.ico', { address: '::1' }).catch((error) => ({ status: error.code }));
  assert.ok([404, 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ECONNREFUSED'].includes(ipv6.status), `IPv6 loopback: ${ipv6.status}`);
  if (ipv6.status === 404) assert.ok(true, 'this computer has IPv6 loopback, and the listener holds the same port there');
  const refused = await callbackRequest(port, `/?error=access_denied&error_description=no&state=${declined.state}`);
  assert.equal(refused.status, 200);
  assert.match(refused.text, /not completed/);
  assert.deepEqual(await first.result, { error: 'declined' });
  const expired = await startCallback({ authorization: newAuthorization(), timeoutMs: 20 });
  assert.deepEqual(await expired.result, { error: 'expired' });
  const cancelled = await startCallback({ authorization: newAuthorization(), timeoutMs: 10_000 });
  cancelled.close();
  assert.deepEqual(await cancelled.result, { error: 'cancelled' });
});

test('an id token made for another app, another sign-in or another time is refused', () => {
  const now = 1_800_000_000_000;
  const claims = { aud: CLIENT, nonce: 'n', oid: 'object-one', sub: 'subject-one', exp: now / 1000 + 600, preferred_username: 'reader@example.test' };
  assert.deepEqual(idTokenClaims(jwt(claims), { clientId: CLIENT, nonce: 'n', now }), { subject: 'object-one', hint: 'reader@example.test' });
  const withoutObject = { ...claims };
  delete withoutObject.oid;
  assert.equal(idTokenClaims(jwt(withoutObject), { clientId: CLIENT, nonce: 'n', now }).subject, 'subject-one');
  for (const change of [{ aud: 'another-app' }, { nonce: 'other' }, { exp: now / 1000 - 3600 }, { oid: undefined, sub: undefined }]) {
    assert.throws(() => idTokenClaims(jwt({ ...claims, ...change }), { clientId: CLIENT, nonce: 'n', now }), { code: 'invalid' }, JSON.stringify(change));
  }
  assert.throws(() => idTokenClaims('not.a-token', { clientId: CLIENT, nonce: 'n', now }), { code: 'invalid' });
  assert.throws(() => idTokenClaims(null, { clientId: CLIENT, nonce: 'n', now }), { code: 'invalid' });
});

test('token requests are public-client requests, and each refusal, wait and outage keeps its own code', async () => {
  const token = `${MICROSOFT_LOGIN}/token`;
  const graph = fakeFetch([{ method: 'POST', url: token, reply: json(200, { access_token: 'access', refresh_token: 'refresh', id_token: 'id', scope: 'Files.ReadWrite.AppFolder', expires_in: 3599 }) }]);
  const tokens = await redeemCode({ fetchImpl: graph.fetchImpl, clientId: CLIENT, code: 'code', verifier: 'verifier', redirectUri: 'http://localhost:1/' });
  assert.deepEqual(tokens, { accessToken: 'access', refreshToken: 'refresh', idToken: 'id', scope: 'Files.ReadWrite.AppFolder', expiresInMs: 3599_000 });
  const form = Object.fromEntries(new URLSearchParams(graph.calls[0].body.toString('utf8')));
  assert.deepEqual(form, {
    client_id: CLIENT, grant_type: 'authorization_code', code: 'code', redirect_uri: 'http://localhost:1/',
    code_verifier: 'verifier', scope: 'openid profile offline_access Files.ReadWrite.AppFolder',
  });
  assert.equal(form.client_secret, undefined, 'a public client never sends a secret');
  const cases = [
    [json(400, { error: 'invalid_grant' }), 'refused'],
    [json(400, { error: 'interaction_required' }), 'refused'],
    [json(429, { error: 'too_many' }, { 'retry-after': '7' }), 'unavailable'],
    [json(400, { error: 'temporarily_unavailable' }), 'unavailable'],
    [json(500, { error: 'server_error' }), 'unavailable'],
    [json(200, { token_type: 'Bearer' }), 'invalid'],
    [new TypeError('fetch failed'), 'unavailable'],
    [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'timeout'],
  ];
  for (const [reply, code] of cases) {
    const fake = fakeFetch([{ method: 'POST', url: token, reply }]);
    await assert.rejects(refreshTokens({ fetchImpl: fake.fetchImpl, clientId: CLIENT, refreshToken: 'r' }), (error) => {
      assert.equal(error.code, code);
      if (reply.status === 429) assert.equal(error.retryAfterMs, 7000);
      return true;
    });
  }
  assert.equal(retryAfterMs(new Response(null, { headers: { 'retry-after': new Date(1_000_000 + 30_000).toUTCString() } }), 1_000_000), 30_000);
  assert.equal(retryAfterMs(new Response(null, { headers: { 'retry-after': '999999' } })), 3_600_000, 'held to an hour');
});

// ------------------------------------------------------------------ OneDrive primitives

const SESSION = `${GRAPH}/me/drive/special/approot:/${NAME}:/createUploadSession?@microsoft.graph.conflictBehavior=fail`;
const LOOKUP = `${GRAPH}/me/drive/special/approot:/${NAME}?$select=id,name,size,createdDateTime`;
const CHILDREN = `${GRAPH}/me/drive/special/approot/children?$select=id,name,size,createdDateTime&$top=200`;
const CREATED = { id: 'ITEM!7', name: NAME, size: 5, createdDateTime: '2026-10-28T20:00:00Z' };

function drive(routes, { renewals = [] } = {}) {
  const fake = fakeFetch(routes);
  const onedrive = createOneDrive({
    fetchImpl: fake.fetchImpl,
    accessToken: async ({ renew }) => {
      renewals.push(renew);
      return renew ? 'access-renewed' : 'access-current';
    },
  });
  return { ...fake, onedrive, renewals };
}

test('creating opens a body-free upload session that fails on an existing name, then puts every byte without Authorization', async () => {
  const bytes = Buffer.from('hello');
  const { onedrive, calls } = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD, expirationDateTime: '2026-10-29T00:00:00Z' }) },
    { method: 'PUT', url: UPLOAD, reply: json(201, CREATED) },
  ]);
  assert.deepEqual(await onedrive.create(NAME, bytes), { id: 'ITEM!7', name: NAME, size: 5, created: Date.parse(CREATED.createdDateTime) });
  assert.deepEqual(calls.map((call) => [call.method, call.url, Boolean(call.authorization)]), [
    ['POST', SESSION, true], ['PUT', UPLOAD, false],
  ]);
  assert.equal(calls[0].body.length, 0, 'the session request has no body');
  assert.equal(calls[1].range, 'bytes 0-4/5');
  assert.deepEqual(calls[1].body, bytes);

  for (const address of ['http://my.microsoftpersonalcontent.com/upload', 'https://user:pass@my.microsoftpersonalcontent.com/u',
    'https://127.0.0.1/upload', 'https://localhost/upload', 'https://my.microsoftpersonalcontent.com:8443/u', 'not a url']) {
    const odd = drive([{ method: 'POST', url: SESSION, reply: json(200, { uploadUrl: address }) }]);
    await assert.rejects(odd.onedrive.create(NAME, bytes), { code: 'invalid' }, address);
    assert.equal(odd.calls.length, 1, `${address}: no bytes sent`);
  }
  assert.ok(capabilityUrl('https://sn3302.up.1drv.com/up/session') && capabilityUrl(UPLOAD), 'Microsoft\'s hosts, with no list of them');

  const taken = drive([{ method: 'POST', url: SESSION, reply: json(409, { error: { code: 'nameAlreadyExists' } }) }]);
  await assert.rejects(taken.onedrive.create(NAME, bytes), { code: 'exists' });
  const late = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(409, { error: { code: 'nameAlreadyExists' } }) },
    { method: 'DELETE', url: UPLOAD, reply: new Response(null, { status: 204 }) },
  ]);
  await assert.rejects(late.onedrive.create(NAME, bytes), { code: 'exists' });
  assert.deepEqual(late.calls.map((call) => call.method), ['POST', 'PUT', 'DELETE'], 'the refused session is cancelled');
});

test('an upload that gets no answer is settled before the reply: cancelled first, then looked up', async () => {
  const bytes = Buffer.from('hello');
  const landed = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: new TypeError('fetch failed') },
    { method: 'DELETE', url: UPLOAD, reply: json(404, { error: { code: 'itemNotFound' } }) },
    { method: 'GET', url: LOOKUP, reply: json(200, CREATED) },
  ]);
  assert.equal((await landed.onedrive.create(NAME, bytes)).id, 'ITEM!7', 'it had landed, so it is reported as made');
  assert.deepEqual(landed.calls.map((call) => [call.method, Boolean(call.authorization)]), [
    ['POST', true], ['PUT', false], ['DELETE', false], ['GET', true],
  ]);

  const missed = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(202, { nextExpectedRanges: ['0-'] }) },
    { method: 'DELETE', url: UPLOAD, reply: new Response(null, { status: 204 }) },
    { method: 'GET', url: LOOKUP, reply: json(404, { error: { code: 'itemNotFound' } }) },
  ]);
  await assert.rejects(missed.onedrive.create(NAME, bytes), { code: 'unavailable' }, 'cancelled and not there, so it never will be');

  let cancelOk = false;
  const unknown = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: new TypeError('fetch failed') },
    { method: 'DELETE', url: UPLOAD, reply: () => (cancelOk ? new Response(null, { status: 204 }) : new TypeError('fetch failed')) },
    { method: 'GET', url: CHILDREN, reply: json(200, { value: [] }) },
  ]);
  await assert.rejects(unknown.onedrive.create(NAME, bytes), { code: 'timeout' }, 'not cancelled, so whether it landed is not known');
  cancelOk = true;
  unknown.calls.length = 0;
  assert.deepEqual(await unknown.onedrive.list(), []);
  assert.deepEqual(unknown.calls.map((call) => call.method), ['DELETE', 'GET'], 'the next list cancels the unsettled session first');
});

// An id made only of dots becomes a dot segment in Graph's request path, so '..' would name the drive
// rather than an item or the app folder (stage 2 review, L5). None is taken from OneDrive's answers or
// from a stored record; the control API's own refusal of one is in the host's cases below.
test('item and folder ids made only of dots are never taken from OneDrive or the stored record', async () => {
  const listed = drive([{ method: 'GET', url: CHILDREN, reply: json(200, { value: [CREATED, { ...CREATED, id: '..' }, { ...CREATED, id: '.' }] }) }]);
  assert.deepEqual((await listed.onedrive.list()).map((entry) => entry.id), ['ITEM!7']);
  const root = fakeFetch([{ method: 'GET', url: `${GRAPH}/me/drive/special/approot?$select=id,parentReference`, reply: json(200, { id: '..', parentReference: { driveId: '...' } }) }]);
  assert.deepEqual(await createOneDrive({ fetchImpl: root.fetchImpl, accessToken: async () => 'access' }).appFolder(), { id: null, driveId: null });
  const learned = [];
  const made = fakeFetch([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(201, { ...CREATED, parentReference: { id: '..' } }) },
  ]);
  await createOneDrive({ fetchImpl: made.fetchImpl, accessToken: async () => 'access', onFolder: (id) => learned.push(id) }).create(NAME, Buffer.from('hello'));
  assert.deepEqual(learned, [], 'a parent named only with dots is not learned as the folder');
  assert.equal(validRecord(RECORD), true);
  for (const folder of ['.', '..']) assert.equal(validRecord({ ...RECORD, folder }), false, folder);
});

// A timeout or a server failure answering the PUT may come after every byte was committed, a gateway's
// 504 in particular, so it is settled as a lost reply is (stage 2 review, L1): a create refused with any
// code but timeout must never appear later. Refusals that say what was wrong stay definite.
test('an upload answered with a timeout or a server failure is settled like a lost reply; other refusals are definite', async () => {
  const bytes = Buffer.from('hello');
  for (const status of [408, 500, 502, 504]) {
    const landed = drive([
      { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
      { method: 'PUT', url: UPLOAD, reply: json(status, {}) },
      { method: 'DELETE', url: UPLOAD, reply: json(404, { error: { code: 'itemNotFound' } }) },
      { method: 'GET', url: LOOKUP, reply: json(200, CREATED) },
    ]);
    assert.equal((await landed.onedrive.create(NAME, bytes)).id, 'ITEM!7', `${status}: it had landed, so it is reported as made`);
    assert.deepEqual(landed.calls.map((call) => call.method), ['POST', 'PUT', 'DELETE', 'GET'], `${status}: cancelled, then looked up`);
  }
  const busy = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(503, {}, { 'retry-after': '30' }) },
    { method: 'DELETE', url: UPLOAD, reply: new Response(null, { status: 204 }) },
    { method: 'GET', url: LOOKUP, reply: json(404, { error: { code: 'itemNotFound' } }) },
  ]);
  await assert.rejects(busy.onedrive.create(NAME, bytes), (error) => error.code === 'unavailable' && error.retryAfterMs === 30_000,
    'not there, and the wait OneDrive asked for is kept');
  for (const [status, code] of [[409, 'exists'], [403, 'refused'], [507, 'quota']]) {
    const refused = drive([
      { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
      { method: 'PUT', url: UPLOAD, reply: json(status, {}) },
      { method: 'DELETE', url: UPLOAD, reply: new Response(null, { status: 204 }) },
    ]);
    await assert.rejects(refused.onedrive.create(NAME, bytes), { code }, String(status));
    assert.ok(!refused.calls.some((call) => call.method === 'GET'), `${status}: definite, so nothing is looked up`);
  }
});

test('a list waits for an upload under way, so nothing a reply said had failed can appear after it', async () => {
  const put = deferred();
  const listed = [];
  const { onedrive, calls } = drive([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: () => put.promise },
    { method: 'GET', url: CHILDREN, reply: () => json(200, { value: listed }) },
  ]);
  const creating = onedrive.create(NAME, Buffer.from('hello'));
  await until(() => calls.some((call) => call.method === 'PUT'), 'the upload is under way');
  const listing = onedrive.list();
  for (let turn = 0; turn < 20; turn += 1) await settle();
  assert.ok(!calls.some((call) => call.url === CHILDREN), 'the list has not been asked for yet');
  listed.push(CREATED);
  put.resolve(json(201, CREATED));
  await creating;
  assert.deepEqual((await listing).map((entry) => entry.name), [NAME]);
});

test('reading follows exactly one redirect, the download carries no Authorization, and its size is capped', async () => {
  const content = `${GRAPH}/me/drive/items/ITEM!7/content`;
  const { onedrive, calls } = drive([
    { method: 'GET', url: content, reply: new Response(null, { status: 302, headers: { location: DOWNLOAD } }) },
    { method: 'GET', url: DOWNLOAD, reply: new Response(Buffer.from('backup bytes'), { status: 200 }) },
  ]);
  assert.equal((await onedrive.read('ITEM!7')).toString('utf8'), 'backup bytes');
  assert.deepEqual(calls.map((call) => [call.url, Boolean(call.authorization), call.redirect]), [
    [content, true, 'manual'], [DOWNLOAD, false, 'manual'],
  ]);
  const cases = [
    [[new Response(null, { status: 302, headers: { location: 'http://public.ch.files.1drv.com/x' } })], 'invalid'],
    [[new Response(null, { status: 302, headers: { location: DOWNLOAD } }), new Response(null, { status: 302, headers: { location: DOWNLOAD } })], 'invalid'],
    [[json(404, { error: { code: 'itemNotFound' } })], 'not-found'],
    [[new Response(null, { status: 302, headers: { location: DOWNLOAD } }), new Response('x', { status: 200, headers: { 'content-length': String(33 * 1024 * 1024) } })], 'too-large'],
  ];
  for (const [[first, second], code] of cases) {
    const odd = drive([
      { method: 'GET', url: content, reply: first },
      ...(second ? [{ method: 'GET', url: DOWNLOAD, reply: second }] : []),
    ]);
    await assert.rejects(odd.onedrive.read('ITEM!7'), { code });
  }

  // An item over the cap that declares no length is read to the cap and no further, and nothing of it is
  // returned (stage 1 review, L8).
  const MIB = 1024 * 1024;
  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += MIB;
      controller.enqueue(new Uint8Array(MIB));
      if (pulled >= 40 * MIB) controller.close();
    },
  });
  const streamed = drive([
    { method: 'GET', url: content, reply: new Response(null, { status: 302, headers: { location: DOWNLOAD } }) },
    { method: 'GET', url: DOWNLOAD, reply: new Response(endless, { status: 200 }) },
  ]);
  await assert.rejects(streamed.onedrive.read('ITEM!7'), { code: 'too-large' });
  assert.ok(pulled <= 34 * MIB, `stopped at the cap, after ${pulled / MIB} MiB of 40`);
});

test('listing follows every page, and an app folder that does not exist yet lists as empty', async () => {
  const empty = drive([{ method: 'GET', url: CHILDREN, reply: json(404, { error: { code: 'itemNotFound' } }) }]);
  assert.deepEqual(await empty.onedrive.list(), []);
  const second = `${GRAPH}/me/drive/special/approot/children?$skiptoken=page-two`;
  const paged = drive([
    { method: 'GET', url: CHILDREN, reply: json(200, { value: [CREATED, { id: 'bad id with spaces', name: 'x' }], '@odata.nextLink': second }) },
    { method: 'GET', url: second, reply: json(200, { value: [{ ...CREATED, id: 'ITEM!8', name: 'other.txt', size: 'big' }] }) },
  ]);
  assert.deepEqual((await paged.onedrive.list()).map((entry) => [entry.id, entry.size]), [['ITEM!7', 5], ['ITEM!8', null]]);
  const away = drive([{ method: 'GET', url: CHILDREN, reply: json(200, { value: [], '@odata.nextLink': 'https://graph.example.test/next' }) }]);
  await assert.rejects(away.onedrive.list(), { code: 'invalid' });
});

// The person deleting the app folder means consent and discovery run again (the transport contract), so a
// folder known by its id answers 404 as deleted rather than being made again without a word.
test('with the app folder known, listing and creating go by its id, and a 404 for it means it was deleted', async () => {
  const children = `${GRAPH}/me/drive/items/APP!1/children?$select=id,name,size,createdDateTime&$top=200`;
  const session = `${GRAPH}/me/drive/items/APP!1:/${NAME}:/createUploadSession?@microsoft.graph.conflictBehavior=fail`;
  const learned = [];
  const known = fakeFetch([
    { method: 'GET', url: children, reply: json(200, { value: [CREATED] }) },
    { method: 'POST', url: session, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(201, { ...CREATED, parentReference: { id: 'APP!1' } }) },
  ]);
  const byId = createOneDrive({ fetchImpl: known.fetchImpl, accessToken: async () => 'access', folder: 'APP!1', onFolder: (id) => learned.push(id) });
  assert.deepEqual((await byId.list()).map((entry) => entry.id), ['ITEM!7']);
  assert.equal((await byId.create(NAME, Buffer.from('hello'))).id, 'ITEM!7');
  assert.deepEqual(learned, [], 'a folder already known is not learned again');
  for (const [method, url] of [['GET', children], ['POST', session]]) {
    const deleted = fakeFetch([{ method, url, reply: json(404, { error: { code: 'itemNotFound' } }) }]);
    const onedrive = createOneDrive({ fetchImpl: deleted.fetchImpl, accessToken: async () => 'access', folder: 'APP!1' });
    await assert.rejects(method === 'GET' ? onedrive.list() : onedrive.create(NAME, Buffer.from('hello')), { code: 'folder-gone' }, method);
  }
  const fresh = fakeFetch([
    { method: 'POST', url: SESSION, reply: json(200, { uploadUrl: UPLOAD }) },
    { method: 'PUT', url: UPLOAD, reply: json(201, { ...CREATED, parentReference: { id: 'APP!2', driveId: 'drive-one' } }) },
  ]);
  await createOneDrive({ fetchImpl: fresh.fetchImpl, accessToken: async () => 'access', onFolder: (id) => learned.push(id) }).create(NAME, Buffer.from('hello'));
  assert.deepEqual(learned, ['APP!2'], 'with no folder known, a create teaches the one it made');
});

test('deleting an item already gone succeeds, throttling carries the provider\'s wait, and a second 401 needs sign-in', async () => {
  const item = `${GRAPH}/me/drive/items/ITEM!7`;
  for (const status of [204, 404]) {
    const done = drive([{ method: 'DELETE', url: item, reply: new Response(status === 204 ? null : '{}', { status }) }]);
    await done.onedrive.delete('ITEM!7');
  }
  const cases = [
    [json(429, {}, { 'retry-after': '7' }), 'unavailable', 7000],
    [json(503, {}, { 'retry-after': '120' }), 'unavailable', 120_000],
    [json(507, { error: { code: 'quotaLimitReached' } }), 'quota', 0],
    [json(403, { error: { code: 'accessDenied' } }), 'refused', 0],
    [json(500, {}), 'unavailable', 0],
  ];
  for (const [reply, code, wait] of cases) {
    const odd = drive([{ method: 'DELETE', url: item, reply }]);
    await assert.rejects(odd.onedrive.delete('ITEM!7'), (error) => error.code === code && error.retryAfterMs === wait);
  }
  const renewals = [];
  const expired = drive([{ method: 'DELETE', url: item, reply: json(401, {}) }], { renewals });
  await assert.rejects(expired.onedrive.delete('ITEM!7'), { code: 'needs-sign-in' });
  assert.deepEqual(renewals, [false, true], 'one renewal, then a sign-in is asked for');
  assert.deepEqual(expired.calls.map((call) => call.authorization), ['Bearer access-current', 'Bearer access-renewed']);
});

// ------------------------------------------------------------------ the host

function memoryStore(initial = null) {
  let saved = initial === null ? null : structuredClone(initial);
  const log = [];
  return {
    log,
    get saved() { return saved === null ? null : structuredClone(saved); },
    faults: { load: null, probe: null },
    async probe() {
      log.push('probe');
      if (this.faults.probe) throw this.faults.probe;
    },
    async exists() { return saved !== null; },
    async load() {
      log.push('load');
      if (this.faults.load) throw this.faults.load;
      return saved === null ? null : structuredClone(saved);
    },
    async save(record) {
      log.push('save');
      saved = structuredClone(record);
    },
    async clear() {
      log.push('clear');
      saved = null;
    },
  };
}

// Microsoft as the host meets it. The app folder is known by its id: a request for a folder that is no
// longer the current one answers 404, as a folder the person deleted does, and the app-root path resolves to
// the current folder, as Microsoft makes it again on demand.
function microsoft({ driveId = 'drive-one', folderId = 'APP!1', nonce = () => null, refresh = () => json(200, { access_token: 'access-refreshed', refresh_token: 'refresh-2', expires_in: 3600, scope: 'Files.ReadWrite.AppFolder' }) } = {}) {
  const state = { driveId, folderId, items: [] };
  const folderIn = (url) => /\/me\/drive\/items\/([^/:?]+)/.exec(url)?.[1] ?? null;
  const gone = () => json(404, { error: { code: 'itemNotFound' } });
  const fake = fakeFetch([
    {
      method: 'POST', url: `${MICROSOFT_LOGIN}/token`,
      reply: (call) => {
        const form = Object.fromEntries(new URLSearchParams(call.body.toString('utf8')));
        if (form.grant_type === 'refresh_token') return refresh(form);
        return json(200, {
          access_token: 'access-first', refresh_token: 'refresh-1', expires_in: 3600,
          scope: 'openid profile offline_access Files.ReadWrite.AppFolder',
          id_token: jwt({ aud: CLIENT, nonce: nonce(), oid: 'object-one', exp: Math.floor(Date.now() / 1000) + 600, preferred_username: 'reader@example.test' }),
        });
      },
    },
    { method: 'GET', url: `${GRAPH}/me/drive/special/approot?$select=id,parentReference`, reply: () => json(200, { id: state.folderId, parentReference: { driveId: state.driveId } }) },
    { method: 'GET', url: CHILDREN, reply: () => json(200, { value: state.items }) },
    { method: 'GET', url: /\/me\/drive\/items\/[^/]+\/children\?/, reply: (call) => (folderIn(call.url) === state.folderId ? json(200, { value: state.items }) : gone()) },
    {
      method: 'POST', url: /:\/createUploadSession\?/,
      reply: (call) => (folderIn(call.url) && folderIn(call.url) !== state.folderId ? gone() : json(200, { uploadUrl: UPLOAD })),
    },
    { method: 'PUT', url: UPLOAD, reply: () => json(201, { ...CREATED, parentReference: { id: state.folderId, driveId: state.driveId } }) },
  ]);
  return { ...fake, state };
}

async function hostServer(host) {
  const server = createServer((req, res) => {
    if (String(req.url).startsWith(CLOUD_API_PREFIX)) host.handle(req, res);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  async function call(operation, body = {}, headers = {}, { method = 'POST', raw } = {}) {
    const merged = {
      host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json',
      [CLOUD_API_HEADER]: '1', 'sec-fetch-site': 'same-origin', ...headers,
    };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    const payload = raw ?? JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `${CLOUD_API_PREFIX}${operation}`, method, headers: merged, agent: false, setHost: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text, body: text ? JSON.parse(text) : null });
        });
      });
      req.on('error', reject);
      req.end(method === 'GET' || method === 'OPTIONS' ? undefined : payload);
    });
  }
  return { port, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

function host({ store = memoryStore(), fetch = microsoft(), session = async () => true, opened = [], clock = Date.now, deadlines } = {}) {
  const sessions = [];
  const instance = createCloudHost({
    clientText: CLIENT_TEXT, platform: 'win32', fetchImpl: fetch.fetchImpl, store, clock, ...(deadlines ? { deadlines } : {}),
    sessionCheck: async (socket) => {
      sessions.push(socket.remotePort);
      return session(socket);
    },
    openUrl: async (url) => { opened.push(url); },
  });
  return { instance, store, fetch, opened, sessions };
}

test('the control API refuses every request that is not the served page\'s, before reading or doing anything', async () => {
  let inSession = true;
  const env = host({ session: async () => inSession });
  const api = await hostServer(env.instance);
  try {
    const ok = await api.call('status');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.status.state, 'not-connected');
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    const checked = env.sessions.length;
    const refusals = [
      [['status', {}, {}, { method: 'GET' }], 405, 'method'],
      [['status', {}, {}, { method: 'OPTIONS' }], 405, 'method'],
      [['status', {}, { host: 'attacker.example:80' }], 403, 'host'],
      [['status', {}, { host: `localhost:${api.port}` }], 403, 'host'],
      [['status', {}, { origin: undefined }], 403, 'origin'],
      [['status', {}, { origin: 'null' }], 403, 'origin'],
      [['status', {}, { origin: 'https://attacker.example' }], 403, 'origin'],
      [['status', {}, { 'sec-fetch-site': 'cross-site' }], 403, 'site'],
      [['status', {}, { [CLOUD_API_HEADER]: undefined }], 403, 'header'],
      [['status', {}, { 'content-type': 'text/plain' }], 415, 'type'],
      [['status', {}, { 'content-type': 'application/x-www-form-urlencoded' }], 415, 'type'],
    ];
    for (const [args, status, code] of refusals) {
      const answer = await api.call(...args);
      assert.equal(answer.status, status, JSON.stringify(args));
      assert.equal(answer.body?.error?.code, code, JSON.stringify(args));
      assert.equal(answer.headers['access-control-allow-origin'], undefined, 'nothing is readable from another origin');
      assert.equal(answer.headers.connection, 'close');
    }
    assert.equal(env.sessions.length, checked, 'no session lookup for a request the headers already refuse');
    const hostless = await api.call('status', {}, { host: undefined });
    assert.deepEqual([hostless.status, hostless.body], [400, null], 'Node\'s own parser refuses a request with no Host at all');
    assert.equal((await api.call('teleport')).status, 404);
    assert.equal((await api.call('status?x=1')).status, 404);
    assert.equal((await api.call('list', {}, {}, { raw: 'x'.repeat(17 * 1024) })).status, 413);
    assert.equal((await api.call('status', {}, {}, { raw: '{not json' })).status, 400);
    assert.equal((await api.call('status', {}, {}, { raw: '[1]' })).status, 400);
    assert.equal((await api.call('status', {}, { 'sec-fetch-site': undefined })).status, 200, 'an older browser without fetch metadata');
    inSession = false;
    const other = await api.call('status');
    assert.equal(other.status, 403);
    assert.equal(other.body.error.code, 'session');
    assert.ok(!other.text.includes('not-connected'), 'another session learns nothing about the connection');
  } finally {
    env.instance.close();
    await api.close();
  }
});

async function signIn(env, api, { nonceRef, start = async () => (await api.call('connect')).body.status }) {
  const started = await start();
  assert.equal(started.state, 'signing-in');
  await until(() => env.opened.length > 0, 'the browser was asked to open the sign-in');
  const url = new URL(env.opened.at(-1));
  nonceRef.value = url.searchParams.get('nonce');
  const port = Number(new URL(url.searchParams.get('redirect_uri')).port);
  const answer = await callbackRequest(port, `/?code=code-${env.opened.length}&state=${url.searchParams.get('state')}`);
  assert.equal(answer.status, 200);
  await until(async () => (await env.instance.status()).state !== 'signing-in', 'the sign-in finishes');
  return url;
}

test('connecting signs in through the browser and the callback, keeps only protected tokens, and never hands one to the page', async () => {
  const nonceRef = { value: null };
  const fetch = microsoft({ nonce: () => nonceRef.value });
  const env = host({ fetch });
  const api = await hostServer(env.instance);
  try {
    const url = await signIn(env, api, { nonceRef });
    const status = (await api.call('status')).body.status;
    assert.equal(status.state, 'connected');
    assert.match(status.connection, /^[a-f0-9]{32}$/);
    assert.equal(status.account, 'reader@example.test');
    const tokenCall = fetch.calls.find((call) => call.url === `${MICROSOFT_LOGIN}/token`);
    const form = Object.fromEntries(new URLSearchParams(tokenCall.body.toString('utf8')));
    assert.equal(createHash('sha256').update(form.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.equal(form.redirect_uri, url.searchParams.get('redirect_uri'));
    assert.equal(form.client_secret, undefined);
    assert.deepEqual(env.store.saved, {
      version: 1, provider: 'onedrive', connection: status.connection, account: { id: 'drive:drive-one', hint: 'reader@example.test' },
      folder: 'APP!1', refreshToken: 'refresh-1', savedAt: env.store.saved.savedAt,
    });
    fetch.state.items.push(CREATED);
    const listed = await api.call('list', { connection: status.connection });
    assert.deepEqual(listed.body.items.map((entry) => entry.name), [NAME]);
    for (const answer of [status, listed.body]) assert.ok(!/access-|refresh-/.test(JSON.stringify(answer)), 'no token reaches the page');
    const again = await api.call('connect');
    assert.equal(again.body.status.state, 'connected', 'connecting while connected changes nothing');
    assert.equal(env.opened.length, 1);
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a refused refresh needs sign-in and keeps the connection; signing in to the same drive keeps it, another drive does not', async () => {
  const nonceRef = { value: null };
  let refreshes = 0;
  const fetch = microsoft({ nonce: () => nonceRef.value, refresh: () => { refreshes += 1; return json(400, { error: 'invalid_grant' }); } });
  const store = memoryStore({ ...RECORD });
  const env = host({ store, fetch });
  const api = await hostServer(env.instance);
  try {
    const before = (await api.call('status')).body.status;
    assert.deepEqual([before.state, before.connection], ['connected', RECORD.connection]);
    const refused = await api.call('list', { connection: RECORD.connection });
    assert.deepEqual([refused.status, refused.body.ok, refused.body.error.code], [200, false, 'needs-sign-in']);
    assert.equal(refreshes, 1);
    const after = (await api.call('status')).body.status;
    assert.deepEqual([after.state, after.connection, after.account], ['needs-sign-in', RECORD.connection, RECORD.account.hint]);
    assert.equal(store.saved.refreshToken, null, 'the dead refresh token is gone');
    assert.equal(store.saved.connection, RECORD.connection);
    assert.equal((await api.call('list', { connection: RECORD.connection })).body.error.code, 'needs-sign-in');
    assert.equal(refreshes, 1, 'nothing is retried in silence');

    await signIn(env, api, { nonceRef });
    const same = (await api.call('status')).body.status;
    assert.deepEqual([same.state, same.connection], ['connected', RECORD.connection], 'the same drive: no browser has to agree again');
    await api.call('disconnect');
    fetch.state.driveId = 'drive-two';
    await signIn(env, api, { nonceRef });
    const other = (await api.call('status')).body.status;
    assert.equal(other.state, 'connected');
    assert.notEqual(other.connection, RECORD.connection, 'another account is another connection');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a page that names another connection is refused, and disconnecting removes the stored sign-in', async () => {
  const store = memoryStore({ ...RECORD });
  const env = host({ store });
  const api = await hostServer(env.instance);
  try {
    const stale = await api.call('list', { connection: 'd'.repeat(32) });
    assert.equal(stale.body.error.code, 'needs-consent', 'a consent given for another connection writes nothing and asks again');
    for (const [operation, input] of [['read', { id: 'ITEM!7' }], ['create', { name: NAME, bytes: 'aGk=' }], ['delete', { id: 'ITEM!7' }]]) {
      const answer = await api.call(operation, { connection: 'd'.repeat(32), ...input });
      assert.equal(answer.body.error.code, 'needs-consent', operation);
    }
    assert.equal(env.fetch.calls.length, 0, 'none of them reached OneDrive');
    assert.equal((await api.call('list', {})).body.error.code, 'invalid');
    assert.equal((await api.call('create', { connection: RECORD.connection, name: '../escape', bytes: 'aGk=' })).body.error.code, 'invalid');
    assert.equal((await api.call('create', { connection: RECORD.connection, name: NAME, bytes: '' })).body.error.code, 'invalid');
    for (const id of ['a/b', '.', '..']) {
      for (const operation of ['read', 'delete']) {
        assert.equal((await api.call(operation, { connection: RECORD.connection, id })).body.error.code, 'invalid', `${operation} ${id}`);
      }
    }
    assert.equal(env.fetch.calls.length, 0, 'no refused id reached OneDrive');
    const gone = await api.call('disconnect');
    assert.equal(gone.body.status.state, 'not-connected');
    assert.equal(store.saved, null);
    assert.equal((await api.call('list', { connection: RECORD.connection })).body.error.code, 'not-connected');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a deleted app folder asks every browser again under a new connection, and the next create teaches the new folder', async () => {
  const store = memoryStore({ ...RECORD });
  const fetch = microsoft();
  const env = host({ store, fetch });
  const api = await hostServer(env.instance);
  // Why every browser is asked again, as the card shows it: the person deleted the folder, nobody signed in
  // again (P02-T07 decision 2). The page's own transport carries it.
  const FOLDER_GONE = 'The Recap Page folder was deleted from OneDrive, so cloud backup asks again before it makes a new one.';
  const transport = createCloudHostTransport({ fetchImpl: pageFetch(api).fetchImpl });
  try {
    assert.equal((await api.call('status')).body.status.reason, null, 'an ordinary connection has nothing to explain');
    fetch.state.folderId = 'APP!2';
    const refused = await api.call('list', { connection: RECORD.connection });
    assert.equal(refused.body.error?.code, 'needs-consent', 'the person deleted the folder, so consent runs again');
    assert.equal(refused.body.error?.message, FOLDER_GONE);
    const status = (await api.call('status')).body.status;
    assert.equal(status.state, 'connected');
    assert.notEqual(status.connection, RECORD.connection, 'a new connection, so every browser asks again');
    assert.equal(status.reason, FOLDER_GONE, 'and the host says why, for every browser that has not agreed again');
    assert.equal((await transport.status()).reason, FOLDER_GONE, 'through the page\'s transport too');
    assert.deepEqual([store.saved.connection, store.saved.folder], [status.connection, null]);
    const old = (await api.call('create', { connection: RECORD.connection, name: NAME, bytes: 'aGk=' })).body.error;
    assert.deepEqual([old?.code, old?.message], ['needs-consent', FOLDER_GONE], 'nothing is made under the old consent, which is told why');
    assert.deepEqual((await api.call('list', { connection: status.connection })).body.items, [], 'discovery under the new one');
    const made = await api.call('create', { connection: status.connection, name: NAME, bytes: 'aGk=' });
    assert.equal(made.body.ok, true);
    await until(() => store.saved?.folder === 'APP!2', 'the folder that create made is learned');
    assert.equal(store.saved.connection, status.connection, 'learning it asks nobody again');
    fetch.state.items.push(CREATED);
    assert.deepEqual((await api.call('list', { connection: status.connection })).body.items.map((entry) => entry.name), [NAME]);
    assert.ok(fetch.calls.some((call) => call.url.startsWith(`${GRAPH}/me/drive/items/APP!2/children?`)), 'listed by the new folder\'s id');
    assert.equal((await api.call('status')).body.status.reason, FOLDER_GONE, 'still said while that connection lasts, for the browsers not yet asked');
    await api.call('disconnect');
    assert.equal((await api.call('status')).body.status.reason, null, 'and gone with it');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('signing in again after the app folder was deleted is a new connection; the same folder keeps it', async () => {
  for (const [folderId, kept] of [['APP!1', true], ['APP!2', false]]) {
    const nonceRef = { value: null };
    const fetch = microsoft({ nonce: () => nonceRef.value, folderId });
    const store = memoryStore({ ...RECORD, refreshToken: null });
    const env = host({ store, fetch });
    const api = await hostServer(env.instance);
    try {
      assert.equal((await api.call('status')).body.status.state, 'needs-sign-in');
      await signIn(env, api, { nonceRef });
      const status = (await api.call('status')).body.status;
      assert.equal(status.state, 'connected');
      assert.equal(status.connection === RECORD.connection, kept, folderId);
      assert.equal(store.saved.folder, folderId);
    } finally {
      env.instance.close();
      await api.close();
    }
  }
});

// Every data operation answers within the deadline this host states, from the token store through every
// request, and each sits at least five seconds inside the deadline the page's engine states, so the page
// always hears an answer before it gives up (stage 1 review, L8; the transport contract, CQ-2).
test('every data operation answers within its deadline, inside the one the engine states', async () => {
  for (const operation of ['list', 'read', 'create', 'delete']) {
    assert.ok(HOST_DEADLINES_MS[operation] + 5_000 <= CLOUD_TRANSPORT_DEADLINES_MS[operation], operation);
  }
  const silent = {
    fetchImpl: (url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal.reason));
    }),
  };
  const env = host({ store: memoryStore({ ...RECORD }), fetch: silent, deadlines: { list: 60, read: 60, create: 60, delete: 60 } });
  const api = await hostServer(env.instance);
  try {
    for (const [operation, input] of [['list', {}], ['read', { id: 'ITEM!7' }], ['create', { name: NAME, bytes: 'aGk=' }], ['delete', { id: 'ITEM!7' }]]) {
      const started = Date.now();
      const answer = await api.call(operation, { connection: RECORD.connection, ...input });
      assert.deepEqual([answer.body.ok, answer.body.error?.code], [false, 'timeout'], operation);
      assert.ok(Date.now() - started < 5_000, `${operation} answered after ${Date.now() - started} ms`);
    }
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a refresh that finishes after a disconnect never writes the connection back', async () => {
  const pending = deferred();
  const fetch = microsoft({ refresh: () => pending.promise });
  const store = memoryStore({ ...RECORD });
  const env = host({ store, fetch });
  const api = await hostServer(env.instance);
  try {
    const listing = api.call('list', { connection: RECORD.connection });
    await until(() => fetch.calls.some((call) => call.url === `${MICROSOFT_LOGIN}/token`), 'the refresh is under way');
    await api.call('disconnect');
    pending.resolve(json(200, { access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 }));
    assert.equal((await listing).body.error.code, 'not-connected');
    assert.equal(store.saved, null, 'the disconnect stands');
    assert.equal((await api.call('status')).body.status.state, 'not-connected');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('where Windows restricts PowerShell, cloud backup says why, signs nothing in, and can still disconnect', async () => {
  const store = memoryStore({ ...RECORD });
  store.faults.load = new CloudTokenError('language');
  const env = host({ store });
  const api = await hostServer(env.instance);
  try {
    const status = (await api.call('status')).body.status;
    assert.deepEqual([status.state, status.connection], ['unavailable', null]);
    assert.match(status.message, /restricting PowerShell/);
    assert.equal((await api.call('connect')).body.error.code, 'language');
    assert.equal(env.opened.length, 0);
    await api.call('disconnect');
    assert.equal(store.saved, null, 'erase can always remove a sign-in it cannot read');
  } finally {
    env.instance.close();
    await api.close();
  }
  const elsewhere = createCloudHost({ clientText: CLIENT_TEXT, platform: 'linux', store: memoryStore(), sessionCheck: async () => true, openUrl: async () => {} });
  assert.equal((await elsewhere.status()).state, 'unavailable');
  assert.ok(new ProviderError('unavailable', 'x', { retryAfterMs: 5 }).retryAfterMs === 5);
});

// The first request to a freshly started host reads the stored sign-in, and a disconnect can land while
// PowerShell unprotects it. That read used to finish after the disconnect and put the old sign-in back,
// so the disconnect answered connected and the next refresh saved it again (stage 2 review, M1).
test('a disconnect that lands while the stored sign-in is being read is never undone by that read', async () => {
  const store = memoryStore({ ...RECORD });
  const reading = deferred();
  const read = store.load.bind(store);
  // As the real store does: the file is read first, then PowerShell spends its time unprotecting it.
  store.load = async () => {
    const sealed = await read();
    store.log.push('reading');
    await reading.promise;
    return sealed;
  };
  const env = host({ store });
  const api = await hostServer(env.instance);
  try {
    const first = api.call('status');
    await until(() => store.log.includes('reading'), 'the stored sign-in is being read');
    const asked = env.sessions.length;
    const leaving = api.call('disconnect');
    await until(() => env.sessions.length > asked, 'the disconnect reached the host');
    for (let turn = 0; turn < 50; turn += 1) await settle();
    reading.resolve();
    assert.equal((await leaving).body.status.state, 'not-connected');
    await first;
    assert.equal((await api.call('status')).body.status.state, 'not-connected');
    assert.equal((await api.call('list', { connection: RECORD.connection })).body.error.code, 'not-connected', 'the old connection is refused');
    assert.equal(store.saved, null, 'the sign-in stays removed');
    assert.ok(!store.log.slice(store.log.indexOf('clear')).includes('save'), 'nothing saved it back');
  } finally {
    env.instance.close();
    await api.close();
  }
});

// OneDrive can refuse a token the host has just renewed. That sign-in is no longer any good, so the host
// says so as it does for a refused refresh: status asks for a sign-in again and Connect starts one, rather
// than answering connected to a person who has just been told to sign in (stage 2 review, L3).
test('a token OneDrive refuses even after renewing it asks for a sign-in again, and Connect starts one', async () => {
  const fetch = microsoft();
  fetch.routes.unshift({ method: 'GET', url: /^https:\/\/graph\.microsoft\.com\//, reply: () => json(401, {}) });
  const store = memoryStore({ ...RECORD });
  const env = host({ store, fetch });
  const api = await hostServer(env.instance);
  try {
    assert.equal((await api.call('list', { connection: RECORD.connection })).body.error.code, 'needs-sign-in');
    const status = (await api.call('status')).body.status;
    assert.deepEqual([status.state, status.connection], ['needs-sign-in', RECORD.connection], 'asked for, and the connection stays');
    assert.equal(store.saved.refreshToken, null);
    assert.equal(store.saved.connection, RECORD.connection);
    assert.equal((await api.call('connect')).body.status.state, 'signing-in', 'Connect starts the sign-in it asks for');
    await until(() => env.opened.length === 1, 'the browser was asked to open the sign-in');
  } finally {
    env.instance.close();
    await api.close();
  }
});

// A computer that never connected has never run PowerShell, so a restriction used to be found only by the
// save after a whole Microsoft sign-in, and Connect then ran another one (stage 2 review, L2). It is found
// before Microsoft's page opens now, and stays said.
test('a computer that cannot protect a sign-in says so before Microsoft\'s page opens, and keeps saying it', async () => {
  const store = memoryStore();
  store.faults.probe = new CloudTokenError('language');
  const env = host({ store });
  const api = await hostServer(env.instance);
  try {
    assert.equal((await api.call('status')).body.status.state, 'not-connected', 'nothing has needed PowerShell yet');
    const refused = (await api.call('connect')).body;
    assert.deepEqual([refused.ok, refused.error.code], [false, 'language']);
    const status = (await api.call('status')).body.status;
    assert.equal(status.state, 'unavailable');
    assert.match(status.message, /restricting PowerShell/);
    assert.equal((await api.call('connect')).body.error.code, 'language', 'refused at once from then on');
    assert.deepEqual([env.opened.length, store.log.filter((entry) => entry === 'probe').length, env.fetch.calls.length], [0, 1, 0],
      'no browser, one probe, nothing sent to Microsoft');
  } finally {
    env.instance.close();
    await api.close();
  }

  // A restriction that arrives only with the save after a sign-in is said from then on all the same.
  const nonceRef = { value: null };
  const later = memoryStore();
  later.save = async () => { throw new CloudTokenError('language'); };
  const signed = host({ store: later, fetch: microsoft({ nonce: () => nonceRef.value }) });
  const laterApi = await hostServer(signed.instance);
  try {
    await signIn(signed, laterApi, { nonceRef });
    assert.equal((await laterApi.call('status')).body.status.state, 'unavailable');
    assert.equal((await laterApi.call('connect')).body.error.code, 'language');
    assert.equal(signed.opened.length, 1, 'no second sign-in');
  } finally {
    signed.instance.close();
    await laterApi.close();
  }
});

// A Windows account whose local app data is missing, or not on a drive, has nowhere private to keep a
// sign-in, and the card used to say so as though the computer were not running Windows at all (the
// residual P02-T05 recorded). It has its own reason now, found before Microsoft's page opens and kept.
test('a Windows account with no usable local app data folder says so in its own words, before Microsoft\'s page opens', async () => {
  const opened = [];
  let spawned = 0;
  const fetch = microsoft();
  for (const env of [{}, { LOCALAPPDATA: '\\\\server\\share' }]) {
    const instance = createCloudHost({
      clientText: CLIENT_TEXT, platform: 'win32', env, fetchImpl: fetch.fetchImpl,
      spawnImpl: () => { spawned += 1; throw new Error('PowerShell must not start'); },
      sessionCheck: async () => true, openUrl: async (url) => { opened.push(url); },
    });
    const api = await hostServer(instance);
    try {
      assert.equal((await api.call('status')).body.status.state, 'not-connected', 'nothing has needed the folder yet');
      const refused = (await api.call('connect')).body;
      assert.deepEqual([refused.ok, refused.error.code], [false, 'location']);
      const status = (await api.call('status')).body.status;
      assert.equal(status.state, 'unavailable');
      assert.match(status.message, /no local app data folder that Recap Page can use/);
      assert.doesNotMatch(status.message, /only on Windows/);
      assert.equal((await api.call('connect')).body.error.code, 'location', 'refused at once from then on');
    } finally {
      instance.close();
      await api.close();
    }
  }
  assert.deepEqual([opened.length, spawned, fetch.calls.length], [0, 0, 0], 'no browser, no PowerShell, nothing sent to Microsoft');
});

// ------------------------------------------------------------------ the page's transport

// The browser's part of a request from the served page: the absolute address, and the Origin and fetch
// metadata a browser adds to a same-origin POST. Everything else is the transport's own.
function pageFetch(api, { origin = `http://127.0.0.1:${api.port}` } = {}) {
  const seen = [];
  const fetchImpl = (path, init = {}) => {
    seen.push({ path, init });
    return globalThis.fetch(`http://127.0.0.1:${api.port}${path}`, { ...init, headers: { ...init.headers, origin, 'sec-fetch-site': 'same-origin' } });
  };
  return { fetchImpl, seen };
}

test('the page\'s transport speaks the control API as the served page does, and every byte crosses it unchanged', async () => {
  assert.equal(CLOUD_HOST_PREFIX, CLOUD_API_PREFIX);
  assert.equal(CLOUD_HOST_HEADER, CLOUD_API_HEADER);
  const nonceRef = { value: null };
  const fetch = microsoft({ nonce: () => nonceRef.value });
  const env = host({ fetch });
  const api = await hostServer(env.instance);
  const page = pageFetch(api);
  const transport = createCloudHostTransport({ fetchImpl: page.fetchImpl });
  try {
    assert.deepEqual(await transport.status(), {
      enabled: true, provider: 'onedrive', state: 'not-connected', connection: null, account: null, message: null, reason: null, signInExpiresAt: null,
    });
    let started = null;
    await signIn(env, api, { nonceRef, start: async () => { started = await transport.connect(); return started; } });
    assert.ok(Number.isSafeInteger(started.signInExpiresAt) && started.signInExpiresAt > Date.now(), 'the page can say how long the sign-in stays open');
    const status = await transport.status();
    assert.deepEqual([status.state, status.account], ['connected', 'reader@example.test']);
    const { connection } = status;
    assert.deepEqual(await transport.list({ connection }), []);

    // Every byte value, across more than one of the pieces the page encodes in.
    const bytes = new Uint8Array(100_000).map((value, at) => (at * 7919) % 256);
    assert.deepEqual(await transport.create(NAME, bytes, { connection }), {
      id: 'ITEM!7', name: NAME, size: 5, created: Date.parse(CREATED.createdDateTime),
    });
    assert.ok(Buffer.from(bytes).equals(fetch.calls.find((call) => call.method === 'PUT').body), 'OneDrive received exactly the page\'s bytes');
    fetch.routes.push(
      { method: 'GET', url: `${GRAPH}/me/drive/items/ITEM!7/content`, reply: () => new Response(null, { status: 302, headers: { location: DOWNLOAD } }) },
      { method: 'GET', url: DOWNLOAD, reply: () => new Response(Buffer.from(bytes), { status: 200 }) },
      { method: 'DELETE', url: `${GRAPH}/me/drive/items/ITEM!7`, reply: () => new Response(null, { status: 204 }) },
    );
    assert.deepEqual(await transport.read('ITEM!7', { connection }), bytes);
    assert.equal(await transport.delete('ITEM!7', { connection }), undefined);
    assert.equal((await transport.disconnect()).state, 'not-connected');

    assert.deepEqual(page.seen.map(({ path }) => path), ['status', 'connect', 'status', 'list', 'create', 'read', 'delete', 'disconnect']
      .map((operation) => `${CLOUD_API_PREFIX}${operation}`));
    for (const { init } of page.seen) {
      assert.deepEqual([init.method, init.headers['content-type'], init.headers[CLOUD_API_HEADER]], ['POST', 'application/json', '1']);
    }
    assert.ok(page.seen.slice(3, 7).every(({ init }) => JSON.parse(init.body).connection === connection), 'every data operation names the consented connection');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('the page\'s transport keeps every refusal\'s code and wait, and a request the host turned away halts with the reason', async () => {
  let inSession = true;
  const fetch = microsoft();
  const store = memoryStore({ ...RECORD });
  const env = host({ store, fetch, session: async () => inSession });
  const api = await hostServer(env.instance);
  const transport = createCloudHostTransport({ fetchImpl: pageFetch(api).fetchImpl });
  try {
    const refusal = (code, extra = {}) => (error) => error instanceof CloudBackupError && error.code === code
      && Object.entries(extra).every(([key, value]) => (value instanceof RegExp ? value.test(error[key]) : error[key] === value));
    await assert.rejects(transport.list({ connection: 'd'.repeat(32) }), refusal('needs-consent'));
    await assert.rejects(transport.list({}), refusal('invalid'));
    fetch.routes.unshift({ method: 'GET', url: /\/children\?/, reply: () => json(429, {}, { 'retry-after': '7' }) });
    await assert.rejects(transport.list({ connection: RECORD.connection }), refusal('unavailable', { retryAfterMs: 7000 }));

    inSession = false;
    const session = /could not confirm that this browser runs in the Windows account that started it/;
    const away = await transport.status();
    assert.deepEqual([away.enabled, away.state, away.connection], [true, 'unavailable', null], 'cloud backup is here, but not for this browser');
    assert.match(away.message, session);
    await assert.rejects(transport.list({ connection: RECORD.connection }), refusal('refused', { message: session }));
    inSession = true;

    const elsewhere = createCloudHostTransport({ fetchImpl: pageFetch(api, { origin: `http://localhost:${api.port}` }).fetchImpl });
    assert.match((await elsewhere.status()).message, /only in Recap Page opened at http:\/\/127\.0\.0\.1:8787/);
    await assert.rejects(elsewhere.list({ connection: RECORD.connection }), refusal('refused', { message: /opened at http:\/\/127\.0\.0\.1:8787/ }));
    assert.equal(store.saved.connection, RECORD.connection, 'nothing a refusal answered changed the connection');
  } finally {
    env.instance.close();
    await api.close();
  }

  const restricted = memoryStore({ ...RECORD });
  restricted.faults.load = new CloudTokenError('language');
  const limited = host({ store: restricted });
  const limitedApi = await hostServer(limited.instance);
  try {
    const transportHere = createCloudHostTransport({ fetchImpl: pageFetch(limitedApi).fetchImpl });
    const status = await transportHere.status();
    assert.deepEqual([status.state, status.provider], ['unavailable', 'onedrive']);
    assert.match(status.message, /restricting PowerShell/);
    await assert.rejects(transportHere.connect(), (error) => error instanceof CloudBackupError && error.code === 'language' && /restricting PowerShell/.test(error.message));
  } finally {
    limited.instance.close();
    await limitedApi.close();
  }
});

test('a build without cloud backup, a server that is not this app\'s and no answer at all read as not enabled', async () => {
  assert.equal(process.env.MRT_CLOUD_CLIENT_CONFIG, undefined, 'this checkout carries no client configuration');
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const dormant = createCloudHostTransport({ fetchImpl: (path, init) => globalThis.fetch(`http://127.0.0.1:${port}${path}`, init) });
    assert.deepEqual(await dormant.status(), { enabled: false });
    await assert.rejects(dormant.list({ connection: RECORD.connection }), { code: 'unavailable', message: /not part of this build/ });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const answering = (respond) => createCloudHostTransport({ fetchImpl: async () => respond() });
  const text = (status) => () => new Response('Not here', { status, headers: { 'content-type': 'text/plain' } });
  const body = (status, value) => () => json(status, value);
  const notEnabled = [
    [() => { throw new TypeError('fetch failed'); }, 'unavailable'],
    [text(405), 'invalid'],
    [body(200, { hello: 'world' }), 'invalid'],
    [body(200, { ok: true, status: { state: 'somewhere else' } }), 'invalid'],
  ];
  for (const [respond, code] of notEnabled) {
    assert.deepEqual(await answering(respond).status(), { enabled: false }, String(respond));
    await assert.rejects(answering(respond).list({ connection: RECORD.connection }), { code }, String(respond));
  }
  await assert.rejects(answering(body(200, { ok: true, items: 'many' })).list({ connection: RECORD.connection }), { code: 'invalid' });
  await assert.rejects(answering(body(200, { ok: true, bytes: '***' })).read('ITEM!7', { connection: RECORD.connection }), { code: 'invalid' });
  await assert.rejects(answering(body(200, { ok: true })).read('ITEM!7', { connection: RECORD.connection }), { code: 'invalid' });

  const busy = body(429, { ok: false, error: { code: 'unavailable', message: 'Too many cloud requests at once.' } });
  assert.deepEqual(await answering(busy).status(), {
    enabled: true, provider: null, state: 'unavailable', connection: null, account: null,
    message: 'The Recap Page app is busy. Try again in a moment.', reason: null, signInExpiresAt: null,
  });
  await assert.rejects(answering(busy).list({ connection: RECORD.connection }), { code: 'unavailable' });
  const full = body(200, { ok: false, error: { code: 'quota', message: 'OneDrive is full.', retryAfterMs: 5 } });
  await assert.rejects(answering(full).create(NAME, new Uint8Array([1]), { connection: RECORD.connection }),
    (error) => error.code === 'quota' && error.message === 'OneDrive is full.' && error.retryAfterMs === 5);
  await assert.rejects(answering(body(200, { ok: false, error: { code: 7 } })).delete('ITEM!7', { connection: RECORD.connection }), { code: 'failed' });

  // A host that never answers, or stops partway through its answer, is given up on at the engine's
  // deadline and the grace, and a status that never comes reads as not enabled.
  const silent = createCloudHostTransport({
    deadlines: { list: 30, read: 30, create: 30, delete: 30 }, graceMs: 0, accountMs: 30,
    fetchImpl: async (path, init) => {
      if (path.endsWith('read')) {
        return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(init.signal.reason)); } }), { status: 200 });
      }
      return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
    },
  });
  assert.deepEqual(await silent.status(), { enabled: false });
  await assert.rejects(silent.list({ connection: RECORD.connection }), { code: 'timeout' });
  await assert.rejects(silent.read('ITEM!7', { connection: RECORD.connection }), { code: 'timeout' });
});
