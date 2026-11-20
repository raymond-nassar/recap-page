// The filters above the full reading order, defined once.
//
// There used to be two lists that had to agree: the radios in src/index.html and a chain of
// equality checks in main.js. Nothing held them together, and the failure was silent in whichever
// direction they drifted. A radio present in the markup and missing from the checks reached a
// trailing `return true`, so the reader saw a filter selected, stored and honoured against a list
// it was not filtering; a check present in the code and missing from the markup was simply
// unreachable. Neither says anything on screen or in the console.
//
// So the two lists are one list, and it is this one. An entry carries the value, the label the
// radio shows and the predicate that decides a row, which makes "in the markup but not in the
// code" impossible to express rather than merely discouraged: there is no way to add a radio
// without also adding the predicate it renders from.
//
// It lives under lib/ rather than beside the renderer because the predicates are the part worth
// testing and nothing here touches the DOM.
//
// Two filters were removed at the owner's request on 19 Nov 2026, "Past Unlimited date or marked
// available" and "Details pending", because they answered questions about the data rather than
// about reading. A reader who had one chosen is returned to All: wireReading() admits only a value
// the current radios offer, and a complete backup that names one restores as All
// (LEGACY_READING_FILTERS below). The availability badge and its five states are untouched.

// Order is display order. `all` leads because it is the default and the way back from any of the
// others.
export const READING_FILTERS = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'unread', label: 'Unread', match: (item) => !item.read },
  { value: 'deferred', label: 'Deferred', match: (item) => !item.read && Boolean(item.deferred) },
  { value: 'read', label: 'Read', match: (item) => Boolean(item.read) },
];

// What a filter falls back to, and what the app starts on before anything is restored.
export const DEFAULT_FILTER = 'all';

// Values a build before 19 Nov 2026 could save. A complete backup naming one restores as the
// default rather than being refused, so nothing a reader saved with an older build stops loading.
export const LEGACY_READING_FILTERS = Object.freeze(['unlimited', 'pending']);

export function readingFilter(value) {
  return READING_FILTERS.find((f) => f.value === value) ?? null;
}

// Throws rather than matching everything. Every value that can reach this comes from a radio
// rendered out of the list above, so an unknown one is a programming error and not something a
// reader can do, and the old behaviour of quietly passing the whole list is exactly what made the
// same mistake invisible for as long as it was. Matching nothing was considered, which is what
// filterByFacet does for the catalog, and rejected here: a stale saved facet is reachable by a
// reader who used an older build, whereas this is not reachable at all without an edit to this
// file, so it should stop the person making that edit rather than show them an empty list.
export function matchesReadingFilter(value, item) {
  const entry = readingFilter(value);
  if (!entry) throw new Error(`Unknown reading filter: ${JSON.stringify(value)}`);
  return entry.match(item);
}

// The one way the single list can still be self-inconsistent is an entry that names a filter and
// does not decide one. Reported rather than thrown so the caller chooses when to fail, which is
// what lets this be exercised against a list built to be wrong.
export function filterListProblems(filters) {
  const problems = [];
  if (!Array.isArray(filters) || filters.length === 0) return ['The filter list is empty.'];
  const seen = new Set();
  for (const [i, f] of filters.entries()) {
    const where = `Filter ${i}`;
    if (!f || typeof f.value !== 'string' || f.value === '') problems.push(`${where} has no value.`);
    else if (seen.has(f.value)) problems.push(`${where} repeats the value ${JSON.stringify(f.value)}.`);
    else seen.add(f.value);
    if (!f || typeof f.label !== 'string' || f.label === '') problems.push(`${where} has no label.`);
    if (!f || typeof f.match !== 'function') problems.push(`${where} has no match function.`);
  }
  if (!problems.length && !filters.some((f) => f.value === DEFAULT_FILTER)) {
    problems.push(`No filter offers the default value ${JSON.stringify(DEFAULT_FILTER)}.`);
  }
  return problems;
}

// Checked at load so a malformed entry stops the app on the boot after the edit that made it,
// rather than at whichever later moment a reader happens to choose that filter.
const problems = filterListProblems(READING_FILTERS);
if (problems.length) throw new Error(`Reading filters are inconsistent: ${problems.join(' ')}`);
