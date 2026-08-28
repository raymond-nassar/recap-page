import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'inhumans-reading-order.json');
const missingLedgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'inhumans-reading-order.missing.json');

const expected = {
  schemaVersion: 1,
  id: 'inhumans-reading-order',
  inventoryId: 'inhumans-reading-order',
  sourceUrl: 'https://www.comicbookherald.com/inhumans-reading-order/',
  sourcePageTitle: 'Inhumans Reading Order: Black Bolt, Medusa, and Maximus the Mad!',
  sourceRetrievedAt: '2026-08-27',
  sourceProvider: 'comic-book-herald',
  sourceBoundary: {
    status: 'exact-page-snapshot',
    scope: 'full page',
    qualifyingSection: null,
    pageTitle: 'Inhumans Reading Order: Black Bolt, Medusa, and Maximus the Mad!',
    canonicalUrl: 'https://www.comicbookherald.com/inhumans-reading-order/',
    firstHeading: 'I) The Origins of the Inhumans',
    lastHeading: 'Latest Additions:',
    issueBearingBlockCount: 40,
    reason: 'The page has no qualifying Best Comics or Essential Comics section, so the full article is the permitted boundary.',
    contrarianCheck: 'A page scan found no qualifying Best Comics or Essential Comics section; incidental best/essential wording in prose does not create one.',
  },
  sourceNodeCount: 120,
  provenanceGroupCount: 8,
  sourceOccurrenceCount: 354,
  issueBearingBlockCount: 40,
  sourceNodePositions: range(1, 120),
  issueBearingNodePositions: [6, 8, 12, 18, 21, 25, 28, 33, 36, 40, 43, 48, 52, 55, 58, 62, 68, 71, 74, 77, 82, 85, 86, 87, 88, 89, 90, 95, 97, 99, 101, 103, 105, 107, 109, 111, 113, 115, 117, 119],
  groupHeadings: [
    'Prelude',
    'I) The Origins of the Inhumans',
    'II) Marvel Knights Inhumans for the 2000’s',
    'III) Inhumans and the Marvel Era of Events',
    'IV) Inhumans… In Space! Cosmic Attilan',
    'V) Infinity, Inhumanity, and All-New Inhuman',
    'VI) All-New All-Different Inhumans',
    'Latest Additions:',
  ],
  groupBlockPositions: [
    range(1, 2),
    range(3, 14),
    range(15, 29),
    range(30, 44),
    range(45, 63),
    range(64, 82),
    range(83, 92),
    range(93, 120),
  ],
  groupSizes: [2, 12, 15, 15, 19, 19, 10, 28],
  dispositionCounts: {
    'canonical-candidate': 267,
    repeat: 4,
    gap: 0,
    exclusion: 83,
  },
  sourceTypeCounts: {
    issue: 268,
    collection: 35,
    prose: 27,
    'formatting-marker': 11,
    h2: 7,
    'issue-title': 3,
    'partial-material': 3,
  },
  exclusionReasonCounts: {
    'collection marker': 33,
    'formatting marker': 11,
    'guide link': 2,
    'partial material reference': 3,
    'prose marker': 27,
    'section marker': 7,
  },
  repeatPositions: [34, 35, 36, 329],
  repeatOfPositions: [14, 15, 16, 262],
  titleOnlyCandidatePositions: [87, 289],
  issueTitleRows: [
    { position: 87, sourceIssueReference: 'Inhumans 2099 One-Shot', issueNumber: null, provisionalDisposition: 'canonical-candidate' },
    { position: 280, sourceIssueReference: 'Inhumans Prime #1', issueNumber: '1', provisionalDisposition: 'canonical-candidate' },
    { position: 289, sourceIssueReference: 'Inhumans: Judgement Day', issueNumber: null, provisionalDisposition: 'canonical-candidate' },
  ],
  partialMaterialPositions: [22, 23, 24],
  partialMaterialSourceTexts: ['#48', '#50', '#52'],
  node6IssueNumbers: ['36', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '62', '63', '64', '65', '5', '48', '50', '52', '54', '55', '56', '57', '58', '59', '60', '61'],
  node18IssueNumbers: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  node113IssueNumbers: ['6', '7', '8', '11'],
};

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

async function readLedger(filePath = ledgerPath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function projectOccurrence(occurrence) {
  return {
    position: occurrence.position,
    sourceType: occurrence.sourceType,
    sourceText: occurrence.sourceText,
    sourceIssueReference: occurrence.sourceIssueReference,
    sourceRangeReference: occurrence.sourceRangeReference,
    collectionTitle: occurrence.collectionTitle ?? null,
    normalizedSeriesTitle: occurrence.normalizedSeriesTitle ?? null,
    seriesYear: occurrence.seriesYear ?? null,
    issueNumber: occurrence.issueNumber ?? null,
    provisionalDisposition: occurrence.provisionalDisposition,
    reason: occurrence.reason ?? null,
    repeatOfPosition: occurrence.repeatOfPosition ?? null,
  };
}

function sourceOccurrences(ledger) {
  return ledger.sourceNodes.flatMap((node) => node.occurrences.map(projectOccurrence));
}

function issueOccurrences(ledger) {
  return ledger.issueOccurrences.map(projectOccurrence);
}

function sourceOccurrenceByPosition(ledger, position) {
  for (const node of ledger.sourceNodes) {
    const occurrence = node.occurrences.find((entry) => entry.position === position);
    if (occurrence) {
      return { node, occurrence };
    }
  }
  return null;
}

function sourceNodeByIndex(ledger, sourceNodeIndex) {
  return ledger.sourceNodes.find((node) => node.sourceNodeIndex === sourceNodeIndex) ?? null;
}

function mutateOccurrence(ledger, position, mutator) {
  const flat = ledger.issueOccurrences.find((entry) => entry.position === position);
  const nested = sourceOccurrenceByPosition(ledger, position);
  assert.ok(flat, `missing flat occurrence ${position}`);
  assert.ok(nested, `missing nested occurrence ${position}`);
  mutator(flat, nested.node, nested.occurrence);
}

function removeOccurrence(ledger, position) {
  const flatIndex = ledger.issueOccurrences.findIndex((entry) => entry.position === position);
  assert.notEqual(flatIndex, -1, `missing flat occurrence ${position}`);
  ledger.issueOccurrences.splice(flatIndex, 1);

  for (const node of ledger.sourceNodes) {
    const nestedIndex = node.occurrences.findIndex((entry) => entry.position === position);
    if (nestedIndex !== -1) {
      node.occurrences.splice(nestedIndex, 1);
      return;
    }
  }

  assert.fail(`missing nested occurrence ${position}`);
}

function assertLedgerShape(ledger) {
  assert.equal(ledger.schemaVersion, expected.schemaVersion);
  assert.equal(ledger.id, expected.id);
  assert.equal(ledger.inventoryId, expected.inventoryId);
  assert.equal(ledger.sourceUrl, expected.sourceUrl);
  assert.equal(ledger.sourcePageTitle, expected.sourcePageTitle);
  assert.equal(ledger.sourceRetrievedAt, expected.sourceRetrievedAt);
  assert.equal(ledger.sourceProvider, expected.sourceProvider);
  assert.deepEqual(ledger.sourceBoundary, {
    ...expected.sourceBoundary,
    contentSha256: ledger.sourceBoundary.contentSha256,
    issueBearingBlocksSha256: ledger.sourceBoundary.issueBearingBlocksSha256,
  });
  assert.equal(ledger.sourceBoundary.contentSha256.length, 64);
  assert.equal(ledger.sourceBoundary.issueBearingBlocksSha256.length, 64);
  assert.equal(ledger.sourceBoundary.scope, expected.sourceBoundary.scope);
  assert.equal(ledger.sourceBoundary.qualifyingSection, expected.sourceBoundary.qualifyingSection);
  assert.equal(ledger.sourceBoundary.pageTitle, expected.sourceBoundary.pageTitle);
  assert.equal(ledger.sourceBoundary.canonicalUrl, expected.sourceBoundary.canonicalUrl);
  assert.equal(ledger.sourceBoundary.firstHeading, expected.sourceBoundary.firstHeading);
  assert.equal(ledger.sourceBoundary.lastHeading, expected.sourceBoundary.lastHeading);
  assert.equal(ledger.sourceBoundary.reason, expected.sourceBoundary.reason);
  assert.equal(ledger.sourceBoundary.contrarianCheck, expected.sourceBoundary.contrarianCheck);
  assert.equal(ledger.sourceBoundaryDigest, digest(ledger.sourceBoundary));

  assert.equal(ledger.sourceNodeCount, expected.sourceNodeCount);
  assert.equal(ledger.provenanceGroupCount, expected.provenanceGroupCount);
  assert.equal(ledger.sourceOccurrenceCount, expected.sourceOccurrenceCount);
  assert.equal(ledger.sourceNodes.length, expected.sourceNodeCount);
  assert.equal(ledger.provenanceGroups.length, expected.provenanceGroupCount);
  assert.equal(ledger.issueOccurrences.length, expected.sourceOccurrenceCount);

  assert.deepEqual(ledger.sourceNodes.map((node) => node.sourceNodeIndex), expected.sourceNodePositions);
  assert.deepEqual(
    ledger.sourceNodes.reduce((counts, node) => {
      counts[node.tag] = (counts[node.tag] || 0) + 1;
      return counts;
    }, {}),
    { P: 107, H2: 8, DIV: 5 },
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.sourceGroupPosition),
    range(1, expected.provenanceGroupCount),
  );
  assert.deepEqual(ledger.provenanceGroups.map((group) => group.heading), expected.groupHeadings);
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.blocks.map((block) => block.sourceNodeIndex)),
    expected.groupBlockPositions,
  );
  assert.deepEqual(ledger.provenanceGroups.map((group) => group.blocks.length), expected.groupSizes);

  const issueBearingNodes = ledger.sourceNodes.filter((node) => node.occurrences.some((entry) => entry.provisionalDisposition !== 'exclusion'));
  assert.equal(issueBearingNodes.length, expected.issueBearingBlockCount);
  assert.deepEqual(issueBearingNodes.map((node) => node.sourceNodeIndex), expected.issueBearingNodePositions);
  assert.equal(ledger.sourceBoundary.issueBearingBlockCount, issueBearingNodes.length);
  assert.equal(
    ledger.sourceBoundary.issueBearingBlocksSha256,
    'a486e455526a6da4dfc9a721ebbf6837f69049f5eb7bc213944dc13923c0eb10',
  );
  assert.equal(
    ledger.sourceBoundary.contentSha256,
    'cd2223a2f58ef03cb7d221e769285b8188790e5f19229ba912710bb225691f9f',
  );

  const flatProjection = issueOccurrences(ledger);
  const nestedProjection = sourceOccurrences(ledger);
  assert.deepEqual(flatProjection, nestedProjection);
  assert.deepEqual(flatProjection.map((occurrence) => occurrence.position), range(1, expected.sourceOccurrenceCount));
  assert.equal(new Set(flatProjection.map((occurrence) => occurrence.position)).size, expected.sourceOccurrenceCount);
  assert.equal(flatProjection.some((occurrence) => occurrence.provisionalDisposition === 'gap'), false);

  const dispositionCounts = flatProjection.reduce((counts, occurrence) => {
    counts[occurrence.provisionalDisposition] = (counts[occurrence.provisionalDisposition] || 0) + 1;
    return counts;
  }, { 'canonical-candidate': 0, repeat: 0, gap: 0, exclusion: 0 });
  assert.deepEqual(ledger.categoryCounts, expected.dispositionCounts);
  assert.deepEqual(dispositionCounts, expected.dispositionCounts);
  assert.deepEqual(ledger.categoryPositions, {
    'canonical-candidate': flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate').map((occurrence) => occurrence.position),
    repeat: flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'repeat').map((occurrence) => occurrence.position),
    gap: [],
    exclusion: flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'exclusion').map((occurrence) => occurrence.position),
  });
  assert.deepEqual(ledger.categoryPositions.repeat, expected.repeatPositions);
  assert.deepEqual(ledger.categoryPositions.gap, []);
  assert.equal(ledger.categoryPositions.exclusion.length, 83);
  const exclusionPositions = flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'exclusion').reduce((categories, occurrence) => {
    if (!categories[occurrence.reason]) {
      categories[occurrence.reason] = [];
    }
    categories[occurrence.reason].push(occurrence.position);
    return categories;
  }, {});
  assert.deepEqual(ledger.exclusionCategories, exclusionPositions);
  assert.deepEqual(
    Object.fromEntries(Object.entries(ledger.exclusionCategories).map(([reason, positions]) => [reason, positions.length])),
    expected.exclusionReasonCounts,
  );

  assert.deepEqual(
    flatProjection.reduce((counts, occurrence) => {
      counts[occurrence.sourceType] = (counts[occurrence.sourceType] || 0) + 1;
      return counts;
    }, {}),
    expected.sourceTypeCounts,
  );
  assert.equal(
    flatProjection.every((occurrence) => ['prose', 'h2', 'formatting-marker', 'collection'].includes(occurrence.sourceType)
      ? occurrence.provisionalDisposition === 'exclusion'
      : true),
    true,
  );
  assert.equal(
    flatProjection.filter((occurrence) => occurrence.sourceType === 'issue-title').every((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate'),
    true,
  );
  assert.equal(
    flatProjection.filter((occurrence) => occurrence.sourceType === 'issue-title').length,
    expected.issueTitleRows.length,
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.sourceType === 'issue-title').map((occurrence) => ({
      position: occurrence.position,
      sourceIssueReference: occurrence.sourceIssueReference,
      issueNumber: occurrence.issueNumber,
      provisionalDisposition: occurrence.provisionalDisposition,
    })),
    expected.issueTitleRows,
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.sourceType === 'issue-title' && occurrence.issueNumber == null).map((occurrence) => occurrence.position),
    expected.titleOnlyCandidatePositions,
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.position === 354).map((occurrence) => ({
      sourceType: occurrence.sourceType,
      sourceText: occurrence.sourceText,
      sourceIssueReference: occurrence.sourceIssueReference,
      provisionalDisposition: occurrence.provisionalDisposition,
      reason: occurrence.reason,
    })),
    [{
      sourceType: 'collection',
      sourceText: 'The Darkhold: Black Bolt',
      sourceIssueReference: null,
      provisionalDisposition: 'exclusion',
      reason: 'collection marker',
    }],
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'repeat').map((occurrence) => occurrence.position),
    expected.repeatPositions,
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'repeat').map((occurrence) => occurrence.repeatOfPosition),
    expected.repeatOfPositions,
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'repeat').map((occurrence) => ({
      sourceIssueReference: occurrence.sourceIssueReference,
      normalizedSeriesTitle: occurrence.normalizedSeriesTitle,
      issueNumber: occurrence.issueNumber,
      repeatOfPosition: occurrence.repeatOfPosition,
    })),
    [
      { sourceIssueReference: 'Fantastic Four #45', normalizedSeriesTitle: 'Fantastic Four', issueNumber: '45', repeatOfPosition: 14 },
      { sourceIssueReference: 'Fantastic Four #46', normalizedSeriesTitle: 'Fantastic Four', issueNumber: '46', repeatOfPosition: 15 },
      { sourceIssueReference: 'Fantastic Four #47', normalizedSeriesTitle: 'Fantastic Four', issueNumber: '47', repeatOfPosition: 16 },
      { sourceIssueReference: 'Uncanny Inhumans #11', normalizedSeriesTitle: 'Uncanny Inhumans', issueNumber: '11', repeatOfPosition: 262 },
    ],
  );
  assert.deepEqual(flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'exclusion' && occurrence.reason === 'partial material reference').map((occurrence) => occurrence.position), expected.partialMaterialPositions);
  assert.deepEqual(flatProjection.filter((occurrence) => occurrence.provisionalDisposition === 'exclusion' && occurrence.reason === 'partial material reference').map((occurrence) => occurrence.sourceText), expected.partialMaterialSourceTexts);
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.position === 266).map((occurrence) => ({
      sourceText: occurrence.sourceText,
      sourceIssueReference: occurrence.sourceIssueReference,
      normalizedSeriesTitle: occurrence.normalizedSeriesTitle,
      issueNumber: occurrence.issueNumber,
      provisionalDisposition: occurrence.provisionalDisposition,
    })),
    [{
      sourceText: 'Annual #1',
      sourceIssueReference: 'Uncanny Inhumans Annual #1',
      normalizedSeriesTitle: 'Uncanny Inhumans Annual',
      issueNumber: '1',
      provisionalDisposition: 'canonical-candidate',
    }],
  );
  assert.deepEqual(
    flatProjection.filter((occurrence) => occurrence.position === 53).map((occurrence) => occurrence.sourceText),
    ['#2'],
  );
  assert.deepEqual(
    sourceNodeByIndex(ledger, 6).occurrences.map((occurrence) => occurrence.position),
    range(6, 32),
  );
  assert.deepEqual(
    sourceNodeByIndex(ledger, 6).occurrences.map((occurrence) => occurrence.sourceText),
    ['#36', '#38', '#39', '#40', '#41', '#42', '#43', '#44', '#45', '#46', '#47', '#62', '#63', '#64', '#65', 'Fantastic Four Annual #5', '#48', '#50', '#52', '#54', '#55', '#56', '#57', '#58', '#59', '#60', '#61'],
  );
  assert.deepEqual(sourceNodeByIndex(ledger, 18).occurrences.map((occurrence) => occurrence.issueNumber), expected.node18IssueNumbers);
  assert.deepEqual(sourceNodeByIndex(ledger, 113).occurrences.map((occurrence) => occurrence.issueNumber), expected.node113IssueNumbers);
  assert.equal(sourceNodeByIndex(ledger, 113).occurrences.at(-1).provisionalDisposition, 'repeat');
  assert.equal(sourceNodeByIndex(ledger, 113).occurrences.at(-1).repeatOfPosition, 262);
  assert.equal(sourceNodeByIndex(ledger, 120).occurrences.length, 1);
}

function expectLedgerFailure(ledger, mutate) {
  assert.throws(() => {
    const draft = structuredClone(ledger);
    mutate(draft);
    assertLedgerShape(draft);
  });
}

test('the Inhumans source ledger preserves the frozen boundary and order', async () => {
  const ledger = await readLedger();
  assertLedgerShape(ledger);
});

test('the Inhumans source ledger rejects the contrarian mutations', async () => {
  await assert.rejects(() => readLedger(missingLedgerPath));

  const ledger = await readLedger();
  assertLedgerShape(ledger);

  expectLedgerFailure(ledger, (draft) => {
    draft.issueOccurrences.pop();
    draft.sourceOccurrenceCount -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    removeOccurrence(draft, 280);
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.issueOccurrences.sort((left, right) => left.sourceIssueReference.localeCompare(right.sourceIssueReference));
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 354, (flat, node, nested) => {
      flat.provisionalDisposition = 'canonical-candidate';
      nested.provisionalDisposition = 'canonical-candidate';
      flat.sourceType = 'issue-title';
      nested.sourceType = 'issue-title';
      flat.normalizedSeriesTitle = 'The Darkhold: Black Bolt';
      nested.normalizedSeriesTitle = 'The Darkhold: Black Bolt';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 87, (flat, node, nested) => {
      delete flat.position;
      delete nested.position;
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    delete draft.categoryCounts.exclusion;
    delete draft.categoryPositions.exclusion;
  });

  expectLedgerFailure(ledger, (draft) => {
    removeOccurrence(draft, 57);
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 1, (flat, node, nested) => {
      flat.provisionalDisposition = 'canonical-candidate';
      nested.provisionalDisposition = 'canonical-candidate';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 329, (flat, node, nested) => {
      flat.provisionalDisposition = 'canonical-candidate';
      nested.provisionalDisposition = 'canonical-candidate';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 87, (flat, node, nested) => {
      flat.provisionalDisposition = 'exclusion';
      nested.provisionalDisposition = 'exclusion';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 34, (flat, node, nested) => {
      delete flat.repeatOfPosition;
      delete nested.repeatOfPosition;
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 1, (flat, node, nested) => {
      flat.provisionalDisposition = 'gap';
      nested.provisionalDisposition = 'gap';
      flat.sourceType = 'issue';
      nested.sourceType = 'issue';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 22, (flat, node, nested) => {
      flat.provisionalDisposition = 'canonical-candidate';
      nested.provisionalDisposition = 'canonical-candidate';
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    mutateOccurrence(draft, 87, (flat, node, nested) => {
      flat.provisionalDisposition = 'gap';
      nested.provisionalDisposition = 'gap';
    });
  });
});
