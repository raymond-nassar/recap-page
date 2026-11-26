// #1601: the one place saved comics move from an old identity to the one this release uses. It runs
// on a state that has already been read or verified, never inside migrate() or validateBackup():
// a signed complete backup is checked by re-deriving its reader data and comparing it byte for byte,
// so rewriting identities there would refuse every genuine backup made before this release.
//
// Two kinds of move, both all or nothing for each comic, under the owner's rule recorded on the
// Issue: carry over a verified one-to-one match with no conflicting saved data, and leave anything
// uncertain or conflicting exactly as it was saved. The reviewed same-edition group exception
// permits multiple old keys to name one target, but migrates only when at most one old key has state.
//   1. A published guide correction (src/data/identityCorrections.js) moves `from` to `to` only when
//      every list holding `from` is a copy of a guide carrying that same correction, so a number
//      another list uses for a different comic is never touched (#1594).
//   2. A viewer-only comic joins the one catalog number the bundled table names for it.
import { identityCorrections as bundledCorrections } from '../../data/identityCorrections.js';
import { normalizeIssue } from './model.js';
import { appViewerFor, catalogIdsForViewer } from './marvelComicsApp.js';
import { taggedViewer, viewerKey, viewerNumber } from './marvelComicsAppUrl.js';
import { copyForRekey, joinViewerRecords, joinable, rekey } from './viewerJoin.js';

const MAX_TITLE = 300;

// A table with any fault applies nothing: a partial table would move some comics of a guide and
// leave others, which is a state no guide revision describes.
export function validateIdentityCorrections(entries, { viewerFor = appViewerFor } = {}) {
  const errors = [];
  const byFrom = new Map();
  const toFrom = new Map();
  const groupTargets = new Map();
  const groupSources = new Map();
  const seen = new Set();
  if (!Array.isArray(entries)) return { ok: false, errors: ['The correction table is not a list.'], byFrom };
  entries.forEach((entry, index) => {
    const where = `Correction ${index + 1}`;
    if (!entry || typeof entry !== 'object') return errors.push(`${where} is not an object.`);
    const { catalogId, from, to, appViewer, title, legacyTitle, evidence, sameEditionGroup: rawGroup } = entry;
    const hasGroup = rawGroup !== undefined;
    const validGroup = typeof rawGroup === 'string'
      && rawGroup.length <= 80
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawGroup);
    if (hasGroup && !validGroup) errors.push(`${where} has an invalid sameEditionGroup.`);
    const sameEditionGroup = validGroup ? rawGroup : null;
    if (typeof catalogId !== 'string' || !catalogId) errors.push(`${where} has no catalogId.`);
    if (!Number.isSafeInteger(from) || from === 0) errors.push(`${where} has an invalid from.`);
    if (!Number.isSafeInteger(to) || to === 0) errors.push(`${where} has an invalid to.`);
    if (from === to) errors.push(`${where} does not change the identity.`);
    if (typeof title !== 'string' || !title || title.length > MAX_TITLE) errors.push(`${where} has no usable title.`);
    if (typeof legacyTitle !== 'string' || !legacyTitle.trim() || legacyTitle.length > MAX_TITLE) {
      errors.push(`${where} has no usable legacy title.`);
    }
    if (evidence === undefined || evidence === null || evidence === '') errors.push(`${where} has no evidence.`);
    if (to < 0) {
      if (viewerNumber(appViewer) === null || viewerKey(appViewer) !== to) errors.push(`${where} has a viewer key that does not match its appViewer.`);
    } else if (appViewer !== undefined && viewerFor(to) !== viewerNumber(appViewer)) {
      errors.push(`${where} names an appViewer the bundled table does not give its catalog number.`);
    }
    const pair = `${catalogId}|${from}`;
    if (seen.has(pair)) errors.push(`${where} repeats ${from} in ${catalogId}.`);
    seen.add(pair);
    const settled = byFrom.get(from);
    if (settled && (settled.to !== to || settled.sameEditionGroup !== sameEditionGroup)) {
      errors.push(`${where} moves ${from} somewhere other guides do not.`);
    }
    let target = toFrom.get(to);
    if (!target) {
      target = { froms: new Set(), groups: new Set() };
      toFrom.set(to, target);
    }
    target.froms.add(from);
    target.groups.add(sameEditionGroup ?? '');
    if (sameEditionGroup) {
      const groupedTarget = groupTargets.get(sameEditionGroup);
      if (groupedTarget !== undefined && groupedTarget !== to) {
        errors.push(`${where} points sameEditionGroup ${sameEditionGroup} at different destinations.`);
      }
      groupTargets.set(sameEditionGroup, to);
      if (!groupSources.has(sameEditionGroup)) groupSources.set(sameEditionGroup, new Set());
      groupSources.get(sameEditionGroup).add(from);
    }
    if (!settled) byFrom.set(from, {
      from, to, appViewer: to < 0 ? viewerNumber(appViewer) : null,
      targetViewer: to < 0 ? viewerNumber(appViewer) : viewerNumber(appViewer ?? viewerFor(to)),
      title,
      catalogs: new Set(), legacyTitles: new Set(), sameEditionGroup,
    });
    byFrom.get(from).catalogs.add(catalogId);
    byFrom.get(from).legacyTitles.add(legacyTitle);
  });
  for (const [to, target] of toFrom) {
    if (target.froms.size > 1 && (target.groups.size !== 1 || target.groups.has(''))) {
      errors.push(`Multiple old keys move onto ${to} without one sameEditionGroup.`);
    }
  }
  for (const [group, sources] of groupSources) {
    if (sources.size < 2) errors.push(`sameEditionGroup ${group} does not contain multiple old keys.`);
  }
  // A number that is both moved and moved onto would make the result depend on the order of moves.
  for (const from of byFrom.keys()) if (toFrom.has(from)) errors.push(`${from} is both moved and a destination.`);
  return errors.length ? { ok: false, errors, byFrom: new Map() } : { ok: true, errors, byFrom };
}

const holdersOf = (state, id) => Object.values(state.lists ?? {}).filter((list) => list?.itemIds?.includes(id));
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

function hasSavedIdentity(state, id) {
  if (['issues', 'read', 'notes', 'ratings', 'overrides'].some((section) => owns(state[section], id))) return true;
  return Object.values(state.lists ?? {}).some((list) => (
    list?.itemIds?.includes(id)
    || list?.deferredIssueIds?.includes(id)
    || owns(list?.collectedIn, id)
  ));
}

function blockedSameEditionGroups(state, byFrom) {
  const members = new Map();
  for (const correction of byFrom.values()) {
    if (!correction.sameEditionGroup) continue;
    if (!members.has(correction.sameEditionGroup)) members.set(correction.sameEditionGroup, new Set());
    members.get(correction.sameEditionGroup).add(correction.from);
  }
  const blocked = new Set();
  for (const [group, ids] of members) {
    if ([...ids].filter((id) => hasSavedIdentity(state, id)).length > 1) blocked.add(group);
  }
  return blocked;
}

export function applyIdentityCorrections(state, entries = bundledCorrections, { viewerFor = appViewerFor } = {}) {
  if (!state?.issues || !state?.lists) return state;
  const table = validateIdentityCorrections(entries, { viewerFor });
  if (!table.ok || !table.byFrom.size) return state;
  const blockedGroups = blockedSameEditionGroups(state, table.byFrom);
  let next = null;
  for (const correction of table.byFrom.values()) {
    if (correction.sameEditionGroup && blockedGroups.has(correction.sameEditionGroup)) continue;
    const current = next ?? state;
    if (!eligible(current, correction)) continue;
    next ??= copyForRekey(state);
    const { from, to, appViewer, title } = correction;
    if (!next.issues[to]) {
      // A viewer-only comic has nothing to look up, so it is marked as a guide record that arrived
      // without details rather than one still waiting for them.
      next.issues[to] = normalizeIssue({ issueId: to, title, ...(appViewer ? { appViewer } : {}), ...(to < 0 ? { source: 'curated' } : {}) });
    }
    // The old record stays as it was saved. It is not shown once no list holds it, and keeping it
    // means nothing a previous build wrote is lost.
    rekey(next, from, to);
  }
  return next ?? state;
}

function eligible(state, { from, to, appViewer, catalogs }) {
  const destination = state.issues[to];
  if (to < 0 && destination && taggedViewer(destination) !== appViewer) return false;
  const holders = holdersOf(state, from);
  if (!holders.length) return false;
  if (!holders.every((list) => catalogs.has(list.catalogId))) return false;
  return joinable(state, from, to);
}

export function reconcileIdentities(state, { corrections = bundledCorrections, catalogIdsFor = catalogIdsForViewer, viewerFor = appViewerFor } = {}) {
  if (!state?.issues) return state;
  const table = validateIdentityCorrections(corrections, { viewerFor });
  if (!table.ok) return joinViewerRecords(state, { catalogIdsFor, viewerFor });
  const blockedGroups = blockedSameEditionGroups(state, table.byFrom);
  const blockedTargets = new Set([...table.byFrom.values()]
    .filter(({ sameEditionGroup }) => sameEditionGroup && blockedGroups.has(sameEditionGroup))
    .map(({ to }) => to));
  const allowedCatalogIdsFor = blockedTargets.size
    ? (viewer) => catalogIdsFor(viewer).filter((id) => !blockedTargets.has(id))
    : catalogIdsFor;
  const corrected = applyIdentityCorrections(state, corrections, { viewerFor });
  return joinViewerRecords(corrected, { catalogIdsFor: allowedCatalogIdsFor, viewerFor });
}

// Every pair of saved records that are known to be the same comic and are both held by a list, so
// both would show a usable checkmark. Each pair is the reason reconciliation refused to merge them.
export function identityConflicts(state, { corrections = bundledCorrections, catalogIdsFor = catalogIdsForViewer, viewerFor = appViewerFor } = {}) {
  const found = new Set();
  if (!state?.issues || !state?.lists) return found;
  const held = new Set(Object.values(state.lists).flatMap((list) => list?.itemIds ?? []));
  const table = validateIdentityCorrections(corrections, { viewerFor });
  if (table.ok) {
    const blockedGroups = blockedSameEditionGroups(state, table.byFrom);
    for (const { from, to, catalogs, legacyTitles, sameEditionGroup, targetViewer } of table.byFrom.values()) {
      const source = state.issues[from];
      const matchingLegacyTitle = typeof source?.title === 'string' && legacyTitles.has(source.title);
      const sourceHolders = holdersOf(state, from);
      const sourceMatches = sourceHolders.some((list) => catalogs.has(list.catalogId)) || matchingLegacyTitle;
      if (held.has(from) && held.has(to) && sourceMatches) {
        found.add(`${from}|${to}`);
      }
      if (sameEditionGroup && blockedGroups.has(sameEditionGroup) && targetViewer) {
        const viewerId = viewerKey(targetViewer);
        if (held.has(from) && sourceMatches && held.has(viewerId) && taggedViewer(state.issues[viewerId]) === targetViewer) {
          found.add(`${from}|${viewerId}`);
        }
      }
    }
  }
  for (const record of Object.values(state.issues)) {
    const viewer = taggedViewer(record);
    if (!viewer || !held.has(record.issueId)) continue;
    const ids = catalogIdsFor(viewer);
    if (ids.length === 1 && held.has(ids[0]) && viewerFor(ids[0]) === viewer) found.add(`${record.issueId}|${ids[0]}`);
  }
  return found;
}

// Whether `after` holds a pair of usable checkmarks for one comic that `before` did not. A change
// that would create one is refused whole, so nothing is written.
export function addsIdentityConflict(before, after, options) {
  const prior = identityConflicts(before, options);
  for (const pair of identityConflicts(after, options)) if (!prior.has(pair)) return true;
  return false;
}

// The curated importer uses this before its first write, so a conflict cannot leave a list shell
// behind. Tests exercise the same preflight with saved data held only in memory.
export function guardIdentityImport(before, candidate, options) {
  const next = reconcileIdentities(candidate, options);
  return addsIdentityConflict(before, next, options)
    ? { state: before, conflict: true }
    : { state: next, conflict: false };
}
