# Agent screening

The filename reflects the former shadow implementation. New submissions now use enforced policy `house-agent-enforced-v2`. Prior shadow assessments remain immutable historical evidence and are not treated as approval under the new policy.

Saving queues screening in the same transaction as the immutable submitted revision. It returns Reviewing without waiting for providers. New agents wait for acceptance; edits leave the last accepted version usable. Model/voice-only changes on accepted, unchanged character content reuse that safety decision.

The worker runs the existing OpenAI moderation and strict Luna assessment stages. Only a complete no-concern assessment with no safety flag or refusal may automatically publish. Review/inconclusive results, incomplete stages and uncertain dispatches hold the revision. A moderation refusal may still permit a separate collusion-only assessment, but that partial result never permits automatic publication.

Provider requests/responses, available reasoning, attempts and failures remain private object-backed evidence. A provider-written recommendation is evidence: server policy, exact revision identity, human moderation state and transactional publication determine authority. No score threshold or prose grants permission to publish.

## Publication and human review

Automatic publication rechecks latest-submission identity, profile restrictions, review version, route, human flags, ancestry and waiting games under locks. Stale work cannot overwrite a newer submission. Human flags, claims/escalations and rejected ancestors cannot be cleared by an automatic assessment. Reviewers retain whole-revision accept/reject, reopen and audited undo through the existing moderation surfaces.

A crash after assessment persistence is recovered by the publication reconciler without another provider call. A waiting-roster conflict retains the draft and assessment, exposes an owner-safe explanation and prevents partial publication. Frozen games and historical media are unchanged.

The moderation inbox and Screening overview show enforced results and operational failures. Counts describe stored current-policy work; reads never dispatch providers. Normal owner payloads expose Reviewing/Held and safe next steps, not raw findings, reviewer notes or private evidence.

Do not blindly reset unknown provider attempts. Inspect retained request/response references and reconcile their charge outcome before any retry. Missing credentials and incomplete evidence must remain visible failures rather than automatic approval.

## Historical cutover

Previously usable profiles remain usable. Their first new edit captures the old accepted content and existing bytes before recording a new held submission. This does not regenerate artwork or rewrite game history. Existing shadow assessments are preserved; new enforcement is prospective through the new submission policy.

Screened revisions remain reviewable after another submission. Explicit human work remains protected. Legacy unscreened cleanup from migration 0127 retains its historical semantics.

Run deterministic screening, submission, moderation and enrollment tests plus the owner browser journey before release. Those checks establish lifecycle and authorization behavior, not model accuracy. See [workspace deployment](deployment/agent-workspace.md) for the coordinated release and live verification boundary.
