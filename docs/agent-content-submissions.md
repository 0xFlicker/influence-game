# Agent workspace and publication

Creation, ordinary editing, profile requests and linked strategy edits use one workspace. Guided and Advanced show the same draft, model choice, voice, selected images, crop and conversation. Advanced has Character, Strategy and Appearance sections. Both modes share the hall background and full-body stage; an empty Guided creator uses the full width. Model and voice sit below the composer or editable fields, and Close stays in the header while Cancel and Review are grouped at the bottom. Review is enabled only for a changed draft with name, personality and gender present and any new head/portrait confirmed. It opens an accessible dialog containing actual field differences and Undo before Create or Save; undoing every change closes it. Required-field shortcuts sit by the actions and open the relevant field. Text updates never imply image generation.

## Drafts and artwork

Authenticated drafts are private account records with a versioned compare-and-swap document in object storage. Tab storage supplies immediate recovery. Close waits for durable draft persistence; Cancel confirms discard. Stale drafts remain recoverable: a three-way merge preserves independent accepted-profile changes and asks about conflicting fields. If this tab and the account draft differ, both versions are shown before the user chooses which to resume. Artwork, portrait and head geometry merge as one decision. A conflict never silently discards local work or starts paid work.

An artwork request is a durable owner-scoped job with immutable inputs, a stable UUID, worker lease, real stage and retained result. Navigation, reload, polling and mode changes do not dispatch another request. The existing formation illustration is used for an agent's first image; an existing selected image stays visible during replacement. Stages report queueing, image generation, optional background removal and portrait preparation, with elapsed time rather than an invented percentage.

Agent images must be generated; user image upload is not supported. Generated artwork becomes a candidate. Select adopts it into the draft and opens head/portrait confirmation; Discard retires it. Completion never updates a saved agent by itself. A changed brief is shown before selection. Saving an existing agent during replacement submits only the currently selected artwork and preserves the remaining draft/job. Retry reuses a successful image when removal or portrait preparation failed. Unknown paid outcomes retain their fence and require reconciliation.

Generated drafts use private, content-addressed image objects and owner associations. `/api/agent-profiles/images/:hash` authorizes the owner until publication. Acceptance grants public access to the exact submitted bytes. Historical public images and originals retain their existing access; no historical image is regenerated or made private by this change.

## Submission and moderation

`creationRequestId` is a stable UUID bound to the normalized creation payload, including voice and game/season destination. Equivalent response-loss retries return the original result; reuse with different input conflicts. Updates use `submissionId` plus `expectedContentRevisionId`, which matches the owner's `latestContentRevisionId`. Analytical revision checks remain available for strategy reviews. Immutable receipts remain historical even after the submission is accepted.

Save atomically records a whole content snapshot, its asset hashes, model/voice settings, screening outbox, retry receipt and optional entry destination. It closes into **Reviewing**. A complete clear assessment under `house-agent-enforced-v2` may publish automatically; refusal, incomplete assessment, flagged safety, human intervention or publication conflict holds the revision for moderation. See [screening](agent-shadow-screening.md).

`latestContentRevisionId` identifies the submitted draft; `contentRevisionId` identifies the accepted public version. While an edit is reviewing or held, the last accepted version stays public and usable. A new agent cannot enter a game or appear publicly until accepted. Legacy usable profiles acquire an exact accepted baseline on their first edit; historical assets and ancestry are never invented.

Publication locks affected waiting games, the profile and the review, rechecks the latest submission and human restrictions, then commits the accepted content, voice, applicable competitive revision, avatar audit and waiting-seat updates. Frozen games and championship builds retain their pinned state. Failure rolls back publication and retains the submitted draft. Completed assessments can be reconciled after restart without another provider call.

Unchanged submissions deduplicate. A model/voice-only change on already accepted content creates an immutable metadata revision reusing that safety decision; it does not rescreen identical character content. Model changes made alongside content changes publish with that revision. REST and MCP use this same path. Owner-learning applications remain submitted until acceptance, then resolve and record the actual publication receipt.

Screened revisions and explicit human work remain reviewable even after another submission. Legacy unscreened cleanup retains its previous migration semantics and closes only the old unreviewed intake work covered by that policy.

## Owner surfaces and entry

Dashboard management shows full-body cards, actual activity, Needs attention and resumable account drafts. Edit stays first; View opens the owner profile. Review is a separate artwork decision. Search/filter and the originating card are carried back from editing. Reading collection/status routes never starts generation.

The owner profile distinguishes accepted content from a reviewing/held submission. Model and voice share one draft/review/save path. Voice auditions read versioned cached samples; playing or selecting never generates speech or saves the agent. Only one sample plays at once; selection, dismissal, mode changes and unmount stop playback.

A game/season target is committed with the submission. After acceptance, Continue rechecks ordinary admission and eligibility; it does not reserve a seat or bypass a closed/full game. A lost save response cannot lose this target or create another agent.

## Errors and support

The [error matrix](agent-workspace-errors.md) maps each step to Retry, Reload, Discard or support. The workspace shows one short notice with Discord/Email links. Missing or uncertain image receipts disable request retry; Discard retires the draft and artwork job without deleting the accepted profile or provider evidence.

## Storage and rollout

Large draft, job, screening and provider documents use private object storage references; PostgreSQL owns authority, hashes, versions and leases. See the [deployment checklist](deployment/agent-workspace.md). Deploy API, workers and web together. No feature flag or shadow-mode switch is used.
