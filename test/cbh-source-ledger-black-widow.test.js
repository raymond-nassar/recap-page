import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'black-widow-reading-order.json');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-character-inventory.json');

const expectedCategoryCounts = {
  'provisional-canonical-candidate': 567,
  'semantic-exclusion': 186,
  'true-repeat': 20,
  'unresolved-included-identity-gap': 0,
};

const expectedNodeCounts = new Map([
  [19, 8],
  [49, 1],
  [10, 1],
  [54, 10],
  [56, 4],
  [72, 1],
  [74, 18],
  [82, 3],
  [83, 1],
  [87, 1],
  [95, 18],
  [98, 17],
  [101, 8],
  [105, 10],
  [61, 9],
  [123, 6],
  [132, 1],
  [145, 3],
  [150, 1],
  [164, 13],
  [177, 7],
]);

const namedComicsWithoutSourceIssueNumbers = new Map([
  [226, { title: 'Daredevil: Love and War', year: 1986, issueNumber: '0' }],
  [318, { title: 'Avengers: Deathtrap - The Vault', year: 1991, issueNumber: '1' }],
  [441, { title: 'Captain America: The Legend', year: 1996 }],
  [453, { title: 'Onslaught: X-Men', year: 1996, issueNumber: '1' }],
  [466, { title: 'Thunderbolts Annual', year: 1997 }],
  [699, { title: 'Infinity Countdown Prime', year: 2018, issueNumber: '1' }],
]);

const sourceNumberingDistinctFromProviderCanonicalNumbering = {
  sourcePosition: 298,
  sourceIssueReference: 'Black Widow: The Coldest War Marvel OGN #61',
  sourceIssueNumber: '61',
};

const settledAvailabilityExclusions = new Map([
  [315, {
    sourceIssueReference: 'Namor The Sub-Mariner Annual #1',
    sourceRangeReference: 'Namor The Sub-Mariner Annual (1991) #1',
    issueNumber: '1',
  }],
  [441, {
    sourceIssueReference: 'Captain America: The Legend (1996)',
    sourceRangeReference: undefined,
    issueNumber: null,
  }],
  [462, {
    sourceIssueReference: 'Thunderbolts #-1',
    sourceRangeReference: 'Collects: Thunderbolts (1997) #1-5 & -1',
    issueNumber: '-1',
  }],
]);

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readLedger() {
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

async function readInventory() {
  return JSON.parse(await readFile(inventoryPath, 'utf8'));
}

function validateLedger(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'black-widow-reading-order');
  assert.equal(ledger.inventoryId, 'black-widow-reading-order');
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/black-widow-reading-order/');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-23');
  assert.equal(ledger.sourceProvider, 'comic-book-herald');
  assert.equal(ledger.sourceContentSha256, 'd038b80551132f73436c6fe32608d1d7005c4319f9e94d536c9ffb3bd29f193e');
  assert.equal(
    ledger.sourceIssueBearingBlocksSha256,
    '61e9c2bd0929a4b80dfb75e028faeca96505d00907d1af5567d7a27ced1d1de2',
  );
  assert.match(ledger.sourceBoundary, /complete CBH Black Widow page/i);
  assert.match(ledger.sourceBoundary, /full page/i);
  assert.match(ledger.sourceBoundary, /no qualifying Best Comics or Essential Comics subsection/i);

  assert.equal(ledger.sourceNodeCount, 209);
  assert.equal(ledger.provenanceGroupCount, 8);
  assert.equal(ledger.issueBearingBlockCount, 76);
  assert.equal(ledger.sourceOccurrenceCount, ledger.occurrences.length);

  assert.deepEqual(ledger.categoryCounts, expectedCategoryCounts);
  const derivedCounts = ledger.occurrences.reduce((acc, entry) => {
    acc[entry.disposition] = (acc[entry.disposition] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(
    {
      'provisional-canonical-candidate': derivedCounts['provisional-canonical-candidate'] ?? 0,
      'true-repeat': derivedCounts['true-repeat'] ?? 0,
      'unresolved-included-identity-gap': derivedCounts['unresolved-included-identity-gap'] ?? 0,
      'semantic-exclusion': derivedCounts['semantic-exclusion'] ?? 0,
    },
    expectedCategoryCounts,
  );
  assert.equal(
    derivedCounts['provisional-canonical-candidate']
      + (derivedCounts['unresolved-included-identity-gap'] ?? 0)
      + derivedCounts['semantic-exclusion']
      + derivedCounts['true-repeat'],
    ledger.sourceOccurrenceCount,
  );

  assert.equal(ledger.occurrences.length, 773);
  assert.equal(ledger.occurrences[0].sourcePosition, 1);
  assert.equal(ledger.occurrences[ledger.occurrences.length - 1].sourcePosition, 773);

  const positions = ledger.occurrences.map((entry) => entry.sourcePosition);
  assert.deepEqual(positions, range(1, ledger.sourceOccurrenceCount));
  assert.equal(new Set(positions).size, ledger.sourceOccurrenceCount);

  const sourceNodes = ledger.occurrences.map((entry) => entry.sourceNode);
  assert.equal(new Set(sourceNodes).size, ledger.sourceNodeCount);
  assert.deepEqual(
    [...new Set(sourceNodes)],
    range(1, ledger.sourceNodeCount),
  );

  for (const [sourceNode, expectedCount] of expectedNodeCounts.entries()) {
    assert.equal(
      ledger.occurrences.filter((entry) => entry.sourceNode === sourceNode).length,
      expectedCount,
      `source node ${sourceNode} count`,
    );
  }

  const grouped = new Map();
  const seenIdentities = new Set();
  for (const entry of ledger.occurrences) {
    assert.equal(typeof entry.sourceIssueReference, 'string');
    assert.equal(entry.sourceIssueReference.length > 0, true);
    assert.equal(typeof entry.sourceNode, 'number');
    assert.equal(typeof entry.sourceGroup, 'string');
    assert.equal(typeof entry.disposition, 'string');

    if (entry.disposition !== 'semantic-exclusion') {
      assert.equal(
        typeof entry.normalizedSeriesTitle === 'string' && entry.normalizedSeriesTitle.trim().length > 0,
        true,
        `included source row ${entry.sourcePosition} must retain its inherited series identity`,
      );
      assert.equal(
        /^\d{4}$/.test(String(entry.issueNumber ?? '')),
        false,
        `included source row ${entry.sourcePosition} must not store a publication year as its issue number`,
      );
      const identity = [
        entry.normalizedSeriesTitle,
        entry.seriesYear,
        entry.issueNumber,
      ].join('|');
      if (entry.disposition === 'true-repeat') {
        assert.equal(seenIdentities.has(identity), true, `repeat identity must match an earlier canonical row: ${identity}`);
      } else {
        assert.equal(seenIdentities.has(identity), false, `duplicate canonical identity ${identity}`);
        seenIdentities.add(identity);
      }
    }
    if (/\bmaterial from\b/i.test(String(entry.sourceRangeReference ?? ''))) {
      assert.equal(
        entry.disposition,
        'semantic-exclusion',
        `partial-material source row ${entry.sourcePosition} must stay excluded`,
      );
    }

    const group = grouped.get(entry.sourceNode) ?? [];
    group.push(entry);
    grouped.set(entry.sourceNode, group);
  }

  for (const [node, items] of grouped.entries()) {
    const localPositions = items.map((entry) => entry.sourceBlockPosition);
    assert.deepEqual(localPositions, range(1, items.length), `sourceBlockPosition sequence for node ${node}`);
  }

  for (const [sourcePosition, expected] of namedComicsWithoutSourceIssueNumbers.entries()) {
    const entry = ledger.occurrences.find((candidate) => candidate.sourcePosition === sourcePosition);
    assert.equal(entry?.normalizedSeriesTitle, expected.title, `named comic at source position ${sourcePosition}`);
    assert.equal(entry?.seriesYear, expected.year, `named comic year at source position ${sourcePosition}`);
    assert.equal(
      entry?.issueNumber,
      expected.issueNumber ?? null,
      `named comic at source position ${sourcePosition} canonical issue number`,
    );
  }

  const coldestWar = ledger.occurrences.find(
    (entry) => entry.sourcePosition === sourceNumberingDistinctFromProviderCanonicalNumbering.sourcePosition,
  );
  assert.equal(coldestWar?.sourceIssueReference, sourceNumberingDistinctFromProviderCanonicalNumbering.sourceIssueReference);
  assert.equal(coldestWar?.issueNumber, sourceNumberingDistinctFromProviderCanonicalNumbering.sourceIssueNumber);
  assert.equal(Object.hasOwn(coldestWar ?? {}, 'metadataIssueNumber'), false);

  const node10 = ledger.occurrences.filter((entry) => entry.sourceNode === 10);
  assert.equal(node10.filter((entry) => entry.disposition === 'true-repeat').length, 1);
  assert.equal(node10.some((entry) => entry.sourceIssueReference === 'Amazing Spider-Man #86'), true);

  const node54 = ledger.occurrences.filter((entry) => entry.sourceNode === 54);
  assert.equal(node54.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 10);
  assert.equal(node54.some((entry) => entry.sourceIssueReference === 'Daredevil: Love and War (1986)'), true);

  const node74 = ledger.occurrences.filter((entry) => entry.sourceNode === 74);
  assert.equal(node74.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 16);
  assert.equal(node74.filter((entry) => entry.disposition === 'semantic-exclusion').length, 2);
  assert.equal(node74.some((entry) => entry.sourceIssueReference === 'Avengers: Deathtrap ? The Vault (1991)'), true);

  const node95 = ledger.occurrences.filter((entry) => entry.sourceNode === 95);
  assert.equal(node95.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 16);
  assert.equal(node95.filter((entry) => entry.disposition === 'semantic-exclusion').length, 2);
  assert.equal(node95.some((entry) => entry.sourceIssueReference === 'Ashcan Edition'), true);

  const node98 = ledger.occurrences.filter((entry) => entry.sourceNode === 98);
  assert.equal(node98.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 14);
  assert.equal(node98.filter((entry) => entry.disposition === 'semantic-exclusion').length, 3);
  assert.equal(node98.some((entry) => entry.sourceIssueReference === 'Captain America: The Legend (1996)'), true);

  const node101 = ledger.occurrences.filter((entry) => entry.sourceNode === 101);
  assert.equal(node101.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 8);
  assert.equal(node101.some((entry) => entry.sourceIssueReference === 'Onslaught: X-Men (1996)'), true);

  const node105 = ledger.occurrences.filter((entry) => entry.sourceNode === 105);
  assert.equal(node105.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 9);
  assert.equal(node105.filter((entry) => entry.disposition === 'semantic-exclusion').length, 1);
  assert.equal(node105.some((entry) => entry.sourceIssueReference === 'Thunderbolts Annual ?97'), true);

  for (const [sourcePosition, expected] of settledAvailabilityExclusions) {
    const entry = ledger.occurrences.find((candidate) => candidate.sourcePosition === sourcePosition);
    assert.equal(entry?.disposition, 'semantic-exclusion');
    assert.equal(entry?.sourceIssueReference, expected.sourceIssueReference);
    assert.equal(entry?.sourceRangeReference, expected.sourceRangeReference);
    assert.equal(entry?.issueNumber, expected.issueNumber);
    assert.equal(entry?.decisionScope, 'Owner-authorized Marvel Unlimited exclusion');
    assert.match(entry?.reason ?? '', /Marvel Unlimited/i);
  }

  const node126 = ledger.occurrences.filter((entry) => entry.sourceNode === 126);
  assert.equal(node126.every((entry) => entry.normalizedSeriesTitle === 'Daredevil' && entry.seriesYear === 1998), true);
  assert.equal(node126.every((entry) => entry.disposition === 'provisional-canonical-candidate'), true);

  const node131 = ledger.occurrences.filter((entry) => entry.sourceNode === 131);
  assert.equal(node131.every((entry) => entry.normalizedSeriesTitle === 'New Avengers' && entry.seriesYear === 2004), true);
  assert.equal(node131.every((entry) => entry.disposition === 'provisional-canonical-candidate'), true);

  const node134 = ledger.occurrences.filter((entry) => entry.sourceNode === 134);
  assert.equal(node134.every((entry) => entry.normalizedSeriesTitle === 'Black Widow' && entry.seriesYear === 2004), true);
  assert.equal(node134.filter((entry) => entry.disposition === 'true-repeat').length, 5);
  assert.equal(node134.some((entry) => entry.issueNumber === '6' && entry.disposition === 'provisional-canonical-candidate'), true);

  const node136 = ledger.occurrences.filter((entry) => entry.sourceNode === 136);
  assert.equal(node136.every((entry) => entry.normalizedSeriesTitle === 'Mighty Avengers' && entry.seriesYear === 2007), true);
  assert.equal(node136.every((entry) => entry.disposition === 'provisional-canonical-candidate'), true);

  const node139 = ledger.occurrences.filter((entry) => entry.sourceNode === 139);
  assert.equal(node139.every((entry) => entry.normalizedSeriesTitle === 'Black Widow & the Marvel Girls' && entry.seriesYear === 2009), true);
  assert.equal(node139.every((entry) => entry.disposition === 'provisional-canonical-candidate'), true);

  const node142 = ledger.occurrences.filter((entry) => entry.sourceNode === 142);
  assert.equal(node142.every((entry) => entry.normalizedSeriesTitle === 'Black Widow' && entry.seriesYear === 2010), true);
  assert.equal(node142.every((entry) => entry.disposition === 'provisional-canonical-candidate'), true);

  const node6 = ledger.occurrences.filter((entry) => entry.sourceNode === 6);
  assert.equal(node6.find((entry) => entry.sourcePosition === 6)?.normalizedSeriesTitle, 'Tales of Suspense');
  assert.equal(node6.find((entry) => entry.sourcePosition === 6)?.seriesYear, 1959);

  const node9 = ledger.occurrences.filter((entry) => entry.sourceNode === 9);
  assert.equal(node9.find((entry) => entry.sourcePosition === 18)?.disposition, 'true-repeat');

  const node13 = ledger.occurrences.filter((entry) => entry.sourceNode === 13);
  assert.equal(node13.every((entry) => entry.normalizedSeriesTitle === 'Daredevil' && entry.seriesYear === 1964), true);

  const node30 = ledger.occurrences.filter((entry) => entry.sourceNode === 30);
  assert.equal(node30.filter((entry) => entry.disposition === 'true-repeat').length, 3);
  assert.equal(node30.filter((entry) => entry.disposition === 'true-repeat').every((entry) => ['81', '82', '83'].includes(entry.issueNumber)), true);

  const node74Partial = ledger.occurrences.filter((entry) => entry.sourceNode === 74);
  assert.equal(node74Partial.find((entry) => entry.sourcePosition === 314)?.disposition, 'semantic-exclusion');
  assert.equal(node74Partial.find((entry) => entry.sourcePosition === 314)?.reason, 'Partial-material label remains excluded.');

  const node164 = ledger.occurrences.filter((entry) => entry.sourceNode === 164);
  assert.equal(node164.filter((entry) => entry.disposition === 'semantic-exclusion').length, 1);
  assert.equal(node164.some((entry) => entry.sourceIssueReference === 'Material from Free Comic Book Day 2017 (Secret Empire)'), true);

  const node177 = ledger.occurrences.filter((entry) => entry.sourceNode === 177);
  assert.equal(node177.filter((entry) => entry.disposition === 'provisional-canonical-candidate').length, 6);
  assert.equal(node177.filter((entry) => entry.disposition === 'semantic-exclusion').length, 1);
  assert.equal(node177.some((entry) => entry.sourceIssueReference === 'Infinity Countdown Prime (2018)'), true);

}

function expectLedgerFailure(ledger, mutator) {
  assert.throws(() => {
    const draft = clone(ledger);
    mutator(draft);
    validateLedger(draft);
  });
}

test('the Black Widow source ledger preserves the frozen boundary and occurrence order', async () => {
  const ledger = await readLedger();
  validateLedger(ledger);

  const inventory = await readInventory();
  const record = inventory.find((entry) => entry.id === 'black-widow-reading-order');
  assert.equal(record.reason.includes('773'), true);
  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'shipped');
});

test('the Black Widow source ledger rejects the contrarian mutations', async () => {
  const ledger = await readLedger();
  validateLedger(ledger);

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.pop();
    draft.sourceOccurrenceCount -= 1;
    draft.categoryCounts[draft.occurrences[draft.occurrences.length - 1].disposition] -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences = draft.occurrences.filter((entry) => entry.sourceNode !== 95);
    draft.sourceOccurrenceCount -= 18;
    draft.categoryCounts['provisional-canonical-candidate'] -= 16;
    draft.categoryCounts['semantic-exclusion'] -= 2;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.sort((left, right) => left.sourceIssueReference.localeCompare(right.sourceIssueReference));
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.push({
      ...clone(draft.occurrences[0]),
      sourcePosition: draft.occurrences[0].sourcePosition,
    });
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences = draft.occurrences.filter((entry) => entry.disposition !== 'semantic-exclusion');
    draft.categoryCounts['semantic-exclusion'] = 0;
    draft.sourceOccurrenceCount -= 169;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences = draft.occurrences.filter((entry) => !(entry.sourceNode === 61 && entry.issueNumber === '225'));
    draft.categoryCounts['provisional-canonical-candidate'] -= 1;
    draft.sourceOccurrenceCount -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences = draft.occurrences.filter((entry) => entry.sourceNode !== 10);
    draft.categoryCounts['true-repeat'] -= 1;
    draft.sourceOccurrenceCount -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const prose = draft.occurrences.find((entry) => entry.sourceNode === 19);
    prose.disposition = 'provisional-canonical-candidate';
  });

  expectLedgerFailure(ledger, (draft) => {
    const collision = draft.occurrences.find((entry) => entry.sourceNode === 177 && entry.disposition === 'provisional-canonical-candidate');
    collision.normalizedSeriesTitle = 'Daredevil';
    collision.seriesYear = 1964;
    collision.issueNumber = '185';
  });

  expectLedgerFailure(ledger, (draft) => {
    const candidate = draft.occurrences.find((entry) => entry.sourcePosition === 441);
    candidate.disposition = 'unresolved-included-identity-gap';
    draft.categoryCounts['provisional-canonical-candidate'] -= 1;
    draft.categoryCounts['unresolved-included-identity-gap'] += 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const mixed = draft.occurrences.find((entry) => entry.sourceNode === 164 && entry.disposition === 'semantic-exclusion');
    mixed.disposition = 'unresolved-included-identity-gap';
  });

  expectLedgerFailure(ledger, (draft) => {
    const namedOneShot = draft.occurrences.find((entry) => entry.sourcePosition === 226);
    namedOneShot.issueNumber = '1';
  });
});
