---
module: Agent entry
problem_type: feature
tags: [agent-profiles, enrollment, daily-free, visuals, recovery]
---

# Full-body Agent entry

New owned-Agent entries to Influence games, Werewolf lobbies, and the Daily Free queue require a published `fullBodyReferenceUrl`. The server checks this inside the locked admission transaction (or queue switch transaction), so web and MCP clients share the rule. Existing waiting seats and an existing same-Agent Daily Free entry remain valid even if their Agent currently lacks body art. A Daily Free draw may seat an Agent from that already accepted queue entry; the draw must not invalidate standing membership. Starting a game does not acquire a new art requirement. House-filled cast is unaffected.

The game picker preselects the only available owned Agent. **Join with [Agent]** submits through the lobby's ordinary join endpoint. An incomplete Agent opens a focused version of the canonical editor at `/agents/prepare`. This shows the exact lobby or season, available artwork, the image generation control, and the next step. It loads the lobby before offering generation so a full or closed destination can be reported immediately.

The preview appears when generation starts and sits above the artwork actions on narrow screens. When generation returns a valid head position and crop for the same full-body image, the entry screen shows the headshot beside the full-body image. **Save image & join** (or **Save image & enter** for Daily Free) accepts the suggested head position and crop and saves the profile and its destination together. **Adjust portrait** opens the crop editor. If a complete suggestion is unavailable, **Set portrait** is the next step. The crop editor selects the gold head box when manual placement is needed. Other restored profile edits still receive the full review screen. Image generation uses the editor’s existing scan and elapsed status. Save, review and admission use the shared status text. No seat is reserved while these steps run.

A published submission proceeds into its original lobby or season without another confirmation. When review is pending, the preparation page checks status while visible and resumes automatically on approval. The existing saved continuation also resumes on return to the preparation page. Opening an arbitrary preparation link cannot join on its own. A confirmed join remains successful if continuation cleanup fails. A lobby that fills or starts remains viewable, and the saved artwork is available for another game. A Daily Free failure retains the original season for retry. `/agents/prepare` without a destination still lists saved Agents for artwork management.

This changes admission and Agent-management UI, not the presentation contract. Existing frozen games, seats, and exports are not regenerated. A waiting seat updated through the normal profile path continues to follow its current revision under the established reconciliation rule.
