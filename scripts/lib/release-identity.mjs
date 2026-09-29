import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ANDROID_CODE_LIMIT = 2100000000;
export const DEVELOPMENT_ANDROID_CODE = 3000002;
export const ABOUT_BUILD = 'Source checkout; revision not embedded.';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(`release identity: ${message}`);
}

function keys(value, expected) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...expected].sort().join(), 'unexpected record fields');
}

function git(args, root = ROOT) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function sourceIdentity(root = ROOT) {
  return {
    sourceRevision: git(['rev-parse', 'HEAD'], root),
    sourceTree: git(['rev-parse', 'HEAD^{tree}'], root),
    sourceDirty: git(['status', '--porcelain', '--untracked-files=no'], root) !== ''
      || git(['ls-files', '--others', '--exclude-standard', '--', 'src', 'packaging', 'scripts'], root) !== '',
  };
}

export function assertSourceUnchanged(identity, root = ROOT) {
  const current = sourceIdentity(root);
  requireValue(current.sourceRevision === identity.sourceRevision
    && current.sourceTree === identity.sourceTree && current.sourceDirty === identity.sourceDirty,
  'source changed during packaging');
}

export function validateIdentity(value) {
  keys(value, ['schemaVersion', 'productVersion', 'platform', 'packageVersion', 'channel',
    'sourceRevision', 'sourceTree', 'sourceDirty']);
  requireValue(value.schemaVersion === 1 && VERSION.test(value.productVersion), 'invalid product version');
  requireValue(SHA.test(value.sourceRevision) && SHA.test(value.sourceTree)
    && typeof value.sourceDirty === 'boolean', 'invalid source identity');
  requireValue(['development', 'candidate', 'proof'].includes(value.channel), 'invalid build channel');
  if (value.platform === 'android') {
    requireValue(Number.isSafeInteger(value.packageVersion) && value.packageVersion > 0
      && value.packageVersion <= ANDROID_CODE_LIMIT, 'Android versionCode outside Play limit');
  } else {
    requireValue(['windows-portable', 'windows-msix'].includes(value.platform), 'invalid platform');
    const expected = value.platform === 'windows-portable' ? value.productVersion
      : `${value.productVersion}.${value.channel === 'proof' ? 1 : 0}`;
    requireValue(value.packageVersion === expected, 'invalid Windows package version');
  }
  requireValue(value.channel !== 'candidate' || !value.sourceDirty, 'candidate source must be clean');
  return value;
}

export async function buildIdentity(platform, packageVersion, channel, root = ROOT) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const source = sourceIdentity(root);
  return validateIdentity({
    schemaVersion: 1, productVersion: version, platform, packageVersion,
    channel: channel ?? (source.sourceDirty ? 'development' : 'candidate'), ...source,
  });
}

export function stampAbout(html, identity) {
  validateIdentity(identity);
  requireValue(html.split(ABOUT_BUILD).length === 2, 'About build marker changed');
  return html.replace(ABOUT_BUILD, `${identity.platform} ${identity.packageVersion}; ${identity.channel}; `
    + `source ${identity.sourceRevision}${identity.sourceDirty ? ' (modified)' : ''}.`);
}

export async function writeBuildIdentity(directory, identity) {
  const index = join(directory, 'index.html');
  await writeFile(index, stampAbout(await readFile(index, 'utf8'), identity));
  await writeFile(join(directory, 'build-info.json'), `${JSON.stringify(validateIdentity(identity), null, 2)}\n`);
}

export function validateAndroidLedger(ledger) {
  keys(ledger, ['schemaVersion', 'retiredThrough', 'reservations']);
  requireValue(ledger.schemaVersion === 1 && ledger.retiredThrough === DEVELOPMENT_ANDROID_CODE
    && Array.isArray(ledger.reservations), 'invalid Android allocation ledger');
  let previous = ledger.retiredThrough;
  for (const entry of ledger.reservations) {
    keys(entry, ['versionCode', 'productVersion', 'sourceRevision', 'sourceTree', 'artifact']);
    requireValue(entry.versionCode === previous + 1 && entry.versionCode <= ANDROID_CODE_LIMIT,
      'Android reservations must increase without reuse or overflow');
    requireValue(VERSION.test(entry.productVersion) && SHA.test(entry.sourceRevision)
      && SHA.test(entry.sourceTree), 'invalid Android reservation source');
    if (entry.artifact !== null) validateArtifact(entry.artifact);
    previous = entry.versionCode;
  }
  return ledger;
}

export function reserveAndroidBuild(ledger, source) {
  validateAndroidLedger(ledger);
  const versionCode = nextAndroidVersionCode(ledger.reservations.at(-1)?.versionCode ?? ledger.retiredThrough);
  const reservation = {
    versionCode, productVersion: source.productVersion,
    sourceRevision: source.sourceRevision, sourceTree: source.sourceTree, artifact: null,
  };
  return validateAndroidLedger({ ...ledger, reservations: [...ledger.reservations, reservation] });
}

export function nextAndroidVersionCode(previous) {
  requireValue(Number.isSafeInteger(previous) && previous >= DEVELOPMENT_ANDROID_CODE
    && previous < ANDROID_CODE_LIMIT, 'Android versionCode exhausted or invalid');
  return previous + 1;
}

export function assertAppendOnlyLedger(previous, next) {
  validateAndroidLedger(previous);
  validateAndroidLedger(next);
  requireValue(next.reservations.length >= previous.reservations.length, 'Android reservations cannot be removed');
  previous.reservations.forEach((entry, index) => {
    const replacement = next.reservations[index];
    requireValue(JSON.stringify({ ...replacement, artifact: entry.artifact }) === JSON.stringify(entry)
      && (entry.artifact === null || JSON.stringify(entry.artifact) === JSON.stringify(replacement.artifact)),
    'Android reservations cannot be rewritten');
  });
}

export async function androidBuild({
  root = ROOT, code = process.env.RECAP_ANDROID_VERSION_CODE,
  ledgerPath = process.env.RECAP_ANDROID_LEDGER ?? join(root, 'packaging', 'android', 'version-codes.json'),
} = {}) {
  const identity = await buildIdentity('android', DEVELOPMENT_ANDROID_CODE, 'development', root);
  if (code !== undefined) {
    requireValue(/^[1-9]\d*$/.test(code), 'invalid reserved Android versionCode');
    const ledger = validateAndroidLedger(JSON.parse(await readFile(ledgerPath, 'utf8')));
    const reservation = ledger.reservations.find((entry) => entry.versionCode === Number(code));
    requireValue(reservation && reservation.artifact === null && !identity.sourceDirty
      && reservation.productVersion === identity.productVersion
      && reservation.sourceRevision === identity.sourceRevision
      && reservation.sourceTree === identity.sourceTree, 'Android reservation is sealed or does not match clean source');
    identity.packageVersion = reservation.versionCode;
    identity.channel = 'candidate';
  }
  return {
    identity,
    versionCode: identity.packageVersion,
    versionName: identity.channel === 'candidate' ? identity.productVersion
      : `${identity.productVersion}-dev.${identity.sourceRevision.slice(0, 8)}${identity.sourceDirty ? '-dirty' : ''}`,
  };
}

export async function artifactRecord(path, identity) {
  validateIdentity(identity);
  const name = basename(path);
  requireValue(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), 'unsafe artifact name');
  const bytes = await readFile(path);
  requireValue(bytes.length > 0, 'artifact is empty');
  return { ...identity, artifact: {
    name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  } };
}

export async function verifyArtifact(path, record) {
  const { artifact, ...identity } = record;
  validateArtifact(artifact);
  const actual = await artifactRecord(path, identity);
  requireValue(JSON.stringify(actual.artifact) === JSON.stringify(artifact),
    'artifact bytes or filename changed; rebuilding is not promotion');
  return actual;
}

function validateArtifact(artifact) {
  keys(artifact, ['name', 'bytes', 'sha256']);
  requireValue(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifact.name)
    && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && HASH.test(artifact.sha256),
  'invalid artifact identity');
}

export function sealAndroidArtifact(ledger, record) {
  validateAndroidLedger(ledger);
  const { artifact, ...identity } = record;
  validateArtifact(artifact);
  validateIdentity(identity);
  requireValue(identity.platform === 'android' && identity.channel === 'candidate',
    'development builds cannot be uploaded or promoted');
  const entry = ledger.reservations.find(({ versionCode }) => versionCode === identity.packageVersion);
  requireValue(entry && entry.artifact === null && entry.productVersion === identity.productVersion
    && entry.sourceRevision === identity.sourceRevision && entry.sourceTree === identity.sourceTree,
  'unreserved or already sealed Android artifact');
  return { ...ledger, reservations: ledger.reservations.map((item) => item === entry ? { ...item, artifact } : item) };
}

export async function verifyAndroidPromotion(path, record, ledger) {
  await verifyArtifact(path, record);
  validateAndroidLedger(ledger);
  const { artifact, ...identity } = record;
  validateIdentity(identity);
  const entry = ledger.reservations.find(({ versionCode }) => versionCode === identity.packageVersion);
  requireValue(identity.platform === 'android' && identity.channel === 'candidate' && entry
    && entry.sourceRevision === identity.sourceRevision && entry.sourceTree === identity.sourceTree
    && entry.productVersion === identity.productVersion
    && JSON.stringify(entry.artifact) === JSON.stringify(artifact),
  'promotion requires the exact sealed Android candidate');
  return record;
}
