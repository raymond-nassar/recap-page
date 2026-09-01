// Notes: BL-017. The persistence tests here are the point of the file. `coerce` rebuilds state
// field by field, and `exportBackup` names its keys one by one, so a note that is not carried
// through both is written to nothing and read back as nothing, with no error anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEmptyState, createList, duplicateList, deleteList, addIssuesToList, listItems,
  setIssueNote, setListNote, issueNote, normalizeNote, migrate, exportBackup, validateBackup,
  SCHEMA_VERSION, MAX_NOTE,
} from '../src/js/lib/model.js';
import { serializeChecklist, parseChecklist } from '../src/js/lib/markdown.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const seeded = () => {
  const s = createList(createEmptyState(), { name: 'House of M', id: 'list-hom' });
  return addIssuesToList(s, 'list-hom', [
    { issueId: 6482, title: 'House of M (2005) #1' },
    { issueId: 6483, title: 'House of M (2005) #2' },
  ]).state;
};

// ------------------------------------------------------------------ shape

test('a fresh state carries a notes map, so nothing has to guess whether it exists', () => {
  assert.deepEqual(createEmptyState().notes, {});
});

test('a note is trimmed and capped', () => {
  assert.equal(normalizeNote('  spacious  '), 'spacious');
  assert.equal(normalizeNote('x'.repeat(MAX_NOTE + 500)).length, MAX_NOTE);
  assert.equal(normalizeNote(null), '');
  assert.equal(normalizeNote(undefined), '');
});

test('an empty note deletes the key rather than storing an empty string', () => {
  let s = setIssueNote(seeded(), 6482, 'Wanda breaks reality here.');
  assert.equal(issueNote(s, 6482), 'Wanda breaks reality here.');
  assert.ok(Object.prototype.hasOwnProperty.call(s.notes, 6482));

  s = setIssueNote(s, 6482, '   ');
  assert.equal(issueNote(s, 6482), '');
  assert.equal(
    Object.prototype.hasOwnProperty.call(s.notes, 6482),
    false,
    'a cleared note must not survive as an empty string, or every backup carries it forever',
  );
});

test('a note on an unusable issue id is refused rather than stored under NaN', () => {
  const s = seeded();
  assert.equal(setIssueNote(s, 'banana', 'hello'), s);
  assert.equal(setIssueNote(s, 0, 'hello'), s);
});

test('a note on a list that is not there changes nothing', () => {
  const s = seeded();
  assert.equal(setListNote(s, 'list-nope', 'hello'), s);
});

// ------------------------------------------------------------------ persistence

test('an issue note survives the save and load round trip', () => {
  const s = setIssueNote(seeded(), 6482, 'The best issue in the order.');
  const round = migrate(JSON.parse(JSON.stringify(exportBackup(s))));
  assert.equal(issueNote(round, 6482), 'The best issue in the order.');
});

test('a list note survives the save and load round trip', () => {
  const s = setListNote(seeded(), 'list-hom', 'Read this before Decimation.');
  const round = migrate(JSON.parse(JSON.stringify(exportBackup(s))));
  assert.equal(round.lists['list-hom'].note, 'Read this before Decimation.');
});

// exportBackup names its keys rather than spreading, so a map it does not name never reaches the
// file at all. That failure is invisible from the load side, which is why it is asserted here.
test('the exported backup actually contains the notes map', () => {
  const s = setIssueNote(seeded(), 6482, 'Kept.');
  const backup = exportBackup(s);
  assert.deepEqual(backup.notes, { 6482: 'Kept.' });
});

test('a state saved before notes existed loads without them and without throwing', () => {
  const before = {
    schemaVersion: SCHEMA_VERSION,
    issues: {},
    read: {},
    overrides: {},
    lists: { 'list-old': { id: 'list-old', name: 'Old', description: '', created: 1, itemIds: [] } },
    listOrder: ['list-old'],
    active: 'list-old',
  };
  const round = migrate(before);
  assert.deepEqual(round.notes, {}, 'a missing notes map becomes an empty one, never undefined');
  assert.equal(round.lists['list-old'].note, '', 'a list with no note reads as empty, not undefined');
  assert.equal(issueNote(round, 6482), '');
});

test('a v1 backup, which predates notes entirely, still migrates', () => {
  const round = migrate({
    schemaVersion: 1,
    lists: [{ name: 'Ancient', items: [{ issueId: 6482, title: 'One', read: true }] }],
  });
  assert.deepEqual(round.notes, {});
});

test('a backup whose notes map is the wrong shape is refused, not coerced', () => {
  const bad = validateBackup({ schemaVersion: SCHEMA_VERSION, notes: [] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /notes must be an object/);
});

test('a stored note that is not usable text is dropped on load rather than reaching the screen', () => {
  const round = migrate({
    schemaVersion: SCHEMA_VERSION,
    notes: { 6482: '   ', 0: 'zero is not an issue id', banana: 'nor is this' },
    lists: {},
    listOrder: [],
  });
  assert.deepEqual(round.notes, {});
});

// ------------------------------------------------------------------ list lifecycle

test('a duplicate carries the note, because it is still about that reading order', () => {
  const s = setListNote(seeded(), 'list-hom', 'Skip the tie-ins.');
  const { state: after, listId: copyId } = duplicateList(s, 'list-hom');
  assert.equal(after.lists[copyId].note, 'Skip the tie-ins.');
});

// Deliberately asymmetric, and both halves matter. The list note dies with the list because it
// was about the list. The issue note outlives it for the same reason read state does: the issue
// is still in the library and may be in another order.
test('deleting a list takes its note but leaves issue notes alone', () => {
  let s = setListNote(seeded(), 'list-hom', 'About the order.');
  s = setIssueNote(s, 6482, 'About the issue.');
  const after = deleteList(s, 'list-hom');
  assert.equal(after.lists['list-hom'], undefined);
  assert.equal(issueNote(after, 6482), 'About the issue.');
});

test('a row carries its note, so the view does not have to reach into state itself', () => {
  const s = setIssueNote(seeded(), 6483, 'Wanda again.');
  const rows = listItems(s, 'list-hom');
  assert.equal(rows.find((r) => r.issueId === 6483).note, 'Wanda again.');
  assert.equal(rows.find((r) => r.issueId === 6482).note, '');
});

// ------------------------------------------------------------------ markdown export

test('notes are exported as quoted lines under what they belong to', () => {
  const md = serializeChecklist({
    name: 'House of M',
    note: 'Read before Decimation.',
    items: [{ issueId: 6482, title: 'HoM #1', read: true, note: 'The best one.' }],
  });
  assert.match(md, /^> Read before Decimation\.$/m);
  assert.match(md, /^> The best one\.$/m);
});

test('a multi-line note is quoted on every line, not just the first', () => {
  const md = serializeChecklist({
    name: 'X',
    items: [{ issueId: 1, title: 'One', read: false, note: 'first\nsecond' }],
  });
  assert.match(md, /^> first$/m);
  assert.match(md, /^> second$/m);
});

// The prefix is the whole reason quoteNote exists. Without it a note beginning "- " is read back
// as an item and a note beginning "# " as a heading, so exporting and re-importing a list would
// invent issues the reader never added.
test('a note that looks like Markdown does not become an item when the export is parsed back', () => {
  const md = serializeChecklist({
    name: 'X',
    items: [{ issueId: 6482, title: 'HoM #1', read: false, note: '- [ ] not a real item\n# not a heading' }],
  });
  const { entries, unresolved, headings } = parseChecklist(md);
  assert.equal(entries.length, 1, 'the one real item, and nothing invented from the note');
  assert.equal(entries[0].issueId, 6482);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(headings, ['X'], 'only the list name, not the note line that starts with a hash');
});

test('a list with no notes exports exactly as it did before notes existed', () => {
  const args = { name: 'X', description: 'D', items: [{ issueId: 1, title: 'One', read: false }] };
  assert.equal(serializeChecklist(args), serializeChecklist({ ...args, note: '' }));
  assert.equal(serializeChecklist(args).includes('>'), false);
});

// Notes (BL-017) and collected editions (BL-066) were built on separate branches and first met in
// the merge, and they meet inside serializeChecklist, which now writes both a "## " heading per
// edition and a "> " line per note. Neither branch could have tested the combination. The risk is
// specific: a quoted note sits between two items, so if quoting failed it would be read back as an
// item inside whichever book it followed, silently growing that edition by an issue.
test('a note inside a collected edition does not disturb the edition it sits in', () => {
  const md = serializeChecklist({
    name: 'Ultimate Universe',
    note: 'Start here.\n- not an item',
    items: [
      { issueId: 1, title: 'Invasion #1', read: true, collectedIn: 'Ultimate Invasion', note: 'Great opener.' },
      { issueId: 2, title: 'Invasion #2', read: false, collectedIn: 'Ultimate Invasion', note: '# not a heading' },
      { issueId: 3, title: 'Universe #1', read: false, collectedIn: 'Ultimate Universe One' },
    ],
  });
  const { entries, unresolved, headings } = parseChecklist(md);
  assert.equal(entries.length, 3, 'the three real items, and nothing invented from three notes');
  assert.deepEqual(unresolved, []);
  assert.deepEqual(
    entries.map((e) => e.section),
    ['Ultimate Invasion', 'Ultimate Invasion', 'Ultimate Universe One'],
    'every issue is read back into the book it was exported from',
  );
  assert.deepEqual(
    headings,
    ['Ultimate Universe', 'Ultimate Invasion', 'Ultimate Universe One'],
    'the two edition headings and the list name, and nothing from the notes',
  );
});

// ------------------------------------------------------------------ wiring

// ask.js is imported by main.js, which reads `document` at module scope, so this is checked as
// text like the other main.js wiring tests.
test('the note editor distinguishes clearing from cancelling', () => {
  const ask = read('src/js/ask.js');
  assert.match(ask, /export async function askNote/, 'askNote exists');
  assert.match(
    ask,
    /return ok \? area\.trim\(\) : null;/,
    'an emptied note resolves to the empty string, and only backing out resolves null',
  );
});

test('the note field is never required, or an emptied note could not be submitted', () => {
  const ask = read('src/js/ask.js');
  assert.equal(
    /area\.required = /.test(ask),
    false,
    'setting required on the textarea would refuse the submit that clears a note',
  );
});

test('the view acts on a cleared note and ignores a cancelled one', () => {
  const reading = read('src/js/views/reading.js');
  assert.equal(
    (reading.match(/if \(note === null\) return;/g) || []).length,
    2,
    'both note editors test for null explicitly rather than for falsiness',
  );
});

test('the note control stays out of the row action cluster, which is already full', () => {
  const reading = read('src/js/views/reading.js');
  const cluster = reading.slice(reading.indexOf("el('div', { class: 'ract', id: panelId }"));
  const end = cluster.indexOf('      ]));');
  assert.equal(
    cluster.slice(0, end).includes("act: 'note'"),
    false,
    'the note control belongs in the text column, not beside the six existing buttons',
  );
  assert.match(reading, /class: `rnote/, 'the note control exists');
});

// An aria-label replaces the element's contents in the accessible name rather than adding to it,
// so a label naming only the action hides the note itself from the one reader who cannot see it.
// Found in review, and nothing else in the suite or the gates would catch it coming back.
test('a screen reader is told what the note says, not just that one exists', () => {
  const reading = read('src/js/views/reading.js');
  const label = /'aria-label': item\.note\s*\n?\s*\?\s*`([^`]*)`/.exec(reading);
  assert.ok(label, 'the note control still labels itself conditionally');
  assert.match(
    label[1],
    /\$\{item\.note\}/,
    'the note text is part of the accessible name, not replaced by it',
  );
  assert.match(label[1], /\$\{item\.title\}/, 'and the label still says which issue it is about');
  // Measured in Edge: a note typed as "Wanda breaks reality." announced as "here.. Select to edit
  // it." when the action trailed the note. The note is the one part the app does not punctuate.
  assert.match(
    label[1],
    /\$\{item\.note\}$/,
    'the note ends the label, so the app never punctuates after the reader\u2019s own words',
  );
});
