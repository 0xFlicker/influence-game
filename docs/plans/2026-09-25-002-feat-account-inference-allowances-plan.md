---
title: Account spending visibility and refillable inference allowances
type: feat
date: 2026-09-25
status: implemented
---

# Account spending and inference allowances

Approved scope: build admin spending visibility first, then account allowance admission and controls. All accounts begin on Free. Players never see numeric balances; explicit exhausted generation opens a contact dialog. No paid tiers, subscription integration, unified credits, or game charging in this increment.

## Policy

- Free grants 100 text operations and 25 images once. Existing accounts receive a fresh allowance; historical spend is not deducted.
- Friends and Family grants the same quantities monthly, anchored to UTC assignment anniversaries, clamped to month end without drifting. Missed periods do not accumulate.
- Policies are stored records, independent of roles. Manual grants persist across renewals and assignments. Recurring allowance is consumed first. Plan edits affect future grants; account assignment explicitly restarts its period.
- Default burst caps are five text starts per minute and five image starts per rolling day, plus one active operation of each category. Admin overrides can increase these caps. A refill does not implicitly remove throttles.
- Admins/sysops manage plans, account assignments, grants, overrides, generation pauses, and evidence-based reservation reconciliation. Moderators cannot. Only sysops alter exemptions or sysop accounts.
- Preserve existing sysop image exemptions using fresh database authority; text is not exempt. Restrictions take precedence.

## Accounting and admission

Report text, legacy avatar, visual generation/localization, and owner-learning source journals without duplicating their records. Display estimated versus actual dollars and unpriced attempt counts. Older text has no reconstruction source. Game costs remain on the existing game cost panel, never attributed to each participant.

Text operations have durable request identities, input hashes, bounded provider attempts, usage evidence, and result recovery. SDK retries are disabled for these calls. Reserve allowance before dispatch. Concurrent admission and account mutations serialize per account. Confirmed failures refund; transport ambiguity holds the reservation. Operators must confirm a provider outcome before reconciliation. A provider call already admitted may finish after a pause; future dispatches must recheck the account.

Owner learning retains earned entitlements. Cropping, polling, reads, and exact generation recovery do not debit allowance. Image localization is reported as spend but does not debit a second generation unit.

## Interfaces

- `/admin/inference`: URL-persisted account search, sorting, windows, pagination, operation/attempt details, and account controls.
- `/api/admin/inference/usage`, `/plans`, `/accounts/:id`, `/actions`: current-role authorization, private uncached reads, audited idempotent commands.
- Generation errors distinguish exhausted, paused, throttled, busy, and recovery-required without exposing balances. Exhausted/paused requests link to Discord, support email, and developer X.

## Verification and rollout

Migrations 0096–0098 add text evidence, account policies/reservations, and grant audits. No production migration or provider calls are authorized by local validation. Deploy spending visibility before enforcement as separate release increments; there are no runtime feature flags. This working branch contains both increments and must be split into release commits before promotion if independent deployment is required.

Required checks: typecheck/lint, provider-free suite, PostgreSQL suite, focused reservation and policy tests, and an isolated browser journey covering preserved owner drafts and admin refills. Test monthly boundaries, concurrency, retries, manual grants, stale roles, pause races, unknown cost, and source deduplication.

## Local verification (2026-09-25)

The provider-free baseline passed with 1,981 tests and five skips. The PostgreSQL baseline passed with 1,695 tests. Subsequent focused service checks passed (97 tests), including the final allowance and text-operation suite (10 tests). The isolated provider-free browser journey passed: exhaustion preserves the draft, admin refill persists, and ordinary players cannot read usage administration. A stale isolated Next build cache caused intermediate compilation timeouts; replacing only that test cache restored the passing journey.

At the operator's request, the usage panel omits the historical-coverage explanatory paragraph and updated timestamp. Coverage metadata remains available in the protected API, and unknown costs remain explicitly unpriced. No production migration, deployment, or paid provider call was performed.
