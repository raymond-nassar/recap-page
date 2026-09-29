import { execFileSync } from 'node:child_process';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ROOT, androidBuild, artifactRecord, reserveAndroidBuild, sealAndroidArtifact,
  validateAndroidLedger, verifyArtifact, verifyAndroidPromotion,
} from './lib/release-identity.mjs';

const [command, input, output] = process.argv.slice(2);
const ledgerPath = process.env.RECAP_ANDROID_LEDGER ?? join(ROOT, 'packaging', 'android', 'version-codes.json');
async function updateLedger(change) {
  const lockPath = `${ledgerPath}.lock`;
  const lock = await open(lockPath, 'wx');
  const temporary = `${ledgerPath}.next`;
  let pending;
  try {
    const previous = validateAndroidLedger(JSON.parse(await readFile(ledgerPath, 'utf8')));
    const next = await change(previous);
    pending = await open(temporary, 'wx');
    await pending.writeFile(`${JSON.stringify(validateAndroidLedger(next), null, 2)}\n`);
    await pending.close();
    await rename(temporary, ledgerPath);
    return next;
  } finally {
    if (pending) {
      await pending.close();
      await rm(temporary, { force: true });
    }
    await lock.close();
    await rm(lockPath);
  }
}

if (command === 'version' && !input) {
  console.log(JSON.stringify(await androidBuild()));
} else if (command === 'reserve' && /^[0-9a-f]{40}$/.test(input) && !output) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  if (git('rev-parse', `${input}^{commit}`) !== input) throw new Error('Source must be an exact commit');
  const productVersion = JSON.parse(git('show', `${input}:package.json`)).version;
  const sourceTree = git('rev-parse', `${input}^{tree}`);
  const next = await updateLedger((ledger) => reserveAndroidBuild(ledger, { productVersion, sourceRevision: input, sourceTree }));
  console.log(`Reserved ${next.reservations.at(-1).versionCode}. Merge this append-only reservation before building the pinned source. A reservation is not upload authorization.`);
} else if (command === 'record' && input && output) {
  const { identity } = await androidBuild();
  const record = await artifactRecord(input, identity);
  const saveRecord = () => writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  if (identity.channel === 'candidate') {
    await updateLedger(async (ledger) => {
      const sealed = sealAndroidArtifact(ledger, record);
      await saveRecord();
      return sealed;
    });
  } else {
    await saveRecord();
  }
  console.log(`Recorded ${record.artifact.name} (${identity.channel}); no upload performed.`);
} else if (command === 'verify' && input && output) {
  await verifyArtifact(input, JSON.parse(await readFile(output, 'utf8')));
  console.log('Exact artifact verified; no rebuild or upload performed.');
} else if (command === 'promotion' && input && output) {
  await verifyAndroidPromotion(input, JSON.parse(await readFile(output, 'utf8')),
    JSON.parse(await readFile(ledgerPath, 'utf8')));
  console.log('Exact sealed Android candidate verified; owner approval and store eligibility are still required.');
} else {
  throw new Error('Usage: android-release.mjs version | reserve <full-source-sha> | record <apk-or-aab> <new-record.json> | verify <artifact> <record.json> | promotion <artifact> <record.json>');
}
