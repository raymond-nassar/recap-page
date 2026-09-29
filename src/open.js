// Launch page for the Marvel Unlimited reader.
//
// Why this page exists at all: a direct reader URL needs `digitalId`, which only
// /v1/issues/{id} returns. Doing that lookup in the app BEFORE window.open costs the
// user-activation token and the tab gets blocked; doing it after means holding a window
// handle and navigating it later, which testing on 2026-08-03 showed to be unreliable.
// So the app opens this page immediately and the lookup happens HERE, in the new tab.
// No handle is retained, and `opener` is severed below before any navigation.
//
// Deliberately not an open redirector: book ids must be digits and supplied issue pages
// must match the issue id and strict Marvel URL shape. The API base comes from this
// origin's own settings rather than from the URL.
//
// This lives in its own file rather than an inline <script> so the server can send a
// Content-Security-Policy with `script-src 'self'`. That is the directive that stops a
// compromised or hostile metadata response from executing script it smuggled into a
// title or description, so it is worth keeping strict enough to be meaningful.
//
// Loaded as a module so it can share the API base rule with the app rather than keeping
// a second copy of it. open.html loads it at the end of <body>, and module scripts are
// deferred, so the elements looked up below are parsed by the time this runs.

import { isAllowedApiBase } from './js/lib/apiBase.js';
import { issuePageUrl } from './js/lib/issuePageUrl.js';

// Disown the opener before anything else, and in particular before any navigation.
// The opener belongs to the tab rather than to the document, so severing it here also
// covers read.marvel.com and marvel.com, which this tab is about to replace itself with.
//
// The app's own launcher already passes 'noopener' (src/js/reader.js), so nothing in this
// repository needs it. This page is a plain URL, though, and anything else that reaches it,
// a bookmark, an external link, or another site calling window.open without 'noopener',
// would otherwise leave the destination holding a handle it can navigate the opener with.
// Measured before this line existed: the destination did hold one.
//
// Nothing here needs the opener. Every path leaves via location.replace, and no message is
// ever posted back to the app.
window.opener = null;

const q = new URLSearchParams(location.search);
const digits = (v) => (/^[1-9]\d{0,11}$/.test(v || '') ? v : null);

const digitalId = digits(q.get('d'));
const issueId = digits(q.get('i'));
const pageUrl = issueId && q.getAll('u').length === 1 ? issuePageUrl(q.get('u'), issueId) : null;
const knownPage = pageUrl && q.getAll('p').length === 1 && q.get('p') === '1';
const title = (q.get('t') || '').slice(0, 120);

const h = document.getElementById('h');
const p = document.getElementById('p');
const fallback = document.getElementById('fallback');

const readerUrl = (d) => `https://read.marvel.com/#/book/${d}`;
const detailUrl = (i) => `https://www.marvel.com/comics/issue/${i}/`;

if (title) h.textContent = `Opening ${title}…`;

function go(url) {
  fallback.href = url;
  location.replace(url);
}

// Same origin as the app, so this reads the user's configured API base directly
// instead of accepting one from the query string.
function apiBase() {
  try {
    const raw = JSON.parse(localStorage.getItem('mrt.settings') || '{}');
    const base = String(raw.apiBase || 'https://marvel.emreparker.com/v1').replace(/\/+$/, '');
    if (!isAllowedApiBase(base)) return null;
    return base;
  } catch {
    return null;
  }
}

async function resolveAndGo(id, page = detailUrl(id)) {
  const base = apiBase();
  if (!base) return go(page);

  p.textContent = 'Looking up the Marvel Unlimited link for this issue…';
  fallback.href = page;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/issues/${id}`, {
      headers: { accept: 'application/json' },
      // This response carries the issue synopsis, and this tab is not the app: it has no cache to
      // strip and nothing here reads the prose. Without the directive the browser would keep a copy
      // on disk anyway, which is the one thing the tracker promises does not happen.
      cache: 'no-store',
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const d = digits(String(data && data.digitalId != null ? data.digitalId : ''));
    if (d) return go(readerUrl(d));
    p.textContent = 'No direct reader link is recorded, so this opens the Marvel issue page instead.';
  } catch {
    p.textContent = 'Could not reach the metadata service, so this opens the issue page on marvel.com instead.';
  } finally {
    clearTimeout(timer);
  }
  setTimeout(() => go(page), 1400);
}

if (digitalId) {
  go(readerUrl(digitalId));
} else if (knownPage) {
  if (!title) h.textContent = 'Opening the Marvel issue page…';
  p.textContent = 'Opening the Marvel issue page. Reading progress has not changed.';
  go(pageUrl);
} else if (issueId) {
  resolveAndGo(issueId, pageUrl || detailUrl(issueId));
} else {
  h.textContent = 'Nothing to open';
  p.textContent = 'This link was missing an issue reference.';
}
