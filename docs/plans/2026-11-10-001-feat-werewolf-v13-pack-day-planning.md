---
title: Werewolf v13 pack discussion and next-day planning
type: feat
status: complete
date: 2026-11-10
scope: implementation authorized
---

# Werewolf v13 pack discussion and next-day planning

Give the wolves a private conversation with two explicit jobs: choose tonight's
attack and prepare for tomorrow's discussion and vote. Agreement must no longer
end the conversation immediately. Each wolf gets at most **three turns total per
night**, including target negotiation, strategy speech and silent passes. With
two wolves this is at most six alternating decisions, not six more after agreement.

## Decisions and scope

Confirmed by the user on November 10:

- Plan a new rules version for this change.
- Continue pack speech after target agreement, subject to the turn/pass limit.
- Three turns means three turns **per wolf**.
- The first agreed target stays locked while strategy talk continues.
- Two consecutive passes may end talk early **only after target agreement**.
  Before agreement, silence consumes turns without ending negotiation early.
- Prompt for both target agreement and next-day strategy using ordinary
  Mafia/Werewolf scum guidance.
- Commit the existing coaching work first. That checkpoint is `a73fdbba`;
  its focused coaching suite passed 11 tests before the commit.

The product questions are resolved. On November 10 the user requested committing
this plan and implementing v13 with these rules. Paid model evaluation, deployment
and historical regeneration remain outside the current task.

## Current behavior and cause

- `werewolf/rules.ts` currently creates v11 games without the Hunter and v12 games
  with it. Both use the current reducer in `rules-v9.ts`. V13 is the next version.
- `rules-v9.ts::packResult` finds each wolf's latest explicit target and emits
  `werewolf.pack_vote_resolved` immediately when they match. Six decisions without
  agreement produce no attack. There is currently no two-pass termination rule.
- `agent.ts::decideCurrent` tells wolves that matching targets immediately ends
  negotiation. The shared v9/v11/v12 rules text reinforces this. Changing only
  strategic coaching cannot create a post-agreement conversation.
- Multi-wolf `pack_propose` combines required legal `targetId`, optional `text`,
  optional `cue` and nonempty private `thinking` in one exact structured decision.
  Null speech is already legal; a successful multi-wolf decision currently cannot
  return a null target. A silent speech pass is distinct from declining a target.
- Pack proposals commit sequentially. `observation.ts` provides the current
  night's canonical `packProposals` to wolves, including during the following day
  because the day number has not changed. `packDiscussion` covers older speech
  entries and is not where current structured proposals live.
- `packProposals` deliberately resets when the next night's day number changes;
  a v9 regression pins this behavior. Extending all-night recall is a separate
  product decision, not a prerequisite for using tonight's plan tomorrow.
- `watch-contract.ts` skips silent proposals, including their thoughts, in normal
  playback. Spoken proposals already flow through the shared pack presentation.
- `werewolf-lobbies.ts` currently retains the lobby's frozen rules version when
  starting it. A paragraph in `docs/werewolf.md` says waiting lobbies adopt deployed
  rules; implementation must correct that documentation to match the owning source,
  rather than silently change existing lobby behavior.

Paths in this section are under `packages/engine/src/` unless an API file is named.

## Accepted v13 night contract

1. Keep the seeded alternating wolf order. A successful silent pass consumes one
   of that wolf's three opportunities. Retries of an unaccepted provider response
   consume no additional opportunity. Never reset the count on agreement.
2. Before agreement, retain the existing exact combined target-and-speech decision.
   Each wolf chooses a legal living non-wolf target, even when returning null
   speech. The latest accepted targets are standing proposals. Prose never
   establishes agreement, chooses an attack or changes a proposal.
3. The first matching pair of accepted targets locks the attack. Record the lock
   in reducer state at that accepted prefix. Locking does **not** end pack talk,
   resolve the night or reveal other roles' choices.
4. After lock, use the remaining alternating slots for strategy speech or a silent
   pass. Keep the same combined decision shape; constrain its `targetId` to the
   locked target in both the provider schema and semantic validator. Explain that
   this field acknowledges the existing attack and cannot reopen it. This avoids
   a second action type or another target-selection call.
5. Once the target is locked, two consecutive successful null-text decisions,
   one from each wolf, end talk. Start the silent streak after the locking decision;
   earlier silence and silence on the agreement decision do not count toward this
   early closure. Any intervening speech resets the streak. A production cue or
   private thinking does not turn silence into speech. Passes do not withdraw a
   standing target or cancel a lock.
6. Before agreement, even two consecutive silent decisions do not end talk.
   Continue alternating until targets agree or the six-decision limit is reached.
   Two silent matching proposals establish the lock and leave the remaining slots
   available; two silent differing proposals leave negotiation open.
7. Otherwise close at the sixth accepted decision. Agreement on that last decision
   still counts. If no lock exists at closure, there is no pack attack; Doctor,
   Seer and optional Hunter decisions still run and resolve normally.
8. Emit one canonical `werewolf.pack_vote_resolved` at conversation closure,
   using the locked target and the explicit proposals that established it. Do not
   manufacture fresh ballots from strategy-only acknowledgments or add a new
   ballot phase. Keep attack outcome (`agreed` versus no agreement) distinct from
   conversation closure (`turn_limit`, `both_pass`, or a typed failure boundary).
   Use a v13-specific exact result shape for new closure metadata; old event
   shapes remain unchanged and must not acquire invented defaults.
9. A lone wolf keeps its existing single target plus private spoken explanation.
   Losing a partner does not create a three-turn conversation with oneself.

Typed availability failures are not voluntary passes. Preserve the owning
provider retry/recovery policy and sanitized evidence; never let a failed call
fabricate consent, count toward `both_pass`, erase a locked attack, or create an
endless loop. If an existing explicit fallback consumes a slot, label that fact
separately from an intentional pass and test the resulting closure. Genuine
context limits require supported context adaptation, never size-only game failure.

### Examples to pin in tests

| Accepted decisions | Required behavior |
| --- | --- |
| A targets X; B targets X, both speaking | X locks at decision 2; A gets decision 3 for strategy. |
| Agreement at 2, then four strategy speeches | Close at 6; each wolf used three opportunities. |
| Agreement at 2; A passes; B speaks; A passes; B passes | Speech resets the streak; close at 6 with X. |
| A silently targets X; B silently targets X | Lock X at 2; continue with A at 3. |
| A silently targets X; B silently targets Y | Remain unagreed; continue with A at 3. |
| Agreement at 2; A passes; B passes | Close at 4 with the locked target. |
| Six silent proposals with no matching standing targets | Close at 6 with no attack. |
| No agreement through decision 5; decision 6 matches | Attack the agreed target; no extra strategy slots. |
| Locked X; later decision names Y | Invalid output; retry without committing Y or consuming a turn. |
| One wolf has died before the night | One solo decision, with the existing private explanation. |

## Prompt and next-day use

Use phase-specific coaching, in addition to the owner's strategy and character
voice. Keep the overall pack instruction short and explicit:

> This private pack conversation has two jobs: agree on tonight's attack and make
> a workable plan for tomorrow's discussion and vote. You each have at most three
> turns total, including passes. Before agreement, choose a legal attack target
> and use your speech to negotiate or plan. Once targets match, the attack stays
> locked and you may use your remaining turns for strategy. Discuss whom to
> pressure tomorrow, which villagers might support that vote, and how each of you
> can argue credibly from your public claims and voting record. Consider a backup
> if the attack is blocked, a role claim changes the situation, or a partner comes
> under pressure. Adapt rather than force yesterday's plan. Say anything your
> partner needs to know in pack speech; your thinking is private to you. Pass with
> null text when you have nothing useful to add. After agreement, two consecutive
> passes end talk. The pass streak starts after the target locks; silence before
> agreement still uses a turn but does not end negotiation early.

Supplement this with concise situational guidance: compare removing an information
threat with leaving a persuadable suspect alive; coordinate a plausible daytime
vote and alternative; weigh defending, distancing or bussing when relevant.
Neither partner defense nor sacrifice is mandatory. Do not force identical public
stories or synchronized votes that expose the pack. Plans are intentions, not
binding future votes or verified facts. Roles stay hidden on death, and unknown
Doctor/Seer/Hunter actions remain unknown.

The strategy basis is MafiaScum's [Playing Scum](https://forum.mafiascum.net/viewtopic.php?t=80129):
its night-play advice separates reviewing the prior day, planning with contingencies,
and effective night actions. This game's short turns, serial majority ballots,
hidden death roles and lack of daytime pack chat require adapting that guidance;
do not import other setups' powers, role reveals or communication rules.

At each slot, supply canonical stage, locked target, actor's remaining opportunities
and relevant accepted pack speech. Update both the version-specific rules text and
the `pack_propose` instruction; v13 must never also receive the old instruction
that matching ends negotiation. Fix the generic “keep plans in thinking” instruction
for pack turns: pack speech is allowed to communicate wolf plans and identities
to living partners, while individual thinking remains private. Public turns retain
their existing private-information warning.

Prove that a wolf's first daytime priority/discussion and ballot invocations receive
the actual accepted pack speech from the preceding night. No House-authored plan,
summary call, parsed prose commitments or new planning schema is needed. The wolf
can adapt after dawn and earlier public ballots. Other contestants, Mystery, public
API exports and unauthorized MCP reads must receive none of the private conversation,
lock state, passes, turn counters or private thinking.

## Implementation sequence

1. **Version and reducer.** Extend `werewolf/types.ts`, `rules.ts`, `rules-v9.ts`
   with v13, the deferred closure and prefix-derived lock/pass state. Reuse existing
   modular rules; avoid copying the whole reducer. Freeze the three-turn rule in
   v13 semantics. V7–v12 keep their accepted reducers, shapes and early-agreement
   termination. New game/lobby creation selects v13, with the existing optional
   Hunter setting controlling items; do not enable Hunter merely by bumping the
   version. Previously frozen lobbies and running games retain their version.
2. **Decision and context.** Update `agent.ts`, `observation.ts`, and the relevant
   fallback validation in `runner.ts`. Add v13 request metadata to the frozen
   contract so the schema can enforce a locked target. Preserve old request shapes
   and observation hashes for historical durable plans. Keep one sequential
   provider slot per opportunity and commit it before preparing the next context.
   Retain strict provider-native schemas and semantic checks inside the attempt
   boundary; never accept a speech-only prose response as an action.
3. **API, MCP and consumers.** Update frozen version checks in
   `packages/api/src/services/werewolf-lobbies.ts`, canonical game DTOs and explicit
   version unions (including production moments, watch timing and results).
   Regenerate closed MCP schemas with `bun run mcp:schemas`; test actual HTTP
   serialization for v13 and historical shapes. Reuse existing private bucket
   journal storage, hash verification and owner-epoch fences. No storage migration
   or historical game rewrite is required by this rule change.
4. **Presentation and reports.** Reuse proposal speech/thinking in the existing
   pack room. Carry accepted event identities and frozen cast through
   `werewolf/watch.ts`, `watch-contract.ts`, `house-speech.ts`, `house-narration.ts`,
   `report.ts`, production moments, House Cuts and replay-export adapters. Show all
   accepted strategy speeches in order, then one closure/result and normal night
   actions. Keep passes out of playback even with Show thinking. Omniscient may
   show spoken turns' saved thinking; partners never receive it. Update v13 labels
   that would otherwise misdescribe each strategy turn as a new attack choice.
   House narration remains factual presentation and cannot invent a pack plan.
5. **Docs and release.** Update `docs/werewolf.md`, rules-page content,
   `docs/reasoning-transcript-observability.md`, the relevant examples in
   `docs/local-model-evaluation.md` and `DEVELOPMENT.md`/`README.md`, and the JSDoc in
   `packages/engine/src/simulate.ts`. Keep direct-House-call and no-`as any`
   disciplines visible. Document v13 semantics and historical versions clearly.
   Deployment is the gate; add no feature flag or disabled mode. Merge/deployment
   remain later actions outside this implementation task.

## Acceptance and evidence

### Deterministic correctness and recovery

- Add focused v13 tests for every table row, all possible agreement beats 2–6,
  at most three slots per wolf, pre-agreement passes without early closure,
  a fresh post-lock pass streak, speech-reset silence, cue-only silence, no agreement,
  lone wolves and remaining night roles. Replay from every accepted prefix must
  choose the same next actor, lock and closure.
- Exercise the actual model adapter with captured invocations: both objectives
  appear; shared pack planning is not confined to thinking; old early-stop wording
  is absent; target restrictions change after lock; next-day prompts retain speech.
- Cover non-JSON, malformed/ambiguous wrappers, `{}`, missing/extra fields, illegal
  or changed locked targets, blank/oversized speech and exhausted retries. Valid
  supported unwrapping succeeds separately. Rejected output never mutates state.
- In PostgreSQL tests, interrupt after agreement, during strategy, after a pass,
  and after a journaled provider result before event commit. Replace the owner and
  resume the same localhost API game: preserve lock, remaining turns, source order,
  accepted call IDs and evidence without redispatching accepted calls. Use
  `setupTestDB()` and sequential shared-database tests.
- Test wolf versus other-contestant observations, Mystery/Omniscient projection,
  cursor reads, API and MCP serialization, and frozen source/export access. Include
  historical v7/v8 sealed negotiations and v9–v12 immediate-agreement fixtures.
  Do not rewrite old fixtures to v13 just to obtain green tests.
- Run `bun run test`, `bun run test:postgres`, `bun run check`, and
  `bun run mcp:schemas:check` after implementation. Report actual results and any
  pre-existing failures. The checkpoint's prior checks do not validate v13.

### Viewer, Studio and video parity

Follow [the presentation parity checklist](../presentation-parity.md). This change
adds observable post-agreement content, so shared component imports alone do not
establish completion. Retain fresh matched viewer, Studio Source, Studio Selected
cut and encoded export evidence for early agreement followed by strategy speech.
Exercise the actual adapters and include speech-only, thought-only and closure-only
cuts with omitted neighbors. Cuts must not leak omitted speech or future decisions.

Compare entrance/read/exit, direct seek and reverse/random frame sampling; thinking
on/off; recorded and unrecorded speech; reduced motion; long names and maximum legal
copy at narrow/short/fullscreen geometry. Werewolf casts stay at eight or fewer.
Assert no scrolling, clipped required text or unreadably small type. Mystery must
contain no pack content or private music/visual cues. Include House Cuts where
their source selection consumes these new speeches. Retain source/selection IDs,
settings, sample coordinates, assertions, screenshots and a freshly encoded clip.

Existing MP4s do not change. A selection whose frozen source already contains the
chosen speech can prepare a fresh bundle and encode again. Old v7–v12 sources never
gain v13 discussion. Adding newly accepted live source moments to an older selection
requires an explicit source/selection refresh; preserve pinned history and assets.
If any surface or required render proof is missing, report **presentation parity
is incomplete**.

### Model quality evaluation, separately authorized

No paid run is part of this implementation task. A later authorized evaluation should use
durable localhost API games with seven/eight-player two-wolf casts, multiple seeds,
the same models and a stated aggregate spend cap. Retain game IDs, watch URLs,
sanitized requests/responses, structured thinking, native reasoning, attempts,
retries, failures, usage and immutable local artifacts. Stop spending if evidence
persistence fails. Compare current behavior with v13; distinguish local, staging
and production evidence.

Review whether both wolves communicate a concrete next-day voting objective,
persuadable villagers, distinct plausible public arguments and a relevant
contingency. Follow the next day's speech/ballots to see whether they use or
reasonably revise the plan. Track early passes, strategy turns after agreement,
private leaks, latency and cost. More words or a higher wolf win rate alone do not
prove better strategy; voluntary silence remains legal and no plan is enforced.

## Implementation and validation

The approved plan was committed as `a21fbbfb`. The implementation adds v13 reducer
state, strict locked-target requests, both-objective coaching, next-day recall
proof, regenerated MCP contracts and version-aware report/player labels. Existing
versions and already frozen lobbies retain their semantics. Recovery tests cover
owner replacement after agreement, strategy speech and a pass, including a rejected
target followed by a journaled accepted result with no provider redispatch.

Fresh visual checks also found clipped frozen names. Shared cast labels now wrap,
speech fitting reserves the measured speaker label, and short two-person geometry
uses the existing compact room. Taller pictures keep the circular cast. These are
shared viewer/Studio/export changes, with an additional Influence consumer check.
There are no intentional content differences between those surfaces.

Current local validation (November 10):

| Check | Outcome |
| --- | --- |
| `bun run test` | 3,519 passed; five skipped. |
| Focused v13 engine/export contracts | 21 passed, including direct-prefix recovery, privacy and House Cuts. |
| Focused typography/room/export tests | 24 passed. |
| `bun run check` | Passed. |
| `bun run mcp:schemas:check` | Generated contracts are current. |
| Deterministic localhost browser tests | Three passed: v13 creation, post-agreement desktop/mobile playback, v7 historical replay. Harness servers and isolated database were cleaned up. |
| `bun run test:postgres` | 2,621 passed; no failures. |
| Fresh rendered/encoded matrix | Passed all nine cases at four geometries: 296 comparisons and nine fresh encoded videos. Viewer, Studio Source, Studio Selected cut and export agree, with caption-page/scroll audits, direct/reverse sampling, recorded audio, full night sequence, isolated cuts, Mystery and historical v8/v12 coverage. |

Evidence is retained under
`/Users/user/.codex/visualizations/2026/11/10/01a1c788-373b-70a2-ace1-6971897ec012/`:
`werewolf-v13/` contains canonical source, selected cases, manifests, matched frames,
caption-page audits and encoded clips; `werewolf-v13-browser/` contains the actual
localhost viewer screenshots; `influence-name-wrap/` covers the shared Influence
consumer. Refresh old bundles from the same frozen selections to capture new
label measurements, then encode fresh movies. Old v7–v12 sources retain their
original speech; including additional accepted live speech requires an explicit
source/selection refresh.

All inference and audio in these checks are deterministic fixtures/mocks. No paid
model qualification, production/staging writes, deployment or historical media
regeneration was performed. Strategic improvement remains an empirical question
for the separately authorized API evaluation above.
