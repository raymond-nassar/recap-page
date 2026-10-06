import { parseChecklist, readerIssueId } from './markdown.js';
import { MAX_BACKUP_BYTES, MAX_ISSUES, MAX_NAME, normalizeIssue } from './model.js';

export const DRAFT_FORMAT = 'recap-import-draft';
export const DRAFT_VERSION = 1;

export function listSignature(list) {
  return list ? JSON.stringify([
    list.id, list.created, list.itemIds, list.collectedIn ?? {}, list.deferredIssueIds ?? [],
  ]) : null;
}

export function sourceOccurrences(rawText) {
  if (typeof rawText !== 'string' || rawText.length > MAX_BACKUP_BYTES
    || new TextEncoder().encode(rawText).length > MAX_BACKUP_BYTES) throw new Error('The import draft source exceeds the 8 MiB limit.');
  const parsed = parseChecklist(rawText);
  const entries = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  if (entries.length > MAX_ISSUES || entries.some((entry) => entry.issueId != null
    && (!Number.isSafeInteger(entry.issueId) || entry.issueId === 0))) throw new Error('The import draft has too many source positions or an invalid comic identity.');
  const lines = rawText.split(/\r?\n/);
  const positions = [];
  lines.forEach((line, index) => {
    const row = parseChecklist(line);
    if (row.entries.length || row.unresolved.length) positions.push(index + 1);
  });
  return entries.map((entry, index) => ({
    ...entry, line: positions[index], choice: null, applied: false,
  }));
}

export function occurrenceIssue(entry) {
  if (entry.choice) return { ...entry.choice, collectedIn: entry.section ?? null };
  if (entry.issueId == null) return null;
  const readerOnly = readerIssueId(entry.digitalId) === entry.issueId;
  return {
    issueId: entry.issueId, title: entry.title, url: readerOnly ? null : entry.url,
    digitalId: entry.digitalId ?? null, source: readerOnly ? 'manual' : 'import',
    hydrated: readerOnly, collectedIn: entry.section ?? null,
  };
}

export function validateImportDraft(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES
    || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('The import draft exceeds the 8 MiB limit.');
  const draft = JSON.parse(text);
  if (draft?.format !== DRAFT_FORMAT || draft.version !== DRAFT_VERSION) throw new Error('This is not a supported import draft file.');
  if (typeof draft.rawText !== 'string' || !Array.isArray(draft.occurrences)
    || draft.occurrences.length > MAX_ISSUES) throw new Error('The import draft source is invalid.');
  const source = sourceOccurrences(draft.rawText);
  if (!source.length || source.length !== draft.occurrences.length) throw new Error('The import draft source positions do not match.');
  source.forEach((entry, index) => {
    const held = draft.occurrences[index];
    const { choice, applied, ...original } = held;
    const expected = { ...entry };
    delete expected.choice;
    delete expected.applied;
    if (JSON.stringify(original) !== JSON.stringify(expected)
      || typeof applied !== 'boolean') throw new Error('The import draft source was changed.');
    if (choice !== null) {
      const normalized = normalizeIssue(choice);
      if (entry.issueId != null || !normalized || normalized.issueId <= 0
        || JSON.stringify(choice) !== JSON.stringify(normalized)) throw new Error('The import draft has an invalid selected comic.');
    }
  });
  const destination = draft.destination;
  if (!destination || typeof destination.id !== 'string' || !destination.id
    || destination.id.length > MAX_NAME || !Number.isSafeInteger(destination.created)
    || typeof destination.newList !== 'boolean' || typeof destination.name !== 'string'
    || destination.name.length > MAX_NAME || !Array.isArray(destination.prefix)
    || destination.prefix.length > MAX_ISSUES
    || destination.prefix.some((id) => !Number.isSafeInteger(id) || id === 0)
    || new Set(destination.prefix).size !== destination.prefix.length
    || !(draft.expected === null || typeof draft.expected === 'string')
    || !(draft.readerToken === null || typeof draft.readerToken === 'string')
    || typeof draft.paused !== 'boolean'
    || typeof draft.incarnation !== 'string' || typeof draft.revision !== 'string'
    || !Array.isArray(draft.previousSources)
    || draft.previousSources.some((raw) => typeof raw !== 'string')) throw new Error('The import draft destination or lifecycle is invalid.');
  if (draft.pending !== null) {
    const pending = draft.pending;
    if (!pending || typeof pending !== 'object' || typeof pending.beforeAbsent !== 'boolean'
      || !(pending.beforeToken === null || typeof pending.beforeToken === 'string')
      || typeof pending.before !== 'string' || typeof pending.after !== 'string'
      || !Array.isArray(pending.indices) || pending.indices.some((i) => !Number.isInteger(i)
        || i < 0 || i >= source.length || !occurrenceIssue(draft.occurrences[i]))
      || !Number.isSafeInteger(pending.at)) throw new Error('The import draft pending outcome is invalid.');
  }
  return draft;
}

export function importProjection(state, draft, indices) {
  const markers = indices.map((index) => occurrenceIssue(draft.occurrences[index])?.issueId)
    .filter((id) => id != null);
  return JSON.stringify({
    list: listSignature(state.lists[draft.destination.id]),
    read: [...new Set(markers)].map((id) => [id, state.read[id] ?? null]),
  });
}

export function pendingOutcome(draft, state, token, absent) {
  const pending = draft.pending;
  if (!pending) return 'none';
  const actual = importProjection(state, draft, pending.indices);
  if (actual === pending.after) return 'after';
  if (actual === pending.before && token === pending.beforeToken
    && (token !== null || (absent && pending.beforeAbsent))) return 'before';
  return 'unknown';
}
