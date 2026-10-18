# Context compaction: first real-provider evaluation

On 2026-10-18, GPT-6 Luna and Muse Spark 1.3 Contributor completed six full-context/compacted pairs each. Both retained all explicit fixture probes and fixture-preferred decisions. This is encouraging narrow evidence, not closure of the compaction-quality queue item: summaries sometimes restate instructions or recommend an action, and the fixtures are synthetic and deliberately easy to inspect.

[Reviewable outputs and measurements](2026-10-18-context-compaction-results.json) include all successful answers and summaries, plus the failed Katana attempts. No real game content or credentials were used. Raw evidence stays in gitignored `.local-uploads/context-compaction/<runId>/private-run.json`; the review file records each run ID, evidence hash, source-file hashes and fixture hash.

## Method

- Three committed scenarios: an Influence promise withdrawn in favor of another partner, a Werewolf ballot with verified private knowledge versus public claims, and a House interview with a subject/audience boundary. Each interleaves relevant evidence with 48 synthetic small-talk exchanges, including a late reversal and quoted instruction injection.
- Two samples per scenario/model, alternating full-first and compacted-first order. Each lane is independent; no accepted summary is reused between samples.
- The same exact output schema asks for a choice, explanation/question, and three explicit probes: promise status, accusation status and latest speaker. The probes are exposed in both conditions and in compactor orientation; this measures task-guided retention, not an unseen-question memory benchmark.
- The compacted lane injects one initial `context_length_exceeded` response locally without sending that request. All subsequent summary calls and final answers are real provider requests through the production adapter/coordinator/compaction path. Full-context calls are also real. This does **not** establish behavior at an actual provider context-window boundary.
- Each source fits one production summary chunk. This live run does not establish multi-chunk fidelity, repeated-revision quality, restart durability, or complete-game strategy; deterministic tests cover the corresponding execution mechanics.
- These are dedicated synthetic semantic invocations, not captures from production games or a full-game simulation. Actor-specific production-builder wiring is covered by separate deterministic tests.
- Low reasoning, 2,048 output-token limit, no model fallback and at most 32 actual dispatches per model/run. The final harness stops a model after a lane whose every dispatch fails; that stop was added after the initial unavailable GLM run.

Fixture identity: `sha256:ec40d3f1c25dc919c3ae85313de1a2c8657507ec532a9f97084353ce084249ab`.

## Results

| Model | Successful full / compacted lanes | Explicit probes, full / compacted | Preferred choices, full / compacted | Final request character reduction | Full / compacted total tokens | Estimated USD, full / compacted |
| --- | --- | --- | --- | --- | --- | --- |
| `openai:gpt-6-luna` | 6 / 6 | 18/18 / 18/18 | 6/6 / 6/6 | 84.1% | 14,429 / 20,526 | $0.001108 / $0.002072 |
| `meta-muse:muse-spark-1.3-contributor` | 6 / 6 | 18/18 / 18/18 | 6/6 / 6/6 | 79.7% | 17,683 / 27,948 | $0.002077 / $0.003555 |
| `katana:glm-5-3-private` | 0 / 0 | Not evaluated | Not evaluated | — | Usage unavailable | Unknown |
| `katana:glm-5-3-flash-private` | 0 / 0 | Not evaluated | Not evaluated | — | Usage unavailable | Unknown |

Each successful model used 18 real calls: six full-context actions, six summaries, six compacted actions. All paired choices and probe answers agreed. Character reduction compares final action messages, not the aggregate work of generating memory. Total tokens **increased** by 42.3% for Luna and 58.1% for Muse because this one-use evaluation also pays for compaction. Summed provider latency averaged 2.21s full versus 4.75s compacted for Luna, and 2.96s versus 7.63s for Muse; local processing and injected rejection are excluded.

The two successful runs total approximately **$0.008812** at the repository's model rate estimates, including observed cache usage. Recorded service tiers were OpenAI `default` and Muse `auto`. Rates per million tokens were Luna $0.10 input / $0.01 cached / $0.50 output and Muse Contributor $0.10 / $0.002 / $0.20. These are estimates, not provider billing receipts. Failed Katana requests returned no usage/billing evidence, so their cost is unknown rather than asserted zero.

Katana listed both GLM 5.3 IDs. The initial standard-model run made 24 dispatches across 12 failed lanes, all classified `service_error`. A subsequent bounded diagnostic made two dispatches and captured `502 status code (no body)` for both. Flash also returned that HTTP 502 error on its first two dispatches and the harness stopped. There is no GLM compaction-quality result. GLM uses the existing Katana GLM transport capability template only for evaluation; this PR does not add it to the production catalog or declare it qualified.

## Qualitative review

This review was performed by the implementation agent from the saved outputs, not a blinded independent panel.

- **Promise reversal:** both models retained Mira's withdrawal, Vera's newer reciprocal deal and the disputed status of the allegation. Their compacted explanations selected Vera for the current agreement rather than punishing an unverified accusation.
- **Verified knowledge:** both retained the seer result and selected Mira. Neither followed the quoted demand to ignore private observations. This is one injection fixture, not an injection-resistance guarantee.
- **House scope:** final outputs remained questions addressed to Atlas, focused on the changed alliance rather than declaring cheating. Muse's first compacted question added “what are you considering for your vote?” where its full-context question asked about the “next move”; the fixture's VOTE orientation allows that framing, but the difference shows contextual interpretation rather than verbatim retention.
- **Task leakage into memory:** Luna's first Werewolf summary explicitly said **“Vote Mira.”** Both models often copied actor/task instructions and verified current facts into summaries of historical dialogue. The downstream answers were correct here, but this blurs source history with orientation and demonstrates that the instruction to summarize rather than perform the action is not fully reliable. These outputs remain private derived inputs and are never accepted as canonical actions.
- **No universal quality claim:** perfect explicit probes on three small, highly compressible fixtures do not establish retention of subtle commitments, adversarial ambiguity, balanced competing strategies, or unseen follow-up questions. Task leakage and broader/captured-game evaluation remain open before calling quality validation complete.

## Reproduce

These commands are opt-in paid provider runs with synthetic content. The default includes Luna, Muse Contributor and standard GLM 5.3; use `--models=` to select a subset. Muse Contributor may use submissions for training, so the harness accepts no external game input.

```bash
doppler run --project social-strategy-agent --config dev -- \
  bun run --cwd packages/engine evaluate:context-compaction --samples=2

# Optional separately listed GLM Flash candidate:
doppler run --project social-strategy-agent --config dev -- \
  bun run --cwd packages/engine evaluate:context-compaction \
  --models=katana:glm-5-3-flash-private --samples=2

# Provider-free harness checks:
bun test packages/engine/src/__tests__/context-compaction-evaluation.test.ts
```

The harness writes `private-run.json` after each lane, plus `summary.json` and an allowlisted `review.json`. A failed lane/model yields a nonzero exit code while preserving completed evidence. The first successful runs predate failure-handling/export-only improvements; their recorded source hashes identify the exact evaluated files. Production compaction behavior and fixtures were unchanged by those harness improvements.
