---
title: Werewolf trailer story boundaries inside the House renderer
date: 2026-10-05
module: House postgame media
problem_type: architecture_pattern
component: media_renderer
tags: [werewolf, house, trailer, spoiler-policy, music, remotion]
---

# Game-specific story, shared media mechanics

W5 adds an approved Werewolf teaser to the existing Influence trailer renderer. Do not manufacture Influence final-vote/winner facts to fit its manifest. Use a discriminated schema-2 contract and cohesive game modules; keep Remotion sequencing, serial rendering, posters, captions, audio muxing, checksums and cleanup shared. After the operator approved the sample/policy/score, the shared coordinator and worker gained Werewolf dispatch. Keep per-game enqueue locks, audience settlement, media visibility and last-ready replacement semantics shared.

A Mystery House Cut is safe for its completed-game audience, but may explain later consequences. For the first teaser policy, resolve canonical public introduction/first-discussion references before the first ballot. Require all references of a Cut to fit, then use only an exact attributed quotation. Do not copy its title, context, angle or payoff into a teaser. Never derive accepted game facts from dialogue. Render only match-frozen normal character portraits, not wolf forms. Serialize an allowlist rather than reducer state.

This conservative policy produced zero eligible Cuts for `hazy-ruby-sand`. A short cast/premise teaser is a valid output, not an excuse to add filler or leak an outcome. Pending editorial work waits; failed or empty settled work permits cast-only output. Expanding the teaser's evidence boundary is an editorial decision to review against a real sample.

Music length follows picture. Werewolf uses a single hash-pinned full Suno source from zero with an end fade; Influence retains its prepared duration matrix. Missing/wrong/too-short music must fail explicitly before expensive rendering. Local asset paths are not deployment contracts. Audio-prefix correlation and ffprobe validate the export mechanically; only the operator can approve the finished edit and score together.

Use an isolated test database when worktrees have divergent migration histories. Do not repair the shared test schema incidentally. Keep renderer, browser, local durable delivery and external publication evidence distinct. Current proof and artifacts are recorded in [W5](../../plans/2026-10-05-001-feat-werewolf-trailers-release-assets.md).


One integration trap: the public media route originally sat behind an Influence-only 409 guard. Put shared postgame media beside shared results/Cuts and authorize visibility at that route; do not special-case the client around an Influence error. Test the outer router, not only a service function.

Use repeatable-read snapshots for standalone local review; inside the coordinator, read under its existing game lock rather than opening a nested read-only transaction. Read services accept the database operations they need (`select`) so transactions can reuse them without unsafe casts. Type the pending-editorial condition; corrupt canonical history must not become indefinite waiting.

Rendering from a second local worktree can fail because that checkout lacks the original crop files. Point the isolated test asset server explicitly at the source upload directory and adapt only local URLs in the disposable copy. Do not restore or regenerate profile artwork to satisfy a trailer test.

The shared video element needs `crossOrigin="anonymous"` for captions served from the media storage origin. Checking that a `<track>` URL exists is insufficient: browser acceptance must wait for the track to load and inspect its cues while actual video playback advances. Keep storage CORS, caption readiness, range reads and deployment proof separate.
