import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonFetcher } from '../../../scripts/lib/fetch-json.mjs';
import { lookupIssues } from '../../../scripts/lib/lookup-issues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const API = 'https://marvel.emreparker.com/v1';
const ids = [
  'doctor-strange-multiverse-of-madness',
  'spider-man-no-way-home',
  'marvel-multiverse',
  'marvel-what-if',
];
const mappings = await Promise.all(ids.map(async (id) => (
  JSON.parse(await readFile(path.join(ROOT, 'scripts', 'data', 'cbh-mappings', `${id}.json`), 'utf8'))
)));
const rows = mappings.flatMap((mapping) => mapping.rows);
const { getJson } = createJsonFetcher();
const { meta, refused } = await lookupIssues(rows.map((row) => Number(row.selectedIssueId)), {
  getJson,
  url: (id) => `${API}/issues/${id}`,
});
if (refused.size > 0) throw new Error(`${refused.size} mapped issue ids returned 404`);

const failures = [];
for (const row of rows) {
  const live = meta.get(Number(row.selectedIssueId));
  if (!live) {
    failures.push(`${row.selectedIssueId}: no live metadata`);
    continue;
  }
  if (Number(live.id) !== Number(row.selectedIssueId)) failures.push(`${row.selectedIssueId}: id changed`);
  if (Number(live.seriesId) !== Number(row.seriesId)) failures.push(`${row.selectedIssueId}: series changed`);
  if (String(live.issueNumber) !== String(row.metadataIssueNumber ?? row.issueNumber)) {
    failures.push(`${row.selectedIssueId}: issue number changed`);
  }
  if (live.detailUrl !== row.marvelIssueUrl) failures.push(`${row.selectedIssueId}: detail URL changed`);
}
if (failures.length > 0) throw new Error(failures.join('\n'));
console.log(`MCU companion contract passed for ${rows.length} of ${rows.length} mapped issue ids.`);
