import { readFile, writeFile } from 'node:fs/promises';
import { packetDigestFor } from '../../../scripts/lib/cbro-evidence.mjs';
import { normalizeTitle } from '../../../src/js/lib/markdown.js';

const resolution = JSON.parse(await readFile(
  new URL('licensed-character-issues-resolution.json', import.meta.url),
  'utf8',
));
const outputDir = new URL('../../../scripts/data/cbro-packets/', import.meta.url);

const manifests = Object.freeze({
  'wraith-war': Object.freeze({
    description: 'Seven essential Wraith War chapters from Hulk, Avengers, and Uncanny X-Men, selected from the full source order.',
    depth: 'essential',
    characters: Object.freeze(['Hulk', 'Avengers', 'X-Men']),
    keywords: Object.freeze(['Wraith War', 'Dire Wraiths', 'Avengers', 'X-Men']),
    timeline: 1984,
  }),
  'secret-wars-ii': Object.freeze({
    description: 'Forty selected Secret Wars II chapters, omitting two nonessential tie-ins that are not discoverable through Marvel Unlimited.',
    depth: 'selected',
    characters: Object.freeze(['Beyonder', 'Avengers', 'Spider-Man', 'Fantastic Four', 'X-Men']),
    keywords: Object.freeze(['Secret Wars II', 'Beyonder', 'Marvel event']),
    timeline: 1985,
  }),
  'mutant-massacre': Object.freeze({
    description: 'Eleven selected Mutant Massacre chapters, omitting one nonessential tie-in that is not discoverable through Marvel Unlimited.',
    depth: 'selected',
    characters: Object.freeze(['X-Men', 'X-Factor', 'New Mutants', 'Thor', 'Daredevil']),
    keywords: Object.freeze(['Mutant Massacre', 'X-Men', 'X-Factor', 'Marauders']),
    timeline: 1986,
  }),
});

function metadataSeriesTitle(seriesName) {
  return seriesName.replace(/\s+\(\d{4}(?:\s*-\s*[^)]*)?\)\s*$/, '').trim();
}

for (const event of resolution.guides) {
  const manifest = manifests[event.id];
  if (!manifest) throw new Error(`No manifest proposal exists for ${event.id}`);
  const rows = event.rows.map((row) => {
    const apiTitle = metadataSeriesTitle(row.apiSeriesName);
    const manualSeriesSelection = (
      normalizeTitle(apiTitle) !== normalizeTitle(row.normalizedSeriesTitle)
    );
    return {
      sourceIssueReference: row.sourceIssueReference,
      sourceRangeReference: null,
      normalizedSeriesTitle: row.normalizedSeriesTitle,
      seriesYear: row.seriesYear,
      issueNumber: row.issueNumber,
      seriesId: row.seriesId,
      candidateIssueId: row.candidateIssueId,
      manualSeriesSelectionApproved: manualSeriesSelection,
      selectionNote: manualSeriesSelection
        ? `The source label resolves to the configured metadata series ${row.apiSeriesName}, series ${row.seriesId}.`
        : null,
    };
  });
  const packet = {
    schemaVersion: 1,
    id: event.id,
    inventoryId: event.id,
    sourceProvider: 'comic-book-reading-orders',
    sourceUrl: event.sourceUrl,
    sourceSection: null,
    sourceRetrievedAt: '2026-08-24',
    sourceContentSha256: event.sourceContentSha256,
    sourceBoundary: 'The active Single Issues panel, in displayed order.',
    excludedSourceReferences: [
      'Trade collections',
      'Page commentary and navigation',
      'Branding, layout, and images',
    ],
    excludedSourceRows: event.excludedSourceRows,
    sourceOccurrenceCount: event.sourceRowCount,
    expectedCount: rows.length,
    proposedManifest: {
      id: event.id,
      name: event.title,
      description: manifest.description,
      type: 'event',
      depth: manifest.depth,
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: `${event.id}.md`,
      sourcePage: event.sourceUrl,
      sourceSection: null,
      sourceOrigin: 'Compiled for this project from Comic Book Reading Orders',
      sourceLicense: null,
      out: `${event.id.replaceAll('-', '_')}.json`,
      characters: manifest.characters,
      keywords: manifest.keywords,
      expect: rows.length,
      timeline: manifest.timeline,
      coverIssueId: rows[0].candidateIssueId,
    },
    insertionAnchor: { beforeId: 'fall-of-the-mutants' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'MRT-003-C02-B04 coordinator',
      rationale: 'The exact source page, 89-row conservation ledger, approved guide-scoped exclusions, retained metadata, first-on-sale chronology, and non-complete manifest proposal were reviewed centrally.',
      reviewedAt: resolution.generatedAt,
    },
    rows,
  };
  const frozen = { ...packet, packetDigest: packetDigestFor(packet) };
  await writeFile(
    new URL(`${event.id}.json`, outputDir),
    `${JSON.stringify(frozen, null, 2)}\n`,
    'utf8',
  );
}

console.log(`froze ${resolution.guides.length} exclusion-aware packets with ${resolution.retainedCount} retained rows`);
