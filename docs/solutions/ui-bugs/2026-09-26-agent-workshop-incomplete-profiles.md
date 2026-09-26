---
module: Agent editor
date: 2026-09-26
problem_type: ui_bug
component: frontend
symptoms:
  - Workshop visual updates fail before character generation
  - Saving an incomplete profile shows an error away from the save button
  - Missing gender is difficult to discover and complete
root_cause: integration_error
resolution_type: code_fix
tags: [agent-editor, workshop, structured-output, gender, validation]
---

# Workshop tools and incomplete profile feedback

## Evidence

Staging API logs at 08:37:59 and 08:40:55 UTC on September 26 rejected
`/api/agent-profiles/edit-assistant` with provider HTTP 400: GPT-6 Luna does not
support function tools with reasoning in Chat Completions. The route surfaced
that failure as the generic “Your draft is unchanged” error. This occurred
before profile writing or image generation; missing gender was not the cause
of that provider rejection.

Separately, the editor required gender on save but rendered validation only
beside the input. The fixed Workshop hid this feedback and did not receive
save errors. A collapsed Workshop also hid assistant errors.

## Changes

- Use `reasoning_effort: "none"` for the Advanced Workshop's exact native tool
  selection. Retain Standard processing, zero SDK retries, strict decoding,
  and the existing text-generation allowance accounting. The pinned SDK lacks
  that enum value, so its SDK transport sends an explicitly typed current
  request body; no permissive response parsing is introduced.
- Show save validation and server errors beside the save action even when the
  Workshop is collapsed. Center the first invalid field above that panel for
  manual correction. Keep reference and assistant failures visible there.
- Offer “Fill missing details” for incomplete existing characters. Generate
  the empty fields from existing context, requiring structured gender and
  archetype enums, and preserve populated fields and selected images.
- Keep missing archetype absent in generation input; display AI choice when
  no archetype exists. Clear corrected field errors after inference succeeds.
- Return a readable 504 for a timed-out Workshop request without dropping
  the typed message.

## Verification boundary

API regressions model the exact unsupported provider request and retain
malformed-tool and incomplete-output rejection coverage. Form tests exercise
missing identity completion, preservation, save feedback, and failed-save
retry. Browser fixtures exercise desktop and mobile save feedback, submission
blocking during generation, and identity completion without image requests.
These checks use mocked provider responses and local databases; they do not
prove live model quality or a deployed staging fix. The historical game-join
error was not reproduced.
