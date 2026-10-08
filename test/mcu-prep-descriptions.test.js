import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import {
  historicalMcuDescriptionEntry, historicalMcuDescriptionManifest,
  historicalMcuDescriptionPayloadText,
} from './helpers/reading-choice-history.mjs';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const hash = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const expectedIds = [
  'mcu-prep-deadpool-and-wolverine', 'mcu-prep-daredevil-born-again', 'mcu-prep-thunderbolts',
  'mcu-prep-fantastic-four-first-steps', 'avengers-doomsday-secret-wars',
  'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'mcu-prep-eternals',
  'spider-man-no-way-home', 'mcu-prep-moon-knight', 'doctor-strange-multiverse-of-madness',
];

test('MCU descriptions require the exact refreshed copy on every current surface', async () => {
  const [revision, manifest, catalog] = await Promise.all([
    json('test/fixtures/mcu-prep-description-refresh.json'),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
  ]);
  const { sha256, ...capture } = revision;
  assert.equal(capture.sourceCommit, '1389e546de45b76844325cf149a6b7911829d360');
  assert.equal(capture.issue, 'https://github.com/raymond-nassar/recap-page/issues/731');
  assert.equal(sha256, '6333cf20651e02519060549f043a32883a64e0413af64621e5f19831c0b11e2a');
  assert.equal(hash(JSON.stringify(capture)), sha256);
  assert.deepEqual(capture.entries.map((entry) => entry.id), expectedIds);
  const parsed = parseCatalog(catalog);
  assert.equal(parsed.dropped, 0);
  for (const edit of capture.entries) {
    const entry = manifest.lists.find((row) => row.id === edit.id);
    const card = catalog.lists.find((row) => row.id === edit.id);
    const payload = await json(`src/data/${edit.file}`);
    assert.equal(manifest.lists.filter((row) => row.id === edit.id).length, 1, edit.id);
    assert.equal(catalog.lists.filter((row) => row.id === edit.id).length, 1, edit.id);
    assert.equal(entry.out, edit.file, edit.id);
    assert.equal(card.file, edit.file, edit.id);
    assert.equal(payload.id, edit.id);
    assert.equal(entry.description, edit.after, `${edit.id}: current manifest description`);
    assert.equal(card.description, edit.after, `${edit.id}: current catalog description`);
    assert.equal(parsed.lists.find((row) => row.id === edit.id).description, edit.after, edit.id);
    assert.equal(payload.description, edit.after, `${edit.id}: current payload description`);
    assert.equal(card.name, entry.name, edit.id);
    assert.equal(payload.name, entry.name, edit.id);
    assert.doesNotMatch(edit.after, /[\u2013\u2014]/);
  }
  assert.equal(manifest.lists.find((row) => row.id === 'avengers-doomsday-secret-wars').name,
    'Avengers: Doomsday & Avengers: Secret Wars');
  assert.match(capture.entries.find((row) => row.id === 'mcu-prep-thunderbolts').after,
    /Thunderbolts \(1997\) #-1 is still missing provider details; the other 34 comics are included\.$/);
  assert.match(capture.entries.find((row) => row.id === 'mcu-prep-fantastic-four-first-steps').after,
    /whole anthology, including stories beyond its Silver Surfer material\.$/);
});

test('MCU description history inverts only exact current copy and preserves every other value', async () => {
  const [revision, manifest, catalog, historyText] = await Promise.all([
    json('test/fixtures/mcu-prep-description-refresh.json'),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    text('test/fixtures/reading-choice-history.json'),
  ]);
  assert.equal(hash(historyText), revision.readingChoiceHistoryLfSha256);
  for (const edit of revision.entries) {
    const entry = manifest.lists.find((row) => row.id === edit.id);
    const card = catalog.lists.find((row) => row.id === edit.id);
    const payloadText = await text(`src/data/${edit.file}`);
    const originalEntry = historicalMcuDescriptionEntry(entry);
    assert.notEqual(originalEntry, entry);
    assert.deepEqual(originalEntry, { ...entry, description: edit.before });
    assert.equal(entry.description, edit.after);
    assert.equal(digestCanonicalJson(originalEntry), edit.manifestSha256, edit.id);
    assert.equal(digestCanonicalJson(historicalMcuDescriptionEntry(card)), edit.catalogSha256, edit.id);
    const originalText = historicalMcuDescriptionPayloadText(edit.file, payloadText);
    assert.equal(hash(originalText), edit.payloadLfSha256, `${edit.id}: complete original payload bytes`);
    assert.equal(digestCanonicalJson(JSON.parse(originalText)), edit.payloadSha256, edit.id);
    assert.deepEqual(JSON.parse(originalText), { ...JSON.parse(payloadText), description: edit.before });
    assert.equal(hash(historicalMcuDescriptionPayloadText(
      edit.file, payloadText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
    )), edit.payloadLfSha256, `${edit.id}: Windows line endings preserve the same original`);
    for (const description of [edit.before, 'Unrecorded copy.', undefined]) {
      assert.throws(() => historicalMcuDescriptionEntry({ ...entry, description }),
        /expected exact current description/, edit.id);
    }
    assert.throws(() => historicalMcuDescriptionEntry({ ...entry, id: 'wrong-guide' }),
      /identity does not match/, edit.id);
    assert.throws(() => historicalMcuDescriptionEntry({ ...entry, out: 'wrong_payload.json' }),
      /payload identity does not match/, edit.id);
    assert.throws(() => historicalMcuDescriptionPayloadText(
      edit.file, JSON.stringify({ ...JSON.parse(payloadText), id: 'wrong-guide' }, null, 2),
    ), /identity does not match/, edit.id);
    const renamed = historicalMcuDescriptionEntry({ ...entry, name: 'Unapproved title' });
    assert.equal(renamed.name, 'Unapproved title');
    assert.notEqual(digestCanonicalJson(renamed), edit.manifestSha256, edit.id);
    const redated = historicalMcuDescriptionPayloadText(edit.file,
      `${JSON.stringify({ ...JSON.parse(payloadText), generatedAt: '2099-01-01T00:00:00.000Z' }, null, 2)}\n`);
    assert.equal(JSON.parse(redated).generatedAt, '2099-01-01T00:00:00.000Z');
    assert.notEqual(hash(redated), edit.payloadLfSha256, edit.id);
    assert.notEqual(digestCanonicalJson(JSON.parse(redated)), edit.payloadSha256, edit.id);
  }
  const reconstructed = historicalMcuDescriptionManifest(manifest);
  assert.deepEqual(reconstructed.lists.map((row) => row.id), manifest.lists.map((row) => row.id));
  assert.deepEqual(reconstructed.paths, manifest.paths);
  assert.ok(reconstructed.lists.some((row) => row.id === 'avengers-doomsday-secret-wars'));
  for (const entry of manifest.lists.filter((row) => !expectedIds.includes(row.id))) {
    assert.equal(historicalMcuDescriptionEntry(entry), entry, `${entry.id}: non-target identity`);
  }
  assert.equal((await json('src/data/hickman_minimal.json')).count, 69);
});
