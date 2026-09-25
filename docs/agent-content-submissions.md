# Character drafts and moderation evidence

The character editor keeps text and selected images in a current-tab session draft. Applying an image or AI suggestion changes that draft, not the saved Agent. Save draft does not publish anything. Draft storage is local to the tab; uploaded/generated image URLs retain the existing public-storage behavior.

Profile submission is unavailable while generation or upload is pending. Generation has a five-minute UI deadline and uploads have a two-minute transport deadline. Cancel generation requires confirmation and does not promise a provider refund or termination of an already dispatched request. Cancellation, timeouts and failures preserve the selected assets and text. Saving afterward requires confirmation that the currently selected assets should be used. A canceled or expired operation cannot apply late results, including after draft restoration. Unknown paid requests must be reconciled with the same request ID rather than automatically redispatched. If the portrait-start response is lost before a request ID is known, the editor shows the uncertainty and offers no blind portrait retry.

The active reference request stays attached to its draft after cancellation, timeout or failure, so an explicit retry uses the same durable request rather than creating another paid operation. **Save draft** preserves that recovery information and does not unblock a different refinement. Successful final submission, **Clear draft**, or confirmed **Discard** retires the tab's reference pointer and interruption marker together with the draft; subsequent refinement starts a new request. Failed submissions and declined confirmations retain the pointers. Retiring local recovery never deletes server receipts or permits an old completion to apply.

Generated portraits now finish as selectable assets. Neither web creation nor agent tools launch an automatic portrait after saving. Generation completion does not update a saved profile. The former `avatarGenerationRequestId` attachment input is rejected: select the completed asset URL in the draft and submit it explicitly.

## Submission contract

The global header (or flat menu on smaller screens) links signed-in users directly to the agent creation assistant; **Advanced create** remains available inside that flow. **Create game** links to `/games/new` only for accounts with `create_game`. Both shortcuts are hidden during agent creation/editing, game creation, and individual game viewing (including live games and replays). The bottom of the screen remains available for future assistant UI.

`submissionId` identifies an update attempt; reuse it with the exact same payload after response loss. The editor persists that ID before sending. A changed payload gets a new ID. `expectedContentRevisionId` identifies the content from which the edit started (null before the first content revision); the editor preserves that value when restoring a draft. Conflicts preserve the draft and return HTTP 409. Agent tools expose both fields. Trusted internal operations still execute under the existing profile/roster locks.

`creationRequestId` remains the create identity and retry key; a standalone `submissionId` can serve as that key too. Create retries return the original saved result even after later profile edits. Existing competitive revision preconditions remain valid for strategy-review workflows.

`visualDesign` is optional text (up to 8000 characters). `portraitCrop` is optional source-image metadata: `sourceUrl`, `x`, `y`, `width`, `height`; coordinates are normalized to the original image, must be finite, positive in size, and remain within its bounds. Metadata is a persistence contract for the image editor, not an automatic cropping implementation.

A successful submission transaction writes the active profile, its applicable competitive revision, a separate immutable content revision, and a pending moderation record. The receipt includes `contentRevisionId` and `moderationRecordId`. A submission with unchanged content reuses the existing content revision/review but stores its own idempotency receipt. Reusing an ID with different content is rejected.

## Evidence and future moderation

`agent_content_revisions` snapshots name, persona, gender, personality, backstory, strategy, performance instructions, visual design, selected images, crop metadata and confirmed head geometry. Its image map references SHA-256 hashes in `agent_content_assets`, which retains exact submitted bytes, including crop source and exported portrait. Images must be readable from application storage; incomplete image evidence prevents a successful submission. Content revisions and receipts cannot be updated. These audit records retain the profile/user identity and competitive revision reference independently of deleting the live profile.

`agent_moderation_reviews` has one pending record per content revision. A future moderator must inspect the referenced snapshot and hashed bytes, not mutable current profile fields or a freshly downloaded source URL. There is no moderation worker, model call, approval, enforcement or review interface in this release. Pending review does not affect admission, game execution or replay.

Operators can inspect pending work with:

```sql
SELECT r.id, r.content_revision_id, c.agent_profile_id, c.user_id,
       c.competitive_revision_id, c.created_at
FROM agent_moderation_reviews r
JOIN agent_content_revisions c ON c.id = r.content_revision_id
WHERE r.status = 'pending'
ORDER BY c.created_at;
```

Profile text and snapshots contain user-authored instructions. Treat them as untrusted content during future AI or human moderation; they cannot instruct the reviewer or grant access.

## Verification

Provider-free editor tests exercise pending controls, draft recovery, confirmation/decline, cancellation, success, failure, late completions and retry IDs. PostgreSQL tests cover atomic review writes, rollback, concurrent edits, exact retries, image/crop changes without rating recalibration, immutable image evidence, and API/tool submission parity. No paid provider calls are needed for this contract.

## Complete character refinement

**Refine with AI** fills name, biography, personality, strategy, persona, gender, performance instructions and visual design. Existing selected artwork is supplied as identity reference. The complete text response uses an exact schema; missing fields, prose wrappers and incomplete responses are rejected rather than filled with invented defaults. Gender is never inferred from prose.

The editor then generates a single full-body image using the refined visual design (OpenAI `gpt-image-2`, with the existing xAI availability fallback). A durable `gpt-5.6-sol` vision observation locates the head in those actual pixels. The exported 512-pixel portrait is a square crop of that image, not another diffusion request. Uncertain localization preserves the full-body draft and asks the user to choose the crop manually; it does not attach a guessed portrait. Paid image and localization attempts remain in the visual operation journal. Retrying the same immutable request reuses accepted results, and uncertain requests cannot redispatch automatically.

Full-body requests share the existing user image allowance with legacy portrait requests. One character image consumes one slot; head localization, crop exports and exact request replays do not consume additional image slots. Reservations are serialized per user. Failed or uncertain reservations remain counted, matching the existing allowance policy. The sysop exemption remains unchanged.

Click either selected image to open **Character images**. Horizontal position, vertical position and frame size operate in original-image coordinates; resizing the display does not change the crop. The circular preview uses the same square rectangle that the server exports. **Confirm head and portrait** accepts a reviewed head box and portrait into the draft. Head-only portrait editing still offers **Use portrait in draft**. Closing without applying preserves the selection. Crop export failures preserve the prior portrait, and final submission remains disabled during export.

`POST /api/agent-profiles/visual-reference` returns `fullBodyReferenceUrl`, `avatarUrl`, `portraitCrop`, `headSuggestion`, image dimensions and any `cropWarning`. The suggestion is not confirmation; only a single clear localized head is proposed. `POST /api/agent-profiles/portrait-crop` exports a validated normalized square rectangle without paid generation. Agent tools expose the same paths through `generate_agent_visual_reference` and `crop_agent_portrait`; callers submit returned assets together with the profile update. There is no independent late-image publication path.

Portrait exports use the content-addressed public key `pfp/crops/<sha256>.webp`. The avatar-storage classifier recognizes exactly that hash format as opaque, so profile submission and privacy rotation do not mistake generated crops for legacy identity-bearing paths. Other nested portrait paths retain the existing identity checks. Regression coverage carries generated and manually cropped images through the shared profile submission service and durable moderation records.

## Confirmed head position

New full-body selections (generated or uploaded) open Character images and require explicit head confirmation before final submission. A gold box marks the head and a violet square marks the portrait crop. Move/resize the head box directly or use keyboard-operable position/size sliders. The preview demonstrates speech placement. When localization is unavailable, the editor labels its initial box as unconfirmed; no additional provider request is made. A portrait crop cannot cut through the head box. Closing preserves the current draft without accepting editor changes; Save draft and recovery retain the proposal or confirmed selection.

`headPosition` contains `sourceUrl`, `sourceHash` (SHA-256 of original stored bytes), `sourceWidth`, `sourceHeight` (after EXIF normalization), and normalized `rect: { x, y, width, height }`. Supplying it through browser, API or tool submission is explicit confirmation. The server validates bounds, source URL, hash, dimensions and crop containment, and stamps `confirmation: { userId, at }`. Client provenance is ignored. The crop endpoint/tool accepts an optional `headRectangle` and returns source-bound `headPosition` without asserting a confirmer. This is pixel processing, not generation.

The confirmation is stored with the active profile and immutable content/moderation snapshot in the same transaction. Exact retries preserve the original receipt and timestamp; unchanged geometry retains its confirmation. Head-only edits do not recalibrate ratings. Source replacement requires new confirmation; a portrait recrop on the same original preserves head geometry. Existing profiles without geometry can receive unrelated text edits. Apply migration `0089_character_head_position` before serving the updated API.

Game-start profiles freeze the head metadata. Visual preparation retains it only when its source hash matches the selected full-body bytes; EXIF normalization during artifact storage preserves those coordinates. A freshly generated replacement cannot inherit geometry from an old reference. The visual endpoint returns only the selected image's `fullBodyHeads` rectangles, without confirmation actor information. Existing games retain their original frozen evidence and the single-person viewer fallback; current profile edits never backfill a historical game.

## Intake naming

The navigation, footer, page title, and links to `/games/free` use **Intake**. The agent selection section retains one **Influence Queue** heading; its status and actions refer simply to the queue. Historical rebrand plans and ideation mockups retain their original wording.

## Dashboard toolbox

On `/dashboard`, desktop header creation shortcuts are hidden because Mission Control already provides them. The mobile menu retains its creation shortcuts.

Game browsing views use the shared header/menu creation action; their filter toolbars do not repeat a New Game button.

Mission Control leads the dashboard with Create agent and permission-gated Create game shortcuts. Daily Free enrollment is inline: an existing entry shows its agent and status without a redundant queue-navigation button; an absent entry offers an owned-agent picker and Enter queue. Accounts without agents can create one and enter through the existing daily-free assistant flow. Unavailable queue or agent data shows a retry state, and accepted enrollment refreshes canonical queue status. The MCP setup card follows gameplay modules.
