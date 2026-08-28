import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'young-avengers-reading-order.json');

const EXPECTED = {
  sourceNodeCount: 85,
  sourceOccurrenceCount: 220,
  counts: {
    exclusion: 58,
    exact: 162,
    repeat: 0,
    gap: 0,
  },
  sourceContentSha256: '568c8dcf02bd1566cc3c457c4baffdbf517748c70648df276692b930619a78e3',
  sourceIssueBearingBlocksSha256: 'e4c6de73726ffca68ff07aa86d56a14b049d1a012811af113abf5420fa0cf146',
  groupCounts: {
    Prelude: 3,
    'Young Avengers Origins!': 18,
    'Young Avengers Reborn!': 37,
    'Latest Additions:': 27,
  },
  adjacentExclusions: ['Avengers', 'Hawkeye', 'Scarlet Witch', 'War of the Realms', 'Empyre', 'King in Black'],
};

function range(length) {
  return Array.from({ length }, (_, index) => index + 1);
}

function rowsByText(ledger, text) {
  return ledger.occurrences.filter((row) => row.sourceText.includes(text));
}

function validateLedger(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'young-avengers-reading-order');
  assert.equal(ledger.inventoryId, 'young-avengers-reading-order');
  assert.equal(ledger.sourceUrl, 'https://www.comicbookherald.com/young-avengers-reading-order/');
  assert.equal(ledger.sourceRetrievedAt, '2026-08-23');
  assert.equal(ledger.sourceContentSha256, EXPECTED.sourceContentSha256);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, EXPECTED.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceGroupCount, 4);
  assert.equal(ledger.sourceNodeCount, EXPECTED.sourceNodeCount);
  assert.equal(ledger.sourceOccurrenceCount, EXPECTED.sourceOccurrenceCount);
  assert.deepEqual(ledger.counts, EXPECTED.counts);
  assert.deepEqual(ledger.sourceBoundary.adjacentExclusions, EXPECTED.adjacentExclusions);
  assert.equal(ledger.sourceBoundary.scope, 'full page');
  assert.equal(ledger.sourceBoundary.qualifyingSection, null);
  assert.equal(ledger.sourceBoundary.firstHeading, 'Related Reading Orders:');
  assert.equal(ledger.sourceBoundary.lastHeading, 'Latest Additions:');
  assert.equal(ledger.sourceBoundary.lastBlockText, 'Guardians of the Galaxy by Kelly #7');
  assert.equal(ledger.sourceBoundary.firstBlockText.includes('Young Avengers is one of those'), true);
  assert.equal(ledger.sourceBoundary.firstBlockText.includes('Teen Titans'), true);

  assert.deepEqual(
    ledger.sourceNodes.map((node) => node.position),
    range(ledger.sourceNodeCount),
  );
  assert.deepEqual(
    ledger.occurrences.map((row) => row.position),
    range(ledger.sourceOccurrenceCount),
  );

  assert.deepEqual(
    ledger.sourceNodes.reduce((counts, node) => {
      counts[node.sourceGroup] = (counts[node.sourceGroup] || 0) + 1;
      return counts;
    }, {}),
    EXPECTED.groupCounts,
  );

  assert.equal(
    ledger.occurrences.every((row) => row.sourceText && row.sourceText.trim().length > 0),
    true,
  );

  assert.equal(
    ledger.occurrences.some((row) => row.sourceText.includes('Material from') && row.disposition !== 'exclusion'),
    false,
  );

  ledger.occurrences.forEach((row, index) => {
    assert.equal(row.position, index + 1);
    assert.equal(typeof row.sourceBlockPosition, 'number');
    assert.equal(row.sourceBlockPosition >= 1 && row.sourceBlockPosition <= ledger.sourceNodeCount, true);
    assert.equal(typeof row.sourceGroup, 'string');
    assert.equal(typeof row.sourceText, 'string');
    assert.equal(typeof row.sourceReference, 'string');
    assert.equal(['exact', 'exclusion', 'repeat', 'gap'].includes(row.disposition), true);

    if (row.disposition === 'exact') {
      assert.equal(typeof row.sourceRangeReference, 'string');
      assert.equal(typeof row.sourceClauseKind, 'string');
      assert.equal(typeof row.normalizedSeriesTitle, 'string');
      assert.equal(row.normalizedSeriesTitle.trim().length > 0, true);
      if (row.issueNumber == null) {
        assert.equal(['named-work-label', 'issue-label'].includes(row.sourceClauseKind), true);
      } else {
        assert.equal(String(row.issueNumber).includes('-'), false);
        assert.equal(String(row.issueNumber).includes(','), false);
      }
    }

    if (row.disposition === 'exclusion') {
      assert.equal(typeof row.exclusionReason, 'string');
      assert.equal(row.exclusionReason.trim().length > 0, true);
      assert.equal(row.issueNumber == null || String(row.issueNumber).trim().length > 0, true);
    }

    if (row.disposition === 'repeat') {
      assert.equal(Number.isInteger(row.repeatOfPosition), true);
      assert.equal(row.repeatOfPosition < row.position, true);
      const original = ledger.occurrences[row.repeatOfPosition - 1];
      assert.equal(Boolean(original), true);
      assert.equal(original.disposition, 'exact');
      assert.equal(row.normalizedSeriesTitle, original.normalizedSeriesTitle);
      assert.equal(row.seriesYear, original.seriesYear);
      assert.equal(String(row.issueNumber), String(original.issueNumber));
    }

    if (row.disposition === 'gap') {
      assert.equal(typeof row.sourceReference, 'string');
      assert.equal(row.sourceReference.trim().length > 0, true);
    }
  });

  assert.equal(rowsByText(ledger, 'Avengers').some((row) => row.disposition === 'exclusion'), true);
  assert.equal(rowsByText(ledger, 'Hawkeye').some((row) => row.disposition === 'exclusion'), true);
  assert.equal(rowsByText(ledger, 'Scarlet Witch').some((row) => row.disposition === 'exclusion'), true);
  assert.equal(rowsByText(ledger, 'War of the Realms').some((row) => row.disposition === 'exclusion'), true);
  assert.equal(rowsByText(ledger, 'Empyre').some((row) => row.disposition === 'exclusion'), true);
  assert.equal(rowsByText(ledger, 'King in Black').some((row) => row.disposition === 'exclusion'), true);

  assert.equal(rowsByText(ledger, 'Collects: Young Avengers 1-12, Special').filter((row) => row.disposition === 'exact').length, 13);
  assert.equal(
    rowsByText(ledger, 'Collects: Young Avengers 1-12, Special').some((row) => row.normalizedSeriesTitle === 'Young Avengers Special' && row.issueNumber == null),
    true,
  );
  assert.equal(rowsByText(ledger, 'Collects: Young Avengers Presents #1-6').filter((row) => row.disposition === 'exact').length, 6);
  assert.equal(rowsByText(ledger, 'Collects: Avengers: The Children').filter((row) => row.disposition === 'exact').length, 11);
  assert.equal(rowsByText(ledger, 'Collects: Young Avengers #1-5, Marvel Now! Point One').filter((row) => row.disposition === 'exact').length, 6);
  assert.equal(
    rowsByText(ledger, 'Collects: Young Avengers #1-5, Marvel Now! Point One').some((row) => row.normalizedSeriesTitle === 'Marvel Now! Point One' && row.issueNumber == null),
    true,
  );
  assert.equal(rowsByText(ledger, 'Collects: Marvel Boy #1 To #6').filter((row) => row.disposition === 'exact').length, 6);
  assert.equal(rowsByText(ledger, 'Collects: Journey Into Mystery 622-636, 626.1').filter((row) => row.disposition === 'exact').length, 16);
  assert.equal(rowsByText(ledger, 'Collects: X-Factor (2020) #1 to #3, #5').filter((row) => row.disposition === 'exact').length, 4);
  assert.equal(rowsByText(ledger, 'Scarlet Witch by Orlando #6').filter((row) => row.disposition === 'exact').length, 1);
  assert.equal(rowsByText(ledger, 'Loki by Watters #3').filter((row) => row.disposition === 'exact').length, 1);
  assert.equal(rowsByText(ledger, 'Guardians of the Galaxy by Kelly #7').filter((row) => row.disposition === 'exact').length, 1);
}

function expectLedgerFailure(ledger, mutator) {
  const draft = structuredClone(ledger);
  mutator(draft);
  assert.throws(() => validateLedger(draft));
}

test('Young Avengers source ledger preserves boundary and order', async () => {
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  validateLedger(ledger);
});

test('Young Avengers source ledger rejects contrarian mutations', async () => {
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  validateLedger(ledger);

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.pop();
    draft.sourceOccurrenceCount -= 1;
    draft.counts[draft.occurrences[draft.occurrences.length - 1].disposition] -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const index = draft.sourceNodes.findIndex((node) => node.text.includes('Children'));
    assert.equal(index > -1, true);
    const sourceBlockPosition = draft.sourceNodes[index].position;
    draft.sourceNodes.splice(index, 1);
    draft.sourceNodes.forEach((node) => {
      if (node.position > sourceBlockPosition) node.position -= 1;
    });
    draft.occurrences = draft.occurrences.filter((row) => row.sourceBlockPosition !== sourceBlockPosition);
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.sort((left, right) => left.disposition.localeCompare(right.disposition));
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences[draft.occurrences.length - 1].position = draft.occurrences[draft.occurrences.length - 2].position;
  });

  expectLedgerFailure(ledger, (draft) => {
    const block = draft.occurrences.find((row) => row.sourceText.includes('Young Avengers Presents #1-6') && row.issueNumber === '1');
    block.issueNumber = '1-6';
  });

  expectLedgerFailure(ledger, (draft) => {
    const prose = draft.occurrences.find((row) => row.sourceText.includes('The concept for Young Avengers launched'));
    prose.disposition = 'exact';
    prose.sourceClauseKind = 'prose';
    prose.normalizedSeriesTitle = 'Young Avengers';
    prose.issueNumber = '1';
    draft.counts.exact += 1;
    draft.counts.exclusion -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const hawkeye = draft.occurrences.find((row) => row.sourceText.includes('Hawkeye (2016) #1-6') && row.issueNumber === '1');
    hawkeye.disposition = 'repeat';
    hawkeye.repeatOfPosition = 1;
    hawkeye.seriesYear = null;
    draft.counts.repeat += 1;
    draft.counts.exact -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const exact = draft.occurrences.find((row) => row.sourceText.includes('Young Avengers #1-5, Marvel Now! Point One') && row.normalizedSeriesTitle === 'Marvel Now! Point One');
    exact.disposition = 'repeat';
    exact.repeatOfPosition = exact.position + 1;
    draft.counts.repeat += 1;
    draft.counts.exact -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const gap = draft.occurrences.find((row) => row.sourceText.includes('Marvel Now! Point One') && row.normalizedSeriesTitle === 'Marvel Now! Point One');
    gap.disposition = 'gap';
    gap.sourceReference = '';
    gap.sourceRangeReference = '';
    draft.counts.gap += 1;
    draft.counts.exact -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const namedGap = draft.occurrences.find((row) => row.sourceText.includes('Young Avengers 1-12, Special') && row.normalizedSeriesTitle === 'Young Avengers Special');
    namedGap.disposition = 'gap';
    namedGap.sourceReference = '';
    namedGap.sourceRangeReference = '';
    draft.counts.gap += 1;
    draft.counts.exact -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const material = draft.occurrences.find((row) => row.sourceText.includes('War of the Realms'));
    material.disposition = 'exact';
    material.sourceText = 'Material from War of the Realms';
    material.sourceClauseKind = 'partial-material';
    material.normalizedSeriesTitle = 'War of the Realms';
    material.seriesYear = null;
    material.issueNumber = null;
    draft.counts.exact += 1;
    draft.counts.exclusion -= 1;
  });

  expectLedgerFailure(ledger, (draft) => {
    const partial = draft.occurrences.find((row) => row.sourceText.includes('Collects: Avengers: The Children'));
    partial.issueNumber = '1-9';
  });

  for (const disposition of ['exact', 'exclusion']) {
    expectLedgerFailure(ledger, (draft) => {
      const index = draft.occurrences.findIndex((row) => row.disposition === disposition);
      draft.occurrences.splice(index, 1);
      draft.counts[disposition] -= 1;
      draft.sourceOccurrenceCount -= 1;
    });
  }
});
