import {
  defaultPath,
  groupCatalog,
  modernTimelineLists,
  resolveReadingPaths,
  safeFile,
  storyKey,
} from './catalog.js';
import { isRead } from './model.js';

const MAX_SUGGESTIONS = 6;
const MAX_CACHE_FILES = 12;
const MAX_CACHE_ITEMS = 4096;

const owns = (map, key) => map != null && Object.prototype.hasOwnProperty.call(map, key);
const validIssueId = (id) => Number.isSafeInteger(id) && id !== 0;
const validSeriesId = (id) => (Number.isSafeInteger(id) && id > 0)
  || (typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)));

function rosterOf(ids) {
  if (!Array.isArray(ids) || [...ids].some((id) => !validIssueId(id))) return null;
  return [...new Set(ids)];
}

function fullyRead(state, ids) {
  const roster = rosterOf(ids);
  return Boolean(roster?.length && roster.every((id) => isRead(state, id)));
}

function publicationDate(value) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(value)) {
    return null;
  }
  const time = Date.parse(value);
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time) || !Number.isFinite(day.getTime())
    || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return time;
}

function issueMetadata(issue) {
  return {
    issueId: issue.issueId,
    seriesId: issue.seriesId ?? null,
    seriesName: typeof issue.seriesName === 'string' && issue.seriesName.trim()
      ? issue.seriesName
      : null,
    onSale: issue.onSale ?? null,
    creators: Array.isArray(issue.creators)
      ? issue.creators
        .filter((credit) => credit && typeof credit.name === 'string' && typeof credit.role === 'string')
        .map((credit) => ({ name: credit.name, role: credit.role }))
      : null,
  };
}

function parseOrder(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order) || !Array.isArray(order.items)) {
    throw new SyntaxError('The bundled order has no items array.');
  }
  const items = [];
  for (const issue of order.items) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) || !validIssueId(issue.issueId)) {
      throw new SyntaxError('The bundled order contains an invalid issue ID.');
    }
    items.push(issueMetadata(issue));
  }
  return { items };
}

function savedMetadata(state, list, order = null) {
  const roster = rosterOf(list.itemIds);
  if (!roster) return null;
  const bundled = new Map((order?.items ?? []).map((issue) => [issue.issueId, issue]));
  return roster.map((id) => {
    const stored = owns(state.issues, id) && state.issues[id]?.issueId === id
      ? issueMetadata(state.issues[id])
      : null;
    const fallback = bundled.get(id);
    const seriesId = validSeriesId(stored?.seriesId) ? stored.seriesId : fallback?.seriesId ?? null;
    return {
      issueId: id,
      seriesId,
      seriesName: stored?.seriesId === seriesId && stored.seriesName
        ? stored.seriesName
        : fallback?.seriesId === seriesId ? fallback.seriesName : null,
      onSale: publicationDate(stored?.onSale) != null ? stored.onSale : fallback?.onSale ?? null,
      creators: Array.isArray(stored?.creators) ? stored.creators : fallback?.creators ?? null,
    };
  });
}

function needsSourceMetadata(items) {
  return Boolean(items?.length && items.some((issue) => !Array.isArray(issue.creators)
    || !validSeriesId(issue.seriesId) || publicationDate(issue.onSale) == null));
}

function writerNames(issue) {
  return new Set((issue?.creators ?? [])
    .filter((credit) => credit.role === 'writer' && credit.name.trim())
    .map((credit) => credit.name));
}

function sourceWriters(items) {
  const counts = new Map();
  for (const issue of items ?? []) {
    for (const writer of writerNames(issue)) counts.set(writer, (counts.get(writer) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([writer]) => writer);
}

function seriesSpans(items) {
  const spans = new Map();
  if (!items?.length || items.some((issue) => !validSeriesId(issue.seriesId))) return spans;
  for (const issue of items) {
    const span = spans.get(issue.seriesId) ?? {
      start: Infinity,
      end: -Infinity,
      name: null,
      valid: true,
    };
    const time = publicationDate(issue.onSale);
    if (time == null) span.valid = false;
    else {
      span.start = Math.min(span.start, time);
      span.end = Math.max(span.end, time);
    }
    span.name ??= issue.seriesName;
    spans.set(issue.seriesId, span);
  }
  for (const [id, span] of spans) {
    if (!span.valid) spans.delete(id);
  }
  return spans;
}

function abortError() {
  const error = new Error('Cancelled.');
  error.name = 'AbortError';
  return error;
}

const cancelledResult = () => ({ suggestions: [], failures: [], cancelled: true });

function hintScore(candidate, source, writers, spans, state) {
  const keywords = new Set(candidate.entry.keywords ?? []);
  const characters = new Set(candidate.entry.characters ?? []);
  let score = writers.filter((writer) => keywords.has(writer)).length * 100;
  score += (source?.characters ?? []).filter((name) => characters.has(name)).length * 10;
  score += (source?.keywords ?? []).filter((name) => keywords.has(name)).length;
  for (const span of spans.values()) {
    if (span.name && keywords.has(span.name)) score += 20;
  }
  if (candidate.saved && (savedMetadata(state, candidate.saved) ?? [])
    .some((issue) => spans.has(issue.seriesId))) score += 20;
  if (Number.isInteger(source?.timeline) && Number.isInteger(candidate.entry.timeline)) {
    score += 1 / (1 + Math.abs(candidate.entry.timeline - source.timeline));
  }
  return score;
}

export function createListRecommendationResolver({ loadBundledOrder } = {}) {
  if (typeof loadBundledOrder !== 'function') throw new TypeError('A bundled-order loader is required.');
  const cache = new Map();
  const pending = new Map();
  let cachedItems = 0;

  function remember(file, order) {
    if (order.items.length > MAX_CACHE_ITEMS) return;
    while (cache.size >= MAX_CACHE_FILES || cachedItems + order.items.length > MAX_CACHE_ITEMS) {
      const oldest = cache.keys().next().value;
      cachedItems -= cache.get(oldest).items.length;
      cache.delete(oldest);
    }
    cache.set(file, order);
    cachedItems += order.items.length;
  }

  function load(file, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    const cached = cache.get(file);
    if (cached) {
      cache.delete(file);
      cache.set(file, cached);
      return Promise.resolve(cached);
    }
    let job = pending.get(file);
    if (!job) {
      job = { controller: new AbortController(), consumers: 0, settled: false };
      pending.set(file, job);
      job.promise = Promise.resolve()
        .then(() => loadBundledOrder(file, { signal: job.controller.signal }))
        .then(parseOrder)
        .then((order) => {
          if (pending.get(file) === job && !job.controller.signal.aborted) remember(file, order);
          return order;
        })
        .finally(() => {
          job.settled = true;
          if (pending.get(file) === job) pending.delete(file);
        });
    }
    // A request owns its subscription, not the shared fetch used by a newer request.
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (settle, value) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        job.consumers -= 1;
        if (!job.consumers && !job.settled) {
          if (pending.get(file) === job) pending.delete(file);
          job.controller.abort();
        }
        settle(value);
      };
      const onAbort = () => finish(reject, abortError());
      job.consumers += 1;
      signal?.addEventListener('abort', onAbort, { once: true });
      job.promise.then((order) => finish(resolve, order), (error) => finish(reject, error));
      if (signal?.aborted) onAbort();
    });
  }

  async function metadata(entry, stage, signal) {
    const file = safeFile(entry.file);
    if (!file) {
      return {
        order: null,
        failure: {
          stage,
          catalogId: entry.id,
          file: null,
          code: 'invalid-file',
          message: `Metadata for ${entry.name} has no safe bundled file.`,
        },
      };
    }
    try {
      return { order: await load(file, signal), failure: null };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      return {
        order: null,
        failure: {
          stage,
          catalogId: entry.id,
          file,
          code: error?.name === 'SyntaxError' ? 'parse-failed' : 'request-failed',
          message: `Could not load metadata for ${entry.name}: ${error?.message || 'The metadata request failed.'}`,
        },
      };
    }
  }

  async function resolve({ catalog, state, sourceListId, isCompleted, signal } = {}) {
    if (signal?.aborted) return cancelledResult();
    if (!Array.isArray(catalog?.lists) || !state?.lists || !state.read
      || typeof isCompleted !== 'function') {
      throw new TypeError('Recommendations require a catalog, reader state, and completion lookup.');
    }
    const source = owns(state.lists, sourceListId) ? state.lists[sourceListId] : null;
    if (!source) {
      return {
        suggestions: [],
        failures: [{
          stage: 'source',
          catalogId: null,
          file: null,
          code: 'source-not-found',
          message: 'The saved source list no longer exists.',
        }],
        cancelled: false,
      };
    }
    const failures = [];
    const byId = new Map(catalog.lists.map((entry) => [entry.id, entry]));
    const sourceEntry = byId.get(source.catalogId);
    const sourceKey = sourceEntry ? storyKey(sourceEntry) : null;
    const excluded = new Set(sourceKey == null ? [] : [sourceKey]);
    const savedByCatalogId = new Map();
    const savedIds = new Set([...(state.listOrder ?? []), ...Object.keys(state.lists)]);
    for (const id of savedIds) {
      const saved = owns(state.lists, id) ? state.lists[id] : null;
      const entry = byId.get(saved?.catalogId);
      if (!entry) continue;
      if (isCompleted(state, id) === true || fullyRead(state, saved.itemIds)) {
        excluded.add(storyKey(entry));
      } else if (!savedByCatalogId.has(entry.id) || id === state.active) {
        savedByCatalogId.set(entry.id, { ...saved, id });
      }
    }
    const candidates = new Map();
    for (const story of groupCatalog(catalog.lists)) {
      if (excluded.has(story.key)) continue;
      const entry = defaultPath(story, (list) => savedByCatalogId.has(list.id));
      if (entry) candidates.set(story.key, { key: story.key, entry, saved: savedByCatalogId.get(entry.id) });
    }
    const sequences = [];
    for (const path of resolveReadingPaths(catalog.paths, catalog.lists)) {
      const sourceIndex = path.stops.findIndex((stop) => stop.key === sourceKey);
      if (sourceIndex < 0) continue;
      sequences.push({
        stops: path.stops.slice(sourceIndex + 1)
          .filter((stop) => candidates.has(stop.key))
          .map((stop) => ({
            key: stop.key,
            reason: {
              type: 'reading-path',
              text: `Next in ${path.name}`,
              pathId: path.id,
              pathName: path.name,
              position: stop.position,
              total: stop.total,
              sourcePosition: path.stops[sourceIndex].position,
            },
          })),
      });
    }
    const timeline = groupCatalog(modernTimelineLists(catalog.lists));
    const sourceTimelineIndex = timeline.findIndex((story) => story.lists
      .some((entry) => entry.id === sourceEntry?.id));
    if (sourceTimelineIndex >= 0) {
      sequences.push({
        stops: timeline.slice(sourceTimelineIndex + 1)
          .map((story, index) => ({
            key: story.key,
            reason: {
              type: 'modern-timeline',
              text: 'Next in Modern Timeline',
              position: sourceTimelineIndex + index + 2,
              total: timeline.length,
              sourcePosition: sourceTimelineIndex + 1,
            },
          }))
          .filter((stop) => candidates.has(stop.key)),
      });
    }

    try {
      let sourceItems = savedMetadata(state, source);
      if (sourceEntry && needsSourceMetadata(sourceItems)) {
        const result = await metadata(sourceEntry, 'source', signal);
        if (result.failure) failures.push(result.failure);
        sourceItems = savedMetadata(state, source, result.order);
      }
      const writers = sourceWriters(sourceItems);
      const spans = seriesSpans(sourceItems);
      const shortlist = [];
      const shortlisted = new Set();
      const add = (candidate) => {
        if (!candidate || shortlisted.has(candidate.key) || shortlist.length >= MAX_SUGGESTIONS) return;
        shortlist.push(candidate);
        shortlisted.add(candidate.key);
      };
      for (const sequence of sequences) add(candidates.get(sequence.stops[0]?.key));
      if (writers.length || spans.size) {
        const hinted = [...candidates.values()]
          .map((candidate) => ({ candidate, score: hintScore(candidate, sourceEntry, writers, spans, state) }))
          .sort((a, b) => b.score - a.score);
        for (const { candidate } of hinted) add(candidate);
      }
      for (let depth = 1; shortlist.length < MAX_SUGGESTIONS
        && sequences.some((sequence) => sequence.stops.length > depth); depth += 1) {
        for (const sequence of sequences) add(candidates.get(sequence.stops[depth]?.key));
      }
      const loaded = await Promise.all(shortlist.map(async (candidate) => ({
        ...candidate,
        ...await metadata(candidate.entry, 'candidate', signal),
      })));
      if (signal?.aborted) return cancelledResult();
      for (const candidate of loaded) {
        if (candidate.failure) failures.push(candidate.failure);
        if (candidate.order && fullyRead(state, candidate.order.items.map((issue) => issue.issueId))) {
          excluded.add(candidate.key);
        }
      }
      const continuationReasons = new Map();
      for (const sequence of sequences) {
        const next = sequence.stops.find((stop) => !excluded.has(stop.key));
        if (!next || !shortlisted.has(next.key)) continue;
        const reasons = continuationReasons.get(next.key) ?? [];
        reasons.push(next.reason);
        continuationReasons.set(next.key, reasons);
      }
      const suggestions = [];
      for (const candidate of loaded) {
        if (excluded.has(candidate.key)) continue;
        const reasons = [...(continuationReasons.get(candidate.key) ?? [])];
        const items = candidate.saved
          ? savedMetadata(state, candidate.saved, candidate.order)
          : candidate.order?.items;
        const candidateWriters = new Set((items ?? []).flatMap((issue) => [...writerNames(issue)]));
        for (const writer of writers) {
          if (candidateWriters.has(writer)) {
            reasons.push({ type: 'same-writer', text: `Includes comics by ${writer}`, writer });
          }
        }
        for (const [seriesId, candidateSpan] of seriesSpans(items)) {
          const sourceSpan = spans.get(seriesId);
          if (!sourceSpan || candidateSpan.start <= sourceSpan.end) continue;
          const seriesName = candidateSpan.name ?? sourceSpan.name;
          reasons.push({
            type: 'later-series',
            text: seriesName ? `Later comics in ${seriesName}` : 'Later comics from the same series',
            seriesId,
            seriesName,
            sourceEnd: new Date(sourceSpan.end).toISOString(),
            candidateStart: new Date(candidateSpan.start).toISOString(),
          });
        }
        if (!reasons.length) continue;
        suggestions.push({
          catalogId: candidate.entry.id,
          name: candidate.entry.name,
          storyKey: candidate.key,
          ...(candidate.saved ? { savedListId: candidate.saved.id } : {}),
          reasons,
        });
      }
      return { suggestions, failures, cancelled: false };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return cancelledResult();
      throw error;
    }
  }

  return { resolve };
}
