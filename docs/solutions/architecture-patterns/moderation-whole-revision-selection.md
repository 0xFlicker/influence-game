---
title: Keep submitted character history separate from effective publication
date: 2026-09-25
module: Agent content moderation
problem_type: architecture
tags: [moderation, revisions, ancestry, concurrency, receipts]
---

# Whole-revision moderation selection

Status: backend implementation with local PostgreSQL coverage; the moderator
HTTP/MCP and browser workflows are not yet implemented. This is an integration
finding, not a claim that the moderation release is complete.

## Problem

A character revision is a full snapshot. Rejecting an image in R2 does not remove
that image from a later R3 that only changes the biography. Replacing the profile
with R1 also must not lose the latest submitted draft or rewrite started games.
Undoing R2 after an approved correction R4 must leave R4 published.

## Implemented model

- `latestContentRevisionId` records submission history; `contentRevisionId`
  selects effective publication. Owner concurrency checks use the latest pointer.
- Record explicit parents under the profile lock. Mark legacy ancestry unknown;
  never infer ordering from UUIDs or tied timestamps.
- Rejection changes the target disposition and holds dependent snapshots.
  Previously resolved dependent work explicitly reopens with a new review cycle
  and an audit event. Old claims are invalidated.
- Choose an allowed, unheld whole snapshot using recorded ancestry. Unknown
  ancestry is withheld conservatively for admin recovery. No field merging.
- After rejection, owner corrections only write immutable intake evidence. They
  do not change the effective profile, competitive revision, ratings, or seats.
- Undo is a compensating action, fenced by the original decision and a current
  preview. It restores disposition without overriding a newer permitted snapshot
  or independently archived identity.

## Lock and receipt boundary

Moderation writes take a short intake advisory lock, then follow existing
game-before-profile lock order. Recheck the waiting game set, current permission,
server lease expiry, disposition, and preview fingerprint after lock waits.
The fingerprint covers publication, latest submission, profile version, and
review state across the character history. A stale inbox version alone is not
enough to detect a concurrent owner edit.

Snapshot application uses the existing competitive-revision service with a
`moderation` trigger. Decision state, audit, profile selection, recalibration,
and waiting-seat reconciliation share one transaction. A failed transaction does
not consume the lease or record a successful decision. A known name conflict
withholds publication and routes the item to admin recovery.

Exact action/submission retries return historical receipts. They never repeat
publication or reacquire expired leases. Receipts distinguish held corrections
from published changes; strict MCP output schemas must include that distinction.

## Scope boundary

The operator chose current profile and future game eligibility only. Existing
historical artwork, trailers, and public object URLs remain unchanged. Historical
media withdrawal is a separate future admin operation. Protected retained evidence
is still required for the inbox. No paid calls or storage deletion occur in the
moderation transaction.

## Coverage and outstanding integration

`packages/api/src/__tests__/moderation-decisions.test.ts` covers dependent holds,
initial rejection, stale previews, lease expiry, name conflicts, explicit reopen,
both actions on rejected content, undo after a newer correction, independent
archive preservation, admission/freeze rejection, and transaction rollback.

Moderation synchronizes the competitive revision even while a profile is archived.
Archival blocks availability and seat reconciliation, but restoring a profile must
reuse its reviewed competitive revision rather than synthesize a runtime-policy
change. The archive → moderation undo → restore regression covers this boundary.

Before enabling the inbox, complete owner draft recovery and safe status,
reversible owner archival, authorized HTTP/MCP evidence and action contracts,
moderator/admin screens, and browser/concurrency verification. Do not mistake
passing service tests for an operator-ready workflow.
