// The reader's rated comics, and the Character guide associations used to filter them.
//
// Pure and browser-free apart from the injectable loader at the bottom, like the rest of
// src/js/lib: nothing here reads storage or touches the DOM.
//
// The collection is every key of state.ratings and nothing else. A rating outlives the list that
// introduced its issue, exactly as read state and notes do, so selecting through lists or through
// state.issues alone would silently lose scores the reader still holds. An ID with no saved
// metadata is still a rated comic and is shown as "Issue {id}" rather than dropped.
//
// Characters are guide-level tags in the catalog, not per-issue appearances. An association here
// means "this issue is in a reading guide tagged with that character", which is all the bundled
// data can support. No association is therefore not evidence that a character is absent, and the
// view words both cases that way.

import { MAX_NAME, isIssueRating } from './model.js';
import { foldName } from './nameIndex.js';

export const RATED_GUIDE_INDEX_VERSION = 1;
export const RATED_GUIDE_INDEX_FILE = 'rated-guide-index.json';
export const TOP_RATED_MIN = 4;
export const TOP_RATED_LIMIT = 6;
export const RATING_SORTS = ['rating', 'title'];
export const DEFAULT_RATING_SORT = 'rating';
export const RATING_THRESHOLDS = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);

const validIssueId = (id) => Number.isSafeInteger(id) && id !== 0;

// Explicit codepoint comparison rather than localeCompare, so the generated file and the sort
// order do not depend on the host's ICU data.
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- collection

export function ratedComics(state) {
  const rows = [];
  for (const [key, score] of Object.entries(state?.ratings ?? {})) {
    const issueId = Number(key);
    if (!validIssueId(issueId) || !isIssueRating(score)) continue;
    const issue = state.issues?.[issueId] ?? null;
    rows.push({
      issueId,
      score,
      known: Boolean(issue),
      issue,
      title: issue?.title ? String(issue.title) : `Issue ${issueId}`,
      seriesName: issue?.seriesName ?? null,
    });
  }
  return rows;
}

function textKey(row) {
  return foldName([row.title, row.issue?.number, row.seriesName].filter((v) => v != null && v !== '').join(' '));
}

export function sortRatedComics(rows, sort = DEFAULT_RATING_SORT) {
  const keyed = rows.map((row) => ({ row, title: foldName(row.title) }));
  keyed.sort((a, b) => {
    const byScore = b.row.score - a.row.score;
    const byTitle = compareText(a.title, b.title);
    const primary = sort === 'title' ? byTitle || byScore : byScore || byTitle;
    return primary || a.row.issueId - b.row.issueId;
  });
  return keyed.map((k) => k.row);
}

export function topRatedComics(rows, limit = TOP_RATED_LIMIT) {
  return sortRatedComics(rows.filter((row) => row.score >= TOP_RATED_MIN)).slice(0, limit);
}

// Returns the guides that associate an issue with a character, matched by folded label so the
// URL value survives a casing or punctuation difference.
export function characterGuidesFor(index, issueId, character) {
  const want = foldName(character);
  if (!index || !want) return [];
  return (index.byIssue.get(issueId) ?? [])
    .map((ordinal) => index.guides[ordinal])
    .filter((guide) => guide.characters.some((label) => foldName(label) === want));
}

// Labels offered by the Character guide control: only those associated with at least one rated
// comic, since a choice that can only ever produce an empty list is noise.
export function characterOptions(index, rows) {
  if (!index) return [];
  const byFold = new Map();
  for (const row of rows) {
    for (const ordinal of index.byIssue.get(row.issueId) ?? []) {
      for (const label of index.guides[ordinal].characters) {
        const fold = foldName(label);
        if (!byFold.has(fold)) byFold.set(fold, label);
      }
    }
  }
  return [...byFold].sort((a, b) => compareText(a[0], b[0])).map(([, label]) => label);
}

// `index` is null while the association data is loading or unavailable. The character filter is
// then reported as not applied rather than treated as matching everything or nothing, so a count
// is never presented as filtered when it was not.
export function filterRatedComics(rows, { min = null, q = '', character = '' } = {}, index = null) {
  const words = foldName(q).split(' ').filter(Boolean);
  let unknownExcluded = 0;
  const base = [];
  for (const row of rows) {
    if (min != null && row.score < min) continue;
    if (words.length) {
      if (!row.known) {
        unknownExcluded += 1;
        continue;
      }
      const key = textKey(row);
      if (!words.every((word) => key.includes(word))) continue;
    }
    base.push(row);
  }
  const wantCharacter = Boolean(foldName(character));
  const characterApplied = wantCharacter && Boolean(index);
  const matched = characterApplied
    ? base.flatMap((row) => {
      const guides = characterGuidesFor(index, row.issueId, character);
      return guides.length ? [{ ...row, guides }] : [];
    })
    : base;
  return {
    rows: matched,
    total: rows.length,
    baseCount: base.length,
    characterApplied,
    characterPending: wantCharacter && !index,
    unknownExcluded,
  };
}

// ---------------------------------------------------------------- generated index

// Built at vendor time from the final catalog and the payload each catalog entry was written
// from, so a partition child is indexed from the payload about to be written rather than from a
// file on disk that the same batch is replacing. Any malformed input throws, which aborts the
// whole atomic output batch instead of shipping a partial index.
export function buildRatedGuideIndex(catalog, payloadByCatalogId) {
  if (!Array.isArray(catalog)) throw new Error('rated guide index: catalog is not a list');
  const entries = [...catalog].sort((a, b) => compareText(String(a?.id), String(b?.id)));
  const seenIds = new Set();
  const guides = [];
  const issueGuides = new Map();
  entries.forEach((entry, ordinal) => {
    const id = entry?.id;
    if (typeof id !== 'string' || !id || seenIds.has(id)) {
      throw new Error(`rated guide index: catalog entry ${JSON.stringify(id)} has a missing or duplicate id`);
    }
    seenIds.add(id);
    const name = canonicalText(entry.name);
    if (!name) throw new Error(`rated guide index: ${id} has no name`);
    if (!Array.isArray(entry.characters)) throw new Error(`rated guide index: ${id} has no character list`);
    const characters = [];
    const folds = new Set();
    for (const raw of entry.characters) {
      const label = canonicalText(raw);
      if (!label) throw new Error(`rated guide index: ${id} has an empty character label`);
      const fold = foldName(label);
      if (!fold || folds.has(fold)) continue;
      folds.add(fold);
      characters.push(label);
    }
    guides.push([id, name, characters]);
    const payload = payloadByCatalogId?.get(id);
    if (!payload || !Array.isArray(payload.items)) {
      throw new Error(`rated guide index: ${id} has no payload items`);
    }
    for (const item of payload.items) {
      const issueId = item?.issueId;
      if (!validIssueId(issueId)) throw new Error(`rated guide index: ${id} has an invalid issue id ${JSON.stringify(issueId)}`);
      if (!issueGuides.has(issueId)) issueGuides.set(issueId, new Set());
      issueGuides.get(issueId).add(ordinal);
    }
  });
  return {
    version: RATED_GUIDE_INDEX_VERSION,
    guides,
    issueGuides: [...issueGuides]
      .sort((a, b) => a[0] - b[0])
      .map(([issueId, set]) => [issueId, [...set].sort((a, b) => a - b)]),
  };
}

// One record per line, so a regenerated index diffs by guide and by issue rather than as one
// unreadable line.
export function serializeRatedGuideIndex(index) {
  const lines = (records) => records.map((record) => `    ${JSON.stringify(record)}`).join(',\n');
  return `{\n  "version": ${index.version},\n  "guides": [\n${lines(index.guides)}\n  ],\n`
    + `  "issueGuides": [\n${lines(index.issueGuides)}\n  ]\n}\n`;
}

function canonicalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_NAME ? text : null;
}

export class RatedGuideIndexError extends Error {}

// Strict on purpose. A malformed file is reported as unavailable, never accepted as an index
// with no associations, because an empty index would answer every Character guide filter with a
// confident "no matches".
export function parseRatedGuideIndex(raw) {
  const fail = (why) => { throw new RatedGuideIndexError(`The Character guide data is not valid (${why}).`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('not an object');
  if (raw.version !== RATED_GUIDE_INDEX_VERSION) fail('unsupported version');
  if (!Array.isArray(raw.guides) || !Array.isArray(raw.issueGuides)) fail('missing lists');
  const ids = new Set();
  const guides = raw.guides.map((tuple, ordinal) => {
    if (!Array.isArray(tuple) || tuple.length !== 3) fail(`guide ${ordinal} has the wrong shape`);
    const [id, name, characters] = tuple;
    if (typeof id !== 'string' || !id || ids.has(id)) fail(`guide ${ordinal} has a missing or duplicate id`);
    ids.add(id);
    if (canonicalText(name) !== name) fail(`guide ${id} has an invalid name`);
    if (!Array.isArray(characters)) fail(`guide ${id} has no character list`);
    const folds = new Set();
    for (const label of characters) {
      if (canonicalText(label) !== label || !foldName(label) || folds.has(foldName(label))) {
        fail(`guide ${id} has an invalid character label`);
      }
      folds.add(foldName(label));
    }
    return { id, name, characters };
  });
  const byIssue = new Map();
  for (const tuple of raw.issueGuides) {
    if (!Array.isArray(tuple) || tuple.length !== 2) fail('an issue record has the wrong shape');
    const [issueId, ordinals] = tuple;
    if (!validIssueId(issueId) || byIssue.has(issueId)) fail(`issue ${JSON.stringify(issueId)} is invalid or repeated`);
    if (!Array.isArray(ordinals) || !ordinals.length) fail(`issue ${issueId} names no guide`);
    let previous = -1;
    for (const ordinal of ordinals) {
      if (!Number.isInteger(ordinal) || ordinal <= previous || ordinal >= guides.length) {
        fail(`issue ${issueId} names an unknown guide`);
      }
      previous = ordinal;
    }
    byIssue.set(issueId, ordinals);
  }
  return { guides, byIssue };
}

// ---------------------------------------------------------------- loader

// One request at a time and one parsed result per document. A failure clears the pending entry so
// the view's explicit Retry starts a fresh request; there is no automatic retry loop. Nothing is
// fetched until load() is called, so importing this module costs nothing.
export function createRatedGuideIndexLoader({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = new URL(`../../data/${RATED_GUIDE_INDEX_FILE}`, import.meta.url),
} = {}) {
  let result = null;
  let pending = null;
  return {
    load() {
      if (result) return Promise.resolve(result);
      if (pending) return pending;
      pending = (async () => {
        let response;
        try {
          // no-cache rather than no-store, matching the other bundled data: revalidate, keep.
          response = await fetchImpl(url, { cache: 'no-cache' });
        } catch {
          throw new RatedGuideIndexError('The Character guide data could not be loaded.');
        }
        if (!response?.ok) throw new RatedGuideIndexError(`The Character guide data could not be loaded (HTTP ${response?.status}).`);
        let raw;
        try {
          raw = await response.json();
        } catch {
          throw new RatedGuideIndexError('The Character guide data is not valid JSON.');
        }
        result = parseRatedGuideIndex(raw);
        return result;
      })();
      pending.catch(() => {}).finally(() => { pending = null; });
      return pending;
    },
    get loaded() {
      return result;
    },
  };
}
