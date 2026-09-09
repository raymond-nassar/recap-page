import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynopsisDisclosure, renderSynopsisDescription } from '../src/js/lib/synopsisDisclosure.js';
import { NO_SYNOPSIS } from '../src/js/synopsis.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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

test('445 shared live policy shows held prose without controls only when hiding is off', () => {
  let hiding = true;
  const disclosure = createSynopsisDisclosure({ hiding: () => hiding });
  const button = { setAttribute() {} };
  const description = { id: 'description' };
  const render = (entry) => renderSynopsisDescription({
    button, description, entry, issue: { issueId: 42, title: 'Synthetic' },
    fallback: 'No description.', disclosure,
  });
  render('Held plot');
  assert.equal(description.hidden, true);
  hiding = false;
  render('Held plot');
  assert.equal(description.textContent, 'Held plot');
  assert.equal(button.hidden, true);
  assert.equal(disclosure.isRevealed(42), false);
  for (const entry of [undefined, NO_SYNOPSIS, '']) {
    render(entry);
    assert.equal(description.textContent, 'No description.');
    assert.equal(button.hidden, true);
  }
  hiding = true;
  render('Held plot');
  assert.equal(description.hidden, true);
});

test('445 actual preference transitions clear choices while unchanged values and save failures stay truthful', () => {
  const source = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const setter = source.slice(source.indexOf('function setDescriptionHiding('), source.indexOf('function applyReadingShortcutSetting('));
  const settings = { hideDescriptions: true };
  const disclosure = createSynopsisDisclosure({ hiding: () => settings.hideDescriptions });
  let saved = true;
  const reports = [];
  const calls = [];
  const controls = { checked: true, replaceChildren() { reports.length = 0; } };
  const context = {
    settings, synopsisDisclosure: disclosure, saveSettings: () => saved,
    $: () => controls, notify: (...args) => reports.push(args), announce: (text) => calls.push(text),
    readingView: { renderHero() { calls.push('Reading'); } },
    issueView: { refreshDescription() { calls.push('Details'); } },
  };
  runInNewContext(`${setter}\nthis.setMode = setDescriptionHiding;`, context);
  disclosure.reveal(42);
  const generation = disclosure.generation();
  context.setMode(true);
  assert.equal(disclosure.generation(), generation);
  assert.equal(disclosure.isRevealed(42), true);
  context.setMode(false);
  assert.equal(disclosure.isRevealed(42), false);
  assert.equal(disclosure.generation(), generation + 1);
  assert.ok(calls.includes('Reading') && calls.includes('Details'));
  disclosure.reveal(42);
  saved = false;
  const before = calls.length;
  context.setMode(true);
  assert.equal(disclosure.isRevealed(42), false);
  assert.equal(settings.hideDescriptions, true);
  assert.match(reports.at(-1)[1], /could not be saved.*reload/);
  assert.deepEqual(calls.slice(before), ['Reading', 'Details']);
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
