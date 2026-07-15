#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GENERATED_RULES_DIR="$ROOT_DIR/packages/android/app/build/generated/ksp/release/resources/META-INF/proguard"
USAGE_FILE="$ROOT_DIR/packages/android/app/build/outputs/mapping/release/usage.txt"

if [ ! -d "$GENERATED_RULES_DIR" ] || [ ! -f "$USAGE_FILE" ]; then
  echo "Release KSP/R8 artifacts are missing; assembleRelease must run first."
  exit 1
fi

mapfile -t reflective_models < <(
  grep -l 'public synthetic <init>' "$GENERATED_RULES_DIR"/*.pro \
    | xargs -r grep -h '^-keepnames class ' \
    | sed -E 's/^-keepnames class ([^ ]+)$/\1/' \
    | sort -u
)

if [ "${#reflective_models[@]}" -eq 0 ]; then
  echo "No generated Moshi default-constructor rules were found."
  exit 1
fi

removed_models=()
for model in "${reflective_models[@]}"; do
  if awk -v model="$model" '
    $0 == model ":" { in_model = 1; next }
    in_model && /^[^ ]/ { exit }
    in_model && /public synthetic void <init>/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$USAGE_FILE"; then
    removed_models+=("$model")
  fi
done

if [ "${#removed_models[@]}" -ne 0 ]; then
  echo "R8 removed constructors reflectively required by generated Moshi adapters:"
  printf '  %s\n' "${removed_models[@]}"
  exit 1
fi

echo "[android-r8] Verified ${#reflective_models[@]} generated Moshi default constructors."
