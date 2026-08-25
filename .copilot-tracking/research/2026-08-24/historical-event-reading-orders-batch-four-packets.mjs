import { readFile, writeFile } from 'node:fs/promises';
import { packetDigestFor } from '../../../scripts/lib/cbro-evidence.mjs';
import { normalizeTitle } from '../../../src/js/lib/markdown.js';

const resolution = JSON.parse(await readFile(
  new URL('historical-event-reading-orders-batch-four-resolution.json', import.meta.url),
  'utf8',
));
const outputDir = new URL('../../../scripts/data/cbro-packets/', import.meta.url);
const selectedIds = Object.freeze([
  'evolutionary-war',
  'inferno',
  'atlantis-attacks',
  'days-of-future-present',
]);

const manifests = Object.freeze({
  'evolutionary-war': Object.freeze({
    description: 'Eleven annual chapters carrying the Evolutionary War across Marvel heroes and teams.',
    characters: Object.freeze(['X-Men', 'Avengers', 'Spider-Man', 'Fantastic Four']),
    keywords: Object.freeze(['Evolutionary War', 'High Evolutionary', 'X-Men', 'Avengers']),
    timeline: 1988,
  }),
  inferno: Object.freeze({
    description: 'Thirty-nine chapters interleaving X-Men, X-Factor, New Mutants, Spider-Man, and related Inferno stories.',
    characters: Object.freeze(['X-Men', 'X-Factor', 'New Mutants', 'Spider-Man']),
    keywords: Object.freeze(['Inferno', 'X-Men', 'X-Factor', 'New Mutants']),
    timeline: 1988,
  }),
  'atlantis-attacks': Object.freeze({
    description: 'Seventeen chapters carrying Atlantis Attacks across annuals and related Marvel stories.',
    characters: Object.freeze(['Avengers', 'Fantastic Four', 'X-Men', 'Spider-Man']),
    keywords: Object.freeze(['Atlantis Attacks', 'Avengers', 'Fantastic Four', 'X-Men']),
    timeline: 1989,
  }),
  'days-of-future-present': Object.freeze({
    description: 'Four annual chapters connecting Fantastic Four, X-Factor, New Mutants, and X-Men.',
    characters: Object.freeze(['X-Men', 'X-Factor', 'New Mutants', 'Fantastic Four']),
    keywords: Object.freeze(['Days of Future Present', 'X-Men', 'X-Factor', 'New Mutants']),
    timeline: 1990,
  }),
});

function metadataSeriesTitle(seriesName) {
  return String(seriesName).replace(/\s+\([^)]*\)\s*$/, '').trim();
}

for (const id of selectedIds) {
  const event = resolution.events.find((candidate) => candidate.id === id);
  if (!event || event.unresolvedRowCount !== 0 || event.duplicateIssueIds.length !== 0) {
    throw new Error(`${id} does not have complete exact resolution evidence`);
  }
  const manifest = manifests[id];
  const rows = event.rows.map((row) => {
    const manualSeriesSelection = normalizeTitle(row.sourceSeriesTitle)
      !== normalizeTitle(metadataSeriesTitle(row.seriesName));
    return {
      sourceIssueReference: row.sourceIssueReference,
      sourceRangeReference: null,
      normalizedSeriesTitle: row.sourceSeriesTitle,
      seriesYear: row.seriesYear,
      issueNumber: row.issueNumber,
      seriesId: row.seriesId,
      candidateIssueId: row.selectedIssueId,
      manualSeriesSelectionApproved: manualSeriesSelection,
      selectionNote: manualSeriesSelection
        ? `The source label resolves to the configured metadata series ${row.seriesName}, series ${row.seriesId}.`
        : null,
    };
  });
  const packet = {
    schemaVersion: 1,
    id,
    inventoryId: id,
    sourceProvider: 'comic-book-reading-orders',
    sourceUrl: event.sourceUrl,
    sourceRetrievedAt: event.sourceRetrievedAt.slice(0, 10),
    sourceContentSha256: event.sourceContentSha256,
    sourceBoundary: 'The active Single Issues panel, in displayed order.',
    excludedSourceReferences: [
      'Trade collections',
      'Page commentary and navigation',
      'Branding, layout, and images',
    ],
    expectedCount: rows.length,
    proposedManifest: {
      id,
      name: event.title,
      description: manifest.description,
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: `${id}.md`,
      sourcePage: event.sourceUrl,
      sourceSection: null,
      sourceOrigin: 'Compiled for this project from Comic Book Reading Orders',
      sourceLicense: null,
      out: `${id.replaceAll('-', '_')}.json`,
      characters: manifest.characters,
      keywords: manifest.keywords,
      expect: rows.length,
      timeline: manifest.timeline,
      coverIssueId: rows[0].candidateIssueId,
    },
    insertionAnchor: { beforeId: 'maximum-security' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'MRT-003-C02-B05 coordinator',
      rationale: 'The exact CBRO page, active issue panel, provider identity, refreshed source digest, unchanged row order, manifest proposal, and first-on-sale chronology were reviewed centrally.',
      reviewedAt: resolution.generatedAt,
    },
    rows,
  };
  const frozen = { ...packet, packetDigest: packetDigestFor(packet) };
  await writeFile(new URL(`${id}.json`, outputDir), `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');
}

console.log(`froze ${selectedIds.length} CBRO event-page packets with ${resolution.selectedIssueCount} rows`);
