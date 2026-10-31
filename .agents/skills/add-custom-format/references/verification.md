# Verification matrix

## Rules and contracts

- minimum/maximum roster boundaries and every role collision;
- legal and illegal action matrices for each branch;
- non-JSON, fenced/embedded JSON, empty object, missing/extra fields, stale handles, duplicate identities, and illegal values;
- provider exhaustion, timeout, unavailable method, and deterministic fallback provenance;
- optional speech absence without fabricated contestant text.

## Canonical authority

- every committed partial prefix projects successfully;
- illegal ordering, duplicates, missing atomic partners, invalid speakers/voters/targets, and contradictory aggregates fail;
- direct append and durable batch commit enforce the same reducer;
- persisted corrupt prefixes are not returned as complete;
- historical versions retain their frozen meaning.

## Durability

- restart after every committed cursor matches uninterrupted output;
- deterministic draw/result replay;
- atomic dependent decisions;
- same actor in multiple ordered provider slots;
- no uncommitted continuity, transcript, event, or publication leakage.

## Presentation and facts

- viewer cue order from typed sanitized decisions;
- live prefix equals replay prefix;
- reconnect never replays already published beats or leaks a later atomic value early;
- completed entry uses the last trusted snapshot;
- reduced motion preserves semantic beats and readable dwell;
- mobile preserves role and target legibility;
- House/revealed facts, results, owner learning, MCP, and simulation artifacts agree.

## Repository gates

Run focused tests while building, then:

```bash
bun run test
bun run test:postgres
bun run check
```

Report pass, fail, skipped, and environment-blocked checks separately.


## Presentation ownership and historical replay

For new Influence root schema revisions, add explicit canonical projection ownership in `CANONICAL_PRESENTATION_OWNERS`, viewer ownership in `VIEWER_EVENT_OWNERS`, and an exhaustive real cue renderer. Register representative branches in `FORMAT_KERNEL_VIEWER_SCENARIO_IDS`; the catalog/prefix render test must fail for a format without a fixture. Test required speech consumption exactly once, missing projectors, unknown runtime events, and incomplete live delivery buffering. Never satisfy coverage with a generic fallback card.

Preserve old games under their frozen root and decision contracts. Exercise old speechless fixtures through the current scene and preserve pinned production projection v3/v4 source identities; newly built production snapshots use v5. Two Names nominations, override use/decline, and replacement must consume their existing thinking/speech before the canonical reveal, including when one actor owns every role. For Safety Bounce, assert actor/target and pool transitions, thinking then speech then reveal, reconnect/seek, mobile and reduced motion. Transparent character overlap is intentional; do not add overlap checks or special layout rules for ordinary full-body images.
