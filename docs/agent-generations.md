# Pending agent images and cancellation

Explicit artwork links resume a matching, unconflicted account draft before
displaying its candidate. Divergent draft copies or changed baselines still need
the owner's decision. Admission and ready responses refresh Activity immediately;
a request starting before its list row arrives has a startup status. Ready
candidates remain in Activity even when also visible beside the form.

Character editing carries explicit artwork intent separately from selected text
fields. Updating gendered wording in an appearance/performance description or
filling missing details does not request an image. Mixed text-and-art requests
can request both without inferring a paid dispatch merely from a field name.

Agent creation, editing, management and MCP share the owner-scoped generation
list. It includes unfinished agents and requests whose original drafts no longer
exist. Reads return operational metadata only and never start or resume providers.

The editor keeps status in a reserved footer and exposes the request list through
Activity. On mobile the footer remains fixed above the safe area and Activity opens
a bottom sheet. Generation, draft recovery, validation summaries and moderation
never insert banners above the fields. Draft conflicts open in the same overlay.
The preview keeps its dimensions while artwork becomes ready.

Management uses an Activity dialog without reserving a sidebar. Its gallery uses
creation date descending and ID ascending, never review state or update time.
Status badges overlay the fixed-height artwork so card positions stay unchanged
when review completes.

The editor checks activity before offering a new image. The API checks capacity,
pauses and allowances under the account/queue locks as well. Simultaneous starts
admit only the available work; blocked starts and retries return `generation_pending`
with `blockedBy`. Exact replays keep the original request identity. Text editing,
model and voice selection remain available while an image is pending.

| State   | Copy                                                        | Actions         |
| ------- | ----------------------------------------------------------- | --------------- |
| Queued  | Waiting to start                                            | View, Cancel    |
| Running | Generating image / Removing background / Preparing portrait | View, Cancel    |
| Stopped | Generation stopped                                          | Clear, Support  |
| Ready   | Image ready                                                 | Review, Discard |

Support opens a contact dialog with Discord instructions, the support email and a
copyable request reference. Email includes the reference automatically.

Selecting artwork or cancelling a request immediately removes its completed action
from the local list and invalidates older in-flight reads. Other agents' Review
links open their own workspace; they never attach that image to the current draft.

## Execution and billing

`inference_reservations.state`, its original identifier, bucket and provider
journal remain accounting evidence. Image execution has independent lease and
release metadata. A live provider call renews a two-minute execution lease every
15 seconds. New image admission and worker maintenance recover expired leases.

A reserved request that never dispatched can fail and return its credit once.
A dispatched or uncertain request that loses ownership releases its execution slot
but keeps an uncertain charge and its debit. It does not become a free generation.
A real late receipt can settle that accounting afterward. No recovery process
creates a new paid dispatch or claims an unknown outcome was free.

A completed provider image response retains its bytes, usage and allowance debit
even if local decoding or transparency validation rejects the artwork. The
candidate stays failed; an explicit retry is a new generation. These local checks
make no additional provider request.

Pre-migration image journals keep their original request hashes, paid images and
allowance identifiers. Reads verify the frozen request and reference hashes;
cached images are reused without another generation or debit. Historical opaque
sources use explicit background preparation when an alpha consumer needs them.
Current requests retain the stricter operation/background/model fingerprint.

Cancellation fences the job before releasing execution. A lease-lost worker
cannot renew or dispatch again. HTTP cancellation is best effort; the provider may
finish. Late output and receipts remain stored, but a discarded job cannot publish
a candidate or change the saved agent. Cancelling an image keeps its character
and conversation draft. Discarding the whole draft uses the same image
cancellation underneath. Selected artwork decisions remain immutable. Older agent preparation jobs are included in the same activity list. Cancellation is available until their final saving stage; once saving begins, the already-authorized commit finishes.

For a confirmed failure before provider dispatch, an explicit retry advances the
operation generation and reserves a fresh execution. Background removal and
portrait preparation reuse their already-paid source and do not require another
image slot. Uncertain native provider attempts remain fenced against replay.

## Existing records and rollout

Migrations 0164–0165 associate existing reservations with their visual/portrait
operations, initialize execution leases and add owner activity indexes. They do
not delete or rewrite provider evidence, charge amounts, original reservation
identities or existing binaries. The initial lease grace covers an existing
bounded provider/fallback chain; expired historical execution is audited when
recovered. Apply migrations before releasing the API, worker and web together.

The old local development reservation was left unresolved financially. Its stale
execution can be released without choosing the admin success/refund actions.
Staging and production require their normal migration/deployment process.

## API and MCP

- `GET /api/agent-profiles/generations` lists owned image work.
- `POST /api/agent-profiles/generations/:id/cancel` accepts the exact `source`
  (`reference`, `avatar`, `preparation` or `reservation`) returned by the list.
- MCP exposes `list_agent_generations` with `agents:read`, and
  `cancel_agent_generation` with `agents:read` plus `agents:write`.
- Cross-owner operations return unavailable. A reservation identifier cannot be
  used to bypass cancellation of its linked live job. Financial reconciliation
  stays an audited admin operation.

Tests cover competing starts, pause/exhaustion, queued and dispatched cancellation,
refund idempotence, stale leases, heartbeat fencing, late success, retry admission,
owner isolation and cancellation preserving editor drafts through the real UI.
