// The cloud control API: what the page asks of the Windows host, under one prefix on the app's own origin
// (#810, P02-T01 section 3.6). The host holds the OneDrive connection for this Windows account. The page
// never receives a token: it asks the host to connect, disconnect and report status, and to list, read,
// create and delete in the app's own folder, which is the transport the shared protocol runs over.
//
// Who may ask (P02-T01 section 3.8). Only a POST from the app's own origin, naming this server in its Host
// header, with a JSON body and a custom header, is answered. A page from any other origin cannot send that
// without a CORS preflight, and this host never approves one; the Host check defeats DNS rebinding; and the
// calling process must be in this server's Windows session, which the operating system answers. No
// response carries CORS headers, so nothing here is readable from another origin.
//
// A connection belongs to this Windows account and is shared by every browser profile that talks to the
// host. Each data request names the connection the page was given, and a request for any other is
// refused, so a page whose consent was for one account can never write to another that was connected
// since, from this profile or any other.

import { randomBytes } from 'node:crypto';
import { parseCloudClient } from './cloudConfig.mjs';
import { createSessionCheck } from './cloudSession.mjs';
import { CloudTokenError, createProtector, createTokenStore, tokenDirectory } from './cloudTokens.mjs';
import { ProviderError, SIGN_IN_MS, newAuthorization, openBrowser, startCallback } from './cloudSignIn.mjs';
import {
  MAX_ITEM_BYTES, authorizationUrl, createOneDrive, createUploadTracker, grantsAppFolder, idTokenClaims, redeemCode, refreshTokens,
} from './oneDrive.mjs';

export const CLOUD_API_PREFIX = '/__recap_cloud__/v1/';
export const CLOUD_API_HEADER = 'x-recap-cloud';
export const CLOUD_API_OPERATIONS = Object.freeze(['status', 'connect', 'disconnect', 'list', 'read', 'create', 'delete']);
const OPERATIONS = new Set(CLOUD_API_OPERATIONS);
const SMALL_BODY = 16 * 1024;
const CREATE_BODY = Math.ceil(MAX_ITEM_BYTES / 3) * 4 + 16 * 1024;
const MAX_IN_FLIGHT = 16;
// The longest each data operation may take here, from the token store through every request, each five
// seconds inside the deadline the page's engine states for it (CLOUD_TRANSPORT_DEADLINES_MS in
// src/js/lib/cloudProtocol.js), so the page always hears an answer before it gives up. A test holds the two
// together. Work cut off this way goes on behind the answer: a create keeps its place in the upload
// tracker, so the next list still waits for it or cancels it.
export const HOST_DEADLINES_MS = Object.freeze({ list: 115_000, read: 595_000, create: 595_000, delete: 25_000 });
const CONNECTION = /^[a-f0-9]{32}$/;
const ITEM_ID = /^[A-Za-z0-9!._-]{1,256}$/;
// Only names of the shape the backup protocol writes, so nothing reaching this API can put any other kind
// of file in the person's account, or a path where a name belongs.
const ITEM_NAME = /^recap-page-[a-z0-9][a-z0-9.-]{0,118}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const JSON_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
const HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
});

const SIGN_IN_ENDED = Object.freeze({
  declined: 'Sign-in was cancelled.',
  refused: 'Microsoft did not complete the sign-in.',
  expired: 'Sign-in did not finish within five minutes. Start it again when you are ready.',
  cancelled: 'Sign-in was cancelled.',
  invalid: 'Sign-in was stopped after answers it did not expect.',
  failed: 'Sign-in stopped unexpectedly.',
});
const CONNECTED_AGAIN = 'Cloud backup was connected again since this browser agreed to it, so it asks again first.';

function send(res, status, body, extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function createCloudHost({
  clientText, client = parseCloudClient(clientText),
  env = process.env, platform = process.platform, fetchImpl = globalThis.fetch, spawnImpl,
  store = createTokenStore({ directory: tokenDirectory(env), protector: createProtector({ platform, spawnImpl }) }),
  sessionCheck = createSessionCheck({ platform }),
  openUrl = (url) => openBrowser(url, { platform, spawnImpl }),
  clock = Date.now, random = randomBytes, signInMs = SIGN_IN_MS, deadlines = HOST_DEADLINES_MS,
} = {}) {
  const clientId = client.providers.onedrive.clientId;
  const tracker = createUploadTracker();
  let loading = null;
  let record = null;
  let unavailable = platform === 'win32' ? null : new CloudTokenError('platform');
  let message = null;
  let signIn = null;
  let access = null;
  let refreshing = null;
  let epoch = 0;
  let inFlight = 0;
  let queue = Promise.resolve();
  // Every change to the stored sign-in, in order, so a refresh that finishes after a disconnect can never
  // write the connection back.
  const serial = (operation) => {
    const run = queue.then(operation);
    queue = run.catch(() => {});
    return run;
  };

  // The stored sign-in is read once, when it is first needed, and only if one exists, so a computer that
  // never connected never starts PowerShell. A read that timed out is tried again next time.
  function load() {
    if (unavailable) return Promise.resolve();
    loading ??= (async () => {
      try {
        record = (await store.exists()) ? await store.load() : null;
      } catch (error) {
        if (error?.code === 'language' || error?.code === 'platform') {
          unavailable = error;
        } else if (error?.code === 'unreadable' || error?.code === 'invalid') {
          // A sign-in this Windows account cannot read is no use to anyone; a new one is asked for.
          record = null;
          message = error.message;
          await store.clear().catch(() => {});
        } else {
          loading = null;
          throw error;
        }
      }
    })();
    return loading;
  }

  async function status() {
    let failed = null;
    await load().catch((error) => { failed = error; });
    const problem = unavailable ?? failed;
    const state = problem ? 'unavailable' : signIn ? 'signing-in' : !record ? 'not-connected'
      : record.refreshToken ? 'connected' : 'needs-sign-in';
    return {
      provider: 'onedrive', state,
      connection: problem ? null : record?.connection ?? null,
      account: problem ? null : record?.account.hint ?? null,
      message: problem?.message ?? message,
      signInExpiresAt: signIn?.expiresAt ?? null,
    };
  }

  async function signInJob(job) {
    const started = epoch;
    const authorization = newAuthorization(random);
    const callback = await startCallback({ authorization, timeoutMs: signInMs });
    job.close = callback.close;
    try {
      if (signIn !== job) return;
      await openUrl(authorizationUrl({ clientId, redirectUri: callback.redirectUri, authorization }));
      const answer = await callback.result;
      if (answer.error) throw new ProviderError(answer.error, SIGN_IN_ENDED[answer.error] ?? SIGN_IN_ENDED.failed);
      const tokens = await redeemCode({ fetchImpl, clientId, clock, code: answer.code, verifier: authorization.verifier, redirectUri: callback.redirectUri });
      if (!tokens.refreshToken || !grantsAppFolder(tokens.scope)) {
        throw new ProviderError('refused', 'Microsoft did not grant the access cloud backup needs.');
      }
      const claims = idTokenClaims(tokens.idToken, { clientId, nonce: authorization.nonce, now: clock() });
      const folder = await createOneDrive({ fetchImpl, clock, accessToken: async () => tokens.accessToken }).appFolder();
      // The drive names the account. If the app folder is not there to report it, the account's own id
      // stands in, which can only ever ask the browsers for their consent again, never skip it.
      const account = folder.driveId ? `drive:${folder.driveId}` : `subject:${claims.subject}`;
      await serial(async () => {
        if (epoch !== started || signIn !== job) return;
        const previous = record;
        const next = {
          version: 1, provider: 'onedrive',
          connection: previous?.account.id === account ? previous.connection : Buffer.from(random(16)).toString('hex'),
          account: { id: account, hint: claims.hint }, refreshToken: tokens.refreshToken, savedAt: Math.floor(clock()),
        };
        await store.save(next);
        record = next;
        access = { token: tokens.accessToken, expiresAt: clock() + tokens.expiresInMs, connection: next.connection };
        message = null;
      });
    } finally {
      callback.close();
    }
  }

  async function connect() {
    await load();
    if (unavailable) throw unavailable;
    if (!signIn && !record?.refreshToken) {
      const job = { expiresAt: Math.floor(clock() + signInMs), close: () => {} };
      signIn = job;
      message = null;
      signInJob(job)
        .catch((error) => { if (signIn === job) message = error?.message ?? SIGN_IN_ENDED.failed; })
        .finally(() => { if (signIn === job) signIn = null; });
    }
    return status();
  }

  // Disconnecting works even where the sign-in cannot be read, so erase can always remove it.
  async function disconnect() {
    epoch += 1;
    const job = signIn;
    signIn = null;
    job?.close();
    access = null;
    await serial(async () => {
      await store.clear();
      record = null;
    });
    message = null;
    return status();
  }

  async function renewal(current) {
    const started = epoch;
    let tokens;
    try {
      tokens = await refreshTokens({ fetchImpl, clientId, clock, refreshToken: current.refreshToken });
    } catch (error) {
      if (error?.code !== 'refused') throw error;
      // The refresh token is dead. The connection and the account stay, so signing in again to the same
      // account carries on without any browser having to agree again.
      await serial(async () => {
        if (epoch !== started || record !== current) return;
        const next = { ...current, refreshToken: null, savedAt: Math.floor(clock()) };
        record = next;
        access = null;
        await store.save(next).catch(() => {});
      });
      throw new ProviderError('needs-sign-in', 'Microsoft asked for the sign-in to be made again, so cloud backups have stopped until it is.');
    }
    return serial(async () => {
      if (epoch !== started || record !== current) throw new ProviderError('not-connected', 'Cloud backup was disconnected.');
      // Every refresh returns a new refresh token, which replaces the stored one at once. Should the store
      // fail, the old one still works, because Microsoft does not revoke a refresh token when it is used.
      const next = { ...current, refreshToken: tokens.refreshToken ?? current.refreshToken, savedAt: Math.floor(clock()) };
      await store.save(next).catch(() => {});
      record = next;
      access = { token: tokens.accessToken, expiresAt: clock() + tokens.expiresInMs, connection: next.connection };
      return access.token;
    });
  }

  function tokenFor(connection) {
    return async ({ renew = false } = {}) => {
      const current = record;
      if (!current) throw new ProviderError('not-connected', 'Cloud backup was disconnected.');
      if (current.connection !== connection) throw new ProviderError('needs-consent', CONNECTED_AGAIN);
      if (!current.refreshToken) throw new ProviderError('needs-sign-in', 'Sign in to OneDrive again to keep backing up.');
      if (!renew && access?.connection === connection && access.expiresAt - 60_000 > clock()) return access.token;
      // One refresh at a time for a connection: the second caller waits for the first one's token rather
      // than spending the refresh token the first is about to replace.
      if (refreshing?.connection !== connection) {
        const pending = { connection, promise: renewal(current) };
        refreshing = pending;
        const done = () => { if (refreshing === pending) refreshing = null; };
        pending.promise.then(done, done);
      }
      return refreshing.promise;
    };
  }

  async function drive(input) {
    await load();
    if (unavailable) throw unavailable;
    if (!object(input) || typeof input.connection !== 'string' || !CONNECTION.test(input.connection)) {
      throw new ProviderError('invalid', 'The request did not name a connection.');
    }
    if (!record) throw new ProviderError('not-connected', 'Cloud backup is not connected on this computer.');
    // A different connection than the one this browser agreed to: another profile reconnected the host,
    // perhaps to another account, so this browser has to see what is there and agree again first.
    if (record.connection !== input.connection) throw new ProviderError('needs-consent', CONNECTED_AGAIN);
    if (!record.refreshToken) throw new ProviderError('needs-sign-in', 'Sign in to OneDrive again to keep backing up.');
    return createOneDrive({ fetchImpl, clock, tracker, accessToken: tokenFor(input.connection) });
  }

  function itemId(input) {
    if (typeof input.id !== 'string' || !ITEM_ID.test(input.id)) throw new ProviderError('invalid', 'The request did not name an item.');
    return input.id;
  }

  function within(operation, work) {
    const limit = deadlines[operation];
    let timer;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new ProviderError('timeout', `OneDrive did not finish within ${Math.round(limit / 1000)} seconds.`)), limit);
    });
    const done = work();
    done.catch(() => {});
    return Promise.race([done, late]).finally(() => clearTimeout(timer));
  }

  const operations = {
    status: async () => ({ status: await status() }),
    connect: async () => ({ status: await connect() }),
    disconnect: async () => ({ status: await disconnect() }),
    list: (input) => within('list', async () => ({ items: await (await drive(input)).list() })),
    read: (input) => within('read', async () => {
      const onedrive = await drive(input);
      return { bytes: (await onedrive.read(itemId(input))).toString('base64') };
    }),
    create: (input) => within('create', async () => {
      const onedrive = await drive(input);
      if (typeof input.name !== 'string' || !ITEM_NAME.test(input.name)
        || typeof input.bytes !== 'string' || !BASE64.test(input.bytes)) {
        throw new ProviderError('invalid', 'The request did not hold a backup to create.');
      }
      const bytes = Buffer.from(input.bytes, 'base64');
      if (bytes.length === 0) throw new ProviderError('invalid', 'That backup is empty.');
      if (bytes.length > MAX_ITEM_BYTES) throw new ProviderError('too-large', 'That backup is larger than a cloud backup can be.');
      return { item: await onedrive.create(input.name, bytes) };
    }),
    delete: (input) => within('delete', async () => {
      const onedrive = await drive(input);
      await onedrive.delete(itemId(input));
      return {};
    }),
  };

  async function handle(req, res) {
    const target = String(req.url ?? '');
    const operation = target.startsWith(CLOUD_API_PREFIX) ? target.slice(CLOUD_API_PREFIX.length) : '';
    // Every refusal closes the connection, so a body that was never read cannot be left on it.
    const refuse = (status, code, text, extra = {}) => send(res, status, { ok: false, error: { code, message: text } }, { connection: 'close', ...extra });
    const port = req.socket?.localPort;
    if (req.method !== 'POST') return refuse(405, 'method', 'Only POST is accepted here.', { allow: 'POST' });
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(403, 'host', 'This request did not name this server.');
    if (req.headers.origin !== `http://127.0.0.1:${port}`) return refuse(403, 'origin', 'This request did not come from Recap Page.');
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return refuse(403, 'site', 'This request did not come from Recap Page.');
    if (req.headers[CLOUD_API_HEADER] !== '1') return refuse(403, 'header', 'This request did not come from Recap Page.');
    if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) return refuse(415, 'type', 'Only JSON is accepted here.');
    // After the header checks, which cost nothing, and before anything is read or done: another Windows
    // session's process gets no answer beyond this, and its connection is closed.
    if (!(await sessionCheck(req.socket))) return refuse(403, 'session', 'This request came from another Windows session.');
    if (!OPERATIONS.has(operation)) return refuse(404, 'operation', 'There is no such cloud operation.');
    if (inFlight >= MAX_IN_FLIGHT) return refuse(429, 'unavailable', 'Too many cloud requests at once.');
    inFlight += 1;
    try {
      const text = await readBody(req, operation === 'create' ? CREATE_BODY : SMALL_BODY);
      if (text === null) return refuse(413, 'size', 'That request is larger than this operation accepts.');
      let input;
      try { input = text === '' ? {} : JSON.parse(text); }
      catch { return refuse(400, 'json', 'That request is not readable JSON.'); }
      if (!object(input)) return refuse(400, 'json', 'That request is not a JSON object.');
      try {
        send(res, 200, { ok: true, ...(await operations[operation](input)) });
      } catch (error) {
        const known = error instanceof ProviderError || error instanceof CloudTokenError;
        send(res, 200, {
          ok: false,
          error: {
            code: known ? error.code : 'failed',
            message: known ? error.message : 'Cloud backup stopped unexpectedly.',
            ...(known && error.retryAfterMs > 0 ? { retryAfterMs: error.retryAfterMs } : {}),
          },
        });
      }
    } finally {
      inFlight -= 1;
    }
    return undefined;
  }

  return {
    handle,
    status,
    close() {
      epoch += 1;
      const job = signIn;
      signIn = null;
      job?.close();
    },
  };
}
