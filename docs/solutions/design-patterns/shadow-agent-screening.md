---
title: Keep AI agent screening separate from human moderation authority
date: 2026-10-21
module: Agent Profiles
problem_type: design_pattern
component: background_job
tags: [moderation, shadow, collusion, immutable-evidence, provider-retries]
---

Agent screening gates new content publication under `house-agent-enforced-v2`. The last accepted revision stays usable while a changed revision is reviewing or held. Historical shadow assessments remain readable and cannot grant current-policy approval. A mutable profile read can race with later edits; a reused human flag can accidentally make an advisory model authoritative.

Enqueue a separate assessment keyed by immutable content revision and policy version in the existing submission transaction. Keep AI status/recommendations separate from human decisions. Automatic publication requires a complete clear current-policy assessment and an untouched ordinary review; active human claims, flags, holds, triage and restricted ancestry take precedence. Authorize the review before exposing the assessment. Fence worker completion by lease ownership and render old-revision status explicitly.

Persist requests before spending and raw responses before validation or subsequent calls. Reuse accepted or observed responses after restart. Stop uncertain dispatches and evidence-storage failures visibly instead of repeating paid calls or reporting clearance. All body documents belong in the private bucket, with relational references and integrity checks in PostgreSQL.

Game policy must distinguish outside-game collusion (predetermined support based on names, owners, passwords or coded affinity markers) from earned in-game alliances and Werewolf faction teamwork. Require exact excerpts or retained image references. A shared hobby alone is not collusion. Neither safety scores nor a model recommendation is a human decision.

See [the implementation and backfill runbook](../../agent-shadow-screening.md).

Screen only the retained full-body reference in both OpenAI moderation and Luna. OpenAI moderation rejects multiple images (`too_many_images`); including the derived headshot caused real local `request_error` failures. The request builder accepts a single optional image, and regression coverage excludes portrait/crop-source evidence. Profiles without a full-body reference receive text-only screening; a declared reference must still pass retained-byte integrity checks. Ordinary edits do not force visual regeneration.

On a structured provider safety refusal, preserve the refused operation and continue only a separate, text-only `luna_collusion` operation. Hold the submission for moderation regardless of the fallback outcome. Expose scope, operation/attempt tags, HTTP and provider codes, and classifier flags/scores to human reviewers. Never interpret arbitrary 4xx errors or prose as refusal, recursively fallback, or resume a refused image analysis. A complete clear assessment can publish atomically; refused or incomplete assessments cannot.


Legacy unscreened revisions can outlive their use as either the submitted or published profile. Close their untouched pending reviews as `superseded` and release claims, both in the deployment data migration and during subsequent submissions. Preserve explicit human triage and all evidence. Lock claimed/triaged review rows so closure cannot leave a new dangling claim. A null screening is "not queued", never "awaiting screening"; closed intake history is not a moderation approval.
