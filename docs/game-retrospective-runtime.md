# Game retrospective runtime

RT-04 connects Influence's existing runner to the [frozen context](game-retrospective-context.md) and [strict statement invocation](game-retrospective-invocation.md). Werewolf runtime wiring and the cross-layer completion/read/presentation work remain subsequent tasks in the [implementation plan](plans/2026-10-10-004-feat-game-retrospectives-implementation-plan.md).

## Influence execution

Competitive wins enter a nonfinal `retrospective` machine state. Initialization admits the whole original roster against every sealed primary/fallback model, compiles the original outcome account and commits `retrospective.started`. Each following durable turn plans one `retrospective-statement` subcall, accepts its strict speech, and atomically commits its canonical record, correlated public dialogue, publication, provider receipt and next ordinal. Eliminated contestants remain available as original agents; their gameplay eligibility does not change.

The completion turn validates the complete roster proof, commits `retrospective.completed`, enters END and creates the existing held completion publication. Neither the competitive result nor an intermediate speech creates that publication. The event bus remains available until the epilogue finishes. API settlement is still the caller's responsibility.

Initialization stores the private dossier in `game_retrospective_inputs` inside the same owner-fenced transaction as its canonical definition. The writer validates the canonical source, game kind, definition hash and both compact JSON and PostgreSQL JSONB byte bounds. A later failure rolls back both records. Resumption reads the immutable input and accepted prefix; it does not rebuild initialization capacity through provider transport. Fresh statement dispatch still uses the invocation's verified capacity admission, and accepted provider replay uses no transport.

Product dialogue and canonical events have independent sequence spaces. The API store captures the original outcome's owning committed turn and its dialogue head. Each original dialogue entry uses its persisted owning-turn event boundary, capped at the original outcome. Local runs bind dialogue at explicit completed phase boundaries; a supplied phase-boundary resume capsule binds its existing dialogue to that checkpoint. No current read head or transcript prose invents a source relationship. Formal speech writers now supply exact dialogue pointers; validation reuses their structured display formatter for presentation labels.

An exact round limit can stop an Influence evaluation before any competitive outcome exists. Such a bounded run has no retrospective and cannot provide the new competitive completion proof. Normal API runs retain their existing player-scaled completion floor. This does not manufacture a winner or draw for partial evaluations.

## Local proof and remaining integration

Deterministic engine tests restart at outcome, initialization, every statement ordinal and final completion. They verify exact prior text, unchanged outcome/order, one speech per original contestant, no premature completion, no repeated initialization capacity reads, correlated dialogue, and a required-speech failure retaining its unfinished frontier. Database proof exercises rollback after private-input insertion and successful restart into one complete epilogue.

Fresh local Influence runner calls also execute the epilogue. Simulator artifact/report and local MCP integration remain RT-13; the dedicated runtime is not a claim that those downstream formats already support the new tail. Verified hosted OpenAI capacity remains required for real statements; unsupported local/provider windows fail explicitly. Paid/provider quality and deployed execution remain separately authorized validation.

Keep exact types without `as any`, separate private cognition from public speech, and call House methods directly. No extra worker, queue, speech fallback, media generation or historical generation is introduced.
