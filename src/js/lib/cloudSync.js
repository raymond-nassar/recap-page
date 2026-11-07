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
    && isDigest(value.digest) && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0;
}

function newestFirst(left, right) {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  return left.stream < right.stream ? -1 : left.stream > right.stream ? 1 : 0;
}

export function compareCloudBackups({
  ownStream = null, localDigest, matchedDigest = null, declinedDigest = null, keptDigest = null,
  declinedByStream = [], lastUploadedDigest = null, localEmpty, remotes,
} = {}) {
  if ((ownStream !== null && (typeof ownStream !== 'string' || !STREAM.test(ownStream)))
    || !isDigest(localDigest) || ![matchedDigest, declinedDigest, keptDigest, lastUploadedDigest].every(optionalDigest)
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
  const observedMatch = current.some((backup) => backup.digest === localDigest);
  const isEcho = (backup) => lastUploadedDigest !== null
    && backup.digest === lastUploadedDigest && backup.digest !== localDigest;
  const declines = new Map(declinedByStream.map((entry) => [entry.stream, entry.digest]));
  const isDeclined = (backup) => backup.digest === declinedDigest || declines.get(backup.stream) === backup.digest;
  const hasEcho = current.some(isEcho);
  const hasKeptChoice = current.some((backup) =>
    isDeclined(backup) && backup.digest !== localDigest && !isEcho(backup));
  const ignored = new Set([localDigest, matchedDigest, keptDigest]);
  // Time chooses which difference to show, not whether one side's content is ahead.
  const different = current.filter((backup) => !ignored.has(backup.digest) && !isDeclined(backup) && !isEcho(backup)).sort(newestFirst);
  if (different.length) {
    const kind = matchedDigest === null
      ? (localEmpty ? 'remote-ahead' : 'first-match')
      : (localDigest === matchedDigest ? 'remote-ahead' : 'both-changed');
    return { kind, offer: different[0], othersDiffering: different.length - 1, observedMatch };
  }

  if (hasKeptChoice) return { kind: 'kept-choice', offer: null, othersDiffering: 0, observedMatch };
  if (hasEcho) return { kind: 'local-ahead', offer: null, othersDiffering: 0, observedMatch };
  return { kind: observedMatch ? 'in-step' : 'no-offer', offer: null, othersDiffering: 0, observedMatch };
}
