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

test('Civil War links follow the seven verified comics in each list variant', async (t) => {
  for (const [listId, file] of [
    ['civil-war-essential', 'civil_war_essential.json'],
    ['civil-war', 'civil_war.json'],
  ]) {
    await t.test(listId, () => {
      const list = JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
      const matches = list.items.filter((entry) => entry.seriesId === 1067);
      assert.deepEqual(matches.map((entry) => Number(entry.number)), [1, 2, 3, 4, 5, 6, 7]);
      for (const issue of matches) {
        const book = editionRelations(listId, issue).find((entry) => entry.id === 'civil-war-2007-tpb');
        assert.ok(book, `${listId} #${issue.number}`);
        assert.deepEqual(book.links.map(({ provider, url }) => [provider, url]), [
          ['hoopla', 'https://www.hoopladigital.com/title/12003677'],
          ['libby', 'https://share.libbyapp.com/title/4455520'],
        ]);
      }
      assert.deepEqual(
        editionEvidence.relations.filter((entry) =>
          entry.catalogId === listId && entry.editionId === 'civil-war-2007-tpb').map((entry) => entry.issueId),
        matches.map((entry) => entry.issueId),
      );
      for (const issue of list.items.filter((entry) => entry.seriesId !== 1067)) {
        assert.ok(!editionRelations(listId, issue).some((entry) => entry.id === 'civil-war-2007-tpb'));
      }
    });
  }
});

test('Warbound links follow the independently identified originals in both lists', () => {
  const inputs = loadInputs();
  const id = 'world-war-hulk-warbound';
  const edition = inputs.pilot.editions.find((entry) => entry.id === id);
  assert.ok(edition, 'the selected book exists');
  const check = inputs.gcdInputs.editions[id];
  const source = inputs.gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  const collection = inputs.gcdInputs.seriesEvidence[check.collectionSeriesId].series;
  const trade = inputs.fixtures[edition.gcdIssueId].issue;
  assert.equal(collection.api_url, trade.series);
  assert.deepEqual(collection.active_issues, [trade.api_url]);
  assert.equal(collection.binding.toLowerCase(), edition.format);
  assert.equal(trade.isbn, '');
  assert.equal(trade.notes, 'Collects WWH Aftersmash: Warbound (Marvel, 2008 series) #1-5.');
  assert.equal(source.api_url, 'https://www.comics.org/api/series/33241/?format=json');
  assert.deepEqual(check.originalIssues.map(({ appNumber }) => appNumber), [1, 2, 3, 4, 5]);
  const listIds = ['world-war-hulk-aftersmash', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide'];
  for (const listId of listIds) {
    const items = inputs.lists[listId].items.filter((entry) => entry.seriesId === 3171);
    assert.deepEqual(items.map((entry) => Number(entry.number)), [1, 2, 3, 4, 5]);
    for (const { appNumber, gcdIssueId, onSaleDate } of check.originalIssues) {
      const original = inputs.fixtures[gcdIssueId].issue;
      const item = items.find((entry) => entry.number === String(appNumber));
      assert.equal(original.series, source.api_url);
      assert.equal(original.number, item.number);
      assert.equal(original.variant_of, null);
      assert.equal(original.story_set.find((story) => story.type === 'comic story').script, 'Greg Pak');
      if (appNumber === 1) assert.equal(item.onSale.slice(0, 10), onSaleDate);
      else {
        assert.notEqual(item.onSale.slice(0, 10), onSaleDate);
        assert.equal(item.onSale.slice(0, 7), original.key_date.slice(0, 7));
      }
      const links = editionRelations(listId, item).find((entry) => entry.id === id)?.links;
      assert.deepEqual(links?.map(({ provider, url }) => [provider, url]),
        [['hoopla', 'https://www.hoopladigital.com/title/15006597']]);
    }
    assert.equal(editionEvidence.relations.filter((entry) =>
      entry.catalogId === listId && entry.editionId === id).length, 5);
  }
  const outputs = build(inputs);
  const result = outputs['gcd-editions.json'].editions.find((entry) => entry.edition === id).check;
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.verifiedComics, ['3171:1', '3171:2', '3171:3', '3171:4', '3171:5']);
  const bad = clone(inputs);
  bad.fixtures[edition.gcdIssueId].issue.notes = trade.notes.replace('#1-5', '#1-4');
  const rejected = build(bad);
  assert.notEqual(rejected['gcd-editions.json'].editions.find((entry) => entry.edition === id).check.status, 'verified');
  assert.ok(!buildAppData(bad, rejected)['collectedEditionEvidence.js'].includes(`"editionId": "${id}"`));
});

test('returned links follow their verified list comics', () => {
  const cases = [
    ['spider-verse', 'spider_verse.json', 'amazing-spider-man-edge-of-spider-verse', 19075, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/12205516'],
    ]],
    ['infinity-countdown-wars', 'infinity_countdown_wars.json', 'doctor-strange-waid-v1-across-the-universe', 24296, [3], [
      ['hoopla', 'https://www.hoopladigital.com/title/13897690'],
    ]],
    ['axis', 'axis.json', 'loki-agent-of-asgard-v2-i-cannot-tell-a-lie', 18340, [6, 7, 8, 9], [
      ['hoopla', 'https://www.hoopladigital.com/title/12687655'],
      ['libby', 'https://share.libbyapp.com/title/5863852'],
    ]],
    ['war-of-the-realms', 'war_of_the_realms.json', 'asgardians-v2-war-of-the-realms', 25996, [8, 9, 10], [
      ['hoopla', 'https://www.hoopladigital.com/title/12917346'],
      ['libby', 'https://share.libbyapp.com/title/8114341'],
    ]],
    ['war-of-the-realms', 'war_of_the_realms.json', 'war-of-the-realms-journey-into-mystery', 27320, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/12917438'],
      ['libby', 'https://share.libbyapp.com/title/8114272'],
    ]],
    ['war-of-the-realms', 'war_of_the_realms.json', 'war-of-the-realms-new-agents-of-atlas', 27505, [1, 2, 3, 4], [
      ['hoopla', 'https://www.hoopladigital.com/title/12917437'],
      ['libby', 'https://share.libbyapp.com/title/5678469'],
    ]],
    ['world-war-hulk-aftersmash', 'world_war_hulk_aftersmash.json', 'world-war-hulk-warbound', 3171, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/15006597'],
    ]],
    ['planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'planet_hulk_reading_order_and_greg_pak_hulk_comics_guide.json', 'world-war-hulk-warbound', 3171, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/15006597'],
    ]],
    ['iron-man-2020', 'iron_man_2020.json', 'iron-man-2020-robot-revolution', 28356, [1, 2, 3, 4, 5, 6], []],
    ['infinity-countdown-wars', 'infinity_countdown_wars.json', 'asgardians-v1-the-infinity-armada', 25996, [1, 2], [
      ['hoopla', 'https://www.hoopladigital.com/title/12917385'],
      ['libby', 'https://share.libbyapp.com/title/5832334'],
    ]],
    ['x-men-divided-we-stand', 'x_men_divided_we_stand.json', 'young-xmen-v1-final-genesis', 4443, [1, 2, 3, 4, 5], []],
    ['marvel-knights-to-planet-x-33', 'marvel_knights_to_planet_x_33.json', 'uncanny-xmen-v1-hope', 2258, [410, 411, 412, 413, 414, 415], []],
    ['marvel-knights-to-planet-x-37', 'marvel_knights_to_planet_x_37.json', 'xtreme-xmen-v3-schism', 646, [19, 20, 21, 22, 23], []],
    ['marvel-knights-to-planet-x-41', 'marvel_knights_to_planet_x_41.json', 'exiles-v4-legacy', 479, [20, 21, 22, 23, 24, 25], []],
    ['marvel-knights-to-planet-x-51', 'marvel_knights_to_planet_x_51.json', 'xtreme-xmen-v5-god-loves', 646, [25, 26, 27, 28, 29, 30], []],
    ['marvel-knights-to-planet-x-59', 'marvel_knights_to_planet_x_59.json', 'exiles-v5-unnatural-instincts', 479, [26, 27, 28, 29, 30], []],
    ['marvel-knights-to-planet-x-64', 'marvel_knights_to_planet_x_64.json', 'spectacular-spider-man-v1-hunger', 556, [1, 2, 3, 4, 5], []],
    ['marvel-knights-to-planet-x-77', 'marvel_knights_to_planet_x_77.json', 'xtreme-xmen-v7-storm-arena', 646, [36, 37, 38, 39], []],
    ['siege-dark-reign-prelude', 'siege_dark_reign_prelude.json', 'mighty-avengers-earths-mightiest', 1866, [21, 22, 23, 24, 25, 26], []],
    ['doomwar', 'doomwar.json', 'doomwar-2011-tpb', 9240, [1, 2, 3, 4, 5, 6], [
      ['hoopla', 'https://www.hoopladigital.com/title/15293370'],
      ['libby', 'https://share.libbyapp.com/title/9203113'],
    ]],
    ['x-men-regenesis', 'x_men_regenesis.json', 'avengers-academy-second-semester', 9086, [22], [
      ['libby', 'https://share.libbyapp.com/title/13637356'],
    ]],
    ['secret-invasion', 'secret_invasion.json', 'secret-invasion-front-line', 5213, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/15183611'],
      ['libby', 'https://share.libbyapp.com/title/9227009'],
    ]],
    ['secret-invasion', 'secret_invasion.json', 'secret-invasion-fantastic-four', 4886, [1, 2, 3], [
      ['hoopla', 'https://www.hoopladigital.com/title/14279808'],
      ['libby', 'https://share.libbyapp.com/title/7785428'],
    ]],
    ['secret-invasion', 'secret_invasion.json', 'secret-invasion-x-men', 5364, [1, 2, 3, 4], [
      ['hoopla', 'https://www.hoopladigital.com/title/15183606'],
      ['libby', 'https://share.libbyapp.com/title/9227013'],
    ]],
    ['civil-war-avengers', 'civil_war_avengers.json', 'mighty-avengers-v1-ultron', 1866, [1, 2, 3, 4, 5, 6], [
      ['hoopla', 'https://www.hoopladigital.com/title/15183607'],
      ['libby', 'https://share.libbyapp.com/title/9192151'],
    ]],
    ['siege-dark-reign-prelude', 'siege_dark_reign_prelude.json', 'siege-mighty-avengers', 1866, [32, 33, 34, 35, 36], [
      ['libby', 'https://share.libbyapp.com/title/9465007'],
    ]],
    ['chaos-war', 'chaos_war.json', 'chaos-war-2011-tpb', 11854, [1, 2, 3, 4, 5], [
      ['hoopla', 'https://www.hoopladigital.com/title/14794072'],
      ['libby', 'https://share.libbyapp.com/title/8771019'],
    ]],
  ];
  for (const [listId, file, editionId, seriesId, numbers, links] of cases) {
    const list = JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
    const items = list.items.filter((entry) => entry.seriesId === seriesId && numbers.includes(Number(entry.number)));
    assert.deepEqual(items.map((entry) => Number(entry.number)), numbers);
    for (const issue of items) {
      const editions = editionRelations(listId, issue);
      const book = editions.find((entry) => entry.id === editionId);
      assert.ok(book, `${listId} #${issue.number}`);
      assert.deepEqual(book.links.map(({ provider, url }) => [provider, url]), links);
    }
    const related = editionEvidence.relations.filter((entry) => entry.editionId === editionId && entry.catalogId === listId);
    assert.deepEqual(related.map((entry) => entry.issueId), items.map((entry) => entry.issueId));
  }
});

test('Journey Into Mystery uses the dated original series and exact collected issues', () => {
  const { gcdInputs, fixtures, lists } = loadInputs();
  const check = gcdInputs.editions['war-of-the-realms-journey-into-mystery'];
  const series = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  const trade = fixtures[2023510].issue;
  assert.equal(series.name.toLowerCase(), 'war of the realms: journey into mystery');
  assert.equal(series.year_began, 2019);
  assert.equal(trade.isbn, '978-1-302-91834-7');
  assert.equal(trade.notes, 'Collects War of the Realms: Journey Into Mystery (Marvel, 2019 series) #1-5.');
  assert.deepEqual(check.originalIssues.map(({ appNumber, gcdIssueId }) => [appNumber, gcdIssueId]), [
    [1, 1947974], [2, 1961181], [3, 1966454], [4, 1974716], [5, 1978220],
  ]);
  for (const { appNumber, gcdIssueId } of check.originalIssues) {
    const original = fixtures[gcdIssueId].issue;
    const items = lists['war-of-the-realms'].items.filter((entry) =>
      entry.seriesId === 27320 && entry.number === String(appNumber));
    assert.equal(items.length, 1);
    assert.equal(items[0].seriesName, 'War of the Realms: Journey Into Mystery (2019)');
    assert.equal(original.series, series.api_url);
    assert.equal(original.number, String(appNumber));
    assert.equal(original.variant_of, null);
    assert.match(original.key_date, /^2019-/);
  }
});

test('New Agents of Atlas uses the matching trade and original issues', () => {
  const { gcdInputs, fixtures, lists, pilot } = loadInputs();
  const id = 'war-of-the-realms-new-agents-of-atlas';
  const edition = pilot.editions.find((entry) => entry.id === id);
  assert.ok(edition);
  const check = gcdInputs.editions[id];
  const source = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  const collection = gcdInputs.seriesEvidence[check.collectionSeriesId].series;
  const trade = fixtures[edition.gcdIssueId].issue;
  assert.equal(collection.api_url, trade.series);
  assert.equal(collection.binding.toLowerCase(), edition.format);
  assert.deepEqual(collection.active_issues, [trade.api_url]);
  assert.equal(source.name.toLowerCase(), collection.name.toLowerCase());
  assert.equal(source.year_began, collection.year_began);
  assert.deepEqual(check.originalIssues.map(({ appNumber }) => appNumber), [1, 2, 3, 4]);
  assert.equal(new Set(check.originalIssues.map(({ gcdIssueId }) => gcdIssueId)).size, 4);
  for (const { appNumber, gcdIssueId, onSaleDate } of check.originalIssues) {
    const original = fixtures[gcdIssueId].issue;
    const matches = lists['war-of-the-realms'].items.filter((entry) =>
      entry.seriesId === 27505 && entry.number === String(appNumber));
    assert.equal(matches.length, 1);
    const issue = matches[0];
    assert.equal(issue.seriesName.toLowerCase(), `${source.name} (${source.year_began})`.toLowerCase());
    assert.equal(issue.onSale.slice(0, 10), onSaleDate);
    assert.equal(original.series, source.api_url);
    assert.equal(original.series_name, `${source.name} (${source.year_began} series)`);
    assert.equal(original.number, String(appNumber));
    assert.equal(original.variant_of, null);
    const stories = original.story_set.filter((story) => story.type === 'comic story');
    assert.equal(stories.length, 1);
    assert.ok(issue.creators.some(({ name, role }) => role === 'writer' && name === stories[0].script));
    assert.ok(issue.creators.some(({ name }) => name === stories[0].pencils));
  }
});

test('Robot Revolution uses the 2020 originals rather than the older Iron Man 2020 series', () => {
  const { gcdInputs, fixtures, lists } = loadInputs();
  const check = gcdInputs.editions['iron-man-2020-robot-revolution'];
  const series = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  assert.equal(series.name, 'Iron Man 2020');
  assert.equal(series.year_began, 2020);
  assert.equal(fixtures[2156466].issue.isbn, '978-1-302-92085-2');
  assert.equal(fixtures[2156466].issue.notes, 'Collects Iron Man 2020 (Marvel, 2020 series) #1-6.');
  assert.deepEqual(check.originalIssues.map(({ appNumber, gcdIssueId }) => [appNumber, gcdIssueId]), [
    [1, 2056366], [2, 2069751], [3, 2079928], [4, 2123239], [5, 2131004], [6, 2139854],
  ]);
  for (const { appNumber, gcdIssueId } of check.originalIssues) {
    const original = fixtures[gcdIssueId].issue;
    const items = lists['iron-man-2020'].items.filter((entry) =>
      entry.seriesId === 28356 && entry.number === String(appNumber));
    assert.equal(items.length, 1);
    assert.equal(items[0].seriesName, 'Iron Man 2020 (2020)');
    assert.match(items[0].onSale, /^2020-/);
    assert.equal(original.series, series.api_url);
    assert.equal(original.number, String(appNumber));
    assert.equal(original.variant_of, null);
    assert.match(original.key_date, /^2020-/);
  }
});

test('Edge of Spider-Verse trade stories match each original issue', () => {
  const { gcdInputs, fixtures } = loadInputs();
  const check = gcdInputs.editions['amazing-spider-man-edge-of-spider-verse'];
  const series = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  assert.equal(series.name, 'Edge of Spider-Verse');
  assert.equal(series.year_began, 2014);
  const trade = fixtures[1343400].issue;
  const clean = (value) => value.replaceAll('(credited)', '').replace(/\s*;\s*/g, '; ').replace(/\s+/g, ' ').trim();
  assert.equal(check.originalIssues.length, 5);
  for (const original of check.originalIssues) {
    const issue = fixtures[original.gcdIssueId].issue;
    const stories = issue.story_set.filter((story) => story.type === 'comic story');
    const story = trade.story_set.find((entry) => entry.sequence_number === original.collectionSequence);
    assert.equal(issue.series, series.api_url);
    assert.equal(issue.number, String(original.appNumber));
    assert.equal(stories.length, 1);
    assert.ok(story);
    for (const field of ['script', 'pencils', 'page_count']) {
      assert.equal(clean(story[field]), clean(stories[0][field]), `#${original.appNumber} ${field}`);
    }
    if (story.title) assert.equal(story.title, stories[0].title);
  }
});

test('Doctor Strange trade and original match the independently identified 2018 series', () => {
  const { gcdInputs, fixtures, lists } = loadInputs();
  const check = gcdInputs.editions['doctor-strange-waid-v1-across-the-universe'];
  const series = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  const trade = fixtures[1955785].issue;
  const original = fixtures[1822580].issue;
  const app = lists['infinity-countdown-wars'].items.find((entry) => entry.issueId === 68295);
  assert.equal(series.api_url, 'https://www.comics.org/api/series/125730/?format=json');
  assert.equal(series.name, 'Doctor Strange');
  assert.equal(series.year_began, 2018);
  assert.equal(series.publisher, 'https://www.comics.org/api/publisher/78/?format=json');
  assert.equal(series.country, 'us');
  assert.equal(series.language, 'en');
  assert.equal(trade.notes, 'Collects Doctor Strange (Marvel, 2018 Series) #1-5.');
  assert.equal(trade.isbn, '978-1-302-91233-8');
  assert.equal(trade.variant_of, null);
  assert.equal(check.gcdSeries, 'Doctor Strange (Marvel, 2018 Series)');
  assert.deepEqual(check.contents.map(({ seriesId, from, to }) => [seriesId, from, to]), [[24296, 1, 5]]);
  assert.equal(original.series, series.api_url);
  assert.equal(original.number, '3');
  assert.equal(original.variant_of, null);
  assert.equal(app.seriesId, 24296);
  assert.equal(app.seriesName, 'Doctor Strange (2018 - 2019)');
  assert.equal(app.title, 'Doctor Strange (2018) #3');
  assert.equal(app.number, original.number);
  assert.equal(app.onSale.slice(0, 10), '2018-07-04');
  assert.equal(original.publication_date, 'September 2018');
  const originals = original.story_set.filter((story) => story.type === 'comic story');
  const tradeStories = trade.story_set.filter((story) => story.type === 'comic story');
  assert.equal(originals.length, 1);
  assert.equal(tradeStories.length, 5);
  const matches = tradeStories.filter((story) => story.title === originals[0].title);
  assert.equal(matches.length, 1);
  const clean = (value) => value.replaceAll('(credited)', '').replace(/\s+/g, ' ').trim();
  for (const field of ['title', 'page_count', 'script', 'pencils']) {
    assert.equal(clean(matches[0][field]), clean(originals[0][field]), field);
  }
  assert.deepEqual(app.creators.filter((creator) => creator.role === 'writer').map((creator) => creator.name),
    [originals[0].script]);
  const relations = editionEvidence.relations.filter((entry) =>
    entry.editionId === 'doctor-strange-waid-v1-across-the-universe');
  assert.equal(relations.length, 1);
  assert.ok(relations.some((entry) => entry.catalogId === 'infinity-countdown-wars'
    && entry.issueId === app.issueId && entry.seriesId === app.seriesId && entry.number === app.number
    && entry.portion === 'full' && entry.status === 'verified' && entry.conflicts.length === 0));
});

test('Loki volume 2 contains six original stories from the identified 2014 series', () => {
  const { gcdInputs, fixtures, lists } = loadInputs();
  const check = gcdInputs.editions['loki-agent-of-asgard-v2-i-cannot-tell-a-lie'];
  const series = gcdInputs.seriesEvidence[check.sourceSeriesId].series;
  const trade = fixtures[1342239].issue;
  assert.equal(series.api_url, 'https://www.comics.org/api/series/78892/?format=json');
  assert.equal(series.name, 'Loki: Agent of Asgard');
  assert.equal(series.year_began, 2014);
  assert.equal(series.publisher, 'https://www.comics.org/api/publisher/78/?format=json');
  assert.equal(series.country, 'us');
  assert.equal(series.language, 'en');
  assert.equal(trade.isbn, '978-0-7851-9331-9');
  assert.equal(trade.variant_of, null);
  const stories = trade.story_set.filter((story) => story.type === 'comic story');
  assert.equal(stories.length, 6);
  assert.deepEqual(check.originalIssues.map((entry) =>
    [entry.appNumber, entry.gcdIssueId, entry.collectionSequence]), [
    [6, 1256193, 2], [7, 1263506, 4], [8, 1281111, 6],
    [9, 1297065, 8], [10, 1309470, 10], [11, 1319464, 12],
  ]);
  assert.deepEqual(check.contents.map(({ seriesId, from, to }) => [seriesId, from, to]), [[18340, 6, 11]]);
  const clean = (value) => value.replaceAll('(credited)', '').replace(/\s+/g, ' ').trim();
  for (const entry of check.originalIssues) {
    const original = fixtures[entry.gcdIssueId].issue;
    const originals = original.story_set.filter((story) => story.type === 'comic story');
    const story = stories.find((item) => item.sequence_number === entry.collectionSequence);
    assert.equal(original.series, series.api_url);
    assert.equal(original.number, String(entry.appNumber));
    assert.equal(original.variant_of, null);
    assert.equal(originals.length, 1);
    assert.ok(story);
    for (const field of ['title', 'page_count', 'script', 'pencils']) {
      assert.equal(clean(story[field]), clean(originals[0][field]), `#${entry.appNumber} ${field}`);
    }
  }
  const relations = editionEvidence.relations.filter((entry) => entry.editionId === 'loki-agent-of-asgard-v2-i-cannot-tell-a-lie');
  const expected = [48519, 50715, 51078, 51170];
  assert.deepEqual(relations.map((entry) => entry.issueId), expected);
  for (const relation of relations) {
    const app = lists.axis.items.find((entry) => entry.issueId === relation.issueId);
    assert.equal(app.seriesName, 'Loki: Agent of Asgard (2014 - 2015)');
    assert.equal(app.title, `Loki: Agent of Asgard (2014) #${relation.number}`);
    assert.equal(app.number, relation.number);
    assert.equal(app.seriesId, 18340);
    assert.equal(relation.seriesId, app.seriesId);
    assert.equal(relation.catalogId, 'axis');
    assert.equal(relation.status, 'verified');
    assert.equal(relation.portion, 'full');
    assert.deepEqual(relation.conflicts, []);
  }
});

test('the bundled projection preserves pilot relations and matches selected list issues', () => {
  assert.equal(editionEvidence.license, 'CC BY-SA 4.0');
  assert.match(editionEvidence.attribution, /Grand Comics Database/);
  assert.ok(editionEvidence.modification);
  const groups = {};
  for (const entry of editionEvidence.relations) (groups[entry.catalogId] ||= []).push(entry);
  assert.equal(groups['civil-war-avengers'].filter((entry) => entry.editionId !== 'mighty-avengers-v1-ultron').length, 13);
  assert.equal(groups['civil-war-avengers'].length, 19);
  assert.equal(groups['nebula-reading-order'].length, 10);
  const expected = {
    'civil-war-essential': ['civil-war-2007-tpb', 1067, 1, 7],
    'civil-war': ['civil-war-2007-tpb', 1067, 1, 7],
    'spider-verse': ['amazing-spider-man-edge-of-spider-verse', 19075, 1, 5],
    'war-of-the-realms': ['asgardians-v2-war-of-the-realms', 25996, 8, 10],
    'infinity-countdown-wars': ['asgardians-v1-the-infinity-armada', 25996, 1, 2],
    'x-men-divided-we-stand': ['young-xmen-v1-final-genesis', 4443, 1, 5],
    'world-war-hulk-aftersmash': ['world-war-hulk-warbound', 3171, 1, 5],
    'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide': ['world-war-hulk-warbound', 3171, 1, 5],
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
    'marvel-knights-to-planet-x-33': ['uncanny-xmen-v1-hope', 2258, 410, 415],
    'marvel-knights-to-planet-x-37': ['xtreme-xmen-v3-schism', 646, 19, 23],
    'marvel-knights-to-planet-x-41': ['exiles-v4-legacy', 479, 20, 25],
    'marvel-knights-to-planet-x-42': ['new-xmen-v4-riot-at-xaviers', 2281, 134, 138],
    'marvel-knights-to-planet-x-51': ['xtreme-xmen-v5-god-loves', 646, 25, 30],
    'marvel-knights-to-planet-x-59': ['exiles-v5-unnatural-instincts', 479, 26, 30],
    'marvel-knights-to-planet-x-64': ['spectacular-spider-man-v1-hunger', 556, 1, 5],
    'marvel-knights-to-planet-x-69': ['daredevil-v8-echo-vision-quest', 449, 51, 55],
    'marvel-knights-to-planet-x-77': ['xtreme-xmen-v7-storm-arena', 646, 36, 39],
  };
  const lists = loadInputs().lists;
  assert.deepEqual(Object.keys(groups).sort(), [
    'civil-war-avengers', 'nebula-reading-order', 'doomwar', 'x-men-regenesis', 'secret-invasion',
    'siege-dark-reign-prelude', 'chaos-war', 'axis', 'iron-man-2020', ...Object.keys(expected),
  ].sort());
  for (const [listId, [book, series, first, last]] of Object.entries(expected)) {
    const items = lists[listId].items.filter((entry) => entry.seriesId === series
      && Number(entry.number) >= first && Number(entry.number) <= last);
    assert.equal(items.length, last - first + 1, listId);
    const additionalBooks = [
      'doctor-strange-waid-v1-across-the-universe', 'war-of-the-realms-journey-into-mystery',
      'war-of-the-realms-new-agents-of-atlas',
    ];
    const rows = groups[listId].filter((entry) => !additionalBooks.includes(entry.editionId));
    assert.deepEqual(rows.map((entry) => [entry.editionId, entry.issueId, entry.seriesId, entry.number]),
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
    'amazing-spider-man-edge-of-spider-verse': [
      ['hoopla', 'https://www.hoopladigital.com/title/12205516'],
    ],
    'doctor-strange-waid-v1-across-the-universe': [
      ['hoopla', 'https://www.hoopladigital.com/title/13897690'],
    ],
    'loki-agent-of-asgard-v2-i-cannot-tell-a-lie': [
      ['hoopla', 'https://www.hoopladigital.com/title/12687655'],
      ['libby', 'https://share.libbyapp.com/title/5863852'],
    ],
    'new-xmen-v4-riot-at-xaviers': [
      ['hoopla', 'https://www.hoopladigital.com/title/12650794'],
      ['libby', 'https://share.libbyapp.com/title/5408076'],
    ],
    'daredevil-v8-echo-vision-quest': [
      ['hoopla', 'https://www.hoopladigital.com/title/14762070'],
      ['libby', 'https://share.libbyapp.com/title/8364770'],
    ],
    'doomwar-2011-tpb': [
      ['hoopla', 'https://www.hoopladigital.com/title/15293370'],
      ['libby', 'https://share.libbyapp.com/title/9203113'],
    ],
    'avengers-academy-second-semester': [['libby', 'https://share.libbyapp.com/title/13637356']],
    'secret-invasion-front-line': [
      ['hoopla', 'https://www.hoopladigital.com/title/15183611'],
      ['libby', 'https://share.libbyapp.com/title/9227009'],
    ],
    'mighty-avengers-v1-ultron': [
      ['hoopla', 'https://www.hoopladigital.com/title/15183607'],
      ['libby', 'https://share.libbyapp.com/title/9192151'],
    ],
    'siege-mighty-avengers': [['libby', 'https://share.libbyapp.com/title/9465007']],
    'chaos-war-2011-tpb': [
      ['hoopla', 'https://www.hoopladigital.com/title/14794072'],
      ['libby', 'https://share.libbyapp.com/title/8771019'],
    ],
    'world-war-hulk-warbound': [['hoopla', 'https://www.hoopladigital.com/title/15006597']],
    'war-of-the-realms-journey-into-mystery': [
      ['hoopla', 'https://www.hoopladigital.com/title/12917438'],
      ['libby', 'https://share.libbyapp.com/title/8114272'],
    ],
    'war-of-the-realms-new-agents-of-atlas': [
      ['hoopla', 'https://www.hoopladigital.com/title/12917437'],
      ['libby', 'https://share.libbyapp.com/title/5678469'],
    ],
    'secret-invasion-fantastic-four': [
      ['hoopla', 'https://www.hoopladigital.com/title/14279808'],
      ['libby', 'https://share.libbyapp.com/title/7785428'],
    ],
    'secret-invasion-x-men': [
      ['hoopla', 'https://www.hoopladigital.com/title/15183606'],
      ['libby', 'https://share.libbyapp.com/title/9227013'],
    ],
  });
  assert.equal(Object.keys(editionCatalog.editions).length, 39);
  for (const [id, entries] of Object.entries(destinations)) {
    const completeReturn = ['war-of-the-realms-journey-into-mystery',
      'war-of-the-realms-new-agents-of-atlas', 'world-war-hulk-warbound'].includes(id);
    const currentReturn = [
      'amazing-spider-man-edge-of-spider-verse',
      'doctor-strange-waid-v1-across-the-universe',
      'loki-agent-of-asgard-v2-i-cannot-tell-a-lie',
    ].includes(id);
    const previousReturn = [
      'xtreme-xmen-v1-destiny', 'civil-war-2007-tpb', 'asgardians-v1-the-infinity-armada',
      'asgardians-v2-war-of-the-realms', 'new-xmen-v2-imperial', 'new-xmen-v4-riot-at-xaviers',
      'daredevil-v8-echo-vision-quest',
    ].includes(id);
    const sourceHash = completeReturn
      ? '9b2ba6f30f7d612941c39cd65dde5807899913df0d48049bfd69a5e1d38802c7'
      : currentReturn
        ? '3848cdd6136d166a0753dbfa1eee8141b15f890cf2bdb50d954f7f26b78355da'
        : previousReturn
          ? '0b85d0cc1942a6600d3ba08731759475294f2977576889a439f78f212990b17d'
          : '94a88e797a37042c857ec66c04b75ec471ce9b8ef706634529ecfba665cc6275';
    for (const entry of entries) {
      assert.equal(entry.checkedAt, completeReturn || currentReturn ? '2026-11-14' : '2026-11-13');
      assert.equal(entry.confirmedBy, 'owner');
      assert.ok(entry.source.includes(sourceHash), id);
    }
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
