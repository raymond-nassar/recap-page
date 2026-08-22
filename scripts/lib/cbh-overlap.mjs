export function issueIdsFromValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => issueIdsFromValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const knownContainers = ['items', 'issues', 'rows', 'issueIds'];
  for (const key of knownContainers) {
    if (Array.isArray(value[key])) {
      return issueIdsFromValue(value[key]);
    }
  }

  if (typeof value.issueId === 'number' || typeof value.issueId === 'string') {
    return [String(value.issueId)];
  }
  if (typeof value.id === 'number' || typeof value.id === 'string') {
    return [String(value.id)];
  }

  return Object.values(value).flatMap((entry) => issueIdsFromValue(entry));
}

export function compareIssueSets(candidateIds, existingIds) {
  const candidateList = Array.isArray(candidateIds) ? candidateIds.map(String) : [];
  const existingList = Array.isArray(existingIds) ? existingIds.map(String) : [];
  const candidateSet = new Set(candidateList);
  const existingSet = new Set(existingList);
  const sharedIds = candidateList.filter((id) => existingSet.has(id));

  if (sharedIds.length === 0) {
    return { relationship: 'none', sharedCount: 0, sharedIds: [] };
  }

  const candidateExact = candidateList.length === existingList.length && candidateList.every((id) => existingSet.has(id)) && existingList.every((id) => candidateSet.has(id));
  if (candidateExact) {
    return { relationship: 'exact', sharedCount: sharedIds.length, sharedIds };
  }

  const candidateSubset = candidateList.every((id) => existingSet.has(id)) && existingList.length > candidateList.length;
  if (candidateSubset) {
    return { relationship: 'candidate-subset', sharedCount: sharedIds.length, sharedIds };
  }

  const existingSubset = existingList.every((id) => candidateSet.has(id)) && candidateList.length > existingList.length;
  if (existingSubset) {
    return { relationship: 'existing-subset', sharedCount: sharedIds.length, sharedIds };
  }

  return { relationship: 'partial', sharedCount: sharedIds.length, sharedIds };
}

export function buildComparisonReport({ candidateIds, orders, peerOrders = [] }) {
  const normalizedCandidateIds = Array.isArray(candidateIds) ? candidateIds.map(String) : [];
  if (normalizedCandidateIds.length === 0) {
    throw new Error('Cannot build an overlap report without candidate issue ids');
  }
  if (new Set(normalizedCandidateIds).size !== normalizedCandidateIds.length) {
    throw new Error('Duplicate candidate issue ids cannot be compared');
  }

  const allOrders = [...orders, ...peerOrders];
  const seenOrderIds = new Set();
  const comparisons = allOrders.map((order) => {
    const orderId = String(order.orderId ?? order.id ?? '').trim();
    if (!orderId) {
      throw new Error('Compared order is missing an order id');
    }
    if (seenOrderIds.has(orderId)) {
      throw new Error(`Duplicate compared order id: ${orderId}`);
    }
    seenOrderIds.add(orderId);
    const existingIds = issueIdsFromValue(order.issueIds ?? order.items ?? order.issues ?? []);
    if (existingIds.length === 0) {
      throw new Error(`Order ${orderId} is missing shipped payload issue ids`);
    }
    if (new Set(existingIds).size !== existingIds.length) {
      throw new Error(`Duplicate comparison issue ids in order ${orderId}`);
    }
    const outcome = compareIssueSets(normalizedCandidateIds, existingIds);
    return {
      orderId,
      sharedCount: outcome.sharedCount,
      sharedIds: outcome.sharedIds,
      relationship: outcome.relationship,
    };
  }).sort((left, right) => left.orderId.localeCompare(right.orderId));

  return {
    candidateCount: normalizedCandidateIds.length,
    comparisonCount: comparisons.length,
    comparisons,
  };
}
