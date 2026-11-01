---
module: Werewolf Visual Mode
problem_type: ui_bug
tags: [werewolf, visual-mode, image-generation, staging]
---

# Preserve frozen Werewolf staging with supplied room crops

The distinct-region renderer omitted scene direction whenever a backdrop existed, and omitted individual placement positions entirely. Werewolf always supplies approved backgrounds, so its village seating, pack masonry seats and hunt foreground/background separation disappeared from provider prompts.

Restore `plan.direction.roomDirection` and each member's frozen placement position in populated-view prompts. Regional crop constraints remain in place. Generic repair `renderContext` defaults are deliberately excluded from staging: they describe the room library, not the frozen custom shot, and could tell Influence to reconstruct the entire room in every crop.

## Review triage

- Fixed the missing frozen direction and per-character positions for all three Werewolf purposes.
- Fixed the initial overbroad restoration that also treated generic repair defaults as custom staging. Added a regression proving those defaults cannot override an Influence crop.
- Verified that participant subsets, strict localization, wolf-form resolution, private evidence, accepted historical media and publication boundaries are unchanged.
- Added provider-mocked renderer tests using the production Werewolf planner for village, pack and hunt, plus the generic-repair regression. PostgreSQL testing was cancelled at the user's explicit request; these database-owned tests remain for CI.

## Paid local evidence

All three scene-only probes used the production planner, approved backgrounds, durable renderer and strict identity verification. Pack and hunt generated and verified actual wolf forms. No contestant turns or production writes were performed.

| Scene | Retained local game ID | Result | Cost, including forms |
| --- | --- | --- | --- |
| Village, 12 players | f1e8974c-659f-4e60-9b3b-4b0546a8a638 | Three distinct views; all 12 verified | $0.547921 |
| Pack, two wolves | 3a6f6260-af07-44fa-bf58-94778d3cd9d8 | Both verified, seated in masonry | $0.290560 |
| Hunt, two wolves and target | 2cac38fc-774c-47fb-871c-7c3262c1a8c3 | All verified; target foreground left, wolves behind right | $0.319403 |

Visual inspection confirmed the intended staging. This follow-up cost $1.157884; combined spend is $4.619763 of the authorized $15. All requests/responses, reference inputs, receipts and output images remain private in local DB/object storage and `packages/engine/docs/simulations/werewolf-staging-2026-11-01/`, including a local preview gallery. These samples demonstrate the requested scenes, not a statistical reliability claim.

Validation: provider-free baseline 3,233 passed, five skipped; type checks and lint passed. PostgreSQL suite explicitly skipped/cancelled at user request to avoid interference with other chats.

Correction: Werewolf supports at most eight players. The retained twelve-player village evidence above exceeds that supported size and is not representative Werewolf acceptance coverage. It is retained as historical evidence, not a supported-game test. The current probe and representative renderer fixture use eight players.


## Representative eight-player review

Werewolf supports up to eight players. Local game `87f143b9-b9a6-42a1-a92d-e082a265ce31` exercised the complete eight-player village path with two source views and automatic stitching. The final continuous image passed strict verification of all eight identities, with eight localized head anchors. Total scene time was 186.368 seconds, demonstrating why the former 180-second deadline was insufficient even for a supported roster. Cost was $0.686614; cumulative task spending is $6.100645 of $15.

The current Werewolf probe accepts an eight-player village roster. Added eight-player shared grouping coverage passed (ten provider-free scene-plan tests total); types and lint passed. Evidence and the preview are retained privately under `packages/engine/docs/simulations/werewolf-eight-player-2026-11-01/`.

Review also identified the CI village fixture collision: it first prepared an Influence lobby, then tried to write a different Werewolf plan at the same immutable boundary. The fixture now builds cast references without preparing that extra scene. The production immutable-plan guard is unchanged. PostgreSQL tests remain skipped locally per user instruction; the updated fixture is for CI.
