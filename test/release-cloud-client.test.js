import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseCloudInput, writeReleaseCloudInput, removeReleaseCloudInput } from '../scripts/release-cloud-client.mjs';
import { verifyCloudClientDigest } from '../scripts/lib/cloud-client.mjs';
import { inspectCloudClient } from '../scripts/inspect-msix.mjs';

const CLIENT = 'test-client.recap-page';
const HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('release inputs fail closed and bind only checked client and registered redirect digests', () => {
  const windows = releaseCloudInput(CLIENT);
  assert.equal(windows.digest, digest(windows.bytes));
  assert.equal(windows.expectation, null);
  const android = releaseCloudInput(CLIENT, HASH);
  assert.equal(android.expectation, `${CLIENT}\n${HASH}\n`);
  assert.equal(android.digest, digest(JSON.stringify({ clientId: CLIENT, redirectHash: HASH })));
  assert.notEqual(android.digest, releaseCloudInput(CLIENT, 'BBBBBBBBBBBBBBBBBBBBBBBBBBB=').digest);
  for (const [client, hash] of [[undefined, HASH], ['', HASH], [CLIENT, ''], [CLIENT, `${HASH}\n`], ['bad\nvalue', HASH]]) {
    assert.throws(() => releaseCloudInput(client, hash));
  }
});

test('packaged cloud configuration must agree with its identity, including dormant absence', async () => {
  const { bytes, digest: cloudClient } = releaseCloudInput(CLIENT);
  assert.equal(verifyCloudClientDigest({ cloudClient }, bytes), cloudClient);
  assert.equal(verifyCloudClientDigest({ cloudClient: null }, null), null);
  for (const [identity, carried] of [
    [{ cloudClient: null }, bytes], [{ cloudClient }, null],
    [{ cloudClient: '0'.repeat(64) }, bytes],
    [{ cloudClient: digest(Buffer.from('{}')) }, Buffer.from('{}')],
  ]) assert.throws(() => verifyCloudClientDigest(identity, carried));
  const layout = await mkdtemp(join(tmpdir(), 'recap-msix-cloud-test-'));
  try {
    const path = join(layout, 'cloud-client.json');
    await writeFile(path, bytes);
    assert.equal(await inspectCloudClient(layout, [path], { cloudClient }), cloudClient);
    assert.equal(await inspectCloudClient(layout, [], { cloudClient: null }), null);
    await assert.rejects(inspectCloudClient(layout, [join(layout, 'CLOUD-CLIENT.JSON')], { cloudClient: null }),
      /filename is not canonical/);
    await assert.rejects(inspectCloudClient(layout, [], { cloudClient }));
  } finally {
    await rm(layout, { recursive: true, force: true });
  }
});

test('release scratch is external, exclusive, owner-bound and removable after invalid input', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'recap-release-cloud-test-'));
  const env = {
    RUNNER_TEMP: parent, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    RECAP_ONEDRIVE_CLIENT_ID: CLIENT, RECAP_ONEDRIVE_PLAY_REDIRECT_HASH: HASH,
  };
  try {
    await assert.rejects(writeReleaseCloudInput(true, { ...env, RECAP_ONEDRIVE_PLAY_REDIRECT_HASH: '' }));
    const result = await writeReleaseCloudInput(true, env);
    assert.equal(await readFile(join(result.directory, 'redirect-hash'), 'utf8'), HASH);
    assert.equal(await readFile(join(result.directory, 'expectation'), 'utf8'), `${CLIENT}\n${HASH}\n`);
    await assert.rejects(writeReleaseCloudInput(true, env), /EEXIST/);
    await assert.rejects(removeReleaseCloudInput({ ...env, GITHUB_RUN_ID: '124' }));
    await removeReleaseCloudInput(env);
    await assert.rejects(readFile(join(result.directory, 'cloud-client.json')), { code: 'ENOENT' });
    await removeReleaseCloudInput(env);
    const failed = spawnSync(process.execPath, ['scripts/release-cloud-client.mjs', 'android'], {
      env: { ...process.env, ...env, RECAP_ONEDRIVE_PLAY_REDIRECT_HASH: 'private-invalid-value' },
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.doesNotMatch(failed.stdout + failed.stderr, /private-invalid-value|test-client/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

const jdk = spawnSync('javac', ['-version'], { encoding: 'utf8' }).status === 0;
test('Android manifest checks admit only the exact configured redirect and reject dormant extras', {
  skip: jdk ? false : 'JDK required; the protected candidate executes the same Java verifier',
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-cloud-manifest-test-'));
  const source = 'scripts/android/VerifyBundle.java';
  const packageName = 'io.github.raymondnassar.recappage';
  const activity = `<activity android:name="${packageName}.prototype.SignInRedirectActivity" android:exported="true" android:excludeFromRecents="true" android:noHistory="true" android:theme="@android:style/Theme.NoDisplay">`
    + '<intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/>'
    + `<category android:name="android.intent.category.BROWSABLE"/><data android:scheme="msauth" android:host="${packageName}" android:path="/${HASH}"/></intent-filter>`
    + `<meta-data android:name="recap.cloud.client" android:value="${CLIENT}"/><meta-data android:name="recap.cloud.redirectHash" android:value="${HASH}"/></activity>`;
  const manifest = (redirect) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}" android:versionCode="3000003" android:versionName="4.3.0">`
    + '<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.INTERNET"/>'
    + '<queries><intent><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https"/></intent></queries>'
    + '<application android:allowBackup="false" android:usesCleartextTraffic="false" android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules" android:networkSecurityConfig="@xml/network_security_config">'
    + `<activity android:name="${packageName}.prototype.MainActivity" android:exported="true"/>${redirect}</application></manifest>`;
  try {
    const compiled = spawnSync('javac', ['--release', '17', '-d', scratch, source], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const expectation = join(scratch, 'expectation');
    const xml = join(scratch, 'manifest.xml');
    await writeFile(expectation, `${CLIENT}\n${HASH}\n`);
    const run = async (text, enabled = true) => {
      await writeFile(xml, text);
      const env = { ...process.env };
      delete env.RECAP_ANDROID_CLOUD_EXPECTATION;
      if (enabled) env.RECAP_ANDROID_CLOUD_EXPECTATION = expectation;
      return spawnSync('java', ['-cp', scratch, 'VerifyBundle', 'manifest', xml, packageName,
        '3000003', '4.3.0', 'app', 'publishing'], { env, encoding: 'utf8' });
    };
    assert.equal((await run(manifest(activity))).status, 0);
    assert.equal((await run(manifest(''), false)).status, 0);
    for (const text of [
      manifest(''), manifest(activity + activity),
      manifest(activity.replace('android:exported="true"', 'android:exported="false"')),
      manifest(activity.replace(`android:path="/${HASH}"`, 'android:path="/wrong"')),
      manifest(activity.replace(`android:host="${packageName}"`, 'android:host="other"')),
      manifest(activity.replace(CLIENT, 'wrong-client')),
      manifest(activity.replace('android:noHistory="true"', 'android:noHistory="false"')),
      manifest(activity.replace('android.intent.category.DEFAULT', 'android.intent.category.LAUNCHER')),
      manifest(activity.replace('</activity>', '<service android:name=".Unexpected"/></activity>')),
    ]) {
      const result = await run(text);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /MANIFEST_CLOUD_REDIRECT/);
      assert.doesNotMatch(result.stdout + result.stderr, /test-client|AAAAAAAA/);
    }
    assert.equal((await run(manifest(activity), false)).status, 1);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
