# SelfFeed Android App

Jetpack Compose Android client for SelfFeed API, targeting **Android 13 / API 33**.

## Highlights

- Kotlin + Jetpack Compose UI
- JWT bearer auth with automatic refresh using secure, persisted refresh cookie
- Encrypted local session storage (`EncryptedSharedPreferences`)
- Feature coverage aligned with web app core flows:
  - Login / Register / Session restore
  - Categories and feeds (create/edit/delete/select)
  - Feed sync
  - Article list/detail with rich/text reader mode, trusted embedded media preview (YouTube/Vimeo/Streamable), mark read/unread, mark all read, load-more pagination
  - Search with load-more pagination
  - Preferences (theme, density, sort, auto-mark mode, text size, font family, hide read)
  - Stats dashboard with daily activity + recent sync runs
  - Admin registration-lock toggle
  - OPML import/export (exported as attached `.opml` file via share sheet)
  - OPML import summary + warning details dialog
- Performance-oriented UI with lazy lists and stateflow-driven rendering
- Repository-level resilience for read APIs (retry with bounded backoff/jitter) plus short-lived in-memory caching for frequently refreshed lists/detail views

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

- Debug build uses `http://10.0.2.2:3000/api/v1/` for emulator-to-host API access.
- Release build placeholder is `https://your-api-domain/api/v1/`.

Update `API_BASE_URL` in `app/build.gradle.kts` for your environment.

## Run

1. Open `packages/android` in Android Studio.
2. Let Gradle sync.
3. Run on Android 13 emulator or Waydroid (API 33).
4. Ensure API is running at `localhost:3000` from host machine.

## First-time Setup

### Required SDK Components

Install these in Android Studio SDK Manager:

- Android SDK Platform 33
- Android SDK Build-Tools (latest)
- Android SDK Platform-Tools
- Android Emulator

### Recommended Emulator Profile

- Device: Pixel 8 (or equivalent)
- System image: Android 13 (API 33, Google APIs)
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

## Testing

- Added unit tests for trusted media URL validation in `app/src/test/java/com/selffeed/android/ui/utils/MediaTrustTest.kt`.
- Added comprehensive ViewModel unit tests in `app/src/test/java/com/selffeed/android/ui/MainViewModelTest.kt` covering bootstrap/auth, debounced search, pagination, and debug resilience metric reset paths.
- Added baseline instrumentation UI tests for auth flow rendering/toggle in `app/src/androidTest/java/com/selffeed/android/ui/AuthFlowUiTest.kt`.
- Added instrumentation tests for tab content interactions/load-more behavior in `app/src/androidTest/java/com/selffeed/android/ui/TabContentUiTest.kt`.
- Run unit tests with `./gradlew -p packages/android :app:testDebugUnitTest`.
- Run instrumentation tests with `./gradlew -p packages/android :app:connectedDebugAndroidTest`.
- Run lint + debug build checks with `./gradlew -p packages/android :app:lintDebug :app:assembleDebug`.
- Run all local Android pre-release checks from repo root with `bun run android:check`.

## CI

- Android checks run in the main CI workflow.
- A dedicated Android workflow is also available at `.github/workflows/android-ci.yml`.
- Dedicated workflow triggers on Android path changes and supports manual runs (`workflow_dispatch`).

## Known Gaps vs Web

- Most core web flows are implemented; remaining gaps are deeper visual polish, additional admin flows, and full keyboard/navigation parity.

## Release Checklist

Before shipping a production build:

- Set release `API_BASE_URL` in `app/build.gradle.kts` to your HTTPS API domain.
- Confirm release network policy keeps cleartext disabled (`src/release/res/xml/network_security_config.xml`).
- Ensure signing config/keystore is configured in Android Studio or CI secrets.
- Run full Android checks:
  - `./gradlew -p packages/android :app:testDebugUnitTest`
  - `./gradlew -p packages/android :app:lintDebug :app:assembleDebug`
- Verify CI jobs are green (`android-unit-tests`, `android-build-check`).
- Smoke-test auth, feed sync, article read/unread, search, and OPML import/export on device/emulator.
