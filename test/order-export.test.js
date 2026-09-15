import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist, readerIssueId, serializeChecklist, serializeReadingOrder } from '../src/js/lib/markdown.js';

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

const fixture = freeze({
  name: 'Synthetic reading order',
  description: 'PRIVATE DESCRIPTION',
  note: 'PRIVATE LIST NOTE',
  created: 1777777777777,
  deferredIssueIds: [99],
  items: [
    { issueId: 42, title: 'First ] issue', collectedIn: 'Volume one', read: true, note: 'PRIVATE ISSUE NOTE', override: 'available', readAt: 1777777777777 },
    { issueId: -12345, title: 'Unresolved manual position', collectedIn: 'Volume one', read: true },
    { issueId: readerIssueId(129648), digitalId: 129648, title: 'Future issue', collectedIn: 'Volume two', read: true },
    { issueId: 99, title: 'Last issue', url: 'https://www.marvel.com/comics/issue/99/last', collectedIn: 'Volume two', read: false, deferred: true },
  ],
  source: {
    sourceOrigin: 'Synthetic curator',
    source: 'https://example.test/order?edition=one#exact',
    sourceLicense: 'Synthetic permission',
    sourceSection: 'A specific source section',
    updatedAt: 'PRIVATE SNAPSHOT DATE',
    description: 'PRIVATE SOURCE DESCRIPTION',
  },
});

test('order-only allowlist excludes all personal state without mutating its input', () => {
  const before = JSON.stringify(fixture);
  const md = serializeReadingOrder(fixture);
  assert.doesNotMatch(md, /PRIVATE|1777777777777|available|override|readAt|deferred|\[x\]/i);
  assert.equal((md.match(/^- \[ \]/gm) ?? []).length, 4);
  assert.equal(JSON.stringify(fixture), before);
});

test('order-only keeps exact interleaved positions, identities, titles and sections', () => {
  const { entries, unresolved } = parseChecklist(serializeReadingOrder(fixture));
  const rows = [...entries, ...unresolved].sort((a, b) => a.index - b.index);
  assert.deepEqual(rows.map((row) => [row.issueId ?? null, row.title, row.section, row.read]), [
    [42, 'First ] issue', 'Volume one', false],
    [null, 'Unresolved manual position', 'Volume one', false],
    [readerIssueId(129648), 'Future issue', 'Volume two', false],
    [99, 'Last issue', 'Volume two', false],
  ]);
  assert.equal(entries[1].digitalId, 129648);
  assert.equal(entries[2].url, fixture.items[3].url);
});

test('order-only preserves exact source links and available credits without invented attribution', () => {
  const md = serializeReadingOrder(fixture);
  assert.match(md, /^Source: Synthetic curator$/m);
  assert.ok(md.includes('Source link: <https://example.test/order?edition=one#exact>'));
  assert.match(md, /^Source license: Synthetic permission$/m);
  assert.match(md, /^Source section: A specific source section$/m);
  const unknown = serializeReadingOrder({ name: 'Unknown', items: [] });
  assert.match(unknown, /Source attribution is unavailable/);
  assert.doesNotMatch(unknown, /app-authored|Compiled for|Recap Page/);
});

test('order-only preserves manual reader books but excludes URL page and credential state', () => {
  const md = serializeReadingOrder({
    name: 'Manual',
    items: [
      { issueId: -1234, digitalId: 129648, title: 'Manual book', url: null, read: true },
      { issueId: -2345, title: 'Pasted book', url: 'https://read.marvel.com/#/book/1067/page/8' },
      { issueId: 42, digitalId: 123, title: 'Provider issue', url: 'https://user:secret@www.marvel.com/comics/issue/42/slug?private=yes#page' },
      { issueId: -3456, title: 'Not resolved', url: 'https://example.test/private' },
      { issueId: 99, digitalId: 123, title: 'Known provider identity', url: 'https://read.marvel.com/#/book/123/page/8' },
    ],
  });
  assert.match(md, /https:\/\/read\.marvel\.com\/#\/book\/129648/);
  assert.match(md, /https:\/\/read\.marvel\.com\/#\/book\/1067/);
  assert.match(md, /https:\/\/www\.marvel\.com\/comics\/issue\/42\/slug/);
  assert.doesNotMatch(md, /page\/8|user|secret|private|comics\/issue\/-/);
  const parsed = parseChecklist(md);
  assert.deepEqual(parsed.entries.map((entry) => entry.issueId), [readerIssueId(129648), readerIssueId(1067), 42, 99]);
  assert.equal(parsed.unresolved[0].title, 'Not resolved');
});

test('order-only resets sections when a named run is followed by an unlabelled position', () => {
  const md = serializeReadingOrder({
    name: 'Sections',
    items: [
      { issueId: 1, title: 'One', collectedIn: 'Volume' },
      { issueId: -2, title: 'Unlabelled' },
      { issueId: 3, title: 'Three', collectedIn: 'Volume' },
    ],
  });
  const parsed = parseChecklist(md);
  const rows = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  assert.deepEqual(rows.map((row) => row.section), ['Volume', null, 'Volume']);
});

test('order-only handles an empty list and keeps multiline labels from introducing read rows', () => {
  const md = serializeReadingOrder({ name: 'Empty', note: 'PRIVATE', items: [] });
  assert.equal(md, '# Empty\n\nSource attribution is unavailable.\n\n');
  assert.deepEqual(parseChecklist(md).entries, []);
  assert.deepEqual(parseChecklist(md).unresolved, []);
  const lines = serializeReadingOrder({
    name: 'Name\n- [x] injected',
    items: [{ issueId: 1, title: 'Title\n- [x] injected', collectedIn: 'Section\n- [x] injected' }],
  });
  assert.equal(parseChecklist(lines).entries.length, 1);
  assert.equal(parseChecklist(lines).entries[0].read, false);
  assert.doesNotMatch(lines, /^- \[x\]/m);
});

test('personal Markdown still exports descriptions, notes and checked progress unchanged', () => {
  const input = {
    name: 'Personal', description: 'My description', note: 'My list note',
    items: [{ issueId: 1, title: 'One', read: true, note: 'My issue note' }],
  };
  const expected = '# Personal\n\nMy description\n\n> My list note\n\n- [x] [One](https://www.marvel.com/comics/issue/1/)\n> My issue note\n';
  assert.equal(serializeChecklist(input), expected);
  serializeReadingOrder(input);
  assert.equal(serializeChecklist(input), expected);
});
