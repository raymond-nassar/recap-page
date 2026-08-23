import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComparisonReport } from '../../../scripts/lib/cbh-overlap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const boundariesPath = path.join(root, '.copilot-tracking', 'research', '2026-08-22', 'character-spotlight-boundaries.json');
const manifestPath = path.join(root, 'src', 'data', 'curated-lists.json');
const outputPath = path.join(root, '.copilot-tracking', 'research', '2026-08-22', 'character-spotlight-white-tiger-evidence.json');
const api = 'https://marvel.emreparker.com/v1';
const metadataHorizon = '2025-10-29T23:59:59Z';

const series = Object.freeze({
  avengersAcademy: { id: 9086, title: 'Avengers Academy', year: 2010 },
  youngAvengers: { id: 17647, title: 'Young Avengers', year: 2013 },
  avengersArena: { id: 16875, title: 'Avengers Arena', year: 2012 },
  mightyAvengers: { id: 18309, title: 'Mighty Avengers', year: 2013 },
  infinity: { id: 17735, title: 'Infinity', year: 2013 },
  captainAmerica2012: { id: 16516, title: 'Captain America', year: 2012 },
  captainAmericaMightyAvengers: { id: 19160, title: 'Captain America & the Mighty Avengers', year: 2014 },
  shield: { id: 19639, title: 'S.H.I.E.L.D.', year: 2014 },
  newAvengers: { id: 20841, title: 'New Avengers', year: 2015 },
  allNewHawkeye: { id: 19255, title: 'All-New Hawkeye', year: 2015 },
  agentsOfShield: { id: 20607, title: 'Agents of S.H.I.E.L.D.', year: 2016 },
  squirrelGirlFirst: { id: 19750, title: 'The Unbeatable Squirrel Girl', year: 2015 },
  squirrelGirlSecond: { id: 20620, title: 'The Unbeatable Squirrel Girl', year: 2015 },
  powerManIronFist: { id: 21122, title: 'Power Man and Iron Fist', year: 2016 },
  defenders: { id: 23074, title: 'Defenders', year: 2017 },
  captainAmerica2018: { id: 24503, title: 'Captain America', year: 2018 },
  marvelComics: { id: 27020, title: 'Marvel Comics', year: 2019 },
  valkyrie: { id: 27826, title: 'Valkyrie: Jane Foster', year: 2019 },
  contagion: { id: 28968, title: 'Contagion', year: 2019 },
  empyreAftermath: { id: 29276, title: 'Empyre: Aftermath Avengers', year: 2020 },
  womenOfMarvel: { id: 32095, title: 'Women of Marvel', year: 2021 },
  marvelVoicesCommunity: { id: 35716, title: "Marvel's Voices: Community", year: 2022 },
});

function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
}

function sourceRows(entry, numbers, sourceRangeReference, options = {}) {
  return numbers.map((issueNumber) => ({
    sourceIssueReference: `${options.sourceTitle ?? entry.title} #${issueNumber}`,
    sourceRangeReference,
    normalizedSeriesTitle: entry.title,
    seriesYear: entry.year,
    issueNumber,
    seriesId: entry.id,
    manualSeriesSelectionApproved: options.manualSeriesSelectionApproved ?? false,
    selectionNote: options.selectionNote ?? null,
  }));
}

const rows = [
  ...sourceRows(series.avengersAcademy, range(21, 39), 'Avengers Academy (2010) #21-39'),
  ...sourceRows(series.youngAvengers, range(12, 13), 'The Ava Ayala Cut: Young Avengers (2013) #12-13'),
  ...sourceRows(series.avengersArena, ['13'], 'The Ava Ayala Cut: Avengers Arena #13'),
  ...sourceRows(series.mightyAvengers, ['1', '3', '4', '5'], 'The Ava Ayala Cut: Mighty Avengers #1, 3-5'),
  ...sourceRows(series.infinity, ['3'], 'The Ava Ayala Cut: Infinity #3'),
  ...sourceRows(series.mightyAvengers, range(6, 8), 'The Ava Ayala Cut: Mighty Avengers #6-8'),
  ...sourceRows(series.mightyAvengers, range(12, 14), 'The Ava Ayala Cut: Mighty Avengers #12-14'),
  ...sourceRows(series.captainAmerica2012, ['25'], 'The Ava Ayala Cut: Captain America #25'),
  ...sourceRows(series.captainAmericaMightyAvengers, range(1, 7), 'Captain America & The Mighty Avengers #1-7'),
  ...sourceRows(series.shield, ['1'], 'The Ava Ayala Cut: S.H.I.E.L.D. #1'),
  ...sourceRows(series.captainAmericaMightyAvengers, range(8, 9), 'The Ava Ayala Cut: Captain America & The Mighty Avengers #8-9'),
  ...sourceRows(series.newAvengers, range(1, 6), 'New Avengers #1-6'),
  ...sourceRows(series.allNewHawkeye, ['2'], 'The Ava Ayala Cut: All-New Hawkeye #2'),
  ...sourceRows(series.agentsOfShield, range(3, 4), 'The Ava Ayala Cut: Agents of S.H.I.E.L.D. #3-4'),
  ...sourceRows(series.newAvengers, range(7, 10), 'The Ava Ayala Cut: New Avengers (2015) #7-10'),
  ...sourceRows(series.squirrelGirlFirst, ['8'], 'The Ava Ayala Cut: The Unbeatable Squirrel Girl #8'),
  ...sourceRows(series.powerManIronFist, ['6'], 'The Ava Ayala Cut: Power Man and Iron Fist #6'),
  ...sourceRows(series.newAvengers, range(14, 18), 'The Ava Ayala Cut: New Avengers (2015) #14-18'),
  ...sourceRows(series.defenders, ['9'], 'The Ava Ayala Cut: Defenders (2017) #9'),
  ...sourceRows(series.squirrelGirlSecond, ['27'], 'The Ava Ayala Cut: The Unbeatable Squirrel Girl (2015) #27'),
  ...sourceRows(series.captainAmerica2018, ['7', '8', '9', '12'], 'The Ava Ayala Cut: Captain America (2018) #7-9, #12'),
  ...sourceRows(series.marvelComics, ['1000'], 'Marvel Comics #1000'),
  ...sourceRows(series.captainAmerica2018, ['13', '14', '16'], 'The Ava Ayala Cut: Captain America (2018) #13-14, #16'),
  ...sourceRows(series.valkyrie, ['6'], 'The Ava Ayala Cut: Valkyrie: Jane Foster (2019) #6'),
  ...sourceRows(series.contagion, range(3, 5), 'The Ava Ayala Cut: Contagion (2019) #3-5'),
  ...sourceRows(series.empyreAftermath, ['1'], 'Empyre: Aftermath Avengers (2020) #1'),
  ...sourceRows(series.womenOfMarvel, ['1'], 'The Ava Ayala Cut: Women of Marvel (2021) #1'),
  ...sourceRows(series.captainAmerica2018, ['29'], 'The Ava Ayala Cut: Captain America (2018) #29'),
  ...sourceRows(
    series.marvelVoicesCommunity,
    ['1'],
    "Marvel's Voices: Community (2021) #1",
    {
      sourceTitle: "Marvel's Voices: Community (2021)",
      manualSeriesSelectionApproved: true,
      selectionNote: "The source labels the one-shot 2021; Marvel's metadata groups the issue under its 2022 collection year.",
    },
  ),
];

async function getSeries(entry) {
  const response = await fetch(`${api}/series/${entry.id}/issues?limit=200&offset=0`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${entry.title} metadata request failed with ${response.status}`);
  const body = await response.json();
  if (body.has_next) throw new Error(`${entry.title} metadata unexpectedly requires another page`);
  return body;
}

const seriesBodies = new Map();
for (const entry of Object.values(series)) {
  if (!seriesBodies.has(entry.id)) seriesBodies.set(entry.id, await getSeries(entry));
}

const resolvedRows = rows.map((row, index) => {
  const candidates = seriesBodies.get(row.seriesId).items.filter((item) => String(item.issueNumber) === row.issueNumber);
  if (candidates.length !== 1) {
    throw new Error(`Row ${index + 1} ${row.sourceIssueReference} resolved to ${candidates.length} metadata records`);
  }
  const candidate = candidates[0];
  if (new Date(candidate.onSaleDate) > new Date(metadataHorizon)) {
    throw new Error(`Row ${index + 1} ${row.sourceIssueReference} exceeds the metadata horizon`);
  }
  return {
    ...row,
    candidateIssueId: candidate.id,
    resolvedIssueTitle: candidate.title,
    onSaleDate: candidate.onSaleDate,
  };
});

const candidateIds = resolvedRows.map((row) => String(row.candidateIssueId));
if (new Set(candidateIds).size !== candidateIds.length) throw new Error('White Tiger source rows resolved to duplicate issues');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const orders = [];
for (const entry of manifest.lists) {
  const payload = JSON.parse(await readFile(path.join(root, 'src', 'data', entry.out), 'utf8'));
  orders.push({ orderId: entry.id, items: payload.items });
}
const report = buildComparisonReport({ candidateIds, orders });
const boundaryDocument = JSON.parse(await readFile(boundariesPath, 'utf8'));
const boundary = boundaryDocument.records.find((record) => record.url === 'https://www.comicbookherald.com/ava-ayala-reading-order/');
if (!boundary) throw new Error('White Tiger boundary record is missing');

const nonNoneRelationships = report.comparisons.filter((comparison) => comparison.relationship !== 'none');
const output = {
  taskId: 'MRT-002-C01',
  candidateId: 'white-tiger-ava-ayala',
  sourceUrl: boundary.url,
  sourceRetrievedAt: '2026-08-23',
  sourceContentSha256: boundary.contentSha256,
  sourceSection: 'Ava Ayala complete reading path using each explicit Ava Ayala Cut plus whole entries where the guide supplies no narrower cut',
  sourceBoundary: "Begins with Avengers Academy (2010) #21 and ends with Marvel's Voices: Community #1. Collection contents are used only when the guide presents the whole entry without a narrower Ava Ayala Cut. Every explicit Ava Ayala Cut replaces its surrounding collection contents.",
  excludedSourceReferences: [
    'Related reading-order links',
    'Collection issues replaced by an explicit Ava Ayala Cut',
    'Editorial commentary and non-issue prose',
  ],
  metadataHorizon,
  expectedCount: resolvedRows.length,
  rowsDigest: createHash('sha256').update(JSON.stringify(resolvedRows)).digest('hex'),
  rows: resolvedRows,
  relationshipEvidence: {
    libraryListCount: orders.length,
    candidateCount: report.candidateCount,
    comparisonCount: report.comparisonCount,
    nonNoneRelationships,
  },
  centralDisposition: {
    boundary: 'approved',
    metadataHorizon: 'approved',
    relationship: nonNoneRelationships.some((relationship) => (
      relationship.relationship === 'candidate-subset'
      || relationship.relationship === 'existing-subset'
      || relationship.relationship === 'partial'
    )) ? 'approved-with-recorded-overlap' : 'approved',
    surface: 'character-run',
    selection: 'pilot-approved',
    authority: 'coordinator',
  },
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  candidateId: output.candidateId,
  expectedCount: output.expectedCount,
  latestOnSaleDate: resolvedRows.map((row) => row.onSaleDate).sort().at(-1),
  nonNoneRelationships,
}, null, 2));
