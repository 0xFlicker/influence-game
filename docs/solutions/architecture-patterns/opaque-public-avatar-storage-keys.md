---
title: Opaque Public Avatar Storage Keys
date: 2026-08-04
category: architecture-patterns
module: public player identity
problem_type: architecture_pattern
component: object_storage
severity: high
applies_when:
  - "storing public profile media owned by an authenticated account"
  - "changing an object-key scheme that previously embedded internal identity"
  - "rotating durable media references across relational and JSON database fields"
  - "deleting legacy public objects only after replacement and reference verification"
tags: [avatar, privacy, object-storage, opaque-key, data-rotation, public-media]
related_components: [database, authentication, background_job, testing_framework, documentation]
---

# Opaque Public Avatar Storage Keys

## Context

Public media does not make internal identity safe to publish. An object key is copied into browser URLs, caches, logs, screenshots, referrers, and third-party tooling. A key such as `pfp/<users.id>/<asset>.png` therefore exposes the internal authentication subject even when the image itself is intentionally public.

Ownership and auditability already live in `agent_profiles`, avatar generation requests, and the avatar change ledger. Putting those identifiers in the pathname duplicates authority while widening disclosure.

## Pattern

Generate a fresh random asset UUID at the final storage boundary. Uploaded portraits use `pfp/<uuid>.<ext>` and generated portraits use `pfp/generated/<uuid>.<ext>`. Do not derive the key from a user, agent, request, wallet, email, handle, filename, or provider value. Treat the resulting URL as a public locator only.

Validate inbound owned URLs as well as producers. New create and replacement operations must reject known legacy identity-bearing owned keys. An update may preserve its exact current legacy URL so an unrelated profile edit is not blocked while rotation is pending, but it must not assign that URL to another profile or reintroduce it after rotation.

## Rotation invariants

Build the rotation manifest from the union of storage inventory and a fresh whole-database reference scan. A referenced legacy key with no source object is a hard failure; iterating only bucket objects can otherwise produce a false clean result. Scan direct avatar fields and recursively scan safe generation metadata, avatar change metadata/URL columns, and persisted postgame render snapshots.

Copy referenced objects to random replacement keys with an explicit public ACL. Require a non-null matching ETag and byte length before recording a copy as complete. Repoint each legacy key transactionally, including recalculating the House Highlights snapshot hash whenever its manifest changes. Checkpoint the private `0600` manifest after each durable step so reruns verify completed work instead of blindly repeating it.

Deletion is a distinct, explicitly confirmed phase. Before deleting anything, rescan the entire database, reject untracked legacy objects, and re-HEAD every required replacement. Keep avatar/profile writes and render-worker claims quiescent across repoint, verification, and deletion because no database transaction can atomically cover an external object store.

## Verification

Tests should cover opaque generation for manual and generated avatars, rejection of new legacy assignments, preservation of an unchanged legacy value during unrelated edits, encoded path-style S3 URLs, every persisted reference family, snapshot hash regeneration, dangling database-only references, missing replacements, null/mismatched ETags, untracked late objects, resumable checkpoints, and both CLI mutation gates.

Deployment proof still needs a production-like staging rehearsal, a private full-bucket classification, zero-result database audits, anonymous replacement `HEAD` checks, old-object `404` checks after deletion, and signed-in/public portrait smoke tests. Unit tests cannot prove provider ACL behavior, cache expiry, or that all live writers were drained.
