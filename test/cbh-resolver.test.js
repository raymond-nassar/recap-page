import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRow, validateResolvedMapping } from '../scripts/lib/cbh-resolution.mjs';
import {
  selectPreparationGuides,
  shouldPreserveApprovedMapping,
} from '../scripts/prepare-cbh-batch.mjs';
import {
  packetDigestFor,
  validateFrozenPacket,
} from '../scripts/lib/cbh-inventory.mjs';
import { resolveMapping } from '../scripts/resolve-cbh-order.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function frozenPacket(overrides = {}) {
  const id = overrides.id ?? 'future-event';
  const sourceUrl = overrides.sourceUrl ?? 'https://www.comicbookherald.com/future-event/';
  const packet = {
    schemaVersion: 1,
    id,
    inventoryId: overrides.inventoryId ?? id,
    sourceUrl,
    sourceRetrievedAt: '2026-08-22',
    sourceBoundary: 'The explicit issue-by-issue reading-order section.',
    excludedSourceReferences: [],
    expectedCount: 1,
    proposedManifest: {
      id,
      name: 'Future Event',
      description: 'A frozen test event.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: `${id}.md`,
      sourcePage: sourceUrl,
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
      sourceLicense: null,
      out: `${id.replaceAll('-', '_')}.json`,
      characters: ['Tester'],
      keywords: ['Future Event'],
      expect: 1,
      timeline: 2026,
      coverIssueId: 9001,
    },
    insertionAnchor: { beforeId: 'new-ultimate-universe' },
    sourceReview: {
      authorityType: 'human',
      authorityIdentity: 'source-owner',
      rationale: 'The visible source boundary and chronology were reviewed.',
      reviewedAt: '2026-08-22T12:00:00Z',
    },
    rows: [{
      sourceIssueReference: 'Future Event #1',
      sourceRangeReference: null,
      normalizedSeriesTitle: 'Future Event',
      seriesYear: 2026,
      issueNumber: '1',
      seriesId: 900,
      candidateIssueId: 9001,
      manualSeriesSelectionApproved: false,
      selectionNote: null,
    }],
    ...overrides,
  };
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

test('a single exact normalized candidate is selected', () => {
  const row = { normalizedSeriesTitle: 'Civil War', issueNumber: '2', seriesYear: '2006' };
  const candidates = [
    { id: 101, title: 'Civil War', issueNumber: '2', seriesYear: '2006' },
    { id: 102, title: 'Civil War', issueNumber: '1', seriesYear: '2006' },
  ];

  const result = resolveRow(row, candidates);
  assert.equal(result.status, 'exact');
  assert.equal(result.selectedIssueId, '101');
  assert.deepEqual(result.candidateIssueIds, ['101']);
});

test('similar but non-exact candidates stay unresolved', () => {
  const row = { normalizedSeriesTitle: 'Spider-Verse', issueNumber: '1', seriesYear: '2014' };
  const candidates = [
    { id: 201, title: 'Spider-Verse', issueNumber: '2', seriesYear: '2014' },
    { id: 202, title: 'Spider-Man: Spider-Verse', issueNumber: '1', seriesYear: '2014' },
  ];

  const result = resolveRow(row, candidates);
  assert.equal(result.status, 'unmatched');
  assert.deepEqual(result.candidateIssueIds, ['201', '202']);
});

test('series ids are checked instead of trusting row-derived candidate titles', () => {
  const row = {
    normalizedSeriesTitle: 'Secret War',
    issueNumber: '1',
    seriesYear: '2004',
    seriesId: 418,
    note: '',
  };
  const wrongSeries = [{
    id: 203,
    title: 'Secret War',
    issueNumber: '1',
    seriesYear: '2004',
    seriesId: 999,
  }];

  assert.equal(resolveRow(row, wrongSeries).status, 'unmatched');
});

test('a reviewed title mismatch requires explicit approval, the same series id, and a note', () => {
  const candidate = {
    id: 17212,
    title: 'Hulk',
    issueNumber: '112',
    seriesYear: '1999',
    seriesId: 465,
    manualSeriesSelection: true,
    manualSeriesSelectionApproved: true,
  };
  const reviewed = {
    normalizedSeriesTitle: 'Incredible Hercules',
    issueNumber: '112',
    seriesYear: '1999',
    seriesId: 465,
    manualSeriesSelectionApproved: true,
    note: 'Marvel indexes this transition issue in Hulk before Incredible Hercules #113.',
  };

  const result = resolveRow(reviewed, [candidate]);
  assert.equal(result.status, 'exact');
  assert.equal(result.selectedIssueId, '17212');
  assert.equal(resolveRow({ ...reviewed, manualSeriesSelectionApproved: false }, [candidate]).status, 'unmatched');
  assert.equal(resolveRow(reviewed, [{ ...candidate, manualSeriesSelectionApproved: false }]).status, 'unmatched');
  assert.equal(resolveRow({ ...reviewed, note: '' }, [candidate]).status, 'unmatched');
  assert.equal(resolveRow({ ...reviewed, seriesId: 466 }, [candidate]).status, 'unmatched');
});

test('multiple exact title matches are ambiguous and stop the run', () => {
  const row = { normalizedSeriesTitle: 'Fear Itself', issueNumber: '1', seriesYear: '2011' };
  const candidates = [
    { id: 301, title: 'Fear Itself', issueNumber: '1', seriesYear: '2011' },
    { id: 302, title: 'Fear Itself', issueNumber: '1', seriesYear: '2011' },
  ];

  const result = resolveRow(row, candidates);
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidateIssueIds, ['301', '302']);
});

test('a year mismatch is filtered out before selection', () => {
  const row = { normalizedSeriesTitle: 'Avengers Vs X-Men', issueNumber: '1', seriesYear: '2012' };
  const candidates = [
    { id: 401, title: 'Avengers Vs X-Men', issueNumber: '1', seriesYear: '2011' },
    { id: 402, title: 'Avengers Vs X-Men', issueNumber: '1', seriesYear: '2012' },
  ];

  const result = resolveRow(row, candidates);
  assert.equal(result.status, 'exact');
  assert.equal(result.selectedIssueId, '402');
});

test('a source display number can resolve against an explicit metadata number', () => {
  const row = {
    normalizedSeriesTitle: 'Avengers',
    issueNumber: '1.MU',
    metadataIssueNumber: '1.1',
    seriesYear: '2016',
    seriesId: 22547,
  };
  const candidate = {
    id: 62507,
    title: 'Avengers',
    issueNumber: '1.1',
    seriesYear: '2016',
    seriesId: 22547,
  };

  const result = resolveRow(row, [candidate]);
  assert.equal(result.status, 'exact');
  assert.equal(result.selectedIssueId, '62507');
  assert.equal(resolveRow({ ...row, metadataIssueNumber: undefined }, [candidate]).status, 'unmatched');
});

test('approved exceptions are preserved without selection change', () => {
  const row = {
    normalizedSeriesTitle: 'Secret War',
    issueNumber: '1',
    resolutionStatus: 'approved-exception',
    selectedIssueId: 777,
    candidateIssueIds: [777],
    note: 'manual override',
  };

  const result = resolveRow(row, []);
  assert.equal(result.status, 'approved-exception');
  assert.equal(result.selectedIssueId, 777);
});

test('duplicate selected ids fail validation before writing', () => {
  assert.throws(() => validateResolvedMapping([
    { resolutionStatus: 'exact', selectedIssueId: 500 },
    { resolutionStatus: 'exact', selectedIssueId: 500 },
  ]), /Duplicate selected issue id/);
});

test('preparation preserves approved mappings unless an explicit refresh mode is selected', () => {
  const approved = { reviewStatus: 'approved' };
  assert.equal(shouldPreserveApprovedMapping(approved), true);
  assert.equal(shouldPreserveApprovedMapping(approved, { forceApproved: true }), false);
  assert.equal(shouldPreserveApprovedMapping(approved, { refreshApproved: true }), false);
  assert.equal(shouldPreserveApprovedMapping({ reviewStatus: 'pending-independent-review' }), false);
});

test('frozen packets bind source identity, rows, manifest, chronology, review, and digest', () => {
  const packet = frozenPacket();
  const inventoryRecord = {
    id: 'future-event',
    url: packet.sourceUrl,
    deliveryStatus: 'pending',
  };
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: 'future-event',
    inventoryRecord,
    catalogEntries: [],
  }));
  assert.throws(
    () => validateFrozenPacket({ ...packet, sourceBoundary: 'A changed boundary.' }),
    /packet digest is stale/i,
  );
  assert.throws(
    () => validateFrozenPacket(packet, { expectedId: 'different-event' }),
    /does not match requested id/i,
  );
  assert.throws(
    () => validateFrozenPacket(packet, {
      inventoryRecord: { ...inventoryRecord, url: 'https://www.comicbookherald.com/other/' },
    }),
    /differs from inventory/i,
  );
});

test('preparation selects one frozen packet by inventory id without changing legacy guides', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cbh-packet-select-'));
  const packetsDir = path.join(tempDir, 'packets');
  const inventoryPath = path.join(tempDir, 'inventory.json');
  const manifestPath = path.join(tempDir, 'manifest.json');
  mkdirSync(packetsDir);
  const packet = frozenPacket({ inventoryId: 'future-inventory' });
  writeFileSync(path.join(packetsDir, 'future-event.json'), JSON.stringify(packet), 'utf8');
  writeFileSync(inventoryPath, JSON.stringify([{
    id: 'future-inventory',
    url: packet.sourceUrl,
    deliveryStatus: 'pending',
  }]), 'utf8');
  writeFileSync(manifestPath, JSON.stringify({ lists: [] }), 'utf8');

  const selected = await selectPreparationGuides(['future-inventory'], {
    packetsDir,
    inventoryPath,
    manifestPath,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'future-event');
  assert.equal(selected[0].isFrozenPacket, true);
  assert.equal(selected[0].rows.length, 1);

  const legacy = await selectPreparationGuides(['minimum-carnage'], { packetsDir });
  assert.deepEqual(legacy.map((guide) => guide.id), ['minimum-carnage']);
  assert.equal(legacy[0].isFrozenPacket, undefined);
});

test('resolveMapping requires real metadata and rejects unresolved rows', async () => {
  const mapping = {
    rows: [{
      candidateIssueIds: ['9001'],
      normalizedSeriesTitle: 'Ghosted',
      issueNumber: '2',
      seriesYear: '2015',
      note: '',
    }],
  };

  await assert.rejects(
    () => resolveMapping(mapping, {
      metadataLookup: () => null,
    }), /unresolved|metadata|candidate/i,
  );

  const resolved = await resolveMapping({
    rows: [{
      candidateIssueIds: ['9002'],
      normalizedSeriesTitle: 'Fear Itself',
      issueNumber: '1',
      seriesYear: '2011',
      note: '',
    }],
  }, {
    metadataLookup: (issueId) => (issueId === '9002' ? {
      id: 9002,
      title: 'Fear Itself',
      issueNumber: '1',
      seriesYear: '2011',
    } : null),
  });

  assert.equal(resolved.rows[0].resolutionStatus, 'exact');
  assert.equal(resolved.rows[0].selectedIssueId, 9002);
});

test('the CLI exits nonzero and keeps the mapping unchanged when resolution is unresolved', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cbh-resolve-'));
  const mappingPath = path.join(tempDir, 'mapping.json');
  const original = {
    rows: [{
      candidateIssueIds: ['9001'],
      normalizedSeriesTitle: 'Ghosted',
      issueNumber: '2',
      seriesYear: '2015',
      note: '',
    }],
  };
  writeFileSync(mappingPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

  const proc = spawnSync(process.execPath, ['scripts/resolve-cbh-order.mjs', mappingPath], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(proc.status, 0, proc.stderr || proc.stdout || 'expected a failing exit code');
  assert.deepEqual(JSON.parse(readFileSync(mappingPath, 'utf8')), original);
});
