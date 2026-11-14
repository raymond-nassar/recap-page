import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DATA_DIR, build, checkEdition, databaseLeaks, fetchLive, loadInputs, minimiseGcdIssue, notesStateRange, render, run,
  validate, validateSeriesCrosswalk,
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
  const data = inputs();
  for (const [name, value] of [['pilot.json', data.curated], ['editions.json', outputs['editions.json']],
    ['cbh-edition-facts.json', outputs['cbh-edition-facts.json']]]) {
    assert.deepEqual(databaseLeaks(value, name), []);
  }
});

test('validation rejects a database fact placed in an MIT-licensed file', () => {
  const data = inputs();
  const outputs = build(data);
  const leaky = clone(data);
  leaky.curated.editions[0].gcdCheck.storyTitles = { 1: 'A' };
  leaky.curated.editions[1].contents.push({ seriesId: 1, from: 1, to: 1, assertedBy: 'gcd-notes', basis: 'x' });
  leaky.curated.editions[2].title = 'Secret Wars (Marvel, 2015 series)';
  const errors = validate(leaky, outputs).filter((error) => error.includes('MIT-licensed'));
  assert.equal(errors.length, 3, errors.join('\n'));
});

test('MIT-licensed files never state which book is a printing of which', () => {
  const data = inputs();
  const outputs = build(data);
  const ids = data.curated.editions.map((edition) => edition.id);
  assert.ok(!ids.some((id) => /printing/.test(id)), ids.join(', '));
  for (const text of ['Curated as a later printing of the 2010 book.', 'x-2014-tpb-second-printing', 'A Second Edition.']) {
    const leaky = clone(data);
    leaky.curated.editions[0].contents[0].basis = text;
    assert.equal(validate(leaky, outputs).filter((error) => error.includes('MIT-licensed')).length, 1, text);
  }
});

test('a printing link and notes ranges come only from the share-alike inputs', () => {
  const { curated, gcdInputs, pilot } = inputs();
  const merged = Object.fromEntries(pilot.editions.map((edition) => [edition.id, edition]));
  assert.ok(!curated.editions.some((edition) => 'printingOf' in edition));
  assert.equal(merged['realm-of-kings-tpb-2601361'].printingOf, gcdInputs.editions['realm-of-kings-tpb-2601361'].printingOf);
  assert.ok(merged['secret-wars-2015-hc'].contents.every((range) => range.assertedBy === 'gcd-notes'));
});

test('Imperial keeps matched full originals while holding the additional story in issue 126', () => {
  const data = inputs();
  const edition = data.pilot.editions.find((entry) => entry.id === 'new-xmen-v2-imperial');
  const book = data.fixtures[edition.gcdIssueId].issue;
  const originals = edition.gcdCheck.originalIssues;
  assert.deepEqual(originals.map((entry) => entry.appNumber), [118, 119, 120, 121, 122, 123, 124, 125, 126]);
  assert.equal(new Set(Object.values(edition.gcdCheck.storyTitles)).size, 8);
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const credit = (value) => normalize((value || '').replace(/\s*\(credited(?: as [^)]*)?\)/gi, ''));
  for (const reference of originals) {
    const source = data.fixtures[reference.gcdIssueId];
    const original = source.issue;
    const stories = original.story_set.filter((entry) => entry.type === 'comic story');
    const story = book.story_set.find((entry) => entry.sequence_number === reference.collectionSequence);
    const main = stories.find((entry) => normalize(entry.title) === normalize(story.title));
    const list = data.lists[`marvel-knights-to-planet-x-${reference.appNumber <= 122 ? '12' : '15'}`];
    const app = list.items.filter((entry) => entry.seriesId === 2281 && entry.number === String(reference.appNumber));
    assert.equal(app.length, 1);
    assert.equal(app[0].seriesName, 'New X-Men (2001 - 2004)');
    assert.equal(source.url, `https://www.comics.org/api/issue/${reference.gcdIssueId}/?format=json`);
    assert.equal(original.api_url, source.url);
    assert.equal(original.series, 'https://www.comics.org/api/series/9855/?format=json');
    assert.equal(original.series_name, 'New X-Men (2001 series)');
    assert.equal(original.number, String(reference.appNumber));
    assert.equal(original.variant_of, null);
    assert.equal(stories.length, reference.appNumber === 126 ? 2 : 1);
    assert.ok(main, `original #${reference.appNumber} has the indexed trade story`);
    for (const field of ['title', 'script', 'pencils']) {
      const clean = field === 'title' ? normalize : credit;
      assert.ok(clean(main[field]), `original #${reference.appNumber} has ${field}`);
      assert.equal(clean(main[field]), clean(story[field]), `original #${reference.appNumber} ${field}`);
    }
    assert.ok(Number(main.page_count) > 0);
    assert.equal(Number(main.page_count), Number(story.page_count), `original #${reference.appNumber} pages`);
    if (reference.appNumber === 126) {
      const additional = stories.find((entry) => entry !== main);
      assert.equal(additional.feature, 'Spider-Man');
      assert.equal(additional.title, 'Jay Leno & Spider-Man: One Night Only! (Don\'t Forget to Tip Your Waitress) Part Three');
      assert.equal(Number(additional.page_count), 5);
      assert.ok(!book.story_set.some((entry) => entry.type === 'comic story'
        && normalize(entry.title) === normalize(additional.title)));
    }
  }
  const comparison = data.fixtures[edition.gcdCheck.comparisonIssueId].issue.story_set;
  const covers = comparison.flatMap((entry, index) =>
    entry.type === 'cover reprint (on interior page)' && entry.title === 'Issue 123' ? [index] : []);
  assert.equal(covers.length, 1);
  const hardcoverStory = comparison[covers[0] + 1];
  const tradeStory = book.story_set.find((entry) => entry.sequence_number === 12);
  assert.equal(hardcoverStory.type, 'comic story');
  assert.equal(hardcoverStory.sequence_number, comparison[covers[0]].sequence_number + 1);
  for (const field of ['title', 'script', 'pencils']) {
    const clean = field === 'title' ? normalize : credit;
    assert.equal(clean(hardcoverStory[field]), clean(tradeStory[field]));
  }
  assert.equal(Number(hardcoverStory.page_count), 23);
  assert.equal(Number(tradeStory.page_count), 22);
  const checked = build(data)['gcd-editions.json'].editions.find((entry) => entry.edition === edition.id);
  assert.equal(checked.check.status, 'verified');
  assert.deepEqual(checked.check.verifiedComics, Array.from({ length: 8 }, (_, i) => `2281:${118 + i}`));
  assert.ok(checked.assertedContents.some((range) => range.from === 126 && range.to === 126 && range.portion === 'partial'));
  assert.ok(checked.check.excludedSequences.some((entry) => entry.sequence === 18 && entry.reason));
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

test('a count differs only by sequences recorded as exclusions, each with its reason', () => {
  const stories = [1, 2, 3, 4, 5, 6].map((sequence_number) => ({ type: 'comic story', sequence_number }));
  const edition = (uncountedSequences) => editionWith({ tier: 'gcd-count-only', expectedComicStories: 4, uncountedSequences },
    [{ seriesId: 7, from: 1, to: 4, assertedBy: 'owner-curated', basis: 'x' }]);
  const explained = checkEdition(edition({ 5: 'Back-up story.', 6: 'Reprint.' }), fixtureWith(stories), {});
  assert.equal(explained.status, 'consistent');
  assert.deepEqual(explained.excluded.map((entry) => [entry.sequence, entry.reason]), [[5, 'Back-up story.'], [6, 'Reprint.']]);
  const unexplained = checkEdition(edition({}), fixtureWith(stories), {});
  assert.equal(unexplained.status, 'conflict');
  const stale = checkEdition(edition({ 5: 'Back-up story.', 6: 'Reprint.', 9: 'Gone.' }), fixtureWith(stories), {});
  assert.ok(stale.conflicts.some((conflict) => conflict.kind === 'exclusion-missing'));
  assert.notEqual(stale.status, 'consistent');
});

test('the indexer-notes match is exact, so #1-5 never matches #1-50', () => {
  const series = 'X (Marvel, 2015 series)';
  assert.ok(notesStateRange(`Collects ${series} #1-5.`, series, '#1-5', false));
  assert.ok(!notesStateRange(`Collects ${series} #1-50.`, series, '#1-5', false));
  assert.ok(!notesStateRange(`Collects ${series} #10.`, series, '#1', false));
  assert.ok(!notesStateRange(`Collects ${series} #1-5-6.`, series, '#1-5', false));
  for (const near of ['#1-5a', '#1-5.1', '#1-5/6']) {
    assert.ok(!notesStateRange(`Collects ${series} ${near}.`, series, '#1-5', false), near);
  }
  assert.ok(notesStateRange(`Collects ${series} #1-5, and more.`, series, '#1-5', false));
  assert.ok(notesStateRange(`Collects ${series} #1-5`, series, '#1-5', false));
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: series }, [{ seriesId: 7, from: 1, to: 5, assertedBy: 'gcd-notes', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([], { notes: `Collects ${series} #1-50` }), {});
  assert.equal(result.verified.size, 0);
  assert.equal(result.status, 'conflict');
});

test('indexer notes do not match a longer series ending in the target name', () => {
  const series = 'Avengers (Marvel, 2010 series)';
  const span = '#1-5';
  for (const notes of [
    `Collects Secret ${series} ${span}.`,
    `Collects Secret and ${series} ${span}.`,
    `Collects X (Marvel, 2015 series) #1-2 and Secret ${series} ${span}.`,
  ]) {
    assert.equal(notesStateRange(notes, series, span, false), false, notes);
  }
  assert.equal(notesStateRange(`Collects ${series} ${span}.`, series, span, false), true);
  assert.equal(notesStateRange(`Collects X (Marvel, 2015 series) #1-2, and ${series} ${span}.`, series, span, false), true);
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: series },
    [{ seriesId: 7, from: 1, to: 5, assertedBy: 'gcd-notes', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([], { notes: `Collects Secret ${series} ${span}.` }), {});
  assert.equal(result.status, 'conflict');
  assert.equal(result.verified.size, 0);
  const control = checkEdition(edition, fixtureWith([], { notes: `Collects ${series} ${span}.` }), {});
  assert.equal(control.status, 'verified');
  assert.deepEqual([...control.verified], ['7:1', '7:2', '7:3', '7:4', '7:5']);
});

test('indexer notes distinguish partial material before the exact series', () => {
  const series = 'Avengers (Marvel, 2010 series)';
  const span = '#1-5';
  const longer = `Collects material from New ${series} ${span}.`;
  const partial = `Collects material from ${series} ${span}.`;
  assert.equal(notesStateRange(longer, series, span, false), false);
  assert.equal(notesStateRange(longer, series, span, true), false);
  assert.equal(notesStateRange(longer, `New ${series}`, span, false), false);
  assert.equal(notesStateRange(longer, `New ${series}`, span, true), true);
  assert.equal(notesStateRange(partial, series, span, false), false);
  assert.equal(notesStateRange(partial, series, span, true), true);
  assert.equal(notesStateRange(`Collects ${series} ${span}.`, series, span, true), false);
  assert.equal(notesStateRange(`Collects X (Marvel, 2015 series) #1-2 and material from ${series} ${span}.`,
    series, span, true), true);
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: series },
    [{ seriesId: 7, from: 1, to: 5, assertedBy: 'gcd-notes', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([], { notes: longer }), {});
  assert.equal(result.status, 'conflict');
  assert.equal(result.verified.size, 0);
});

test('an edition with any conflict is never labelled verified', () => {
  const series = 'X (Marvel, 2015 series)';
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: series, weakNumbers: { 2: 'Disputed.' } },
    [{ seriesId: 7, from: 1, to: 2, assertedBy: 'gcd-notes', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([], { notes: `Collects ${series} #1-2` }), {});
  assert.equal(result.status, 'verified-with-conflicts');
  const statuses = Object.fromEntries(build(inputs())['gcd-editions.json'].editions.map((entry) => [entry.edition, entry.check]));
  for (const check of Object.values(statuses)) if (check.conflicts.length) assert.notEqual(check.status, 'verified');
  assert.equal(statuses['secret-wars-2015-hc'].status, 'verified-with-conflicts');
  assert.equal(statuses['thunderbolts-ellis-v2-caged-angels'].status, 'verified-with-conflicts');
  const partly = editionWith({ tier: 'gcd-story-titles', storyTitles: { 1: 'A' } },
    [{ seriesId: 7, from: 1, to: 2, assertedBy: 'owner-curated', basis: 'x' }]);
  const partlyResult = checkEdition(partly, fixtureWith([
    { type: 'comic story', sequence_number: 1, title: 'A' },
    { type: 'comic story', sequence_number: 2, title: 'B' },
  ]), {});
  assert.equal(partlyResult.conflicts.length, 0);
  assert.equal(partlyResult.status, 'partly-verified');
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

function crosswalkFixture(id, series, number, name = 'The Example Heroes (2010 series)') {
  const url = `https://www.comics.org/api/issue/${id}/?format=json`;
  return { ...fixtureWith([], { api_url: url, series, series_name: name, number }), url };
}

function crosswalkExample() {
  const url = 'https://www.comics.org/api/series/90000001/?format=json';
  return {
    entry: {
      appSeriesId: 7, from: 100, to: 600,
      gcdSeries: 'The Example Heroes (Marvel, 2010 series)',
      gcdAliases: ['Example Heroes (Marvel, 2010 series)'],
      gcdSeriesUrl: url,
      gcdSeriesPage: 'https://www.comics.org/series/90000001/',
      sourceIssues: [{
        gcdIssueId: 90000002, gcdIssuePage: 'https://www.comics.org/issue/90000002/', appNumber: 100, gcdNumber: '100',
      }],
    },
    fixtures: { 90000002: crosswalkFixture(90000002, url, '100') },
  };
}

function crosswalkCheck(from, to, entries, fixtures, series = 'Example Heroes (Marvel, 2010 series)',
  listSeries = 'Example Heroes (2001)') {
  const span = from === to ? `#${from}` : `#${from}-${to}`;
  const edition = editionWith({ tier: 'gcd-notes', gcdSeries: series },
    [{ seriesId: 7, from, to, assertedBy: 'gcd-notes', basis: 'x' }]);
  return checkEdition(edition, fixtureWith([], { notes: `Collects ${series} ${span}.` }),
    { 7: listSeries }, { crosswalk: entries, fixtures });
}

test('crosswalk uses the mapped series year without relaxing an unmapped year', () => {
  const { entry, fixtures } = crosswalkExample();
  const mapped = crosswalkCheck(394, 395, [entry], fixtures);
  assert.equal(mapped.status, 'verified');
  assert.deepEqual([...mapped.verified], ['7:394', '7:395']);
  const unmapped = crosswalkCheck(394, 395, [], fixtures);
  assert.ok(unmapped.conflicts.some((conflict) => conflict.kind === 'series-year'));
  assert.notEqual(unmapped.status, 'verified');
});

test('crosswalk rejects overlapping entries even when one covers the range', () => {
  const { entry, fixtures } = crosswalkExample();
  const result = crosswalkCheck(394, 395, [entry, clone(entry)], fixtures);
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-overlap'));
  assert.ok(validateSeriesCrosswalk([entry, clone(entry)], fixtures).some((error) => error.includes('overlap')));
});

test('crosswalk rejects partial coverage of a claimed range', () => {
  const { entry, fixtures } = crosswalkExample();
  const result = crosswalkCheck(99, 100, [entry], fixtures);
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-range'));
});

test('crosswalk rejects a different source series even when its year matches', () => {
  const { entry, fixtures } = crosswalkExample();
  const result = crosswalkCheck(394, 395, [entry], fixtures, 'Other Heroes (Marvel, 2010 series)');
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-identity'));
});

test('crosswalk rejects an alias that names a different series', () => {
  const { entry, fixtures } = crosswalkExample();
  entry.gcdAliases.push('Other Heroes (Marvel, 2010 series)');
  const result = crosswalkCheck(394, 395, [entry], fixtures, 'Other Heroes (Marvel, 2010 series)');
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
});

test('crosswalk checks every fetched source issue against the mapped series URL', () => {
  const { entry, fixtures } = crosswalkExample();
  entry.sourceIssues.push({
    gcdIssueId: 90000003, gcdIssuePage: 'https://www.comics.org/issue/90000003/', appNumber: 101, gcdNumber: '101',
  });
  fixtures[90000003] = crosswalkFixture(90000003, 'https://www.comics.org/api/series/90000004/?format=json', '101');
  const result = crosswalkCheck(394, 395, [entry], fixtures);
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
});

test('crosswalk rejects a wrong series URL even when the page and name agree with the entry', () => {
  const { entry, fixtures } = crosswalkExample();
  entry.gcdSeriesUrl = 'https://www.comics.org/api/series/90000004/?format=json';
  entry.gcdSeriesPage = 'https://www.comics.org/series/90000004/';
  const result = crosswalkCheck(394, 395, [entry], fixtures);
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
});

test('crosswalk fails closed when a source issue fixture is missing or names the wrong issue', () => {
  const { entry } = crosswalkExample();
  for (const bad of [{}, { 90000002: crosswalkFixture(90000002, entry.gcdSeriesUrl, '99') }]) {
    const result = crosswalkCheck(394, 395, [entry], bad);
    assert.equal(result.verified.size, 0);
    assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
  }
});

test('crosswalk guards story-title checks as well as indexer notes', () => {
  const { entry, fixtures } = crosswalkExample();
  fixtures[90000002].issue.series = 'https://www.comics.org/api/series/90000004/?format=json';
  const edition = editionWith({ tier: 'gcd-story-titles', gcdSeries: 'Example Heroes (Marvel, 2010 series)', storyTitles: { 394: 'A' } },
    [{ seriesId: 7, from: 394, to: 394, assertedBy: 'owner-curated', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([{ type: 'comic story', title: 'A', sequence_number: 1 }]),
    { 7: 'Example Heroes (2001)' }, { crosswalk: [entry], fixtures });
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
});

test('invalid crosswalk entries and database-only fields fail validation', () => {
  const { entry, fixtures } = crosswalkExample();
  assert.deepEqual(validateSeriesCrosswalk([entry], fixtures), []);
  const wrongPage = clone(entry);
  wrongPage.gcdSeriesPage = 'https://www.comics.org/series/90000004/';
  assert.ok(validateSeriesCrosswalk([wrongPage], fixtures).length);
  const noEvidence = clone(entry);
  noEvidence.sourceIssues = [];
  assert.ok(validateSeriesCrosswalk([noEvidence], fixtures).length);
  assert.ok(validateSeriesCrosswalk('not an array', fixtures).length);
  assert.ok(databaseLeaks({ seriesCrosswalk: [entry] }, 'pilot.json').length);
});

test('a valid crosswalk permits story-title verification', () => {
  const { entry, fixtures } = crosswalkExample();
  const edition = editionWith({ tier: 'gcd-story-titles', gcdSeries: 'Example Heroes (Marvel, 2010 series)', storyTitles: { 394: 'A' } },
    [{ seriesId: 7, from: 394, to: 394, assertedBy: 'owner-curated', basis: 'x' }]);
  const result = checkEdition(edition, fixtureWith([{ type: 'comic story', title: 'A', sequence_number: 1 }]),
    { 7: 'Example Heroes (2001)' }, { crosswalk: [entry], fixtures });
  assert.equal(result.status, 'verified');
  assert.deepEqual([...result.verified], ['7:394']);
});

test('crosswalk rejects zero coverage for a listed series even when the year agrees', () => {
  const { entry, fixtures } = crosswalkExample();
  const result = crosswalkCheck(601, 602, [entry], fixtures,
    'Example Heroes (Marvel, 2010 series)', 'Example Heroes (2010)');
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-range'));
});

test('crosswalk binds numeric source issues while allowing an evidenced unnumbered annual', () => {
  const { entry, fixtures } = crosswalkExample();
  entry.sourceIssues[0].appNumber = 101;
  assert.ok(validateSeriesCrosswalk([entry], fixtures).length);
  assert.equal(crosswalkCheck(394, 395, [entry], fixtures).verified.size, 0);

  const annual = clone(entry);
  annual.from = 1;
  annual.to = 1;
  annual.sourceIssues[0] = {
    gcdIssueId: 90000002, gcdIssuePage: 'https://www.comics.org/issue/90000002/', appNumber: 1, gcdNumber: '[nn]',
  };
  fixtures[90000002].issue.number = '[nn]';
  fixtures[90000002].issue.notes = 'Example Heroes Annual.';
  assert.deepEqual(validateSeriesCrosswalk([annual], fixtures), []);
  fixtures[90000002].issue.notes = '';
  assert.ok(validateSeriesCrosswalk([annual], fixtures).length);
});

test('crosswalk rejects altered source issue URLs and series names', () => {
  const { entry, fixtures } = crosswalkExample();
  for (const mutate of [
    (fixture) => { fixture.url = 'https://www.comics.org/api/issue/90000009/?format=json'; },
    (fixture) => { fixture.issue.api_url = 'https://www.comics.org/api/issue/90000009/?format=json'; },
    (fixture) => { fixture.issue.series_name = 'Other Heroes (2010 series)'; },
  ]) {
    const bad = clone(fixtures);
    mutate(bad[90000002]);
    const result = crosswalkCheck(394, 395, [entry], bad);
    assert.equal(result.verified.size, 0);
    assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
  }
  const wrongPage = clone(entry);
  wrongPage.sourceIssues[0].gcdIssuePage = 'https://www.comics.org/issue/90000009/';
  const result = crosswalkCheck(394, 395, [wrongPage], fixtures);
  assert.equal(result.verified.size, 0);
  assert.ok(result.conflicts.some((conflict) => conflict.kind === 'series-crosswalk-evidence'));
});

test('approved crosswalk data cannot silently lose a required entry', () => {
  const data = inputs();
  assert.equal(data.gcdInputs.expectedCrosswalkEntries, 7);
  assert.equal(data.gcdInputs.seriesCrosswalk.length, data.gcdInputs.expectedCrosswalkEntries);
  assert.deepEqual(validateSeriesCrosswalk(data.gcdInputs.seriesCrosswalk, data.fixtures), []);
  const missing = clone(data);
  missing.gcdInputs.seriesCrosswalk.pop();
  assert.ok(validate(missing, build(missing)).some((error) => error.includes('required crosswalk entries')));
});

test('pilot coverage records the hard cases', () => {
  const lists = Object.fromEntries(build(inputs())['gcd-editions.json'].coverage.map((list) => [list.listId, list]));
  const kinds = (id) => lists[id].findings.map((finding) => finding.kind);
  assert.equal(lists.civil_war_avengers.verifiedRows, 13);
  assert.equal(lists.civil_war_avengers.verifiedWithConflictsRows, 5);
  assert.equal(lists.avengers_doomsday_secret_wars.verifiedRows, 0);
  assert.ok(kinds('nebula_reading_order').includes('partial-selection'));
  assert.ok(kinds('avengers_doomsday_secret_wars').includes('overlap'));
  assert.equal(lists.avengers_doomsday_secret_wars.partialRows, 1);
  assert.ok(kinds('realm_of_kings').includes('variant-printing'));
  assert.ok(kinds('the_unbeatable_squirrel_girl').includes('group-wider-than-edition'));
});

test('a book with no curated contents raises no pair finding', () => {
  const lists = Object.fromEntries(build(inputs())['editions.json'].lists.map((list) => [list.listId, list]));
  const findings = (id) => lists[id].findings.map((finding) => finding.kind);
  assert.ok(!findings('avengers_doomsday_secret_wars').includes('group-spans-editions'));
  assert.ok(!lists.avengers_doomsday_secret_wars.findings.some((finding) => /secret-wars-2015-hc/.test(finding.detail)));
  assert.ok(findings('avengers_doomsday_secret_wars').includes('group-wider-than-edition'));
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

function originalSeriesExample() {
  const gcdSeriesUrl = 'https://www.comics.org/api/series/90000001/?format=json';
  return {
    gcdSeriesUrl,
    seriesEvidence: {
      90000001: {
        url: 'https://www.comics.org/api/series/name/Example/year/2010/?format=json',
        retrievedAt: '2026-11-12T00:00:00.000Z',
        series: {
          api_url: gcdSeriesUrl, name: 'Example', year_began: 2010,
          publisher: 'https://www.comics.org/api/publisher/78/?format=json',
          country: 'us', language: 'en', issue_descriptors: ['1 [Direct Edition]', '2'],
        },
      },
    },
  };
}

test('numbered covers verify complete stories only with an exact source series', () => {
  const { gcdSeriesUrl, seriesEvidence } = originalSeriesExample();
  const edition = editionWith({
    tier: 'gcd-numbered-covers', gcdSeries: 'Example (Marvel, 2010 series)',
    gcdSeriesUrl, sourceSeriesId: 90000001, coverPrefix: '[Example] #',
    expectedScript: 'Writer', expectedPencils: 'Artist',
  }, [{ seriesId: 7, from: 1, to: 2, assertedBy: 'gcd-stories', basis: 'x' }]);
  const fixture = fixtureWith([
    { type: 'cover reprint (on interior page)', title: '[Example] #1', sequence_number: 1 },
    { type: 'comic story', title: 'One', sequence_number: 2, page_count: '22.000', script: 'Writer', pencils: 'Artist' },
    { type: 'cover reprint (on interior page)', title: '[Example] #2', sequence_number: 3 },
    { type: 'comic story', title: 'Two', sequence_number: 4, page_count: '23.000', script: 'Writer', pencils: 'Artist' },
  ], { api_url: 'https://www.comics.org/api/issue/1/?format=json' });
  const check = (book = edition, source = fixture, series = seriesEvidence, names = { 7: 'Example (2010 - 2015)' }) =>
    checkEdition(book, source, names, { seriesEvidence: series });
  assert.deepEqual([...check().verified], ['7:1', '7:2']);
  const variants = [
    (book, source) => { source.issue.story_set[2].title = '[Example] #9'; },
    (book, source) => { source.issue.story_set[3].type = 'illustration'; },
    (book, source) => { source.issue.story_set[3].script = 'Wrong'; },
    (book, source) => { source.issue.story_set.splice(3, 0, { type: 'illustration', title: 'extra', sequence_number: 9 }); },
    (book, source) => { source.issue.api_url = 'https://www.comics.org/api/issue/9/?format=json'; },
    (book, source, series) => { series[90000001].series.api_url = 'https://www.comics.org/api/series/9/?format=json'; },
    (book, source, series) => { series[90000001].series.issue_descriptors = ['1 [Direct Edition]']; },
    (book, source, series) => { series[90000001].series.country = 'es'; },
    (book) => { book.gcdCheck.coverPrefix = '[Other] #'; },
  ];
  for (const mutate of variants) {
    const book = clone(edition);
    const source = clone(fixture);
    const series = clone(seriesEvidence);
    mutate(book, source, series);
    assert.notEqual(check(book, source, series).status, 'verified');
  }
  assert.notEqual(check(edition, fixture, seriesEvidence, { 7: 'Example (2011)' }).status, 'verified');
  assert.notEqual(check(edition, fixture, seriesEvidence, { 7: 'Different (2010)' }).status, 'verified');
});

test('numbered covers cannot verify an explicitly excluded story', () => {
  const { gcdSeriesUrl, seriesEvidence } = originalSeriesExample();
  const edition = editionWith({
    tier: 'gcd-numbered-covers', gcdSeries: 'Example (Marvel, 2010 series)',
    gcdSeriesUrl, sourceSeriesId: 90000001, coverPrefix: '[Example] #',
    expectedScript: 'Writer', expectedPencils: 'Artist', uncountedSequences: { 4: 'Held for review.' },
  }, [{ seriesId: 7, from: 1, to: 1, assertedBy: 'gcd-stories', basis: 'x' }]);
  const fixture = fixtureWith([
    { type: 'cover reprint (on interior page)', title: '[Example] #1', sequence_number: 1 },
    { type: 'comic story', title: 'One', sequence_number: 2, page_count: '22', script: 'Writer', pencils: 'Artist' },
    { type: 'cover reprint (on interior page)', title: '[Example] #2', sequence_number: 3 },
    { type: 'comic story', title: 'Two', sequence_number: 4, page_count: '22', script: 'Writer', pencils: 'Artist' },
  ], { api_url: 'https://www.comics.org/api/issue/1/?format=json' });
  const check = (book) => checkEdition(book, fixture, { 7: 'Example (2010)' }, { seriesEvidence });
  assert.deepEqual([...check(edition).verified], ['7:1']);
  const excludedClaim = clone(edition);
  excludedClaim.gcdCheck.uncountedSequences = { 2: 'Held for review.' };
  assert.equal(check(excludedClaim).verified.size, 0);
  assert.notEqual(check(excludedClaim).status, 'verified');
  for (const excluded of [{ 4: '' }, { 99: 'Missing story.' }]) {
    const bad = clone(edition);
    bad.gcdCheck.uncountedSequences = excluded;
    assert.notEqual(check(bad).status, 'verified');
  }
  for (const excluded of [['invalid'], 'invalid', null]) {
    const bad = clone(edition);
    bad.gcdCheck.uncountedSequences = excluded;
    assert.throws(() => check(bad), /Uncounted sequences must be an object/);
  }
});

test('original issue stories verify only exact series, identity, title, pages and credits', () => {
  const { gcdSeriesUrl } = originalSeriesExample();
  const edition = editionWith({
    tier: 'gcd-original-stories', gcdSeries: 'Example (Marvel, 2010 series)', gcdSeriesUrl,
    originalIssues: [
      { appNumber: 1, gcdIssueId: 10, collectionSequence: 1 },
      { appNumber: 2, gcdIssueId: 11, collectionSequence: 2 },
    ],
  }, [{ seriesId: 7, from: 1, to: 2, assertedBy: 'gcd-stories', basis: 'x' }]);
  const stories = [
    { type: 'comic story', title: 'One', sequence_number: 1, page_count: '22.000', script: 'Writer (credited)', pencils: 'Artist (credited)' },
    { type: 'comic story', title: 'Two', sequence_number: 2, page_count: '23.000', script: 'Writer (credited)', pencils: 'Artist (credited)' },
  ];
  const book = fixtureWith(stories, { api_url: 'https://www.comics.org/api/issue/1/?format=json' });
  const original = (id, number, story) => {
    const url = `https://www.comics.org/api/issue/${id}/?format=json`;
    return { ...fixtureWith([{ ...story, sequence_number: 1, script: 'Writer', pencils: 'Artist' }], {
      api_url: url, number: String(number), series: gcdSeriesUrl, series_name: 'Example (2010 series)',
    }), url };
  };
  const fixtures = { 10: original(10, 1, stories[0]), 11: original(11, 2, stories[1]) };
  const check = (value = edition, source = book, originals = fixtures, names = { 7: 'Example (2010 - 2015)' }) =>
    checkEdition(value, source, names, { fixtures: originals });
  assert.deepEqual([...check().verified], ['7:1', '7:2']);
  for (const mutate of [
    (a) => { a.issue.series = 'https://www.comics.org/api/series/9/?format=json'; },
    (a) => { a.issue.number = '9'; },
    (a) => { a.issue.api_url = 'https://www.comics.org/api/issue/9/?format=json'; },
    (a) => { a.issue.story_set[0].title = 'Wrong'; },
    (a) => { a.issue.story_set[0].page_count = '24.000'; },
    (a) => { a.issue.story_set[0].script = 'Wrong'; },
    (a) => { a.issue.story_set[0].pencils = null; },
  ]) {
    const originals = clone(fixtures);
    mutate(originals[11]);
    assert.notEqual(check(edition, book, originals).status, 'verified');
  }
  const duplicates = clone(edition);
  duplicates.gcdCheck.originalIssues[1].collectionSequence = 1;
  assert.notEqual(check(duplicates).status, 'verified');
  assert.notEqual(check(edition, book, fixtures, { 7: 'Example (2011)' }).status, 'verified');
});

test('a numbered comparison requires the original to settle a page-count discrepancy', () => {
  const { gcdSeriesUrl } = originalSeriesExample();
  const edition = editionWith({
    tier: 'gcd-numbered-comparison', gcdSeries: 'Example (Marvel, 2010 series)', gcdSeriesUrl,
    comparisonIssueId: 20, comparisonCoverPrefix: 'Issue ',
    originalIssues: [{ appNumber: 2, gcdIssueId: 11, collectionSequence: 2 }],
  }, [{ seriesId: 7, from: 1, to: 2, assertedBy: 'gcd-stories', basis: 'x' }]);
  const stories = [
    { type: 'comic story', title: 'One', sequence_number: 1, page_count: '22.000', script: 'Writer', pencils: 'Artist' },
    { type: 'comic story', title: 'Two', sequence_number: 2, page_count: '22.000', script: 'Writer', pencils: 'Artist' },
  ];
  const book = fixtureWith(stories, { api_url: 'https://www.comics.org/api/issue/1/?format=json' });
  const comparisonUrl = 'https://www.comics.org/api/issue/20/?format=json';
  const comparison = { ...fixtureWith([
    { type: 'cover reprint (on interior page)', title: 'Issue 1', sequence_number: 1 },
    { ...stories[0], sequence_number: 2 },
    { type: 'cover reprint (on interior page)', title: 'Issue 2', sequence_number: 3 },
    { ...stories[1], sequence_number: 4, page_count: '23.000' },
  ], { api_url: comparisonUrl }), url: comparisonUrl };
  const originalUrl = 'https://www.comics.org/api/issue/11/?format=json';
  const original = { ...fixtureWith([{ ...stories[1], sequence_number: 1 }], {
    api_url: originalUrl, number: '2', series: gcdSeriesUrl, series_name: 'Example (2010 series)',
  }), url: originalUrl };
  const fixtures = { 11: original, 20: comparison };
  const check = (bookFixture = book, source = fixtures) =>
    checkEdition(edition, bookFixture, { 7: 'Example (2010 - 2015)' }, { fixtures: source });
  assert.deepEqual([...check().verified], ['7:1', '7:2']);
  for (const mutate of [
    (source) => { delete source[11]; },
    (source) => { source[11].issue.story_set[0].page_count = '23.000'; },
    (source) => { source[11].issue.series = 'https://www.comics.org/api/series/9/?format=json'; },
    (source) => { source[20].issue.story_set[2].title = 'Issue 9'; },
    (source) => { source[20].issue.story_set[3].title = 'Different'; },
    (source) => { source[20].issue.story_set[3].page_count = '22.000'; },
  ]) {
    const changed = clone(fixtures);
    mutate(changed);
    assert.notEqual(check(book, changed).status, 'verified');
  }
});
