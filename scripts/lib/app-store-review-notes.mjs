import { approvedText } from '../check-store-release.mjs';
import { StoreTextError } from './store-text.mjs';

// Apple's appStoreReviewDetails notes are documented as at most 4,000 bytes, so the limit is
// counted in UTF-8 bytes rather than characters, and text over it stops rather than being cut.
export const REVIEW_NOTES_LIMIT_BYTES = 4000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const reviewNotesBytes = (text) => Buffer.byteLength(text, 'utf8');

export function reviewNotesPath(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new StoreTextError('App Review notes: version must be x.y.z');
  }
  return `docs/releases/${version}-app-store-review-notes.json`;
}

export function validReviewNotes(notes) {
  // Every UTF-16 unit is at least one UTF-8 byte, so the character check cannot pass longer text.
  approvedText(notes, REVIEW_NOTES_LIMIT_BYTES, 'App Review notes');
  if (reviewNotesBytes(notes) > REVIEW_NOTES_LIMIT_BYTES) {
    throw new Error(`App Review notes must be at most ${REVIEW_NOTES_LIMIT_BYTES} UTF-8 bytes`);
  }
  return notes;
}

export function approvedReviewNotes(bytes, version) {
  const path = reviewNotesPath(version);
  let value;
  try {
    value = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
  } catch {
    throw new StoreTextError(`App Review notes: ${path} is not valid JSON`);
  }
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'notes,version') {
      throw new Error('exactly notes and version are required');
    }
    if (value.version !== version) throw new Error('version must match the release');
    validReviewNotes(value.notes);
  } catch (error) {
    throw new StoreTextError(`App Review notes: ${path}: ${error.message}`);
  }
  return { notes: value.notes, version, path, bytes: reviewNotesBytes(value.notes) };
}

// Only a missing tree entry means "no change"; a git failure is thrown by the caller's git.
export function approvedReviewNotesAt({ revision, version, git }) {
  const path = reviewNotesPath(version);
  const found = git('ls-tree', '--name-only', revision, '--', path);
  if (found === '') return null;
  if (found !== path) throw new StoreTextError(`App Review notes: unexpected tree entry for ${path}`);
  return approvedReviewNotes(git('show', `${revision}:${path}`), version);
}
