import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarkdown } from './author-cbh-packet.mjs';
import {
  ultimateSelection, selectedUltimateEntry, selectedUltimatePayload,
} from './lib/ultimate-spider-man-selection.mjs';
import { writeOutputsAtomically } from './vendor-orders.mjs';
import { preflightPublicationWrites, readPublicationInputs } from './check-publication.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const show = (file) => execFileSync('git', ['show', `${ultimateSelection.priorCommit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
}).replace(/\r\n/g, '\n');

export function readUltimateSelectionBaseline() {
  const text = show(`src/data/${ultimateSelection.payloadFile}`);
  assert.equal(createHash('sha256').update(text).digest('hex'), ultimateSelection.payloadSha256,
    'Ultimate Spider-Man prior payload differs from the pinned correction input.');
  return {
    text,
    payload: JSON.parse(text),
    entry: JSON.parse(show('src/data/curated-lists.json')).lists
      .find(({ id }) => id === ultimateSelection.id),
    catalog: JSON.parse(show('src/data/catalog.json')).lists
      .find(({ id }) => id === ultimateSelection.id),
  };
}

export async function correctUltimateSpiderMan() {
  const inputs = await readPublicationInputs({
    root,
    paths: [
      'scripts/data/ultimate-spider-man-selection.json',
      `scripts/data/cbh-mappings/${ultimateSelection.id}.json`,
      'src/data/curated-lists.json',
      `src/data/${ultimateSelection.payloadFile}`,
    ].map((file) => path.join(root, file)),
  });
  const baseline = readUltimateSelectionBaseline();
  const manifest = await read('src/data/curated-lists.json');
  const mapping = await read(`scripts/data/cbh-mappings/${ultimateSelection.id}.json`);
  const payload = selectedUltimatePayload(baseline.payload);
  const entry = selectedUltimateEntry(baseline.entry);
  const currentEntry = manifest.lists.find(({ id }) => id === entry.id);
  const currentPayload = await read(`src/data/${ultimateSelection.payloadFile}`);
  // Both toggled states are recognized so restoring Incursion never overwrites an unrelated edit.
  const alternate = {
    ...ultimateSelection,
    exclusions: ultimateSelection.exclusions.map((block) => block.firstSourcePosition === 336
      ? { ...block, enabled: !block.enabled } : block),
  };
  assert.ok([baseline.payload, payload, selectedUltimatePayload(baseline.payload, alternate)]
    .some((value) => JSON.stringify(value) === JSON.stringify(currentPayload)),
  'Ultimate Spider-Man current payload has unrecorded drift.');
  assert.ok([baseline.entry, entry, selectedUltimateEntry(baseline.entry, alternate)]
    .some((value) => JSON.stringify(value) === JSON.stringify(currentEntry)),
  'Ultimate Spider-Man current manifest has unrecorded drift.');
  const outputs = [
    { path: path.join(root, 'src', 'data', 'orders', currentEntry.sourceFile), content: buildMarkdown(mapping) },
    { path: path.join(root, 'src', 'data', ultimateSelection.payloadFile), content: `${JSON.stringify(payload, null, 2)}\n` },
    {
      path: path.join(root, 'src', 'data', 'curated-lists.json'),
      content: `${JSON.stringify({
        ...manifest, lists: manifest.lists.map((row) => row.id === entry.id ? entry : row),
      }, null, 2)}\n`,
    },
  ];
  await preflightPublicationWrites({
    root, inputs,
    outputs: outputs.map(({ path: file, content }) => ({ file, content })),
  });
  await writeOutputsAtomically(outputs);
  execFileSync(process.execPath, ['scripts/vendor-orders.mjs', '--catalog-only'], { cwd: root, stdio: 'inherit' });
  const catalog = await read('src/data/catalog.json');
  assert.equal(catalog.lists.find(({ id }) => id === entry.id).count, payload.items.length);
  return { count: payload.items.length, excluded: baseline.payload.items.length - payload.items.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  correctUltimateSpiderMan().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
