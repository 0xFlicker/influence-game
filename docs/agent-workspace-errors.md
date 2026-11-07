# Agent workspace errors

One notice, one short sentence, one recovery action. Support opens a contact dialog explaining Discord and email, with a copyable agent/request reference when available. Email includes that reference. Assistant failures include their text request ID, matching the API log and accounting record, even when no image request exists. Provider messages and accounting terms stay in retained evidence. Inline field validation remains beside the relevant input.

The two dimensions are **step** and **recovery**:

| Step | Retry the same work | Reload / resolve | Discard the draft | Contact support |
| --- | --- | --- | --- | --- |
| Open agent / destination | Couldn’t load agent. / Couldn’t load game entry. | Your account changed. | — | This agent is unavailable. |
| Recover draft | — | Couldn’t load draft. / Draft changed in another tab. | This draft can’t be opened. | Browser recovery is unavailable. |
| Save draft | Couldn’t save draft. | Draft changed in another tab. | Couldn’t discard draft. | Persistent storage failure |
| Character assistant | Couldn’t update character. / Character update timed out. Input stays in the composer; Send retries. | Re-enter your request. | Resume or discard your draft. | Repeated failure |
| Image generation | Couldn’t create image. | Artwork changed in another tab. | Image generation stopped. / Image request is unavailable. | Missing receipt or uncertain provider outcome; no Retry |
| Select / discard artwork | Couldn’t select artwork. / Couldn’t discard artwork. Select or Discard retries the decision, never generation. | Artwork changed in another tab. | Abandon the draft | Repeated failure |
| Background removal | Couldn’t finish image. Reuses retained source. | — | Abandon the draft | Repeated failure |
| Portrait | Couldn’t load artwork. / Couldn’t save portrait. | Adjust the head/crop in place. | Close portrait editing | Repeated failure |
| Voice audition | Couldn’t play sample. Play retries. | — | — | Repeated failure |
| Submit agent | Couldn’t save agent. Same submission identity. | Agent changed. Reopen to compare. | Abandon unsaved changes | Repeated failure |
| Game / season entry | Couldn’t enter. Your agent is saved. | Full/closed destinations require another entry choice. | No draft reset required | Repeated failure |
| Generation admission (text or image) | Generation is busy. / Please wait before generating again. | Sign in to continue. | A draft reset does not remove account restrictions. | Generation limit reached. / Generation is paused. / Generation needs support. |

`Reviewing` and `Held for moderation` are submission states, not request errors. Draft conflicts and framing decisions retain their specific comparison controls. A pending job remains an activity with its real stage, not an error.

## Display and recovery rules

- Draft persistence errors take precedence, then save, artwork and assistant failures. A child assistant failure feeds the same notice. Workspace notices use the footer’s reserved status space, with full details in Activity; they do not insert rows above the editor. Save errors appear inside the active review dialog. Portrait and voice notices live in their respective active controls, not in a second page banner.
- Known retryable image failures expose Retry. An incomplete/uncertain dispatch exposes Discard and support, disables retry/revise for that request, and never encourages Send to repeat it. A successful retained image permits removal/storage recovery without another provider dispatch, even when an earlier fallback attempt remains uncertain.
- Discard is explicit and confirmed. It removes the draft and retires its artwork job while retaining the saved agent, accepted images and provider journal. A missing artwork job cannot trap a draft: a cancellation record prevents a delayed create request from reviving it. Already selected decisions remain immutable. Draft autosave is fenced during discard. A stale account-draft version still requires reload; never silently delete another tab’s newer work.
- Cancelling or discarding image work releases its execution slot. It does not establish an unknown provider outcome or refund a dispatched credit. The retained charge can be reconciled separately; new requests still pass ordinary account admission. See [pending image work](agent-generations.md).
- Technical codes are persisted as small job metadata and returned with retryability. Existing failed requests are classified from their actual journal, never by parsing prose.
- Account-limit notices keep the existing generation-contact dialog. Other notices use one Support link to open help with the relevant request context. Pending image work uses the shared activity list, with View and Cancel before a new generation can start.

## Reported development incident

The reported agent’s accepted revision was intact. The retained image job was discarded and its account draft absent after the user reset it. The OpenAI Sunburst attempt had a start record, no completion receipt, no final image and no reconciliation. This supports an interrupted dispatch; it does not prove why it was interrupted or whether the provider charged. No new generation was run to diagnose it.

## Verification

Provider-free API tests cover ownership, atomic queue admission, lost execution
leases, accounting retained after cancellation and late responses. Browser journeys
cover creation/editing in both modes, draft recovery, pending requests visible in
the editor and management, cancellation preserving edits, and quota contact.
Validation results are recorded in the implementation handoff.

Generation allowance errors also retain the existing contact dialog inside the
workspace. Its Discord, email and X actions remain available; dismissing it
returns to the unchanged draft and restored request. This dialog is reserved for
allowance exhaustion or an account pause, not ordinary generation failures.
