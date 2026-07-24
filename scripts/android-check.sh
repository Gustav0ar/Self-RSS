#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/packages/android"

if [ ! -f "$ANDROID_DIR/gradlew" ]; then
  echo "Android Gradle Wrapper not found at $ANDROID_DIR/gradlew"
  exit 1
fi

echo "[android-check] Checking Android/OpenAPI compatibility..."
bun "$ROOT_DIR/scripts/check-android-openapi-contract.ts"

echo "[android-check] Reporting resolved Android version..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:printAndroidVersionMetadata

echo "[android-check] Running Android unit tests..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:testDeviceTestUnitTest

echo "[android-check] Compiling Android instrumentation tests..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleDeviceTestAndroidTest

echo "[android-check] Running Android lint (debug)..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:lintDebug

echo "[android-check] Assembling Android debug build..."
bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleDebug

echo "[android-check] Assembling Android release build..."
SELF_FEED_API_BASE_URL=https://example.invalid/api/v1/ \
  bash "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleRelease

echo "[android-check] Verifying minified Moshi constructors..."
bash "$ROOT_DIR/scripts/check-android-release-r8.sh"

echo "[android-check] ✅ All Android checks passed."
