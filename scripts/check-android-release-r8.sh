#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USAGE_FILE="$ROOT_DIR/packages/android/app/build/outputs/mapping/release/usage.txt"
MAPPING_FILE="$ROOT_DIR/packages/android/app/build/outputs/mapping/release/mapping.txt"

if [ ! -f "$USAGE_FILE" ] || [ ! -f "$MAPPING_FILE" ]; then
  echo "Release R8 mapping/usage artifacts are missing; assembleRelease must run first."
  exit 1
fi

# Verify critical kotlinx.serialization DTO companions and Nav3 route keys were not stripped by R8.
required_classes=(
  "com.selffeed.android.ui.ArticleListDestination"
  "com.selffeed.android.ui.ArticleDetailDestination"
  "com.selffeed.android.network.ApiEnvelope\$Companion"
  "com.selffeed.android.network.ApiListResponse\$Companion"
  "com.selffeed.android.network.ArticleDetail\$Companion"
  "com.selffeed.android.network.ArticleListItem\$Companion"
  "com.selffeed.android.network.UserPreferences\$Companion"
  "com.selffeed.android.network.LoginRequest\$Companion"
)

missing=()
for cls in "${required_classes[@]}"; do
  if ! grep -q "^${cls} -> " "$MAPPING_FILE"; then
    missing+=("$cls")
  fi
done

if [ "${#missing[@]}" -ne 0 ]; then
  echo "R8 stripped required serialization/navigation classes:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

echo "[android-r8] Verified ${#required_classes[@]} critical serialization and navigation classes under R8."
