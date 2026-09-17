import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect, fingerprint, uploadMetadata } from '../scripts/inspect-store-recovery.mjs';

test('Store creation accepts exactly 200 and 201 without broadening other requests', () => {
  const source = readFileSync(new URL('../scripts/publish-store-update.ps1', import.meta.url), 'utf8');
  const create = source.match(/-Method 'POST' -Uri \$submissionBase -Headers \$headers -ExpectedStatus @\(([^)]+)\)/);
  assert.ok(create);
  assert.deepEqual(create[1].split(',').map(Number), [200, 201]);
  assert.equal((source.match(/-ExpectedStatus @\(200, 201\)/g) ?? []).length, 1);
  assert.match(source, /\$ExpectedStatus -notcontains \$status/);
});

function submission(id) {
  return {
    id, status: 'PendingCommit', fileUploadUrl: 'https://private.invalid/secret',
    statusDetails: { errors: [] },
    applicationPackages: [{ version: '2.1.0.0', fileStatus: 'Uploaded' }],
    targetPublishMode: 'Immediate',
    packageDeliveryOptions: { packageRollout: { isPackageRollout: false } },
    listings: { secretDescription: 'not an output field' },
  };
}

test('Store inspection fetches exact references and emits only allowlisted facts', async () => {
  const seen = [];
  const result = await inspect(async (url) => {
    seen.push(url);
    if (seen.length === 1) return {
      id: '9PDJ7XR9Q40Q',
      lastPublishedApplicationSubmission: { id: '123' },
      pendingApplicationSubmission: { id: '456' },
    };
    return submission(url.split('/').at(-1));
  });
  assert.equal(seen.length, 3);
  assert.ok(seen[1].endsWith('/submissions/123'));
  assert.ok(seen[2].endsWith('/submissions/456'));
  assert.equal(result.pending.id, '456');
  assert.doesNotMatch(JSON.stringify(result), /secret|fileUploadUrl|listings|statusDetails/);
  const changed = submission('456');
  changed.fileUploadUrl = 'different';
  assert.equal(fingerprint(changed), result.pending.fingerprint);
  changed.listings.secretDescription = 'changed';
  assert.notEqual(fingerprint(changed), result.pending.fingerprint);
  await assert.rejects(inspect(async () => ({ id: 'wrong' })), /identity/);
});

test('Store inspection stays protected, manual, read-only and does not persist private responses', () => {
  const workflow = readFileSync(new URL('../.github/workflows/store-recovery-inspect.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/inspect-store-recovery.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /environment: microsoft-store-production/);
  assert.match(workflow, /group: microsoft-store-production/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.doesNotMatch(workflow, /upload-artifact|release:|secrets: inherit/);
  assert.equal((script.match(/method: 'POST'/g) ?? []).length, 1);
  assert.equal((script.match(/method: 'GET'/g) ?? []).length, 1);
  assert.doesNotMatch(script, /method: '(PUT|DELETE)'|writeFile|console\.log|\/commit/);
});

test('Store upload diagnostics expose only hostname and validated flags, never path or authorization', () => {
  assert.deepEqual(uploadMetadata(
    'https://example.blob.core.windows.net/ingestion/private-file?sig=private-signature&se=2099-01-01',
  ), {
    hostname: 'example.blob.core.windows.net',
    https: true, ingestionPath: true, hasCredentials: false, hasFragment: false,
    hasSignature: true, expiresAt: '2099-01-01T00:00:00.000Z',
  });
  assert.throws(() => uploadMetadata('not a URL'));
});
