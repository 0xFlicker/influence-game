---
module: Seasons
problem_type: missing_feature
tags: [agents, visuals, recovery, seasons]
---

# One-click visual preparation for a saved agent

The Seasons entry panel offers **Update** when the selected saved agent lacks a headshot, full-body reference, visual design, or performance instructions. Complete agents retain an **Edit agent** link. Selecting an agent, joining the queue, and opening the page do not create visual-update jobs.

The same job now also fills missing Influence and Werewolf strategy fields when its owner explicitly starts an update. Game and Daily Free entry use the dedicated preparation flow described in [Full-body Agent entry](full-body-agent-entry.md); older waiting seats remain valid.

## Explicit action and recovery

Owner-authenticated `POST /api/agent-profiles/:id/visual-update` creates or explicitly retries one durable job. Concurrent clicks converge under an agent advisory transaction lock and a unique active-job index. The source and stage checkpoint are private object-backed payloads; the public response contains only status and a safe message. Missing fields alone are prepared, using existing appearance references. The normal saved-agent update path validates image evidence, preserves unrelated fields, records a content revision and applies normal moderation.

The API process runs the authorized job after returning the request. Status reads resume only already-authorized queued/processing work. A two-minute lease with heartbeat fences abandoned workers; a later visit can resume after a process interruption. This is not a new always-on scheduler. If nobody revisits after an API crash, the job waits for the next status request. Failed work needs an explicit Retry update click. Uncertain provider dispatches retain their operation identity; retry checks the existing request instead of risking a duplicate charge. Such uncertainty may still require provider recovery, and is displayed honestly.

Stages are details → body → head localization → portrait → save. Checkpoints and stable provider request IDs preserve successful work. A source edit conflicts rather than overwriting the owner's newer profile. Final save uses a stable submission receipt; a lost response is recognized from that receipt. A held submission is shown as awaiting review, then follows its moderation result. The interface shows actual stages and an indeterminate activity indicator, never invented percentages.

## Existing transparent artwork

The entry preview resolves the transparent derivative of the current body's exact content hash, using its published content revision or verified head-position source hash. It does not start cutout work. Without an available transparent image, it falls back to the saved headshot, then the existing persona portrait. It never shows the opaque original body as if it were a transparent cutout. A failed image URL also falls through to the next candidate.

## Validation and local limits

`agent-visual-updates.test.ts` exercises real Hono authentication and PostgreSQL persistence with provider stubs, including normal saved-agent revisions, concurrent submission, interrupted stages, source edits, response-loss recovery, expired leases and lost-worker fencing. UI tests cover explicit action, reconnect, completion, failure, retry and moderation hold; preview tests cover selection and image fallbacks. These tests make no paid provider calls and use a disposable database.

During verification on 2026-11-04, localhost web was reachable but its API was unavailable (no listener on port 3000), so live visual verification could not complete. No developer servers were started or stopped. Meta Spark's recorded transparent PNG was absent from both the current and former local upload directories; no artwork was regenerated, restored or backfilled in this change. Once the API is running, that missing asset correctly uses the headshot fallback until the existing cutout is restored separately.
