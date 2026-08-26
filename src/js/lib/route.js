// The URL scheme. Kept out of main.js so it can be tested in Node: main.js reads `document` at
// module scope and cannot be imported.
//
// A hash rather than a path, for two independent reasons. Constraint 5 makes the origin
// load-bearing, and server.mjs serves files with no single-page fallback, so a path such as
// /read/list-abc would 404 on exactly the reload and bookmark that this scheme exists to support.

import { LIBRARY_VIEWS } from './library.js';
import { READING_FILTERS, DEFAULT_FILTER } from './readingFilters.js';
import { HOME_CATEGORIES, PUBLISHING_CATEGORIES } from './catalog.js';

const PUBLISHING_ROUTES = new Set(PUBLISHING_CATEGORIES.map((category) => category.route));
const CUSTOM_CATEGORY_ROUTES = HOME_CATEGORIES
  .filter((category) => !category.shelf && !PUBLISHING_ROUTES.has(category.route))
  .map((category) => category.route);

// Every section the app can reach. This lives here rather than in main.js so that one list backs
// both what can be shown and what can be routed to. Split across two files, a new view could be
// routable but not showable, or showable but silently unreachable by URL.
export const ADD_VIEWS = ['add-search', 'add-series', 'add-creator', 'add-import', 'add-manual'];
export const VIEWS = [
  'home', 'read', 'issue', 'library', 'browse', 'add', 'catalog', 'lines', 'spotlights', 'progress',
  ...PUBLISHING_CATEGORIES.map((category) => category.route),
  ...CUSTOM_CATEGORY_ROUTES,
  ...ADD_VIEWS,
  'data', 'about', ...LIBRARY_VIEWS.map((v) => v.value),
];

// Addresses written before a screen was replaced. They are accepted on input but never treated as
// renderable views, so every member of VIEWS still names a real panel.
export const LEGACY_VIEW_ALIASES = {};

function canonicalView(view) {
  return LEGACY_VIEW_ALIASES[view] ?? view;
}

const PREFIX = '#/';
const SPOTLIGHT_SORT_KEY = 'sort';
const SPOTLIGHT_POPULARITY_SORT = 'popularity';

// The reading filter travels as a query inside the fragment rather than as a third path segment.
// The deciding reason is that a query is omitted when it says nothing, so while the filter is the
// default every address this app writes is byte for byte the one it wrote before BL-037, and every
// bookmark and shared link made under BL-036 keeps working untouched. A third segment would have
// needed a placeholder on any view with no active list, `#/about//unread`, whose empty middle
// collides with the shipped rule that a trailing slash reads as no list.
//
// Measured in Edge rather than assumed, because all of it is browser behaviour this file cannot
// see: location.hash returns the `?` and everything after it, location.search stays empty so the
// fragment's query is never read as the document's, replaceState and assignment both land it
// intact, assignment fires one hashchange carrying it, no request is made for it, and Back over a
// filter change returns the previous one.
const FILTER_KEY = 'filter';
const ISSUE_CONTEXT_KEYS = new Set(['list', 'order']);

function issueId(value) {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '');
  if (!/^-?[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 && String(id) === raw ? id : null;
}

// Like the active list, the filter rides along on every view rather than on the reading view alone.
// It is one global value, and applyRoute writes it into stored settings exactly as it already
// writes the active list, so a subset would be a rule to keep in step for no gain.
export function formatRoute({
  view, listId, filter, sort, issueId: rawIssueId, context,
} = {}) {
  const canonical = canonicalView(view);
  if (!VIEWS.includes(canonical)) return '';
  if (canonical === 'issue') {
    const id = issueId(rawIssueId);
    if (id == null) return '';
    const query = new URLSearchParams();
    if (context && ISSUE_CONTEXT_KEYS.has(context.kind) && typeof context.id === 'string' && context.id) {
      query.set(context.kind, context.id);
    }
    const search = query.toString();
    return `${PREFIX}issue/${id}${search ? `?${search}` : ''}`;
  }
  const tail = listId ? `/${encodeURIComponent(listId)}` : '';
  const query = new URLSearchParams();
  // An unknown filter is dropped rather than written through, so a value that could not have come
  // from a radio cannot be put into an address by this app and then read back as if it had.
  const known = READING_FILTERS.some((f) => f.value === filter);
  if (known && filter !== DEFAULT_FILTER) query.set(FILTER_KEY, filter);
  if (canonical === 'spotlights' && sort === SPOTLIGHT_POPULARITY_SORT) query.set(SPOTLIGHT_SORT_KEY, sort);
  const search = query.toString();
  const suffix = search ? `?${search}` : '';
  return `${PREFIX}${encodeURIComponent(canonical)}${tail}${suffix}`;
}

// Returns null for anything that is not one of our routes, which the caller must treat as "not
// mine, leave it alone". index.html ships a skip link to #main, and clicking it pushes a history
// entry, so hashchange really is handed a foreign hash during ordinary keyboard use. Rewriting it
// would break the skip target.
export function parseRoute(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return null;

  // Split before decoding, not after. formatRoute percent-encodes each path segment, so a list id
  // containing a literal question mark arrives here as %3F and cannot be mistaken for the start of
  // the query. Decoding first would turn that id back into a `?` and cut the path at it.
  const body = hash.slice(PREFIX.length);
  const at = body.indexOf('?');
  const path = at < 0 ? body : body.slice(0, at);
  const search = at < 0 ? '' : body.slice(at + 1);

  const parts = path.split('/');
  if (parts.length > 2) return null;

  let view;
  let listId;
  try {
    view = decodeURIComponent(parts[0]);
    listId = parts[1] === undefined ? null : decodeURIComponent(parts[1]);
  } catch {
    // A malformed percent-escape throws rather than returning a string. A typo in a shared link is
    // not a reason to take the reader's app down.
    return null;
  }

  view = canonicalView(view);
  if (!VIEWS.includes(view)) return null;

  if (view === 'issue') {
    if (parts.length !== 2) return null;
    const id = issueId(listId);
    if (id == null) return null;
    const entries = [...new URLSearchParams(search).entries()];
    const context = entries.length === 1
      && ISSUE_CONTEXT_KEYS.has(entries[0][0])
      && entries[0][1]
      ? { kind: entries[0][0], id: entries[0][1] }
      : null;
    return { view, issueId: id, context };
  }

  // Null means the address says nothing about the filter, which is what absent, unknown and the
  // default all amount to. An unknown value refuses the filter rather than the whole route: a stale
  // link from an older build names a view the reader can still be taken to, and the trailing sync
  // then rewrites the address without it. This is unlike the settings path, which corrects an
  // unknown stored value, because that one is a record only this app writes.
  const params = new URLSearchParams(search);
  const raw = params.get(FILTER_KEY);
  const filter = READING_FILTERS.some((f) => f.value === raw) && raw !== DEFAULT_FILTER ? raw : null;
  const rawSort = view === 'spotlights' ? params.get(SPOTLIGHT_SORT_KEY) : null;
  const sort = view === 'spotlights' && rawSort === SPOTLIGHT_POPULARITY_SORT
    ? rawSort
    : null;

  return sort ? { view, listId: listId || null, filter, sort } : { view, listId: listId || null, filter };
}
