# Plan 030: Add secure Android article and feed deep links

> **Executor instructions**: Use the `android-cli`, `navigation-3`, and
> `adaptive` skills if available. This app supports arbitrary self-hosted
> servers, so do not claim verified HTTPS App Links for hosts the app owner
> does not control.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/android/app/src/main/AndroidManifest.xml packages/android/app/src/main/java/com/selffeed/android/MainActivity.kt packages/android/app/src/main/java/com/selffeed/android/ui packages/android/app/src/main/res packages/android/app/src/test packages/android/app/src/androidTest packages/web/src`

## Status

- **State**: DONE
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 026
- **Category**: direction
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

Web articles have shareable routes, but Android only handles the launcher
intent. Links cannot return a user to an article, and sharing an RSS URL to the
app cannot start the existing feed-discovery flow.

## Current state

- `packages/web/src/routes/router.tsx:79-96` defines `/articles/:articleId`.
- `packages/android/app/src/main/AndroidManifest.xml:41-52` declares only
  `MAIN/LAUNCHER`.
- `MainActivity` uses `singleTask`, so both cold-start `intent` and
  `onNewIntent` must be handled.
- Article/feed navigation is ViewModel-driven from one root state, not a
  Navigation Component route graph.

## Link contract

- Support `selffeed://article/<article-id>?server=<https-origin>`.
- Support `selffeed://add-feed?url=<https-feed-url>`.
- Support Android `ACTION_SEND` for a single `text/plain` HTTPS feed URL.
- Never switch servers or submit a feed silently. If the optional server does
  not match the configured server, show a confirmation naming both origins;
  cancel leaves all state unchanged.
- Queue one pending external action through authentication and consume it
  exactly once after a valid session is restored.
- Arbitrary HTTPS interception and wildcard verified App Links are explicitly
  out of scope. A future branded distribution may add a fixed verified host.

## Scope

In scope: manifest filters, URI parser/value object, intent lifecycle,
auth-delayed action coordination, article open, add-feed confirmation,
localized/adaptive UI, tests, and optional web “Open in Android” link generation
using the explicit custom scheme.

Out of scope: silently changing API host, accepting non-HTTPS server/feed URLs,
background subscription, multiple shared URLs, or a new navigation framework.

## Steps

1. Implement a pure parser that validates scheme, action, UUID/article id,
   HTTPS origin/feed URL, length, credentials, fragments, and unsupported
   parameters. Fuzz malformed inputs and reject ambiguous encodings.
2. Add manifest filters for the custom scheme and `ACTION_SEND text/plain`
   while keeping the activity exported surface minimal.
3. Route both cold and warm intents into a lifecycle-safe pending-action
   coordinator. Deduplicate repeated intents and survive configuration change
   without replaying consumed actions.
4. After authentication, open an owned article through the existing
   ArticlesViewModel. For missing/unauthorized ids, show localized recovery and
   stay on the previous screen.
5. Send feed URLs into the existing discovery/add-feed UI with explicit user
   confirmation and category selection. Confirm any server change before
   clearing/reloading session state.
6. Add unit, Robolectric, and non-disruptive instrumentation tests for valid,
   malformed, cold/warm, unauthenticated, wrong-server, duplicate, and
   cancellation flows.

## Verification

- Android unit tests include parser and coordinator matrices.
- `adb shell am start -W -a android.intent.action.VIEW -d 'selffeed://article/<fixture-id>' com.selffeed.android`
  opens the seeded fixture on a disposable emulator/test variant.
- `mise exec -- bun run android:check` exits 0.
- No intent test replaces or clears the user's normal installed application.

## STOP conditions

Stop if implementation requires a wildcard HTTPS intent filter, automatically
trusting a new server, bypassing authentication, or running disruptive tests on
a physical user's normal package.

## Maintenance notes

Treat deep links as untrusted network input. Version the custom scheme contract
before making incompatible path/query changes.
