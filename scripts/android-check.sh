#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/packages/android"

if [ ! -f "$ANDROID_DIR/gradlew" ]; then
  echo "Android Gradle Wrapper not found at $ANDROID_DIR/gradlew"
  exit 1
fi

echo "[android-check] Running Android unit tests..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:testDebugUnitTest

echo "[android-check] Running Android lint (debug)..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:lintDebug

echo "[android-check] Assembling Android debug build..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleDebug

echo "[android-check] Assembling Android release build..."
SELF_FEED_API_BASE_URL=https://example.invalid/api/v1/ \
  bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleRelease

echo "[android-check] ✅ All Android checks passed."
