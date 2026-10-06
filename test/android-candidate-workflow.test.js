import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/android-release-candidate.yml');
const shell = read('scripts/android-release-candidate.sh');
const verifier = read('scripts/android/VerifyBundle.java');
const candidate = workflow.slice(workflow.indexOf('\n  candidate:'));
const rehearsal = workflow.slice(workflow.indexOf('\n  rehearsal:'), workflow.indexOf('\n  candidate:'));
const preflight = workflow.slice(workflow.indexOf('\n  preflight:'), workflow.indexOf('\n  rehearsal:'));

test('candidate is direct manual main-only and missing protection cannot schedule its environment', () => {
  assert.match(workflow, /^on:\s*\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /workflow_call|workflow_run|pull_request_target|^\s+push:|^\s+release:/m);
  assert.match(workflow, /options: \[Rehearsal, Candidate\][\s\S]*default: Rehearsal/);
  assert.match(candidate, /github\.ref == 'refs\/heads\/main'/);
  assert.match(candidate, /github\.workflow_ref == format\('\{0\}\/\.github\/workflows\/android-release-candidate\.yml@refs\/heads\/main'/);
  assert.match(candidate, /needs\.preflight\.outputs\.environment == 'android-release-candidate'/);
  assert.match(candidate, /environment: \$\{\{ needs\.preflight\.outputs\.environment \}\}/);
  assert.doesNotMatch(preflight, /^ {4}environment:|secrets\./m);
  assert.match(rehearsal, /ref: \$\{\{ needs\.preflight\.outputs\.source_sha \}\}\s+path: application/);
  assert.doesNotMatch(rehearsal, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.doesNotMatch(workflow, /contents: write|actions: write|id-token:|secrets: inherit/);
  for (const job of [candidate, rehearsal]) {
    const env = job.match(/^ {4}env:\r?\n([\s\S]*?)^ {4}steps:/m)?.[1];
    assert.ok(env, 'Inspect the actual job-level environment');
    assert.doesNotMatch(env, /\$\{\{\s*runner\./);
    assert.match(env, /RECAP_ANDROID_SOURCE_SUBDIRECTORY: application/);
    assert.match(env, /RECAP_ANDROID_SOURCE_SHA: \$\{\{ needs\.preflight\.outputs\.source_sha \}\}/);
    assert.match(job, /ref: \$\{\{ needs\.preflight\.outputs\.source_sha \}\}\s+path: application/);
  }
  assert.match(candidate, /RECAP_ANDROID_LEDGER_SHA: \$\{\{ needs\.preflight\.outputs\.ledger_sha \}\}/);
  assert.match(preflight, /source_sha: \$\{\{ steps\.check\.outputs\.source_sha \}\}/);
  assert.match(preflight, /ledger_sha: \$\{\{ steps\.check\.outputs\.ledger_sha \}\}/);
  assert.match(workflow, /source_sha:\s+description: Optional checked source pin[\s\S]*?type: string/);
  assert.doesNotMatch(workflow, /required: true/);
  assert.match(workflow, /run-name: Android \$\{\{ inputs\.mode \}\} code /);
  assert.match(shell, /WORK="\$\{RUNNER_TEMP:\?\}\/recap-aab-\$\{GITHUB_RUN_ID:\?\}-\$\{GITHUB_RUN_ATTEMPT:\?\}"/);
  assert.match(shell, /export RECAP_ANDROID_WORK="\$WORK"/);
});

test('upload secrets are confined to the external signer step and never enter rehearsal', () => {
  assert.doesNotMatch(rehearsal, /secrets\.|ANDROID_UPLOAD_|^ {4}environment:/m);
  const signer = candidate.slice(candidate.indexOf('      - name: Sign with'), candidate.indexOf('      - name: Inspect and test'));
  const remainder = candidate.replace(signer, '');
  for (const name of ['KEYSTORE_BASE64', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
    assert.equal([...workflow.matchAll(new RegExp(`secrets\\.ANDROID_UPLOAD_${name}`, 'g'))].length, 1);
    assert.ok(signer.includes(`secrets.ANDROID_UPLOAD_${name}`));
    assert.ok(!remainder.includes(`secrets.ANDROID_UPLOAD_${name}`));
  }
  assert.match(shell, /upload secrets must be scoped only to the signing step/);
  assert.match(shell, /--ks-pass="file:\$WORK\/proof-secret\/password" --key-pass="file:\$WORK\/proof-secret\/password"/);
  assert.match(shell, /--ks-pass env:RECAP_PROOF_PASSWORD --key-pass env:RECAP_PROOF_PASSWORD/);
  assert.doesNotMatch(shell, /pass:\$|set -x|--scan|--debug/);
});

test('same-AAB proof and cleanup precede exact allowlisted retention with no Play upload', () => {
  assert.match(shell, /build-apks --bundle="\$WORK\/recap-page-android\.aab"/);
  assert.match(shell, /--derived-artifacts "\$WORK\/native-input\.json" --result "\$WORK\/native-result\.json"/);
  assert.match(shell, /bash "\$TOOL_ROOT\/scripts\/android-emulator-ci\.sh" --derived-artifacts/);
  const native = read('scripts/android-emulator-ci.sh');
  assert.match(native, /ROOT="\$\{RECAP_ANDROID_SOURCE_ROOT:-/);
  assert.match(native, /cd "\$ROOT"/);
  assert.match(native, /if \[\[ "\$MODE" == derived \]\]; then CHECKER="\$TOOLING\/scripts\/check-android-instrumentation\.mjs"; fi/);
  assert.ok(shell.indexOf('  clean_secrets\n  unset RECAP_PROOF_PASSWORD') < shell.indexOf('  node "$NODE" finish'));
  assert.match(shell, /trap on_exit EXIT/);
  assert.match(shell, /trap 'exit 143' TERM/);
  assert.match(shell, /rm -rf -- "\$WORK\/public"/);
  assert.match(candidate, /if: always\(\)[\s\S]*cleanup/);
  const retained = [...candidate.matchAll(/\/public\/([a-z.-]+)/g)].map((match) => match[1]);
  assert.deepEqual(retained, ['recap-page-android.aab', 'android-artifact.json', 'android-candidate.json', 'version-codes.proposed.json']);
  assert.doesNotMatch(workflow, /\/public\/\*|androidpublisher|fastlane|upload_to_play_store|gradle.*publish/i);
  assert.match(rehearsal, /\/public\/android-rehearsal\.json/);
  const ci = read('.github/workflows/ci.yml').split('\n  android-emulator:')[1];
  for (const surface of [rehearsal, ci]) {
    assert.match(surface, /id: native_cleanup/);
    assert.ok(surface.indexOf('bash scripts/android-release-candidate.sh cleanup')
      < surface.indexOf('--validate-native-failure'));
    assert.match(surface, /if: failure\(\) && .*steps\.native_cleanup\.outputs\.failure_capsule == 'true'/);
    assert.match(surface, /path: \$\{\{ runner\.temp \}\}\/recap-aab-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/android-native-failure\.json/);
    assert.doesNotMatch(surface, /\/public\/android-native-failure|path:.*native-failure.*\*/);
    const outer = Number(surface.match(/^ {4}timeout-minutes: (\d+)/m)[1]);
    const steps = [...surface.matchAll(/^ {8}timeout-minutes: (\d+)/gm)].map((match) => Number(match[1]));
    assert.ok(steps.reduce((sum, value) => sum + value, 0) < outer);
  }
  assert.match(rehearsal, /if: failure\(\) && inputs\.mode == 'Rehearsal'/);
  assert.match(ci, /if: failure\(\) && steps\.native_mode\.outputs\.mode == 'rehearsal'/);
  assert.doesNotMatch(candidate, /native-failure|failure_capsule/);
});

test('actual JDK proof owns signature enforcement while held interfaces fail explicitly', () => {
  const implementation = read('scripts/android-candidate.mjs');
  assert.match(verifier, /new JarFile\(input\.toFile\(\), signed\)/);
  assert.match(verifier, /while \(\(count = stream\.read\(buffer\)\) != -1\)/);
  assert.match(verifier, /require\(signers != null && signers\.length == 1, "UNSIGNED_ENTRY"\)/);
  assert.match(verifier, /hash\(certificate\.getEncoded\(\)\)\.equals\(expected\)/);
  assert.match(implementation, /INTEGRATION_HELD:/);
  assert.match(implementation, /RECAP_ANDROID_DERIVED_INTERFACE=1/);
  assert.match(implementation, /signerSha256/);
  assert.match(implementation, /mutantViolatedRejectionAssertion: true/);
  assert.match(shell, /if \[\[ "\$MODE" == Rehearsal \]\]; then node "\$NODE" jdk-proof; fi/);
});
