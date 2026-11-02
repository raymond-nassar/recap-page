// Google Drive for the Windows host (#810, P04): the provider module against Google's endpoints held in
// memory, and the host connecting to it. Nothing here reaches Google, and every client value is a
// placeholder: a real secret must never be written into the repository.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { CLOUD_CLIENT_FORMAT, parseCloudClient } from '../host/cloudConfig.mjs';
import { CLOUD_API_HEADER, CLOUD_API_PREFIX, createCloudHost } from '../host/cloudHost.mjs';
import {
  DRIVE, DRIVE_UPLOAD, FOLDER_NAME, FOLDER_TYPE, GOOGLE_AUTHORIZE, GOOGLE_SCOPE, GOOGLE_TOKEN, MAX_ITEM_BYTES, MAX_UNSETTLED,
  authorizationUrl, createGoogleDrive, createUploadTracker, driveHeaders, grantsDriveFile, redeemCode, refreshTokens,
} from '../host/googleDrive.mjs';

const ONEDRIVE_CLIENT = 'test-client.recap-page';
const GOOGLE_CLIENT = 'placeholder.apps.googleusercontent.com';
const GOOGLE_SECRET = 'placeholder-desktop-secret';
const NAME = `recap-page-backup-v1-${'a'.repeat(32)}-7.json.gz`;
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-one';
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

function clientText(googledrive) {
  return JSON.stringify({
    format: CLOUD_CLIENT_FORMAT, version: 1,
    providers: { onedrive: { clientId: ONEDRIVE_CLIENT, authority: 'consumers' }, ...(googledrive ? { googledrive } : {}) },
  });
}

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

// Google's token and Drive endpoints, with one account's Drive in memory. Every call is kept, with
// whether it carried an Authorization header. `answers` replaces the answer for a kind of call once.
function google({ scope = GOOGLE_SCOPE, permissionId = 'perm-one', email = 'reader@example.test' } = {}) {
  const state = { folders: [], items: [], next: 1, uploads: new Map(), revoked: [], answers: {}, refreshes: 0 };
  const calls = [];
  const newId = (prefix) => `${prefix}${state.next++}`;
  const once = (kind) => {
    const answer = state.answers[kind];
    if (answer === undefined) return undefined;
    delete state.answers[kind];
    return typeof answer === 'function' ? answer() : answer;
  };
  async function fetchImpl(target, options = {}) {
    const url = new URL(String(target));
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    const call = { method, url: url.href, authorization: headers.get('authorization'), range: headers.get('content-range'), body };
    calls.push(call);
    const form = () => Object.fromEntries(new URLSearchParams(body.toString('utf8')));
    if (url.href === GOOGLE_TOKEN) {
      const fields = form();
      const special = once(fields.grant_type);
      if (special) return special;
      if (fields.grant_type === 'refresh_token') {
        state.refreshes += 1;
        return json(200, { access_token: `access-${state.refreshes + 1}`, expires_in: 3599, scope, token_type: 'Bearer' });
      }
      return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3599, scope, token_type: 'Bearer' });
    }
    // Revoking at Google ends the grant for every client of the project, so on every path it must never
    // be asked for; any request that could be one is recorded for the tests to refuse.
    if (/revoke/i.test(url.href)) {
      state.revoked.push(url.href);
      return new Response(null, { status: 200 });
    }
    if (url.href === UPLOAD || url.href.startsWith(`${UPLOAD}&`)) {
      const special = once(call.range ? 'status' : 'put');
      if (special instanceof Error) throw special;
      if (special) return special;
      const pending = state.uploads.get(UPLOAD);
      if (!pending) return json(404, { error: { code: 404 } });
      const made = { id: newId('FILE'), name: pending.name, parents: pending.parents, size: String(call.range ? pending.size : body.length), createdTime: '2026-11-01T20:00:00.000Z' };
      if (!state.items.some((entry) => entry.id === pending.madeId)) {
        pending.madeId = made.id;
        state.items.push({ ...made, trashed: false });
      }
      const kept = state.items.find((entry) => entry.id === pending.madeId);
      return json(200, { id: kept.id, name: kept.name, size: kept.size, createdTime: kept.createdTime, parents: kept.parents });
    }
    if (!call.authorization) return json(401, { error: { code: 401 } });
    const special = once(`${method} ${url.pathname}`);
    if (special instanceof Error) throw special;
    if (special) return special;
    if (method === 'GET' && url.pathname === '/drive/v3/about') {
      return json(200, { user: { emailAddress: email, displayName: 'Reader', permissionId } });
    }
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q');
      if (q.startsWith('name = ')) {
        const found = state.folders.filter((entry) => !entry.trashed).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
        return json(200, { files: found.map(({ id, createdTime }) => ({ id, createdTime })) });
      }
      const parent = /^'([^']+)' in parents and trashed = false$/.exec(q)?.[1];
      const all = state.items.filter((entry) => entry.parents.includes(parent) && !entry.trashed);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + 2);
      return json(200, {
        files: page.map(({ id, name, size, createdTime }) => ({ id, name, size, createdTime })),
        ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}),
      });
    }
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      const sent = JSON.parse(body.toString('utf8'));
      const folder = { id: newId('FOLDER'), name: sent.name, mimeType: sent.mimeType, parents: sent.parents, createdTime: `2026-11-01T20:00:0${state.next}.000Z`, trashed: false };
      state.folders.push(folder);
      return json(200, { id: folder.id });
    }
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const sent = JSON.parse(body.toString('utf8'));
      if (!state.folders.some((entry) => sent.parents.includes(entry.id) && !entry.trashed)) return json(404, { error: { code: 404 } });
      state.uploads.set(UPLOAD, { name: sent.name, parents: sent.parents, size: Number(headers.get('x-upload-content-length')) });
      return new Response(null, { status: 200, headers: { location: UPLOAD } });
    }
    const fileId = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (fileId) {
      const folder = state.folders.find((entry) => entry.id === fileId);
      const entry = folder ?? state.items.find((candidate) => candidate.id === fileId);
      if (!entry) return json(404, { error: { code: 404 } });
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return new Response(Buffer.from(`bytes of ${entry.name}`), { status: 200 });
      if (method === 'GET') return json(200, { id: entry.id, trashed: entry.trashed });
      if (method === 'PATCH') {
        Object.assign(entry, JSON.parse(body.toString('utf8')));
        return json(200, { id: entry.id });
      }
    }
    return json(418, { error: 'unrouted' });
  }
  return { fetchImpl, calls, state };
}

function drive(fake, options = {}) {
  const renewals = [];
  const service = createGoogleDrive({
    fetchImpl: fake.fetchImpl,
    accessToken: async ({ renew = false } = {}) => { renewals.push(renew); return renew ? 'access-renewed' : 'access-1'; },
    ...options,
  });
  return { service, renewals };
}

// ------------------------------------------------------------------ configuration

test('a Google Drive registration is optional, and accepted only in the exact shape this version writes', () => {
  assert.equal(parseCloudClient(clientText()).providers.googledrive, undefined);
  const windows = parseCloudClient(clientText({ windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET } }));
  assert.deepEqual(windows.providers.googledrive, { windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET } });
  assert.ok(Object.isFrozen(windows.providers.googledrive) && Object.isFrozen(windows.providers.googledrive.windows));
  const unusable = [
    {}, { clientId: GOOGLE_CLIENT }, { windows: { clientId: GOOGLE_CLIENT } },
    { windows: { clientId: GOOGLE_CLIENT, clientSecret: 'short' } },
    { windows: { clientId: GOOGLE_CLIENT, clientSecret: 'has a space in it' } },
    { windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET, extra: 1 } },
    { android: { release: GOOGLE_CLIENT } },
    { windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET }, android: { release: GOOGLE_CLIENT } },
    { windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET }, ios: { clientId: GOOGLE_CLIENT } },
  ];
  for (const entry of unusable) assert.throws(() => parseCloudClient(clientText(entry)), { code: 'invalid-config' }, JSON.stringify(entry));
});

// ------------------------------------------------------------------ sign-in

test('the sign-in asks for drive.file alone, offline, with PKCE, and the grant is read rather than assumed', () => {
  const url = new URL(authorizationUrl({
    clientId: GOOGLE_CLIENT, redirectUri: 'http://127.0.0.1:50123/',
    authorization: { state: 'state-1', challenge: 'challenge-1', nonce: 'nonce-1' },
  }));
  assert.equal(`${url.origin}${url.pathname}`, GOOGLE_AUTHORIZE);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: GOOGLE_CLIENT, response_type: 'code', redirect_uri: 'http://127.0.0.1:50123/', scope: GOOGLE_SCOPE,
    state: 'state-1', code_challenge: 'challenge-1', code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account',
  });
  assert.ok(grantsDriveFile(`openid ${GOOGLE_SCOPE}`));
  assert.ok(!grantsDriveFile('https://www.googleapis.com/auth/drive.appdata'));
  assert.ok(!grantsDriveFile(`${GOOGLE_SCOPE}.readonly`), 'a longer scope that starts the same is not the scope');
  assert.ok(!grantsDriveFile(''));
});

test('the token request carries the secret and the verifier, and each refusal maps to what follows it', async () => {
  const fake = google();
  const tokens = await redeemCode({ fetchImpl: fake.fetchImpl, clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET, code: 'code-1', verifier: 'verifier-1', redirectUri: 'http://127.0.0.1:1/' });
  assert.deepEqual(tokens, { accessToken: 'access-1', refreshToken: 'refresh-1', scope: GOOGLE_SCOPE, expiresInMs: 3_599_000 });
  const form = Object.fromEntries(new URLSearchParams(fake.calls[0].body.toString('utf8')));
  assert.deepEqual(form, {
    client_id: GOOGLE_CLIENT, client_secret: GOOGLE_SECRET, grant_type: 'authorization_code', code: 'code-1',
    redirect_uri: 'http://127.0.0.1:1/', code_verifier: 'verifier-1',
  });
  const renewed = await refreshTokens({ fetchImpl: fake.fetchImpl, clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET, refreshToken: 'refresh-1' });
  assert.equal(renewed.refreshToken, null, 'Google sends no new refresh token, so the caller keeps its own');
  const cases = [
    [json(400, { error: 'invalid_grant' }), 'refused'],
    [json(401, { error: 'invalid_client' }), 'refused'],
    [json(429, {}, { 'retry-after': '7' }), 'unavailable'],
    [json(503, {}), 'unavailable'],
    [json(500, {}), 'unavailable'],
    [json(200, { expires_in: 3599 }), 'invalid'],
  ];
  for (const [answer, code] of cases) {
    fake.state.answers.refresh_token = answer;
    await assert.rejects(refreshTokens({ fetchImpl: fake.fetchImpl, clientId: GOOGLE_CLIENT, refreshToken: 'refresh-1' }), { code }, `${answer.status} is ${code}`);
  }
  fake.state.answers.refresh_token = json(429, {}, { 'retry-after': '7' });
  await assert.rejects(refreshTokens({ fetchImpl: fake.fetchImpl, clientId: GOOGLE_CLIENT, refreshToken: 'refresh-1', clock: () => 0 }), { retryAfterMs: 7000 });
});

// ------------------------------------------------------------------ the drive

test('a Drive request carries exactly one Authorization, the host\'s, and refuses a caller\'s in any case', () => {
  assert.deepEqual(driveHeaders({ accept: 'application/json' }, 'token-1'), { accept: 'application/json', authorization: 'Bearer token-1' });
  for (const name of ['authorization', 'Authorization', 'AUTHORIZATION']) assert.throws(() => driveHeaders({ [name]: 'x' }, 'token-1'), TypeError);
});

test('the account is named by Drive itself, and no folder lists as empty without making one', async () => {
  const fake = google();
  const { service } = drive(fake);
  assert.deepEqual(await service.identify(), { account: 'google:perm-one', hint: 'reader@example.test', folder: null });
  assert.deepEqual(await service.list(), []);
  assert.equal(fake.state.folders.length, 0, 'listing never makes the folder');
  const unnamed = google({ permissionId: '' });
  await assert.rejects(drive(unnamed).service.identify(), { code: 'invalid' });
});

test('creating makes one visible Recap Page folder at the top of the Drive, uploads without Authorization, and lists every page', async () => {
  const fake = google();
  const learned = [];
  const { service } = drive(fake, { onFolder: (id) => learned.push(id) });
  const created = await service.create(NAME, Buffer.from('hello'));
  assert.equal(created.name, NAME);
  assert.equal(created.size, 5);
  assert.equal(fake.state.folders.length, 1);
  assert.deepEqual([fake.state.folders[0].name, fake.state.folders[0].mimeType, fake.state.folders[0].parents], [FOLDER_NAME, FOLDER_TYPE, ['root']]);
  assert.deepEqual(learned, [fake.state.folders[0].id]);
  const put = fake.calls.find((call) => call.method === 'PUT');
  assert.equal(put.authorization, null, 'the upload address is the capability, and carries no token');
  const opened = fake.calls.find((call) => call.url.startsWith(`${DRIVE_UPLOAD}/files?uploadType=resumable`));
  assert.ok(opened.authorization.startsWith('Bearer '));
  for (let more = 0; more < 4; more += 1) await service.create(`${NAME}.${more}`, Buffer.from('x'));
  assert.equal(fake.state.folders.length, 1, 'the folder is made once');
  const listed = await service.list();
  assert.equal(listed.length, 5, 'all three pages');
  assert.ok(fake.calls.filter((call) => call.url.includes('pageToken=')).length >= 2);
  assert.ok(listed.every((entry) => typeof entry.size === 'number' && typeof entry.created === 'number'));
});

test('two devices that make the folder at once settle on the older, and the newer empty one goes to the trash', async () => {
  const fake = google();
  fake.state.folders.push({ id: 'OLDER', name: FOLDER_NAME, mimeType: FOLDER_TYPE, parents: ['root'], createdTime: '2026-11-01T00:00:00.000Z', trashed: false });
  // The first search finds nothing, as if the other device's folder arrived just after it.
  fake.state.answers['GET /drive/v3/files'] = json(200, { files: [] });
  const { service } = drive(fake);
  const created = await service.create(NAME, Buffer.from('hello'));
  assert.ok(created);
  const mine = fake.state.folders.find((entry) => entry.id !== 'OLDER');
  assert.equal(mine.trashed, true);
  assert.deepEqual(fake.state.items[0].parents, ['OLDER']);
});

test('a recorded folder that is deleted or in the trash means the person deleted it', async () => {
  const fake = google();
  const { service } = drive(fake);
  await service.create(NAME, Buffer.from('hello'));
  const folder = fake.state.folders[0];
  folder.trashed = true;
  await assert.rejects(service.list(), { code: 'folder-gone' });
  await assert.rejects(drive(fake, { folder: 'GONE' }).service.list(), { code: 'folder-gone' });
  await assert.rejects(drive(fake, { folder: folder.id }).service.create(NAME, Buffer.from('x')), { code: 'folder-gone' });
});

test('an upload whose reply is lost is settled by asking the session, and an unknown outcome is asked again at the next list', async () => {
  const fake = google();
  const tracker = createUploadTracker();
  const { service } = drive(fake, { tracker });
  fake.state.answers.put = new TypeError('connection reset');
  const settled = await service.create(NAME, Buffer.from('hello'));
  assert.equal(settled.name, NAME, 'the session answered with the finished file');
  assert.equal(fake.calls.at(-1).range, 'bytes */5');
  assert.equal(fake.calls.at(-1).authorization, null);

  fake.state.answers.put = json(503, {});
  fake.state.answers.status = new Response(null, { status: 308 });
  await assert.rejects(service.create(`${NAME}.2`, Buffer.from('x')), { code: 'unavailable' }, 'a session still missing bytes never completes');

  fake.state.answers.put = new TypeError('connection reset');
  fake.state.answers.status = new TypeError('connection reset');
  await assert.rejects(service.create(`${NAME}.3`, Buffer.from('x')), { code: 'timeout' });
  assert.equal(tracker.unsettled.size, 1);
  await service.list();
  assert.equal(tracker.unsettled.size, 0, 'the next list settled it first');

  fake.state.answers.put = new Response('{"id":', { status: 200 });
  fake.state.answers.status = json(200, { name: NAME });
  await assert.rejects(service.create(`${NAME}.5`, Buffer.from('x')), { code: 'timeout' }, 'a complete upload with an unreadable answer is never refused');
  assert.equal(tracker.unsettled.size, 0, 'and, being complete, is not asked about again');

  for (let index = 0; index <= MAX_UNSETTLED; index += 1) {
    fake.state.answers.put = new TypeError('connection reset');
    fake.state.answers.status = new TypeError('connection reset');
    await assert.rejects(service.create(`${NAME}.u${index}`, Buffer.from('x')), { code: 'timeout' });
  }
  assert.equal(tracker.unsettled.size, MAX_UNSETTLED, 'only the newest unsettled sessions are kept');
  assert.ok(!tracker.unsettled.has(`${NAME}.u0`) && tracker.unsettled.has(`${NAME}.u${MAX_UNSETTLED}`), 'the oldest gives way');

  fake.state.answers.put = json(400, { error: { errors: [{ reason: 'badRequest' }] } });
  await assert.rejects(service.create(`${NAME}.4`, Buffer.from('x')), { code: 'invalid' }, 'a definite refusal is not settled');
});

test('reading is capped, deleting puts the item in the trash, and an item already gone counts as deleted', async () => {
  const fake = google();
  const { service } = drive(fake);
  const created = await service.create(NAME, Buffer.from('hello'));
  assert.equal((await service.read(created.id)).toString('utf8'), `bytes of ${NAME}`);
  fake.state.answers[`GET /drive/v3/files/${created.id}`] = new Response('x', { status: 200, headers: { 'content-length': String(MAX_ITEM_BYTES + 1) } });
  await assert.rejects(service.read(created.id), { code: 'too-large' });
  await service.delete(created.id);
  assert.equal(fake.state.items[0].trashed, true);
  assert.deepEqual(await service.list(), []);
  await service.delete('NO-SUCH-ITEM');
  await assert.rejects(service.read('NO-SUCH-ITEM'), { code: 'not-found' });
});

test('Drive\'s reasons for a 403 are read, and a second 401 needs a sign-in', async () => {
  const fake = google();
  const { service, renewals } = drive(fake);
  const reasons = [['storageQuotaExceeded', 'quota'], ['userRateLimitExceeded', 'unavailable'], ['rateLimitExceeded', 'unavailable'], ['insufficientFilePermissions', 'refused']];
  for (const [reason, code] of reasons) {
    fake.state.answers['GET /drive/v3/about'] = json(403, { error: { errors: [{ reason }] } });
    await assert.rejects(service.identify(), { code }, reason);
  }
  fake.state.answers['GET /drive/v3/about'] = json(429, {}, { 'retry-after': '3' });
  await assert.rejects(service.identify(), { code: 'unavailable' });
  renewals.length = 0;
  let unauthorized = 0;
  fake.state.answers['GET /drive/v3/about'] = () => { unauthorized += 1; fake.state.answers['GET /drive/v3/about'] = json(401, {}); return json(401, {}); };
  await assert.rejects(service.identify(), { code: 'needs-sign-in' });
  assert.deepEqual(renewals, [false, true], 'renewed once, then given up');
  assert.equal(unauthorized, 1);
});

// ------------------------------------------------------------------ the host

function memoryStore() {
  let saved = null;
  return {
    get saved() { return saved === null ? null : structuredClone(saved); },
    async probe() {},
    async exists() { return saved !== null; },
    async load() { return saved === null ? null : structuredClone(saved); },
    async save(record) { saved = structuredClone(record); },
    async clear() { saved = null; },
  };
}

async function hostServer(instance) {
  const server = createServer((req, res) => instance.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const call = (operation, body = {}) => new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, path: `${CLOUD_API_PREFIX}${operation}`, method: 'POST', agent: false,
      headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', [CLOUD_API_HEADER]: '1' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

function callback(redirect, query) {
  const url = new URL(redirect);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: url.port, path: `/?${query}`, headers: { host: url.host }, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

function host({ googledrive = { windows: { clientId: GOOGLE_CLIENT, clientSecret: GOOGLE_SECRET } }, fake = google() } = {}) {
  const opened = [];
  const store = memoryStore();
  const instance = createCloudHost({
    clientText: clientText(googledrive), platform: 'win32', fetchImpl: fake.fetchImpl, store,
    sessionCheck: async () => true, openUrl: async (url) => { opened.push(url); },
  });
  return { instance, store, fake, opened };
}

async function signIn(env, api) {
  const started = await api.call('connect', { provider: 'googledrive' });
  assert.equal(started.status.state, 'signing-in');
  assert.equal(started.status.provider, 'googledrive');
  await until(() => env.opened.length > 0, 'the browser was asked to open the sign-in');
  const url = new URL(env.opened.at(-1));
  const redirect = url.searchParams.get('redirect_uri');
  assert.equal(await callback(redirect, `code=code-1&state=${url.searchParams.get('state')}`), 200);
  await until(async () => (await env.instance.status()).state !== 'signing-in', 'the sign-in finishes');
  return url;
}

test('the host offers Google Drive only when its Windows client is configured, and only one service at a time', async () => {
  for (const googledrive of [null]) {
    const env = host({ googledrive });
    const api = await hostServer(env.instance);
    try {
      const { status } = await api.call('status');
      assert.deepEqual(status.providers, ['onedrive']);
      const refused = await api.call('connect', { provider: 'googledrive' });
      assert.deepEqual([refused.ok, refused.error.code], [false, 'invalid']);
      assert.equal(env.opened.length, 0);
    } finally {
      env.instance.close();
      await api.close();
    }
  }
  const env = host();
  const api = await hostServer(env.instance);
  try {
    const { status } = await api.call('status');
    assert.deepEqual([status.provider, status.providers, status.state], ['onedrive', ['onedrive', 'googledrive'], 'not-connected']);
    for (const provider of [7, 'icloud', '__proto__', 'constructor']) {
      assert.equal((await api.call('connect', { provider })).error.code, 'invalid', String(provider));
    }
    await signIn(env, api);
    const other = await api.call('connect', { provider: 'onedrive' });
    assert.deepEqual([other.ok, other.error.code], [false, 'invalid']);
    assert.equal(env.opened.length, 1, 'no second sign-in started');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('connecting to Google Drive signs in on the loopback address, keeps only protected tokens, and disconnecting forgets it on this computer alone', async () => {
  const env = host();
  const api = await hostServer(env.instance);
  try {
    const url = await signIn(env, api);
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(redirect.hostname, '127.0.0.1', 'Google prefers the loopback address for a desktop app');
    assert.equal(url.searchParams.get('scope'), GOOGLE_SCOPE);
    const { status } = await api.call('status');
    assert.deepEqual([status.provider, status.state, status.account], ['googledrive', 'connected', 'reader@example.test']);
    const tokenCall = env.fake.calls.find((call) => call.url === GOOGLE_TOKEN);
    const form = Object.fromEntries(new URLSearchParams(tokenCall.body.toString('utf8')));
    assert.equal(form.client_secret, GOOGLE_SECRET);
    assert.equal(createHash('sha256').update(form.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.deepEqual(env.store.saved, {
      version: 1, provider: 'googledrive', connection: status.connection, account: { id: 'google:perm-one', hint: 'reader@example.test' },
      folder: null, refreshToken: 'refresh-1', savedAt: env.store.saved.savedAt,
    });
    const created = await api.call('create', { connection: status.connection, name: NAME, bytes: Buffer.from('hello').toString('base64') });
    assert.equal(created.item.name, NAME);
    const listed = await api.call('list', { connection: status.connection });
    assert.deepEqual(listed.items.map((entry) => entry.name), [NAME]);
    await until(() => env.store.saved.folder !== null, 'the folder id is learned');
    for (const answer of [status, created, listed]) assert.ok(!/access-|refresh-|placeholder-desktop/.test(JSON.stringify(answer)), 'no token or secret reaches the page');

    // A create left unsettled belongs to this sign-in, and is not asked about once it is gone.
    env.fake.state.answers.put = new TypeError('connection reset');
    env.fake.state.answers.status = new TypeError('connection reset');
    assert.equal((await api.call('create', { connection: status.connection, name: `${NAME}.2`, bytes: 'eA==' })).error.code, 'timeout');
    const before = env.fake.calls.length;
    const gone = await api.call('disconnect');
    assert.equal(gone.status.state, 'not-connected');
    assert.equal(env.store.saved, null);
    await settle();
    assert.equal(env.fake.calls.length, before, 'disconnecting sends nothing to Google');
    assert.deepEqual(env.fake.state.revoked, [], 'revoking would end the grant on the person\'s other devices too');
    await signIn(env, api);
    const again = (await api.call('status')).status;
    const after = env.fake.calls.length;
    assert.equal((await api.call('list', { connection: again.connection })).ok, true);
    assert.ok(!env.fake.calls.slice(after).some((call) => call.range), 'the earlier sign-in\'s session is not asked about');
    assert.deepEqual(env.fake.state.revoked, []);
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a Google grant without drive.file counts as not signed in, and is neither kept nor revoked', async () => {
  const env = host({ fake: google({ scope: 'https://www.googleapis.com/auth/drive.appdata' }) });
  const api = await hostServer(env.instance);
  try {
    await signIn(env, api);
    const { status } = await api.call('status');
    assert.deepEqual([status.state, status.message], ['not-connected', 'Google did not grant the access cloud backup needs.']);
    assert.equal(env.store.saved, null);
    assert.deepEqual(env.fake.state.revoked, []);
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a renewal keeps the refresh token Google does not resend, and a refused one names Google', async () => {
  const env = host();
  const api = await hostServer(env.instance);
  try {
    await signIn(env, api);
    const { status } = await api.call('status');
    // The token from the sign-in is good for an hour; a 401 makes the host renew at once.
    env.fake.state.answers['GET /drive/v3/files'] = json(401, {});
    await api.call('list', { connection: status.connection });
    assert.equal(env.fake.state.refreshes, 1);
    assert.equal(env.store.saved.refreshToken, 'refresh-1');
    env.fake.state.answers['GET /drive/v3/files'] = json(401, {});
    env.fake.state.answers.refresh_token = json(400, { error: 'invalid_grant' });
    const refused = await api.call('list', { connection: status.connection });
    assert.equal(refused.error.code, 'needs-sign-in');
    assert.match(refused.error.message, /^Google asked for the sign-in to be made again/);
    const after = (await api.call('status')).status;
    assert.equal(after.state, 'needs-sign-in');
    const again = await api.call('list', { connection: status.connection });
    assert.equal(again.error.message, 'Sign in to Google Drive again to keep backing up.');
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('a deleted Recap Page folder in Google Drive asks every browser again, in Google Drive\'s name', async () => {
  const env = host();
  const api = await hostServer(env.instance);
  try {
    await signIn(env, api);
    const { status } = await api.call('status');
    await api.call('create', { connection: status.connection, name: NAME, bytes: Buffer.from('hello').toString('base64') });
    await until(() => env.store.saved.folder !== null, 'the folder id is learned');
    env.fake.state.folders[0].trashed = true;
    const refused = await api.call('list', { connection: status.connection });
    assert.equal(refused.error.code, 'needs-consent');
    assert.equal(refused.error.message, 'The Recap Page folder was deleted from Google Drive, so cloud backup asks again before it makes a new one.');
    const after = (await api.call('status')).status;
    assert.notEqual(after.connection, status.connection);
    assert.equal(after.reason, refused.error.message);
  } finally {
    env.instance.close();
    await api.close();
  }
});

test('no path in the Windows host can revoke a Google grant', async () => {
  // Revoking at Google ends the grant for every client of the project, so one computer disconnecting
  // would sign the person's phone out too. The behavior is pinned above; this pins the code itself.
  for (const file of ['../host/googleDrive.mjs', '../host/cloudHost.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /oauth2\/revoke|googleapis\.com\/revoke|\/revoke\b/, file);
  }
});

test('Drive endpoints named here are Google\'s own', () => {
  assert.equal(DRIVE, 'https://www.googleapis.com/drive/v3');
  assert.equal(DRIVE_UPLOAD, 'https://www.googleapis.com/upload/drive/v3');
});
