---
module: Werewolf Runtime
problem_type: architecture
tags: [werewolf, retrospective, recovery, provider-journal, completion]
---

# Keep the Werewolf outcome separate from execution completion

Adding postgame speech to the existing runner exposed three assumptions: the runner stopped as soon as `outcome` existed, the store closed its owner at that same event, and shared inspection expected the result to be the last visible entry. Those assumptions prevent restart and continued playback of a committed epilogue.

Fresh rules-v8 games enter `retrospective` at the immutable competitive outcome. The existing runner initializes the complete frozen context, then prepares each exact request and context hash in `werewolf_turns`. A distinct `retrospective-statement` action retains the ordinary Werewolf sequence journal coordinate and owner fence. Accepted journal values survive an owner change without another model request.

The reducer checks canonical deaths and the dedicated survivor shuffle at initialization, then validates ordinal, actor and the exact prior prefix at every acceptance. Public history adds speech with an explicit retrospective purpose; dead speakers do not regain gameplay eligibility. Only the full-roster completion proof closes the owner and catalog execution and queues existing postgame work. Shared inspection validates that proof instead of checking the visible tail's entry kind.

Rules-v8 fixtures claiming a completed game must include their epilogue. Outcome-only v8 fixtures remain useful for unfinished or suspended execution; they must not claim final completion. Existing rules-v7 games retain their original completion at the competitive outcome, and remain available to replay and Studio without an epilogue. Keep the completion predicate version-aware rather than applying new terminal requirements to saved games. Large valid accounts continue through context adaptation; size estimates must not fail admission or discard required meaning.

Local model evaluation exposed another distinction: a provider circuit can open during gameplay and remain open when the epilogue begins. Do not turn `circuit_open` into a legal gameplay fallback. Stop before committing the single turn or the sealed batch, retain accepted journal values, and release API ownership for recovery. An exhausted required retrospective still pauses explicitly rather than inventing a statement. The API reporter prints its progress and saved failure reason, and distinguishes read-only `--game` from permission-checked `--resume-retrospective`. LM Studio keeps concurrent requests with a configurable hour-long inference/queueing timeout; hosted action deadlines must not truncate local calls.

See the [runtime guide](../../game-retrospective-runtime.md) and [RT-05 ledger](../../plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md). Keep exact types without `as any`, and keep any House calls direct. These proofs are local deterministic evidence, not provider quality or deployment acceptance.
