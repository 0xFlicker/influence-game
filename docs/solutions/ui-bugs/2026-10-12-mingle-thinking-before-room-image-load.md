---
title: Hold Mingle thinking until the selected room image loads
date: 2026-10-12
module: Influence visual playback
problem_type: ui_bug
category: ui-bugs
tags: [influence, mingle, thinking, playback, image-loading]
---

The first visit to a Mingle room could zoom into an unrelated object in the previous room before displaying the next speech. Returning to the room often worked because the browser already had its image.

`VisualSceneView` retained the previous camera image during the incoming image load, but thinking framing used the incoming scene's head coordinates. Its existing readiness callback was not connected to the Influence presentation director, so thinking consumed its time while those old pixels remained visible.

Connect scene readiness to the active cue's existing `setReady` gate through `VisualPresentationFrame`. Report readiness in a layout effect to hold the shared clock before paint. Scope callbacks to the cue key and release the gate when leaving scene presentation or unmounting. Successful loads and image failures both release the gate; failures use the existing portrait fallback.

Independently gate thinking transforms, portraits and overlays on the selected image being loaded and its transition being complete. Retaining an image never makes incoming head coordinates applicable to it. Do not add another timer or infer room transitions from transcript prose.

Regression coverage delays the second room's image, checks that the retained image has no incoming thinking zoom, checks thinking after the transition, and proves both image load and image failure preserve the shared thinking clock and pause behavior.

The existing Influence and Werewolf room test harnesses also need `getComputedStyle` and `document.fonts.ready` for shared typography measurement. Scope player assertions to the render container so hidden probes appended to the document do not masquerade as visible speech, and flush font-ready updates before teardown.

Local verification: 46 focused playback tests, 2,597 provider-free tests (five skipped), 2,025 PostgreSQL tests, and repository typecheck/lint passed. PostgreSQL used a fresh temporary database because the shared test database had a migration-history conflict; the temporary database was removed afterward. No deployment or live-browser verification was performed.
