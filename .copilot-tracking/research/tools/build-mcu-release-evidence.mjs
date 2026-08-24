import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approvalDigestFor,
  digestCanonicalJson,
  mappingDigestFor,
  packetDigestFor,
} from '../../../scripts/lib/cbh-inventory.mjs';
import { writeFilesAtomically } from '../../../scripts/lib/cbro-evidence.mjs';
import { buildReportForMapping } from '../../../scripts/report-order-overlap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RESEARCH_DIR = path.join(ROOT, '.copilot-tracking', 'research', '2026-08-23');
const INVENTORY_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-mcu-companion-inventory.json');
const PACKETS_DIR = path.join(ROOT, 'scripts', 'data', 'cbh-packets');
const MAPPINGS_DIR = path.join(ROOT, 'scripts', 'data', 'cbh-mappings');
const OVERLAPS_DIR = path.join(ROOT, 'scripts', 'data', 'cbh-overlaps');
const JOURNAL = path.join(ROOT, 'scripts', 'data', '.mcu-evidence-transaction.json');
const SOURCE_ORIGIN = "Compiled for this project from Comic Book Herald's guide";
const PACKET_REVIEW = 'MRT-004 central CBH source review';
const REVIEWED_AT = '2026-08-24T01:00:00Z';

const selections = {
  'doctor-strange-multiverse-of-madness': {
    priority: 1,
    name: 'Doctor Strange: Multiverse of Madness',
    description: 'Seventeen issue-specific picks connecting Doctor Strange, the Illuminati, and the multiverse, limited to the recommendations this companion guide names by issue.',
    characters: ['Doctor Strange', 'Scarlet Witch', 'Illuminati'],
    keywords: ['Multiverse of Madness', 'Doctor Strange', 'Illuminati', 'New Avengers', 'Comic Book Herald'],
    coverIssueId: 55415,
    sourceBoundary: 'Includes Doctor Strange (2015) #1-10, New Avengers: Illuminati #0-5, and New Avengers #51, the three headed recommendations whose source text states exact issue numbers.',
    exclusions: [
      'Related reading-order links',
      'Doctor Strange and the Sorcerers Supreme, The Mystic Hands of Doctor Strange, What Is It That Disturbs You Stephen, Marvel Zombies, Young Avengers, and Exiles headed picks without a complete issue-number boundary',
      'Empyre: X-Men #1 and #4 and Exiles #66 contextual prose mentions',
      'Editorial commentary and images',
    ],
    nonNoneRationale: {
      'civil-war-avengers': 'The six Illuminati issues serve this film-companion path rather than reproducing the Civil War Avengers reading purpose.',
      'dark-reign-avengers': 'New Avengers #51 is one source-required endpoint in this companion path rather than a duplicate of the broader Dark Reign Avengers list.',
    },
  },
  'spider-man-no-way-home': {
    priority: 2,
    name: 'Spider-Man: No Way Home',
    description: 'Seventeen issue-specific Spider-Man and Doctor Strange picks for a multiverse homecoming, limited to the recommendations this companion guide names by issue.',
    characters: ['Spider-Man', 'Doctor Strange', 'Doctor Octopus'],
    keywords: ['No Way Home', 'Spider-Man', 'Doctor Strange', 'Back in Black', 'Comic Book Herald'],
    coverIssueId: 43170,
    sourceBoundary: 'Includes Amazing Spider-Man #57-58, #500, and #539-543; Friendly Neighborhood Spider-Man #17-23 and Annual #1; and Doctor Strange #390, the three headed recommendations whose source text states exact issue numbers.',
    exclusions: [
      'Related reading-order links',
      'Spider-Man and Doctor Octopus: Negative Exposure, Spider-Verse: Warzones and Web Warriors, and Spider-Man: Fever headed picks without exact issue-number boundaries',
      'Amazing Spider-Man Annual #2 contextual prose mention',
      'Spider-Man: One More Day, which the source explicitly declines to recommend',
      'Editorial commentary and images',
    ],
    nonNoneRationale: {},
  },
  'marvel-multiverse': {
    priority: 3,
    name: 'Marvel Multiverse',
    description: 'The Days of Future Past two-parter, the only selection this ten-pick multiverse guide identifies by issue number.',
    characters: ['X-Men', 'Kitty Pryde', 'Wolverine'],
    keywords: ['Marvel Multiverse', 'Days of Future Past', 'alternate reality', 'X-Men', 'Comic Book Herald'],
    coverIssueId: 13683,
    sourceBoundary: 'Includes Uncanny X-Men #142-143, the page’s only headed recommendation that identifies an exact issue range.',
    exclusions: [
      'Night of the Living Deadpool, Mutant X, Spider-Girl, Exiles, X-Treme X-Men, Ghost Spider, Cosmic Ghost Rider, Secret Wars, and Age of Apocalypse headed picks without exact issue-number boundaries',
      'What If? #105, Spider-Geddon, Gwenom, Captain Marvel and the Carol Corps, Weirdworld, E Is for Extinction, and Legion Quest contextual prose mentions',
      'Editorial commentary and images',
    ],
    nonNoneRationale: {
      'xmen-claremont': 'The two Days of Future Past issues are the source’s only issue-numbered multiverse pick and form a transparent thematic subset rather than an exact duplicate.',
      'xmen-claremont-complete': 'The two Days of Future Past issues are the source’s only issue-numbered multiverse pick and form a transparent thematic subset rather than an exact duplicate.',
    },
  },
  'marvel-what-if': {
    priority: 4,
    name: 'Marvel What If?',
    description: 'Seven alternate-reality issues and one-shots from this What If best-of guide.',
    characters: ['Doctor Doom', 'Thor', 'Daredevil', 'Spider-Man', 'Magik'],
    keywords: ['What If', 'alternate reality', 'Marvel Multiverse', 'Age of Ultron', 'Comic Book Herald'],
    coverIssueId: 12135,
    sourceBoundary: 'Includes the seven headed picks identified by their immediately preceding source captions or exact one-shot title: What If? #22, #25, #28, #30, #105, What If? Age of Ultron #5, and What If? Magik.',
    exclusions: [
      'Amazing Spider-Man #148-150 contextual continuity reference',
      'Unnumbered What If? Age of Ultron miniseries issues other than the caption-identified #5',
      'Editorial commentary and images',
    ],
    nonNoneRationale: {},
  },
};

const inventorySpecs = [
  [1, 'doctor-strange-multiverse-of-madness', 'The Best Comics to Read with Doctor Strange: Multiverse of Madness!', 'selected', 'reviewed', 'ready', null, 'First release: 17 exact issue rows with two centrally approved partial relationships.'],
  [2, 'spider-man-no-way-home', 'The Best Comics to Read Before Spider-Man: No Way Home!', 'selected', 'reviewed', 'ready', null, 'First release: 17 exact issue rows with no current-library or selected-peer overlap.'],
  [3, 'marvel-multiverse', '10 Great Comics Featuring the Marvel Multiverse!', 'selected', 'reviewed', 'ready', null, 'First release: the two issue-numbered Days of Future Past rows, centrally approved as subsets of both Claremont paths.'],
  [4, 'marvel-what-if', 'Best of Marvel What If…? Comics!', 'selected', 'reviewed', 'ready', null, 'First release: seven exact issues or one-shots with no current-library or selected-peer overlap.'],
  [5, 'wandavision', '10 Best Comics To Read With Wandavision!', 'follow-up', 'pending', 'deferred', 1, 'Next user priority; freeze eleven headed picks and resolve the title-count discrepancy before mapping.'],
  [6, 'spider-man-far-from-home', 'The Best Comics to Read With Spider-Man: Far From Home!', 'follow-up', 'reviewed-feasibility', 'deferred', 2, 'Eight exact feasibility rows; bind indexed post 40184 and reject podcast post 40334 in a later release.'],
  [7, 'avengers-endgame-character-picks', 'One Comic Rec for Every Avenger in Avengers: Endgame!', 'follow-up', 'pending', 'deferred', 3, 'Freeze ten sections and the nested Captain Marvel alternative before mapping.'],
  [8, 'avengers-endgame', 'Best Comics To Read Before Avengers: Endgame!', 'blocked', 'not-applicable', 'blocked', null, 'Blocked: the current source states no explicit issue-number boundary.'],
  [9, 'miles-morales-spider-verse', 'The Best Miles Morales Comics To Read With Into the Spider-Verse', 'follow-up', 'pending', 'deferred', 4, 'Map only the eleven source-authored Collects boundaries in a later release.'],
  [10, 'venom-movie', 'The Best Venom Comics To Read With Venom (The Movie)!', 'follow-up', 'pending', 'deferred', 5, 'Map only the eleven source-authored Issues boundaries in a later release.'],
  [11, 'ant-man-wasp-mcu', 'Best Ant-Man & Wasp Comics To Read With The MCU', 'blocked', 'not-applicable', 'blocked', null, 'Blocked: seven collection recommendations have no complete issue-number boundaries.'],
  [12, 'deadpool-2', 'Best Deadpool Comics To Read With Deadpool 2', 'blocked', 'not-applicable', 'blocked', null, 'Blocked: ten collection or run recommendations have no complete issue-number boundaries.'],
  [13, 'avengers-infinity-war', 'Best Comics To Read With Avengers: Infinity War', 'blocked', 'not-applicable', 'blocked', null, 'Blocked: collection-level recommendations and a prose novel do not provide a complete comic issue boundary.'],
  [14, 'iron-man-3', 'Best Iron Man Comics to Read Before Iron Man 3', 'follow-up', 'pending', 'deferred', 6, 'Map the eleven issue-explicit rows across all three source sections in a later release.'],
];

function seriesTitle(apiName) {
  return String(apiName).replace(/\s+\(\d{4}(?:\s*-\s*[^)]*)?\)\s*$/, '').trim();
}

function seriesYear(apiName) {
  const year = Number(String(apiName).match(/\((\d{4})/)?.[1]);
  return Number.isInteger(year) ? year : null;
}

function packetRow(row) {
  const manual = Boolean(row.manualIdentityReason);
  return {
    sourceIssueReference: row.sourceIssueReference,
    sourceRangeReference: row.sourceRangeReference ?? row.sourceIssueReference,
    normalizedSeriesTitle: seriesTitle(row.apiSeriesName),
    seriesYear: seriesYear(row.apiSeriesName),
    issueNumber: row.sourceIssueNumber ?? row.issueNumber,
    metadataIssueNumber: row.metadataIssueNumber,
    seriesId: row.seriesId,
    candidateIssueId: row.selectedIssueId,
    manualSeriesSelectionApproved: manual,
    selectionNote: row.manualIdentityReason ?? null,
  };
}

function proposedManifest(id, spec, sourceUrl, count) {
  return {
    id,
    name: spec.name,
    description: spec.description,
    type: 'screen-companion',
    depth: 'selected',
    beginner: false,
    group: null,
    groupName: null,
    variant: null,
    sourceFile: `${id}.md`,
    sourcePage: sourceUrl,
    sourceOrigin: SOURCE_ORIGIN,
    sourceLicense: null,
    out: `${id.replaceAll('-', '_')}.json`,
    characters: spec.characters,
    keywords: spec.keywords,
    expect: count,
    timeline: null,
    coverIssueId: spec.coverIssueId,
  };
}

function relationshipRationale(spec, comparison) {
  return spec.nonNoneRationale[comparison.orderId]
    ?? 'The current report contains no shared issue for this order.';
}

const boundaries = JSON.parse(await readFile(
  path.join(RESEARCH_DIR, 'mcu-best-of-source-boundaries.json'),
  'utf8',
));
const mappingEvidence = JSON.parse(await readFile(
  path.join(RESEARCH_DIR, 'mcu-best-of-first-release-mapping.json'),
  'utf8',
));
const boundaryByPriority = new Map(boundaries.records.map((record) => [record.priority, record]));
const evidenceById = new Map(mappingEvidence.guides.map((guide) => [guide.id, guide]));

const inventory = inventorySpecs.map(([
  position,
  id,
  title,
  centralDisposition,
  relationshipStatus,
  deliveryStatus,
  followUpRank,
  reason,
]) => {
  const boundary = boundaryByPriority.get(position);
  return {
    position,
    id,
    title,
    url: boundary.canonicalUrl,
    wordpressType: boundary.wordpressType,
    wordpressId: boundary.wordpressId,
    wordpressSlug: boundary.wordpressSlug,
    sourceRetrievedAt: boundary.sourceRetrievedAt,
    sourceContentSha256: boundary.sourceContentSha256,
    sourceIssueBearingBlocksSha256: boundary.sourceIssueBearingBlocksSha256,
    sourceIssueBearingBlockCount: boundary.issueBearingBlockCount,
    sourceBoundaryStatus: centralDisposition === 'blocked'
      ? 'blocked-no-complete-issue-boundary'
      : (position === 9 || position === 10 ? 'source-enumerated-collection-boundary' : 'exact-reviewed-boundary'),
    centralDisposition,
    relationshipStatus,
    deliveryStatus,
    followUpRank,
    reason,
    overlapIds: position === 1
      ? ['civil-war-avengers', 'dark-reign-avengers']
      : position === 3
        ? ['xmen-claremont', 'xmen-claremont-complete']
        : position === 6
          ? ['spider-man-best-of']
          : [],
    catalogIds: [],
  };
});

const identity = inventory.map(({
  relationshipStatus: _relationshipStatus,
  deliveryStatus: _deliveryStatus,
  catalogIds: _catalogIds,
  ...record
}) => record);
const inventoryIdentitySha256 = digestCanonicalJson(identity);

const packets = [];
const mappings = [];
for (const [id, spec] of Object.entries(selections)) {
  const source = boundaryByPriority.get(spec.priority);
  const evidence = evidenceById.get(id);
  const rows = evidence.rows.map(packetRow);
  const manifest = proposedManifest(id, spec, source.canonicalUrl, rows.length);
  const packet = {
    schemaVersion: 1,
    id,
    inventoryId: id,
    sourceUrl: source.canonicalUrl,
    sourceRetrievedAt: source.sourceRetrievedAt.slice(0, 10),
    sourceContentSha256: source.sourceContentSha256,
    sourceIssueBearingBlocksSha256: source.sourceIssueBearingBlocksSha256,
    sourceBoundary: spec.sourceBoundary,
    excludedSourceReferences: spec.exclusions,
    expectedCount: rows.length,
    proposedManifest: manifest,
    insertionAnchor: { beforeId: 'white-tiger-ava-ayala' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'MRT-004 coordinator',
      rationale: 'The canonical source identity, issue-bearing boundary, exclusions, source order, and exact metadata interpretation were independently reviewed.',
      reviewedAt: REVIEWED_AT,
    },
    rows,
  };
  packet.packetDigest = packetDigestFor(packet);
  packets.push(packet);

  const candidateMetadata = evidence.rows.map((row) => {
    const manual = Boolean(row.manualIdentityReason);
    const title = seriesTitle(row.apiSeriesName);
    return {
      id: row.selectedIssueId,
      title,
      issueTitle: row.resolvedIssueTitle,
      seriesTitle: title,
      apiSeriesName: row.apiSeriesName,
      seriesId: row.seriesId,
      issueNumber: row.metadataIssueNumber,
      seriesYear: seriesYear(row.apiSeriesName),
      manualSeriesSelection: manual,
      manualSeriesSelectionApproved: manual,
      detailUrl: row.marvelIssueUrl,
      onSaleDate: row.onSaleDate,
    };
  });
  const mappingRows = evidence.rows.map((row, index) => {
    const sourceRow = rows[index];
    return {
      sourcePosition: index + 1,
      ...sourceRow,
      resolutionStatus: 'exact',
      candidateIssueIds: [String(row.selectedIssueId)],
      selectedIssueId: row.selectedIssueId,
      marvelIssueUrl: row.marvelIssueUrl,
      resolvedIssueTitle: row.resolvedIssueTitle,
      note: row.manualIdentityReason
        ?? `Marvel series ${row.seriesId} (${row.apiSeriesName}) is the reviewed metadata series for this source reference.`,
      status: 'exact',
      selectedIssueIds: [row.selectedIssueId],
    };
  });
  const mapping = {
    id,
    inventoryId: id,
    packetDigest: packet.packetDigest,
    sourceUrl: source.canonicalUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: rows.length,
    excludedSourceReferences: spec.exclusions,
    proposedManifest: manifest,
    candidateMetadata,
    rows: mappingRows,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  mappings.push(mapping);
}

const initialFiles = [
  {
    file: INVENTORY_PATH,
    content: `${JSON.stringify({
      schemaVersion: 1,
      taskId: 'MRT-004',
      inventoryIdentitySha256,
      records: inventory,
    }, null, 2)}\n`,
  },
  ...packets.map((packet) => ({
    file: path.join(PACKETS_DIR, `${packet.id}.json`),
    content: `${JSON.stringify(packet, null, 2)}\n`,
  })),
  ...mappings.map((mapping) => ({
    file: path.join(MAPPINGS_DIR, `${mapping.id}.json`),
    content: `${JSON.stringify(mapping, null, 2)}\n`,
  })),
];
await writeFilesAtomically(initialFiles, { journalFile: JOURNAL });

const reports = [];
for (const mapping of mappings) {
  const mappingPath = path.join(MAPPINGS_DIR, `${mapping.id}.json`);
  const peerPaths = mappings
    .filter((peer) => peer.id !== mapping.id)
    .map((peer) => path.join(MAPPINGS_DIR, `${peer.id}.json`));
  reports.push(await buildReportForMapping(mappingPath, peerPaths));
}

const approvedMappings = mappings.map((mapping, index) => {
  const packet = packets[index];
  const report = reports[index];
  const spec = selections[mapping.id];
  const dispositions = report.comparisons.map((comparison) => ({
    orderId: comparison.orderId,
    relationship: comparison.relationship,
    decision: 'approved',
    rationale: relationshipRationale(spec, comparison),
    authorityType: comparison.relationship === 'none' ? 'policy' : 'stronger-model',
    authorityIdentity: comparison.relationship === 'none'
      ? 'MRT-004 none-overlap policy'
      : 'MRT-004 coordinator',
    reviewedAt: REVIEWED_AT,
  }));
  const relationshipReview = {
    reportDigest: report.reportDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: report.libraryDigest,
    peerDigests: report.peerDigests,
    dispositions,
    authorityType: 'stronger-model',
    authorityIdentity: 'MRT-004 coordinator',
    rationale: 'Every current library and selected release-peer relationship was reviewed; exact duplicates remain unapprovable.',
    reviewedAt: REVIEWED_AT,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  return {
    ...mapping,
    reviewStatus: 'approved',
    packetReview: PACKET_REVIEW,
    approvedManifest: structuredClone(packet.proposedManifest),
    relationshipReview,
  };
});

await writeFilesAtomically([
  ...approvedMappings.map((mapping) => ({
    file: path.join(MAPPINGS_DIR, `${mapping.id}.json`),
    content: `${JSON.stringify(mapping, null, 2)}\n`,
  })),
  ...reports.map((report) => ({
    file: path.join(OVERLAPS_DIR, `${report.candidateId}.json`),
    content: `${JSON.stringify(report, null, 2)}\n`,
  })),
], { journalFile: JOURNAL });

console.log(JSON.stringify({
  inventoryIdentitySha256,
  selected: approvedMappings.map((mapping, index) => ({
    id: mapping.id,
    rows: mapping.rows.length,
    comparisons: reports[index].comparisonCount,
    nonNone: reports[index].comparisons.filter((comparison) => comparison.relationship !== 'none'),
  })),
}, null, 2));
