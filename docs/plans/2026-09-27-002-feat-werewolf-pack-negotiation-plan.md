---
title: Werewolf unanimous pack negotiation
type: feat
status: completed
date: 2026-09-27
---

# Werewolf unanimous pack negotiation

Replace the single pack exchange and random attack tie-break with up to three proposal/ballot attempts each night. Two living wolves each receive one optional sequential proposal per attempt, followed by simultaneous sealed target choices. Unanimity locks the attack; disagreement reveals both choices to the pack and retries. Three disagreements cause no attack. A lone wolf skips proposals and resolves with one ballot. Doctor and Seer still act once and resolve together at dawn, including after pack failure.

Choose the opening speaker from the game seed and night number; alternate initiative after each failed attempt. Speech never determines targets or agreement. Canonical `werewolf.pack_vote_resolved` events own the attempt, ballots, agreed target, and end reason. Each new attempt clears pending actions, preserving the last resolution in history. Rules version 3 rejects older experimental logs without rewriting them or introducing a compatibility path.

## Authority and implementation map

- `packages/engine/src/werewolf/types.ts`, `rules.ts`: negotiation state, deterministic initiative, proposal and ballot scheduling, exact resolution validation, nullable night attack, version bump. Retain strict target contracts and existing typed provider fallbacks.
- `runner.ts`: reuse the frozen concurrent decision batch for pack ballots. Reserve every ballot before dispatch, commit privately in canonical order, then reveal the complete result. Sequential proposals remain immediately visible to the pack.
- `observation.ts`: wolf-only current attempt/order/stage and previous resolved ballots; Omniscient receives resolved ballots; Mystery never receives pack attempts, choices, or the reason nobody died. Neither spectator audience sees pending ballots or private thinking. Observations must be identical before and after another wolf's private commitment, including after owner replacement.
- `report.ts`, `api-simulate.ts`, web `werewolf-viewer.tsx` and `werewolf-lobby.tsx`: readable attempt results, named votes, retry/no-attack explanations in Omniscient, unchanged Mystery secrecy. Render Doctor/Seer evidence even when the agreed attack is null. Preserve Omniscient chat role labels.
- API `services/werewolf-games.ts`: existing generic event persistence, action planning, owner fence, and audience-local prefix replay should support this without a schema migration. Verify with PostgreSQL recovery and replay tests rather than adding a second execution path.
- MCP: existing Werewolf inspection gap remains explicitly tracked in `2026-09-27-001-feat-werewolf-mcp-inspection-plan.md`; include negotiation facts in that forthcoming audience reader. Do not route these events through Influence MCP defaults.
- Docs: Werewolf rules, observability, local evaluation, simulator JSDoc, domain concepts, and architectural learning. No added dependency, flag, migration, or new model schema is needed.

## Verification

Prove first/second/third-attempt agreement, three disagreements, seeded and alternating initiative, single survivor, proposal response visibility, sealed partial ballots, illegal targets and forged resolution rejection, provider-unavailable fallback, unchanged Doctor/Seer behavior, replay at every prefix, and resume after a private ballot commit using accepted journal values without another provider call. Verify Mystery/Omniscient cursor separation and readable CLI/web results. Run provider-free baseline, PostgreSQL baseline against the dedicated local test database, type/lint checks, and Werewolf browser journey. Do not start a paid game for this change.

Reusable implementation hint: trace a new game decision through rules → planned provider calls → private commitments → canonical reveal → actor/audience projections → CLI/web/MCP; test interruption immediately before the reveal, where secrecy and recovery contracts meet.

## Completed validation

- `bun run test`: 2,078 passed, 5 existing skips, 0 failures across 194 files.
- After adding the dedicated fallback-restart regression, `bun test packages/engine/src/__tests__/werewolf.test.ts`: 38 passed; engine typecheck passed again.
- `TEST_DATABASE_URL=postgresql://influence:influence@127.0.0.1:54320/influence_werewolf_test bun run test:postgres`: 1,773 passed, 0 failures across 149 files, including provider-journal recovery after a partial pack ballot.
- `bun run check`: all workspace type and lint checks passed.
- Werewolf browser journey: 3 passed, including real API/scripted execution, Omniscient failed ballots and Doctor/Seer rendering, Mystery concealment, and mobile overflow checks. Inspected `/tmp/werewolf-pack-ballots-mobile.png`.
- No paid game or live-model evaluation was started. Browser harness cleanup completed; generated Next.js test-only configuration changes were removed. Existing game logs remain untouched.
