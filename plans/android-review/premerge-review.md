# Android PR stack pre-merge review

Gustavo authorized further review, fixes and merging PRs #46–73 on 2026-09-12. This supersedes the earlier merge restriction in the implementation plans. Production deployment still requires a separate environment approval. The original checkout and its uncommitted plan files remain untouched.

## Reviewed candidate

- Main: `cd802e546d030ebfb98b0e01d37905b5b254ac7a`.
- Combined implementation: `5cc2ad7980259768d2c0bbc31176073fb01bf8d0`, plus the restoration fixture correction below.
- PR #47 contains design alternatives and an explicitly pending selection. Merging those documents does not select or implement a layout.
- Root owns all edits and test/device execution. Three independent read-only reviewers completed fresh passes over migrations, account/data consistency and reader/media lifetime. None found a new blocker. Root also reviewed the API cache/state response contracts and their cross-client callers.

## Findings and resolution

PR #69's latest documentation commit had a failed reader restoration test in CI run `34698147650`. Its assertion expected offset 600 before asynchronous body preparation finished. The controlled reproduction in `/tmp/android-premerge-restoration-red-4.log` fails with the same actual offset 0. Earlier reproduction attempts timed out because the fixture awaited dispatch before synchronizing Navigation's layout. The corrected test first establishes the restored reader shell, holds preparation, then waits for the production body-ready callback before asserting the exact original offset. `/tmp/android-premerge-restoration-green.log` passes all four restoration cases. No delay or production workaround was added.

All 28 GitHub review records were inspected, including discussion and inline threads. Each has only a Copilot quota notice; there are no inline findings or unresolved threads. This is not automated-review approval. Main's ruleset requires one approving GitHub review and provides an administrator bypass. Merge authorization does not fabricate an approving review.

## Data migration contract

Android Room advances from version 7 on main to version 10. Forward migrations and exported schemas are committed for 8, 9 and 10. The production registry includes every supported upgrade path. The direct 6-to-8 path retains historical offline pins before applying the existing version-7 repair. Version-8 and version-9 upgrades retain cached payload bytes, queued mutation IDs and existing ownership metadata. Session preference schema 1 adds persistent ownership without rewriting existing encrypted credentials or queued events.

The shared migration contract checks populated upgrades from versions 1 through 9, both historical version-6 layouts, clean creation, reopening, and the actual production migration registry. JVM migration checks pass as part of the complete 614-case suite. The same migration contract passes on real API 35 Android SQLite in the complete 132-case device run. No destructive fallback or production database clearing is added. API schema and Drizzle migration files are unchanged by this stack; API tests use temporary SQLite files and disposable loopback Redis.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Android JVM suite | 614 passed, zero failures or skips | `/tmp/android-premerge-final-build.log` and Gradle XML reports |
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
| Security | All four jobs passed at `5cc2ad7` | Run `34702966192` |
| Repository CI | Running at `5cc2ad7` | Run `34702960705` |
| Latest combined Android CI | All required jobs passed at `5cc2ad7` | Run `34701826679` |

The disposable device is emulator-5568, API 35, WebView 124.0.6367.219, 320 × 640 at density 160, with animations disabled. Only isolated test package IDs are installed. Main pushes trigger container publication and queue the production deployment workflow; the production job requires Gustavo's explicit environment approval. No deployment approval is part of this review.

## Remaining limits

Physical frame, battery and native/WebView memory measurements remain in plans 033/049. Earlier fullscreen native and host JBR compiler crashes remain unexplained; subsequent passing checks do not establish their causes. These limits remain visible and are not described as zero regressions or zero leaks. Unimplemented plans 038 and 040–049 remain separate from this merge review.

## Merge record

No PR has been merged during this review yet. Record final head checks, review findings, merge commits and post-merge validation here before declaring the merge task complete.

PR #69 receives the fixture correction as `aa53fa9`; its own complete 593-case JVM suite passes in `/tmp/android-premerge-pr69-unit.log`. PRs #70–73 are rebased on that correction. Their resulting package tree matches the combined candidate tested locally, verified with `git diff --exit-code f394bd4 HEAD -- packages`. No production code or persistent schema changed during this further review. Fresh PR CI is required on the rewritten branches.
