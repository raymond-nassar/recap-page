import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const officialId = 'io.github.raymondnassar.recappage';
const prototypeId = `${officialId}.prototype`;
const app = '../packaging/android/app/';
const javaPackage = 'java/io/github/raymondnassar/recappage/prototype/';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const buildSource = () => read(`${app}build.gradle`)
  .replace(/\/\*[\s\S]*?\*\/|^ *\/\/.*$/gm, '');

// These source contracts do not run AGP or prove merged resources, installation or signing.
test('source identities preserve the prototype debug package', () => {
  const build = buildSource();
  const defaults = build.match(/^ {4}defaultConfig \{\r?\n([\s\S]*?)^ {4}\}/m)?.[1];
  const debug = build.match(/^ {8}debug \{\r?\n([\s\S]*?)^ {8}\}/m)?.[1];
  assert.ok(defaults, 'Read identity from defaultConfig, not an unrelated declaration');
  assert.ok(debug, 'The existing debug build type must remain explicit');
  assert.equal(defaults.match(/^ +applicationId '([^']+)'$/m)?.[1], officialId);
  assert.equal(build.match(/^ +namespace '([^']+)'$/m)?.[1], prototypeId);
  assert.equal(debug.match(/^ +applicationIdSuffix '([^']+)'$/m)?.[1], '.prototype');
  assert.match(debug, /^ +debuggable true$/m);
  assert.equal([...build.matchAll(/\bapplicationId\b/g)].length, 1);
  assert.equal([...build.matchAll(/\bapplicationIdSuffix\b/g)].length, 1);
  assert.equal([...build.matchAll(/\bnamespace\b/g)].length, 1);
  assert.doesNotMatch(build, /\b(?:productFlavors|flavorDimensions|sourceSets|testNamespace)\b/);
  assert.match(build, /providers\.gradleProperty\('recapAndroidTestBuildType'\)\.getOrElse\('debug'\)/);
  assert.match(build, /nativeTestBuildType in \['debug', 'release'\]/);
  assert.match(build, /testBuildType nativeTestBuildType/);
  assert.match(defaults, /testApplicationId "\$\{nativeTestTarget\}\.test"/);
});

test('source labels and Activity follow the unchanged namespace', () => {
  const manifest = read(`${app}src/main/AndroidManifest.xml`);
  const mainStrings = read(`${app}src/main/res/values/strings.xml`);
  const debugStrings = read(`${app}src/debug/res/values/strings.xml`);
  const activity = read(`${app}src/main/${javaPackage}MainActivity.java`);
  const namespace = buildSource().match(/^ +namespace '([^']+)'$/m)?.[1];
  const activityName = manifest.match(/<activity\b[^>]*android:name="([^"]+)"/)?.[1];
  assert.match(manifest, /<application\b[^>]*android:label="@string\/app_name"/);
  assert.equal(activityName, '.MainActivity');
  assert.equal(`${namespace}${activityName}`, `${prototypeId}.MainActivity`);
  assert.equal(activity.match(/^package ([\w.]+);/m)?.[1], prototypeId);
  assert.match(activity, /^public class MainActivity extends Activity \{/m);
  assert.match(activity, /protected CloudPort\.Factory cloudFactory\(\) throws IOException \{ return null; \}/);
  assert.match(activity, /new CloudPort\(cloudFactory\(\),/);
  assert.doesNotMatch(activity, /\b(?:CloudSdkAuthFactory|CloudGoogleAuth|CloudMicrosoftAuth)\b/);
  const debugManifest = read(`${app}src/debug/AndroidManifest.xml`);
  assert.match(debugManifest, /<queries>\s*<package android:name="\$\{applicationId\}\.test"\s*\/>\s*<\/queries>/);
  assert.doesNotMatch(debugManifest, /QUERY_ALL_PACKAGES/);
  for (const name of ['CloudSdkQualificationActivity', 'CloudAuthActivity', 'CloudSdkRedirectActivity']) {
    assert.match(debugManifest, new RegExp(`<activity\\s+android:name="\\.${name}"\\s+android:exported="false"\\s+android:process=":cloudCandidate"`));
  }
  const qualification = read(`${app}src/debug/${javaPackage}CloudSdkQualificationActivity.java`);
  assert.match(qualification, /extends MainActivity/);
  assert.match(qualification, /Build\.VERSION\.SDK_INT < 28 \|\| used/);
  assert.match(qualification, /WebView\.setDataDirectorySuffix\("cloud-sdk-" \+ session\)/);
  assert.match(qualification, /Files\.createDirectory\(fresh\)/);
  assert.match(qualification, /getApplicationContext\(\) \{ return this; \}/);
  assert.match(qualification, /getNoBackupFilesDir\(\) \{ return fresh\.toFile\(\); \}/);
  assert.match(qualification, /CloudAndroidConfiguration\.configured\(isolated, authentication\)/);
  assert.doesNotMatch(qualification, /\.(?:clear|delete|readAllBytes)\(/);
  assert.match(qualification, /packageDigest\(getPackageCodePath\(\)\)\.equals\(input\.get\("appSha256"\)\)/);
  assert.match(qualification, /packageDigest\(tests\.getPackageCodePath\(\)\)\.equals\(input\.get\("testSha256"\)\)/);
  assert.match(qualification, /CloudSdkQualificationScope\.open\(getNoBackupFilesDir\(\)\.getCanonicalFile\(\)\.toPath\(\), input, fixture,/);
  assert.match(qualification, /serviceScope\.authentication\(authentication\)/);
  assert.match(qualification, /serviceScope\.codec\(codec\), serviceScope::connection/);
  const factory = read(`${app}src/debug/${javaPackage}CloudSdkAuthFactory.java`);
  const microsoft = read(`${app}src/debug/${javaPackage}CloudMicrosoftAuth.java`);
  assert.match(factory, /CloudMicrosoftAuth\.access\(cached\.material, cached\.id\)/);
  assert.match(factory, /CloudMicrosoftAuth\.reusable\(cached\.material, cached\.id\)/);
  const access = microsoft.match(/^ {4}static Identity access\([\s\S]*?^ {4}\}/m)?.[0];
  assert.ok(access);
  assert.match(access, /Identity reusable = reusable\(serialized, expectedId\);/);
  assert.match(access, /return reusable == null \? reopen\(cached\(serialized, expectedId\)\.state, expectedId\) : reusable;/);
  const reusable = microsoft.match(/^ {4}static Identity reusable\([\s\S]*?^ {4}\}/m)?.[0];
  assert.ok(reusable);
  assert.match(reusable, /Identity identity = cached\(serialized, expectedId\);[\s\S]*CloudNativeAuth\.usableAccessToken/);
  assert.match(reusable, /state\.getAccessTokenExpirationTime\(\),\s*System\.currentTimeMillis\(\), state\.getNeedsTokenRefresh\(\)/);
  assert.match(reusable, /return null;/);
  assert.deepEqual([...mainStrings.matchAll(/<string name="app_name">([^<]+)<\/string>/g)]
    .map((match) => match[1]), ['Recap Page']);
  assert.deepEqual([...debugStrings.matchAll(/<string name="([^"]+)">([^<]+)<\/string>/g)]
    .map((match) => [match[1], match[2]]), [['app_name', 'Recap Page prototype']]);
});

test('native connection presentation keeps official provider controls and platform layout boundaries', () => {
  const activity = read(`${app}src/debug/${javaPackage}CloudAuthActivity.java`);
  const strings = read(`${app}src/debug/res/values/cloud_native_auth.xml`);
  assert.match(activity, /new SignInButton\(this\)/);
  assert.match(activity, /SignInButton\.SIZE_WIDE/);
  assert.match(activity, /SignInButton\.COLOR_AUTO/);
  assert.match(activity, /connect\.setOnClickListener\(\(view\) -> authorize\(\)\)/);
  assert.match(activity, /connect\.setEnabled\(false\)/);
  assert.match(activity, /Identity\.getAuthorizationClient\(this\)/);
  assert.match(activity, /new ScrollView\(this\)/);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\) \| WindowInsets\.Type\.displayCutout\(\)/);
  assert.match(activity, /setMinimumHeight\(dp\(48\)\)/);
  assert.match(activity, /setAccessibilityLiveRegion\(View\.ACCESSIBILITY_LIVE_REGION_POLITE\)/);
  assert.match(strings, /name="cloud_native_auth_title_google">Connect Google Drive</);
  assert.match(strings, /name="cloud_native_auth_title_microsoft">Connect OneDrive</);
  assert.doesNotMatch(activity, /\b(?:EditText|WebView|GoogleSignInOptions)\b/);
  const qualification = read(`${app}src/debug/${javaPackage}CloudSdkQualificationActivity.java`);
  const manifest = read(`${app}src/debug/AndroidManifest.xml`);
  const nativeTest = read(`${app}src/androidTest/${javaPackage}CloudAuthIntegrationTest.java`);
  assert.match(qualification, /presentationStarted\.compareAndSet\(false, true\)/);
  assert.match(qualification, /nonce\.equals\(owner\.presentationNonce\)/);
  assert.match(qualification, /StandardCopyOption\.ATOMIC_MOVE/);
  assert.match(manifest, /<receiver\s+android:name="\.CloudSdkQualificationActivity\$ClosePresentation"\s+android:exported="false"\s+android:process=":cloudCandidate"/);
  assert.match(nativeTest, /String provider = args\.getString\("recapCloudPresentationProvider"\)/);
  assert.match(nativeTest, /cancel\.click\(\)/);
  assert.doesNotMatch(nativeTest, /proceed\.click\(\)/);
});

test('native fixture identities follow the selected test target while default debug stays prototype', () => {
  const manifest = read(`${app}src/androidTest/AndroidManifest.xml`);
  const provider = read(`${app}src/androidTest/${javaPackage}FixtureDocumentProvider.java`);
  const nativeTest = read(`${app}src/androidTest/${javaPackage}NativeIntegrationTest.java`);
  const emulator = read('../scripts/android-emulator-ci.sh');
  assert.equal(manifest.match(/<queries>\s*<package android:name="([^"]+)"/)?.[1], '${recapTestTargetPackage}');
  assert.equal(manifest.match(/android:authorities="([^"]+)"/)?.[1], '${recapTestProviderAuthority}');
  assert.match(manifest, /android:name="recap\.test\.target" android:value="\$\{recapTestTargetPackage\}"/);
  assert.deepEqual([...manifest.matchAll(/<(?:activity|provider)\b[^>]*android:name="([^"]+)"/g)]
    .map((match) => match[1]), [
    `${prototypeId}.NativeIntegrationTest$BrowserFixture`,
    `${prototypeId}.NativeIntegrationTest$DomainFixture`,
    `${prototypeId}.FixtureDocumentProvider`,
  ]);
  for (const source of [provider, nativeTest]) {
    assert.equal(source.match(/^package ([\w.]+);/m)?.[1], prototypeId);
  }
  assert.match(provider, /getPackageUid\(\s*targetPackage\(getContext\(\)\), 0\)/);
  assert.match(provider, /testContext\.getPackageName\(\)\.equals\(target \+ "\.test"\)/);
  assert.ok(provider.includes(`"${officialId}".equals(target)`));
  assert.ok(provider.includes(`"${prototypeId}".equals(target)`));
  assert.match(provider, /targetPackage\(testContext\) \+ "\.test\.documents\/document\/backup\.json"/);
  assert.match(provider, /caller != targetUid && caller != Process\.myUid\(\)/);
  assert.doesNotMatch(nativeTest, /FixtureDocumentProvider\.(?:SAVED|REFUSED)/);
  assert.match(nativeTest, /FixtureDocumentProvider\.saved\(instrumentation\.getContext\(\)\)/);
  assert.equal(emulator.match(/^APP=(.+)$/m)?.[1], prototypeId);
  assert.ok(emulator.includes('CLASS="$APP.NativeIntegrationTest"'));
  assert.ok(emulator.includes('RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"'));
});

test('release source stays explicitly unsigned, non-debug and unshrunk', () => {
  const build = buildSource();
  const types = build.match(/^ {4}buildTypes \{\r?\n([\s\S]*?)^ {4}\}/m)?.[1];
  assert.ok(types, 'Inspect the buildTypes declarations');
  const debugBlock = /^ {8}debug \{\r?\n[^{}]*^ {8}\}/m;
  assert.match(types, debugBlock);
  const release = types.match(/^ {8}release \{\r?\n([^{}]*)^ {8}\}/m)?.[1];
  assert.ok(release, 'The release type has explicit non-debug, unshrunk settings');
  assert.match(release, /^ +debuggable false$/m);
  assert.match(release, /^ +minifyEnabled false$/m);
  assert.match(release, /^ +shrinkResources false$/m);
  assert.doesNotMatch(build, /\b(?:signingConfig|signingConfigs|initWith)\b/);
  assert.deepEqual([...build.matchAll(/^ +debuggable (.+)$/gm)].map((match) => match[1]), ['true', 'false']);
});
