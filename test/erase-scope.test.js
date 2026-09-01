// What erasing everything reaches, and what it says it reaches.
//
// BL-113 asked which of two promises should win: the erase dialog's claim that it clears
// everything this browser has stored, or the salvage family's rule that nothing but the reader
// removes a copy of data the app could not read. The rule won, so these hold the wording to what
// the route actually does. The behaviour half is in test/storage.test.js, next to the other
// eraseAll tests, because it is a claim about the store rather than about the copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { eraseDialogBody, eraseOutcome } from '../src/js/views/data.js';

// Only the fields the wording reads: how many there are, and whether any of them is live. chars
// and at belong to the row on screen rather than to this sentence, and a fixture that carried
// them would suggest they were read here.
const copy = (key, live = false) => ({ key, live });
const one = [copy('mrt.state.salvage')];
const two = [copy('mrt.state.salvage'), copy('mrt.state.salvage.1700000000000')];
const oneLive = [copy('mrt.state.salvage', true)];
const twoOneLive = [copy('mrt.state.salvage', true), copy('mrt.state.salvage.1700000000000')];

const HEADING = 'Copies kept after a failed read';

// The branch with nothing to disclose, which is not the branch with nothing to correct. It used
// to say the route clears everything this browser has stored for the tracker, and two names
// survive every erase: mrt.settings and sidebar.collapsed are written by the app and removed by
// nothing, so that sentence was false for any reader who had ever changed the theme. It is the
// same defect as the one BL-113 was raised for, in the one branch nobody thought to check
// because it looked like the easy case.
test('with nothing kept aside the dialog claims the lists and the progress, and not the settings', () => {
  const body = eraseDialogBody([]);
  assert.doesNotMatch(body, /everything this browser has stored/);
  assert.match(body, /clears every list and all reading progress/);
  assert.match(body, /settings are kept/);
  assert.match(body, /It cannot be undone\.$/);
  assert.doesNotMatch(body, /kept aside/, 'and it does not raise a subject the reader has no copies in');
});

// The defect the item names. The sentence was true of every state the app can be in except the one
// where something survives, which is the only state in which anyone is misled by it.
test('the dialog stops claiming everything once a copy is being kept aside', () => {
  const body = eraseDialogBody(one);
  assert.doesNotMatch(body, /everything this browser has stored/);
  assert.match(body, /clears every list and all reading progress/);
  assert.match(body, /does not reach it/);
  assert.match(body, /It cannot be undone\.$/, 'the warning is narrowed, not dropped');
});

// Where, not merely whether. A reader told something survived and not told where it is has been
// given a worry rather than a choice, and the copies have their own Remove on the same screen.
test('the dialog says where what survives can be found', () => {
  assert.match(eraseDialogBody(one), new RegExp(`"${HEADING}" above`));
  assert.match(eraseDialogBody(one), /own Remove button/);
});

// The promise the screen behind the dialog does not always keep. renderSalvage() puts a note
// where Remove would be while a copy is live, so a dialog naming that button unconditionally
// sends the reader to a control that is not there, and it does it in the state a copy is
// likeliest to be in: live is what a copy is for as long as the data it copies is still saved,
// which on the erase screen is right up until the moment the reader presses the button.
test('the dialog only names the Remove button when the copy actually has one', () => {
  assert.match(eraseDialogBody(one), /own Remove button/);

  const live = eraseDialogBody(oneLive);
  assert.doesNotMatch(live, /Remove button/, 'the screen is withholding it, so the dialog must not name it');
  assert.match(live, new RegExp(`"${HEADING}" above`), 'but where it is stays said either way');
  assert.match(live, /only you can remove it/);
});

// One live copy out of two is enough to withhold the claim, because the sentence is one sentence
// about all of them and there is no true reading of "their own Remove button" when one has none.
test('one live copy among several withholds the button claim for all of them', () => {
  const said = eraseDialogBody(twoOneLive);
  assert.doesNotMatch(said, /Remove button/);
  assert.match(said, /2 copies of data this app could not read are kept aside/);
  assert.match(said, /only you can remove them/);
});

test('one copy and several copies are counted and agreed with', () => {
  const single = eraseDialogBody(one);
  assert.match(single, /One copy of data this app could not read is kept aside/);
  assert.match(single, /It stays under/);
  assert.match(single, /with its own Remove button/);

  const several = eraseDialogBody(two);
  assert.match(several, /2 copies of data this app could not read are kept aside/);
  assert.match(several, /They stay under/);
  assert.match(several, /with their own Remove button/);
});

// The third answer, and the one a boolean would lose. renderSalvage() already refuses to report an
// empty list when storage declined to enumerate, on the grounds that a refusal to say is not a
// statement that there is nothing. The same refusal must not become a promise here, and it is the
// only direction of this wording that can be wrong in a way that costs the reader data.
test('a browser that will not list its storage is not a browser saying there is nothing', () => {
  const body = eraseDialogBody(null);
  assert.doesNotMatch(body, /everything this browser has stored/);
  assert.match(body, /will not let the app list what else it has stored/);
  assert.match(body, /is not reached/);
});

test('an erase that left nothing behind says so plainly', () => {
  assert.equal(eraseOutcome(false, []), 'All local data erased.');
});

// Byte for byte what shipped before BL-113, because that clause was already right and the item is
// about a different survivor. Pinned rather than assumed: this message is now composed from parts,
// and a composition is exactly where a sentence quietly acquires an extra space or loses a stop.
test('the snapshot sentence is unchanged when the snapshot is the only thing left', () => {
  assert.equal(
    eraseOutcome(true, []),
    'Lists and reading progress erased. One copy could not be removed and is still in this browser, '
      + 'behind "Undo last restore".',
  );
});

test('a salvage copy that survives is named in the message, not only in the dialog', () => {
  const said = eraseOutcome(false, one);
  assert.doesNotMatch(said, /All local data erased/);
  assert.match(said, new RegExp(`One copy kept after a failed read is still here, under "${HEADING}"`));
});

// The two survivors are independent: the snapshot goes when its removal lands, the salvage copies
// never go. So all four combinations are reachable and the message cannot be a choice between two
// strings. This is the combination a ternary cannot express at all.
test('both survivors are reported when both survive', () => {
  const said = eraseOutcome(true, two);
  assert.match(said, /^Lists and reading progress erased\./);
  assert.match(said, /"Undo last restore"/);
  assert.match(said, /2 copies kept after a failed read are still here/);
});

test('a storage that will not enumerate is reported as not having said, in the message too', () => {
  const said = eraseOutcome(false, null);
  assert.doesNotMatch(said, /All local data erased/);
  assert.match(said, /will not list what else it has stored/);
});

// Both sentences send the reader to a heading by name, and a name is a claim about another file.
// Read it from the page rather than trusting it: renaming that section would otherwise leave two
// sentences directing a reader to a heading that is not there, and nothing would notice. The order
// check is the other half of the same claim, because the dialog says "above".
test('the heading the wording names is the heading the page has, and it is above the button', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const heading = html.indexOf(`<h3>${HEADING}</h3>`);
  const button = html.indexOf('id="btn-wipe"');
  assert.ok(heading !== -1, `the page must carry the heading the dialog names: ${HEADING}`);
  assert.ok(button !== -1, 'and the button whose dialog names it');
  assert.ok(heading < button, 'the dialog says "above", so the section has to be above');
  assert.ok(eraseDialogBody(one).includes(`"${HEADING}"`));
  assert.ok(eraseOutcome(false, one).includes(`"${HEADING}"`));
});
// Everything above holds what the two functions say. None of it holds that the button uses them,
// and that gap is not hypothetical: the first version of this file was run against a mutant that
// put the old sentence back at the call site, and every assertion above stayed green. So these
// two read the shipped module, which is what test/shipped-copy.test.js already does for the copy
// that lives outside JavaScript, and for the same reason.
//
// The count is the load-bearing half rather than the match. Reverting the call site does not
// remove the policy, it adds a second copy of the sentence beside it, so a test that only asked
// whether the sentence exists somewhere would pass on the mutant it was written to catch.
test('the erase dialog is built by the policy, not by a literal at the button', () => {
  const dataSrc = readFileSync(new URL('../src/js/views/data.js', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const lead = 'This clears every list and all reading progress. Your settings are kept.';
  const gone = 'clears everything this browser has stored for the tracker';

  assert.equal(dataSrc.split(lead).length - 1, 1, 'a second copy means a call site is building the body inline again');
  assert.equal(
    dataSrc.split(gone).length - 1,
    0,
    'and the sentence two survivors made false must not come back, at the policy or at the button',
  );
  const policy = dataSrc.indexOf('export function eraseDialogBody');
  const next = dataSrc.indexOf('export function eraseOutcome');
  const at = dataSrc.indexOf(lead);
  assert.ok(policy !== -1 && next > policy, 'the two policies must both still be there, in order');
  assert.ok(at > policy && at < next, 'and the lead has to sit inside the policy that composes it');
  assert.match(dataSrc, /body: eraseDialogBody\(getSalvageCopies\(\)\)/);
  assert.match(dataSrc, /export function eraseDialogBody/);
  assert.match(mainSrc, /import.*eraseOutcome.*from.*views\/data\.js/);
});

// The same shape for the message, and the same reason. Asked of storage at the call site rather
// than reusing what the dialog was built from, because the dialog stays open for as long as the
// reader leaves it and another tab can take or remove a copy in that time.
test('the erase message is composed at the button from what storage says then', () => {
  const src = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const plain = "'All local data erased.'";
  const dataSrc = readFileSync(new URL('../src/js/views/data.js', import.meta.url), 'utf8');

  assert.equal(dataSrc.split(plain).length - 1, 1, 'a second copy means the button is choosing a string again');
  assert.ok(dataSrc.indexOf(plain) > dataSrc.indexOf('export function eraseOutcome'));
  assert.match(src, /announceIfSaved\(eraseOutcome\(snapshotKept, store\.salvageCopies\(\)\)\)/);
});

// The list the two sentences above send the reader to is painted on arrival at that screen, and
// the erase happens without an arrival because the button is on it. Both outcomes move a row: an
// erase that lands makes a live copy removable, and an erase that is refused can create the first
// copy this browser has held. So the surface naming copies has to be rebuilt before the message
// that names them is said. test/storage.test.js holds the store half of both.
test('the erase route repaints the salvage list, and does it before it speaks', () => {
  const src = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const repaint = src.indexOf('recoveryView.renderSalvage()');
  const speak = src.indexOf('announceIfSaved(eraseOutcome(');
  assert.ok(repaint !== -1, 'the erase route has to rebuild the list it now describes');
  assert.ok(repaint < speak, 'and rebuild it before describing it, or the two disagree on screen');
});
