// Client for the community Marvel metadata API.
// Every request goes through the rate limiter and the IndexedDB cache.

import { RateLimiter, abortError } from './lib/limiter.js';
import { ResponseCache } from './cache.js';
import { isAllowedApiBase } from './lib/apiBase.js';
import { DEFAULT_LIMIT, parseNameIndex, searchNames } from './lib/nameIndex.js';

export const DEFAULT_BASE = 'https://marvel.emreparker.com/v1';
export const MAX_LIMIT = 200; // limit=500 returns HTTP 422

// Series and creators are searched locally against a vendored index, because the API ignores
// `q` on those two routes. See lib/nameIndex.js and scripts/vendor-index.mjs.
const INDEXES = {
  series: { file: 'series-index.json', label: 'series' },
  creators: { file: 'creators-index.json', label: 'creator' },
};

// Removes issue synopsis prose from a response before it is cached, leaving everything else alone.
//
// The alternative, deleting `description` wherever the key appears, was the first design and is
// wrong. This cache is general: /health, /search/issues, /series and /creators all pass through it,
// and a `description` on any of those means something else. Stripping by key alone would quietly
// corrupt a response whose shape nobody had thought about yet, which is a worse failure than the
// one it prevents, because it would show up as missing text somewhere unrelated with nothing to
// connect it back to here.
//
// So the shape is checked instead: a record carrying an issue id, or a list of them under `items`,
// which is what /issues/{id} and /search/issues return. The defence against a new prose-bearing
// shape arriving later is a test asserting the strip, not a wider strip.
//
// The copy is shallow and made only when there is something to remove, so an unaffected response is
// cached as the same object it already was.
export function withoutSynopsis(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data.items)) {
    return { ...data, items: data.items.map(withoutSynopsis) };
  }
  const looksLikeIssue = data.id != null || data.issueId != null;
  if (!looksLikeIssue || data.description == null) return data;
  const copy = { ...data };
  delete copy.description;
  return copy;
}

// fetch and sleep are injectable for the same reason RateLimiter takes now and sleep: the retry
// chain is four attempts deep and waits between them, so a test that drives it against a service
// answering 503 sits for about fifteen seconds of real time and cannot see the responses it is
// asserting about. Both default to the globals, and fetch is read through a wrapper rather than
// captured, so a page that replaces globalThis.fetch after this module loads is still honoured.
export class MarvelApi {
  constructor({
    baseUrl = DEFAULT_BASE, limiter, cache, onStatus = () => {}, loadIndex, fetch: fetchImpl, sleep: sleepImpl,
  } = {}) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    // The settings form is not the only way a base URL reaches this client. loadSettings() reads
    // one out of localStorage on every boot, and that value outlives the build that wrote it, so
    // an older version, a hand edit or a restored backup can put anything at all in front of the
    // fetch in get(). Checking here means a client that would fetch from somewhere the rule
    // does not allow cannot be built in the first place, which is a stronger guarantee than
    // remembering to check at each of the three call sites. It throws rather than falling back,
    // because silently talking to a different service than the one asked for is the failure this
    // is meant to prevent, not an acceptable recovery from it.
    if (!isAllowedApiBase(base)) {
      throw new TypeError(`Refusing ${JSON.stringify(String(baseUrl))} as an API base: use https, or http against localhost.`);
    }
    this.baseUrl = base;
    this.limiter = limiter ?? new RateLimiter();
    this.cache = cache ?? new ResponseCache({ baseUrl: this.baseUrl });
    this.onStatus = onStatus;
    this.loadIndex = loadIndex ?? fetchNameIndex;
    this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.sleep = sleepImpl ?? sleep;
    this.indexes = new Map();
  }

  get queueDepth() {
    return this.limiter.depth;
  }

  async get(path, { signal, cache = true, attempt = 0 } = {}) {
    if (cache) {
      const hit = await this.cache.get(path);
      if (hit) return hit;
    }

    const run = async () => {
      const res = await this.fetch(this.baseUrl + path, {
        headers: { accept: 'application/json' },
        // The app's own cache is the one above, and it is stripped of synopsis prose before
        // anything is written to it. The browser's cache is not: it stores the response as sent,
        // on disk, under rules this app cannot read and a "clear cached metadata" button cannot
        // reach. Without this directive the promise that a fetched synopsis lives only in memory
        // would hold everywhere except the one store the reader has no way to inspect.
        cache: 'no-store',
        signal,
      });
      this.limiter.observe(res.headers);

      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new ApiError(`Service is busy (HTTP ${res.status}).`, res.status, true);
        const wait = this.limiter.backoff(attempt);
        this.limiter.penalize(wait);
        this.onStatus({ kind: 'backoff', ms: wait, status: res.status });
        throw new RetrySignal(wait);
      }
      // The service answered. Reported even for a 404 or another refusal, because what this
      // says is that the service is responding rather than that the answer was welcome, and
      // that is the only thing that can tell a caller a run of backoffs has ended. Nothing is
      // reported when the retries are exhausted above: that is the service still not answering.
      this.onStatus({ kind: 'ok', status: res.status });
      if (res.status === 404) throw new ApiError('Not found.', 404, false);
      if (!res.ok) throw new ApiError(`Request failed (HTTP ${res.status}).`, res.status, false);
      return res.json();
    };

    try {
      const data = await this.limiter.schedule(run, { signal });
      if (cache) await this.cache.set(path, withoutSynopsis(data));
      return data;
    } catch (err) {
      if (err instanceof RetrySignal) {
        await this.sleep(err.wait, signal);
        return this.get(path, { signal, cache, attempt: attempt + 1 });
      }
      throw err;
    }
  }

  health(opts) {
    return this.get('/health', { cache: false, ...opts });
  }

  async searchIssues(q, { limit = 50, signal } = {}) {
    const data = await this.get(
      `/search/issues?q=${encodeURIComponent(q)}&limit=${clampLimit(limit)}`,
      { signal },
    );
    return (data.items ?? []).map(toIssue);
  }

  async issue(id, opts = {}) {
    const data = await this.get(`/issues/${Number(id)}`, opts);
    return toIssue(data);
  }

  // Series and creator search is local, not a request.
  //
  // `/series?q=…` and `/creators?q=…` accept the parameter and silently ignore it: the response
  // is identical to the unfiltered one. Sending it anyway is what made "Add a whole series" and
  // "Browse a creator" answer every query with the alphabetical head of the collection ("#O",
  // "#X", "A CO" for a creator search of "Hickman"), each row wired to a one-click "Add all
  // issues". So the two collections are vendored into src/data/ and filtered here instead.
  //
  // Unlike searchIssues these return an envelope rather than a bare array, because a local
  // search knows how many names actually matched and when its snapshot was taken, and the view
  // has to be able to say "40 of 312" rather than implying the other 272 do not exist.
  async searchNameIndex(kind, q, { limit = DEFAULT_LIMIT } = {}) {
    const index = await this.nameIndex(kind);
    const { items, matched } = searchNames(index.entries, q, { limit });
    return { items, matched, limit, generatedAt: index.generatedAt, total: index.total };
  }

  searchSeries(q, opts) {
    return this.searchNameIndex('series', q, opts);
  }

  searchCreators(q, opts) {
    return this.searchNameIndex('creators', q, opts);
  }

  // One shared load per index, so two searches started in quick succession cannot fetch the
  // same file twice. A failure drops the entry so a later search retries rather than replaying
  // the original error forever.
  nameIndex(kind) {
    let pending = this.indexes.get(kind);
    if (!pending) {
      pending = this.loadIndex(kind).then(parseNameIndex);
      pending.catch(() => {
        if (this.indexes.get(kind) === pending) this.indexes.delete(kind);
      });
      this.indexes.set(kind, pending);
    }
    return pending;
  }

  // Lets a view start the download when the reader opens the search, instead of making the
  // first search wait for it. Failures are the caller's to ignore: this is only a head start.
  warmNameIndex(kind) {
    return this.nameIndex(kind).catch(() => null);
  }

  // Pages to completion. Guarded so a misbehaving `has_next` cannot loop forever.
  async allPages(path, { signal, onPage, onProgress, maxPages = 60 } = {}) {
    const out = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page += 1) {
      if (signal?.aborted) throw abortError();
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.get(`${path}${sep}limit=${MAX_LIMIT}&offset=${offset}`, { signal });
      const items = data.items ?? [];
      out.push(...items);
      const progress = { loaded: out.length, total: data.total ?? null };
      if (signal?.aborted) throw abortError();
      await onPage?.(items, progress);
      if (signal?.aborted) throw abortError();
      onProgress?.(progress);
      if (!data.has_next || items.length === 0) break;
      offset += items.length;
      if (data.total != null && out.length >= data.total) break;
    }
    return out;
  }

  async seriesIssues(seriesId, opts = {}) {
    const { onPage, ...pageOpts } = opts;
    const items = await this.allPages(`/series/${Number(seriesId)}/issues`, {
      ...pageOpts,
      onPage: onPage ? (page, progress) => onPage(page.map(toIssue).filter(Boolean), progress) : undefined,
    });
    return items.map(toIssue);
  }

  async creatorIssues(creatorId, opts = {}) {
    const { onPage, ...pageOpts } = opts;
    const items = await this.allPages(`/creators/${Number(creatorId)}/issues`, {
      ...pageOpts,
      onPage: onPage ? (page, progress) => onPage(page.map(toIssue).filter(Boolean), progress) : undefined,
    });
    // Creator responses omit detailUrl and unlimitedDate; toIssue reconstructs the URL and
    // leaves availability `unknown` rather than implying the issue is not in Unlimited.
    return items.map(toIssue);
  }
}

// Maps an API record to the app's issue shape. Fields the endpoint does not return stay null,
// and `hydrated` records whether we have the fields the UI needs.
export function toIssue(raw) {
  if (!raw) return null;
  const issueId = Number(raw.id ?? raw.issueId);
  return {
    issueId,
    title: raw.title ?? `Issue ${issueId}`,
    number: raw.issueNumber ?? null,
    url: raw.detailUrl ?? `https://www.marvel.com/comics/issue/${issueId}/`,
    seriesId: raw.seriesId ?? null,
    seriesName: raw.seriesName ?? null,
    onSale: raw.onSaleDate ?? null,
    mu: raw.unlimitedDate ?? null,
    digitalId: raw.digitalId ?? null,
    // Only /v1/issues/{id} returns these; list endpoints omit them entirely.
    cover: raw.cover ?? null,
    description: raw.description ?? null,
    pageCount: raw.pageCount ?? null,
    creators: Array.isArray(raw.creators) ? raw.creators : null,
    source: 'api',
    hydrated: raw.digitalId != null,
  };
}

export class ApiError extends Error {
  constructor(message, status, transient) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.transient = transient;
  }
}

// Loads a vendored index from our own origin.
//
// The URL is resolved against this module rather than the page, so it does not depend on which
// HTML file is open or how deep it sits. A failure is reported as a failure: falling back to an
// unfiltered list would put us straight back to answering "Hickman" with "#O".
async function fetchNameIndex(kind) {
  const spec = INDEXES[kind];
  if (!spec) throw new Error(`Unknown search index "${kind}".`);

  // What to do about it has to match what the code actually does. nameIndex() drops the failed
  // load, so simply searching again starts a fresh attempt — telling the reader to reload would
  // send them off to lose their place for no reason.
  const unavailable = (reason) => new ApiError(
    `The ${spec.label} index could not be loaded (${reason}), so ${spec.label} search is unavailable. ` +
    'Search again to retry.',
    null,
    false,
  );

  let res;
  try {
    // no-cache, not no-store: the browser still keeps the file, it just revalidates before
    // reusing it, so re-running the vendor script is picked up on the next load rather than
    // whenever a heuristic decides. That guarantee is worth having because the index is a
    // snapshot the view puts a date on, and a stale one would make the view's date a lie.
    // server.mjs sends an ETag, so revalidating an unchanged index costs a 304, not 345 KB.
    // This matches how main.js loads catalog.json and the reading orders.
    res = await fetch(new URL(`../data/${spec.file}`, import.meta.url), { cache: 'no-cache' });
  } catch {
    throw unavailable('it could not be fetched');
  }
  if (!res.ok) throw unavailable(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw unavailable('it is not valid JSON');
  }
}

class RetrySignal {
  constructor(wait) {
    this.wait = wait;
  }
}

function clampLimit(n) {
  return Math.max(1, Math.min(MAX_LIMIT, Number(n) || 20));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      reject(abortError());
    });
  });
}
