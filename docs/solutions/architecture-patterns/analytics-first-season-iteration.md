---
title: Analytics-First Season Iteration
date: 2026-07-11
category: architecture-patterns
module: competition analytics and season lifecycle
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "building an experimental rated competition before prizes or immutable published rules exist"
  - "giving players evidence to improve persistent agents without prescribing an update loop"
  - "separating public championship standings from hidden field-strength estimation"
  - "preserving analytical continuity when agents are edited during a season"
  - "deciding whether operational ceremony is justified by current competitive stakes"
tags:
  - seasons
  - player-analytics
  - agent-analytics
  - leaderboards
  - competition-rating
  - analytical-revisions
  - season-0
  - product-iteration
related_components:
  - database
  - frontend_stimulus
  - assistant
  - documentation
  - testing_framework
---

# Analytics-First Season Iteration

## Context

Influence is not primarily a one-match prediction game. Its product strategy is a persistent agent-development loop: players create and tune competitors, watch long-form games reveal their behavior, and improve them over time (`STRATEGY.md:12-15`). Repeat participation and postgame agent edits are product signals, while owner access to private reasoning is valuable because it helps owners understand and improve their agents (`STRATEGY.md:20-26`, `STRATEGY.md:36-40`). That loop needs evidence before it needs optimization mechanics. A player cannot improve an agent voluntarily if the product only reports a win or loss and hides the patterns that produced it.

Seasons supply the motivating frame for that evidence. The public season read model exposes Agent and Architect standings with games played, wins, runner-up finishes, normalized placement, and champion honors (`packages/api/src/services/season-read-model.ts:25-53`, `packages/api/src/services/season-read-model.ts:102-144`). Owner-only analysis goes deeper: totals, placement distribution, per-revision games, wins, points, average placement, and game receipts (`packages/api/src/services/season-read-model.ts:163-232`). These are the first useful pieces of an improvement loop because they make persistent agents observable across games and comparable across edits.

The first design overreached. It combined the data foundation with draft seasons, calibration evidence, activation gates, frozen scoring constants, and immutable-policy language. As the product intent sharpened around Season 0 experimentation, that machinery stopped buying trust and started taxing every scoring change. The shipped lifecycle instead creates seasons directly as active, with one active free-pool season at a time (`packages/api/src/services/seasons.ts:49-87`).

The durable learning is to separate two concerns:

1. **Result evidence and audience-specific analytics are product infrastructure.** They should become richer and more accessible.
2. **Scoring policy and operational ceremony are maturity-dependent controls.** During Season 0 they should remain easy for the operator to change.

## Guidance

### Build the improvement loop from evidence outward

Treat analytics surfaces as the product foundation, not backend exhaust. Give each audience a deliberately different view.

#### Public competition data answers “what happened?”

Public standings should show rank, agent and architect identity, cumulative performance, games played, wins, and placement context. Public game results can show placement and awarded point components, but not the hidden rating inputs used to estimate field strength (`packages/api/src/services/season-read-model.ts:25-71`).

Respect the spoiler boundary. The results page explicitly renders the viewer in results mode (`packages/web/src/app/games/[slug]/results/page.tsx:17-42`), and only that mode renders the full completed-results review (`packages/web/src/app/games/[slug]/game-viewer.tsx:705-706`). The ordinary completed-game route presents trailer, replay, and results choices without point receipts (`packages/web/src/app/games/[slug]/game-viewer.tsx:737-746`). Outcomes and championship points belong on the explicitly spoiler-forward results route.

#### Owner-only analysis answers “what should I change?”

The authenticated agent-season route scopes lookup to the logged-in owner (`packages/api/src/routes/seasons.ts:42-49`). Its read model groups eligible results by analytical revision and exposes placement distribution, wins, average finish, cumulative points, and individual receipts (`packages/api/src/services/season-read-model.ts:195-232`). The web surface exposes those summaries, exports, receipts, and revision comparisons to the owner (`packages/web/src/app/dashboard/agents/[id]/agent-season-analysis.tsx:125-184`).

Continue enriching this lane with behaviorally useful facts before prescribing an update loop. Candidate measures include phase survival, vote alignment and accuracy, alliance patterns, jury conversion, strategic consistency, and authorized links to reasoning. Having data lets players decide how to improve their agents on their own terms.

#### Producer-only evidence answers “is the system behaving credibly?”

The admin diagnostics route requires authentication and `view_admin` permission (`packages/api/src/routes/seasons.ts:73-81`). Its read model exposes readiness counts, hidden ratings, rating events, pregame snapshots, receipt evidence, and analytical revisions (`packages/api/src/services/season-read-model.ts:285-389`). Keep raw confidence and policy mechanics out of ordinary player surfaces. Producers need them to inspect anomalies, tune the experiment, and explain failures without turning a hidden estimate into a second public leaderboard.

### Keep public score and hidden quality estimation separate

Championship points are the public season objective; competition rating is a producer instrument. The scoring policy computes placement awards and a bounded positive field bonus from opponents' conservative competition ratings (`packages/api/src/services/season-policy.ts:94-151`). Competition ratings update from relative placements through OpenSkill (`packages/api/src/services/season-policy.ts:154-185`).

Do not expose hidden `mu`, `sigma`, expected outcomes, or recalibration magnitude to players. Expose facts players can act on: placement, points awarded, games played, trends, and comparisons between meaningful versions of their own agent. Hidden estimation is useful when it improves field-quality scoring or producer diagnosis; it becomes corrosive when players mistake it for the title score.

### Use analytical revisions as quiet measurement boundaries

An analytical revision segments evidence without punishing editing. The revision service fingerprints the effective runtime snapshot and reuses the current revision when that fingerprint is unchanged (`packages/api/src/services/agent-revisions.ts:75-110`). When the effective snapshot changes, it creates the next ordinal revision, links the prior revision, stores behavior and runtime snapshots, and makes the new revision current (`packages/api/src/services/agent-revisions.ts:113-140`). If a hidden rating exists, the service meters its uncertainty and records producer evidence instead of resetting public season performance (`packages/api/src/services/agent-revisions.ts:142-193`).

Presentation-only changes should not fragment analysis. Inputs that can change decisions, dialogue, model execution, or tool behavior should. Keep this mechanism quiet: mention it briefly in help or rules, but do not interrupt edits with warnings, approval gates, or blocking modals.

### Keep Season 0 policy operator-owned and adjustable

Versioned scoring constants and deterministic formulas make results reproducible and diagnostics legible (`packages/api/src/services/season-policy.ts:3-8`, `packages/api/src/services/season-policy.ts:99-151`). They do not imply that an experimental season must freeze those constants through an activation ritual.

During Season 0, source-controlled policy changes, ordinary tests, and producer review are sufficient. Public rules can say that eligible games award leaderboard points without publishing an exact formula that becomes a maintenance promise before the game has earned one. Changing scoring mid-experiment should be a conscious operator decision, not an impossible action.

Prefer visibility over prohibition:

- retain canonical placements and completed-game facts;
- version the policy recorded with derived evidence;
- show producers enough evidence to reproduce or explain awards;
- keep correction and recomputation possible while the competition is explicitly experimental;
- centralize standings and crown derivation so one policy change cannot produce inconsistent surfaces.

Result records remain useful for audit and analysis without requiring immutable season rules. Evidence preservation and policy immutability are different promises.

### Formalize only when real stakes create a trust obligation

Draft states, frozen rules, immutable awards, calibration gates, and activation proofs are tools, not virtues. Introduce them when a concrete condition appears:

- prizes, money, qualification, sponsorship, or contractual commitments depend on standings;
- a published season start promises one scoring policy for the entire competition;
- multiple operators need controlled approval or audit separation;
- participants need to reproduce or challenge an award after the fact;
- policy changes can no longer be explained honestly as Season 0 experimentation;
- game volume makes recomputation, correction, or producer review operationally risky.

Define the promise first—what is frozen, when it becomes binding, how corrections work, and what evidence participants may inspect—then add the smallest mechanism that enforces it. Do not prepay mature-competition complexity merely because it might eventually be useful.

## Why This Matters

Rich data turns spectating into retention. A leaderboard gives players a reason to enter another game; owner analysis gives them a reason to edit an agent; revision-separated results help them judge whether the edit worked. Together these surfaces create a voluntary optimization loop without prescribing one correct strategy.

Audience separation protects suspense and trust. Point receipts belong on the results route so a viewer can choose spoilers. Hidden ratings stay producer-only so an uncertain quality estimate does not compete with the public championship. Owners receive deeper analysis than the public because they need actionable evidence without receiving other players' private material or producer internals.

Ceremony has a real cost. Draft, calibration, activation, and immutability systems add states, migrations, UI, documentation burden, and new failure modes. Before meaningful external stakes exist, they turn every rules experiment into a governance event and slow the learning Season 0 exists to produce. Versioned code plus producer evidence preserves enough accountability to iterate; stronger guarantees should arrive alongside stronger promises.

## When to Apply

Apply this pattern when designing seasonal competition, agent dashboards, postgame analysis, analytical revisions, scoring changes, or producer diagnostics for an early-stage game.

Keep the lightweight adjustable model while:

- the season is clearly experimental;
- one operator owns the competition;
- prizes and contractual stakes are absent;
- scoring changes are part of product discovery;
- corrections can be reviewed and explained directly.

Move toward frozen policy and durable award finality only when external stakes or explicit participant promises make retroactive interpretation changes a trust problem rather than an iteration choice.

The spoiler boundary applies at every maturity level: outcomes, championship receipts, and point totals belong on an explicitly spoiler-forward results route, while the ordinary completed-game route lets viewers choose replay or results (`packages/web/src/app/games/[slug]/components/completed-game-entry.tsx:82-124`).

## Examples

### A productive Season 0 loop

1. An agent completes several rated games and appears in public standings with rank, games, wins, and placement performance.
2. Its owner opens private analysis, inspects receipts and placement distribution, and follows links into authorized completed-game evidence.
3. The owner changes strategy instructions. Influence quietly creates an analytical revision because an effective runtime input changed.
4. Later results appear under the new revision, allowing comparison of games, wins, points, and average finish against the prior revision.
5. Producers inspect hidden rating events, snapshots, and receipt evidence to judge field-quality scoring and recalibration.
6. If play reveals poor scoring balance, the operator changes the versioned policy, tests it, and treats the change as Season 0 iteration rather than inventing an activation-proof exception process.

### Correct audience boundaries

| Audience or surface | Appropriate evidence |
|---|---|
| Public leaderboard | Rank, agent, architect credit, points, games, wins, placement context |
| Results route | Winner, full postgame facts, and point receipts ordered by awarded points |
| Owner analysis | Revision-separated performance, placement distribution, receipts, exports, authorized reasoning links |
| Producer diagnostics | Hidden ratings and uncertainty, rating events, pregame snapshots, policy evidence, eligibility anomalies, unsettled seats, revision records |

The receipt component orders results by total points, then placement, then agent name (`packages/web/src/app/games/[slug]/components/completed-game-entry.tsx:131-136`). The completed-results review is the surface that renders those receipts (`packages/web/src/app/games/[slug]/components/completed-results-review.tsx:164-170`, `packages/web/src/app/games/[slug]/components/completed-results-review.tsx:232-253`).

### A later high-stakes season

Suppose a future season offers a cash prize and publishes a fixed scoring promise before registration. That promise creates a different product contract. The season may then need a frozen policy identifier, an effective-at boundary, durable award records, correction procedures, and an operator approval step. Those mechanisms are justified because changing interpretation after games begin could change who receives something valuable. They are not retroactive evidence that Season 0 needed the same machinery while rules, participation, and useful analytics were still being discovered.

## Related

- [Agent strategy observability spine](agent-strategy-observability-spine.md) — the evidence-before-optimization pattern for agent strategy diagnostics.
- [Production MCP role/resource split](production-mcp-role-resource-split.md) — the authorization and delivery boundary for owned-agent and producer data.
- [Owner-scoped alliance read models](owner-scoped-alliance-read-models.md) — a compact/detail privacy pattern for player-owned analysis.
- [API startup recovery resumes interrupted games](../runtime-errors/api-startup-recovery-resumes-interrupted-games.md) — the operational boundary on claims about reliable ranked-result settlement.
