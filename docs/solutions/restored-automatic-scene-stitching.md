---
module: Visual Mode
problem_type: ui_bug
tags: [visual-mode, werewolf, stitching, product-continuity]
---

# Restore automatic stitching and the expected continuous scene

PR #258 incorrectly removed automatic harmonization while addressing duplicate backgrounds and the 180-second deadline. That changed the expected final output without the user's agreement. The user explicitly instructed restoration for Influence and Werewolf, allowing a longer timeout, and requires explicit question-and-answer approval before future product decisions.

Complete verified region sets are now assembled at 3072×1536, preserving source order and proportions, then harmonized with the ordered assembly plus the original views as references. The final image undergoes strict whole-cast verification. Original views and rejected candidates remain durable evidence. The scene deadline is ten minutes; owner guards and uncertain-charge protections still apply. Incomplete source sets and identity rejection retain the existing documented recovery behavior; no rejection is presented as a verified composite. Producer metadata distinguishes a generated composite awaiting verification from a partial region.

## Saved-image stitching evidence

The saved 12-player Influence views from game `58f370d5-127d-4db8-ab70-42a2ccd3eeb1` and Werewolf village views from game `f1e8974c-659f-4e60-9b3b-4b0546a8a638` were stitched without regenerating their source views. Both resulting continuous images passed strict verification of all 12 identities and visual inspection.

- Influence accepted operation prefix: `stitch-proof:83fcbecb-ae29-4b65-9c49-cb09a1663a60`, 73.177 seconds, $0.316429.
- Werewolf accepted operation prefix: `stitch-proof:9d38a0e7-9b01-42a2-909d-71511e02f6f8`, 69.963 seconds, $0.315304.
- First Influence attempt omitted one contestant and was rejected; retained cost $0.162535. Adding the ordered assembly preserved the missing identity in the accepted attempt.
- Additional stitching cost $0.794268. Combined task spend $5.414031 of the $15 authorization.

Private source inputs, complete sanitized requests/responses, candidates, stitched images and the local gallery are retained under `packages/engine/docs/simulations/stitch-repair-2026-11-01/` and the existing local DB/object-storage journal. No production images or historical records were replaced.

Validation: provider-free baseline 3,233 passed, five skipped; type checks and lint passed. Database-owned tests were updated for the harmonization call, strict rejection, durable reuse and continued recovery; PostgreSQL tests remain skipped at the user's request.

Correction: Werewolf supports at most eight players. The retained twelve-player village evidence above exceeds that supported size and is not representative Werewolf acceptance coverage. It is retained as historical evidence, not a supported-game test. The current probe and representative renderer fixture use eight players.
