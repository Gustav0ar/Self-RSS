# Android design selection

Selected direction: pending

The three local mock directions are ready for review. No real Android layout/copy implementation is approved by this record until Gustavo chooses the applicable direction and states.

## Shared proposed behavior

- Show one stable refresh status through final reconciliation. Keep cached content usable.
- Saving retains readable text; image downloads follow the Wi-Fi setting and expose partial failure.
- Removing downloads keeps bookmarks. Clearing temporary cache preserves retained downloads and queued changes.
- Pause media on page/tab/background transitions. Returning to an article does not autoplay.
- Use finite 160ms reveals, gesture-driven navigation, and no animation when reduced motion is enabled.
- Keep drafts visible after failure. Close editors only after the matching successful operation.

## Remaining decision

Choose Queue first, Reading first, Library and reader, or specify a combination. Typography, density and navigation from that choice become the UI implementation contract. The mock scenarios may be amended before implementation.
