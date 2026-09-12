# Design comparison

Open each direction and use the scenario selector. All content is synthetic and no network or account actions run.

- Queue first: strongest scanning density, bottom navigation on phones, focused reader after opening an article.
- Reading first: larger editorial titles and reading typography, top navigation, more breathing room.
- Library and reader: compact subscription rail and concurrent list/reader on wide windows, focused reader on phones.

The common controls demonstrate refresh as one four-stage operation, offline availability/filter, search with retained results, partial content, recoverable failure, saved/download controls, feed drafts, text scale, and reduced motion.

Check phone portrait, narrow landscape, a 1024px tablet, 200% browser text enlargement, keyboard focus, and screen-reader labels. The explicit large-text toggle supplements browser scaling. All three directions keep black backgrounds and white primary text. Animations are finite and respond to state changes; there is no spinner or shimmer.

Click an article, play the simulated audio, then choose Next or Back. Playback state resets to paused. Real provider playback, native Android gesture physics, OS process restoration and TalkBack must be verified in the Android implementation, not inferred from this mock.

Settings shows temporary cache separate from retained downloads. Remove downloads keeps bookmarks. Feed submission in the editor-failure scenario keeps the draft and displays a local error. Session/server/sign-out management and OPML are explanatory actions here; the full existing capabilities must remain in the Android app.

Publishing and user selection are pending. `html-communication` is unavailable, so an alternate publication method requires the requested approval before publication.
