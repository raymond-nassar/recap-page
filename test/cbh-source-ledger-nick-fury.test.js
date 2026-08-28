import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'nick-fury-reading-order.json');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-character-inventory.json');

const expectedGroupNames = [
  'Prelude and setup',
  'WWII Fury',
  'Transition and 1980s',
  'Nick Fury: Director of S.H.I.E.L.D.',
  'Modern Fury and Secret War',
  'Garth Ennis Fury',
  'S.H.I.E.L.D. by Hickman and Weaver',
];

const expectedGroupNodeCounts = [6, 5, 2, 5, 3, 2, 2];
const expectedNodeOccurrenceCounts = [1, 1, 1, 1, 1, 1, 34, 32, 33, 64, 21, 1, 1, 13, 46, 1, 36, 6, 7, 28, 1, 25, 1, 13, 1];
const expectedCategoryCounts = {
  'provisional-canonical-candidate': 272,
  'true-repeat': 74,
  'unresolved-included-identity-gap': 0,
  'semantic-exclusion': 24,
};
const expectedAllowedClassifications = new Set([
  'provisional-canonical-candidate',
  'true-repeat',
  'unresolved-included-identity-gap',
  'semantic-exclusion',
]);
const expectedBoundaryProofTypes = [
  'live-url',
  'retrieval-date',
  'content-hash',
  'issue-bearing-block-hash',
  'first-included-block',
  'last-included-block',
];

function readLedger() {
  return readFile(ledgerPath, 'utf8').then((content) => JSON.parse(content));
}

function readInventory() {
  return readFile(inventoryPath, 'utf8').then((content) => JSON.parse(content));
}

function nodeDigest(node) {
  return {
    sourceNode: node.sourceNode,
    sourceGroup: node.sourceGroup,
    sourceGroupPosition: node.sourceGroupPosition,
    sourceBlockPosition: node.sourceBlockPosition,
    sourceText: node.sourceText,
    countsTowardIssueBearingBlocks: node.countsTowardIssueBearingBlocks,
  };
}

function occurrenceDigest(occurrence) {
  return {
    sourcePosition: occurrence.sourcePosition,
    sourceNode: occurrence.sourceNode,
    sourceGroup: occurrence.sourceGroup,
    sourceGroupPosition: occurrence.sourceGroupPosition,
    sourceBlockPosition: occurrence.sourceBlockPosition,
    sourceIssueReference: occurrence.sourceIssueReference,
    sourceRangeReference: occurrence.sourceRangeReference,
    normalizedSeriesTitle: occurrence.normalizedSeriesTitle,
    seriesYear: occurrence.seriesYear,
    issueNumber: occurrence.issueNumber,
    classification: occurrence.classification,
    sourceType: occurrence.sourceType,
    reason: occurrence.reason,
    note: occurrence.note,
    repeatOf: occurrence.repeatOf,
  };
}

function assertLedgerShape(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'nick-fury-reading-order');
  assert.equal(ledger.inventoryId, 'nick-fury-reading-order');
  assert.equal(ledger.sourceProvider, 'comic-book-herald');
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/omnibussin-nick-fury-from-war-world-ii-to-s-h-i-e-l-d/');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-28');
  assert.equal(ledger.sourcePageTitle, 'Omnibussin: Nick Fury, from World War II to S.H.I.E.L.D.');
  assert.equal(ledger.sourceContentSha256, '2ede127daa81d8358e9dc9a3c3795e817b4cc18739163dc7eadb56e0102e093e');
  assert.equal(ledger.sourceNodeCount, 25);
  assert.equal(ledger.sourceBlockCount, 25);
  assert.equal(ledger.provenanceGroupCount, 7);
  assert.equal(ledger.issueBearingBlockCount, 14);
  assert.equal(ledger.sourceOccurrenceCount, 370);
  assert.equal(ledger.sourceNodes.length, ledger.sourceNodeCount);
  assert.equal(ledger.sourceNodes.length, ledger.sourceBlockCount);
  assert.equal(ledger.occurrences.length, ledger.sourceOccurrenceCount);
  assert.equal(ledger.sourceBoundary.status, 'exact-page-snapshot');
  assert.equal(ledger.sourceBoundary.canonicalUrl, ledger.sourceUrl);
  assert.equal(ledger.sourceBoundary.pageTitle, ledger.sourcePageTitle);
  assert.equal(ledger.sourceBoundary.browserTitle, 'Complete Nick Fury Omnibus Reading Order!');
  assert.equal(ledger.sourceBoundary.blockCount, 25);
  assert.equal(ledger.sourceBoundary.headingCount, 0);
  assert.equal(ledger.sourceBoundary.firstIncludedBlock.sourceNode, 1);
  assert.equal(ledger.sourceBoundary.lastIncludedBlock.sourceNode, 25);
  assert.equal(ledger.sourceBoundary.issueBearingBlockCount, 14);
  assert.equal(ledger.sourceBoundaryDigest, digestCanonicalJson(ledger.sourceBoundary));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, digestCanonicalJson(ledger.sourceNodes.filter((node) => node.countsTowardIssueBearingBlocks)));
  assert.equal(ledger.sourceNodeOrderDigest, digestCanonicalJson(ledger.sourceNodes.map(nodeDigest)));
  assert.equal(ledger.occurrenceDigest, digestCanonicalJson(ledger.occurrences.map(occurrenceDigest)));
  assert.equal(ledger.repeatDigest, digestCanonicalJson(ledger.occurrences.filter((occurrence) => occurrence.classification === 'true-repeat').map(occurrenceDigest)));
  assert.equal(ledger.dispositionDigest, digestCanonicalJson(ledger.categoryCounts));
  assert.deepEqual(ledger.categoryCounts, expectedCategoryCounts);
  assert.equal(ledger.sourceNodes.filter((node) => node.countsTowardIssueBearingBlocks).length, ledger.issueBearingBlockCount);
  assert.deepEqual(ledger.sourceBoundary.boundaryProof.map((entry) => entry.type), expectedBoundaryProofTypes);
  assert.equal(ledger.sourceBoundary.boundaryProof[0].url, ledger.sourceUrl);
  assert.equal(ledger.sourceBoundary.boundaryProof[1].retrievedAt, ledger.sourceRetrievedAt);
  assert.equal(ledger.sourceBoundary.boundaryProof[2].sha256, ledger.sourceContentSha256);
  assert.equal(ledger.sourceBoundary.boundaryProof[3].sha256, ledger.sourceIssueBearingBlocksSha256);
  assert.ok(ledger.sourceBoundary.firstIncludedBlock.sourceText.startsWith('Nick Fury must be a difficult character'));
  assert.ok(ledger.sourceBoundary.lastIncludedBlock.sourceText.startsWith('That'));
  assert.equal(ledger.sourceBoundary.adjacentContentExcluded.length, 2);
  assert.ok(ledger.sourceBoundary.adjacentContentExcluded[0].includes('article chrome'));
  assert.ok(ledger.sourceBoundary.adjacentContentExcluded[1].includes('ad divs'));
}

function validateLedger(ledger) {
  assertLedgerShape(ledger);

  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceNode),
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceGroup),
    [
      'Prelude and setup',
      'Prelude and setup',
      'Prelude and setup',
      'Prelude and setup',
      'Prelude and setup',
      'Prelude and setup',
      'WWII Fury',
      'WWII Fury',
      'WWII Fury',
      'WWII Fury',
      'WWII Fury',
      'Transition and 1980s',
      'Transition and 1980s',
      'Nick Fury: Director of S.H.I.E.L.D.',
      'Nick Fury: Director of S.H.I.E.L.D.',
      'Nick Fury: Director of S.H.I.E.L.D.',
      'Nick Fury: Director of S.H.I.E.L.D.',
      'Nick Fury: Director of S.H.I.E.L.D.',
      'Modern Fury and Secret War',
      'Modern Fury and Secret War',
      'Modern Fury and Secret War',
      'Garth Ennis Fury',
      'Garth Ennis Fury',
      'S.H.I.E.L.D. by Hickman and Weaver',
      'S.H.I.E.L.D. by Hickman and Weaver',
    ],
  );
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.countsTowardIssueBearingBlocks),
    [
      false, false, false, true, false, false,
      true, true, true, true, true,
      false, false,
      true, true, false, true, true,
      true, true, false, true,
      false, true,
      false,
    ],
  );
  assert.equal(ledger.sourceNodes.filter((node) => node.countsTowardIssueBearingBlocks).length, 14);
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.occurrences.length),
    expectedNodeOccurrenceCounts,
  );
  assert.deepEqual([...new Set(ledger.sourceNodes.map((node) => node.sourceGroup))], expectedGroupNames);
  assert.deepEqual(
    expectedGroupNames.map((groupName) => ledger.sourceNodes.filter((node) => node.sourceGroup === groupName).length),
    expectedGroupNodeCounts,
  );
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceGroupPosition),
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 7, 7],
  );

  assert.deepEqual(
    ledger.occurrences.map((occurrence) => occurrence.sourcePosition),
    Array.from({ length: ledger.sourceOccurrenceCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.occurrences.map((occurrence) => occurrence.classification).every((classification) => expectedAllowedClassifications.has(classification)),
    true,
  );
  assert.deepEqual(
    ledger.occurrences.reduce((counts, occurrence) => {
      counts[occurrence.classification] = (counts[occurrence.classification] ?? 0) + 1;
      return counts;
    }, {
      'provisional-canonical-candidate': 0,
      'true-repeat': 0,
      'unresolved-included-identity-gap': 0,
      'semantic-exclusion': 0,
    }),
    expectedCategoryCounts,
  );
  assert.deepEqual(
    ledger.occurrences.map((occurrence) => occurrence.classification).slice(0, 6),
    ['semantic-exclusion', 'semantic-exclusion', 'semantic-exclusion', 'provisional-canonical-candidate', 'semantic-exclusion', 'semantic-exclusion'],
  );
  assert.deepEqual(
    ledger.occurrences.map((occurrence) => occurrence.sourceNode).every((sourceNode) => sourceNode >= 1 && sourceNode <= 25),
    true,
  );
  for (const node of ledger.sourceNodes) {
    assert.deepEqual(
      node.occurrences.map((occurrence) => occurrence.sourceNode),
      Array.from({ length: node.occurrences.length }, () => node.sourceNode),
    );
  }
  assert.deepEqual(
    ledger.sourceNodes
      .flatMap((node) => node.occurrences)
      .sort((left, right) => left.sourcePosition - right.sourcePosition)
      .map(occurrenceDigest),
    ledger.occurrences.map(occurrenceDigest),
  );

  for (const occurrence of ledger.occurrences) {
    if (occurrence.classification !== 'semantic-exclusion') {
      assert.equal(typeof occurrence.normalizedSeriesTitle === 'string' && occurrence.normalizedSeriesTitle.trim().length > 0, true);
      assert.equal(occurrence.sourceType === 'named-work' || /^\d+$/.test(String(occurrence.issueNumber ?? '')), true);
    } else {
      assert.equal(occurrence.classification, 'semantic-exclusion');
    }

    if (occurrence.sourceType === 'partial-material') {
      assert.equal(occurrence.classification, 'semantic-exclusion');
    }
  }

  const byPosition = new Map(ledger.occurrences.map((occurrence) => [occurrence.sourcePosition, occurrence]));
  for (const occurrence of ledger.occurrences) {
    if (occurrence.classification !== 'true-repeat') {
      continue;
    }

    assert.equal(typeof occurrence.repeatOf, 'number');
    assert.equal(occurrence.repeatOf < occurrence.sourcePosition, true);
    const canonical = byPosition.get(occurrence.repeatOf);
    assert.ok(canonical);
    assert.equal(canonical.classification, 'provisional-canonical-candidate');
    assert.equal(occurrence.normalizedSeriesTitle, canonical.normalizedSeriesTitle);
    assert.equal(String(occurrence.seriesYear ?? ''), String(canonical.seriesYear ?? ''));
    assert.equal(String(occurrence.issueNumber ?? ''), String(canonical.issueNumber ?? ''));
  }
}

test('Nick Fury source ledger preserves the frozen source boundary and order', async () => {
  const ledger = await readLedger();
  const inventory = await readInventory();
  const inventoryRecord = inventory.find((entry) => entry.url === ledger.sourceUrl);

  assert.ok(inventoryRecord);
  assert.equal(inventoryRecord.title, 'Nick Fury');
  assert.equal(inventoryRecord.url, ledger.sourceUrl);
  validateLedger(ledger);
});

test('Nick Fury source ledger rejects structural mutations', async () => {
  const ledger = await readLedger();

  const cases = [
    ['truncation', (draft) => { draft.sourceNodes.pop(); }],
    ['whole-node omission', (draft) => { draft.sourceNodes.splice(6, 1); }],
    ['category reordering', (draft) => {
      draft.occurrences.sort((left, right) => (
        left.classification.localeCompare(right.classification)
        || left.sourcePosition - right.sourcePosition
      ));
    }],
    ['duplicate positions', (draft) => {
      draft.occurrences[draft.occurrences.length - 1].sourcePosition = draft.occurrences[draft.occurrences.length - 2].sourcePosition;
    }],
    ['dropped range member', (draft) => {
      draft.occurrences = draft.occurrences.filter((occurrence) => !(occurrence.sourceNode === 7 && occurrence.sourcePosition === 8));
    }],
    ['unexpanded range-valued issue number', (draft) => {
      draft.occurrences[6].issueNumber = '1-22';
    }],
    ['issue-bearing prose', (draft) => {
      draft.occurrences[0].classification = 'provisional-canonical-candidate';
    }],
    ['title-only repeat collision', (draft) => {
      const index = draft.occurrences.findIndex((occurrence) => occurrence.classification === 'true-repeat');
      draft.occurrences[index].normalizedSeriesTitle = 'Sgt Fury';
    }],
    ['inherited identity loss', (draft) => {
      draft.occurrences[3].normalizedSeriesTitle = null;
    }],
    ['deleted repeat pointer', (draft) => {
      const index = draft.occurrences.findIndex((occurrence) => occurrence.classification === 'true-repeat');
      draft.occurrences[index].repeatOf = 999;
    }],
    ['blank gap', (draft) => {
      draft.occurrences[3].classification = 'unresolved-included-identity-gap';
    }],
    ['mixed partial material', (draft) => {
      draft.occurrences[251].classification = 'provisional-canonical-candidate';
    }],
    ['named-work as gap', (draft) => {
      draft.occurrences[84].classification = 'unresolved-included-identity-gap';
    }],
  ];

  for (const [, mutate] of cases) {
    const draft = structuredClone(ledger);
    mutate(draft);
    assert.throws(() => validateLedger(draft));
  }

  for (const classification of ['provisional-canonical-candidate', 'true-repeat', 'semantic-exclusion']) {
    const draft = structuredClone(ledger);
    const index = draft.occurrences.findIndex((occurrence) => occurrence.classification === classification);
    draft.occurrences.splice(index, 1);
    assert.throws(() => validateLedger(draft));
  }
});
