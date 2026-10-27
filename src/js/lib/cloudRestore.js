import { KEY, IMPORT_DRAFT_KEY, READER_RESTORE_PREPARATION_KEYS } from '../storage.js';
import { LIST_HISTORY_KEY } from './listHistory.js';
import { MAX_BACKUP_BYTES } from './model.js';
import { validateImportDraft } from './importDraft.js';
import { CLOUD_SETTINGS_KEYS, CLOUD_DRAFT_FIELDS, validateCloudComponents } from './cloudSnapshot.js';

const KEYS = [...new Set([
  ...Object.values(READER_RESTORE_PREPARATION_KEYS), LIST_HISTORY_KEY,
  ...Object.values(CLOUD_SETTINGS_KEYS), IMPORT_DRAFT_KEY,
])];
const HEX = /^[a-f0-9]{64}$/;

class PreparedRestoreError extends Error {}
function refuse(message) { throw new PreparedRestoreError(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, names) {
  return object(value) && Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key));
}
function bounded(value) {
  if (value !== null && (typeof value !== 'string' || value.length > MAX_BACKUP_BYTES
    || new TextEncoder().encode(value).length > MAX_BACKUP_BYTES)) refuse('Prepared restore values exceed their supported bounds.');
  return value;
}
function token(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function sameImage(a, b) { return KEYS.every((key) => a[key] === b[key]); }

export function preparedCloudRestoreImages(prepared) {
  if (!fields(prepared, ['format', 'version', 'captureId', 'contentDigest', 'before', 'owners'])
    || prepared.format !== 'recap-page-cloud-restore-prepared' || prepared.version !== 1
    || typeof prepared.captureId !== 'string' || !HEX.test(prepared.captureId)
    || typeof prepared.contentDigest !== 'string' || !HEX.test(prepared.contentDigest)
    || !fields(prepared.before, KEYS) || !Array.isArray(prepared.owners) || prepared.owners.length !== 4) {
    refuse('The prepared restore record is incomplete or unsupported.');
  }
  const before = Object.fromEntries(KEYS.map((key) => [key, bounded(prepared.before[key])]));
  const [reader, history, settings, draft] = prepared.owners;
  for (const [owner, name, names] of [
    [reader, 'reader', ['owner', 'version', 'before', 'value', 'effects']],
    [history, 'history', ['owner', 'version', 'before', 'value', 'effects']],
    [settings, 'settings', ['owner', 'version', 'effects']],
    [draft, 'draft', ['owner', 'version', 'before', 'value', 'retainedSources', 'effects']],
  ]) {
    if (!fields(owner, names) || owner.owner !== name || owner.version !== 1 || !Array.isArray(owner.effects)) {
      refuse('A prepared restore owner is invalid.');
    }
  }
  if (!fields(reader.before, Object.keys(READER_RESTORE_PREPARATION_KEYS))
    || Object.entries(READER_RESTORE_PREPARATION_KEYS).some(([field, key]) => reader.before[field] !== before[key])
    || history.before !== before[LIST_HISTORY_KEY] || draft.before !== before[IMPORT_DRAFT_KEY]
    || settings.effects.length !== 2 || !Array.isArray(draft.retainedSources)
    || draft.retainedSources.some((raw) => typeof raw !== 'string')) refuse('Prepared prior values do not match their owners.');
  bounded(JSON.stringify(draft.retainedSources));
  const readerValue = JSON.parse(bounded(reader.value));
  const historyValue = JSON.parse(bounded(history.value));
  if (!token(readerValue?.writeToken) || typeof readerValue.exportedAt !== 'string'
    || !Number.isFinite(Date.parse(readerValue.exportedAt))
    || new Date(readerValue.exportedAt).toISOString() !== readerValue.exportedAt
    || !token(historyValue?.writeToken)) refuse('Prepared restore write identities are invalid.');
  delete readerValue.writeToken;
  delete readerValue.exportedAt;
  delete historyValue.writeToken;
  const settingsRaw = settings.effects[0]?.value;
  const sidebar = settings.effects[1]?.value;
  if (![null, 'true', 'false'].includes(sidebar)) refuse('The prepared sidebar value is invalid.');
  let portableDraft = null;
  if (draft.value !== null) {
    const held = validateImportDraft(bounded(draft.value));
    if (!held.paused || held.pending !== null || held.readerToken !== null || held.expected !== null
      || (draft.before !== null && !held.previousSources.includes(draft.before))
      || draft.retainedSources.some((raw) => !held.previousSources.includes(raw))) {
      refuse('Prepared draft restoration must remain paused and retain displaced source.');
    }
    portableDraft = Object.fromEntries(CLOUD_DRAFT_FIELDS.map((key) => [key, held[key]]));
  }
  validateCloudComponents({
    reader: readerValue, history: historyValue, draft: portableDraft,
    settings: { ...JSON.parse(bounded(settingsRaw)), sidebarCollapsed: sidebar === null ? null : sidebar === 'true' },
  });
  const expected = [
    [
      { key: READER_RESTORE_PREPARATION_KEYS.temporary, before: before[READER_RESTORE_PREPARATION_KEYS.temporary], value: reader.value },
      { key: READER_RESTORE_PREPARATION_KEYS.snapshot, before: before[READER_RESTORE_PREPARATION_KEYS.snapshot], value: before[KEY] ?? '' },
      { key: KEY, before: before[KEY], value: reader.value },
      { key: READER_RESTORE_PREPARATION_KEYS.temporary, before: reader.value, value: null },
    ],
    [{ key: LIST_HISTORY_KEY, before: before[LIST_HISTORY_KEY], value: history.value }],
    [
      { key: CLOUD_SETTINGS_KEYS.settings, before: before[CLOUD_SETTINGS_KEYS.settings], value: settingsRaw },
      { key: CLOUD_SETTINGS_KEYS.sidebar, before: before[CLOUD_SETTINGS_KEYS.sidebar], value: sidebar },
    ],
    [{ key: IMPORT_DRAFT_KEY, before: before[IMPORT_DRAFT_KEY], value: draft.value }],
  ];
  prepared.owners.forEach((owner, index) => {
    if (owner.effects.length !== expected[index].length || owner.effects.some((effect, offset) =>
      !fields(effect, ['key', 'before', 'value'])
      || Object.keys(effect).some((field) => effect[field] !== expected[index][offset][field]))) {
      refuse('A prepared restore effect is not an exact supported owner operation.');
    }
  });
  const effects = expected.flat().map((effect) => ({ ...effect }));
  const states = [before];
  for (const effect of effects) {
    bounded(effect.value);
    if (states.at(-1)[effect.key] !== effect.before) refuse('Prepared restore effects are out of order.');
    states.push({ ...states.at(-1), [effect.key]: effect.value });
  }
  return { states, effects };
}

// The controller must verify its durable journal and hold the exclusive lease before calling.
export function applyPreparedCloudRestore(prepared, step, {
  storage, isExclusive, isJournalReady, direction = 'forward',
} = {}) {
  let attempted = false;
  try {
    if (typeof storage?.getItem !== 'function' || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function' || typeof isExclusive !== 'function'
      || typeof isJournalReady !== 'function' || !['forward', 'prior'].includes(direction)) {
      refuse('Prepared restore needs storage, an exclusive session and verified journal.');
    }
    function guard() {
      if (isExclusive() !== true) refuse('The exclusive restore session is unavailable. Recovery remains paused.');
      if (isJournalReady({ prepared, step, direction }) !== true) {
        refuse('The exact prepared restore journal has not been verified. No replacement was made.');
      }
    }
    guard();
    const { states, effects } = preparedCloudRestoreImages(prepared);
    if (!Number.isInteger(step) || step < 0 || step >= effects.length) refuse('The prepared restore step is invalid.');
    const read = () => Object.fromEntries(KEYS.map((key) => [key, storage.getItem(key)]));
    const source = states[direction === 'forward' ? step : step + 1];
    const target = states[direction === 'forward' ? step + 1 : step];
    guard();
    const actual = read();
    if (sameImage(actual, target)) return { ok: true, changed: false, alreadyApplied: true, step, direction };
    if (!sameImage(actual, source)) refuse('Local values changed outside this prepared step. Preserve recovery before continuing.');
    const effect = effects[step];
    const value = direction === 'forward' ? effect.value : effect.before;
    attempted = true;
    let writeFailed = false;
    try {
      if (value === null) storage.removeItem(effect.key);
      else storage.setItem(effect.key, value);
    } catch { writeFailed = true; }
    const durable = read();
    if (sameImage(durable, target)) {
      return { ok: true, changed: true, alreadyApplied: false, step, direction,
        warning: writeFailed ? 'The browser reported a write error, but the exact prepared value was verified.' : null };
    }
    if (sameImage(durable, source)) {
      return { ok: false, changed: false, step, direction,
        error: 'The prepared replacement was not saved. Prior values are unchanged; recovery remains available.' };
    }
    return { ok: false, changed: null, step, direction,
      error: 'Saved values do not match this prepared step. Recovery remains paused; no rollback was attempted.' };
  } catch (error) {
    return {
      ok: false, changed: attempted ? null : false, step, direction,
      error: attempted ? 'The prepared write could not be verified. Preserve recovery before continuing.'
        : error instanceof PreparedRestoreError ? error.message
          : 'The prepared record or prior local values could not be verified. No replacement was made.',
    };
  }
}
