# Plan 026: Remove main-thread blocking from Android session persistence

> **Executor instructions**: Use the `android-cli` and `testing-setup` skills
> if available. Preserve encrypted-at-rest tokens and synchronous cached reads
> required by OkHttp.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt packages/android/app/src/main/java/com/selffeed/android/network packages/android/app/src/main/java/com/selffeed/android/ui packages/android/app/src/test`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

`SessionStore` wraps DataStore and Android Keystore operations in
`runBlocking`. Login, registration, server switching, and bootstrap originate
in main-thread `viewModelScope`, so slow storage or Keystore access can cause
visible jank or an ANR.

## Current state

- `SessionStore.kt:89-92` performs legacy migration during construction.
- `SessionStore.kt:127-186` uses `runBlocking` for token, cookie, client ID,
  and server URL reads/writes.
- `RssRepository.kt:109-124` persists tokens and restores sessions inside
  suspend repository methods.
- `AuthViewModel.kt:55-97,111-150` calls those methods from `viewModelScope`.
- OkHttp authenticators/cookie handling require immediate cached reads. Do not
  perform disk I/O from those callbacks.

## Scope

In scope: suspending persistence APIs, IO dispatch, preload lifecycle, cached
snapshot semantics, one-time migration, repository/network callers, tests.
Out of scope: changing encryption algorithm, clearing user sessions, replacing
DataStore, or redesigning authentication.

## Steps

1. Characterize every SessionStore caller as either synchronous network
   callback or suspending app flow. Add StrictMode/coroutine tests that fail if
   disk/Keystore work executes on the main dispatcher.
2. Keep synchronous getters cache-only after an explicit application startup
   preload. Convert persistence setters, clear, migration, client ID creation,
   and server URL updates to suspend functions using an injected IO dispatcher.
3. Move legacy migration out of the constructor into the serialized preload
   path. Make preload idempotent under concurrent AppViewModel/network startup
   and publish one immutable in-memory session snapshot atomically.
4. Update repository and refresh/cookie coordination so writes complete before
   reporting login/refresh success. Network callbacks may enqueue a serialized
   persistence write but must update the in-memory snapshot first.
5. Test process restart persistence, failed/cancelled writes, concurrent
   refresh rotation, legacy migration, logout clearing, server switch, and
   unavailable Keystore behavior.

## Verification

- `JAVA_HOME=/home/gustavo/.local/share/JetBrains/Toolbox/apps/android-studio/jbr ./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest`
  exits 0.
- `mise exec -- bun run android:check` exits 0.
- `rg -n "runBlocking" packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt`
  returns no production matches.

## STOP conditions

Stop if avoiding blocking would require returning an uninitialized refresh
cookie to OkHttp, weakening encryption, or accepting login success before the
refresh session is durably stored.

## Maintenance notes

Session state has two layers: an atomic memory snapshot for synchronous network
access and encrypted DataStore for durability. Future fields must update both
through the same serialized write path.
