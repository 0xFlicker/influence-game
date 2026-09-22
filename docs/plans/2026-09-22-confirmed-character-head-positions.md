---
title: Confirmed character head positions
type: feat
status: proposed
date: 2026-09-22
---

# Confirmed character head positions

## Current delivery and existing behavior

The viewer now fills the player vertically with the saved full-body reference and overlays speech below its head region. Existing upright character references use a conservative top-of-image fallback; no historical game data or paid generation is needed for that presentation fix. The workflow below is the next implementation, not yet shipped.

`generateVisualProfileReference` already calls head localization after generation. It uses the returned head rectangle to derive `portraitCropFromHead`, exports the portrait, then discards the rectangle from the response. `CharacterPortraitEditor` allows adjusting a square crop. `AgentForm` accepts the generated image/crop immediately. The square portrait crop includes hair and shoulders and is **not** a reliable head bounding box.

## Source-bound geometry

Persist one confirmed head rectangle in normalized, EXIF-normalized **full-body source coordinates**, separate from the portrait crop. Include the immutable source asset hash, source URL, width and height. The exported portrait, its crop, and the head geometry belong to the same atomic content revision. Record confirmation actor and time on the server; clients cannot assert a different confirmer.

Head bounds must be finite, nonempty and contained within the image. Validate the source hash against the submitted immutable image evidence. Changing the source invalidates its head confirmation; changing only the portrait crop does not move the head in the original. The portrait's own head rectangle is derived from source coordinates and the crop transformation, rather than localized again. The editor should prevent a crop that cuts through the confirmed head.

## Create and edit draft flow

1. Keep the localized head rectangle as a proposal in the generation receipt and draft. Do not add another image generation or localization request when the existing call succeeded.
2. Open the existing Character images editor for a newly generated or uploaded full body. Show a labeled head box on the original, a portrait crop preview, and an example speech bubble below the head. Offer move/resize handles plus keyboard-operable position/size controls. The head box and portrait crop are distinct controls.
3. If localization failed or found no clear head, let the user place the box manually. A top-of-image suggestion may initialize the editor but must be labeled as unconfirmed. No guessed box is silently saved as verified.
4. Use an explicit **Confirm head and portrait** action to accept the geometry and exported portrait into the draft. Users may correct either selection before confirmation. The original full-body image remains unchanged.
5. Restore the source, proposed/confirmed geometry and crop with current-tab draft recovery. A new replacement clears confirmation for that replacement, while cancellation retains the prior selected image and geometry. Existing epoch fencing still rejects late completions.
6. Require confirmation before submitting a newly selected full body. Save draft remains available. Unrelated edits to an existing historical profile do not silently acquire a guessed head or force regeneration; the editor offers a clear review action for its existing image.

## Atomic submission and viewer delivery

Carry the metadata through the shared profile contract, create/update service, browser draft model, API and agent tools. A tool submission must provide equivalent explicit geometry confirmation; the browser is not an authorization boundary. Save profile values, immutable content revision, and moderation record in the existing transaction. A geometry-only change is a content revision, never a competitive recalibration.

Freeze confirmed geometry with the game-start profile and prepared cast reference. If preparing a cast reference creates different image bytes through a spatial transformation, transform the head rectangle using that exact operation or discard it; never apply it to a newly generated image. Return geometry bound to the selected reference artifact from the visual endpoint. Playback uses matching confirmed geometry first, then the existing single-character fallback when no matching data exists. Room-scene anchor verification remains separate.

Existing games are not rewritten from current agent profiles. Optional backfill for a historical game must annotate its exact frozen artifacts, preserve artifact hashes, record provenance, and receive review before replacing the fallback. It must not change accepted agent image context, dialogue, or gameplay.

## Verification

- Provider-free editor tests: proposed box, manual placement, keyboard correction, confirmation, declined/closed editor, generation failure, replacement, recovery, cancel/timeout and fenced late results.
- Geometry tests: portrait/landscape sources, EXIF orientation, image scaling, edge heads, crop transforms, source mismatch, invalid bounds, and speech below the confirmed head on rotation.
- Shared service/PostgreSQL tests: text-only edits to legacy profiles, geometry-only revision without rating effects, atomic rollback, concurrency conflicts, idempotent retry, immutable moderation evidence, browser/API/tool parity.
- Viewer tests: frozen geometry survives later profile edits; different image hashes never reuse it; actual confirmed head and legacy fallback both preserve face clearance and readable pages. Review `odd-lime-vine` and new confirmed profiles on phone portrait, phone landscape and desktop.
