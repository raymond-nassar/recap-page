import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from './cbh-inventory.mjs';

export const mcuEditorial = JSON.parse(readFileSync(
  new URL('../data/mcu-prep-description-revision.json', import.meta.url), 'utf8',
));
const { sha256, ...record } = mcuEditorial;
assert.equal(digestCanonicalJson(record), sha256, 'MCU editorial revision digest changed.');
assert.equal(record.schemaVersion, 1);
assert.equal(record.entries.length, 30);
assert.equal(new Set(record.entries.map(({ id }) => id)).size, 30);
assert.equal(new Set(record.entries.map(({ file }) => file)).size, 30);
const byId = new Map(record.entries.map((entry) => [entry.id, entry]));
const byFile = new Map(record.entries.map((entry) => [entry.file, entry]));

// Source approvals describe their original copy, not later editorial recommendations.
export function beforeMcuEditorialEntry(entry) {
  const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
  if (!revision) return entry;
  assert.equal(entry.id, revision.id, 'MCU editorial identity changed.');
  for (const field of ['out', 'file']) {
    if (Object.hasOwn(entry, field)) assert.equal(entry[field], revision.file, 'MCU editorial file changed.');
  }
  assert.ok(entry.description === revision.after || entry.description === revision.before,
    `${entry.id}: unrecorded MCU editorial description.`);
  return { ...entry, description: revision.before };
}

export function afterMcuEditorialEntry(entry) {
  const original = beforeMcuEditorialEntry(entry);
  const revision = byId.get(original.id);
  return revision ? { ...original, description: revision.after } : original;
}

export function beforeMcuEditorialManifest(manifest, { restoreWithdrawal = false } = {}) {
  const lists = manifest.lists.map(beforeMcuEditorialEntry);
  const { manifestEntry, beforeId } = record.withdrawal;
  if (restoreWithdrawal && !lists.some(({ id }) => id === manifestEntry.id)) {
    const index = lists.findIndex(({ id }) => id === beforeId);
    if (index >= 0) lists.splice(index, 0, structuredClone(manifestEntry));
  }
  return { ...manifest, lists };
}

export function beforeMcuEditorialPayloadText(file, text) {
  const revision = byFile.get(file);
  if (!revision) return text;
  const payload = JSON.parse(text);
  assert.equal(payload.id, revision.id, 'MCU editorial payload identity changed.');
  beforeMcuEditorialEntry(payload);
  const headers = text.match(/^ {2}"description": .+,\r?$/gm) ?? [];
  assert.equal(headers.length, 1, 'Expected one top-level editorial description.');
  const header = `  "description": ${JSON.stringify(payload.description)},`;
  assert.equal(headers[0].replace(/\r$/, ''), header);
  return text.replace(header, () => `  "description": ${JSON.stringify(revision.before)},`);
}
