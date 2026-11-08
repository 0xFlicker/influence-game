# Agent workspace manual testing — 2026-11-07

Local dev account, real providers, authorized budget: $10. Baseline commit:
`fbb98af3`. Do not modify model-named agents except GPT Sol.

## Plan

| Journey | Checks | Result |
| --- | --- | --- |
| Guided creation | Direct prompt, generated fields, model/voice, alpha image, portrait, review, publication | Passed: Nori Lantern |
| Advanced creation | Validation, all sections, voice, image, review diffs | Passed: Mara Tideglass |
| Guided update | Single-field revision, gender, appearance edit, preservation of unrelated fields | Passed after scope fix |
| Advanced update | Direct edits, no-op review, cancel/recovery, review diffs | Passed after URL identity and name-feedback fixes |
| Long operations | Immediate feedback, activity, cancel, navigation/recovery, duplicate requests | Live cancellation/recovery passed; stale leases covered by provider-free tests |
| Management | Attention, search, View/Edit, stable order and return position | Passed; exact order/geometry also covered by browser assertions |
| Responsive/accessibility | Narrow viewport, footer, selectors, focus, dialogs | Desktop/mobile checked; four-flow size matrix covered automatically |

## Budget and evidence

Operation ledger baseline: `2026-11-07T19:02:50Z`. Read account text operation
estimates and owner-linked visual attempt receipts from the local dev database.
Unknown or unfinished image charges are reserved conservatively at $0.50 per
attempt; stop new paid work before the total including reserves reaches $10.
Estimates are not final provider invoices. Keep operation IDs and changed agent
IDs below so the operator can inspect the work.

## Findings and changes

- Existing account draft resumed in its saved Advanced mode; input was correctly
  blocked until Resume. Scratch contents: empty required fields, `asdasd` backstory.

## Operator proposals

No architecture changes were made. Remaining product decisions:

1. When the initial prompt already produced an appearance description, Guided
   still asks the user to describe it again. Offer a direct Generate action for
   that existing brief; ask the question only when the brief is empty.
2. Existing agents can review/save text while a new image is still preparing.
   Decide whether to keep separate text/art submissions with explicit review
   wording, or wait for image selection before submission. The test run waited
   for selection; it did not publish a deliberately mismatched text/image pair.
3. The owner View page currently shows personality and backstory. Consider adding
   strategies, appearance/performance and model/voice to make View a complete
   read-only inspection surface.

Grok fallback, deliberate provider outages, forced human moderation holds and
actual allowance exhaustion were not induced in this account. Cancellation and
normal automatic acceptance were tested live; provider-free coverage retains
quota contact, moderation and stale-slot cases.

- Created **Nori Lantern** (`80dd497d-02c3-4e3d-80f3-4ccb03eb8454`) in Guided mode.
  Model and voice were changed while text generation was active and retained.
  Played Lumen, selected transparent artwork, confirmed framing, and submitted;
  automatic review accepted the agent. Image request:
  `1491e332-f452-46c5-ae66-ed05f8278e5e`. OpenAI Flare medium took 9.027 seconds;
  image estimate $0.036370, framing $0.012519, initial text $0.002217.
- Leaving the editor during image work and reviewing from management recovered
  the operation. Found a misleading changed-brief warning before Resume. Fixed:
  explicit artwork handoffs resume an unconflicted draft after account recovery,
  then read the candidate; conflicting drafts still require an explicit choice.
- View crashed without the auth context because its route was outside `(site)`.
  Moved it under the shared site layout; manually verified Nori's accepted profile.
- Tested Advanced GPT Sol backstory edit and review Undo. Undo correctly closes an
  empty review and disables Review. Save then found a source URL identity bug:
  normalized API upload URLs did not match absolute saved head coordinates.
  Canonicalized both through the existing storage URL normalizer before comparing;
  retained image hash, dimensions and geometry verification. Added an exact proxy
  origin regression and a different-image rejection assertion.
- Review now shows display labels for Gender and Archetype instead of raw enum IDs.

- **Mara Tideglass** (`74c0e429-7905-4789-bef6-9b64e991fe06`) was created manually
  in Advanced mode. Required-field gating, styled archetypes, blank Werewolf
  default, generated image selection, portrait confirmation and review passed.
  Voice preview/selection during generation persisted Carina.
- Cancellation before selection passed. A second request was cancelled within a
  second of dispatch (`041186ca-1950-477e-9aa1-f15fdd7d391d`); its returned image
  receipt stayed recorded, the job stayed discarded, and a fresh generation
  (`70f01c34-4ad7-49b7-9aa4-4e662a913c78`) succeeded without stale-slot blocking.
- Nori's targeted scarf edit (`3d6cb980-d107-4264-8ae3-572eae6c0ecd`) used Sunburst
  and preserved the otter, pose, apron, goggles and radio. The review contained
  only Appearance and Artwork/portrait. Submitted and automatically accepted.
- Activity briefly said No activity during startup and was empty when its only
  row was the already displayed candidate. Added immediate refresh after admission,
  a startup status before the row arrives, and retained the ready row in Activity.
- Mobile management, Guided/Advanced editing, fixed footer, voice search and
  Escape dismissal checked. Chrome was at 90% zoom; the requested 390×844 override
  produced a measured CSS viewport of 416×938. Screenshot paths are under
  `.renders/agent-tuneup/`.
- Duplicate-name save incorrectly suggested stale-agent recovery. It now returns
  to the name field with `This name is already in use.` The invalid rename was
  discarded; Mara's accepted identity remained unchanged.
- Cost checkpoint: $0.245900 estimated, zero unknown receipts, including cancelled
  work. This covers eight account text calls and nine visual/framing attempts.

- Silas Venn (`9ea4786b-464b-4cf4-b87c-fb7080b09c09`) had no full-body image or
  visual notes. Advanced Generate accepted the blank optional notes and produced
  a Deceiver-based transparent character. Selected, framed, submitted and accepted;
  Needs attention returned to zero. The candidate warning exposed a null/empty
  string comparison bug, now fixed; archetype changes are also compared because
  an empty visual brief uses that archetype.


- The exact chat request `Make Mara male. Change only the gender selection; leave
  the name, text, voice and existing artwork unchanged.` initially renamed Mara,
  rewrote prose and filled optional Werewolf notes. Nothing from that draft was
  submitted. Guided now resolves unscoped revisions with the existing strict
  field-selection tool. Retesting produced **only Gender: Female → Male**; the
  test change was undone/discarded and Mara stayed accepted as originally created.
- Final dev audit: all five tested saved agents are accepted, zero active image
  jobs, zero account drafts, and zero updates to the eight protected model agents.
- Final estimate: **$0.294466** from 13 account text calls, six image attempts and
  five framing calls. All receipts priced; no unknown charges. Flare medium image
  calls took 6.657–9.027 seconds; the Sunburst edit took 25.322 seconds. Cancelled
  work is included. Cost/audit snapshots: `.renders/agent-tuneup/provider-costs.json`
  and `.renders/agent-tuneup/account-audit.json`.

## Automated validation

- Final full provider-free baseline: 3,367 passed, five skipped. Exact-scope
  regressions also pass in the 39-test chat/recovery suite.
- Profile API regression suite: 64 passed, including storage-origin normalization.
- Final browser journeys: 15 passed, including View routing, ready Activity, all
  four editor flows and stable review-completion geometry. Full API baseline: **2,527 passed** across four fresh databases (727 + 603 +
  545 + 652). The render-proof teardown and concurrent-migration tests timed out
  during the loaded parallel attempt; both affected full shards passed on rerun
  after the heavy checks finished. Disposable shard databases were removed.
- Typecheck, lint and MCP output-schema checks: passed.
- The first unsharded API attempt used an older disposable test schema whose
  `render_jobs` table lacked `source_render_version`. It was stopped; no product
  schema or gameplay data was altered. The unused disposable shared test database
  was rebuilt and its 64 profile tests passed.

## Follow-up: related gender wording and missing fields

The owner clarified that gender edits may update related text (for example,
`she was a chef` → `he was a chef`) and may complete missing fields. Updated the
selector and completion contract accordingly. Populated unrelated fields and the
agent's name remain protected. Focused strategy-only edits stay isolated.
Artwork intent is explicit: changing pronouns in an appearance description does
not trigger image generation. Pure text edits omit image references.

A live Mara draft changed Female → Male, updated personality/backstory/appearance
wording to he/his and filled missing Werewolf notes. It kept Mara Tideglass,
Carina and the existing artwork. The revision was reviewed and discarded;
Mara's accepted version remains unchanged. Evidence:
`.renders/agent-tuneup/gender-related-review.jpg`.
The three new text calls cost an estimated $0.001284; cumulative testing is
$0.295750. Image attempts remained at six, with eleven total visual/framing
receipts. No new artwork was requested.

Follow-up verification: 101 focused tests, 3,368 full provider-free tests (five
skipped), 64 profile API tests and all 15 browser journeys passed. Typecheck,
lint and `git diff --check` passed. React review found no new effects, state
synchronization or accessibility changes.
The full sequential PostgreSQL baseline also passed: 2,527 tests across 241
files, zero failures (1,021 seconds).

## Follow-up: profile links on management cards

Removed the separate View action. The character image and name share one profile
link with keyboard focus and a name underline on hover/focus; Edit remains in the
card action row. The existing management browser journey now clicks both surfaces
at desktop and mobile widths, verifies return position, and opens the profile
with Enter. Both management journeys passed (47 assertions), as did typecheck,
lint and `git diff --check`. The first browser startup selected an occupied local
port; rerunning with fresh random ports passed. Evidence:
`.renders/agent-workspace/management-profile-link-1440.png` and
`.renders/agent-workspace/management-profile-link-390.png`.

The Needs attention panel now renders only when agents need attention. Both
management browser journeys passed with the empty-panel check at desktop/mobile
widths (51 assertions); typecheck, lint and `git diff --check` passed.

Voice options now show catalog Male/Female labels beside each name and on the
selected voice. The 21-test editor/recovery suite and existing Advanced creation
browser journey passed, including voice selection and audition separation.
Typecheck, lint and `git diff --check` passed.

The owner profile back link now sits outside the background panel, aligned with
the heading and separated from the panel by 16px. The existing management
browser journey passed desktop/mobile geometry and return-navigation checks
(31 assertions). Typecheck, lint and `git diff --check` passed. Screenshots:
`.renders/agent-workspace/owner-profile-1440.png` and
`.renders/agent-workspace/owner-profile-390.png`.

## Follow-up: stable management actions

Removed More. Edit, Analyze and Archive remain in one action row. Archive now
uses the existing dialog and returns focus to its trigger on cancellation; it
does not append confirmation below the collection. Archive triggers are disabled
while a request is pending.

Analyze remains enabled: the collection has no cheap authoritative availability
flag spanning season receipts and current-strategy Influence/Werewolf owner
learning. The existing lifetime games-played count does not cover Werewolf. No
per-agent analysis reads were added to the management load.

Both management browser journeys passed (69 assertions), including row alignment,
absence of disclosures, archive confirmation geometry/focus, profile navigation
and editor/review behavior. Desktop/mobile screenshots remain under
`.renders/agent-workspace/management-profile-link-1440.png` and
`.renders/agent-workspace/management-profile-link-390.png`. Typecheck, lint and
`git diff --check` passed.

## Follow-up: visible generation activity

Added warm text sweeps to the fields actually being generated, including missing
fields selected for completion. Guided fixtures and Advanced inputs share the
same scope. The composer and empty House mark indicate routing immediately.
Text-only work leaves existing artwork still. Image generation and portrait
preparation scan the retained artwork and show the actual operation stage.
Reopened queued/running image requests reuse collection metadata; late metadata
does not reveal a new empty image pane or move the editor. A local failure
overrides stale queued metadata immediately. Success and cancellation clear the
indicators. Reduced motion uses static highlights; scans never claim a percentage.
The obsolete forming class that changed fixture height has been removed.

Verification: 45 focused tests passed, including scoped text activity and failure
cleanup; the full provider-free baseline passed 3,369 tests (five skipped). All
13 workspace browser journeys passed (732 assertions), exercising all four
creation/editing modes, desktop/mobile scans, reduced motion, reopened jobs,
success/failure/cancellation and stable geometry. Typecheck, lint and
`git diff --check` passed. The first restricted baseline could not bind local
test servers and emitted a test teardown error; the permitted rerun passed.
No paid provider calls were needed.

Visual evidence: `.renders/agent-workspace/text-scan-{guided,advanced}-{1440,390}.png`,
`image-scan-{guided,advanced}-{1440,390}.png` and
`existing-image-scan-{1440,390}.png`. Animation samples are paused at their middle
frame for screenshots; browser assertions verify moving and reduced-motion modes.

## Follow-up: use the whole management width

Removed the reserved 300px Activity/Needs attention sidebar and its grid gap.
The gallery always spans the content width; queued work, attention items, errors
and accepted game/season continuations remain in the Activity dialog. Pending
continuations now contribute to its count. Removed the obsolete sidebar layout
and its narrower gallery breakpoint, keeping responsive three/two/one-column
gallery behavior without status-driven width changes.

All 13 workspace browser journeys passed (758 assertions), including full-width
alignment at 1440px, 1024px and 390px, support/recovery access through Activity
and unchanged card positions through review acceptance. Typecheck, lint and
`git diff --check` passed. Evidence: the existing management-profile-link width
screenshots and `.renders/agent-workspace/stable-gallery-accepted.png`.

## Follow-up: quiet ready cards

Ready agents no longer display Accepted. Their status row keeps a 20px minimum
height so completion of review does not move cards or actions. Reviewing, held,
image preparation and failures remain visible; missing full-body artwork and
artwork conflicts receive actionable status copy. During edits the secondary
line says Current version stays usable. Game/season continuation copy uses ready.

Both management/profile and review-completion browser journeys passed (87
assertions), including an empty ready status and unchanged card geometry.
Typecheck, lint and `git diff --check` passed. Updated visual evidence remains
`.renders/agent-workspace/stable-gallery-accepted.png`.

## Follow-up: compact card details

The large name-to-metadata gap came from reserving two status rows and adding
metadata margins. Removed the second row, grouped metadata 6px below the name,
and moved one compact 20px status line above the actions. During review, Still
usable shares that line. Status completion keeps card geometry stable.

The two management/profile and review-completion browser journeys passed (93
assertions), including compact metadata spacing at desktop, tablet and mobile
widths plus unchanged card positions on acceptance. Typecheck, lint and
`git diff --check` passed. Existing management and stable-gallery screenshots
show the compact treatment.

## Follow-up: quiet management header

Removed the duplicate Create action from the management masthead. Activity is
absent when its count is zero. Otherwise a clickable activity icon carries a
stationary numeric badge; only the icon spins during queued/running generation
or automatic review. Results, errors and other attention items keep a still
indicator. The full count is available to assistive technology, reduced motion
stops rotation, and the Activity dialog closes if its last item clears.

Reviewing agents now contribute to the count and have a Reviewing section with
View links inside Activity. The primary navigation retains agent creation.

All 13 workspace browser journeys passed (784 assertions), covering the empty
header, removed local Create link, live count, review details and count changes,
spinner/reduced motion, pending requests and stable card positions. Typecheck,
lint and `git diff --check` passed. Visual evidence includes
`.renders/agent-workspace/management-active.png` and the management width
screenshots. No paid provider calls were needed.

## Follow-up: artwork badge cards

Implemented the approved Side badges layout in agent management. Names,
archetypes, models, voices and meaningful status sit over the artwork; only
Edit, Analyze and Archive remain underneath. Names wrap in a separate grid row
above the figure, and the entire image fits inside its remaining area. Voice
gender comes from the stock catalog. Ready agents have no status badge; pending
revisions retain Still usable only when an accepted revision exists.

Image work uses an indeterminate scan; automatic review spins only its status
badge. Reduced motion keeps static indications. Card and action geometry remain
fixed through status changes. The first-image House logo now loads from the web
app instead of incorrectly resolving against the API.

Provider-free browser coverage includes ten status/artwork cases at 1440, 768 and
320px, long names/model labels, loaded images, aligned actions, first-generation
fallback, new versus revised moderation and reduced motion. The existing profile
navigation and review-publication regressions still pass.

Validation: 14 workspace browser journeys passed (1,050 assertions); after the
logo correction, all three affected management journeys passed again (373
assertions). The provider-free baseline passed with 3,369 passes, 5 skips and no
failures; typecheck, lint and `git diff --check` passed. Screenshots are under
`.renders/agent-workspace/management-badges-{1440,768,320}.png` and
`management-profile-link-390.png`. No paid generation or account mutations were
needed for this pass.

## Follow-up: hide the empty attention filter

Needs attention uses the existing computed attention list and disappears at zero,
without another request or scan. Empty attention URLs return to All while keeping
search and the agent return position. Both affected management browser journeys
passed (358 assertions), including empty and nonempty filter states and stale URL
recovery.

## Follow-up: Guided field readers and identity editors

Long-text fixture arrows open full-text readers without selecting an AI edit.
Clicking the tile body still scopes the composer directly. Mouse hover previews
the full value after 600ms without moving the form; touch uses the arrow. Readers
and editors anchor beside the referring field, flip above it when needed and
stay within the visible viewport instead of using the bottom activity position.

Name and Archetype use compact X / input or picker / OK / sparkle controls.
Cancel and Escape discard their local buffer. OK applies only that field to the
shared draft; Enter on Name does the same without submitting the agent form.
Sparkle queues the existing draft field, leaves the unsent composer message
intact and restores its focus without a provider request. The styled Archetype
picker stays fully usable inside the native dialog, including at 320px.

All 15 workspace browser journeys passed (1,099 assertions). The final field
journey separately verifies delayed hover, short-viewport fit, full-text content,
field anchoring, visible dropdown clicks, cancel/apply, shared Advanced values,
focus return and zero provider calls. The focused unit group passed 47 tests.
The provider-free baseline passed 3,372 tests with 5 skips and no failures.
An initial broad run hit a React scheduler cleanup error after the existing
history-pagination tests; those tests passed in isolation with the Guided tests,
and the full baseline then passed on rerun.
Final typecheck, lint and `git diff --check` passed.

Visual evidence is under `.renders/agent-workspace/`: `guided-field-hover-1440.png`,
`guided-field-reader-1440.png`, `guided-name-editor-{1440,390,320}.png` and
`guided-archetype-editor-320.png`. No paid generation or account changes were
needed.

## PR review: paid image recovery

Reviewed owner and draft-version boundaries, immutable submissions, publication
claims and roster continuity, private artwork access, cancellation/lease fences,
provider retries and allowance settlement. Fixed two related failures: image
decoding could throw before retaining a completed response, and a returned image
rejected locally could incorrectly refund a paid generation. Receipts, returned
bytes and debits now survive local file failures; the candidate remains failed
and an explicit retry starts another generation. The transparency check reads
the alpha channel locally and makes no provider call.

The model migration also changed request fingerprints and allowance identities.
Historical journals now verify and reuse their frozen requests and retained
images without rewriting evidence or debiting another allowance. A failed,
never-dispatched historical reservation advances only on explicit retry, keeping
its original refund. Regression tests cover these cases with mocked transport.

The React review also found an archive failure hidden behind its own modal and
retained after retry. Archive errors now appear inside that dialog and clear
when reopening or retrying. The browser journey covers failure, cancellation,
reopening and successful retry without leaving a phantom Activity item.

Review validation: the provider-free baseline passed 3,372 tests (five skipped),
and the final API code passed 2,533 cases across four isolated database shards
(728 / 603 / 545 / 657). Frozen install, typecheck, lint and MCP schema checks
passed. The early sequential run began before the review fixes were complete;
the final shard runs provide the final-code API evidence.

Parallel runs on the local PostgreSQL server hit a database-drop checkpoint wait
in one API cleanup hook and browser cleanup. All temporary browser/server
processes exited. The affected API shard then passed alone (545 cases, including
cleanup), without increasing its timeout, and all four temporary shard databases
were removed. This is local evidence; staging and production remain untested by
this review. No paid provider calls were made.

The final browser run after the database load settled passed all 15 journeys
(1,107 assertions) and cleanup in 66.2 seconds. The timed-out run's exact
temporary databases and role were also verified absent. `git diff --check`
passed; generated Next.js test route paths were restored before commit.

CI follow-up: enrollment and public-profile fixtures explicitly accept their
submitted revisions. Moderation and Werewolf learning journeys check the held or
reviewing state before acceptance. The removed Workshop controls no longer have
their own browser cases: scoped visual revisions are covered by the workspace
browser journey and agent-profile API tests; missing identity and failed-save
recovery are covered by the workspace draft and account browser tests. The
profile-to-editor handoff now waits for draft recovery and displays the request
and assistant response in the guided conversation; the public-identity browser
test checks that the request runs once and is not replayed after reload.

## Creation follow-up

The first guided conversation now uses the welcome area's space after sending,
and the opening prompt no longer crowds the user's first message. Browser
coverage checks 320×568, 390×844, 768×1024, 1024×768, 1440×900 and 1920×1080,
including the typing indicator above the fixed footer.

Ready artwork now goes directly to review in both creation modes. The generated
portrait and head suggestion are used when available; if localization fails,
the full-body image remains usable without invented head coordinates. Portrait
adjustment remains available. Browser coverage checks model and voice selection,
review, creation and publication, including failed localization.

A real local Guided test created Maren Tidewell
(`12c2d1dc-0868-42c3-ada3-8c301fdf18af`) with generated artwork, GPT Luna and
Carina using Review → Create without selecting or confirming a portrait. It was
accepted; the model and voice were verified in the local database. The recorded
incremental estimate was $0.050290 (four text calls, one Flare image and one
head-localization call), bringing the prior $0.295750 estimate to $0.346040.
These estimates exclude moderation: this agent's Luna screening receipt recorded
3,647 input and 109 output tokens but does not report a billed amount. They are
not provider invoices.
