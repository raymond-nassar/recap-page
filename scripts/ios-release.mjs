import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, open, rename, rm, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, artifactRecord, verifyArtifact, validateIdentity } from './lib/release-identity.mjs';

const ledgerFile = 'packaging/ios/build-numbers.json';
const sha = /^[0-9a-f]{40}$/;
const hash = /^[0-9a-f]{64}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const environment = 'ios-testflight';
const workflowFile = 'ios-testflight.yml';
function requireValue(ok, message) {
  if (!ok) throw new Error(`iOS release: ${message}`);
}
function keys(value, names) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...names].sort().join(), 'unexpected fields');
}
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const ledgerPath = () => process.env.RECAP_IOS_LEDGER ?? join(ROOT, ledgerFile);

export function validateIosLedger(ledger) {
  keys(ledger, ['schemaVersion', 'retiredThrough', 'reservations']);
  requireValue(ledger.schemaVersion === 1 && ledger.retiredThrough === 1
    && Array.isArray(ledger.reservations), 'invalid ledger');
  let previous = ledger.retiredThrough;
  for (const entry of ledger.reservations) {
    keys(entry, ['buildNumber', 'productVersion', 'sourceRevision', 'sourceTree', 'artifact']);
    requireValue(entry.buildNumber === previous + 1 && entry.buildNumber <= 9999,
      'build numbers must increase without reuse; single-component Apple limit is 9999');
    requireValue(version.test(entry.productVersion) && sha.test(entry.sourceRevision)
      && sha.test(entry.sourceTree), 'invalid reservation source');
    if (entry.artifact !== null) {
      keys(entry.artifact, ['name', 'bytes', 'sha256']);
      requireValue(/^[A-Za-z0-9][A-Za-z0-9._-]*\.ipa$/.test(entry.artifact.name)
        && Number.isSafeInteger(entry.artifact.bytes) && entry.artifact.bytes > 0
        && hash.test(entry.artifact.sha256), 'invalid IPA seal');
    }
    previous = entry.buildNumber;
  }
  return ledger;
}

export function assertIosAppendOnly(previous, next) {
  validateIosLedger(previous);
  validateIosLedger(next);
  requireValue(next.reservations.length >= previous.reservations.length, 'reservations cannot be removed');
  previous.reservations.forEach((entry, index) => {
    const replacement = next.reservations[index];
    requireValue(JSON.stringify({ ...replacement, artifact: entry.artifact }) === JSON.stringify(entry)
      && (entry.artifact === null || JSON.stringify(entry.artifact) === JSON.stringify(replacement.artifact)),
    'reservations and sealed bytes cannot be rewritten');
  });
}

export function reserveIosBuild(ledger, source) {
  validateIosLedger(ledger);
  return validateIosLedger({ ...ledger, reservations: [...ledger.reservations, {
    buildNumber: (ledger.reservations.at(-1)?.buildNumber ?? 1) + 1,
    productVersion: source.productVersion, sourceRevision: source.sourceRevision,
    sourceTree: source.sourceTree, artifact: null,
  }] });
}

export function iosReservation(ledger, number) {
  validateIosLedger(ledger);
  requireValue(/^[1-9]\d*$/.test(String(number)), 'invalid build number');
  const entry = ledger.reservations.find((item) => item.buildNumber === Number(number));
  requireValue(entry, 'build number is not reserved');
  return entry;
}

export function candidateIdentity(entry) {
  return validateIdentity({
    schemaVersion: 1, productVersion: entry.productVersion, platform: 'ios',
    packageVersion: entry.buildNumber, channel: 'candidate', sourceRevision: entry.sourceRevision,
    sourceTree: entry.sourceTree, sourceDirty: false,
  });
}

export function sealIosArtifact(ledger, record) {
  const entry = iosReservation(ledger, record.packageVersion);
  const { artifact, ...identity } = record;
  requireValue(JSON.stringify(identity) === JSON.stringify(candidateIdentity(entry)), 'record source mismatch');
  requireValue(entry.artifact === null, 'reservation already sealed');
  return validateIosLedger({ ...ledger,
    reservations: ledger.reservations.map((item) => item === entry ? { ...item, artifact } : item) });
}

export async function verifyIosUpload(path, record, ledger) {
  const entry = iosReservation(ledger, record.packageVersion);
  const { artifact, ...identity } = record;
  requireValue(JSON.stringify(identity) === JSON.stringify(candidateIdentity(entry))
    && entry.artifact !== null && JSON.stringify(artifact) === JSON.stringify(entry.artifact),
  'upload requires the exact merged seal and candidate identity');
  await verifyArtifact(path, record);
  return record;
}

export function iosUploadRecord(record, exportRun, uploadRun, uploadedAt = new Date()) {
  requireValue(/^[1-9]\d*$/.test(exportRun) && /^[1-9]\d*$/.test(uploadRun), 'invalid upload run identity');
  return {
    ...record, exportRun, uploadRun, uploadedAt: uploadedAt.toISOString(),
    expiresAt: new Date(uploadedAt.getTime() + 90 * 86400000).toISOString(),
    expiryBasis: 'Upload plus 90 days; confirm the actual expiration in TestFlight after processing.',
  };
}

function assertMainSource(entry, main = 'origin/main', root = ROOT) {
  const command = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  requireValue(command('rev-parse', `${entry.sourceRevision}^{commit}`) === entry.sourceRevision,
    'source must be an exact commit');
  command('merge-base', '--is-ancestor', entry.sourceRevision, main);
  requireValue(command('rev-parse', `${entry.sourceRevision}^{tree}`) === entry.sourceTree
    && JSON.parse(command('show', `${entry.sourceRevision}:package.json`)).version === entry.productVersion,
  'source tree or version mismatch');
}

export function checkIosHistory({ root = ROOT } = {}) {
  const command = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let previous = { schemaVersion: 1, retiredThrough: 1, reservations: [] };
  for (const commit of command('rev-list', '--reverse', '--first-parent', 'HEAD', '--', ledgerFile).split('\n').filter(Boolean)) {
    const next = validateIosLedger(JSON.parse(command('show', `${commit}:${ledgerFile}`)));
    assertIosAppendOnly(previous, next);
    for (const entry of next.reservations.slice(previous.reservations.length)) {
      assertMainSource(entry, 'origin/main', root);
      command('merge-base', '--is-ancestor', entry.sourceRevision, `${commit}^`);
    }
    previous = next;
  }
  const current = validateIosLedger(JSON.parse(readFileSync(join(root, ledgerFile), 'utf8')));
  assertIosAppendOnly(previous, current);
  current.reservations.forEach((entry) => assertMainSource(entry, 'origin/main', root));
  return current;
}

async function updateLedger(change) {
  const path = ledgerPath();
  const lock = await open(`${path}.lock`, 'wx');
  let pending = false;
  try {
    const previous = validateIosLedger(await json(path));
    const next = change(previous);
    assertIosAppendOnly(previous, next);
    await writeFile(`${path}.next`, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    pending = true;
    await rename(`${path}.next`, path);
    pending = false;
    return next;
  } finally {
    if (pending) await rm(`${path}.next`);
    await lock.close();
    await rm(`${path}.lock`);
  }
}

export function assertInvocation(env) {
  requireValue(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === `${env.GITHUB_REPOSITORY}/.github/workflows/${workflowFile}@refs/heads/main`,
  'manual main workflow required');
  requireValue(['export', 'upload'].includes(env.IOS_MODE) && env.GITHUB_RUN_ATTEMPT === '1',
    'invalid mode or rerun; reserve a fresh number after an export failure');
}

export function assertProtection(value, policies) {
  const rule = value.protection_rules?.find((rule) => rule.type === 'required_reviewers');
  const reviewers = rule?.reviewers;
  requireValue(reviewers?.length === 1 && reviewers[0].type === 'User'
    && reviewers[0].reviewer.login === 'raymond-nassar' && value.can_admins_bypass === false
    && rule.prevent_self_review === false,
  'environment must require only the owner and forbid administrator bypass');
  requireValue(value.deployment_branch_policy?.custom_branch_policies === true
    && value.deployment_branch_policy.protected_branches === false
    && policies.branch_policies?.length === 1 && policies.branch_policies[0].name === 'main'
    && policies.branch_policies[0].type === 'branch', 'environment must allow only the main branch');
}

export function assertRunHistory(runs, env, buildNumber) {
  requireValue(!runs.some((run) => String(run.id) !== env.GITHUB_RUN_ID
    && run.display_title === `iOS ${env.IOS_MODE} build ${buildNumber}`),
  'build already attempted in this mode; stop and inspect the earlier run');
  if (env.IOS_MODE === 'upload') {
    requireValue(!runs.some((run) => {
      const match = /^iOS upload build ([1-9]\d*)$/.exec(run.display_title);
      return match && Number(match[1]) > buildNumber;
    }), 'a newer build has an upload attempt; never upload an older allocation afterward');
  }
}

export function assertExportRun(run, buildNumber) {
  requireValue(run.path === `.github/workflows/${workflowFile}` && run.head_branch === 'main'
    && run.event === 'workflow_dispatch' && run.conclusion === 'success'
    && run.display_title === `iOS export build ${buildNumber}`, 'wrong or unsuccessful export run');
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000),
  });
  requireValue(response.ok, `GitHub ${path} failed (${response.status}); no protection is created automatically`);
  return response.json();
}

async function preflight() {
  const env = process.env;
  assertInvocation(env);
  assertProtection(await github(`environments/${environment}`),
    await github(`environments/${environment}/deployment-branch-policies`));
  git('fetch', 'origin', 'main:refs/remotes/origin/main');
  const ledger = validateIosLedger(JSON.parse(git('show', `origin/main:${ledgerFile}`)));
  const entry = iosReservation(ledger, env.IOS_BUILD_NUMBER);
  assertMainSource(entry);
  requireValue(env.IOS_MODE === 'export' ? entry.artifact === null : entry.artifact !== null,
    'export requires an unsealed reservation; upload requires a merged seal');
  // An unsuccessful or uncertain run consumes its attempt too. Never silently retry a sign/upload.
  const runs = [];
  for (let page = 1; ; page++) {
    const response = await github(`actions/workflows/${workflowFile}/runs?event=workflow_dispatch&branch=main&per_page=100&page=${page}`);
    requireValue(response.total_count <= 1000, 'GitHub run search exceeds 1000; audit history before proceeding');
    runs.push(...response.workflow_runs);
    if (runs.length >= response.total_count) break;
    requireValue(response.workflow_runs.length > 0, 'incomplete run history');
  }
  assertRunHistory(runs, env, entry.buildNumber);
  if (env.IOS_MODE === 'upload') {
    requireValue(/^[1-9]\d*$/.test(env.IOS_EXPORT_RUN ?? ''), 'export run is required');
    assertExportRun(await github(`actions/runs/${env.IOS_EXPORT_RUN}`), entry.buildNumber);
  }
  if (env.GITHUB_OUTPUT) await writeFile(env.GITHUB_OUTPUT,
    `source_sha=${entry.sourceRevision}\nproduct_version=${entry.productVersion}\nenvironment=${environment}\n`, { flag: 'a' });
  return { ledger, entry };
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

async function authenticated(mode) {
  const { ledger, entry } = await preflight();
  const env = process.env;
  const keyDir = join(env.RUNNER_TEMP, 'ios-private-keys');
  const keyPath = join(keyDir, `AuthKey_${env.ASC_KEY_ID}.p8`);
  requireValue(/^[A-Z0-9]{10}$/.test(env.ASC_KEY_ID ?? '')
    && /^[0-9a-f-]{36}$/i.test(env.ASC_ISSUER_ID ?? '')
    && /^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? '') && env.ASC_PRIVATE_KEY?.includes('PRIVATE KEY'),
  'missing or malformed protected environment configuration');
  await mkdir(keyDir, { mode: 0o700 });
  await writeFile(keyPath, env.ASC_PRIVATE_KEY, { flag: 'wx', mode: 0o600 });
  const output = join(env.RUNNER_TEMP, 'ios-public');
  await mkdir(output, { recursive: true });
  const auth = ['-allowProvisioningUpdates', '-authenticationKeyPath', keyPath,
    '-authenticationKeyID', env.ASC_KEY_ID, '-authenticationKeyIssuerID', env.ASC_ISSUER_ID];
  if (mode === 'export') {
    const source = join(ROOT, 'application');
    requireValue(execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim() === ''
      && execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() === entry.sourceRevision,
    'application source must be the clean reservation checkout');
    const ledgerCopy = join(env.RUNNER_TEMP, 'ios-ledger.json');
    await save(ledgerCopy, ledger);
    run(process.execPath, ['scripts/prepare-ios.mjs'], { cwd: source,
      env: { ...env, RECAP_IOS_LEDGER: ledgerCopy, RECAP_IOS_BUILD_NUMBER: String(entry.buildNumber) } });
    const archive = join(env.RUNNER_TEMP, 'RecapPage.xcarchive');
    const options = join(env.RUNNER_TEMP, 'ios-export.plist');
    await writeFile(options, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string><key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${env.APPLE_TEAM_ID}</string>
<key>manageAppVersionAndBuildNumber</key><false/></dict></plist>`, { flag: 'wx' });
    run('xcodebuild', ['archive', '-project', 'packaging/ios/RecapPage.xcodeproj', '-scheme', 'RecapPage',
      '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archive,
      `DEVELOPMENT_TEAM=${env.APPLE_TEAM_ID}`, `CURRENT_PROJECT_VERSION=${entry.buildNumber}`,
      `MARKETING_VERSION=${entry.productVersion}`, ...auth], { cwd: source });
    run('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', output,
      '-exportOptionsPlist', options, ...auth]);
    // Export logs and provisioning metadata are private scratch, not retained artifacts.
    const ipa = (await readdir(output)).filter((name) => name.endsWith('.ipa'));
    requireValue(ipa.length === 1, 'export must produce exactly one IPA');
    const path = join(output, ipa[0]);
    const inspection = join(env.RUNNER_TEMP, 'ios-inspection');
    run('ditto', ['-x', '-k', path, inspection]);
    const payload = join(inspection, 'Payload');
    const apps = (await readdir(payload)).filter((name) => name.endsWith('.app'));
    requireValue(apps.length === 1, 'IPA must contain one app');
    const app = join(payload, apps[0]);
    const plist = (key) => execFileSync('plutil',
      ['-extract', key, 'raw', '-o', '-', join(app, 'Info.plist')], { encoding: 'utf8' }).trim();
    const appIdentity = await json(join(source, 'packaging', 'ios', 'identity.json'));
    requireValue(plist('CFBundleIdentifier') === appIdentity.bundleIdentifier
      && plist('CFBundleVersion') === String(entry.buildNumber)
      && plist('CFBundleShortVersionString') === entry.productVersion, 'exported app identity mismatch');
    requireValue(JSON.stringify(await json(join(app, 'web', 'build-info.json')))
      === JSON.stringify(candidateIdentity(entry)), 'embedded source identity mismatch');
    run('codesign', ['--verify', '--deep', '--strict', app]);
    const record = await artifactRecord(path, candidateIdentity(entry));
    await save(join(output, 'ios-artifact.json'), record);
    await save(join(output, 'build-numbers.proposed.json'), sealIosArtifact(ledger, record));
  } else {
    const record = await json(join(output, 'ios-artifact.json'));
    const path = join(output, record.artifact.name);
    await verifyIosUpload(path, record, ledger);
    run('xcrun', ['altool', '--upload-app', '--type', 'ios', '--file', path,
      '--apiKey', env.ASC_KEY_ID, '--apiIssuer', env.ASC_ISSUER_ID],
    { env: { ...env, API_PRIVATE_KEYS_DIR: keyDir } });
    await save(join(env.RUNNER_TEMP, 'ios-upload.json'),
      iosUploadRecord(record, env.IOS_EXPORT_RUN, env.GITHUB_RUN_ID));
  }
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'history') {
    checkIosHistory();
    console.log('iOS append-only ledger history verified.');
  } else if (command === 'reserve' && sha.test(input) && !output) {
    const source = { sourceRevision: input, sourceTree: git('rev-parse', `${input}^{tree}`),
      productVersion: JSON.parse(git('show', `${input}:package.json`)).version };
    assertMainSource(source);
    const next = await updateLedger((ledger) => reserveIosBuild(ledger, source));
    console.log(`Reserved build ${next.reservations.at(-1).buildNumber}; merge before export. No signing or upload.`);
  } else if (command === 'record' && input && output) {
    const ledger = validateIosLedger(await json(ledgerPath()));
    const entry = iosReservation(ledger, process.env.RECAP_IOS_BUILD_NUMBER);
    const record = await artifactRecord(input, candidateIdentity(entry));
    const proposed = sealIosArtifact(ledger, record);
    await save(output, record);
    await save(`${output}.proposed.json`, proposed);
  } else if (command === 'verify' && input && output) {
    await verifyIosUpload(input, await json(output), await json(ledgerPath()));
    console.log('Exact sealed IPA verified; no upload performed.');
  } else if (command === 'preflight') {
    await preflight();
  } else if (['export', 'upload'].includes(command)) {
    requireValue(process.env.IOS_MODE === command, 'mode mismatch');
    await authenticated(command);
  } else throw new Error('Usage: ios-release.mjs history | reserve <full-source-sha> | record <ipa> <new-record.json> | verify <ipa> <record.json> | preflight | export | upload');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
