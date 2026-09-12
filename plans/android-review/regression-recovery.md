# Android regression recovery

This follow-up starts at `2b7d569` after integration of PRs #46–75. It fixes the five regressions confirmed in the post-merge review, plus failures exposed while reviewing those fixes. The PR for `fix/android-regression-recovery` tracks hosted checks and merge status.

## Changes and acceptance

| Failure | Correction | Focused proof |
| --- | --- | --- |
| Reconnecting missed newly synchronized articles. | Reconnect refreshes Pager membership after invalidating counts. | ReadStateManager reconnect test verifies the membership event. |
| A remote bookmark for an uncached article never appeared in Saved. | Save and unsave receipts refresh membership after applying Room state, without reopening the selected reader. | Versioned and legacy receipt cases verify both save directions. |
| A deleted feed reappeared offline. | Accepted deletion removes its metadata and adjusts only its count scope. Metadata and article snapshots started before deletion cannot restore old membership. | Offline feed stream, delayed metadata GET, production Pager and delayed mutation-rejection cases. |
| Article revision history grew indefinitely and enlarged bulk reconciliation. | Retain at most 256 orphan revision records; protect cached articles, offline bodies, pending changes, legacy pins and observed IDs. Bulk operations exclude discarded history. | Shared JVM/device retention contract checks pressure, reopen, observer overlap, release, snapshot fencing and queued/offline preservation. |
| Changing reader mode on a neighboring page lost the previous page's position. | Retain each article's scroll intent through actual body replacement. User dragging cancels pending restoration. | Delayed preparation, repeated mode changes, recreation, renderer recovery and actual WebView navigation. |

Review also reproduced Text reading completion becoming disabled after memory trimming. Body readiness now follows the actual rendered body, so a renderer permission change cannot invalidate unchanged Text content.

## Review corrections

- A rejected read request may still hold the count scope captured before feed deletion. Rejection now reads the current persisted scope before removing the matching pending mutation.
- Search snapshots carry the epoch after their own admission. Pruning does not cause a successful page to be fetched twice, and cached server flags cannot outlive their revision history.
- Explicit query clearing retires in-flight article snapshots even when the orphan cache is below its limit.
- Failed force refresh reads the latest cached state after the request fails, preserving changes accepted while the request was pending.
- Serial observer replacement retains recently released state within the same 256-entry grace budget. Later pressure evicts released records, proving that references are not leaked.
- Reading state does not create cache rows or scan retention history. Existing read receipts also avoid retention scans.

## Data and lifecycle contracts

Room remains at version 10. No entity, exported schema, migration or destructive fallback changes. The retention budget applies only to unprotected cache history. Offline bodies, queued mutation identities and legacy pins remain protected. Existing upgrade tests still validate the supported historical schemas.

Observed IDs are retained only while their flows are collected. Overlapping collectors use reference counts, and cancellation releases those references in a short Room transaction. Final release records recent use so the app's bounded observation window survives immediate recollection. Network work stays outside the transaction and account commit lock. Snapshot validation and writes share a transaction so eviction cannot occur between the check and commit.

## Validation

The complete JVM suite passes all 646 tests. Repository lint and architecture checks pass. Full device, process-recovery and final build/lint results are recorded in the PR before merging.

This correction does not complete the remaining Android roadmap or establish physical-device frame timings or native heap leak measurements. Those acceptance items remain tracked in the implementation progress record.
