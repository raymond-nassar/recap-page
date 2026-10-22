import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcuEditorial } from './lib/mcu-editorial.mjs';
import { digestCanonicalJson } from './lib/cbh-inventory.mjs';
import { firstSentence } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { writeOutputsAtomically } from './vendor-orders.mjs';
import { readPublicationInputs, preflightPublicationWrites } from './check-publication.mjs';

export async function refreshMcuDescriptions({ root = fileURLToPath(new URL('..', import.meta.url)) } = {}) {
  const manifestFile = join(root, 'src', 'data', 'curated-lists.json');
  const discoveryFile = join(root, 'src', 'data', 'mcu-prep.json');
  const payloadFiles = mcuEditorial.entries.map(({ file }) => join(root, 'src', 'data', file));
  const inputs = await readPublicationInputs({ root, paths: [manifestFile, discoveryFile, ...payloadFiles] });
  const manifest = inputs.json(manifestFile);
  const discovery = inputs.json(discoveryFile);
  const outputs = [];
  for (const [index, edit] of mcuEditorial.entries.entries()) {
    assert.match(edit.id, /^mcu-prep-/);
    assert.equal(edit.file, `${edit.id.replaceAll('-', '_')}.json`);
    assert.doesNotMatch(edit.after, /[\u2013\u2014]/);
    assert.ok(firstSentence(edit.after).length <= 140, `${edit.id}: card opening is too long.`);
    const entries = manifest.lists.filter(({ id }) => id === edit.id);
    assert.equal(entries.length, 1, `${edit.id}: expected one canonical manifest entry.`);
    const entry = entries[0];
    assert.equal(entry.out, edit.file);
    assert.ok([edit.before, edit.after].includes(entry.description), `${edit.id}: unknown manifest copy.`);
    const file = payloadFiles[index];
    const text = await readFile(file, 'utf8');
    const payload = inputs.json(file);
    const { description, ...rest } = payload;
    assert.equal(payload.id, edit.id);
    assert.ok([edit.before, edit.after].includes(description), `${edit.id}: unknown payload copy.`);
    assert.equal(digestCanonicalJson(rest), edit.nonDescriptionSha256, `${edit.id}: non-description payload changed.`);
    const header = `  "description": ${JSON.stringify(description)},`;
    assert.equal((text.match(/^ {2}"description": .+,\r?$/gm) ?? []).length, 1);
    assert.ok(text.includes(header));
    entry.description = edit.after;
    outputs.push({ file, content: text.replace(header, () => `  "description": ${JSON.stringify(edit.after)},`) });
  }
  const retired = mcuEditorial.withdrawal.manifestEntry;
  const matches = manifest.lists.filter(({ id }) => id === retired.id);
  assert.ok(matches.length <= 1, 'Duplicate retired guide.');
  if (matches.length) assert.deepEqual(matches[0], retired, 'Retired manifest differs from the reviewed source.');
  manifest.lists = manifest.lists.filter(({ id }) => id !== retired.id);
  const associations = discovery.guides.filter(({ id }) => id === retired.id);
  assert.ok(associations.length <= 1, 'Duplicate retired MCU association.');
  if (associations.length) assert.deepEqual(associations[0], mcuEditorial.withdrawal.discoveryEntry,
    'Retired MCU association differs from the reviewed source.');
  const discoveryText = await readFile(discoveryFile, 'utf8');
  const discoveryLines = discoveryText.split(/(?<=\n)/);
  const removedLines = discoveryLines.filter((line) => line.includes(`"id": "${retired.id}"`));
  assert.equal(removedLines.length, associations.length);
  assert.deepEqual(parseManifest(manifest).errors, []);
  outputs.push({ file: manifestFile, content: `${JSON.stringify(manifest, null, 2)}\n` });
  outputs.push({ file: discoveryFile, content: discoveryLines.filter((line) => !removedLines.includes(line)).join('') });
  await preflightPublicationWrites({ root, inputs, outputs });
  await writeOutputsAtomically(outputs.map(({ file, content }) => ({ path: file, content })));
  return { descriptions: mcuEditorial.entries.length, withdrawn: retired.id };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshMcuDescriptions().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
