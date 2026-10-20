---
title: Influence open conversations, private huddle recall, and room playback
type: feat
status: implemented
date: 2026-10-19
---

# Influence open conversations, private huddle recall, and room playback

## Purpose and scope

Bring the successful Werewolf conversation behavior to Influence Lobby, Mingle, and simplified alliance huddles: bounded spoken output, sequential contributions, optional replies, meaningful silence, and private decision evidence. Make huddles watchable as room conversations after ordinary Mingle while keeping their existence private from other contestants.

The user subsequently authorized committing and implementing this plan, with full localhost API games of 6–8 players and a fresh aggregate $25 inference limit. The plan was committed first as `b1a7ffca`; the inspected baseline was merged `main` at `bde3e613`. Implementation is committed as `48029042`. See the [evaluation report](../evaluations/2026-10-19-influence-open-conversations.md) for verification, complete-game evidence, accounting, and remaining quality issues.

### Confirmed product requirements

- Use generated text size, not wall-clock duration, to bound conversation. Future TTS-based pacing is outside this change.
- Permit natural back-and-forth and silence. Do not require new facts as a condition of speaking or guarantee each player a speaking/pass opportunity before the allowance expires.
- Preserve feedback-informed retries for oversized messages, including the rejected text, exact measured size, allowed size, and unit.
- Retain thinking, available native reasoning, provider evidence, retries, failures, and usage for debugging. Passes do not become spoken messages or playback beats.
- Simplify huddles into House-selected private conversations for eligible alliances. Remove new huddle tactical proposal/commitment/response/contingency atoms and mandatory tactical outcome generation.
- Participants can update their private strategy and recall conversations they actually attended. Strategy is fallible interpretation, not the sole surviving evidence of dialogue.
- Other agents receive no new knowledge that a huddle was scheduled, occurred, or was skipped. Participant identities, transcripts, counts, scheduling details, and private execution progress must not disclose it.
- Agents may disclose or lie about alliances/huddles through speech. Such a disclosure is a claim heard by its actual audience; it grants no access to private records.
- Formal alliance formation, consent, membership, amendment, and closure remain separate and unchanged. Existing knowledge from those interactions or earlier disclosures remains valid.
- Show spoken huddles in room playback at their actual chronological position, including Studio/export. Spectator visibility must never become contestant knowledge.

### Recommended implementation choices

The following are concrete defaults for implementation and evaluation, not claims that the user has already selected the exact tuning values:

- Start Mingle with two bounded conversation rounds and one simultaneous movement boundary between them, replacing the current default of three one-turn beats.
- Start with a 320-byte individual speech limit and 400 bytes per participant per conversation; measure the entire round, including huddles, before increasing allowances.
- Retain current House initial placement and scarce huddle-selection policy. Do not combine this work with redesigning room allocation or alliance eligibility.
- Use the directed-handoff limit for groups of three or more; allow natural alternation for two-person rooms.
- Keep huddle thinking out of spectator room playback under the existing huddle audience policy. Private debugging retains it. Ordinary speaking-turn thinking keeps its existing authorized presentation behavior.

## Baseline implementation and affected boundaries

| Area | Pre-change source and behavior | Planned change |
| --- | --- | --- |
| Lobby | `packages/engine/src/phases/lobby.ts`: one serial speech per living player by default; `agent.ts` warns there will be no further reply | Replace fixed speaker passes and timing prompts with a bounded conversation cursor and strict speak/pass contract |
| Mingle | `phases/mingle.ts`, `mingle-turn-execution.ts`: three beats by default; each occupant acts once, then movements resolve simultaneously | Multiple sequential contributions per fixed room arrangement, room-local budgets, explicit movement intent handling |
| Durable execution | `game-runner.ts`, `durable-game-turn.ts`, `mingle-window-contract.ts`: one complete Mingle beat per accepted turn; alliance actions and huddles currently bundled into Mingle completion | Persist each accepted contribution and movement boundary; separate huddle scheduling/session completion from the broad completion turn |
| Huddles | `phases/alliances.ts`: one opportunity per member, accepted fact atoms, House interpretation, canonical outcome | Keep private session/audience records; remove new tactical atoms/outcomes and the mandatory interpretation call |
| Recall | `context-builder.ts`, `context-recall-plan.ts`: typed outcomes protected; raw huddle dialogue excluded from historical recall | Authorize dialogue by immutable participation, include recent exchanges before decisions, allow later relevant recall |
| Playback | `influence-production-source.ts` excludes huddle rows; alliance inspection can already show their speech | Add deliberate spectator conversation projection, chronological moments, room scene bindings, Studio/export support |
| Visual preparation | `visual-mingle-boundary.ts` prepares committed beat arrangements | Prepare committed conversation arrangements, including private huddles, without mutating ordinary Mingle occupancy |

The active format-kernel path is the primary target, including both Two Names social windows when applicable. Any live standard Lobby entry using the same runner must receive the new contract consistently. Inspect shared Reckoning/Tribunal Lobby entry points explicitly: use bounded discussion for their Lobby speech, but retain their stage-specific rules. Introductions, formal pleas, accusations/defenses, jury questions, ballots, powers, and retrospective speech are outside scope. Do not revive obsolete classic social execution paths to implement this feature.

## Conversation contract and scheduling

### Accepted output

Use an exact provider-native structured contract with speak/pass, speech, optional addressee ID, optional reply reference, and the existing private thinking/strategy fields. Movement fields exist only at eligible ordinary Mingle turns. Huddles and Lobby cannot issue movement actions.

- Speak requires nonblank text within the UTF-8 byte limit. Pass has null text, addressee, and reply reference.
- Addressing someone does not make group speech private to that person: all current room participants hear it.
- Addressees must be other current participants. Reply references must identify accepted spoken contributions the actor was authorized to hear; never expose pass IDs or gaps identifying private floor offers.
- A reply reference identifies evidence being discussed; it does not grant a scheduling handoff or require addressing that earlier speaker.
- Commit the contribution and its audience before preparing the next actor's context. Use canonical accepted coordinates, never prose parsing, to schedule or deliver speech.
- Preserve original accepted speech. No House rewriting, inferred tactical facts, separate should-speak call, or hidden consensus extraction.

Use the existing retry/absence policy. A length rejection receives the exact rejected speech and measurement feedback, with bounded retries. Failed attempts consume no spoken allowance. An exhausted provider becomes a private unavailable outcome, distinct from voluntary silence, without fabricated speech or a tactical decision. Context-size adaptation remains independent of output validation.

### Floor selection and ending

Use a frozen seeded order and least-recently-offered selection between directed exchanges. A spoken addressee may receive the next opportunity; it is not an obligation to answer. A pass returns control to the scheduler.

In every conversation type, pass/unavailable records, silent-player sets, last-offered counters, and pending floor queues remain execution/debugging data. Other agents see accepted speech only, without metadata identifying who declined to speak. Do not encode private offers in their contribution numbering or reference lists.

For groups of three or more, allow three consecutive directed handoffs: A → B → A → B. The final recipient may refer to earlier statements but may not address the immediately preceding speaker; they should address another participant, make a contribution to the group, or pass. Warn the preceding speaker that the next turn must redirect so they should not invite a fresh direct rebuttal. Scheduling uses structured addressees; do not add a prose classifier to police wording.

For exactly two participants, allow alternation without an impossible third-person redirect. Fair scheduling and directed handoff both lead to the other participant. Speech allowance and silence still terminate the conversation.

A conversation ends when its remaining allowance cannot cover the configured maximum contribution, or every current participant has passed/been unavailable since the last accepted speech. Speech resets that local silence set. Preserve distinct ending reasons for voluntary silence and unavailable participants in private diagnostics. Empty and solo ordinary rooms have no conversation calls.

No mandatory opening sweep or per-player speech reservation. Track unoffered participants for evaluation. Budget limits bound spoken output, not a small number of provider calls: many short speeches may still be expensive. Keep that distinction visible in diagnostics.

## Output budgets

Freeze policy values in the game's execution configuration so subsequent tuning cannot change saved interpretation.

| Conversation | Initial evaluation allowance | Notes |
| --- | --- | --- |
| Lobby | 400 × living participants bytes | One shared public allowance |
| Each ordinary Mingle room round | 400 × occupants bytes | Two rounds initially; freeze occupancy and allowance at round start |
| Each selected huddle | 400 × live session participants bytes | Separate allowance; no movement and no guaranteed speech |
| Individual speech | At most 320 bytes | Offer speech only with at least 320 bytes left; preserve the existing Werewolf cutoff behavior initially |

Charge only exact accepted spoken text, including its whitespace. Exclude JSON, IDs, thinking, strategy, production cues, provider reasoning, rejected attempts, and movement-only decisions. Passes consume zero speech bytes. Do not transfer unused allowance between rooms, rounds, or huddles; moving cannot replenish a room mid-conversation.

For eight players, these starting ceilings allow 3,200 Lobby bytes and up to 6,400 ordinary Mingle bytes, plus 400 bytes per participant across each scheduled huddle. Solo/empty rooms and early silence reduce actual output. Two Names can add another full social window. This is not an assertion that Influence will become shorter.

Agents see their own conversation's remaining allowance and what action follows it. Other-room byte usage and huddle totals are not contestant-visible. Do not add technical budget banners to the player. A user-facing progress design is a separate decision.

Keep provider reasoning limits separate from speech limits. Reuse current model policy initially and inspect saved reasoning for clipping or poor decisions before changing inference settings; a short speech is not evidence that little reasoning was needed.

## Lobby flow

Begin the normal round and assemble the public context as today, then run one bounded conversation. Replace per-player message counts and “you will not get another reply” instructions with actual remaining allowance and reply opportunities. Ending the conversation advances to the existing next phase; no new vote or alliance mutation is introduced.

Prompts invite answers, clarification, negotiation, humor, reassurance, changed positions, specific pressure, and useful restatement when someone misunderstood. Silence is appropriate when the agent has nothing useful to contribute, is waiting, or prefers not to disclose. Avoid instructions that simultaneously demand every turn drive the conversation forward. Lobby strategy should remain suited to public speech and the upcoming Influence decision, not Werewolf suspicion or elimination guidance.

## Mingle flow and movement

1. The House chooses initial placement through the existing validated assignment path. Freeze the first room arrangement and prepare its visuals.
2. Run each occupied room's bounded conversation. Preserve independent room state and budgets. Do not require cross-room concurrency in the first implementation.
3. At the single movement boundary, freeze all destinations, resolve them together through the existing room/player-follow resolver, and commit the next arrangement atomically.
4. Prepare changed scenes, then run the second room-conversation round. Finish ordinary Mingle and enter the existing formal alliance-action window.

### Movement without compulsory speech

- Each accepted first-round Mingle decision includes an explicit movement intent: stay, go to room, or follow player. Talk and pass both permit it. The latest accepted intent replaces the player's earlier intent, including an explicit return to stay.
- Intent is private until the movement boundary; current speech always reaches the current room. Prompts explain that departure is deferred and replies can still occur before departure.
- At the boundary, players who never received a conversation opportunity, including solo occupants, receive one movement-only decision. It offers no speech and does not reopen conversation. Freeze these requests against the pre-movement arrangement; no player sees another pending destination.
- Every player therefore has a movement choice without guaranteeing a speaking turn or adding a second decision for everyone who already supplied intent.
- Preserve existing deterministic handling of follow chains, cycles, invalid targets, and provider absence. Unavailable movement-only actors stay; an unavailable later conversation offer does not erase an earlier accepted intent.
- Second-round speech has no movement fields because there is no following ordinary room round. Do not record or render an unused final move.
- A room reaching silence ends only that room's conversation. Movement is resolved after all rooms close, and the second round receives fresh silence/scheduling state even when membership happens to remain the same.

Room-count visibility remains as currently allowed for ordinary Mingle; exact foreign-room identities remain hidden. A new arrival receives only messages they actually heard previously plus new speech after joining. Sharing a room now never grants access to that room's earlier dialogue. Do not let a foreign room's speech/pass count influence the entrant's prompt metadata or reply-reference numbering.

## Simplified huddles

After ordinary Format Mingle and formal alliance actions, retain the House's scarce selection of eligible active alliances. Existing eligibility requires at least two living members and excludes universal alliances. Preserve the current selection quota and repeat-session policy initially; use session history, not removed outcome counts, for House scheduling context.

For each selection, create a private immutable participant snapshot and run the same bounded conversation behavior with no movement. One player may attend multiple sessions; their knowledge accumulates only from sessions they attended. Finish each session explicitly before beginning the next and advancing to the existing format action. Two Names' initial/final social windows keep their canonical order; do not relocate older pre-vote/pre-Council sessions in historical playback.

### Remove from new huddle execution

- Tactical proposal, commitment, response, and contingency atoms and their validation/response-ID bookkeeping.
- Protected “official tactical outcome” records derived from those atoms.
- The mandatory House interpretation/summarization call after every huddle.
- New empty tactical outcome placeholders and UI copy expecting structured facts.

Do not replace these with a new extraction call or regex that turns dialogue into consensus. Formal alliance creation/amendment remains in its existing separate structured window.

### Retain as operational and dialogue authority

- Private House selection, stable session identity, alliance association, frozen participants, chronological boundaries, budget/scheduler cursor, and completion.
- Accepted original speech with immutable speaker/audience identity and stable evidence references.
- Private pass/unavailable decisions, strategy updates, thinking/reasoning, provider evidence and usage.
- Presentation scene bindings and selected room, kept out of contestant context unless independently meaningful there.

These records establish that a conversation happened and who heard it. They do not establish the truth of statements, agreed targets, consensus, promises, or future votes. Reuse Mingle conversation primitives where appropriate while keeping huddle session identity and audience explicit; a scope rename alone must not broaden access.

## Participant-only recall and existence privacy

### Replace the memory path before removing outcomes

Current recall excludes raw huddle dialogue and relies on protected typed outcomes. Removing outcomes before replacing that path is a release-blocking memory regression.

- During a session, provide the participant the accepted conversation so far and their existing private strategy. No other agent's thinking or reasoning enters context.
- At the participant's next consequential decision, include all newly attended huddle dialogue since their previous consequential decision as recent private evidence, rather than relying on lexical retrieval to happen to find it. Include it in an intervening strategy-reconciliation prompt if that prompt runs first, without consuming the next-decision guarantee.
- Preserve the source speech permanently. If recent context requires adaptation, use existing supported compaction with source provenance and normal continuity safeguards; do not invent a second compulsory huddle-summary pipeline or fail the game due to input size.
- Older attended dialogue becomes eligible for relevant historical recall, under the existing prompt-class policy. It is not promised permanent verbatim inclusion in every future prompt.
- Carry private strategy updates through the existing accepted gameplay/strategy boundary. Do not add standalone strategy-reflection calls or demand a strategy delta on every contribution.
- Describe dialogue as what a named participant said, and derived memory/strategy as fallible interpretation. Neither overrides canonical votes, membership, eligibility, eliminations, or results.

### Authorize before selecting or counting

Eligibility uses the immutable session-time audience and accepted speech identity, never current alliance membership, a matching display name, a room image, or a claim made in dialogue. Former members retain access to attended sessions; new members do not inherit old ones. A participant who passed still heard the session. Missing or ambiguous private audience evidence fails closed.

Filter before candidate counts, ranking, compaction, cache keys, receipts, and prompt construction. Use actor-visible evidence coordinates in contestant-facing references. Global event/session IDs, offsets, schedule indices, excluded counts, future floor queues, total huddle budgets, and producer rationale must not reveal foreign sessions.

Other contestants receive no “huddle scheduled,” “you were not selected,” “huddles completed,” or empty private-stage messages. Participant context may identify their own alliance and session, but cannot reveal how many other sessions exist. Huddle presentation rooms must not enter ordinary room counts or movement maps. House phase narration must not disclose private attendance or session existence. This is a data/prompt privacy requirement; provider runtime latency is not a promised anonymity channel.

A spoken disclosure is delivered only to its audience. It can inform those listeners' beliefs, but cannot grant access, certify a roster, retroactively expose speech, or mutate official alliance membership. Do not redact agent-authored disclosures merely to hide what the agent intentionally revealed.

Prove privacy differentially: adding, removing, or changing an unrelated huddle must not change a nonparticipant's assembled prompt, eligible recall, retrieval receipts, or contestant-facing metadata when their legitimate game knowledge is otherwise unchanged. Later public disclosures or actions can legitimately change that knowledge.

## Room playback, Studio, and read models

### Chronology and presentation

Create one explicit scene/session binding for each huddle. Show its actual spoken contributions after ordinary Mingle/alliance actions and before the subsequent action, using accepted chronological boundaries. Keep overlapping alliances as separate sessions even if the same players or physical setting recur. Display an appropriate brief alliance/session label if needed for spectator comprehension; do not add the removed technical facts banners.

Use the existing room dialogue director: establish the room, focus the speaker, present the original speech, return to the room, then advance. Passes have no thinking, fake `[PASS]`, empty speech, or floor-offer playback cue. An entirely silent session creates no empty conversation scene in the watch sequence; its private execution evidence remains saved.

Huddle speech is spectator-visible through the deliberate game-level projection already supported by alliance inspection. Huddle thinking/strategy/native reasoning remain under existing private access rules, even when the generic Show thinking setting is on. Do not widen generic public websocket or MCP transcript authorization as a shortcut to room playback. Add a bounded, sanitized spectator delivery/read path as needed for live watching and seek parity.

### Visual room selection

1. Search only prior eligible scenes in the same game's accepted prefix for an exact participant-set match. Never select a future scene or a superset containing extra people.
2. Reuse a ready scene only when frozen visual references, background/version, placements, and presentation requirements are compatible. Prefer the most recent compatible match with a stable tie-breaker. A group match alone is not proof that an image is reusable.
3. Otherwise choose an available physical room from the saved session seed and persist the selection. Prepare the arrangement for exactly those participants using existing visual storage/rendering boundaries.
4. Bind that scene to this session independently of ordinary Mingle occupancy. Reusing an image does not merge conversations or audiences.
5. Use the normal portrait fallback in nonvisual mode or when best-effort imagery is unavailable. Honor existing required-visual pause/recovery policy where explicitly configured.

Prepare scenes from committed session participants before visible dialogue begins. Gate the shared presentation clock on the selected image's readiness, including seek/load failure; never apply incoming head coordinates to a retained prior image. Use the same binding for live playback, seeking, Studio preview, and export.

### Inspectors and historical records

Update alliance panels, MCP/API reads, and postgame summaries to show attended conversations, session counts where authorized, and source-linked speech instead of a mandatory tactical outcome. Any optional editorial interpretation must be labeled as interpretation and cannot be gameplay authority. Remove placeholder copy such as “No structured huddle facts were recorded” for new sessions.

Keep completed saved games readable and playable in player, Studio, API, and MCP. Retain only historical decoding/projection needed for their accepted older huddle outcomes and formats; do not manufacture new facts or rewrite stored history. Remove obsolete tactical generation from the new live path. Plan rollout after active games finish; supporting old active execution across rollout is not a requirement of this plan.

## Implementation slices

1. **Conversation foundation and Lobby.** Introduce the smallest pure scheduling/budget state needed by actual consumers, strict output validation, feedback retries, accepted-turn persistence, and new Lobby prompts. Reuse proven Werewolf behavior without routing Influence through Werewolf rules or changing Werewolf gameplay. Avoid a general-purpose conversation framework.
2. **Ordinary Mingle.** Replace beat-wide conversation execution with per-contribution cursors, preserve simultaneous movement at the explicit boundary, add movement-only opportunities where missing, update inbox reconstruction, visual preparation, and both Two Names windows.
3. **Participant recall and simplified huddles.** Add audience-validated recent/historical dialogue memory, then remove new tactical facts and compulsory House interpretation. Separate scheduling/session/contribution/completion commits. Update House scheduling inputs, inspectors, and postgame consumers together so no temporary memory hole ships.
4. **Huddle room presentation.** Add sanitized chronological moments and scene bindings across live player, saved replay, Studio, and export. Keep session existence out of contestant projections and skip silent/pass playback.
5. **Whole-game evaluation and tuning.** Validate privacy and recovery deterministically, then run authorized full games through the localhost API. Review saved speech, thinking/reasoning, inference usage, and room playback; tune budgets or room-round count only from that evidence.

`AGENTS.md`, `CONCEPTS.md`, observability/local-evaluation docs, and affected simulation JSDoc were updated alongside implementation. The sections above preserve the implementation contract; the evaluation report distinguishes tested behavior from remaining tuning hypotheses.

## Verification and acceptance

### Deterministic contract and engine coverage

- Malformed/fenced/non-JSON outputs, missing/extra fields, blank or multibyte over-limit speech, invalid addressees/references, bounded feedback retries, and exhausted providers.
- A → B → A → B, final-turn redirect with earlier references, two-person alternation, all-pass endings, budget exhaustion before some players receive a turn, and all-unavailable endings.
- Exact byte accounting; rejected attempts and private cognition do not spend speech allowance; independent room budgets cannot be replenished by movement.
- Talk/pass with movement, latest intent replacement, never-offered/solo movement-only decisions, follow chains/cycles, simultaneous destination resolution, and no final unused movement.
- Recovery between any contribution, movement plan/commit, huddle selection/start/completion, and visual preparation. Replay accepted provider values without repeated charges, duplicate speech, lost strategy, or broader audiences.

### Recall and privacy coverage

- A silent participant recalls what others said; a nonparticipant cannot discover the session. Departed members retain access and new members receive no old transcript.
- Recent attended huddle reaches the next consequential decision even without lexical overlap; later recall respects prompt class and immutable audiences. Multiple attended sessions remain distinct.
- Foreign-session differential tests cover full prompts, caches, counts, receipts, metadata, IDs/references, and budget progress—not only visible speech arrays.
- Disclosures can spread as ordinary speech but neither unlock private reads nor become official facts. Spectator projections are never used to build contestant context.
- Strategy failures and successful passes retain sanitized private evidence without leaking it into speech or spectators.

### Browser and read-model coverage

- Lobby replies and passes; ordinary room transitions; no technical budget banners or pass beats.
- Spoken huddle after Mingle, multiple/overlapping sessions, exact-set visual reuse, mismatch requiring a new arrangement, deterministic room selection, portrait fallback, delayed image load, and seeking.
- Player, Studio, export, authorized API/MCP, and retrospective/context readers agree on chronology and audience. No huddle thinking appears through a generic Show thinking toggle.
- Saved pre-change games retain their original results, accepted dialogue, and historical reads. New games do not render empty tactical-outcome panels.
- Both Two Names social windows and normal endgame/results completion remain correct.

Run the repository's provider-free baseline, PostgreSQL baseline, typecheck/lint, and relevant classified browser suites before merging implementation. Follow the shared database isolation rules. The implementation requires these checks; planning alone did not require inference.

### Full-game evaluation

Use durable localhost API games so player, Studio, API, and MCP inspect the same tested artifacts. The implementation request authorizes a fresh $25 aggregate inference allowance for 6–8-player games. Keep an aggregate spend ledger, budget guard, game IDs, immutable sanitized evidence, and useful failure records. Use low-cost monitoring where available.

Compare whole games, not isolated exchanges: early social rounds, later strategy, small and crowded rooms, solo starts, overlapping alliances, repeated huddles, and Two Names' second window. Evaluate with the authorized models where budget permits, including Muse given the user's gameplay preference.

Measure actual speech bytes/playback duration, inference calls/cost, passes versus provider absences, missed opportunities, speaker concentration, direct answers, repeated content, movement-only overhead, useful movement, recall at subsequent decisions, and image reuse/rendering cost. Manually inspect whether promises and disagreements influence later decisions through actual recalled dialogue. Do not infer naturalness or strategic quality from turn counts alone.

## Main risks and decisions to revisit after evidence

- Two longer room rounds may still be slower or less mobile than three short beats. Initial round count and per-room allowance are tuning hypotheses; measure the whole social window including huddles.
- A participant's final movement intent may predate later room speech. Prompts must make intent persistence clear; measure regretted/stale movement before adding extra confirmation calls for everyone.
- Removing protected tactical outcomes can weaken long-term recall. The recent-evidence guarantee and historical retrieval are acceptance requirements, not optional follow-up work.
- Natural speech makes social commitments ambiguous. This is intended; the engine must not recreate tactical adjudication to make analysis easier.
- Shared replay surfaces can accidentally broaden private access. Keep spectator and contestant projections separate and test absence of session-existence signals.
- Huddle visual reuse can show stale cast/layout or bind to future imagery. Exact participants, compatible frozen assets, accepted-prefix lookup, and saved binding are mandatory.

## Source references

- `packages/engine/src/phases/lobby.ts`
- `packages/engine/src/phases/mingle.ts`
- `packages/engine/src/mingle-turn-execution.ts`
- `packages/engine/src/mingle-inbox-replay.ts`
- `packages/engine/src/phases/alliances.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/game-runner.ts`
- `packages/engine/src/durable-game-turn.ts`
- `packages/engine/src/mingle-window-contract.ts`
- `packages/engine/src/context-builder.ts`
- `packages/engine/src/context-recall-plan.ts`
- `packages/engine/src/alliance-huddle-outcome.ts`
- `packages/engine/src/postgame-analysis.ts`
- `packages/api/src/services/transcript-visibility-policy.ts`
- `packages/api/src/services/public-alliance-read-model.ts`
- `packages/api/src/services/influence-production-source.ts`
- `packages/api/src/services/visual-mingle-boundary.ts`
- `packages/engine/src/visual-scene-plan.ts`
- `packages/engine/src/production-moments/index.ts`
- `docs/solutions/architecture-patterns/owner-scoped-alliance-read-models.md`
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`
- `docs/solutions/ui-bugs/2026-10-12-mingle-thinking-before-room-image-load.md`
