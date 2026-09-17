import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { authenticatedRequest, fingerprint } from './inspect-store-recovery.mjs';
import { TARGET, bindApplication } from './resume-store-recovery.mjs';
import { prepareApiDraft } from './check-store-release.mjs';

export function reconstructOriginal(published, current, expectedFingerprint) {
  const original = structuredClone(published);
  for (const key of ['id', 'status', 'friendlyName']) {
    if (Object.hasOwn(current, key)) original[key] = current[key];
    else delete original[key];
  }
  if (fingerprint(original) !== expectedFingerprint) {
    throw new Error('The original draft could not be reconstructed exactly');
  }
  return original;
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
  try {
    const request = await authenticatedRequest();
    const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${TARGET.product}`;
    bindApplication(await request(root));
    const published = await request(`${root}/submissions/${TARGET.published}`);
    const current = await request(`${root}/submissions/${TARGET.draft}`);
    const notes = JSON.parse(readFileSync(new URL('../docs/releases/3.0.0-store.json', import.meta.url), 'utf8'));
    const result = diagnose(published, current, notes);
    const output = JSON.stringify(result, null, 2);
    process.stdout.write(`${output}\n`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Read-only draft difference diagnosis\n\n\`\`\`json\n${output}\n\`\`\`\n`);
  } catch {
    process.stderr.write('Read-only draft diagnosis failed. No mutation attempted; private response details suppressed.\n');
    process.exitCode = 1;
  }
}
