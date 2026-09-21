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
  validateReleaseNotes,
  validateReleaseNotesTarget,
  validateSubmissionIdentity,
  validateSubmissionStatus,
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
const publisher = readFileSync(new URL('../scripts/store-release.mjs', import.meta.url), 'utf8');
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
    Listings: { 'en-us': { BaseListing: { Description: 'Preserved', ReleaseNotes: 'Earlier notes' } } },
    ...overrides,
  };
}

function notes(version = nextVersion) {
  return { version: version.slice(0, -2), locale: 'en-us', text: '- Read at your own pace.' };
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
  const draft = prepareApiDraft(original, replacement, 'submission-id', notes(), nextVersion);
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
  assert.deepEqual(verifyDraft(draft, replacement, 'submission-id', notes(), nextVersion), {
    bundleName: replacement,
    targetPublishMode: 'Immediate',
  });
});

test('draft validation fails on missing, duplicate, or malformed submission fields', () => {
  const replacement = `RecapPage_${nextVersion}_x64_arm64.msixbundle`;
  assert.throws(
    () => prepareApiDraft(submission(), bundleName, 'submission-id', notes(), nextVersion),
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
      notes(),
      nextVersion,
    ),
    /must not be null/,
  );
  assert.throws(
    () => prepareApiDraft(
      submission({ PackageDeliveryOptions: {} }),
      replacement,
      'submission-id',
      notes(),
      nextVersion,
    ),
    /PackageRollout/,
  );
  assert.throws(
    () => validateSubmissionIdentity(submission(), 'other-submission'),
    /created submission/,
  );
  assert.throws(
    () => {
      const malformed = prepareApiDraft(submission(), replacement, 'submission-id', notes(), nextVersion);
      malformed.TargetPublishMode = 'Manual';
      return verifyDraft(malformed, replacement, 'submission-id', notes(), nextVersion);
    },
    /must be Immediate/,
  );
});

test('Store release notes require the exact version, supported locale and bounded bullets', () => {
  assert.deepEqual(validateReleaseNotes(notes(), nextVersion), notes());
  for (const invalid of [
    { ...notes(), version: '0.0.0' },
    { ...notes(), locale: 'fr-fr' },
    { ...notes(), text: '' },
    { ...notes(), text: 'Not a bullet' },
    { ...notes(), text: '- ' },
    { ...notes(), text: '- Valid\n\n- Extra blank' },
    { ...notes(), text: `- ${'x'.repeat(1499)}` },
    { ...notes(), text: '- Has a trailing newline\n' },
    { ...notes(), extra: 'not allowed' },
  ]) {
    assert.throws(() => validateReleaseNotes(invalid, nextVersion), /release notes/);
  }
  assert.equal(validateReleaseNotes({ ...notes(), text: `- ${'x'.repeat(1498)}` }, nextVersion).text.length, 1500);
});

test('Store notes update only the approved locale without changing the source submission', () => {
  const original = submission();
  original.Listings['fr-fr'] = { BaseListing: { ReleaseNotes: 'Conserver', Description: 'Autre' } };
  original.Listings['en-us'].BaseListing.Images = [{ FileName: 'existing.png', FileStatus: 'Uploaded' }];
  const before = structuredClone(original);
  const replacement = `RecapPage_${nextVersion}_x64_arm64.msixbundle`;
  const draft = prepareApiDraft(original, replacement, 'submission-id', notes(), nextVersion);
  assert.equal(draft.Listings['en-us'].BaseListing.ReleaseNotes, notes().text);
  const expectedListings = structuredClone(before.Listings);
  expectedListings['en-us'].BaseListing.ReleaseNotes = notes().text;
  assert.deepEqual(draft.Listings, expectedListings);
  assert.deepEqual(original, before);
  const lowerCase = {
    ...original,
    listings: { 'en-us': { baseListing: { releaseNotes: 'Earlier notes', description: 'Preserved' } } },
  };
  delete lowerCase.Listings;
  const lowerDraft = prepareApiDraft(lowerCase, replacement, 'submission-id', notes(), nextVersion);
  assert.equal(lowerDraft.listings['en-us'].baseListing.releaseNotes, notes().text);
  verifyDraft(lowerDraft, replacement, 'submission-id', notes(), nextVersion);
});

test('Store notes reject missing or ambiguous destination fields before preparing a draft', () => {
  for (const listings of [
    {},
    { 'en-us': null },
    { 'en-us': { BaseListing: {} } },
    { 'en-us': { BaseListing: { ReleaseNotes: null } } },
    { 'en-us': { BaseListing: { ReleaseNotes: '', releaseNotes: '' } } },
    { 'en-us': { BaseListing: { ReleaseNotes: '' }, baseListing: { releaseNotes: '' } } },
  ]) {
    assert.throws(
      () => validateReleaseNotesTarget(submission({ Listings: listings }), notes(), nextVersion),
      /submission|listing/,
    );
  }
  assert.throws(
    () => validateReleaseNotesTarget(submission({ listings: {} }), notes(), nextVersion),
    /exactly one recognized field/,
  );
});

test('Store draft read-back rejects changed release notes', () => {
  const replacement = `RecapPage_${nextVersion}_x64_arm64.msixbundle`;
  const draft = prepareApiDraft(submission(), replacement, 'submission-id', notes(), nextVersion);
  draft.Listings['en-us'].BaseListing.ReleaseNotes = 'Earlier notes';
  assert.throws(
    () => verifyDraft(draft, replacement, 'submission-id', notes(), nextVersion),
    /release notes do not match/,
  );
  delete draft.Listings['en-us'].BaseListing.ReleaseNotes;
  assert.throws(
    () => verifyDraft(draft, replacement, 'submission-id', notes(), nextVersion),
    /ReleaseNotes/,
  );
});

test('Store notes are version-bound in both workflow paths using the tested production publisher', () => {
  for (const name of ['Validate Partner Center without mutation', 'Submit one Store update']) {
    assert.match(step(name), /-ReleaseNotesPath '\.\/docs\/releases\/\$\{\{ steps\.release\.outputs\.app_version \}\}-store\.json'/);
  }
  assert.match(apiScript, /& node \(Join-Path \$PSScriptRoot 'store-release\.mjs'\)/);
  assert.match(apiScript, /\$Mode \$ProductId \$BundlePath \$ExpectedVersion \$ReleaseNotesPath \$archivePath/);
  assert.match(workflow, /test\/store-publisher\.test\.js/);
});

test('the committed Store notes match the canonical application release', () => {
  const current = JSON.parse(readFileSync(
    new URL(`../docs/releases/${pkg.version}-store.json`, import.meta.url), 'utf8',
  ));
  validateReleaseNotes(current, `${pkg.version}.0`);
  assert.doesNotMatch(current.text, /[\u2013\u2014]/);
});

test('commit validation accepts only the expected asynchronous start', () => {
  assert.deepEqual(validateCommitResponse({ status: 'CommitStarted' }), {
    status: 'CommitStarted',
  });
  assert.throws(() => validateCommitResponse({ status: 'CommitFailed' }), /CommitStarted/);
  assert.throws(() => validateCommitResponse({}), /recognized field/);
});

test('status validation distinguishes unexpected lifecycle from confirmed terminal or error outcomes', () => {
  for (const status of ['None', 'PendingCommit']) {
    assert.deepEqual(validateSubmissionStatus({ status, statusDetails: { errors: [] } }),
      { status, state: 'verification-pending' });
    assert.deepEqual(validateSubmissionStatus({ status, statusDetails: { errors: [{ code: 'InvalidState' }] } }),
      { status, state: 'failed' });
  }
  for (const status of ['Canceled', 'CommitFailed', 'PreProcessingFailed', 'CertificationFailed',
    'PublishFailed', 'ReleaseFailed']) {
    assert.deepEqual(validateSubmissionStatus({ status, statusDetails: { errors: [] } }),
      { status, state: 'failed' });
  }
  for (const response of [
    { status: 'Unknown', statusDetails: { errors: [] } },
    { status: 'Certification' },
    { status: 'Published', statusDetails: { errors: null } },
    { status: 'Published', Status: 'Published', statusDetails: { errors: [] } },
  ]) assert.throws(() => validateSubmissionStatus(response));
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

test('the Store workflow builds native launchers once before its one bundle build', () => {
  const native = step('Build the production native launchers');
  assert.match(native, /run: \.\/scripts\/build-native-launcher\.ps1/);
  assert.doesNotMatch(native, /IncludeProofTools|Negatives|secrets\./);
  assert.ok(workflow.indexOf(native) < workflow.indexOf('Build the Store bundle once'));
  assert.equal((workflow.match(/run: npm run msix:pack/g) ?? []).length, 1);
  assert.equal((workflow.match(/run: \.\/scripts\/build-native-launcher\.ps1/g) ?? []).length, 1);
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
  assert.match(rehearsal, /if: steps\.release\.outputs\.mode == 'Validate'/);
  assert.match(rehearsal, /-Mode Validate/);
  assert.match(submission, /if: steps\.release\.outputs\.mode == 'Submit'/);
  assert.match(submission, /-Mode Submit/);
  assert.doesNotMatch(rehearsal, /-Mode Submit/);
  const targetVersionCheck = publisher.indexOf('validatePublishedSubmission(published, version)');
  assert.ok(
    targetVersionCheck > 0 &&
      targetVersionCheck < publisher.indexOf("if (mode === 'Validate')"),
    'read-only rehearsal exits before checking the target package version',
  );
});

test('catch-up submission binds immutable application source separately from reviewed publisher', () => {
  assert.match(workflow, /options: \[Validate, Submit\]\r?\n\s+default: Validate/);
  assert.match(step('Check out the reviewed publisher'), /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(step('Check out the reviewed publisher'), /path: \.store-tooling/);
  const metadata = step('Resolve release metadata');
  assert.match(metadata, /EXPECTED_SOURCE_SHA -cnotmatch '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(metadata, /\$actual -cne \$env:EXPECTED_SOURCE_SHA/);
  assert.match(metadata, /gh api "repos\/\$env:GITHUB_REPOSITORY\/releases\/tags\/\$env:RELEASE_TAG"/);
  assert.match(metadata, /DISPATCH_MODE -ne 'Validate' -or \$env:RELEASE_TAG -or \$env:EXPECTED_SOURCE_SHA/);
  assert.match(step('Prove release commit provenance'), /git merge-base --is-ancestor/);
  assert.match(step('Prove release commit provenance'),
    /GITHUB_EVENT_NAME -eq 'release' -and \$tagCommit -ne \$env:GITHUB_SHA/);
  assert.match(step('Submit one Store update'), /\.\/\.store-tooling\/scripts\/publish-store-update\.ps1/);
  assert.doesNotMatch(workflow, /gh release create|git tag|git push|cancel-in-progress: true/);
});

test('the exact WACK-approved bundle is rechecked before a single upload', () => {
  assert.match(
    step('Inspect the Store packages'),
    /run: npm run msix:inspect -- --structural/,
  );
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
  assert.doesNotMatch(publisher, /request\('DELETE'|retry/i);
  assert.equal((publisher.match(/request\('POST', `\$\{draftUrl\}\/commit`/g) ?? []).length, 1);
  assert.match(publisher, /redirect: 'error'/);
  assert.match(apiScript, /finally[\s\S]*Remove-Item -LiteralPath \$archivePath -Force/);
});

test('every Store workflow step has a deadline below the job backstop', () => {
  const deadlines = [...workflow.matchAll(/^\s*timeout-minutes: (\d+)\s*$/gm)]
    .map((match) => Number(match[1]));
  const [job, ...steps] = deadlines;
  const stepCount = (workflow.match(/^ {6}- name:/gm) ?? []).length;
  assert.equal(steps.length, stepCount);
  assert.ok(job >= steps.reduce((sum, value) => sum + value, 0) + 1);
  const cleanup = step('Remove generated Store material');
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /shell: powershell/);
});
