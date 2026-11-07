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
