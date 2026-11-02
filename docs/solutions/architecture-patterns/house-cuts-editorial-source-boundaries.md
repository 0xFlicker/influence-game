---
title: House Cuts editorial source boundaries
module: House Cuts
problem_type: architecture_pattern
date: 2026-11-01
tags: [house-cuts, werewolf, influence, editorial, audience, source-evidence]
---

# House Cuts: editorial freedom with source provenance

The production audit found 11 failed jobs out of 13. All 17 retry pairs sent identical requests. Most rejections were redundant bookkeeping: participants discussed rather than speaking, canonical facts omitted from a second reference list, and same-position source ordering. One exact-text mismatch referenced another selected speech by the same character. Frozen sources and private receipts were intact.

Editorial v3 lets the House summarize, paraphrase, condense and polish player-focused excerpts. It does not require verbatim text, model-authored participant lists or duplicate fact-reference lists. The final House pass returns finished cards and may rewrite, combine, order or overlap stories. Code does not rank stories or enforce non-overlap. There are no deterministic filler cards, ranking fallbacks or public disclaimers.

## Authority and validation

The existing game adapters supply audience-local frozen evidence. Influence uses canonical events and attributed public dialogue; private Mingle/huddles are not promoted to public evidence. Werewolf uses its audience projector, excluding Mystery terminal results and retrospective material. Player prose is never parsed into authoritative identities, votes, phases or outcomes.

Both calls retain provider-native exact schemas. The batch binds sourceHash/windowId. Within a valid batch envelope, cards with malformed fields, foreign references or excerpt references outside selected dialogue are rejected independently; the native schema remains exact. Valid siblings survive. Code orders selected references by frozen source order, derives participants and excerpt speakers, and creates replay links. Publication rechecks the source hash and rebuilds context from source rather than trusting cached URLs. Mystery replay links reach the end of the contributing windows. The final editor sees the candidates and the complete frozen audience-local source, so it can edit with the game’s wider context.

Unreadable or wholly unusable responses receive bounded corrective retries. The next request includes the persisted failure, including after restart. Each call saves its reservation before dispatch and terminal receipt before subsequent work. Provider-exhausted discovery windows are recorded as failures and later windows continue; storage, integrity and budget errors stop work. Exhausted windows replay their failures rather than spending again.

One or more published cards is success. An explicit empty editorial selection is successful zero. If discovery yields no candidates and has failed windows, that is a failure, not a fabricated zero. No publication is assembled from an interrupted final response. Raw rejected cards remain in private provider receipts even when valid siblings are accepted.

## Recovery and operator visibility

`GET /api/games/:id/cuts/diagnostics` requires a currently assigned admin/sysop role and returns audience job status, saved failure, attempt outcomes, spend and `expectedUpdatedAt`. Public `/cuts` reads never expose journals or trigger generation.

`POST /api/games/:id/cuts/recover` accepts exactly `{ audience, expectedUpdatedAt, idempotencyKey }`. It requires the same current operator authorization, a completed visible game, a failed unpublished job, saved source/journal, known terminal dispatches and remaining audience budget. It fences the expected job timestamp under a row lock. Identical retries return the existing revision. It creates a new v3 journal retaining the previous journal inside the private object-storage document; prior spending counts against the same budget. It does not replace successful publications, regenerate game history, reset the budget, or silently backfill games. Worker publication remains lease-fenced and rechecks game visibility.

New excerpt publications retain sourceRef for trailer attribution. Existing immutable publications without it retain their existing historical lookup behavior. New excerpts do not use exact-text matching. Gallery, share cards and Werewolf trailer presentation preserve speaker-focused layout without forced quotation marks.

Failure logs include the job's saved reason. Diagnostics expose unsuccessful windows even when a later card makes publication successful. Provider bodies, native reasoning, revisions and rejections stay in private storage; PostgreSQL owns job metadata and references.

## Validation and paid evaluation

Provider-free tests cover paraphrases, source ordering, mixed valid/invalid cards, overlap, explicit zero, all-invalid failure, corrective retries, failed-window continuation, replay and recovery authorization/fencing. Required baselines are `bun run test`, `bun run test:postgres`, and `bun run check`.

`packages/api/src/scripts/evaluate-house-cuts.ts` is an explicitly paid localhost API harness. Use a fresh dedicated `influence_cuts_eval_*` database, local private bucket, OpenAI credentials, and a fresh private output directory. It seeds canonical fixtures, starts the actual authenticated Cuts API, requests recovery over HTTP, runs the real worker and reads published cards over HTTP. Three audience journals are each capped at $0.75 ($2.25 maximum total). It retains the database, source/journal objects, publications and sanitized private receipts; no shared test DB truncation or production writes. The retained exclusive run lock prevents accidental repeats. A new run requires fresh spending authorization within the task's remaining allowance.

No `as any` or direct-House-call bypasses. Synthetic fixtures prove integration, not real-game editorial quality; inspect final cards as well as status.

### Studio operator controls

Completed games expose **Tools → House Cuts** to Admin/Sysop operators (or the House Cuts toolbar action outside the editorial workspace). Diagnostics include the expected audiences even when their jobs are missing, plus available actions, card count and blocked-retry reasons. The panel shows spending and generation progress and handles stale-state checks and exact retries after uncertain HTTP responses.

`POST /api/games/:id/cuts/backfill` accepts exactly `{ audience }`. It checks the current operator role, completed visible game and game-specific audience before inserting a queued job under the game row lock. The unique game/audience constraint makes duplicate submissions idempotent. Existing failed, running and ready jobs are returned unchanged; recovery remains a separate action. No historical generation occurs until an operator clicks Generate missing Cuts.

### Share landing pages and artwork

A `?scene=…&audience=…` link opens a server-rendered moment landing page: the Cut title is the main heading, followed by one context sentence, replay and agent-creation actions, attributed excerpts and a single editorial angle. Game overview, full replay and audience-local gallery navigation remain available. When a frozen Cut has no replay coordinate, the action opens the full audience-specific replay instead of inventing a moment. Invalid/cross-audience IDs remain unavailable.

Gallery cards, moment pages and 1200×630 social previews reuse bundled House background artwork. Selection is decorative and stable by Cut ID, never inferred from dialogue or used as game authority. Open Graph and Twitter metadata preserve the selected audience and canonical moment URL. Social images embed local artwork without remote image dependencies or new generation spend; publication content is unchanged.
