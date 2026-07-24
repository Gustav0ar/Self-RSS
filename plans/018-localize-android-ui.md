# Plan 018: Move Android user-facing text into resources

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/android/app/src/main/java/com/selffeed/android/ui packages/android/app/src/main/res/values/strings.xml packages/android/app/src/test packages/android/app/src/androidTest`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW
- **Depends on**: plan 009
- **Category**: tech-debt
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

Android exposes roughly 149 embedded English labels and descriptions while
`strings.xml` contains only the app name. Resources are required for
translation, pluralization, pseudo-locale testing, and reliable large-text/RTL
review.

## Current state

- `res/values/strings.xml:1-4` defines only `app_name`.
- `SettingsTab.kt:45-120`, `SelfFeedApp.kt:562-701`, `FeedsTab.kt`, and
  `ArticlesTab.kt` contain visible text and content descriptions.
- ViewModels also emit English status strings; composables cannot call
  `stringResource` from non-composable layers.

## Scope

In scope: Android UI/viewmodel presentation text, `strings.xml`, necessary
plural resources, and Android unit/instrumentation tests.
Out of scope: translating to a real second language, server-provided errors, or
changing layouts/branding.

## Steps

1. Inventory user-visible literals in `ui/`; distinguish UI copy from log,
   protocol, enum, URL, and test-fixture strings.
2. Move composable labels, actions, validation copy, and content descriptions
   to named resources. Use plurals and format arguments for counts/names.
3. Replace ViewModel-owned display strings with a small presentation text type
   representing either a string resource plus arguments or an already-localized
   server message. Resolve resources only in the UI layer.
4. Update tests to assert semantics through resolved default-locale text.
5. Run pseudo-locale, RTL, 1.3x/2.0x font scale, and TalkBack-oriented manual
   checks on login, articles, feeds, settings, dialogs, and reader.

## Verification

- `rg -n 'Text\\(\"|contentDescription = \"' packages/android/app/src/main/java/com/selffeed/android/ui`
  returns only explicitly documented non-user-facing exceptions.
- `bun run android:check` exits 0.
- Android unit and instrumentation tests pass; lint reports no missing
  translation/plural/resource-format errors.

## STOP conditions

Stop if converting a ViewModel message would force Android `Context` into a
ViewModel or repository. Introduce a presentation abstraction instead.

## Maintenance notes

Resource names should describe meaning, not screen coordinates. Future UI copy
must enter through resources even when the application remains English-only.
