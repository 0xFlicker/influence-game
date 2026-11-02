---
module: Influence alliance presentation
problem_type: integration_issue
tags: [alliances, house, narration, replay, durability, privacy]
---

# Author alliance introductions after conversation, before the next decision

Alliance conversations need an identifiable viewer entrance without exposing scheduler terminology. The House benefits from knowing the upcoming conversation when writing a teaser, while still lacking the next actual decision.

Run one exact-schema author batch after all selected conversations finish. Commit the saved copy in its own durable turn before closing the social phase. Combining authoring and phase entry would anchor the old-phase transcript to the new phase's event head, unnecessarily delaying complete-phase release until a later boundary. The authored cursor makes restart after commit free of another author call.

Store only participant IDs, the session-time name, session identity and the first-speech anchor as transcript metadata. Text follows the existing bucket-backed transcript storage path. Playback and the production catalog reorder by that structural anchor, retaining original source identities. Never infer membership or chronology from House prose.

The House receives completed dialogue, accepted canonical history, current-round messages and older dialogue connected through two alliance membership edges, with shared context adaptation. Prompt instructions permit editorial foreknowledge and restrained spoilers, but disallow quoted upcoming lines, conversation payoffs and predicted results stated as facts. Creative prose is not a factual authority or a contestant observation. Owner transcript authorization separately excludes these rows.

Provider exhaustion retains its evidence and omits the optional teaser. Silent sessions produce no beat. Existing games use structured session/event metadata for the alliance name and saved audience for attendance, with no historical regeneration.

Audio readiness also reconciles clip identities at an unchanged canonical head: accepted dialogue can grow without a new game event. The required post-commit audio hook waits for the track to be ready before phase closure, including after restart. Previously recorded clips retain their IDs and versions; only the new House line is synthesized. The logo follows the shared House narration treatment, without an extra text title.

Production source v8 carries alliance session/intro metadata. Pinned v3–v7 source projections omit the new fields so their accepted-source hashes and selection identities remain unchanged. Refresh Source explicitly to use v8; prepare a new bundle and encode a new output. Existing immutable bundles and videos are not rewritten.

The player picture has no scrollable containers. Casts over four members page on the shared clock, reserving at least 3.5 seconds per cast page; ordinary keyboard/click transport advancement remains available. Long narration pages in `HouseMessage`, the shared caption container whose border crosses the logo midpoint. Recorded alliance captions use the same in-beat container and read clock, avoiding a second caption overlay. Viewer, Source/Selected cut and export use the same layout.

Run the deterministic proof from `packages/web` with `bun run src/scripts/verify-alliance-presentation.ts /tmp/alliance-presentation-proof`. It compares real viewer/Studio/export pictures, audits required content bounds and the absence of scroll panes, checks logo placement, captures frozen caption pages, samples all cast pages plus entrance/read/exit/handoff, repeats seeks in reverse, and encodes two fresh H.264 clips through the production bundle preparer. Fixture recording PCM is compared with decoded encoded audio; no speech/model provider is called. Optional case names and `--width=1280`, `--width=640` or `--width=320` narrow a repeat check. The full Source case retains its opening/catalog and focuses the rendered range on the alliance sequence. Encoded cases retain offline `.bundle` directories with frozen media, static asset checksums, layouts and captions. See [presentation parity](../../presentation-parity.md) for the full matrix and bundle-refresh rules.

Local validation covered 108 matched frame coordinates at 1280×720, 640×360 and 320×480, including large casts, long names/copy, reduced motion, isolated speech/thinking and historical conversations. Maximum viewer/Studio/export mean RGB difference was below 0.001 on the 0–255 channel scale. Fresh encoded samples stayed within the 4-channel compression tolerance. Synthetic recorded audio correlated above 0.999 with less than 50 ms offset after AAC encoding. These fixtures prove rendering/binding and audio placement; they do not constitute a paid full-game or deployed editor-UI test.
