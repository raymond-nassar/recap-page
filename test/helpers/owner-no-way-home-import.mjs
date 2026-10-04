import {
  addIssuesToList,
  createEmptyState,
  createList,
  exportBackup,
  markRead,
  setActive,
  setDeferred,
  setIssueNote,
  setListNote,
  setOverride,
} from '../../src/js/lib/model.js';

export function importedNoWayHomeFixture({ owner, legacy }) {
  let state = createEmptyState();
  for (const [id, payload] of [['original-import', legacy], ['retired-import', owner]]) {
    state = createList(state, { id, name: payload.name, description: payload.description, catalogId: payload.id });
    state = addIssuesToList(state, id, payload.items.map((issue) => ({ ...issue, source: 'curated' }))).state;
    state = setListNote(state, id, `Keep my ${id} list note`);
  }
  state = createList(state, { id: 'unrelated-import', name: 'Unrelated saved list' });
  state = addIssuesToList(state, 'unrelated-import', [legacy.items[0]]).state;
  state = setListNote(state, 'unrelated-import', 'Keep this unrelated list');
  state = markRead(state, legacy.items[0].issueId, true, 1700000000000);
  state = markRead(state, owner.items[0].issueId, true, 1700000000001);
  state = setIssueNote(state, owner.items[0].issueId, 'Keep my retired-guide issue note');
  state = setOverride(state, owner.items[1].issueId, 'available');
  state = setOverride(state, owner.items[2].issueId, 'unavailable');
  state = setDeferred(state, 'retired-import', owner.items[3].issueId, true);
  state = setActive(state, 'retired-import');
  for (const [index, id] of state.listOrder.entries()) state.lists[id].created = 1700000000000 + index;
  const backup = { ...exportBackup(state), exportedAt: '2026-10-03T00:00:00.000Z' };
  const raw = JSON.stringify(state);
  const keys = {
    'mrt.state.v2': raw,
    'mrt.state.prerestore': JSON.stringify(backup),
    'mrt.state.restore.tmp': 'Keep the exact temporary restore bytes',
    'mrt.state.salvage': 'Keep the exact earlier salvage bytes',
    'mrt.state.salvage.1700000000000': 'Keep this distinct older salvage copy',
  };
  return { state, raw, backup, keys };
}
