import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'black-widow-reading-order.json');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-character-inventory.json');

const expectedGroupNames = [
  'Black Widow Origins',
  "Essential Black Widow Stories From 70's To 90's",
  "Black Widow in the 1990's",
  "Marvel Knights Black Widow (1999 through 2000's)",
  'Black Widow Comics From 2010 to 2012',
  'Marvel NOW! Black Widow',
  'All-New All-Different Black Widow',
  'Latest Additions',
];

const expectedIssueBearingNodeIndices = [
  6, 9, 10, 12, 13, 17, 19, 21, 24, 27, 30, 34, 37, 40, 43, 46, 49, 51, 54, 56, 58, 61, 64, 68,
  71, 72, 74, 77, 80, 82, 83, 85, 87, 89, 92, 95, 98, 101, 105, 108, 111, 113, 116, 119, 123,
  124, 126, 129, 131, 132, 134, 136, 139, 142, 145, 149, 150, 158, 161, 164, 168, 171, 174, 177,
  180, 183, 186, 189, 192, 195, 199, 201, 203, 205, 207, 209,
];

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countOccurrencesInNode(node) {
  const matches = node.text.match(/#\s*-?\d+(?:\s*(?:-|to)\s*#?\s*-?\d+)?/g) ?? [];
  let count = 0;
  for (const match of matches) {
    const pair = match.match(/#\s*(-?\d+)(?:\s*(?:-|to)\s*#?\s*(-?\d+))?/);
    const start = Number(pair[1]);
    const end = pair[2] == null ? start : Number(pair[2]);
    count += Math.abs(end - start) + 1;
  }
  if (node.sourceNodeIndex === 95) count += 4;
  if (node.sourceNodeIndex === 123) count += 3;
  return count;
}

function issueBearingNodeIndices(ledger) {
  return ledger.sourceNodes
    .filter((node) => countOccurrencesInNode(node) > 0)
    .map((node) => node.sourceNodeIndex);
}

function sourceNodeIndices(ledger) {
  return ledger.sourceNodes.map((node) => node.sourceNodeIndex);
}

function summarizeLedger(ledger) {
  const issueBearingNodes = ledger.sourceNodes.filter((node) => countOccurrencesInNode(node) > 0);
  const occurrenceTotal = ledger.sourceNodes.reduce((sum, node) => sum + countOccurrencesInNode(node), 0);
  const exclusionNodes = ledger.sourceNodes.length - issueBearingNodes.length;

  return {
    occurrenceTotal,
    issueBearingNodes,
    exclusionNodes,
  };
}

async function readLedger() {
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

async function readInventory() {
  return JSON.parse(await readFile(inventoryPath, 'utf8'));
}

function validateLedgerShape(ledger) {
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
  assert.equal(ledger.pageBlockCount, 209);
  assert.equal(ledger.issueBearingBlockCount, 76);
  assert.equal(ledger.sourceNodeCount, 209);
  assert.equal(ledger.provenanceGroupCount, 8);

  assert.deepEqual(ledger.provenanceGroups.map((group) => group.name), expectedGroupNames);
  assert.deepEqual(ledger.provenanceGroups.map((group) => group.sourceNodeIndices), [
    range(1, 31),
    range(32, 65),
    range(66, 120),
    range(121, 139),
    range(140, 150),
    range(151, 155),
    range(156, 196),
    range(197, 209),
  ]);

  assert.equal(ledger.sourceNodes.length, 209);
  assert.deepEqual(sourceNodeIndices(ledger), range(1, 209));
  assert.deepEqual(issueBearingNodeIndices(ledger), expectedIssueBearingNodeIndices);

  const summary = summarizeLedger(ledger);
  assert.equal(summary.issueBearingNodes.length, 76);
  assert.equal(summary.exclusionNodes, 133);
  assert.equal(summary.occurrenceTotal, 613);

  assert.deepEqual(
    ledger.sourceNodes.filter((node) => [95, 123].includes(node.sourceNodeIndex)).map((node) => node.text),
    [
      'Collects: Force Works (1994) #1-11, 12 (A story), 13-15, Ashcan Edition, Century: Distant Sons (1996) #1, Material from Iron Man/Force Works Collectors’ Preview (1994)',
      'This collection contains issues #1 to #3 of both the 1999 and 2001 Black Widow miniseries. Note that the 2001 miniseries from Greg Rucka and Devin Grayson is labeled Black Widow: Breakdown in Marvel Unlimited.',
    ],
  );
  assert.deepEqual(
    ledger.sourceNodes
      .filter((node) => /^Collects: Black Widow(?: \((?:2016|2019|2020)\))?/.test(node.text) || /^Collects: The Web of Black Widow/.test(node.text) || /^Collects: Wastelanders: Black Widow/.test(node.text) || /^Collects: Black Widow: Widow’s Sting/.test(node.text))
      .map((node) => node.text),
    [
      'Collects: Black Widow (2016) #1-6',
      'Collects: Black Widow (2016) #7-12',
      'Collects: Black Widow (2019) #1-5',
      'Collects: The Web of Black Widow #1 to #5',
      'Collects: Black Widow: Widow’s Sting #1',
      'Collects: Wastelanders: Black Widow #1',
      'Collects: Black Widow #1 to #5',
      'Collects: Black Widow (2020) #6 to #10',
      'Collects: Black Widow (2020) #11 to #15',
    ],
  );

  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 6)), 11);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 17)), 10);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 19)), 8);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 46)), 23);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 95)), 16);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 123)), 6);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 150)), 1);
  assert.equal(countOccurrencesInNode(ledger.sourceNodes.find((node) => node.sourceNodeIndex === 201)), 1);
}

function expectLedgerFailure(ledger, mutator) {
  assert.throws(() => {
    const draft = clone(ledger);
    mutator(draft);
    validateLedgerShape(draft);
  });
}

test('the Black Widow source ledger preserves the frozen boundary and group ordering', async () => {
  const ledger = await readLedger();
  const inventory = await readInventory();

  validateLedgerShape(ledger);

  const record = inventory.find((entry) => entry.id === 'black-widow-reading-order');
  assert.equal(record.reason.includes('613 expanded issue occurrences'), true);
  assert.equal(record.centralDisposition, 'deferred');
  assert.equal(record.deliveryStatus, 'not-applicable');
});

test('the Black Widow source ledger rejects the contrarian mutations', async () => {
  const ledger = await readLedger();
  validateLedgerShape(ledger);

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.pop();
    draft.sourceNodeCount -= 1;
    draft.pageBlockCount -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.splice(94, 1);
    draft.sourceNodeCount -= 1;
    draft.pageBlockCount -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.sort((left, right) => left.text.localeCompare(right.text));
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.push({
      ...clone(draft.sourceNodes[5]),
      sourceNodeIndex: draft.sourceNodes[5].sourceNodeIndex,
    });
    draft.sourceNodeCount += 1;
    draft.pageBlockCount += 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes = draft.sourceNodes.filter((node) => node.sourceNodeIndex !== 1 && node.sourceNodeIndex !== 6);
    draft.sourceNodeCount -= 2;
    draft.pageBlockCount -= 2;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes[16].text = 'Collects: Avengers (1963) #31-39';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes[18].text = draft.sourceNodes[18].text.replace('issue #29', 'issue 29');
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes[191].text = 'Collects: Black Widow #1-5';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes[16].text = '';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes[94].text = 'Force Works (1994) #1-11, 12 (A story), 13-15, Ashcan Edition, Century: Distant Sons (1996) #1';
  });
});
