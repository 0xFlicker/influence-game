---
module: Authentication
tags: [clerk, authentication, session-recovery, nextjs]
problem_type: integration_issue
---

# Keep Clerk browser verification separate from House session ownership

## Evidence

On 2026-10-26, production signup remained on “Checking…” after email-code
submission. A subsequent sign-in returned Clerk HTTP 400 `session_exists` with an
active provider session. The House form kept displaying “Signing in…” because
the password helper returned `provider_error` without surfacing non-field errors.

The original verification request was no longer available in DevTools, so its
exact failure cannot be proven from that capture. The installed Next.js adapter
also contains a concrete hanging path: before session activation it wraps
`invalidateCacheAction().then(resolve)` in a promise without rejecting on failure.
The page had a `/games` 404, consistent with—but not proof of—that path.

## Resolution

- Use the already-pinned `@clerk/react` provider and hooks directly. House sessions
  are issued by the API; Clerk Next.js cache invalidation and middleware add no
  authority and must not gate that exchange.
- Offer explicit continuation of an active session with a verified primary email.
  Recover `session_exists` only for the matching submitted identity, then let the
  API verify the provider assertion and resolve the durable account.
- Recovery exchanges an existing credential. It must not create a House account
  without the current consent flow or bypass linking and invite requirements.
- Throw provider errors into the existing form error boundary. Preserve field
  errors without duplicating them in the alert.
- After 30 seconds, replace the disabled form with a reload recovery action.
  Do not start competing mutations while an old operation is unresolved. Reject
  cancelled authentication attempts before exchanging a late provider token.
- Keep the legacy CAPTCHA mount in the flow panel across steps.

## Verification

Provider-free helper tests cover `session_exists`, identity mismatch, unverified
and inactive sessions, and non-field errors. Rendered tests use real Clerk hooks
with fixture resources to exercise continuation, required legal consent, stalled
operations, and cancellation. These tests do not substitute for a post-deployment
real-provider signup/sign-in smoke test.
