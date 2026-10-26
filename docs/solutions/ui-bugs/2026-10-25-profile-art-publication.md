---
module: character-artwork
tags: [agent-profile, frozen-identity, werewolf, websocket, cutouts, exports]
problem_type: architecture
date: 2026-10-25
---

# Publish corrected artwork through the reusable profile

The temporary local appearance mapping replaced frozen character presentation in
game detail, episode previews, WebSocket snapshots, visual metadata, Werewolf watch
windows and both production source builders. It has been deleted, including its
reader, public/producer image routes, gateway registration, launcher setting and
dedicated tests. No replacement mapping or compatibility path remains. Historical
review receipts retain the old URLs as evidence only.

WebSocket sends are synchronous again after the normal visibility check. The
per-game queue remains because asynchronous visibility checks must not reorder
reconnect snapshots and durable publications. Regression coverage gates each check
and verifies snapshot/publication/snapshot ordering without mutating canonical state.

The ordinary Werewolf reference reader now carries confirmed head geometry from the
immutable content revision. It requires the matching body hash, source URL and valid
rectangle. Watch players, nested snapshots, night-before snapshots and export all
use that same frozen geometry. No mutable Agent Profile lookup or name matching is
involved. Source hash validation remains strict: earlier source selections containing
the removed mapping, or lacking this frozen head geometry, need a new selection.
Already rendered movies remain untouched.

## Local installation

Gemini Pro profile `8590e89f-d12e-436f-8f0b-fa56df9f4e2b` now uses approved no-crest
male-android artwork from `docs/research/2026-10-25-gemini-no-crest/published-assets/`.
The operator used the existing `storePublicAvatarImage`, `exportCharacterPortrait`
and `updateOwnedAgentProfile` services, the same publication boundaries used by the
normal profile workflow. The source has a new opaque local public-storage key;
portrait cropping reproduced the reviewed portrait hash. The submission captured
both images into the durable private payload bucket and recorded head confirmation.
Readback verified both hashes and byte lengths before recording completion.

- Accepted content revision: `cbc481ef-3a1d-4d6b-b4b9-94018f421014`.
- Source SHA-256: `a85dff2140e482f56f0e10406726599e129642f0a9d69bc113674124fe44d04e`.
- Portrait SHA-256: `259d78af8fc0cf436c39bebd9925ed09b7d63169d6cee995780b5949954b8c1a`.
- Head rectangle: `{x: 0.427, y: 0.013, width: 0.14, height: 0.122}`.
- Normal BiRefNet job: `edd1c095-2197-45d1-a0cb-b3c0ffa4b61f`, ready after one attempt.
- Derived cutout SHA-256: `c34436d356809c0c515197d218ba8c2b30db6017237d23a40bdd8d2edcbe67f3`.

The cutout CLI discovered only the new source for this agent. It ran the existing
Docker image at 2 CPU / 16 GiB, with 20.95 seconds of inference. No old source hash
was rebound. The general backfill, async demand system, cutoff selection and strict
committed-playback checks were not changed. The preceding backfill work was already
committed and no concurrent cutout worker was running.

Installation and live HTTP/export proof are preserved in
[profile-installation.json](../../research/2026-10-25-gemini-no-crest/profile-installation.json)
and [normal-path-verification.json](../../research/2026-10-25-gemini-no-crest/normal-path-verification.json).
Approved source files, prompts, earlier review bundles and receipts are unchanged.

## Historical appearance and new demonstration

These four local demos now show their original frozen Gemini portrait and the normal
cutout of their original body source:

| Game | ID | Kind |
| --- | --- | --- |
| neat-violet-moon | ddfa4f77-ffd5-4191-85bb-4f4c67b97200 | Werewolf |
| ultra-violet-quartz | 9437c80e-b028-47f6-83ae-e4bb6b0d2fed | Influence, suspended |
| hard-smoke-rune | f1fe7318-72c6-46f4-bb98-e4a4bb54692e | Werewolf |
| bare-sand-nest | 7362d8ec-52e7-4f93-81e1-3b08c745d4ca | Influence |

All four served portrait hash `928c00b0d47826b90f908d8e44137fa638a5ae6ac57a744bf989b55989370be6`
and original-source cutout hash `ff2635159c574e0d46e22e90ae10ed9e140ab8ac478ae6bb0a6d4772a5e75d2d`.
All four production sources could be read twice with the same new fixed snapshot.
The browser also loaded and advanced `hard-smoke-rune` through its opening into
Night 1; its original Gemini portrait remained visible. The
[historical playback screenshot](../../research/2026-10-25-gemini-no-crest/historical-frozen-playback.png)
records that identity independently of the new lobby.
Before/after fingerprints match for 312 Influence events, 257 Werewolf events and
16 Influence seats; these demos had no original visual-artifact rows to rewrite.
Previous content revisions were also verified unchanged.

New unlisted waiting lobby `dark-cyan-oak` (`e8008433-8144-46bf-ba6f-82308a9c0b49`)
contains the corrected Gemini profile through normal admission. It was not started.
Browser inspection confirmed the normal cast card renders the approved male android;
the [portrait screenshot](../../research/2026-10-25-gemini-no-crest/normal-profile-lobby.png)
is retained with the source review evidence.
Provider-free regression tests create and freeze both game kinds using the exact
approved source, then prove old games and fixed exports survive another profile edit.
No paid generation, simulation, production publication or deployment occurred.

## Validation

- Provider-free suite: 2,999 passed, 5 skipped, 0 failed. The initial sandbox run
  could not bind test HTTP servers; the required rerun with local socket access passed.
- Workspace typechecks and linters: passed.
- Focused WebSocket, visibility, cutout/backfill and production-source regressions:
  73 passed, 0 failed; the new approved-profile/new-game regression passed separately.
- Final episode/profile rerun: 16 passed, 0 failed. It supplies
  `JWT_SECRET=art-cleanup-test-only`; the
  standalone episode route fixtures need that test-only setting (the full suite
  provides it through earlier fixtures).
- Full PostgreSQL suite: 2,231 passed, 0 failed across 197 files, run sequentially
  against local PostgreSQL (684.91 seconds).
- Local Docker inference, stored hash/length verification, all four historical
  HTTP image reads and pinned export-source rereads: passed.
- Source audit: no runtime reader, route, configuration reference or special Gemini
  artwork branch remains. Historical review JSON retains old URLs as evidence.
- `git diff --check`: passed.

Full check logs are retained locally at `/tmp/art-cleanup-tests-unsandboxed.log`,
`/tmp/art-cleanup-postgres.log`, `/tmp/art-cleanup-check-verified.log`,
`/tmp/art-cleanup-focused.log`, `/tmp/art-cleanup-profile-test.log` and
`/tmp/art-cleanup-final-focused-verified.log`. The initial standalone attempt without
the test JWT is retained in `/tmp/art-cleanup-final-focused.log`.

## Production still required

Follow [normal profile publication](../../deployment/character-art-replacement.md)
with separately authorized production uploads, verified source/portrait objects,
the current production profile revision and confirmed source geometry. Follow the
[cutout rollout runbook](../../deployment/character-cutouts.md) for production worker
prerequisites and bounded processing. Demonstrate the update in a new game; never
rewrite historical games to recreate the temporary appearance.
