import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CHECKPOINT_PATH = '.copilot-tracking/research/2026-08-27/x-force-stage-a-checkpoint.json';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function readCheckpoint() {
  return readFile(CHECKPOINT_PATH, 'utf8').then((text) => JSON.parse(text));
}

function clone(value) {
  return structuredClone(value);
}

function flattenSourceNodes(checkpoint) {
  const occurrences = [];

  for (const node of checkpoint.sourceNodes) {
    if (Array.isArray(node.entries) && node.entries.length > 0) {
      for (const entry of node.entries) {
        assert.equal(Array.isArray(entry.issues), true, `node ${node.index} has unexpanded issues`);
        for (const issue of entry.issues) {
          const issueText = String(issue);
          assert.match(issueText, /^\d+(\.\d+)?$/, `node ${node.index} has unexpanded range-valued issueNumber`);
          occurrences.push({
            sourceNodeIndex: node.index,
            sourceNodeTag: node.tag,
            sourceGroup: node.group,
            sourceType: entry.sourceType || node.sourceType,
            sourceText: entry.issues.length === 1 && entry.label ? entry.label : `${entry.label} ${issueText}`,
            sourceRangeReference: node.text,
            normalizedSeriesTitle: entry.series,
            seriesYear: entry.year,
            issueNumber: issueText,
            identityKey: `${entry.series}|${entry.year}|${issueText}`,
            reason: null,
            sourceNodeKind: node.nodeKind,
          });
        }
      }
      continue;
    }

    occurrences.push({
      sourceNodeIndex: node.index,
      sourceNodeTag: node.tag,
      sourceGroup: node.group,
      sourceType: node.sourceType,
      sourceText: node.text,
      sourceRangeReference: node.text,
      normalizedSeriesTitle: null,
      seriesYear: null,
      issueNumber: null,
      identityKey: null,
      reason: node.reason,
      sourceNodeKind: node.nodeKind,
    });
  }

  const seen = new Map();
  return occurrences.map((occurrence, index) => {
    const position = index + 1;
    if (occurrence.identityKey == null) {
      return {
        ...occurrence,
        position,
        provisionalDisposition: 'exclusion',
        repeatOfPosition: null,
      };
    }

    if (seen.has(occurrence.identityKey)) {
      return {
        ...occurrence,
        position,
        provisionalDisposition: 'repeat',
        repeatOfPosition: seen.get(occurrence.identityKey),
      };
    }

    seen.set(occurrence.identityKey, position);
    return {
      ...occurrence,
      position,
      provisionalDisposition: 'canonical-candidate',
      repeatOfPosition: null,
    };
  });
}

function digestOccurrences(occurrences) {
  return sha256(occurrences.map(({ position: _position, ...entry }) => entry));
}

function digestSourceNodes(sourceNodes) {
  return sha256(sourceNodes.map((node) => ({
    index: node.index,
    tag: node.tag,
    group: node.group,
  })));
}

function snapshotOccurrence(occurrence) {
  return {
    position: occurrence.position,
    sourceNodeIndex: occurrence.sourceNodeIndex,
    sourceGroup: occurrence.sourceGroup,
    sourceType: occurrence.sourceType,
    sourceNodeKind: occurrence.sourceNodeKind,
    sourceText: occurrence.sourceText,
    sourceRangeReference: occurrence.sourceRangeReference,
    normalizedSeriesTitle: occurrence.normalizedSeriesTitle,
    seriesYear: occurrence.seriesYear,
    issueNumber: occurrence.issueNumber,
    provisionalDisposition: occurrence.provisionalDisposition,
    repeatOfPosition: occurrence.repeatOfPosition,
    reason: occurrence.reason,
  };
}

function buildRepeatAudit(checkpoint) {
  const byPosition = new Map(checkpoint.occurrences.map((occurrence) => [occurrence.position, occurrence]));
  const mappings = checkpoint.occurrences
    .filter((occurrence) => occurrence.provisionalDisposition === 'repeat')
    .map((occurrence) => {
      const canonical = byPosition.get(occurrence.repeatOfPosition);
      assert.notEqual(canonical, undefined);
      return {
        repeatPosition: occurrence.position,
        canonicalPosition: canonical.position,
        repeatSourceNodeIndex: occurrence.sourceNodeIndex,
        repeatSourceGroup: occurrence.sourceGroup,
        repeatSourceType: occurrence.sourceType,
        repeatSourceText: occurrence.sourceText,
        repeatSourceRangeReference: occurrence.sourceRangeReference,
        repeatNormalizedSeriesTitle: occurrence.normalizedSeriesTitle,
        repeatSeriesYear: occurrence.seriesYear,
        repeatIssueNumber: occurrence.issueNumber,
        canonicalSourceNodeIndex: canonical.sourceNodeIndex,
        canonicalSourceGroup: canonical.sourceGroup,
        canonicalSourceType: canonical.sourceType,
        canonicalSourceText: canonical.sourceText,
        canonicalSourceRangeReference: canonical.sourceRangeReference,
        canonicalNormalizedSeriesTitle: canonical.normalizedSeriesTitle,
        canonicalSeriesYear: canonical.seriesYear,
        canonicalIssueNumber: canonical.issueNumber,
        backward: canonical.position < occurrence.position,
      };
    });
  const titleCounts = mappings.reduce((counts, mapping) => {
    counts[mapping.repeatNormalizedSeriesTitle] = (counts[mapping.repeatNormalizedSeriesTitle] || 0) + 1;
    return counts;
  }, {});
  return {
    count: mappings.length,
    mappingDigest: sha256(mappings),
    mappings,
    allBackward: mappings.every((mapping) => mapping.backward),
    titleCounts,
  };
}

function buildCandidateAudit(checkpoint) {
  const candidates = checkpoint.occurrences.filter((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate');
  return {
    count: candidates.length,
    positions: candidates.map((occurrence) => occurrence.position),
    positionDigest: sha256(candidates.map((occurrence) => occurrence.position)),
    evidenceDigest: sha256(candidates.map(snapshotOccurrence)),
  };
}

function buildExclusionAudit(checkpoint) {
  const exclusions = checkpoint.occurrences.filter((occurrence) => occurrence.provisionalDisposition === 'exclusion');
  const classes = Object.entries(
    exclusions.reduce((groups, occurrence) => {
      if (!groups[occurrence.reason]) groups[occurrence.reason] = [];
      groups[occurrence.reason].push(occurrence.position);
      return groups;
    }, {}),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, positions]) => ({
      reason,
      representativePosition: positions[0],
      positions,
      count: positions.length,
    }));
  return {
    count: exclusions.length,
    positions: exclusions.map((occurrence) => occurrence.position),
    positionDigest: sha256(exclusions.map((occurrence) => occurrence.position)),
    evidenceDigest: sha256(exclusions.map(snapshotOccurrence)),
    classes,
  };
}

function buildSourceNodeCounts(checkpoint) {
  const issueBearing = checkpoint.sourceNodes.filter((node) => Array.isArray(node.entries)).length;
  return {
    issueBearing,
    contextual: checkpoint.sourceNodes.length - issueBearing,
  };
}

function validateCheckpoint(checkpoint) {
  assert.equal(checkpoint.schemaVersion, 1);
  assert.equal(checkpoint.id, 'x-force-stage-a-checkpoint');
  assert.equal(checkpoint.title, 'X-Force');
  assert.equal(checkpoint.issueNumber, 239);
  assert.equal(checkpoint.priority, 26);
  assert.equal(checkpoint.sourceUrl, 'https://www.comicbookherald.com/x-force-reading-order/');
  assert.equal(checkpoint.sourceTitle, 'X-Force Reading Order - Comic Book Herald');
  assert.equal(checkpoint.sourceRetrievedAt, '2026-08-27');

  assert.equal(checkpoint.sourceBoundary.scope, 'full page');
  assert.equal(checkpoint.sourceBoundary.qualifyingSection, null);
  assert.match(checkpoint.sourceBoundary.ownerRule, /No qualifying Best\/Essential subsection exists/i);
  assert.equal(checkpoint.sourceBoundary.firstHeading, 'X-Force 90’s Comic Book Reading Order');
  assert.equal(checkpoint.sourceBoundary.lastHeading, 'Deadpool vs. X-Force');
  assert.equal(checkpoint.sourceBoundary.evidence.length, 3);
  assert.match(checkpoint.sourceBoundary.evidence[1].text, /No qualifying Best\/Essential subsection exists/i);
  assert.match(checkpoint.sourceBoundary.evidence[2].text, /overlap only partially/i);
  assert.equal(checkpoint.sourceBoundary.contentSha256.length, 64);
  assert.equal(checkpoint.sourceBoundary.issueBearingBlocksSha256.length, 64);

  assert.equal(checkpoint.inventoryRow.position, 26);
  assert.equal(checkpoint.inventoryRow.team, 'X-Force');
  assert.equal(checkpoint.inventoryRow.issue, 239);
  assert.equal(checkpoint.inventoryRow.priority, 26);
  assert.equal(checkpoint.inventoryRow.stage, 'A');
  assert.equal(checkpoint.inventoryRow.scope, 'source-only');
  assert.equal(checkpoint.inventoryRow.catalogComparison.exactGuide, 'x-force-reading-order');
  assert.equal(checkpoint.inventoryRow.catalogComparison.duplicateCoverageRejected, true);

  assert.equal(checkpoint.sourceGroups.length, 6);
  assert.deepEqual(
    checkpoint.sourceGroups.map((group) => group.id),
    ['intro', 'related-reading-orders', 'x-force-90s', 'x-force-2000s', 'x-force-doing-the-jobs', 'uncanny-x-force'],
  );

  assert.equal(checkpoint.sourceNodes.length, 71);
  assert.equal(checkpoint.sourceGroupCount, 6);
  assert.equal(checkpoint.sourceNodeCount, 71);
  assert.equal(checkpoint.occurrenceCount, checkpoint.occurrences.length);
  assert.equal(checkpoint.sourceNodes.filter((node) => Array.isArray(node.entries)).length, checkpoint.sourceBoundary.issueBearingBlockCount);

  const repeatAudit = buildRepeatAudit(checkpoint);
  const candidateAudit = buildCandidateAudit(checkpoint);
  const exclusionAudit = buildExclusionAudit(checkpoint);
  const sourceNodeCounts = buildSourceNodeCounts(checkpoint);

  assert.deepEqual(checkpoint.repeatAudit, repeatAudit);
  assert.deepEqual(checkpoint.candidateAudit, candidateAudit);
  assert.deepEqual(checkpoint.exclusionAudit, exclusionAudit);
  assert.deepEqual(checkpoint.sourceNodeCounts, sourceNodeCounts);
  assert.equal(repeatAudit.allBackward, true);
  assert.equal(repeatAudit.count, 97);
  assert.equal(candidateAudit.count, 265);
  assert.equal(exclusionAudit.count, 42);
  assert.equal(sourceNodeCounts.issueBearing, 29);
  assert.equal(sourceNodeCounts.contextual, 42);
  assert.equal(repeatAudit.titleCounts['Uncanny X-Force'], 37);
  assert.equal(repeatAudit.titleCounts['X-Force'], 42);
  assert.equal(repeatAudit.titleCounts['Cable'], 3);
  assert.equal(repeatAudit.titleCounts['New Mutants'], 3);
  assert.equal(repeatAudit.titleCounts['X-Men Legacy'], 4);
  assert.equal(repeatAudit.titleCounts['X-Force Annual'], 1);
  assert.equal(repeatAudit.titleCounts['X-Force/Cable: Messiah War'], 1);
  assert.equal(repeatAudit.titleCounts['X Necrosha: The Gathering'], 1);
  assert.equal(repeatAudit.titleCounts['New Warriors'], 1);
  assert.equal(repeatAudit.titleCounts['Nomad'], 1);

  assert.equal(
    checkpoint.occurrences.filter((occurrence) => occurrence.normalizedSeriesTitle === 'X-Statix').every((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate'),
    true,
  );
  assert.equal(
    checkpoint.occurrences.filter((occurrence) => occurrence.normalizedSeriesTitle === 'Cable and X-Force').every((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate'),
    true,
  );
  assert.equal(
    checkpoint.occurrences.filter((occurrence) => occurrence.sourceNodeIndex === 29).every((occurrence) => occurrence.provisionalDisposition === 'canonical-candidate'),
    true,
  );
  assert.equal(
    checkpoint.occurrences
      .filter((occurrence) => occurrence.provisionalDisposition === 'repeat')
      .every((occurrence) => occurrence.repeatOfPosition < occurrence.position),
    true,
  );
  assert.equal(
    checkpoint.occurrences
      .filter((occurrence) => occurrence.provisionalDisposition === 'repeat')
      .every((occurrence) => {
        const issue = Number.parseInt(String(occurrence.issueNumber), 10);
        return Number.isNaN(issue) ? true : issue !== occurrence.seriesYear;
      }),
    true,
  );
  assert.equal(
    checkpoint.occurrences
      .filter((occurrence) => occurrence.provisionalDisposition === 'repeat')
      .every((occurrence) => {
        const canonical = checkpoint.occurrences[occurrence.repeatOfPosition - 1];
        return canonical.normalizedSeriesTitle === occurrence.normalizedSeriesTitle
          && canonical.seriesYear === occurrence.seriesYear
          && canonical.issueNumber === occurrence.issueNumber;
      }),
    true,
  );

  const expectedOccurrences = flattenSourceNodes(checkpoint);
  assert.deepEqual(
    checkpoint.occurrences.map((entry) => ({
      position: entry.position,
      sourceNodeIndex: entry.sourceNodeIndex,
      sourceGroup: entry.sourceGroup,
      sourceType: entry.sourceType,
      sourceText: entry.sourceText,
      sourceRangeReference: entry.sourceRangeReference,
      normalizedSeriesTitle: entry.normalizedSeriesTitle,
      seriesYear: entry.seriesYear,
      issueNumber: entry.issueNumber,
      provisionalDisposition: entry.provisionalDisposition,
      repeatOfPosition: entry.repeatOfPosition,
      reason: entry.reason,
    })),
    expectedOccurrences.map((entry) => ({
      position: entry.position,
      sourceNodeIndex: entry.sourceNodeIndex,
      sourceGroup: entry.sourceGroup,
      sourceType: entry.sourceType,
      sourceText: entry.sourceText,
      sourceRangeReference: entry.sourceRangeReference,
      normalizedSeriesTitle: entry.normalizedSeriesTitle,
      seriesYear: entry.seriesYear,
      issueNumber: entry.issueNumber,
      provisionalDisposition: entry.provisionalDisposition,
      repeatOfPosition: entry.repeatOfPosition,
      reason: entry.reason,
    })),
  );

  assert.deepEqual(checkpoint.occurrenceCounts, {
    'canonical-candidate': 265,
    repeat: 97,
    gap: 0,
    exclusion: 42,
  });

  assert.deepEqual(checkpoint.countBreakdown, {
    provisionalCandidateCount: 265,
    fullIdentityRepeatCount: 97,
    sourceIdentityGapCount: 0,
    exclusionCount: 42,
  });

  assert.deepEqual(checkpoint.categorizedPositions.gapPositions, []);
  assert.equal(checkpoint.sourceNodeOrderSha256.length, 64);
  assert.equal(checkpoint.sourceContentSha256.length, 64);
  assert.equal(checkpoint.issueBearingBlocksSha256.length, 64);
  assert.equal(checkpoint.digestInputSha256, digestOccurrences(checkpoint.occurrences));
  assert.equal(checkpoint.sourceNodeOrderSha256, digestSourceNodes(checkpoint.sourceNodes));
  assert.equal(
    checkpoint.countBreakdown.provisionalCandidateCount
      + checkpoint.countBreakdown.fullIdentityRepeatCount
      + checkpoint.countBreakdown.sourceIdentityGapCount
      + checkpoint.countBreakdown.exclusionCount,
    checkpoint.occurrenceCount,
  );
}

test('X-Force stage A checkpoint preserves the source boundary and ledger', async () => {
  const checkpoint = await readCheckpoint();
  assert.doesNotThrow(() => validateCheckpoint(checkpoint));
});

test('X-Force stage A checkpoint rejects truncated, reordered and mutated shapes', async () => {
  const checkpoint = await readCheckpoint();

  const truncation = clone(checkpoint);
  truncation.occurrences.pop();
  assert.throws(() => validateCheckpoint(truncation));

  const wholeNodeOmission = clone(checkpoint);
  wholeNodeOmission.sourceNodes = wholeNodeOmission.sourceNodes.filter((node) => node.index !== 40);
  assert.throws(() => validateCheckpoint(wholeNodeOmission));

  const reordered = clone(checkpoint);
  reordered.occurrences = [...reordered.occurrences].sort((left, right) => left.provisionalDisposition.localeCompare(right.provisionalDisposition));
  assert.throws(() => validateCheckpoint(reordered));

  const duplicatePosition = clone(checkpoint);
  duplicatePosition.occurrences[duplicatePosition.occurrences.length - 1].position = duplicatePosition.occurrences[duplicatePosition.occurrences.length - 2].position;
  assert.throws(() => validateCheckpoint(duplicatePosition));

  for (const disposition of ['canonical-candidate', 'repeat', 'exclusion']) {
    const dropped = clone(checkpoint);
    const index = dropped.occurrences.findIndex((entry) => entry.provisionalDisposition === disposition);
    dropped.occurrences.splice(index, 1);
    assert.throws(() => validateCheckpoint(dropped));
  }

  const gapMutation = clone(checkpoint);
  const gapIndex = gapMutation.occurrences.findIndex((entry) => entry.provisionalDisposition === 'canonical-candidate');
  gapMutation.occurrences[gapIndex].provisionalDisposition = 'gap';
  gapMutation.occurrences[gapIndex].repeatOfPosition = null;
  assert.throws(() => validateCheckpoint(gapMutation));

  const droppedRangeMember = clone(checkpoint);
  const nodeTen = droppedRangeMember.sourceNodes.find((node) => node.index === 10);
  nodeTen.entries[0].issues.splice(1, 1);
  assert.throws(() => validateCheckpoint(droppedRangeMember));

  const issueBearingProse = clone(checkpoint);
  const nodeForty = issueBearingProse.sourceNodes.find((node) => node.index === 40);
  nodeForty.entries[0].sourceType = 'title-range';
  assert.throws(() => validateCheckpoint(issueBearingProse));

  const highRiskRepeatIdentity = clone(checkpoint);
  const xForceSection = highRiskRepeatIdentity.sourceNodes.find((node) => node.index === 69);
  xForceSection.entries[0].year = 2014;
  assert.throws(() => validateCheckpoint(highRiskRepeatIdentity));

  const titleOnlyRepeatCollision = clone(checkpoint);
  const nodeThirtyOne = titleOnlyRepeatCollision.sourceNodes.find((node) => node.index === 31);
  nodeThirtyOne.nodeKind = 'issue-title-range';
  nodeThirtyOne.sourceType = 'title-range';
  nodeThirtyOne.disposition = undefined;
  nodeThirtyOne.entries = [{
    series: 'X-Force',
    year: 2004,
    label: 'X-Force #1',
    issues: [1],
  }];
  assert.throws(() => validateCheckpoint(titleOnlyRepeatCollision));

  const blankGap = clone(checkpoint);
  const blankNode = blankGap.sourceNodes.find((node) => node.index === 8);
  blankNode.disposition = 'gap';
  blankNode.reason = 'blank issue line';
  assert.throws(() => validateCheckpoint(blankGap));

  const mixedPartialMaterial = clone(checkpoint);
  const partialNode = mixedPartialMaterial.sourceNodes.find((node) => node.index === 56);
  partialNode.disposition = undefined;
  partialNode.nodeKind = 'issue-clause';
  partialNode.sourceType = 'collects';
  partialNode.entries = [{
    series: 'Cable and X-Force',
    year: 2012,
    label: 'Cable And X-Force 1-5',
    issues: [1, 2, 3, 4, 5],
  }];
  assert.throws(() => validateCheckpoint(mixedPartialMaterial));

  const namedWorkAsGap = clone(checkpoint);
  const messiahWar = namedWorkAsGap.sourceNodes.find((node) => node.index === 39);
  messiahWar.entries[3].sourceType = 'gap';
  assert.throws(() => validateCheckpoint(namedWorkAsGap));

  const inheritedRangeIdentityLoss = clone(checkpoint);
  const annualSeven = inheritedRangeIdentityLoss.sourceNodes.find((node) => node.index === 10).entries.find((entry) => entry.label === 'Annual 7');
  annualSeven.series = 'Annual';
  assert.throws(() => validateCheckpoint(inheritedRangeIdentityLoss));

  const deletedRepeatPointer = clone(checkpoint);
  const repeatPointer = deletedRepeatPointer.occurrences.find((entry) => entry.provisionalDisposition === 'repeat');
  repeatPointer.repeatOfPosition = null;
  assert.throws(() => validateCheckpoint(deletedRepeatPointer));

  const redirectedRepeatPointer = clone(checkpoint);
  const redirectedPointer = redirectedRepeatPointer.occurrences.find((entry) => entry.provisionalDisposition === 'repeat');
  redirectedPointer.repeatOfPosition += 1;
  assert.throws(() => validateCheckpoint(redirectedRepeatPointer));

  const unexpandedRangeIssueNumber = clone(checkpoint);
  const xForceVolume = unexpandedRangeIssueNumber.sourceNodes.find((node) => node.index === 65).entries[0];
  xForceVolume.issues = ['1-6'];
  assert.throws(() => validateCheckpoint(unexpandedRangeIssueNumber));
});
