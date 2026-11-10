import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DATA_DIR, build, checkEdition, fetchLive, loadInputs, minimiseGcdIssue, render, run, validate,
} from '../scripts/collected-editions.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const inputs = () => loadInputs();

function fixtureWith(stories, extra = {}) {
  return {
    url: 'https://www.comics.org/api/issue/1/?format=json',
    retrievedAt: '2026-11-10T00:00:00.000Z',
    issue: { notes: '', variant_of: null, story_set: stories, ...extra },
  };
}

function editionWith(gcdCheck, contents = [{ seriesId: 7, from: 1, to: 2, assertedBy: 'owner-curated', basis: 'x' }]) {
  return { id: 'e', gcdIssueId: 1, contents, gcdCheck };
}

test('the committed pilot outputs are current and valid', () => {
  const lines = [];
  assert.deepEqual(run({ log: (line) => lines.push(line) }), []);
  assert.equal(lines.length, 5);
});

test('outputs do not depend on the clock', () => {
  const first = Object.values(build(inputs())).map(render).join('');
  const realNow = Date.now;
  Date.now = () => 0;
  try {
    assert.equal(Object.values(build(inputs())).map(render).join(''), first);
  } finally {
    Date.now = realNow;
  }
});

test('database-derived facts stay in the share-alike file', () => {
  const outputs = build(inputs());
  assert.equal(outputs['gcd-editions.json'].license, 'CC BY-SA 4.0');
  const neutral = JSON.stringify(outputs['editions.json']) + JSON.stringify(outputs['cbh-edition-facts.json']);
  for (const leak of ['story_set', 'isbn', 'publicationDate', 'comics.org']) assert.ok(!neutral.includes(leak), leak);
});

test('minimising a database record drops covers and keeps credit', () => {
  const fixture = minimiseGcdIssue({
    url: 'u',
    retrievedAt: 't',
    body: JSON.stringify({
      cover: 'https://files1.comics.org/x.jpg',
      notes: ' a\n b ',
      story_set: [{ type: 'cover', title: 'c' }, { type: 'comic story', title: 'Part  One', sequence_number: 3 }],
    }),
  });
  assert.equal(fixture.license, 'CC BY-SA 4.0');
  assert.equal(fixture.issue.notes, 'a b');
  assert.ok(!('cover' in fixture.issue));
  assert.deepEqual(fixture.issue.story_set.map((story) => story.title), ['Part One']);
});

test('story titles verify only when every curated title is present', () => {
  const check = { tier: 'gcd-story-titles', storyTitles: { 1: 'A', 2: 'B' } };
  const good = checkEdition(editionWith(check), fixtureWith([
    { type: 'comic story', title: 'A', sequence_number: 1 },
    { type: 'comic story', title: 'B', sequence_number: 2 },
  ]), {});
  assert.equal(good.status, 'verified');
  assert.deepEqual([...good.verified], ['7:1', '7:2']);
  const bad = checkEdition(editionWith(check), fixtureWith([{ type: 'comic story', title: 'A', sequence_number: 1 }]), {});
  assert.equal(bad.status, 'conflict');
  assert.equal(bad.verified.size, 0);
  // Same count, wrong title: the count alone must not let the edition verify.
  const renamed = checkEdition(editionWith(check), fixtureWith([
    { type: 'comic story', title: 'A', sequence_number: 1 },
    { type: 'comic story', title: 'C', sequence_number: 2 },
  ]), {});
  assert.equal(renamed.status, 'conflict');
  assert.equal(renamed.verified.size, 0);
});

test('a matching story count is consistent but never verified', () => {
  const result = checkEdition(editionWith({ tier: 'gcd-count-only', expectedComicStories: 2 }), fixtureWith([
    { type: 'comic story', sequence_number: 1 },
    { type: 'comic story', sequence_number: 2 },
  ]), {});
  assert.equal(result.status, 'consistent');
  assert.equal(result.verified.size, 0);
});

test('a count mismatch is recorded with its evidence, not resolved', () => {
  const result = checkEdition(editionWith({ tier: 'gcd-count-only', expectedComicStories: 2 }), fixtureWith([
    { type: 'comic story', sequence_number: 1 },
    { type: 'comic story', sequence_number: 2 },
    { type: 'comic story', sequence_number: 5 },
  ]), {});
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts[0].evidence.sequences, [1, 2, 5]);
});

test('indexer notes verify full ranges and flag partial material', () => {
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: 'X (Marvel, 2015 series)', partialSeries: 'Y (Marvel, 2015 series)' }, [
    { seriesId: 7, from: 1, to: 2, assertedBy: 'gcd-notes', basis: 'x' },
    { seriesId: 8, from: 0, to: 0, portion: 'partial', assertedBy: 'gcd-notes', basis: 'x' },
  ]);
  const result = checkEdition(edition, fixtureWith([], {
    notes: 'Collects X (Marvel, 2015 series) #1-2 and material from Y (Marvel, 2015 series) #0',
  }), { 7: 'X (2015)' });
  assert.deepEqual([...result.verified], ['7:1', '7:2']);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.kind), ['material-from']);
  const year = checkEdition(edition, fixtureWith([], { notes: 'X (Marvel, 2015 series) #1-2' }), { 7: 'X (2016)' });
  assert.ok(year.conflicts.some((conflict) => conflict.kind === 'series-year'));
});

test('pilot coverage records the hard cases', () => {
  const lists = Object.fromEntries(build(inputs())['editions.json'].lists.map((list) => [list.listId, list]));
  const kinds = (id) => lists[id].findings.map((finding) => finding.kind);
  assert.equal(lists.civil_war_avengers.verifiedRows, 18);
  assert.ok(kinds('nebula_reading_order').includes('partial-selection'));
  assert.ok(kinds('avengers_doomsday_secret_wars').includes('overlap'));
  assert.equal(lists.avengers_doomsday_secret_wars.partialRows, 1);
  assert.ok(kinds('realm_of_kings').includes('variant-printing'));
  assert.ok(kinds('the_unbeatable_squirrel_girl').includes('group-wider-than-edition'));
});

test('validation rejects store links, covers and unresolved references', () => {
  const data = inputs();
  const outputs = build(data);
  assert.deepEqual(validate(data, outputs), []);
  const broken = clone(data);
  broken.pilot.editions[0].contents[0].basis = 'see https://www.amazon.com/dp/1?tag=x';
  broken.pilot.editions[1].cover = 'x';
  broken.pilot.editions[2].printingOf = 'missing';
  broken.pilot.lists[0].groups[0].editions.push('nope');
  const errors = validate(broken, outputs).join('\n');
  for (const want of ['store or affiliate link', 'cover data', 'printingOf does not resolve', 'unknown edition nope']) {
    assert.match(errors, new RegExp(want));
  }
});

test('the check fails when a derived file drifts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'editions-'));
  try {
    cpSync(DATA_DIR, dir, { recursive: true });
    const file = path.join(dir, 'editions.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"schemaVersion": 1', '"schemaVersion": 2'));
    assert.deepEqual(run({ dir, log: () => {} }), ['editions.json is stale; run with --write']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the live lookup refuses to exceed its hourly budget', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gcd-ledger-'));
  const ledgerFile = path.join(dir, 'ledger.json');
  try {
    writeFileSync(ledgerFile, JSON.stringify({ calls: Array(25).fill(1000), notBefore: 0 }));
    const fetchImpl = () => assert.fail('must not fetch');
    await assert.rejects(fetchLive(5, { fetchImpl, now: () => 2000, ledgerFile }), /25 calls/);
    writeFileSync(ledgerFile, JSON.stringify({ calls: [], notBefore: 9000 }));
    await assert.rejects(fetchLive(5, { fetchImpl, now: () => 2000, ledgerFile }), /wait until/);
    await assert.rejects(fetchLive('../x', { fetchImpl, ledgerFile }), /numeric/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
