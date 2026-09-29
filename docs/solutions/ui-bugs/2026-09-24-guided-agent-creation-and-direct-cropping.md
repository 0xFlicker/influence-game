---
module: Agent creation
date: 2026-09-24
problem_type: ui_bug
component: frontend
symptoms:
  - Agent creation exposes the full editing form before character direction is established
  - Mobile crop sliders and the source image cannot be viewed together
root_cause: design_gap
resolution_type: code_fix
tags: [agent-creation, structured-output, mobile, portrait, pointer-events]
---

# Guided character creation and direct crop controls

## Public creation and authentication handoff

The canonical creator is `/agents/create`. A page-level AuthGate prevented new
visitors from seeing the hall or trying the assistant, so admission now happens
at generation and save actions. The anonymous first turn uses one strict
`{reply, profile}` generation rather than spending its preview on a separate
command-router call. A signed browser cookie and PostgreSQL advisory lock enforce
one successful preview per browser and one shared dispatch per minute. Busy
admission consumes no visitor allowance; accepted retries replay their stored
result. Anonymous spending has its own admin pool.

Keep the active draft storage owner stable while authentication changes. This
avoids replacing a new visitor's cards with an account recovery prompt during
signup. Account reloads can recover that anonymous draft when no account draft
exists. Authentication renders through a body portal so the creator's inert
background siblings cannot disable the signup modal. Browser verification must
include the existing public-profile setup step after signup, then verify that a
subsequent message debits the Free account instead of the Anonymous pool.

## Guided editor

Creation now offers Advanced create and a full-screen assistant backed by the
same draft recovery and save contract. Profile generation precedes explicit
character approval; image generation follows an appearance description. A
stage-specific strict command schema, decoded on both server and client, controls
which actions can run. Assistant prose never becomes transition authority.
The router now returns a bounded presentation reply only for clarification;
action commands require an empty reply. A shared general rules and strategy
primer informs those answers, Advanced edits, and generated strategy text.

Compact fixtures remain above chat. Explicit section selections constrain which
generated fields are applied. Cards open a full-screen reader before selecting
a section for revision. Edit adds an animated section pill and focuses the
composer; Close and Escape leave the selection unchanged. Direct text editing
remains available in Advanced create. Appearance requests apply
only visual design and generated images, preserving approved character text.
The House mark and opening scene persist through clarifications and failed
turns. A character summary takes the top position once generated character
content exists. On tall screens the cards grow up to the viewport midpoint.
The chat log moves earlier bubbles out of view beneath the summary without a
visible scrollbar. The full-screen stone hall, gold accents, and translucent bubbles
keep the creation flow legible without a hard divider.

Starter pills share Advanced create's curated ingredients. Selected tags are
removable, support submission without typed text, and survive failed requests.
The inset send arrow shows activity. Ingredient rows sit below the conversation
and directly above the composer on both wide and narrow screens. Pending turns
leave the disabled composer, pills, and secondary actions in place.

Interactive text calls previously inherited Flex processing while the command
request had a 60-second browser deadline. They now explicitly request Standard,
disable the Flex transport, use low reasoning effort, and cap each provider call
at 45 seconds without SDK retries. Keep background generation policy separate.
Timeout tests verify readable errors and preservation of the player's input;
mocked tests do not establish live provider latency.

Guided generation opens the full-screen portrait editor automatically, with
crop and head controls ready. Advanced editing opens in confirmation mode when
it has a crop and detected head. Optional editing selects one of the overlapping boxes. Pointer capture
supports mouse and touch movement and corner resizing; square crops use source
pixel geometry. Precise sliders remain available beside a sticky source image.
Keep the preview compact during editing so the source and controls fit on phones.

Regression coverage includes invalid and out-of-stage commands, conversation
endings, review/revision ordering, original draft recovery, desktop/mobile
creation, full-text section reading and scoped revision, touch/mouse crop edits and switching back
to Advanced. Model and image results in browser tests are simulated; live
provider quality is a separate opt-in check.

Browser fixtures must return the complete `{ command, reply }` contract, including
`reply: ""` for action commands. A command-only mock is rejected before profile
generation and leaves the approval button absent. The desktop/mobile journey
also asserts that the composer and visual ingredients stay visible and disabled
while appearance generation is pending.

## Source-image load failure and portrait model check (2026-09-26)

A failed browser image load left the headshot dialog displaying a head box,
speech placement, and a crop-containment warning without source dimensions.
Confirmation correctly stayed disabled, but “Close and try again” reopened the
same URL and offered no targeted recovery. This explains the repeated UI state;
it does not establish whether the failed delivery was HTTP, storage, or browser
network related. A screenshot alone cannot identify that cause.

The composer now gates geometry on successful loading, clears geometry on a
subsequent load failure, resolves relative API image URLs through the runtime API
origin, and offers Retry image plus Open source image. Retry remounts the image
without a generation or localization request. A source change remounts the editor
so dimensions, head geometry, and errors cannot survive from another image.

Portrait localization and game-scene composition, geometry, and identity
verification now select GPT-6 Sol through the existing Responses API and exact
strict schemas. Existing
operation keys and input fingerprints remain stable so accepted attempts replay
and uncertain attempts cannot automatically incur another paid request during
the model change. Provider receipts retain the model actually used.

Official standard rates for GPT-6 Sol are $2 input, $0.20 cached input, $2.50 cache
writes, and $10 output per million tokens, half GPT-5.6 Sol's corresponding rates.
See [pricing](https://developers.openai.com/api/docs/pricing) and
[model capabilities](https://developers.openai.com/api/docs/models/gpt-6-sol).
Two opt-in live calls on bundled diplomat and wildcard portrait art returned
HTTP 200, passed exact semantic decoding with one clear anchor, and took 5,963
and 5,516 ms. Estimated costs were 4,418 and 4,498 micro-USD. These calls prove
image/schema compatibility, not generated full-body localization accuracy or
resolution of the original deployed image-delivery failure.

Validation for this patch: `bun run check` passed; `bun run test` passed with
2,030 tests and five intentional skips after rerunning with local socket access;
`bun run test:postgres` passed with 1,761 tests. The focused journal/pricing run
passed ten tests, including accepted-evidence replay across the model change and
uncertain-transport redispatch blocking. Focused creator/recovery tests passed
37 tests. A concurrent journal run initially timed out waiting for the baseline's
shared database lock; the sequential rerun passed. The bounded Grok review
returned no findings report and was stopped; it is not review proof. These are
local checks; this patch has not been deployed.

The scene renderer regressions assert GPT-6 Sol and strict schemas on every
composition, geometry, and identity call, including small and large casts.
The shared model constant removes the obsolete per-portrait model override.
The shared scene-model update passed `bun run check`, the provider-free baseline
(2,030 passed, five intentional skips), and the PostgreSQL API baseline
(1,762 passed). No deployment or live multi-character quality evaluation was
performed for this follow-up.
