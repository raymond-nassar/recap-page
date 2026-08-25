import { readFile, writeFile } from 'node:fs/promises';
import { packetDigestFor } from '../../../scripts/lib/cbro-evidence.mjs';
import { normalizeTitle } from '../../../src/js/lib/markdown.js';

const resolution = JSON.parse(await readFile(
  new URL('historical-event-reading-orders-batch-three-resolution.json', import.meta.url),
  'utf8',
));
const outputDir = new URL('../../../scripts/data/cbro-packets/', import.meta.url);

const manifests = {
  'kravens-last-hunt': {
    description: "Seven chapters following Kraven's Last Hunt through its later Soul of the Hunter epilogue.",
    characters: ['Spider-Man', 'Kraven the Hunter', 'Mary Jane Watson'],
    keywords: ["Kraven's Last Hunt", 'Spider-Man', 'Kraven the Hunter'],
    timeline: 1987,
  },
  'fall-of-the-mutants': {
    description: 'Twenty-nine chapters interleaving X-Factor, X-Men, New Mutants, and related Fall of the Mutants stories.',
    characters: ['X-Men', 'X-Factor', 'New Mutants'],
    keywords: ['Fall of the Mutants', 'X-Men', 'X-Factor', 'New Mutants'],
    timeline: 1988,
  },
};

function sourceSeries(reference) {
  return reference
    .replace(/\s+#.*$/, '')
    .replace(/\s+Vol\.\s+\d+$/i, '')
    .trim();
}

function seriesYear(seriesName) {
  return Number(seriesName.match(/\((\d{4})/)?.[1]);
}

for (const id of ['kravens-last-hunt', 'fall-of-the-mutants']) {
  const event = resolution.events.find((candidate) => candidate.id === id);
  const manifest = manifests[id];
  const rows = event.rows.map((row) => {
    const normalizedSeriesTitle = sourceSeries(row.sourceIssueReference);
    const metadataTitle = row.seriesName.replace(/\s+\([^)]*\)\s*$/, '').trim();
    const manualSeriesSelection = normalizeTitle(normalizedSeriesTitle)
      !== normalizeTitle(metadataTitle);
    return {
      sourceIssueReference: row.sourceIssueReference,
      sourceRangeReference: null,
      normalizedSeriesTitle,
      seriesYear: seriesYear(row.seriesName),
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
    sourceRetrievedAt: '2026-08-24',
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
      authorityIdentity: 'MRT-003-C02-B03 coordinator',
      rationale: 'The exact CBRO page, active issue panel, exclusions, provider identity, unchanged source digest, row order, manifest proposal, and first-on-sale chronology were reviewed centrally.',
      reviewedAt: '2026-08-24T22:37:22Z',
    },
    rows,
  };
  const frozen = { ...packet, packetDigest: packetDigestFor(packet) };
  await writeFile(new URL(`${id}.json`, outputDir), `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');
}

console.log('froze 2 CBRO event-page packets with 36 rows');
