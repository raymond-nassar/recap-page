// The complete backup file: every kind of saved data in one file, and the exact bytes a restore of it
// writes.
//
// The three single-kind backups each hold one kind of data, and moving between devices meant exporting
// and restoring three files by hand, with settings left behind (#810). This file holds all of it: the
// reading data, completion history, five portable settings, the sidebar preference and the import draft
// or an explicit null, behind one digest. It is provider-neutral, so a later cloud backup can carry the
// same components inside an envelope of its own.
//
// The metadata service address is deliberately not one of the settings. No backup carried settings
// before this, and a file that did would let anyone who hands a reader a backup re-point every metadata
// request to a host of their choosing after one generic question. A restore leaves it exactly as saved.
//
// Nothing here writes. Capture reads storage, preparation computes the exact bytes each owner would
// write, and the restore engine in completeRestore.js journals those bytes before it writes any of them.

import {
  KEY, IMPORT_DRAFT_KEY, SETTINGS_KEY, SIDEBAR_KEY, READER_RESTORE_KEYS,
  prepareReaderRestore, prepareImportDraftRestore,
} from '../storage.js';
import {
  createEmptyState, exportBackup, validateBackup, normalizeIssue, SCHEMA_VERSION, MAX_BACKUP_BYTES,
} from './model.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT, parseListHistory, prepareListHistoryRestore } from './listHistory.js';
import { DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences, validateImportDraft } from './importDraft.js';
import { DEFAULT_FILTER, readingFilter } from './readingFilters.js';
import { THEMES, normaliseTheme } from './theme.js';

export const COMPLETE_BACKUP_FORMAT = 'recap-page-complete-backup';
export const COMPLETE_BACKUP_VERSION = 1;
export const COMPLETE_BACKUP_FILENAME = 'recap-page-complete-backup.json';
// The ceiling of the complete file alone. Each component inside it is still held to the 8 MiB limit
// its own single-kind backup has, so this is a guard on what is read before parsing, not a raised limit.
export const MAX_COMPLETE_BACKUP_BYTES = 32 * 1024 * 1024;
export const PORTABLE_SETTINGS = Object.freeze(['covers', 'theme', 'filter', 'readingShortcut', 'hideDescriptions']);
export const PORTABLE_DRAFT_FIELDS = Object.freeze(['format', 'version', 'rawText', 'occurrences', 'destination', 'previousSources']);
export const PREPARED_FORMAT = 'recap-page-complete-restore-prepared';
const SETTINGS_FIELDS = [...PORTABLE_SETTINGS, 'sidebarCollapsed'];
const COMPONENTS = ['reader', 'history', 'settings', 'draft'];
const FILE_FIELDS = ['components', 'digest', 'format', 'version'];
const CAPTURE_KEYS = [KEY, LIST_HISTORY_KEY, SETTINGS_KEY, SIDEBAR_KEY, IMPORT_DRAFT_KEY];
const HEX = /^[a-f0-9]{64}$/;

// Each component's keys, in the order its writes are made. The reader's stage and saved-copy keys are
// part of it because its four writes touch them.
export const COMPONENT_KEYS = Object.freeze({
  reader: Object.freeze([READER_RESTORE_KEYS.temporary, READER_RESTORE_KEYS.snapshot, READER_RESTORE_KEYS.main]),
  history: Object.freeze([LIST_HISTORY_KEY]),
  settings: Object.freeze([SETTINGS_KEY, SIDEBAR_KEY]),
  draft: Object.freeze([IMPORT_DRAFT_KEY]),
});
export const RESTORE_KEYS = Object.freeze(COMPONENTS.flatMap((name) => COMPONENT_KEYS[name]));

export class CompleteBackupError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'CompleteBackupError';
    this.code = code;
  }
}

function refuse(message, code) { throw new CompleteBackupError(message, code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactFields(value, fields) {
  return object(value) && Object.keys(value).length === fields.length
    && fields.every((key) => Object.hasOwn(value, key));
}

// Sorted keys at every depth, so equal content has equal bytes whatever order an owner wrote it in.
export function canonical(value, depth = 0) {
  if (depth > 64) refuse('The backup is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (!object(value)) refuse('The backup holds a value this app does not write.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}

function utf8Length(text) { return new TextEncoder().encode(text).length; }

function bounded(text, label, limit = MAX_BACKUP_BYTES) {
  if (typeof text !== 'string' || text.length > limit || utf8Length(text) > limit) {
    refuse(`${label} is larger than its ${limit / (1024 * 1024)} MiB limit. Nothing was changed.`, 'oversize');
  }
  return text;
}

function parseJson(text, label, limit) {
  bounded(text, label, limit);
  try { return JSON.parse(text); }
  catch { refuse(`${label} is not readable JSON. Nothing was changed.`); }
}

function readerContent(state) {
  const value = exportBackup(state);
  delete value.exportedAt;
  return value;
}

function portableReader(input) {
  if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) {
    refuse('The reading data in this file is not in the format this version saves.');
  }
  const checked = validateBackup(input);
  if (!checked.ok) refuse(`The reading data in this file cannot be restored: ${checked.errors.join(' ')}`);
  const result = readerContent(checked.state);
  if (canonical(input) !== canonical(result)) refuse('The reading data in this file was changed or is incomplete.');
  bounded(canonical(result), 'The reading data');
  return result;
}

function portableHistory(input) {
  if (!exactFields(input, ['format', 'version', 'records'])) refuse('The completion history in this file has unsupported fields.');
  const records = parseListHistory(bounded(JSON.stringify(input), 'The completion history'));
  const result = { format: LIST_HISTORY_FORMAT, version: 1, records: [...records.values()] };
  if (canonical(input) !== canonical(result)) refuse('The completion history in this file has unsupported fields or identities.');
  return result;
}

function portableSettings(input) {
  if (!exactFields(input, SETTINGS_FIELDS) || !THEMES.includes(input.theme) || !readingFilter(input.filter)
    || ['covers', 'readingShortcut', 'hideDescriptions'].some((key) => typeof input[key] !== 'boolean')
    || ![null, true, false].includes(input.sidebarCollapsed)) {
    refuse('The settings in this file are not ones this version understands.');
  }
  return { ...input };
}

// The draft travels without its lifecycle: its revision, its reader token and any half-finished
// publication belong to the device it was saved on. It is restored paused, for review before anything
// in it is applied.
function lifecycle(draft) {
  return {
    ...draft, expected: null, readerToken: null, paused: true, pending: null,
    incarnation: 'complete-backup', revision: 'complete-backup',
  };
}

function portableDraft(input) {
  if (input === null) return null;
  if (!exactFields(input, PORTABLE_DRAFT_FIELDS) || input.format !== DRAFT_FORMAT || input.version !== DRAFT_VERSION
    || !Array.isArray(input.occurrences)) refuse('The import draft in this file has unsupported fields.');
  let sources;
  try { sources = [sourceOccurrences(input.rawText), sourceOccurrences(input.rawText, { legacyReaderLinks: true })]; }
  catch { refuse('The import draft source in this file is not usable.'); }
  if (sources.some((source) => source.length !== input.occurrences.length)) refuse('The import draft source positions in this file do not match its source.');
  const occurrences = sources[0].map((entry, index) => sources.map((source) => ({
    ...source[index],
    choice: input.occurrences[index]?.choice === null ? null : normalizeIssue(input.occurrences[index]?.choice),
    applied: input.occurrences[index]?.applied,
  })).find((candidate) => canonical(candidate) === canonical(input.occurrences[index])) ?? entry);
  if (canonical(occurrences) !== canonical(input.occurrences)) refuse('The import draft source or its selections were changed.');
  try { validateImportDraft(bounded(JSON.stringify(lifecycle({ ...input, occurrences })), 'The import draft')); }
  catch (error) {
    if (error instanceof CompleteBackupError) throw error;
    refuse('The import draft in this file cannot be restored.');
  }
  return { ...input, occurrences };
}

export function validateComponents(input) {
  if (!exactFields(input, COMPONENTS)) refuse('A complete backup holds every kind of saved data, including an explicit empty import draft.');
  try {
    return {
      reader: portableReader(input.reader),
      history: portableHistory(input.history),
      settings: portableSettings(input.settings),
      draft: portableDraft(input.draft),
    };
  } catch (error) {
    if (error instanceof CompleteBackupError) throw error;
    refuse('A part of this backup failed the check its own backup type has. Nothing was changed.');
  }
}

async function sha256(text, cryptoProvider) {
  if (typeof cryptoProvider?.subtle?.digest !== 'function') {
    refuse('This browser cannot check backup digests, so complete backups are unavailable here.', 'unsupported');
  }
  let hash;
  try { hash = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(text)); }
  catch { refuse('The backup digest could not be computed. Nothing was changed.', 'hash'); }
  if (!(hash instanceof ArrayBuffer) || hash.byteLength !== 32) refuse('The backup digest could not be computed. Nothing was changed.', 'hash');
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createCompleteBackup(components, { cryptoProvider = globalThis.crypto } = {}) {
  // Copied through text before the first await, so nothing edited while the digest is computed can
  // reach the bytes it describes.
  const copy = parseJson(bounded(JSON.stringify(components), 'The complete backup', MAX_COMPLETE_BACKUP_BYTES),
    'The complete backup', MAX_COMPLETE_BACKUP_BYTES);
  const content = validateComponents(copy);
  const digest = await sha256(canonical(content), cryptoProvider);
  const backup = { format: COMPLETE_BACKUP_FORMAT, version: COMPLETE_BACKUP_VERSION, digest, components: content };
  const text = bounded(canonical(backup), 'The complete backup', MAX_COMPLETE_BACKUP_BYTES);
  return { text, backup };
}

// Names the file the reader picked by mistake, so the refusal says where it does belong.
function otherFileRefusal(input) {
  if (!object(input)) return 'This is not a complete backup file from Recap Page.';
  if (input.format === COMPLETE_BACKUP_FORMAT) return 'This complete backup was made by a newer version of Recap Page, which this version cannot read.';
  if (input.format === LIST_HISTORY_FORMAT) return 'This is a completion-history backup. Restore it under Completion history.';
  if (input.format === DRAFT_FORMAT) return 'This is an import-draft backup. Restore it under Import draft.';
  if (input.format === 'recap-page-complete-restore-prior') return 'This is the prior copy kept during a complete restore, not a complete backup.';
  if (input.schemaVersion != null && object(input.lists)) return 'This is a reading-data backup. Restore it under Reading data.';
  return 'This is not a complete backup file from Recap Page.';
}

export async function parseCompleteBackup(text, { cryptoProvider = globalThis.crypto } = {}) {
  const input = parseJson(text, 'This file', MAX_COMPLETE_BACKUP_BYTES);
  if (!object(input) || input.format !== COMPLETE_BACKUP_FORMAT || input.version !== COMPLETE_BACKUP_VERSION) {
    refuse(otherFileRefusal(input), 'format');
  }
  if (!exactFields(input, FILE_FIELDS) || typeof input.digest !== 'string' || !HEX.test(input.digest)) {
    refuse('This complete backup is incomplete or has fields this version does not write.');
  }
  const components = validateComponents(input.components);
  if (await sha256(canonical(components), cryptoProvider) !== input.digest) {
    refuse('This complete backup does not match its own digest, so it was changed after it was saved. Nothing was changed.', 'integrity');
  }
  return { format: input.format, version: input.version, digest: input.digest, components };
}

// Read as loadSettings() and loadRailed() read them, so the file holds what this device is showing.
export function settingsFromStorage(rawSettings, rawSidebar) {
  let stored = {};
  try {
    const parsed = JSON.parse(rawSettings ?? '{}');
    if (object(parsed)) stored = parsed;
  } catch { /* an unreadable value is shown as the defaults, and is backed up the same way */ }
  return {
    covers: stored.covers !== false,
    theme: normaliseTheme(stored.theme),
    filter: readingFilter(stored.filter) ? stored.filter : DEFAULT_FILTER,
    readingShortcut: stored.readingShortcut !== false,
    hideDescriptions: stored.hideDescriptions !== false,
    sidebarCollapsed: rawSidebar === 'true' ? true : rawSidebar === 'false' ? false : null,
  };
}

function fromWitness(witness) {
  let reader;
  if (witness[KEY] === null) reader = readerContent(createEmptyState());
  else {
    let parsed;
    try { parsed = JSON.parse(witness[KEY]); }
    catch { refuse('Saved reading data cannot be read, so it cannot be backed up. Download the reading-data copy first.', 'unreadable'); }
    const checked = validateBackup(parsed);
    if (!checked.ok) refuse('Saved reading data cannot be read, so it cannot be backed up. Download the reading-data copy first.', 'unreadable');
    reader = readerContent(checked.state);
  }
  let records;
  try { records = parseListHistory(witness[LIST_HISTORY_KEY]); }
  catch { refuse('Completion history cannot be read, so it cannot be backed up. Use Completion history to keep a copy first.', 'unreadable'); }
  const history = { format: LIST_HISTORY_FORMAT, version: 1, records: [...records.values()] };
  const settings = settingsFromStorage(witness[SETTINGS_KEY], witness[SIDEBAR_KEY]);
  let draft = null;
  if (witness[IMPORT_DRAFT_KEY] !== null) {
    let held;
    try { held = validateImportDraft(witness[IMPORT_DRAFT_KEY]); }
    catch { refuse('The saved import draft cannot be read, so it cannot be backed up. Download its import-draft backup first.', 'unreadable'); }
    if (held.pending !== null) {
      refuse('An import is still being saved. Open Search, resume or discard the saved import, then download the complete backup.', 'pending');
    }
    draft = Object.fromEntries(PORTABLE_DRAFT_FIELDS.map((key) => [key, held[key]]));
  }
  return validateComponents({ reader, history, settings, draft });
}

// Read twice, before and after the digest, and retried when the two differ, so a save in another tab
// part way through cannot produce a file that mixes two moments.
//
// The import-draft store, when given, is asked first: source it could not save is held only in memory,
// so a file read from storage alone would leave it out while claiming to hold everything. That case
// is refused, as a pending import is, and the import-draft download, which does carry it, is named.
export async function captureCompleteBackup({ storage, cryptoProvider = globalThis.crypto, importDraft = null } = {}) {
  if (typeof storage?.getItem !== 'function') throw new TypeError('A complete backup needs browser storage.');
  if (importDraft && ((importDraft.recovery?.length ?? 0) > 0 || importDraft.uncertain === true)) {
    refuse('This page holds import source that could not be saved, and the complete backup would leave it out. Download it with Download import-draft backup instead.', 'unsaved');
  }
  const read = () => {
    try {
      return Object.fromEntries(CAPTURE_KEYS.map((key) => [key, storage.getItem(key) ?? null]));
    } catch {
      refuse('Saved data could not be read. Nothing was changed.', 'storage');
    }
  };
  const same = (a, b) => CAPTURE_KEYS.every((key) => a[key] === b[key]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const witness = read();
    let components;
    try { components = fromWitness(witness); }
    catch (error) {
      if (!same(witness, read())) continue;
      throw error;
    }
    const { text, backup } = await createCompleteBackup(components, { cryptoProvider });
    if (!same(witness, read())) continue;
    return { text, backup, witness };
  }
  refuse('Saved data kept changing while the backup was being made. Try again in a moment.', 'raced');
}

// A file larger than this was not written by this app, so it is refused before it is read.
export function completeBackupFileRefusal(file) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= MAX_COMPLETE_BACKUP_BYTES) return null;
  return `That file is larger than the ${MAX_COMPLETE_BACKUP_BYTES / (1024 * 1024)} MiB a complete backup can be, so it was not read. Nothing was changed.`;
}

// What the confirmation names: everything a restore of this file replaces.
export function completeBackupSummary(backup) {
  const { reader, history, draft } = backup.components;
  return {
    lists: reader.listOrder.length,
    records: history.records.length,
    draft: draft !== null,
  };
}

// ------------------------------------------------------------------ preparation

// The settings a restore writes: the stored object with the five portable fields replaced, so the
// metadata service address and anything else the file does not carry stay as saved. Settings that the
// file leaves as they are keep their exact stored bytes, so such a restore writes nothing there.
export function prepareSettingsRestore(settings, beforeSettings, beforeSidebar) {
  let base = null;
  if (beforeSettings !== null) {
    try {
      const parsed = JSON.parse(beforeSettings);
      if (object(parsed)) base = parsed;
    } catch { /* replaced by the restored fields alone, as loadSettings() already shows defaults for it */ }
  }
  const unchanged = base !== null && PORTABLE_SETTINGS.every((key) => base[key] === settings[key]);
  const next = { ...(base ?? {}) };
  for (const key of PORTABLE_SETTINGS) next[key] = settings[key];
  const value = unchanged ? beforeSettings : JSON.stringify(next);
  const sidebar = settings.sidebarCollapsed === null ? null : String(settings.sidebarCollapsed);
  return {
    owner: 'settings', before: { settings: beforeSettings, sidebar: beforeSidebar },
    effects: [
      { key: SETTINGS_KEY, before: beforeSettings, value },
      { key: SIDEBAR_KEY, before: beforeSidebar, value: sidebar },
    ],
  };
}

function readImage(storage, keys) {
  return Object.fromEntries(keys.map((key) => [key, storage.getItem(key) ?? null]));
}

// Every owner's exact bytes, prepared under the exclusive lock and refused, with nothing written, if
// any of them cannot be prepared or if saved data changes while they are.
export function prepareCompleteRestore({ backup, storage, isExclusive, draftRecovery = [] } = {}) {
  if (typeof storage?.getItem !== 'function' || typeof isExclusive !== 'function') {
    throw new TypeError('Restore preparation needs storage and the exclusive restore lock.');
  }
  if (!Array.isArray(draftRecovery) || draftRecovery.some((value) => typeof value !== 'string')) {
    throw new TypeError('Retained import draft sources must be exact strings.');
  }
  const read = () => {
    if (isExclusive() !== true) refuse('Close other Recap Page tabs, then try again. Nothing was replaced.', 'blocked');
    try { return readImage(storage, RESTORE_KEYS); }
    catch { refuse('Saved data could not be read, so it could not be kept for recovery. Nothing was replaced.', 'storage'); }
  };
  const before = read();
  let owners;
  try {
    const reader = prepareReaderRestore(backup.components.reader, {
      main: before[READER_RESTORE_KEYS.main], snapshot: before[READER_RESTORE_KEYS.snapshot],
      temporary: before[READER_RESTORE_KEYS.temporary],
    });
    const history = prepareListHistoryRestore(JSON.stringify(backup.components.history), before[LIST_HISTORY_KEY]);
    const settings = prepareSettingsRestore(backup.components.settings, before[SETTINGS_KEY], before[SIDEBAR_KEY]);
    const draft = prepareImportDraftRestore(
      backup.components.draft === null ? null : lifecycle(backup.components.draft),
      before[IMPORT_DRAFT_KEY], draftRecovery.slice(),
    );
    owners = [reader, history, settings, draft];
  } catch (error) {
    if (error instanceof CompleteBackupError) throw error;
    refuse(`The restore could not be prepared (${error.message}). Nothing was replaced.`, 'preparation');
  }
  const after = read();
  if (RESTORE_KEYS.some((key) => after[key] !== before[key])) {
    refuse('Saved data changed while the restore was being prepared. Nothing was replaced; try again.', 'raced');
  }
  return { format: PREPARED_FORMAT, version: 1, digest: backup.digest, before, owners };
}

// ------------------------------------------------------------------ the restore plan

function sameImage(a, b, keys) { return keys.every((key) => a[key] === b[key]); }

function sameEffects(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((effect, index) =>
    exactFields(effect, ['key', 'before', 'value']) && effect.key === expected[index].key
    && effect.before === expected[index].before && effect.value === expected[index].value);
}

function invalid(message = 'The recovery journal does not match its backup, so it cannot be trusted to write anything.') {
  refuse(message, 'journal');
}

function verifyReader(owner, backup, before) {
  if (!exactFields(owner, ['owner', 'before', 'value', 'effects']) || owner.owner !== 'reader') invalid();
  const prior = { main: before[READER_RESTORE_KEYS.main], snapshot: before[READER_RESTORE_KEYS.snapshot], temporary: before[READER_RESTORE_KEYS.temporary] };
  if (canonical(owner.before) !== canonical(prior) || typeof owner.value !== 'string') invalid();
  let parsed;
  try { parsed = JSON.parse(owner.value); } catch { invalid(); }
  if (!object(parsed) || typeof parsed.writeToken !== 'string' || !parsed.writeToken || parsed.writeToken.length > 200
    || typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))
    || new Date(parsed.exportedAt).toISOString() !== parsed.exportedAt) invalid();
  const checked = validateBackup(backup.components.reader);
  if (!checked.ok) invalid();
  const content = exportBackup(checked.state);
  content.exportedAt = parsed.exportedAt;
  if (owner.value !== JSON.stringify({ writeToken: parsed.writeToken, ...content })) invalid();
  const expected = [
    { key: READER_RESTORE_KEYS.temporary, before: prior.temporary, value: owner.value },
    { key: READER_RESTORE_KEYS.snapshot, before: prior.snapshot, value: prior.main ?? '' },
    { key: READER_RESTORE_KEYS.main, before: prior.main, value: owner.value },
    { key: READER_RESTORE_KEYS.temporary, before: owner.value, value: null },
  ];
  if (!sameEffects(owner.effects, expected)) invalid();
  return expected;
}

function verifyHistory(owner, backup, before) {
  if (!exactFields(owner, ['owner', 'before', 'value', 'effects']) || owner.owner !== 'history'
    || owner.before !== before[LIST_HISTORY_KEY] || typeof owner.value !== 'string') invalid();
  let parsed;
  try { parsed = JSON.parse(owner.value); } catch { invalid(); }
  if (!object(parsed) || typeof parsed.writeToken !== 'string' || !parsed.writeToken
    || owner.value !== JSON.stringify({ writeToken: parsed.writeToken, ...backup.components.history })) invalid();
  try { parseListHistory(owner.value); } catch { invalid(); }
  const expected = [{ key: LIST_HISTORY_KEY, before: owner.before, value: owner.value }];
  if (!sameEffects(owner.effects, expected)) invalid();
  return expected;
}

function verifySettings(owner, backup, before) {
  const expected = prepareSettingsRestore(backup.components.settings, before[SETTINGS_KEY], before[SIDEBAR_KEY]);
  if (!exactFields(owner, ['owner', 'before', 'effects']) || owner.owner !== 'settings'
    || canonical(owner.before) !== canonical(expected.before) || !sameEffects(owner.effects, expected.effects)) invalid();
  return expected.effects;
}

function verifyDraft(owner, backup, before) {
  if (!exactFields(owner, ['owner', 'before', 'value', 'retainedSources', 'effects']) || owner.owner !== 'draft'
    || owner.before !== before[IMPORT_DRAFT_KEY] || !Array.isArray(owner.retainedSources)
    || owner.retainedSources.some((source) => typeof source !== 'string')
    || new Set(owner.retainedSources).size !== owner.retainedSources.length) invalid();
  const portable = backup.components.draft;
  if ((portable === null) !== (owner.value === null)) invalid();
  if (portable !== null) {
    let held;
    try { held = validateImportDraft(owner.value); } catch { invalid(); }
    const retained = [...new Set([...portable.previousSources, ...owner.retainedSources, ...(owner.before !== null ? [owner.before] : [])])];
    if (!held.paused || held.pending !== null || held.readerToken !== null || held.expected !== null
      || canonical(held.previousSources) !== canonical(retained)
      || PORTABLE_DRAFT_FIELDS.some((key) => key !== 'previousSources' && canonical(held[key]) !== canonical(portable[key]))) invalid();
  }
  const expected = [{ key: IMPORT_DRAFT_KEY, before: owner.before, value: owner.value }];
  if (!sameEffects(owner.effects, expected)) invalid();
  return expected;
}

function statesOf(keys, effects, before) {
  const states = [Object.fromEntries(keys.map((key) => [key, before[key]]))];
  for (const effect of effects) {
    if (!keys.includes(effect.key) || states.at(-1)[effect.key] !== effect.before) invalid();
    states.push({ ...states.at(-1), [effect.key]: effect.value });
  }
  return states;
}

// Checks a prepared record against the file it was prepared from, so a journal can only ever write
// the bytes that file and the exact prior values imply, and returns each component's sequence of
// stored states, one per write, from its prior image to its prepared image.
export function restorePlan(prepared, backup) {
  if (!exactFields(prepared, ['format', 'version', 'digest', 'before', 'owners'])
    || prepared.format !== PREPARED_FORMAT || prepared.version !== 1 || prepared.digest !== backup.digest
    || !exactFields(prepared.before, RESTORE_KEYS) || !Array.isArray(prepared.owners) || prepared.owners.length !== 4) invalid();
  for (const key of RESTORE_KEYS) {
    const value = prepared.before[key];
    if (value !== null && (typeof value !== 'string' || utf8Length(value) > 4 * MAX_BACKUP_BYTES)) invalid();
  }
  const verify = { reader: verifyReader, history: verifyHistory, settings: verifySettings, draft: verifyDraft };
  const components = COMPONENTS.map((name, index) => {
    const effects = verify[name](prepared.owners[index], backup, prepared.before);
    const keys = COMPONENT_KEYS[name];
    return { name, keys, effects, states: statesOf(keys, effects, prepared.before) };
  });
  return { before: prepared.before, components };
}

// Where a component's stored bytes sit in its own sequence of states. Checkpoints are only hints: the
// browser can lose a run of recent writes, so the bytes decide. A component whose prepared image equals
// its prior image is both at once.
export function classifyComponent(storage, component) {
  const actual = readImage(storage, component.keys);
  const matches = component.states.flatMap((state, index) => sameImage(actual, state, component.keys) ? [index] : []);
  const last = component.states.length - 1;
  if (!matches.length) return { name: component.name, status: 'other', lowest: null, highest: null };
  const prior = matches[0] === 0;
  const done = matches.at(-1) === last;
  return {
    name: component.name, lowest: matches[0], highest: matches.at(-1),
    status: prior && done ? 'unchanged' : prior ? 'prior' : done ? 'prepared' : 'partial',
  };
}

export function imageOf(storage, keys = RESTORE_KEYS) { return readImage(storage, keys); }
