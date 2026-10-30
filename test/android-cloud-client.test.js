import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidCloudClient } from '../scripts/android-cloud-client.mjs';

const ANDROID = 'packaging/android/app';
const JAVA = `${ANDROID}/src/main/java/io/github/raymondnassar/recappage/prototype`;
const HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const CONFIG = JSON.stringify({
  format: 'recap-page-cloud-client', version: 1, providers: { onedrive: { clientId: 'test-client.recap-page', authority: 'consumers' } },
});

function withConfig(text, run) {
  const directory = mkdtempSync(join(tmpdir(), 'recap-android-cloud-'));
  try {
    const path = join(directory, 'cloud-client.json');
    writeFileSync(path, text);
    return run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('An Android build reads its client id from the configuration and its redirect only from the hashes it is given', () => {
  withConfig(CONFIG, (path) => {
    assert.deepEqual(androidCloudClient(path, [`debug=${HASH}`]),
      { clientId: 'test-client.recap-page', redirectHashes: { debug: HASH } });
    assert.deepEqual(androidCloudClient(path, [`release=${HASH}`, 'debug=Bb+/Bb+/Bb+/Bb+/Bb+/Bb+/Bb+=']).redirectHashes,
      { release: HASH, debug: 'Bb+/Bb+/Bb+/Bb+/Bb+/Bb+/Bb+=' });
    // Gradle reads the answer from standard output, so the script itself is held to the same shape.
    const printed = JSON.parse(execFileSync(process.execPath, ['scripts/android-cloud-client.mjs', path, `release=${HASH}`], { encoding: 'utf8' }));
    assert.deepEqual(printed, { clientId: 'test-client.recap-page', redirectHashes: { release: HASH } });
    const file = join(path, '..', 'redirect-hash');
    writeFileSync(file, HASH);
    assert.deepEqual(androidCloudClient(path, [`release-file=${file}`]), printed);
    assert.throws(() => androidCloudClient(path, [`release-file=${file}`, `release=${HASH}`]), /given once/);
    writeFileSync(file, `${HASH}\n`);
    assert.throws(() => androidCloudClient(path, [`release-file=${file}`]), /not a signature hash/);
  });
});

test('An Android build refuses a configuration or redirect hash it could not sign in with', () => {
  withConfig(CONFIG, (path) => {
    assert.throws(() => androidCloudClient(path, []), /at least one build type/);
    assert.throws(() => androidCloudClient(path, ['debug=Bb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%2FBb%2B%3D']), /not a signature hash/);
    assert.throws(() => androidCloudClient(path, [`debug=${HASH}`, `debug=${HASH}`]), /given once/);
    assert.throws(() => androidCloudClient(path, [`staging=${HASH}`]), /given once/);
    assert.throws(() => androidCloudClient(path, [`debug=${HASH}\n`]), /not a signature hash/);
  });
  withConfig(JSON.stringify({ format: 'recap-page-cloud-client', version: 2 }), (path) => {
    assert.throws(() => androidCloudClient(path, [`debug=${HASH}`]), /not one this version understands/);
  });
  withConfig(`{"format":"recap-page-cloud-client","pad":"${'x'.repeat(4096)}"}`, (path) => {
    assert.throws(() => androidCloudClient(path, [`debug=${HASH}`]), /missing or too large/);
  });
});

// OD-07 asks that a Play-signed install and a test copy built here both sign in. Each is registered at the
// redirect for its own signing key, and the build is handed that key's hash, so nothing on the device may ask
// which key signed it: a release built here and one re-signed by Play then run the same code to the same
// registered redirect. The Play-signed sign-in itself is observed on P05's release candidate.
test('Android sign-in never reads the installed signing certificate', () => {
  const sources = readdirSync(JAVA).filter((name) => name.endsWith('.java'));
  assert.ok(sources.includes('AndroidCloud.java') && sources.includes('CloudAuthorization.java'));
  for (const name of sources) {
    const text = readFileSync(join(JAVA, name), 'utf8');
    for (const pattern of [/GET_SIGNATURES/, /GET_SIGNING_CERTIFICATES/, /signingInfo/i, /\.signatures\b/, /SigningInfo/, /getPackageInfo/]) {
      assert.doesNotMatch(text, pattern, `${name} must not read the signer (${pattern})`);
    }
  }
  const cloud = readFileSync(join(JAVA, 'AndroidCloud.java'), 'utf8');
  assert.match(cloud, /meta\.getString\(REDIRECT_HASH\)/);
  assert.match(cloud, /CloudAuthorization\.redirectUri\(app\.getPackageName\(\), hash\)/);
});

test('A build without a cloud configuration has no sign-in redirect at all', () => {
  const manifest = readFileSync(`${ANDROID}/src/main/AndroidManifest.xml`, 'utf8');
  assert.doesNotMatch(manifest, /SignInRedirectActivity|msauth|recap\.cloud/);
  const overlay = readFileSync(`${ANDROID}/src/cloud/AndroidManifest.xml`, 'utf8');
  assert.match(overlay, /android:name="\.SignInRedirectActivity"/);
  assert.match(overlay, /android:scheme="msauth"/);
  assert.match(overlay, /android:host="\$\{applicationId\}"/);
  assert.match(overlay, /android:path="\/\$\{recapCloudRedirectHash\}"/);
  // Only the overlay names the values, and only the variant handed a hash takes the overlay.
  const gradle = readFileSync(`${ANDROID}/build.gradle`, 'utf8');
  assert.match(gradle, /def cloudHash = cloudClient\?\.redirectHashes\?\.get\(variant\.buildType\)\s+if \(cloudHash != null\) \{\s+variant\.sources\.manifests\.addStaticManifestFile\('src\/cloud\/AndroidManifest\.xml'\)/);
  assert.doesNotMatch(gradle, /sourceSets\.\w+\.manifest/);
});
