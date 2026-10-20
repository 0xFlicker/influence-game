---
title: Werewolf v9 implementation and local verification
date: 2026-10-18
status: complete
branch: codex/context-overflow-adaptation
---

# Werewolf v9 implementation and local verification

New games use one open discussion with a shared UTF-8 speech allowance, followed by one serial public majority ballot. Every accepted contribution is visible before the next player acts. Discussion allows silence and three directed handoffs (A → B → A → B); the final speaker redirects or passes while retaining the ability to reference earlier claims. The initial policy is 400 bytes per living player and 320 bytes per message, frozen at game start. No discussion opportunity is guaranteed before the allowance ends. Voting has its own per-message allowance and always includes every living voter.

Two wolves combine speech and target proposals, agreeing after two through six beats or making no attack after six without agreement. A lone wolf retains the mandatory legal target rule. Completed v7/v8 histories retain their original reduction, sealed-ballot visibility, results and assets. Their historical plurality results are never reinterpreted as v9 majority votes. The extracted legacy reducer is byte-for-byte identical to the original reducer in the plan commit.

The [approved plan](../plans/2026-10-18-001-feat-werewolf-bounded-discussion-public-voting.md) defines the scope. The user authorized implementation and whole-game simulations with the approved models under an aggregate $15 ceiling. No staging or production deployment is part of this validation.

## Length rejection and private repair

The shared provider attempt path now carries typed length feedback from strict schema and semantic validators. Each permitted retry receives the latest exact rejected draft, field, measured size, allowed size, overage and measurement unit. A complete decoded rejected decision accompanies the draft so valid target/recipient choices can be retained. The repair note explicitly asks the same actor to shorten its own message while preserving intent. This uses the existing bounded attempts and fallback policy; it neither truncates speech nor accepts any part of the failed decision.

The inventory covers Werewolf introductions and historical speech, new discussion/ballot/proposal speech, cues and thinking, shared retrospective schema limits, context summaries, and House interview/huddle/long-form limits. Existing raw schema caps remain enforced; Unicode code points, UTF-16 code units and UTF-8 bytes are labeled according to the validator that rejected the value. Soft Influence conversation guidance remains soft. User-submitted API errors do not trigger model repair.

Feedback stays in private attempt evidence under the same logical actor/action. Frozen context hashes remain unchanged, while attempt-specific repair instructions are appended after context adaptation. API owner recovery restores pending feedback through the existing bucket evidence and integrity checks. A regression interrupts an oversized public ballot, changes owner, repairs the same target and speech, and proves exactly one accepted commit with no rejected text in public history.

## Local verification

| Check | Result | Scope |
| --- | --- | --- |
| `bun run test` | 2,725 passed, five existing skips, zero failures; 24,560 assertions | Final engine/web/protocol provider-free baseline, including the optional-participation refinement. |
| `bun run test:postgres` | 2,085 passed, zero failures; 24,341 assertions | Final local API baseline, including historical REST/MCP, Studio source, privacy and owner recovery. |
| Current rules and coaching | 32 engine checks and nine API catalog checks passed | General MCP rules and character creation use v9; old games retain explicit legacy prompt text. |
| v9 edge cases | 23 passed | UTF-8 boundaries, both final-redirect prompts, serial visibility/majority, six pack beats, malformed output, stale proposals, lone-wolf fallback, every-prefix replay and full scripted game. |
| Accepted pack-proposal recovery | Passed, 12 assertions | Crash after provider acceptance but before event commit, replacement owner, no redispatch, private partner observation, one final agreement. |
| Actual MCP HTTP version matrix | v7/v8/v9 passed; 194 assertions including current Studio source | Paginated replay and results for each version; public v9 conversations/ballots and Omniscient-only proposals. |
| Affected MCP/Studio contract suites | 66 passed across focused runs | Full HTTP route, House inspection, rule lookup and Studio source suites after schema regeneration. The long-history case was rerun with the repository's 30-second API timeout after the ad hoc command used Bun's five-second default. |
| House length-limit regressions | 67 passed, 406 assertions | Exact feedback for schema and UTF-16 limits, including whitespace-heavy raw caps. |
| `bun run check` | Passed | Final workspace typechecks and lint. |
| Werewolf browser suite | 25 passed, 356 assertions | Current v9 player/public ballot and owner flow, historical v7 readable replay, historical v8 House/admin/Studio, transformation and night outcome. |
| Additional browser journeys | Two passed, 16 assertions | Visual recovery and owner learning, each run separately. |

The silence stress case produces nine ten-byte contributions interspersed with 32 passes: 41 opportunities consume 90 bytes and leave an undispatchable 310-byte remainder. It proves that intervening speech resets the silence sweep, and that an output cap must not be described as a small provider-call cap.

The explicit v7 HTTP test exposed a stale generated MCP output contract that allowed only `rulesVersion: 8`. The pinned schema generator now emits the owning v7/v8/v9 union and new typed discussion/ballot/proposal fields. The schemas remain closed to extra fields; no permissive fallback was added. Tests exercise actual tool serialization and all pages, rather than only the engine projector.

Local logs: `/private/tmp/werewolf-provider-free-pass-guidance.log`, `/private/tmp/werewolf-postgres-pass-guidance.log`, `/private/tmp/werewolf-current-rules.log`, `/private/tmp/werewolf-current-rules-api.log`, `/private/tmp/werewolf-v9-final-prompt.log`, `/private/tmp/werewolf-v9-pack-recovery.log`, `/private/tmp/werewolf-all-versions-mcp.log`, `/private/tmp/werewolf-mcp-contract-regressions.log`, `/private/tmp/werewolf-mcp-long-history.log`, `/private/tmp/werewolf-check-pass-guidance.log`. The full browser suite output is retained in the task tool transcript rather than a separate log. Browser harness children and isolated databases were cleaned up, and generated Next configuration edits were restored. The React review checklist found no new hook, fetching, or accessibility issues in the changed viewer components. These are local execution evidence, not deployed checks.

## Paid game evaluation

Standalone simulations use the normal ten-day cap and include all postgame retrospectives. The shared attempt ledger is `/private/tmp/werewolf-paid-2026-10-18.json`; all runs keep that ledger, including failed attempts and the first exploratory game. Attempt admission reserves conservative input/output cost before dispatch, retaining the reservation floor after settlement. Usage-based estimates and provider-reported actual cost are separate fields; missing invoice data is not reported as zero.

The [model quality report](2026-10-19-werewolf-v9-model-quality.md) records completed games, whole-game behavior, missed floor opportunities, redirects, repair outcomes and aggregate cost. Private canonical logs, prompts and provider evidence remain local under `packages/engine/docs/simulations/`. This small sample supports pacing and prompt decisions, not a statistical faction-balance claim.

The two-wolf run `v9-luna-two-15` is a pacing counterexample: it finished on day eight, with no eliminations on days 1, 2, 3, 5, 6 and 7. Four of eight attacks were protected. Echo was eliminated on day four; Rex on day eight, leaving Finn (wolf) and Vera (Doctor), which establishes wolf parity. The daily output limit held throughout, but repeated failed majorities extended the whole game. This is evidence for further conversation and coordination tuning, not a reason to change the required majority rule.

The initial paid cohort produced no voluntary discussion passes and included repetitive agreement. A subsequent prompt refinement makes optional participation explicit and asks for null text when the actor would merely agree, repeat an unchanged suspicion or promise, or repeat that evidence is missing. Games through #17 retain the initial prompt; games #18 onward evaluate this refinement separately. Rules, output budgets, scheduling and ballot semantics are unchanged.

The completed evaluation contains 20 final-schema full games with retrospectives: 16 baseline and four prompt-refinement candidates, including five eight-player/two-wolf games overall. All replay against the final reducer and watch projection. One earlier exploratory full game and one harness-interrupted partial run remain separately preserved and included in accounting. Final committed reservation is $10.27357850 of the $15 cap, including three unsettled reservations; estimated token usage is $1.21853310, with provider invoice cost unavailable. The saved ledger was independently recomputed and matched its evidence copy. No further simulations are running.

All 46 discussion windows respected the byte budget and gave every living player an opportunity in this sample, without changing the rule that an opportunity is not guaranteed. None produced voluntary discussion silence, including the four prompt-refinement games. Useful direct replies and public-vote influence were observed, but the refinement did not establish improved silence behavior, and the eight-day outlier remains a pacing limitation. Mechanical implementation and compatibility verification are complete; these quality findings remain explicit tuning work rather than being marked as passed acceptance claims.
