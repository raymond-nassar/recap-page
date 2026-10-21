import { parseCatalog, safeFile } from './catalog.js';
import { shellUrls } from './offline.js';

export const CONTENT_CACHE_PREFIX = 'mrt-offline-content-v1-';
export const CONTENT_MANIFEST_PATH = '/__mrt_offline_content__/manifest.json';
export const CONTENT_MAX_CONCURRENT = 4;

const FORMAT = 'mrt-offline-content';
const VERSION = 1;
const CATALOG_PATH = '/data/catalog.json';

function shellPath(path) {
  return path === '/'
    || path === '/index.html'
    || path === '/styles.css'
    || (/^\/js\/.+\.js$/).test(path);
}

function contentTypeFor(path) {
  if (path === '/' || path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return /^(text|application)\/(javascript|ecmascript)$/;
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.json')) return 'application/json';
  return null;
}

function normalizedUrl(raw, origin) {
  if (typeof raw !== 'string' || raw.includes('\\')) return null;
  let url;
  try {
    url = new URL(raw, `${origin}/`);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
  return url;
}

function shellResourceUrls(scope) {
  const origin = scope.location?.origin;
  if (typeof origin !== 'string') throw new Error('The app origin is unavailable.');
  const urls = new Set();
  for (const raw of shellUrls(scope)) {
    const url = normalizedUrl(raw, origin);
    if (url && shellPath(url.pathname)) urls.add(url.href);
  }
  if (!urls.size) throw new Error('The loaded app shell could not be identified.');
  return [...urls].sort();
}

function checkAbort(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function mapLimit(items, operation, { signal, onProgress, phase }) {
  const results = new Array(items.length);
  let next = 0;
  let firstError = null;
  let completed = 0;
  const worker = async () => {
    while (!firstError) {
      try {
        checkAbort(signal);
        const index = next++;
        if (index >= items.length) return;
        results[index] = await operation(items[index], index);
        completed += 1;
        onProgress?.({ phase, completed, total: items.length, path: items[index].path });
      } catch (error) {
        firstError ??= error;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(CONTENT_MAX_CONCURRENT, items.length) },
    () => worker(),
  ));
  if (firstError) throw firstError;
  checkAbort(signal);
  return results;
}

async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) throw new Error('This browser cannot verify offline content.');
  const hash = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function stableInventory(resources) {
  return [...resources]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, kind, sha256: digest, bytes, contentType }) => ({
      path, kind, sha256: digest, bytes, contentType,
    }));
}

async function digestInventory(resources, cryptoProvider) {
  const normalized = stableInventory(resources);
  return sha256(new TextEncoder().encode(JSON.stringify(
    normalized.map(({ path, kind, sha256: digest, bytes, contentType }) => (
      [path, kind, digest, bytes, contentType]
    )),
  )), cryptoProvider);
}

async function sourceDigest(resources, cryptoProvider) {
  return digestInventory(resources.filter((resource) => resource.kind === 'shell'), cryptoProvider);
}

function manifestUrl(origin) {
  return new URL(CONTENT_MANIFEST_PATH, origin).href;
}

function cacheKey(cache, url) {
  return cache.match(url);
}

function mediaMatches(path, value) {
  const expected = contentTypeFor(path);
  const actual = String(value ?? '').split(';', 1)[0].trim().toLowerCase();
  if (expected instanceof RegExp) return expected.test(actual);
  return expected === actual;
}

async function fetchResource({ fetchImpl, url, kind, signal }) {
  const response = await fetchImpl(url.href, {
    cache: 'no-cache',
    redirect: 'error',
    signal,
  });
  if (!response || response.status !== 200) {
    throw new Error(`${url.pathname} did not return a complete response.`);
  }
  if (response.type === 'opaque' || response.redirected) {
    throw new Error(`${url.pathname} did not return a verifiable same-origin response.`);
  }
  const finalUrl = response.url ? normalizedUrl(response.url, url.origin) : url;
  if (!finalUrl || finalUrl.href !== url.href) {
    throw new Error(`${url.pathname} redirected outside its expected app resource.`);
  }
  const contentType = response.headers?.get?.('content-type');
  if (!mediaMatches(url.pathname, contentType)) {
    throw new Error(`${url.pathname} has an unsupported content type.`);
  }
  if (typeof response.clone !== 'function') {
    throw new Error(`${url.pathname} cannot be verified before it is cached.`);
  }
  const bytes = await response.clone().arrayBuffer();
  return {
    path: url.pathname,
    url: url.href,
    kind,
    contentType: String(contentType).split(';', 1)[0].trim().toLowerCase(),
    bytes: bytes.byteLength,
    body: bytes,
    response,
  };
}

async function hashResource(resource, cryptoProvider) {
  return { ...resource, sha256: await sha256(resource.body, cryptoProvider) };
}

function readText(bytes, scope) {
  const Decoder = scope.TextDecoder ?? globalThis.TextDecoder;
  return new Decoder().decode(bytes);
}

function usable(scope, caches, cryptoProvider) {
  if (!scope.navigator?.serviceWorker) return 'This browser does not support offline app storage.';
  if (!scope.navigator.serviceWorker.controller) {
    return 'The app service worker must control this page before offline preparation is available.';
  }
  if (!caches?.open || !caches?.keys || !caches?.delete) return 'Browser offline storage is unavailable.';
  if (!cryptoProvider?.subtle?.digest) return 'This browser cannot verify offline content.';
  return null;
}

async function currentBase({ scope, fetchImpl, cryptoProvider, signal, onProgress }) {
  const origin = scope.location.origin;
  const shellUrlsForPage = shellResourceUrls(scope);
  const resources = [
    ...shellUrlsForPage.map((url) => ({ url, path: new URL(url).pathname, kind: 'shell' })),
    { url: new URL(CATALOG_PATH, origin).href, path: CATALOG_PATH, kind: 'catalog' },
  ];
  const fetched = await mapLimit(resources, (resource) => fetchResource({
    fetchImpl, url: new URL(resource.url), kind: resource.kind, signal,
  }), { signal, onProgress, phase: 'fetch' });
  const hashed = await Promise.all(fetched.map((resource) => hashResource(resource, cryptoProvider)));
  const catalogResource = hashed.find((resource) => resource.kind === 'catalog');
  let catalog;
  try {
    catalog = parseCatalog(JSON.parse(readText(catalogResource.body, scope)));
  } catch (error) {
    throw new Error(`The curated Reading List catalog could not be verified (${error.message}).`, { cause: error });
  }
  return {
    origin,
    shell: hashed.filter((resource) => resource.kind === 'shell'),
    catalog: catalogResource,
    lists: catalog.lists,
  };
}

function selectedList(lists, listId) {
  if (typeof listId !== 'string' || !listId.trim()) {
    throw new Error('Choose a Reading List before preparing offline content.');
  }
  const list = lists.find((entry) => entry.id === listId);
  if (!list) throw new Error('That Reading List is no longer in the catalog. Refresh and choose again.');
  const file = safeFile(list.file);
  if (!file) throw new Error('That Reading List does not have a safe bundled content file.');
  return { ...list, file };
}

async function cacheManifest(cache, origin) {
  const response = await cacheKey(cache, manifestUrl(origin));
  if (!response) return null;
  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    throw new Error('A saved offline-content manifest could not be read.', { cause: error });
  }
  if (!manifest || manifest.format !== FORMAT || manifest.version !== VERSION
    || manifest.complete !== true || typeof manifest.listId !== 'string' || !manifest.listId.trim()
    || !safeFile(manifest.file) || !Array.isArray(manifest.resources) || !manifest.resources.length
    || manifest.resources.some((item) => !item || typeof item !== 'object')
    || !/^[0-9a-f]{64}$/.test(manifest.sourceDigest)
    || !/^[0-9a-f]{64}$/.test(manifest.contentDigest)) {
    throw new Error('A saved offline-content manifest is incomplete or unsupported.');
  }
  return manifest;
}

async function verifyBundle(cache, manifest, origin, cryptoProvider) {
  const resources = [];
  const paths = new Set();
  let shellCount = 0;
  let catalogCount = 0;
  let selectedCount = 0;
  for (const item of manifest.resources) {
    const url = normalizedUrl(item.path, origin);
    if (!url || url.pathname !== item.path || url.search || url.hash
      || !/^[0-9a-f]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0
      || typeof item.contentType !== 'string'
      || paths.has(item.path)
      || !['shell', 'catalog', 'selected'].includes(item.kind)
      || (item.kind === 'shell' && !shellPath(item.path))
      || (item.kind === 'catalog' && item.path !== CATALOG_PATH)
      || (item.kind === 'selected' && item.path !== `/data/${manifest.file}`)
      || !mediaMatches(item.path, item.contentType)) return false;
    paths.add(item.path);
    if (item.kind === 'shell') shellCount += 1;
    if (item.kind === 'catalog') catalogCount += 1;
    if (item.kind === 'selected') selectedCount += 1;
    if (!await verifyCacheEntry(cache, { ...item, url: url.href }, cryptoProvider)) return false;
    resources.push(item);
  }
  if (!shellCount || catalogCount !== 1 || selectedCount !== 1) return false;
  return await sourceDigest(resources, cryptoProvider) === manifest.sourceDigest
    && await digestInventory(resources, cryptoProvider) === manifest.contentDigest;
}

async function verifyCacheEntry(cache, resource, cryptoProvider) {
  const response = await cacheKey(cache, resource.url);
  if (!response || response.status !== 200) return false;
  const bytes = await response.clone().arrayBuffer();
  return bytes.byteLength === resource.bytes
    && await sha256(bytes, cryptoProvider) === resource.sha256;
}

async function cacheName(listId, contentDigest, cryptoProvider) {
  const idDigest = await sha256(new TextEncoder().encode(listId), cryptoProvider);
  return `${CONTENT_CACHE_PREFIX}${idDigest.slice(0, 16)}-${contentDigest}`;
}

function asResponse(scope, value) {
  const ResponseType = scope.Response ?? globalThis.Response;
  return new ResponseType(value, { headers: { 'content-type': 'application/json' } });
}

function abortResult(error) {
  return error?.name === 'AbortError';
}

export function createOfflineContent({
  scope = globalThis,
  caches = scope.caches,
  fetchImpl = scope.fetch?.bind(scope),
} = {}) {
  const cryptoProvider = scope.crypto ?? globalThis.crypto;
  let preparing = false;

  async function prepare(listId, { signal, onProgress } = {}) {
    const unavailable = usable(scope, caches, cryptoProvider);
    if (unavailable) return { ok: false, state: 'unsupported', error: unavailable };
    if (preparing) return { ok: false, state: 'preparing', error: 'Offline preparation is already running.' };
    preparing = true;
    let stageName = null;
    try {
      checkAbort(signal);
      const base = await currentBase({ scope, fetchImpl, cryptoProvider, signal, onProgress });
      const list = selectedList(base.lists, listId);
      const listUrl = new URL(`/data/${list.file}`, base.origin);
      const selected = await fetchResource({
        fetchImpl, url: listUrl, kind: 'selected', signal,
      });
      let payload;
      try {
        payload = JSON.parse(readText(selected.body, scope));
      } catch (error) {
        throw new Error(`The selected Reading List content is not valid JSON (${error.message}).`, { cause: error });
      }
      if (!payload || payload.id !== list.id || !Array.isArray(payload.items)) {
        throw new Error('The selected Reading List content does not match its catalog identity.');
      }
      const all = [
        ...base.shell,
        base.catalog,
        await hashResource(selected, cryptoProvider),
      ];
      const sDigest = await sourceDigest(all, cryptoProvider);
      const cDigest = await digestInventory(all, cryptoProvider);
      const inventory = stableInventory(all);
      const name = await cacheName(list.id, cDigest, cryptoProvider);
      const cache = await caches.open(name);
      const previousManifest = await cacheManifest(cache, base.origin);
      if (previousManifest && previousManifest.contentDigest === cDigest
        && await verifyBundle(cache, previousManifest, base.origin, cryptoProvider)) {
        return {
          ok: true, state: 'ready', listId: list.id, file: list.file,
          cacheName: name, manifest: previousManifest,
        };
      }
      stageName = name;
      if (previousManifest) await caches.delete(name);
      const staging = await caches.open(name);
      await mapLimit(all, async (resource) => {
        checkAbort(signal);
        await staging.put(resource.url, resource.response.clone());
        if (!await verifyCacheEntry(staging, resource, cryptoProvider)) {
          throw new Error(`${resource.path} did not match after its offline write.`);
        }
      }, { signal, onProgress, phase: 'write' });
      checkAbort(signal);
      const manifest = {
        format: FORMAT,
        version: VERSION,
        complete: true,
        listId: list.id,
        file: list.file,
        sourceDigest: sDigest,
        contentDigest: cDigest,
        resources: inventory,
      };
      const serialized = JSON.stringify(manifest);
      await staging.put(manifestUrl(base.origin), asResponse(scope, serialized));
      const committed = await cacheManifest(staging, base.origin);
      if (!committed || JSON.stringify(committed) !== serialized
        || !await verifyBundle(staging, committed, base.origin, cryptoProvider)) {
        throw new Error('The completed offline Reading List could not be confirmed.');
      }
      const cleanupWarnings = [];
      for (const otherName of await caches.keys()) {
        if (!otherName.startsWith(CONTENT_CACHE_PREFIX) || otherName === name) continue;
        const other = await caches.open(otherName);
        const otherManifest = await cacheManifest(other, base.origin);
        if (otherManifest?.listId !== list.id) continue;
        try {
          if (!await caches.delete(otherName)) cleanupWarnings.push(otherName);
        } catch (error) {
          cleanupWarnings.push(`${otherName}: ${error.message}`);
        }
      }
      return {
        ok: true, state: 'ready', listId: list.id, file: list.file,
        cacheName: name, manifest: committed, cleanupWarnings,
      };
    } catch (error) {
      let cleanupError = null;
      if (stageName) {
        try {
          await caches.delete(stageName);
        } catch (cleanupFailure) {
          cleanupError = cleanupFailure.message;
        }
      }
      return {
        ok: false,
        state: abortResult(error) ? 'cancelled' : 'failed',
        error: error.message,
        cleanupError,
      };
    } finally {
      preparing = false;
    }
  }

  async function readiness(listId, { signal, onProgress } = {}) {
    const unavailable = usable(scope, caches, cryptoProvider);
    if (unavailable) return { ok: false, state: 'unsupported', error: unavailable };
    if (preparing) return { ok: false, state: 'preparing' };
    try {
      checkAbort(signal);
      const base = await currentBase({ scope, fetchImpl, cryptoProvider, signal, onProgress });
      const list = selectedList(base.lists, listId);
      const candidates = [];
      let hasCandidate = false;
      for (const name of await caches.keys()) {
        if (!name.startsWith(CONTENT_CACHE_PREFIX)) continue;
        const cache = await caches.open(name);
        const manifest = await cacheManifest(cache, base.origin);
        if (manifest?.listId !== list.id) continue;
        hasCandidate = true;
        if (!await verifyBundle(cache, manifest, base.origin, cryptoProvider)) continue;
        const catalogEntry = manifest.resources.find((resource) => resource.kind === 'catalog');
        if (manifest.sourceDigest === await sourceDigest(base.shell, cryptoProvider)
          && catalogEntry?.sha256 === base.catalog.sha256
          && manifest.file === list.file) {
          candidates.push({ name, cache, manifest });
        }
      }
      if (!candidates.length) {
        return {
          ok: true,
          state: hasCandidate ? 'stale' : 'idle',
          listId: list.id,
          file: list.file,
          reason: hasCandidate ? 'The saved offline copy no longer matches this app or catalog.' : null,
        };
      }
      const selectedUrl = new URL(`/data/${list.file}`, base.origin);
      const currentSelected = await hashResource(await fetchResource({
        fetchImpl, url: selectedUrl, kind: 'selected', signal,
      }), cryptoProvider);
      const match = candidates.find(({ manifest }) => (
        manifest.resources.some((resource) => resource.kind === 'selected'
          && resource.path === currentSelected.path && resource.sha256 === currentSelected.sha256)
      ));
      if (!match) {
        return {
          ok: true, state: 'stale', listId: list.id, file: list.file,
          reason: 'The selected Reading List content has changed. Prepare it again.',
        };
      }
      return {
        ok: true, state: 'ready', listId: list.id, file: list.file,
        cacheName: match.name, manifest: match.manifest,
      };
    } catch (error) {
      return {
        ok: false,
        state: abortResult(error) ? 'cancelled' : 'failed',
        error: error.message,
      };
    }
  }

  return { prepare, readiness };
}
