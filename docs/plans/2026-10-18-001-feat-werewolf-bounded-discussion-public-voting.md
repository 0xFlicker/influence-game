---
title: Werewolf bounded discussion, public majority voting, and combined pack proposals
type: feat
status: proposed
date: 2026-10-18
---

# Werewolf bounded discussion, public majority voting, and combined pack proposals

## Purpose and authorization

Replace long opener-led daytime threads and repeated sealed ballots with one bounded open conversation, followed by one public sequential majority ballot with optional speech. Combine each wolf's private speech and attack proposal into one decision, eliminating the separate pack ballot calls.

This document is a plan only. No implementation, deployment, or paid calls are part of authoring it. The user has authorized subsequent paid evaluation with `gpt-6-luna` and/or `muse-1.3-contributor`, with a **$15 aggregate ceiling**. The expected 20–30 games is an estimate, not permission to exceed that ceiling. Evaluate whole games across multiple days; do not substitute isolated days or truncated games for quality evidence.

## Confirmed requirements

- Daytime pacing is governed by generated **text output size**, not elapsed wall time. Future TTS duration may replace the text measure; TTS is outside this implementation.
- Agents see the remaining discussion output allowance and know that one public ballot follows it.
- Every enforced message-length rejection receives a feedback-informed retry: the rejected message, its exact measured size, the allowed size, and an instruction to shorten it while preserving intent. Apply this across existing message surfaces, not just the new Werewolf discussion.
- Discussion permits direct exchanges and silence, without a leader, obligatory speeches from everyone, or repeated full-room response rounds.
- Every living player votes once, serially, with an optional short message. Abstention is legal. Accepted votes and messages are public before the next voter decides.
- Elimination requires a **strict majority of all living players**. There is no plurality fallback, runoff, or return to discussion. One target vote plus everyone else abstaining means no elimination.
- Completed released games remain playable, openable in Production Studio, and readable through MCP and API. Their accepted history and results remain unchanged.
- Keeping old active games executable across rollout is **not required**. Production normally attempts to finish games before rollout; do not build a second live execution system solely for this change.
- Pack speech and target proposal are one structured decision. Allow **three full back-and-forth exchanges**, ending early when proposals agree. With two wolves this allows up to six individual decisions, not three and not a forced six.
- Use full six-player, one-wolf games for quick quality evaluation. Include full two-wolf games to evaluate the pack change.

The live-game and completed-game requirements are deliberately different. Historical interpretation remains necessary even when old model dispatch is removed. These explicit requirements supersede blanket removal of compatibility for released game reads.

## Current implementation and problem

`packages/engine/src/werewolf/rules.ts` schedules an opening from each living player, ordered respondents, and an opener answer after each spoken response. Each thread triggers a sealed ballot; the last ballot currently uses mandatory-target plurality. The documented worst case is `N × (3N − 1)` decisions per day before retries: 102 for six living players and 140 for seven.

Pack negotiation currently schedules optional speech from each wolf followed by separate sealed attack decisions. The next attempt can repeat both stages. Combining speech and target removes redundant evaluation without deriving a target from prose.

Current released rules versions are v7 and v8. `house-werewolf-inspection.ts` reconstructs history through the engine replay/projection functions and validates completion with `werewolfExecutionFinished`; changing the live runner alone cannot be assumed safe for MCP history. The player, Studio, production adapters, retrospectives, and results readers also consume canonical replay.

## Proposed daytime rules

### 1. One shared output allowance

Use **UTF-8 bytes of accepted spoken text** as the initial deterministic unit. Bytes avoid tying gameplay to a particular model tokenizer. Count the exact stored speech, including whitespace; reject whitespace-only speech. Do not count JSON structure, target IDs, private thinking, provider-native reasoning, production cues, rejected attempts, or provider latency.

Initial tuning hypothesis, frozen at dawn using the living count `N`:

| Allocation | Initial value | Meaning |
| --- | --- | --- |
| Discussion | `400 × N` UTF-8 bytes | Shared allowance; no equal speech quotas |
| Individual discussion contribution | At most 320 bytes, further bounded by remaining allowance | Usually one conversational move, about 10–35 words |
| Voting | At most 320 bytes per living voter | Separate reserved allowance so discussion cannot consume voting opportunities |

For six living players, discussion permits 2,400 bytes, and voting reserves at most 1,920 additional bytes. These are initial experiment values, not measured balance claims. Freeze the selected constants in the new game's rules/configuration so replay never depends on later tuning.

This is an output limit, not an input/context limit. Never truncate game authority, fail a game, or suspend it because its input context is large. Continue to use supported context adaptation and the provider policy. An over-budget generated speech is a typed invalid output subject to the bounded, feedback-informed retry described below; never clip accepted speech or silently remove words.

Passes consume zero spoken bytes. There is **no separate fixed turn-count deadline**. Termination comes from finite positive-byte speech plus the silence rule below. Provider failures are recorded distinctly and cannot create an infinite sequence of retries or floor offers.

Each observation includes the total and remaining discussion bytes, current per-message maximum, and the separate voting allowance. Explain that this is shared speaking space: as it runs low, agents may want to make an accusation, disclose information, or consolidate support. Do not label bytes as seconds or claim knowledge of who would have spoken next beyond the actual scheduler.

When the allowance reaches zero, transition to voting. If a very small remainder produces awkward final contributions, tune the initial unit/limit policy based on evidence rather than adding hidden extensions or an invented clock. Accepted output must always obey the frozen rule.

Future TTS: a later rules version may charge accepted audio duration instead. Keep this byte policy localized, but do not introduce an unused generic budget framework, audio pipeline, or estimated-seconds counter now.

### 2. Floor opportunities without leaders

Initial scheduling hypothesis:

1. Seed a deterministic tie-break order for the day. With no directed reply pending, offer the floor to the living player least recently offered an opportunity, breaking ties by that order.
2. A contribution contains `text`, optional production `cue`, an optional explicit `recipientId`, and an optional `replyToContributionId`. Text may be null for a silent pass; recipient and reply fields must then be null. Validate living recipients, non-self addressing, and visible canonical reply coordinates.
3. A spoken contribution may offer its named recipient the next opportunity. Allow at most two consecutive directed handoffs before returning to the fair scheduler: A → B → A is possible, but two players cannot hold the floor indefinitely.
4. Every offer, including a directed offer or pass, updates that actor's last-opportunity position. A normal floor offer resets the directed-handoff counter. A pass returns to the fair scheduler.
5. Every accepted speech is committed and visible before the next model call. A recipient can decline; naming them does not force an answer or create an additional speech quota.

After each spoken contribution, clear the set of players who have subsequently declined the floor. When all living players have passed without intervening speech, close discussion early. Typed provider-unavailable silence also advances the scheduler and can exhaust the no-speech sweep, but remains separately identified; report an unavailable/mixed sweep rather than falsely claiming everyone chose silence.

This is the initial mechanism to test, not a claim of perfect spontaneous turn-taking. It avoids an extra model call to ask everyone whether they want to speak after every message. It also avoids any House model choosing speakers, rewriting speech, or judging whether an accusation is strategically valid.

Naturalness is a separate acceptance concern. Prompts should foreground the actual latest exchange and explicit reply context, without requiring a room recap. A player may answer, question, accuse, disclose, redirect, or remain silent. Do not force consensus, equal participation, or politeness that erases character strategy. Public silence should not become an audible announcement or a long empty playback beat.

### 3. One public sequential majority ballot

- Freeze a seeded voter order at dawn and include it in observations. Vary the order by day; do not let a leader choose it.
- Each living player receives exactly one ballot opportunity. The observation includes all committed discussion, prior public ballot messages, exact current totals, remaining voters, and `requiredVotes = floor(N / 2) + 1`.
- The exact model response combines `targetId: living-other-player | null`, `text: string | null`, `cue: string | null`, and private `thinking`. A vote can be silent; an abstention can include speech. Private thinking never becomes public dialogue.
- Validate and commit the target and message atomically before dispatching the next voter. No frozen concurrent batch for daytime ballots. A later voter must see earlier committed choices and speech, including after recovery.
- Choices cannot be revised. Every voter still gets their opportunity if a majority is reached early; elimination happens only at the final canonical resolution.
- A target with at least the fixed majority threshold is eliminated. Otherwise nobody is eliminated. Abstentions and provider-unavailable ballots do not lower the threshold. There is no plurality calculation or tie-breaking elimination.
- The day then ends, subject to the existing faction victory/day-limit checks. No further discussion, extra ballot, nomination, trial, or defense phase is introduced.

Examples with six living players: threshold four; `A=4, B=1, abstain=1` eliminates A; `A=3, B=2, abstain=1`, `A=1, abstain=5`, and all-abstain eliminate nobody. Abstention is a declined elimination choice, not the old promise to hear another thread.

Later voters have more information and the last voter can make an unanswered accusation. Evaluate this strategic asymmetry over complete games. Do not preemptively add response windows that reopen the phase.

## Combined nighttime speech and proposals

### Two living wolves

One individual beat returns a single exact structured decision: `targetId`, optional `text`, optional `cue`, and private `thinking`. The target must be a living non-wolf; a silent beat still makes an explicit proposal. Speech does not establish agreement.

At the start of each night, seed the first speaker, clear prior-night proposals, and alternate wolves for up to **three full exchanges**: A → B, A → B, A → B. There is no separate pack-vote phase or confirmation call.

Each accepted proposal replaces that wolf's current proposal and is immediately visible to the other wolf together with its speech. After every beat, if both wolves have an accepted current proposal and their target IDs match, emit one canonical pack-agreement resolution and stop. The earliest possible agreement is after the first A → B; agreement may also occur on beat three, four, five, or six. The latest proposal remains an explicit standing offer until replaced or the night ends, and the prompt must explain this.

If six beats complete without agreement, emit a canonical no-agreement resolution and make no attack. Retain the existing no-attack consequence of exhausted disagreement. Do not fabricate consensus, choose a random winner, or add a seventh call. Proposal order and remaining exchanges are part of the frozen observation and replay state.

For typed provider exhaustion, record an unavailable beat without accepted speech or a current proposal for that actor; clear that actor's previous standing proposal so stale intent cannot manufacture fresh agreement. This failure policy should be explicit in rules and tests. Structural corruption, lost ownership, and code errors are not gameplay silence.

### One living wolf and other night roles

A lone wolf chooses its attack in one decision; optional speech is allowed in that same decision but no negotiation or confirmation is needed. Preserve the existing seeded legal fallback for an unavailable lone-wolf mandatory target. Doctor and Seer still act once per night, with the same legality and simultaneous night-resolution rules. Neither receives pack proposals. Disagreement or unavailable pack consensus does not skip their actions.

Mystery receives only the ordinary public dawn outcome. Omniscient and authorized wolf observations can see accepted proposal history according to their existing access boundaries; private thinking remains separately gated. No pack counters, targets, or speech leak through Mystery progress or cursor positions.

## Feedback-informed retries for oversized messages

Replace fresh retries of an unchanged request with an explicit repair opportunity wherever a generated message is rejected for exceeding an enforced length limit. Inventory all such validators and their callers during implementation. Known surfaces include Werewolf introductions/daytime/pack speech, shared Influence/Werewolf retrospective speech, and the new public vote/proposal messages. Cover any other enforced generated-message length rejection found in that inventory. This does not add hard limits to Influence room/Mingle messages that currently have only soft brevity guidance, or introduce model retries for user-submitted API validation errors.

The next attempt receives the original frozen task and observation plus a private, structured repair note containing:

- The affected field path and **exact rejected message**, without clipping or rewriting it.
- Its exact measured size, allowed size, and the amount over the limit.
- The precise measurement unit used by the rejecting validator: UTF-8 bytes, Unicode code points, UTF-16 code units, or tokens with the identified tokenizer. Do not label every measure simply as characters or estimate a count. For new discussion speech, use UTF-8 bytes and the effective allowance `min(perMessageLimit, remainingDiscussionBytes)`.
- A concise instruction: shorten this draft to fit while preserving its intended claim, answer, question, or persuasive point; return the entire required structured decision. Preserve valid non-message choices such as target and recipient while repairing length, unless another validation error explicitly requires their correction.

Example repair note: “Your `text` was rejected: 412 UTF-8 bytes; allowed 320; over by 92. Rejected draft: [exact text]. Shorten it to at most 320 UTF-8 bytes without losing its intent. Return the complete required decision.” Actual counts must be computed from that exact draft, not copied from this illustrative example.

Use typed validation details rather than parsing human-readable error strings. Exact-schema rejection must expose enough diagnostic information for repair even if it precedes domain validation. A decodable field may be quoted for feedback without accepting any part of the rejected decision. Do not extract JSON from prose, accept fenced output, fill missing fields, or turn a malformed/incomplete provider response into accepted speech to obtain a repair draft. If no complete message is available, retain the appropriate malformed/incomplete-output retry policy; do not invent an exact message or size.

The rejected draft is untrusted quoted data, not new instructions or accepted dialogue. It stays private to the same actor and logical action. Neither other contestants nor spectator history receives it, and it cannot change votes, standing proposals, reply scheduling, or the shared output budget. The full repaired decision must pass the same strict schema and semantic checks before atomic acceptance. No House rewrite or automatic truncation substitutes for the actor's repair.

Reuse the shared provider-attempt path and current attempt/fallback limits. A repair consumes an existing retry and its real provider cost; it does not open a second retry loop or enlarge the allowance. If another repair is needed, use the latest rejected draft and fresh exact counts rather than accumulating every failed draft in context. Preserve repair feedback across permitted provider fallback and worker recovery under the same logical action, using the existing private attempt evidence/storage boundaries. Keep the canonical frozen observation unchanged and the attempt-specific feedback separately identifiable, so context-source and accepted-result integrity checks remain valid. Never redispatch an already accepted result merely to reconstruct repair context.

Exhaustion keeps each owning phase's existing typed behavior: unavailable silence for optional speech, marked unavailable abstention where applicable, and an explicit retrospective execution error for required postgame speech. Do not fabricate acceptance or weaken the rules to guarantee a repair succeeds. Historical accepted messages are never revalidated under new limits or rewritten by this feature.

## Canonical authority, recovery, and storage

Introduce a new rules version (v9 if still available at implementation). New structured actions and events must distinguish open discussion, public ballot contributions, pack proposals, and final resolutions from historical thread/sealed-ballot records.

- The engine owns budget accounting, floor selection, vote order, totals, standing proposals, agreement, and phase transitions. Never parse message prose for any of these facts.
- Persist stable action coordinates and frozen observations before dispatch. Commit accepted speech and its associated target/metadata together. An accepted provider value recovered after interruption must not be generated again or charged twice against the discussion budget.
- Preserve owner-epoch fences, provider journals, typed bounded retry, and one canonical final vote/night resolution. Recovery of **new-version** games remains required.
- Use exact provider-native schemas with semantic validation inside the provider-attempt boundary. Reject missing/extra fields, fenced or embedded JSON, illegal targets, invalid reply IDs, and byte-limit violations.
- Reuse existing storage boundaries. New large immutable evidence/context/render documents belong in the existing buckets with verified references, not database body columns. Do not introduce a storage migration unless actual changed persistence requires one; if needed, follow the complete existing-data migration requirements.

## Completed-game compatibility

Keep version-aware historical reduction and projection for all released histories currently supported (v7 and v8), alongside the new rules. Preserve old thread ordering, old sealed ballot visibility and results, old pass labels, audience-local cursors, role reveal timing, results, and retrospectives. Old plurality outcomes remain historical facts even though new games are majority-only.

Do not rewrite events, recalculate past winners under new rules, regenerate historical speech, reinterpret old pack chat as target proposals, or rewrite existing media. New public vote speech must not alter the historical reveal boundary of sealed votes.

Verify completed fixtures through all of:

1. Browser player/replay, seeking, Mystery/Omniscient switching, decisions, and existing visual playback.
2. Production Studio opening, source inspection, scene/moment selection, and existing assets.
3. Public and authorized API reads, including historical prefixes and results.
4. MCP discovery and game inspection, including paginated historical reads and completion validation.

Reuse existing shared components and isolate version-specific interpretation at the owning rules/projection boundaries. Retain only old logic required for correct historical reads; do not build a generic legacy execution framework. Rollout checks should inventory active games and normally wait for completion. Migrating, canceling, or repairing an old active game is not authorized by this plan and is not an acceptance requirement.

## Implementation sequence

1. **Capture historical fixtures and contracts.** Preserve representative completed v7/v8 histories, including early majority, final plurality, failed pack agreement, visuals, and v8 retrospectives. Establish cross-surface read assertions before changing reducers. Inspect current serializers and response schemas, not just TypeScript types.
2. **Implement new rules and repair feedback end to end with scripted agents.** Add exact action/event contracts, deterministic byte accounting and floor scheduling, majority-only sequential ballots, combined pack proposals, and new-version recovery. Inventory every enforced generated-message length rejection and connect each to feedback-informed retries, including existing retrospective/message surfaces. Keep night roles and victory rules unchanged.
3. **Connect observations, presentation, and inspection.** Show remaining discussion space, public vote speech/tallies, and wolf proposal exchanges in the appropriate audience. Update player/watch navigation, timing, results/decision readers, Studio source generation, MCP DTOs, and CLI reporting together. Historical games continue to use historical semantics.
4. **Update docs and run deterministic validation.** Required repository checks plus targeted browser/Studio/MCP compatibility and recovery coverage. No production deployment as part of validation.
5. **Run authorized full-game evaluation, tune, and report.** Start with complete six-player games. Change one pacing/prompt parameter at a time, freeze each candidate, then replay complete games across several seeds. Include full two-wolf games before acceptance.

Primary implementation owners are `packages/engine/src/werewolf/{types,rules,agent,conversation,observation,runner,watch,watch-contract,watch-timing,report,thinking,results,retrospective}.ts`, their focused tests, API Werewolf runtime/presentation/decisions/production services and routes, `services/house-werewolf-inspection.ts`, and the actual web Werewolf viewer/Studio consumers discovered during implementation. Avoid assuming all readers use the same entry point.

Repair feedback additionally touches the owning validators and the existing shared `structured-output.ts`, `provider-adapters.ts`, `provider-execution.ts`, `agent.ts`, and retrospective invocation/contracts as needed. Use one shared mechanism with typed feedback from each length validator; do not duplicate bespoke retry loops per discussion format. Reconcile any prompt/validator limit mismatch found in this inventory against the intended enforced contract, without silently changing existing hard limits.

Update `docs/werewolf.md`, `docs/werewolf-rules-page-content.md`, `docs/reasoning-transcript-observability.md`, `docs/local-model-evaluation.md`, relevant `DEVELOPMENT.md`/`README.md` usage, `CONCEPTS.md`, simulator JSDoc in `packages/engine/src/simulate.ts` and both Werewolf simulators, and the applicable `docs/solutions/` learning. Retain the no-`as any`, no transcript inference, and direct-House-call disciplines.

## Verification and acceptance

### Deterministic correctness

- Exact UTF-8 accounting for ASCII, emoji, multibyte text, whitespace, passes, and the final remaining-byte allowance. Retries and accepted-result recovery cannot double-charge.
- For every inventoried enforced message limit, prove an oversized first response produces a second request containing the exact draft, field, measured size, allowed size, overage, correct unit, and intent-preserving shortening instruction. Cover schema-level and semantic rejection, including Unicode measurement differences and a shrinking discussion allowance.
- Prove a valid repair commits exactly once with valid non-message choices preserved; repeated oversize uses the latest draft; exhausted repairs use the owning typed fallback/error. Check provider fallback and restart preserve pending repair feedback, accepted-result recovery makes no extra call, and rejected drafts never enter public history, contestant observations for other actors, or budget charges. Malformed output must not gain permissive parsing through the repair path.
- No-speech sweep termination; unavailable silence distinguished from voluntary passes; no zero-output infinite loops.
- A → B → A exchanges, directed-chain limit, least-recently-offered fairness, valid reply references, and silence without synthetic dialogue.
- Each serial vote observes all previous votes/speech and no future ballot; majority denominator remains all living voters; one vote plus all abstain cannot eliminate; no early removal of a voter.
- Two-wolf agreement after beats 2 through 6, six-beat disagreement, proposal replacement, unavailable beat semantics, seeded order, single-wolf action, and no Mystery leakage. Scripted disagreements are essential even if paid games usually agree immediately.
- New-version recovery after provider acceptance but before commit, after each public vote or proposal, and around final resolution; duplicate commits and stale owners remain rejected.
- Malformed structured output coverage for every new decision kind: non-JSON, fenced/embedded JSON, `{}`, required/extra fields, illegal IDs, semantic budget errors, exhausted retries. Invalid speech-plus-target cannot partially mutate the game.
- Completed v7/v8 compatibility matrix across player, Studio, MCP, API, results, and audience-prefix privacy. Tests must exercise actual routes/tools and viewer paths, not just a reducer snapshot.
- Large valid input contexts continue through adaptation; byte output limits never become input-context rejection tests.

Run Bun only: `bun run test`, `bun run test:postgres` against local PostgreSQL, `bun run check`, and affected deterministic browser journeys. Shared DB tests use `setupTestDB()` and remain sequential. Follow the elevated-access retry rule before diagnosing sandbox DB connection failures. Paid tests remain opt-in and outside required CI.

### Paid full-game evaluation: authorized, not executed by this plan

- **Models:** `gpt-6-luna` and/or `muse-1.3-contributor` only, including fallback routes. `openai:gpt-6-luna` is present in the current catalog; verify the exact Muse provider route, structured-output support, availability, and prices before choosing it. Do not silently substitute another model.
- **Ceiling:** $15 total across baseline calls if any, retries, fallback calls, compaction, retrospectives, failed/incomplete games, and all candidates. No image, video, or TTS generation. Use recorded provider usage and current configured pricing; do not assume a fixed per-game price.
- **Spend control:** run games sequentially initially, maintain a cumulative spend/reservation ledger, and admit a game only with room for a conservative whole-game allowance. Enforce per-attempt admission against worst-case billable input/output and outstanding reservations through existing budget controls where available. If reliable pricing/reservation is unavailable, do not launch a paid batch. A budget-stopped game is reported as incomplete and not counted as a quality success; $15 is not a target that must be spent.
- **Shape:** start with two complete six-player, one-wolf games using the normal 10-day cap, then inspect entire trajectories before expanding. If costs and quality permit, aim for roughly 20–30 games overall, with most at six players/one wolf and several complete two-wolf games. Use the existing eight-player/two-wolf preset for the latter unless a supported equivalent is selected.
- **Comparison:** use available recorded recent games as a qualitative baseline; do not claim matched-model evidence without it. For new comparisons, record seed, frozen cast/strategy, model configuration, rules version, and budget constants. Reuse seed/cast configurations across candidates where useful, recognizing changed decision sequences do not make outcomes identical.
- **Whole-game review:** watch how early suspicion becomes claims, commitments, vote coalitions, investigation disclosures, and late-game decisions. Early-day chaos alone is not a failure. Do not force a one-day cap to save money or declare a single attractive exchange sufficient.
- **Evidence:** retain local simulation ledgers, transcripts, provider receipts, seeds/manifests, and review notes under `packages/engine/docs/simulations/`. Use `--chatty`/transcript diagnostics; distinguish private reasoning from accepted public speech.
- **Measures:** accepted discussion bytes and spoken turns by day, repeated versus responsive contributions, silence distribution, vote speech's influence on later choices, majority/no-elimination frequency, day count, faction result, pack decisions to agreement, length rejection/repair success/exhaustion counts, preservation of intent in sampled repairs, fallback frequency, and total cost. Generation latency may be observed operationally but is never a gameplay budget.
- **Acceptance judgment:** shorter and more responsive conversations across full games, agents using the remaining allowance sensibly, meaningful public voting, natural silence, and no repeated majority deadlock that makes complete games drag. This small sample supports qualitative iteration, not statistical faction-balance claims. If majority coordination is weak, improve discussion/prompting and re-evaluate; do not restore plurality.

## Boundaries and remaining tuning questions

Confirmed: output-size pacing, feedback-informed retries across all enforced generated-message length limits, strict majority, one public ballot, completed-history compatibility, three full pack exchanges with early agreement, full-game evaluation, approved models, and the $15 ceiling.

To tune through evidence: the initial byte allocation, individual speech cap, directed-handoff limit, fairness of published voting order, and whether quiet agents can contribute at useful moments. The selected initial settings above make the first implementation concrete without claiming these values have already been validated.

Out of scope: nominations/trials, live timers, TTS, role redesign, broader casts, new provider platforms, historical rewrites, old-version live execution guarantees, feature flags, and production deployment.
