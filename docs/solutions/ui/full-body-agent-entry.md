---
module: Agent entry
problem_type: feature
tags: [agent-profiles, enrollment, daily-free, visuals, recovery]
---

# Full-body Agent entry

New owned-Agent entries to Influence games, Werewolf lobbies, and the Daily Free queue require a published `fullBodyReferenceUrl`. The server checks this inside the locked admission transaction (or queue switch transaction), so web and MCP clients share the rule. Existing waiting seats and an existing same-Agent Daily Free entry remain valid even if their Agent currently lacks body art. A Daily Free draw may seat an Agent from that already accepted queue entry; the draw must not invalidate standing membership. Starting a game does not acquire a new art requirement. House-filled cast is unaffected.

The game Agent picker labels an incomplete Agent and sends its owner to `/agents/prepare?agentId=…&flow=join_game&gameId=…`. Daily Free entry points use the same page with `flow=daily_free`. The page presents **Complete & join** and **Edit Agent**. Automatic completion uses the owner-account text and image generation allowances, fills missing Influence and Werewolf strategies and presentation fields, generates full-body art, localizes the head, derives a portrait, and saves one revision. Populated fields stay unchanged. Its durable checkpoints, lease recovery, moderation hold, explicit retry, and source-conflict policy are those of the existing visual-update job. It never reserves a game seat; joining occurs after successful publication and can still fail if the game fills or entry eligibility changes.

The edit route retains the game or season target. **Save & join** enters only when the published Agent has full-body art. A held save waits for review; an incomplete save returns to preparation. Creation with a join target also hands off to preparation if the new Agent lacks body art. The owner can return to an in-progress preparation job; reloading never creates a new paid job. The shareable owner link `/agents/prepare` lists saved Agents and offers update-only completion, including for people who already have a waiting seat.

This changes admission and Agent-management UI, not the presentation contract. Existing frozen games, seats, and exports are not regenerated. A waiting seat updated through the normal profile path continues to follow its current revision under the established reconciliation rule.
