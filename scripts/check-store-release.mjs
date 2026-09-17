#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requiredKey(value, names, label, allowNull = false) {
  const found = names.filter((name) => Object.hasOwn(value, name));
  if (found.length !== 1) {
    throw new Error(`${label} must contain exactly one recognized field`);
  }
  const key = found[0];
  if (!allowNull && (value[key] === null || value[key] === undefined)) {
    throw new Error(`${label} must not be null`);
  }
  return { key, value: value[key] };
}

function optionalReference(value, names, label) {
  const found = names.filter((name) => Object.hasOwn(value, name));
  if (found.length === 0) return null;
  if (found.length > 1) {
    throw new Error(`${label} must contain at most one recognized field`);
  }
  const reference = value[found[0]];
  if (reference === null) return null;
  const id = requiredKey(record(reference, label), ['Id', 'id'], `${label}.Id`).value;
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${label}.Id must be a string`);
  return id;
}

function parseVersion(version, label = 'version') {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must contain four unsigned integer components`);
  }
  const parts = version.split('.').map(Number);
  if (parts.some((part) => part > 65535)) {
    throw new Error(`${label} components must be between 0 and 65535`);
  }
  return parts;
}

export function comparePackageVersions(left, right) {
  const leftParts = parseVersion(left, 'left version');
  const rightParts = parseVersion(right, 'right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Math.sign(leftParts[index] - rightParts[index]);
    }
  }
  return 0;
}

export function validateReleaseEvent(event, applicationVersion, packageVersion) {
  const root = record(event, 'release event');
  const release = record(root.release, 'release event.release');
  if (root.action !== 'published') throw new Error('release event action must be published');
  if (release.draft !== false) throw new Error('release must not be a draft');
  if (release.prerelease !== false) throw new Error('release must not be a prerelease');
  if (release.tag_name !== `v${applicationVersion}`) {
    throw new Error('release tag must match the application version');
  }
  if (packageVersion !== `${applicationVersion}.0`) {
    throw new Error('Store package version must match the application version');
  }
  return { tag: release.tag_name, version: applicationVersion, packageVersion };
}

export function validateApplication(application, productId) {
  const app = record(application, 'application');
  const id = requiredKey(app, ['Id', 'id'], 'application.Id').value;
  if (id !== productId) throw new Error('application.Id does not match the configured product');
  const pending = optionalReference(
    app,
    ['PendingApplicationSubmission', 'pendingApplicationSubmission'],
    'application.PendingApplicationSubmission',
  );
  if (pending !== null) throw new Error('application has a pending submission');
  const published = optionalReference(
    app,
    ['LastPublishedApplicationSubmission', 'lastPublishedApplicationSubmission'],
    'application.LastPublishedApplicationSubmission',
  );
  if (published === null) throw new Error('application has no published submission');
  return { applicationId: id, lastPublishedSubmissionId: published };
}

function requireFreePricing(source, label) {
  const pricing = requiredKey(
    source,
    ['Pricing', 'pricing'],
    `${label}.Pricing`,
  ).value;
  const priceId = requiredKey(
    record(pricing, `${label}.Pricing`),
    ['PriceId', 'priceId'],
    `${label}.Pricing.PriceId`,
  ).value;
  if (priceId !== 'Free') throw new Error(`${label} must identify free pricing`);
}

export function validateActivationSubmission(submission) {
  const source = record(submission, 'published submission');
  requireFreePricing(source, 'published submission');
  const packages = requiredKey(
    source,
    ['ApplicationPackages', 'applicationPackages'],
    'published submission.ApplicationPackages',
  ).value;
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('published submission.ApplicationPackages must be a non-empty array');
  }
  const publishedVersions = packages.map((entry, index) => {
    const item = record(entry, `published submission.ApplicationPackages[${index}]`);
    const version = requiredKey(
      item,
      ['Version', 'version'],
      `published submission.ApplicationPackages[${index}].Version`,
    ).value;
    parseVersion(version, `published submission.ApplicationPackages[${index}].Version`);
    return version;
  });
  const highest = publishedVersions.reduce(
    (current, version) => (comparePackageVersions(version, current) > 0 ? version : current),
  );
  return { highestPublishedVersion: highest };
}

export function validatePublishedSubmission(submission, targetVersion) {
  const { highestPublishedVersion: highest } = validateActivationSubmission(submission);
  if (comparePackageVersions(targetVersion, highest) <= 0) {
    throw new Error('target package version must be greater than the last published version');
  }
  return { highestPublishedVersion: highest, targetVersion };
}

function publicationFields(submission) {
  const mode = requiredKey(
    submission,
    ['TargetPublishMode', 'targetPublishMode'],
    'submission.TargetPublishMode',
  );
  const date = requiredKey(
    submission,
    ['TargetPublishDate', 'targetPublishDate'],
    'submission.TargetPublishDate',
    true,
  );
  const delivery = requiredKey(
    submission,
    ['PackageDeliveryOptions', 'packageDeliveryOptions'],
    'submission.PackageDeliveryOptions',
  );
  const rollout = requiredKey(
    record(delivery.value, 'submission.PackageDeliveryOptions'),
    ['PackageRollout', 'packageRollout'],
    'submission.PackageDeliveryOptions.PackageRollout',
  );
  const enabled = requiredKey(
    record(rollout.value, 'submission.PackageDeliveryOptions.PackageRollout'),
    ['IsPackageRollout', 'isPackageRollout'],
    'submission.PackageDeliveryOptions.PackageRollout.IsPackageRollout',
  );
  return { mode, date, rollout, enabled };
}

function packageFileNames(submission) {
  const packages = requiredKey(
    submission,
    ['ApplicationPackages', 'applicationPackages'],
    'submission.ApplicationPackages',
  ).value;
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('submission.ApplicationPackages must be a non-empty array');
  }
  return packages.map((entry, index) => {
    const item = record(entry, `submission.ApplicationPackages[${index}]`);
    const fileName = requiredKey(
      item,
      ['FileName', 'fileName'],
      `submission.ApplicationPackages[${index}].FileName`,
    ).value;
    if (typeof fileName !== 'string' || !fileName.trim()) {
      throw new Error(`submission.ApplicationPackages[${index}].FileName must be a string`);
    }
    return basename(fileName);
  });
}

export function validateSubmissionIdentity(submission, submissionId) {
  const draft = record(submission, 'submission');
  const id = requiredKey(draft, ['Id', 'id'], 'submission.Id').value;
  if (typeof id !== 'string' || !id.trim()) throw new Error('submission.Id must be a string');
  if (id !== submissionId) throw new Error('submission.Id does not match the created submission');
  return { submissionId: id };
}

export function validateApiPackageReplacement(submission, bundleName) {
  const draft = record(submission, 'submission');
  const packageNames = packageFileNames(draft);
  const extension = extname(bundleName).toLowerCase();
  if (extension !== '.msixbundle') throw new Error('Store update must use an MSIX bundle');
  const replaceable = packageNames.filter(
    (fileName) => extname(fileName).toLowerCase() === extension,
  );
  if (replaceable.length !== 1) {
    throw new Error('submission must contain exactly one replaceable MSIX bundle');
  }
  return { replacedBundleName: replaceable[0], bundleName: basename(bundleName) };
}

export function validateReleaseNotes(notes, packageVersion) {
  const source = record(notes, 'release notes');
  if (Object.keys(source).sort().join(',') !== 'locale,text,version') {
    throw new Error('release notes must contain only locale, text and version');
  }
  if (typeof source.version !== 'string' || `${source.version}.0` !== packageVersion) {
    throw new Error('release notes version must match the Store package version');
  }
  parseVersion(packageVersion);
  if (source.locale !== 'en-us') throw new Error('release notes locale must be en-us');
  if (typeof source.text !== 'string' || source.text.length > 1500 ||
      source.text !== source.text.trim() ||
      !source.text.split('\n').every((line) => /^- \S[^\r]*$/.test(line))) {
    throw new Error('release notes must be nonempty bullet lines of at most 1500 characters');
  }
  return source;
}

function releaseNotesField(submission, locale) {
  const listings = requiredKey(
    record(submission, 'submission'),
    ['Listings', 'listings'],
    'submission.Listings',
  ).value;
  record(listings, 'submission.Listings');
  if (!Object.hasOwn(listings, locale)) {
    throw new Error(`submission.Listings must contain ${locale}`);
  }
  const listing = requiredKey(
    record(listings[locale], `submission.Listings.${locale}`),
    ['BaseListing', 'baseListing'],
    'listing.BaseListing',
  ).value;
  const field = requiredKey(
    record(listing, 'listing.BaseListing'),
    ['ReleaseNotes', 'releaseNotes'],
    'listing.ReleaseNotes',
  );
  if (typeof field.value !== 'string') throw new Error('listing.ReleaseNotes must be a string');
  return { listing, ...field };
}

export function validateReleaseNotesTarget(submission, notes, packageVersion) {
  const source = validateReleaseNotes(notes, packageVersion);
  releaseNotesField(submission, source.locale);
  return source;
}

export function prepareApiDraft(submission, bundleName, submissionId, notes, packageVersion) {
  const draft = structuredClone(record(submission, 'submission'));
  const source = validateReleaseNotesTarget(draft, notes, packageVersion);
  validateSubmissionIdentity(draft, submissionId);
  requireFreePricing(draft, 'submission');
  const { replacedBundleName } = validateApiPackageReplacement(draft, bundleName);
  if (replacedBundleName === basename(bundleName)) {
    throw new Error('submission already contains the target bundle filename');
  }
  const packages = requiredKey(
    draft,
    ['ApplicationPackages', 'applicationPackages'],
    'submission.ApplicationPackages',
  ).value;
  const replaced = packages.find(
    (entry) => basename(entry.FileName ?? entry.fileName) === replacedBundleName,
  );
  const status = requiredKey(
    record(replaced, 'replaceable application package'),
    ['FileStatus', 'fileStatus'],
    'replaceable application package.FileStatus',
  );
  if (status.value !== 'Uploaded') {
    throw new Error('replaceable application package must already be Uploaded');
  }
  replaced[status.key] = 'PendingDelete';
  packages.push({
    fileName: basename(bundleName),
    fileStatus: 'PendingUpload',
    minimumDirectXVersion: 'None',
    minimumSystemRam: 'None',
  });
  const fields = publicationFields(draft);
  draft[fields.mode.key] = 'Immediate';
  draft[fields.date.key] = null;
  fields.rollout.value[fields.enabled.key] = false;
  const noteField = releaseNotesField(draft, source.locale);
  noteField.listing[noteField.key] = source.text;
  return draft;
}

export function verifyDraft(submission, bundleName, submissionId, notes, packageVersion) {
  const draft = record(submission, 'submission');
  const source = validateReleaseNotesTarget(draft, notes, packageVersion);
  if (releaseNotesField(draft, source.locale).value !== source.text) {
    throw new Error('submission release notes do not match the approved release notes');
  }
  validateSubmissionIdentity(draft, submissionId);
  const packages = requiredKey(
    draft,
    ['ApplicationPackages', 'applicationPackages'],
    'submission.ApplicationPackages',
  ).value;
  packageFileNames(draft);
  const bundleEntries = packages.filter(
    (entry) => extname(entry.FileName ?? entry.fileName).toLowerCase() === '.msixbundle',
  );
  if (bundleEntries.length !== 2) {
    throw new Error('submission must contain one replaced and one intended MSIX bundle');
  }
  const matches = bundleEntries.filter(
    (entry) => basename(entry.FileName ?? entry.fileName) === basename(bundleName),
  );
  if (matches.length !== 1) {
    throw new Error('submission must contain the intended bundle filename exactly once');
  }
  const intendedStatus = requiredKey(
    record(matches[0], 'intended application package'),
    ['FileStatus', 'fileStatus'],
    'intended application package.FileStatus',
  ).value;
  if (intendedStatus !== 'PendingUpload') {
    throw new Error('intended application package must be PendingUpload');
  }
  const replaced = bundleEntries.find((entry) => entry !== matches[0]);
  const replacedStatus = requiredKey(
    record(replaced, 'replaced application package'),
    ['FileStatus', 'fileStatus'],
    'replaced application package.FileStatus',
  ).value;
  if (replacedStatus !== 'PendingDelete') {
    throw new Error('replaced application package must be PendingDelete');
  }
  const fields = publicationFields(draft);
  if (fields.mode.value !== 'Immediate') {
    throw new Error('submission.TargetPublishMode must be Immediate');
  }
  if (fields.date.value !== null) throw new Error('submission.TargetPublishDate must be null');
  if (fields.enabled.value !== false) {
    throw new Error('submission gradual rollout must be disabled');
  }
  return { bundleName: basename(bundleName), targetPublishMode: 'Immediate' };
}

export function validateCommitResponse(response) {
  const commit = record(response, 'commit response');
  const status = requiredKey(commit, ['Status', 'status'], 'commit response.Status').value;
  if (status !== 'CommitStarted') throw new Error('commit response.Status must be CommitStarted');
  return { status };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function usage() {
  throw new Error(
    'usage: check-store-release.mjs '
    + '<release|application|activation|submission|api-package|notes|notes-target|prepare-api-draft|verify-draft|commit> '
    + '<arguments>',
  );
}

function main(args) {
  const [mode, ...values] = args;
  if (mode === 'release' && values.length === 3) {
    validateReleaseEvent(readJson(values[0], 'release event'), values[1], values[2]);
  } else if (mode === 'application' && values.length === 2) {
    validateApplication(readJson(values[0], 'application'), values[1]);
  } else if (mode === 'activation' && values.length === 1) {
    validateActivationSubmission(readJson(values[0], 'published submission'));
  } else if (mode === 'submission' && values.length === 2) {
    validatePublishedSubmission(readJson(values[0], 'published submission'), values[1]);
  } else if (mode === 'api-package' && values.length === 2) {
    validateApiPackageReplacement(readJson(values[0], 'submission'), values[1]);
  } else if (mode === 'notes' && values.length === 2) {
    validateReleaseNotes(readJson(values[0], 'release notes'), values[1]);
  } else if (mode === 'notes-target' && values.length === 3) {
    validateReleaseNotesTarget(
      readJson(values[0], 'submission'), readJson(values[1], 'release notes'), values[2],
    );
  } else if (mode === 'prepare-api-draft' && values.length === 6) {
    const draft = prepareApiDraft(
      readJson(values[0], 'submission'), values[2], values[3],
      readJson(values[4], 'release notes'), values[5],
    );
    writeFileSync(values[1], `${JSON.stringify(draft)}\n`, { flag: 'wx' });
  } else if (mode === 'verify-draft' && values.length === 5) {
    verifyDraft(
      readJson(values[0], 'submission'), values[1], values[2],
      readJson(values[3], 'release notes'), values[4],
    );
  } else if (mode === 'commit' && values.length === 1) {
    validateCommitResponse(readJson(values[0], 'commit response'));
  } else {
    usage();
  }
  process.stdout.write(`Store release ${mode} check passed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Store release check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
