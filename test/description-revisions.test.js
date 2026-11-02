import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDescriptionRevisions, describeDescriptionRevision, descriptionRevisions, planDescriptionRevisions,
  sealDescriptionRevisions, validateDescriptionRevisions,
} from '../scripts/lib/description-revisions.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';

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
    const entry = manifest.lists.find(({ id }) => id === edit.id);
    const payload = await json(`src/data/${edit.file}`);
    const card = catalog.lists.find(({ id }) => id === edit.id);
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
