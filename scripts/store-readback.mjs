import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  apiFields, mutableIntent, preservedIntentPair, requirePendingDraft, verifyDraft, verifyPreservedIntent,
  prepareApiDraft, validatePublishedSubmission, validateApiPackageReplacement, validateReleaseNotesTarget,
} from './check-store-release.mjs';

const FIELDS = new Set(`applicationCategory pricing trialPeriod marketSpecificPricings sales priceId
  isAdvancedPricingModel visibility targetPublishMode targetPublishDate listings baseListing platformOverrides
  copyrightAndTrademarkInfo keywords licenseTerms privacyPolicy supportContact websiteUrl description
  features releaseNotes images recommendedHardware minimumHardware title shortDescription shortTitle sortTitle
  voiceTitle devStudio fileName fileStatus id imageType hardwarePreferences automaticBackupEnabled
  canInstallOnRemovableMedia isGameDvrEnabled gamingOptions hasExternalInAppProducts meetAccessibilityGuidelines
  notesForCertification applicationPackages version architecture languages capabilities minimumDirectXVersion
  minimumSystemRam targetDeviceFamilies targetPlatform packageDeliveryOptions packageRollout isPackageRollout
  packageRolloutPercentage packageRolloutStatus fallbackSubmissionId isMandatoryUpdate mandatoryUpdateEffectiveDate
  enterpriseLicensing allowMicrosoftDecideAppAvailabilityToFutureDeviceFamilies allowTargetFutureDeviceFamilies
  trailers videoFileName trailerAssets title imageList name basePriceId startDate endDate deviceFamilyListings
  status friendlyName genres isLocalMultiplayer isLocalCooperative isOnlineMultiplayer isOnlineCooperative localMultiplayerMinPlayers
  localMultiplayerMaxPlayers localCooperativeMinPlayers localCooperativeMaxPlayers isBroadcastingPrivilegeGranted
  isCrossPlayEnabled kinectDataForExternal`.split(/\s+/));
const LOCALES = new Set(`en-us en-gb en-au en-ca en-in en-nz en-ie en-sg en-za fr-fr fr-ca fr-be fr-ch
  de-de de-at de-ch es-es es-mx es-us it-it ja-jp ko-kr pt-br pt-pt ru-ru zh-cn zh-tw zh-hk
  ar-sa bg-bg ca-es cs-cz da-dk el-gr et-ee fi-fi he-il hi-in hr-hr hu-hu id-id lt-lt lv-lv
  ms-my nb-no nl-nl nl-be pl-pl ro-ro sk-sk sl-si sr-latn-rs sv-se th-th tr-tr uk-ua vi-vn`.split(/\s+/));
const DICTIONARIES = new Set(['listings', 'marketSpecificPricings', 'allowTargetFutureDeviceFamilies',
  'platformOverrides', 'deviceFamilyListings', 'trailerAssets']);
const STATUS = new Set(['None', 'Canceled', 'PendingCommit', 'CommitStarted', 'CommitFailed',
  'PendingPublication', 'Publishing', 'Published', 'PublishFailed', 'PreProcessing', 'PreProcessingFailed',
  'Certification', 'CertificationFailed', 'Release', 'ReleaseFailed']);
const ERROR_CODES = new Set(['None', 'InvalidArchive', 'MissingFiles', 'PackageValidationFailed',
  'InvalidParameterValue', 'InvalidOperation', 'InvalidState', 'ResourceNotFound', 'ServiceError',
  'ListingOptOutWarning', 'ListingOptInWarning', 'UpdateOnlyWarning', 'Other', 'PackageValidationWarning']);

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const kind = (value) => value === undefined ? 'missing' : value === null ? 'null'
  : Array.isArray(value) ? 'array' : typeof value;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function descriptor(value) {
  const type = kind(value);
  return { type, sha256: sha256(JSON.stringify({ type, value: canonical(value) })),
    ...(type === 'array' || type === 'string' ? { count: value.length }
      : type === 'object' ? { count: Object.keys(value).length } : {}) };
}

function segment(key, parent) {
  if (parent === 'listings' && LOCALES.has(key)) return key;
  if (!DICTIONARIES.has(parent) && FIELDS.has(key)) return key;
  return `redacted-${sha256(key)}`;
}

export function semanticDifferences(expected, actual) {
  const differences = [];
  let total = 0;
  function walk(before, after, path, parent, depth) {
    if (isDeepStrictEqual(before, after)) return;
    const beforeType = kind(before);
    const afterType = kind(after);
    if (depth < 24 && beforeType === afterType && ['array', 'object'].includes(beforeType)) {
      const keys = beforeType === 'array'
        ? Array.from({ length: Math.max(before.length, after.length) }, (_, index) => String(index))
        : [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      for (const key of keys) {
        walk(Object.hasOwn(before, key) ? before[key] : undefined,
          Object.hasOwn(after, key) ? after[key] : undefined,
          `${path}/${beforeType === 'array' ? key : segment(key, parent)}`, key, depth + 1);
      }
      return;
    }
    total += 1;
    if (differences.length < 100) differences.push({ path, before: descriptor(before), after: descriptor(after) });
  }
  walk(expected, actual, '', '', 0);
  return { differences, total, truncated: total > differences.length };
}

export function checkResult(checkId, operation) {
  try {
    operation();
    return { checkId, result: 'pass', code: 'OK' };
  } catch {
    return { checkId, result: 'fail', code: checkId };
  }
}

export function readbackChecks(actual, expected, { bundleName, pendingId, notes, version }) {
  const checks = [
    checkResult('READBACK_PENDING', () => requirePendingDraft(actual)),
    checkResult('READBACK_DRAFT', () => verifyDraft(actual, bundleName, pendingId, notes, version)),
    checkResult('READBACK_INTENT', () => verifyPreservedIntent(actual, expected, bundleName)),
  ];
  let semantic;
  let normalized;
  let beforeNormalization;
  checks.push(checkResult('READBACK_DIFFERENCES', () => {
    // The raw mutable pair also exposes metadata normalized away by the publisher, without changing its policy.
    normalized = semanticDifferences(mutableIntent(expected), mutableIntent(actual));
    const pair = preservedIntentPair(actual, expected, bundleName);
    semantic = semanticDifferences(pair.expected, pair.actual);
    const safeResource = (source) => {
      const value = apiFields(source);
      for (const field of ['fileUploadUrl', 'statusDetails']) delete value[field];
      return value;
    };
    beforeNormalization = semanticDifferences(safeResource(expected), safeResource(actual));
  }));
  return { checks, semantic, normalized, beforeNormalization };
}

export function applicationReferenceChecks(app, config, prefix = 'APPLICATION') {
  const demand = (condition) => { if (!condition) throw new Error('Application references changed'); };
  return [
    checkResult(`${prefix}_PRODUCT`, () => demand(app?.id === config.productId)),
    checkResult(`${prefix}_PUBLISHED_REFERENCE`, () => demand(app?.lastPublishedApplicationSubmission?.id === config.publishedId)),
    checkResult(`${prefix}_PENDING_REFERENCE`, () => demand(app?.pendingApplicationSubmission?.id === config.pendingId)),
  ];
}

export function currentReadbackChecks({ app, published, pending, status }, config) {
  const { publishedId, pendingId, bundleName, version, notes } = config;
  const checks = applicationReferenceChecks(app, config);
  const demand = (condition) => { if (!condition) throw new Error('Current readback contract failed'); };
  const check = (id, operation) => checks.push(checkResult(id, operation));
  check('PUBLISHED_IDENTITY', () => demand(published?.id === publishedId));
  check('PUBLISHED_STATUS', () => demand(published?.status === 'Published'));
  check('PUBLISHED_FREE', () => demand(published?.pricing?.priceId === 'Free'));
  check('PUBLISHED_VERSION_ADVANCE', () => validatePublishedSubmission(published, version));
  check('PUBLISHED_PACKAGE_REPLACEMENT', () => validateApiPackageReplacement(published, bundleName));
  check('PUBLISHED_NOTES_TARGET', () => validateReleaseNotesTarget(published, notes, version));
  check('PENDING_IDENTITY', () => demand(pending?.id === pendingId));
  check('PENDING_FREE', () => demand(pending?.pricing?.priceId === 'Free'));
  check('PENDING_PUBLICATION_MODE', () => demand(pending?.targetPublishMode === 'Immediate'));
  check('PENDING_ROLLOUT_DISABLED', () => demand(
    pending?.packageDeliveryOptions?.packageRollout?.isPackageRollout === false));
  check('PENDING_PUBLICATION_DATE', () => demand(pending?.targetPublishDate === null
    || (typeof pending?.targetPublishDate === 'string' && Number.isFinite(Date.parse(pending.targetPublishDate)))));
  const targets = Array.isArray(pending?.applicationPackages)
    ? pending.applicationPackages.filter((entry) => entry?.fileName === bundleName) : [];
  check('PENDING_TARGET_FILENAME', () => demand(targets.length === 1));
  check('PENDING_TARGET_FILE_STATUS', () => demand(targets.length === 1 && targets[0].fileStatus === 'PendingUpload'));
  check('PENDING_TARGET_VERSION', () => demand(targets.length === 1
    && (!Object.hasOwn(targets[0], 'version') || targets[0].version === version)));
  check('PENDING_NOTES_LOCALE', () => demand(Object.hasOwn(pending?.listings ?? {}, notes.locale)));
  const observedNotes = pending?.listings?.[notes.locale]?.baseListing?.releaseNotes;
  check('PENDING_NOTES_HASH', () => demand(typeof observedNotes === 'string' && sha256(observedNotes) === config.notesSha256));
  check('STATUS_PENDING', () => demand(status?.status === 'PendingCommit'));
  check('STATUS_ERRORS_EMPTY', () => demand(Array.isArray(status?.statusDetails?.errors) && status.statusDetails.errors.length === 0));
  let expected;
  check('EXPECTED_UPDATE', () => {
    expected = prepareApiDraft({ ...published, id: pendingId }, bundleName, pendingId, notes, version);
  });
  const readback = readbackChecks(pending, expected, config);
  checks.push(...readback.checks);
  return { checks, expected, readback };
}

export function knownValue(value, allowed) {
  return { ...descriptor(value), ...(allowed.has(value) ? { value } : {}) };
}

export function statusObservation(source) {
  const value = apiFields(source);
  const details = {};
  for (const field of ['errors', 'warnings']) {
    const entries = value?.statusDetails?.[field];
    details[field] = { type: kind(entries), count: Array.isArray(entries) ? entries.length : null,
      codes: Array.isArray(entries) ? [...new Set(entries.map((entry) =>
        ERROR_CODES.has(entry?.code) ? entry.code : 'REDACTED_UNKNOWN_CODE'))].sort() : [] };
  }
  return { status: knownValue(value?.status, STATUS), ...details };
}

export function packageObservation(entry, bundleName, version) {
  const value = entry?.version;
  const validVersion = typeof value === 'string' && /^\d{1,5}(?:\.\d{1,5}){3}$/.test(value)
    && value.split('.').every((part) => Number(part) <= 65535);
  return {
    type: kind(entry), filenameMatches: entry?.fileName === bundleName,
    version: { ...descriptor(value), ...(validVersion ? { value } : {}), matches: value === version },
    fileStatus: knownValue(entry?.fileStatus, new Set(['None', 'PendingUpload', 'Uploaded', 'PendingDelete'])),
  };
}
