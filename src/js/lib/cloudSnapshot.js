import { DEFAULT_BASE } from '../api.js';
import {
  KEY, IMPORT_DRAFT_KEY, READER_RESTORE_PREPARATION_KEYS,
  prepareReaderRestore, prepareImportDraftRestore,
} from '../storage.js';
import { createEmptyState, exportBackup, validateBackup, normalizeIssue, SCHEMA_VERSION, MAX_BACKUP_BYTES } from './model.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT, parseListHistory, prepareListHistoryRestore } from './listHistory.js';
import { DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences, validateImportDraft } from './importDraft.js';
import { isAllowedApiBase } from './apiBase.js';
import { DEFAULT_FILTER, readingFilter } from './readingFilters.js';
import { DEFAULT_THEME, THEMES } from './theme.js';

export const CLOUD_SNAPSHOT_FORMAT = 'recap-page-cloud-backup';
export const CLOUD_SNAPSHOT_VERSION = 1;
export const MAX_CLOUD_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const CLOUD_SETTINGS_KEYS = Object.freeze({ settings: 'mrt.settings', sidebar: 'sidebar.collapsed' });
const SETTINGS_KEY = CLOUD_SETTINGS_KEYS.settings;
const SIDEBAR_KEY = CLOUD_SETTINGS_KEYS.sidebar;
const COMPONENTS = ['reader', 'history', 'settings', 'draft'];
const KEYS = [KEY, LIST_HISTORY_KEY, SETTINGS_KEY, SIDEBAR_KEY, IMPORT_DRAFT_KEY];
const HEX = /^[a-f0-9]{64}$/;
const SETTINGS_FIELDS = ['apiBase', 'covers', 'theme', 'filter', 'readingShortcut', 'hideDescriptions', 'sidebarCollapsed'];
export const CLOUD_DRAFT_FIELDS = Object.freeze(['format', 'version', 'rawText', 'occurrences', 'destination', 'previousSources']);

export class CloudSnapshotError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'CloudSnapshotError';
    this.code = code;
  }
}

function refuse(message, code) { throw new CloudSnapshotError(message, code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactFields(value, fields) {
  return object(value) && Object.keys(value).length === fields.length
    && fields.every((key) => Object.hasOwn(value, key));
}

function canonical(value, depth = 0) {
  if (depth > 64) refuse('The cloud snapshot is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (!object(value)) refuse('The cloud snapshot contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}

function bounded(text, label, limit = MAX_BACKUP_BYTES) {
  if (typeof text !== 'string' || text.length > limit || new TextEncoder().encode(text).length > limit) {
    refuse(`${label} exceeds its UTF-8 size limit. The previous backup is unchanged.`, 'oversize');
  }
  return text;
}

function parse(text, label, limit) {
  bounded(text, label, limit);
  try { return JSON.parse(text); }
  catch { refuse(`${label} is not valid JSON. Its saved value is unchanged.`); }
}

function portableReader(input) {
  if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) {
    refuse('Reading data needs the current saved schema before cloud backup. Local exports remain available.');
  }
  const checked = validateBackup(input);
  if (!checked.ok) refuse(`Reading data cannot be backed up: ${checked.errors.join(' ')}`);
  const result = exportBackup(checked.state);
  delete result.exportedAt;
  if (canonical(input) !== canonical(result)) {
    refuse('Reading data is not a complete restorable snapshot. Export it locally before recovery.');
  }
  bounded(canonical(result), 'Reading data');
  return result;
}

function portableHistory(input) {
  const records = parseListHistory(bounded(JSON.stringify(input), 'Completion history'));
  const result = { format: LIST_HISTORY_FORMAT, version: 1, records: [...records.values()] };
  if (canonical(input) !== canonical(result)) refuse('Completion history has unsupported fields or identities.');
  return result;
}

function portableSettings(input) {
  if (!exactFields(input, SETTINGS_FIELDS) || typeof input.apiBase !== 'string' || !input.apiBase
    || input.apiBase !== input.apiBase.trim().replace(/\/+$/, '') || !isAllowedApiBase(input.apiBase)
    || !THEMES.includes(input.theme) || !readingFilter(input.filter)
    || ['covers', 'readingShortcut', 'hideDescriptions'].some((key) => typeof input[key] !== 'boolean')
    || ![null, true, false].includes(input.sidebarCollapsed)) {
    refuse('Saved preferences are unsupported. Review Backup & settings before cloud backup.');
  }
  bounded(canonical(input), 'Saved preferences');
  return input;
}

function portableDraft(input) {
  if (input === null) return null;
  if (!exactFields(input, CLOUD_DRAFT_FIELDS) || input.format !== DRAFT_FORMAT || input.version !== DRAFT_VERSION
    || !Array.isArray(input.occurrences)) refuse('The portable import draft has unsupported fields.');
  const source = sourceOccurrences(input.rawText);
  if (source.length !== input.occurrences.length) refuse('The portable draft source positions do not match.');
  const occurrences = source.map((entry, index) => ({
    ...entry, choice: input.occurrences[index]?.choice === null ? null : normalizeIssue(input.occurrences[index]?.choice),
    applied: input.occurrences[index]?.applied,
  }));
  if (canonical(occurrences) !== canonical(input.occurrences)) refuse('The portable draft source or selections changed.');
  const text = bounded(JSON.stringify({
    ...input, occurrences, expected: null, readerToken: null, paused: true, pending: null,
    incarnation: 'cloud-portable', revision: 'cloud-portable',
  }), 'Import draft');
  try { validateImportDraft(text); }
  catch { refuse('The saved import draft is not restorable. Export its retained source before recovery.'); }
  return { ...input, occurrences };
}

export function validateCloudComponents(input) {
  if (!exactFields(input, COMPONENTS)) refuse('The cloud snapshot must contain every data category, including an explicit draft value.');
  try {
    return {
      reader: portableReader(input.reader),
      history: portableHistory(input.history),
      settings: portableSettings(input.settings),
      draft: portableDraft(input.draft),
    };
  } catch (error) {
    if (error instanceof CloudSnapshotError) throw error;
    refuse('A cloud snapshot component failed its existing backup validator. Nothing was restored.');
  }
}

async function sha256(text, cryptoProvider) {
  if (typeof cryptoProvider?.subtle?.digest !== 'function') {
    refuse('This browser cannot verify cloud backup hashes. Local reading remains available.', 'unsupported');
  }
  try {
    const hash = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(text));
    if (!(hash instanceof ArrayBuffer) || hash.byteLength !== 32) throw new Error('Invalid digest');
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
  } catch { refuse('Cloud backup hashing failed. The previous backup is unchanged.', 'hash'); }
}

async function hashes(components, cryptoProvider) {
  const componentDigests = {};
  for (const key of COMPONENTS) componentDigests[key] = await sha256(canonical(components[key]), cryptoProvider);
  return { componentDigests, contentDigest: await sha256(canonical(components), cryptoProvider) };
}

function metadata(input) {
  if (!exactFields(input, ['captureId', 'streamId', 'slotId', 'attemptId', 'generation', 'capturedAt', 'label'])
    || ['captureId', 'streamId', 'attemptId'].some((key) => typeof input[key] !== 'string' || !HEX.test(input[key]))
    || typeof input.slotId !== 'string' || !/^[A-Za-z0-9!_.:-]{1,256}$/.test(input.slotId)
    || !Number.isSafeInteger(input.generation) || input.generation < 1
    || typeof input.capturedAt !== 'string' || !Number.isFinite(Date.parse(input.capturedAt))
    || new Date(input.capturedAt).toISOString() !== input.capturedAt
    || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200) {
    refuse('The cloud snapshot has an invalid stream, generation or capture identity.');
  }
  return { ...input };
}

export async function createCloudSnapshot(components, capture, { cryptoProvider = globalThis.crypto } = {}) {
  // Copy before the first await: UI edits cannot alter the bytes being hashed.
  const content = validateCloudComponents(parse(bounded(JSON.stringify(components), 'Cloud snapshot', MAX_CLOUD_SNAPSHOT_BYTES),
    'Cloud snapshot', MAX_CLOUD_SNAPSHOT_BYTES));
  const identity = metadata(capture);
  const digests = await hashes(content, cryptoProvider);
  const snapshot = { format: CLOUD_SNAPSHOT_FORMAT, version: CLOUD_SNAPSHOT_VERSION, ...identity, ...digests, components: content };
  const text = bounded(canonical(snapshot), 'Cloud snapshot', MAX_CLOUD_SNAPSHOT_BYTES);
  return { text, snapshot };
}

export async function parseCloudSnapshot(text, { cryptoProvider = globalThis.crypto } = {}) {
  const input = parse(text, 'Cloud snapshot', MAX_CLOUD_SNAPSHOT_BYTES);
  if (!exactFields(input, ['format', 'version', 'captureId', 'streamId', 'slotId', 'attemptId', 'generation',
    'capturedAt', 'label', 'contentDigest', 'componentDigests', 'components'])
    || input.format !== CLOUD_SNAPSHOT_FORMAT || input.version !== CLOUD_SNAPSHOT_VERSION
    || typeof input.contentDigest !== 'string' || !HEX.test(input.contentDigest)
    || !exactFields(input.componentDigests, COMPONENTS)
    || COMPONENTS.some((key) => typeof input.componentDigests[key] !== 'string' || !HEX.test(input.componentDigests[key]))) {
    refuse('This is not a complete supported cloud snapshot.');
  }
  metadata(Object.fromEntries(['captureId', 'streamId', 'slotId', 'attemptId', 'generation', 'capturedAt', 'label']
    .map((key) => [key, input[key]])));
  const components = validateCloudComponents(input.components);
  const actual = await hashes(components, cryptoProvider);
  if (input.contentDigest !== actual.contentDigest || canonical(input.componentDigests) !== canonical(actual.componentDigests)) {
    refuse('Cloud snapshot hashes do not match its contents. Nothing was restored.', 'integrity');
  }
  return { ...input, components };
}

function fromWitness(witness) {
  const storedReader = witness[KEY] === null ? exportBackup(createEmptyState()) : parse(witness[KEY], 'Reading data');
  if (!object(storedReader)) refuse('Saved reading data is not an object.');
  delete storedReader.writeToken;
  delete storedReader.exportedAt;
  const reader = portableReader(storedReader);
  const history = { format: LIST_HISTORY_FORMAT, version: 1, records: [...parseListHistory(witness[LIST_HISTORY_KEY]).values()] };
  const rawSettings = witness[SETTINGS_KEY] === null ? {} : parse(witness[SETTINGS_KEY], 'Saved preferences');
  if (!object(rawSettings)) refuse('Saved preferences are not an object.');
  const sidebar = witness[SIDEBAR_KEY];
  if (![null, 'true', 'false'].includes(sidebar)) refuse('The saved sidebar preference is invalid.');
  const settings = portableSettings({
    apiBase: typeof rawSettings.apiBase === 'string' && rawSettings.apiBase
      ? rawSettings.apiBase.trim().replace(/\/+$/, '') : DEFAULT_BASE,
    covers: rawSettings.covers !== false, theme: rawSettings.theme === undefined ? DEFAULT_THEME : rawSettings.theme,
    filter: rawSettings.filter === undefined ? DEFAULT_FILTER : rawSettings.filter,
    readingShortcut: rawSettings.readingShortcut !== false, hideDescriptions: rawSettings.hideDescriptions !== false,
    sidebarCollapsed: sidebar === null ? null : sidebar === 'true',
  });
  let draft = null;
  if (witness[IMPORT_DRAFT_KEY] !== null) {
    let held;
    try { held = validateImportDraft(witness[IMPORT_DRAFT_KEY]); }
    catch { refuse('The saved import draft cannot be backed up. Export its retained source before recovery.'); }
    if (held.pending !== null) refuse('An import publication is unsettled. Resolve its saved draft before cloud backup.', 'pending');
    draft = Object.fromEntries(CLOUD_DRAFT_FIELDS.map((key) => [key, held[key]]));
    portableDraft(draft);
  }
  return { reader, history, settings, draft };
}

export async function captureCloudContent({ storage, isBlocked, cryptoProvider = globalThis.crypto } = {}) {
  if (typeof storage?.getItem !== 'function' || typeof isBlocked !== 'function') {
    throw new TypeError('Cloud capture requires persisted storage and the current recovery/interlock guard.');
  }
  function check() {
    if (isBlocked() !== false) refuse('Recovery or a local save is unsettled. Cloud capture is paused.', 'blocked');
  }
  function read() {
    check();
    try {
      return Object.fromEntries(KEYS.map((key) => {
        const value = storage.getItem(key);
        if (value !== null && typeof value !== 'string') refuse('Saved storage did not return an exact value.', 'storage');
        return [key, value];
      }));
    } catch (error) {
      if (error instanceof CloudSnapshotError) throw error;
      refuse('Saved data could not be read for cloud backup. Local values were not changed.', 'storage');
    }
  }
  const same = (a, b) => KEYS.every((key) => a[key] === b[key]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const witness = read();
    let components;
    try { components = fromWitness(witness); }
    catch (error) {
      if (!same(witness, read())) continue;
      if (error instanceof CloudSnapshotError) throw error;
      refuse('Saved data failed its existing backup validator. Export the affected local data before recovery.');
    }
    if (!same(witness, read())) continue;
    const digests = await hashes(components, cryptoProvider);
    if (!same(witness, read())) continue;
    bounded(canonical(components), 'Cloud snapshot', MAX_CLOUD_SNAPSHOT_BYTES);
    return { components, ...digests, witness };
  }
  refuse('Saved data kept changing during capture. Newest changes remain pending until the next save or resume.', 'raced');
}

export async function prepareCloudRestore({
  text, storage, isExclusive, draftRecovery = [], cryptoProvider = globalThis.crypto,
} = {}) {
  if (typeof storage?.getItem !== 'function' || typeof isExclusive !== 'function') {
    throw new TypeError('Cloud restore preparation requires storage and its exclusive session lease.');
  }
  if (!Array.isArray(draftRecovery) || draftRecovery.some((value) => typeof value !== 'string')) {
    throw new TypeError('Cloud restore requires exact retained draft source strings.');
  }
  if (isExclusive() !== true) refuse('Close other app tabs before preparing cloud restore.', 'blocked');
  const retainedSources = draftRecovery.slice();
  const snapshot = await parseCloudSnapshot(text, { cryptoProvider });
  function read() {
    if (isExclusive() !== true) refuse('Close other app tabs before preparing cloud restore.', 'blocked');
    try {
      return Object.fromEntries([...new Set([...KEYS, ...Object.values(READER_RESTORE_PREPARATION_KEYS)])]
        .map((key) => [key, storage.getItem(key)]));
    } catch { refuse('Prior local data could not be preserved for restore. Nothing was changed.', 'storage'); }
  }
  const before = read();
  for (const raw of Object.values(before)) {
    if (raw !== null) bounded(raw, 'Prior local data');
  }
  let owners;
  try {
    const readerBefore = Object.fromEntries(Object.entries(READER_RESTORE_PREPARATION_KEYS)
      .map(([field, key]) => [field, before[key]]));
    const reader = prepareReaderRestore(snapshot.components.reader, readerBefore);
    const history = prepareListHistoryRestore(JSON.stringify(snapshot.components.history), before[LIST_HISTORY_KEY]);
    const portable = snapshot.components.draft;
    const draft = prepareImportDraftRestore(portable === null ? null : {
      ...portable, expected: null, readerToken: null, paused: true, pending: null,
      incarnation: 'cloud-preparation', revision: 'cloud-preparation',
    }, before[IMPORT_DRAFT_KEY], retainedSources);
    const { sidebarCollapsed, ...settings } = snapshot.components.settings;
    const settingsValue = bounded(JSON.stringify(settings), 'Prepared saved preferences');
    const settingsOwner = {
      owner: 'settings', version: 1,
      effects: [
        { key: SETTINGS_KEY, before: before[SETTINGS_KEY], value: settingsValue },
        { key: SIDEBAR_KEY, before: before[SIDEBAR_KEY],
          value: sidebarCollapsed === null ? null : String(sidebarCollapsed) },
      ],
    };
    owners = [reader, history, settingsOwner, draft];
  } catch (error) {
    if (error instanceof CloudSnapshotError) throw error;
    refuse('The complete restored data, including retained draft sources, could not be prepared. Nothing was changed.', 'preparation');
  }
  const actual = read();
  if (Object.keys(before).some((key) => actual[key] !== before[key])) {
    refuse('Local data changed while restore was being prepared. Review the current values; nothing was replaced.', 'raced');
  }
  return {
    format: 'recap-page-cloud-restore-prepared', version: 1,
    captureId: snapshot.captureId, contentDigest: snapshot.contentDigest, before, owners,
  };
}
