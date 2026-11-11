import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  editionCatalog, editionEvidence, editionRelations, editionCoverage, providerLinks,
} from '../src/js/lib/collectedEditions.js';
import { collectedEditionCredit, collectedEditionLabels } from '../src/js/views/shared/collected-editions.js';
import { build, buildAppData, databaseLeaks, loadInputs } from '../scripts/collected-editions.mjs';
import { serializeChecklist } from '../src/js/lib/markdown.js';

const clone = (value) => structuredClone(value);
const el = (tag, props, children = []) => ({ tag, ...props, children: [].concat(children).filter(Boolean) });
const item = { issueId: 7, seriesId: 8, number: '1', collectedIn: 'My heading' };
const catalog = {
  editions: { book: { title: '<Curated book>', destinations: [] } },
  providers: { hoopla: { name: 'Hoopla', permission: 'pending' } },
};
const relation = {
  catalogId: 'list', editionId: 'book', ...item, status: 'verified', portion: 'full', conflicts: [],
  source: 'https://www.comics.org/issue/1/', checkedAt: '2026-11-10',
};
const evidence = { relations: [relation] };
const destination = {
  provider: 'hoopla', url: 'https://www.hoopladigital.com/title/123456789',
  status: 'verified', checkedAt: '2026-11-10',
};
const granted = () => ({
  ...clone(catalog),
  providers: { hoopla: { name: 'Hoopla', permission: 'granted', permissionEvidence: 'Written permission fixture' } },
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

test('provider permission and target verification are independent fail-closed gates', () => {
  const book = { title: 'Fixture', destinations: [destination] };
  for (const permission of ['pending', 'denied', undefined]) {
    const policy = granted();
    policy.providers.hoopla.permission = permission;
    assert.deepEqual(providerLinks(book, policy), []);
  }
  const absent = granted();
  delete absent.providers.hoopla.permissionEvidence;
  assert.deepEqual(providerLinks(book, absent), []);
  assert.deepEqual(providerLinks(book, granted()), [{ name: 'Hoopla', url: destination.url }]);
  for (const change of [{ status: 'unknown' }, { checkedAt: '' }, { provider: 'unknown' }]) {
    assert.deepEqual(providerLinks({ destinations: [{ ...destination, ...change }] }, granted()), []);
  }
  for (const url of [
    'http://www.hoopladigital.com/title/123', 'https://www.hoopladigital.com.evil.test/title/123',
    'https://user@www.hoopladigital.com/title/123', 'https://www.hoopladigital.com:444/title/123',
    'https://www.hoopladigital.com/title/123?card=private', 'https://www.hoopladigital.com/title/123#x',
    'https://www.hoopladigital.com/search?q=book', 'javascript:alert(1)', 'not a URL',
  ]) assert.deepEqual(providerLinks({ destinations: [{ ...destination, url }] }, granted()), [], url);
});

test('row renderer uses text and only granted links add row tab stops', () => {
  const pending = collectedEditionLabels(el, 'list', item, catalog, evidence);
  assert.equal(pending.children[0].children[0].text, 'Collected in <Curated book>');
  assert.equal(pending.children[0].children.length, 1);
  assert.equal(collectedEditionLabels(el, 'custom', item, catalog, evidence), null);
  const policy = granted();
  policy.editions.book.destinations = [destination];
  const rendered = collectedEditionLabels(el, 'list', item, policy, evidence);
  const link = rendered.children[0].children[1];
  assert.equal(link.tag, 'a');
  assert.equal(link.href, destination.url);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.equal(link.text, 'View this book at Hoopla');
  assert.match(link['aria-label'], /<Curated book>.*opens outside/);
  const credit = collectedEditionCredit(el);
  assert.equal(credit.children.filter((child) => child.tag === 'a').length, 2);
  assert.match(credit.children.join(' '), /adapted/);
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
  assert.deepEqual(editionCatalog.providers, { hoopla: { name: 'Hoopla', permission: 'pending' } });
  assert.ok(Object.values(editionCatalog.editions).every((book) => book.destinations.length === 0));
  for (const file of ['collectedEditionCatalog.js', 'collectedEditionEvidence.js']) {
    const text = readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /hoopladigital|contentId|"cover"|amazon|amzn/i);
  }
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
