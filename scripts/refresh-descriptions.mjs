import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptionRevisions, planDescriptionRevisions } from './lib/description-revisions.mjs';
import { parseManifest } from '../src/js/lib/curated.js';
import { writeOutputsAtomically } from './vendor-orders.mjs';
import { readPublicationInputs, preflightPublicationWrites } from './check-publication.mjs';

export async function refreshDescriptions({
  root = fileURLToPath(new URL('..', import.meta.url)), revisions = descriptionRevisions,
} = {}) {
  if (!revisions.entries.length) return { descriptions: 0 };
  const manifestFile = join(root, 'src', 'data', 'curated-lists.json');
  const payloadFiles = revisions.entries.map(({ file }) => join(root, 'src', 'data', file));
  const inputs = await readPublicationInputs({ root, paths: [manifestFile, ...payloadFiles] });
  const payloadTexts = new Map(await Promise.all(revisions.entries.map(async ({ file }, index) =>
    [file, await readFile(payloadFiles[index], 'utf8')])));
  const plan = planDescriptionRevisions({ revisions, manifest: inputs.json(manifestFile), payloadTexts });
  const errors = parseManifest(plan.manifest).errors;
  if (errors.length) throw new Error(`Revised manifest is invalid: ${errors.join('; ')}`);
  const outputs = [
    ...plan.payloads.map(({ file, content }) => ({ file: join(root, 'src', 'data', file), content })),
    { file: manifestFile, content: `${JSON.stringify(plan.manifest, null, 2)}\n` },
  ];
  await preflightPublicationWrites({ root, inputs, outputs });
  await writeOutputsAtomically(outputs.map(({ file, content }) => ({ path: file, content })));
  return { descriptions: revisions.entries.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshDescriptions().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
