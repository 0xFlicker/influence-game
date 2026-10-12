---
title: Let Studio use the shared replay fallback for absent frozen character art
module: Werewolf production and local replay export
problem_type: integration_issue
date: 2026-10-12
tags: [werewolf, production, avatars, fallback, frozen-media, export]
---

## Problem

A completed staging match had a registered contestant with an Agent Profile ID but no content-revision ID in its canonical start record. Native replay could show its existing image fallback. Studio loaded the catalog but failed eager media preparation with `Frozen character reference unavailable`; the Player and timeline never mounted, and durations showed zero.

`materializeWerewolfWatch` advertised a portrait endpoint for every player even when `werewolfReferenceMetadata` already knew that no portrait was available. The immutable character reader correctly returned 404. Loading today's mutable profile would change the historical match and would not repair its frozen reference.

## Solution

For a production snapshot, advertise a portrait URL only when the pin includes that frozen portrait or the character uses the existing bundled House art. Otherwise return the existing nullable portrait field. The shared replay stages then render their House portrait, initials or name-card fallback; Studio and export use those same stages. Local export already snapshots built-in stage art into its bundle with file hashes.

Build full-body URLs from the character endpoint separately from the nullable portrait URL. A body-only reference must retain its available original body without producing `null&image=body` or requiring a nonexistent portrait. Apply the binding to window identities, moment snapshots and pre-night snapshots. Public replay's URL contract remains unchanged.

Keep the media pin authoritative. Later insertion of originally captured portrait bytes leaves an existing missing-art preview/export unchanged until explicit visual refresh. A tampered availability list still fails snapshot validation, direct unavailable image requests still return 404, and current profile URLs are never read. Available imagery, authorization and transport failures remain errors; do not catch arbitrary failed media requests and silently discard their assets. Regeneration/recovery still requires its existing frozen-reference validation and operation permissions.

## Validation

The focused PostgreSQL regression passed 808 assertions for a missing revision, body-only art, an absent captured portrait later restored, both audiences, all relevant snapshot bindings, exact returned body bytes, frozen selected export validation, explicit refresh and tampered-pin rejection. Its first draft attempted to delete immutable accepted character evidence; the existing database guard rejected that setup. The corrected regression tampers with the supplied pin instead and preserves that guard.

The isolated browser proof opens the Studio, seeks the missing-art thought, saves a label, watches and freezes its cut, samples it in both directions and fits desktop/narrow layouts. It observes zero requests for the mutable profile image. Encoded 640×360/24 fps frames agree with the preview at thought entrance, reading and return (mean pixel differences 1.44 / 2.04 / 1.39 out of 255); the selected thought schedules no audio. The existing verifier also proves reverse/random/fresh/contiguous sampling and encoded frame/audio presence. The complete Studio interface/encoded suite passed 20 tests with one optional skip after the capture-order correction below; its owned database was dropped. Full baseline results are recorded in the [refinements plan](../../plans/2026-10-10-002-feat-production-studio-editing-refinements.md).

The staging diagnosis was read-only. The implementation and encoded proof are local; deployment and delivered operator acceptance remain separate. No paid generation or real-game repair was performed.

Integrated runs exposed a sampling prerequisite: Remotion can render correct frame attributes before its fresh measured Player layout has visibly painted. The first capture was black; a later capture of the same frame and geometry showed the correct fallback. The shared browser capture helper now foregrounds the preview, waits for positive measured bounds and visible ancestors, then waits for paint, retaining its exact-frame, font and decoded-image checks. Waiting for paint before checking visibility was insufficient. It retains the strict pixel assertion and adds no product timing workaround. The complete Studio interface and encoded proof passed after that ordering correction. The season browser harness also needed an explicit teardown deadline consistent with its existing bounded browser/server/database cleanup steps; its default five-second hook timeout interrupted that ordered cleanup despite passing product assertions.

The final full browser run passed every Studio test and both encoded comparisons but retained one public Werewolf replay fetch timeout (69 passes, one optional skip, one failure). That journey passed its isolated rerun; no public replay transport changes were added for the non-reproducing failure. Provider-free and PostgreSQL baselines, all package typechecks/lint and scoped cleanup passed. The full run's nonzero result is preserved in the plan instead of being represented as a wholly green baseline.
