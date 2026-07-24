# Format-kernel web contract drift

**Date:** 2026-07-24  
**Branch:** `feat/sequester-format-kernel`  
**Status:** Web UI intentionally **not** updated. This note is for whoever next touches watch / completed-results / transcript parsers.

## Summary

Standard rounds no longer use **expose** as an agent-facing ballot or elimination input. Agents cast **empower only**. Elimination is owned by the **format kernel** (Save-or-eliminate / Vote Bomb / Safety Bounce), not Power → Council.

## What web currently may still assume

| Assumption | Reality now |
|------------|-------------|
| Vote lines look like `empower=X, expose=Y` | New games log `votes: empower=X` only |
| Revealed vote ledger always has expose targets | `exposeTargetId` / `exposeTargetName` optional / absent |
| Round has power action + council pair | Format rounds: `powerAction`/`candidates` null; `formatId` / `formatMethod` may be set on `RoundResult` |
| Phases include POWER / COUNCIL every round | Default path: `FORMAT_MENU` → `FORMAT_PICK` → `FORMAT_MINGLE` → `FORMAT_RESOLVE` |
| Post-vote pressure / exposure scores drive UI | Not built on default path; expose scores from ledger may be empty |

## Surfaces to update later (not done here)

- Transcript / system-message parsers (`packages/web/.../message-parsing.ts` and similar)
- Completed results round cards that hard-require expose / power / council sections
- Live watch pressure widgets keyed to expose / council candidates
- Audio cues for council nominees / power actions on standard rounds
- Any client copy of “expose someone” in rules UI (server rules page content is already updated in `docs/rules-page-content.md`)

## Safe parsing guidance

1. Treat **empower** as the only required standard-vote field for new runs.  
2. If `expose` is missing, do not invent one.  
3. Prefer phase enum / `formatId` over assuming Power/Council always fire.  
4. Historical replays may still contain dual-ballot `vote.cast` with `exposeTarget`; support both shapes.

## MCP judgment (already applied)

- Management rules packet (`packages/api/src/game-mcp/rules.ts`) updated to empower-only + formats.  
- Active-match MCP still must not expose in-match vote tools (unchanged policy).  
- `read_round_facts` consumers should tolerate null expose on ledger rows; deep postgame redesign deferred.
