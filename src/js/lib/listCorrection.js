import { addIssuesToList, exportBackup, MAX_BACKUP_BYTES, MAX_ISSUES, validateBackup } from './model.js';
import { READING_ORDER_REVISIONS } from './readingOrderRevisions.js';

function checkedOrder(ids, label) {
  if (!Array.isArray(ids) || ids.length > MAX_ISSUES || (label === 'published' && !ids.length)) {
    throw new Error(`The ${label} order is not usable.`);
  }
  const found = new Set();
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id === 0 || found.has(id)) {
      throw new Error(`The ${label} order has an invalid or duplicate comic identity.`);
    }
    found.add(id);
  }
  return found;
}

export function earlierPublishedOrders(list) {
  if (!list) return [];
  try {
    checkedOrder(list.itemIds, 'saved');
  } catch {
    return [];
  }
  return READING_ORDER_REVISIONS.filter((record) => (!list.catalogId || record.catalogId === list.catalogId)
    && record.previousOrders.some((previous) => previous.length === list.itemIds.length
      && previous.every((id, index) => id === list.itemIds[index])));
}

export function matchesEarlierPublishedOrder(list) {
  return earlierPublishedOrders(list).length > 0;
}

export function publishedRevisionItems(entry, order) {
  if (!entry || !order || order.id !== entry.id || !Array.isArray(order.items)
    || order.count !== order.items.length) {
    throw new Error('The published order could not be verified.');
  }
  const ids = order.items.map((item) => item?.issueId);
  checkedOrder(ids, 'published');
  const record = READING_ORDER_REVISIONS.find(({ catalogId }) => catalogId === entry.id);
  if (record && (record.revisedOrder.length !== ids.length
    || record.revisedOrder.some((id, index) => id !== ids[index]))) {
    throw new Error('The current published order is not available in this app.');
  }
  return order.items;
}

export function compareListOrders(saved, revised) {
  const savedSet = checkedOrder(saved, 'saved');
  const revisedSet = checkedOrder(revised, 'published');
  const savedShared = saved.filter((id) => revisedSet.has(id));
  const revisedShared = revised.filter((id) => savedSet.has(id));
  return {
    added: revised.filter((id) => !savedSet.has(id)),
    retained: saved.filter((id) => !revisedSet.has(id)),
    reordered: savedShared.some((id, index) => id !== revisedShared[index]),
  };
}

export function revisedOrderKeepingExtras(saved, revised) {
  const { added } = compareListOrders(saved, revised);
  if (saved.length + added.length > MAX_ISSUES) {
    throw new Error('The updated order has too many comic identities.');
  }
  const revisedSet = new Set(revised);
  const before = new Map();
  const trailing = [];
  let next = null;
  for (let index = saved.length - 1; index >= 0; index -= 1) {
    const id = saved[index];
    if (revisedSet.has(id)) next = id;
    else if (next === null) trailing.push(id);
    else {
      if (!before.has(next)) before.set(next, []);
      before.get(next).push(id);
    }
  }
  const result = [];
  for (const id of revised) {
    const retained = before.get(id);
    if (retained) for (let index = retained.length - 1; index >= 0; index -= 1) result.push(retained[index]);
    result.push(id);
  }
  return result.concat(trailing.reverse());
}

export function applyListRevision(state, listId, expectedList, items) {
  const list = Object.hasOwn(state.lists, listId) ? state.lists[listId] : null;
  if (!list || typeof expectedList !== 'string' || JSON.stringify(list) !== expectedList) {
    throw new Error('The saved list changed. Review the update again.');
  }
  if (!Array.isArray(items) || items.some((item) => !item || typeof item !== 'object'
    || (item.title != null && (typeof item.title !== 'string' || !item.title.trim())))) {
    throw new Error('The published order has an invalid comic.');
  }
  const ids = items.map((item) => item.issueId);
  const order = revisedOrderKeepingExtras(list.itemIds, ids);
  if (order.length === list.itemIds.length && order.every((id, index) => id === list.itemIds[index])) return state;
  const added = addIssuesToList(state, listId, items.map((item) => ({ ...item, source: 'curated' })), {
    preserveExisting: true,
  });
  const deferred = new Set(list.deferredIssueIds ?? []);
  const lists = Object.assign(Object.create(null), added.state.lists);
  const merged = added.state.lists[listId];
  lists[listId] = {
    ...merged,
    itemIds: order,
    deferredIssueIds: order.filter((id) => deferred.has(id)),
  };
  const candidate = { ...added.state, lists };
  const backup = exportBackup(candidate);
  const checked = validateBackup(backup);
  if (!checked.ok) throw new Error(`The updated list cannot be backed up: ${checked.errors.join(' ')}`);
  const text = JSON.stringify(backup, null, 2);
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    throw new Error('The updated reading data exceeds the backup limit. Nothing was changed.');
  }
  return candidate;
}
