import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDescriptionRevisions, describeDescriptionRevision, descriptionRevisions, planDescriptionRevisions,
  sealChapterDescriptionRevisions, sealDescriptionRevisions, validateChapterDescriptionRevisions,
  validateDescriptionRevisions,
} from '../scripts/lib/description-revisions.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { digestJson } from '../scripts/lib/chapter-orders.mjs';
import { digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';
import { sourceCreditRevisions } from '../scripts/lib/source-credit-revisions.mjs';
import {
  beforeUltimateSelectionEntry, beforeUltimateSelectionCatalogEntry, beforeUltimateSelectionPayloadText,
} from './helpers/ultimate-spider-man-selection-history.mjs';

const json = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

const ID = 'house-of-m';
const FILE = 'house_of_m.json';
const AFTER = 'Wanda Maximoff reshapes reality, and the heroes wake in a world that should not exist. Preview text follows.';

async function fixture(overrides = {}) {
  const payload = await json(`src/data/${FILE}`);
  const entry = describeDescriptionRevision({
    id: ID, file: FILE, before: payload.description, after: AFTER, support: 'Fixture support line.',
  }, payload);
  return sealDescriptionRevisions({ issue: 1075, entries: [{ ...entry, ...overrides }] });
}

test('the committed description revision record is sealed and matches published copy', async () => {
  const manifest = await json('src/data/curated-lists.json');
  const catalog = await json('src/data/catalog.json');
  for (const edit of descriptionRevisions.entries) {
    const entry = beforeUltimateSelectionEntry(manifest.lists.find(({ id }) => id === edit.id));
    const payload = JSON.parse(beforeUltimateSelectionPayloadText(edit.file, await text(`src/data/${edit.file}`)));
    const card = beforeUltimateSelectionCatalogEntry(catalog.lists.find(({ id }) => id === edit.id));
    assert.equal(entry.description, edit.after, `${edit.id}: manifest copy`);
    assert.equal(payload.description, edit.after, `${edit.id}: payload copy`);
    assert.equal(card.description, edit.after, `${edit.id}: catalog copy`);
  }
});

test('planning a revision changes only the manifest copy and the payload description header', async () => {
  const revisions = createDescriptionRevisions(await fixture());
  const manifest = await json('src/data/curated-lists.json');
  const source = await text(`src/data/${FILE}`);
  const plan = planDescriptionRevisions({ revisions, manifest, payloadTexts: new Map([[FILE, source]]) });
  assert.equal(plan.manifest.lists.find(({ id }) => id === ID).description, AFTER);
  const changed = plan.manifest.lists.filter((entry, index) =>
    JSON.stringify(entry) !== JSON.stringify(manifest.lists[index]));
  assert.deepEqual(changed.map(({ id }) => id), [ID]);
  const [{ file, content }] = plan.payloads;
  assert.equal(file, FILE);
  const before = source.split('\n');
  const after = content.split('\n');
  assert.equal(after.length, before.length);
  assert.deepEqual(after.flatMap((line, index) => line === before[index] ? [] : [index]).length, 1);
  assert.equal(JSON.parse(content).description, AFTER);
  const again = planDescriptionRevisions({ revisions, manifest: plan.manifest, payloadTexts: new Map([[FILE, content]]) });
  assert.equal(again.payloads[0].content, content, 'An applied revision replays unchanged.');
});

test('planning stops on unknown copy or changed comics instead of overwriting them', async () => {
  const revisions = createDescriptionRevisions(await fixture());
  const manifest = await json('src/data/curated-lists.json');
  const source = await text(`src/data/${FILE}`);
  const edited = { ...manifest, lists: manifest.lists.map((entry) =>
    entry.id === ID ? { ...entry, description: 'Unrecorded copy.' } : entry) };
  assert.throws(() => planDescriptionRevisions({ revisions, manifest: edited, payloadTexts: new Map([[FILE, source]]) }),
    /unknown manifest copy/);
  const payload = JSON.parse(source);
  payload.items[0].title = `${payload.items[0].title} changed`;
  assert.throws(() => planDescriptionRevisions({
    revisions, manifest, payloadTexts: new Map([[FILE, `${JSON.stringify(payload, null, 2)}\n`]]),
  }), /non-description payload changed/);
});

test('historical description digests accept only the recorded current credit inverse', async () => {
  const id = 'mcu-prep-doctor-strange-2016';
  const file = 'mcu_prep_doctor_strange_2016.json';
  const manifest = await json('src/data/curated-lists.json');
  const payload = await json(`src/data/${file}`);
  const { description: originalDescription, ...original } = sourceCreditRevisions.undo(payload, file);
  const edit = describeDescriptionRevision({
    id, file, before: payload.description, after: AFTER, support: 'Fixture support line.',
  }, payload);
  assert.equal(originalDescription, payload.description);
  edit.nonDescriptionSha256 = digestCanonicalJson(original);
  const revisions = createDescriptionRevisions(sealDescriptionRevisions({ issue: 1075, entries: [edit] }));
  const plan = (value) => planDescriptionRevisions({
    revisions, manifest, payloadTexts: new Map([[file, `${JSON.stringify(value, null, 2)}\n`]]),
  });
  const output = plan(payload).payloads[0].content;
  assert.equal(JSON.parse(output).source, payload.source);
  assert.equal(JSON.parse(output).description, AFTER);
  assert.throws(() => plan({ ...payload, source: 'https://example.test/other' }), /published credit is not latest/);
  assert.throws(() => plan({ ...payload, items: [] }), /non-description payload changed/);
});

test('historical checks replay only the exact recorded inverse', async () => {
  const revisions = createDescriptionRevisions(await fixture());
  const manifest = await json('src/data/curated-lists.json');
  const current = manifest.lists.find(({ id }) => id === ID);
  const revised = { ...current, description: AFTER };
  assert.deepEqual(revisions.beforeEntry(revised), current);
  assert.deepEqual(revisions.beforeEntry(current), current);
  assert.deepEqual(revisions.afterEntry(current), revised);
  assert.throws(() => revisions.beforeEntry({ ...current, description: 'Unrecorded copy.' }), /unrecorded/);
  assert.throws(() => revisions.beforeEntry({ ...current, out: 'other.json' }), /file changed/);
  assert.throws(() => revisions.beforeEntry({ ...current, id: 'other', out: FILE }), /identity changed/);
  const untouched = manifest.lists.find(({ id }) => id !== ID);
  assert.equal(revisions.beforeEntry(untouched), untouched);
  const source = await text(`src/data/${FILE}`);
  const plan = planDescriptionRevisions({ revisions, manifest, payloadTexts: new Map([[FILE, source]]) });
  assert.equal(revisions.beforePayloadText(FILE, plan.payloads[0].content), source);
  assert.equal(revisions.beforePayloadText(FILE, source), source);
});

test('composed history inverses undo only their own revised copy and pass everything else on', async () => {
  const revisions = createDescriptionRevisions(await fixture());
  const manifest = await json('src/data/curated-lists.json');
  const current = manifest.lists.find(({ id }) => id === ID);
  const revised = { ...current, description: AFTER };
  assert.deepEqual(revisions.undoEntry(revised), current);
  assert.equal(revisions.undoEntry(current), current);
  const older = { ...current, description: 'Copy an older inverse still has to judge.' };
  assert.equal(revisions.undoEntry(older), older, 'Unrecorded copy passes through for an older inverse.');
  assert.deepEqual(revisions.redoEntry(current), revised);
  assert.equal(revisions.redoEntry(revised), revised);
  assert.equal(revisions.redoEntry(older), older);
  const applied = { ...manifest, lists: manifest.lists.map((entry) => entry.id === ID ? revised : entry) };
  assert.deepEqual(revisions.undoManifest(applied), manifest);
  assert.deepEqual(revisions.undoManifest(manifest), manifest);
  const source = await text(`src/data/${FILE}`);
  const plan = planDescriptionRevisions({ revisions, manifest, payloadTexts: new Map([[FILE, source]]) });
  assert.equal(revisions.undoPayloadText(FILE, plan.payloads[0].content), source);
  assert.equal(revisions.undoPayloadText(FILE, source), source);
  const library = await loadLibrarySnapshot({ manifest: revisions.undoManifest(applied) });
  assert.equal(library.manifest.lists.find(({ id }) => id === ID).description, current.description);
});

test('separately owned revision records compose without duplicate identities or files', async () => {
  const first = await fixture();
  const secondEntry = { ...first.entries[0], id: 'another-guide', file: 'another_guide.json' };
  const second = sealDescriptionRevisions({ issue: 1156, entries: [secondEntry] });
  const revisions = createDescriptionRevisions(first, undefined, [second]);
  assert.deepEqual(revisions.records.map(({ issue }) => issue), [1075, 1156]);
  assert.deepEqual(revisions.entries.map(({ id }) => id), [ID, 'another-guide']);
  const original = { id: secondEntry.id, out: secondEntry.file, description: secondEntry.before };
  const updated = { ...original, description: secondEntry.after };
  assert.deepEqual(revisions.redoEntry(original), updated);
  assert.deepEqual(revisions.undoEntry(updated), original);
  assert.throws(() => createDescriptionRevisions(first, undefined, [first]), /duplicate revision/);
  const sharedFile = sealDescriptionRevisions({
    issue: 1156, entries: [{ ...secondEntry, file: first.entries[0].file }],
  });
  assert.throws(() => createDescriptionRevisions(first, undefined, [sharedFile]), /duplicate revision file/);
});

test('the record rejects copy that breaks the card rules or the evidence trail', async () => {
  const valid = await fixture();
  const reseal = (entry) => sealDescriptionRevisions({ issue: 1075, entries: [{ ...valid.entries[0], ...entry }] });
  assert.throws(() => reseal({ after: 'Wanda Maximoff \u2014 reshapes reality.' }), /dash/);
  assert.throws(() => reseal({ after: `${'A'.repeat(141)}. Then more.` }), /too long/);
  assert.throws(() => reseal({ support: '' }), /support is empty/);
  assert.throws(() => reseal({ id: 'marvel-knights-to-planet-x-20' }), /owner attachment/);
  assert.throws(() => reseal({ sources: [{ url: 'https://example.com', retrieved: '2026-11-02' }] }), /bad source/);
  assert.throws(() => reseal({ after: valid.entries[0].before }), /changes nothing/);
  assert.throws(() => sealDescriptionRevisions({ issue: 1075, entries: [valid.entries[0], valid.entries[0]] }),
    /duplicate/);
  assert.throws(() => validateDescriptionRevisions({ ...valid, issue: 1076 }), /digest changed/);
});

const CHAPTER = 'marvel-knights-to-planet-x-07';
const CHAPTER_FILE = 'marvel_knights_to_planet_x_07.json';
const CHAPTER_AFTER = 'Spider-Man turns inward while a stranger asks what his powers really are. Fixture copy follows.';

async function chapterFixture() {
  const { descriptionCopy } = await json('scripts/data/marvel-knights-to-planet-x-lists.json');
  const entries = descriptionCopy.entries.map(({ id, sourceHeading, description }) => ({
    id, sourceHeading, before: description, after: id === CHAPTER ? CHAPTER_AFTER : description,
  }));
  const copy = (side) => entries.map(({ id, sourceHeading, ...rest }) => ({ id, sourceHeading, description: rest[side] }));
  return sealChapterDescriptionRevisions({
    issue: 1075,
    previous: { ownerAttachmentSha256: descriptionCopy.ownerAttachmentSha256, entriesSha256: descriptionCopy.entriesSha256 },
    current: { ownerAttachmentSha256: 'a'.repeat(64), entriesSha256: digestJson(copy('after')) },
    entries,
  });
}

test('the committed chapter record supersedes the ledger copy it replaced and names the current one', async () => {
  const { descriptionCopy } = await json('scripts/data/marvel-knights-to-planet-x-lists.json');
  const { chapters } = descriptionRevisions;
  if (chapters.entries.length === 0) return;
  assert.deepEqual(chapters.current, {
    ownerAttachmentSha256: descriptionCopy.ownerAttachmentSha256, entriesSha256: descriptionCopy.entriesSha256,
  });
  assert.notEqual(chapters.previous.entriesSha256, chapters.current.entriesSha256);
  assert.deepEqual(chapters.entries.map(({ id, sourceHeading, after }) => ({ id, sourceHeading, description: after })),
    descriptionCopy.entries);
});

test('chapter history undoes only the exact superseded attachment copy', async () => {
  const revisions = createDescriptionRevisions(await fixture(), await chapterFixture());
  const catalog = await json('src/data/catalog.json');
  const card = catalog.lists.find(({ id }) => id === CHAPTER);
  const revised = { ...card, description: CHAPTER_AFTER };
  assert.deepEqual(revisions.undoEntry(revised), card);
  assert.equal(revisions.undoEntry(card), card);
  assert.deepEqual(revisions.redoEntry(card), revised);
  const older = { ...card, description: 'Copy an older inverse still has to judge.' };
  assert.equal(revisions.undoEntry(older), older);
  assert.throws(() => revisions.undoEntry({ ...revised, file: 'other.json' }), /chapter file changed/);
  const other = catalog.lists.find(({ id }) => id === 'marvel-knights-to-planet-x-08');
  assert.equal(revisions.undoEntry(other), other, 'An unchanged chapter is left alone.');
  const source = await text(`src/data/${CHAPTER_FILE}`);
  const payload = JSON.parse(source);
  const header = `  "description": ${JSON.stringify(payload.description)},`;
  const applied = source.replace(header, () => `  "description": ${JSON.stringify(CHAPTER_AFTER)},`);
  assert.notEqual(applied, source);
  assert.equal(revisions.undoPayloadText(CHAPTER_FILE, applied), source);
  assert.equal(revisions.undoPayloadText(CHAPTER_FILE, source), source);
});

test('the chapter record rejects copy that is not bound to both attachments', async () => {
  const valid = await chapterFixture();
  const record = { ...valid };
  delete record.sha256;
  const reseal = (change) => sealChapterDescriptionRevisions({ ...record, ...change });
  assert.throws(() => reseal({ previous: { ...record.previous, entriesSha256: 'b'.repeat(64) } }), /Superseded/);
  assert.throws(() => reseal({ current: { ...record.current, entriesSha256: 'b'.repeat(64) } }), /Current chapter copy/);
  assert.throws(() => reseal({ entries: record.entries.map((entry, index) =>
    index === 0 ? { ...entry, id: 'house-of-m' } : entry) }), /not a chapter/);
  assert.throws(() => reseal({ previous: null }), /previous digests/);
  assert.throws(() => sealChapterDescriptionRevisions({ issue: 1075, previous: record.previous, current: null, entries: [] }),
    /supersedes no attachment/);
  assert.throws(() => validateChapterDescriptionRevisions({ ...valid, sha256: 'c'.repeat(64) }), /digest changed/);
});
