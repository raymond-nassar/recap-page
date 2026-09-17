import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint } from '../scripts/inspect-store-recovery.mjs';
import { reconstructOriginal, differences } from '../scripts/diagnose-store-draft.mjs';
import { TARGET } from '../scripts/resume-store-recovery.mjs';

test('draft reconstruction is accepted only with the exact original sealed fingerprint', () => {
  const published = { id: '123', status: 'Published', friendlyName: 'Submission 1', listing: 'Original', carriedFlag: false };
  const original = { ...published, id: '456', status: 'PendingCommit', friendlyName: 'Submission 2', carriedFlag: true };
  const current = { ...original, listing: 'Modified' };
  assert.deepEqual(reconstructOriginal(published, current, fingerprint(original)), original);
  assert.throws(() => reconstructOriginal({ ...published, listing: 'Wrong' }, current, fingerprint(original)), /exactly/);
  assert.throws(() => reconstructOriginal(published, { ...current, friendlyName: 'Wrong' }, fingerprint(original)), /exactly/);
  const tooMany = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field${index}`, true]));
  assert.throws(() => reconstructOriginal({}, tooMany, fingerprint({})), /bounded/);
});

test('draft reconstruction inverts only the accepted package edits and retains cloned metadata', () => {
  const published = {
    id: '123', status: 'Published',
    applicationPackages: [{ id: 'published', fileName: 'old.msixbundle', fileStatus: 'Uploaded' }],
  };
  const original = {
    ...published, id: '456', status: 'PendingCommit',
    applicationPackages: [{ id: 'cloned', fileName: 'old.msixbundle', fileStatus: 'Uploaded' }],
  };
  const current = structuredClone(original);
  current.applicationPackages[0].fileStatus = 'PendingDelete';
  current.applicationPackages.push({ fileName: TARGET.bundle, fileStatus: 'PendingUpload' });
  assert.deepEqual(reconstructOriginal(published, current, fingerprint(original)), original);
  for (const mutate of [
    (copy) => { copy.applicationPackages[1].fileName = 'other.msixbundle'; },
    (copy) => { copy.applicationPackages[0].fileName = 'other-old.msixbundle'; },
    (copy) => { copy.applicationPackages[0].fileStatus = 'Uploaded'; },
    (copy) => { copy.applicationPackages.push({ fileName: 'extra.msixbundle' }); },
  ]) {
    const invalid = structuredClone(current);
    mutate(invalid);
    assert.throws(() => reconstructOriginal(published, invalid, fingerprint(original)), /accepted update/);
  }
});

test('draft diagnosis emits difference paths and hashes but never private values or upload locations', () => {
  const before = { date: '1601-01-01T00:00:00Z', listing: { description: 'private-before' }, fileUploadUrl: 'secret' };
  const after = { date: '1601-01-01T00:00:00.000Z', listing: { description: 'private-after' }, fileUploadUrl: 'different-secret' };
  const result = differences(before, after);
  assert.deepEqual(result.map((entry) => entry.path), ['/date', '/listing/description']);
  assert.equal(result[0].sameDate, true);
  assert.equal(result[1].sameDate, false);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|fileUploadUrl/);
  assert.throws(() => differences({ 'unsafe/key': 1 }, { 'unsafe/key': 2 }), /Unsafe/);
});

test('draft diagnosis remains protected and exposes no Store mutation capability', () => {
  const workflow = readFileSync(new URL('../.github/workflows/store-draft-diagnose.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/diagnose-store-draft.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /environment: microsoft-store-production/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /group: microsoft-store-production/);
  assert.doesNotMatch(workflow, /upload-artifact|release:|inputs:/);
  assert.match(script, /await authenticatedRequest\(\)/);
  assert.doesNotMatch(script, /fetch\(|\.upload\(|\/commit|writeFile/);
});
