import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChecklist, parseTitleList, serializeChecklist, issueIdFromUrl,
  digitalIdFromUrl, isSafeMarvelUrl, normalizeTitle, resolveUniqueExact, stripInlineMarkdown,
} from '../src/js/lib/markdown.js';

test('parses the upstream checklist format', () => {
  const { entries } = parseChecklist(
    '- [ ] [Secret Warriors (2009) #1](https://www.marvel.com/comics/issue/23648/secret_warriors_2009_1)',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issueId, 23648);
  assert.equal(entries[0].title, 'Secret Warriors (2009) #1');
  assert.equal(entries[0].read, false);
});

test('- [x] imports as already read, in either case', () => {
  const { entries } = parseChecklist([
    '- [x] [A](https://www.marvel.com/comics/issue/1/a)',
    '- [X] [B](https://www.marvel.com/comics/issue/2/b)',
    '- [ ] [C](https://www.marvel.com/comics/issue/3/c)',
  ].join('\n'));
  assert.deepEqual(entries.map((e) => e.read), [true, true, false]);
});

test('collects headings and uses them as list-name candidates', () => {
  const { headings } = parseChecklist('# Hickman to Secret Wars\n\n## Phase one\n- [ ] x');
  assert.deepEqual(headings, ['Hickman to Secret Wars', 'Phase one']);
});

test('lines without a Marvel issue link are surfaced, never dropped', () => {
  const { entries, unresolved } = parseChecklist([
    '- [ ] [Good](https://www.marvel.com/comics/issue/5/good)',
    '- [ ] Some Comic Nobody Linked',
    '- [x] [Offsite](https://example.com/whatever)',
  ].join('\n'));

  assert.equal(entries.length, 1);
  assert.equal(unresolved.length, 2);
  assert.equal(unresolved[0].title, 'Some Comic Nobody Linked');
  assert.equal(unresolved[1].read, true, 'read state must survive so it is not silently lost');
  assert.equal(unresolved[1].url, null, 'a non-Marvel URL must not be carried through');
});

test('every item records its position so reading order survives the resolved/unresolved split', () => {
  const { entries, unresolved } = parseChecklist([
    '# Heading is not an item',
    '- [ ] [First](https://www.marvel.com/comics/issue/1/first)',
    '- [ ] Not Linked Yet',
    '',
    'Some prose that is not an item.',
    '- [x] [Third](https://www.marvel.com/comics/issue/2/third)',
    '- [ ] Also Not Linked',
  ].join('\n'));

  assert.deepEqual(entries.map((e) => e.index), [0, 2]);
  assert.deepEqual(unresolved.map((u) => u.index), [1, 3]);

  // Merging on index has to reproduce the file, or a vendored order would read out of sequence.
  const merged = [...entries, ...unresolved].sort((a, b) => a.index - b.index).map((i) => i.title);
  assert.deepEqual(merged, ['First', 'Not Linked Yet', 'Third', 'Also Not Linked']);
});

test('accepts bullets, asterisks, indentation and non-breaking spaces', () => {
  const { entries } = parseChecklist([
    '  - [ ] [A](https://www.marvel.com/comics/issue/1/a)',
    '* [ ] [B](https://www.marvel.com/comics/issue/2/b)',
    '-\u00a0[ ] [C](https://www.marvel.com/comics/issue/3/c)',
    '- [D](https://www.marvel.com/comics/issue/4/d)',
  ].join('\n'));
  assert.deepEqual(entries.map((e) => e.issueId), [1, 2, 3, 4]);
});

test('ignores prose and blank lines', () => {
  const { entries, unresolved } = parseChecklist('Just a sentence.\n\n\nAnother one.');
  assert.equal(entries.length, 0);
  assert.equal(unresolved.length, 0);
});

test('quoted source positions retain their group and expanded item spans', () => {
  const parsed = parseChecklist([
    '## First group',
    '> First source row',
    '- [ ] [One](https://www.marvel.com/comics/issue/1/one)',
    '- [ ] Missing but counted',
    '> Second source row',
    '- [ ] [Two](https://www.marvel.com/comics/issue/2/two)',
  ].join('\n'));

  assert.deepEqual(parsed.sourcePositions, [
    {
      ordinal: 1, label: 'First source row', section: 'First group', start: 0, count: 2,
    },
    {
      ordinal: 2, label: 'Second source row', section: 'First group', start: 2, count: 1,
    },
  ]);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.unresolved.length, 1);
});

test('ordinary checklists keep an empty additive source-position result', () => {
  assert.deepEqual(
    parseChecklist('- [ ] [One](https://www.marvel.com/comics/issue/1/one)').sourcePositions,
    [],
  );
});

test('issueIdFromUrl accepts real shapes and rejects lookalikes', () => {
  assert.equal(issueIdFromUrl('https://www.marvel.com/comics/issue/52447/slug'), 52447);
  assert.equal(issueIdFromUrl('http://marvel.com/comics/issue/1/'), 1);
  assert.equal(issueIdFromUrl('https://www.marvel.com/comics/issue/99'), 99);
  assert.equal(issueIdFromUrl('https://evil.com/comics/issue/1/x'), null);
  assert.equal(issueIdFromUrl('https://www.marvel.com.evil.com/comics/issue/1/x'), null);
  assert.equal(issueIdFromUrl('not a url'), null);
  assert.equal(issueIdFromUrl(null), null);
});

test('digitalIdFromUrl reads the book id off a Marvel Unlimited reader address', () => {
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/129648'), 129648);
  assert.equal(digitalIdFromUrl('  https://read.marvel.com/#/book/1067  '), 1067);
  // The reader appends its own page state to the hash while you read, so the address a
  // subscriber copies is rarely the bare one.
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/71158/page/4'), 71158);
});

test('digitalIdFromUrl refuses anything that would build a dead reader link', () => {
  // A lookalike host is the one that matters: it would otherwise hand an attacker-chosen
  // number straight to the launcher.
  assert.equal(digitalIdFromUrl('https://read.marvel.com.evil.com/#/book/5'), null);
  assert.equal(digitalIdFromUrl('https://evil.com/#/book/5'), null);
  // A marvel.com issue address is a valid thing to paste and carries an issue id, not a book id.
  // Reading one as the other would open somebody else's comic.
  assert.equal(digitalIdFromUrl('https://www.marvel.com/comics/issue/6482/x'), null);
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/0'), null);
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/series/1234'), null);
  assert.equal(digitalIdFromUrl('https://read.marvel.com/'), null);
  assert.equal(digitalIdFromUrl('not a url'), null);
  assert.equal(digitalIdFromUrl(null), null);
});

test('digitalIdFromUrl refuses every scheme its sibling refuses', () => {
  // The sibling check in this module and the private copy in the reader module both refuse
  // anything outside http and https. This function did not, so the same address answered two
  // ways depending on which of the three you happened to ask.
  assert.equal(digitalIdFromUrl('ftp://read.marvel.com/#/book/5'), null);
  assert.equal(digitalIdFromUrl('file://read.marvel.com/#/book/5'), null);
  assert.equal(digitalIdFromUrl('javascript://read.marvel.com/#/book/5'), null);
  assert.equal(digitalIdFromUrl('foo://read.marvel.com/#/book/5'), null);
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/5'), 5, 'and still answers the two it allows');
  assert.equal(digitalIdFromUrl('http://read.marvel.com/#/book/5'), 5);
});

test('digitalIdFromUrl stops at the twelve digits the launcher will accept', () => {
  // The launcher refuses more than twelve digits before it will build a reader address, so an id
  // longer than that would store here and be rejected at the point of use, which is the dead Read
  // button this function's own comment says it prevents.
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/123456789012'), 123456789012,
    'twelve is the last one the launcher will take');
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/1234567890123'), null);
  assert.equal(digitalIdFromUrl('https://read.marvel.com/#/book/1234567890123456'), null);
});

test('isSafeMarvelUrl rejects other hosts and dangerous schemes', () => {
  assert.ok(isSafeMarvelUrl('https://www.marvel.com/comics/issue/1/x'));
  assert.ok(isSafeMarvelUrl('https://read.marvel.com/#/book/123'));
  assert.equal(isSafeMarvelUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMarvelUrl('data:text/html,<script>'), false);
  assert.equal(isSafeMarvelUrl('https://marvel.com.attacker.net/'), false);
  assert.equal(isSafeMarvelUrl('https://notmarvel.com/'), false);
});

test('serialize then parse is lossless for id, title and read state', () => {
  const items = [
    { issueId: 1, title: 'One', url: 'https://www.marvel.com/comics/issue/1/one', read: true },
    { issueId: 2, title: 'Two', url: 'https://www.marvel.com/comics/issue/2/two', read: false },
  ];
  const { entries } = parseChecklist(serializeChecklist({ name: 'L', description: 'D', items }));
  assert.deepEqual(
    entries.map((e) => ({ issueId: e.issueId, title: e.title, read: e.read })),
    items.map((i) => ({ issueId: i.issueId, title: i.title, read: i.read })),
  );
});

test('serializer escapes brackets so titles cannot break the link syntax', () => {
  const md = serializeChecklist({
    name: 'x',
    items: [{ issueId: 1, title: 'Weird ] Title', url: 'https://www.marvel.com/comics/issue/1/x', read: false }],
  });
  const { entries } = parseChecklist(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issueId, 1);
});

// Regression: escaping "]" without first escaping "\" silently ate backslashes, so a title
// round-tripped through export/restore came back altered. Export is the only backup mechanism,
// so a lossy round trip is data loss.
test('titles survive a round trip whatever brackets and backslashes they contain', () => {
  const B = String.fromCharCode(92);
  const titles = [
    'Weird ] Title',
    `Back${B}slash`,
    `Both ${B}] here`,
    `Trailing${B}`,
    `${B}${B} double`,
    '[Bracketed]',
    'Plain',
  ];
  const md = serializeChecklist({
    name: 'x',
    items: titles.map((t, i) => ({ issueId: i + 1, title: t, read: i % 2 === 0 })),
  });
  const { entries, unresolved } = parseChecklist(md);

  assert.equal(unresolved.length, 0, 'nothing may degrade to unresolved');
  assert.deepEqual(entries.map((e) => e.title), titles);
  assert.deepEqual(entries.map((e) => e.issueId), titles.map((_, i) => i + 1));
  assert.deepEqual(entries.map((e) => e.read), titles.map((_, i) => i % 2 === 0));
});

// The link-text pattern uses a nested quantifier, so it is worth proving it stays linear.
test('a pathological line does not hang the parser', () => {
  const B = String.fromCharCode(92);
  for (const input of [
    `- [ ] [${B.repeat(20000)}`,
    `- [ ] [${`a${B}`.repeat(10000)}`,
    `- [ ] [${'a'.repeat(100000)}`,
  ]) {
    const started = Date.now();
    parseChecklist(input);
    assert.ok(Date.now() - started < 1000, 'parsing must not blow up on unterminated link text');
  }
});

test('serializer emits a usable URL when only an id is known', () => {
  const md = serializeChecklist({ name: 'x', items: [{ issueId: 42, title: 'Forty Two', read: false }] });
  assert.match(md, /https:\/\/www\.marvel\.com\/comics\/issue\/42\//);
});

test('parseTitleList strips bullets and checkboxes', () => {
  const out = parseTitleList('- [x] Read One\n* Two\nThree\n\n');
  assert.deepEqual(out, [
    { title: 'Read One', read: true },
    { title: 'Two', read: false },
    { title: 'Three', read: false },
  ]);
});

test('stripInlineMarkdown keeps link text and drops emphasis', () => {
  assert.equal(stripInlineMarkdown('**Bold** and [linked](http://x)'), 'Bold and linked');
});

test('normalizeTitle folds punctuation, case and ampersands', () => {
  assert.equal(normalizeTitle('The Avengers (2012) #1'), normalizeTitle('the  avengers 2012 1'));
  assert.equal(normalizeTitle('Cloak & Dagger'), normalizeTitle('Cloak and Dagger'));
  assert.equal(normalizeTitle('Spider\u2019s Web'), normalizeTitle("Spider's Web"));
});

test('resolveUniqueExact auto-accepts only a single exact match', () => {
  const one = resolveUniqueExact('Avengers (2012) #1', [
    { title: 'Avengers (2012) #1', issueId: 1 },
    { title: 'Avengers (2012) #10', issueId: 2 },
  ]);
  assert.equal(one.status, 'resolved');
  assert.equal(one.match.issueId, 1);

  const many = resolveUniqueExact('Avengers (2012) #1', [
    { title: 'Avengers (2012) #1', issueId: 1 },
    { title: 'Avengers (2012) #1', issueId: 9 },
  ]);
  assert.equal(many.status, 'ambiguous', 'duplicates must never auto-resolve');

  assert.equal(resolveUniqueExact('Nope', [{ title: 'Other' }]).status, 'unmatched');
  assert.equal(resolveUniqueExact('', [{ title: 'x' }]).status, 'ambiguous');
  assert.equal(resolveUniqueExact('x', []).status, 'unmatched');
});

// A hand-added issue gets a negative synthetic id so it can never collide with a real Marvel
// id. The serializer used to build a marvel.com URL from any non-null id, which published a
// dead link and broke the round trip: the id pattern will not match a leading "-", so on
// re-import the entry fell out of `entries` into `unresolved` and its read state detached.
test('a hand-added issue never becomes a fabricated marvel.com link', () => {
  const md = serializeChecklist({
    name: 'Mixed',
    items: [
      { issueId: 52447, title: 'Real Issue #1', url: null, read: false },
      { issueId: -1754289012345, title: 'My Indie Comic #1', url: null, read: true },
    ],
  });

  assert.ok(!md.includes('/-'), `no negative id may reach a URL:\n${md}`);
  assert.match(md, /- \[x\] My Indie Comic #1/, 'it serializes as a plain checkbox instead');

  const { entries, unresolved } = parseChecklist(md);
  assert.deepEqual(entries.map((e) => e.issueId), [52447]);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].title, 'My Indie Comic #1');
  assert.equal(unresolved[0].read, true, 'and its read state still round-trips');
  assert.equal(unresolved[0].url, null, 'with no invented link attached');
});

// A trade order is a checklist with sub-headings, and the sub-heading is the only place the
// file says which book an issue is collected in. Losing it on the way in or out would turn a
// trade order back into an ordinary issue list with no visible sign anything had gone.
test('a sub-heading labels the issues beneath it with their collected edition', () => {
  const { entries } = parseChecklist([
    '# The New Ultimate Universe: Collected Editions',
    '',
    '## Ultimate Invasion',
    '',
    '- [ ] [Ultimate Invasion (2023) #1](https://www.marvel.com/comics/issue/97145/a)',
    '- [x] [Ultimate Invasion (2023) #2](https://www.marvel.com/comics/issue/97147/a)',
    '',
    '## Ultimates Vol. 1: Fix the World',
    '',
    '- [ ] [Ultimates (2024) #1](https://www.marvel.com/comics/issue/113211/a)',
  ].join('\n'));

  assert.deepEqual(entries.map((e) => e.section), [
    'Ultimate Invasion',
    'Ultimate Invasion',
    'Ultimates Vol. 1: Fix the World',
  ]);
});

// The list's own name is written as `# name`, so a level-1 heading is a title and not a book.
// Treating it as one would file every issue in the order under a single section named after
// the list, which looks like a working trade order and is not one.
test('a level-1 heading is a title, not a collected edition', () => {
  const { entries } = parseChecklist([
    '# My reading order',
    '- [ ] [One #1](https://www.marvel.com/comics/issue/1/a)',
  ].join('\n'));

  assert.equal(entries[0].section, null);
});

// A second `#` further down is the case that looks right while being wrong: without the reset
// the issues under it keep the last trade's name.
test('a later level-1 heading ends the section rather than continuing it', () => {
  const { entries } = parseChecklist([
    '## Ultimate Invasion',
    '- [ ] [One #1](https://www.marvel.com/comics/issue/1/a)',
    '# Appendix',
    '- [ ] [Two #1](https://www.marvel.com/comics/issue/2/a)',
  ].join('\n'));

  assert.deepEqual(entries.map((e) => e.section), ['Ultimate Invasion', null]);
});

// An issue whose title could not be resolved to an id still belongs to a book, and the
// unresolved path is the one that gets forgotten.
test('an unresolved line keeps the collected edition it sat under', () => {
  const { unresolved } = parseChecklist([
    '## Ultimate Endgame',
    '- [ ] Some Issue Nobody Can Resolve',
  ].join('\n'));

  assert.equal(unresolved[0].section, 'Ultimate Endgame');
});

// Export then re-import is the reader's own backup route. If the books do not survive it,
// the file they saved is not the list they had.
test('a trade order survives a round trip through export and import', () => {
  const items = [
    { issueId: 97145, title: 'Ultimate Invasion (2023) #1', url: null, read: true, collectedIn: 'Ultimate Invasion' },
    { issueId: 97147, title: 'Ultimate Invasion (2023) #2', url: null, read: false, collectedIn: 'Ultimate Invasion' },
    { issueId: 113211, title: 'Ultimates (2024) #1', url: null, read: false, collectedIn: 'Ultimates Vol. 1: Fix the World' },
  ];
  const md = serializeChecklist({ name: 'Collected Editions', items });

  assert.match(md, /^## Ultimate Invasion$/m);
  assert.match(md, /^## Ultimates Vol\. 1: Fix the World$/m);

  const { entries } = parseChecklist(md);
  assert.deepEqual(
    entries.map((e) => [e.issueId, e.section, e.read]),
    items.map((i) => [i.issueId, i.collectedIn, i.read]),
  );
});

// An ordinary issue order must serialize exactly as it always did, or every existing order
// gains a heading it never had.
test('a list with no collected editions gains no headings', () => {
  const md = serializeChecklist({
    name: 'Plain',
    items: [{ issueId: 1, title: 'One #1', url: null, read: false }],
  });

  assert.ok(!md.includes('## '), `no sub-heading may appear:\n${md}`);
});
