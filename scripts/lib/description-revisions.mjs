import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from './cbh-inventory.mjs';
import { firstSentence } from '../../src/js/lib/catalog.js';
import { digestJson } from './chapter-orders.mjs';

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

const COPY_DIGESTS = ['entriesSha256', 'ownerAttachmentSha256'];
const chapterFileFor = (id) => `${id.replaceAll('-', '_')}.json`;
const digestCopy = (entries, side) => digestJson(entries.map(({ id, sourceHeading, ...copy }) =>
  ({ id, sourceHeading, description: copy[side] })));

// The chapter ledger keeps only the owner's current attachment. When a new attachment replaces
// it, this record keeps the superseded copy, bound to both attachments' digests, so the same
// exact inverse can reconstruct chapter cards that earlier approvals were checked against.
export function validateChapterDescriptionRevisions(value) {
  const { sha256, ...record } = value;
  assert.equal(digestCanonicalJson(record), sha256, 'Chapter description revision digest changed.');
  assert.deepEqual(Object.keys(record).sort(), ['current', 'entries', 'issue', 'previous', 'schemaVersion']);
  assert.equal(record.schemaVersion, 1);
  assert.ok(Number.isInteger(record.issue) && record.issue > 0, 'Chapter revisions need an owning Issue.');
  assert.ok(Array.isArray(record.entries));
  if (record.entries.length === 0) {
    assert.equal(record.previous, null, 'An empty chapter record supersedes no attachment.');
    assert.equal(record.current, null, 'An empty chapter record names no attachment.');
    return value;
  }
  for (const side of ['previous', 'current']) {
    assert.deepEqual(Object.keys(record[side] ?? {}).sort(), COPY_DIGESTS, `Chapter ${side} digests are missing.`);
    for (const key of COPY_DIGESTS) assert.match(record[side][key], /^[a-f0-9]{64}$/);
  }
  const ids = new Set();
  for (const entry of record.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['after', 'before', 'id', 'sourceHeading']);
    assert.match(entry.id, CHAPTER_ID, `${entry.id}: not a chapter list.`);
    assert.ok(!ids.has(entry.id), `${entry.id}: duplicate chapter revision.`);
    ids.add(entry.id);
    for (const field of ['before', 'after', 'sourceHeading']) {
      assert.equal(typeof entry[field], 'string', `${entry.id}: ${field} must be text.`);
      assert.ok(entry[field].trim().length > 0, `${entry.id}: ${field} is empty.`);
    }
  }
  assert.equal(digestCopy(record.entries, 'before'), record.previous.entriesSha256,
    'Superseded chapter copy differs from its attachment entries.');
  assert.equal(digestCopy(record.entries, 'after'), record.current.entriesSha256,
    'Current chapter copy differs from its attachment entries.');
  return value;
}

export function sealChapterDescriptionRevisions({ issue, previous, current, entries }) {
  const record = { schemaVersion: 1, issue, previous, current, entries };
  return validateChapterDescriptionRevisions({ ...record, sha256: digestCanonicalJson(record) });
}

// A copy revision is not a new source approval, so historical checks replay only its exact
// inverse. Either recorded side is accepted, which lets the same check run before and after the
// emitter, and anything else is unrecorded copy that must stop the check.
export function createDescriptionRevisions(value, chapterValue = sealChapterDescriptionRevisions({
  issue: value.issue, previous: null, current: null, entries: [],
})) {
  const record = validateDescriptionRevisions(value);
  const chapters = validateChapterDescriptionRevisions(chapterValue);
  const byId = new Map(record.entries.map((entry) => [entry.id, entry]));
  const byFile = new Map(record.entries.map((entry) => [entry.file, entry]));
  const chapterById = new Map(chapters.entries.map((entry) => [entry.id, entry]));
  const chapterByFile = new Map(chapters.entries.map((entry) => [chapterFileFor(entry.id), entry]));

  // Chapter copy is swapped only when it is exactly the recorded side, and only for the chapter
  // itself, never for a list whose id or file merely resembles one.
  function swapChapterEntry(entry, from, to) {
    const revision = chapterById.get(entry.id);
    if (!revision || revision.before === revision.after || entry.description !== revision[from]) return entry;
    for (const field of ['out', 'file']) {
      if (Object.hasOwn(entry, field)) {
        assert.equal(entry[field], chapterFileFor(revision.id), `${revision.id}: chapter file changed.`);
      }
    }
    return { ...entry, description: revision[to] };
  }

  function undoChapterPayloadText(file, text) {
    const revision = chapterByFile.get(file);
    if (!revision) return text;
    const payload = JSON.parse(text);
    if (payload.description !== revision.after) return text;
    assert.equal(payload.id, revision.id, `${file}: chapter identity changed.`);
    const header = `  "description": ${JSON.stringify(revision.after)},`;
    const headers = text.match(HEADER) ?? [];
    assert.equal(headers.length, 1, `${file}: expected one top-level description.`);
    assert.equal(headers[0].replace(/\r$/, ''), header);
    return text.replace(header, () => `  "description": ${JSON.stringify(revision.before)},`);
  }

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
    if (chapterById.has(entry.id)) return swapChapterEntry(entry, 'after', 'before');
    const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
    return revision && entry.description === revision.after ? beforeEntry(entry) : entry;
  }

  function redoEntry(entry) {
    if (chapterById.has(entry.id)) return swapChapterEntry(entry, 'before', 'after');
    const revision = byId.get(entry.id) ?? byFile.get(entry.out ?? entry.file);
    return revision && entry.description === revision.before ? afterEntry(entry) : entry;
  }

  function undoManifest(manifest) {
    return { ...manifest, lists: manifest.lists.map(undoEntry) };
  }

  function undoPayloadText(file, text) {
    if (chapterByFile.has(file)) return undoChapterPayloadText(file, text);
    const revision = byFile.get(file);
    return revision && JSON.parse(text).description === revision.after ? beforePayloadText(file, text) : text;
  }

  return {
    record, entries: record.entries, chapters, beforeEntry, afterEntry, beforeManifest, beforePayloadText,
    undoEntry, redoEntry, undoManifest, undoPayloadText,
  };
}

const readRecord = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
export const descriptionRevisions = createDescriptionRevisions(
  readRecord('description-revisions.json'), readRecord('chapter-description-revisions.json'),
);

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
