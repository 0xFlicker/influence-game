---
title: Agent creation, editing, and management redesign
date: 2026-11-06
status: implemented-local-verification
type: ux-and-implementation-plan
---

# Agent creation, editing, and management redesign

## November 7 implementation refinement

The final user review supersedes the upload and initial shell placements below: agent images must be generated, with no user upload control or endpoint. Preserve the existing Guided hall and compact above-the-fold staging. Guided and Advanced share one character stage, draft and conversation; an empty Guided creator spans the width. Model/voice sit beside the input activity, below the composer or fields. Close is in the header, Cancel/Review are grouped. Review requires actual changes and valid required fields, shows real differences in a dialog, and closes when all changes are undone. Test all four create/edit mode combinations with mocked/provider-free browser journeys after resolving the layout.


Replace the disconnected creator, advanced form, and floating Workshop with one character workspace. **Guided and Advanced are two views of the same draft.** The character has a prominent full-body stage; preferred game model and voice have a permanent, shared home; every proposed change can be inspected before saving. Long operations keep their own state and never make unrelated work look busy.

The user approved implementation on November 6. The shared workspace, owner management/profile, versioned drafts, cached voice auditions, durable artwork jobs, private draft media, enforced publication and image-provider migration are implemented in this checkout. The decisions and original investigation below retain the design rationale. Current behavior and rollout are documented in [the submission contract](../agent-content-submissions.md) and [deployment checklist](../deployment/agent-workspace.md). Local evidence is recorded separately from staging/production verification.

## Direction established in the refinement

- Preserve the successful Guided conversation, character ingredients, section readers, and approval beats. Improve its shared workspace and transitions into Advanced.
- Bring management, creation, and editing into the dashboard/Seasons visual language: warm hall photography, Georgia headings, brass rules, readable neutral surfaces, and full-body character staging.
- Reuse existing verified cutouts. The user believes the historical full-body backfill is complete; check for remaining missing/failed assets instead of planning another bulk backfill. Use the existing background-removal pipeline when Grok fallback requires it. Native-alpha artwork normally skips that stage.
- Plan the GPT Image 2.6 migration across **all new image operations in Visual Mode**, not just the profile editor. Existing accepted images and historical games remain immutable.
- **Keep medium quality.** The user's latest correction explicitly chooses the existing quality tier as sufficient. There is no planned upgrade to high. Flare/Sunburst routing is independent of quality.
- Explore routing new compositions to Flare and targeted edits to Sunburst through a validated assistant command. “Flash” in the discussion refers to the documented Flare model.
- Remove invented headlines, draft taglines, decorative eyebrows and redundant reassurance. A draft uses its actual saved name, or **Untitled agent**, and an actual operational status.
- Keep **Edit** first and **View** second on every saved-agent entry. View opens the profile; Edit opens the workspace. A separate **Review** action opens the pending decision. Do not swap positions or give two labels to the same destination.
- Move shadow screening into enforcement: save a submission, close the editor, show **Reviewing**, then **Accepted** or **Held for moderation**. The user explicitly confirmed that the last accepted version stays public and usable during review/hold; new agents wait for acceptance.

The user approved these decisions and the implementation uses deployment as its gate; no production deployment is included.

## Findings in the current checkout

| Reported issue                                   | Owning code and finding                                                                                                                                                                                                                             | Required result                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Strategy edits appear to regenerate the portrait | `agent-form.tsx` defines `generationBusy` as profile text work, reference work, or pending portrait work. The advanced portrait is replaced with “Creating character…” for any of them. The text-only edit path explicitly avoids image generation. | Keep the selected image visible. Text work reports the affected field; only an actual image operation shows image-generation status. |
| Model and voice feel unrelated                   | Model preference lives in the draft; `AgentVoicePicker` has an independent GET/PUT lifecycle and “Save voice” button.                                                                                                                               | One placement, one draft, one review, one final commit.                                                                              |
| Basic creation cannot choose a model             | `agent-create-content.tsx` always passes `publicPreview`; `agent-form.tsx` hides the model picker whenever that prop is set, including signed-in creation.                                                                                          | Show eligible model choices in Guided and Advanced, including creation. Keep current server entitlement rules.                       |
| Creation has no voice picker                     | Voice selection requires an existing agent ID and is outside `EditorSnapshot`.                                                                                                                                                                      | Add a draft voice choice and include it in create, recovery, diff, validation, and update.                                           |
| No voice audition                                | Current picker is a native select with no playback or sample URL. The October voice plan already specifies cached shared samples.                                                                                                                   | Complete the audition feature using the current stock voice catalog.                                                                 |
| Changes are hard to inspect                      | Ordinary edits do not enable `showLiveChanges`; that diff is reserved for review-linked strategy proposals. AI updates apply directly to draft fields and say to review above.                                                                      | Display an actual field-level change set for every save and an inspectable proposal for every AI change.                             |
| No return to Guided from edit                    | Creation wires `onAdvanced` and `onAssistant`; `agent-edit-content.tsx` wires neither.                                                                                                                                                              | Both modes available for existing and new agents, preserving every draft field and in-flight operation.                              |
| Full-body art is secondary                       | Advanced begins with a small circular portrait; body art is at the end of the long form.                                                                                                                                                            | Body art becomes the persistent visual anchor. Portrait framing becomes a focused action.                                            |
| Image generation and backgrounds                 | `visual-image-provider.ts` uses OpenAI `gpt-image-2`, medium quality, with xAI on selected availability failures. Both full-body generators explicitly request warm grey backgrounds. There is no `background: transparent` request.                | Move new image operations to 2.6 at medium; transparent character assets, opaque rooms/scenes; qualify both routes.                  |
| Old management page                              | `agents-content.tsx` and `agent-list.tsx` use small portraits and purple panels. The list supports image status props, but its current parent supplies none. “Delete” buttons open an archive operation.                                            | Full-body gallery, truthful readiness/activity, resumable drafts, contextual next actions, consistent Archive wording.               |

These findings are from source inspection, not a reproduction against deployed production. Relevant files are under `packages/web/src/app/dashboard/agents/`, plus `packages/web/src/components/model-preference-picker.tsx`, `packages/api/src/services/visual-image-provider.ts`, `visual-profile-generation.ts`, and `agent-visual-update-generation.ts`.

## Approved product decisions

1. **One workspace, two reversible modes.** New character creation and a request submitted from an agent profile open Guided. A direct Edit action opens Advanced. Both have the same conspicuous mode switch. “Basic” becomes “Guided”; it is equally capable, with less form exposure.
2. **Remove the permanent assistant dock from Advanced.** Each substantial text field offers “Refine with AI,” opening Guided with that field explicitly selected. Appearance generation remains an explicit action in Appearance. The normal Advanced footer contains draft status and review/save actions.
3. **Voice joins the profile draft.** Selecting or auditioning a voice never writes the saved agent immediately. Voice and model are reviewed and saved with the rest of the changes. Existing recordings retain their frozen voices.
4. **Draft saving and selected-image publication are separate.** An existing agent can **Save** with a notice that the current artwork is being submitted while a replacement continues as an unselected candidate. The replacement is never adopted by that save. A new agent can remain an incomplete draft, with completion/entry requirements shown separately. Do not invent a blanket ban on saving an incomplete profile. Rebase remaining changes after a save and compare the image request's frozen identity/appearance inputs before later adoption.
5. **Authenticated drafts survive leaving the page.** Extend durable draft/recovery support rather than promising background completion from tab storage alone. Anonymous preview keeps its existing limited scope until account creation.
6. **Native transparent character artwork, with an explicit Grok-plus-cutout fallback.** The user approved native alpha as the primary path and the existing background-removal pipeline for fallback needs. Qualify the exact API models, reuse completed derivatives, and keep image-service routing separate from the user's preferred contestant model.

The user's request establishes the need for model/voice controls, voice auditions, visible changes, prominent body art, better asynchronous feedback, and a calmer design. The first five choices specify proposed behavior; the sixth records the approved art direction and its implementation constraints.

## Visual direction

Use an editorial character workspace: quiet charcoal or warm paper surfaces, strong typography, thin dividers, restrained brass accents, and room for the artwork. Avoid nested tinted cards, a purple panel around every textarea, shimmer over an existing image, and decorative progress percentages.

On large displays, use approximately 1,240–1,440 px of available width. A 32–38% art column sits beside a generous editor. Keep the reading width of long prose comfortable rather than stretching every line. The art column shows the entire body and feet with `object-fit: contain`. A portrait thumbnail and “Adjust portrait” action explain that the avatar derives from this image. Images with backgrounds sit in a deliberate rectangular frame; verified transparent art sits directly on a neutral stage. Never pretend an opaque source is a cutout.

The editing column starts with **How they play & sound**: adjacent preferred-model and voice controls. Below that, Advanced has **Character**, **Strategy**, and **Appearance** sections. On mobile, use one page scroll, a bounded full-body preview, preferences, then the active section. Do not create several independently scrolling panes or squeeze full-body art into a huge empty mobile hero. At 320 px the controls stack. The action bar must remain reachable without hiding fields or errors behind the keyboard.

Guided uses the same shell and preferences, retaining the current House conversation, ingredient/fixture fields, expandable section readers, and character approval step. Use **Continue** for the approval action. Retain all current fields; the concept's four visible fixtures illustrate the layout, not a reduced schema. Earlier conversation can be expanded when useful. Advanced has no global composer; its field actions retain access to assistance.

Use the existing dashboard.module.css and seasons.module.css language deliberately: hall masthead, cream/brass primary action, Georgia title, understated separators. Keep the creator's hall/stage identity without recreating a purple card around every section. The transparent sample is a visible part of the refinement; opaque images get an honest frame.

### Copy must have an identifiable source

The previous concept's “A magician with something to hide,” “A good read. A better bluff,” section nicknames, and assistant reply were hardcoded sample copy. They were not an AI summary of a real draft. Remove those embellishments rather than adding another summarization request to justify them.

| Content                      | Source                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Page/field names and actions | Concise fixed interface labels: Agents, Drafts, Personality, Edit, View, Review, Save, Create, Continue                  |
| Draft title                  | Saved name; Untitled agent when blank. No invented tagline or separate AI-generated draft title                          |
| Character/strategy text      | Exact draft fields, expanded or excerpted without rewriting their meaning; updates reflect the same fields in both modes |
| Assistant response           | An actual retained assistant response/proposal; do not insert static prose styled as an AI answer                        |
| Status, time, changes        | Durable operation/publication state, saved timestamps, and computed field differences                                    |
| Moderation explanation       | Authorized owner-facing outcome and reason; no raw provider evidence or accusations inferred from a status               |

Remove “Changes stay in your draft,” “Your cast,” “In the making,” and other decorative/redundant copy. Retain short explanations only where they change a decision: model preference is best effort, current artwork stays selected, or a submitted revision is held. Use one-word action labels where the surrounding context supplies the object; accessible names can include the agent name. Model/voice option names and field labels are values, not action phrases.

## Agent management from the dashboard

Keep the existing **Dashboard → Your agents → Manage agents** link at /dashboard/agents. The dashboard remains a compact bench; management is the full collection. Create still routes to /agents/create; Edit opens the shared workspace on that agent in Advanced. Profile prompts and Continue creating open Guided. Preserve the originating game/season destination through draft recovery and back navigation.

### Collection hierarchy

1. A restrained hall masthead: **Your agents**, one **Create** action.
2. A responsive full-body gallery: three columns on desktop, two on tablet, one on narrow phones. Use a consistent contained stage so feet and heads remain visible across different proportions. Character names wrap, and essential controls never depend on hover.
3. Each entry shows name, archetype, model, voice, selected-profile readiness, and any outstanding artwork/review activity. Keep game statistics in Analyze; do not collapse Influence-only wins/losses into a misleading cross-game score.
4. A **Drafts** section holds incomplete creation drafts by their actual names. They are not counted as saved agents or offered as game-ready contestants.
5. Preserve **Needs attention** as a compact actionable section and collection filter. Include artwork awaiting selection, held submissions, failures, missing required art and conflicts. Healthy image generation or automatic Reviewing remains activity, not an error or an owner task.

| Situation                                   | Fixed actions / extra contextual action   | Supporting message                                                     |
| ------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Saved accepted agent                        | Edit, View                                | Accepted; model and voice                                              |
| Replacement running, current profile usable | Edit, View                                | Generating image; accepted version available                           |
| Candidate ready                             | Edit, View; Review in Needs attention     | Artwork ready; profile unchanged until accepted submission             |
| Missing required entry artwork              | Edit, View                                | Name the missing item                                                  |
| Preparation failed                          | Edit, View; Retry on the failed operation | Identify the failed step; preserve successful work                     |
| Creation draft                              | Continue                                  | Actual saved stage and time                                            |
| Reviewing submission                        | Edit, View                                | Reviewing; accepted version stays available, if one exists             |
| Held submission                             | Edit, View                                | Held for moderation; distinguish pending content from accepted version |

**Edit** always opens the shared editable draft in the first action slot. **View** always opens the profile in the second slot: the accepted public version when available, or an owner-only submitted preview for a new agent without an accepted version. It never aliases Edit. The owner may see private submission status above the public profile; other visitors cannot. **Review** is reserved for a decision the owner can actually make, such as selecting artwork. A held moderation submission does not give the owner an approve action.

Keep Edit available during generation because unrelated text, model and voice fields can change. Lock only a conflicting image dispatch/selection and show its reason. If an actual permission/transaction state prevents all editing, disable Edit in the same slot with an accessible explanation; never swap it for View or hide it.

“Ready to enter” only reports profile requirements. It does not guarantee a seat, eligibility for a particular season, provider availability, or the requested contestant model. A replacement job never makes a usable saved profile unready. Readiness, publication, and artwork activity are separate dimensions.

Secondary menu actions: **Analyze**, **Archive**. View is the stable second action, not a duplicate menu link. Use Archive consistently in trigger, dialog and confirmation. Preserve game history and explain removal from the owner's collection; do not promise self-service restore while only an admin restore path exists. Prevent duplicate archive submits and surface conflicts or failures without removing the row prematurely.

### Management data and recovery

Extend the owner's collection read model to return authorized selected artwork, resolved model/voice display, draft summary, publication state, and durable operation summary. Avoid a request-per-agent chain and do not enqueue provider work when opening the page. Reuse the same job identity and recovery owner as the editor; list status reads must not become an accidental second dispatcher.

Keep loaded entries during refresh failures with an inline Retry. Specify empty collection, no search results, missing/failed images, archived entries, moderation states, slow reads, and stale multi-tab updates. A broken thumbnail is not a failed image generation. Return from editing preserves the collection search/filter and scroll location. A recovery action resumes the known authorized operation rather than creating a new paid request.

## New character journey

| Step           | What the person does                                                                                | What the product shows and preserves                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enter          | Arrives from Create, signup, game join, or Daily Free.                                              | One route with preserved destination. The first screen asks for an idea; a returning draft offers Resume or Start new.                                                                           |
| Imagine        | Describes a character or chooses a few ingredients.                                                 | Keep the existing one-message anonymous preview and account handoff; do not move the signup gate in this redesign.                                                                               |
| Shape          | Reads the character, personality, and separate game strategies. Edits directly or asks for changes. | A readable summary with expandable full text. Models and voices are already visible, with safe defaults, so choosing them is optional rather than another mandatory wizard.                      |
| Choose a look  | Reviews/edits the visual brief, then chooses Generate or Upload.                                    | Explicit generation action and current allowance/cost treatment. Do not generate an expensive replacement because unrelated text changed. Preserve the character's identity and reference image. |
| Wait usefully  | Chooses model and voice, listens to samples, or edits fields unrelated to the artwork request.      | Actual stage and elapsed time. Draft saving is independent of provider work. No fabricated completion percentage or guaranteed ETA.                                                              |
| Frame          | Reviews the full body and proposed portrait/head bounds.                                            | **Select** accepts the candidate and suggested crop; **Portrait** opens precise framing. Low-confidence head localization requires correction rather than a guessed face.                        |
| Review         | Sees the final identity, two strategies, appearance, model, and voice.                              | Required-field errors link to their fields. Default or unspecified choices are explicit. A completed draft is not yet a saved agent.                                                             |
| Create         | Chooses Create with the destination visible nearby.                                                 | One idempotent submission. Close into Reviewing after the durable receipt.                                                                                                                       |
| Review outcome | Can leave the page; later sees Accepted or Held for moderation.                                     | Accepted new agents become usable. Held agents remain owner-visible and link to their status.                                                                                                    |
| Enter          | Resumes an explicitly authorized game/season handoff after acceptance.                              | Recheck current admission. If joining fails, retain the accepted agent and retry only entry. Never reserve or promise a seat while review is pending.                                            |

The mode switch is not a reset, approval, save, generation trigger, or new paid request. Model preference is best effort under the game's routing policy; selecting a text-only contestant model must remain legal, including Visual Mode.

## Existing agent journey

**Direct edit:** open Advanced with the saved/submitted baseline, current full body, and current model and voice. Manual typing changes only the working draft. A compact count (“3 changes”) opens the review. Cancel offers to keep a draft or discard it only when there is something to lose.

**Profile request:** submitting “make her more skeptical in Werewolf” opens Guided on that same agent with the request visible. Resolve an existing draft before executing the handoff, as today. The assistant proposes a typed patch limited to the requested fields. Show “Werewolf strategy changed” with actual before/after text; do not claim the art changed. Accepting a proposal updates the working draft, not the saved profile.

**Refine a field:** a scoped action names the field before calling the assistant. The result has Keep, Edit, and Discard actions. AI-authored summaries may explain intent, but the displayed diff is computed from values, not model claims. A multi-field request shows every affected field. Do not infer a change set from prose.

**Change the look:** explicit Generate or Upload creates a candidate beside the selected art. Keep the selected image visible throughout. After generation, review the candidate and crop; selecting it changes the draft. Cancel/retry/failure never quietly changes selected artwork. Text may continue independently, but editing identity/appearance inputs while their frozen image request is running marks the result as based on the earlier brief. Require explicit adoption, never overwrite newer choices.

**Save:** use one review that groups changes under Character, Game strategy, Appearance, Model, and Voice. Text shows word-level additions/deletions with full text available; images show old/new thumbnails and crop changes. Each change can be undone. The action is **Save** or **Create**; change counts, publication effects and any return destination appear in surrounding status, not a sentence in the button. On a durable submission receipt, close the editor and show Reviewing on management/dashboard activity. Saving is not publication.

Review-linked learning proposals retain their existing baseline, staleness, and resolution rules. A generic edit must not accidentally resolve a strategy review. A stale tab gets a real comparison and conflict resolution, not a forced overwrite.

## Enforced post-save review

### Confirmed current behavior

The current implementation is genuinely shadow-only, not an enforcement setting waiting to be toggled. docs/agent-shadow-screening.md states that Phase 2 is not implemented. agent-screening-worker.ts already has durable claims, leases/heartbeats, strict assessments, retained request/response evidence, restart recovery and bounded attempts, but only records a recommendation. agent-screening-read.ts exposes mode=shadow.

agent-content-submissions.ts currently advances contentRevisionId immediately for ordinary saves and records publication=published. Agent moderation reviews default to disposition=allowed before a screening result exists. agent-profile-management.ts also updates active character/rating state and waiting seats before screening finishes. The shared eligibility helper permits a profile without contentRevisionId when moderationRequired is false. These paths must change together; a new owner badge alone would be misleading.

Retain the existing immutable content snapshots, artifact hashes, worker, human moderation queue, permissions, versioned decisions and audit. Change publication authority at the owning transaction, with a new policy version and explicit pending/accepted/held state; do not treat legacy default allowed as evidence of an automated or human acceptance.

### User-approved public behavior

1. **Save/Create** durably records the submitted revision and queues screening. Return success as **Reviewing** and let the editor close. Failures before persistence keep the editor and user input intact.
2. **Reviewing** is queued/running screening of that exact submission. It appears on management and the dashboard's agent/activity surfaces, and survives page closure/reload. Do not use the image animation for it.
3. **Accepted** means the server has applied the versioned acceptance policy and committed publication. Select the whole approved revision atomically, then refresh dependent live profile/entry state. Reconcile only waiting enrollment state under its established authority; running/frozen games remain unchanged.
4. **Held for moderation** means the submission has been placed in the existing authorized moderation queue. The owner can inspect its status and edit a correction. A hold is not a finding of misconduct or a final rejection. Human accept/reject/restore keeps its current permissions, claims, preview/version fences and audit.
5. **An existing agent retains its last accepted public/usable version while a newer submission is Reviewing or Held.** This is explicitly confirmed by the user. The editor loads the submitted draft with a clear baseline; View shows the accepted profile. A new agent with no accepted version remains owner-visible and cannot be publicly selected or entered into a game.

The user will arrange Dot's daily review separately. No scheduling, messaging, claimed SLA, or automated moderation decision is authorized by that statement. The existing read_moderation/decision tools remain the operator path; add owner-safe status parity to API/MCP without exposing private raw assessments.

### Acceptance and failure policy

Map validated complete assessments to explicit server policy: a full no_concern result with all required stages and no unresolved blocking safety/refusal/human restriction can be automatically accepted; review or inconclusive results go to Held for moderation. A refusal always holds the revision, including when the separate text-only collusion assessment finds no concern. No score threshold or model-written prose grants publication authority.

Transient retryable failures remain Reviewing while the bounded worker policy is actually retrying. Incomplete/exhausted/uncertain screening goes to Held for moderation with an owner-safe explanation that automatic review could not finish. Never label a provider/storage failure as a content violation, accept it as clearance, or leave a stopped job spinning forever. Human review remains available without repeating an uncertain paid call.

Outcomes are bound to the immutable content revision and policy. A late result cannot overwrite a newer selected/submitted revision, revoke an unrelated accepted revision, reverse a human decision, or approve inherited rejected content implicitly. Preserve the whole-snapshot ancestry/hold selection rules and explicit human overrides. Corrections create a new submission and screening identity; keep prior evidence readable.

Model/voice are part of one draft and one save receipt. A metadata-only save that does not change screened content should reuse that content's valid decision rather than manufacture another paid screening. For a mixed content/preferences submission, keep the selected configuration coherent until the content revision is accepted. Preserve entitlement checks and frozen voices in existing recordings.

### Enforcement cutover and entry handoff

Use deployment as the gate. Do not add a shadow/enforced feature flag or claim this design turns production enforcement on.

Change all create/edit sources together: web, API/MCP, profile prompt handoff, visual completion, learning proposals, generated artwork replacement, and operator submission paths. Public reads, cached cards, agent pickers, Daily Free, game enrollment and season qualification must all read accepted authority. New null-accepted profiles cannot slip through the old eligibility predicate. Audit early public image upload/publication so an unaccepted image cannot bypass the intended owner/public boundary through an asset URL.

Creating for a game now saves a submission first. Preserve the destination and explicitly authorized entry intent durably; after acceptance, recheck admission rather than promising or reserving a seat during review. If a game fills or ends, keep the accepted agent and show the entry failure separately. A hold pauses entry, not the saved draft. Waiting-seat reconciliation, ratings and learning-review applied status occur only after publication and under their existing revision fences.

## Editable information

| Section            | Fields and actions                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared preferences | Preferred contestant model; stock voice; cached audition; reset to automatic/default; actual default resolved from durable identity when available |
| Character          | Name, gender, archetype, personality, backstory; scoped AI assistance; fill missing fields without changing populated fields                       |
| Strategy           | Separate Influence and Werewolf instructions; visible defaults when blank; explicit customize/reset actions; review-linked comparisons             |
| Appearance         | Visual design, performance instructions, full-body generation, selected candidate, source-bound portrait crop and head confirmation         |
| Review             | Every changed value, image/crop comparison, per-change undo, validation, destination, publication state                                            |

Do not expose raw provider models for character writing/image generation as if they were contestant preferences. Do not add sliders for invented personality scores or controls with no runtime effect. Preserve each field's current validation and semantics.

## Model and voice selection

Reuse the existing model combobox pattern. Offer only the account's eligible catalog entries, retain “Let the House decide,” and explain the best-effort routing policy in a short helper. Do not present unmeasured model personality claims or confuse API unit prices with a customer's game price.

Voice uses a searchable audition picker with two separate actions per row: play/stop the sample and select the voice. Keyboard and screen-reader behavior must preserve that separation. Only one sample plays at a time. Selecting, switching mode, closing the picker, and leaving the page stop playback. Voice names and audition are sufficient for launch; add tone/accent descriptions only after listening and validating them, not by guessing from provider names or gender labels.

Record one short common script for each eligible player voice, using the same audio recipe as gameplay, and cache versioned samples in object storage. Opening the picker, playing a sample, and selecting a voice consume no new generation request. Show loading, playback failure, retry, and a transcript. Never autoplay. Reserve Helios for the House. Character-specific test lines are a possible later feature, not required for the first complete redesign.

Creation needs a stable draft identity if “Automatic” previews a specific voice: freeze that choice into the creation receipt or show the assignment only after an explicit selection. It must not play one default and silently save another. Voice remains a stock xAI selection in this proposal; using OpenAI image credits does not imply replacing the audio provider.

## Asynchronous state contract

Keep independent state for draft persistence, AI proposal, artwork, head/crop confirmation, publication, and entry handoff. A single global busy flag cannot represent them truthfully.

### Reuse confirmed in the current Guided implementation

The source contains reusable activity presentation. Reuse it rather than inventing another loading illustration:

| Existing element              | Source                                     | Refined use                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CharacterFormation            | character-formation.tsx and its CSS module | First image only, where there is no selected artwork. Preserve its silhouette/orbit/scan motif and reduced-motion treatment. Adapt palette tokens to the House shell.       |
| Typing dots                   | agent-creation-chat.tsx                    | Assistant text work, adjacent to the current response. Keep role/status labeling. Do not animate the character stage.                                                       |
| Busy send button              | agent-creation-chat.tsx                    | A request the composer actually owns; preserve aria-busy and duplicate-send protection.                                                                                     |
| Stage-specific studio chatter | agent-ai-editor.tsx                        | Optional quiet flavor under a factual status label. Reuse sensible copy, remove claims about simulations or backgrounds that did not occur. It is never progress telemetry. |

CharacterFormation takes only a name; it does not provide provider progress, elapsed time, job persistence, or stage recovery. Its source comment explicitly describes indeterminate formation. The refinement concept renders that existing illustration rather than a replacement motif.

The current Guided component derives working from pending OR busy, and locks the composer, mode switch, and draft save broadly. Reusing its visuals does **not** mean reusing that global lock. Narrow locking to conflicting operations. Model/voice controls, unrelated fields, mode switching, and safe draft persistence remain available during artwork generation. Preserve its request-text recovery on failure.

For existing art, show a compact activity area below the selected full body: **Brief saved → Creating image → Preparing portrait → Ready to review**. Insert **Removing background** when that real stage is required; native-alpha output skips it. Highlight only confirmed checkpoints. Show elapsed time from the durable start timestamp, without claiming provider percent or time remaining. A long elapsed time alone does not prove a failed request. Announce stage changes politely, not each second or animation frame.

If status checking fails, preserve selected art and the last known stage, show “Progress unavailable,” and retry the status read. Do not dispatch another image from a refresh or tab restoration. If the body succeeded but portrait preparation failed, retain/show the body and offer manual framing or retry only that step. For first images, replace formation with the actual body as soon as safely persisted; do not keep a silhouette over completed work.

| State                      | Message and allowed action                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposing strategy         | “Updating Werewolf strategy.” Keep art visible. Prevent a second conflicting proposal; unrelated model/voice edits remain available.                                       |
| Queued artwork             | “Artwork queued.” Show the selected source and request brief. Leave/reopen resumes this authorized operation, not a new request.                                           |
| Generating artwork         | “Creating your new look,” elapsed time, actual stage. Keep current art visible. Do not lock unrelated fields.                                                              |
| Removing background        | Image generation succeeded; the existing cutout job is preparing transparency. Keep the selected art visible and retain the generated source.                              |
| Preparing portrait         | “Artwork ready. Preparing the portrait.” Show successful body output immediately; a head-localization failure offers manual framing without regenerating it.               |
| Candidate ready            | “New look ready to review.” Never auto-publish or silently replace the selected image.                                                                                     |
| Status unavailable         | “We cannot check progress right now.” Preserve the last known stage and operation ID; refresh status instead of dispatching generation.                                    |
| Failed                     | Name the failed stage. Retry only that stage under the existing operation identity; keep completed stages and selected art.                                                |
| Uncertain provider outcome | “Checking the previous request.” Reconcile evidence before retrying a chargeable call. No automatic duplicate generation.                                                  |
| Canceled selection         | Explain that the returned result will not be used and an already-dispatched call may still count against allowance. Fence late results.                                    |
| Saving draft               | “Saving draft…” then “Draft saved.” If persistence fails, preserve local work and show “Draft not saved”; do not continue paid work without its required durable evidence. |
| Saving agent               | Prevent duplicate submit; recover a lost response through the existing receipt. Confirm saved/pending-review/rejected accurately.                                          |
| Reviewing submission       | The editor can close. Show queued/running review on management and dashboard; preserve any last accepted version.                                                          |
| Accepted submission        | Publish the exact accepted revision and reconcile permitted future/waiting use. Existing frozen games remain unchanged.                                                    |
| Held for moderation        | Surface in Needs attention and the authorized moderation queue. Give an owner-safe reason; keep the prior accepted version usable.                                         |
| Entry failed after save    | “Agent saved; joining did not complete.” Retry entry, not profile creation. Never promise a seat while images are running.                                                 |

The existing saved-agent visual-update service has durable stage checkpoints and lease recovery, but currently resumes abandoned work on status reads; it is not proof of an autonomous background scheduler. Before saying “You can leave; we will finish,” supply a durable worker/dispatcher path. Reuse existing journal, object storage, lease fences, recovery, and publication services rather than creating a parallel job framework. If that path is not ready, use the truthful message “Your draft is saved. Return here to resume preparation.”

## OpenAI image findings and recommendation

The current source uses the OpenAI Images API with `gpt-image-2`; it does not call ChatGPT's UI. Both character body prompts request an opaque grey backdrop. The common image adapter also pads unexpected dimensions with `#161616`, which must not introduce opaque borders into native-alpha output.

OpenAI's [August 20 changelog](https://developers.openai.com/api/docs/changelog) documents transparency preview for `gpt-image-2`: set `background: "transparent"` and output PNG or WebP. Its current [GPT Image 2.6 guide](https://developers.openai.com/api/docs/guides/image-prompting) documents Flare for faster iteration and Sunburst for more detailed or precise work; both support transparency. Account access and actual performance still require a real request.

Recommended comparison: current GPT Image 2 versus GPT Image 2.6 Flare and Sunburst at 1024×1536, explicit medium quality, native transparency. Include fresh human, anthropomorphic/nonhuman, and difficult-edge characters; include one clothing edit preserving identity. Keep prompts and references identical within each comparison. Record model, request settings, sanitized provider evidence, latency, usage, output bytes, actual alpha statistics, head-crop result, and assessed failures. A single attractive example is not an onboarding-quality benchmark.

The proposed default is **medium quality for both Flare and Sunburst**, following the user's correction. Compare Flare on new compositions and Sunburst on targeted edits, then verify fidelity and actual cost per accepted image including retries. This is not a production switch or a claim of measured speed. Monthly credits do not eliminate latency, failure, or post-credit unit economics.

### Intent routing: new composition versus edit

The assistant already returns separate generate_appearance and revise_appearance commands in agent-creation-chat.tsx. Both currently call the same appearance callback and lose that distinction. The image adapter chooses its HTTP endpoint from reference count. These are separate concerns: an image can be a **new composition with references**.

Carry an exact provider-native structured command through the owner into a validated image request: operation (create/edit), purpose, target source identity/hash when editing, reference identities and roles, and requested change. The assistant selects the semantic operation; the server validates ownership, allowed purpose, target existence, limits, and source identity, then selects the model deterministically. Do not let model prose or a user-supplied model ID become routing authority.

| Operation                                              | Proposed model, medium | Examples                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a new composition                               | GPT Image 2.6 Flare    | First character without an identity target, a new empty room, a newly staged scene using frozen cast and room references                                        |
| Edit an existing target / preserve a specific identity | GPT Image 2.6 Sunburst | Change jacket while keeping the face, extend a portrait into the same character's body, wolf transformation, repair a specific scene, harmonize accepted panels |
| Deterministic image processing                         | No image-model request | Crop portrait, resize, encode, split an accepted scene into views                                                                                               |
| Text-only profile patch                                | No image-model request | Strategy, personality, model or voice change without an appearance operation                                                                                    |

An existing agent can request an entirely new concept; it is still a create operation. Revising an existing generated character is an edit. A scene composed from room/cast references is new composition; repairing a specific accepted scene is edit. Endpoint mechanics follow API requirements independently of semantic model choice.

Use the current assistant's clarification command when scope is ambiguous. Preserve an explicit “New look” versus “Edit selected look” action for direct Advanced requests, so routine button actions require no extra classifier call. A second instruction cannot silently retarget a dispatched request.

Freeze operation, model, quality, background, dimensions, prompt, target hash and reference hashes before dispatch and include them in durable request/evidence hashes. Recovery replays the accepted request. In particular, championship recovery currently reconstructs only prompt/width/height/references; it must preserve the full request contract. Drain/reconcile in-flight paid operations before the policy cutover rather than silently re-routing them under a new default. Never retry an uncertain dispatch as a fresh request on the other model.

### Scope: every Visual Mode image path

Use the existing common adapter and durable journal; do not add a parallel image service.

| Owner                                             | New default behavior                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visual-profile-generation.ts                      | Medium; first body creates use Flare, identity-preserving reference transformations use Sunburst; native alpha; source-bound head crop                          |
| agent-visual-update-generation.ts                 | Medium; carry create/edit command; native-alpha selected candidate; preserve current source through failure                                                     |
| visual-game-assets.ts                             | Missing frozen body references follow the same identity rules; room-library backgrounds use Flare and remain opaque                                             |
| visual-character-variants.ts                      | Sunburst medium for exact-source wolf transformations; native alpha; preserve private game-scoped storage/access                                                |
| visual-scene-renderer.ts                          | Flare medium for new room panoramas and staged sections; Sunburst medium for harmonization and target-preserving repairs; scenes remain opaque                  |
| championship-artwork.ts                           | Both missing body and separately generated portrait paths use the policy; identity references route to Sunburst; preserve immutable accepted competition builds |
| visual-render-journal.ts and admin/repair callers | Same immutable request settings, usage pricing, receipts, authorized retries and publication fences; no bypass during resume/recovery                           |

Retain current dimensions and participant verification, including wide panoramas and isolated panels. “All Visual Mode” changes image generation, not contestant reasoning models, planning/localization models, or TTS. Reuse valid cached rooms and accepted artwork; a model migration does not require regenerating existing binaries. New explicit regenerations use the new policy, while historical accepted assets and hashes remain intact.

Character bodies and variants need verified transparency at the end of preparation. OpenAI requests native alpha; a Grok fallback may return an opaque source and then use our existing background removal. Rooms, panoramas, and composed scenes retain a background. Reuse the source-hash cutout lookup for completed derivatives and native-alpha sources. Private wolf forms stay private. The complete preparation pipeline must fulfill the alpha requirement; each generation provider does not need to produce alpha itself.

### Existing art and Grok fallback

The user's expected starting state is that old full-body images have already been backfilled. This planning pass inspected the reuse/inventory code, not live environment completeness. Before rollout, inspect current source hashes, ready derivatives, completed storage/associations, and any missing, failed or unfinished work. Existing code already reuses ready cutouts by source hash and recipe without rerunning removal. A missing association or a failed final upload can need completion even when inference succeeded.

- **Existing verified cutout:** reuse it directly. Preserve the opaque original and source-bound derivative; no repeat generation or removal.
- **New OpenAI native-alpha output:** validate the actual pixels and publish through the existing artwork lookup, subject to the submitted revision's access/moderation state. Skip background removal.
- **Grok fallback:** under the existing authorized provider-fallback rules, retain the generated source and receipt, then enqueue/reuse its cutout through the existing dispatcher. Validate and durably store the resulting alpha image before the candidate becomes ready.
- **Grok opaque output:** use the same preparation stage. Transparency is a property of the completed asset; do not claim the provider emitted native alpha when removal supplied it.
- **Missing/failed old derivative:** resolve that specific gap with the retained source and existing retry/publication mechanisms. No blanket reprocessing of completed assets or historical regeneration.
- **Removal/storage failure:** keep the generated original, selected profile art, and successful stage receipts. Retry removal or final storage as appropriate; do not generate another image because a later stage failed. Unknown provider outcomes still require reconciliation before a fallback dispatch.

Use our current background-removal implementation. Do not add a second xAI background-removal integration for this redesign. Preserve source dimensions, source-hash identity, crop coordinates, private game-variant access and frozen asset bindings. Native-alpha and Grok-plus-removal paths must produce the same usable artwork contract; receipts and costing must retain which stages actually ran.

### Price comparison

Standard USD rates from [OpenAI pricing](https://developers.openai.com/api/docs/pricing), checked November 6, 2026:

| Model                          | Text input / 1M tokens | Image input / 1M tokens | Image output / 1M tokens | Role in comparison                             |
| ------------------------------ | ---------------------: | ----------------------: | -----------------------: | ---------------------------------------------- |
| GPT Image 2.6 Flare            |                     $5 |                      $8 |                      $30 | Interactive candidate                          |
| GPT Image 2.6 Sunburst         |                     $5 |                      $8 |                      $30 | Fidelity candidate                             |
| GPT Image 2.5 Flare / Sunburst |                     $5 |                      $8 |                      $30 | Previous generation; no price-rate advantage   |
| GPT Image 2                    |                     $5 |                      $8 |                      $30 | Current integration baseline                   |
| GPT Image 1.5                  |                     $5 |                      $8 |                      $32 | Older comparison                               |
| GPT Image 1 Mini               |                     $2 |                   $2.50 |                       $8 | Budget comparison, quality must be established |

Equal token rates do not establish equal cost per picture. The [generation guide](https://developers.openai.com/api/docs/guides/image-generation#calculating-costs) has a model/quality/size calculator. Its live calculator was checked at 1024×1536 with the grouped **GPT Image 2.6 (Sunburst and Flare)** selection: low 664 output tokens/$0.01992; medium 1,132/$0.03396; high 1,372/$0.04116. These are calculator estimates, not billed benchmark results. Record actual per-model usage during the pilot.

| 1024×1536 image output                             |   Medium |     High | 1,000 medium outputs |
| -------------------------------------------------- | -------: | -------: | -------------------: |
| GPT Image 2.6 Flare / Sunburst, current calculator | $0.03396 | $0.04116 |               $33.96 |
| GPT Image 2, guide's historical table              |   $0.041 |   $0.165 |                  $41 |
| GPT Image 1.5, guide's historical table            |   $0.050 |   $0.200 |                  $50 |
| GPT Image 1 Mini, guide's historical table         |   $0.015 |   $0.052 |                  $15 |

These output estimates exclude prompt/reference input, retries, localization, storage, and audio. The calculator makes 2.6 worth testing for both cost and latency; it does not prove the quality setting is visually equivalent to an older model's setting. `gpt-image-1` is retired and is not a candidate.

At the selected medium tier, the calculator estimate is about **$0.034 per 1024×1536 output versus the current $0.041**, approximately 17% less before input and retries. The earlier comparison of 2.6 high to the current cost is contextual only; high is not the selected default.

Official comparison examples, not generated for The House and not a benchmark of our prompts:

- Photorealism: [2.6 Flare](https://developers.openai.com/images/platform/guides/image-prompting/photorealism-gpt-image-2-6-flare.webp), [2.6 Sunburst](https://developers.openai.com/images/platform/guides/image-prompting/photorealism-gpt-image-2-6-sunburst.webp).
- Identity and clothing edit: [2.6 Flare](https://developers.openai.com/images/platform/guides/image-prompting/outfit-gpt-image-2-6-flare.webp), [2.6 Sunburst](https://developers.openai.com/images/platform/guides/image-prompting/outfit-gpt-image-2-6-sunburst.webp).
- Transparent cutout: [2.6 Flare](https://developers.openai.com/images/platform/guides/image-prompting/extract-product-gpt-image-2-6-flare.webp), [2.6 Sunburst](https://developers.openai.com/images/platform/guides/image-prompting/extract-product-gpt-image-2-6-sunburst.webp).

### Native alpha integration

1. Add explicit image operation/purpose/background, model and medium quality to the existing request contract and request hash. Character sources request native alpha; rooms/scenes stay opaque. Cover every generation, variant, repair and championship path listed above.
2. Pass `background` and `output_format` in OpenAI JSON generation and multipart edit requests. Grok uses its supported request contract and the existing removal stage when its output is opaque. Preserve alpha through resize, encoding, upload, and crop. Do not change shared scene padding globally.
3. Validate decoded alpha: an alpha channel alone is insufficient. Require real transparent/background pixels, credible near-opaque subject coverage, unclipped head/feet, and review of hair/glass/fine edges against light and dark backgrounds. Do not require an exact alpha-255 pixel: the approved preview has transparent background and subject values near 252–254. A checkerboard painted into RGB fails.
4. Store source and provider evidence with existing bucket clients; verify hash and length before committing references. Publish verified native-alpha bytes through the existing source-hash art lookup so new native cutouts do not require a second background-removal job. Keep head/crop coordinates tied to the exact source.
5. Reuse the expected historical backfill and preserve its opaque originals and verified derivatives. Check and repair only remaining gaps. For Grok fallback, run the existing background-removal stage and validate its result; an opaque intermediate is valid input but is not yet a completed transparent asset. No historical regeneration or redundant cutout work.
6. Freeze the chosen assets through existing revision and game-source boundaries. Changing an image model or preferred game model must not rewrite accepted game history or existing recordings.
7. Update model pricing and receipts before changing the default model: `visual-pricing.ts` currently recognizes only `gpt-image-2` for image usage. Unknown usage must remain unpriced, not be reported as zero.

## Implementation sequence

Each slice must work end to end before the next. Deployment remains the gate; do not ship disabled decorative controls or introduce feature flags for this work.

1. **State correctness and common draft.** Separate text/image busy indicators. Define shared create/edit draft including voice, baseline and proposed patches. Preserve stable create keys, retry receipts, stale-revision checks, restore behavior, and review ownership. Add durable draft storage with object-backed bodies and indexed operational metadata. Update web/API/MCP contracts together; remove obsolete separate mutation paths once consumers move.
2. **Complete the Advanced vertical slice.** Implement the body-first shell, preferences, all fields, generation/framing, generic review with per-field undo, one coherent save, and recoverable errors. Reuse existing combobox, text diff, image controls, and crop editor where they fit. No floating Workshop remains on this path.
3. **Connect Guided to the same draft.** New creation, existing-agent prompt handoff, field refinement, two-way mode switch, and contextual summaries use that shared state. Preserve anonymous/signup, game join, Daily Free, moderation, and learning-review flows. Remove the superseded guided/Workshop state ownership rather than adding a third editor.
4. **Complete auditions and long jobs.** Ship versioned shared voice samples, accessible playback, durable generation status/recovery, candidate selection, staged retries, and continuation after navigation. Separate draft persistence from final publication, and ensure source conflicts are visible.
5. **Qualify and migrate all image paths.** Evaluate 2.6 Flare/Sunburst at medium, add structured create/edit routing, cover the complete Visual Mode inventory and costing, and prove native-alpha and Grok-plus-removal publication and consumer parity. Reuse completed cutouts and check remaining backfill gaps. Image generation does not expand contestant model eligibility.
6. **Enforce submitted-revision screening.** Separate submission from publication across every write path, add the versioned server acceptance decision, route holds to existing human moderation, and preserve last accepted authority. Update eligibility, waiting seats, ratings, owner learning, private media access, receipts and API/MCP together. Make recovery and concurrency correct before changing public labels.
7. **Refresh management end to end.** Build the gallery against the shared owner read model, resumable drafts/jobs and post-save review. Keep Edit/View positions and distinct destinations, preserve Needs attention, and connect safe owner status/notifications after the editor closes.
8. **Exercise the onboarding funnel before paid traffic.** Run complete local and staging journeys with real allowed dependencies, fix failures, then publish the coordinated web/API change. Production deployment remains a separate authorized action.

Relevant modules to split by responsibility: workspace shell; shared draft state; Guided proposal surface; Advanced field panels; preference/audition controls; artwork operation/candidate/framing surface; change review. These are component boundaries, not a new rendering or workflow framework.

## Acceptance and launch evidence

- Strategy-only manual and assistant edits issue zero image requests; the selected body and portrait remain visible throughout success and failure.
- Guided ↔ Advanced preserves text, selected model/voice, proposal decisions, selected art, crop, operation identity, dirty state, errors, and destination. Opening/restoring/toggling never dispatches a paid operation.
- Every field is reachable and editable. The same underlying draft is submitted from either mode. Review shows the actual changed values, including clearing a field, reverting it, changing defaults, voice-only, model-only, image-only, and crop-only changes.
- Voice audition never changes selection, selection never saves, and final save includes the chosen voice. Race two previews, close while loading, navigate away, simulate playback failure, and verify one player and no autoplay. Check Helios exclusion and automatic voice consistency.
- Persist/reload at each long-operation stage; test completed body plus failed localization, network loss, response loss, timeout, cancellation, late completion, quota exhaustion, storage failure, stale revision, two tabs, and uncertain provider dispatch. Prove no duplicate profiles, charges, or entries.
- New account, signed-out preview → signup, existing account, restored draft, review-linked strategy, profile-request handoff, missing art, moderation hold/rejection, full game, and failed enrollment each have an explicit recoverable outcome.
- Dashboard → Manage → Edit/Continue → Review → return retains the correct draft, operation, source revision, search and destination. Collection reads issue zero paid requests. Archive uses truthful wording and retains history. Test empty/error/attention states and current-ready plus replacement-running simultaneously.
- Edit/View labels, positions and destinations remain stable across generation, candidate-ready, Reviewing and Held states. Review opens an owner decision, not a duplicate editor/profile action. Verify disabled conflicting operations have an accessible explanation.
- Save closes only after durable submission; then reload/navigation observes Reviewing → Accepted/Held from the correct revision. New unaccepted agents cannot enter/publicly appear; an edited agent's last accepted text/art/configuration remains public and usable. Exercise provider refusal, partial screening, exhausted retries, unknown dispatch, worker restart, missing credentials and incomplete evidence without silent acceptance.
- Race two submissions, stale worker completion, human hold/accept/reject and owner corrections. Old results cannot publish over newer authority or clear human restrictions. Confirm waiting seats/ratings/learning state apply only after publication and frozen games never change. Preserve accepted historical content through the prospective enforcement cutover.
- Route first/new art, reference-preserving transformations, cast-referenced new scenes, repairs, harmonization, wolf variants and championship preparation explicitly. Assert medium in OpenAI JSON and multipart requests, source-consistent recovery, alpha preservation, opaque scenes, accurate pricing and no duplicate uncertain dispatch. Native-alpha assets and completed backfilled cutouts bypass redundant removal. A Grok opaque output follows the existing removal pipeline; removal/storage failure retries only that failed stage, and no candidate is ready before verified transparent bytes are available.
- Verify 320/390 px mobile, short landscape, keyboard open, 1,024 px, and large desktop. Check full-body fit, long names, long strategies, zoom, focus order, error focus, reduced motion, and screen-reader live announcements. Editor scrolling is page content, never a new scrolling player treatment.
- Required implementation checks: `bun run test`, sequential local `bun run test:postgres`, `bun run check`, and affected browser harnesses. Do not run paid/provider tests as part of ordinary CI.
- If native-alpha assets or crop treatment affect game pictures, follow `docs/presentation-parity.md`: live/replay, Studio Source, Selected cut, fresh local/worker bundle, and encoded clip at matched coordinates. Include opaque historical art, transparent new art, isolated cuts, and direct/reverse seeks. Frozen bundles/movies do not update themselves; document explicit fresh-bundle/re-export steps. No parity claim from this design prototype.

Use the existing analytics stack to measure entry source, first draft success, image-stage duration/failure, audition use, mode changes, review acceptance, save success, recovered sessions, and completed entry. Record stage and correlation identifiers, not raw prompts, private strategies, or provider responses in product analytics. Establish p50/p95 time to a playable character and cost per successfully created character before setting conversion or latency targets. A zero-duplicate/no-lost-draft recovery run and complete usability pass are launch gates; an attractive screenshot alone is not.

## Planning deliverables and limits

The refined concept demonstrates dashboard-linked management, Needs attention, stable Edit/View actions with different destinations, a separate artwork Review, Guided/Advanced, direct draft-field summaries, first-image formation, current art during replacement, and before/after review with undo. Saving closes into a simulated Reviewing state; the moderation outcome control demonstrates Accepted/Held while keeping the accepted profile intact. The transparent Mira preview was generated through the built-in image tool and has verified alpha; that tool does not expose an exact selectable model, so this is not a verified GPT Image 2.6 API result or billed latency/cost benchmark.

All displayed character field values, collection records, job times and statuses are examples. Guided now renders those same example fields instead of a second invented summary; it makes no AI call. No static prose masquerades as an assistant response. Local prototype navigation retains an in-memory draft, not durable persistence. Voice samples, API calls, generation, exact crop controls, actual screening, archive and game entry remain unconnected. The artwork review reuses a sample image rather than claiming another generated candidate. Official OpenAI examples establish documented capabilities, not our account's model access.

Planning verification: browser interaction checks passed for fixed Edit/View order and distinct destinations, separate artwork review, removed filler, Guided reading the edited draft fields, save closing into Reviewing, Held preserving the accepted profile, Accepted publishing the submitted sample, attention filters, and a newly submitted agent remaining owner-only. Earlier checks covered model/voice selection and field undo. No browser errors or duplicate element IDs; 320 px management/workspace widths do not overflow. Revised desktop and mobile screenshots were inspected; earlier light-theme checks passed. This is prototype verification, not application or presentation-parity evidence. Repository implementation baselines were not run because no application code changed.
