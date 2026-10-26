# Influence room backgrounds

Implemented 2026-10-24 for static portrait/full-body playback. Browser watch and Studio/Remotion use the shared presentation components; replay bundles snapshot the entire `public/visual` tree, including these plates.

## Current settings

| Scene | Setting |
| --- | --- |
| Introductions and Lobby | Classical reception rotunda, charcoal marble, gold capitals, purple panels |
| Mingle room 1 | Moonlit garden colonnade |
| Mingle room 2 | Amber ember chamber with a recessed rear hearth |
| Mingle room 3 | Purple archive chamber with recessed bookshelves |
| Mingle room 4 | Resonance chamber with a gold lyre relief |
| Mingle room 5 | Intimate amethyst stone chamber |
| Empower vote and revote | Warm, inviting limestone hall with a small rear stone fire pit |
| Council/elimination and jury ballots | Stone tribunal, semicircular columns, lit center, rear judicial monolith |
| Werewolf public ballot | Outdoor village tribunal square, evening torchlight |

All floors stay open for characters. Influence Lobby/Mingle use the same `PortraitRoom` shallow perspective, speaker rotation and bubble placement as Werewolf. Room identity comes from the saved room number; ballot setting comes from structured ballot purpose/ledger choice, never narration or caption matching. Introductions keep individual full-body/portrait staging. The current 12-player limit requires at most five Mingle rooms. Unnumbered huddles use the lobby plate.

Generated plates live in `packages/web/public/visual/influence/rooms-v1/` and `packages/web/public/visual/werewolf/votes-v1/`; each directory records full prompts and provenance. Published visual-mode scenes retain their accepted art. This is presentation-only: no game state, rules, recorded results or model prompts change.

## Remaining scene inventory

These scenes still use black, a sparse gradient, or the generic studio backdrop. They are deliberately left for the next art pass. Paths below are relative to `packages/web/src/app/games/[slug]/components/`.

| Scene family | Renderer | Suggested later treatment |
| --- | --- | --- |
| Format offer, selection and rules | `format-offer-stage.tsx`, `format-presentation.tsx` | Dark muted stone alcove behind format cards; preserve rule readability |
| Safety Bounce without accepted scene art | `safety-bounce-stage.tsx`; the visual variant is `safety-bounce-scene.tsx` | Quiet purple-stone chamber behind the existing sequence |
| Two Names nominations, acceptance/decline, plea and resolution | `two-names-stage.tsx`, `nominee-selection.tsx`, `solo-presentation.tsx` | Muted tribunal antechamber; keep nominees and selected target legible |
| Special-format aggregate, wheel and resolution screens | `format-resolution-stage.tsx`, `format-presentation.tsx` | Subdued tribunal plate behind existing authoritative totals/wheel |
| Compact tally/legacy roll-call components | `format-empower-vote-stage.tsx`, `format-ballot-reveal.tsx` | Extend the corresponding vote setting to these non-cinematic summaries |
| House transitions, narration and exit announcements | `house-segment.tsx` | Dark House seal/column setting with low contrast behind text |
| Anonymous speech | `visual-presentation.tsx` | Neutral dark stone wall; no character attribution |
| Diary, farewell, retrospective and other solo asides | `solo-presentation.tsx` via `visual-presentation.tsx` | Small confession chamber; decide whether farewell/retrospective share it |
| Winner and final standings | `winner-scene.tsx` | Celebratory gold/purple chamber with space for winner and standings |
| Standalone Studio thinking-only shots | `packages/web/src/remotion/house-replay/frame.tsx` (`ThinkingFrame`) | Carry the original phase/room setting into independently selected thought clips |

Next pass should group reusable plates by these scene families instead of generating an image for every event type. Keep accepted visual-mode panels, nominee selection, tallies and wheel behavior intact.
