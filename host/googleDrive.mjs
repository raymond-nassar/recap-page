// Google Drive for the Windows host (#810, P04): Google's sign-in for an installed app and the four
// operations the shared protocol needs, list, read, create and delete, in a visible "Recap Page" folder at
// the top of the person's Drive (owner, 2026-11-01).
//
// The one scope asked for is drive.file, which Google lists as non-sensitive and which reaches only files
// this app created or the person opened with it (Drive scopes guide, retrieved 2026-11-01). No openid or
// email scope is asked for: the account is named by Drive's own about resource, which drive.file can read.
//
// Sign-in follows Google's guide for desktop apps (OAuth 2.0 for iOS and desktop apps, retrieved
// 2026-11-01): a loopback redirect to http://127.0.0.1:<port>/, which Google prefers to "localhost" because
// that name "may cause issues with client firewalls", PKCE with S256, and the client secret Google issues a
// Desktop client, which that guide says an installed app cannot keep confidential. It arrives with the
// client configuration like every other registration value and is never committed (OD-06).
//
// Drive allows two files of one name in a folder, so this transport cannot refuse a taken name the way
// OneDrive's does. The shared protocol is told so (duplicateNames on the page's transport) and lists again
// after every create, keeping the oldest of a name.

import { ProviderError, capabilityUrl, discard, networkFailure, readBounded, readJson, retryAfterMs } from './cloudSignIn.mjs';

export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_NAME = 'Recap Page';
export const FOLDER_TYPE = 'application/vnd.google-apps.folder';
// The same ceiling the shared protocol puts on a cloud backup.
export const MAX_ITEM_BYTES = 32 * 1024 * 1024;
const METADATA_MS = 30_000;
const MAX_PAGES = 50;
const ITEM_FIELDS = 'id,name,size,createdTime';
// Drive ids are letters, digits, hyphens and underscores. Held to the host's own item shape too.
const ITEM_ID = /^[A-Za-z0-9_-]{1,256}$/;
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);
const QUOTA_REASONS = new Set(['storageQuotaExceeded', 'quotaExceeded']);

export function authorizationUrl({ clientId, redirectUri, authorization }) {
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: GOOGLE_SCOPE,
    state: authorization.state, code_challenge: authorization.challenge, code_challenge_method: 'S256',
    // Offline access gives the refresh token, and asking for consent each time makes sure one comes back,
    // because Google sends it only with a consent the person has just given.
    access_type: 'offline', prompt: 'consent select_account',
  });
  return `${GOOGLE_AUTHORIZE}?${params.toString().replace(/\+/g, '%20')}`;
}

async function tokenRequest({ fetchImpl, clientId, clientSecret, form, clock = Date.now }) {
  let response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), ...form }).toString(),
      redirect: 'error', signal: AbortSignal.timeout(METADATA_MS),
    });
  } catch (error) {
    throw networkFailure(error, 'Google sign-in');
  }
  const wait = retryAfterMs(response, clock());
  const body = await readJson(response);
  if (response.ok) {
    if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
      throw new ProviderError('invalid', 'Google answered the sign-in without an access token.');
    }
    const seconds = Number(body.expires_in);
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      scope: typeof body.scope === 'string' ? body.scope : '',
      expiresInMs: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 60), 24 * 3600) * 1000 : 3600 * 1000,
    };
  }
  if (response.status === 429 || response.status === 503 || body?.error === 'temporarily_unavailable') {
    throw new ProviderError('unavailable', 'Google sign-in asked to wait before trying again.', { retryAfterMs: wait });
  }
  if (response.status >= 500) throw new ProviderError('unavailable', 'Google sign-in did not answer this time.');
  // invalid_grant, a revoked or expired refresh token, and every other refusal: only a new sign-in follows.
  throw new ProviderError('refused', 'Google refused the sign-in.');
}

export function redeemCode({ code, verifier, redirectUri, ...rest }) {
  return tokenRequest({ ...rest, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier } });
}

// Google keeps the refresh token across refreshes and usually sends no new one, so the caller keeps the old.
export function refreshTokens({ refreshToken, ...rest }) {
  return tokenRequest({ ...rest, form: { grant_type: 'refresh_token', refresh_token: refreshToken } });
}

// Google's consent screen lets a person untick a scope, so the grant is read rather than assumed.
export function grantsDriveFile(scope) {
  return String(scope).split(/\s+/).includes(GOOGLE_SCOPE);
}

function displayText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && [...value].every((character) => character.codePointAt(0) > 0x1f && character.codePointAt(0) !== 0x7f) ? value : null;
}

function item(value) {
  if (value === null || typeof value !== 'object' || typeof value.id !== 'string' || !ITEM_ID.test(value.id)
    || typeof value.name !== 'string' || value.name.length === 0 || value.name.length > 1024) return null;
  const created = Date.parse(value.createdTime);
  // Drive writes a file's size as a decimal string, because it is a 64-bit number.
  const size = typeof value.size === 'string' && /^\d{1,15}$/.test(value.size) ? Number(value.size)
    : Number.isSafeInteger(value.size) && value.size >= 0 ? value.size : null;
  return { id: value.id, name: value.name, size, created: Number.isFinite(created) ? created : null };
}

const transferMs = (bytes) => 60_000 + Math.ceil(bytes / 65_536) * 1000;
const quoted = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Only the host authorizes a Drive request; a caller's Authorization in any case is refused (#996, S5-2).
export function driveHeaders(headers, token) {
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) {
    throw new TypeError('Only the host sets Authorization on a Drive request.');
  }
  return { ...headers, authorization: `Bearer ${token}` };
}

export function createUploadTracker() {
  return { inflight: new Set(), unsettled: new Map() };
}

// Every unsettled session costs a request before each list, so only the newest are kept. One dropped is
// never asked again, and its create stays the timeout it was already reported as.
export const MAX_UNSETTLED = 16;

export function createGoogleDrive({ fetchImpl, accessToken, clock = Date.now, tracker = createUploadTracker(), folder = null, onFolder = () => {} }) {
  let known = folder;
  const gone = () => new ProviderError('folder-gone', 'The Recap Page folder was deleted from Google Drive.');

  async function call(method, url, { body, headers = {}, timeoutMs = METADATA_MS } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const token = await accessToken({ renew: attempt > 0 });
      let response;
      try {
        response = await fetchImpl(url, {
          method, headers: driveHeaders(headers, token), body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw networkFailure(error, 'Google Drive');
      }
      if (response.status === 401 && attempt === 0) {
        await discard(response);
        continue;
      }
      return response;
    }
  }

  // Drive gives the reason for a 403 in its body, and a rate limit and a full account both arrive as 403.
  async function failure(response) {
    const { status } = response;
    const wait = retryAfterMs(response, clock());
    const body = status === 403 || status === 400 ? await readJson(response, 64 * 1024) : (await discard(response), null);
    const reasons = new Set((Array.isArray(body?.error?.errors) ? body.error.errors : []).map((entry) => entry?.reason));
    const has = (set) => [...reasons].some((reason) => set.has(reason));
    if (status === 401) return new ProviderError('needs-sign-in', 'Google Drive asked for the sign-in to be made again.');
    if (status === 403 && has(QUOTA_REASONS)) return new ProviderError('quota', 'Google Drive is full, so nothing more can be backed up there.');
    if (status === 403 && has(RATE_REASONS)) return new ProviderError('unavailable', 'Google Drive asked to wait before trying again.', { retryAfterMs: wait });
    if (status === 403) return new ProviderError('refused', 'Google Drive refused access to the Recap Page folder.');
    if (status === 404) return new ProviderError('not-found', 'That item is no longer in Google Drive.');
    if (status === 429 || status === 503) return new ProviderError('unavailable', 'Google Drive asked to wait before trying again.', { retryAfterMs: wait });
    if (status >= 500) return new ProviderError('unavailable', 'Google Drive did not answer this time.');
    return new ProviderError('invalid', `Google Drive answered in a way this version does not expect (${status}).`);
  }

  async function files(query, { fields = `nextPageToken,files(${ITEM_FIELDS})`, orderBy, pageToken, pageSize = 1000 } = {}) {
    const params = new URLSearchParams({ q: query, fields, spaces: 'drive', pageSize: String(pageSize) });
    if (orderBy) params.set('orderBy', orderBy);
    if (pageToken) params.set('pageToken', pageToken);
    const response = await call('GET', `${DRIVE}/files?${params}`);
    if (!response.ok) throw await failure(response);
    const body = await readJson(response, 8 * 1024 * 1024);
    if (!Array.isArray(body?.files)) throw new ProviderError('invalid', 'Google Drive listed files in a way this version does not expect.');
    return body;
  }

  // The oldest folder of the name at the top of the Drive, among those this app can see. Two devices that
  // made one at the same moment both settle on the older, so their backups meet in one place.
  async function findFolder() {
    const body = await files(`name = ${quoted(FOLDER_NAME)} and mimeType = ${quoted(FOLDER_TYPE)} and 'root' in parents and trashed = false`,
      { fields: 'files(id,createdTime)', orderBy: 'createdTime', pageSize: 10 });
    const found = body.files.find((entry) => typeof entry?.id === 'string' && ITEM_ID.test(entry.id));
    return found ? found.id : null;
  }

  // The folder this host recorded, if the person has not deleted it. A folder in the trash counts as
  // deleted: its files are still listed under it, but they are on their way out of the account.
  async function checkFolder(id) {
    const response = await call('GET', `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed`);
    if (response.status === 404) {
      await discard(response);
      throw gone();
    }
    if (!response.ok) throw await failure(response);
    const body = await readJson(response, 64 * 1024);
    if (body?.trashed === true) throw gone();
    if (body?.id !== id) throw new ProviderError('invalid', 'Google Drive described the Recap Page folder in a way this version does not expect.');
  }

  async function makeFolder() {
    const response = await call('POST', `${DRIVE}/files?fields=id`, {
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_TYPE, parents: ['root'] }),
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    if (!response.ok) throw await failure(response);
    const id = (await readJson(response, 64 * 1024))?.id;
    if (typeof id !== 'string' || !ITEM_ID.test(id)) throw new ProviderError('invalid', 'Google Drive did not say which folder it made.');
    // Another device may have made one at the same moment. The oldest wins, and an empty one this create
    // made is put in the trash rather than left beside it.
    const oldest = await findFolder().catch(() => id);
    if (oldest && oldest !== id) {
      await call('PATCH', `${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, {
        body: JSON.stringify({ trashed: true }), headers: { 'content-type': 'application/json; charset=utf-8' },
      }).then(discard, () => {});
      return oldest;
    }
    return id;
  }

  async function folderForCreate() {
    if (known) return known;
    const id = (await findFolder()) ?? (await makeFolder());
    known = id;
    onFolder(id);
    return id;
  }

  // What became of an upload whose reply was lost. Asking a resumable session how much it holds answers
  // with the file once it is complete, or 308 while bytes are missing; nothing resumes it, so a 308 is a
  // backup that never arrives. Any other answer leaves the outcome unknown, which the contract calls a
  // timeout, and the next list asks again before listing.
  async function status(upload, size) {
    try {
      const response = await fetchImpl(upload.href, {
        method: 'PUT', headers: { 'content-range': `bytes */${size}` }, redirect: 'manual', signal: AbortSignal.timeout(METADATA_MS),
      });
      if (response.status === 200 || response.status === 201) return { complete: true, done: item(await readJson(response, 64 * 1024)) };
      await discard(response);
      if (response.status === 308 || response.status === 404 || response.status === 410) return { done: null };
    } catch { /* unknown */ }
    return undefined;
  }

  async function settle(name, upload, size, wait = 0) {
    const answer = await status(upload, size);
    if (answer === undefined) {
      tracker.unsettled.delete(name);
      tracker.unsettled.set(name, { upload, size });
      while (tracker.unsettled.size > MAX_UNSETTLED) tracker.unsettled.delete(tracker.unsettled.keys().next().value);
      throw new ProviderError('timeout', 'Google Drive did not say whether the backup was saved.');
    }
    if (answer.done && answer.done.name === name) return answer.done;
    // Complete, with an answer this version cannot read: the file is there, so the next list shows it, and
    // calling the create refused would break the promise that a refused create never appears later.
    if (answer.complete) throw new ProviderError('timeout', 'Google Drive did not say whether the backup was saved.');
    throw new ProviderError('unavailable', 'The backup did not reach Google Drive.', wait > 0 ? { retryAfterMs: wait } : undefined);
  }

  async function createOnce(name, bytes) {
    const parent = await folderForCreate();
    const opened = await call('POST', `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${ITEM_FIELDS},parents`, {
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/octet-stream' }),
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(bytes.length) },
    });
    if (opened.status === 404) {
      await discard(opened);
      throw gone();
    }
    if (!opened.ok) throw await failure(opened);
    const upload = capabilityUrl(opened.headers.get('location'));
    await discard(opened);
    if (!upload) throw new ProviderError('invalid', 'Google Drive did not return a usable upload address.');
    let response;
    try {
      response = await fetchImpl(upload.href, {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
        redirect: 'manual', signal: AbortSignal.timeout(transferMs(bytes.length)),
      });
    } catch {
      return settle(name, upload, bytes.length);
    }
    if (response.status === 200 || response.status === 201) {
      const created = item(await readJson(response, 64 * 1024));
      if (!created || created.name !== name) return settle(name, upload, bytes.length);
      return created;
    }
    // A timeout or a server failure may come after every byte arrived, so it is settled as a lost reply is:
    // a create refused with any code but timeout must never appear later (stage 2 review, L1).
    if (response.status === 408 || response.status === 308 || response.status >= 500) {
      const wait = retryAfterMs(response, clock());
      await discard(response);
      return settle(name, upload, bytes.length, wait);
    }
    throw await failure(response);
  }

  return {
    // The account and the folder, asked once at sign-in. The account is Drive's permission id for the
    // person, which stays the same for their account; the email address is shown on the card.
    async identify() {
      const response = await call('GET', `${DRIVE}/about?fields=user(emailAddress,displayName,permissionId)`);
      if (!response.ok) throw await failure(response);
      const user = (await readJson(response, 64 * 1024))?.user;
      const id = displayText(user?.permissionId);
      if (!id) throw new ProviderError('invalid', 'Google did not confirm which account signed in.');
      return {
        account: `google:${id}`,
        hint: displayText(user.emailAddress) ?? displayText(user.displayName),
        folder: known ?? (await findFolder()),
      };
    },

    // Every backup in the Recap Page folder, all pages. No folder yet lists as empty; the folder this host
    // recorded gone or in the trash means the person deleted it.
    async list() {
      await Promise.allSettled([...tracker.inflight]);
      for (const [name, { upload, size }] of tracker.unsettled) if ((await status(upload, size)) !== undefined) tracker.unsettled.delete(name);
      if (known) await checkFolder(known);
      else {
        known = await findFolder();
        if (!known) return [];
        onFolder(known);
      }
      const items = [];
      let pageToken;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = await files(`${quoted(known)} in parents and trashed = false`, { pageToken });
        for (const value of body.files) {
          const found = item(value);
          if (found) items.push(found);
        }
        if (body.nextPageToken === undefined) return items;
        if (typeof body.nextPageToken !== 'string' || body.nextPageToken.length === 0 || body.nextPageToken.length > 4096) {
          throw new ProviderError('invalid', 'Google Drive pointed the next page somewhere this version does not expect.');
        }
        pageToken = body.nextPageToken;
      }
      throw new ProviderError('invalid', 'The Recap Page folder holds more items than this version reads.');
    },

    async read(id) {
      const response = await call('GET', `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { timeoutMs: transferMs(MAX_ITEM_BYTES) });
      if (response.status !== 200) throw await failure(response);
      // Read to the cap and no further, whatever the response declares.
      const bytes = await readBounded(response, MAX_ITEM_BYTES).catch(() => {
        throw new ProviderError('unavailable', 'The download from Google Drive stopped part way.');
      });
      if (!bytes) throw new ProviderError('too-large', 'That item is larger than a cloud backup can be.');
      return bytes;
    },

    create(name, bytes) {
      const job = createOnce(name, bytes);
      tracker.inflight.add(job);
      job.then(() => tracker.inflight.delete(job), () => tracker.inflight.delete(job));
      return job;
    },

    // Put in the person's Drive trash, where it stays for 30 days, as OneDrive's recycle bin keeps a
    // deleted backup. An item already gone counts as deleted.
    async delete(id) {
      const response = await call('PATCH', `${DRIVE}/files/${encodeURIComponent(id)}?fields=id`, {
        body: JSON.stringify({ trashed: true }), headers: { 'content-type': 'application/json; charset=utf-8' },
      });
      if (response.status === 404) { await discard(response); return; }
      if (!response.ok) throw await failure(response);
      await discard(response);
    },
  };
}
