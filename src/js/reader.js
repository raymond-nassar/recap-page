// Opening comics in the Marvel Comics app, or its website when no verified link exists (#1601).
//
// Each issue opens in its own tab. Single-tab reuse was tested on 2026-08-03 against a live
// subscription and rejected (see CHG-002): neither a named target nor a retained window handle
// reliably re-routed an already-loaded read.marvel.com tab, because the reader is a hash-routed
// single-page app and a cross-origin reload cannot be forced from script.
//
// The tab is pointed at our own /open.html, which keeps window.open synchronous inside the click
// handler, so the browser never treats it as an unsolicited popup.

import { appViewerFor } from './lib/marvelComicsApp.js';
import { taggedViewer } from './lib/marvelComicsAppUrl.js';
import { readerDestination } from './lib/readerDestination.js';

export const READER_PREFIX = 'https://read.marvel.com/#/book/';

function referenceId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  return /^[1-9]\d{0,11}$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

// Returns null rather than a URL containing "null"/"undefined", so callers must
// deal with the missing-digitalId case explicitly instead of shipping a dead link.
export function readerUrl(digitalId) {
  const id = referenceId(digitalId);
  return id ? `${READER_PREFIX}${id}` : null;
}

// Use third-party URLs only when they point at Marvel; Find-only issues have no detail link.
export function detailUrl(issue) {
  if (issue?.findOnly === true) return null;
  const id = Number(issue?.issueId);
  const fallback = Number.isInteger(id) && id > 0
    ? `https://www.marvel.com/comics/issue/${id}/`
    : null;
  const candidate = issue?.url ?? issue?.detailUrl;
  return isSafeMarvelUrl(candidate) ? candidate : fallback;
}

function isSafeMarvelUrl(url) {
  if (typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  // #1601: a saved Marvel Unlimited reader address is kept in saved data but no longer opened, so
  // it never stands in for the comic's marvel.com page.
  return host === 'marvel.com' || host === 'www.marvel.com';
}

// True when we hold enough of a reference to offer the control at all. A viewer-only comic is
// recognized only by its tag (#1601), never by decoding its key, so a legacy record whose number
// merely falls in the same range is not mistaken for one. A saved title-only entry can still use
// the general Marvel Comics website fallback without claiming a viewer identity.
export function isLaunchable(issue) {
  return referenceId(issue?.issueId) !== null || referenceId(issue?.digitalId) !== null
    || taggedViewer(issue) !== null
    || (Number.isSafeInteger(issue?.issueId) && issue.issueId < 0
      && typeof issue.title === 'string' && issue.title.trim().length > 0);
}

// Builds the same-origin launch URL. #1601: only a verified Marvel Comics app viewer number is
// carried, as `a`; without one the launcher opens the Marvel Comics website. Book IDs, Marvel
// Unlimited pages and the old lookup stay in saved data but are no longer launched.
export function launchUrl(issue, origin = location.origin) {
  const params = new URLSearchParams();
  params.set('r', readerDestination());
  const viewer = appViewerFor(issue);
  if (viewer) params.set('a', viewer);
  if (issue?.title) params.set('t', String(issue.title).slice(0, 120));
  return `${origin}/open.html?${params.toString()}`;
}

// Must be called synchronously from a user gesture, or the browser will block the tab.
// Returns { ok, target }, where `target` is 'app' or 'comics', and null when there was no reference.
export function openIssue(issue, { origin = location.origin } = {}) {
  if (!isLaunchable(issue)) {
    return { ok: false, target: null, reason: 'no-reference' };
  }

  const url = launchUrl(issue, origin);
  let win;
  try {
    win = window.open(url, '_blank', 'noopener');
  } catch {
    win = null;
  }

  // With 'noopener' a browser may legitimately return null even on success, so a null handle
  // is not proof of a block. Treat it as opened; the launcher page reports its own failures.
  return {
    ok: true,
    target: new URL(url).searchParams.has('a') ? 'app' : 'comics',
    window: win,
  };
}
