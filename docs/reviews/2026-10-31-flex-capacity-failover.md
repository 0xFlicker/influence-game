# Flex capacity failover validation — 2026-10-31

## Root cause

The coordinated gameplay path disables SDK/legacy transport retries so every actual dispatch can be journaled. It lacked a coordinator-owned service-tier transition. A Flex capacity 429 with Retry-After therefore entered ordinary model health cooldown; standard processing was blocked with Flex. Exhaustion reached phase-level provider-unavailable policies, allowing legal absence/synthetic decisions instead of keeping the unfinished call pending. These findings come from the local owning code. The incident counts and timestamps for `keen-ochre-wolf` were supplied by the operator, not independently re-audited here. Its historical events and result were not changed.

## Implemented behavior

- Explicit hosted OpenAI Flex HTTP 429 `flex_unavailable` or `resource_unavailable` immediately retries the same invocation/model with `service_tier: "default"`. The installed SDK and official API contract define `default` as standard processing; `auto` can inherit project configuration.
- Existing durable health machinery stores a Flex-only scope. Calls bypass Flex for 5–15 minutes, bounded by Retry-After; ordinary calls can try Flex after expiry. Standard success does not clear the Flex cooldown.
- Each actual dispatch retains its own durable attempt identity, sanitized evidence, requested/actual tier, usage and frozen rate card. Strict schema, semantic validation, context identity, reasoning and canonical acceptance fences remain in force. Availability/indeterminate attempts do not exhaust semantic-output repair limits.
- Exhausted operational routes raise a distinct deferred error. Influence and Werewolf preserve the unfinished turn and accepted sibling results, release ownership and retry after 1, 2, 4, 8, 16, then 30 minutes. Recovery suspends after 24 waves; permanent blockers suspend sooner when no temporarily unavailable route remains. Cancellation and malformed-output policies remain distinct.
- New-game recommendations include native Anthropic Haiku 5.5 and native xAI Grok 4.3, the economical supported audited options, with 1,000-call fallback caps. Admin creation uses configured/available recommendations for contestants and House. API creation without an explicit policy and the weekly cron/free-queue draw share the defaults for both routes. Existing sealed manifests and explicit custom policies are unchanged.

## Coverage and verification

The shared adapter/coordinator covers contestant and House calls, Werewolf decisions, retrospectives and context compaction. House Cuts' separate `auto` retry was replaced with shared explicit tier failover while preserving its local journal/budget. Outside-game uncoordinated SDK helpers retain their separate transport policy.

Deterministic regressions cover Flex-to-standard success, subsequent cooldown routing, bounded recovery, unrelated error policies, restart after Flex terminalization and standard acceptance, one accepted result, standard cost/evidence, and pending required finalist speeches/jury ballots. No paid simulations or live inference probes were run.

Final required baselines:

| Command | Result |
|---|---|
| `bun run test` | 3,203 passed, 5 skipped, 0 failed; 336 files |
| `bun run test:postgres` | 2,286 passed, 0 failed; 206 files; sequential local PostgreSQL run |
| `bun run check` | All workspace type checks and lint passed |
| `git diff --check` | Passed |

The first full runs exposed old expectations for provider-unavailable behavior and Daily fallback defaults, plus a retrospective journal-exhaustion classification regression. The expectations were updated and the classification corrected; the final complete baselines above were rerun after those changes, the creation-default review fix and integration with current main.

## Limits

A crash after remote dispatch but before durable terminalization is indeterminate. Without provider idempotency, duplicate remote inference/billing cannot be ruled out; accepted results and canonical effects remain fenced against duplication. After bounded suspension, operator repair is required; no generic provider-suspension resume endpoint is added here. Frozen fallback budgets still apply.

The requested checkout started clean. The PR branch integrates upstream main through `f8a1b2bd`; conflicts preserved the incoming game-schema and playback changes alongside availability recovery. No deployment or production mutation was performed.


## Follow-up review

Manual review found that API creation without an explicit model policy still used a primary-only route. Defaults now apply at `creationModelRouting`, shared by Influence creation, Werewolf creation and Werewolf lobbies. Explicit policies and historical reads remain exact. Added regression assertions cover both contestant/House creation defaults, explicit-policy preservation, and both routes in weekly free-queue draws. The weekly scheduler calls the free-queue API; no infrastructure change is needed.

External Grok review was attempted with read-only snapshots, then retried with a smaller source diff and noninteractive execution. It returned no findings or completed review before being stopped; this is inconclusive, not a clean external review. Manual review found no further actionable defects after the creation-default fix.
