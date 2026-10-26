import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CBH_SOURCE_PROVIDER } from './cbh-inventory.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const OWNER_EVENT_PROVIDER = Object.freeze({
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for Modern Timeline',
  requireSourceContentSha256: true, requireSourceProvider: true, allowMissingCover: true,
});

// #898. The owner's picks from Marvel's young readers guide are character and team runs rather
// than MCU companions, and they are credited the way the earlier owner best-of list is.
export const OWNER_YOUNG_READERS_PROVIDER = Object.freeze({
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by the project owner',
  requireSourceContentSha256: true, requireSourceProvider: true, allowMissingCover: true,
});

export const OWNER_SURFACES = Object.freeze(['modern-timeline', 'young-readers']);

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
    if (!guide || Object.keys(guide).some((key) => !['id', 'contract', 'surface', 'baselineRowCount', 'sourceProvider'].includes(key))
      || typeof guide.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.id)
      || (Object.hasOwn(guide, 'surface') && !OWNER_SURFACES.includes(guide.surface))
      || (Object.hasOwn(guide, 'baselineRowCount')
        && (!Number.isSafeInteger(guide.baselineRowCount) || guide.baselineRowCount < 1))
      || (Object.hasOwn(guide, 'sourceProvider')
        && (guide.sourceProvider !== CBH_SOURCE_PROVIDER.id
          || !Object.hasOwn(guide, 'baselineRowCount') || Object.hasOwn(guide, 'surface')))
      || ids.has(guide.id) || guide.contract !== `test/fixtures/owner-delivery/${guide.id}.json`) {
      throw new Error('Owner delivery registry contains an invalid or duplicate guide.');
    }
    ids.add(guide.id);
  }
  return registry;
}

export function ownerGuideProvider(registration, ownerProvider) {
  if (registration.sourceProvider === CBH_SOURCE_PROVIDER.id) return CBH_SOURCE_PROVIDER;
  if (registration.surface === 'modern-timeline') return OWNER_EVENT_PROVIDER;
  if (registration.surface === 'young-readers') return OWNER_YOUNG_READERS_PROVIDER;
  return registration.id === 'mcu-prep-thunderbolts'
    ? { ...ownerProvider, sourceOrigin: 'Compiled by hand for this project from the owner-authored outline in GitHub issue #682' }
    : ownerProvider;
}

const registrations = readOwnerGuideRegistry().guides;
export const registeredOwnerGuideIds = Object.freeze(registrations.map(({ id }) => id));
export const registeredOwnerAdditionIds = Object.freeze(
  registrations.filter((guide) => !Object.hasOwn(guide, 'baselineRowCount')).map(({ id }) => id),
);
