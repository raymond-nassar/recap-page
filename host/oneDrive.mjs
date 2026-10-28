// OneDrive for the Windows host: Microsoft's sign-in endpoints for personal accounts and the four
// operations on the app's own folder that the shared protocol needs, list, read, create and delete.
//
// What each request looks like rests on what was observed rather than assumed. Creating goes through an
// upload session whose URL asks to fail on an existing name, then one PUT of every byte to the address it
// returns, without the Authorization header: that is the documented route for conflict behavior, and the
// only one the stopped session saw work under the app-folder permission in the owner's own folder
// (2026-10-22), where the JSON-body variant failed three times. Reading follows exactly one redirect to a
// preauthenticated address, again without Authorization (B10 in the P02-T01 facts, retrieved 2026-10-28).

import { ProviderError, capabilityUrl, discard, networkFailure, readBounded, readJson, retryAfterMs } from './cloudSignIn.mjs';

export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
// openid and profile give the id token whose nonce ties a sign-in to this request and whose name is shown
// as the account; offline_access gives the refresh token; the app folder is the only storage asked for.
export const MICROSOFT_SCOPE = 'openid profile offline_access Files.ReadWrite.AppFolder';
const FOLDER_SCOPE = 'files.readwrite.appfolder';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
// The same ceiling the shared protocol puts on a cloud backup.
export const MAX_ITEM_BYTES = 32 * 1024 * 1024;
const METADATA_MS = 30_000;
const MAX_PAGES = 50;
const ITEM_FIELDS = '$select=id,name,size,createdDateTime';
const ITEM_ID = /^[A-Za-z0-9!._-]{1,256}$/;

export function authorizationUrl({ clientId, redirectUri, authorization }) {
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
    scope: MICROSOFT_SCOPE, state: authorization.state, nonce: authorization.nonce,
    code_challenge: authorization.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  return `${MICROSOFT_LOGIN}/authorize?${params.toString().replace(/\+/g, '%20')}`;
}

async function tokenRequest({ fetchImpl, clientId, form, clock = Date.now }) {
  let response;
  try {
    response = await fetchImpl(`${MICROSOFT_LOGIN}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...form }).toString(),
      redirect: 'error', signal: AbortSignal.timeout(METADATA_MS),
    });
  } catch (error) {
    throw networkFailure(error, 'Microsoft sign-in');
  }
  const wait = retryAfterMs(response, clock());
  const body = await readJson(response);
  if (response.ok) {
    if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
      throw new ProviderError('invalid', 'Microsoft answered the sign-in without an access token.');
    }
    const seconds = Number(body.expires_in);
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      idToken: typeof body.id_token === 'string' ? body.id_token : null,
      scope: typeof body.scope === 'string' ? body.scope : '',
      expiresInMs: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 60), 24 * 3600) * 1000 : 3600 * 1000,
    };
  }
  if (response.status === 429 || response.status === 503 || body?.error === 'temporarily_unavailable') {
    throw new ProviderError('busy', 'Microsoft sign-in asked to wait before trying again.', { retryAfterMs: wait });
  }
  if (response.status >= 500) throw new ProviderError('transient', 'Microsoft sign-in did not answer this time.');
  // invalid_grant, interaction_required and every other refusal: only a new sign-in can follow.
  throw new ProviderError('refused', 'Microsoft refused the sign-in.');
}

export function redeemCode({ code, verifier, redirectUri, ...rest }) {
  return tokenRequest({
    ...rest, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: MICROSOFT_SCOPE },
  });
}

export function refreshTokens({ refreshToken, ...rest }) {
  return tokenRequest({ ...rest, form: { grant_type: 'refresh_token', refresh_token: refreshToken, scope: MICROSOFT_SCOPE } });
}

export function grantsAppFolder(scope) {
  return String(scope).toLowerCase().split(/\s+/).includes(FOLDER_SCOPE);
}

function displayText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && [...value].every((character) => character.codePointAt(0) > 0x1f && character.codePointAt(0) !== 0x7f) ? value : null;
}

// The id token comes straight from the token endpoint over TLS, which OpenID Connect accepts in place of
// checking its signature (Core 1.0, section 3.1.3.7). Its audience, nonce and expiry are still checked,
// so a token made for another app or another sign-in is never taken for this one.
export function idTokenClaims(idToken, { clientId, nonce, now = Date.now() }) {
  const invalid = () => new ProviderError('invalid', 'Microsoft did not confirm which account signed in.');
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw invalid();
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { throw invalid(); }
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  const subject = displayText(claims?.oid) ?? displayText(claims?.sub);
  if (!audience.includes(clientId) || claims.nonce !== nonce || !subject
    || !Number.isFinite(claims.exp) || claims.exp * 1000 < now - 5 * 60_000) throw invalid();
  return { subject, hint: displayText(claims.preferred_username) ?? displayText(claims.email) ?? displayText(claims.name) };
}

function item(value) {
  if (value === null || typeof value !== 'object' || typeof value.id !== 'string' || !ITEM_ID.test(value.id)
    || typeof value.name !== 'string' || value.name.length === 0 || value.name.length > 1024) return null;
  const created = Date.parse(value.createdDateTime);
  return {
    id: value.id, name: value.name,
    size: Number.isSafeInteger(value.size) && value.size >= 0 ? value.size : null,
    created: Number.isFinite(created) ? created : null,
  };
}

const transferMs = (bytes) => 60_000 + Math.ceil(bytes / 65_536) * 1000;

// Uploads under way and upload sessions that could not be settled, kept by the host across operations and
// connections: a list waits for the first and cancels the second, so nothing a reply said had failed can
// appear in the account after a list that missed it.
export function createUploadTracker() {
  return { inflight: new Set(), unsettled: new Map() };
}

export function createOneDrive({ fetchImpl, accessToken, clock = Date.now, tracker = createUploadTracker() }) {
  async function call(method, path, { body, timeoutMs = METADATA_MS } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const token = await accessToken({ renew: attempt > 0 });
      let response;
      try {
        response = await fetchImpl(`${GRAPH}${path}`, {
          method, headers: { authorization: `Bearer ${token}` }, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw networkFailure(error, 'OneDrive');
      }
      if (response.status === 401 && attempt === 0) {
        await discard(response);
        continue;
      }
      return response;
    }
  }

  async function failure(response) {
    const { status } = response;
    const wait = retryAfterMs(response, clock());
    await discard(response);
    if (status === 401) return new ProviderError('needs-sign-in', 'OneDrive asked for the sign-in to be made again.');
    if (status === 403) return new ProviderError('refused', 'OneDrive refused access to the app folder.');
    if (status === 404) return new ProviderError('not-found', 'That item is no longer in OneDrive.');
    if (status === 409) return new ProviderError('conflict', 'OneDrive already holds an item with that name.');
    if (status === 429 || status === 503) return new ProviderError('busy', 'OneDrive asked to wait before trying again.', { retryAfterMs: wait });
    if (status === 507) return new ProviderError('refused', 'OneDrive is full, so nothing more can be backed up there.');
    if (status >= 500) return new ProviderError('transient', 'OneDrive did not answer this time.');
    return new ProviderError('invalid', `OneDrive answered in a way this version does not expect (${status}).`);
  }

  // Cancelling a session makes it unable to complete later. A session that is already gone, because it
  // completed or expired, answers 404, which settles it just as well.
  async function cancel(upload) {
    try {
      const response = await fetchImpl(upload.href, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(METADATA_MS) });
      await discard(response);
      return response.status === 204 || response.status === 404;
    } catch {
      return false;
    }
  }

  async function lookup(name) {
    const response = await call('GET', `/me/drive/special/approot:/${encodeURIComponent(name)}?${ITEM_FIELDS}`);
    if (response.status === 404) {
      await discard(response);
      return null;
    }
    if (!response.ok) throw await failure(response);
    const found = item(await readJson(response));
    if (!found) throw new ProviderError('invalid', 'OneDrive described the item in a way this version does not expect.');
    return found;
  }

  // An upload that got no answer may still have been committed. Its session is cancelled first, so nothing
  // can complete after this reply, and then its name is looked up: the file is there now, or never will be.
  async function settle(name, upload) {
    if (!(await cancel(upload))) {
      tracker.unsettled.set(name, upload);
      throw new ProviderError('unknown', 'OneDrive did not say whether the backup was saved.');
    }
    const found = await lookup(name);
    if (!found) throw new ProviderError('transient', 'The backup did not reach OneDrive.');
    return found;
  }

  async function createOnce(name, bytes) {
    const opened = await call('POST',
      `/me/drive/special/approot:/${encodeURIComponent(name)}:/createUploadSession?@microsoft.graph.conflictBehavior=fail`,
      { body: '' });
    if (!opened.ok) throw await failure(opened);
    const upload = capabilityUrl((await readJson(opened, 64 * 1024))?.uploadUrl);
    if (!upload) throw new ProviderError('invalid', 'OneDrive did not return a usable upload address.');
    let response;
    try {
      response = await fetchImpl(upload.href, {
        method: 'PUT', headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes,
        redirect: 'manual', signal: AbortSignal.timeout(transferMs(bytes.length)),
      });
    } catch {
      return settle(name, upload);
    }
    if (response.status === 200 || response.status === 201) {
      const created = item(await readJson(response, 64 * 1024));
      return created && created.name === name ? created : settle(name, upload);
    }
    if (response.status === 202) {
      await discard(response);
      return settle(name, upload);
    }
    const refused = await failure(response);
    await cancel(upload);
    throw refused;
  }

  return {
    // The app folder's drive, which names the account: a later sign-in to the same drive keeps the
    // connection, so no browser has to agree to backups again.
    async appFolder() {
      const response = await call('GET', '/me/drive/special/approot?$select=id,parentReference');
      if (response.status === 404) {
        await discard(response);
        return { driveId: null };
      }
      if (!response.ok) throw await failure(response);
      const driveId = (await readJson(response, 64 * 1024))?.parentReference?.driveId;
      return { driveId: typeof driveId === 'string' && ITEM_ID.test(driveId) ? driveId : null };
    },

    // Every item in the app folder, all pages. A folder that does not exist yet lists as empty.
    async list() {
      await Promise.allSettled([...tracker.inflight]);
      for (const [name, upload] of tracker.unsettled) if (await cancel(upload)) tracker.unsettled.delete(name);
      const items = [];
      let path = `/me/drive/special/approot/children?${ITEM_FIELDS}&$top=200`;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await call('GET', path);
        if (response.status === 404 && page === 0) {
          await discard(response);
          return [];
        }
        if (!response.ok) throw await failure(response);
        const body = await readJson(response, 8 * 1024 * 1024);
        if (!Array.isArray(body?.value)) throw new ProviderError('invalid', 'OneDrive listed the app folder in a way this version does not expect.');
        for (const value of body.value) {
          const found = item(value);
          if (found) items.push(found);
        }
        const next = body['@odata.nextLink'];
        if (next === undefined) return items;
        if (typeof next !== 'string' || !next.startsWith(`${GRAPH}/`)) {
          throw new ProviderError('invalid', 'OneDrive pointed the next page somewhere this version does not expect.');
        }
        path = next.slice(GRAPH.length);
      }
      throw new ProviderError('invalid', 'The app folder holds more items than this version reads.');
    },

    async read(id) {
      const response = await call('GET', `/me/drive/items/${encodeURIComponent(id)}/content`);
      let content = response;
      if (response.status === 302) {
        const download = capabilityUrl(response.headers.get('location'));
        await discard(response);
        if (!download) throw new ProviderError('invalid', 'OneDrive pointed the download somewhere this version does not expect.');
        try {
          content = await fetchImpl(download.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(transferMs(MAX_ITEM_BYTES)) });
        } catch (error) {
          throw networkFailure(error, 'OneDrive');
        }
      }
      if (content.status !== 200) throw await failure(content);
      const bytes = await readBounded(content, MAX_ITEM_BYTES).catch(() => {
        throw new ProviderError('transient', 'The download from OneDrive stopped part way.');
      });
      if (!bytes) throw new ProviderError('invalid', 'That item is larger than a cloud backup can be.');
      return bytes;
    },

    create(name, bytes) {
      const job = createOnce(name, bytes);
      tracker.inflight.add(job);
      job.then(() => tracker.inflight.delete(job), () => tracker.inflight.delete(job));
      return job;
    },

    // An item already gone counts as deleted. OneDrive keeps every deleted item in the person's recycle
    // bin for up to 30 days, because the app-folder permission cannot delete permanently.
    async delete(id) {
      const response = await call('DELETE', `/me/drive/items/${encodeURIComponent(id)}`);
      await discard(response);
      if (response.status === 204 || response.status === 404) return;
      throw await failure(response);
    },
  };
}
