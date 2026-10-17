# Game retrospective contract

The contracts in [retrospective.ts](../packages/engine/src/retrospective.ts), each game's canonical reducer and the immutable private input schema drive the implemented feature. The [frozen context compilers](game-retrospective-context.md) supply speaker order/capacity admission, and [strict invocations](game-retrospective-invocation.md) accept only final speech. Both existing runners, completion settlement, API/MCP delivery, replay, Studio/export and simulations use this boundary. See [runtime and recovery](game-retrospective-runtime.md) and the [task ledger](plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md) for local proof and separately scoped model/deployment acceptance.

## Outcome and final execution boundary

The original outcome is immutable game authority. `RetrospectiveOutcomeSource` identifies its game kind, game ID, canonical event sequence and SHA-256 event digest. The event digest uses canonical JSON, matching Influence's existing event hashing. This anchor stays distinct from the final event head used to seal transcript, costs and settlement.

Influence derives the anchor from `jury.winner_determined` or the accepted elimination that leaves one survivor. Werewolf derives it only from its own `werewolf.completed` outcome event. Neither adapter parses transcript text. Their projections keep original roster and outcome evidence alongside a retrospective projection. Retrospective records cannot revive contestants, alter factions/results, or resume gameplay.

The chosen Influence execution cursor is the closed `retrospective` kind with three stages:

- `initialize` has no mutable data bag. Freeze the private input and canonical definition at this frontier.
- `statement` contains `definitionHash` and a zero-based `ordinal`. Canonical progress determines the actor; the cursor does not duplicate speech or order.
- `complete` contains `definitionHash`. Validate and commit completion proof before entering the existing `terminal/commit_game` cursor.

RT-04 changes every former terminal exit into a nonfinal XState `retrospective` state and redirects its cursor to `initialize`. A committed completion record permits a dedicated `RETROSPECTIVE_COMPLETE` transition to final `end`; it alone emits transport `GAME_OVER`. The machine cannot choose completion based on the existence of a winner or on model prose.

Werewolf has a distinct `retrospective` phase. After its gameplay result, only retrospective initialization, the next accepted statement, and retrospective completion may follow. The reducer already validates these records and preserves roles, deaths, faction outcome and gameplay history. RT-05 extends its step driver to prepare and execute these slots. Both runners now drive the complete epilogue before execution ends; see the [runtime](game-retrospective-runtime.md).

RT-06 retains `games.status = in_progress` and normal owner fencing through that continuation. Only completion proof permits terminal settlement, `completed`, lease closure and completion-triggered jobs. Exhausted required-speech failure suspends the same run with its accepted prefix; no silent skip or fabricated speech qualifies as completion. RT-07 exposes the canonical result independently of operational completion.

## Canonical records and completion proof

| Purpose | Influence event | Werewolf event |
| --- | --- | --- |
| Freeze source, input and order | `retrospective.started` | `werewolf.retrospective_started` |
| Accept one final speech | `retrospective.statement_recorded` | `werewolf.retrospective_statement_recorded` |
| Prove the complete epilogue | `retrospective.completed` | `werewolf.retrospective_completed` |

Influence records use public `RETROSPECTIVE` envelope phase and payload version 1. Werewolf retains its own envelope. The shared payload contract is version 1; the prompt is `retrospective.v1`. Unsupported versions, missing fields and extra fields fail exact validation. No generic JSON bag, permissive decoder or historical backfill path is introduced.

The definition contains original outcome source, `inputHash`, `speakerIds`, prompt version and `definitionHash`. The latter hashes the complete definition body excluding itself, so a changed context/order cannot retain the same identity. The speaker list must be an exact permutation of the original game roster: duplicate, missing or foreign actors fail. The definition can be initialized once, after the outcome. RT-02 compiles game-specific exit/survivor ordering from each game's authority.

Each statement records zero-based ordinal, actor, definition hash, exact prior-statement hash, prepared-request hash, accepted provider logical-call ID and original speech. Its event sequence is the stable source identity; no independent statement ID or mutable queue is required. A provider acceptance cannot author two slots.

Prior references include canonical sequence, ordinal, actor and a hash of the exact `{speech}` value. Requests freeze the full ordered list plus its hash, game ID, definition/input hashes, actor and ordinal. `prepareRetrospectiveRequest` uses only the accepted canonical prefix. Live provider preparation must supply the exact earlier speech text corresponding to those references, not summaries or a speculative uncommitted prefix.

Completion includes `definitionHash`, `statementCount`, and the hash of every ordered statement reference. The reducer accepts it only after all original contestants have exactly one accepted speech in the frozen order and rejects any later retrospective record. Last-speech acceptance and completion remain separate canonical facts, allowing explicit recovery between them. An outcome alone, matching count alone, or forged prefix digest cannot prove completion.

## Private input and limits

`RetrospectiveInputV1` contains the outcome anchor, chronological sections and separately quoted dialogue. Each section names its phase, source range and factual summary. The ranges must cover every canonical event from 1 through the original outcome without gaps, overlap or future events. Dialogue includes a canonical anchor, exact canonical-event/transcript source reference, actor, scope, recorded audience and original text; a future quote is invalid. RT-02's exhaustive fact allowlists and source fixtures establish account coverage and disclosure; contiguous coordinates alone do not prove a factually complete account.

The input's SHA-256 canonical JSON digest binds it to the public definition. `assertRetrospectiveInputBinding` rechecks this on storage/recovery. Freeze original character and own game-specific strategy through the existing game setup; do not put opponents' strategy, thinking, raw prompts or provider logs into the shared dossier. Reading a public statement never grants access to the private input.

Input size is not an acceptance or suspension condition. Migration `0118_retrospective_input_size` removes the former 256 KiB database constraint without rewriting existing inputs or hashes; the engine and writer no longer impose that ceiling. Whole-roster preflight records worst-case serialized sizes for observability even when they exceed an advisory budget. Exact shape, source, hash, roster and continuity validation remain enforced. Existing JSONB inputs are an explicitly authorized immediate-repair exception: the [highest-priority storage migration](refactor-queue.md) must move every existing retrospective input to private bucket storage, rehearsed on local/staging data, before addressing all other binary/document paths. Provider context-overflow adaptation remains a separate open item in that queue; this repair does not claim to enlarge provider context windows.

The exact native tool is `submit_retrospective`, with action `retrospective-statement` and payload `{speech: string}`. Speech is nonblank and at most 2,000 Unicode code points. The current prompt targets 40–75 words and asks for at most 1,000 code points; the strict artifact ceiling remains 2,000. Accepted text is preserved verbatim, including whitespace. Actor, ordinal, outcome, addressees and other facts never come from the speech. There is no pass, fallback statement, strategy update or required private-reasoning field.

`retrospectiveSpeechArtifact` uses the existing exact structured-output registry. Complete JSON/native payload and accepted journal value follow the same strict shape. Plain/fenced/embedded prose, `{}`, null/blank/oversized speech and additional fields fail. RT-03 invokes this artifact inside the common provider-attempt boundary and proves retries/exhaustion there; RT-01 does not add model calls or a second retry policy.

## Storage, provider binding and version policy

[0115_game_retrospective_inputs.sql](../packages/api/drizzle/0115_game_retrospective_inputs.sql) adds one private row per game. Its primary key is `game_id`; scalar columns pin contract version, outcome sequence/digest and input digest, and JSON stores the bounded input. Foreign-key cascade supports normal game erasure. Shape/source/size constraints reject mismatches; an update trigger makes all row fields immutable. No backfill, progress counter, accepted-speech table or polling index is needed.

Future writers insert that row and canonical start under the existing owner/transaction fence and verify the actual game kind and accepted outcome before insert. Database shape constraints do not substitute for semantic input validation or canonical-source verification. Request slots and runtime progress belong to the existing turn/execution mechanisms.

Influence uses the existing `durable_turn` semantic coordinate `(turnId, subcallSlot)`, with one retrospective speech subcall bound to its prepared request. Werewolf uses its existing game-scoped `werewolf_action` sequence coordinate and a distinct typed retrospective request in `werewolf_turns`; RT-05 extends that prepared-request union and exact journal validator together. It never dispatches a postgame slot as `discuss`, `introduce` or a target decision. Accepted provider IDs in canonical records must be checked against the committed journal receipt under the same owner epoch before write. RT-01's pure reducer cannot establish provider receipt authenticity by itself.

No outer durable-turn or provider-coordinate version bump is needed: their envelopes and existing coordinates remain unchanged, and the cursor gains closed variants. New retrospective payload/private-input contracts start at version 1. RT-05 moves fresh-run Werewolf configuration/writers to rules v8 when automatic retrospective execution replaces stop-on-outcome. Existing v7 games remain supported with their original stop-on-outcome boundary, replay and Studio access; the shared reducer validates the unchanged gameplay contracts for both versions. Earlier experimental versions remain unsupported. Do not silently retrofit generation or rewrite a v7 game's history.

## Verification

Provider-free fixtures reject duplicate/missing/foreign actors, changed definition/context bindings, wrong outcome sources, statements before outcome, skipped/repeated slots, reused provider acceptance, changed prior hashes, incomplete/forged completion and writes after completion. Influence failures do not mutate its projection; Werewolf outcome/deaths/roles remain unchanged. Cursor fixtures reject arbitrary fields/stages and invalid ordinals. PostgreSQL tests cover one-row identity, source/version/hash/size constraints, immutable updates and game-erasure cascade.

Required baselines are `bun run test`, `bun run test:postgres`, and `bun run check`. For this checkout, the shared local test database had an existing migration/table mismatch (`werewolf_lobby_seats` absent); verification uses a separate task-specific database with the complete migration chain. Preserve the shared database rather than resetting it. All new API tests use `setupTestDB()` and its process advisory lock. No live model, staging, deployment, browser epilogue or encoded export is claimed by RT-01.
