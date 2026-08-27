import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import test from 'node:test';

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
  assert.equal(ledger.occurrenceCount, ledger.occurrences.length);
  assert.equal(ledger.groupCount, new Set(ledger.occurrences.map((entry) => entry.sourceGroup)).size);
  assert.equal(ledger.groupCount, 8);
  assert.equal(ledger.normalizedSourceHash, normalizedDigest(ledger));
  assert.equal(ledger.sourceNodeOrderHash, orderDigest(ledger));
  const counts = ledger.occurrences.reduce((acc, entry) => {
    acc[entry.provisionalDisposition] = (acc[entry.provisionalDisposition] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(ledger.occurrenceCounts, counts);
  assert.equal(counts['canonical-candidate'] > 0, true);
  assert.equal(counts.repeat > 0, true);
  assert.equal(counts.gap > 0, true);
  assert.equal(counts.exclusion > 0, true);
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
    } else {
      assert.equal(entry.repeatOfPosition == null, true);
    }
    if (entry.provisionalDisposition === 'gap') {
      assert.equal(entry.sourceText, 'Issues:');
    }
  });
}

test('Silver Surfer source ledger preserves the full boundary and order', async () => {
  const ledger = await readLedger();
  assert.doesNotThrow(() => assertLedgerShape(ledger));
});

test('Silver Surfer source ledger rejects the known defect shapes', async () => {
  const ledger = await readLedger();

  assert.throws(() => assertLedgerShape({
    ...ledger,
    occurrences: ledger.occurrences.slice(0, -1),
  }));

  assert.throws(() => assertLedgerShape({
    ...ledger,
    occurrences: [...ledger.occurrences].sort((left, right) => left.provisionalDisposition.localeCompare(right.provisionalDisposition)),
  }));

  for (const disposition of ['canonical-candidate', 'repeat', 'gap', 'exclusion']) {
    const index = ledger.occurrences.findIndex((entry) => entry.provisionalDisposition === disposition);
    const mutated = {
      ...ledger,
      occurrences: ledger.occurrences.filter((_, entryIndex) => entryIndex !== index),
    };
    assert.throws(() => assertLedgerShape(mutated));
  }

  const duplicatePosition = ledger.occurrences.map((entry) => ({ ...entry }));
  duplicatePosition[duplicatePosition.length - 1].position = duplicatePosition[duplicatePosition.length - 2].position;
  assert.throws(() => assertLedgerShape({ ...ledger, occurrences: duplicatePosition }));

  const proseIndex = ledger.occurrences.findIndex((entry) => /Silver Surfer duels the Hulk/i.test(entry.sourceText));
  assert.notEqual(proseIndex, -1);
  const proseMutated = ledger.occurrences.map((entry) => ({ ...entry }));
  proseMutated[proseIndex].provisionalDisposition = 'exclusion';
  assert.throws(() => assertLedgerShape({ ...ledger, occurrences: proseMutated }));
});
