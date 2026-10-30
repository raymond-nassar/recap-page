import test from 'node:test';
import assert from 'node:assert/strict';
import { availability, describe, calendarDate, localDayString, STATE } from '../src/js/lib/availability.js';
import { parseIssueNumber, compareIssues, sortIssues } from '../src/js/lib/sort.js';

// ------------------------------------------------------------------ availability

test('a missing unlimitedDate is unknown, never "unavailable"', () => {
  assert.equal(availability({ mu: null }).state, STATE.UNKNOWN);
  assert.equal(availability({}).state, STATE.UNKNOWN);
  assert.equal(availability(null).state, STATE.UNKNOWN);
});

test('a past date is expected, a future date is scheduled', () => {
  const today = '2026-08-03';
  assert.equal(availability({ mu: '2020-01-01T00:00:00+0000' }, { today }).state, STATE.EXPECTED);
  assert.equal(availability({ mu: '2030-01-01T00:00:00+0000' }, { today }).state, STATE.SCHEDULED);
});

test('an issue released today counts as expected, not scheduled', () => {
  assert.equal(
    availability({ mu: '2026-08-03T00:00:00+0000' }, { today: '2026-08-03' }).state,
    STATE.EXPECTED,
  );
});

// The bug this guards: comparing a UTC-midnight instant against Date.now() badges an issue
// a day early for anyone west of UTC. Comparing calendar-date strings avoids that entirely.
test('a UTC-midnight timestamp does not badge early for a user behind UTC', () => {
  const issue = { mu: '2026-08-04T00:00:00+0000' };
  assert.equal(availability(issue, { today: '2026-08-03' }).state, STATE.SCHEDULED);
  assert.equal(availability(issue, { today: '2026-08-04' }).state, STATE.EXPECTED);
});

test('calendarDate reads the date portion without shifting timezone', () => {
  assert.equal(calendarDate('2013-05-15T00:00:00+0000'), '2013-05-15');
  assert.equal(calendarDate('2013-05-15'), '2013-05-15');
  assert.equal(calendarDate(null), null);
  assert.equal(calendarDate('nonsense'), null);
});

test('localDayString formats as YYYY-MM-DD with padding', () => {
  assert.equal(localDayString(new Date(2026, 0, 5)), '2026-01-05');
  assert.match(localDayString(), /^\d{4}-\d{2}-\d{2}$/);
});

test('manual overrides win over whatever the metadata says', () => {
  const scheduled = { mu: '2030-01-01T00:00:00+0000' };
  assert.equal(availability(scheduled, { override: 'available' }).state, STATE.OVERRIDE_AVAILABLE);

  const past = { mu: '2000-01-01T00:00:00+0000' };
  assert.equal(availability(past, { override: 'unavailable' }).state, STATE.OVERRIDE_UNAVAILABLE);
});

test('an unknown override value is ignored', () => {
  assert.equal(availability({ mu: null }, { override: 'garbage' }).state, STATE.UNKNOWN);
});

test('describe never asserts availability as fact', () => {
  const text = describe({ mu: '2020-01-01T00:00:00+0000' }, { today: '2026-08-03' });
  assert.match(text, /Unlimited date: 2020-01-01 \(passed\)/);
  assert.doesNotMatch(text, /^Available$/);
  assert.match(describe({ mu: '2030-01-01' }, { today: '2026-08-03' }), /2030-01-01/);
  const examples = [
    [{}, {}, 'No recorded Unlimited date'],
    [{ mu: '2030-01-01' }, {}, 'Unlimited date: 2030-01-01 (future)'],
    [{ mu: '2020-01-01' }, {}, 'Unlimited date: 2020-01-01 (passed)'],
    [{}, { override: 'available' }, 'You marked it available in Unlimited'],
    [{}, { override: 'unavailable' }, 'You marked it unavailable in Unlimited'],
  ];
  assert.equal(new Set(examples.map(([issue, options]) => describe(issue, { today: '2026-12-07', ...options }))).size, 5);
  for (const [issue, options, expected] of examples) assert.equal(describe(issue, { today: '2026-12-07', ...options }), expected);
});

// ------------------------------------------------------------------ sort

test('parses plain, point, and lettered issue numbers', () => {
  assert.equal(parseIssueNumber('#1').value, 1);
  assert.equal(parseIssueNumber('0.1').value, 0.1);
  assert.equal(parseIssueNumber('Avengers (2012) #1.AU').value, 1);
  assert.equal(parseIssueNumber('Avengers (2012) #1.AU').suffix, 'AU');
  assert.equal(parseIssueNumber('#10').value, 10);
});

test('issue numbers sort numerically, not as strings', () => {
  const sorted = sortIssues([
    { title: 'S #10', number: '10', seriesName: 'S', onSale: '2013-01-01' },
    { title: 'S #2', number: '2', seriesName: 'S', onSale: '2013-01-01' },
    { title: 'S #1', number: '1', seriesName: 'S', onSale: '2013-01-01' },
  ]);
  assert.deepEqual(sorted.map((i) => i.number), ['1', '2', '10']);
});

test('point issues fall between their neighbours', () => {
  const sorted = sortIssues([
    { number: '1', seriesName: 'S', onSale: '2013-01-01' },
    { number: '2', seriesName: 'S', onSale: '2013-01-01' },
    { number: '0.1', seriesName: 'S', onSale: '2013-01-01' },
  ]);
  assert.deepEqual(sorted.map((i) => i.number), ['0.1', '1', '2']);
});

test('annuals and specials sort after ordinary issues of the same series', () => {
  const a = parseIssueNumber('Avengers Annual #1');
  const n = parseIssueNumber('Avengers #1');
  assert.ok(a.kind > n.kind);
});

test('on-sale date dominates the ordering', () => {
  const sorted = sortIssues([
    { title: 'Later', number: '1', seriesName: 'B', onSale: '2014-01-01' },
    { title: 'Earlier', number: '99', seriesName: 'A', onSale: '2013-01-01' },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ['Earlier', 'Later']);
});

test('undated issues sort last rather than first', () => {
  const sorted = sortIssues([
    { title: 'No date', number: '1', seriesName: 'S' },
    { title: 'Dated', number: '2', seriesName: 'S', onSale: '2013-01-01' },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ['Dated', 'No date']);
});

test('the comparator is a consistent total order', () => {
  const items = [
    { title: 'A', number: '1', seriesName: 'S', onSale: '2013-01-01' },
    { title: 'B', number: '2', seriesName: 'S', onSale: '2013-01-01' },
    { title: 'C', number: '1', seriesName: 'T', onSale: '2013-01-01' },
    { title: 'D', number: 'Annual 1', seriesName: 'S', onSale: '2013-01-01' },
  ];
  for (const a of items) {
    assert.equal(compareIssues(a, a), 0, 'must be reflexive');
    for (const b of items) {
      const fwd = Math.sign(compareIssues(a, b)) || 0;
      const rev = -Math.sign(compareIssues(b, a)) || 0;
      assert.equal(fwd, rev, 'must be antisymmetric');
    }
  }
  assert.deepEqual(sortIssues(items), sortIssues([...items].reverse()), 'must be order-independent');
});
