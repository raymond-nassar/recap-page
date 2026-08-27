import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function issueBearingBlocksDigest(ledger) {
  return digest(JSON.stringify(ledger.sourceNodes
    .filter((node) => node.sourceOccurrenceCount > 0)
    .map((node) => ({
      sourceBlockPosition: node.sourceBlockPosition,
      sourceGroupPosition: node.sourceGroupPosition,
      sourceGroup: node.sourceGroup,
      tag: node.tag,
      text: node.text,
      semanticRole: node.semanticRole,
      sourceOccurrenceStartPosition: node.sourceOccurrenceStartPosition,
      sourceOccurrenceCount: node.sourceOccurrenceCount,
    }))));
}

function sourceContentDigest(ledger) {
  return digest(ledger.sourceNodes.map((node) => `${node.tag}:${node.text}`).join('\n'));
}

function sourceIdentity(entry) {
  return [
    entry.normalizedSeriesTitle,
    entry.seriesYear ?? 'source-unspecified',
    entry.issueNumber,
  ].join('|');
}

function occurrencesAt(ledger, sourceBlockPosition) {
  return ledger.issueOccurrences.filter((entry) => entry.sourceBlockPosition === sourceBlockPosition);
}

function partitionDigest(ledger) {
  return digest(JSON.stringify(ledger.issueOccurrences.map((entry) => ({
    sourceOccurrencePosition: entry.sourceOccurrencePosition,
    classification: entry.classification,
    sourceClauseKind: entry.sourceClauseKind,
    sourceIssueReference: entry.sourceIssueReference,
    sourceIdentity: entry.sourceIdentity,
  }))));
}

function candidateRangeRowsDigest(ledger) {
  return digest(JSON.stringify(ledger.issueOccurrences
    .filter((entry) => entry.classification === 'provisional-canonical-candidate' && entry.sourceIdentity != null)
    .map((entry) => ({
      sourceOccurrencePosition: entry.sourceOccurrencePosition,
      sourceIdentity: sourceIdentity(entry),
      sourceClauseKind: entry.sourceClauseKind,
      sourceIssueReference: entry.sourceIssueReference,
    }))));
}

function repeatRowsDigest(ledger) {
  return digest(JSON.stringify(ledger.issueOccurrences
    .filter((entry) => entry.classification === 'true-repeat')
    .map((entry) => ({
      sourceOccurrencePosition: entry.sourceOccurrencePosition,
      sourceIdentity: sourceIdentity(entry),
      sourceClauseKind: entry.sourceClauseKind,
      sourceIssueReference: entry.sourceIssueReference,
      repeatOfPositions: entry.repeatOfPositions,
    }))));
}

function semanticExclusionRowsDigest(ledger) {
  return digest(JSON.stringify(ledger.issueOccurrences
    .filter((entry) => entry.classification === 'semantic-exclusion')
    .map((entry) => ({
      sourceOccurrencePosition: entry.sourceOccurrencePosition,
      sourceBlockPosition: entry.sourceBlockPosition,
      sourceClauseKind: entry.sourceClauseKind,
      sourceIssueReference: entry.sourceIssueReference,
      reason: entry.reason,
    }))));
}

function namedWorkAuditDigest(ledger) {
  return digest(JSON.stringify(ledger.issueOccurrences
    .filter((entry) => entry.sourceClauseKind === 'named-work-label')
    .map((entry) => ({
      sourceOccurrencePosition: entry.sourceOccurrencePosition,
      sourceBlockPosition: entry.sourceBlockPosition,
      sourceGroupPosition: entry.sourceGroupPosition,
      sourceGroup: entry.sourceGroup,
      sourceIssueReference: entry.sourceIssueReference,
      verbatimSourceReference: entry.sourceRangeReference,
      inferredTitle: entry.normalizedSeriesTitle,
      inferredYear: entry.sourceIssueReference === 'Guardians of Knowhere' ? 2015 : 'source-unspecified',
      inferredFormat: entry.sourceIssueReference === 'Guardians of Knowhere' ? 'crossover' : (entry.sourceIssueReference === 'Guardians of the Galaxy: Awesome Mix Infinite Comic' ? 'infinite comic' : 'event'),
      classification: entry.classification,
      reason: entry.reason,
    }))));
}

function cloneLedger(ledger) {
  return JSON.parse(JSON.stringify(ledger));
}

function assertGuardiansLedgerShape(ledger) {
  const expectedNodeRoles = {
    prose: 36,
    heading: 8,
    blank: 6,
    'collection-label': 36,
    'collection-clause': 41,
    'named-work-label': 5,
    'issue-range-label': 1,
    'issue-prose': 3,
    'event-label': 6,
    'creator-run-label': 1,
    'issue-label': 1,
  };
  const expectedClauseClassifications = {
    'collection-label': 'semantic-exclusion',
    'named-work-label': 'provisional-canonical-candidate',
    'event-label': 'semantic-exclusion',
    'creator-run-label': 'semantic-exclusion',
    'issue-prose': 'provisional-canonical-candidate',
    'issue-range-label': 'provisional-canonical-candidate',
    'issue-label': 'provisional-canonical-candidate',
  };
  const expectedNamedWorkAudit = [
    {
      sourceOccurrencePosition: 117,
      sourceBlockPosition: 31,
      sourceGroupPosition: 5,
      sourceGroup: 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run',
      sourceIssueReference: 'Annihilation',
      verbatimSourceReference: 'Annihilation',
      inferredTitle: 'Annihilation',
      inferredYear: 'source-unspecified',
      inferredFormat: 'event',
      classification: 'provisional-canonical-candidate',
      reason: 'Named work is source-identifiable without a numeric issue label.',
    },
    {
      sourceOccurrencePosition: 118,
      sourceBlockPosition: 34,
      sourceGroupPosition: 5,
      sourceGroup: 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run',
      sourceIssueReference: 'Annihilation Conquest',
      verbatimSourceReference: 'Annihilation Conquest',
      inferredTitle: 'Annihilation Conquest',
      inferredYear: 'source-unspecified',
      inferredFormat: 'event',
      classification: 'provisional-canonical-candidate',
      reason: 'Named work is source-identifiable without a numeric issue label.',
    },
    {
      sourceOccurrencePosition: 146,
      sourceBlockPosition: 41,
      sourceGroupPosition: 5,
      sourceGroup: 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run',
      sourceIssueReference: 'The Thanos Imperative',
      verbatimSourceReference: 'The Thanos Imperative',
      inferredTitle: 'The Thanos Imperative',
      inferredYear: 'source-unspecified',
      inferredFormat: 'event',
      classification: 'provisional-canonical-candidate',
      reason: 'Named work is source-identifiable without a numeric issue label.',
    },
    {
      sourceOccurrencePosition: 240,
      sourceBlockPosition: 78,
      sourceGroupPosition: 6,
      sourceGroup: 'Marvel NOW! Guardians of the Galaxy - The Brian Michael Bendis Run',
      sourceIssueReference: 'Guardians of Knowhere',
      verbatimSourceReference: 'Guardians of Knowhere',
      inferredTitle: 'Guardians of Knowhere',
      inferredYear: 2015,
      inferredFormat: 'crossover',
      classification: 'provisional-canonical-candidate',
      reason: 'Named work is source-identifiable without a numeric issue label.',
    },
    {
      sourceOccurrencePosition: 271,
      sourceBlockPosition: 93,
      sourceGroupPosition: 7,
      sourceGroup: 'All-New All-Different Guardians of the Galaxy... Still by Bendis',
      sourceIssueReference: 'Guardians of the Galaxy: Awesome Mix Infinite Comic',
      verbatimSourceReference: 'Guardians of the Galaxy: Awesome Mix Infinite Comic',
      inferredTitle: 'Guardians of the Galaxy: Awesome Mix Infinite Comic',
      inferredYear: 'source-unspecified',
      inferredFormat: 'infinite comic',
      classification: 'provisional-canonical-candidate',
      reason: 'Named work is source-identifiable without a numeric issue label.',
    },
  ];

  assert.equal(ledger.sourceNodes.length, ledger.sourceBlockCount);
  assert.equal(ledger.provenanceGroups.length, ledger.provenanceGroupCount);
  assert.equal(ledger.issueOccurrences.length, ledger.sourceOccurrenceCount);
  assert.equal(ledger.sourceContentSha256, sourceContentDigest(ledger));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, issueBearingBlocksDigest(ledger));
  assert.equal(ledger.sourceBoundaryDigest, digest(ledger.sourceBoundary));
  assert.equal(ledger.sourceReview.namedWorkAuditDigest, namedWorkAuditDigest(ledger));
  assert.equal(ledger.sourceReview.candidateRangeRowsDigest, candidateRangeRowsDigest(ledger));
  assert.equal(ledger.sourceReview.repeatRowsDigest, repeatRowsDigest(ledger));
  assert.equal(ledger.sourceReview.semanticExclusionRowsDigest, semanticExclusionRowsDigest(ledger));
  assert.equal(ledger.sourceReview.partitionDigest, partitionDigest(ledger));
  assert.deepEqual(ledger.sourceReview.namedWorkAudit, expectedNamedWorkAudit);
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceBlockPosition),
    Array.from({ length: ledger.sourceBlockCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.sourceNodes.reduce((counts, node) => {
      counts[node.semanticRole] = (counts[node.semanticRole] || 0) + 1;
      return counts;
    }, {}),
    expectedNodeRoles,
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.heading),
    [
      'Prelude',
      'Guardians of the Galaxy Reading Order',
      'Original Guardians of the Galaxy',
      "1990's Guardians of the Galaxy by Jim Valentino",
      'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run',
      'Marvel NOW! Guardians of the Galaxy - The Brian Michael Bendis Run',
      'All-New All-Different Guardians of the Galaxy... Still by Bendis',
      'Marvel Legacy to Marvel Fresh Start Guardians',
      'Latest Additions:',
    ],
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => [
      group.sourceBlockStartPosition,
      group.sourceBlockEndPosition,
    ]),
    [[1, 3], [4, 5], [6, 14], [15, 29], [30, 43], [44, 81], [82, 98], [99, 129], [130, 144]],
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.issueBearingBlockCount),
    [0, 0, 4, 12, 7, 25, 13, 20, 13],
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.issueOccurrenceCount),
    [0, 0, 38, 78, 30, 94, 42, 95, 43],
  );
  assert.deepEqual(
    ledger.issueOccurrences.map((entry) => entry.sourceOccurrencePosition),
    Array.from({ length: ledger.sourceOccurrenceCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.categoryCounts,
    {
      'provisional-canonical-candidate': 323,
      'semantic-exclusion': 59,
      'true-repeat': 38,
    },
  );
  for (const [classification, positions] of Object.entries(ledger.categoryPositions)) {
    assert.deepEqual(
      positions,
      ledger.issueOccurrences
        .filter((entry) => entry.classification === classification)
        .map((entry) => entry.sourceOccurrencePosition),
    );
  }

  const identityBuckets = new Map();
  const seenIssueIdentities = new Set();
  for (const entry of ledger.issueOccurrences) {
    const classification = expectedClauseClassifications[entry.sourceClauseKind];

    if (classification) {
      assert.equal(entry.classification, classification);
      if (entry.sourceIdentity) {
        const identity = sourceIdentity(entry);
        const seen = identityBuckets.get(identity) || [];
        seen.push(entry);
        identityBuckets.set(identity, seen);
        seenIssueIdentities.add(identity);
      }
    } else {
      assert.equal(entry.sourceClauseKind, 'collection-clause');
      if (entry.sourceIdentity == null) {
        assert.equal(entry.classification, 'semantic-exclusion');
      } else {
        const identity = sourceIdentity(entry);
        const bucket = identityBuckets.get(identity) || [];
        assert.equal(entry.classification, seenIssueIdentities.has(identity) ? 'true-repeat' : 'provisional-canonical-candidate');
        bucket.push(entry);
        identityBuckets.set(identity, bucket);
        seenIssueIdentities.add(identity);
      }
    }

    if (entry.sourceClauseKind === 'collection-label') {
      assert.equal(entry.normalizedSeriesTitle, null);
      assert.equal(entry.seriesYear, null);
      assert.equal(entry.issueNumber, null);
      assert.equal(entry.sourceIdentity, null);
    }

    if (entry.sourceClauseKind === 'named-work-label') {
      assert.equal(entry.classification, 'provisional-canonical-candidate');
      assert.ok(entry.normalizedSeriesTitle);
      assert.equal(entry.issueNumber, null);
      assert.equal(entry.sourceIdentity, null);
      assert.equal(entry.reason, 'Named work is source-identifiable without a numeric issue label.');
    }

    if (entry.sourceClauseKind === 'issue-prose'
      || entry.sourceClauseKind === 'issue-range-label'
      || entry.sourceClauseKind === 'issue-label') {
      assert.equal(entry.classification, 'provisional-canonical-candidate');
      assert.equal(entry.sourceIdentity, sourceIdentity(entry), entry.sourceIssueReference);
    }

    if (entry.sourceClauseKind === 'event-label' || entry.sourceClauseKind === 'creator-run-label') {
      assert.equal(entry.sourceIdentity, null);
    }
  }

  let singletonCount = 0;
  let doubleCount = 0;
  let tripleCount = 0;
  for (const [identity, entries] of identityBuckets) {
    assert.ok(entries.length >= 1 && entries.length <= 3, identity);
    if (entries.length === 1) {
      singletonCount += 1;
      assert.equal(entries[0].classification, 'provisional-canonical-candidate', identity);
    } else if (entries.length === 2) {
      doubleCount += 1;
      assert.deepEqual(
        entries.map((entry) => entry.classification).sort(),
        ['provisional-canonical-candidate', 'true-repeat'],
        identity,
      );
    } else {
      tripleCount += 1;
      assert.deepEqual(
        entries.map((entry) => entry.classification),
        ['provisional-canonical-candidate', 'true-repeat', 'true-repeat'],
        identity,
      );
    }
  }
  assert.equal(identityBuckets.size, 318);
  assert.equal(singletonCount, 285);
  assert.equal(doubleCount, 28);
  assert.equal(tripleCount, 5);
}

test('the Guardians Stage A ledger freezes the full-page boundary and inventory checkpoint', async () => {
  const ledger = await readJson('scripts/data/cbh-source-ledgers/guardians-of-the-galaxy-reading-order.json');
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const record = inventory.find((entry) => entry.id === ledger.id);
  const headings = [
    'Prelude',
    'Guardians of the Galaxy Reading Order',
    'Original Guardians of the Galaxy',
    "1990's Guardians of the Galaxy by Jim Valentino",
    'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run',
    'Marvel NOW! Guardians of the Galaxy - The Brian Michael Bendis Run',
    'All-New All-Different Guardians of the Galaxy... Still by Bendis',
    'Marvel Legacy to Marvel Fresh Start Guardians',
    'Latest Additions:',
  ];

  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'guardians-of-the-galaxy-reading-order');
  assert.equal(ledger.inventoryId, ledger.id);
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/guardians-of-the-galaxy-reading-order/');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-27');
  assert.equal(ledger.sourceProvider, 'comic-book-herald');
  assert.equal(ledger.sourceBlockCount, 144);
  assert.equal(ledger.provenanceGroupCount, headings.length);
  assert.equal(ledger.sourceOccurrenceCount, 420);
  assert.deepEqual(ledger.categoryCounts, {
    'provisional-canonical-candidate': 323,
    'semantic-exclusion': 59,
    'true-repeat': 38,
  });
  assert.match(ledger.sourceBoundary, /No qualifying Best Comics or Essential Comics subsection exists/i);
  assert.match(ledger.sourceBoundary, /full page is the frozen boundary/i);
  assert.equal(ledger.sourceContentSha256, sourceContentDigest(ledger));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, issueBearingBlocksDigest(ledger));
  assert.equal(ledger.sourceBoundaryDigest, digest(ledger.sourceBoundary));

  assert.equal(ledger.sourceNodes.length, ledger.sourceBlockCount);
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceBlockPosition),
    Array.from({ length: ledger.sourceBlockCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.heading),
    headings,
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => [
      group.sourceBlockStartPosition,
      group.sourceBlockEndPosition,
    ]),
    [[1, 3], [4, 5], [6, 14], [15, 29], [30, 43], [44, 81], [82, 98], [99, 129], [130, 144]],
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.issueBearingBlockCount),
    [0, 0, 4, 12, 7, 25, 13, 20, 13],
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.issueOccurrenceCount),
    [0, 0, 38, 78, 30, 94, 42, 95, 43],
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.classification === 'provisional-canonical-candidate').length,
    323,
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.classification === 'provisional-canonical-candidate' && entry.sourceIdentity == null).length,
    5,
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.classification === 'unresolved-included-identity-gap').length,
    0,
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.sourceClauseKind === 'named-work-label').length,
    5,
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.sourceClauseKind === 'issue-prose').length,
    7,
  );

  const categoryTotals = Object.fromEntries(
    Object.entries(ledger.categoryPositions).map(([key, value]) => [key, value.length]),
  );
  assert.deepEqual(categoryTotals, ledger.categoryCounts);
  assert.deepEqual(
    Object.values(ledger.categoryPositions).flat().sort((left, right) => left - right),
    Array.from({ length: ledger.sourceOccurrenceCount }, (_, index) => index + 1),
  );

  assert.ok(record);
  assert.equal(record.reason, 'The full-page boundary and Stage A source ledger are frozen, but issue rows have not been resolved against the metadata snapshot, so a complete-library relationship cannot be asserted safely.');
  assert.equal(record.sourceRetrievedAt, ledger.sourceRetrievedAt);
  assert.equal(record.sourceContentSha256, ledger.sourceContentSha256);
  assert.equal(record.disposition, 'deferred');
  assert.equal(record.centralDisposition, 'deferred');
  assert.equal(record.deliveryStatus, 'not-applicable');
  assert.deepEqual(record.catalogIds, []);
});

test('the Guardians Stage A ledger expands repeats, named works, and partial-material exclusions', async () => {
  const ledger = await readJson('scripts/data/cbh-source-ledgers/guardians-of-the-galaxy-reading-order.json');
  const expectedNamedWorkRefs = [
    'Annihilation',
    'Annihilation Conquest',
    'The Thanos Imperative',
    'Guardians of Knowhere',
    'Guardians of the Galaxy: Awesome Mix Infinite Comic',
  ];
  const partialRefs = [
    'Marvel Comics Presents #134',
    'Guardians of the Galaxy Annual #4',
    'Amazing Spider-Man #654 (B story)',
    'Thor (1966) #314',
    "Logan's Run #6",
    'Marvel Holiday Special #2',
    'Free Comic Book Day 2018 (Amazing Spider-Man) #1',
    'Thanos Legacy (2018) #1',
  ];

  assert.deepEqual(
    ledger.sourceReview.namedWorkAudit.map((entry) => entry.sourceIssueReference),
    expectedNamedWorkRefs,
  );
  assert.deepEqual(
    ledger.sourceReview.namedWorkAudit.map((entry) => [entry.sourceOccurrencePosition, entry.sourceBlockPosition, entry.sourceGroup]),
    [
      [117, 31, 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run'],
      [118, 34, 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run'],
      [146, 41, 'Modern Guardians of the Galaxy - Dan Abnett & Andy Lanning Run'],
      [240, 78, 'Marvel NOW! Guardians of the Galaxy - The Brian Michael Bendis Run'],
      [271, 93, 'All-New All-Different Guardians of the Galaxy... Still by Bendis'],
    ],
  );
  assert.equal(
    ledger.issueOccurrences.filter((entry) => entry.classification === 'unresolved-included-identity-gap').length,
    0,
  );
  assert.deepEqual(
    ledger.issueOccurrences
      .filter((entry) => entry.sourceClauseKind === 'named-work-label')
      .map((entry) => [entry.sourceOccurrencePosition, entry.classification, entry.reason]),
    [
      [117, 'provisional-canonical-candidate', 'Named work is source-identifiable without a numeric issue label.'],
      [118, 'provisional-canonical-candidate', 'Named work is source-identifiable without a numeric issue label.'],
      [146, 'provisional-canonical-candidate', 'Named work is source-identifiable without a numeric issue label.'],
      [240, 'provisional-canonical-candidate', 'Named work is source-identifiable without a numeric issue label.'],
      [271, 'provisional-canonical-candidate', 'Named work is source-identifiable without a numeric issue label.'],
    ],
  );
  assert.equal(
    ledger.issueOccurrences
      .filter((entry) => entry.classification === 'semantic-exclusion'
        && entry.reason === 'Partial-material reference rather than a whole-comic occurrence.')
      .length,
    16,
  );
  for (const ref of partialRefs) {
    assert.ok(
      ledger.issueOccurrences.some((entry) => (
        entry.classification === 'semantic-exclusion'
          && entry.reason === 'Partial-material reference rather than a whole-comic occurrence.'
          && entry.sourceIssueReference === ref
      )),
      `${ref} is missing its partial-material exclusion`,
    );
  }

  assert.deepEqual(
    occurrencesAt(ledger, 51).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #8', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #9', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 52).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #1', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #2', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #3', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #4', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #5', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #6', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #7', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #8', 'true-repeat'],
      ['Guardians of the Galaxy #9', 'true-repeat'],
      ['Guardians of the Galaxy #10', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 54).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #11', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #12', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #13', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 55).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #11', 'true-repeat'],
      ['Guardians of the Galaxy #12', 'true-repeat'],
      ['Guardians of the Galaxy #13', 'true-repeat'],
      ['All-New X-Men #22', 'provisional-canonical-candidate'],
      ['All-New X-Men #23', 'provisional-canonical-candidate'],
      ['All-New X-Men #24', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 70).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #24', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #25', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 72).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #24', 'true-repeat'],
      ['Guardians of the Galaxy #25', 'true-repeat'],
      ['Guardians of the Galaxy #26', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #27', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #1', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #2', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #3', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #4', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #5', 'provisional-canonical-candidate'],
    ],
  );
  assert.deepEqual(
    occurrencesAt(ledger, 73).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy & X-Men: The Black Vortex Alpha #1', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy #24', 'true-repeat'],
      ['Guardians of the Galaxy #25', 'true-repeat'],
      ['Legendary Star-Lord #9', 'provisional-canonical-candidate'],
      ['Legendary Star-Lord #10', 'provisional-canonical-candidate'],
      ['Legendary Star-Lord #11', 'provisional-canonical-candidate'],
      ['All-New X-Men #38', 'provisional-canonical-candidate'],
      ['All-New X-Men #39', 'provisional-canonical-candidate'],
      ['Guardians Team-Up #2', 'true-repeat'],
      ['Nova #28', 'provisional-canonical-candidate'],
      ['Cyclops #12', 'provisional-canonical-candidate'],
      ['Captain Marvel #14', 'provisional-canonical-candidate'],
      ['Guardians of the Galaxy & X-Men: The Black Vortex Omega #1', 'provisional-canonical-candidate'],
    ],
  );
  assert.ok(
    occurrencesAt(ledger, 89).every((entry) => (
      entry.classification === 'semantic-exclusion'
        && entry.reason === 'Partial-material reference rather than a whole-comic occurrence.'
    )),
  );
  assert.equal(occurrencesAt(ledger, 132).filter((entry) => entry.classification === 'true-repeat').length, 7);
  assert.equal(occurrencesAt(ledger, 134).filter((entry) => entry.classification === 'true-repeat').length, 5);
  assert.equal(occurrencesAt(ledger, 136).filter((entry) => entry.classification === 'true-repeat').length, 7);
  assert.equal(occurrencesAt(ledger, 138).filter((entry) => entry.classification === 'true-repeat').length, 6);
  assert.deepEqual(
    occurrencesAt(ledger, 140).map((entry) => [entry.sourceIssueReference, entry.classification]),
    [
      ['Guardians of the Galaxy #16', 'true-repeat'],
      ['Guardians of the Galaxy #17', 'true-repeat'],
      ['Guardians of the Galaxy #18', 'true-repeat'],
      ['Cable: Reloaded #1', 'provisional-canonical-candidate'],
      ['The Last Annihilation: Wiccan & Hulking #1', 'provisional-canonical-candidate'],
      ['The Last Annihilation: Wakanda and S.W.O.R.D. #7', 'provisional-canonical-candidate'],
    ],
  );
});

test('the Guardians Stage A checkpoint stays distinct from related current-catalog guides', async () => {
  const ledger = await readJson('scripts/data/cbh-source-ledgers/guardians-of-the-galaxy-reading-order.json');
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const record = inventory.find((entry) => entry.id === ledger.id);
  const guardiansSet = new Set(ledger.issueOccurrences
    .filter((entry) => entry.classification === 'provisional-canonical-candidate')
    .map(sourceIdentity));
  const peerIds = [
    'rocket-raccoon-reading-order',
    'groot-reading-order',
    'star-lord-reading-order',
    'thanos-reading-order',
    'last-annihilation',
  ];
  const peerPackets = await Promise.all(
    peerIds.map(async (peerId) => [peerId, await readJson(`scripts/data/cbh-packets/${peerId}.json`)]),
  );

  assert.ok(record);
  assert.deepEqual(record.catalogIds, []);
  assert.equal(record.centralDisposition, 'deferred');
  assert.equal(manifest.lists.some((entry) => entry.id === ledger.id), false);
  assert.equal(catalog.lists.some((entry) => entry.id === ledger.id), false);
  assert.ok(guardiansSet.has('Marvel Super-Heroes|1967|18'));
  assert.ok(guardiansSet.has('Guardians of the Galaxy|1990|1'));
  assert.ok(guardiansSet.has('Guardians of the Galaxy|2013|1'));
  assert.ok(guardiansSet.has('Guardians of the Galaxy|2023|1'));

  for (const [peerId, packet] of peerPackets) {
    const peerManifest = manifest.lists.find((entry) => entry.id === peerId);
    assert.ok(peerManifest, `${peerId} is missing from curated-lists.json`);
    assert.notEqual(peerManifest.sourcePage, ledger.sourceUrl);

    const peerSet = new Set(packet.rows.map(sourceIdentity));
    assert.equal(peerSet.has('Marvel Super-Heroes|1967|18'), false, `${peerId} should not subsume the original-team opener`);
    assert.equal(peerSet.has('Guardians of the Galaxy|1990|1'), false, `${peerId} should not subsume the Valentino team run`);
  }

  const starLordPacket = peerPackets.find(([peerId]) => peerId === 'star-lord-reading-order')?.[1];
  assert.ok(starLordPacket);
  assert.equal(
    new Set(starLordPacket.rows.map(sourceIdentity)).has('Guardians of the Galaxy|2013|1'),
    false,
    'star-lord-reading-order should stay distinct from the 2013 team launch',
  );
});

test('the Guardians Stage A ledger fails before the requested mutation cases', async () => {
  const ledger = await readJson('scripts/data/cbh-source-ledgers/guardians-of-the-galaxy-reading-order.json');

  assert.doesNotThrow(() => assertGuardiansLedgerShape(ledger));

  const expectFailure = (name, mutate) => {
    const mutated = cloneLedger(ledger);
    mutate(mutated);
    assert.throws(() => assertGuardiansLedgerShape(mutated), name);
  };

  expectFailure('tail truncation', (mutated) => {
    mutated.issueOccurrences.pop();
  });

  expectFailure('whole-node omission', (mutated) => {
    mutated.sourceNodes.pop();
  });

  expectFailure('source/category reorder', (mutated) => {
    mutated.categoryPositions['provisional-canonical-candidate'] = [...mutated.categoryPositions['provisional-canonical-candidate']].reverse();
  });

  expectFailure('duplicate positions', (mutated) => {
    mutated.issueOccurrences[1].sourceOccurrencePosition = mutated.issueOccurrences[0].sourceOccurrencePosition;
  });

  for (const classification of [
    'provisional-canonical-candidate',
    'semantic-exclusion',
    'true-repeat',
  ]) {
    expectFailure(`deletion from ${classification}`, (mutated) => {
      const index = mutated.issueOccurrences.findIndex((entry) => entry.classification === classification);
      mutated.issueOccurrences.splice(index, 1);
    });
  }

  expectFailure('dropped range member', (mutated) => {
    const index = mutated.issueOccurrences.findIndex((entry) => entry.sourceBlockPosition === 10);
    mutated.issueOccurrences.splice(index, 1);
  });

  expectFailure('issue-bearing prose misclassification', (mutated) => {
    const entry = mutated.issueOccurrences.find((row) => row.sourceClauseKind === 'issue-prose');
    entry.classification = 'semantic-exclusion';
  });

  expectFailure('title-only cross-series repeat collision', (mutated) => {
    const entry = mutated.issueOccurrences.find((row) => row.sourceIssueReference === 'Guardians Team-Up #2' && row.classification === 'true-repeat');
    entry.normalizedSeriesTitle = 'Guardians of the Galaxy';
    entry.seriesYear = 2013;
    entry.issueNumber = '24';
  });

  expectFailure('blank formatting as gap', (mutated) => {
    const entry = mutated.sourceNodes.find((node) => node.semanticRole === 'blank');
    entry.sourceOccurrenceCount = 1;
  });

  expectFailure('mixed whole-comic and partial-material conflation', (mutated) => {
    const entry = mutated.issueOccurrences.find((row) => row.classification === 'semantic-exclusion' && row.reason === 'Partial-material reference rather than a whole-comic occurrence.');
    entry.classification = 'provisional-canonical-candidate';
  });

  const namedWorkMutated = cloneLedger(ledger);
  namedWorkMutated.issueOccurrences.find((row) => row.sourceClauseKind === 'named-work-label').classification = 'semantic-exclusion';
  assert.notEqual(namedWorkAuditDigest(namedWorkMutated), ledger.sourceReview.namedWorkAuditDigest);
  assert.throws(() => assertGuardiansLedgerShape(namedWorkMutated));

  const inheritedRangeMutated = cloneLedger(ledger);
  inheritedRangeMutated.issueOccurrences.find((row) => row.sourceClauseKind === 'issue-range-label').normalizedSeriesTitle = null;
  inheritedRangeMutated.issueOccurrences.find((row) => row.sourceClauseKind === 'issue-range-label').sourceIdentity = null;
  assert.notEqual(candidateRangeRowsDigest(inheritedRangeMutated), ledger.sourceReview.candidateRangeRowsDigest);
  assert.notEqual(partitionDigest(inheritedRangeMutated), ledger.sourceReview.partitionDigest);
  assert.throws(() => assertGuardiansLedgerShape(inheritedRangeMutated));
});
