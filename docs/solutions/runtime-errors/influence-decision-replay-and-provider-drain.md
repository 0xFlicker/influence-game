---
module: Influence runtime
problem_type: runtime_error
tags: [provider-journal, recovery, structured-output, influence]
---

# Preserve accepted decision contracts and drain provider batches

New Influence games freeze `decisionContractVersion: 2` in their configuration, including waiting lobbies. Standalone agents default to v2. An absent stored version resolves to historical v1: these games can contain both exact pre-speech decisions (`thinking` and structured choice) and exact speech-era decisions (`message` and structured choice). Recovery validates each accepted value against the corresponding complete schema, including canonical player IDs and strategy fields. Missing `message` selects the pre-speech schema only for historical replay; missing or invalid required fields and extra fields still fail integrity validation. A v2 game never accepts a missing-message value.

This distinction applies only to accepted journal replay. Fresh calls always use the current strict provider-native speech schema, even when an old game continues. Historical accepted values are never regenerated, rewritten, or inferred from transcript text. Provider attempt evidence has debug retention and can be expired or redacted; it cannot become a prerequisite for game recovery. The accepted journal value/hash and planned durable slot remain the recovery authority. The structured artifact version labels fresh request evidence; it does not replace the stable logical action or durable subcall identity. A reconstructed pending slot reads accepted results before request preparation, or allocates a new attempt ordinal when no accepted result exists.

Parallel provider collections must settle every dispatched promise before propagating a sibling failure. Otherwise the owning turn can clear durable bindings and release its owner while a successful sibling is still saving evidence. `drainProviderCalls` retains roster order, waits for all terminal writes, and then propagates a failure; sealed collections do not commit ballots from a partially failed batch.

Speech length failures return `LengthFeedback` from semantic validation. Retry prompts include the clean rejected decision and measured UTF-8 bytes, after audio annotation normalization, so repair preserves the choice while shortening delivery. Raw attempts remain evidence; no `as any` or direct House calls bypass the shared provider execution boundary.

Provider-free regressions cover both historical accepted shapes without dispatch, malformed historical values, missing-message v2 corruption, fresh strict dispatch on historical games, ASCII/multibyte byte repair, and delayed siblings after a failed sealed ballot. The PostgreSQL regression persists a v1 accepted decision in a planned durable slot, removes its debug evidence outbox, reconstructs the slot, and verifies replay produces no new provider attempt.
