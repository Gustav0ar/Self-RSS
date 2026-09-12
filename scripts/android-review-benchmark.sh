#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/android-review-common.sh"
review_output=''
while [[ $# -gt 0 ]]; do
    case "$1" in
        --serial) [[ $# -ge 2 ]] || review_fail 'Missing serial.'; review_serial="$2"; shift 2 ;;
        --output) [[ $# -ge 2 ]] || review_fail 'Missing output directory.'; review_output="$2"; shift 2 ;;
        *) review_fail "Unknown argument: $1" ;;
    esac
done
[[ -n "$review_output" ]] || review_fail 'Pass --output <directory> for benchmark evidence.'
review_check_device
[[ "$("$review_adb" -s "$review_serial" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]] ||
    review_fail 'Physical performance measurement requires a physical device. Use the process wrapper for emulator behavior tests.'
review_run_external_tests com.selffeed.android.macrobenchmark.StartupBenchmark
mkdir -p -- "$review_output"
{
    git -C "$review_root" rev-parse HEAD
    printf 'serial=%s\n' "$review_serial"
    "$review_adb" -s "$review_serial" shell getprop ro.product.model
    "$review_adb" -s "$review_serial" shell getprop ro.build.version.sdk
    "$review_adb" -s "$review_serial" shell dumpsys webviewupdate
} > "$review_output/environment.txt"
cp -a "$review_root/packages/android/macrobenchmark/build/outputs" "$review_output/macrobenchmark-outputs"
printf 'Benchmark evidence: %s\n' "$review_output"
