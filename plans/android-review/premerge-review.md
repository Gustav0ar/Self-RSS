# Android PR stack pre-merge review

Gustavo authorized further review, fixes and merging PRs #46–73 on 2026-09-12. This supersedes the earlier merge restriction in the implementation plans. Production deployment still requires a separate environment approval. The original checkout and its uncommitted plan files remain untouched.

## Reviewed candidate

- Main: `cd802e546d030ebfb98b0e01d37905b5b254ac7a`.
- Combined implementation: `76793558ad5ebdc5de9438210c37b96942e681ee`, including both test synchronization corrections below. Production packages match the fully device-tested candidate `f394bd4`; the only package difference is the outbox test correction.
- PR #47 contains design alternatives and an explicitly pending selection. Merging those documents does not select or implement a layout.
- Root owns all edits and test/device execution. Three independent read-only reviewers completed fresh passes over migrations, account/data consistency and reader/media lifetime. None found a new blocker. Root also reviewed the API cache/state response contracts and their cross-client callers.

## Findings and resolution

PR #69's latest documentation commit had a failed reader restoration test in CI run `34698147650`. Its assertion expected offset 600 before asynchronous body preparation finished. The controlled reproduction in `/tmp/android-premerge-restoration-red-4.log` fails with the same actual offset 0. Earlier reproduction attempts timed out because the fixture awaited dispatch before synchronizing Navigation's layout. The corrected test first establishes the restored reader shell, holds preparation, then waits for the production body-ready callback before asserting the exact original offset. `/tmp/android-premerge-restoration-green.log` passes all four restoration cases. No delay or production workaround was added.

Fresh CI runs `34703218677` and `34703294671` exposed a second timing assumption in the outbox receipt test. `runCurrent()` drains the test scheduler but cannot guarantee that Room's executor has returned the action. The test now awaits the receipt with a bounded real-time timeout while its WorkManager gate stays closed, then verifies the persisted mutation ID. The focused suite passes. A temporary production mutation that joins worker scheduling makes the corrected test fail with the expected timeout in `/tmp/android-premerge-outbox-receipt-mutant.log`; the mutation was removed. The complete PR #69 suite passes all 593 cases in `/tmp/android-premerge-pr69-final-unit.log`. No production scheduling change was needed.

Combining PR #47 exposed existing mock JS/CSS lint errors. Formatting, statement callbacks and equivalent template strings fix them. A timestamp class replaces an inline float plus its overriding CSS. All six before/after phone/tablet screenshots are pixel-identical, and search, text size, download removal and bookmark preservation pass in `/tmp/android-premerge-design-comparison.log`. Repository Biome checks pass in `/tmp/android-premerge-design-fixed.log`. The design choice remains pending.

All 28 GitHub review records were inspected, including discussion and inline threads. Each has only a Copilot quota notice; there are no inline findings or unresolved threads. This is not automated-review approval. Main's ruleset requires one approving GitHub review and provides an administrator bypass. A normal merge of #46 at verified head `3fedeb14ce7e9010a6ab424727e4afcbcd4e9a03` was rejected by GitHub's branch policy. No PR was merged. An independent approving review or Gustavo's explicit authorization to use the administrator override is still needed. Protection rules and production approvals remain unchanged.

## Data migration contract

Android Room advances from version 7 on main to version 10. Forward migrations and exported schemas are committed for 8, 9 and 10. The production registry includes every supported upgrade path. The direct 6-to-8 path retains historical offline pins before applying the existing version-7 repair. Version-8 and version-9 upgrades retain cached payload bytes, queued mutation IDs and existing ownership metadata. Session preference schema 1 adds persistent ownership without rewriting existing encrypted credentials or queued events.

The shared migration contract checks populated upgrades from versions 1 through 9, both historical version-6 layouts, clean creation, reopening, and the actual production migration registry. JVM migration checks pass as part of the complete 614-case suite. The same migration contract passes on real API 35 Android SQLite in the complete 132-case device run. No destructive fallback or production database clearing is added. API schema and Drizzle migration files are unchanged by this stack; API tests use temporary SQLite files and disposable loopback Redis.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Android JVM suite | 614 passed again after both fixture corrections, zero failures or skips | `/tmp/android-premerge-combined-final-unit.log` and Gradle XML reports |
| Isolated device and minified performance APK pairs | Passed | `/tmp/android-premerge-final-build.log` |
| Complete API 35 device suite | 132 passed, zero failures or skips | `/tmp/android-premerge-full-device.log` |
| External process recovery | Both cases passed | `/tmp/android-premerge-process.log` |
| Android lint | Debug, device-test and minified performance variants passed | `/tmp/android-premerge-final-lint.log` |
| API integration | 143 passed, zero failures | `/tmp/android-premerge-api-integration.log` |
| API unit | 734 passed | `/tmp/android-premerge-web-api-unit.log` |
| Web unit | 403 passed | `/tmp/android-premerge-web-api-unit.log` |
| Repository lint and architecture | Passed | `/tmp/android-premerge-repo-lint.log` |
| Cross-package type checks | Passed | `/tmp/android-premerge-types.log` |
| API/web builds | Passed | `/tmp/android-premerge-repo-build.log` |
| Generated OpenAPI and Android contract mapping | Passed, no generated diff | `/tmp/android-premerge-openapi.log` |
| Security | All four jobs passed on the combined design tree at `7909493` | Run `34704026973`; current checks are linked from [PR #47](https://github.com/Gustav0ar/Self-RSS/pull/47) |
| Repository CI | All five jobs passed at `5cc2ad7`; current combined-tree checks are linked from PR #47 | Run `34702960705` and [PR #47](https://github.com/Gustav0ar/Self-RSS/pull/47) |
| Combined Android CI | All required jobs passed at `5cc2ad7`; latest branches pass hosted JVM tests and are running device/build checks | Run `34701826679`; current [PR #73](https://github.com/Gustav0ar/Self-RSS/pull/73) run `34703983630` |

The disposable device is emulator-5568, API 35, WebView 124.0.6367.219, 320 × 640 at density 160, with animations disabled. Only isolated test package IDs are installed. Main pushes trigger container publication and queue the production deployment workflow; the production job requires Gustavo's explicit environment approval. No deployment approval is part of this review.

## Remaining limits

Physical frame, battery and native/WebView memory measurements remain in plans 033/049. Earlier fullscreen native and host JBR compiler crashes remain unexplained; subsequent passing checks do not establish their causes. These limits remain visible and are not described as zero regressions or zero leaks. Unimplemented plans 038 and 040–049 remain separate from this merge review.

## Merge record

No PR has been merged during this review. GitHub rejected the first normal merge because an approving review is required. [PR #47](https://github.com/Gustav0ar/Self-RSS/pull/47) records the final check results and merge disposition after this review snapshot. A merge must use the reviewed head, preserve the dependency chain and leave production approval untouched.

PR #69 receives the restoration correction as `aa53fa9` and the outbox assertion correction as `04131a1`; its own complete 593-case JVM suite passes in `/tmp/android-premerge-pr69-unit.log`. PRs #70–73 are rebased on that correction. Their production package tree matches the combined candidate tested locally. The only package difference from `f394bd4` is the outbox assertion correction in `RssRepositoryTest.kt`. No production code or persistent schema changed during this further review. Fresh PR CI runs are #69 `34703984314`, #70 `34703984051`, #71 `34703982996`, #72 `34703984308` and #73 `34703983630`. Four duplicate runs caused by simultaneous stacked base/head updates were cancelled; each branch retains its complete fresh run. Required jobs must pass before merging. The baseline-profile job is intentionally conditional and was skipped; physical performance acceptance remains open.
