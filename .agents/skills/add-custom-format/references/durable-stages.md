# Durable staged formats

Each consequential stage is a logical transaction:

1. typed committed cursor identifies the stage;
2. planned intent lists engine and provider operations in deterministic order;
3. scratch execution may call providers and build events;
4. canonical events, continuity, next cursor, provider bindings, transcript drafts, and viewer publications commit atomically;
5. pre-commit failure discards scratch work;
6. post-commit recovery reads the canonical result and never repeats the decision or draw.

Randomness uses the durable turn seed and a canonical-order candidate list. Persist the accepted result.

Provider coordinates include the logical turn, action identity, and ordered slot. Multiple calls by one actor must never overwrite one another. Required decision plus required dependent decision belongs to one intent and one commit, even when both calls use the same actor.

For repeated social windows, include a stable semantic key such as `initial_names` or `final_names` in progress, prompt scope, room allocation, inbox/alliance/huddle identity, provider ordinals, recovery, canonical markers, and viewer cues.
