# Provider context adaptation

The shared model-invocation path recognizes `context_overflow`, compacts marked context and retries the same logical decision. Estimated size never rejects a game. If adapted execution still exhausts, the owning engine phase retains its existing fallback, absence or suspension/recovery policy.

Normal requests retain their original content. Builders mark literal spans of their own rendered context as compactable; the adapter does not parse headings or dialogue to infer facts. The current action, legal choices, exact output schema, current board and audience boundary remain outside those spans. Historical events, strategy and dialogue are lossy contextual memory; neither a summary schema nor a source hash proves retention of every useful fact.

## Runtime behavior

- Recognize explicit context-limit codes and narrowly matched provider error messages. An unrelated HTTP 400 stays `request_error`; output truncation stays a structured-output failure. Context overflow does not open provider-health circuits.
- Each summary receives an `orientation` alongside its source chunk and character budget: actor identity; the acting character's personality, backstory and game-specific strategy (plus current Influence strategy memory); and the pending action, phase/round, original instructions/current situation and output contract. Historical spans are replaced by explicit markers in the orientation, not repeated wholesale. Werewolf retains only actor-authorized role knowledge; retrospectives use the original frozen self, never the current Profile. House receives its own instructions and authorized subject/audience context, with no contestant character or invented strategy. The compactor summarizes for the pending task; it does not perform it.
- Record the original attempt with its source hash and revision. After overflow, request strict `context_summary` results from the sealed runtime manifest. Never infer successful summarization from fenced JSON, extra fields or prose around JSON.
- Use at most three adapted revisions. Chunk sizes start at 16,384 Unicode code points, then 8,192 and 4,096. Summary targets are one quarter, one eighth and one twelfth of each chunk respectively. Spans shorter than 512 UTF-16 code units are retained; they are poor targets for useful compression. A rejected summary chunk splits in half down to the retry floor. Each revision permits at most 128 chunk operations, and each chunk gets two attempts per allowed model. These are bounded work policies, not model context capacities.
- Summary dispatches consume the same per-game fallback caps as action dispatches. Local Influence/House token reports include newly generated summaries under `context-summary`; API accounting comes from every reserved journal attempt. No summary or adaptation resets an authorized spend cap.
- Retry the action using the derived messages and the unchanged output contract. Preserve unmarked bytes; JSON field replacements remain valid JSON objects with an explicit `derivedContextMemory` field. Require the complete rendered message set to shrink. A smaller request can still overflow because model capacity also includes output/schema/vision overhead.
- Do not resend a model's known-overflowing revision under unchanged policy. A different sealed model can try the latest revision. Failed compaction, no reduction, exhausted work or exhausted adapted action retries return through the existing typed engine failure path.

The default work limits are conservative implementation defaults, not a claim of optimal cost or universal fit. Deterministic coverage includes a Unicode/escaped source above 256 KiB and representative game builders. The [initial opt-in provider evaluation](evaluations/2026-10-18-context-compaction.md) measures narrow fixture retention and cost on Luna/Muse and records task leakage into summaries. Broader hosted-model quality remains pending; mocks prove execution and isolation, not strategic fidelity.

## Journal and recovery

`context_source_hash` and `context_revision` are small attempt metadata added by migration `0123_context_adaptation`. Existing rows remain unchanged with null metadata. The hash binds original messages, marked spans, character context, output schema and adaptation-policy version. Policy version 2 includes the actor/task-aware summary prompt.

Summary calls have `context_compaction` semantic coordinates containing the parent's action coordinate, a content hash, revision and chunk ordinal. They inherit the parent actor, action, owner and planned-turn authorization, but have separate logical-call IDs. They cannot occupy a planned action's acceptance slot or appear as a Werewolf ballot. They never emit canonical events, speech, thinking or strategy changes.

Accepted summaries use the existing `provider_logical_calls.accepted_value_object` private payload writer. No new document-body column or bucket client is introduced. Upload/hash/length verification and existing orphan handling apply. Original source comes from the existing frozen inputs or deterministic planned-turn reconstruction; rejected-request evidence remains on the existing private evidence path. The adapted request is deterministically rebuilt from accepted chunk summaries before dispatch; a second full copy of that derived document is unnecessary.

Restart restores attempt metadata, skips rejected request revisions and reuses accepted chunks. Accepted game decisions replay before adaptation. A source mismatch is an integrity failure. Stale owners cannot read/dispatch/accept summary children. Indeterminate remote calls may be billed twice, but local acceptance still permits at most one canonical effect per logical decision.

Explicit retrospective recovery reuses its existing `resumedAt` generation: old failures no longer consume the reopened retry allowance, the latest context revision is retained, and accepted summaries remain reusable. No new recovery endpoint or suspended-game state is added.

Private Influence/House decision traces record the actual adapted messages. Producer attempt history distinguishes summary calls by their `context_compaction` coordinates. Summaries remain private source material; they are not a spectator feed or a source of canonical facts.

## Invocation inventory

| Entry point | Compaction boundary |
| --- | --- |
| Influence `executeModelCall` / semantic invocation builder | Rendered dialogue, historical recall, current strategy memory, huddle/alliance context, vote/history receipts and owner-authored background. Current board, rules, legal constraints and appended action instructions remain exact. |
| Dedicated Influence and Werewolf retrospectives | Frozen sections, dialogue and prior statements; original request identity, outcome and speaker remain exact. |
| Werewolf `decide` | Actor-visible board history and pack discussion; current request, roster, verified role knowledge, investigations, pack membership and current conversation reminder remain exact. |
| House diary questions/follow-ups | Subject-authorized historical record, conversations, decisions, prior diary and session Q&A. Current board, interview identity and scheduling instructions remain exact. |
| House huddle selection/outcomes | Authored alliance purpose and huddle transcript; scheduling choices/budgets and structured member facts remain exact. |
| House narrative/long-form summaries | Historical canonical events, permitted dialogue/diary, narrative notebook and long-form source context. Current short-form projection/output bounds remain exact. |
| House room assignment/proposer selection | No growing history: bounded roster, current rules and legal allocation contract only. No prose-based removal of these mechanical inputs. |
| House Cuts trial, Owner Learning, provider-health probes and image generation | Separate editorial/operational paths; not gameplay compaction targets. Their budgets and contracts are unchanged. |

## Validation and rollout

Run `bun run test`, `bun run test:postgres` and `bun run check`. Focused tests cover strict summary decoding, source drift, restart reuse, persistent overflow, legal decision preservation, both retrospective builders, private House boundaries, journal separation, owner fencing and provider health. Do not interpret a passing mock summary as evidence that a hosted model preserved strategic nuance.

Deploy the additive migration with the application through normal staging and production approval. No feature flag or private-data export is needed. The queue remains rollout/evaluation pending until actual deployment and the remaining quality issues identified by evaluation are resolved.
