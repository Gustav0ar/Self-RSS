#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/packages/android"
APK_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
UNSIGNED_APK="$APK_DIR/app-release-unsigned.apk"
SIGNED_APK="$(mktemp --suffix=-self-feed-release.apk)"
trap 'rm -f "$SIGNED_APK" "$SIGNED_APK.idsig"' EXIT

: "${SELF_FEED_API_BASE_URL:=https://example.invalid/api/v1/}"
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"

SELF_FEED_API_BASE_URL="$SELF_FEED_API_BASE_URL" \
  "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" :app:assembleRelease

BUILD_TOOLS_DIR="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
if [ -z "$BUILD_TOOLS_DIR" ]; then
  echo "No Android build-tools installation found under $ANDROID_HOME/build-tools" >&2
  exit 1
fi

DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
if [ ! -f "$DEBUG_KEYSTORE" ]; then
  mkdir -p "$(dirname "$DEBUG_KEYSTORE")"
  keytool -genkeypair \
    -keystore "$DEBUG_KEYSTORE" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US"
fi

"$BUILD_TOOLS_DIR/zipalign" -f 4 "$UNSIGNED_APK" "$SIGNED_APK"
"$BUILD_TOOLS_DIR/apksigner" sign \
  --ks "$DEBUG_KEYSTORE" \
  --ks-key-alias androiddebugkey \
  --ks-pass pass:android \
  --key-pass pass:android \
  "$SIGNED_APK"
"$BUILD_TOOLS_DIR/apksigner" verify --verbose "$SIGNED_APK"

adb install -r "$SIGNED_APK"
adb logcat -c
adb shell am force-stop com.selffeed.android
adb shell am start -W \
  -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER \
  -n com.selffeed.android/.MainActivity
sleep 5

if ! adb shell pidof com.selffeed.android >/dev/null; then
  echo "Minified release process did not survive startup" >&2
  adb logcat -b crash -d -t 300 >&2 || true
  exit 1
fi

echo "Minified Android release started successfully"
