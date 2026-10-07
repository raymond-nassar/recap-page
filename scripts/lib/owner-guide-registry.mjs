import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function readOwnerGuideRegistry(root = ROOT) {
  const unreadable = new Error('Owner delivery registry is unreadable or malformed; private input details are omitted.');
  let registry;
  try {
    registry = JSON.parse(readFileSync(path.join(root, 'scripts', 'data', 'owner-deliveries.json'), 'utf8'));
  } catch {
    throw unreadable;
  }
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.guides)
    || Object.keys(registry).some((key) => !['schemaVersion', 'guides'].includes(key))) {
    throw new Error('Owner delivery registry is invalid.');
  }
  const ids = new Set();
  for (const guide of registry.guides) {
    if (!guide || Object.keys(guide).some((key) => !['id', 'contract'].includes(key))
      || typeof guide.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.id)
      || ids.has(guide.id) || guide.contract !== `test/fixtures/owner-delivery/${guide.id}.json`) {
      throw new Error('Owner delivery registry contains an invalid or duplicate guide.');
    }
    ids.add(guide.id);
  }
  return registry;
}

export const registeredOwnerGuideIds = Object.freeze(readOwnerGuideRegistry().guides.map(({ id }) => id));
