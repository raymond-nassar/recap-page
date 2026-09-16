import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeChecklist, readerIssueId } from '../src/js/lib/markdown.js';

const plain = {
  includeProgress: true,
  includeLinks: false,
  includeDescription: false,
  includeSections: false,
  includeNotes: false,
  literal: true,
};
const list = {
  name: 'Spider-Man reading list',
  description: 'An optional description.',
  note: 'My private list note.',
  deferredIssueIds: [2],
  items: [
    {
      issueId: 1, title: 'Amazing Spider-Man (2018) #1', read: true,
      note: 'My private issue note.', collectedIn: 'First collection', override: 'available',
    },
    { issueId: 2, title: 'Amazing Spider-Man (2018) #2', read: false, deferred: true },
    { issueId: -3, title: 'Amazing Spider-Man (2018) #3', read: false },
  ],
};

test('readable default is the approved plain checklist with no private extras', () => {
  assert.equal(serializeChecklist(list, plain), [
    '# Spider-Man reading list', '',
    '- [x] Amazing Spider-Man (2018) #1',
    '- [ ] Amazing Spider-Man (2018) #2',
    '- [ ] Amazing Spider-Man (2018) #3', '',
  ].join('\n'));
});

test('readable export can omit progress without omitting or reordering comics', () => {
  assert.equal(serializeChecklist(list, { ...plain, includeProgress: false }), [
    '# Spider-Man reading list', '',
    '- Amazing Spider-Man (2018) #1',
    '- Amazing Spider-Man (2018) #2',
    '- Amazing Spider-Man (2018) #3', '',
  ].join('\n'));
});

test('description, sections and personal notes are independently opt-in', () => {
  const description = serializeChecklist(list, { ...plain, includeDescription: true });
  assert.match(description, /> An optional description\./);
  assert.doesNotMatch(description, /private|First collection|https:/);
  const sections = serializeChecklist(list, { ...plain, includeSections: true });
  assert.match(sections, /## First collection/);
  assert.doesNotMatch(sections, /private|optional description/);
  const notes = serializeChecklist(list, { ...plain, includeNotes: true });
  assert.match(notes, /> My private list note\./);
  assert.match(notes, /> My private issue note\./);
  assert.doesNotMatch(notes, /First collection|optional description|https:/);
});

test('optional links retain the canonical reader address and known provider identity', () => {
  const data = {
    name: 'Links',
    items: [
      { title: 'Reader comic', issueId: readerIssueId(129648), digitalId: 129648, read: true },
      { title: 'Provider comic', issueId: 6482, read: false },
      { title: 'Manual book', issueId: -1234, digitalId: 1067, read: true },
      { title: 'Pasted book', issueId: -2345, url: 'http://read.marvel.com/#/book/129648/page/8', read: false },
      { title: 'Unknown comic', issueId: -1, read: false },
    ],
  };
  const result = serializeChecklist(data, { ...plain, includeLinks: true });
  assert.match(result, /\[Reader comic\]\(https:\/\/read\.marvel\.com\/#\/book\/129648\)/);
  assert.match(result, /\[Provider comic\]\(https:\/\/www\.marvel\.com\/comics\/issue\/6482\/\)/);
  assert.match(result, /- \[x\] \[Manual book\]\(https:\/\/read\.marvel\.com\/#\/book\/1067\)/);
  assert.match(result, /\[Pasted book\]\(https:\/\/read\.marvel\.com\/#\/book\/129648\)/);
  assert.doesNotMatch(result, /page\/8/);
  assert.match(result, /- \[ \] Unknown comic\n$/);
  assert.doesNotMatch(serializeChecklist(data, plain), /https:|129648|6482/);
});

test('readable user text cannot inject headings, checklist rows, HTML or Markdown links', () => {
  const result = serializeChecklist({
    name: 'Title\n- [ ] Extra',
    description: '# Not a heading\n<img src="https://example.com/a">',
    note: '[private link](https://example.com)',
    items: [{
      title: '**Comic**\\variant\n- [x] Injected <script> <SCRIPT> & [link](https://example.com)',
      read: false, note: '# Also not a heading\n- [ ] Not a comic',
      collectedIn: 'Group\n## Injected',
    }],
  }, { ...plain, includeNotes: true, includeDescription: true, includeSections: true });
  assert.equal(result.split('\n').filter((line) => /^- /.test(line)).length, 1);
  assert.equal(result.split('\n').filter((line) => /^# /.test(line)).length, 1);
  assert.equal(result.split('\n').filter((line) => /^## /.test(line)).length, 1);
  assert.doesNotMatch(result, /<(?:script|img)\b|\*\*Comic\*\*|(?<!\\)\[private link\]\(/i);
  assert.match(result, /&lt;script&gt;/);
  assert.match(result, /&lt;SCRIPT&gt;/);
  assert.match(result, /\\\\variant/);
  assert.match(result, /> # Also not a heading/);
});

test('readable links exclude nonofficial URLs and private URL state and escape destinations', () => {
  const data = {
    items: [
      { issueId: -1, title: 'Unsafe', url: 'javascript:alert(1)' },
      { issueId: -2, title: 'External', url: 'https://example.com/comic' },
      { issueId: -3, title: 'Credentials', url: 'https://name:secret@www.marvel.com/comics/issue/1/' },
      { issueId: -4, title: 'Known [variant]', url: 'https://www.marvel.com/comics/issue/1/a_(b)' },
    ],
  };
  const result = serializeChecklist(data, { ...plain, includeLinks: true });
  assert.doesNotMatch(result, /javascript:|example\.com|secret|name:/);
  assert.match(result, /a_%28b%29/);
  assert.match(result, /Known \\\[variant\\\]/);
});

test('readable export preserves saved identity text without inferring missing metadata', () => {
  const items = [
    { title: 'Avengers (2012) #1.AU', number: '1.AU', onSale: '2026-01-01' },
    { title: 'Unknown annual', issueId: -4 },
    { title: 'Avengers (2012) #1.1 Variant B' },
  ];
  assert.equal(serializeChecklist({ items }, plain),
    '- [ ] Avengers (2012) #1.AU\n- [ ] Unknown annual\n- [ ] Avengers (2012) #1.1 Variant B\n');
});

test('readable notes normalize carriage returns before quoting every prose line', () => {
  const result = serializeChecklist({
    description: 'Description\r- not another comic',
    note: 'List note\r\n# still a note',
    items: [{ title: 'Comic #1', note: 'Issue note\r- also a note' }],
  }, { ...plain, includeDescription: true, includeNotes: true });
  assert.doesNotMatch(result, /\r/);
  assert.match(result, /> Description\n> - not another comic/);
  assert.match(result, /> List note\n> # still a note/);
  assert.match(result, /> Issue note\n> - also a note/);
  assert.equal(result.split('\n').filter((line) => line.startsWith('- ')).length, 1);
});

test('export does not mutate input and readable choices never change legacy defaults', () => {
  const original = structuredClone(list);
  const legacy = serializeChecklist(list);
  serializeChecklist(list, { ...plain, includeNotes: true });
  assert.equal(serializeChecklist(list), legacy);
  assert.match(legacy, /https:\/\/www\.marvel\.com\/comics\/issue\/1\//);
  assert.match(legacy, /> My private issue note/);
  assert.deepEqual(list, original);
});
