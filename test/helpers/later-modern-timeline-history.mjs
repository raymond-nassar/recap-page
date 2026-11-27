import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const entries = new Map([
  ['empyre', '5df626638b354d28f33c91c20e08a2be2dcae2e66458dd6737e3c8d631ec228f'],
  ['blood-hunt', 'f126e3ea8a12dfcee368923ee8c636b27d032134949fdc4326740a836c615963'],
]);

export function beforeLaterModernTimelineManifest(manifest) {
  const removed = new Set();
  const lists = manifest.lists.filter((entry) => {
    if (!entries.has(entry.id)) return true;
    const digest = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    assert(!removed.has(entry.id) && digest === entries.get(entry.id),
      `${entry.id} differs from its published later-installment entry`);
    removed.add(entry.id);
    return false;
  });
  assert(removed.size === 0 || removed.size === entries.size, 'Incomplete later-installment manifest');
  return removed.size ? { ...manifest, lists } : manifest;
}
