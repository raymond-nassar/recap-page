import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { EVENTS, normalizeSeriesRows, nameMatches, parseArgs, essentialOrder, essentialFileName, essentialRefusal } from '../scripts/build-event-order.mjs';

// The completeness audit reads a series index that may be column-oriented, and a reader that
// cannot see names is indistinguishable from a catalogue with nothing in it: both match zero
// series, find zero unaccounted, and report success. These tests pin the reader, because the
// failure they guard against only appears once a committed index exists and is silent when it does.

const columnar = {
  kind: 'series',
  total: 3,
  fields: ['id', 'name', 'issueCount'],
  items: [
    [1067, 'Civil War (2006 - 2007)', 7],
    [26024, ' Superior Spider-Man Vol. 2: Otto-matic (2019)', 1],
    [31377, 'King In Black: Black Panther (2021)', 1],
  ],
};

test('a column-oriented index is mapped through its fields header', () => {
  const { items, why } = normalizeSeriesRows(columnar);
  assert.equal(why, null);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: 1067, name: 'Civil War (2006 - 2007)', issueCount: 7 });
});

test('names survive the mapping, so the audit can still match events', () => {
  const { items } = normalizeSeriesRows(columnar);
  // Reading .name off an unmapped tuple yields undefined and matches nothing, which is the
  // shape of the bug: a clean audit that looked at an empty list.
  assert.equal(items.filter((s) => nameMatches(s.name, 'Civil War')).length, 1);
  assert.equal(items.filter((s) => nameMatches(s.name, 'King in Black')).length, 1);
});

test('tuple rows with no fields header are refused rather than scanned', () => {
  const { items, why } = normalizeSeriesRows({ items: [[1067, 'Civil War (2006 - 2007)', 7]] });
  assert.equal(items, null);
  assert.match(why, /carry an id and a name/);
});

test('a record-oriented index is read as-is', () => {
  const { items, why } = normalizeSeriesRows({ items: [{ id: 1067, name: 'Civil War (2006 - 2007)' }] });
  assert.equal(why, null);
  assert.equal(items[0].name, 'Civil War (2006 - 2007)');
});

test('an index of the wrong shape is refused', () => {
  assert.equal(normalizeSeriesRows({ total: 6990 }).items, null);
  assert.match(normalizeSeriesRows({ total: 6990 }).why, /no array of series/);
});

test('matching is on whole words, so an event does not swallow a longer name', () => {
  assert.ok(nameMatches('Civil War: Front Line (2006)', 'Civil War'));
  assert.ok(nameMatches('Civil War II (2016)', 'Civil War'));
  assert.ok(!nameMatches('Civil Warriors (1994)', 'Civil War'));
  assert.ok(!nameMatches(undefined, 'Civil War'));
});

// Selection is by explicit id, so a series in both lists is a contradiction the audit should never
// have to discover upstream.
test('no series is both included in and excluded from the same event', () => {
  for (const event of EVENTS) {
    const excluded = new Set(Object.values(event.excluded).flat());
    for (const id of event.series) {
      assert.ok(!excluded.has(id), `${event.id}: ${id} is listed as both included and excluded`);
    }
  }
});

test('every event declares its main series among the series it includes', () => {
  for (const event of EVENTS) {
    assert.ok(event.series.includes(event.main), `${event.id}: main series ${event.main} is not included`);
  }
});

// A mistyped safety flag must not read as no flag at all. --dryrun once fell through to a real
// build, rewriting every order file, which is the opposite of what the person typing it wanted.
test('a mistyped flag is refused rather than ignored', () => {
  for (const bad of ['--dryrun', '--dry_run', '--Audit', '-audit']) {
    assert.throws(() => parseArgs([bad]), /unrecognised option/, `${bad} should be refused`);
  }
});

test('--only names the vendor script, and says so', () => {
  assert.throws(() => parseArgs(['--only=house-of-m']), /npm run vendor/);
});

test('the real flags and event ids still parse', () => {
  assert.deepEqual(
    parseArgs(['--dry-run', '--audit', 'civil-war']).targets.map((e) => e.id),
    ['civil-war'],
  );
  const bare = parseArgs([]);
  assert.equal(bare.dryRun, false);
  assert.equal(bare.wantsAudit, false);
  assert.equal(bare.targets.length, EVENTS.length);
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--audit']).wantsAudit, true);
});

test('an unknown event id is refused', () => {
  assert.throws(() => parseArgs(['civil-war-ii']), /is not an event in this script/);
});

// Marvel returns some titles with doubled or leading whitespace ("King In Black: Black Panther
// (2021)" arrives with two spaces, and the series catalogue contains a leading-space name). Both
// generators normalise it on ingest, which means the committed text deliberately differs from the
// raw upstream string. That is the fix, not corruption -- so this pins it, because the obvious way
// to "repair" an apparent mismatch against the API is to put the doubled space back.
//
// Deliberately limited to titles and series names. Marvel's `description` was their prose and
// double-spaced after sentences, which is why it was never normalised. Since BL-130 it is no longer
// vendored, so a sweep of src/data finds no doubled space in a description. What it does find is 47
// series names out of the index, written by a different generator. Neither is a gap in this check.
const ORDERS = new URL('../src/data/orders/', import.meta.url);
const PINNED = [
  'house_of_m',
  'civil_war',
  'annihilation',
  'secret_invasion',
  'king_in_black',
  'house_of_m_essential',
  'civil_war_essential',
  'secret_invasion_essential',
];

test('committed checklists carry no doubled whitespace', async () => {
  let lines = 0;
  for (const file of await readdir(ORDERS)) {
    const text = await readFile(new URL(file, ORDERS), 'utf8');
    for (const line of text.split('\n')) {
      lines += 1;
      assert.ok(!/\S\s{2,}\S/.test(line), `${file}: doubled whitespace in ${JSON.stringify(line)}`);
    }
  }
  // A reader that finds nothing would otherwise pass this without checking anything.
  assert.ok(lines > 100, `expected the committed orders to have content, read ${lines} lines`);
});

// A checklist heading is the one line of these files this repository writes rather than copies:
// `render` builds it from the event name, and an imported file's first heading becomes the list's
// name on screen. So Constraint 11 reaches it, even though the file is data rather than source.
// Scoped to headings on purpose. The item lines carry Marvel's own titles, and five of them really
// are spelled with an en dash rather than a hyphen, all in the Ultimate Impact entries of
// new-ultimate-universe.md, so a whole-file sweep would fail on upstream copy this repository is
// not entitled to rewrite. The character is described rather than reproduced here so that this
// comment does not become the thing it is about.
test('a committed checklist heading carries no en or em dash', async () => {
  let headings = 0;
  for (const file of await readdir(ORDERS)) {
    const text = await readFile(new URL(file, ORDERS), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.startsWith('#')) continue;
      headings += 1;
      assert.ok(
        !/[\u2013\u2014]/.test(line),
        `${file}: Constraint 11, dash in heading ${JSON.stringify(line)}`,
      );
    }
  }
  // Without this the check passes on an empty directory, which is how a scan that reads
  // nothing reports a clean result forever.
  assert.ok(headings >= 9, `expected a heading in every committed order, found ${headings}`);
});

test('pinned titles are trimmed and free of doubled whitespace', async () => {
  let checked = 0;
  for (const name of PINNED) {
    const url = new URL(`../src/data/${name}.json`, import.meta.url);
    const { items } = JSON.parse(await readFile(url, 'utf8'));
    assert.ok(Array.isArray(items) && items.length, `${name}: no items to check`);
    for (const item of items) {
      for (const key of ['title', 'seriesName']) {
        const value = item[key];
        if (typeof value !== 'string') continue;
        checked += 1;
        assert.equal(value, value.trim(), `${name}: untrimmed ${key} ${JSON.stringify(value)}`);
        assert.ok(!/\s{2,}/.test(value), `${name}: doubled whitespace in ${key} ${JSON.stringify(value)}`);
      }
    }
  }
  assert.equal(checked, 346, `expected 173 items with a title and a series name, checked ${checked} strings`);
});

// ------------------------------------------------------------------ the essential variant
//
// `essentialOrder` decides, per event, whether a main-series-only checklist can be offered. The
// decision is derived rather than curated, so these tests are about the derivation: what matters
// is that the refusal fires on the events it should and cannot be talked out of by a plausible
// looking order.

const issue = (seriesId, n) => ({ seriesId, number: n, id: seriesId * 1000 + n });

test('the short path is the main series alone when the main series opens the order', () => {
  const order = [issue(1, 1), issue(2, 1), issue(1, 2), issue(3, 1), issue(1, 3)];
  const kept = essentialOrder({ main: 1 }, order);
  assert.deepEqual(kept.map((i) => i.id), [1001, 1002, 1003]);
});

test('an order that opens on a tie-in gets no short path, because it would start in the middle', () => {
  const order = [issue(2, 1), issue(1, 1), issue(1, 2)];
  assert.equal(essentialOrder({ main: 1 }, order), null);
});

// One issue is a one-shot, not a path through a story, and pairing it with a complete order would
// offer the reader a choice between a reading order and a single comic.
test('a main series of one issue is not offered as a variant', () => {
  assert.equal(essentialOrder({ main: 1 }, [issue(1, 1), issue(2, 1)]), null);
});

test('an empty order is refused rather than yielding an empty variant', () => {
  assert.equal(essentialOrder({ main: 1 }, []), null);
});

test('the short path keeps the order it was given, so publication order survives', () => {
  const order = [issue(1, 3), issue(2, 9), issue(1, 1), issue(1, 2)];
  assert.deepEqual(essentialOrder({ main: 1 }, order).map((i) => i.number), [3, 1, 2]);
});

// essentialOrder refuses for three reasons and only one of them is about starting in the middle,
// so the printed refusal has to say which. Reported as one reason it contradicts itself: a lead of
// 0 reads as "0 comics come before the main series, so reading it alone would start in the middle".
// Only the middle case is reachable from the five events that ship today, which is exactly why the
// other three are asserted here rather than left to a build that cannot produce them. Raised in
// review of this change.
test('each reason the short path is refused is reported as that reason', () => {
  const middle = essentialRefusal({ main: 1 }, [issue(2, 1), issue(2, 2), issue(1, 1)]);
  assert.match(middle, /2 issues come before the main series/);
  assert.match(middle, /start in the middle/);

  assert.match(essentialRefusal({ main: 1 }, [issue(2, 1), issue(1, 1)]), /1 issue comes before/);

  const oneShot = essentialRefusal({ main: 1 }, [issue(1, 1), issue(2, 1)]);
  assert.match(oneShot, /single issue/);
  assert.doesNotMatch(oneShot, /come before|comes before/);

  const empty = essentialRefusal({ main: 1 }, []);
  assert.match(empty, /complete order is empty/);
  assert.doesNotMatch(empty, /come before|comes before/);

  const absent = essentialRefusal({ main: 1 }, [issue(2, 1), issue(3, 1)]);
  assert.match(absent, /absent from the complete order/);
  assert.doesNotMatch(absent, /come before|comes before/);
});

// Every refusal reason must correspond to a real refusal, or the message is describing a case
// essentialOrder does not actually have. Pairing them here keeps the two from drifting apart.
test('every order essentialRefusal explains is one essentialOrder actually refused', () => {
  const refused = [
    [issue(2, 1), issue(2, 2), issue(1, 1)],
    [issue(2, 1), issue(1, 1)],
    [issue(1, 1), issue(2, 1)],
    [],
    [issue(2, 1), issue(3, 1)],
  ];
  for (const order of refused) {
    assert.equal(essentialOrder({ main: 1 }, order), null);
    assert.match(essentialRefusal({ main: 1 }, order), /^no short path, because /);
  }
});

test('the variant checklist is named beside the order it varies from', () => {
  assert.equal(essentialFileName('civil-war.md'), 'civil-war-essential.md');
  // Only the extension is a suffix worth matching, so an event id containing ".md" mid-name
  // cannot be truncated.
  assert.equal(essentialFileName('a.md.b.md'), 'a.md.b-essential.md');
});

// The load-bearing one. Which events have a short path is a claim about Marvel's publication
// dates, and the committed orders are the record of those dates, so the claim is checked against
// them rather than against the list of files someone remembered to generate. Annihilation opens
// on a prologue and four mini-series and King in Black on a Symbiote Spider-Man issue; both are
// therefore expected to have no variant, and if that ever stops being true this fails rather than
// leaving a stale file in place.
test('every event has a short path exactly when its committed order opens on the main series', async () => {
  const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const files = new Set(await readdir(ORDERS));
  let withVariant = 0;
  for (const event of EVENTS) {
    const entry = catalog.lists.find((l) => l.id === event.id);
    assert.ok(entry, `${event.id} is not in the catalog`);
    const { items } = JSON.parse(await readFile(new URL(`../src/data/${entry.file}`, import.meta.url), 'utf8'));
    const opensOnMain = items[0]?.seriesId === event.main;
    const name = essentialFileName(event.file);
    assert.equal(
      files.has(name),
      opensOnMain,
      opensOnMain
        ? `${event.id} opens on its main series but ${name} was not generated`
        : `${name} exists, but ${event.id} opens on series ${items[0]?.seriesId}, not its main series ${event.main}`,
    );
    if (opensOnMain) withVariant += 1;
  }
  assert.equal(withVariant, 3, `expected three events to have a short path, found ${withVariant}`);
});

// A short path that is not a prefix of the long one is not the same story told shorter, it is a
// different list wearing the label. Pinning the subsequence catches a variant vendored from a
// stale checklist, which is the failure mode of generating two files from one source.
test('each pinned short path is the main-series subsequence of its complete order', async () => {
  const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const load = async (id) => {
    const entry = catalog.lists.find((l) => l.id === id);
    assert.ok(entry, `${id} is not in the catalog`);
    return JSON.parse(await readFile(new URL(`../src/data/${entry.file}`, import.meta.url), 'utf8')).items;
  };
  let pairs = 0;
  for (const event of EVENTS) {
    if (!catalog.lists.some((l) => l.id === `${event.id}-essential`)) continue;
    const full = await load(event.id);
    const short = await load(`${event.id}-essential`);
    assert.deepEqual(
      short.map((i) => i.issueId),
      full.filter((i) => i.seriesId === event.main).map((i) => i.issueId),
      `${event.id}-essential is not the main series of ${event.id}, in order`,
    );
    assert.ok(short.length > 1 && short.length < full.length, `${event.id}-essential saves the reader nothing`);
    pairs += 1;
  }
  assert.equal(pairs, 3, `expected three variant pairs, checked ${pairs}`);
});
