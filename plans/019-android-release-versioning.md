# Plan 019: Make Android release versions explicit and monotonic

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/android/app/build.gradle.kts .github/workflows/android-ci.yml scripts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 009
- **Category**: dx
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

`versionCode = 1` and `versionName = "1.0.0"` are hardcoded. Any distributed
second release needs a higher code, and CI currently has no explicit,
reviewable version input.

## Current state

- `packages/android/app/build.gradle.kts:65-70` hardcodes both values.
- `.github/workflows/android-ci.yml` builds release artifacts but does not
  provide version metadata.
- Device-test builds append `-device-test`; preserve that behavior.

## Scope

In scope: Android Gradle version resolution, Android CI inputs/checks, and
release documentation if needed.
Out of scope: signing credentials, Play publishing, or creating a production
release.

## Steps

1. Resolve version name/code from documented Gradle properties or environment
   variables, with deterministic local defaults equal to the current release.
2. Validate: code is a positive integer; name is nonblank; a release CI run
   must provide explicit values. Debug/local builds may use defaults.
3. Add a Gradle task that prints machine-readable version metadata and a CI
   assertion that supplied release values are reflected in the built variant.
4. Document the exact next-release invocation and monotonic-code responsibility.

## Verification

- Default `assembleDebug` remains version 1 / 1.0.0.
- An override build reports and embeds a chosen higher test code/name.
- Invalid/blank overrides fail with a clear Gradle error.
- `bun run android:check` and Android CI YAML syntax checks pass.

## STOP conditions

Stop if version derivation depends on a non-monotonic Git hash or silently
reuses code 1 for CI release artifacts.

## Maintenance notes

Tags may name releases, but `versionCode` must remain monotonically increasing
independently of semantic version formatting.
