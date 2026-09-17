import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { authenticatedRequest, fingerprint } from './inspect-store-recovery.mjs';
import { TARGET, bindApplication } from './resume-store-recovery.mjs';
import { prepareApiDraft } from './check-store-release.mjs';

export function reconstructOriginal(published, current, expectedFingerprint) {
  const original = structuredClone(published);
  for (const key of ['id', 'status']) {
    if (Object.hasOwn(current, key)) original[key] = current[key];
    else delete original[key];
  }
  const carried = structuredClone(current);
  if (Array.isArray(original.applicationPackages) && Array.isArray(carried.applicationPackages)) {
    const old = carried.applicationPackages.filter((entry) => entry.fileStatus === 'PendingDelete');
    const added = carried.applicationPackages.filter((entry) =>
      entry.fileStatus === 'PendingUpload' && entry.fileName === TARGET.bundle);
    if (original.applicationPackages.length !== 1
      || original.applicationPackages[0].fileStatus !== 'Uploaded'
      || carried.applicationPackages.length !== 2 || old.length !== 1 || added.length !== 1
      || old[0].fileName !== original.applicationPackages[0].fileName) {
      throw new Error('Current package edits do not match the accepted update');
    }
    carried.applicationPackages = [{
      ...old[0], fileStatus: original.applicationPackages[0].fileStatus,
    }];
  }
  if (carried.listings?.['en-us']?.baseListing && original.listings?.['en-us']?.baseListing) {
    carried.listings['en-us'].baseListing.releaseNotes = original.listings['en-us'].baseListing.releaseNotes;
  }
  const keys = [...new Set([...Object.keys(original), ...Object.keys(carried)])].filter((key) =>
    !['id', 'status', 'fileUploadUrl', 'statusDetails'].includes(key)
    && JSON.stringify(original[key]) !== JSON.stringify(carried[key]));
  if (keys.length > 8) throw new Error('Reconstruction exceeds the bounded observed-field search');
  // Only values observed in the two authenticated resources participate; the original seal decides.
  for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    const candidate = structuredClone(original);
    keys.forEach((key, index) => {
      if ((mask & (1 << index)) === 0) return;
      if (Object.hasOwn(carried, key)) candidate[key] = carried[key];
      else delete candidate[key];
    });
    if (fingerprint(candidate) === expectedFingerprint) return candidate;
  }
  throw new Error('The original draft could not be reconstructed exactly');
}

export function differences(expected, actual, path = '') {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) {
    return expected.flatMap((value, index) => differences(value, actual[index], `${path}/${index}`));
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object'
    && !Array.isArray(expected) && !Array.isArray(actual)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().flatMap((key) => {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(key)) throw new Error('Unsafe diagnostic field name');
      if (['fileUploadUrl', 'statusDetails', 'applicationPackages'].includes(key) && path === '') return [];
      return differences(expected[key], actual[key], `${path}/${key}`);
    });
  }
  const kind = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const digest = (value) => fingerprint({ value: value === undefined ? { absent: true } : value });
  const sameDate = typeof expected === 'string' && typeof actual === 'string'
    && /^\d{4}-\d\d-\d\dT/.test(expected) && /^\d{4}-\d\d-\d\dT/.test(actual)
    && Number.isFinite(Date.parse(expected)) && Date.parse(expected) === Date.parse(actual);
  return [{
    path, expectedKind: kind(expected), actualKind: kind(actual),
    expectedHash: digest(expected), actualHash: digest(actual), sameDate,
  }];
}

export function diagnose(published, current, notes) {
  if (published.id !== TARGET.published || published.status !== 'Published'
    || fingerprint(published) !== TARGET.publishedFingerprint
    || current.id !== TARGET.draft || current.status !== 'PendingCommit'
    || fingerprint(notes) !== TARGET.notesFingerprint) {
    throw new Error('Diagnostic identity, status or approved baseline differs');
  }
  const original = reconstructOriginal(published, current, TARGET.draftFingerprint);
  const prepared = prepareApiDraft(original, TARGET.bundle, TARGET.draft, notes, TARGET.version);
  prepared.targetPublishDate = original.targetPublishDate;
  const changed = differences(prepared, current);
  if (changed.length > 50) throw new Error('Diagnostic difference population exceeds its bound');
  return {
    submissionId: TARGET.draft, status: current.status,
    originalReconstructedExactly: true,
    intendedFingerprint: fingerprint(prepared), currentFingerprint: fingerprint(current),
    differences: changed,
    notesMatch: current.listings?.['en-us']?.baseListing?.releaseNotes === notes.text,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stage = 'authentication';
  try {
    const request = await authenticatedRequest();
    const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${TARGET.product}`;
    stage = 'application binding';
    bindApplication(await request(root));
    stage = 'published baseline read';
    const published = await request(`${root}/submissions/${TARGET.published}`);
    stage = 'current draft read';
    const current = await request(`${root}/submissions/${TARGET.draft}`);
    stage = 'sealed reconstruction and comparison';
    const notes = JSON.parse(readFileSync(new URL('../docs/releases/3.0.0-store.json', import.meta.url), 'utf8'));
    const result = diagnose(published, current, notes);
    const output = JSON.stringify(result, null, 2);
    process.stdout.write(`${output}\n`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Read-only draft difference diagnosis\n\n\`\`\`json\n${output}\n\`\`\`\n`);
  } catch (error) {
    const safeReasons = [
      'The original draft could not be reconstructed exactly',
      'Reconstruction exceeds the bounded observed-field search',
      'Diagnostic identity, status or approved baseline differs',
      'Diagnostic difference population exceeds its bound',
      'Unsafe diagnostic field name',
      'Current package edits do not match the accepted update',
    ];
    const reason = safeReasons.includes(error.message) ? error.message : 'External request or response validation failed';
    process.stderr.write(`Read-only draft diagnosis failed at ${stage}: ${reason}. No mutation attempted; private response details suppressed.\n`);
    process.exitCode = 1;
  }
}
