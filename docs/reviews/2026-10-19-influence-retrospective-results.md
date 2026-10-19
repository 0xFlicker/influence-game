# Influence retrospective closing results

Influence previously cleared the revealed winner at the retrospective boundary and ended on the final speaker. The endgame cue compiler now emits a closing winner-and-standings cue at canonical `retrospective.completed`. It reuses the accepted jury result, or derives the sole survivor from the canonical frame when there was no jury. Incomplete exit history leaves unknown placements unset. No winner is inferred from dialogue.

Presentation-only API frames now retain retrospective completion even when END follows it. This gives playback, live append, deep links and full replay exports the same completion boundary. Pending/suspended retrospectives do not show the closing cue. Historical games without retrospectives retain their existing ending.

Verification:

- Browser: played the final retrospective of saved localhost game `zero-lilac-jade`, event 315, through completion 316. At 46:08/46:08 the player stopped on Larry Buffer's winner screen, with all seven remaining placements, and Next disabled.
- Focused endgame, director and export tests: 45 passed.
- Focused PostgreSQL replay-frame tests: 18 passed.
- Provider-free baseline: 2,744 passed, 5 skipped, zero failures. The sandboxed attempt could not bind localhost test servers; the rerun with local network access passed.
- `bun run check`: typecheck and lint passed across all workspaces.
- Required PostgreSQL baseline: 2,087 passed, zero failures across 181 files.
- Screenshot: `packages/engine/docs/simulations/influence-retrospective-results-review/influence-retrospective-results.png`.

No inference was requested or spent. The local API was restarted after confirming there were no running games; existing suspended games were left alone.
