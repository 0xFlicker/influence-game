# Screenshot-free preparation: both games and complete openings

2026-11-03. Local experiments only; no product implementation or dependency changes.
Uses the same renderer, browser, saved media and sequential measurement settings as
[influence-followup.md](influence-followup.md). Disposable scripts, logs, copied
bundles, movies and decoded hashes remain in `.renders/video-preparation-proof-2026-11-03/`.

## Result

All eight movies match their corresponding PNG-preparation reference exactly in
decoded video frames, frame timestamps and decoded audio. This covers 6,258 decoded
frames: two copies each of Werewolf's complete 999-frame opening, Influence's
complete 1,530-frame opening, and a 300-frame gameplay sample for each game.
Both use normal motion at 1920×1080/30 fps, with all output frames rendered and
unchanged encoding/audio. Werewolf coverage includes the house video, title/cast,
door video and transitions. Influence covers entrance video, title/cast and the
end of its opening. Movie rendering used four tabs in both arms.

Werewolf preparation was freshly rebuilt in both arms: 34.310 seconds with PNG
capture versus 16.220 without screenshots. Its entire prepared manifest matches.
Influence reused the prior 283.965-second PNG baseline and ran another fresh
screenshot-free prepass in 78.904 seconds. That manifest does **not** match exactly.

Only Influence's layout map differs: one empty-text speech-layout key has height
970.442 in the reference and 484.22 in this run; other key coordinates agree.
All common layout values and all 381 page entries match. The changed key set is
identical to the prior JPEG-prepass result. Earlier screenshot-free runs matched
exactly, so these experiments expose preparation variability; they do not isolate
its cause to screenshot suppression. A fresh repeated PNG control and tracing the
empty-text layout's lifecycle/consumers are needed before deciding it is harmless.
Do not silently discard this key from comparison to manufacture a pass.

## Decision

The tested video output is preserved, including complete openings in both games.
**General preparation equivalence is not yet established.** Keep screenshot-free
preparation experimental until the differing measurement is explained and its
reachability in output is established. The API also sets `videoEnabled: false`
during measurement; these successful video samples do not prove every future
video-dependent layout is unaffected. No full-match movie, reduced-motion matrix,
viewer/Studio parity or native worker qualification is claimed.

Machine-readable checks: [video-preparation-proof.json](video-preparation-proof.json).
