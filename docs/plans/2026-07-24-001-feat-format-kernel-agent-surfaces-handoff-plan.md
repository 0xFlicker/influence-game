---
title: "feat: Format kernel agent surfaces handoff"
type: feat
status: active
date: 2026-07-24
origin: docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md
prior_plan: docs/plans/2026-07-23-001-feat-sequester-format-kernel-plan.md
branch: feat/sequester-format-kernel
---

# feat: Format kernel agent surfaces handoff

## Summary

Complete the sequester **format kernel** so live LLM agents understand and play formats: inject format-pressure context, implement real `InfluenceAgent` tools/prompts for menu pick and format play, stop teaching classic Power→Council on the default path, then validate with OpenAI/local sims. Preserve a flexible per-format module contract so formats can be added or removed without rewriting every agent prompt.

---

## Why this handoff exists

### Problem this session left open

Board mechanics for the format kernel are largely **working** (phase machine, resolvers, MockAgent, short MockAgent games). **Player/agent cognition is not.**

- `packages/engine/src/agent.ts` (`InfluenceAgent`) has **no** format tools or prompts.
- `context-builder.ts` has **no** format-pressure card.
- Product rules (`docs/rules-page-content.md`) and MCP rules (`packages/api/src/game-mcp/rules.ts`) still describe **Power → Council**.
- LLM sims therefore run a new elimination engine while agents still reason about shield/eliminate/pass and Council pairs — **sim quality is misleading**.

### Operator priority (session consensus)

1. **Agent decision surfaces first** — otherwise format-kernel sims are near-worthless.
2. **Flexible formats** — agents do not need the full catalog every turn; they need role-scoped context:
   - House builds a **two-option menu** (code-side today; may stay deterministic).
   - Empowered **picks one** of the two offered.
   - Everyone **plays** the locked format (mingle under rules, then ballots / bounce).
3. **Archetype × format strategy packs** are **later** — after agents can legally play.
4. Do **not** restart full product architecture. Extend the format-module + IAgent pattern already started.

---

## Source of truth (read these first)

| Artifact | Path | Role |
|----------|------|------|
| Requirements | `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md` | Product R/F/AE contract |
| Kernel plan | `docs/plans/2026-07-23-001-feat-sequester-format-kernel-plan.md` | Original implementation units U1–U7 |
| Vocabulary | `CONCEPTS.md` | Format kernel, Round format, Format menu, launch formats |
| This handoff | `docs/plans/2026-07-24-001-feat-format-kernel-agent-surfaces-handoff-plan.md` | **What remains + how to finish** |

### Branch / commits landed (as of handoff)

Branch: **`feat/sequester-format-kernel`**

| Commit theme | Contents |
|--------------|----------|
| Pure resolvers | `packages/engine/src/formats/*`, `format-resolvers.test.ts` |
| Kernel wiring | Phase machine, `format-kernel.ts`, runner, MockAgent, integration tests |
| Sim ergonomics | `--max-rounds`, **no whole-game timeout unless opted in** |
| Docs | Requirements + kernel plan + CONCEPTS entries |

---

## Session decisions (locked product rules)

Carry these forward; do not re-litigate without operator.

### Round spine (standard pre-endgame)

```
Lobby
  → Alliance forming (+ scarce pre-format alliance huddles)
  → Empower vote (plurality; re-vote / wheel as today)
  → House offers exactly 2 launch formats
  → Empowered picks exactly 1
  → Format-aware mingle (all launch formats)
  → Format resolve → exactly 1 elimination
  → checkGameOver / next round / endgame at 4 alive
```

Classic **Power (eliminate/protect/pass) → Reveal → pre-Council huddles → Council** is **not** the default path (may return later as a format card).

### Empower / expose / ties

| Decision | Value |
|----------|--------|
| Empower | Stays; primary power is **format pick** + **format tiebreak** |
| Empowered eligibility | Fully eligible to die same round; pick is not a shield |
| Empowered participation | Full participant on ballots/bounce; tiebreak only on deadlock |
| Expose ballot | **Not required** for launch trio; still cast today as dual-ballot schema legacy — prefer empower-only when touching vote schema |
| Format ties | Empowered chooses among **tied set only** |
| Vote Bomb empty positive | **Vacated** under strict non-self ballot repair (origin R26 not implemented as free any-elim) |
| Self-votes | Illegal (incl. self-save default off; no self-bomb; no self-bounce target) |
| Sole vulnerable | Auto-elim, no vote call |
| House post-pick twist | **None** — fixed rule sheets only |
| Menu | Round 1: any 2 of 3; later: hard-ban last format when 2 alternatives remain |
| Bounce vs mingle order | **mingle → bounce → vote** |
| Visibility | Bounce pointers **public** as made; SoE/Vote Bomb/SB elim ballots **sealed** until reveal |
| Endgame | Unchanged (Reckoning / Tribunal / Judgment) |
| Resume mid-format | Fail-closed / unsupported for new mid-states |
| Game sim timeout | **None by default**; only `--game-timeout-sec/ms` or `INFLUENCE_SIM_GAME_TIMEOUT_MS` |

### Social / tokens

- Prefer **no required multi-beat pre-format room Mingle** for token budget (kernel plan KTD4); alliance forming + scarce pre-format huddles stay.
- Post-pick format mingle is the main scheme window under known rules.
- Current code may still run Mingle I multi-beat before vote — agent-surface work should **not** re-inflate pre-format multi-beat as required.

---

## Launch formats (complete rule sheets for implementers)

IDs in code: `save_or_eliminate` | `vote_bomb` | `safety_bounce`  
Files: `packages/engine/src/formats/{save-or-eliminate,vote-bomb,safety-bounce,menu,types,index}.ts`  
Runner: `packages/engine/src/phases/format-kernel.ts`  
Pressure helper (thin): `packages/engine/src/format-pressure.ts`

### 1. Save-or-eliminate (`save_or_eliminate`)

- Each alive player: one sealed ballot, polarity `save` (+1 net) or `eliminate` (−1 net), target living non-self.
- Lowest net eliminated; dual lowest → empowered picks among tied set.
- Order: **mingle → ballot**.

### 2. Fewest Votes / Vote Bomb (`vote_bomb`)

- Each alive player: one sealed non-self elim-direction vote.
- **Zero votes = safe** (cannot be eliminated).
- Among players with ≥1 vote, **fewest** eliminated; ties → empowered among that set.
- Critical agent teaching: piling the same name can make that person the **sole positive** and still kill them; strays create 1-vote victims.
- Order: **mingle → ballot**.

### 3. Safety Bounce (`safety_bounce`)

- Random starter begins **safe** (public).
- Public chain: safe actor points → target **vulnerable**; vulnerable actor points → target **safe**; only unclassified legal targets.
- Expected pools: ceil(N/2) safe, floor(N/2) vulnerable when complete.
- Then sealed vote **only among vulnerable**; most votes out; sole vulnerable auto-elim.
- Order: **mingle → bounce → vote**.

### Deferred catalog (do not implement in this handoff)

From origin brainstorm — later format cards only:

Room Roulette · Even Votes · Double Votes · Even & Double · Dual Houses · Restricted-history · Date Night · Kingdom / Kings & Peasants · Ranked Elimination · BB-style nominations + veto · multi-elim · classic Influence as format card · expose-gated menus · post-pick mechanical twists.

---

## What is already done (do not reimplement)

| Area | Location | Notes |
|------|----------|--------|
| Pure resolvers + menu + unit tests | `packages/engine/src/formats/`, `__tests__/format-resolvers.test.ts` | AE2–AE4 math, N=5..12 bounce sizes |
| Phase enum + machine path | `types.ts` Phase.FORMAT_*, `phase-machine.ts` | vote → format_menu → pick → mingle → resolve |
| Runner branches | `game-runner.ts` | Calls format phase handlers |
| Format phase handlers | `phases/format-kernel.ts` | Menu, pick, mingle, resolve; House system lines; fallbacks if agent methods missing |
| IAgent optional methods | `game-runner.types.ts` | `pickRoundFormat`, SoE/Bomb/bounce/vote/tiebreak |
| MockAgent | `__tests__/mock-agent.ts` | Full format methods |
| Integration tests | `__tests__/format-kernel-integration.test.ts` | MockAgent full short game, anti-repeat |
| Vote skips council bench | `phases/vote.ts` | No exposure-bench resolve on default path; expose still dual-cast schema |
| Sim flags | `simulate.ts` | `--max-rounds`, no default game timeout |
| CONCEPTS | `CONCEPTS.md` | Format kernel glossary |

### Critical gap

`format-kernel.ts` **falls back** when methods missing:

- Pick → first offered format  
- Ballots → last/first-other heuristics  
- Bounce → first unclassified  

So **MockAgent works; InfluenceAgent does not play strategically.**

---

## Flexible architecture (required for handoff)

### Principle

Agents never need the full format catalog in every prompt. Each turn injects only:

1. **Role** (empowered pick vs player play vs mingle under locked format)
2. **Offered pair** or **locked format id**
3. **That format’s rule sheet + legal action schema**
4. **Board facts for this step** (bounce board, eligible targets, tied set)

### Recommended module contract (extend existing `formats/`)

Per format id, own:

| Concern | Owner |
|---------|--------|
| Pure resolution math | `formats/*.ts` (exists) |
| Public rule sheet string(s) | co-locate with format (extend `format-pressure.ts` RULE_SHEETS or per-file export) |
| Agent tool JSON schema + prompt fragment | `InfluenceAgent` methods keyed by format, or `formats/<id>/agent-surface` if split |
| Runner collection/reveal | `phases/format-kernel.ts` (exists; call real agent methods) |

Adding a format = pure math + rule sheet + tool/prompt surface + register in `LAUNCH_FORMAT_IDS` + menu eligibility.  
Removing = delist from launch set. **Do not** hardcode “all formats” into base personality prompts.

### Observability spine (mandatory)

Same as existing vote/power tools:

1. Typed tool call  
2. Private `agent_turn` with thinking / reasoningContext / decisionLog  
3. Canonical board events only for accepted outcomes (full format events still thin — prefer not to block agent surfaces on perfect event schema)  
4. Public system lines only for public acts (bounce, reveals, menu/pick)

Reference: `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`.

---

## Remaining work — implementation units

### U1. Format-pressure projection wired into PhaseContext

**Goal:** Every format decision and format mingle sees one shared pressure object.

**Files:**
- `packages/engine/src/format-pressure.ts` (extend)
- `packages/engine/src/game-runner.types.ts` (`PhaseContext.formatPressure?`)
- `packages/engine/src/context-builder.ts`
- `packages/engine/src/phases/format-kernel.ts` (set on contextBuilder before agent calls)
- Tests: unit for projection contents; smoke that format-mingle context includes rule sheet

**Must include:**
- empowered id/name  
- offeredFormats (pre-pick) / selectedFormat (post-pick)  
- ruleSheetSummary for locked format  
- optional bounceBoard mid-chain  
- never live sealed ballot targets  

**Patterns:** `post-vote-pressure.ts` injection pattern (even though classic pressure is retired on default path).

---

### U2. InfluenceAgent format tools + methods (core)

**Goal:** Real LLM agents implement all optional IAgent format methods with the same quality bar as `cast_votes` / `use_power` / `council_vote`.

**Files:**
- `packages/engine/src/agent.ts` (tools, prompts, validation, fallbacks)
- `packages/engine/src/__tests__/agent-structured-output.test.ts` (extend schemas)
- Optionally split tool defs if `agent.ts` is too large

**Methods / tools:**

| Method | Tool (suggested) | Who | Input | Output |
|--------|------------------|-----|-------|--------|
| `pickRoundFormat` | `pick_round_format` | Empowered | two format ids + short blurb each | formatId ∈ offered |
| `getSaveOrEliminateBallot` | `save_or_eliminate_ballot` | All alive | legal targets | polarity + target name |
| `getVoteBombBallot` | `vote_bomb_ballot` | All alive | legal targets | target name |
| `getBouncePointer` | `bounce_pointer` | Current actor | unclassified names + running board | target name |
| `getSafetyBounceVote` | `safety_bounce_vote` | All alive | vulnerable names only | target name |
| `breakFormatEliminationTie` | `format_tiebreak` | Empowered | tied names only | target name |

**Prompt requirements:**
- Paste **only** the active format rule sheet (from module), not the whole catalog.
- Teach Vote Bomb “loading vs stray kill” without hard “must scheme” gates.
- Explicit: format pick is not immunity; empowered still votes/bounces.
- Validate names against alive lists; deterministic fallbacks like existing vote code.
- Strategy packet / decisionLog / strategicLens where pattern already exists.

**Patterns:** `getVotes` / `getPowerAction` / `getCouncilVote` in `agent.ts` (~lines 625–720 tools, 2293–2740 methods).

**Verification:** Structured-output tests; short `simulate:local` or OpenAI sim with `--max-rounds 1` shows non-fallback picks in turns JSONL (`format-pick`, `format-ballot`, `bounce-pointer`).

---

### U3. Stop teaching classic Power→Council on the default path

**Goal:** Agent system/phase prompts no longer instruct eliminate/protect/pass or Council pair as normal standard-round play.

**Files:**
- `packages/engine/src/agent.ts` (phase descriptions, vote prompt, power/council call sites unused on default path)
- Any strategy guidelines that hardcode council math for standard rounds

**Approach:**
- Vote prompt: empower remains; de-emphasize or remove expose-as-elimination-math (expose may still be cast for ledger legacy — label it honestly as non-elimination if kept).
- Ensure `getPowerAction` / `getCouncilVote` are not required for standard rounds (already true if runner never calls them).
- Format mingle phase description: “play under locked format,” not “pressure empowered before power action.”

**Do not** delete classic code yet — needed if classic format card returns; just remove from **default** prompt path.

---

### U4. Format-aware mingle + alliance/huddle language

**Goal:** Post-pick mingle and pre-format huddles talk the right game.

**Files:**
- `packages/engine/src/agent.ts` (mingle / alliance prompts)
- `context-builder.ts` (format pressure available in FORMAT_MINGLE)
- Huddle outcome field language if it still says “Council posture” only

**Requirements:**
- Pre-format (before pick): agents may plan empower + contingent branches; they do **not** know the format yet.
- Post-pick mingle: inject locked format + rule summary + “ballots sealed / bounce public” as appropriate.
- Keep mingle token budget intentional (do not re-add full pre-format multi-beat as required).

---

### U5. Rules + MCP agent contract (so external agents match)

**Goal:** Written rules match the kernel so MCP/enrolled agents are not lied to.

**Files:**
- `docs/rules-page-content.md` — rewrite standard-round phases 4–8 for format kernel  
- `packages/api/src/game-mcp/rules.ts` — Votes/Power section → Formats  
- `docs/reasoning-transcript-observability.md` — new actions  
- `docs/local-model-evaluation.md` — short format-kernel sim recipe  
- Keep endgame sections as-is  

**Patterns:** Existing rules page structure; origin F1 order.

---

### U6. Sim validation + operator recipes

**Goal:** Prove LLM agents play formats with legible reasoning.

**Commands (current ergonomics):**

OpenAI (Doppler has `INFLUENCE_LLM_BASE_URL` for LM Studio — **catalog forces hosted OpenAI**):

```bash
cd packages/engine
doppler run --project social-strategy-agent --config dev -- \
  bun run simulate -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model-catalog openai:gpt-5-mini
```

Local LM Studio:

```bash
cd packages/engine
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- \
  --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
  --model <lm-studio-model-id> --llm-timeout-sec 300
```

**Success checks (origin success criteria):**
- Transcript: FORMAT MENU / FORMAT LOCKED / FORMAT RESOLVE; no power-action / council elim on standard rounds  
- Turns JSONL: real `format-pick` / `format-ballot` / `bounce-pointer` with thinking  
- Agents reference active format rules in thinking  
- At least two formats show non-identical coalition scripts across rounds  

**Note:** Whole-game timeout is **off by default**. Only add `--game-timeout-sec` if you want a wall clock.

---

### U7. Deferred (explicitly not this handoff)

- Archetype / persona **format-specific strategy packs**  
- Full format **canonical event** family + revealed-facts migration + postgame cohorts  
- Rich watch UI / audio  
- Durable mid-bounce / sealed-ballot resume  
- Empower-only vote schema migration (nullable expose) if still dual-casting  
- Drop multi-beat Mingle I rooms if still running (token KTD4) — product cleanup  
- Full deferred format catalog  

---

## Suggested execution order

```
U1 format-pressure in PhaseContext
  → U2 InfluenceAgent tools/methods
  → U3 strip classic default-path teaching
  → U4 format-aware mingle prompts
  → U6 sim validation (can interleave early with U2)
  → U5 rules/MCP/docs
  → (later) archetype format packs, events, watch
```

Do **not** start U5 docs polish before U2 makes sims legible.

---

## Provider / env pitfalls (session hard-won)

| Issue | Fact |
|-------|------|
| Doppler `dev` sets `INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1` | Routes sims to LM Studio even when `OPENAI_API_KEY` is present |
| Project base URL wins over hosted OpenAI | `createLlmClientFromEnv` priority |
| Force OpenAI | `--model-catalog openai:gpt-5-mini` (or nano / 5.4-mini) **or** unset `INFLUENCE_LLM_BASE_URL` / `OPENAI_BASE_URL` / `LM_STUDIO_BASE_URL` for the process |
| Game timeout 600000ms | Fixed: no default whole-game timeout; only opt-in |
| Pre-endgame | `--max-rounds 1` or `2` with 8 players avoids Reckoning |

Code: `packages/engine/src/llm-client.ts`, `docs/local-model-evaluation.md`.

---

## Test baselines

```bash
# Always
cd packages/engine
bun test src/__tests__/format-resolvers.test.ts \
  src/__tests__/format-kernel-integration.test.ts \
  src/__tests__/game-engine.test.ts
bun run typecheck

# After U2
bun test src/__tests__/agent-structured-output.test.ts
# + one real LLM sim with --max-rounds 1..2 --chatty
```

Repo-wide: `bun run test` / `bun run check` before merge readiness. Prefer Bun only.

---

## Acceptance examples (agent-facing)

Reuse origin AE1–AE7 for board math. Add for this handoff:

- **AE-H1.** Empowered LLM receives two offered formats and tool-rejects a third; pick appears as `format-pick` turn with thinking naming both options.  
- **AE-H2.** Under Vote Bomb, agent thinking or decisionLog shows awareness of zero-safe / fewest-positive (not “majority eliminate”).  
- **AE-H3.** Format mingle context includes locked format rule summary before ballots.  
- **AE-H4.** Standard-round transcript has no `use_power` / council elim path; has format resolve elim.  
- **AE-H5.** Adding a fourth format later requires a new module + registration, not rewriting base personality prompts.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Prompt-only format rules without tools | U2 tools mandatory (observability spine) |
| Agents still invent Council | U3 prompt cleanup + sim audit |
| Format catalog pasted into every prompt | Role-scoped rule sheets only |
| Double mingle token cost | Keep post-pick window short; don’t re-require multi-beat pre-format |
| Doppler → local empty LM Studio | Document catalog path; optional unset base URL |
| Scope creep into full catalog / archetypes | U7 deferred list is binding |

---

## Handoff checklist for the next agent

1. Read origin requirements + this handoff + prior plan.  
2. Confirm branch `feat/sequester-format-kernel` and run format + game-engine tests.  
3. Implement **U1 → U2 → U3 → U4**, validate with **U6** sim.  
4. Update **U5** rules/MCP/docs in the same branch when agent path works.  
5. Do not claim “format kernel done” until LLM sim shows format-aware thinking, not only MockAgent green.  
6. Prefer minimal diffs; no `as any`; Bun only.  
7. Update CONCEPTS only if new resolved domain terms appear.

---

## Quick reference — key code paths

```
packages/engine/src/formats/                 # pure math + menu
packages/engine/src/format-pressure.ts       # rule sheets + projection shape
packages/engine/src/phases/format-kernel.ts  # House + collection + reveal
packages/engine/src/phase-machine.ts         # format_* states
packages/engine/src/game-runner.ts           # dispatch
packages/engine/src/game-runner.types.ts     # IAgent format methods
packages/engine/src/agent.ts                 # ★ implement here
packages/engine/src/context-builder.ts       # ★ inject format pressure
packages/engine/src/phases/vote.ts           # empower path; no council bench
packages/engine/src/__tests__/mock-agent.ts  # reference implementations
docs/rules-page-content.md                   # ★ rewrite standard rounds
packages/api/src/game-mcp/rules.ts           # ★ rewrite votes/power section
```

---

## Work Audit (handoff authoring)

- **Confidence:** High on inventory of done vs missing (agent.ts/context-builder/rules verified empty of format surfaces)
- **Shortcuts:** Exact line numbers in agent.ts will drift; use symbol search
- **Verification:** This document only; implementer must re-run tests on branch
- **Operator:** Assign next agent to this plan path; prefer `/ce-work` on this file or continue on `feat/sequester-format-kernel`
