import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import {
  ENVIRONMENT, OFFICIAL_ID, PROTOTYPE_ID, REPOSITORY, PACKET, digest,
  validateInvocation, protectionPolicy, requireApproval, eligibleReservation,
  requireUnusedCode, requireSourceAncestry, sourceCommand, checkRecord, assertFiles, checkAssets, noNative,
  verifyNativeReport, withPrivateDirectory, certificateFingerprint, execute,
} from '../scripts/android-candidate.mjs';
import { reserveAndroidBuild, sourceIdentity, artifactRecord, verifyArtifact } from '../scripts/lib/release-identity.mjs';
import { NATIVE_METHODS } from '../scripts/check-android-instrumentation.mjs';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const source = { sourceRevision: sha, sourceTree: tree, productVersion: '3.1.0' };
const identity = () => ({ schemaVersion: 1, productVersion: '3.1.0', platform: 'android',
  packageVersion: 3000003, channel: 'candidate', sourceRevision: sha, sourceTree: tree, sourceDirty: false });
const emptyLedger = () => ({ schemaVersion: 1, retiredThrough: 3000002, reservations: [] });
function invocation(mode = 'Candidate', path = '.github/workflows/android-release-candidate.yml') {
  return {
    input: { mode, sourceSha: sha, ledgerSha: mode === 'Candidate' ? 'd'.repeat(40) : '',
      code: mode === 'Candidate' ? '3000003' : '', highWater: mode === 'Candidate' ? '0' : '',
      evidence: mode === 'Candidate' ? `https://github.com/${REPOSITORY}/issues/578#issuecomment-123` : '' },
    context: { repository: REPOSITORY, event: 'workflow_dispatch', defaultBranch: 'main', ref: 'refs/heads/main',
      sha, workflowSha: sha, workflowRef: `${REPOSITORY}/${path}@refs/heads/main`, runId: 123, attempt: 1,
      actor: 'initiator', triggeringActor: 'initiator', rehearsalFlag: true, emulatorFlag: false },
    run: { id: 123, event: 'workflow_dispatch', head_sha: sha, head_branch: 'main',
      run_attempt: 1, workflow_id: 42, path },
  };
}
function environment() {
  return {
    name: ENVIRONMENT, id: 12, can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { id: 7, type: 'User' } }] }],
  };
}
const branches = () => ({ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] });
const approve = () => [{ environments: [{ id: 12 }], state: 'approved', user: { id: 7, type: 'User', login: 'reviewer' } }];

test('manual caller identity makes CI rehearsal-only even when Candidate inputs are forged', () => {
  for (const [mode, path] of [['Candidate', '.github/workflows/android-release-candidate.yml'],
    ['Rehearsal', '.github/workflows/ci.yml']]) {
    const value = invocation(mode, path);
    assert.doesNotThrow(() => validateInvocation(value.input, value.context, value.run));
  }
  for (const change of [
    (v) => { v.context.event = 'push'; },
    (v) => { v.context.ref = 'refs/heads/feature'; },
    (v) => { v.run.head_sha = 'e'.repeat(40); },
    (v) => { v.context.attempt = v.run.run_attempt = 2; },
    (v) => { v.input.highWater = '3000003'; },
    (v) => { v.input.code = '2100000001'; },
    (v) => { v.input.sourceSha = 'main'; },
  ]) {
    const v = invocation();
    change(v);
    assert.throws(() => validateInvocation(v.input, v.context, v.run));
  }
  const forged = invocation('Candidate', '.github/workflows/ci.yml');
  assert.throws(() => validateInvocation(forged.input, forged.context, forged.run), /CI cannot sign/);
  const both = invocation('Rehearsal', '.github/workflows/ci.yml');
  both.context.emulatorFlag = true;
  assert.throws(() => validateInvocation(both.input, both.context, both.run), /exclusive/);
  both.context.emulatorFlag = false;
  both.input.code = '3000003';
  assert.throws(() => validateInvocation(both.input, both.context, both.run), /must not receive/);
});

test('protection requires actual no-bypass human review and exact main-only deployment policy', () => {
  const policy = protectionPolicy(environment(), branches());
  assert.equal(policy.environmentId, 12);
  for (const modify of [
    (env) => { delete env.can_admins_bypass; },
    (env) => { env.can_admins_bypass = true; },
    (env) => { env.protection_rules[0].prevent_self_review = false; },
    (env) => { env.protection_rules[0].reviewers[0].type = 'Team'; },
    (env) => { env.protection_rules = []; },
    (env) => { env.deployment_branch_policy = null; },
  ]) {
    const env = environment();
    modify(env);
    assert.throws(() => protectionPolicy(env, branches()));
  }
  assert.throws(() => protectionPolicy(environment(), { total_count: 1, branch_policies: [{ name: '*', type: 'branch' }] }));
  assert.throws(() => protectionPolicy(environment(), { total_count: 1, branch_policies: [{ name: 'main', type: 'tag' }] }));
  const recreated = environment();
  recreated.id = 13;
  assert.notEqual(protectionPolicy(recreated, branches()).sha256, policy.sha256);
});

test('policy restoration without the actual current-run environment approval is not authorization', () => {
  const policy = protectionPolicy(environment(), branches());
  const { context } = invocation();
  assert.equal(requireApproval(approve(), policy, context).approved, true);
  for (const history of [[], null, [{ ...approve()[0], state: 'rejected' }],
    [{ ...approve()[0], environments: [{ id: 13 }] }],
    [{ ...approve()[0], user: { id: 7, type: 'User', login: 'initiator' } }],
    [{ ...approve()[0], user: { id: 8, type: 'User', login: 'reviewer' } }],
    [...approve(), ...approve()]]) {
    assert.throws(() => requireApproval(history, policy, context));
  }
  assert.throws(() => requireApproval(approve(), policy, { ...context, attempt: 2 }));
});

test('source ancestry and current ledger prevent stale seals without losing later reservations', async () => {
  const selected = reserveAndroidBuild(emptyLedger(), source);
  const later = reserveAndroidBuild(selected, source);
  assert.equal(eligibleReservation(selected, later, source, '3000003').versionCode, 3000003);
  const sealed = structuredClone(later);
  sealed.reservations[0].artifact = { name: 'recap-page-android.aab', bytes: 1, sha256: hash };
  assert.throws(() => eligibleReservation(selected, sealed, source, '3000003'), /sealed/);
  assert.throws(() => eligibleReservation(selected, later, { ...source, sourceTree: sha }, '3000003'), /selected source/);
  assert.equal(later.reservations.length, 2);
  assert.equal(selected.reservations[0].artifact, null);
  const root = await mkdtemp(join(tmpdir(), 'recap-candidate-ancestry-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    const commits = [];
    for (const label of ['source', 'ledger', 'tooling']) {
      await writeFile(join(root, label), label);
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
        'commit', '--quiet', '-m', label);
      commits.push(git('rev-parse', 'HEAD'));
    }
    requireSourceAncestry(root, commits[0], commits[1], commits[2], commits[2]);
    assert.throws(() => requireSourceAncestry(root, commits[2], commits[1], commits[2], commits[2]),
      /git failed/, 'All commits are on main, but selected source must precede the ledger');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('consumed candidate attempts are rejected and incomplete bounded history never passes', async () => {
  await requireUnusedCode(async () => ({ total_count: 1,
    workflow_runs: [{ id: 123, display_title: 'Android Candidate code 3000003 source a' }] }), '3000003', 123);
  await assert.rejects(requireUnusedCode(async () => ({ total_count: 1,
    workflow_runs: [{ id: 122, display_title: 'Android Candidate code 3000003 source a' }] }), '3000003', 123), /earlier dispatch/);
  await assert.rejects(requireUnusedCode(async () => ({ total_count: 0, workflow_runs: [] }),
    '3000003', 123), /does not include this run/);
  let reads = 0;
  await assert.rejects(requireUnusedCode(async () => { reads += 1; return { total_count: 301, workflow_runs: [] }; },
    '3000003', 123), /bounded read/);
  assert.equal(reads, 3);
});

test('source-rooted CLI survives different tooling commits and intervening development control', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-candidate-root-'));
  try {
    const roots = [join(scratch, 'app'), join(scratch, 'tooling')];
    for (const [index, root] of roots.entries()) {
      await mkdir(join(root, 'scripts', 'lib'), { recursive: true });
      for (const name of ['android-release.mjs', 'lib/release-identity.mjs']) {
        await cp(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
      }
      await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '3.1.0', fixture: index }));
      const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
      git('init', '--quiet');
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
        'commit', '--quiet', '-m', 'Synthetic candidate source');
    }
    const root = roots[0];
    const pin = { ...sourceIdentity(root), productVersion: '3.1.0' };
    const ledger = join(scratch, 'ledger.json');
    await writeFile(ledger, JSON.stringify(reserveAndroidBuild(emptyLedger(), pin)));
    const options = { code: '3000003', ledger };
    const chosen = JSON.parse(sourceCommand(root, 'version', [], options));
    assert.equal(chosen.identity.sourceRevision, pin.sourceRevision);
    assert.throws(() => sourceCommand(roots[1], 'version', [], options), /failed/);
    assert.equal(JSON.parse(sourceCommand(root, 'version', [])).identity.channel, 'development');
    assert.equal(JSON.parse(sourceCommand(root, 'version', [], options)).identity.channel, 'candidate');
    const bundle = join(scratch, 'recap-page-android.aab');
    const record = join(scratch, 'record.json');
    await writeFile(bundle, 'Not a real AAB; identity CLI fixture only.');
    sourceCommand(root, 'record', [bundle, record], options);
    checkRecord(JSON.parse(await readFile(record, 'utf8')), chosen.identity);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('only exact candidate identity and the complete public allowlist may be retained', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-candidate-output-'));
  try {
    for (const name of PACKET) await writeFile(join(scratch, name), 'fixture');
    await assertFiles(scratch, PACKET);
    const path = join(scratch, 'recap-page-android.aab');
    const record = await artifactRecord(path, identity());
    checkRecord(record, identity());
    assert.throws(() => checkRecord({ ...record, channel: 'development' }, identity()), /development/);
    assert.throws(() => checkRecord({ ...record, sourceRevision: tree }, identity()), /differs/);
    await writeFile(join(scratch, 'upload.p12'), 'not a key');
    await assert.rejects(assertFiles(scratch, PACKET), /extra/);
    await writeFile(path, 'tampered');
    await assert.rejects(verifyArtifact(path, record), /changed/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('actual asset bytes, source hashes, fixed origin and exact inventory are checked', async () => {
  noNative([{ name: 'base/assets/recap/js/lib/model.js', elf: false }]);
  for (const entry of [{ name: 'base/lib/x86_64/library.so', elf: false },
    { name: 'lib/x86_64/library.so', elf: false }, { name: 'base/assets/disguised', elf: true }]) {
    assert.throws(() => noNative([entry]), /native library/);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'recap-candidate-assets-'));
  try {
    const root = join(scratch, 'source');
    const generated = join(scratch, 'generated');
    const extracted = join(scratch, 'extracted');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(generated);
    await writeFile(join(root, 'src', 'sample.js'), 'fixture');
    const files = [
      { path: 'sample.js', sha256: digest('fixture'), source: 'src/sample.js', sourceSha256: digest('fixture') },
      { path: 'android-config.json', sha256: digest('{"origin":"http://127.0.0.1:8787","version":"3.1.0"}') },
      { path: 'build-info.json', sha256: digest(JSON.stringify(identity())) },
    ];
    await writeFile(join(generated, 'sample.js'), 'fixture');
    await writeFile(join(generated, 'android-config.json'), '{"origin":"http://127.0.0.1:8787","version":"3.1.0"}');
    await writeFile(join(generated, 'build-info.json'), JSON.stringify(identity()));
    await writeFile(join(generated, '.recap-android-assets'), 'owned fixture');
    await writeFile(join(generated, 'android-assets.json'), JSON.stringify({ build: identity(), files }));
    await mkdir(extracted);
    for (const name of [...files.map((file) => file.path), 'android-assets.json']) {
      await cp(join(generated, name), join(extracted, name));
    }
    assert.equal((await checkAssets(extracted, generated, root, identity(), 'AAB')).files, 4);
    await writeFile(join(extracted, 'sample.js'), 'changed');
    await assert.rejects(checkAssets(extracted, generated, root, identity(), 'AAB'), /differs/);
    await writeFile(join(extracted, 'sample.js'), 'fixture');
    await rm(join(extracted, 'sample.js'));
    await assert.rejects(checkAssets(extracted, generated, root, identity(), 'AAB'),
      /AAB.*missing=1 \[sample\.js\].*extra=0/);
    await writeFile(join(extracted, 'sample.js'), 'fixture');
    await writeFile(join(extracted, 'extra.txt'), 'unlisted');
    await assert.rejects(checkAssets(extracted, generated, root, identity(), 'base-APK'),
      /base-APK.*missing=0.*extra=1 \[extra\.txt\]/);
    await rm(join(extracted, 'extra.txt'));
    await writeFile(join(extracted, '.recap-android-assets'), 'owned fixture');
    await assert.rejects(checkAssets(extracted, generated, root, identity(), 'AAB'),
      /AAB.*extra=1 \[\.recap-android-assets\]/);
    await rm(join(extracted, '.recap-android-assets'));
    const longName = `0-${'x'.repeat(159)}`;
    for (const name of [longName, '1 unsafe', 'a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      await writeFile(join(extracted, name), 'unlisted');
    }
    await assert.rejects(checkAssets(extracted, generated, root, identity(), 'AAB'), (error) => {
      assert.match(error.message, /extra=6 \[\[unreportable-name\], \[unreportable-name\], a\.txt, b\.txt, c\.txt\]/);
      assert.ok(!error.message.includes(longName) && !error.message.includes('1 unsafe'));
      assert.ok(!error.message.includes('d.txt') && !error.message.includes(extracted));
      return true;
    });
    assert.equal(await readFile(join(generated, '.recap-android-assets'), 'utf8'), 'owned fixture');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('native proof binds twelve executions to exact installed bytes and non-reseeding probes', () => {
  const target = (packageName, uid) => ({ packageName, uid, appHashes: [hash], harnessHash: hash, signerSha256: hash });
  const control = { official: target(OFFICIAL_ID, 10001), prototype: target(PROTOTYPE_ID, 10002) };
  const phases = [...NATIVE_METHODS.map((method) => ['suite', method]),
    ...['restart-seed', 'restart-probe', 'official-seed', 'prototype-seed', 'official-probe', 'prototype-probe']
      .map((phase) => [phase, 'startupAndPersistence'])];
  const report = {
    schemaVersion: 1, interfaceVersion: 1, synthetic: true,
    device: { sdk: 36, abi: 'x86_64', width: 1080, height: 2400, density: 420,
      webViewVersion: '133.0.6943.137', externalNetworkBlocked: true },
    executions: phases.map(([phase, method]) => ({
      ...control[phase.startsWith('prototype') ? 'prototype' : 'official'],
      phase, method, status: 'passed', tests: 1, skipped: 0, stateMatched: true, settingsMatched: true, storageCleared: false,
    })),
  };
  verifyNativeReport(report, control);
  for (const change of [
    (r) => { r.executions.pop(); },
    (r) => { r.executions[10].storageCleared = true; },
    (r) => { r.executions[10].appHashes = ['f'.repeat(64)]; },
    (r) => { r.executions[10].phase = 'official-seed'; },
    (r) => { r.executions[0].skipped = 1; },
    (r) => { r.device.externalNetworkBlocked = false; },
  ]) {
    const changed = structuredClone(report);
    change(changed);
    assert.throws(() => verifyNativeReport(changed, control));
  }
});

test('private signing scratch is removed on child failure and refuses unknown cleanup scope', async () => {
  const original = childProcess.execFileSync;
  const privateText = 'PRIVATE_SECRET_VALUE /private/keystore.p12 PRIVATE_ALIAS';
  let failure;
  let calls = 0;
  childProcess.execFileSync = () => { calls += 1; throw failure; };
  syncBuiltinESMExports();
  try {
    const cases = [
      { status: 7, signal: null, stderr: 'MANIFEST_SDK\n', exit: '7', signalName: 'none', code: 'MANIFEST_SDK' },
      { status: null, signal: 'SIGTERM', stderr: 'VERIFICATION_FAILED\n', exit: 'unknown', signalName: 'SIGTERM', code: 'VERIFICATION_FAILED' },
      { status: 256, signal: 'PRIVATE_SIGNAL', stderr: 'PRIVATE_UNKNOWN_CODE\n', exit: 'unknown', signalName: 'unrecognized', code: 'unclassified' },
      { status: 0, signal: null, stderr: 'MANIFEST_SDK /private/keystore.p12\n', exit: 'unknown', signalName: 'none', code: 'unclassified' },
      { status: 1, signal: null, stderr: '\u001b[31mMANIFEST_SDK\u001b[0m\n', exit: '1', signalName: 'none', code: 'unclassified' },
      { status: 2, signal: null, stderr: `${privateText}\nMANIFEST_SDK\n`, exit: '2', signalName: 'none', code: 'MANIFEST_SDK' },
      { status: 3, signal: null, stderr: `${'x'.repeat(4097)}\nMANIFEST_SDK\n`, exit: '3', signalName: 'none', code: 'unclassified' },
    ];
    for (const value of cases) {
      failure = Object.assign(new Error(privateText), {
        status: value.status, signal: value.signal, stderr: Buffer.from(value.stderr),
        stdout: Buffer.from(privateText), path: '/private/keystore.p12', spawnargs: [privateText],
      });
      assert.throws(() => execute('java', [privateText], { env: { PRIVATE_ENV: privateText } }, 'AAB_MANIFEST'), (error) => {
        assert.equal(error.message, `Android candidate: inspection AAB_MANIFEST failed; exit=${value.exit}; signal=${value.signalName}; code=${value.code}. Raw tool output was not retained.`);
        assert.doesNotMatch(error.message, /PRIVATE_|\/private\//);
        assert.ok([...error.message].every((character) => {
          const code = character.codePointAt(0);
          return code > 31 && (code < 127 || code > 159);
        }));
        return true;
      });
      assert.throws(() => execute('java', ['certificate', privateText]), (error) => {
        assert.equal(error.message, "Android candidate: java failed; check this stage's approved inputs. Raw tool output was not retained.");
        return true;
      });
    }
    failure = { status: 1, signal: null, stderr: Buffer.from('MANIFEST_SDK\n') };
    assert.throws(() => execute('java', ['-jar', privateText], {}, 'AAB_STRUCTURE'), (error) => {
      assert.equal(error.message, 'Android candidate: inspection AAB_STRUCTURE failed; exit=1; signal=none; code=unclassified. Raw tool output was not retained.');
      return true;
    });
    const before = calls;
    assert.throws(() => execute('java', [], {}, 'PRIVATE_STAGE'), /unknown inspection stage/);
    assert.throws(() => execute('java', ['certificate', privateText], {}, 'AAB_MANIFEST'), /secret-bearing commands/);
    assert.throws(() => execute('jarsigner', [privateText], {}, 'AAB_ARCHIVE'), /secret-bearing commands/);
    assert.throws(() => execute('apksigner', ['sign', privateText], {}, 'SPLIT_SIGNATURE'), /secret-bearing commands/);
    assert.equal(calls, before);
    childProcess.execFileSync = () => ' verified\n';
    syncBuiltinESMExports();
    assert.equal(execute('java', [], {}, 'AAB_MANIFEST'), 'verified');
  } finally {
    childProcess.execFileSync = original;
    syncBuiltinESMExports();
  }
  const scratch = await mkdtemp(join(tmpdir(), 'recap-candidate-cleanup-'));
  try {
    await assert.rejects(withPrivateDirectory(scratch, 'upload-secret', async (directory) => {
      await writeFile(join(directory, 'keystore'), 'synthetic material only');
      throw new Error('deliberate signer failure');
    }), /deliberate signer failure/);
    assert.deepEqual(await readdir(scratch), []);
    await assert.rejects(withPrivateDirectory(scratch, '..', async () => {}), /unknown/);
    assert.throws(() => certificateFingerprint(''), /missing/);
    assert.equal(certificateFingerprint('AA:'.repeat(31) + 'AA'), 'aa'.repeat(32));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
