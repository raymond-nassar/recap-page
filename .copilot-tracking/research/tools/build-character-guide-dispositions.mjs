import { readFile, writeFile } from 'node:fs/promises';

const researchRoot = new URL('../2026-08-22/', import.meta.url);
const inventory = JSON.parse(await readFile(new URL('character-spotlight-source-inventory.json', researchRoot), 'utf8'));
const boundaries = JSON.parse(await readFile(new URL('character-spotlight-boundaries.json', researchRoot), 'utf8'));
const whiteTiger = JSON.parse(await readFile(new URL('character-spotlight-white-tiger-evidence.json', researchRoot), 'utf8'));
const outputPath = new URL('character-spotlight-dispositions.json', researchRoot);

const excludedSurfaceSlugs = new Set([
  'brian-michael-bendis-marvel-universe-reading-order-2000-2018',
  'donny-cates-marvel-universe-reading-order-2017',
  'jonathan-hickman-marvel-universe-reading-order-2008-to-2016',
  'every-marvel-max-comic-book-series',
  'marvel-and-dc-comics-crossovers-reading-order',
  'the-completely-insane-guide-to-every-marvel-original-graphic-novel-ever',
]);
const excludedProvenanceSlugs = new Set([
  'conan-the-barbarian-comics-reading-order',
  'marvel-and-dc-comics-crossovers-reading-order',
]);

const inventoryByUrl = new Map();
for (const entry of inventory.entries) {
  const current = inventoryByUrl.get(entry.url) ?? {
    labels: [],
    positions: [],
    duplicateFlags: [],
    currentCatalogIds: [],
  };
  current.labels.push(entry.label);
  current.positions.push(entry.position);
  if (entry.duplicateFlag) current.duplicateFlags.push(entry.duplicateFlag);
  current.currentCatalogIds.push(...entry.currentCatalogIds);
  inventoryByUrl.set(entry.url, current);
}

const records = boundaries.records.map((boundary) => {
  const source = inventoryByUrl.get(boundary.url);
  if (!source) throw new Error(`Boundary URL is absent from inventory: ${boundary.url}`);
  const slug = new URL(boundary.url).pathname.split('/').filter(Boolean).at(-1);
  const selectedPilot = boundary.url === whiteTiger.sourceUrl;
  const surfaceExcluded = excludedSurfaceSlugs.has(slug);
  const provenanceExcluded = excludedProvenanceSlugs.has(slug);
  const confirmedPostHorizon = boundary.maximumExplicitIssueBlockYear != null
    && boundary.maximumExplicitIssueBlockYear > 2025;

  let centralDisposition;
  let reason;
  if (selectedPilot) {
    centralDisposition = 'pilot-approved';
    reason = `All ${whiteTiger.expectedCount} source rows resolved exactly inside the metadata horizon and were compared with all ${whiteTiger.relationshipEvidence.libraryListCount} current lists.`;
  } else if (surfaceExcluded || provenanceExcluded) {
    centralDisposition = 'excluded';
    reason = [
      surfaceExcluded ? 'The source is author-centric, topical, or catalog-oriented rather than a character or team reading path.' : null,
      provenanceExcluded ? 'The source includes licensed material outside the unqualified Marvel metadata and provenance contract.' : null,
    ].filter(Boolean).join(' ');
  } else if (confirmedPostHorizon) {
    centralDisposition = 'blocked';
    reason = `The retained source snapshot explicitly names a ${boundary.maximumExplicitIssueBlockYear} issue, beyond the 2025-10-29 metadata horizon.`;
  } else if (source.currentCatalogIds.length > 0) {
    centralDisposition = 'deferred';
    reason = 'The exact source URL is already represented in the catalog; issue-set identity still requires a frozen mapping before any variant decision.';
  } else {
    centralDisposition = 'deferred';
    reason = 'The source boundary is exact, but issue rows have not been frozen and resolved against the metadata snapshot, so a complete-library relationship cannot be asserted safely.';
  }

  return {
    sourceIdentity: boundary.url,
    labels: source.labels,
    positions: source.positions,
    duplicateFlags: source.duplicateFlags,
    sourceBoundary: {
      status: 'exact-page-snapshot',
      wordpressId: boundary.wordpressId,
      canonicalUrl: boundary.canonicalUrl,
      contentSha256: boundary.contentSha256,
      firstHeading: boundary.firstHeading,
      lastHeading: boundary.lastHeading,
      issueBearingBlockCount: boundary.issueBearingBlockCount,
      issueBearingBlocksSha256: boundary.issueBearingBlocksSha256,
    },
    metadataHorizon: selectedPilot
      ? {
          status: 'approved',
          lastResolvedOnSaleDate: whiteTiger.rows.map((row) => row.onSaleDate).sort().at(-1),
          resolvedCount: whiteTiger.expectedCount,
        }
      : {
          status: confirmedPostHorizon ? 'blocked-confirmed-post-horizon' : 'blocked-exact-resolution-not-run',
          wordpressModified: boundary.wordpressModified,
          maximumExplicitIssueBlockYear: boundary.maximumExplicitIssueBlockYear,
        },
    completeLibraryRelationship: selectedPilot
      ? {
          status: whiteTiger.centralDisposition.relationship,
          comparisonCount: whiteTiger.relationshipEvidence.comparisonCount,
          candidateCount: whiteTiger.relationshipEvidence.candidateCount,
          nonNoneRelationships: whiteTiger.relationshipEvidence.nonNoneRelationships,
        }
      : {
          status: surfaceExcluded || provenanceExcluded
            ? 'not-applicable-excluded'
            : 'blocked-exact-resolution-not-run',
          currentCatalogIds: [...new Set(source.currentCatalogIds)],
        },
    centralDisposition,
    reason,
  };
});

const counts = records.reduce((summary, record) => {
  summary[record.centralDisposition] = (summary[record.centralDisposition] ?? 0) + 1;
  return summary;
}, {});

const output = {
  taskId: 'MRT-002-C01',
  generatedOn: '2026-08-23',
  authority: 'coordinator',
  sourceEntryCount: inventory.entryCount,
  sourceIdentityCount: records.length,
  metadataHorizon: boundaries.metadataHorizon,
  selectionGate: 'No pilot was selected until every source identity had an exact boundary record and a central disposition, and the selected pilot alone had exact metadata and complete-current-library evidence.',
  counts,
  records,
};

if (records.length !== inventory.distinctSourceIdentityCount) {
  throw new Error(`Expected ${inventory.distinctSourceIdentityCount} dispositions, found ${records.length}`);
}
if (counts['pilot-approved'] !== 1) throw new Error('Exactly one bounded pilot must be approved');
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(counts, null, 2));
