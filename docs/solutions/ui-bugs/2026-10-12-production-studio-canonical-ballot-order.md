---
title: Preserve canonical ballot order when Studio loads a differently ordered roster
module: Influence format presentation and Production Studio
problem_type: integration_issue
date: 2026-10-12
tags: [influence, production, canonical-events, ballot-order, replay, export]
---

## Problem

Production Studio reported `Production picture is missing` for an `influence-bridge` whose following part was `format_roll_call`. This is a missing compiled presentation, not a missing image. Eager source binding aborted before the Player and timeline mounted.

The catalog creates ballot moments in canonical frame player order and keys a phase bridge to its first following moment. The format compiler instead filtered the separately loaded identity roster by canonical eligibility. That preserved database seat/join order, treating the ordered eligibility list as a set. Different roster orders therefore produced different first voters and bridge identities.

Read-only production event/projection and public replay reads established valid accepted ballots and canonical order for the reported game. Production SQL seat order was not retrieved because the local Tailscale connection was stopped. Reversing only an identity roster in a deterministic local fixture reproduced the exact missing-bridge failure.

## Solution

In the shared format presentation compiler, filter the canonical eligibility array by known identity IDs, preserving canonical order. Keep its existing roster behavior when no trusted eligibility is supplied. Preview and export use this same owner.

Leave API source roster serialization and hashes, stable catalog identity, sparse annotations, canonical game reduction and strict presentation binding unchanged. Do not catch the missing picture, omit the bridge or use transcript prose to reconstruct accepted state. No data migration or new fallback is needed.

## Validation

The focused compiler/binder suite passes 47 tests with 358 assertions. Original, reversed and rotated identity rosters produce identical format cues, catalog binding and default picture/timing coverage across the existing canonical format scenario matrix, including terminal prefixes.

The isolated browser regression reverses fixture seat timestamps without changing canonical frames or catalog IDs. It opens Studio, inspects/seeks the first ballot, compares repeated frame pixels, builds a ballot-only cut and freezes its exact IDs. Browser, encoded-media and baseline results are recorded separately in the [refinements plan](../../plans/2026-10-10-002-feat-production-studio-editing-refinements.md).

These are local fixture checks. No production data was changed, no provider generation was called, and deployment plus opening the reported production game after deployment remain separate proof.

The final standard browser run passes the new ballot-order case but retains an existing Werewolf missing-art first-capture failure (71 passes, five optional skips, one failure). Extended encoding also observed a small avatar-edge reverse raster variance that did not reproduce in an offline repeat of the same prepared bundle. The focused ballot preview/encoded proof passed, but a repeatably green full sampling suite is not claimed. Strict assertions and renderer behavior remain unchanged; exact results are in the plan.
