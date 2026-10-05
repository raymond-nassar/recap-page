#!/usr/bin/env bash
set -euo pipefail

ROOT="${RECAP_ANDROID_SOURCE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
RECAP_ANDROID_DERIVED_INTERFACE=1
MODE=debug
if [[ "$#" != 0 ]]; then
  [[ "$#" == 4 && "$1" == --derived-artifacts && "$3" == --result ]] || {
    printf '%s\n' 'Expected no arguments or --derived-artifacts <control> --result <report>' >&2
    exit 1
  }
  MODE=derived
  CONTROL="$(realpath -e "$2")"
  RESULT="$(realpath -m "$4")"
  WORK="${RECAP_ANDROID_WORK:?Derived proof requires the producer workspace}"
  TOOLING="${RECAP_ANDROID_TOOLING_ROOT:?Derived proof requires the pinned producer tooling}"
  CANDIDATE="$TOOLING/scripts/android-candidate.mjs"
  node "$CANDIDATE" native-input "$CONTROL" "$RESULT" > "$WORK/native-paths.txt"
  mapfile -t paths < "$WORK/native-paths.txt"
  [[ "${#paths[@]}" == 6 ]]
  APKS="${paths[0]}"
  BUNDLETOOL="${paths[1]}"
  OFFICIAL_TEST="${paths[2]}"
  PROTOTYPE_APK="${paths[3]}"
  PROTOTYPE_TEST="${paths[4]}"
  IFS=',' read -r -a NATIVE_METHODS <<< "${paths[5]}"
  [[ "${#NATIVE_METHODS[@]}" == 6 ]]
fi
EVIDENCE="$ROOT/packaging/android/app/build/native-evidence"
if [[ "$MODE" == derived ]]; then EVIDENCE="$WORK/native-evidence"; fi
mkdir -p "$EVIDENCE"
SDK="${ANDROID_HOME:?ANDROID_HOME must name the Linux Android SDK}"
export JAVA_HOME="${JAVA_HOME_17_X64:?The runner must provide JDK 17}"
export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$SDK/emulator:$PATH"
export ANDROID_AVD_HOME="${RUNNER_TEMP:?Run this script in the isolated CI runner}/recap-avd"
export ANDROID_SERIAL=emulator-5554
mkdir -p "$ANDROID_AVD_HOME"
APP=io.github.raymondnassar.recappage.prototype
CLASS="$APP.NativeIntegrationTest"
RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
APK="$ROOT/packaging/android/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$ROOT/packaging/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
ACTIVITY_SOURCE="$ROOT/packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java"
SOURCE_BACKUP=""
EMULATOR_PID=""
EMULATOR_DOWNLOAD=""
NATIVE_FAILURE_ACTIVE=0
CHECKER="$ROOT/scripts/check-android-instrumentation.mjs"
if [[ "$MODE" == derived ]]; then CHECKER="$TOOLING/scripts/check-android-instrumentation.mjs"; fi
INSTRUMENT_EXIT=0
TEE_EXIT=0

cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "${EMULATOR_DOWNLOAD:-}" ]]; then rm -rf -- "$EMULATOR_DOWNLOAD"; fi
  if [[ -n "$SOURCE_BACKUP" ]]; then
    cp "$SOURCE_BACKUP" "$ACTIVITY_SOURCE" || result=1
    rm -f "$SOURCE_BACKUP"
  fi
  if [[ -n "$EMULATOR_PID" ]]; then
    if [[ "$MODE" == debug ]]; then
      adb -s "$ANDROID_SERIAL" logcat -d -v threadtime 'AndroidRuntime:V' 'chromium:W' 'TestRunner:V' '*:S' > "$EVIDENCE/logcat.txt" 2>&1 || true
      adb -s "$ANDROID_SERIAL" pull "/sdcard/Android/data/$APP/files/native-test-evidence" "$EVIDENCE/screenshots" > "$EVIDENCE/pull.txt" 2>&1 || true
    fi
    if [[ "$MODE" == derived && "$NATIVE_FAILURE_ACTIVE" == 1 ]]; then
      local shutdown_exit=0 term_sent=0 kill_sent=0
      if timeout --kill-after=1 2 adb -s "$ANDROID_SERIAL" emu kill > "$EVIDENCE/shutdown.txt" 2>&1; then
        shutdown_exit=0
      else
        shutdown_exit=$?
      fi
      if kill "$EMULATOR_PID" 2>/dev/null; then term_sent=1; fi
      if kill -0 "$EMULATOR_PID" 2>/dev/null; then
        if kill -KILL "$EMULATOR_PID" 2>/dev/null; then kill_sent=1; fi
      fi
      if [[ -f "$WORK/android-native-failure.json" ]]; then
        if RECAP_NATIVE_EMULATOR_PID="$EMULATOR_PID" timeout --kill-after=1 3 node "$CHECKER" --finalize-native-failure \
          "$shutdown_exit" "$term_sent" "$kill_sent"; then
          :
        else
          printf 'Native failure shutdown receipt could not be finalized (exit %s); primary exit remains %s.\n' "$?" "$result" >&2
        fi
      fi
    else
      adb -s "$ANDROID_SERIAL" emu kill > "$EVIDENCE/shutdown.txt" 2>&1 || true
      kill "$EMULATOR_PID" 2>/dev/null || true
      wait "$EMULATOR_PID" 2>/dev/null || true
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

test "$(uname -m)" = x86_64
test -r /dev/kvm
test -w /dev/kvm
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
"$SDKMANAGER" --channel=0 "platforms;android-36" "build-tools;35.0.0" "system-images;android-36;google_apis;x86_64" < /dev/null
# SDK Manager's stable emulator advances independently of the tested revision.
EMULATOR_DOWNLOAD="$(mktemp -d "$RUNNER_TEMP/recap-emulator.XXXXXX")"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://dl.google.com/android/repository/emulator-linux_x64-15917651.zip \
  --output "$EMULATOR_DOWNLOAD/emulator.zip"
printf '%s  %s\n' 95771e0ae431897b2a4bd2d97fa095f29a8b0624a7b216baf529f9306161c266 \
  "$EMULATOR_DOWNLOAD/emulator.zip" | sha256sum --check --status || {
  printf '%s\n' 'Android Emulator archive checksum verification failed' >&2
  exit 1
}
unzip -q "$EMULATOR_DOWNLOAD/emulator.zip" -d "$EMULATOR_DOWNLOAD"
IMAGE="$SDK/system-images/android-36/google_apis/x86_64"
grep -Eq '^Pkg.Revision *= *37\.1\.11 *$' "$EMULATOR_DOWNLOAD/emulator/source.properties" || {
  printf '%s\n' 'Expected Android Emulator revision 37.1.11; downloaded metadata:' >&2
  cat "$EMULATOR_DOWNLOAD/emulator/source.properties" >&2
  exit 1
}
grep -Eq '^Pkg.Revision *= *7 *$' "$IMAGE/source.properties" || {
  printf '%s\n' 'Expected API 36 Google APIs x86_64 image revision 7; installed metadata:' >&2
  cat "$IMAGE/source.properties" >&2
  exit 1
}
# The archive has no package.xml; avdmanager requires a registered emulator package.
cat > "$EMULATOR_DOWNLOAD/emulator/package.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<repo:repository xmlns:repo="http://schemas.android.com/repository/android/common/02"
    xmlns:generic="http://schemas.android.com/repository/android/generic/02"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <localPackage path="emulator">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>37</major><minor>1</minor><micro>11</micro></revision>
    <display-name>Android Emulator</display-name>
  </localPackage>
</repo:repository>
XML
rm -rf -- "$SDK/emulator"
mv "$EMULATOR_DOWNLOAD/emulator" "$SDK/emulator"
rm -rf -- "$EMULATOR_DOWNLOAD"
EMULATOR_DOWNLOAD=""
{
  git rev-parse HEAD
  java -version 2>&1
  "$SDK/emulator/emulator" -version
  cat "$IMAGE/source.properties"
} > "$EVIDENCE/toolchain.txt"
pwsh -NoProfile -File packaging/android/bootstrap-wrapper.ps1
printf 'no\n' | "$AVDMANAGER" create avd --force --name recap-native --package "system-images;android-36;google_apis;x86_64" --device pixel_2
CONFIG="$ANDROID_AVD_HOME/recap-native.avd/config.ini"
sed -i '/^hw.lcd.width=/d; /^hw.lcd.height=/d; /^hw.lcd.density=/d; /^hw.keyboard=/d' "$CONFIG"
printf '\nhw.lcd.width=1080\nhw.lcd.height=2400\nhw.lcd.density=420\nhw.keyboard=no\n' >> "$CONFIG"
cp "$CONFIG" "$EVIDENCE/avd-config.ini"
"$SDK/emulator/emulator" -avd recap-native -port 5554 -no-window -no-audio -no-boot-anim \
  -no-snapshot -no-metrics -gpu swiftshader -memory 2048 -cores 2 > "$EVIDENCE/emulator.log" 2>&1 &
EMULATOR_PID=$!
timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device
booted=false
for attempt in $(seq 1 120); do
  kill -0 "$EMULATOR_PID"
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]] \
    && adb shell cmd package list packages > "$EVIDENCE/packages.txt" \
    && adb shell dumpsys webviewupdate | grep -q 'Current WebView package'; then
    booted=true
    break
  fi
  sleep 2
done
test "$booted" = true
adb root
timeout 30 adb wait-for-device
test "$(adb shell id -u | tr -d '\r')" = 0
adb shell iptables -I OUTPUT 1 '!' -o lo -j REJECT
adb shell ip6tables -I OUTPUT 1 '!' -o lo -j REJECT
adb shell iptables -C OUTPUT '!' -o lo -j REJECT
adb shell ip6tables -C OUTPUT '!' -o lo -j REJECT
{
  adb shell iptables -S OUTPUT
  adb shell ip6tables -S OUTPUT
  adb shell getprop ro.build.version.sdk
  adb shell getprop ro.product.cpu.abi
  adb shell dumpsys webviewupdate
  adb shell settings get system system_locales
} > "$EVIDENCE/device.txt"
adb shell input keyevent 82
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

gradle() {
  ./packaging/android/gradlew -p packaging/android --no-daemon --console plain "$@"
}
install_apks() {
  adb install -r -t "$APK"
  adb install -r -t "$TEST_APK"
}
instrument() {
  local label=$1
  local method=$2
  shift 2
  local selected="$CLASS"
  if [[ "$method" != all ]]; then selected="$CLASS#$method"; fi
  local statuses
  if timeout 420 adb shell am instrument -w -r -e class "$selected" "$@" "$RUNNER" \
    2>&1 | tee "$EVIDENCE/$label.log"; then
    statuses=("${PIPESTATUS[@]}")
  else
    statuses=("${PIPESTATUS[@]}")
  fi
  INSTRUMENT_EXIT="${statuses[0]}"
  TEE_EXIT="${statuses[1]}"
  if [[ "$INSTRUMENT_EXIT" != 0 ]]; then return "$INSTRUMENT_EXIT"; fi
  return "$TEE_EXIT"
}

capture_native_failure() {
  local phase=$1 method=$2 primary=$3 checker_exit=$4 pull_exit=$5
  if [[ "$MODE" != derived || "${RECAP_ANDROID_MODE:-}" != Rehearsal ]]; then return 0; fi
  NATIVE_FAILURE_ACTIVE=1
  # Hard bounds: capture 34s + shutdown 3s + finalization 4s + failed checker/pull 4s.
  if RECAP_NATIVE_EMULATOR_PID="$EMULATOR_PID" RECAP_NATIVE_TARGET="$APP" timeout --kill-after=1 33 node "$CHECKER" --capture-native-failure \
    "$phase" "$method" "$primary" "$INSTRUMENT_EXIT" "$TEE_EXIT" "$checker_exit" "$pull_exit"; then
    :
  else
    printf 'Native failure capsule unavailable (capture exit %s); primary exit remains %s.\n' "$?" "$primary" >&2
  fi
}

candidate_instrument() {
  local phase=$1 method=$2
  shift 2
  local primary=0 checker_exit=- pull_exit=-
  if instrument "$phase" "$method" -e candidatePhase "$phase" "$@"; then
    :
  else
    primary=$?
  fi
  if [[ "$primary" == 0 ]]; then
    if timeout --kill-after=1 3 node "$CHECKER" "$EVIDENCE/$phase.log" "$EVIDENCE/$phase.json" "$method"; then
      checker_exit=0
    else
      primary=$?
      checker_exit=$primary
    fi
  fi
  if [[ "$primary" != 0 ]]; then
    capture_native_failure "$phase" "$method" "$primary" "$checker_exit" "$pull_exit"
    return "$primary"
  fi
  if mkdir -p "$WORK/native-receipts/$phase"; then
    :
  else
    primary=$?
    capture_native_failure "$phase" "$method" "$primary" "$checker_exit" "$primary"
    return "$primary"
  fi
  local methods=("$method")
  if [[ "$method" == all ]]; then methods=("${NATIVE_METHODS[@]}"); fi
  for selected in "${methods[@]}"; do
    if timeout --kill-after=1 3 adb -s "$ANDROID_SERIAL" pull \
      "/sdcard/Android/data/$APP/files/native-test-evidence/candidate-$phase-$selected.json" \
      "$WORK/native-receipts/$phase/$selected.json" > "$EVIDENCE/pull-$phase-$selected.txt" 2>&1; then
      pull_exit=0
    else
      primary=$?
      capture_native_failure "$phase" "$method" "$primary" "$checker_exit" "$primary"
      return "$primary"
    fi
  done
}

if [[ "$MODE" == derived ]]; then
  CLASS=io.github.raymondnassar.recappage.prototype.NativeIntegrationTest
  APP=io.github.raymondnassar.recappage
  RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
  install_derived() {
    java -jar "$BUNDLETOOL" install-apks --apks="$APKS" --device-id="$ANDROID_SERIAL"
  }
  install_derived
  adb install -r -t "$OFFICIAL_TEST"
  candidate_instrument suite all
  candidate_instrument restart-seed startupAndPersistence
  adb shell am force-stop "$APP"
  candidate_instrument restart-probe startupAndPersistence -e restartProbe true
  candidate_instrument official-seed startupAndPersistence -e installationPhase official-seed
  adb install -r -t "$PROTOTYPE_APK"
  adb install -r -t "$PROTOTYPE_TEST"
  APP=io.github.raymondnassar.recappage.prototype
  RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
  candidate_instrument prototype-seed startupAndPersistence -e installationPhase prototype-seed
  APP=io.github.raymondnassar.recappage
  RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
  adb shell am force-stop "$APP"
  install_derived
  candidate_instrument official-probe startupAndPersistence -e installationPhase official-probe
  APP=io.github.raymondnassar.recappage.prototype
  RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
  candidate_instrument prototype-probe startupAndPersistence -e installationPhase prototype-probe
  adb shell iptables -C OUTPUT '!' -o lo -j REJECT
  adb shell ip6tables -C OUTPUT '!' -o lo -j REJECT
  printf '%s\n' 'external-network-blocked-v1' > "$EVIDENCE/network-verified.txt"
  node "$CANDIDATE" native-report
  git diff --exit-code
  exit 0
fi

SOURCE_BACKUP="$(mktemp)"
cp "$ACTIVITY_SOURCE" "$SOURCE_BACKUP"
python3 - "$ACTIVITY_SOURCE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = '"recap:connect:v1"'
assert text.count(old) == 1, 'Native connection marker changed; review the negative control'
p.write_text(text.replace(old, '"recap:broken:v1"'))
PY
gradle assembleDebug assembleDebugAndroidTest
install_apks
instrument negative providerRoundTripAndWriteFailure
node scripts/check-android-instrumentation.mjs "$EVIDENCE/negative.log" "$EVIDENCE/negative.json" providerRoundTripAndWriteFailure NATIVE_SAVE_COMPLETION
cp "$SOURCE_BACKUP" "$ACTIVITY_SOURCE"
rm -f "$SOURCE_BACKUP"
SOURCE_BACKUP=""
gradle assembleDebug assembleDebugAndroidTest lintDebug policyTest
install_apks
instrument suite all
node scripts/check-android-instrumentation.mjs "$EVIDENCE/suite.log" "$EVIDENCE/suite.json"
instrument restart-seed startupAndPersistence
node scripts/check-android-instrumentation.mjs "$EVIDENCE/restart-seed.log" "$EVIDENCE/restart-seed.json" startupAndPersistence
adb shell am force-stop "$APP"
instrument restart-probe startupAndPersistence -e restartProbe true
node scripts/check-android-instrumentation.mjs "$EVIDENCE/restart-probe.log" "$EVIDENCE/restart-probe.json" startupAndPersistence
mkdir -p "$EVIDENCE/verified-apk"
cp "$APK" "$EVIDENCE/verified-apk/recap-page-android-prototype.apk"
node scripts/android-release.mjs record "$EVIDENCE/verified-apk/recap-page-android-prototype.apk" \
  "$EVIDENCE/verified-apk/android-artifact.json"
sha256sum "$APK" "$TEST_APK" > "$EVIDENCE/apk-sha256.txt"
git diff --exit-code
