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
  const consent = `<activity android:name="${packageName}.prototype.GoogleConsentActivity" android:exported="false" android:excludeFromRecents="true" android:theme="@android:style/Theme.Translucent.NoTitleBar"/>`;
  const sdk = '<activity android:name="com.google.android.gms.auth.api.signin.internal.SignInHubActivity" android:exported="false" android:excludeFromRecents="true" android:theme="@android:style/Theme.Translucent.NoTitleBar"/>'
    + '<service android:name="com.google.android.gms.auth.api.signin.RevocationBoundService" android:permission="com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION" android:exported="true" android:visibleToInstantApps="true"/>'
    + '<activity android:name="com.google.android.gms.common.api.GoogleApiActivity" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar"/>'
    + '<meta-data android:name="com.google.android.gms.version" android:value="@integer/google_play_services_version"/>';
  const withSdk = (text) => text.replace('<application ', '<application android:appComponentFactory="androidx.core.app.CoreComponentFactory" ')
    .replace('</application>', `${sdk}</application>`);
  const sdkRedirect = activity.replace('</activity>', '<meta-data android:name="recap.cloud.google" android:value="false"/></activity>');
  try {
    const compiled = spawnSync('javac', ['--release', '17', '-d', scratch, source], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const expectation = join(scratch, 'expectation');
    const xml = join(scratch, 'manifest.xml');
    const resources = join(scratch, 'resources.txt');
    const resourceTable = 'resource 0x7f0d0000 xml/backup_rules\n'
      + 'resource 0x7f0d0001 xml/data_extraction_rules\n'
      + 'resource 0x7f0d0002 xml/network_security_config\n'
      + 'resource 0x7f0d0003 xml/splits0\n  () (file) res/xml/splits0.xml type=XML\n'
      + 'resource 0x7f080000 integer/google_play_services_version\n  () 12451000\n';
    await writeFile(expectation, `${CLIENT}\n${HASH}\n`);
    const run = async (text, enabled = true, profile = 'publishing', table = null) => {
      await writeFile(xml, text);
      const env = { ...process.env };
      delete env.RECAP_ANDROID_CLOUD_EXPECTATION;
      if (enabled) env.RECAP_ANDROID_CLOUD_EXPECTATION = expectation;
      if (table !== null) await writeFile(resources, table);
      return spawnSync('java', ['-cp', scratch, 'VerifyBundle', 'manifest', xml, packageName,
        '3000003', '4.3.0', 'app', profile, ...(table === null ? [] : [resources])], { env, encoding: 'utf8' });
    };
    assert.equal((await run(manifest(activity))).status, 0);
    const legacy = await run(manifest(''), false);
    assert.equal(legacy.status, 0);
    assert.deepEqual(JSON.parse(legacy.stdout), { verified: true, playServices: false });
    const dormant = withSdk(manifest(''));
    const configured = withSdk(manifest(sdkRedirect + consent));
    const approved = await run(dormant, false);
    assert.equal(approved.status, 0, 'The exact dormant SDK manifest is approved');
    assert.deepEqual(JSON.parse(approved.stdout), { verified: true, playServices: true });
    assert.equal((await run(configured)).status, 0, 'The configured SDK manifest stays switched off');
    const derived = dormant.replace('android:minSdkVersion="26"', 'android:minSdkVersion="32"')
      .replace('</application>', '<meta-data android:name="com.android.vending.splits.required" android:value="true"/>'
        + '<meta-data android:name="com.android.vending.splits" android:resource="@xml/splits0"/></application>');
    assert.equal((await run(derived, false, 'bundletool-1.18.3-api36')).status, 0);
    for (const text of [
      derived.replace('<meta-data android:name="com.android.vending.splits.required" android:value="true"/>', ''),
      derived.replace('com.android.vending.splits.required" android:value="true"',
        'com.android.vending.splits.required" android:value="false"'),
      derived.replace('com.android.vending.splits.required" android:value="true"',
        'com.android.vending.splits.required" android:value="true" android:exported="true"'),
      derived.replace('<meta-data android:name="com.android.vending.splits.required" android:value="true"/>',
        '<meta-data android:name="com.android.vending.splits.required" android:value="true"/>'
          + '<meta-data android:name="com.android.vending.splits.required" android:value="true"/>'),
    ]) assert.equal((await run(text, false, 'bundletool-1.18.3-api36')).status, 1);
    const numeric = derived.replace('@integer/google_play_services_version', '@ref/0x7f080000');
    assert.equal((await run(numeric, false, 'bundletool-1.18.3-api36', resourceTable)).status, 0);
    for (const [text, table] of [
      [numeric.replace('@ref/0x7f080000', '@ref/0x7f080001'), resourceTable],
      [numeric, resourceTable.replace('  () 12451000', '  () 12451001')],
      [numeric, resourceTable.replace('  () 12451000', '  () 12451000\n  (fr) 12451001')],
      [numeric, resourceTable + 'resource 0x7f080001 integer/google_play_services_version\n  () 12451000\n'],
    ]) assert.equal((await run(text, false, 'bundletool-1.18.3-api36', table)).status, 1);
    for (const text of [
      dormant.replace('</application>', '<receiver android:name=".Unexpected" android:exported="true"/></application>'),
      dormant.replace('androidx.core.app.CoreComponentFactory', 'foreign.ComponentFactory'),
      dormant.replace('signin.internal.SignInHubActivity" android:exported="false"', 'signin.internal.SignInHubActivity" android:exported="true"'),
      dormant.replace('signin.permission.REVOCATION_NOTIFICATION', 'foreign.PERMISSION'),
      dormant.replace('android:visibleToInstantApps="true"', 'android:visibleToInstantApps="false"'),
      dormant.replace('@integer/google_play_services_version', '@integer/unapproved'),
      dormant.replace(sdk, sdk + sdk),
      dormant.replace(sdk, ''),
      configured.replace('name="recap.cloud.google" android:value="false"', 'name="recap.cloud.google" android:value="true"'),
      configured.replace('GoogleConsentActivity" android:exported="false"', 'GoogleConsentActivity" android:exported="true"'),
    ]) assert.equal((await run(text, text.includes('SignInRedirectActivity'))).status, 1);
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
