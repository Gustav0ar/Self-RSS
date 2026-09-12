#!/usr/bin/env bash
# Shared checks for test-only APKs. This file has no device side effects when sourced.
set -euo pipefail

review_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
review_serial="${ANDROID_REVIEW_SERIAL:-}"
review_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
review_adb="${ANDROID_REVIEW_ADB:-${review_sdk:+$review_sdk/platform-tools/}adb}"
review_gradle="${ANDROID_REVIEW_GRADLE:-$review_root/packages/android/gradlew}"

review_fail() { printf '%s\n' "$*" >&2; exit 2; }

review_check_device() {
    [[ -n "$review_serial" ]] || review_fail 'Set ANDROID_REVIEW_SERIAL to the isolated test device.'
    [[ "$review_serial" =~ ^[a-zA-Z0-9._:-]+$ ]] || review_fail 'Invalid device serial.'
    local inventory
    inventory="$("$review_adb" devices -l)"
    # Refuse even an additional offline/unauthorized device. Connected Gradle
    # tasks must have exactly one possible target before they can install.
    mapfile -t review_devices < <(awk 'NR > 1 && NF >= 2 { print $1 " " $2 }' <<< "$inventory")
    [[ "${#review_devices[@]}" == 1 && "${review_devices[0]}" == "$review_serial device" ]] ||
        review_fail 'Expected exactly the designated, authorized test device; no APK was installed.'
}

review_check_classes() {
    [[ "$1" =~ ^com\.selffeed\.android\.[A-Za-z0-9_.$]+(,com\.selffeed\.android\.[A-Za-z0-9_.$]+)*$ ]] ||
        review_fail 'Provide fully qualified test classes separated by commas.'
}

review_verify_apk() {
    local apk="$1" expected="$2" aapt="${ANDROID_REVIEW_AAPT:-}" actual
    [[ "$expected" == com.selffeed.android.devicetest* || "$expected" == com.selffeed.android.performancetest* ||
       "$expected" == com.selffeed.android.macrobenchmark* ]] || review_fail 'Refusing a non-test package.'
    [[ -f "$apk" ]] || review_fail "Missing built APK: $apk"
    if [[ -z "$aapt" ]]; then
        local candidates=("$review_sdk"/build-tools/*/aapt)
        for candidate in "${candidates[@]}"; do
            [[ -x "$candidate" ]] && aapt="$candidate"
        done
    fi
    [[ -n "$aapt" ]] || review_fail 'Set ANDROID_HOME to an SDK with aapt.'
    actual="$("$aapt" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
    [[ "$actual" == "$expected" ]] || review_fail "Refusing APK package '$actual'; expected '$expected'."
}

review_gradle_run() {
    ANDROID_SERIAL="$review_serial" "$review_gradle" -p "$review_root/packages/android" \
        "-Pandroid.injected.device.serial=$review_serial" "$@"
}

review_run_device_tests() {
    local classes="$1"
    review_check_classes "$classes"
    review_check_device
    review_gradle_run :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest
    review_verify_apk "$review_root/packages/android/app/build/outputs/apk/deviceTest/app-deviceTest.apk" com.selffeed.android.devicetest
    review_verify_apk "$review_root/packages/android/app/build/outputs/apk/androidTest/deviceTest/app-deviceTest-androidTest.apk" com.selffeed.android.devicetest.test
    review_check_device
    review_gradle_run :app:connectedNonDisruptiveDeviceTest "-Pandroid.testInstrumentationRunnerArguments.class=$classes"
}

review_run_external_tests() {
    local classes="$1"
    review_check_classes "$classes"
    [[ "$classes" =~ ^com\.selffeed\.android\.macrobenchmark\.[A-Za-z0-9_.$]+(,com\.selffeed\.android\.macrobenchmark\.[A-Za-z0-9_.$]+)*$ ]] ||
        review_fail 'Recovery tests must run outside the target application in the macrobenchmark test package.'
    review_check_device
    # These task names were discovered with :macrobenchmark:tasks --all.
    review_gradle_run :app:assembleBenchmarkPerformanceTest :macrobenchmark:assembleBenchmarkPerformanceTest
    review_verify_apk "$review_root/packages/android/app/build/outputs/apk/benchmarkPerformanceTest/app-benchmarkPerformanceTest.apk" com.selffeed.android.performancetest
    review_verify_apk "$review_root/packages/android/macrobenchmark/build/outputs/apk/benchmarkPerformanceTest/macrobenchmark-benchmarkPerformanceTest.apk" com.selffeed.android.macrobenchmark
    review_check_device
    review_gradle_run :macrobenchmark:connectedBenchmarkPerformanceTestAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=$classes"
}
