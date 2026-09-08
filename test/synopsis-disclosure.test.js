import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynopsisDisclosure, renderSynopsisDescription } from '../src/js/lib/synopsisDisclosure.js';
import { NO_SYNOPSIS } from '../src/js/synopsis.js';

test('447 disclosure retains exact numeric identity only until clear or a fresh tab', () => {
  const disclosure = createSynopsisDisclosure();
  assert.equal(disclosure.isRevealed(42), false);
  disclosure.reveal(42);
  assert.equal(disclosure.isRevealed('42'), true);
  assert.equal(disclosure.isRevealed(43), false);
  assert.equal(createSynopsisDisclosure().isRevealed(42), false);
  disclosure.toggle('42');
  assert.equal(disclosure.isRevealed(42), false);
  disclosure.reveal(42);
  disclosure.clear();
  assert.equal(disclosure.isRevealed(42), false);
});

test('447 typed session entries distinguish plot prose from identical English fallback text', () => {
  const disclosure = createSynopsisDisclosure();
  const issue = { issueId: 42, title: 'Synthetic issue' };
  const fallback = 'No synopsis is recorded for this issue.';
  const button = { setAttribute(name, value) { this[name] = value; } };
  const description = { id: 'description' };
  const render = (entry) => renderSynopsisDescription({ button, description, issue, entry, fallback, disclosure });
  for (const entry of [undefined, null, NO_SYNOPSIS, '', '  ']) {
    render(entry);
    assert.equal(description.textContent, fallback);
    assert.equal(description.hidden, false);
    assert.equal(button.hidden, true);
    assert.equal(button['aria-expanded'], 'false');
  }
  render(fallback);
  assert.equal(description.textContent, '');
  assert.equal(description.hidden, true);
  assert.equal(button.hidden, false);
  disclosure.reveal(42);
  render(fallback);
  assert.equal(description.textContent, fallback);
  assert.equal(description.hidden, false);
  assert.equal(button['aria-expanded'], 'true');
  assert.match(button['aria-label'], /Hide description: Synthetic issue/);
});
