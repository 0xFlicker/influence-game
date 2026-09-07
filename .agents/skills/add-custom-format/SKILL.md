---
name: add-custom-format
description: Add and prove a custom round format in Influence, including capability selection, exact agent contracts, canonical lifecycle authority, durable staged execution, viewer choreography, read models, docs, and activation. Use when a requested format is not merely another sealed non-polarity tally card or when it introduces roles, branches, speeches, multiple social windows, custom eligibility, public actions, or format-specific UI.
---

# Add Custom Format

Build the smallest complete end-to-end format slice that preserves Influence's event authority and durable-turn guarantees. Do not begin with the viewer or a phase-specific side path.

## Start with repository truth

1. Read the repository `AGENTS.md`, `CONCEPTS.md`, current format catalog, canonical event contracts, durable cursor types, viewer decision compiler, and relevant docs under `docs/solutions/`.
2. Inspect the latest completed format and one capability-adjacent format. Do not copy a sealed-ballot resolver when the new rules introduce different participation or lifecycle semantics.
3. Confirm whether the checkout is dirty. Preserve all unrelated work; if ownership is unclear, ask whether to commit first or continue in place.
4. Write or update a plan that names explicit activation gates. Keep the new format out of the default manifest until engine, persistence, recovery, and viewer proof is green.

## Classify the capability before coding

Read [capability-fit.md](references/capability-fit.md). Choose a distinct capability whenever an existing capability would lie about legal voters, legal targets, public versus sealed action timing, branching, social windows, resolution shape, or viewer state.

The catalog is the single registry. Keep format identity, admission, policy, decision descriptors, aggregate shape, and presentation handler exhaustive there. Do not add duplicate allowlists or compatibility aliases.

## Build in authority order

1. **Pure policy:** implement legality, availability, scoring, ties, and branch matrices as pure functions. Prove boundary rosters and every role collision.
2. **Exact agent contracts:** use provider-native tools or exact strict JSON. The engine supplies request-local legal handles and validates the decoded semantic value. Every required call gets a deterministic rules-legal fallback; optional speech gets typed absence.
3. **Canonical lifecycle:** define public/producer events and one capability-owned prefix reducer. It must accept every valid committed partial prefix and reject impossible order, identity, participation, aggregate, and terminal combinations.
4. **Durable orchestration:** read [durable-stages.md](references/durable-stages.md). Give every consequential stage a typed cursor and planned intent. Persist randomness as an accepted canonical result. Bind provider receipts to ordered action slots, never actor ID alone.
5. **Read models:** project House facts, revealed-round facts, completed results, owner learning, simulation artifacts, API reads, and watch state from canonical events only. Never parse transcript prose.
6. **Viewer:** compile sanitized viewer decisions into trusted snapshots and semantic cues. Live, reconnect, replay, completed entry, mobile, and reduced motion must consume the same cue stream. Animation may interpolate facts but never author them.
7. **Activation:** update the default manifest only after explicit-manifest proof passes. Update rules, concepts, MCP text, simulation docs, observability docs, and the simulator JSDoc in the same change.

## Treat atomic branches explicitly

If one accepted decision requires another value to be legal, commit them in one durable logical turn. Publish separate ordered canonical events when presentation pacing needs separate beats. Test the same actor owning multiple ordered calls; their provider coordinates must remain distinct.

If a format can run the existing Mingle more than once, carry a structural window identity through cursor state, room/alliance/huddle scope, deterministic IDs, provider ordinals, recovery, and viewer cues. A terminal marker alone is insufficient.

## Verification

Read [verification.md](references/verification.md). At minimum, prove:

- pure rule and availability boundaries;
- malformed structured outputs and typed fallbacks;
- every valid canonical partial prefix plus corrupt-order rejection;
- uninterrupted and restart-after-each-stage equivalence;
- same-actor multi-slot replay where applicable;
- direct event append and atomic turn-commit validation;
- live/replay cue equality, reconnect gating, completed entry, reduced motion, and mobile layout;
- completed facts and simulation observability;
- `bun run test`, `bun run test:postgres`, and `bun run check`.

Use Bun only. A sandbox `ECONNREFUSED 127.0.0.1:54320` is not proof Postgres is down; rerun DB-backed checks with local DB visibility.

## Finish

Run the skill validator when changing this skill. In the handoff, name the capability choice, canonical/durable invariants, viewer behavior, activation state, and exact verification results. Do not claim deployment or live proof from source tests.
