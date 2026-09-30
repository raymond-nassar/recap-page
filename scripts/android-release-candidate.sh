#!/usr/bin/env bash
set -euo pipefail
set +x

TOOL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RECAP_ANDROID_TOOLING_ROOT="$TOOL_ROOT"
SOURCE="${RECAP_ANDROID_SOURCE_ROOT:-$TOOL_ROOT}"
WORK="${RECAP_ANDROID_WORK:?Set the owned runner work directory}"
SDK="${ANDROID_HOME:?Android SDK required}"
export JAVA_HOME="${JAVA_HOME_17_X64:?The isolated runner must provide JDK 17}"
export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$SDK/build-tools/35.0.0:$PATH"
NODE="$TOOL_ROOT/scripts/android-candidate.mjs"
HELPER="$TOOL_ROOT/scripts/android/VerifyBundle.java"
MODE="${RECAP_ANDROID_MODE:?Explicit Candidate or Rehearsal required}"
STAGE="${1:?Expected prepare, sign, qualify, rehearsal or cleanup}"
EXPECTED_WORK="${RUNNER_TEMP:?}/recap-aab-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$WORK" == "$EXPECTED_WORK" && "$SOURCE" != "$WORK" ]]
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]

fail() { printf '%s\n' "Android candidate: $1" >&2; exit 1; }
owned() { [[ -f "$WORK/.owner" && ! -L "$WORK" && "$(cat "$WORK/.owner")" == "$GITHUB_RUN_ID:$GITHUB_RUN_ATTEMPT" ]]; }
clean_secrets() {
  owned || return 1
  rm -rf -- "$WORK/upload-secret" "$WORK/proof-secret" "$WORK/fixture-secret" "$WORK/jdk-proof"
  [[ ! -e "$WORK/upload-secret" && ! -e "$WORK/proof-secret" && ! -e "$WORK/jdk-proof" ]]
}
on_exit() {
  local result=$?
  trap - EXIT
  if [[ "$result" != 0 ]] && owned; then
    clean_secrets || result=1
    rm -rf -- "$WORK/public"
  fi
  exit "$result"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [[ "$STAGE" != sign ]]; then
  for name in ANDROID_UPLOAD_KEYSTORE_BASE64 ANDROID_UPLOAD_STORE_PASSWORD ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD; do
    [[ -z "${!name:-}" ]] || fail "upload secrets must be scoped only to the signing step"
  done
fi

gradle() {
  "$SOURCE/packaging/android/gradlew" -p "$SOURCE/packaging/android" --no-daemon --console plain "$@"
}
set_candidate_identity() {
  if [[ "$MODE" == Candidate ]]; then
    export RECAP_ANDROID_VERSION_CODE="${RECAP_ANDROID_CODE:?}"
    export RECAP_ANDROID_LEDGER="$WORK/ledger.json"
  else
    unset RECAP_ANDROID_VERSION_CODE RECAP_ANDROID_LEDGER
  fi
}
prepare() {
  [[ ! -e "$WORK" ]] || fail "work directory already exists; do not reuse an attempted build"
  umask 077
  mkdir -m 700 "$WORK"
  printf '%s' "$GITHUB_RUN_ID:$GITHUB_RUN_ATTEMPT" > "$WORK/.owner"
  node "$NODE" preflight
  node "$NODE" prepare
  set_candidate_identity
  cd "$TOOL_ROOT"
  read -r bundle_version bundle_hash <<< "$(node --input-type=module -e 'import {BUNDLETOOL} from "./scripts/android-candidate.mjs"; console.log(BUNDLETOOL.version+" "+BUNDLETOOL.sha256);')"
  [[ "$bundle_version" == 1.18.3 && "$bundle_hash" =~ ^[0-9a-f]{64}$ ]]
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://github.com/google/bundletool/releases/download/$bundle_version/bundletool-all-$bundle_version.jar" \
    --output "$WORK/bundletool.jar"
  printf '%s  %s\n' "$bundle_hash" "$WORK/bundletool.jar" | sha256sum --check --status
  "$SDK/cmdline-tools/latest/bin/sdkmanager" --channel=0 "platforms;android-36" "build-tools;35.0.0" < /dev/null
  pwsh -NoProfile -File "$SOURCE/packaging/android/bootstrap-wrapper.ps1"
  if [[ "$MODE" == Rehearsal ]]; then node "$NODE" jdk-proof; fi
  gradle -PrecapAndroidTestBuildType=release bundleRelease lintRelease policyTest
  cp "$SOURCE/packaging/android/app/build/outputs/bundle/release/app-release.aab" "$WORK/unsigned.aab"
  cp -R "$SOURCE/packaging/android/app/build/generated/assets/recap" "$WORK/generated"
  node --input-type=module - "$SOURCE" "$WORK" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const [root, work] = process.argv.slice(2);
const wrapper = await readFile(join(root, 'packaging/android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
const build = await readFile(join(root, 'packaging/android/build.gradle'), 'utf8');
const tools = {
  jdk: execFileSync('java', ['--version'], { encoding: 'utf8' }).split(/\r?\n/)[0],
  gradle: wrapper.match(/gradle-([\d.]+)-bin\.zip/)?.[1],
  agp: build.match(/version '([\d.]+)'/)?.[1],
  sdkBuildTools: '35.0.0',
};
await writeFile(join(work, 'toolchain.json'), JSON.stringify(tools));
JS
}

make_proof_key() {
  local file=$1
  keytool -genkeypair -alias proof -keyalg RSA -keysize 2048 -validity 2 \
    -dname 'CN=Recap disposable local proof' -storetype PKCS12 -keystore "$file" \
    -storepass:env RECAP_PROOF_PASSWORD -keypass:env RECAP_PROOF_PASSWORD > /dev/null 2>&1 \
    || fail "disposable proof key creation failed"
}
derive_and_qualify() {
  owned || fail "unowned candidate workspace"
  set_candidate_identity
  umask 077
  mkdir -m 700 "$WORK/proof-secret"
  export RECAP_PROOF_PASSWORD
  RECAP_PROOF_PASSWORD="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
  export RECAP_PROOF_ALIAS=proof
  printf '%s' "$RECAP_PROOF_PASSWORD" > "$WORK/proof-secret/password"
  if [[ "$MODE" == Rehearsal ]]; then
    make_proof_key "$WORK/proof-secret/bundle.p12"
    java "$HELPER" certificate "$WORK/proof-secret/bundle.p12" RECAP_PROOF_ALIAS RECAP_PROOF_PASSWORD > "$WORK/signer.json"
    jarsigner -keystore "$WORK/proof-secret/bundle.p12" -storepass:env RECAP_PROOF_PASSWORD \
      -keypass:env RECAP_PROOF_PASSWORD -sigfile RECAP -digestalg SHA-256 \
      -signedjar "$WORK/recap-page-android.aab" "$WORK/unsigned.aab" proof > /dev/null 2>&1 \
      || fail "disposable rehearsal bundle signing failed"
  fi
  make_proof_key "$WORK/proof-secret/install.p12"
  java "$HELPER" certificate "$WORK/proof-secret/install.p12" RECAP_PROOF_ALIAS RECAP_PROOF_PASSWORD > "$WORK/proof-signer.json"
  printf '%s\n' '{"sdkVersion":36,"screenDensity":420,"supportedAbis":["x86_64"],"supportedLocales":["en-US"]}' > "$WORK/device-spec.json"
  java -jar "$WORK/bundletool.jar" build-apks --bundle="$WORK/recap-page-android.aab" \
    --output="$WORK/derived.apks" --device-spec="$WORK/device-spec.json" \
    --ks="$WORK/proof-secret/install.p12" --ks-key-alias=proof \
    --ks-pass="file:$WORK/proof-secret/password" --key-pass="file:$WORK/proof-secret/password" \
    > /dev/null 2>&1 || fail "same-bundle APK derivation failed"
  gradle -PrecapAndroidTestBuildType=release assembleReleaseAndroidTest
  mapfile -t harnesses < <(find "$SOURCE/packaging/android/app/build/outputs/apk/androidTest/release" -maxdepth 1 -type f -name '*.apk')
  [[ "${#harnesses[@]}" == 1 ]] || fail "expected exactly one release instrumentation APK"
  zipalign -f -P 16 4 "${harnesses[0]}" "$WORK/release-test-aligned.apk"
  apksigner sign --ks "$WORK/proof-secret/install.p12" --ks-key-alias proof \
    --ks-pass env:RECAP_PROOF_PASSWORD --key-pass env:RECAP_PROOF_PASSWORD \
    --out "$WORK/release-test.apk" "$WORK/release-test-aligned.apk" > /dev/null 2>&1 \
    || fail "matching disposable instrumentation signing failed"
  env -u RECAP_ANDROID_VERSION_CODE -u RECAP_ANDROID_LEDGER \
    "$SOURCE/packaging/android/gradlew" -p "$SOURCE/packaging/android" --no-daemon --console plain \
    -PrecapAndroidTestBuildType=debug assembleDebug assembleDebugAndroidTest
  cp "$SOURCE/packaging/android/app/build/outputs/apk/debug/app-debug.apk" "$WORK/prototype.apk"
  cp "$SOURCE/packaging/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" "$WORK/prototype-test.apk"
  node "$NODE" inspect
  clean_secrets
  unset RECAP_PROOF_PASSWORD RECAP_PROOF_ALIAS
  bash "$SOURCE/scripts/android-emulator-ci.sh" --derived-artifacts "$WORK/native-input.json" --result "$WORK/native-result.json"
  node "$NODE" finish
}

case "$STAGE" in
  prepare)
    [[ "$MODE" == Candidate ]] || fail "prepare is the protected Candidate stage"
    prepare
    ;;
  sign)
    [[ "$MODE" == Candidate ]] && owned || fail "sign needs the prepared protected Candidate"
    node "$NODE" sign
    ;;
  qualify)
    [[ "$MODE" == Candidate ]] || fail "qualify is the protected Candidate stage"
    derive_and_qualify
    ;;
  rehearsal)
    [[ "$MODE" == Rehearsal ]] || fail "CI entry cannot request Candidate"
    prepare
    derive_and_qualify
    ;;
  cleanup)
    if [[ -d "$WORK" ]]; then clean_secrets; fi
    ;;
  *) fail "unknown producer stage" ;;
esac
