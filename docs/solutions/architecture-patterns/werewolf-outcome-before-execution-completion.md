---
module: Werewolf Runtime
problem_type: architecture
tags: [werewolf, retrospective, recovery, provider-journal, completion]
---

# Keep the Werewolf outcome separate from execution completion

Adding postgame speech to the existing runner exposed three assumptions: the runner stopped as soon as `outcome` existed, the store closed its owner at that same event, and shared inspection expected the result to be the last visible entry. Those assumptions prevent restart and continued playback of a committed epilogue.

Fresh rules-v8 games enter `retrospective` at the immutable competitive outcome. The existing runner initializes the complete frozen context, then prepares each exact request and context hash in `werewolf_turns`. A distinct `retrospective-statement` action retains the ordinary Werewolf sequence journal coordinate and owner fence. Accepted journal values survive an owner change without another model request.

The reducer checks canonical deaths and the dedicated survivor shuffle at initialization, then validates ordinal, actor and the exact prior prefix at every acceptance. Public history adds speech with an explicit retrospective purpose; dead speakers do not regain gameplay eligibility. Only the full-roster completion proof closes the owner and catalog execution and queues existing postgame work. Shared inspection validates that proof instead of checking the visible tail's entry kind.

Fixtures claiming a completed game must include its epilogue. Outcome-only fixtures remain useful for unfinished or suspended execution and capacity failure; they must not claim final completion. A deliberately oversized complete account fails admission visibly instead of losing later phases or prior speeches.

See the [runtime guide](../../game-retrospective-runtime.md) and [RT-05 ledger](../../plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md). Keep exact types without `as any`, and keep any House calls direct. These proofs are local deterministic evidence, not provider quality or deployment acceptance.
