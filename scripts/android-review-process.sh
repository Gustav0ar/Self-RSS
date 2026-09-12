#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/android-review-common.sh"
[[ $# == 1 ]] || review_fail 'Usage: ANDROID_REVIEW_SERIAL=<serial> bash scripts/android-review-process.sh <external-test-class[,test-class]>'
review_run_external_tests "$1"
