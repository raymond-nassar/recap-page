import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addIssuesToList,
  createEmptyState,
  createList,
} from '../src/js/lib/model.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'fantastic-four-reading-order.json');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-character-inventory.json');
const categoryNames = [
  'provisional-canonical-candidate',
  'true-repeat',
  'unresolved-included-identity-gap',
  'semantic-exclusion',
];
const expectedRepeatIdentities = [
  'Fantastic Four Annual|1963|1',
  'Fantastic Four|1961|8',
  'Ff|2011|4',
  'Ff|2011|5',
  'Marvel Knights 4|2004|1',
  'Marvel Knights 4|2004|2',
  'Marvel Knights 4|2004|3',
  'Marvel Knights 4|2004|4',
];
const nonIssueSourceBlockPositions = [107, 218, 315, 363];
const exactIssueNumberPattern = /^(?:\d+(?:\.\d+)?[A-Za-z]*|\d+\/\d+|Annual|gap)$/;
const explicitRangePattern = /#?(\d+)\s*(?:-|to)\s*#?(\d+)\s*$/i;
const namedUnnumberedCandidateReferences = [];
const contextualIdentitySamples = [
  [44, 'Fantastic Four', 1961, '215'],
  [44, 'Avengers', 1963, '233'],
  [44, 'Alpha Flight', 1983, '4'],
  [54, 'What the--?!', 1988, '2'],
  [54, 'Fantastic Four Roast', 1982, '1'],
  [60, 'Incredible Hulk', 1962, '350'],
  [63, 'The Amazing Spider-Man', 1963, '311'],
  [86, 'Fantastic Four', 1998, '1/2'],
  [86, 'Fantastic Four Annual', 1998, '1'],
  [97, 'Fantastic Four', 1998, '60'],
  [111, 'Marvel Knights 4', 2004, '1'],
  [114, 'Thing: Freakshow', 2002, '1'],
  [119, 'Startling Stories: The Thing - Night Falls on Yancy Street', 2003, '1'],
  [145, 'Thing', 1983, '1'],
  [153, 'Fantastic Four: First Family', 2006, '1'],
  [211, 'Fantastic Four', 1998, '605'],
  [222, 'Fantastic Four', 2012, '4'],
  [244, 'Uncanny Inhumans', 2015, '0'],
  [251, 'Uncanny Avengers', 2015, '1'],
  [295, 'FOOM Magazine', 2017, 'gap'],
  [341, 'Fantastic Four: Reckoning War Alpha', 2022, '1'],
];
const sourceSemanticExclusionReferences = [
  [54, 'And Material From Secret Wars Ii #2'],
  [100, 'And Material From The #500'],
  [152, 'Fantastic Four: First Family'],
];

const namedWorksThatMustStayCandidates = [
  'Fantastic Four 1998 Annual',
  'Fantastic Four Annual (2001)',
  'Son Of A Genius',
  'Happy Franksgiving',
  'Fear Itself: FF one-shot',
  'Galacta: Daughter of Galactus',
  'Fantastic Four: Reckoning War Alpha',
  'Reckoning War: Trial of The Watcher',
];
const unavailableNamedWorks = [
  'Fantastic Four Roast',
  'Fantastic Four Special Edition',
  'Marvel Graphic Novel: Hulk/Thing - The Big Change',
  'Everybody Loves Franklin',
  'Super Summer Spectacular',
  'March Madness',
  'World Be Warned',
  'Monster Mash',
  'Fall Football Fiasco',
  'FOOM Magazine (2017)',
];

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readJson(filePath) {
  return readFile(filePath, 'utf8').then((content) => JSON.parse(content));
}

test('Fantastic Four publishes only settled issues through import', async () => {
  const payload = await readJson(path.join(root, 'src', 'data', 'fantastic_four_reading_order.json'));
  const checklist = parseChecklist(await readFile(
    path.join(root, 'src', 'data', 'orders', 'fantastic-four-reading-order.md'),
    'utf8',
  ));
  const placeholders = payload.items.filter((item) => item.placeholder);
  assert.equal(payload.count, 973);
  assert.equal(payload.items.length, 973);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(placeholders.length, 0);
  assert.equal(checklist.entries.length, 973);
  assert.deepEqual(checklist.unresolved, []);

  let state = createList(createEmptyState(), { name: 'Fantastic Four' });
  const listId = state.listOrder[0];
  const result = addIssuesToList(state, listId, payload.items.map((item) => ({
    ...item,
    source: 'curated',
  })));
  state = result.state;

  assert.equal(result.added, payload.items.length);
  assert.deepEqual(state.lists[listId].itemIds, payload.items.map((item) => item.issueId));
});

function assertFantasticFourSourceLedgerShape(ledger) {
  assert.equal(ledger.sourceBlockCount, ledger.sourceNodes.length, 'sourceBlockCount must match sourceNodes');
  assert.equal(ledger.provenanceGroupCount, ledger.provenanceGroups.length, 'provenanceGroupCount must match provenanceGroups');
  assert.equal(ledger.sourceOccurrenceCount, ledger.issueOccurrences.length, 'sourceOccurrenceCount must match issueOccurrences');
  assert.equal(ledger.provenanceGroups.length, 13, 'expected 13 provenance groups');
  assert.equal(ledger.sourceNodes.length, 133, 'expected 133 selected source nodes');
  assert.equal(ledger.issueBearingSourceBlockCount, 129, 'expected 129 issue-bearing source nodes');
  assert.equal(ledger.sourceOccurrenceCount, 1058, 'expected 1,058 normalized ordered occurrences');
  assert.equal(ledger.sourceBoundaryDigest, digest(ledger.sourceBoundary), 'sourceBoundaryDigest is stale');
  const occurrenceSourceBlockPositions = new Set(
    ledger.issueOccurrences.map((occurrence) => occurrence.sourceBlockPosition),
  );
  const issueBearingSourceNodes = ledger.sourceNodes.filter((node) => (
    occurrenceSourceBlockPositions.has(node.sourceBlockPosition)
  ));
  assert.equal(
    ledger.sourceIssueBearingBlocksSha256,
    digest(JSON.stringify(issueBearingSourceNodes)),
    'sourceIssueBearingBlocksSha256 is stale',
  );
  assert.deepEqual(
    ledger.sourceNodes
      .filter((node) => !occurrenceSourceBlockPositions.has(node.sourceBlockPosition))
      .map((node) => node.sourceBlockPosition),
    nonIssueSourceBlockPositions,
    'only the four verified prose and caption blocks may remain non-issue nodes',
  );
  assert.ok(
    ledger.issueOccurrences.every((occurrence) => typeof occurrence.normalizedSeriesTitle === 'string' && occurrence.normalizedSeriesTitle.trim().length > 0),
    'every occurrence must retain an inherited or explicit series title',
  );

  const derivedCategoryPositions = Object.fromEntries(categoryNames.map((classification) => [
    classification,
    ledger.issueOccurrences
      .filter((occurrence) => occurrence.classification === classification)
      .map((occurrence) => occurrence.sourceOccurrencePosition),
  ]));
  const derivedCategoryCounts = Object.fromEntries(
    Object.entries(derivedCategoryPositions).map(([classification, positions]) => [classification, positions.length]),
  );

  assert.deepEqual(ledger.categoryCounts, derivedCategoryCounts, 'categoryCounts must be derived from issueOccurrences');
  assert.deepEqual(ledger.categoryPositions, derivedCategoryPositions, 'categoryPositions must be derived from issueOccurrences');
  assert.deepEqual(ledger.categoryCounts, {
    'provisional-canonical-candidate': 973,
    'true-repeat': 38,
    'unresolved-included-identity-gap': 0,
    'semantic-exclusion': 47,
  }, 'expected normalized category totals');
  assert.equal(ledger.categoryCounts['unresolved-included-identity-gap'] ?? 0, 0, 'source-identifiable named works must not fall into the gap bucket');
  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.sourceBlockPosition),
    [...ledger.sourceNodes.map((node) => node.sourceBlockPosition)].sort((left, right) => left - right),
    'sourceNodes must stay in source order',
  );
  assert.deepEqual(
    ledger.provenanceGroups.map((group) => group.sourceGroupPosition),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    'provenanceGroups must stay in group order',
  );
  for (const group of ledger.provenanceGroups) {
    const sourceNodes = ledger.sourceNodes.filter((node) => node.sourceGroupPosition === group.sourceGroupPosition);
    const occurrenceNodes = new Set(
      ledger.issueOccurrences
        .filter((occurrence) => occurrence.sourceGroupPosition === group.sourceGroupPosition)
        .map((occurrence) => occurrence.sourceBlockPosition),
    );
    const issueBearingNodes = sourceNodes.filter((node) => occurrenceNodes.has(node.sourceBlockPosition));

    assert.equal(issueBearingNodes.length, group.issueBearingCount, `group ${group.sourceGroupPosition} issue-bearing count is stale`);
    assert.deepEqual(
      issueBearingNodes.map((node) => node.sourceBlockPosition),
      [...occurrenceNodes].sort((left, right) => left - right),
      `group ${group.sourceGroupPosition} must cover every occurrence block`,
    );
  }
  assert.ok(ledger.sourceNodes.every((node) => typeof node.sourceRangeReference === 'string' && node.sourceRangeReference.trim().length > 0));
  assert.ok(ledger.issueOccurrences.every((occurrence) => typeof occurrence.sourceIssueReference === 'string' && occurrence.sourceIssueReference.trim().length > 0));
  assert.deepEqual(
    ledger.issueOccurrences.map((occurrence) => occurrence.sourceOccurrencePosition),
    Array.from({ length: ledger.issueOccurrences.length }, (_, index) => index + 1),
    'sourceOccurrencePosition must stay dense and ordered',
  );
  const includedOccurrences = ledger.issueOccurrences.filter((occurrence) => (
    occurrence.classification === 'provisional-canonical-candidate'
    || occurrence.classification === 'true-repeat'
  ));
  const candidates = includedOccurrences.filter((occurrence) => (
    occurrence.classification === 'provisional-canonical-candidate'
  ));
  assert.ok(
    candidates.every((occurrence) => exactIssueNumberPattern.test(occurrence.issueNumber)),
    'every candidate must retain an exact issue number or an explicit named-work marker',
  );
  const actualNamedUnnumberedReferences = [...new Set(
    candidates
      .filter((occurrence) => occurrence.issueNumber === 'gap' || occurrence.issueNumber === 'Annual')
      .map((occurrence) => occurrence.sourceIssueReference),
  )].sort();
  assert.deepEqual(
    actualNamedUnnumberedReferences,
    [...namedUnnumberedCandidateReferences].sort(),
    'only source-identifiable named works may remain unnumbered',
  );
  for (const [sourceBlockPosition, title, year, issueNumber] of contextualIdentitySamples) {
    const occurrence = ledger.issueOccurrences.find((candidate) => (
      candidate.sourceBlockPosition === sourceBlockPosition
      && candidate.normalizedSeriesTitle === title
      && candidate.seriesYear === year
      && candidate.issueNumber === issueNumber
    ));
    assert.ok(
      occurrence,
      `source block ${sourceBlockPosition} must retain ${title} (${year}) #${issueNumber}`,
    );
  }
  for (const [sourceBlockPosition, sourceIssueReference] of sourceSemanticExclusionReferences) {
    const occurrence = ledger.issueOccurrences.find((candidate) => (
      candidate.sourceBlockPosition === sourceBlockPosition
      && candidate.sourceIssueReference === sourceIssueReference
    ));
    assert.equal(
      occurrence?.classification,
      'semantic-exclusion',
      `${sourceIssueReference} must remain semantic provenance, not a candidate`,
    );
  }
  assert.equal(ledger.expandedRangeSourceEntryCount, 46, 'expected 46 expanded source range entries');
  assert.equal(ledger.expandedRangeOccurrenceCount, 267, 'expected 267 occurrences from expanded ranges');

  const rangeOccurrences = new Map();
  for (const occurrence of includedOccurrences) {
    if (!occurrence.expandedFromSourceRange) {
      continue;
    }

    const match = occurrence.sourceIssueReference.match(explicitRangePattern);
    if (!match) {
      continue;
    }

    const key = `${occurrence.sourceBlockPosition}|${occurrence.sourceIssueReference}`;
    const entries = rangeOccurrences.get(key) ?? {
      start: Number(match[1]),
      end: Number(match[2]),
      issueNumbers: [],
    };
    entries.issueNumbers.push(occurrence.issueNumber);
    rangeOccurrences.set(key, entries);
  }
  assert.equal(rangeOccurrences.size, ledger.expandedRangeSourceEntryCount, 'every explicit source range must be expanded');
  for (const [key, range] of rangeOccurrences) {
    const expectedIssueNumbers = Array.from(
      { length: range.end - range.start + 1 },
      (_, index) => String(range.start + index),
    );
    assert.deepEqual(range.issueNumbers, expectedIssueNumbers, `${key} has a missing or reordered range member`);
  }
  const inheritedMarvelKnightsRange = includedOccurrences.filter((occurrence) => (
    occurrence.sourceBlockPosition === 111
  ));
  assert.deepEqual(
    inheritedMarvelKnightsRange.map((occurrence) => occurrence.issueNumber),
    ['1', '2', '3', '4'],
    'the inherited Marvel Knights range must preserve every issue member',
  );
  assert.ok(
    inheritedMarvelKnightsRange.every((occurrence) => (
      occurrence.normalizedSeriesTitle === 'Marvel Knights 4'
      && occurrence.seriesYear === 2004
      && occurrence.expandedFromSourceRange
    )),
    'the inherited Marvel Knights range must retain its series identity',
  );
  const compoundRangeIdentityExpectations = [
    {
      sourceBlockPosition: 330,
      sourceIssueReference: 'Fantastic Four (2018) #21 to #23',
      expectedIssueNumbers: ['21', '22', '23'],
    },
    {
      sourceBlockPosition: 341,
      sourceIssueReference: 'Fantastic Four (2018) #40 to #42',
      expectedIssueNumbers: ['40', '41', '42'],
    },
  ];
  for (const expectation of compoundRangeIdentityExpectations) {
    const members = includedOccurrences.filter((occurrence) => (
      occurrence.sourceBlockPosition === expectation.sourceBlockPosition
      && occurrence.expandedFromSourceRange
    ));
    assert.deepEqual(
      members.map((occurrence) => occurrence.sourceIssueReference),
      expectation.expectedIssueNumbers.map(() => expectation.sourceIssueReference),
      `source block ${expectation.sourceBlockPosition} must isolate its issue clause`,
    );
    assert.deepEqual(
      members.map((occurrence) => occurrence.issueNumber),
      expectation.expectedIssueNumbers,
      `source block ${expectation.sourceBlockPosition} must preserve its range members`,
    );
    assert.ok(
      members.every((occurrence) => (
        occurrence.normalizedSeriesTitle === 'Fantastic Four'
        && occurrence.seriesYear === 2018
      )),
      `source block ${expectation.sourceBlockPosition} must retain the 2018 Fantastic Four identity`,
    );
  }

  const identities = new Map();
  for (const occurrence of ledger.issueOccurrences) {
    const identity = `${occurrence.normalizedSeriesTitle}|${occurrence.seriesYear}|${occurrence.issueNumber}`;
    const matches = identities.get(identity) ?? [];
    matches.push(occurrence);
    identities.set(identity, matches);
  }

  const duplicateIdentities = [...identities.entries()].filter(([, matches]) => matches.length > 1);
  assert.ok(
    expectedRepeatIdentities.every((identity) => duplicateIdentities.some(([candidate]) => candidate === identity)),
    'expected repeat identities must remain represented after contextual correction',
  );
  for (const [identity, matches] of duplicateIdentities) {
    assert.equal(matches.length, 2, `expected one canonical and one repeat occurrence for ${identity}`);
    assert.ok(matches.some((occurrence) => occurrence.classification === 'provisional-canonical-candidate'), `missing canonical occurrence for ${identity}`);
    assert.ok(matches.some((occurrence) => occurrence.classification === 'true-repeat'), `missing repeat occurrence for ${identity}`);
  }

  for (const sourceIssueReference of namedWorksThatMustStayCandidates) {
    const occurrence = ledger.issueOccurrences.find((candidate) => candidate.sourceIssueReference === sourceIssueReference);
    assert.ok(occurrence, `missing named work: ${sourceIssueReference}`);
    assert.equal(occurrence.classification, 'provisional-canonical-candidate', `${sourceIssueReference} should stay a candidate`);
  }
  for (const sourceIssueReference of unavailableNamedWorks) {
    const occurrence = ledger.issueOccurrences.find((candidate) => candidate.sourceIssueReference === sourceIssueReference);
    assert.ok(occurrence, `missing unavailable named work: ${sourceIssueReference}`);
    assert.equal(occurrence.classification, 'semantic-exclusion', `${sourceIssueReference} should stay excluded`);
  }

  const primerPages = ledger.issueOccurrences.find((occurrence) => occurrence.sourceIssueReference === 'Marvel Legacy Primer pages');
  assert.ok(primerPages, 'missing Marvel Legacy Primer pages');
  assert.equal(primerPages.classification, 'semantic-exclusion', 'Marvel Legacy Primer pages should stay excluded as partial material');
}

test('the Fantastic Four source ledger stays exact through its frozen boundary', async () => {
  const ledger = await readJson(ledgerPath);
  const inventory = await readJson(inventoryPath);
  const record = inventory.find((candidate) => candidate.id === 'fantastic-four-reading-order');

  assert.ok(record, 'expected a Fantastic Four inventory record');
  assert.equal(record.sourceContentSha256, ledger.sourceContentSha256);
  assert.match(record.reason, /973 exact provider or owner-resolved comics/i);
  assert.match(record.reason, /38 backward repeats/i);
  assert.match(record.reason, /47 explicit exclusions/i);
  assert.match(record.reason, /1,058 source occurrences/i);
  assert.doesNotThrow(() => assertFantasticFourSourceLedgerShape(ledger));

  const truncatedNodes = structuredClone(ledger);
  truncatedNodes.sourceNodes.pop();
  assert.throws(() => assertFantasticFourSourceLedgerShape(truncatedNodes), /sourceBlockCount must match sourceNodes/);

  const omittedNode = structuredClone(ledger);
  omittedNode.sourceNodes.splice(10, 1);
  assert.throws(() => assertFantasticFourSourceLedgerShape(omittedNode), /sourceBlockCount must match sourceNodes/);

  const reorderedNodes = structuredClone(ledger);
  reorderedNodes.sourceNodes.reverse();
  assert.throws(() => assertFantasticFourSourceLedgerShape(reorderedNodes), /sourceIssueBearingBlocksSha256 is stale|sourceNodes must stay in source order/);

  const sortedCategories = structuredClone(ledger);
  sortedCategories.categoryPositions['true-repeat'].sort((left, right) => right - left);
  assert.throws(() => assertFantasticFourSourceLedgerShape(sortedCategories), /categoryPositions must be derived from issueOccurrences/);

  const duplicatePosition = structuredClone(ledger);
  duplicatePosition.issueOccurrences[1].sourceOccurrencePosition = 1;
  assert.throws(() => assertFantasticFourSourceLedgerShape(duplicatePosition), /categoryPositions must be derived from issueOccurrences|dense and ordered/);

  const deleteCandidate = structuredClone(ledger);
  deleteCandidate.issueOccurrences.splice(
    deleteCandidate.issueOccurrences.findIndex((occurrence) => occurrence.classification === 'provisional-canonical-candidate'),
    1,
  );
  assert.throws(() => assertFantasticFourSourceLedgerShape(deleteCandidate), /sourceOccurrenceCount must match issueOccurrences/);

  const deleteRepeat = structuredClone(ledger);
  deleteRepeat.issueOccurrences.splice(
    deleteRepeat.issueOccurrences.findIndex((occurrence) => occurrence.classification === 'true-repeat'),
    1,
  );
  assert.throws(() => assertFantasticFourSourceLedgerShape(deleteRepeat), /sourceOccurrenceCount must match issueOccurrences/);

  const deleteExclusion = structuredClone(ledger);
  deleteExclusion.issueOccurrences.splice(
    deleteExclusion.issueOccurrences.findIndex((occurrence) => occurrence.classification === 'semantic-exclusion'),
    1,
  );
  assert.throws(() => assertFantasticFourSourceLedgerShape(deleteExclusion), /sourceOccurrenceCount must match issueOccurrences/);

  const droppedRangeMember = structuredClone(ledger);
  droppedRangeMember.issueOccurrences.splice(
    droppedRangeMember.issueOccurrences.findIndex((occurrence) => (
      occurrence.sourceIssueReference === 'Fantastic Four #1'
    )),
    1,
  );
  assert.throws(() => assertFantasticFourSourceLedgerShape(droppedRangeMember), /sourceOccurrenceCount must match issueOccurrences/);

  const alteredRangeMember = structuredClone(ledger);
  alteredRangeMember.issueOccurrences.find((occurrence) => (
    occurrence.sourceBlockPosition === 10
    && occurrence.issueNumber === '77'
  )).issueNumber = '76';
  assert.throws(() => assertFantasticFourSourceLedgerShape(alteredRangeMember), /missing or reordered range member/);

  const proseMisclassified = structuredClone(ledger);
  proseMisclassified.issueOccurrences.find((occurrence) => occurrence.classification === 'semantic-exclusion')
    .classification = 'provisional-canonical-candidate';
  assert.throws(() => assertFantasticFourSourceLedgerShape(proseMisclassified), /categoryCounts must be derived from issueOccurrences/);

  const titleCollision = structuredClone(ledger);
  const collision = titleCollision.issueOccurrences.find((occurrence) => (
    occurrence.normalizedSeriesTitle === 'Fantastic Four'
    && occurrence.seriesYear === 1998
    && occurrence.issueNumber === '40'
  ));
  assert.ok(collision, 'expected a 1998 Fantastic Four #40 occurrence');
  collision.seriesYear = 1961;
  assert.throws(() => assertFantasticFourSourceLedgerShape(titleCollision), /expected exact repeat identities|duplicate|missing repeat/i);

  const namedWorkGap = structuredClone(ledger);
  namedWorkGap.issueOccurrences.find((occurrence) => occurrence.sourceIssueReference === 'Son Of A Genius')
    .classification = 'unresolved-included-identity-gap';
  assert.throws(() => assertFantasticFourSourceLedgerShape(namedWorkGap), /should stay a candidate|source-identifiable named works|categoryCounts must be derived from issueOccurrences/);

  const mixedClause = structuredClone(ledger);
  mixedClause.issueOccurrences.find((occurrence) => occurrence.classification === 'semantic-exclusion')
    .classification = 'provisional-canonical-candidate';
  assert.throws(() => assertFantasticFourSourceLedgerShape(mixedClause), /categoryCounts must be derived from issueOccurrences/);

  const inheritedIdentityLoss = structuredClone(ledger);
  inheritedIdentityLoss.issueOccurrences.find((occurrence) => occurrence.sourceIssueReference === 'Fantastic Four #1-30').normalizedSeriesTitle = ' ';
  assert.throws(() => assertFantasticFourSourceLedgerShape(inheritedIdentityLoss), /inherited or explicit series title/);
});
