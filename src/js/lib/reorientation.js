import { upNext } from './model.js';

export function earlierIssueIds(state, listId) {
  const list = state.lists[listId];
  if (!list) return [];
  const next = upNext(state, listId);
  return list.itemIds.slice(0, next ? list.itemIds.indexOf(next.issueId) : list.itemIds.length);
}
