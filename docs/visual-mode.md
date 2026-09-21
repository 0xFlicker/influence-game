# Visual Mode

## Approved behavior

Visual Mode is a default-off, creation-time game option. It generates Lobby, up to five Mingle rooms, Tribunal and Finals conversation scenes. Introductions, ballots, diaries and farewells use framed PFPs; format resolutions retain canonical result choreography. No image generation occurs for those portrait/procedural beats.

Room art direction is defined in `packages/engine/src/visual-mode.ts`: ivory/oak/rust Lobby; green garden nook; terracotta kitchen corner; blue reading lounge; ochre music room; plum-and-walnut Den; charcoal/dark-wood Tribunal; pale-stone/brass Finals. Furniture inventories are staging suggestions, never game occupancy limits.

**Updated bubble decision:** show one active bubble per displayed room, then hide it after message-length reading time. Do not retain every player's latest message. The initial timing is 200 words/minute plus one second to orient, with a three-second minimum and 200 ms entrance/exit fades. Long messages are not capped. Use the presentation clock for pause, speed, replay and expiry; changing rooms must not restart expired bubbles.

Agents need a full-body reference plus character performance instructions. Missing references generate before play. Only verified image-capable provider entries may receive annotated room images. Observable cues from current occupants supplement the still image; private thought and strategy remain separate. Cues do not execute game actions or independently trigger renders.

OpenAI is primary for generation, with xAI on availability failures. Affected gameplay waits for matching verified scenes. Failed verification or exhausted providers pauses for operator recovery. Track costs without a cap. Retain receipts and uncertain-attempt records to avoid duplicate paid requests after restarts.

## Implementation status

This branch is in progress; Visual Mode is not yet exposed as a runnable game option.

Implemented foundations:

- Explicit image attachments in provider-neutral invocations, compiled to OpenAI Responses and Katana chat formats; unsupported models reject attachments. Luna and Katana Grok 4.6 have verified capability entries.
- Eight room definitions, explicit phase mapping, scene/cue/anchor types and strict localization validation.
- Final-image localization and numbered image annotation in the API service.
- Timed scene and portrait presentation, Mingle room pinning, anonymous bubbles, retained-image loading states and a presentation-director clock adapter. Full watch data integration remains pending.
- Deterministic staging plans using explicit House alliance groups, preserved furniture positions, overflow staging without capacity limits, and batches of up to four characters.
- Durable image/localization reservations, saved outputs, explicit uncertain-attempt reconciliation, retry generations, and stale-result fencing. Immutable game-scoped artifacts and scene acceptance reuse unchanged and empty rooms.
- A renderer that builds small groups, assembles large casts, harmonizes the final scene and verifies identities before acceptance. Provider-mocked PostgreSQL tests cover the full service pipeline; live visual quality of this production pipeline remains unverified.
- An awaited durable agent-call hook and an owner-fenced scene-context reader. The reader checks committed turn heads, frozen profiles and exact room membership; portrait and ballot methods receive performance instructions without imagery. The game lifecycle has not yet installed this hook.
- Mingle execution is split into serializable initialization, beat and completion functions. Movement remains simultaneous at the end of each beat. The durable coordinator still needs to persist these individual boundaries; the context reader rejects uncommitted Mingle assignments.
- Exact optional cue contracts in agent turns, with malformed-output rejection. Runtime cue collection and sharing remain pending.
- Full-body reference and performance fields through profile storage, authoring API/MCP and editor, including draft/create recovery. Generated reference completion remains to implement.

Live localization verification on 2026-09-21 used both prior twelve-player wide arrangements. All 24 identities were correctly marked above their heads in visually inspected numbered outputs. Temporary evidence is in `/private/tmp/visual-mode-localization-proof/`; no generated media or research runners are committed. This proves those two samples, not general localization accuracy. Actual speech-bubble browser verification remains pending.

Remaining work: lock and publish room assets; reference generation with safe completion; automatic receipt pricing and operator recovery API/tools; committed game scene boundaries and context; cue persistence and producer exports; creation admission; live/replay watch data integration; live-provider and browser verification. The current service tests do not prove these runtime behaviors.

Research code is archived separately on `codex/visual-research` (`089a91db`). It is not a production dependency.

## Verification checkpoint (2026-09-21)

- Provider-free baseline: 1,702 passed, 5 skipped with local network access. A subsequent focused run passed 23 durable-runner and visual-boundary tests, including cancellation while scene preparation is pending.
- PostgreSQL baseline: 1,581 passed. Includes durable render/localization reuse, uncertain attempts, retry fencing, scene acceptance, stale-result checks and owner-fenced context reads with mocked providers.
- Workspace typechecks and lint passed. Focused Mingle tests also verify serialization between beats and reject premature completion; agent tests cover room-audience rejection and diary image omission.
- No new paid requests were made during the durable pipeline implementation. Production pipeline visual quality, browser integration and game-runtime behavior are not yet verified.

The fifth Mingle room is approved: the Den uses muted plum upholstery, warm grey plaster, walnut furniture, a low coffee table and simple wall sconces. Sofa seats, armchairs and standing positions follow the shared staging inventory. The existing `ceil(alivePlayers / 3) + 1` room-count rule remains unchanged, including five rooms at 10–12 players. There are now eight distinct setting definitions; the Den background still needs generation and visual inspection alongside final asset preparation.
