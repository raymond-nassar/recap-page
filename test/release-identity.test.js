import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  ANDROID_CODE_LIMIT, ROOT, ABOUT_BUILD, androidBuild, artifactRecord,
  assertAppendOnlyLedger, assertSourceUnchanged, nextAndroidVersionCode, reserveAndroidBuild,
  sealAndroidArtifact, sourceIdentity, stampAbout, validateAndroidLedger,
  validateIdentity, verifyAndroidPromotion, verifyArtifact, writeBuildIdentity,
} from '../scripts/lib/release-identity.mjs';

const initial = () => ({ schemaVersion: 1, retiredThrough: 3000002, reservations: [] });
const source = {
  productVersion: '3.0.1', sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
};
const candidate = () => ({
  schemaVersion: 1, ...source, platform: 'android', packageVersion: 3000003,
  channel: 'candidate', sourceDirty: false,
});
const artifact = { name: 'recap.apk', bytes: 3, sha256: 'c'.repeat(64) };

test('Android allocations increase across tracks and rebuilds, with a hard Play ceiling', () => {
  const first = reserveAndroidBuild(initial(), source);
  const second = reserveAndroidBuild(first, source);
  assert.deepEqual(second.reservations.map(({ versionCode }) => versionCode), [3000003, 3000004]);
  assert.deepEqual(initial().reservations, []);
  assert.equal(nextAndroidVersionCode(ANDROID_CODE_LIMIT - 1), ANDROID_CODE_LIMIT);
  for (const previous of [ANDROID_CODE_LIMIT, -1, 3000001, NaN, '3000002', 2.5]) {
    assert.throws(() => nextAndroidVersionCode(previous), /versionCode/);
  }
  for (const code of [3000002, 3000004, ANDROID_CODE_LIMIT + 1]) {
    const bad = structuredClone(first);
    bad.reservations[0].versionCode = code;
    assert.throws(() => validateAndroidLedger(bad), /increase/);
  }
});

test('reservations are append-only and sealing is a one-time immutable artifact binding', () => {
  const reserved = reserveAndroidBuild(initial(), source);
  const record = { ...candidate(), artifact };
  const sealed = sealAndroidArtifact(reserved, record);
  assertAppendOnlyLedger(reserved, sealed);
  assertAppendOnlyLedger(sealed, reserveAndroidBuild(sealed, source));
  assert.throws(() => sealAndroidArtifact(sealed, record), /sealed/);
  assert.throws(() => assertAppendOnlyLedger(sealed, reserved), /rewritten/);
  assert.throws(() => assertAppendOnlyLedger(sealed, initial()), /removed/);
  const changed = structuredClone(sealed);
  changed.reservations[0].sourceRevision = 'd'.repeat(40);
  assert.throws(() => assertAppendOnlyLedger(sealed, changed), /rewritten/);
  assert.throws(() => sealAndroidArtifact(reserved, { ...record, channel: 'development' }), /development/);
  assert.throws(() => sealAndroidArtifact(reserved, { ...record, sourceRevision: 'd'.repeat(40) }), /unreserved/);
});

test('public identity rejects arbitrary fields, paths, malformed versions and dirty candidates', () => {
  for (const change of [
    { localPath: 'C:\\private' }, { sourceRevision: 'C:\\private' }, { productVersion: '<script>' },
    { channel: 'secret' }, { platform: 'other' }, { sourceDirty: true }, { packageVersion: 0 },
    { packageVersion: ANDROID_CODE_LIMIT + 1 },
  ]) assert.throws(() => validateIdentity({ ...candidate(), ...change }));
  const portable = { ...candidate(), platform: 'windows-portable', packageVersion: '3.0.1' };
  validateIdentity(portable);
  validateIdentity({ ...portable, platform: 'windows-msix', packageVersion: '3.0.1.0' });
  validateIdentity({ ...portable, platform: 'windows-msix', packageVersion: '3.0.1.1', channel: 'proof' });
  assert.throws(() => validateIdentity({ ...portable, platform: 'windows-msix', packageVersion: '3.0.1.2' }));
});

test('About stamping and its build report agree without changing the source template', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-identity-'));
  try {
    const html = `<p id="about-build">${ABOUT_BUILD}</p>`;
    await writeFile(join(scratch, 'index.html'), html);
    await writeBuildIdentity(scratch, candidate());
    const output = await readFile(join(scratch, 'index.html'), 'utf8');
    assert.equal(output, stampAbout(html, candidate()));
    assert.ok(output.includes('android 3000003; candidate; source ' + source.sourceRevision));
    assert.deepEqual(JSON.parse(await readFile(join(scratch, 'build-info.json'), 'utf8')), candidate());
    assert.throws(() => stampAbout('missing marker', candidate()), /marker/);
    assert.throws(() => stampAbout(html + html, candidate()), /marker/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('promotion verifies exact sealed bytes, not a rebuilt or substituted package', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-artifact-'));
  const path = join(scratch, 'recap.apk');
  try {
    await writeFile(path, 'fixture');
    const record = await artifactRecord(path, candidate());
    const reserved = reserveAndroidBuild(initial(), source);
    const sealed = sealAndroidArtifact(reserved, record);
    await verifyArtifact(path, record);
    await verifyAndroidPromotion(path, record, sealed);
    await assert.rejects(verifyAndroidPromotion(path, record, reserved), /sealed/);
    await assert.rejects(verifyAndroidPromotion(path, { ...record, channel: 'development' }, sealed), /candidate/);
    await writeFile(path, 'changed');
    await assert.rejects(verifyArtifact(path, record), /rebuilding is not promotion/);
    await assert.rejects(verifyAndroidPromotion(path, record, sealed), /rebuilding is not promotion/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Android builds require a reservation for exact clean source and refuse a sealed rebuild', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recap-source-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--quiet');
    await writeFile(join(root, 'package.json'), '{"version":"3.0.1"}\n');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'index.html'), 'fixture');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic source');
    const pin = { productVersion: '3.0.1', ...sourceIdentity(root) };
    const ledgerPath = join(root, 'ledger.json');
    const ledger = reserveAndroidBuild(initial(), pin);
    await writeFile(ledgerPath, JSON.stringify(ledger));
    const built = await androidBuild({ root, code: '3000003', ledgerPath });
    assert.equal(built.identity.channel, 'candidate');
    assert.equal(built.versionName, '3.0.1');
    assert.equal(built.versionCode, 3000003);
    assertSourceUnchanged(built.identity, root);
    const sealed = sealAndroidArtifact(ledger, { ...built.identity, artifact });
    await writeFile(ledgerPath, JSON.stringify(sealed));
    await assert.rejects(androidBuild({ root, code: '3000003', ledgerPath }), /sealed/);
    await writeFile(ledgerPath, JSON.stringify(ledger));
    await writeFile(join(root, 'src', 'index.html'), 'modified');
    assert.throws(() => assertSourceUnchanged(built.identity, root), /source changed/);
    await assert.rejects(androidBuild({ root, code: '3000003', ledgerPath }), /clean source/);
    const development = await androidBuild({ root, code: undefined, ledgerPath });
    assert.equal(development.identity.sourceDirty, true);
    assert.match(development.versionName, /-dev\.[0-9a-f]{8}-dirty$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('committed Android reservations preserve all first-parent allocation history', async () => {
  const path = 'packaging/android/version-codes.json';
  const next = validateAndroidLedger(JSON.parse(await readFile(join(ROOT, path), 'utf8')));
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let previous = initial();
  const history = git('log', '--first-parent', '--reverse', '--format=%H', '--', path).split(/\r?\n/).filter(Boolean);
  for (const ref of history) {
    const current = JSON.parse(git('show', `${ref}:${path}`));
    assertAppendOnlyLedger(previous, current);
    previous = current;
  }
  assertAppendOnlyLedger(previous, next);
  for (const entry of next.reservations) {
    git('merge-base', '--is-ancestor', entry.sourceRevision, 'HEAD');
    assert.equal(git('rev-parse', `${entry.sourceRevision}^{tree}`), entry.sourceTree);
    assert.equal(JSON.parse(git('show', `${entry.sourceRevision}:package.json`)).version, entry.productVersion);
  }
});

test('the reservation CLI writes atomically and refuses an occupied allocation lock', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-allocation-'));
  const ledger = join(scratch, 'ledger.json');
  const execute = promisify(execFile);
  const command = join(ROOT, 'scripts', 'android-release.mjs');
  const head = sourceIdentity().sourceRevision;
  const options = { cwd: ROOT, env: { ...process.env, RECAP_ANDROID_LEDGER: ledger } };
  try {
    await writeFile(ledger, JSON.stringify(initial()));
    await writeFile(`${ledger}.lock`, 'fixture lock');
    await assert.rejects(execute(process.execPath, [command, 'reserve', head], options), /EEXIST/);
    assert.deepEqual(JSON.parse(await readFile(ledger, 'utf8')), initial());
    assert.equal(await readFile(`${ledger}.lock`, 'utf8'), 'fixture lock');
    await rm(`${ledger}.lock`);
    await execute(process.execPath, [command, 'reserve', head], options);
    await execute(process.execPath, [command, 'reserve', head], options);
    const result = validateAndroidLedger(JSON.parse(await readFile(ledger, 'utf8')));
    assert.deepEqual(result.reservations.map(({ versionCode }) => versionCode), [3000003, 3000004]);
    await assert.rejects(readFile(`${ledger}.lock`), { code: 'ENOENT' });
    await assert.rejects(readFile(`${ledger}.next`), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
