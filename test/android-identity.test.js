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
  assert.doesNotMatch(build, /\b(?:productFlavors|flavorDimensions|sourceSets|testApplicationId|testNamespace)\b/);
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
  assert.match(activity, /^public final class MainActivity extends Activity \{/m);
  assert.deepEqual([...mainStrings.matchAll(/<string name="app_name">([^<]+)<\/string>/g)]
    .map((match) => match[1]), ['Recap Page']);
  assert.deepEqual([...debugStrings.matchAll(/<string name="([^"]+)">([^<]+)<\/string>/g)]
    .map((match) => [match[1], match[2]]), [['app_name', 'Recap Page prototype']]);
});

test('native fixture identities stay prototype bound', () => {
  const manifest = read(`${app}src/androidTest/AndroidManifest.xml`);
  const provider = read(`${app}src/androidTest/${javaPackage}FixtureDocumentProvider.java`);
  const nativeTest = read(`${app}src/androidTest/${javaPackage}NativeIntegrationTest.java`);
  const emulator = read('../scripts/android-emulator-ci.sh');
  assert.equal(manifest.match(/<queries>\s*<package android:name="([^"]+)"/)?.[1], prototypeId);
  assert.equal(manifest.match(/android:authorities="([^"]+)"/)?.[1], `${prototypeId}.test.documents`);
  assert.deepEqual([...manifest.matchAll(/<(?:activity|provider)\b[^>]*android:name="([^"]+)"/g)]
    .map((match) => match[1]), [
    `${prototypeId}.NativeIntegrationTest$BrowserFixture`,
    `${prototypeId}.NativeIntegrationTest$DomainFixture`,
    `${prototypeId}.FixtureDocumentProvider`,
  ]);
  for (const source of [provider, nativeTest]) {
    assert.equal(source.match(/^package ([\w.]+);/m)?.[1], prototypeId);
  }
  assert.equal(provider.match(/AUTHORITY = "([^"]+)"/)?.[1], `${prototypeId}.test.documents`);
  assert.equal(provider.match(/getPackageUid\(\s*"([^"]+)", 0\)/)?.[1], prototypeId);
  assert.equal(emulator.match(/^APP=(.+)$/m)?.[1], prototypeId);
  assert.ok(emulator.includes('CLASS="$APP.NativeIntegrationTest"'));
  assert.ok(emulator.includes('RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"'));
});

test('release source retains unsigned non-debug defaults', () => {
  const build = buildSource();
  const types = build.match(/^ {4}buildTypes \{\r?\n([\s\S]*?)^ {4}\}/m)?.[1];
  assert.ok(types, 'Inspect the buildTypes declarations');
  const debugBlock = /^ {8}debug \{\r?\n[^{}]*^ {8}\}/m;
  assert.match(types, debugBlock);
  assert.equal(types.replace(debugBlock, '').trim(), '',
    'Only debug is customized; release must retain unsigned non-debug defaults');
  assert.doesNotMatch(build, /\b(?:signingConfig|signingConfigs|initWith)\b/);
  assert.deepEqual([...build.matchAll(/^ +debuggable (.+)$/gm)].map((match) => match[1]), ['true']);
});
