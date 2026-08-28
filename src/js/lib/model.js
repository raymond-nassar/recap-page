// Normalized application state.
//
// Read state is GLOBAL, keyed by issue id, not stored per list. The bundled Hickman minimal
// (89 issues) and full (219 issues) orders overlap heavily; per-list read flags would let the
// same issue be simultaneously read and unread, and would double-count series progress.
//
// Lists therefore hold ordered ID references only, and every issue's metadata is stored once.

import { compareIssues } from './sort.js';
import { allowedCoverUrl } from './coverHost.js';

export const SCHEMA_VERSION = 2;

// The list map is keyed by ids that come from a restored backup, so a reader whose file happens to
// contain a list called `__proto__` or `constructor` used to lose it. An ordinary object answers
// `lists[id]` from its prototype for those names, so the list read back as something that was never
// stored, and writing `lists.__proto__ = list` invoked the setter instead of storing a member. It
// is a null-prototype map now, which has no inherited names to collide with and no setter to invoke.
//
// The helpers exist because the map is produced in eleven places and `{ ...Object.create(null) }` is
// an ordinary object again, so a single `Object.create(null)` in one place evaporates on the reader's
// first rename. A list of sites that must each be written correctly is the same defect as a list of
// sites that must each be guarded, so the rebuild goes through these rather than through a spread,
// and a test scans `src/js` to keep the next site added from reintroducing it.
const emptyLists = () => Object.create(null);
const cloneLists = (lists) => Object.assign(Object.create(null), lists);
const withList = (lists, id, list) => {
  const next = cloneLists(lists);
  next[id] = list;
  return next;
};

export function createEmptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    issues: {},
    read: {},
    overrides: {},
    // Keyed by issue id, and global for the same reason read state is: the bundled minimal and
    // full orders overlap heavily, so a note attached to one path through an issue would be
    // invisible on the other while the reader was looking at the same comic.
    notes: {},
    lists: emptyLists(),
    listOrder: [],
    active: null,
  };
}

// A per-load start, then counting up, rather than six fresh random characters each time.
//
// The stamp only separates ids minted in different milliseconds, so everything minted inside one
// millisecond used to be told apart by 36^6 of randomness alone. That was safe while the only bulk
// mint was too slow to fill a millisecond. It is not any more: restoring a version 1 backup at the
// 250,000-list ceiling spreads its 250,000 mints over about 500 milliseconds, so roughly 610 land in
// each of some 410 stamps, and that is a birthday draw over 78 million same-stamp pairs. It loses:
// 78 million against 36^6 is 0.036 expected collisions per restore. Measured on this tree, 4 of 60
// restores at the ceiling collided, each one silently dropping a list, because a repeated id
// overwrites lists[id] while listOrder keeps both entries and the map ends one short of the order.
//
// Those figures replace an earlier 130 milliseconds, 2,000 to a stamp and 244 million pairs, which
// were about three times too high and disagreed with the 858 milliseconds this same fixture is
// recorded as taking two paragraphs later in the backlog. The stamps are read back out of the ids
// the shipped mint produced rather than timed around it, so the count needs no instrumentation.
//
// Counting up cannot repeat until 36^6 ids have been minted in a single load, which nothing here
// approaches. The random start is what keeps two loads landing in the same millisecond as unlikely
// to meet as they were before.
//
// padStart holds the suffix at six characters so the ids stay the length the stored payload was
// measured at. It is deliberately not asserted anywhere: the counter starts at a random point in
// the space, so a load reaches a short number only by starting within 36^5 of zero, and a test of
// it would pass for the other thirty-five thirty-sixths of runs whatever the code did.
const ID_SPACE = 36 ** 6;
let idCounter = Math.floor(Math.random() * ID_SPACE);

export function newId(prefix = 'list') {
  idCounter = (idCounter + 1) % ID_SPACE;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- issues

// Whether a record arrived carrying anything beyond the line it was read from. Only
// /v1/issues/{id} returns these two fields, so holding neither means no lookup ever answered for
// this issue, whatever the reason. Exported because the same question is asked from two places
// that must not come to answer it differently: here, to infer the hydrated flag for an issue
// added without one, and by countOrderGaps, to count how many of an order's items arrived empty.
export function hasMetadata(input) {
  return input?.digitalId != null || input?.seriesId != null;
}

// Two different absences that had been one. "Not fetched yet" is worth retrying and "upstream does
// not hold this" is not, and the app had no way to say which it was looking at, so 34 issues sat in
// a queue that could only ever spend rate limit to learn the same 404 again.
//
// A refusal now reaches the app three ways, and this is the weakest of them. A vendored item that
// was refused says so on itself, in the `detailsRefused` field the normalizer reads below, because
// the run that built the file is the only thing that knows which of four unlike failures it met. A
// refusal met at runtime is recorded by markDetailsRefused. Both land in that one field so the rest
// of the app asks the question once.
//
// This inference is what carries a tracker imported before the field existed. A curated order is
// the output of a completed vendoring run, so every item in it has already been looked up, and an
// item from one holding nothing has therefore been asked about and come back empty. That was the
// only signal available when the orders that predate the field were vendored, and coerce() runs every
// stored issue back through the normalizer on load, so a tracker that predates the field is
// corrected rather than left to spend a lookup relearning the same 404.
//
// It is an inference and not a reading, and the gap it used to leave was real: the run wrote the
// same empty item for a 404, an exhausted retry budget, a lost connection and an unparseable body,
// so an outage during a run produced items this would read as refusals. That gap is closed at the
// producer rather than here. A run now aborts before writing anything if any lookup ended without
// an answer, whether it failed or came back carrying nothing hasMetadata accepts, so an empty item
// in a file built from now on can only be a refusal, and the 63 empty items in the two orders that
// predate the field were re-vendored on 2026-08-15, when all 34 unique ids behind them answered 404
// and every one gained the field.
function refusedOnArrival(input) {
  return input?.source === 'curated' && !hasMetadata(input);
}

// A curated order can fall short of complete metadata in two unrelated ways, and a reader told
// about only one of them is left to wonder about the other.
//
// A checklist line carrying no Marvel link at all is vendored as a placeholder: a negative id and
// nothing else, so the app will not offer to open it. One legacy record kept the flag after gaining
// real identity and launch metadata, so the flag alone cannot mean "unopenable". A line whose lookup
// was refused upstream becomes a fully formed record with a positive id and every metadata field
// empty. The two gaps look nothing alike to a reader, so they are counted apart and said apart.
//
// Counted from the items rather than read from the payload's own `placeholders` field. That field
// counts raw flags without asking whether the item later gained metadata, and it carries no count
// for the second kind. The items are what the reader actually receives, so they are what is counted.
export function countOrderGaps(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  let placeholders = 0;
  let empty = 0;
  for (const item of items) {
    const metadata = hasMetadata(item);
    // Exclusive, because an unlinked placeholder holds no metadata either and would otherwise be
    // reported twice. A metadata-bearing legacy flag is neither gap: the issue can be launched.
    if (item?.placeholder === true && !metadata) placeholders += 1;
    else if (item?.placeholder !== true && !metadata) empty += 1;
  }
  return { placeholders, empty };
}

// Said in the order a reader meets them. The second sentence deliberately claims nothing about
// whether the issue can be opened: those items carry a real, positive issue id, so the app does
// open a tab for them and the lookup fails in the tab. Repeating "cannot be opened" here would be
// a false promise of the same shape as the silence it replaces.
export function orderGapSentences(order) {
  const { placeholders, empty } = countOrderGaps(order);
  const out = [];
  if (placeholders) {
    out.push(`${placeholders} of them ${placeholders === 1 ? 'has' : 'have'} no Marvel Unlimited link yet and cannot be opened.`);
  }
  if (empty) {
    out.push(`${empty} of them came with no details at all, so ${empty === 1 ? 'it shows' : 'they show'} no cover and ${empty === 1 ? 'has' : 'have'} no Unlimited link.`);
  }
  return out;
}

// A hand-added issue with no marvel.com URL and no match on the wiki gets a negative synthetic id
// (see doManual), which is namespaced away from real Marvel ids. Rejecting those here silently
// discarded the entry while the UI reported success, so negatives are accepted; only 0 and
// non-integers are refused.
export function normalizeIssue(input) {
  const issueId = Number(input?.issueId ?? input?.id);
  if (!Number.isInteger(issueId) || issueId === 0) return null;
  const synthetic = issueId < 0;
  const refused = refusedOnArrival(input);
  return {
    issueId,
    title: String(input.title ?? `Issue ${issueId}`).slice(0, MAX_NAME),
    number: clampScalar(input.number ?? null),
    // A synthetic id has no marvel.com page, so inventing one would produce a dead link.
    url: clampUrl(input.url ?? input.detailUrl ?? (synthetic ? null : `https://www.marvel.com/comics/issue/${issueId}/`)),
    seriesId: clampScalar(input.seriesId ?? null),
    seriesName: input.seriesName == null ? null : String(input.seriesName).slice(0, MAX_NAME),
    onSale: clampScalar(input.onSale ?? input.onSaleDate ?? null),
    mu: clampScalar(input.mu ?? input.unlimitedDate ?? null),
    digitalId: clampScalar(input.digitalId ?? null),
    // Rich fields, only present on /v1/issues/{id}; list endpoints omit them.
    // `cover` is { path, ext } WITHOUT the variant suffix; the view appends `/{variant}.{ext}`.
    // We store the URL only and never the image bytes: the browser fetches covers directly
    // from Marvel's own CDN, so this app neither copies nor redistributes artwork.
    cover: normalizeCover(input.cover),
    // No `description`. Synopsis prose is the metadata service's, not this project's, and BL-130
    // removed the 798 copies that had been vendored into src/data/. Storing a fetched one would put
    // the same prose back, one issue at a time, into a file the reader can export and share.
    //
    // This is the single issue-level write gate: upsertIssue() reaches it on every write and
    // coerce() reaches it on every load, so dropping the field here stops new writes, drops what a
    // tracker saved before this existed, and drops what a restored backup carries, all at once.
    // A synopsis fetched at runtime lives in memory for the session and is passed to the view
    // separately (see src/js/synopsis.js).
    pageCount: Number(input.pageCount) > 0 ? Number(input.pageCount) : null,
    creators: Array.isArray(input.creators)
      ? input.creators
        .filter((c) => c && typeof c.name === 'string')
        .slice(0, 24)
        .map((c) => ({ name: String(c.name).slice(0, MAX_NAME), role: String(c.role ?? '').slice(0, MAX_NAME) }))
      : null,
    source: clampScalar(input.source ?? 'api'),
    // "pending" means imported from Markdown and not yet enriched. The UI shows this
    // honestly rather than guessing at missing fields.
    //
    // A curated item that arrived empty is refused rather than pending, so the assertion import
    // used to make over the whole file is refused here rather than only at that call site. coerce()
    // runs every stored issue back through this function on load, so a tracker imported before this
    // existed is corrected the next time it opens rather than staying wrong until a re-import.
    hydrated: refused ? false : clampScalar(input.hydrated ?? hasMetadata(input)),
    // A strict boolean, not clampScalar: this field never carries text, and a hand-edited backup
    // saying "yes" must not become a refusal the reader cannot clear.
    detailsRefused: refused || input.detailsRefused === true,
  };
}

// Accepts the API's { path, extension } as well as our stored { path, ext }.
// Marvel's CDN serves https, but the API reports http; upgrade it so the browser
// does not block the image as mixed content.
export function normalizeCover(cover) {
  if (!cover || typeof cover !== 'object') return null;
  const raw = typeof cover.path === 'string' ? cover.path.replace(/^http:\/\//i, 'https://') : null;
  const ext = cover.ext ?? cover.extension ?? 'jpg';
  if (!raw) return null;
  // This is the only place a cover URL is admitted, and every request for one is built from what
  // it returns, so refusing here is what makes the host pin a pin rather than a preference. The
  // scheme is checked inside allowedCoverUrl, which is why there is no separate https test.
  //
  // What comes back is the parsed address serialized again, so what gets stored is the string the
  // check was made against rather than the one the service sent. Keeping the sender's string would
  // let a character the parser escapes travel on unescaped into the CSS the hero background is
  // built from.
  //
  // A refused cover becomes no cover, the same answer an over-long one gets, so the view falls
  // back to the typographic tile it already draws for an issue that never had one. Keeping the
  // address instead would store a URL the app has just decided it will never request, and a
  // restored backup carrying one would put it back on every load.
  const path = allowedCoverUrl(raw);
  if (!path) return null;
  // Truncating a URL would produce a link to nothing, so an over-long one is refused outright the
  // same way a non-https one is. The longest real cover path across every shipped order is 58.
  if (path.length > MAX_URL) return null;
  return { path, ext: String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg' };
}

// A truncated link is a link to the wrong page, so an over-long one becomes no link at all and the
// view falls back to showing no external link rather than a broken one.
function clampUrl(url) {
  if (url == null) return null;
  const s = String(url);
  return s.length > MAX_URL ? null : s;
}

// The scalar fields carry a date, an id, a short code or a flag, and every one of them was passed
// through from a backup untouched, so a hand-edited file put a seven-million-character string where
// a number belongs and cleared every count ceiling with a single issue. Numbers, booleans and nulls
// pass unchanged; a string is held to the name cap, which is more than twice the longest real value
// any of these fields takes. Truncating rather than refusing is right here because none of them is a
// link, so a shortened value is a wrong label rather than a page that does not exist.
function clampScalar(v) {
  return typeof v === 'string' && v.length > MAX_NAME ? v.slice(0, MAX_NAME) : v;
}

// Builds a displayable cover URL. Returns null when there is no cover, so callers
// fall back to the typographic tile rather than requesting a broken image.
export function coverUrl(issue, variant = 'portrait_uncanny') {
  const c = normalizeCover(issue?.cover);
  return c ? `${c.path}/${variant}.${c.ext}` : null;
}

export function upsertIssue(state, input) {
  const issue = normalizeIssue(input);
  if (!issue) return state;
  const prev = state.issues[issue.issueId];
  const merged = prev ? { ...prev, ...stripNulls(issue), hydrated: issue.hydrated || prev.hydrated } : issue;
  return { ...state, issues: { ...state.issues, [issue.issueId]: merged } };
}

function stripNulls(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v;
  return out;
}

export function getIssue(state, issueId) {
  return state.issues[Number(issueId)] ?? null;
}

// Written through its own updater rather than through upsertIssue, because upsertIssue normalizes
// whatever it is handed into a whole issue and a bare { issueId } normalizes to a record whose
// title is "Issue 12345". That is not null, so stripNulls keeps it and the merge would overwrite
// the real title with a placeholder. This touches the one field it is about and nothing else.
//
// Returns the state unchanged when there is nothing to record, so a queue that meets the same
// refusal twice does not write twice.
export function markDetailsRefused(state, issueId) {
  const id = Number(issueId);
  const issue = state.issues[id];
  if (!issue || issue.detailsRefused === true) return state;
  return { ...state, issues: { ...state.issues, [id]: { ...issue, detailsRefused: true } } };
}

// ---------------------------------------------------------------- lists

export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_NOTE = 2000;

// Measured across all 751 issue records in the twelve shipped orders before these caps were
// applied to the import and restore paths: the longest title is 72 characters, the longest series
// name 79, the longest description 800, the longest detail URL 110, the longest cover path 58, the
// longest creator name 22 and the longest role 16. The caps above and below therefore sit at least
// twice above anything real, so nothing this app has ever displayed is truncated by them.
export const MAX_URL = 500;

// Ceilings rather than budgets, and derived from the cheapest record this app can write rather than
// the richest, because the check must never refuse a backup the app itself produced. A first draft
// took the hydrated issue at 923 characters as the floor and set the ceiling at ten thousand. The
// floor is far below that: a coerced issue is a fixed sixteen fields whether or not any of them
// carries text, so the cheapest costs 290 characters at the margin in the form storage writes, and
// the cheapest list costs 127. The most generous origin any browser grants is 10,485,760
// characters, so no tracker this app can save holds more than about 36,200 issues or 82,600 lists,
// and that first ceiling would have refused a tracker a user could reach by importing. Restoring is
// not the only caller: undoing a restore feeds the pre-restore snapshot back through this same
// check, so a ceiling below what the app can hold would have refused a recovery of the app's own
// data. The ceiling here is nearly seven times the issues holdable and three times the lists, and
// below the 374,382 issues an eight mebibyte file can declare in the cheapest packing that still
// coerces, so it still refuses counts absurd on their face. The field count and the marginal cost
// both move whenever a field is added to normalizeIssue, and the test that guards this asserts the
// clause rather than the numbers, so it stays green while these sentences go stale. Re-measure with
// the differencing method the test itself uses; a JSON.stringify of one record does not reproduce
// them.
export const MAX_ISSUES = 250000;
export const MAX_LISTS = 250000;

// The same ceiling was applied to read markers, availability overrides and notes as well, and the
// derivation above was never run for any of them. It does not hold. Those three carry a value of a
// few characters against a key that is the issue id, so at the margin they cost 9, 19 and 11
// characters where an issue costs 290, and the same origin holds about 1,165,000 read markers,
// 551,000 overrides and 953,000 notes. A ceiling of 250,000 therefore sat below what the app can
// hold in three of the five maps it governed, and the clause that mattered was the undo one: a
// reader who restored at the ceiling, annotated one more issue and then restored something else
// could not get their own data back, because undoRestore feeds the pre-restore snapshot through
// this same check and it refused at 250,001. The app blessed N and then refused its own snapshot at
// N+1, which is the data loss the ceiling was raised to prevent, arriving by the door it was
// watching.
//
// The two goals genuinely conflict here and the clause wins. There is no ceiling that both accepts
// everything the app can hold and refuses an eight mebibyte file declaring 772,000 read markers,
// because the app really can hold 963,000 of them. Refusing the reader's own data is data loss;
// coercing an oversized file is a transient allocation the origin write then refuses with the quota
// message it already had. So these three are held above what the origin can hold, which leaves them
// guarding against a corrupted snapshot rather than against a file, the file being bounded by
// MAX_BACKUP_BYTES first. Exempting undoRestore from the check instead was the other way out, and
// was not taken: a recovery path that skips the validation every other path runs is the shape of
// defect this app has already been bitten by twice.
export const MAX_MARKERS = 1500000;

// Checked against the file's declared size before a byte of it is read, so a file picked by mistake
// costs nothing to refuse. The heaviest backup this app can write is 1,560,536 characters as
// downloaded, measured with all twelve orders imported, every issue read and every issue annotated
// to the note cap. Written entirely in four-byte characters that same backup would be 6,242,144
// bytes, a little under six mebibytes, so eight leaves room above anything honest while still
// refusing a file picked in error before it is loaded into memory.
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

// A collected edition's name is a book title, so it needs far less room than a list name, and
// capping it keeps a corrupted or hostile order file from writing an unbounded string into
// storage once per issue.
export const MAX_COLLECTION = 200;

// The collected edition an issue belongs to, as a map from issue id to edition name.
//
// It lives on the list rather than on the issue because the same issue can sit in an ordinary
// issue order and in a trade order at the same time, and only the trade order knows it as part
// of a book. Issues are stored once and shared between lists, so writing it there would leak a
// trade order's structure into every other list holding that issue.
//
// Only ids the list actually holds are kept. A stale entry is invisible until the same issue is
// added back, at which point it would reappear in a book the reader never put it in.
function normalizeCollectedIn(raw, itemIds) {
  const ids = new Set(itemIds);
  const out = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const id = Number(k);
    if (!ids.has(id) || typeof v !== 'string' || !v.trim()) continue;
    out[id] = v.trim().slice(0, MAX_COLLECTION);
  }
  return out;
}

export function createList(state, { name, description = '', id = newId(), itemIds = [], catalogId = null, note = '', collectedIn = {} } = {}) {
  const listId = id;
  const ids = dedupe(itemIds.map(Number).filter((n) => Number.isInteger(n) && n !== 0));
  const list = {
    id: listId,
    name: String(name || 'Untitled list').slice(0, MAX_NAME),
    description: String(description || '').slice(0, MAX_DESCRIPTION),
    // The reader's own text about this order, kept apart from `description`, which holds the
    // curated order's authored blurb and is shown in the catalog card and the preview. Letting a
    // note overwrite that would destroy text the reader never wrote and cannot get back.
    note: normalizeNote(note),
    created: Date.now(),
    // Which catalog entry this list was imported from, when it was. It is what lets the
    // catalog show "in library" instead of offering to import a second copy, so it has to
    // survive a reload rather than being tracked only in memory.
    catalogId: catalogId ? String(catalogId).slice(0, MAX_NAME) : null,
    itemIds: ids,
    collectedIn: normalizeCollectedIn(collectedIn, ids),
  };
  return {
    ...state,
    lists: withList(state.lists, listId, list),
    listOrder: [...state.listOrder, listId],
    active: state.active ?? listId,
  };
}

export function renameList(state, listId, name, description) {
  const list = state.lists[listId];
  if (!list) return state;
  const next = { ...list, name: String(name ?? list.name).slice(0, MAX_NAME) };
  if (description !== undefined) next.description = String(description).slice(0, MAX_DESCRIPTION);
  return { ...state, lists: withList(state.lists, listId, next) };
}

// Returns { state, listId } because the caller needs the copy's id, and the usual trick of
// reading the last entry of listOrder does not work here: the copy is inserted next to its
// original rather than appended.
//
// Read progress is deliberately NOT copied. It is global, keyed by issue id (see the note at
// the top of this file), so the copy shares it with the original automatically: marking an
// issue read in either one shows it read in both. That is the point of duplicating an event
// order to try a different path through it, and it is why the copy needs its own itemIds
// array rather than a shared reference, so reordering one list never disturbs the other.
export function duplicateList(state, listId, { name } = {}) {
  const source = state.lists[listId];
  if (!source) return { state, listId: null };

  const id = newId();
  const copy = {
    id,
    name: name ? String(name).slice(0, MAX_NAME) : copyName(state, source.name),
    description: String(source.description || '').slice(0, MAX_DESCRIPTION),
    // The note travels with the copy. Duplicating an order is how a reader tries a different path
    // through it, and what they wrote about the order is still true of the copy.
    note: source.note ?? '',
    created: Date.now(),
    // A duplicate is the reader's own working copy, so it does not inherit the claim to be
    // the catalog import. Otherwise two lists would answer to the same catalog entry and
    // "in library" would point at whichever was found first.
    catalogId: null,
    itemIds: [...source.itemIds],
    // The copy is the same books in the same order, so it carries the same edition names. A
    // reader duplicating a trade order to reshuffle it would otherwise get a flat issue list
    // and no way to see which volume anything came from.
    collectedIn: { ...(source.collectedIn ?? {}) },
  };

  const listOrder = [...state.listOrder];
  const at = listOrder.indexOf(listId);
  listOrder.splice(at < 0 ? listOrder.length : at + 1, 0, id);

  return {
    state: { ...state, lists: withList(state.lists, id, copy), listOrder, active: state.active ?? id },
    listId: id,
  };
}

// "X" becomes "X (copy)", then "X (copy 2)" on the next duplication, so repeated copies stay
// tellable apart in the rail. The base is trimmed to make room for the suffix: appending first
// and slicing afterwards would cut the suffix off a maximally long name, producing a copy whose
// name was identical to the original.
function copyName(state, base) {
  const taken = new Set(Object.values(state.lists).map((l) => l.name));
  const fit = (suffix) => base.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix;
  let candidate = fit(' (copy)');
  for (let n = 2; taken.has(candidate) && n <= 999; n += 1) candidate = fit(` (copy ${n})`);
  return candidate;
}

export function deleteList(state, listId) {
  if (!state.lists[listId]) return state;
  const lists = cloneLists(state.lists);
  delete lists[listId];
  const listOrder = state.listOrder.filter((id) => id !== listId);
  const active = state.active === listId ? (listOrder[0] ?? null) : state.active;
  // Issue metadata and read state intentionally survive: the same issues may be in other
  // lists, and progress should never be destroyed by deleting a list.
  return { ...state, lists, listOrder, active };
}

// Puts a deleted list back where it was. The caller holds the removed list object and the
// index it occupied, because `deleteList` is the only thing that knows both and neither
// survives in the state afterwards.
//
// Read progress is not a consideration in either direction. It is global and keyed by issue
// id, so deleting a list never touched it and restoring one never has to put it back.
//
// A list whose id is present again is not restored, and neither is one whose catalog entry is
// already answered. Undo is offered for the rest of the session, so the buffer can outlive the
// deletion by a long way: an undone restore can bring the same id back, and a second import can
// bring the same order back under a new id. Splicing the stale copy in on top of either would
// destroy work rather than recover it, or leave two lists claiming one catalog entry, which is
// exactly the state `duplicateList` strips `catalogId` to avoid.
export function restoreList(state, list, { index = null, active = false } = {}) {
  if (!list?.id || state.lists[list.id]) return state;
  if (list.catalogId && listForCatalogId(state, list.catalogId)) return state;
  const listOrder = [...state.listOrder];
  const at = Number.isInteger(index) && index >= 0 && index <= listOrder.length ? index : listOrder.length;
  listOrder.splice(at, 0, list.id);
  return {
    ...state,
    lists: withList(state.lists, list.id, list),
    listOrder,
    active: active || state.active == null ? list.id : state.active,
  };
}

export function setActive(state, listId) {
  return state.lists[listId] ? { ...state, active: listId } : state;
}

// The list a catalog entry was imported into, if it is still there. Deleting the list is
// what puts an order back on offer, so this is read from state rather than remembered.
export function listForCatalogId(state, catalogId) {
  if (!catalogId) return null;
  for (const id of state.listOrder) {
    if (state.lists[id]?.catalogId === catalogId) return state.lists[id];
  }
  return null;
}

// ---------------------------------------------------------------- items

export function addIssuesToList(state, listId, inputs, { at = null, sort = false } = {}) {
  const list = state.lists[listId];
  if (!list) return { state, added: 0, skipped: 0 };

  let next = state;
  const incoming = [];
  // Which collected edition each incoming issue belongs to. Read from the input rather than
  // from the stored issue, because normalizeIssue drops it on purpose: it describes this
  // list's structure, not the issue.
  const editions = new Map();
  // upsertIssue copies the whole issues map on every call, so adding n issues cost n copies and this
  // loop was quadratic. Nothing shipped reaches that: the largest curated order is a few hundred.
  // The version 1 restore route does, because it hands a list's entire carrier to one call, and the
  // raised ceiling admits 250,000 of them: measured, 120,000 items took 22.7 seconds and 250,000 took
  // 96 before failing. The same issues declared the version 2 way take 100 milliseconds. The merge
  // below is the one upsertIssue performs, still against the running map so a repeat inside a single
  // import merges as it did, but the map and the state are each built once.
  const issues = { ...state.issues };
  for (const input of inputs) {
    const issue = normalizeIssue(input);
    if (!issue) continue;
    const prev = issues[issue.issueId];
    issues[issue.issueId] = prev
      ? { ...prev, ...stripNulls(issue), hydrated: issue.hydrated || prev.hydrated }
      : issue;
    incoming.push(issue.issueId);
    if (typeof input?.collectedIn === 'string' && input.collectedIn.trim()) {
      editions.set(issue.issueId, input.collectedIn.trim().slice(0, MAX_COLLECTION));
    }
  }
  next = { ...state, issues };

  const ordered = sort
    ? [...incoming].sort((a, b) => compareIssues(next.issues[a], next.issues[b]))
    : incoming;

  const existing = new Set(list.itemIds);
  const fresh = dedupe(ordered).filter((id) => !existing.has(id));
  const skipped = ordered.length - fresh.length;

  // Splicing with a spread passes every inserted id as a separate argument, so the insert gave out
  // at the argument limit rather than at any bound this app states: measured on the version 1
  // restore route, 125,000 ids inserted and 130,000 threw "Maximum call stack size exceeded", which
  // the restore then reported to the reader as its refusal reason. The limit is an engine detail and
  // not a number worth stating, so the insert is written not to have one.
  const held = list.itemIds;
  const index = at == null ? held.length : clamp(at, 0, held.length);
  const itemIds = held.slice(0, index).concat(fresh, held.slice(index));

  // Only the issues actually added take an edition name. An issue the list already held keeps
  // the edition it was added under, so re-importing an order cannot move an issue into a
  // different book than the one the reader has been working through.
  const collectedIn = { ...(list.collectedIn ?? {}) };
  for (const id of fresh) {
    const name = editions.get(id);
    if (name) collectedIn[id] = name;
  }

  return {
    state: { ...next, lists: withList(next.lists, listId, { ...list, itemIds, collectedIn }) },
    added: fresh.length,
    skipped,
  };
}

export function removeFromList(state, listId, issueId) {
  const list = state.lists[listId];
  if (!list) return state;
  const id = Number(issueId);
  const itemIds = list.itemIds.filter((n) => n !== id);
  if (itemIds.length === list.itemIds.length) return state;
  // Dropped with the issue. Left behind, it would put the issue back into a book it had been
  // removed from the moment it was added again, and grow storage for a list that no longer
  // holds it.
  const collectedIn = { ...(list.collectedIn ?? {}) };
  delete collectedIn[id];
  return { ...state, lists: withList(state.lists, listId, { ...list, itemIds, collectedIn }) };
}

export function moveItem(state, listId, issueId, delta) {
  const list = state.lists[listId];
  if (!list) return state;
  const itemIds = [...list.itemIds];
  const from = itemIds.indexOf(Number(issueId));
  if (from < 0) return state;
  const to = clamp(from + delta, 0, itemIds.length - 1);
  if (to === from) return state;
  itemIds.splice(to, 0, ...itemIds.splice(from, 1));
  return { ...state, lists: withList(state.lists, listId, { ...list, itemIds }) };
}

export function moveItemTo(state, listId, issueId, index) {
  const list = state.lists[listId];
  if (!list) return state;
  const from = list.itemIds.indexOf(Number(issueId));
  if (from < 0) return state;
  return moveItem(state, listId, issueId, clamp(index, 0, list.itemIds.length - 1) - from);
}

// ---------------------------------------------------------------- read state

// The timestamp is coerced here rather than only in `coerce`, because `coerce` runs on the v2
// branch of `migrate` alone. The v1 branch reaches read state through this function instead, so a
// v1 backup carrying `readAt: "banana"` used to land unchanged in the read map and reach the
// screen as "Invalid Date". Written the same way `coerce` writes it, so a value restored from a
// v1 backup and the same value reloaded from storage cannot disagree.
export function markRead(state, issueId, read = true, at = Date.now()) {
  const id = Number(issueId);
  if (!Number.isInteger(id)) return state;
  const next = { ...state.read };
  if (read) next[id] = Number(at) || Date.now();
  else delete next[id];
  return { ...state, read: next };
}

export function toggleRead(state, issueId) {
  return markRead(state, issueId, !isRead(state, issueId));
}

export function isRead(state, issueId) {
  return Object.prototype.hasOwnProperty.call(state.read, Number(issueId));
}

export function markManyRead(state, issueIds, read = true) {
  let next = state;
  for (const id of issueIds) next = markRead(next, id, read);
  return next;
}

export function setOverride(state, issueId, value) {
  const id = Number(issueId);
  const overrides = { ...state.overrides };
  if (value === 'available' || value === 'unavailable') overrides[id] = value;
  else delete overrides[id];
  return { ...state, overrides };
}

// ---------------------------------------------------------------- notes

// Trimmed and capped, and an empty result deletes rather than storing "". That keeps "has a note"
// a presence check at every call site, and stops a note the reader cleared from riding along in
// every future backup as an empty string.
export function normalizeNote(text) {
  return String(text ?? '').trim().slice(0, MAX_NOTE);
}

export function setIssueNote(state, issueId, text) {
  const id = Number(issueId);
  if (!Number.isInteger(id) || id === 0) return state;
  const note = normalizeNote(text);
  const notes = { ...state.notes };
  if (note) notes[id] = note;
  else delete notes[id];
  return { ...state, notes };
}

export function issueNote(state, issueId) {
  return state.notes?.[Number(issueId)] ?? '';
}

// The list's note lives on the list object rather than in a second map, because it dies with the
// list. An issue note outlives every list that introduced the issue, exactly as read state does.
export function setListNote(state, listId, text) {
  const list = state.lists[listId];
  if (!list) return state;
  return { ...state, lists: withList(state.lists, listId, { ...list, note: normalizeNote(text) }) };
}

// ---------------------------------------------------------------- derived

export function upNext(state, listId) {
  const list = state.lists[listId];
  if (!list) return null;
  const id = list.itemIds.find((i) => !isRead(state, i));
  return id == null ? null : (state.issues[id] ?? { issueId: id, title: `Issue ${id}` });
}

export function listProgress(state, listId) {
  const list = state.lists[listId];
  if (!list) return { read: 0, total: 0 };
  const total = list.itemIds.length;
  const read = list.itemIds.reduce((n, id) => n + (isRead(state, id) ? 1 : 0), 0);
  return { read, total };
}

// Aggregated over UNIQUE issue ids, so an issue in two lists counts once. Given a listId it counts
// that list alone; a reader inside one crossover was otherwise shown totals inflated by every other
// list they had imported, which is the number they are least able to act on.
export function seriesProgress(state, listId = null) {
  const tracked = new Set();
  if (listId == null) {
    for (const id of state.listOrder) {
      for (const issueId of state.lists[id]?.itemIds ?? []) tracked.add(issueId);
    }
  } else {
    for (const issueId of state.lists[listId]?.itemIds ?? []) tracked.add(issueId);
  }
  const bySeries = new Map();
  for (const id of tracked) {
    const issue = state.issues[id];
    const key = issue?.seriesId ?? `unknown:${issue?.seriesName ?? 'Unsorted'}`;
    if (!bySeries.has(key)) {
      bySeries.set(key, {
        seriesId: issue?.seriesId ?? null,
        seriesName: issue?.seriesName ?? 'Unknown series',
        tracked: 0,
        read: 0,
      });
    }
    const row = bySeries.get(key);
    row.tracked += 1;
    if (isRead(state, id)) row.read += 1;
  }
  return [...bySeries.values()].sort((a, b) => a.seriesName.localeCompare(b.seriesName));
}

// Which of the reader's lists an issue is in, named, in rail order. Read state and issue
// metadata both outlive the list that introduced them, by the deliberate choice recorded above
// `deleteList`, so an issue can be read and belong to nothing at all. The Library views are the
// first surface that can say so, and they can only say it if this returns nothing rather than
// guessing at a list.
export function listsContaining(state, issueId) {
  const id = Number(issueId);
  const names = [];
  for (const listId of state.listOrder) {
    const list = state.lists[listId];
    if (list?.itemIds.includes(id)) names.push(list.name);
  }
  return names;
}

// The one row shape both Library views render, so a row that renders in one renders in the other.
// The fallback matches `listItems`: an id with no metadata is shown as itself rather than dropped,
// because a read record for an issue the app has otherwise forgotten is exactly what these views
// exist to make visible.
function libraryRow(state, issueId) {
  const id = Number(issueId);
  const issue = state.issues[id] ?? { issueId: id, title: `Issue ${id}`, hydrated: false, source: 'unknown' };
  return {
    ...issue,
    read: isRead(state, id),
    readAt: state.read[id] ?? null,
    lists: listsContaining(state, id),
  };
}

// Newest first, because the question this answers is what you have been reading, and the timestamp
// `markRead` already stores is the only ordering the data supports. The tie break is explicit
// rather than left to key order: `markManyRead` calls `markRead` in a loop, each with its own
// `Date.now()`, so a bulk mark produces runs of equal timestamps, and integer-like keys enumerate
// ascending, which would sort an arbitrary half of one bulk mark above the other.
export function readIssues(state) {
  return Object.keys(state.read)
    .map((id) => libraryRow(state, id))
    .sort((a, b) => (b.readAt ?? 0) - (a.readAt ?? 0) || a.issueId - b.issueId);
}

// By title rather than by id. A hand-added entry with a marvel.com URL keeps that issue's real id,
// one whose details came from the wiki keeps the real id the wiki carries, and one with neither
// gets a negative synthetic id from the clock, so the two kinds cannot be ordered against each
// other by id at all: every entry of the second kind would sort below every entry of the first for
// no reason a reader could see.
export function manualIssues(state) {
  return Object.values(state.issues)
    .filter((issue) => issue.source === 'manual')
    .map((issue) => libraryRow(state, issue.issueId))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

export function pendingIssueIds(state) {
  const tracked = new Set();
  for (const listId of state.listOrder) {
    for (const id of state.lists[listId]?.itemIds ?? []) tracked.add(id);
  }
  return [...tracked].filter((id) => {
    const issue = state.issues[id];
    // A refusal is excluded rather than merely deprioritised. This set is both the retry queue and
    // the number on the button that offers to work through it, so leaving 34 refusals in it would
    // spend the reader's own request budget, held at 45 a minute, to learn the same 404 again and
    // change nothing. Offering to fetch what cannot be fetched turns a silent omission into a
    // loud promise, which is worse than the silence.
    return issue && !issue.hydrated && !issue.detailsRefused && issue.source !== 'manual';
  });
}

// The first `lookahead + 1` ids that pass the predicate, in the order given.
//
// The predicate is applied before the count, not after, and the difference only shows on a second
// run. Taking the first nine ids and then filtering them yields fewer than nine when some are
// already done, and the shortfall is made up from the remainder, which is ordered by when an id was
// tracked rather than by where it sits in the list. So a reader who stopped a run and restarted it
// got a worse order than the first time: issues they had already read fetched ahead of the ones
// they were about to.
export function lookaheadPriority(ids, wanted, lookahead) {
  const want = Math.max(0, Number(lookahead) || 0) + 1;
  const out = [];
  for (const id of ids) {
    if (!wanted(id)) continue;
    out.push(id);
    if (out.length >= want) break;
  }
  return out;
}

// Hydration priority: whatever you are about to read, plus a short lookahead.
export function hydrationOrder(state, listId, lookahead = 5) {
  const pending = new Set(pendingIssueIds(state));
  const list = state.lists[listId];
  const unread = list ? list.itemIds.filter((id) => !isRead(state, id)) : [];
  const priority = lookaheadPriority(unread, (id) => pending.has(id), lookahead);
  const rest = [...pending].filter((id) => !priority.includes(id));
  return [...priority, ...rest];
}

// The order a synopsis run works through, which is not the hydration order and cannot reuse it.
//
// Hydration's queue is every pending issue in the library, because a missing digitalId is missing
// wherever it sits. A synopsis run is bounded by one list: it is started from that list's tool bar,
// its progress is reported there, and its results are thrown away at the end of the session, so
// fetching prose for an order the reader is not reading spends their request budget on text nothing
// will show.
//
// Read items are included, after the unread ones. A reader does look back at an issue they have
// already finished, and by then the run that would have fetched it has ended.
//
// `wanted` decides what is still worth asking for. It is supplied rather than computed here because
// what the session already knows is not part of saved state and must not become part of it.
export function synopsisOrder(state, listId, wanted, lookahead = 8) {
  const list = state.lists[listId];
  if (!list) return [];
  // A hand-added issue is by definition newer than the metadata snapshot, so the service has no
  // record of it: either it carries a synthetic negative id the service has never seen, or it
  // carries a real id the service answers 404 for. Asking about one spends a request either way.
  const ids = list.itemIds.filter((id) => state.issues[id] && state.issues[id].source !== 'manual');
  const unread = ids.filter((id) => !isRead(state, id));
  const priority = lookaheadPriority(unread, wanted, lookahead);
  // The tail is rebuilt unread-first rather than filtered out of list order, which is the same
  // mistake lookaheadPriority was written to fix, one step further down the queue. Filtering `ids`
  // keeps list order, so a reader a hundred issues into an order would have spent the first two
  // minutes of the run on prose for issues they had already finished before it reached the tenth
  // issue ahead of them, and nothing survives the tab to make that back.
  const tail = [...unread, ...ids.filter((id) => isRead(state, id))];
  const rest = tail.filter((id) => wanted(id) && !priority.includes(id));
  return [...priority, ...rest];
}

// ---------------------------------------------------------------- persistence shape

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyState();
  const version = Number(raw.schemaVersion ?? 1);

  if (version === SCHEMA_VERSION) return coerce(raw);

  if (version < 2) {
    // v1 stored full item objects inside each list, with a per-list `read` boolean.
    // Collapse to global read state; if an issue was read anywhere, it is read.
    //
    // Built into accumulators and assembled once, the way coerce() does on the other branch, rather
    // than threading an immutable state through createList, addIssuesToList and markRead one element
    // at a time. Each of those copies a whole map per call, so this loop was quadratic three times
    // over and the ceilings admit 250,000 of either shape. Only the copy inside addIssuesToList was
    // measured and removed before, and the fixture written to prove it carried one list and no
    // `read` flag, which is the field the sentence above says defines the format, so it was the one
    // shape that missed both of the others. Measured on this tree: 5,000 empty lists is 0.17 of a
    // mebibyte, two per cent of the size guard, and took 16.8 seconds, and 80,000 items carrying
    // `read` took 9.3 seconds at 3.19. Both are linear now.
    const issues = {};
    const read = {};
    const lists = emptyLists();
    const listOrder = [];
    let active = null;
    const carriers = Array.isArray(raw.lists) ? raw.lists : Object.values(raw.lists ?? {});
    for (const oldList of carriers) {
      const items = Array.isArray(oldList?.items) ? oldList.items : [];
      const listId = newId();
      const itemIds = [];
      const held = new Set();
      // Read from the input rather than from the stored issue, and last one wins, because that is
      // what the Map this replaces did: it was written per input and read once per kept id.
      const editions = new Map();
      for (const input of items) {
        const issue = normalizeIssue(input);
        if (issue) {
          const prev = issues[issue.issueId];
          issues[issue.issueId] = prev
            ? { ...prev, ...stripNulls(issue), hydrated: issue.hydrated || prev.hydrated }
            : issue;
          if (!held.has(issue.issueId)) {
            held.add(issue.issueId);
            itemIds.push(issue.issueId);
          }
          if (typeof input?.collectedIn === 'string' && input.collectedIn.trim()) {
            editions.set(issue.issueId, input.collectedIn.trim().slice(0, MAX_COLLECTION));
          }
        }
        // Asked of every item, not only of the ones that became issues, because markRead was called
        // the same way: it takes any integer, so a v1 file marking id 0 read still lands in the map
        // even though normalizeIssue refuses that id. Kept rather than tidied, because coerce accepts
        // the same key on the other branch and the two branches must not disagree about a stored file.
        if (!input?.read) continue;
        const id = Number(input.issueId ?? input.id);
        if (Number.isInteger(id)) read[id] = Number(input.readAt ?? Date.now()) || Date.now();
      }
      const collectedIn = {};
      for (const id of itemIds) {
        const name = editions.get(id);
        if (name) collectedIn[id] = name;
      }
      lists[listId] = {
        id: listId,
        name: String((oldList?.name ?? 'Imported list') || 'Untitled list').slice(0, MAX_NAME),
        description: String((oldList?.description ?? '') || '').slice(0, MAX_DESCRIPTION),
        note: normalizeNote(''),
        created: Date.now(),
        catalogId: null,
        itemIds,
        collectedIn,
      };
      listOrder.push(listId);
      active ??= listId;
    }
    return { ...createEmptyState(), issues, read, lists, listOrder, active };
  }

  // Newer than we understand: refuse rather than silently mangling it.
  throw new Error(`Unsupported schema version ${version}; this build understands ${SCHEMA_VERSION}.`);
}

function coerce(raw) {
  const base = createEmptyState();
  const issues = {};
  for (const v of Object.values(raw.issues ?? {})) {
    const n = normalizeIssue(v);
    if (n) issues[n.issueId] = n;
  }
  const read = {};
  for (const [k, v] of Object.entries(raw.read ?? {})) {
    const id = Number(k);
    if (Number.isInteger(id)) read[id] = Number(v) || Date.now();
  }
  const overrides = {};
  for (const [k, v] of Object.entries(raw.overrides ?? {})) {
    if (v === 'available' || v === 'unavailable') overrides[Number(k)] = v;
  }
  // Measured before this line existed: a note set on an issue was gone on the next page load,
  // because this function rebuilds state field by field and anything it does not name is dropped.
  // The same is true of the list's note below.
  const notes = {};
  for (const [k, v] of Object.entries(raw.notes ?? {})) {
    const id = Number(k);
    const note = normalizeNote(v);
    if (Number.isInteger(id) && id !== 0 && note) notes[id] = note;
  }
  const lists = emptyLists();
  for (const [k, v] of Object.entries(raw.lists ?? {})) {
    if (!v || typeof v !== 'object') continue;
    const itemIds = dedupe((Array.isArray(v.itemIds) ? v.itemIds : []).map(Number).filter((n) => Number.isInteger(n) && n !== 0));
    lists[k] = {
      id: k,
      name: String(v.name ?? 'Untitled list').slice(0, MAX_NAME),
      description: String(v.description ?? '').slice(0, MAX_DESCRIPTION),
      note: normalizeNote(v.note),
      created: Number(v.created) || Date.now(),
      catalogId: typeof v.catalogId === 'string' && v.catalogId ? v.catalogId.slice(0, MAX_NAME) : null,
      itemIds,
      // Rebuilt rather than carried across, so a hand-edited backup cannot name issues the
      // list does not hold. A list saved before trade orders existed simply has none, which is
      // why this is not a schema version bump: the field's absence is a valid state, not an
      // older shape needing migration.
      collectedIn: normalizeCollectedIn(v.collectedIn, itemIds),
    };
  }
  // Filtered to strings before anything else, because the membership test is a property lookup and
  // the dedupe is a Set: the lookup coerces its key, the Set compares identity, and the two disagree
  // on every value that is not already a string. An entry of [1] stringifies to "1", so it passed the
  // lookup against a list keyed "1", and each array was a distinct identity, so the dedupe kept every
  // one: 300,000 of those still reached the rail after the dedupe was added, on the same 1.14
  // mebibyte file. Nothing this app writes is a non-string, and dropping one costs at most its
  // position, since the backfill below returns the list itself.
  const named = (Array.isArray(raw.listOrder) ? raw.listOrder : Object.keys(lists))
    .filter((id) => typeof id === 'string');
  // Deduplicated because the filter tests membership rather than uniqueness, so one valid id
  // repeated survived once per repetition: 300,000 entries naming a single list fitted in a
  // 1.14 mebibyte file, cleared every ceiling, and made the rail append 300,000 nodes on every
  // update. Deduplicated, the order is bounded by the number of lists, which is already capped.
  const listOrder = dedupe(named.filter((id) => lists[id]));
  // Backfilled through a Set rather than Array.includes, which made this loop quadratic in the
  // number of lists. That cost 3 milliseconds while the ceiling was 1,000 and 26.6 seconds once it
  // was 250,000, on a 5.38 mebibyte file that clears the size guard and every count check, so the
  // tab froze before a byte was written. The same input takes 125 milliseconds through a Set, and
  // the order it produces is the one Array.includes produced.
  const seen = new Set(listOrder);
  for (const id of Object.keys(lists)) if (!seen.has(id)) listOrder.push(id);

  return {
    ...base,
    issues,
    read,
    overrides,
    notes,
    lists,
    listOrder,
    active: lists[raw.active] ? raw.active : (listOrder[0] ?? null),
  };
}

// Structural validation for restore. Returns { ok, errors, state }.
export function validateBackup(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Backup is not an object.'], state: null };
  }
  if (raw.schemaVersion == null) errors.push('Missing schemaVersion.');
  if (Number(raw.schemaVersion) > SCHEMA_VERSION) {
    errors.push(`Backup schema ${raw.schemaVersion} is newer than this app (${SCHEMA_VERSION}).`);
  }
  if (raw.lists != null && (typeof raw.lists !== 'object' || Array.isArray(raw.lists))) {
    errors.push('lists must be an object.');
  }
  if (raw.issues != null && (typeof raw.issues !== 'object' || Array.isArray(raw.issues))) {
    errors.push('issues must be an object.');
  }
  if (raw.read != null && (typeof raw.read !== 'object' || Array.isArray(raw.read))) {
    errors.push('read must be an object.');
  }
  if (raw.notes != null && (typeof raw.notes !== 'object' || Array.isArray(raw.notes))) {
    errors.push('notes must be an object.');
  }
  if (errors.length) return { ok: false, errors, state: null };

  // Counted before coercion, because coercion is what builds the oversized object: an issue costs
  // 23.6 characters at its cheapest in a file and 280 once coerced, an amplification of nearly
  // twelve. Each ceiling sits above anything this app can hold in the map it governs, so a tracker
  // too large for the origin is still accepted here and still refused by the write, with the honest
  // quota message it already had. What this buys is refusing counts absurd on their face, for one
  // pass over the keys, before coercion allocates for them. The three cheap maps take a ceiling of
  // their own because one number could not cover both: see the note above MAX_MARKERS.
  for (const [label, value, cap] of [
    ['issues', raw.issues, MAX_ISSUES],
    ['read markers', raw.read, MAX_MARKERS],
    ['availability overrides', raw.overrides, MAX_MARKERS],
    ['notes', raw.notes, MAX_MARKERS],
    ['lists', raw.lists, MAX_LISTS],
  ]) {
    if (!value || typeof value !== 'object') continue;
    const n = Object.keys(value).length;
    if (n > cap) errors.push(`Backup declares ${n} ${label}, and this app holds at most ${cap}.`);
  }
  if (raw.lists && typeof raw.lists === 'object' && !Array.isArray(raw.lists)) {
    // A version 1 backup has no top-level issues map: it carries whole issue objects inside each
    // list's `items`, which migrate reads and turns into exactly that many issues. The loop above
    // therefore scored a v1 file at zero however large it was, and 50,000 items in a 1.50 mebibyte
    // file built 50,000 issues in 3.8 seconds. Summed rather than checked per list, because one map
    // is what they become.
    let carried = 0;
    for (const v of Object.values(raw.lists)) {
      const n = Array.isArray(v?.itemIds) ? v.itemIds.length : 0;
      if (Array.isArray(v?.items)) carried += v.items.length;
      if (n > MAX_ISSUES) {
        errors.push(`One list declares ${n} issues, and this app holds at most ${MAX_ISSUES} in a list.`);
        break;
      }
    }
    if (carried > MAX_ISSUES) {
      errors.push(`Backup declares ${carried} issues inside its lists, and this app holds at most ${MAX_ISSUES}.`);
    }
  }
  if (errors.length) return { ok: false, errors, state: null };

  try {
    return { ok: true, errors: [], state: migrate(raw) };
  } catch (err) {
    return { ok: false, errors: [err.message], state: null };
  }
}

export function withoutIssueDescriptions(state, boundary, warn = console.warn) {
  const issues = state?.issues;
  if (!issues || typeof issues !== 'object') return state;

  let nextIssues = issues;
  let refused = 0;
  for (const [id, issue] of Object.entries(issues)) {
    if (!issue || typeof issue !== 'object'
      || !Object.prototype.hasOwnProperty.call(issue, 'description')) continue;
    if (nextIssues === issues) nextIssues = { ...issues };
    const nextIssue = { ...issue };
    delete nextIssue.description;
    nextIssues[id] = nextIssue;
    refused += 1;
  }
  if (refused === 0) return state;

  warn(`${boundary} refused ${refused} issue description field${refused === 1 ? '' : 's'}.`);
  return { ...state, issues: nextIssues };
}

export function exportBackup(state) {
  const clean = withoutIssueDescriptions(state, 'Backup export');
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'recap-page',
    issues: clean.issues,
    read: clean.read,
    overrides: clean.overrides,
    // Named explicitly, like every other key here. This function does not spread, so a map it
    // does not name never reaches the backup file or localStorage at all. Measured: without this
    // line an issue note was absent from the exported JSON, not merely dropped on the way back in.
    notes: clean.notes ?? {},
    lists: clean.lists,
    listOrder: clean.listOrder,
    active: clean.active,
  };
}

export function listItems(state, listId) {
  const list = state.lists[listId];
  if (!list) return [];
  const editions = list.collectedIn ?? {};
  return list.itemIds.map((id) => ({
    ...(state.issues[id] ?? { issueId: id, title: `Issue ${id}`, hydrated: false, source: 'unknown' }),
    read: isRead(state, id),
    override: state.overrides[id] ?? null,
    note: issueNote(state, id),
    collectedIn: editions[id] ?? null,
  }));
}

// The collected editions a list is divided into, in reading order, each with its own progress.
//
// Editions are runs of consecutive items rather than a grouping of the whole list, because
// itemIds is the reading order and the reader may reorder it. A book split in two by a move
// shows as two runs, which is the truth about the order they are now in; silently regrouping
// them would show a reading order the list does not have.
//
// Returns [] for a list with no editions at all, so a caller can tell "not a trade order" from
// "a trade order whose books are all empty" without inspecting the items.
export function listCollections(state, listId) {
  const items = listItems(state, listId);
  const runs = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last.name === item.collectedIn) last.items.push(item);
    else runs.push({ name: item.collectedIn, items: [item] });
  }
  if (!runs.some((r) => r.name)) return [];
  return runs.map((run) => ({
    name: run.name,
    items: run.items,
    total: run.items.length,
    read: run.items.filter((i) => i.read).length,
  }));
}

// ---------------------------------------------------------------- helpers

function dedupe(arr) {
  return [...new Set(arr)];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------- progress

export function completionState(read, total) {
  const nRead = Number(read) || 0;
  const nTotal = Number(total) || 0;
  if (nTotal > 0 && nRead >= nTotal) return 'done';
  if (nRead === 0) return 'unstarted';
  return 'active';
}

export function seriesWord(state) {
  return state === 'done' ? 'Fully read' : state === 'active' ? 'Reading' : state === 'unstarted' ? 'Not started' : '';
}

export function orderWord(state) {
  return state === 'done' ? 'Finished' : state === 'active' ? 'Reading' : state === 'unstarted' ? 'Not started' : '';
}

export function progressSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let read = 0;
  let tracked = 0;
  let done = 0;
  for (const row of list) {
    read += Number(row?.read) || 0;
    tracked += Number(row?.tracked) || 0;
    if (completionState(row?.read, row?.tracked) === 'done') done += 1;
  }
  return { series: list.length, read, tracked, done };
}

export function progressGroups(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map([
    ['active', { key: 'active', label: 'In progress', rows: [] }],
    ['unstarted', { key: 'unstarted', label: 'Not started', rows: [] }],
    ['done', { key: 'done', label: 'Fully read', rows: [] }],
  ]);
  for (const row of list) {
    groups.get(completionState(row?.read, row?.tracked)).rows.push(row);
  }
  return [...groups.values()].filter((group) => group.rows.length > 0);
}

export function orderStates(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let active = 0;
  let done = 0;
  let unstarted = 0;
  for (const entry of list) {
    const state = completionState(entry?.read, entry?.total);
    if (state === 'done') done += 1;
    else if (state === 'unstarted') unstarted += 1;
    else active += 1;
  }
  return { orders: list.length, active, done, unstarted };
}

// How many of a set of search results the tracker already knows about. The Add view shows this
// beside a result so a reader can tell a new comic from one they have already filed, without
// opening another screen to check.
//
// The question is deliberately about the issue store rather than about the destination list.
// Those differ, and the difference is not an edge case: issue metadata survives a list deletion
// on purpose, and the add path merges every incoming issue into the store before it decides
// whether the list already had it. So an issue can sit in the store while belonging to no list
// at all, and a pill claiming it is in the destination would be false exactly there. What the
// store can answer honestly is "this app has seen this comic", which is what the pill says.
//
// Counted over distinct ids, because a result set is free to repeat one and a count that grew
// past the number of rows on screen would describe nothing a reader could verify.
export function heldCount(state, items) {
  const issues = state?.issues;
  if (!issues) return 0;
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.issueId;
    if (id === undefined || id === null) continue;
    if (seen.has(id)) continue;
    if (issues[id]) seen.add(id);
  }
  return seen.size;
}
