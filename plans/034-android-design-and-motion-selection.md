# Plan 034: Select Android layout, loading, offline, and motion designs

- Status: TODO
- Priority: P1
- Effort: M
- Implementation risk: LOW
- Category: direction
- Planned at: `74d5c11`, 2026-09-11
- Depends on: none

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'plans/android-review/design/' 'plans/android-review/design-selection.md'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The requested layout and animation improvements require design choices before real components change. Gustavo requires several distinct mocks, publication through html-communication, and an explicit choice. This plan prepares those choices, including the failure and offline states that later behavior plans will render.

## Current state and conventions

Standing design constraints: dark mode, true black #000 backgrounds, white primary text, information density, minimal copy, no decorative card/pill chrome, no light-gray subtitle lines above sections, and no em dashes. Preserve touch targets and accessibility while making the list denser. The current audit has not visually inspected the installed app. html-communication was not found in the available skill roots during planning; locating it or obtaining an explicit publishing fallback is an execution dependency, not an assumed permission.

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt:619`:

```kotlin
    val isRead = isReadOverride ?: article.isRead
    val verticalPadding = if (density == DensityPreference.COMPACT) 8.dp else 12.dp
    val heroSize = if (density == DensityPreference.COMPACT) 44.dp else 56.dp
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isRead && !selected) 0.6f else 1f)
                .padding(horizontal = 16.dp, vertical = verticalPadding),
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt:610`:

```kotlin
            bottomBar = {
                Column {
                    key(state.auth.user?.id, state.auth.apiBaseUrl) {
                        ArticleSyncStatusLine(state.isOnline, pendingArticleChanges, onRetryPendingChanges)
                    }
                    AppBottomBar(
                        activeTab = activeTab,
                        onTabSelected = actions.onTabSelected,
                    )
                }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt:43`:

```kotlin
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `plans/android-review/design/`
- `plans/android-review/design-selection.md`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

Use branch `design/android-reading-experience` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| design spec | `test -s plans/android-review/design/scenarios.md` | The scenario checklist exists and includes every required state and viewport. |
| design files | `python3 -c "from pathlib import Path; p=Path('plans/android-review/design'); assert len(list(p.glob('*.html'))) >= 3"` | At least three runnable, distinct HTML mocks exist; inspect each with the publishing skill at the required viewport sizes. |
| design urls | `test -s plans/android-review/design/urls.md` | The URLs and successful preview checks are recorded; every published mock was opened with the publishing skill. |
| design selection | `python3 -c "from pathlib import Path; s=Path('plans/android-review/design-selection.md').read_text(); assert 'Selected direction:' in s and 'Selected direction: pending' not in s"` | The explicit user selection is recorded. Until the answer arrives this gate must remain unsatisfied. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Define the comparison scenarios

Write a scenario checklist under plans/android-review/design covering phone portrait, narrow landscape, tablet/two-pane, 200% text, and keyboard/TalkBack equivalents. Include initial load, cached refresh, offline with text, offline without text, failed detail, sync pending/retrying, save/download status, search updating/error, feed editor failure, and account settings.

Verify with `test -s plans/android-review/design/scenarios.md`. The scenario checklist exists and includes every required state and viewport.

### 2. Build three distinct directions

Create three standalone interactive HTML mocks with local fixture content: a dense title-first queue, an editorial reading-focused layout, and a compact adaptive split-view layout. Vary hierarchy and navigation rather than merely colors. Each must demonstrate queue/search density, reader controls, subscriptions-first navigation, separated reading/account settings, storage/download actions, and loading continuity. Show finite gesture/read/save/category transitions and disabled-motion equivalents. Record any deliberate feature omission.

Verify with `python3 -c "from pathlib import Path; p=Path('plans/android-review/design'); assert len(list(p.glob('*.html'))) >= 3"`. At least three runnable, distinct HTML mocks exist; inspect each with the publishing skill at the required viewport sizes.

### 3. Publish reviewable mocks

Find and read the user-required html-communication skill before publishing. If still unavailable, keep the local mocks ready, report the missing skill, and request permission for an available publishing alternative. Use only a dedicated mock channel with synthetic content. Record working URLs, screenshots at each required size, and the exact state/motion behavior; do not publish the real app or reuse a daily-driver preview.

Verify with `test -s plans/android-review/design/urls.md`. The URLs and successful preview checks are recorded; every published mock was opened with the publishing skill.

### 4. Record Gustavo's choice

Present the URLs and concrete differences, then stop for an explicit pick. Record the selected direction, any combination of elements, approved visible text, typography/density tokens, interaction durations, and offline-removal/storage behavior in design-selection.md. Include Selected direction: pending until the actual answer arrives. A file's existence or elapsed time is not approval. Later UI plans require the recorded choice for the states they implement.

Verify with `python3 -c "from pathlib import Path; s=Path('plans/android-review/design-selection.md').read_text(); assert 'Selected direction:' in s and 'Selected direction: pending' not in s"`. The explicit user selection is recorded. Until the answer arrives this gate must remain unsatisfied.

## Test and acceptance contract

- [ ] Three distinct runnable mocks cover every scenario in the comparison checklist.
- [ ] Published review URLs have been checked and are recorded alongside the mock files.
- [ ] Gustavo's explicit choice and any requested amendments are recorded; until then status remains AWAITING SELECTION.
- [ ] No files in packages/android have changed in this design plan.
- [ ] The chosen design specifies static long-running progress and finite, interruptible interaction motion.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not edit real components before the pick. This is the user's explicit visual-work rule, not an extra approval imposed by this plan.
- If html-communication cannot be found, request a publishing fallback after preparing the local mocks; do not invent a URL or silently switch channels.
- Do not treat the user's request to plan everything as selection of a particular design.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Use design-selection.md as the design decision record, with explicit amendments. Mechanical reliability plans can proceed independently; changes to visible layout or nontrivial copy await the applicable selection.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
