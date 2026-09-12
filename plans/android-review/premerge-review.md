# Android PR stack pre-merge review

Gustavo authorized further review, fixes and merging PRs #46–73 on 2026-09-12. This supersedes the earlier merge restriction in the implementation plans. Production deployment still requires a separate environment approval. The original checkout and its uncommitted plan files remain untouched.

## Reviewed candidate

- Main before merging: `cd802e546d030ebfb98b0e01d37905b5b254ac7a`.
- Combined implementation: `76793558ad5ebdc5de9438210c37b96942e681ee`, including both test synchronization corrections below. Production packages match the fully device-tested candidate `f394bd4`; the only package difference is the outbox test correction.
- PR #47 contains design alternatives and an explicitly pending selection. Merging those documents does not select or implement a layout.
- Root owns all edits and test/device execution. Three independent read-only reviewers completed fresh passes over migrations, account/data consistency and reader/media lifetime. None found a new blocker. Root also reviewed the API cache/state response contracts and their cross-client callers.

## Findings and resolution

PR #69's latest documentation commit had a failed reader restoration test in CI run `34698147650`. Its assertion expected offset 600 before asynchronous body preparation finished. The controlled reproduction in `/tmp/android-premerge-restoration-red-4.log` fails with the same actual offset 0. Earlier reproduction attempts timed out because the fixture awaited dispatch before synchronizing Navigation's layout. The corrected test first establishes the restored reader shell, holds preparation, then waits for the production body-ready callback before asserting the exact original offset. `/tmp/android-premerge-restoration-green.log` passes all four restoration cases. No delay or production workaround was added.

Fresh CI runs `34703218677` and `34703294671` exposed a second timing assumption in the outbox receipt test. `runCurrent()` drains the test scheduler but cannot guarantee that Room's executor has returned the action. The test now awaits the receipt with a bounded real-time timeout while its WorkManager gate stays closed, then verifies the persisted mutation ID. The focused suite passes. A temporary production mutation that joins worker scheduling makes the corrected test fail with the expected timeout in `/tmp/android-premerge-outbox-receipt-mutant.log`; the mutation was removed. The complete PR #69 suite passes all 593 cases in `/tmp/android-premerge-pr69-final-unit.log`. No production scheduling change was needed.

Combining PR #47 exposed existing mock JS/CSS lint errors. Formatting, statement callbacks and equivalent template strings fix them. A timestamp class replaces an inline float plus its overriding CSS. All six before/after phone/tablet screenshots are pixel-identical, and search, text size, download removal and bookmark preservation pass in `/tmp/android-premerge-design-comparison.log`. Repository Biome checks pass in `/tmp/android-premerge-design-fixed.log`. The design choice remains pending.

All 28 GitHub review records were inspected, including discussion and inline threads. Each has only a Copilot quota notice; there are no inline findings or unresolved threads. This is not automated-review approval. Main's ruleset requires one approving GitHub review and provides an administrator bypass. A normal merge of #46 at verified head `3fedeb14ce7e9010a6ab424727e4afcbcd4e9a03` was rejected by GitHub's branch policy. Gustavo then confirmed merging in response to the explicit administrator-override question. The existing override is authorized for this reviewed stack. Protection rules and production approvals remain unchanged.

## Data migration contract

Android Room advances from version 7 on the original main branch to version 10. Forward migrations and exported schemas are committed for 8, 9 and 10. The production registry includes every supported upgrade path. The direct 6-to-8 path retains historical offline pins before applying the existing version-7 repair. Version-8 and version-9 upgrades retain cached payload bytes, queued mutation IDs and existing ownership metadata. Session preference schema 1 adds persistent ownership without rewriting existing encrypted credentials or queued events.

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
| Security | All four jobs passed on the combined design tree at `c474a1b` | [Run 34704362610](https://github.com/Gustav0ar/Self-RSS/actions/runs/34704362610) |
| Repository CI | All five jobs passed at `c474a1b`, including end-to-end tests | [Run 34704361732](https://github.com/Gustav0ar/Self-RSS/actions/runs/34704361732) |
| Combined Android CI | All required unit, lint/build and device jobs passed at `7679355` | [Run 34703983630](https://github.com/Gustav0ar/Self-RSS/actions/runs/34703983630) |

The disposable device is emulator-5568, API 35, WebView 124.0.6367.219, 320 × 640 at density 160, with animations disabled. Only isolated test package IDs are installed. Main pushes trigger container publication and queue the production deployment workflow; the production job requires Gustavo's explicit environment approval. No deployment approval is part of this review.

## Remaining limits

Physical frame, battery and native/WebView memory measurements remain in plans 033/049. Earlier fullscreen native and host JBR compiler crashes remain unexplained; subsequent passing checks do not establish their causes. These limits remain visible and are not described as zero regressions or zero leaks. Unimplemented plans 038 and 040–049 remain separate from this merge review.

## Merge record

The roadmap and all 26 implementation/testing PRs are merged into main in dependency order using the authorized administrator override. Each merge commit has exactly the same Git tree as its reviewed head. PR #47 integrates the design documents and this record; its description records its own merge commit and final main checks. Intermediate workflow runs were cancelled as their merge commits were superseded, including container builds that could otherwise publish older branch tags after the final build. Production approval remains untouched.

| PR | Reviewed head | Merge commit |
| --- | --- | --- |
| [#46](https://github.com/Gustav0ar/Self-RSS/pull/46) | `3fedeb14` | `312521984d70a4078ecb6eb6790eef6ca1065406` |
| [#48](https://github.com/Gustav0ar/Self-RSS/pull/48) | `6a88a723` | `64e78fe9c4c3801b13566ecf3fbb1726837641c4` |
| [#49](https://github.com/Gustav0ar/Self-RSS/pull/49) | `e812051e` | `f2ea1e809ee86a0e0af2201e9298263facc5211c` |
| [#50](https://github.com/Gustav0ar/Self-RSS/pull/50) | `3a2b070c` | `1225a3d2067ba12c475e3222a8f05ed95b92cdd3` |
| [#51](https://github.com/Gustav0ar/Self-RSS/pull/51) | `a403d8cc` | `a10d8e9a3627ed83fd613c763e32c6f67b3f0017` |
| [#52](https://github.com/Gustav0ar/Self-RSS/pull/52) | `fdf7f484` | `4905a9ce16b32fabaa4b5626017d7b5bfca11cb6` |
| [#53](https://github.com/Gustav0ar/Self-RSS/pull/53) | `6fd03a98` | `385ce01d911f14476a4da65d80e14b132e8c474b` |
| [#54](https://github.com/Gustav0ar/Self-RSS/pull/54) | `b23e2296` | `e33f46722bcb348135f2aa3f0757822dd971418c` |
| [#55](https://github.com/Gustav0ar/Self-RSS/pull/55) | `a2719898` | `2213da43d53e90b2e176fd19d8f80e5fd7297336` |
| [#56](https://github.com/Gustav0ar/Self-RSS/pull/56) | `ceeeffd2` | `4b11f8c3ef51c2275f728e3848ae7714811431df` |
| [#57](https://github.com/Gustav0ar/Self-RSS/pull/57) | `90a6d2f6` | `d786344a34535b6e42c3c4167109e1ae1a11a632` |
| [#58](https://github.com/Gustav0ar/Self-RSS/pull/58) | `e4ad9bb3` | `0338a121ab94c986f7240d3e0014901dbcf88dcd` |
| [#59](https://github.com/Gustav0ar/Self-RSS/pull/59) | `25f7a0e8` | `1f83a2943b4f47b9329a32e4bb4a897f1e5f8e80` |
| [#60](https://github.com/Gustav0ar/Self-RSS/pull/60) | `0187f881` | `254c0d3db9fdac1419c87218f3fe3c73ee2044c0` |
| [#61](https://github.com/Gustav0ar/Self-RSS/pull/61) | `3c22340a` | `74d7f210bf8e15aaf1dd2d8ad8e567f3417570fc` |
| [#62](https://github.com/Gustav0ar/Self-RSS/pull/62) | `6fe1f8f2` | `bddbf2d720b7d7ff4f8e4ded143729af3a65bab9` |
| [#63](https://github.com/Gustav0ar/Self-RSS/pull/63) | `f452287b` | `9cbf131e88db7ee764ac2993f6e75a4813b4ba91` |
| [#64](https://github.com/Gustav0ar/Self-RSS/pull/64) | `14c8bd42` | `074725daf3ba7d8d7a56f402ca1577738722cfe2` |
| [#65](https://github.com/Gustav0ar/Self-RSS/pull/65) | `1fc74a2d` | `e3741685dda5c54d853028a3e02ef0ce8212312a` |
| [#66](https://github.com/Gustav0ar/Self-RSS/pull/66) | `5ca7ed16` | `f9b222503e75a49cd688aaf76cd9e3c41fb9d7d8` |
| [#67](https://github.com/Gustav0ar/Self-RSS/pull/67) | `c173b2b1` | `c155fa302dc91340f1444a81fecd2ee27a77a1ee` |
| [#68](https://github.com/Gustav0ar/Self-RSS/pull/68) | `d0ae621a` | `0aaaae0ac31d8e141507272cf6b1f4726fdb8c25` |
| [#69](https://github.com/Gustav0ar/Self-RSS/pull/69) | `04131a14` | `372cac974936b9317b8464c58c4fb4985562b9b1` |
| [#70](https://github.com/Gustav0ar/Self-RSS/pull/70) | `f6bbaa34` | `116687fbac6975dbaa7bc24c4c1a6d66e90464d3` |
| [#71](https://github.com/Gustav0ar/Self-RSS/pull/71) | `a87b9ade` | `a12e57b0ceb76befae2bd34aa4ef2d8187935211` |
| [#72](https://github.com/Gustav0ar/Self-RSS/pull/72) | `fea614cb` | `b524e07dcb1bececed81fe21671e69ac6dafa317` |
| [#73](https://github.com/Gustav0ar/Self-RSS/pull/73) | `76793558` | `a0279a638f9fbb6772dfb702e7d7b60e53735bf1` |
| [#47](https://github.com/Gustav0ar/Self-RSS/pull/47) | Final documentation integration | Recorded in PR #47 |

PR #69 receives the restoration correction as `aa53fa9` and the outbox assertion correction as `04131a1`; its own complete 593-case JVM suite passes in `/tmp/android-premerge-pr69-final-unit.log`. PRs #70–73 are rebased on that correction. Their production package tree matches the combined candidate tested locally. The only package difference from `f394bd4` is the outbox assertion correction in `RssRepositoryTest.kt`. No production code or persistent schema changed during this further review. Fresh PR CI runs are #69 `34703984314`, #70 `34703984051`, #71 `34703982996`, #72 `34703984308` and #73 `34703983630`. Four duplicate runs caused by simultaneous stacked base/head updates were cancelled; each branch retains its complete fresh run. All required jobs in those runs passed before merging. The baseline-profile job is intentionally conditional and was skipped; physical performance acceptance remains open.
