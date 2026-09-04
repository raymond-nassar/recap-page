import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  sourcePositionsForPacket,
  sourceGapResolutionDigestFor,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const EXPECTED = {
  occurrenceCount: 331,
  occurrenceCounts: {
    'canonical-candidate': 268,
    repeat: 12,
    gap: 0,
    exclusion: 51,
  },
  sourceNodeCount: 70,
  groupCount: 8,
  normalizedSourceHash: 'ba565f11535ef1a18a779f18e6d69bb27b0b2bec18cd54e9172d9bf86778204f',
  sourceNodeOrderHash: '375cab20c00dcbc88370d81d5a47ef6ed805fd7b2a7d3e5b2728518f85416797',
  sourceBoundary: {
    contentSha256: 'a160548ac1308afd403c0338e214f14a33097424e26ec10bfe69425d1ac91c83',
    issueBearingBlocksSha256: '87b0596da4099aa56135fed39fa44058336b02550365e2b570d183fb2bdd46e8',
  },
  groupCounts: [12, 141, 72, 25, 29, 15, 16, 21],
  repeatPositions: [43, 44, 45, 46, 58, 59, 60, 61, 195, 196, 197, 305],
  partialMaterialPositions: [75, 76, 77, 121, 324, 325],
  exclusionCategoryCounts: {
    'boundary marker': 1,
    'collection marker': 30,
    'partial material reference': 6,
    'prose marker': 6,
    'section marker': 8,
  },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'the-defenders-reading-order.json');
const inventoryPath = path.join(root, 'scripts', 'data', 'cbh-character-inventory.json');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

async function readLedger() {
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

async function readInventory() {
  return JSON.parse(await readFile(inventoryPath, 'utf8'));
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
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

function occurrenceSnapshot(entry) {
  return {
    position: entry.position,
    sourceText: entry.sourceText,
    normalizedSeriesTitle: entry.normalizedSeriesTitle,
    seriesYear: entry.seriesYear,
    issueNumber: entry.issueNumber,
    provisionalDisposition: entry.provisionalDisposition,
    repeatOfPosition: entry.repeatOfPosition ?? null,
    collectionTitle: entry.collectionTitle,
  };
}

function assertNodeInheritance(ledger) {
  const issueLike = ledger.occurrences.filter((entry) => entry.sourceType === 'issue' || entry.sourceType === 'partial-material');
  const grouped = new Map();
  issueLike.forEach((entry) => {
    if (!grouped.has(entry.sourceNodeIndex)) grouped.set(entry.sourceNodeIndex, []);
    grouped.get(entry.sourceNodeIndex).push(entry);
  });
  for (const [nodeIndex, entries] of grouped.entries()) {
    assert.equal(entries.length > 0, true, `source node ${nodeIndex} should include issue-bearing entries`);
    assert.equal(new Set(entries.map((entry) => entry.sourceRangeReference)).size, 1, `source node ${nodeIndex} should preserve one range reference`);
    assert.equal(new Set(entries.map((entry) => entry.collectionTitle)).size, 1, `source node ${nodeIndex} should preserve one collection title`);
  }
}

function assertLedgerShape(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'the-defenders-reading-order');
  assert.equal(ledger.title, 'The Defenders');
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/the-defenders-reading-order/');
  assert.equal(ledger.sourcePageTitle, 'The Defenders Reading Order - Comic Book Herald');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-27');
  assert.equal(ledger.sourceBoundary.scope, 'full page');
  assert.equal(ledger.sourceBoundary.qualifyingSection, null);
  assert.match(ledger.sourceBoundary.reason, /full article is the permitted boundary/i);
  assert.match(ledger.sourceBoundary.contrarianCheck, /no qualifying Best Comics or Essential Comics section/i);
  assert.equal(ledger.sourceBoundary.firstHeading, 'The Defenders Reading Order');
  assert.equal(ledger.sourceBoundary.lastHeading, 'Latest Additions');
  assert.equal(ledger.sourceBoundary.contentSha256, EXPECTED.sourceBoundary.contentSha256);
  assert.equal(ledger.sourceBoundary.issueBearingBlockCount, 25);
  assert.equal(ledger.sourceBoundary.issueBearingBlocksSha256, EXPECTED.sourceBoundary.issueBearingBlocksSha256);
  assert.equal(ledger.sourceBoundary.contentSha256.length, 64);
  assert.equal(ledger.sourceBoundary.issueBearingBlocksSha256.length, 64);
  assert.equal(ledger.occurrenceCount, EXPECTED.occurrenceCount);
  assert.equal(ledger.occurrences.length, EXPECTED.occurrenceCount);
  assert.deepEqual(ledger.occurrenceCounts, EXPECTED.occurrenceCounts);
  assert.equal(ledger.groupCount, EXPECTED.groupCount);
  assert.equal(ledger.provenanceGroupCount, ledger.groupCount);
  assert.equal(ledger.sourceNodeCount, EXPECTED.sourceNodeCount);
  assert.equal(ledger.normalizedSourceHash, EXPECTED.normalizedSourceHash);
  assert.equal(ledger.sourceNodeOrderHash, EXPECTED.sourceNodeOrderHash);
  assert.deepEqual(
    ledger.occurrences.map((entry) => entry.position),
    Array.from({ length: EXPECTED.occurrenceCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'repeat').map((entry) => entry.position),
    EXPECTED.repeatPositions,
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'gap').map((entry) => entry.position),
    [],
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.sourceType === 'partial-material').map((entry) => entry.position),
    EXPECTED.partialMaterialPositions,
  );
  const derivedExclusionCategories = exclusionCategories(ledger);
  assert.deepEqual(
    Object.fromEntries(Object.entries(derivedExclusionCategories).map(([reason, positions]) => [reason, positions.length])),
    EXPECTED.exclusionCategoryCounts,
  );
  assert.deepEqual(
    [...new Map(ledger.occurrences.map((entry) => [entry.sourceGroup, 0])).keys()].map(
      (group) => ledger.occurrences.filter((entry) => entry.sourceGroup === group).length,
    ),
    EXPECTED.groupCounts,
  );
  assert.equal(ledger.occurrences.every((entry) => typeof entry.sourceRangeReference === 'string' && entry.sourceRangeReference.length > 0), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'issue').every((entry) => typeof entry.collectionTitle === 'string' && entry.collectionTitle.length > 0), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'partial-material').every((entry) => typeof entry.collectionTitle === 'string' && entry.collectionTitle.length > 0), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'prose').every((entry) => entry.provisionalDisposition === 'exclusion' && entry.reason === 'prose marker'), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'collection').every((entry) => entry.provisionalDisposition === 'exclusion' && entry.reason === 'collection marker'), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'h2').every((entry) => entry.provisionalDisposition === 'exclusion' && entry.reason === 'section marker'), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'figure').every((entry) => entry.provisionalDisposition === 'exclusion' && entry.reason === 'boundary marker'), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.sourceType === 'partial-material').every((entry) => entry.provisionalDisposition === 'exclusion' && entry.reason === 'partial material reference'), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'repeat').every((entry) => typeof entry.repeatOfPosition === 'number' && entry.repeatOfPosition < entry.position), true);
  assert.equal(ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'canonical-candidate').some((entry) => entry.issueNumber == null), true);
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.provisionalDisposition === 'canonical-candidate' && entry.issueNumber == null).map(occurrenceSnapshot),
    [{
      position: 303,
      sourceText: 'Free Comic Book Day 2017 (Defenders Story)',
      normalizedSeriesTitle: 'Free Comic Book Day 2017 (Defenders Story)',
      seriesYear: 2017,
      issueNumber: null,
      provisionalDisposition: 'canonical-candidate',
      repeatOfPosition: null,
      collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
    }],
  );
  assertNodeInheritance(ledger);
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.sourceNodeIndex === 19).map(occurrenceSnapshot),
    [
      {
        position: 43,
        sourceText: '#115',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '115',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 38,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 44,
        sourceText: '#116',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '116',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 39,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 45,
        sourceText: '#117',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '117',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 40,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 46,
        sourceText: '#118',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '118',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 41,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 47,
        sourceText: '#119',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '119',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 48,
        sourceText: '#120',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '120',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 49,
        sourceText: '#121',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '121',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 50,
        sourceText: '#122',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '122',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 51,
        sourceText: '#123',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '123',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 52,
        sourceText: '#124',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '124',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 53,
        sourceText: '#125',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '125',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 54,
        sourceText: '#126',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '126',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 55,
        sourceText: '#127',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '127',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 56,
        sourceText: '#128',
        normalizedSeriesTitle: 'Avengers (1963)',
        seriesYear: 1963,
        issueNumber: '128',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 57,
        sourceText: '#1',
        normalizedSeriesTitle: 'Giant-Size (1974)',
        seriesYear: 1974,
        issueNumber: '1',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 58,
        sourceText: '#8',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '8',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 28,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 59,
        sourceText: '#9',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '9',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 29,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 60,
        sourceText: '#10',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '10',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 30,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 61,
        sourceText: '#11',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '11',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 31,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 62,
        sourceText: '#33',
        normalizedSeriesTitle: 'Captain Marvel (1968)',
        seriesYear: 1968,
        issueNumber: '33',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
      {
        position: 63,
        sourceText: '#150',
        normalizedSeriesTitle: 'Fantastic Four (1961)',
        seriesYear: 1961,
        issueNumber: '150',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Avengers Epic Collection: The Avengers/Defenders War',
      },
    ],
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.sourceNodeIndex === 36).map(occurrenceSnapshot),
    [
      {
        position: 195,
        sourceText: '#122',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '122',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 189,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 196,
        sourceText: '#123',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '123',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 190,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 197,
        sourceText: '#124',
        normalizedSeriesTitle: 'Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '124',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 191,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 198,
        sourceText: '#125',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '125',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 199,
        sourceText: '#126',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '126',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 200,
        sourceText: '#127',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '127',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 201,
        sourceText: '#128',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '128',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 202,
        sourceText: '#129',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '129',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 203,
        sourceText: '#130',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '130',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
      {
        position: 204,
        sourceText: '#131',
        normalizedSeriesTitle: 'New Defenders (1972)',
        seriesYear: 1972,
        issueNumber: '131',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'New Defenders Vol. 1',
      },
    ],
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.sourceNodeIndex === 61).map(occurrenceSnapshot),
    [
      {
        position: 297,
        sourceText: '#1',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '1',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 298,
        sourceText: '#2',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '2',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 299,
        sourceText: '#3',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '3',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 300,
        sourceText: '#4',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '4',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 301,
        sourceText: '#5',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '5',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 302,
        sourceText: '#6',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '6',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
      {
        position: 303,
        sourceText: 'Free Comic Book Day 2017 (Defenders Story)',
        normalizedSeriesTitle: 'Free Comic Book Day 2017 (Defenders Story)',
        seriesYear: 2017,
        issueNumber: null,
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 1: Diamonds Are Forever',
      },
    ],
  );
  assert.deepEqual(
    ledger.occurrences.filter((entry) => entry.sourceNodeIndex === 63).map(occurrenceSnapshot),
    [
      {
        position: 305,
        sourceText: '#6',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '6',
        provisionalDisposition: 'repeat',
        repeatOfPosition: 302,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
      {
        position: 306,
        sourceText: '#7',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '7',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
      {
        position: 307,
        sourceText: '#8',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '8',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
      {
        position: 308,
        sourceText: '#9',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '9',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
      {
        position: 309,
        sourceText: '#10',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '10',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
      {
        position: 310,
        sourceText: '#11',
        normalizedSeriesTitle: 'Defenders (2017)',
        seriesYear: 2017,
        issueNumber: '11',
        provisionalDisposition: 'canonical-candidate',
        repeatOfPosition: null,
        collectionTitle: 'Defenders Vol. 2: Kingpins of New York',
      },
    ],
  );
}

test('The Defenders inventory row points at the new source evidence', async () => {
  const inventory = await readInventory();
  const ledger = await readLedger();
  const record = inventory.find((entry) => entry.id === 'the-defenders-reading-order');

  assert.ok(record);
  assert.equal(record.sourceRetrievedAt, ledger.sourceRetrievedAt);
  assert.equal(record.sourceContentSha256, ledger.sourceBoundary.contentSha256);
  assert.equal(record.sourceBoundaryStatus, 'exact-page-snapshot');
  assert.equal(record.metadataHorizonStatus, 'approved');
  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'shipped');
  assert.deepEqual(record.catalogIds, ['the-defenders-reading-order']);
  assert.equal(record.overlapIds.length, 20);
  assert.match(record.reason, /331-occurrence/i);
  assert.match(record.reason, /259 exact metadata rows/i);
  assert.match(record.reason, /20 backward repeats/i);
  assert.match(record.reason, /zero metadata gaps/i);
  assert.match(record.reason, /52 semantic exclusions/i);
  assert.match(record.reason, /current-library relationship/i);
});

test('The Defenders source ledger preserves the full boundary and order', async () => {
  const ledger = await readLedger();
  assert.doesNotThrow(() => assertLedgerShape(ledger));
});

test('The Defenders source ledger rejects the known defect shapes', async () => {
  const ledger = await readLedger();

  assert.throws(() => assertLedgerShape(refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: ledger.occurrences.slice(0, -1),
  })));

  assert.throws(() => assertLedgerShape(refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: ledger.occurrences.filter((entry) => entry.sourceNodeIndex !== 61),
  })));

  const sorted = refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: [...ledger.occurrences].sort((left, right) => (
      `${left.provisionalDisposition}:${left.sourceGroup}:${left.sourceText}`
        .localeCompare(`${right.provisionalDisposition}:${right.sourceGroup}:${right.sourceText}`)
    )),
  });
  assert.throws(() => assertLedgerShape(sorted));

  const duplicatePosition = structuredClone(ledger);
  duplicatePosition.occurrences[duplicatePosition.occurrences.length - 1].position = duplicatePosition.occurrences[duplicatePosition.occurrences.length - 2].position;
  assert.throws(() => assertLedgerShape(duplicatePosition));

  for (const disposition of ['canonical-candidate', 'repeat', 'exclusion']) {
    const index = ledger.occurrences.findIndex((entry) => entry.provisionalDisposition === disposition);
    const mutated = refreshDerivedFields({
      ...structuredClone(ledger),
      occurrences: ledger.occurrences.filter((_, entryIndex) => entryIndex !== index),
    });
    assert.throws(() => assertLedgerShape(mutated));
  }

  const droppedRangeMember = refreshDerivedFields({
    ...structuredClone(ledger),
    occurrences: ledger.occurrences.filter((entry) => entry.position !== 199),
  });
  assert.throws(() => assertLedgerShape(droppedRangeMember));

  const proseMutation = structuredClone(ledger);
  proseMutation.occurrences[0] = {
    ...proseMutation.occurrences[0],
    sourceType: 'issue',
    normalizedSeriesTitle: 'The Defenders (1972)',
    seriesYear: 1972,
    issueNumber: '1',
    provisionalDisposition: 'canonical-candidate',
    reason: null,
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(proseMutation)));

  const titleOnlyRepeat = structuredClone(ledger);
  titleOnlyRepeat.occurrences[304] = {
    ...titleOnlyRepeat.occurrences[304],
    normalizedSeriesTitle: 'Defenders',
    seriesYear: null,
    issueNumber: '6',
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(titleOnlyRepeat)));

  const blankGap = structuredClone(ledger);
  blankGap.occurrences[6] = {
    ...blankGap.occurrences[6],
    sourceType: 'gap',
    sourceText: '',
    sourceRangeReference: '',
    normalizedSeriesTitle: null,
    seriesYear: null,
    issueNumber: null,
    provisionalDisposition: 'gap',
    reason: 'blank issue marker',
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(blankGap)));

  const mixedPartialMaterial = structuredClone(ledger);
  mixedPartialMaterial.occurrences[323] = {
    ...mixedPartialMaterial.occurrences[323],
    sourceType: 'issue',
    normalizedSeriesTitle: 'Marvel Comics (2019)',
    seriesYear: 2019,
    provisionalDisposition: 'canonical-candidate',
    reason: null,
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(mixedPartialMaterial)));

  const namedWorkAsGap = structuredClone(ledger);
  namedWorkAsGap.occurrences[302] = {
    ...namedWorkAsGap.occurrences[302],
    sourceType: 'gap',
    provisionalDisposition: 'gap',
    reason: 'blank issue marker',
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(namedWorkAsGap)));

  const inheritedRangeIdentityLoss = structuredClone(ledger);
  inheritedRangeIdentityLoss.occurrences[304] = {
    ...inheritedRangeIdentityLoss.occurrences[304],
    collectionTitle: null,
  };
  assert.throws(() => assertLedgerShape(refreshDerivedFields(inheritedRangeIdentityLoss)));
});

test('The Defenders publication preserves the settled source partition and exact resolution', async () => {
  const [packet, mapping, report, manifest, catalog, inventory, generated, markdown] = await Promise.all([
    readJson('scripts/data/cbh-packets/the-defenders-reading-order.json'),
    readJson('scripts/data/cbh-mappings/the-defenders-reading-order.json'),
    readJson('scripts/data/cbh-overlaps/the-defenders-reading-order.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson('src/data/the_defenders_reading_order.json'),
    readFile(path.join(root, 'src/data/orders/the-defenders-reading-order.md'), 'utf8'),
  ]);
  const exactResolutions = [
    [102, 57812],
    [199, 20292], [200, 20293], [201, 20294], [202, 20295], [203, 20297], [204, 20298],
    [267, 39757], [268, 39762], [269, 39763], [270, 39758], [271, 39759], [272, 39761],
    [274, 39760], [275, 39767], [276, 39766], [277, 39765], [278, 39764], [279, 39756],
    [303, 62818],
  ];
  const repeatResolutions = [
    [57, 22, 20026],
    [198, 155, 20291],
  ];
  const addedRepeatRows = [
    [57, 22], [198, 155], [206, 157], [207, 158], [208, 159],
    [209, 160], [210, 161], [211, 162],
  ];
  const expectedNonNone = [
    ['agatha-harkness-reading-order', 'partial', 3],
    ['avengers-defenders-war', 'existing-subset', 8],
    ['black-widow-reading-order', 'partial', 1],
    ['captain-marvel-ms-marvel-reading-order', 'partial', 3],
    ['daredevil-reading-order', 'partial', 10],
    ['doctor-strange-reading-order', 'partial', 182],
    ['fantastic-four-reading-order', 'partial', 2],
    ['guardians-of-the-galaxy-reading-order', 'partial', 6],
    ['loki-reading-order', 'partial', 14],
    ['magneto-reading-order', 'partial', 2],
    ['moon-knight-reading-order', 'partial', 4],
    ['punisher-reading-order', 'partial', 6],
    ['question-of-the-week-do-you-have-a-hulk-reading-order', 'partial', 16],
    ['scarlet-witch-best-of', 'partial', 1],
    ['silver-surfer-reading-order', 'partial', 43],
    ['star-lord-reading-order', 'partial', 1],
    ['thanos-reading-order', 'partial', 2],
    ['thanos-war', 'partial', 2],
    ['white-tiger-ava-ayala', 'partial', 1],
    ['xmen-claremont-complete', 'partial', 2],
  ];

  for (const [sourcePosition, issueId] of exactResolutions) {
    assert.equal(
      mapping.rows.find((row) => row.sourcePosition === sourcePosition)?.selectedIssueId,
      issueId,
      `Defenders source position ${sourcePosition} must resolve to issue ${issueId}`,
    );
  }
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: 'the-defenders-reading-order',
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));
  assert.equal(packet.sourceOccurrenceCount, 331);
  assert.equal(packet.rows.length, 259);
  assert.equal(packet.sourceGaps, undefined);
  assert.equal(packet.sourceGapResolutions.length, 23);
  assert.equal(packet.repeatedSourceReferences.length, 20);
  assert.equal(packet.excludedSourceRows.length, 52);
  assert.equal(packet.rows.length + packet.repeatedSourceReferences.length
    + packet.excludedSourceRows.length, 331);
  assert.deepEqual(
    packet.repeatedSourceReferences
      .filter((entry) => addedRepeatRows.some(([position]) => position === entry.sourcePosition))
      .map((entry) => [entry.sourcePosition, entry.canonicalRow]),
    addedRepeatRows,
  );
  assert.deepEqual(
    packet.sourceGapResolutions
      .filter((entry) => entry.resolutionKind === 'exact-issue')
      .map((entry) => [entry.sourcePosition, entry.selectedIssueId]),
    exactResolutions,
  );
  assert.deepEqual(
    packet.sourceGapResolutions
      .filter((entry) => entry.resolutionKind === 'canonical-repeat')
      .map((entry) => [entry.sourcePosition, entry.canonicalRow, entry.selectedIssueId]),
    repeatResolutions,
  );
  assert.deepEqual(
    packet.sourceGapResolutions
      .filter((entry) => entry.resolutionKind === 'source-exclusion')
      .map(({ sourcePosition, decisionScope }) => [sourcePosition, decisionScope]),
    [[310, 'Owner-authorized nonexistent-identity exclusion']],
  );
  assert.ok(packet.sourceGapResolutions.every((resolution) => (
    resolution.evidenceDigest === sourceGapResolutionDigestFor(resolution)
      && resolution.evidenceSources.some((source) => (
        source.kind === 'owner-availability-review'
          && source.url === 'https://github.com/raymond-nassar/recap-page/issues/317'
      ))
  )));
  assert.equal(
    digestCanonicalJson(packet.sourceGapResolutions),
    '6428c9ed9818c1eaa45868a110fe274f1c115343076c0a3658ed964e4121a656',
  );
  assert.deepEqual(
    sourcePositionsForPacket(packet),
    mapping.rows.map((row) => row.sourcePosition),
  );
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 259);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(mapping.candidateMetadata.length, 259);
  assert.deepEqual(mapping.sourceGapResolutions, packet.sourceGapResolutions);
  assert.equal(report.candidateCount, 259);
  assert.equal(report.comparisonCount, 164);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'exact').length, 0);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'none').length, 144);
  assert.deepEqual(
    report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => [comparison.orderId, comparison.relationship, comparison.sharedCount]),
    expectedNonNone,
  );
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.equal(mapping.relationshipReview.authorityIdentity, 'GPT-5.6 Sol');
  assert.equal(generated.count, 259);
  assert.equal(generated.placeholders, 0);
  assert.equal(generated.unresolved.length, 0);
  assert.equal(new Set(generated.items.map((item) => item.issueId)).size, 259);
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 259);
  assert.equal(parsed.unresolved.length, 0);
  assert.match(markdown, /issue\/39761\/defenders_2011_6/);
  assert.match(markdown, /issue\/62818\/free_comic_book_day_all-new_guardians_of_the_galaxy_2017/);
  const manifestEntry = manifest.lists.find((candidate) => candidate.id === 'the-defenders-reading-order');
  const catalogEntry = catalog.lists.find((candidate) => candidate.id === 'the-defenders-reading-order');
  const inventoryEntry = inventory.find((candidate) => candidate.id === 'the-defenders-reading-order');
  assert.ok(manifestEntry);
  assert.ok(catalogEntry);
  assert.ok(inventoryEntry);
  assert.equal(manifestEntry.expect, 259);
  assert.equal(catalogEntry.count, 259);
  assert.equal(catalogEntry.placeholderCount, 0);
  assert.equal(manifestEntry.coverIssueId, 17089);
  assert.deepEqual(inventoryEntry.overlapIds, expectedNonNone.map(([id]) => id));
});
