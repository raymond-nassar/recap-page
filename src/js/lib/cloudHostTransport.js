// The cloud backup transport the Windows host supplies, as the page sees it (#810, P02-T05): the seam's
// four operations on the app's own area of the account, plus the account's status, connect and
// disconnect, each one POST to the host's control API under one prefix on this origin. The transport
// contract is under Cloud backup in docs/ARCHITECTURE.md. Tokens never come here: the host holds them and
// answers with items, bytes and states only.
//
// A build without a client configuration answers 404 under the prefix, as for any unknown path, and so
// does a server that is not this app's. Status calls that, and every other answer that is not the host's,
// "not enabled", so such a build shows no cloud control at all. No answer at all, a server failing, or
// the host too busy to answer says nothing lasting about cloud backup, so status marks it transient, and
// the backups a browser agreed to carry on through it (stage 3 review, S3a-3).

import { CloudBackupError, CLOUD_DEADLINE_GRACE_MS, CLOUD_TRANSPORT_DEADLINES_MS } from './cloudProtocol.js';

export const CLOUD_HOST_PREFIX = '/__recap_cloud__/v1/';
export const CLOUD_HOST_HEADER = 'x-recap-cloud';
// Status, connect and disconnect touch only the host, and connect hands the sign-in to the browser and
// returns at once, so a host that takes longer than this is treated as not answering.
const ACCOUNT_MS = 15_000;
const STATES = new Set(['unavailable', 'not-connected', 'signing-in', 'connected', 'needs-sign-in']);
const PROVIDER = /^[a-z]{1,32}$/;
// Google Drive keeps two items under one name, and the protocol settles that with a second list after a
// create; OneDrive cannot, so it skips that list.
const DUPLICATE_NAMES = new Set(['googledrive']);
const NOT_ENABLED = Object.freeze({ enabled: false });
const NOT_ANSWERED = Object.freeze({ enabled: false, transient: true });
const CHUNK = 0x8000;
// The host turns a request away before reading it when it is not the served page's. The page's own
// requests always have the shape it accepts, so a refusal means the page was opened at another address,
// or the host could not tell that the browser runs in the Windows account that started it.
const ELSEWHERE = 'Cloud backup works only in Recap Page opened at http://127.0.0.1:8787.';
const TURNED_AWAY = Object.freeze({
  host: ELSEWHERE, origin: ELSEWHERE, site: ELSEWHERE, header: ELSEWHERE,
  session: 'The Recap Page app could not confirm that this browser runs in the Windows account that started it, so cloud backup cannot be used here.',
});
const REFUSED = 'The Recap Page app refused the request from this page. Reload the page to try again.';
const BUSY = 'The Recap Page app is busy. Try again in a moment.';
// Statuses for a request the host turned away without reading or doing it: one too many (429), or a body
// that did not arrive in time (408).
const TURNED_AWAY_UNREAD = new Set([408, 429]);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null; }

function toBase64(bytes) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}

function fromBase64(value) {
  let binary;
  try { binary = atob(value); } catch { return null; }
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

// The services the host offers, as short lowercase names. A host older than the choice of service sends
// none, and offers only the one it names.
function providersOf(value, provider) {
  const named = Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && PROVIDER.test(entry)) : [];
  const offered = [...new Set(named)].slice(0, 8);
  return offered.length > 0 ? offered : provider ? [provider] : [];
}

// The host's account status, keeping only the fields the card shows or the protocol needs, and only in
// the shapes the host writes.
function statusOf(value) {
  if (!object(value) || !STATES.has(value.state)) return NOT_ENABLED;
  const provider = typeof value.provider === 'string' && PROVIDER.test(value.provider) ? value.provider : null;
  return {
    enabled: true,
    provider,
    providers: providersOf(value.providers, provider),
    state: value.state,
    connection: text(value.connection, 128),
    account: text(value.account, 256),
    message: text(value.message, 1024),
    reason: text(value.reason, 1024),
    signInExpiresAt: Number.isSafeInteger(value.signInExpiresAt) ? value.signInExpiresAt : null,
  };
}

function unavailable(message) {
  return { enabled: true, provider: null, providers: [], state: 'unavailable', connection: null, account: null, message, reason: null, signInExpiresAt: null };
}

function failure(error, code, fallback) {
  const message = text(error?.message, 1024) ?? fallback;
  return Object.assign(new CloudBackupError(message, code),
    Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs > 0 ? { retryAfterMs: error.retryAfterMs } : {});
}

export function createCloudHostTransport({
  fetchImpl = globalThis.fetch, prefix = CLOUD_HOST_PREFIX, accountMs = ACCOUNT_MS,
  deadlines = CLOUD_TRANSPORT_DEADLINES_MS, graceMs = CLOUD_DEADLINE_GRACE_MS,
} = {}) {
  // The HTTP status and the parsed body, which is null for anything that is not JSON. The engine holds
  // each data operation to its deadline and the grace already; ending the request at the same moment
  // only frees it.
  async function request(operation, input, ms) {
    const signal = AbortSignal.timeout(ms);
    const late = () => new CloudBackupError('The Recap Page app did not answer in time.', 'timeout');
    let response;
    try {
      response = await fetchImpl(`${prefix}${operation}`, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal,
        headers: { 'content-type': 'application/json', [CLOUD_HOST_HEADER]: '1' },
        body: JSON.stringify(input),
      });
    } catch {
      throw signal.aborted ? late() : new CloudBackupError('The Recap Page app could not be reached.', 'unavailable');
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) throw late();
    }
    return { code: response.status, body };
  }

  // The answer's body, or a refusal. The host answers every operation it reads with 200 and { ok }, and
  // turns a request away with a 4xx before reading it. A request turned away can only be refused again,
  // so it halts until something changes, except for the host being busy, which is retried.
  async function post(operation, input, ms) {
    const { code, body } = await request(operation, input, ms);
    if (code === 200 && object(body) && body.ok === true) return body;
    if (object(body) && body.ok === false && object(body.error)) {
      if (code === 200) throw failure(body.error, text(body.error.code, 64) ?? 'failed', 'Cloud backup could not do that.');
      // One request too many, or a body that did not arrive in time: nothing was done, so it is retried, in
      // the page's own words, keeping any wait the host gave (stage 2 review, S1b).
      if (TURNED_AWAY_UNREAD.has(code)) throw failure({ retryAfterMs: body.error.retryAfterMs }, 'unavailable', BUSY);
      throw failure({ message: TURNED_AWAY[body.error.code] ?? REFUSED }, 'refused', REFUSED);
    }
    throw code === 404
      ? new CloudBackupError('Cloud backup is not part of this build of Recap Page.', 'unavailable')
      : new CloudBackupError('The Recap Page app answered in a way this page does not expect.', 'invalid');
  }

  const within = (operation) => deadlines[operation] + graceMs;
  // The service the host last named, which decides whether a create is checked for a second item under
  // its name. A status that names none leaves it as it was.
  let provider = null;
  const heard = (status) => {
    if (status.provider) provider = status.provider;
    return status;
  };

  return {
    get duplicateNames() { return DUPLICATE_NAMES.has(provider); },

    // Never refuses: "not enabled" when something other than the host answered, transient when nothing
    // answered or the host was busy, and "unavailable" with the reason when the host cannot serve this page.
    async status() {
      let answer;
      try { answer = await request('status', {}, accountMs); } catch { return NOT_ANSWERED; }
      const { code, body } = answer;
      if (code === 200 && object(body) && body.ok === true) return heard(statusOf(body.status));
      if (code >= 500) return NOT_ANSWERED;
      if (!object(body) || body.ok !== false || !object(body.error)) return NOT_ENABLED;
      if (code === 200) return unavailable(text(body.error.message, 1024) ?? 'Cloud backup stopped unexpectedly.');
      if (TURNED_AWAY_UNREAD.has(code)) return { ...unavailable(BUSY), transient: true };
      return unavailable(TURNED_AWAY[body.error.code] ?? REFUSED);
    },
    // Signs in to the service named, or to OneDrive when none is, as every host before the choice did.
    async connect({ provider: chosen } = {}) {
      return heard(statusOf((await post('connect', chosen === undefined ? {} : { provider: chosen }, accountMs)).status));
    },
    async disconnect() { return heard(statusOf((await post('disconnect', {}, accountMs)).status)); },

    async list({ connection } = {}) {
      const { items } = await post('list', { connection }, within('list'));
      if (!Array.isArray(items)) throw new CloudBackupError('The cloud account did not answer with a list.', 'invalid');
      return items;
    },
    async read(id, { connection } = {}) {
      const { bytes } = await post('read', { connection, id }, within('read'));
      const decoded = typeof bytes === 'string' ? fromBase64(bytes) : null;
      if (!decoded) throw new CloudBackupError('The cloud copy could not be read.', 'invalid');
      return decoded;
    },
    async create(name, bytes, { connection } = {}) {
      const { item } = await post('create', { connection, name, bytes: toBase64(bytes) }, within('create'));
      return item;
    },
    async delete(id, { connection } = {}) {
      await post('delete', { connection, id }, within('delete'));
    },
  };
}
