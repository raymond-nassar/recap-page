import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(root, 'scripts', 'data', 'cbh-source-ledgers', 'x-force-stage-a-source-ledger.json');
const EXPECTED = {
  sourceNodeCount: 71,
  occurrenceCount: 409,
  occurrenceCounts: {
    'canonical-candidate': 285,
    repeat: 81,
    gap: 0,
    'semantic-exclusion': 43,
  },
  sourceGroupsSha256: '0b391bb17468b480db2bf19001343e23f28ef4dab38ccec56d18ff90ecd4bdd4',
  sourceContentSha256: '6efc1e3a4a60bc2a77c7179c6738e9f9f94c90cbd98fed3a46458d54c0109664',
  sourceNodeOrderSha256: '3151f7f5c511cc66e64670366006ad79a3392472be0bade6892ec27e120d03b2',
  occurrenceContentSha256: 'de3ac8372686c68b66e0dd2f9ac19779b911da83dd07fb9de949778c274f47e2',
  occurrenceOrderSha256: '971e11fbf0384d5be2f6571f29bc33b8c7b5f527b7abf8d04e8d394b6ad3115b',
  repeatAuditSha256: '5ba8e0941117a7c81d919ab3f4fb64f5d83da4dd65049f2916af4f32cf02eee7',
  gapAuditSha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clone(value) {
  return structuredClone(value);
}

async function readLedger() {
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

function sourceContent(ledger) {
  return ledger.sourceNodes.map(({ index, tag, text }) => ({ index, tag, text }));
}

function sourceOrder(ledger) {
  return ledger.sourceNodes.map(({ index, tag, sourceGroup, kind }) => ({
    index,
    tag,
    sourceGroup,
    kind,
  }));
}

function sourceGroups(ledger) {
  return ledger.sourceGroups;
}

function occurrenceContent(occurrences) {
  return occurrences.map(({ position: _position, ...occurrence }) => occurrence);
}

function occurrenceOrder(occurrences) {
  return occurrences.map(({
    position,
    sourceNodeIndex,
    sourceCaption,
    identityKey,
    disposition,
    repeatOfPosition,
  }) => ({
    position,
    sourceNodeIndex,
    sourceCaption,
    identityKey,
    disposition,
    repeatOfPosition,
  }));
}

function repeatAudit(occurrences) {
  return occurrences
    .filter(({ disposition }) => disposition === 'repeat')
    .map(({
      position,
      identityKey,
      repeatOfPosition,
      sourceNodeIndex,
      normalizedSeriesTitle,
      seriesYear,
      issueNumber,
    }) => ({
      position,
      identityKey,
      repeatOfPosition,
      sourceNodeIndex,
      normalizedSeriesTitle,
      seriesYear,
      issueNumber,
    }));
}

function gapAudit(occurrences) {
  return occurrences
    .filter(({ disposition }) => disposition === 'gap')
    .map(({ position, sourceNodeIndex, sourceCaption, reason }) => ({
      position,
      sourceNodeIndex,
      sourceCaption,
      reason,
    }));
}

function identityFor(entry, issueNumber) {
  assert.equal(typeof entry.normalizedSeriesTitle, 'string');
  assert.notEqual(entry.normalizedSeriesTitle.trim(), '');

  if (entry.identityKind === 'issue') {
    assert.equal(Number.isInteger(entry.seriesYear), true);
    assert.match(String(issueNumber), /^\d+(?:\.\d+)?$/);
    assert.doesNotMatch(String(issueNumber), /^\d{4}$/);
    return `issue|${entry.normalizedSeriesTitle.toLocaleLowerCase()}|${entry.seriesYear}|${issueNumber}`;
  }

  assert.equal(entry.identityKind, 'named-work');
  assert.equal(issueNumber == null || /^\d+(?:\.\d+)?$/.test(String(issueNumber)), true);
  return `named-work|${entry.normalizedSeriesTitle.toLocaleLowerCase()}|${entry.seriesYear}|${issueNumber}`;
}

function validateInheritedIdentity(entry) {
  if (!entry.inheritedIdentity) return;

  const { seriesTitle, seriesYear, issueNumber, rationale } = entry.inheritedIdentity;
  assert.equal(typeof seriesTitle, 'string');
  assert.notEqual(seriesTitle.trim(), '');
  assert.equal(Number.isInteger(seriesYear), true);
  assert.equal(typeof issueNumber, 'string');
  assert.notEqual(issueNumber.trim(), '');
  assert.equal(typeof rationale, 'string');
  assert.notEqual(rationale.trim(), '');
}

function deriveOccurrences(ledger) {
  const occurrences = [];
  const seen = new Map();

  for (const node of ledger.sourceNodes) {
    assert.equal(['h2', 'h3', 'p'].includes(node.tag), true, `source node ${node.index} tag`);
    assert.equal(typeof node.text, 'string', `source node ${node.index} text`);
    assert.equal(typeof node.sourceGroup, 'string', `source node ${node.index} group`);

    if (!Object.hasOwn(node, 'entries')) {
      assert.equal(typeof node.reason, 'string', `contextual source node ${node.index} reason`);
      assert.notEqual(node.reason.trim(), '', `contextual source node ${node.index} reason`);
      occurrences.push({
        position: occurrences.length + 1,
        sourceGroup: node.sourceGroup,
        sourceNodeIndex: node.index,
        sourceNodeTag: node.tag,
        sourceNodeKind: node.kind,
        sourceType: node.kind,
        sourceCaption: node.text,
        sourceProvenance: node.text,
        sourceRangeReference: node.text,
        normalizedSeriesTitle: null,
        seriesYear: null,
        issueNumber: null,
        inheritedIdentity: null,
        identityKey: null,
        disposition: 'semantic-exclusion',
        repeatOfPosition: null,
        reason: node.reason,
      });
      continue;
    }

    assert.equal(node.kind, 'issue-clause', `issue-bearing source node ${node.index} cannot be prose`);
    assert.equal(Array.isArray(node.entries), true, `source node ${node.index} entries`);
    assert.equal(node.entries.length > 0, true, `source node ${node.index} entries`);

    for (const entry of node.entries) {
      assert.equal(typeof entry.sourceType, 'string');
      assert.equal(typeof entry.sourceCaption, 'string');
      assert.equal(typeof entry.sourceRangeReference, 'string');
      assert.equal(node.text.includes(entry.sourceCaption), true, `source caption at node ${node.index}`);
      assert.equal(node.text.includes(entry.sourceRangeReference), true, `source range at node ${node.index}`);
      assert.equal(Array.isArray(entry.issueNumbers), true, `source node ${node.index} has unexpanded issues`);
      assert.equal(entry.issueNumbers.length > 0, true, `source node ${node.index} has no issue occurrences`);
      validateInheritedIdentity(entry);

      const isPartialMaterial = entry.sourceType === 'partial-material';
      if (isPartialMaterial) {
        assert.equal(entry.identityKind, 'partial-material');
        assert.equal(entry.disposition, 'semantic-exclusion');
        assert.equal(typeof entry.reason, 'string');
        assert.notEqual(entry.reason.trim(), '');
      } else {
        assert.equal(['issue-range', 'named-work'].includes(entry.sourceType), true);
        assert.equal(Object.hasOwn(entry, 'disposition'), false, `included entry at node ${node.index} cannot be preclassified`);
        if (entry.sourceType === 'named-work') {
          assert.equal(
            entry.issueNumbers.every((issueNumber) => issueNumber == null || /^\d+(?:\.\d+)?$/.test(String(issueNumber))),
            true,
            `named work at node ${node.index} keeps only source-supported issue numbers`,
          );
        }
      }

      for (const issueNumber of entry.issueNumbers) {
        const position = occurrences.length + 1;
        let identityKey = null;
        let disposition = 'semantic-exclusion';
        let repeatOfPosition = null;

        if (!isPartialMaterial) {
          identityKey = identityFor(entry, issueNumber);
          if (seen.has(identityKey)) {
            disposition = 'repeat';
            repeatOfPosition = seen.get(identityKey);
          } else {
            disposition = 'canonical-candidate';
            seen.set(identityKey, position);
          }
        }

        occurrences.push({
          position,
          sourceGroup: node.sourceGroup,
          sourceNodeIndex: node.index,
          sourceNodeTag: node.tag,
          sourceNodeKind: node.kind,
          sourceType: entry.sourceType,
          sourceCaption: entry.sourceCaption,
          sourceProvenance: node.text,
          sourceRangeReference: entry.sourceRangeReference,
          normalizedSeriesTitle: entry.normalizedSeriesTitle,
          seriesYear: entry.seriesYear,
          issueNumber,
          inheritedIdentity: entry.inheritedIdentity ?? null,
          identityKey,
          disposition,
          repeatOfPosition,
          reason: entry.reason ?? null,
        });
      }
    }
  }

  return occurrences;
}

function validateLedger(ledger) {
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.id, 'x-force-stage-a-source-ledger');
  assert.equal(ledger.title, 'X-Force');
  assert.equal(ledger.source.url, 'https://www.comicbookherald.com/x-force-reading-order/');
  assert.equal(ledger.source.pageTitle, 'X-Force Reading Order - Comic Book Herald');
  assert.equal(ledger.source.retrievedAt, '2026-08-27');
  assert.equal(ledger.source.snapshotSha256, '8d4fc5bbd34bcecc6e62678968885fab2dc22e1a9ffcb7bcdf10719c4584a4a8');

  assert.equal(ledger.sourceBoundary.scope, 'full entry-content page');
  assert.equal(ledger.sourceBoundary.qualifyingSection, null);
  assert.match(ledger.sourceBoundary.rationale, /no qualifying Best Comics or Essential Comics subsection/i);
  assert.deepEqual(
    ledger.sourceBoundary.headingScan,
    ledger.sourceNodes.filter(({ tag }) => ['h2', 'h3'].includes(tag)).map(({ text }) => text),
  );
  assert.equal(ledger.sourceBoundary.firstHeading, ledger.sourceBoundary.headingScan[0]);
  assert.equal(ledger.sourceBoundary.lastHeading, ledger.sourceBoundary.headingScan.at(-1));

  assert.equal(ledger.sourceNodes.length, EXPECTED.sourceNodeCount);
  assert.equal(ledger.sourceBoundary.sourceNodeCount, ledger.sourceNodes.length);
  assert.equal(ledger.derived.sourceNodeCount, ledger.sourceNodes.length);
  assert.deepEqual(ledger.sourceNodes.map(({ index }) => index), range(1, ledger.sourceNodes.length));

  const groupIds = ledger.sourceGroups.map(({ id }) => id);
  assert.deepEqual(groupIds, [
    'intro',
    'related-reading-orders',
    'x-force-90s',
    'x-force-2000s',
    'x-force-doing-the-jobs',
    'uncanny-x-force',
  ]);
  for (const group of ledger.sourceGroups) {
    const nodes = ledger.sourceNodes.filter(({ index }) => index >= group.firstNodeIndex && index <= group.lastNodeIndex);
    assert.equal(nodes.length > 0, true);
    assert.equal(nodes.every(({ sourceGroup }) => sourceGroup === group.id), true);
    if (group.id !== 'intro') assert.equal(group.heading, nodes[0].text);
  }
  assert.deepEqual(
    ledger.sourceGroups.flatMap(({ firstNodeIndex, lastNodeIndex }) => range(firstNodeIndex, lastNodeIndex)),
    range(1, ledger.sourceNodes.length),
  );

  const issueBearingNodes = ledger.sourceNodes.filter(({ entries }) => Array.isArray(entries) && entries.length > 0);
  assert.equal(ledger.sourceBoundary.issueBearingNodeCount, issueBearingNodes.length);
  assert.equal(issueBearingNodes.length, 30);

  const nodeThirtyTwo = ledger.sourceNodes.find(({ index }) => index === 32);
  assert.match(nodeThirtyTwo.text, /X-Force #1 to #6/);
  assert.equal(nodeThirtyTwo.entries[0].seriesYear, 2004);
  assert.equal(
    ledger.sourceNodes.find(({ index }) => index === 10).entries
      .find(({ sourceCaption }) => sourceCaption === 'Annual 7').seriesYear,
    1984,
  );
  assert.equal(
    ledger.sourceNodes.find(({ index }) => index === 13).entries
      .find(({ sourceCaption }) => sourceCaption === 'Uncanny X-Men #294-297').seriesYear,
    1963,
  );

  const expectedOccurrences = deriveOccurrences(ledger);
  assert.deepEqual(ledger.occurrences, expectedOccurrences);
  assert.equal(expectedOccurrences.length, EXPECTED.occurrenceCount);
  assert.equal(ledger.derived.occurrenceCount, expectedOccurrences.length);
  assert.deepEqual(ledger.occurrences.map(({ position }) => position), range(1, expectedOccurrences.length));

  const sourceNodeIndexes = new Set(ledger.occurrences.map(({ sourceNodeIndex }) => sourceNodeIndex));
  assert.deepEqual([...sourceNodeIndexes], range(1, ledger.sourceNodes.length));

  const counts = Object.fromEntries(
    ['canonical-candidate', 'repeat', 'gap', 'semantic-exclusion'].map((disposition) => [
      disposition,
      expectedOccurrences.filter((occurrence) => occurrence.disposition === disposition).length,
    ]),
  );
  assert.deepEqual(ledger.derived.occurrenceCounts, counts);
  assert.deepEqual(counts, EXPECTED.occurrenceCounts);
  assert.equal(
    Object.values(counts).reduce((total, count) => total + count, 0),
    ledger.derived.occurrenceCount,
  );

  assert.equal(ledger.derived.sourceContentSha256, digest(sourceContent(ledger)));
  assert.equal(ledger.derived.sourceContentSha256, EXPECTED.sourceContentSha256);
  assert.equal(ledger.derived.sourceNodeOrderSha256, digest(sourceOrder(ledger)));
  assert.equal(ledger.derived.sourceNodeOrderSha256, EXPECTED.sourceNodeOrderSha256);
  assert.equal(ledger.derived.sourceGroupsSha256, digest(sourceGroups(ledger)));
  assert.equal(ledger.derived.sourceGroupsSha256, EXPECTED.sourceGroupsSha256);
  assert.equal(ledger.derived.occurrenceContentSha256, digest(occurrenceContent(expectedOccurrences)));
  assert.equal(ledger.derived.occurrenceContentSha256, EXPECTED.occurrenceContentSha256);
  assert.equal(ledger.derived.occurrenceOrderSha256, digest(occurrenceOrder(expectedOccurrences)));
  assert.equal(ledger.derived.occurrenceOrderSha256, EXPECTED.occurrenceOrderSha256);
  assert.equal(ledger.derived.repeatAuditSha256, digest(repeatAudit(expectedOccurrences)));
  assert.equal(ledger.derived.repeatAuditSha256, EXPECTED.repeatAuditSha256);
  assert.equal(ledger.derived.gapAuditSha256, digest(gapAudit(expectedOccurrences)));
  assert.equal(ledger.derived.gapAuditSha256, EXPECTED.gapAuditSha256);

  const positions = new Map(expectedOccurrences.map((occurrence) => [occurrence.position, occurrence]));
  for (const occurrence of expectedOccurrences.filter(({ disposition }) => disposition === 'repeat')) {
    const canonical = positions.get(occurrence.repeatOfPosition);
    assert.notEqual(canonical, undefined);
    assert.equal(canonical.position < occurrence.position, true);
    assert.equal(canonical.disposition, 'canonical-candidate');
    assert.equal(canonical.identityKey, occurrence.identityKey);
    assert.equal(canonical.normalizedSeriesTitle, occurrence.normalizedSeriesTitle);
    assert.equal(canonical.seriesYear, occurrence.seriesYear);
    assert.equal(canonical.issueNumber, occurrence.issueNumber);
  }

  const xForceIssueOnes = expectedOccurrences.filter((occurrence) => (
    occurrence.normalizedSeriesTitle === 'X-Force'
      && occurrence.issueNumber === '1'
      && occurrence.disposition === 'canonical-candidate'
  ));
  assert.deepEqual(xForceIssueOnes.map(({ seriesYear }) => seriesYear), [1991, 2004, 2008, 2014]);

  const partialMaterial = expectedOccurrences.filter(({ sourceType }) => sourceType === 'partial-material');
  assert.equal(partialMaterial.length > 0, true);
  assert.equal(partialMaterial.every(({ disposition }) => disposition === 'semantic-exclusion'), true);

  const namedWorks = expectedOccurrences.filter(({ sourceType }) => sourceType === 'named-work');
  assert.equal(namedWorks.length > 0, true);
  assert.equal(namedWorks.every((occurrence) => (
    (occurrence.issueNumber === null || /^\d+(?:\.\d+)?$/.test(occurrence.issueNumber))
      && ['canonical-candidate', 'repeat'].includes(occurrence.disposition)
  )), true);
  const messiahWarAlias = expectedOccurrences.find(
    ({ sourceCaption }) => sourceCaption === 'X-Men Messiah War One-Shot',
  );
  assert.deepEqual(
    {
      normalizedSeriesTitle: messiahWarAlias.normalizedSeriesTitle,
      disposition: messiahWarAlias.disposition,
      repeatOfPosition: messiahWarAlias.repeatOfPosition,
    },
    {
      normalizedSeriesTitle: 'X-Force/Cable: Messiah War One-Shot',
      disposition: 'repeat',
      repeatOfPosition: 216,
    },
  );
  assert.deepEqual(
    expectedOccurrences
      .filter(({ sourceCaption }) => (
        sourceCaption === 'X-Necrosha: The Gathering #1' || sourceCaption === 'X-Necrosha #1'
      ))
      .map(({ sourceCaption, normalizedSeriesTitle, seriesYear, issueNumber, disposition, repeatOfPosition }) => ({
        sourceCaption,
        normalizedSeriesTitle,
        seriesYear,
        issueNumber,
        disposition,
        repeatOfPosition,
      })),
    [
      {
        sourceCaption: 'X-Necrosha: The Gathering #1',
        normalizedSeriesTitle: 'X Necrosha: The Gathering',
        seriesYear: 2009,
        issueNumber: '1',
        disposition: 'repeat',
        repeatOfPosition: 255,
      },
      {
        sourceCaption: 'X-Necrosha #1',
        normalizedSeriesTitle: 'X Necrosha',
        seriesYear: 2009,
        issueNumber: '1',
        disposition: 'repeat',
        repeatOfPosition: 254,
      },
    ],
  );

  const gaps = expectedOccurrences.filter(({ disposition }) => disposition === 'gap');
  for (const gap of gaps) {
    assert.equal(typeof gap.reason, 'string');
    assert.match(gap.reason, /source identity cannot determine exact work/i);
    assert.notEqual(gap.sourceCaption.trim(), '');
  }
}

function expectLedgerFailure(ledger, mutate) {
  assert.throws(() => {
    const draft = clone(ledger);
    mutate(draft);
    validateLedger(draft);
  });
}

test('X-Force Stage A reads the durable source ledger and preserves its extracted boundary', async () => {
  const ledger = await readLedger();
  validateLedger(ledger);
});

test('X-Force Stage A rejects structural and source-identity mutations', async () => {
  const ledger = await readLedger();
  validateLedger(ledger);

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.pop();
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes = draft.sourceNodes.filter(({ index }) => index !== 40);
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.sort((left, right) => left.disposition.localeCompare(right.disposition));
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.occurrences.at(-1).position = draft.occurrences.at(-2).position;
  });

  for (const disposition of new Set(ledger.occurrences.map((occurrence) => occurrence.disposition))) {
    expectLedgerFailure(ledger, (draft) => {
      const index = draft.occurrences.findIndex((occurrence) => occurrence.disposition === disposition);
      draft.occurrences.splice(index, 1);
    });
  }

  expectLedgerFailure(ledger, (draft) => {
    const entry = draft.sourceNodes
      .flatMap((node) => node.entries ?? [])
      .find(({ issueNumbers }) => issueNumbers.length > 1);
    entry.issueNumbers.splice(1, 1);
  });

  expectLedgerFailure(ledger, (draft) => {
    const entry = draft.sourceNodes
      .flatMap((node) => node.entries ?? [])
      .find(({ issueNumbers }) => issueNumbers.length > 1);
    entry.issueNumbers = ['98-100'];
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 40).kind = 'prose';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 32).entries[0].seriesYear = 1991;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 10).entries
      .find(({ sourceCaption }) => sourceCaption === 'Annual 7').seriesYear = 1983;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 13).entries
      .find(({ sourceCaption }) => sourceCaption === 'Uncanny X-Men #294-297').seriesYear = 1981;
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 40).entries
      .find(({ sourceCaption }) => sourceCaption === 'X-Men Messiah War One-Shot')
      .normalizedSeriesTitle = 'X-Men Messiah War One-Shot';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceNodes.find(({ index }) => index === 44).entries
      .find(({ sourceCaption }) => sourceCaption === 'X-Necrosha #1')
      .normalizedSeriesTitle = 'X-Necrosha';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceGroups.find(({ id }) => id === 'x-force-2000s').heading = 'incorrect heading';
  });

  expectLedgerFailure(ledger, (draft) => {
    draft.sourceGroups.find(({ id }) => id === 'x-force-90s').lastNodeIndex = 20;
  });

  expectLedgerFailure(ledger, (draft) => {
    const entry = draft.sourceNodes
      .flatMap((node) => node.entries ?? [])
      .find(({ inheritedIdentity }) => inheritedIdentity);
    entry.inheritedIdentity.seriesTitle = null;
  });

  expectLedgerFailure(ledger, (draft) => {
    const blank = draft.occurrences.find(({ sourceNodeKind }) => sourceNodeKind === 'blank-marker');
    blank.disposition = 'gap';
    blank.reason = 'source identity cannot determine exact work';
  });

  expectLedgerFailure(ledger, (draft) => {
    const entry = draft.sourceNodes
      .flatMap((node) => node.entries ?? [])
      .find(({ sourceType }) => sourceType === 'partial-material');
    entry.disposition = 'canonical-candidate';
  });

  expectLedgerFailure(ledger, (draft) => {
    const entry = draft.sourceNodes
      .flatMap((node) => node.entries ?? [])
      .find(({ sourceType }) => sourceType === 'named-work');
    entry.disposition = 'gap';
  });

  expectLedgerFailure(ledger, (draft) => {
    const repeat = draft.occurrences.find(({ disposition }) => disposition === 'repeat');
    repeat.repeatOfPosition = null;
  });

  expectLedgerFailure(ledger, (draft) => {
    const repeat = draft.occurrences.find(({ disposition }) => disposition === 'repeat');
    repeat.repeatOfPosition += 1;
  });
});
