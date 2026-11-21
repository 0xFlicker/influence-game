# House mining and production operations

## Discovery, state and continuity

Prefer current House MCP capabilities when sufficient. Discover tools by name/description rather than assuming a creation or export tool exists. An authorized API is a suitable fallback for missing operations; inspect current routes/contracts, use the existing scoped credentials without printing them, and verify the deployment origin. This reference grants no new credentials or permissions.

Keep operational scripts and candidate receipts outside the application checkout unless code changes were requested. Do not modify game code as part of ordinary mining. Persist a checkpoint outside temporary storage so another turn can recover actual game and render IDs. On resume, query authoritative state; a checkpoint's “running” label is only a pointer.

A useful ledger shape:

```json
{
  "brief": {
    "description": "A tense game with competing credible reads and a late reversal",
    "gameType": "werewolf",
    "format": {"players": 8, "wolves": 2, "doctor": true, "hunter": true},
    "rosterPolicy": {"required": ["GPT Astra", "Claude Opus"], "remaining": "operator delegates choice"},
    "media": {"gameplayAudio": false, "gameplayVisuals": false, "postgameAudio": true, "postgameVisuals": true},
    "visibility": "unlisted",
    "export": true
  },
  "candidates": [],
  "selectedGameId": null,
  "narrativePath": null,
  "thinkingSelectionPath": null,
  "mediaReceipts": [],
  "studioCutUrl": null,
  "selectionHash": null,
  "renderJobId": null,
  "verifiedRenderState": null
}
```

The example values are not universal defaults. Record explicit limits and exclusions when present. Keep free-text descriptions; a rigid schema is unnecessary if the evidence remains clear.

For currently supported Werewolf lobby operations, verify `/api/werewolf/lobbies`, per-game `/join`, `/lobby` and `/start` against deployed contracts. Influence has different creation and lifecycle semantics. A direct “create and start” endpoint can bypass the readback opportunity; prefer a waiting lobby when verifying a custom roster/setup. Confirm current supported rules, not an obsolete historical preset. Required visual generation must not disqualify text-only contestant models under House policy.

Normal waiting is not a blocker. Re-poll a timed-out observation before restarting work. A game can have its faction outcome resolved while retrospective statements are still running; wait for the completion boundary required by production source access. Do not change status manually to force Studio access.

## Editorial evidence

Review complete candidate stories, not only the winner or a turning-point search result. Compare plans, speeches, actions and outcomes. A quick Hunter revenge may be excellent for a requested punchy short but insufficient for an operator seeking a sustained back-and-forth game. Fit the rubric rather than universally rejecting short matches.

A promising story from a prior run was a villager who first suspected Astra, then knowingly broke a 2–2 tie against another villager. The accepted thinking exposed both the wolf's aim to gain one vote and the villager's sincere reassessment. This illustrates a compelling causal hinge; do not require future games to reproduce it or frame every winner as Astra.

Canonical event sequence, replay cursor, moment semantic order and profile/player IDs are not interchangeable. In a prior Werewolf source, a thought at cursor 69 belonged to event sequence 87. Catalog `order.anchor` used the cursor while the moment ID encoded the event sequence. Use the source/catalog mapping and assert the exact intended IDs/speakers before tagging, freezing or exporting. Correct mistakes with revision-guarded edits to only this task's tags.

## Audio and visual production

Read the deployed production preview first. Audio generation can cover more lines than the final cut; bind only the chosen moment recordings when freezing the export. A ready audio track or number of generated clips alone does not prove all selected thoughts are recorded. Compare exact selected IDs, speaker identity and text hashes.

Visual inventories may describe canonical scene keys before scene records exist. Queue one job, keep its returned identifiers and poll; follow per-game concurrency constraints. **Never index jobs by array position to identify a scene.** Lists can reorder after publication or refresh. Match canonical scene key/ID, then exact version/job ID. Read the current expected version and publication revision before mutations.

Review the generated pixels. Check actual cast at that source moment, recognizable identity, wolf/human form according to audience, and head/subject localization when required. Retain review evidence and the accepted generation version. Do not invent review results or submit a review on the wrong reordered job.

Generation, review/verification, publication and source refresh are separate states:

1. A completed generation creates a candidate/version.
2. Review verifies that the version fits the canonical scene and permitted audience.
3. Publish the accepted version using the intended game's audience/access rules.
4. Read back the publication and verify it is available on the intended viewer/Studio surface.
5. Refresh published visuals and prepare a fresh frozen source/selection.

In a prior run, private producer publications were insufficient for the operator's ordinary viewing flow; the operator had to publish the visual-mode generations before seeing them. Do not repeat that by treating any publish receipt as end-to-end visibility proof. Use actual surface availability as evidence. Do not change an unlisted game to public or expose pack-only material in Mystery to fix an access mismatch.

## Export boundary and recovery

Preview the exact recipe (for example full speech/results plus Smart thinking), check counts **and identities**, then freeze it with explicit audience, geometry, audio and music settings. Pin accepted recordings and published images. Refreshing after publication prevents exporting old portrait fallbacks from a pre-generation snapshot.

Order a render with the frozen descriptor and a stable request key. Save the returned job ID. Track queued → rendering (or later), distinguish failures from slow scheduling, and retain execution evidence. Do not claim a successful movie merely because the request returned HTTP 202. The default mining endpoint is worker start, so no full-MP4 quality claim or download is needed at that point.

A Studio review link backed by live tags can drift if tags change later. Retain the frozen export descriptor as the authority for the actual movie; explain the distinction if the operator later changes the cut. An existing bundle/MP4 does not adopt newly published visuals automatically.
