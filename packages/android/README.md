# SelfFeed Android App

Jetpack Compose Android client for SelfFeed API, compiling with **API 37** and targeting **API 35**.

## Highlights

- Kotlin + Jetpack Compose UI
- JWT bearer auth with automatic refresh using secure, persisted refresh cookie
- Encrypted local session storage (DataStore preferences with per-value AES/GCM)
- Feature coverage aligned with web app core flows:
  - Login / Register / Session restore
  - Categories and feeds (create/edit/delete/select), including nested categories and per-feed refresh intervals
  - Feed sync
  - Article list/detail with rich/text reader mode, trusted embedded media preview (YouTube/Vimeo/Streamable), reader typography controls, share/open-original actions, mark read/unread with undo, mark-all confirmation, and load-more pagination
  - Search with load-more pagination
  - Preferences (theme, density, sort, auto-mark mode, text size, font family, hide read)
  - Stats dashboard with daily activity + recent sync runs
  - Admin registration-lock toggle
  - OPML import/export from the subscription UI (exported as attached `.opml` file via share sheet)
  - OPML import summary + warning details dialog
- Performance-oriented UI with lazy lists, stateflow-driven rendering, background refresh status, Navigation 3 responsive list-detail reading, and origin-preserving search navigation
- Paging 3 is the only article-list source of truth; Room query entries retain the current queue offline while a bounded snapshot supports instant reader navigation
- Repository-level resilience for read APIs (retry with bounded backoff/jitter), Room-backed offline detail caching, parallel adjacent-article warming, and realtime content-version invalidation

## Project Layout

```text
packages/android/
├── app/
│   ├── build.gradle.kts
│   └── src/main/java/com/selffeed/android/
│       ├── data/           # repository + secure session store
│       ├── network/        # Retrofit API + auth/cookie refresh plumbing
│       ├── ui/             # viewmodel + root Compose orchestration
│       │   ├── components/ # reader dialog, external actions
│       │   ├── screens/    # feeds/articles/search/settings/stats tabs
│       │   └── utils/      # trust/media helper logic
│       └── MainActivity.kt
├── build.gradle.kts
└── settings.gradle.kts
```

## Base URL

- Debug builds use `http://10.0.2.2:3000/api/v1/` for emulator-to-host API access.
- Release builds require `SELF_FEED_API_BASE_URL` to be set to an HTTPS API endpoint.
- Release certificate pinning is configured with pipe- or comma-separated `sha256/...` values in `SELF_FEED_CERTIFICATE_PINS` and `SELF_FEED_BACKUP_CERTIFICATE_PINS`.

For physical-device debug testing, update the debug `API_BASE_URL` in `app/build.gradle.kts` to your LAN host IP.

## Run

1. Open `packages/android` in Android Studio.
2. Let Gradle sync.
3. Run on a current emulator or Waydroid image supported by the configured SDK.
4. Ensure API is running at `localhost:3000` from host machine.

## First-time Setup

### Required SDK Components

Install these in Android Studio SDK Manager:

- Android SDK Platform 37
- Android SDK Build-Tools (latest)
- Android SDK Platform-Tools
- Android Emulator

### Recommended Emulator Profile

- Device: Pixel 8 (or equivalent)
- System image: Android 15+ (Google APIs)
- Network: default NAT (so app can reach host API via `10.0.2.2`)

### Local API Connectivity Checklist

- API server is running on host at `http://localhost:3000`
- Android debug build uses `http://10.0.2.2:3000/api/v1/`
- If using a physical device, change `API_BASE_URL` to your LAN host IP

### Common Issues

- **`CLEARTEXT communication not permitted`**: use debug build and verify `src/debug/res/xml/network_security_config.xml` exists.
- **`ECONNREFUSED 10.0.2.2:3000`**: API not running locally, wrong port, or host firewall blocking.
- **Gradle mismatch/version drift**: use wrapper commands (`./gradlew ...`) from repo root.

## Security Notes

- Session data uses encrypted storage.
- Refresh token is handled as HTTP-only-style cookie via OkHttp cookie jar persistence.
- `android:allowBackup` is disabled.
- `network_security_config` is variant-specific: debug allows local cleartext (`10.0.2.2`, `localhost`), release disables cleartext traffic.
- Trusted embedded media preview is restricted to known providers/hosts.
- Release certificate pins are applied to the hostname derived from `SELF_FEED_API_BASE_URL`; configure both primary and backup pins so certificate rotation does not strand installed clients.

## Testing

- Added unit tests for trusted media URL validation in `app/src/test/java/com/selffeed/android/ui/utils/MediaTrustTest.kt`.
- ViewModel tests cover auth/bootstrap, feed sync completion, article/search queues, pagination, caching, and realtime invalidation.
- Article warming and enrichment-manager tests verify bounded parallel prefetch and selected-reader refresh behavior.
- Instrumentation coverage exercises the root Hilt activity and major Compose flows.
- Run unit tests with `./gradlew -p packages/android :app:testDeviceTestUnitTest`.
- Run instrumentation tests with `./gradlew -p packages/android :app:connectedDeviceTestAndroidTest`. They use the isolated `com.selffeed.android.devicetest` package and therefore do not replace the normal app.
- Run the same non-disruptive test suite on a physical development device with `bun run android:test:device`.
- Run lint + debug build checks with `./gradlew -p packages/android :app:lintDebug :app:assembleDebug`.
- Run all local Android pre-release checks from repo root with `bun run android:check`.
- Generate the release Baseline Profile on the configured managed device with `SELF_FEED_API_BASE_URL=https://example.invalid/api/v1/ ./gradlew -p packages/android :app:generateBaselineProfile -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=BaselineProfile`. The generator includes a deterministic authenticated app-shell article-card → reader journey, so it does not rely on real credentials or source-feed latency.

## CI

- Android checks run in the dedicated `.github/workflows/android-ci.yml` workflow.
- The workflow runs unit, lint/build, and Hilt-backed Compose instrumentation tests. A manual run also generates and uploads the release Baseline Profile from a Gradle-managed AOSP device.
- Macrobenchmarks remain manual because absolute timing thresholds are not reliable on shared CI hardware; use them to investigate a suspected cold-start or reader-navigation regression.

## UX Notes

- Reader text size, font, density, and auto-mark behavior are applied consistently to the reader and article queue.
- Tablets and foldables use a list-detail reader layout once sufficient width is available; compact screens retain the focused reader flow.
- Search-result readers return to Search when closed, preserving the original query and results.
- The bottom status line counts durable read and save changes waiting for delivery. Retry schedules the existing background worker. Per-article offline labels require persisted body content; images and embeds may still need a connection.

## Release Checklist

Before shipping a production build:

- Choose `SELF_FEED_ANDROID_VERSION_CODE` as a positive integer greater than
  every version code previously uploaded to the store. The release operator is
  responsible for this monotonic increase; Gradle cannot infer the store's
  current maximum. Choose a nonblank `SELF_FEED_ANDROID_VERSION_NAME` for the
  user-visible release version.
- For the next release after the local `1` / `1.0.0` defaults, validate version
  code `2` and name `1.0.1` in Android CI with:
  ```bash
  gh workflow run android-ci.yml \
    -f android_version_code=2 \
    -f android_version_name=1.0.1
  ```
- To build and verify that same version locally, use Gradle properties (the
  equivalent environment variables are also supported):
  ```bash
  SELF_FEED_API_BASE_URL=https://your-api.example/api/v1/ \
    ./packages/android/gradlew -p packages/android \
      -PSELF_FEED_ANDROID_VERSION_CODE=2 \
      -PSELF_FEED_ANDROID_VERSION_NAME=1.0.1 \
      :app:verifyAndroidReleaseVersion \
      :app:printAndroidVersionMetadata
  ```
  `printAndroidVersionMetadata` emits a
  `SELF_FEED_ANDROID_VERSION_METADATA=<json>` line for automation. Local builds
  that omit both inputs deterministically use version code `1` and version name
  `1.0.0`; CI release tasks reject omitted inputs. When both forms are present,
  the `-P` Gradle property takes precedence over the same-named environment
  variable. The isolated device-test variant retains the `-device-test`
  version-name suffix.
- Set `SELF_FEED_API_BASE_URL` to your HTTPS API domain before building release artifacts.
- Set at least two valid pins across `SELF_FEED_CERTIFICATE_PINS` and `SELF_FEED_BACKUP_CERTIFICATE_PINS`; retain an overlap pin during certificate rotation.
- Confirm release network policy keeps cleartext disabled (`src/release/res/xml/network_security_config.xml`).
- Ensure signing config/keystore is configured in Android Studio or CI secrets.
- Run full Android checks:
  - `./gradlew -p packages/android :app:testDeviceTestUnitTest`
  - `./gradlew -p packages/android :app:lintDebug :app:assembleDebug`
- Verify CI jobs are green (`android-unit-tests`, `android-build-check`).
- Smoke-test auth, feed sync, article read/unread, search, and OPML import/export on device/emulator.
