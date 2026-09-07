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
