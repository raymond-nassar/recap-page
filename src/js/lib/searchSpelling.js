import { foldName } from './nameIndex.js';

const nameCache = new WeakMap();
const seriesCache = new WeakMap();
const MAX_QUERY = 80;
const MAX_SUGGESTIONS = 3;

function candidates(entries, series) {
  const cache = series ? seriesCache : nameCache;
  if (cache.has(entries)) return cache.get(entries);
  const unique = new Map();
  for (const entry of entries) {
    const name = series
      ? entry.name.replace(/\s*\(\d{4}(?:\s*-\s*(?:\d{4}|present))?\)\s*$/i, '')
      : entry.name;
    const folded = foldName(name);
    if (!folded) continue;
    const size = entry.issueCount ?? -1;
    if (!unique.has(folded) || unique.get(folded).size < size) {
      unique.set(folded, { name, words: folded.split(' '), size });
    }
  }
  const prepared = [...unique.values()];
  cache.set(entries, prepared);
  return prepared;
}

// Four-letter words can still be ambiguous, so these are optional names, not corrections.
// In particular, "wman" must not become "man", and Marvel 1602 must not become Marvel 1603.
function edits(a, b) {
  if (a === b) return 0;
  if (a.length < 4 || b.length < 4 || /\d/.test(a + b) || Math.abs(a.length - b.length) > 1) return 2;
  let at = 0;
  while (at < Math.min(a.length, b.length) && a[at] === b[at]) at += 1;
  if (a.length !== b.length) {
    return (a.length > b.length
      ? a.slice(at + 1) === b.slice(at)
      : a.slice(at) === b.slice(at + 1)) ? 1 : 2;
  }
  if (a.slice(at + 1) === b.slice(at + 1)) return 1;
  return a[at] === b[at + 1] && a[at + 1] === b[at]
    && a.slice(at + 2) === b.slice(at + 2) ? 1 : 2;
}

export function suggestNames(entries, query, { series = false } = {}) {
  const phrase = foldName(query);
  if (!Array.isArray(entries) || !phrase || phrase.length > MAX_QUERY) return [];
  const words = phrase.split(' ');
  if (!words.some((word) => word.length >= 4 && !/\d/.test(word))) return [];
  const hits = [];
  for (const candidate of candidates(entries, series)) {
    for (let start = 0; start <= candidate.words.length - words.length; start += 1) {
      let cost = 0;
      for (let i = 0; i < words.length && cost <= 1; i += 1) {
        cost += edits(words[i], candidate.words[start + i]);
      }
      if (cost === 1) {
        hits.push({ ...candidate, extra: candidate.words.length - words.length });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.extra - b.extra || b.size - a.size
    || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS).map((hit) => hit.name);
}
