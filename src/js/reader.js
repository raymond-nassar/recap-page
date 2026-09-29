// Opening issues in the Marvel Unlimited web reader.
//
// Each issue opens in its own tab. Single-tab reuse was tested on 2026-08-03 against a live
// subscription and rejected (see CHG-002): neither a named target nor a retained window handle
// reliably re-routed an already-loaded read.marvel.com tab, because the reader is a hash-routed
// single-page app and a cross-origin reload cannot be forced from script.
//
// The tab is pointed at our own /open.html, which performs any needed digitalId lookup itself.
// That keeps window.open synchronous inside the click handler, so the browser never treats it
// as an unsolicited popup, and means no window handle has to be retained afterwards.
//
// Contract verified 2026-08-03 (CHG-001): the live API's digitalId is authoritative; the
// upstream repo README is stale for at least issue 52447.

import { issuePageUrl } from './lib/issuePageUrl.js';

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

// The url field comes from third-party metadata, so it is only used when it
// actually points at Marvel. Anything else falls back to the canonical page.
export function detailUrl(issue) {
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
  return host === 'marvel.com' || host === 'www.marvel.com' || host === 'read.marvel.com';
}

// True when we hold enough of a reference to open anything at all.
export function isLaunchable(issue) {
  return referenceId(issue?.issueId) !== null || referenceId(issue?.digitalId) !== null;
}

// Builds the same-origin launch URL. A known book ID skips lookup; a previously refused
// issue with a matching pinned page skips the same lookup without inventing a book ID.
export function launchUrl(issue, origin = location.origin) {
  const params = new URLSearchParams();
  const digitalId = referenceId(issue?.digitalId);
  const issueId = referenceId(issue?.issueId);
  if (digitalId) params.set('d', digitalId);
  if (issueId) {
    params.set('i', issueId);
    if (!digitalId) {
      const page = issuePageUrl(issue?.url ?? issue?.detailUrl, issueId);
      if (page) {
        params.set('u', page);
        if (issue?.detailsRefused === true) params.set('p', '1');
      }
    }
  }
  if (issue?.title) params.set('t', String(issue.title).slice(0, 120));
  return `${origin}/open.html?${params.toString()}`;
}

// Must be called synchronously from a user gesture, or the browser will block the tab.
// Returns { ok, target }, where `target` is 'reader', 'page' or 'lookup',
// and null when there was no reference.
export function openIssue(issue, { origin = location.origin } = {}) {
  if (!isLaunchable(issue)) {
    return { ok: false, target: null, reason: 'no-reference' };
  }

  const url = launchUrl(issue, origin);
  const params = new URL(url).searchParams;
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
    target: params.has('d') ? 'reader' : params.get('p') === '1' ? 'page' : 'lookup',
    window: win,
  };
}
