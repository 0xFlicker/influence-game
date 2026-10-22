# Agent shadow screening

Phase 1 screens every new saved content revision using OpenAI `omni-moderation-latest` and `gpt-6-luna`. It only adds private recommendations to existing human reviews. It never approves/rejects content, flags or claims human reviews, holds publication, changes eligibility, notifies owners/operators, or changes games. Existing human moderation restrictions still apply. Phase 2 is not implemented.

## Policy

The versioned policy is `house-agent-shadow-v1`. It covers offensive content and **outside-game collusion**: predetermined favoritism, coded affinity signals, owner-arranged coordination, sabotage or game throwing unrelated to the assigned objective. Examples include “always empower Fred” and “support anyone who likes long walks on the beach.” A name or hobby alone is not evidence. In-game alliances, negotiation, bluffing, betrayal, Werewolf faction teamwork, and sacrifices benefiting the assigned faction are permitted.

Screening covers all saved character text, both games' strategy notes, and only the retained full-body reference image. Headshots and other crop sources are excluded from both provider requests; OpenAI moderation accepts at most one image. Profiles without a full-body reference receive text-only screening. A declared full-body reference with missing or corrupt retained evidence fails screening rather than silently dropping the image. OpenAI category scores are advisory signals; Luna applies the House policy and checks visual content, including categories that OpenAI moderation does not support for images. Findings identify exact field excerpts or retained image hashes. A profile assessment suggests instructions warranting review; it does not prove actual match misconduct.

Both inputs and outputs are untrusted. Luna has no tools or decision authority and must return the exact native strict JSON schema. Semantic validation rejects invented excerpts, unrelated image hashes, missing/extra fields, empty results, wrapped JSON and contradictory findings. Recommendations are `no_concern`, `review`, or `inconclusive`; `no_concern` is not human approval. Technical failure is `incomplete`, never clearance.

Ordinary agent updates preserve existing visuals and do not require full-body generation. The editor offers a visual update when the reference is missing. Visual generation creates the full-body image first and derives the portrait crop from it.

## Runtime and evidence

`recordContentSubmission` enqueues one `agent_screenings` row per content revision and policy version within the save transaction. Retries and unchanged saves reuse the row. The game-worker runtime processes jobs when deployment activation permits work and `OPENAI_API_KEY` is present. There is no feature flag. Missing credentials leave jobs pending with a startup warning. Gateway processes do not dispatch screenings. The existing `INFLUENCE_API_TEST_MOCK_RUNNER` test lane also leaves screenings pending and never starts the live provider worker.

Workers claim jobs with PostgreSQL row locks, a five-minute expiring lease and a fifteen-second heartbeat. Every request is persisted before dispatch; every observed response is persisted before validation or another call. Accepted stages and stored-but-not-yet-validated responses are reused on restart. Known retryable HTTP/structured-output failures have at most three attempts per stage with bounded exponential backoff; HTTP errors use the shared provider classifier. Each request has a ninety-second deadline. Transport uncertainty, missing dispatch responses, storage failures and exhausted retries stop the job as incomplete. They do not cause automatic redispatch or affect the agent.

Requests, raw responses (including usage and native reasoning), and assessment documents use the existing private payload bucket and credential sanitizer. PostgreSQL stores references, hashes, status, coordinates and other small operational metadata. All three new payload columns are in the storage inventory and have reference constraints. Requests use retained image bytes, normalized to PNG; no public/mutable URL or storage credential is sent to a provider. Large or unsupported images can produce incomplete screening; publication remains unaffected. Orphan content-addressed objects from failed transactions follow the existing private-payload retention/reconciliation process; never delete shared objects by assumption.

The panel shows queue badges, AI-review/incomplete filters, findings, classifier category scores, policy/model identifiers, completion time and an older-submission notice. Both game strategies appear in comparison snapshots. Human decisions retain their existing claim, preview and version checks. Old assessments never transfer to newer revisions. AI-review/incomplete filters also discover backfilled assessments on resolved reviews; these remain resolved and require explicit admin recovery before another human decision.

`read_moderation` includes the same assessment and queue filters under existing `moderation:read` consent and fresh database authority. It does not expose raw provider payloads or broaden escalated-review visibility. No new MCP write tool or notification automation is added. Private strategy and evidence must not be copied into owner, public or contestant responses.

## Safety refusal fallback

A structured safety refusal in either original operation starts a separate `luna_collusion` operation. Recognized signals are 4xx `error.code` values `content_policy_violation`, `image_content_policy_violation`, or `content_filter`, plus native Responses refusal content, content-filter termination, or a structured safety error in a successful HTTP envelope. HTTP status or error-message prose alone never identifies refusal: authentication, malformed requests, `too_many_images`, and rate limits follow their existing error handling.

The fallback contains agent text and available OpenAI category flags/scores, with no image or image reference. Its native strict schema and semantic validator allow only text-based outside-game collusion findings. It does not attempt the refused safety/image analysis. It has its own durable attempt sequence and the existing bounded retry policy; a second refusal stops immediately without another fallback. Recovery reuses stored original refusals and accepted fallback responses.

Any refusal keeps the overall advisory recommendation at `review`, even if the fallback says `no_concern` about collusion. A failed fallback remains incomplete with the review recommendation intact. The panel/MCP exposes the limited assessment scope, refusal marker, operation tags, attempt numbers, HTTP statuses and structured provider codes alongside the existing category flags and scores. Small nonzero scores use significant digits instead of rounding to zero. No refusal becomes evidence that the image is safe or that it violates policy; a human decides.

Phase 1 never changes human flags, claims, publication, or revision eligibility. For Phase 2, the agreed behavior is to immediately flag and pause the revision when a refusal occurs; that enforcement is deferred, not enabled here. Verification uses synthetic responses and harmless image fixtures only; no live refusal testing or historical requeue is part of this change.

## Deployment and backfill

1. Apply migrations `0124_agent_shadow_screening` and `0125_agent_screening_refusal_fallback` before starting the updated API/web/worker. It queues existing published and latest-submitted revision IDs, including resolved reviews, without reopening or changing them. Starting the worker will spend on these queued assessments.
2. Run the bounded backfill command against each intended environment to capture older profiles that predate content revisions. Inspect first:

   ```sh
   bun run --cwd packages/api backfill:agent-screenings --limit 100
   bun run --cwd packages/api backfill:agent-screenings --apply --limit 100
   bun run --cwd packages/api backfill:agent-screenings --apply --limit 100 --after LAST_PROFILE_ID
   ```

   Continue with the returned `nextCursor` until null. On failures/conflicts, rerun the affected page before advancing. The command enqueues only; workers perform provider calls. Repeating pages is idempotent and does not rescreen completed revisions. Legacy capture locks/rechecks the profile, retains current bytes, marks ancestry unknown, and attaches evidence coordinates without changing content, ratings, archival or existing moderation restrictions. It never fabricates historical snapshots. A missing legacy image is reported as a failed profile ID; fix storage and rerun the page.
3. Open **Moderation → Screening overview**. The panel shows pending, running, completed and incomplete counts, recommendation totals, and failures grouped by code. Use **Refresh** to reload the counts, queue, and selected review together. Admins/sysops with escalation access see all queues; moderators see only the ordinary queue. Counts include older revisions and resolved reviews under the current policy, independently of inbox filters. Profiles awaiting backfill are not included. Use the **AI recommends review** and **Screening incomplete** inbox filters to inspect individual revisions. No production SQL is required.
4. For programmatic inspection, call the existing `read_moderation` MCP tool with `{"operation":"screening_overview"}`, or authenticated `GET /api/moderation/screening-overview`. Both return the same authorized totals and status/recommendation/failure breakdown, with no provider calls or writes.

Incomplete jobs require manual investigation of their attempt references; there is deliberately no automatic paid retry for unknown dispatches. Human review remains available. A future policy version creates separate assessments rather than overwriting evidence. Do not edit a completed assessment or silently reset unknown attempts.

## Validation

Deterministic PostgreSQL tests cover immediate saves, deduplication, evidence constraints, claims, restart recovery, bounded malformed-output retries, persistence failure, backfill and unchanged human moderation. Moderator route tests cover fresh authorization and read-only MCP parity. The moderation browser suite verifies the advisory panel alongside the existing human workflow. These checks do not establish model accuracy. Live evaluation requires a separately authorized provider run and human-labelled examples, including legitimate teamwork and coded collusion.

## Obsolete unscreened intake reviews

Migration `0126_close_unscreened_superseded_reviews` closes legacy pending reviews as `superseded` when their revision is neither the latest submission nor the currently published revision and has no screening record. It releases their claims and increments their review version. New submissions apply the same cleanup transactionally. No production SQL command or operator backfill is needed for this cleanup: the normal deployment migration applies it.

The cleanup preserves ordinary screened revisions, current/published content, and explicit human work (flags, holds, escalations, rejected dispositions, resolved decisions, or reopened review cycles). It does not change publication, restrictions, AI evidence, retained snapshots, or historical decisions. Superseded reviews remain readable in Admin recovery as closed history; an admin can explicitly reopen one with a reason. This is intake cleanup, not Phase 2 enforcement.

A missing screening record is labelled **AI: not queued** in the inbox. **AI: awaiting screening** means an actual pending screening exists; running screenings have their own label.

The release policy pins the exact cleanup migration by hash: its only deletion is temporary claims on the reviews it closes. Changes to its scope require a new policy review; review history and evidence are retained.
