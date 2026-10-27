import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const MAX_BYTES = 32 * 1024 * 1024;
const DEADLINE = 30000;
const ORIGINS = { google: 'https://www.googleapis.com', microsoft: 'https://graph.microsoft.com' };

export class CloudProviderTransportError extends Error {
  constructor(message, { outcome = 'not-sent', status, retryAfterMs } = {}) {
    super(message);
    this.name = 'CloudProviderTransportError';
    this.outcome = outcome;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function invalid() {
  return new CloudProviderTransportError('Unsupported cloud storage request. No provider request was sent.');
}

function retryDelay(value) {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined;
}

function destination(provider, kind, target) {
  if (typeof target !== 'string' || !target || target.length > 16384
    || /[\s\\#]/.test(target)) throw invalid();
  if (kind === 'api' && (!target.startsWith('/') || target.startsWith('//')
    || /(?:^|\/)\.{1,2}(?:\/|[?]|$)|%(?:2e|2f|5c)/i.test(target.split('?')[0]))) throw invalid();
  let url;
  try { url = new URL(target, kind === 'api' ? ORIGINS[provider] : undefined); }
  catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) throw invalid();
  if (kind === 'api') {
    const path = provider === 'google' ? /^\/(?:upload\/)?drive\/v3\/files(?:\/|$)/
      : /^\/v1\.0\/me\/drive(?:\/|$)/;
    if (url.origin !== ORIGINS[provider] || !path.test(url.pathname)) throw invalid();
  } else if (kind === 'session') {
    const allowed = provider === 'google'
      ? url.origin === ORIGINS.google && /^\/upload\/drive\/v3\/files(?:\/|$)/.test(url.pathname)
      : url.hostname.endsWith('.up.1drv.com') || url.hostname === 'my.microsoftpersonalcontent.com';
    if (!allowed) throw invalid();
  } else if (kind !== 'download' || provider !== 'microsoft'
    || !(url.hostname.endsWith('.1drv.com') || url.hostname === 'my.microsoftpersonalcontent.com')) throw invalid();
  return url;
}

export function validateCloudUploadSession(provider, target) {
  if (!Object.hasOwn(ORIGINS, provider)) throw invalid();
  return destination(provider, 'session', target).href;
}

export function validateCloudDownloadHandoff(source, target) {
  const from = destination('microsoft', 'download', source);
  const next = destination('microsoft', 'download', target);
  if (from.origin !== next.origin || from.href === next.href) throw invalid();
  return next.href;
}

export function isCloudMatchTag(value) {
  return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,1024}"$/.test(value);
}

// Host-only transport. Callers must durably record intent before invoking a mutating request.
export function createCloudProviderTransport({ provider, getAccessToken, fetchImpl = globalThis.fetch }) {
  if (!Object.hasOwn(ORIGINS, provider) || typeof getAccessToken !== 'function'
    || typeof fetchImpl !== 'function') throw new TypeError('Native cloud transport configuration is required.');
  return async function request({
    kind = 'api', target, method = 'GET', body, contentRange, uploadSize, ifMatch, maxBytes = MAX_BYTES,
  }) {
    const url = destination(provider, kind, target);
    const conditionalContent = provider === 'microsoft' && kind === 'api'
      && /^\/v1\.0\/me\/drive\/items\/[^/]+\/content$/.test(url.pathname);
    const microsoftItem = provider === 'microsoft' && kind === 'api'
      && /^\/v1\.0\/me\/drive\/items\/[^/]+$/.test(url.pathname);
    const conditionalDelete = microsoftItem && method === 'DELETE' && !url.search;
    const allowed = kind === 'api' ? ['GET', 'POST', 'PATCH', ...(conditionalContent ? ['PUT'] : []),
      ...(conditionalDelete ? ['DELETE'] : [])] : kind === 'session'
      ? provider === 'google' ? ['PUT'] : ['GET', 'PUT'] : ['GET'];
    if (!allowed.includes(method) || !Number.isSafeInteger(maxBytes) || maxBytes < 1
      || maxBytes > MAX_BYTES || (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body))
      || (body !== undefined && method === 'GET')) throw invalid();
    if (body !== undefined && Buffer.byteLength(body) > MAX_BYTES) throw invalid();
    if (ifMatch !== undefined && (provider !== 'microsoft' || kind !== 'api' || !isCloudMatchTag(ifMatch)
      || !(conditionalDelete ? body === undefined : ((method === 'PUT' && conditionalContent)
        || (method === 'PATCH' && microsoftItem)) && body !== undefined && Buffer.byteLength(body) > 0))) throw invalid();
    if (kind === 'api' && ['PUT', 'DELETE'].includes(method) && ifMatch === undefined) throw invalid();
    const bytes = body === undefined ? undefined : Buffer.from(body);
    const startingUpload = provider === 'google' && kind === 'api' && url.pathname.startsWith('/upload/');
    if (startingUpload) {
      if (!['POST', 'PATCH'].includes(method) || url.searchParams.get('uploadType') !== 'resumable'
        || !Number.isSafeInteger(uploadSize) || uploadSize < 1 || uploadSize > MAX_BYTES || !bytes) throw invalid();
    } else if (uploadSize !== undefined) throw invalid();
    if (contentRange !== undefined) {
      if (kind !== 'session' || method !== 'PUT' || typeof contentRange !== 'string') throw invalid();
      const range = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(contentRange);
      if (!range) throw invalid();
      const total = Number(range[3]);
      if (!Number.isSafeInteger(total) || total < 1 || total > MAX_BYTES) throw invalid();
      if (range[1] === undefined) {
        if (provider !== 'google' || (bytes && bytes.length)) throw invalid();
      } else {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= total
          || !bytes || bytes.length !== end - start + 1) throw invalid();
      }
    } else if (kind === 'session' && method === 'PUT') throw invalid();
    const mutating = method !== 'GET' && !(kind === 'session' && contentRange?.startsWith('bytes */'));
    const headers = { accept: 'application/json' };
    if (ifMatch !== undefined) headers['if-match'] = ifMatch;
    if (bytes) headers['content-type'] = 'application/json';
    if (startingUpload) {
      headers['x-upload-content-type'] = 'application/json';
      headers['x-upload-content-length'] = String(uploadSize);
    }
    if (contentRange) headers['content-range'] = contentRange;
    if (kind === 'api' || provider === 'google') {
      let token;
      try { token = await getAccessToken(); }
      catch { throw new CloudProviderTransportError('Cloud authentication is unavailable. Reconnect before retrying.'); }
      if (typeof token !== 'string' || !token || token.length > 65536 || /[\r\n]/.test(token)) {
        throw new CloudProviderTransportError('Cloud authentication is unavailable. Reconnect before retrying.');
      }
      headers.authorization = `Bearer ${token}`;
    }
    const controller = new globalThis.AbortController();
    let timer;
    let reader;
    let outcome = 'not-sent';
    const timeout = new Promise((resolve, reject) => {
      timer = globalThis.setTimeout(() => {
        controller.abort();
        reject(new Error('Deadline'));
      }, DEADLINE);
    });
    const wait = (operation) => Promise.race([operation, timeout]);
    try {
      outcome = mutating ? 'unknown' : 'read-only';
      const response = await wait(fetchImpl(url, {
        method, headers, body: bytes, redirect: 'manual', signal: controller.signal,
      }));
      if (response.status === 302 && provider === 'microsoft' && method === 'GET'
        && (kind === 'download' || kind === 'api'
          && /^\/v1\.0\/me\/drive\/items\/[^/]+\/content$/.test(url.pathname))) {
        let target;
        try {
          target = kind === 'download' ? validateCloudDownloadHandoff(url.href, response.headers.get('location'))
            : destination(provider, 'download', response.headers.get('location')).href;
        }
        catch {
          throw new CloudProviderTransportError('The provider returned an unsupported cloud download destination.', {
            outcome, status: response.status,
          });
        }
        if (response.body) reader = response.body.getReader();
        return { status: response.status, bytes: Buffer.alloc(0), location: target };
      }
      if (response.status >= 300 && response.status !== 308) {
        throw new CloudProviderTransportError('The provider refused or redirected the cloud storage request.', {
          outcome, status: response.status, retryAfterMs: retryDelay(response.headers.get('retry-after')),
        });
      }
      if (!(response.status >= 200 && response.status < 300)
        && !(kind === 'session' && provider === 'google' && response.status === 308)) {
        throw new CloudProviderTransportError('The provider returned an unsupported cloud storage response.', {
          outcome, status: response.status,
        });
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))
        || Number(length) > maxBytes)) throw new Error('Response size');
      const chunks = [];
      let size = 0;
      if (response.body) {
        reader = response.body.getReader();
        while (true) {
          const { done, value } = await wait(reader.read());
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('Response size');
          chunks.push(Buffer.from(value));
        }
      }
      return {
        status: response.status, bytes: Buffer.concat(chunks),
        location: response.headers.get('location'), range: response.headers.get('range'),
        retryAfter: response.headers.get('retry-after'),
      };
    } catch (error) {
      if (error instanceof CloudProviderTransportError) throw error;
      throw new CloudProviderTransportError('The cloud storage request failed, timed out or exceeded its response limit.', { outcome });
    } finally {
      globalThis.clearTimeout(timer);
      controller.abort();
      // Cancellation is best-effort cleanup, never evidence that a dispatched write did not complete.
      if (reader) reader.cancel().catch(() => {});
    }
  };
}
