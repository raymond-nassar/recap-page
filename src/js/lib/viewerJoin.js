// #1601: a comic first saved by its Marvel Comics app viewer number alone, before the bundled table
// joined that viewer to an old catalog number, is carried over to the catalog number so the reader
// keeps one checkmark, note and rating for it. The owner's rule, recorded on the Issue: carry over a
// verified one-to-one match with no conflicting saved data, and leave anything uncertain or
// conflicting untouched.
//
// So the join is all or nothing for each comic. It moves nothing unless the table names exactly one
// catalog number for the viewer and no other viewer-only comic claims that number, and it refuses
// when both records hold a value the other does not equal, or when one list holds both, since
// merging those would either overwrite a saved value or change the list's order. A refused comic
// stays exactly as it was saved and keeps working under its own record. A number that only looks
// equal is never a match: the viewer and catalog numberings overlap, so only the table joins them.
import { appViewerFor, catalogIdsForViewer } from './marvelComicsApp.js';
import { taggedViewer } from './marvelComicsAppUrl.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (map, id) => Object.prototype.hasOwnProperty.call(map ?? {}, id);

export function joinViewerRecords(state, { catalogIdsFor = catalogIdsForViewer, viewerFor = appViewerFor } = {}) {
  if (!state?.issues) return state;
  const planned = [];
  const claims = new Map();
  for (const record of Object.values(state.issues)) {
    const viewer = taggedViewer(record);
    if (!viewer) continue;
    const ids = catalogIdsFor(viewer);
    if (ids.length !== 1 || !Number.isSafeInteger(ids[0]) || ids[0] <= 0) continue;
    const from = record.issueId;
    const to = ids[0];
    // Asked in both directions, so a catalog number the table lists twice joins nothing.
    if (viewerFor(to) !== viewer) continue;
    // A record no list holds is left exactly as saved. Deleting a list keeps its comics' progress,
    // so an orphan is not proof of anything, and moving it would act on data the reader cannot see.
    if (!Object.values(state.lists ?? {}).some((list) => list?.itemIds?.includes(from))) continue;
    if (!joinable(state, from, to)) continue;
    planned.push({ from, to, record });
    claims.set(to, (claims.get(to) ?? 0) + 1);
  }
  const moves = planned.filter(({ to }) => claims.get(to) === 1);
  if (!moves.length) return state;

  const next = copyForRekey(state);
  for (const { from, to, record } of moves) {
    if (!next.issues[to]) {
      const rest = { ...record };
      delete rest.appViewer;
      next.issues[to] = { ...rest, issueId: to };
    }
    // Kept as saved, like a corrected record: once no list holds it, it shows nowhere.
    rekey(next, from, to);
  }
  return next;
}

const PROGRESS = ['read', 'overrides', 'notes', 'ratings'];

export function copyForRekey(state) {
  const next = { ...state, issues: { ...state.issues }, lists: Object.assign(Object.create(null), state.lists) };
  for (const key of PROGRESS) next[key] = { ...(state[key] ?? {}) };
  return next;
}

// Moves progress and every list position from one key to the other in a copy made by
// copyForRekey. Callers have already refused differing values and lists holding both keys.
export function rekey(next, from, to) {
  for (const key of PROGRESS) {
    if (!has(next[key], from)) continue;
    if (!has(next[key], to)) next[key][to] = next[key][from];
    delete next[key][from];
  }
  for (const [listId, list] of Object.entries(next.lists)) {
    if (!list?.itemIds?.includes(from)) continue;
    const collectedIn = { ...(list.collectedIn ?? {}) };
    if (has(collectedIn, from)) {
      collectedIn[to] = collectedIn[from];
      delete collectedIn[from];
    }
    next.lists[listId] = {
      ...list,
      itemIds: list.itemIds.map((id) => (id === from ? to : id)),
      collectedIn,
      deferredIssueIds: (list.deferredIssueIds ?? []).map((id) => (id === from ? to : id)),
    };
  }
}

export function joinable(state, from, to) {
  for (const key of PROGRESS) {
    if (has(state[key], from) && has(state[key], to) && !same(state[key][from], state[key][to])) return false;
  }
  for (const list of Object.values(state.lists ?? {})) {
    const ids = list?.itemIds ?? [];
    if (ids.includes(from) && ids.includes(to)) return false;
  }
  return true;
}
