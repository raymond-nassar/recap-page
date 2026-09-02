import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  comparePackageVersions,
  prepareApiDraft,
  validateApiPackageReplacement,
  validateActivationSubmission,
  validateApplication,
  validateCommitResponse,
  validatePublishedSubmission,
  validateReleaseEvent,
  validateSubmissionIdentity,
  verifyDraft,
} from '../scripts/check-store-release.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(
  new URL('../.github/workflows/microsoft-store-release.yml', import.meta.url),
  'utf8',
);
const apiScript = readFileSync(
  new URL('../scripts/publish-store-update.ps1', import.meta.url),
  'utf8',
);
const bundleName = `RecapPage_${pkg.version}.0_x64_arm64.msixbundle`;
const nextVersion = (() => {
  const parts = pkg.version.split('.').map(Number);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] < 65535) {
      parts[index] += 1;
      parts.fill(0, index + 1);
      return `${parts.join('.')}.0`;
    }
  }
  throw new Error('the application version has no valid higher MSIX version');
})();

function step(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return workflow.match(
    new RegExp(`      - name: ${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n      - name:|$)`),
  )?.[0] ?? '';
}

function release(overrides = {}) {
  return {
    action: 'published',
    release: {
      draft: false,
      prerelease: false,
      tag_name: `v${pkg.version}`,
      ...overrides,
    },
  };
}

function application(overrides = {}) {
  return {
    Id: 'store-product-id',
    PendingApplicationSubmission: null,
    LastPublishedApplicationSubmission: { Id: 'published-submission-id' },
    ...overrides,
  };
}

function submission(overrides = {}) {
  return {
    Id: 'submission-id',
    Pricing: { PriceId: 'Free' },
    ApplicationPackages: [{
      FileName: bundleName,
      FileStatus: 'Uploaded',
      Version: `${pkg.version}.0`,
    }],
    TargetPublishMode: 'Manual',
    TargetPublishDate: '2026-09-15T00:00:00Z',
    PackageDeliveryOptions: {
      PackageRollout: {
        IsPackageRollout: true,
        PackageRolloutPercentage: 25,
      },
    },
    Listings: { 'en-us': { BaseListing: { Description: 'Preserved' } } },
    ...overrides,
  };
}

test('release validation accepts only the exact published application release', () => {
  assert.deepEqual(
    validateReleaseEvent(release(), pkg.version, `${pkg.version}.0`),
    { tag: `v${pkg.version}`, version: pkg.version, packageVersion: `${pkg.version}.0` },
  );
  for (const invalid of [
    { action: 'created', release: release().release },
    release({ draft: true }),
    release({ prerelease: true }),
    release({ tag_name: `release-${pkg.version}` }),
  ]) {
    assert.throws(
      () => validateReleaseEvent(invalid, pkg.version, `${pkg.version}.0`),
      /release/,
    );
  }
  assert.throws(
    () => validateReleaseEvent(release(), pkg.version, '9.9.9.0'),
    /package version/,
  );
});

test('application validation requires the configured live product without a pending draft', () => {
  assert.deepEqual(validateApplication(application(), 'store-product-id'), {
    applicationId: 'store-product-id',
    lastPublishedSubmissionId: 'published-submission-id',
  });
  const noPendingField = application();
  delete noPendingField.PendingApplicationSubmission;
  assert.deepEqual(validateApplication(noPendingField, 'store-product-id'), {
    applicationId: 'store-product-id',
    lastPublishedSubmissionId: 'published-submission-id',
  });
  assert.throws(
    () => validateApplication(application({ Id: 'other' }), 'store-product-id'),
    /configured product/,
  );
  assert.throws(
    () => validateApplication(
      application({ PendingApplicationSubmission: { Id: 'pending' } }),
      'store-product-id',
    ),
    /pending submission/,
  );
  assert.throws(
    () => validateApplication(application({ LastPublishedApplicationSubmission: null }), 'store-product-id'),
    /no published submission/,
  );
});

test('submission validation requires free pricing and a strictly higher target version', () => {
  assert.deepEqual(validateActivationSubmission(submission()), {
    highestPublishedVersion: `${pkg.version}.0`,
  });
  assert.deepEqual(validatePublishedSubmission(submission(), nextVersion), {
    highestPublishedVersion: `${pkg.version}.0`,
    targetVersion: nextVersion,
  });
  assert.throws(
    () => validatePublishedSubmission(submission(), `${pkg.version}.0`),
    /greater than/,
  );
  assert.throws(
    () => validatePublishedSubmission(submission(), '1.9.9.0'),
    /greater than/,
  );
  assert.throws(
    () => validatePublishedSubmission(submission({ Pricing: { PriceId: 'Base' } }), nextVersion),
    /free pricing/,
  );
});

test('four-part Store versions compare numerically and reject malformed components', () => {
  assert.equal(comparePackageVersions('2.10.0.0', '2.9.99.99'), 1);
  assert.equal(comparePackageVersions('2.0.0.0', '2.0.0.0'), 0);
  assert.equal(comparePackageVersions('1.99.99.99', '2.0.0.0'), -1);
  assert.throws(() => comparePackageVersions('2.0.0', '2.0.0.0'), /four/);
  assert.throws(() => comparePackageVersions('2.0.0.65536', '2.0.0.0'), /65535/);
});

test('API draft preparation replaces one bundle and preserves unrelated fields', () => {
  const original = submission();
  const replacement = `RecapPage_${nextVersion}_x64_arm64.msixbundle`;
  assert.deepEqual(validateApiPackageReplacement(original, bundleName), {
    replacedBundleName: bundleName,
    bundleName,
  });
  const draft = prepareApiDraft(original, replacement, 'submission-id');
  assert.equal(original.TargetPublishMode, 'Manual');
  assert.equal(draft.TargetPublishMode, 'Immediate');
  assert.equal(draft.TargetPublishDate, null);
  assert.equal(draft.PackageDeliveryOptions.PackageRollout.IsPackageRollout, false);
  assert.equal(draft.PackageDeliveryOptions.PackageRollout.PackageRolloutPercentage, 25);
  assert.equal(draft.Listings['en-us'].BaseListing.Description, 'Preserved');
  assert.equal(draft.ApplicationPackages[0].FileStatus, 'PendingDelete');
  assert.deepEqual(draft.ApplicationPackages[1], {
    fileName: replacement,
    fileStatus: 'PendingUpload',
    minimumDirectXVersion: 'None',
    minimumSystemRam: 'None',
  });
  assert.deepEqual(verifyDraft(draft, replacement, 'submission-id'), {
    bundleName: replacement,
    targetPublishMode: 'Immediate',
  });
});

test('draft validation fails on missing, duplicate, or malformed submission fields', () => {
  const replacement = `RecapPage_${nextVersion}_x64_arm64.msixbundle`;
  assert.throws(
    () => prepareApiDraft(submission(), bundleName, 'submission-id'),
    /already contains/,
  );
  assert.throws(
    () => validateApiPackageReplacement(
      submission({ ApplicationPackages: [
        { FileName: bundleName, FileStatus: 'Uploaded', Version: `${pkg.version}.0` },
        { FileName: 'another.msixbundle', FileStatus: 'Uploaded', Version: '1.0.0.0' },
      ] }),
      replacement,
    ),
    /exactly one replaceable/,
  );
  assert.throws(
    () => prepareApiDraft(
      submission({ TargetPublishMode: null }),
      replacement,
      'submission-id',
    ),
    /must not be null/,
  );
  assert.throws(
    () => prepareApiDraft(
      submission({ PackageDeliveryOptions: {} }),
      replacement,
      'submission-id',
    ),
    /PackageRollout/,
  );
  assert.throws(
    () => validateSubmissionIdentity(submission(), 'other-submission'),
    /created submission/,
  );
  assert.throws(
    () => {
      const malformed = prepareApiDraft(submission(), replacement, 'submission-id');
      malformed.TargetPublishMode = 'Manual';
      return verifyDraft(malformed, replacement, 'submission-id');
    },
    /must be Immediate/,
  );
});

test('commit validation accepts only the expected asynchronous start', () => {
  assert.deepEqual(validateCommitResponse({ status: 'CommitStarted' }), {
    status: 'CommitStarted',
  });
  assert.throws(() => validateCommitResponse({ status: 'CommitFailed' }), /CommitStarted/);
  assert.throws(() => validateCommitResponse({}), /recognized field/);
});

test('the Store workflow has only approved release and rehearsal entry points', () => {
  assert.match(workflow, /^ {2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /^ {2}release:\r?\n {4}types: \[published\]\s*$/m);
  assert.doesNotMatch(workflow, /pull_request_target|^ {2}(?:push|pull_request|schedule):/m);
  assert.match(workflow, /^ {4}environment: microsoft-store-production\s*$/m);
  assert.match(workflow, /^ {2}contents: read\s*$/m);
  assert.match(workflow, /^ {2}cancel-in-progress: false\s*$/m);
  assert.match(workflow, /runs-on: windows-2022/);
});

test('the Store workflow pins every external release tool', () => {
  assert.match(
    workflow,
    /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
  );
  assert.match(
    workflow,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
  );
  const winapp = step('Install checksum-verified WinApp CLI');
  assert.match(winapp, /releases\/download\/v0\.6\.0\/winappcli-x64\.zip/);
  assert.match(winapp, /F6DC42E3B4E4709C8F617003008E2CFDD9A51735E04E7170D60EDDA258DB78A8/);
  assert.ok(winapp.indexOf('Get-FileHash') < winapp.indexOf('Expand-Archive'));
  assert.ok(winapp.indexOf('Expand-Archive') < winapp.indexOf('winapp.exe'));
  assert.doesNotMatch(workflow, /setup-WinAppCli/);
  assert.doesNotMatch(workflow, /microsoft-store-apppublisher|msstore\b/);
});

test('Store credentials are isolated to read-only and release API steps', () => {
  const rehearsal = step('Validate Partner Center without mutation');
  const submission = step('Submit one Store update');
  for (const protectedStep of [rehearsal, submission]) {
    assert.match(protectedStep, /PARTNER_CENTER_TENANT_ID/);
    assert.match(protectedStep, /PARTNER_CENTER_CLIENT_ID/);
    assert.match(protectedStep, /PARTNER_CENTER_CLIENT_SECRET/);
    assert.doesNotMatch(protectedStep, /PARTNER_CENTER_SELLER_ID/);
  }
  assert.doesNotMatch(workflow.replace(rehearsal, '').replace(submission, ''), /secrets\./);
});

test('manual rehearsal cannot select the Store API mutation path', () => {
  const rehearsal = step('Validate Partner Center without mutation');
  const submission = step('Submit one Store update');
  assert.match(rehearsal, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(rehearsal, /-Mode Validate/);
  assert.match(submission, /if: github\.event_name == 'release'/);
  assert.match(submission, /-Mode Submit/);
  assert.doesNotMatch(rehearsal, /-Mode Submit/);
  const targetVersionCheck = apiScript.indexOf(
    "Invoke-StoreCheck -Arguments @('submission'",
  );
  assert.ok(
    targetVersionCheck > 0 &&
      targetVersionCheck < apiScript.indexOf("if ($Mode -eq 'Validate')"),
    'read-only rehearsal exits before checking the target package version',
  );
});

test('the exact WACK-approved bundle is rechecked before a single upload', () => {
  const firstHash = workflow.indexOf('Record the validated bundle hash');
  const wack = workflow.indexOf('Run WACK on the exact bundle');
  const certifiedHash = workflow.indexOf('Prove the certified bundle is unchanged');
  const preMutationHash = workflow.indexOf('Recheck the bundle before mutation');
  const upload = workflow.indexOf('Submit one Store update');
  assert.ok(firstHash < wack && wack < certifiedHash);
  assert.ok(certifiedHash < preMutationHash && preMutationHash < upload);
  assert.match(workflow, /steps\.bundle_hash\.outputs\.sha256/g);
  assert.doesNotMatch(workflow, /upload-artifact|cache\/save|gh release/i);
});

test('Store API mutations stay bound to one submission ID without retries or deletion', () => {
  assert.equal((apiScript.match(/\.SendAsync\(/g) ?? []).length, 2);
  assert.doesNotMatch(apiScript, /\b(?:for|foreach|while|do)\s*\([^)]*SendAsync|Start-Sleep/);
  assert.doesNotMatch(apiScript, /Method 'DELETE'|HttpMethod\]::Delete|MaximumRetryCount/);
  assert.match(apiScript, /\$submissionId = \[string\]\$created\.id/);
  assert.match(apiScript, /\$submissionUrl = "\$submissionBase\/\$\(.*\$submissionId.*\)"/);
  assert.match(apiScript, /-Method 'PUT'[\s\S]*-Uri \$submissionUrl/);
  assert.match(apiScript, /-Method 'GET' -Uri \$submissionUrl/);
  assert.match(apiScript, /-Method 'POST' -Uri "\$submissionUrl\/commit"/);
  assert.match(apiScript, /prepare-api-draft[\s\S]*\$submissionId/);
  assert.match(apiScript, /verify-draft[\s\S]*\$submissionId/);
});

test('every Store workflow step has a deadline below the job backstop', () => {
  const deadlines = [...workflow.matchAll(/^\s*timeout-minutes: (\d+)\s*$/gm)]
    .map((match) => Number(match[1]));
  const [job, ...steps] = deadlines;
  const stepCount = (workflow.match(/^ {6}- name:/gm) ?? []).length;
  assert.equal(steps.length, stepCount);
  assert.ok(job >= steps.reduce((sum, value) => sum + value, 0) + 1);
  assert.match(step('Remove generated Store material'), /if: always\(\)/);
});
