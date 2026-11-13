import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  editionCatalog, editionEvidence, editionRelations, editionCoverage, providerLinks,
} from '../src/js/lib/collectedEditions.js';
import { collectedEditionCredit, collectedEditionLabels } from '../src/js/views/shared/collected-editions.js';
import { build, buildAppData, databaseLeaks, loadInputs, validateDestinations } from '../scripts/collected-editions.mjs';
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

test('the bundled projection has exactly 23 verified relations, licensed separately, and no provider metadata', () => {
  assert.equal(editionEvidence.license, 'CC BY-SA 4.0');
  assert.match(editionEvidence.attribution, /Grand Comics Database/);
  assert.ok(editionEvidence.modification);
  assert.equal(editionEvidence.relations.length, 23);
  const groups = {};
  for (const entry of editionEvidence.relations) (groups[entry.catalogId] ||= []).push(entry);
  assert.equal(groups['civil-war-avengers'].length, 13);
  assert.equal(groups['nebula-reading-order'].length, 10);
  assert.equal(Object.keys(groups).length, 2);
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
