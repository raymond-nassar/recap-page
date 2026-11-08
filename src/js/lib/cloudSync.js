import { canonical } from './completeBackup.js';

const DIGEST = /^[a-f0-9]{64}$/;
const STREAM = /^[a-f0-9]{32}$/;

// Opening another list changes no reading progress, so it does not make a new personal snapshot.
export async function personalDigest(backup, cryptoProvider = globalThis.crypto) {
  const { reader, ...rest } = backup.components;
  const personal = { ...reader };
  delete personal.active;
  const hash = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ ...rest, reader: personal })));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

// The owner decided (#1176) that only reading progress decides whether another device's backup is
// offered: comics marked read, the lists in the library, ratings and finished lists. Identities and
// values count and times do not, so two devices that marked the same comics read at different
// moments agree. Settings, the sidebar's order of lists, list descriptions and notes, issue notes,
// availability overrides, saved comic details and the import draft are left out; loading another
// device's progress still brings every one of them over, because Load restores the whole backup.
// The prefix keeps this digest from ever equaling a personal digest, so a stored reference names one
// space or the other, and a later definition takes a new version rather than matching old values.
export const MATERIAL_DIGEST_VERSION = 'recap-material-v1';

function sortedKeys(map) {
  return Object.keys(map ?? {}).sort();
}

export function materialProgress(backup) {
  const { reader, history } = backup.components;
  const ratings = {};
  for (const id of sortedKeys(reader.ratings)) ratings[id] = reader.ratings[id];
  const lists = sortedKeys(reader.lists).map((key) => {
    const list = reader.lists[key];
    const itemIds = [...(list.itemIds ?? [])];
    const collectedIn = {};
    for (const id of sortedKeys(list.collectedIn)) {
      if (list.collectedIn[id] !== null && list.collectedIn[id] !== undefined) collectedIn[id] = list.collectedIn[id];
    }
    return {
      id: list.id ?? key, name: list.name ?? '', itemIds, collectedIn,
      deferredIssueIds: [...(list.deferredIssueIds ?? [])].sort((a, b) => a - b),
    };
  });
  const finished = (history?.records ?? [])
    .filter((entry) => entry.completedAt !== null || entry.rating !== null)
    .map((entry) => ({
      listId: entry.listId, created: entry.created, catalogId: entry.catalogId ?? null,
      finished: entry.completedAt !== null, rating: entry.rating ?? null,
    }))
    .sort((a, b) => {
      const left = canonical([a.listId, a.created, a.catalogId]);
      const right = canonical([b.listId, b.created, b.catalogId]);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return { read: sortedKeys(reader.read), ratings, lists, finished };
}

export async function materialDigest(backup, cryptoProvider = globalThis.crypto) {
  const text = `${MATERIAL_DIGEST_VERSION}\n${canonical(materialProgress(backup))}`;
  const hash = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

function optionalDigest(value) {
  return value === null || isDigest(value);
}

function validRemote(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && Number.isSafeInteger(value.generation) && value.generation > 0
    && isDigest(value.digest) && (value.material === undefined || isDigest(value.material))
    && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0;
}

function newestFirst(left, right) {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  return left.stream < right.stream ? -1 : left.stream > right.stream ? 1 : 0;
}

export function compareCloudBackups({
  ownStream = null, localDigest, localMaterial = null, matchedDigest = null, declinedDigest = null, keptDigest = null,
  declinedByStream = [], lastUploadedDigest = null, localEmpty, remotes,
} = {}) {
  if ((ownStream !== null && (typeof ownStream !== 'string' || !STREAM.test(ownStream)))
    || !isDigest(localDigest) || ![localMaterial, matchedDigest, declinedDigest, keptDigest, lastUploadedDigest].every(optionalDigest)
    || !Array.isArray(declinedByStream) || !declinedByStream.every((entry) => entry !== null && typeof entry === 'object'
      && !Array.isArray(entry) && Object.keys(entry).sort().join(',') === 'digest,stream'
      && typeof entry.stream === 'string' && STREAM.test(entry.stream) && isDigest(entry.digest))
    || new Set(declinedByStream.map((entry) => entry.stream)).size !== declinedByStream.length
    || typeof localEmpty !== 'boolean' || !Array.isArray(remotes) || !remotes.every(validRemote)) {
    throw new TypeError('Cloud comparison needs valid saved-state digests and backup identities.');
  }

  const latest = new Map();
  const identities = new Map();
  for (const backup of remotes) {
    if (backup.stream === ownStream) continue;
    const identity = `${backup.stream}:${backup.generation}`;
    if (identities.has(identity) && identities.get(identity) !== backup.digest) {
      throw new TypeError('Two different backups have the same device and generation.');
    }
    identities.set(identity, backup.digest);
    const previous = latest.get(backup.stream);
    if (!previous || backup.generation > previous.generation) latest.set(backup.stream, backup);
  }

  const current = [...latest.values()];
  // Progress is compared by material digest when both sides have one. A stored reference may hold
  // either kind: records written before #1176 hold personal digests, and the tagged material space
  // cannot collide with them, so a reference names a backup when it equals either of its digests.
  const material = (backup) => localMaterial !== null && backup.material !== undefined;
  const sameAsLocal = (backup) => material(backup) ? backup.material === localMaterial : backup.digest === localDigest;
  const names = (reference, backup) => reference !== null
    && (reference === backup.digest || (backup.material !== undefined && reference === backup.material));
  const localNamed = (reference) => reference !== null
    && (reference === localDigest || (localMaterial !== null && reference === localMaterial));
  const observedMatch = current.some(sameAsLocal);
  const isEcho = (backup) => names(lastUploadedDigest, backup) && !sameAsLocal(backup);
  const declines = new Map(declinedByStream.map((entry) => [entry.stream, entry.digest]));
  const isDeclined = (backup) => names(declinedDigest, backup) || names(declines.get(backup.stream) ?? null, backup);
  const hasEcho = current.some(isEcho);
  const hasKeptChoice = current.some((backup) =>
    isDeclined(backup) && !sameAsLocal(backup) && !isEcho(backup));
  const ignored = (backup) => sameAsLocal(backup) || names(matchedDigest, backup) || names(keptDigest, backup);
  // Time chooses which difference to show, not whether one side's content is ahead.
  const different = current.filter((backup) => !ignored(backup) && !isDeclined(backup) && !isEcho(backup)).sort(newestFirst);
  if (different.length) {
    const kind = matchedDigest === null
      ? (localEmpty ? 'remote-ahead' : 'first-match')
      : (localNamed(matchedDigest) ? 'remote-ahead' : 'both-changed');
    return { kind, offer: different[0], othersDiffering: different.length - 1, observedMatch };
  }

  if (hasKeptChoice) return { kind: 'kept-choice', offer: null, othersDiffering: 0, observedMatch };
  if (hasEcho) return { kind: 'local-ahead', offer: null, othersDiffering: 0, observedMatch };
  return { kind: observedMatch ? 'in-step' : 'no-offer', offer: null, othersDiffering: 0, observedMatch };
}
