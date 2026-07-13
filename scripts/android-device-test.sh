#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# This task builds the deviceTest variant, whose application ID differs from
# the normal app. It therefore leaves the user's installed app and data alone.
bash "$ROOT_DIR/packages/android/gradlew" -p "$ROOT_DIR/packages/android" \
  :app:connectedNonDisruptiveDeviceTest
