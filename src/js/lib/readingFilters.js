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
// testing and nothing here touches the DOM. Constraint 6 is the reason that matters: `unlimited`
// is the one filter that reads the five-state availability model, and a filter that quietly
// degrades to All is a filter that has quietly stopped distinguishing those five states.

import { availability, STATE } from './availability.js';

// Order is display order: the two a reader reaches for most, then the two that answer a question
// about an issue rather than about progress. `all` leads because it is the default and the way
// back from any of the others.
export const READING_FILTERS = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'unread', label: 'Unread', match: (item) => !item.read },
  { value: 'deferred', label: 'Deferred', match: (item) => !item.read && Boolean(item.deferred) },
  { value: 'read', label: 'Read', match: (item) => Boolean(item.read) },
  {
    value: 'unlimited',
    label: 'In Unlimited',
    // Deliberately two of the five states and not a boolean. `expected` is the hedge the
    // availability model exists for and `override-available` is the reader saying they checked;
    // `scheduled`, `unknown` and `override-unavailable` each mean something different from each
    // other, and none of them means yes.
    match: (item) => {
      const state = availability(item, { override: item.override }).state;
      return state === STATE.EXPECTED || state === STATE.OVERRIDE_AVAILABLE;
    },
  },
  {
    value: 'pending',
    label: 'Details pending',
    // A manually added issue has no upstream record to wait for, so it is not pending anything
    // and would otherwise sit in this list forever. The same is true of an issue the snapshot has
    // no record of, for a different reason: that one was asked about and refused, so this list
    // would offer the reader 34 issues whose details are never going to arrive.
    match: (item) => !item.hydrated && !item.detailsRefused && item.source !== 'manual',
  },
];

// What a filter falls back to, and what the app starts on before anything is restored.
export const DEFAULT_FILTER = 'all';

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
