import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { mcuPrepSections, parseMcuPrep, releaseDateLabel } from '../src/js/lib/mcuPrep.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const source = { id: 'source', url: 'https://example.com/releases', retrievedAt: '2026-10-08' };
const release = (id, date, phase, title = id) => ({
  id, date, phase, title, format: 'movie', status: 'released', sources: ['source'],
});
const list = (id, extra = {}) => ({
  id, name: id, type: 'screen-companion', characters: [], keywords: [], ...extra,
});
const raw = () => ({
  schemaVersion: 1,
  region: 'US',
  seriesDateKind: 'premiere',
  sources: [source],
  releases: [
    release('late', '2025-05-02', 5, 'Nebula Afterlight'),
    release('season', '2021-08-11', 4, 'Season One'),
    release('early', '2021-01-15', 4, 'The Beginning'),
    release('first', '2014-08-01', 2, 'First Film'),
  ],
  guides: [
    { id: 'late', releases: ['late'] },
    { id: 'general', releases: [], note: 'No specific release.' },
    { id: 'both', releases: ['late', 'early'] },
    { id: 'first', releases: ['first'] },
    { id: 'season', releases: ['season'] },
    { id: 'tie', releases: ['early'] },
  ],
});
const lists = [
  list('late'),
  list('general'),
  list('both', { name: 'Preparation', characters: ['Wolverine'] }),
  list('first'),
  list('season'),
  list('tie'),
  list('new', { characters: ['Spider-Man'] }),
  list('ordinary', { type: 'event' }),
];
const ids = (sections) => sections.flatMap((section) => section.entries.map((entry) => entry.list.id));

test('MCU release organization uses phases and earliest associations in both directions', () => {
  const input = raw();
  const before = JSON.stringify({ input, lists });
  const metadata = parseMcuPrep(input);
  const oldest = mcuPrepSections(lists, metadata);
  assert.deepEqual(oldest.map((section) => section.key), ['phase-2', 'phase-4', 'phase-5', 'unassigned']);
  assert.deepEqual(ids(oldest), ['first', 'both', 'tie', 'season', 'late', 'general', 'new']);
  const newest = mcuPrepSections(lists, metadata, { sort: 'newest' });
  assert.deepEqual(newest.map((section) => section.key), ['phase-5', 'phase-4', 'phase-2', 'unassigned']);
  assert.deepEqual(ids(newest), ['late', 'season', 'both', 'tie', 'first', 'general', 'new']);
  const multi = oldest[1].entries.find((entry) => entry.list.id === 'both');
  assert.deepEqual(multi.releases.map((entry) => entry.id), ['early', 'late']);
  assert.equal(multi.list, lists[2]);
  assert.equal(JSON.stringify({ input, lists }), before);
  assert.deepEqual(mcuPrepSections([], metadata), []);
});

test('MCU release search includes secondary screen titles and existing normalized character matching', () => {
  const metadata = parseMcuPrep(raw());
  assert.deepEqual(ids(mcuPrepSections(lists, metadata, { query: 'Nebula Afterlight' })), ['both', 'late']);
  assert.deepEqual(ids(mcuPrepSections(lists, metadata, { query: 'nebula wolverine' })), ['both']);
  assert.deepEqual(ids(mcuPrepSections(lists, metadata, { query: 'spídérman' })), ['new']);
  assert.deepEqual(ids(mcuPrepSections(lists, metadata, { query: '  preparation ' })), ['both']);
  assert.deepEqual(mcuPrepSections(lists, metadata, { query: 'no-such-reading' }), []);
  assert.equal(ids(mcuPrepSections(lists, metadata, { query: '...' })).length, 7);
});

test('MCU unassigned guides remain once and last, including new guides and missing release metadata', () => {
  const metadata = parseMcuPrep(raw());
  for (const sort of ['oldest', 'newest']) {
    const sections = mcuPrepSections(lists, metadata, { sort });
    assert.equal(sections.at(-1).heading, 'More MCU reading');
    assert.deepEqual(ids([sections.at(-1)]), ['general', 'new']);
    assert.equal(new Set(ids(sections)).size, 7);
  }
  const fallback = mcuPrepSections(lists, null);
  assert.equal(fallback[0].heading, 'MCU Prep reading lists');
  assert.deepEqual(ids(fallback), lists.filter((entry) => entry.type === 'screen-companion').map((entry) => entry.id));
  assert.deepEqual(ids(mcuPrepSections(lists, null, { query: 'Spider-Man' })), ['new']);
});

test('MCU dates preserve year-only precision, stable ties and explicit scheduled status', () => {
  const input = raw();
  input.releases.push(release('year', '2025', 5), release('day', '2025-12-31', 5));
  input.guides.push({ id: 'year', releases: ['year'] }, { id: 'day', releases: ['day'] });
  const metadata = parseMcuPrep(input);
  const dated = [list('year'), list('late'), list('day')];
  assert.deepEqual(ids(mcuPrepSections(dated, metadata)), ['late', 'day', 'year']);
  assert.deepEqual(ids(mcuPrepSections(dated, metadata, { sort: 'newest' })), ['year', 'day', 'late']);
  assert.equal(releaseDateLabel({ date: '2027', status: 'scheduled' }), 'Scheduled: 2027 (year only)');
  assert.equal(releaseDateLabel({ date: '2021-01-15', status: 'released' }), 'Jan 15, 2021');
  assert.equal(releaseDateLabel({ date: '2020-01-01', status: 'scheduled' }), 'Scheduled: Jan 1, 2020');
  assert.equal(releaseDateLabel({ date: '2024-02-29', status: 'released' }, 'en-GB'), '29 Feb 2024');
});

test('MCU metadata rejects malformed facts and unresolved or duplicated references explicitly', () => {
  const cases = [
    (data) => { data.schemaVersion = 2; },
    (data) => { data.region = 'GB'; },
    (data) => { data.seriesDateKind = 'finale'; },
    (data) => { data.sources = null; },
    (data) => { data.sources.push({ ...data.sources[0] }); },
    (data) => { data.sources[0] = { ...source, url: 'javascript:alert(1)' }; },
    (data) => { data.sources[0] = { ...source, url: 'https://user:password@example.com' }; },
    (data) => { data.sources[0] = { ...source, retrievedAt: '2026-02-30' }; },
    (data) => { data.releases.push({ ...data.releases[0] }); },
    (data) => { data.releases[0].title = ' '; },
    (data) => { data.releases[0].phase = 0; },
    (data) => { data.releases[0].phase = '5'; },
    (data) => { data.releases[0].format = 'comic'; },
    (data) => { data.releases[0].status = 'available'; },
    (data) => { data.releases[0].date = '2025-02-29'; },
    (data) => { data.releases[0].date = '2025-04-31'; },
    (data) => { data.releases[0].date = '2025-05'; },
    (data) => { data.releases[0].date = 2025; },
    (data) => { data.releases[0].sources = ['missing']; },
    (data) => { data.releases[0].sources = []; },
    (data) => { data.guides[0].releases = ['missing']; },
    (data) => { data.guides[0].releases = ['late', 'late']; },
    (data) => { data.guides[1].note = ''; },
    (data) => { data.guides.push({ ...data.guides[0] }); },
  ];
  for (const mutate of cases) {
    const input = structuredClone(raw());
    mutate(input);
    assert.throws(() => parseMcuPrep(input), /MCU release metadata:/, mutate.toString());
  }
  assert.throws(() => parseMcuPrep(null), /MCU release metadata:/);
  assert.throws(() => mcuPrepSections(lists, null, { sort: 'invalid' }), /release order/);
});

test('published MCU associations bind exact catalog identities without changing catalog order', () => {
  const catalog = parseCatalog(json('../src/data/catalog.json'));
  const input = json('../src/data/mcu-prep.json');
  const metadata = parseMcuPrep(input);
  const expected = json('./fixtures/mcu-prep-release-order.json');
  const companions = catalog.lists.filter((entry) => entry.type === 'screen-companion');
  const before = JSON.stringify(catalog);
  const byId = new Map(companions.map((entry) => [entry.id, entry]));
  for (const id of metadata.guides.keys()) assert.ok(byId.has(id), `Unknown screen companion: ${id}`);
  const referenced = new Set(input.guides.flatMap((guide) => guide.releases));
  assert.deepEqual([...referenced].sort(), [...metadata.releases.keys()].sort());
  const sections = mcuPrepSections(catalog.lists, metadata);
  assert.deepEqual(ids(sections).slice().sort(), companions.map((entry) => entry.id).sort());
  assert.deepEqual(ids(sections).filter((id) => expected.oldestFirst.includes(id)), expected.oldestFirst);
  assert.deepEqual(ids(sections).filter((id) => expected.unassigned.includes(id)), expected.unassigned);
  const sorted = mcuPrepSections(catalog.lists, metadata, { sort: 'newest' });
  assert.deepEqual(ids(sorted).filter((id) => expected.oldestFirst.includes(id)), [
    ...expected.oldestFirst.filter((id) => !expected.unassigned.includes(id)).reverse(),
    ...expected.unassigned,
  ]);
  const avengers = metadata.guides.get('avengers-doomsday-secret-wars');
  assert.deepEqual(avengers.map(({ date, status }) => ({ date, status })), [
    { date: '2026-12-18', status: 'scheduled' },
    { date: '2027', status: 'scheduled' },
  ]);
  assert.equal(JSON.stringify(catalog), before);
  for (const section of sections) {
    for (const entry of section.entries) assert.equal(entry.list, byId.get(entry.list.id));
  }
});

test('the browser removal mutation reaches the real MCU hook with either checkout line ending', async () => {
  const { mcuPrepOrganizationMutation } = await import('../scripts/browser-mcu-prep-organization.mjs');
  const main = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  for (const ending of ['\n', '\r\n']) {
    const source = main.replace(/\r?\n/g, ending);
    const changed = mcuPrepOrganizationMutation.rewriteMain(source);
    assert.notEqual(changed, source);
    assert.doesNotMatch(changed, /await mcuPrepView\.render\(catalog/);
    assert.match(changed, /async function renderPublishingCategory/);
  }
});
