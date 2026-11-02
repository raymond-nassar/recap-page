import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from './cbh-inventory.mjs';
import { firstSentence } from '../../src/js/lib/catalog.js';

const ENTRY_KEYS = ['after', 'before', 'file', 'id', 'nonDescriptionSha256', 'sources', 'support'];
const HEADER = /^ {2}"description": .+,\r?$/gm;

// Chapter copy is bound to the owner's attachment digest in the chapter ledger, so a record here
// could never be the approval for it. Those lists are not in the manifest either.
const CHAPTER_ID = /^marvel-knights-to-planet-x-\d{2}$/;

export function validateDescriptionRevisions(value) {
  const { sha256, ...record } = value;
  assert.equal(digestCanonicalJson(record), sha256, 'Description revision digest changed.');
  assert.deepEqual(Object.keys(record).sort(), ['entries', 'issue', 'schemaVersion']);
  assert.equal(record.schemaVersion, 1);
  assert.ok(Number.isInteger(record.issue) && record.issue > 0, 'Description revisions need an owning Issue.');
  assert.ok(Array.isArray(record.entries));
  const ids = new Set();
  const files = new Set();
  for (const entry of record.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS, `${entry.id}: unexpected revision fields.`);
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.doesNotMatch(entry.id, CHAPTER_ID, `${entry.id}: chapter copy belongs to the owner attachment.`);
    assert.match(entry.file, /^[a-z0-9_]+\.json$/, `${entry.id}: unsafe payload file.`);
    assert.ok(!ids.has(entry.id), `${entry.id}: duplicate revision.`);
    assert.ok(!files.has(entry.file), `${entry.file}: duplicate revision file.`);
    ids.add(entry.id);
    files.add(entry.file);
    for (const field of ['before', 'after', 'support']) {
      assert.equal(typeof entry[field], 'string', `${entry.id}: ${field} must be text.`);
      assert.equal(entry[field], entry[field].trim(), `${entry.id}: ${field} has edge whitespace.`);
      assert.ok(entry[field].length > 0, `${entry.id}: ${field} is empty.`);
      assert.doesNotMatch(entry[field], /[\r\n]/, `${entry.id}: ${field} spans lines.`);
    }
    assert.notEqual(entry.before, entry.after, `${entry.id}: revision changes nothing.`);
    assert.doesNotMatch(entry.after, /[\u2011\u2013\u2014]/, `${entry.id}: revised copy contains a dash.`);
    assert.ok(firstSentence(entry.after).length <= 140, `${entry.id}: card opening is too long.`);
    assert.match(entry.nonDescriptionSha256, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(entry.sources), `${entry.id}: sources must be a list.`);
    for (const source of entry.sources) {
      assert.deepEqual(Object.keys(source).sort(), ['claim', 'retrieved', 'url'], `${entry.id}: bad source.`);
      assert.match(source.url, /^https:\/\/\S+$/, `${entry.id}: source needs an https URL.`);
      assert.match(source.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${entry.id}: source needs a retrieval date.`);
      assert.ok(source.claim.trim().length > 0, `${entry.id}: source must name the claim it supports.`);
    }
  }
  return value;
}

// A copy revision is not a new source approval, so historical checks replay only its exact
// inverse. Either recorded side is accepted, which lets the same check run before and after the
// emitter, and anything else is unrecorded copy that must stop the check.
export function createDescriptionRevisions(value) {
  const record = validateDescriptionRevisions(value);
  const byId = new Map(record.entries.map((entry) => [entry.id, entry]));
  const byFile = new Map(record.entries.map((entry) => [entry.file, entry]));

  function revisionFor(entry) {
    const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
    if (!revision) return null;
    assert.equal(entry.id, revision.id, `${revision.id}: description revision identity changed.`);
    for (const field of ['out', 'file']) {
      if (Object.hasOwn(entry, field)) {
        assert.equal(entry[field], revision.file, `${revision.id}: description revision file changed.`);
      }
    }
    assert.ok([revision.before, revision.after].includes(entry.description),
      `${revision.id}: unrecorded description revision copy.`);
    return revision;
  }

  function beforeEntry(entry) {
    const revision = revisionFor(entry);
    return revision ? { ...entry, description: revision.before } : entry;
  }

  function afterEntry(entry) {
    const revision = revisionFor(entry);
    return revision ? { ...entry, description: revision.after } : entry;
  }

  function beforeManifest(manifest) {
    return { ...manifest, lists: manifest.lists.map(beforeEntry) };
  }

  function beforePayloadText(file, text) {
    const revision = byFile.get(file);
    if (!revision) return text;
    const payload = JSON.parse(text);
    revisionFor(payload);
    const headers = text.match(HEADER) ?? [];
    assert.equal(headers.length, 1, `${file}: expected one top-level description.`);
    const header = `  "description": ${JSON.stringify(payload.description)},`;
    assert.equal(headers[0].replace(/\r$/, ''), header);
    return text.replace(header, () => `  "description": ${JSON.stringify(revision.before)},`);
  }

  // Older inverses run after this one and accept copy that is already reconstructed, so this step
  // undoes only its own exact revised text and leaves any other copy for them to judge.
  function undoEntry(entry) {
    const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
    return revision && entry.description === revision.after ? beforeEntry(entry) : entry;
  }

  function redoEntry(entry) {
    const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
    return revision && entry.description === revision.before ? afterEntry(entry) : entry;
  }

  function undoManifest(manifest) {
    return { ...manifest, lists: manifest.lists.map(undoEntry) };
  }

  function undoPayloadText(file, text) {
    const revision = byFile.get(file);
    return revision && JSON.parse(text).description === revision.after ? beforePayloadText(file, text) : text;
  }

  return {
    record, entries: record.entries, beforeEntry, afterEntry, beforeManifest, beforePayloadText,
    undoEntry, redoEntry, undoManifest, undoPayloadText,
  };
}

export const descriptionRevisions = createDescriptionRevisions(JSON.parse(readFileSync(
  new URL('../data/description-revisions.json', import.meta.url), 'utf8',
)));

export function describeDescriptionRevision({ id, file, before, after, support, sources = [] }, payload) {
  const { description, ...rest } = payload;
  assert.equal(payload.id, id);
  assert.equal(description, before, `${id}: the revision must start from the current copy.`);
  return { id, file, before, after, support, sources, nonDescriptionSha256: digestCanonicalJson(rest) };
}

export function sealDescriptionRevisions({ issue, entries }) {
  const record = { schemaVersion: 1, issue, entries };
  return validateDescriptionRevisions({ ...record, sha256: digestCanonicalJson(record) });
}

// Pure planning step: the emitter supplies the inputs and owns every write.
export function planDescriptionRevisions({ revisions, manifest, payloadTexts }) {
  const lists = structuredClone(manifest.lists);
  const outputs = [];
  for (const edit of revisions.entries) {
    const entries = lists.filter(({ id }) => id === edit.id);
    assert.equal(entries.length, 1, `${edit.id}: expected one canonical manifest entry.`);
    const [entry] = entries;
    assert.equal(entry.out, edit.file, `${edit.id}: manifest payload file changed.`);
    assert.ok([edit.before, edit.after].includes(entry.description), `${edit.id}: unknown manifest copy.`);
    const text = payloadTexts.get(edit.file);
    assert.equal(typeof text, 'string', `${edit.file}: payload text is missing.`);
    const payload = JSON.parse(text);
    const { description, ...rest } = payload;
    assert.equal(payload.id, edit.id);
    assert.ok([edit.before, edit.after].includes(description), `${edit.id}: unknown payload copy.`);
    assert.equal(digestCanonicalJson(rest), edit.nonDescriptionSha256, `${edit.id}: non-description payload changed.`);
    const header = `  "description": ${JSON.stringify(description)},`;
    assert.equal((text.match(HEADER) ?? []).length, 1, `${edit.file}: expected one top-level description.`);
    assert.ok(text.includes(header), `${edit.file}: description header is not in canonical form.`);
    entry.description = edit.after;
    outputs.push({ file: edit.file, content: text.replace(header, () => `  "description": ${JSON.stringify(edit.after)},`) });
  }
  return { manifest: { ...manifest, lists }, payloads: outputs };
}
