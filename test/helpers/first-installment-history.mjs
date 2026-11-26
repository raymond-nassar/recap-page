import { createHash } from 'node:crypto';

const parentId = 'civil-war-to-secret-invasion';
const sourceCounts = new Map([
  [parentId, 903],
  ['world-war-hulk', 39],
  ['secret-wars-2015-event-tie-ins', 226],
]);
const orderIds = new Set([
  ...sourceCounts.keys(),
  ...Array.from({ length: 14 }, (_, i) => `${parentId}-part-${i + 1}`),
]);

// Older approvals predate both the three source entries and the field that binds the fourteen
// visible parts. Removing the entries alone leaves the later section plan in the historical hash.
export function beforeFirstInstallmentManifest(manifest) {
  const removed = new Set();
  const lists = manifest.lists.filter((entry) => {
    if (!sourceCounts.has(entry.id)) return true;
    if (removed.has(entry.id) || entry.expect !== sourceCounts.get(entry.id)
      || entry.out !== `${entry.id.replaceAll('-', '_')}.json`) {
      throw new Error(`${entry.id}: the current source no longer matches the first installment`);
    }
    removed.add(entry.id);
    return false;
  });
  const sections = manifest.sectionalGuides;
  if (!sections?.some((section) => section.id === parentId)) {
    return lists.length === manifest.lists.length ? manifest : { ...manifest, lists };
  }
  const retained = sections.filter((section) => {
    if (section.id !== parentId) return true;
    if (createHash('sha256').update(JSON.stringify(section)).digest('hex')
      !== '24f4eccf80f3123a5cc9fb5e3f7dbf51c0fcb0cd23e9bbe14100bf5d102a4d93') {
      throw new Error('The bridge section plan differs from the captured first installment');
    }
    return false;
  });
  if (retained.length !== sections.length - 1) throw new Error('Duplicate first installment section plan');
  const prior = { ...manifest, lists };
  if (retained.length) prior.sectionalGuides = retained;
  else delete prior.sectionalGuides;
  return prior;
}

export function beforeFirstInstallmentOrders(orders) {
  return orders.filter((entry) => !orderIds.has(entry.id ?? entry.orderId));
}
