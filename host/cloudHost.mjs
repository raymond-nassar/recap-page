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
import { CloudTokenError, createProtector, createTokenStore, lastsForHostLife, tokenDirectory } from './cloudTokens.mjs';
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
// How long a request's body may take to arrive once reading it starts, after which the request is refused
// 408 and its connection closed, so a caller that stalls holds one of the places above for that long at most
// (stage 2 review, S1b). Measured in Edge on this machine, the largest body this host accepts, a 44.7 MB
// create, arrived 35 to 130 ms after its headers, and a 137 KB one in under a millisecond. It comes before an
// operation's own deadline starts, so it is held inside the five seconds that deadline keeps in hand, and a
// test holds that too.
export const HOST_BODY_MS = 5_000;
// At most this many requests in any window of this length, from every caller together, counted as each is
// taken after the checks below; one past it is turned away 429, unread and holding no place, with the time
// until the oldest leaves the window, which the page's backoff honors (stage 2 review, S1b). Measured in Edge,
// the page's own heaviest minute was 380 requests, from three tabs of one profile open through a sign-in into
// an account at discovery's limits (16 devices, four reads each), then turning backups on, Check again,
// deleting this device's backups and disconnecting, all within 40 seconds; one tab alone made 217.
export const HOST_RATE = Object.freeze({ limit: 1_200, windowMs: 60_000 });
const CONNECTION = /^[a-f0-9]{32}$/;
// Never made only of dots, which a request path would read as a dot segment (stage 2 review, L5).
const ITEM_ID = /^(?!\.+$)[A-Za-z0-9!._-]{1,256}$/;
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
const FOLDER_GONE = 'The Recap Page folder was deleted from OneDrive, so cloud backup asks again before it makes a new one.';

function send(res, status, body, extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

const TOO_LARGE = Symbol('too large');
const TOO_SLOW = Symbol('too slow');
const GONE = Symbol('gone');

// The body as text, or why there is none: larger than the operation accepts, not all here by the deadline,
// or the caller gone first.
function readBody(req, limit, ms) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve(TOO_LARGE);
  if (req.socket?.destroyed) return Promise.resolve(GONE);
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
      if (size > limit) finish(TOO_LARGE);
      else chunks.push(chunk);
    };
    const done = () => finish(Buffer.concat(chunks).toString('utf8'));
    const gone = () => finish(GONE);
    timer = setTimeout(() => finish(TOO_SLOW), ms);
    req.on('data', take);
    req.once('end', done);
    req.once('error', gone);
    req.once('close', gone);
  });
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

const UNEXPECTED = 'Cloud backup stopped unexpectedly.';
// Only this host's own errors carry words written for the page. Anything else, such as a raw Node error
// naming a file in the person's profile, is said in general words, by status as by every other operation
// (stage 2 review, S1a finding 4).
function publicMessage(error, fallback = UNEXPECTED) {
  return error instanceof ProviderError || error instanceof CloudTokenError ? error.message : fallback;
}

export function createCloudHost({
  clientText, client = parseCloudClient(clientText),
  env = process.env, platform = process.platform, fetchImpl = globalThis.fetch, spawnImpl,
  store = createTokenStore({ directory: tokenDirectory(env), protector: createProtector({ platform, spawnImpl }) }),
  sessionCheck = createSessionCheck({ platform }),
  openUrl = (url) => openBrowser(url, { platform, spawnImpl }),
  clock = Date.now, random = randomBytes, signInMs = SIGN_IN_MS, deadlines = HOST_DEADLINES_MS, bodyMs = HOST_BODY_MS,
  rate = HOST_RATE,
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
  let probed = null;
  let epoch = 0;
  // Why the current connection was started without anyone signing in again: the person deleted the app
  // folder. Every browser that agreed to the connection before it is told so, rather than that OneDrive
  // was connected again (P02-T07 decision 2). Held in memory only, so a restarted host says the general
  // sentence instead.
  let changed = null;
  let inFlight = 0;
  // When each request in the current window was taken, oldest first. A clock set back starts the window
  // again, rather than turning every request away until the clock catches up.
  const taken = [];

  // Zero when the request is taken, or how long until the oldest leaves the window.
  function admit() {
    const now = clock();
    if (taken.length > 0 && now < taken[taken.length - 1]) taken.length = 0;
    while (taken.length > 0 && taken[0] <= now - rate.windowMs) taken.shift();
    if (taken.length >= rate.limit) return Math.ceil(taken[0] + rate.windowMs - now);
    taken.push(now);
    return 0;
  }
  let queue = Promise.resolve();
  // Every change to the stored sign-in, in order, so a refresh that finishes after a disconnect can never
  // write the connection back.
  const serial = (operation) => {
    const run = queue.then(operation);
    queue = run.catch(() => {});
    return run;
  };

  // The stored sign-in is read once, when it is first needed, and only if one exists, so a computer that
  // never connected never starts PowerShell. A read that timed out is tried again next time. The read
  // takes its place in the same queue as every change to the stored sign-in, so a disconnect that lands
  // while it unprotects the file waits for it and then wins, rather than being undone by it (stage 2
  // review, M1).
  function load() {
    if (unavailable) return Promise.resolve();
    loading ??= serial(async () => {
      try {
        record = (await store.exists()) ? await store.load() : null;
      } catch (error) {
        if (lastsForHostLife(error)) {
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
    });
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
      message: problem ? publicMessage(problem) : message,
      reason: !problem && record && changed?.connection === record.connection ? changed.reason : null,
      signInExpiresAt: signIn?.expiresAt ?? null,
    };
  }

  // A browser naming a connection that is no longer the current one, told why in the words its card shows.
  function askAgain(current) {
    return new ProviderError('needs-consent', changed?.connection === current.connection ? changed.reason : CONNECTED_AGAIN);
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
        // A sign-in again after a refused refresh keeps the connection for the same account and the same
        // app folder, so backups resume. A folder deleted meanwhile is consent withdrawn, as another account
        // is, so every browser asks again (the transport contract under Cloud backup in ARCHITECTURE).
        const same = previous?.account.id === account && (previous.folder === null || previous.folder === folder.id);
        const next = {
          version: 1, provider: 'onedrive',
          connection: same ? previous.connection : Buffer.from(random(16)).toString('hex'),
          account: { id: account, hint: claims.hint }, folder: folder.id, refreshToken: tokens.refreshToken,
          savedAt: Math.floor(clock()),
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
      // With no sign-in stored, whether this Windows account can protect one is asked before Microsoft's
      // page opens, once in the host's life (stage 2 review, L2). Asked again after the wait, because a
      // second Connect may have started a sign-in meanwhile.
      if (!record) await probe();
      if (!signIn && !record?.refreshToken) {
        const job = { expiresAt: Math.floor(clock() + signInMs), close: () => {} };
        signIn = job;
        message = null;
        signInJob(job)
          .catch((error) => {
            // The save after a sign-in meets a restriction the probe could not, should one arrive later.
            if (lastsForHostLife(error)) unavailable = error;
            if (signIn === job) message = publicMessage(error, SIGN_IN_ENDED.failed);
          })
          .finally(() => { if (signIn === job) signIn = null; });
      }
    }
    return status();
  }

  // Restricted PowerShell, or no usable local application data, makes cloud backup unavailable here for
  // the rest of the host's life, so status says so and Connect refuses at once; any other failure is
  // asked about again at the next Connect.
  function probe() {
    probed ??= store.probe().catch((error) => {
      probed = null;
      if (lastsForHostLife(error)) unavailable = error;
      throw error;
    });
    return probed;
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
      // The refresh token is dead. The connection, the account and the folder stay, so signing in again to
      // the same account, with its folder still there, carries on without any browser agreeing again.
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
      if (current.connection !== connection) throw askAgain(current);
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
    if (record.connection !== input.connection) throw askAgain(record);
    if (!record.refreshToken) throw new ProviderError('needs-sign-in', 'Sign in to OneDrive again to keep backing up.');
    const current = record;
    const onedrive = createOneDrive({
      fetchImpl, clock, tracker, accessToken: tokenFor(input.connection), folder: current.folder,
      onFolder: (id) => learnFolder(current, id),
    });
    const settled = async (error) => {
      if (error?.code === 'folder-gone') await forgetFolder(current);
      if (error?.code === 'needs-sign-in') await signInAgain(current);
      throw error;
    };
    return {
      list: () => onedrive.list().catch(settled),
      read: (id) => onedrive.read(id).catch(settled),
      create: (name, bytes) => onedrive.create(name, bytes).catch(settled),
      delete: (id) => onedrive.delete(id).catch(settled),
    };
  }

  // OneDrive refused a token the host had just renewed, so the sign-in itself is no longer any good, as when
  // a refresh is refused: the record says so, status asks for a sign-in again, and Connect starts one
  // (stage 2 review, L3). The connection stays, so signing in again to the same account carries on. Matched
  // by connection rather than identity, because a refresh within the same operation replaces the record.
  async function signInAgain(current) {
    await serial(async () => {
      const latest = record;
      if (!latest || latest.connection !== current.connection || !latest.refreshToken) return;
      const next = { ...latest, refreshToken: null, savedAt: Math.floor(clock()) };
      await store.save(next).catch(() => {});
      record = next;
      access = null;
    });
  }

  // The person deleted the app folder in OneDrive, which the transport contract treats as consent
  // withdrawn: a new connection id makes every browser see what the account holds and agree again before
  // its next backup, and the folder is forgotten, so the next create makes a new one and teaches its id.
  // The record is matched by connection and folder, not by identity, because a refresh within the same
  // operation replaces it. Should the store refuse, a restarted host finds the old folder gone again.
  async function forgetFolder(current) {
    await serial(async () => {
      const latest = record;
      if (!latest || latest.connection !== current.connection || latest.folder !== current.folder) return;
      const next = { ...latest, connection: Buffer.from(random(16)).toString('hex'), folder: null, savedAt: Math.floor(clock()) };
      await store.save(next).catch(() => {});
      record = next;
      access = null;
      changed = { connection: next.connection, reason: FOLDER_GONE };
    });
    throw new ProviderError('needs-consent', FOLDER_GONE);
  }

  // Learned in place rather than by replacing the record: a refresh under way checks that the record it
  // started from is still current, and a new folder id is no reason for it to fail.
  function learnFolder(current, id) {
    void serial(async () => {
      const latest = record;
      if (!latest || latest.connection !== current.connection || latest.folder !== null) return;
      latest.folder = id;
      latest.savedAt = Math.floor(clock());
      await store.save(latest).catch(() => {});
    });
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
    const refuse = (status, code, text, extra = {}, more = {}) => send(res, status, { ok: false, error: { code, message: text, ...more } }, { connection: 'close', ...extra });
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
    const wait = admit();
    if (wait > 0) {
      return refuse(429, 'unavailable', 'Too many cloud requests in a short time.', { 'retry-after': String(Math.ceil(wait / 1000)) }, { retryAfterMs: wait });
    }
    inFlight += 1;
    try {
      const text = await readBody(req, operation === 'create' ? CREATE_BODY : SMALL_BODY, bodyMs);
      // Nobody is left to answer.
      if (text === GONE) return undefined;
      if (text === TOO_SLOW) {
        // Answered, then the connection is closed, so the rest of the body is never waited for.
        res.once('finish', () => req.socket?.destroy());
        return refuse(408, 'slow', 'That request did not arrive in time.');
      }
      if (text === TOO_LARGE) return refuse(413, 'size', 'That request is larger than this operation accepts.');
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
            message: publicMessage(error),
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
