import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import test from 'node:test';

const EXPECTED = {
  occurrenceCount: 425,
  occurrenceCounts: {
    'canonical-candidate': 277,
    exclusion: 103,
    gap: 5,
    repeat: 40,
  },
  normalizedSourceHash: '1aedaa14f9671bbf6cffdb9d8adc0171c7af2343be71c3a6ccbc882178b964a3',
  sourceNodeOrderHash: '82d979f730300d6dfc76d5ebd8265059910311e26e4a327a321d876397b36cc8',
  gapPositions: [185, 193, 234, 282, 321],
  groupCounts: [5, 46, 43, 48, 58, 94, 44, 87],
  exclusionCategoryCounts: {
    'boundary marker': 4,
    'collection marker': 63,
    'prose marker': 29,
    'section marker': 7,
  },
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

async function readLedger() {
  return JSON.parse(await readFile('scripts/data/cbh-source-ledgers/silver-surfer-reading-order.json', 'utf8'));
}

function orderDigest(ledger) {
  return sha256(ledger.occurrences.map((entry) => ({
    position: entry.position,
    sourceNodeIndex: entry.sourceNodeIndex,
    sourceType: entry.sourceType,
    sourceText: entry.sourceText,
    sourceGroup: entry.sourceGroup,
  })));
}

function normalizedDigest(ledger) {
  return sha256(ledger.occurrences.map(({ position: _position, ...entry }) => entry));
}

function exclusionCategories(ledger) {
  return Object.fromEntries(
    Object.entries(
      ledger.occurrences
        .filter((entry) => entry.provisionalDisposition === 'exclusion')
        .reduce((categories, entry) => {
          if (!categories[entry.reason]) categories[entry.reason] = [];
          categories[entry.reason].push(entry.position);
          return categories;
        }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function refreshDerivedFields(ledger) {
  ledger.occurrences.forEach((entry, index) => {
    entry.position = index + 1;
  });
  ledger.occurrenceCount = ledger.occurrences.length;
  ledger.occurrenceCounts = ledger.occurrences.reduce((counts, entry) => {
    counts[entry.provisionalDisposition] = (counts[entry.provisionalDisposition] || 0) + 1;
    return counts;
  }, {});
  ledger.groupCount = new Set(ledger.occurrences.map((entry) => entry.sourceGroup)).size;
  ledger.provenanceGroupCount = ledger.groupCount;
  ledger.sourceNodeCount = new Set(ledger.occurrences.map((entry) => entry.sourceNodeIndex)).size;
  ledger.categorizedPositions = {
    canonicalCandidatePositions: ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'canonical-candidate').map((entry) => entry.position),
    repeatPositions: ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'repeat').map((entry) => entry.position),
    gapPositions: ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'gap').map((entry) => entry.position),
    exclusionPositions: ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'exclusion').map((entry) => entry.position),
  };
  ledger.exclusionCategories = exclusionCategories(ledger);
  ledger.normalizedSourceHash = normalizedDigest(ledger);
  ledger.sourceNodeOrderHash = orderDigest(ledger);
  return ledger;
}

function assertLedgerShape(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'silver-surfer-reading-order');
  assert.equal(ledger.title, 'Silver Surfer');
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/silver-surfer-reading-order/');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-27');
  assert.equal(ledger.sourceBoundary.scope, 'full page');
  assert.equal(ledger.sourceBoundary.qualifyingSection, null);
  assert.equal(ledger.sourceBoundary.firstHeading, 'Silver Surfer Reading Order');
  assert.equal(ledger.sourceBoundary.lastHeading, 'Latest Additions:');
  assert.equal(ledger.sourceBoundary.contentSha256.length, 64);
  assert.equal(ledger.sourceBoundary.issueBearingBlocksSha256.length, 64);
  assert.equal(ledger.occurrenceCount, EXPECTED.occurrenceCount);
  assert.equal(ledger.occurrenceCount, ledger.occurrences.length);
  assert.equal(ledger.groupCount, new Set(ledger.occurrences.map((entry) => entry.sourceGroup)).size);
  assert.equal(ledger.groupCount, 8);
  assert.equal(ledger.provenanceGroupCount, ledger.groupCount);
  assert.equal(ledger.sourceNodeCount, new Set(ledger.occurrences.map((entry) => entry.sourceNodeIndex)).size);
  assert.equal(ledger.sourceNodeCount, 165);
  assert.equal(ledger.normalizedSourceHash, EXPECTED.normalizedSourceHash);
  assert.equal(ledger.normalizedSourceHash, normalizedDigest(ledger));
  assert.equal(ledger.sourceNodeOrderHash, EXPECTED.sourceNodeOrderHash);
  assert.equal(ledger.sourceNodeOrderHash, orderDigest(ledger));
  const counts = ledger.occurrences.reduce((acc, entry) => {
    acc[entry.provisionalDisposition] = (acc[entry.provisionalDisposition] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(ledger.occurrenceCounts, EXPECTED.occurrenceCounts);
  assert.deepEqual(ledger.occurrenceCounts, counts);
  assert.equal(counts['canonical-candidate'] > 0, true);
  assert.equal(counts.repeat > 0, true);
  assert.equal(counts.gap > 0, true);
  assert.equal(counts.exclusion > 0, true);
  assert.deepEqual(ledger.categorizedPositions.canonicalCandidatePositions, ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'canonical-candidate').map((entry) => entry.position));
  assert.deepEqual(ledger.categorizedPositions.repeatPositions, ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'repeat').map((entry) => entry.position));
  assert.deepEqual(ledger.categorizedPositions.gapPositions, ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'gap').map((entry) => entry.position));
  assert.deepEqual(ledger.categorizedPositions.exclusionPositions, ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'exclusion').map((entry) => entry.position));
  assert.deepEqual(ledger.categorizedPositions.gapPositions, EXPECTED.gapPositions);
  assert.deepEqual(ledger.exclusionCategories, exclusionCategories(ledger));
  assert.deepEqual(
    Object.fromEntries(Object.entries(ledger.exclusionCategories).map(([reason, positions]) => [reason, positions.length])),
    EXPECTED.exclusionCategoryCounts,
  );
  assert.deepEqual(
    [...new Map(ledger.occurrences.map((entry) => [entry.sourceGroup, 0])).keys()].map(
      (group) => ledger.occurrences.filter((entry) => entry.sourceGroup === group).length,
    ),
    EXPECTED.groupCounts,
  );
  ledger.occurrences.forEach((entry, index) => {
    assert.equal(entry.position, index + 1);
    assert.equal(typeof entry.sourceNodeIndex, 'number');
    assert.equal(typeof entry.sourceGroup, 'string');
    assert.equal(typeof entry.sourceType, 'string');
    assert.equal(typeof entry.sourceText, 'string');
    assert.equal(typeof entry.sourceRangeReference, 'string');
    assert.equal(typeof entry.provisionalDisposition, 'string');
    assert.equal(['canonical-candidate', 'repeat', 'gap', 'exclusion'].includes(entry.provisionalDisposition), true);
    if (entry.provisionalDisposition === 'repeat') {
      assert.equal(typeof entry.repeatOfPosition, 'number');
      assert.equal(entry.repeatOfPosition < entry.position, true);
      const original = ledger.occurrences[entry.repeatOfPosition - 1];
      assert.equal(entry.normalizedSeriesTitle, original.normalizedSeriesTitle);
      assert.equal(entry.seriesYear, original.seriesYear);
      assert.equal(entry.issueNumber, original.issueNumber);
    } else {
      assert.equal(entry.repeatOfPosition == null, true);
    }
    if (entry.provisionalDisposition === 'gap') {
      assert.equal(entry.sourceText, 'Issues:');
    }
    if (entry.provisionalDisposition === 'canonical-candidate') {
      assert.notEqual(entry.normalizedSeriesTitle, null);
    }
  });
  assert.equal(ledger.occurrences.some((entry) => entry.sourceType === 'prose' && entry.provisionalDisposition === 'canonical-candidate'), false);
  assert.deepEqual(
    ledger.occurrences
      .filter((entry) => entry.sourceNodeIndex === 36)
      .map(({ sourceText, normalizedSeriesTitle, issueNumber, provisionalDisposition, repeatOfPosition }) => ({
        sourceText,
        normalizedSeriesTitle,
        issueNumber,
        provisionalDisposition,
        repeatOfPosition,
      })),
    [
      { sourceText: 'Avengers #115', normalizedSeriesTitle: 'Avengers', issueNumber: '115', provisionalDisposition: 'repeat', repeatOfPosition: 71 },
      { sourceText: 'Defenders #8', normalizedSeriesTitle: 'Defenders', issueNumber: '8', provisionalDisposition: 'repeat', repeatOfPosition: 75 },
      { sourceText: 'Avengers #116', normalizedSeriesTitle: 'Avengers', issueNumber: '116', provisionalDisposition: 'repeat', repeatOfPosition: 72 },
      { sourceText: 'Defenders #9', normalizedSeriesTitle: 'Defenders', issueNumber: '9', provisionalDisposition: 'repeat', repeatOfPosition: 76 },
      { sourceText: 'Avengers #117', normalizedSeriesTitle: 'Avengers', issueNumber: '117', provisionalDisposition: 'repeat', repeatOfPosition: 73 },
      { sourceText: 'Defenders #10', normalizedSeriesTitle: 'Defenders', issueNumber: '10', provisionalDisposition: 'repeat', repeatOfPosition: 77 },
      { sourceText: 'Avengers #118', normalizedSeriesTitle: 'Avengers', issueNumber: '118', provisionalDisposition: 'repeat', repeatOfPosition: 74 },
      { sourceText: 'Defenders #11', normalizedSeriesTitle: 'Defenders', issueNumber: '11', provisionalDisposition: 'repeat', repeatOfPosition: 78 },
    ],
  );
  assert.equal(
    ledger.occurrenceCount,
    ledger.categorizedPositions.canonicalCandidatePositions.length
      + ledger.categorizedPositions.repeatPositions.length
      + ledger.categorizedPositions.gapPositions.length
      + ledger.categorizedPositions.exclusionPositions.length,
  );
}

test('Silver Surfer source ledger preserves the full boundary and order', async () => {
  const ledger = await readLedger();
  assert.doesNotThrow(() => assertLedgerShape(ledger));
});

test('Silver Surfer source ledger rejects the known defect shapes', async () => {
  const ledger = await readLedger();

  assert.throws(() => assertLedgerShape(refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: ledger.occurrences.slice(0, -1),
  })));

  assert.throws(() => assertLedgerShape(refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: [...ledger.occurrences].sort((left, right) => left.provisionalDisposition.localeCompare(right.provisionalDisposition)),
  })));

  for (const disposition of ['canonical-candidate', 'repeat', 'gap', 'exclusion']) {
    const index = ledger.occurrences.findIndex((entry) => entry.provisionalDisposition === disposition);
    const mutated = refreshDerivedFields({
      ...structuredClone(ledger),
      occurrences: ledger.occurrences.filter((_, entryIndex) => entryIndex !== index),
    });
    assert.throws(() => assertLedgerShape(mutated));
  }

  const duplicatePosition = structuredClone(ledger);
  duplicatePosition.occurrences[duplicatePosition.occurrences.length - 1].position = duplicatePosition.occurrences[duplicatePosition.occurrences.length - 2].position;
  assert.throws(() => assertLedgerShape(duplicatePosition));

  const proseIndex = ledger.occurrences.findIndex((entry) => entry.sourceNodeIndex === 36 && entry.sourceText === 'Avengers #115');
  assert.notEqual(proseIndex, -1);
  const proseMutated = structuredClone(ledger);
  proseMutated.occurrences[proseIndex].provisionalDisposition = 'exclusion';
  proseMutated.occurrences[proseIndex].reason = 'prose marker';
  assert.throws(() => assertLedgerShape(refreshDerivedFields(proseMutated)));

  const droppedRangeMember = structuredClone(ledger);
  const rangeMemberIndex = droppedRangeMember.occurrences.findIndex(
    (entry) => entry.sourceNodeIndex === 9 && entry.issueNumber === '50',
  );
  droppedRangeMember.occurrences.splice(rangeMemberIndex, 1);
  assert.throws(() => assertLedgerShape(refreshDerivedFields(droppedRangeMember)));

  const missingSourceNode = structuredClone(ledger);
  missingSourceNode.occurrences = missingSourceNode.occurrences.filter((entry) => entry.sourceNodeIndex !== 159);
  assert.throws(() => assertLedgerShape(refreshDerivedFields(missingSourceNode)));
});
