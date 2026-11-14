import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  editionCatalog, editionEvidence, editionRelations, editionCoverage, providerLinks,
} from '../src/js/lib/collectedEditions.js';
import { collectedEditionCredit, collectedEditionLabels } from '../src/js/views/shared/collected-editions.js';
import { build, buildAppData, databaseLeaks, loadInputs, validateDestinations } from '../scripts/collected-editions.mjs';
import { providerRequestsBlocked } from '../scripts/browser-collected-editions.mjs';
import { serializeChecklist } from '../src/js/lib/markdown.js';

const clone = (value) => structuredClone(value);
const el = (tag, props, children = []) => ({ tag, ...props, children: [].concat(children).filter(Boolean) });
const item = { issueId: 7, seriesId: 8, number: '1', collectedIn: 'My heading' };
const catalog = {
  editions: { book: { title: '<Curated book>', destinations: [] } },
  providers: {},
};
const relation = {
  catalogId: 'list', editionId: 'book', ...item, status: 'verified', portion: 'full', conflicts: [],
  source: 'https://www.comics.org/issue/1/', checkedAt: '2026-11-10',
};
const evidence = { relations: [relation] };
const approval = 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560';
const destination = {
  provider: 'hoopla', url: 'https://www.hoopladigital.com/title/123456789', checkedAt: '2026-11-10', confirmedBy: 'owner',
};
const libby = { provider: 'libby', url: 'https://share.libbyapp.com/title/1234567', checkedAt: '2026-11-10', confirmedBy: 'owner' };
const approved = () => ({
  ...clone(catalog),
  providers: {
    hoopla: { name: 'Hoopla', basis: 'owner-approval', basisEvidence: approval, providerPermission: 'not-received' },
    libby: { name: 'Libby', basis: 'owner-approval', basisEvidence: approval, providerPermission: 'not-requested' },
  },
});

test('only exact full conflict-free relations label an issue', () => {
  assert.equal(editionRelations('list', item, catalog, evidence).length, 1);
  for (const change of [
    { status: 'consistent' }, { status: 'conflict' }, { status: 'verified-with-conflicts' },
    { portion: 'partial' }, { conflicts: ['conflict'] }, { conflicts: undefined },
    { source: '' }, { checkedAt: '' }, { seriesId: 99 }, { issueId: 99 }, { number: '1a' },
  ]) {
    assert.deepEqual(editionRelations('list', item, catalog, { relations: [{ ...relation, ...change }] }), [], JSON.stringify(change));
  }
  assert.deepEqual(editionRelations('custom', item, catalog, evidence), []);
  assert.deepEqual(editionRelations(null, item, catalog, evidence), []);
  assert.deepEqual(editionRelations('list', { ...item, number: '1.0' }, catalog, evidence), []);
});

test('current membership and overlapping editions use set coverage without changing headings or export', () => {
  const second = { ...item, issueId: 9, number: '2' };
  const before = JSON.stringify([item, second]);
  const list = { name: 'Fixture', items: [item, second] };
  const markdown = serializeChecklist(list);
  const overlap = {
    relations: [relation, relation, { ...relation, editionId: 'other' },
      { ...relation, ...second }],
  };
  const books = { ...catalog, editions: { ...catalog.editions, other: { title: 'Alternative' } } };
  assert.equal(editionRelations('list', item, books, overlap).length, 2);
  assert.deepEqual(editionCoverage('list', [second, item, item], books, overlap),
    { covered: 2, total: 2, editions: ['book', 'other'] });
  assert.deepEqual(editionCoverage('list', [second], books, overlap), { covered: 1, total: 1, editions: ['book'] });
  assert.equal(editionCoverage('list', [{ ...item, issueId: 999 }], books, overlap).covered, 0);
  assert.equal(JSON.stringify([item, second]), before);
  assert.equal(serializeChecklist(list), markdown);
});

test('a link needs a recorded basis and an owner-confirmed address on a real checked date', () => {
  const book = { title: 'Fixture', destinations: [destination, libby] };
  assert.deepEqual(providerLinks(book, approved()), [
    { provider: 'hoopla', name: 'Hoopla', preposition: 'on', url: destination.url },
    { provider: 'libby', name: 'Libby', preposition: 'in', url: libby.url },
  ]);
  for (const change of [
    { basis: 'granted' }, { basis: 'pending' }, { basis: undefined }, { basisEvidence: undefined },
    { basisEvidence: 'Owner said yes' }, { basisEvidence: 'https://example.test/issues/1#issuecomment-1' },
    { name: '' },
  ]) {
    const policy = approved();
    Object.assign(policy.providers.hoopla, change);
    assert.deepEqual(providerLinks({ destinations: [destination] }, policy), [], JSON.stringify(change));
  }
  for (const change of [
    { confirmedBy: undefined }, { confirmedBy: 'ai' }, { checkedAt: '' }, { checkedAt: '2026-02-30' },
    { checkedAt: '10/11/2026' }, { provider: 'unknown' }, { provider: 'constructor' },
  ]) {
    assert.deepEqual(providerLinks({ destinations: [{ ...destination, ...change }] }, approved()), [], JSON.stringify(change));
  }
  assert.deepEqual(providerLinks({ destinations: [destination, { ...destination, url: 'https://www.hoopladigital.com/title/1' }] }, approved())
    .map((link) => link.url), [destination.url]);
  for (const url of [
    'http://www.hoopladigital.com/title/123', 'https://www.hoopladigital.com.evil.test/title/123',
    'https://user@www.hoopladigital.com/title/123', 'https://www.hoopladigital.com:444/title/123',
    'https://www.hoopladigital.com/title/123?card=private', 'https://www.hoopladigital.com/title/123#x',
    'https://www.hoopladigital.com/search?q=book', 'https://hoopladigital.com/title/123',
    'https://share.libbyapp.com/title/123', 'javascript:alert(1)', 'not a URL',
  ]) assert.deepEqual(providerLinks({ destinations: [{ ...destination, url }] }, approved()), [], url);
  for (const url of [
    'http://share.libbyapp.com/title/123', 'https://libbyapp.com/library/lapl/everything/page-1/123',
    'https://share.libbyapp.com/title/123/', 'https://share.libbyapp.com/title/abc',
    'https://share.libbyapp.com/title/123?library=lapl', 'https://link.overdrive.com/?websiteID=1&titleID=123',
    'https://share.libbyapp.com.evil.test/title/123', 'https://www.hoopladigital.com/title/123',
  ]) assert.deepEqual(providerLinks({ destinations: [{ ...libby, url }] }, approved()), [], url);
});

test('provider addresses reject empty query and fragment markers', () => {
  const cases = [
    { ...destination, url: 'https://www.hoopladigital.com/title/123' },
    { ...destination, url: 'https://www.hoopladigital.com/comic/example/123' },
    { ...libby, url: 'https://share.libbyapp.com/title/123' },
  ];
  assert.deepEqual(cases.filter((entry) => providerLinks({ destinations: [entry] }, approved()).length !== 1), []);
  const rejected = cases.flatMap((entry) => ['?', '#'].map((suffix) => ({ ...entry, url: entry.url + suffix })));
  assert.deepEqual(rejected.filter((entry) => providerLinks({ destinations: [entry] }, approved()).length), []);
});

test('provider network proof counts blocked requests rather than failure events', () => {
  const attempts = [
    { target: 'source', id: 'one', url: 'https://www.hoopladigital.com/title/123456789', received: false },
    { target: 'tab-one', id: 'two', url: 'https://www.hoopladigital.com/title/123456789', received: false },
    { target: 'tab-two', id: 'three', url: 'https://share.libbyapp.com/title/123456', received: false },
  ];
  const failures = attempts.flatMap(({ target, id }) => [
    { target, id, error: 'net::ERR_BLOCKED_BY_CLIENT' },
    ...(target === 'source' ? [] : [{ target, id, error: 'net::ERR_ABORTED' }]),
  ]);
  const monitor = { attempts, failures, completed: [], errors: [] };
  assert.equal(providerRequestsBlocked(monitor), true);
  assert.equal(providerRequestsBlocked({ ...monitor, completed: [{ target: 'tab-one', id: 'two' }] }), false);
  assert.equal(providerRequestsBlocked({ ...monitor, attempts: attempts.map((entry, index) =>
    index === 1 ? { ...entry, received: true } : entry) }), false);
  assert.equal(providerRequestsBlocked({ ...monitor, failures: failures.filter((entry) => entry.id !== 'two'
    || entry.error !== 'net::ERR_BLOCKED_BY_CLIENT') }), false);
  assert.equal(providerRequestsBlocked({ ...monitor, attempts: attempts.slice(0, 2) }), false);
  assert.equal(providerRequestsBlocked({ ...monitor, errors: ['monitor error'] }), false);
});

test('the build refuses any destination the display gate would drop', () => {
  const inputs = loadInputs();
  const ids = new Set(inputs.pilot.editions.map((edition) => edition.id));
  const id = [...ids][0];
  const good = { provider: 'libby', url: libby.url, checkedAt: '2026-11-12', confirmedBy: 'owner', source: 'Cowork batch 1' };
  const check = (list, providers = inputs.destinations.providers) => validateDestinations(
    { ...inputs.destinations, providers, destinations: { [id]: list } }, ids);
  assert.deepEqual(validateDestinations(inputs.destinations, ids), []);
  assert.deepEqual(check([good]), []);
  for (const bad of [
    { ...good, url: 'https://share.libbyapp.com/title/1?x=1' }, { ...good, confirmedBy: 'ai' },
    { ...good, checkedAt: '2026-13-01' }, { ...good, source: '' }, { ...good, availability: 'available' },
  ]) assert.notDeepEqual(check([bad]), [], JSON.stringify(bad));
  assert.notDeepEqual(check([good, good]), []);
  assert.notDeepEqual(validateDestinations({ ...inputs.destinations, destinations: { unknown: [good] } }, ids), []);
  assert.notDeepEqual(check([good], { ...inputs.destinations.providers, libby: { name: 'Libby', basis: 'granted' } }), []);
  const outputs = build({ ...inputs, destinations: { ...inputs.destinations, destinations: { [id]: [good] } } });
  const app = buildAppData({ ...inputs, destinations: { ...inputs.destinations, destinations: { [id]: [good] } } }, outputs);
  assert.ok(app['collectedEditionCatalog.js'].includes(good.url));
  assert.doesNotMatch(app['collectedEditionCatalog.js'], /Cowork batch 1/);
});

test('row renderer uses text, hedged link wording, and only accepted links add row tab stops', () => {
  const pending = collectedEditionLabels(el, 'list', item, catalog, evidence);
  assert.equal(pending.children[0].children[0].text, 'Collected in <Curated book>');
  assert.equal(pending.children[0].children.length, 1);
  assert.equal(collectedEditionLabels(el, 'custom', item, catalog, evidence), null);
  const policy = approved();
  policy.editions.book.destinations = [destination, libby];
  const rendered = collectedEditionLabels(el, 'list', item, policy, evidence);
  const link = rendered.children[0].children[1];
  assert.equal(link.tag, 'a');
  assert.equal(link.href, destination.url);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.equal(link.text, 'Look for this book on Hoopla');
  assert.equal(link['aria-label'], 'Look for this book on Hoopla: <Curated book> (opens outside Recap Page)');
  assert.equal(rendered.children[0].children[2].text, 'Look for this book in Libby');
  for (const anchor of rendered.children[0].children.slice(1)) {
    // SC 2.5.3: the shown words, reduced as speech input reduces them, must run unbroken in the name.
    const words = (s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
    assert.ok(words(anchor['aria-label']).includes(words(anchor.text)), `${anchor['aria-label']} lacks ${anchor.text}`);
    assert.doesNotMatch(`${anchor.text} ${anchor['aria-label']}`, /borrow|available|free|read now/i);
  }
  const credit = collectedEditionCredit(el);
  assert.equal(credit.children.filter((child) => child.tag === 'a').length, 2);
  assert.match(credit.children.join(' '), /adapted/);
  assert.match(credit.children.join(' '), /not that it can be borrowed/);
});

test('the bundled projection preserves pilot relations and matches selected Modern Timeline issues', () => {
  assert.equal(editionEvidence.license, 'CC BY-SA 4.0');
  assert.match(editionEvidence.attribution, /Grand Comics Database/);
  assert.ok(editionEvidence.modification);
  const groups = {};
  for (const entry of editionEvidence.relations) (groups[entry.catalogId] ||= []).push(entry);
  assert.equal(groups['civil-war-avengers'].length, 13);
  assert.equal(groups['nebula-reading-order'].length, 10);
  const expected = {
    'marvel-knights-to-planet-x-01': ['daredevil-visionaries-kevin-smith', 449, 1, 6],
    'marvel-knights-to-planet-x-04': ['xtreme-xmen-v1-destiny', 646, 1, 4],
    'marvel-knights-to-planet-x-09': ['exiles-v1-down-the-rabbit-hole', 479, 1, 4],
    'marvel-knights-to-planet-x-11': ['xtreme-xmen-savage-land', 2107, 1, 4],
    'marvel-knights-to-planet-x-12': ['new-xmen-v2-imperial', 2281, 118, 122],
    'marvel-knights-to-planet-x-14': ['xtreme-xmen-v1-destiny', 646, 5, 9],
    'marvel-knights-to-planet-x-15': ['new-xmen-v2-imperial', 2281, 123, 125],
    'marvel-knights-to-planet-x-18': ['exiles-v2-a-world-apart', 479, 5, 11],
    'marvel-knights-to-planet-x-20': ['daredevil-v4-underboss', 449, 26, 31],
    'marvel-knights-to-planet-x-23': ['xtreme-xmen-v2-invasion', 646, 10, 18],
    'marvel-knights-to-planet-x-27': ['exiles-v3-out-of-time', 479, 12, 19],
    'marvel-knights-to-planet-x-42': ['new-xmen-v4-riot-at-xaviers', 2281, 134, 138],
    'marvel-knights-to-planet-x-69': ['daredevil-v8-echo-vision-quest', 449, 51, 55],
  };
  const lists = loadInputs().lists;
  assert.deepEqual(Object.keys(groups).sort(), ['civil-war-avengers', 'nebula-reading-order', ...Object.keys(expected)].sort());
  for (const [listId, [book, series, first, last]] of Object.entries(expected)) {
    const items = lists[listId].items.filter((entry) => entry.seriesId === series
      && Number(entry.number) >= first && Number(entry.number) <= last);
    assert.equal(items.length, last - first + 1, listId);
    assert.deepEqual(groups[listId].map((entry) => [entry.editionId, entry.issueId, entry.seriesId, entry.number]),
      items.map((entry) => [book, entry.issueId, entry.seriesId, String(entry.number)]), listId);
  }
  assert.ok(!editionEvidence.relations.some((entry) =>
    entry.editionId === 'new-xmen-v2-imperial' && entry.seriesId === 2281 && entry.number === '126'));
  assert.ok(!editionEvidence.relations.some((entry) =>
    entry.editionId === 'daredevil-visionaries-kevin-smith' && ['7', '8'].includes(entry.number)));
  assert.ok(!editionEvidence.relations.some((entry) => /x-corps|hardcover/.test(entry.editionId)));
  assert.deepEqual(databaseLeaks(editionCatalog, 'runtime MIT names'), []);
  assert.deepEqual(editionCatalog.providers, approved().providers);
  for (const book of Object.values(editionCatalog.editions)) {
    assert.equal(providerLinks(book).length, book.destinations.length, book.title);
    for (const entry of book.destinations) assert.deepEqual(Object.keys(entry).sort(), ['checkedAt', 'confirmedBy', 'provider', 'url']);
  }
  for (const file of ['collectedEditionCatalog.js', 'collectedEditionEvidence.js']) {
    const text = readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /contentId|"cover"|availab|amazon|amzn/i);
  }
  assert.doesNotMatch(readFileSync(new URL('../src/data/collectedEditionEvidence.js', import.meta.url), 'utf8'), /hoopladigital|libbyapp/);
});

test('runtime generation excludes conflicts and never changes the curated names lane', () => {
  const inputs = loadInputs();
  const outputs = build(inputs);
  const before = buildAppData(inputs, outputs);
  for (const check of outputs['gcd-editions.json'].editions.map((book) => book.check)) {
    if (check.status === 'verified') check.conflicts.push({ kind: 'new-conflict' });
  }
  const after = buildAppData(inputs, outputs);
  assert.match(after['collectedEditionEvidence.js'], /"relations": \[\]/);
  assert.match(after['collectedEditionCatalog.js'], /"editions": \{\}/);
  assert.ok(before['collectedEditionEvidence.js'].includes('CC-BY-SA-4.0'));
});

test('owner-confirmed destinations are limited to released editions', () => {
  const inputs = loadInputs();
  const destinations = inputs.destinations.destinations;
  const actual = Object.fromEntries(Object.entries(destinations).map(([editionId, entries]) => [
    editionId, entries.map(({ provider, url }) => [provider, url]),
  ]));
  assert.deepEqual(actual, {
    'xtreme-xmen-v1-destiny': [['libby', 'https://share.libbyapp.com/title/13812993']],
    'civil-war-2007-tpb': [
      ['hoopla', 'https://www.hoopladigital.com/title/12003677'],
      ['libby', 'https://share.libbyapp.com/title/4455520'],
    ],
    'asgardians-v1-the-infinity-armada': [
      ['hoopla', 'https://www.hoopladigital.com/title/12917385'],
      ['libby', 'https://share.libbyapp.com/title/5832334'],
    ],
    'asgardians-v2-war-of-the-realms': [
      ['hoopla', 'https://www.hoopladigital.com/title/12917346'],
      ['libby', 'https://share.libbyapp.com/title/8114341'],
    ],
    'new-xmen-v2-imperial': [
      ['hoopla', 'https://www.hoopladigital.com/title/12650921'],
      ['libby', 'https://share.libbyapp.com/title/5408074'],
    ],
    'new-xmen-v4-riot-at-xaviers': [
      ['hoopla', 'https://www.hoopladigital.com/title/12650794'],
      ['libby', 'https://share.libbyapp.com/title/5408076'],
    ],
    'daredevil-v8-echo-vision-quest': [
      ['hoopla', 'https://www.hoopladigital.com/title/14762070'],
      ['libby', 'https://share.libbyapp.com/title/8364770'],
    ],
  });
  assert.equal(Object.keys(editionCatalog.editions).length, 15);
  for (const entries of Object.values(destinations).flat()) {
    assert.equal(entries.checkedAt, '2026-11-13');
    assert.equal(entries.confirmedBy, 'owner');
    assert.match(entries.source, /0b85d0cc1942a6600d3ba08731759475294f2977576889a439f78f212990b17d/);
  }
});

test('heading-free selections project only exact verified comics from the chosen list', () => {
  const inputs = loadInputs();
  const source = inputs.lists.civil_war_avengers.items.filter((row) => row.seriesId === 1067);
  assert.ok(source.length > 1);
  inputs.catalog.lists.push({ id: 'selection-test', file: 'selection_test.json' });
  inputs.lists['selection-test'] = {
    id: 'selection-test',
    items: [
      { ...source[0], collectedIn: undefined },
      { ...source[1], collectedIn: undefined },
      { ...source[0], issueId: 900001, number: '99', collectedIn: undefined },
      { ...source[0], issueId: 900002, seriesId: 900, collectedIn: undefined },
    ],
  };
  inputs.gcdInputs.listSelections = [
    { listId: 'selection-test', file: 'src/data/selection_test.json', editions: ['civil-war-2007-tpb'] },
  ];
  const outputs = build(inputs);
  const project = () => {
    const text = buildAppData(inputs, outputs)['collectedEditionEvidence.js'];
    return JSON.parse(text.slice(text.indexOf(' = ') + 3, text.lastIndexOf(';'))).relations
      .filter((entry) => entry.catalogId === 'selection-test');
  };
  assert.deepEqual(project().map((entry) => entry.issueId), source.slice(0, 2).map((entry) => entry.issueId));
  const check = outputs['gcd-editions.json'].editions.find((entry) => entry.edition === 'civil-war-2007-tpb').check;
  const excluded = [];
  for (const change of [{ status: 'consistent' }, { status: 'verified-with-conflicts' }, { conflicts: [{ kind: 'test' }] }]) {
    const saved = clone(check);
    Object.assign(check, change);
    excluded.push(project());
    Object.assign(check, saved);
  }
  assert.deepEqual(excluded, [[], [], []]);
  inputs.gcdInputs.listSelections = [];
  assert.deepEqual(project(), []);
});

test('heading-free selection rejects unknown, duplicate and mismatched references', () => {
  const inputs = loadInputs();
  const source = inputs.lists.civil_war_avengers;
  inputs.catalog.lists.push({ id: 'selection-test', file: 'selection_test.json' });
  inputs.lists['selection-test'] = { ...clone(source), id: 'selection-test' };
  const valid = { listId: 'selection-test', file: 'src/data/selection_test.json', editions: ['civil-war-2007-tpb'] };
  for (const selection of [
    { ...valid, editions: ['missing'] },
    { ...valid, editions: ['civil-war-2007-tpb', 'civil-war-2007-tpb'] },
    { ...valid, file: 'src/data/another_list.json' },
    { ...valid, listId: 'missing' },
  ]) {
    inputs.gcdInputs.listSelections = [selection];
    assert.throws(() => buildAppData(inputs, build(inputs)), /selection/i, JSON.stringify(selection));
  }
  inputs.gcdInputs.listSelections = [valid, clone(valid)];
  assert.throws(() => buildAppData(inputs, build(inputs)), /selection/i);
});
