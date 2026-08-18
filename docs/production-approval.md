# Production approval

Influence is the human approval surface for application production changes. It does not receive production host credentials, raw bootstrap inventory, registry mutation authority, Doppler tokens, or deployment-control credentials. Private `linode-iac` qualifies requests, verifies approval receipts, and owns execution evidence.

The GitHub App must grant read-only Actions and Contents access for provenance plus read-only Environments access for the zero-environment-secrets check. The designated repository ruleset is readable through GitHub's metadata permission; its internal checks and bypass policy remain operator-owned. Workflows mint the policy token separately and use it only for these checks. Callback dispatch uses a separate Contents-write token; the App has no Administration, Deployments, or Packages permission.

## Repository configuration

Linode approval receivers may be enabled only after these conditions hold:

1. Merge the approval broker into `influence-game/main`.
2. Keep repository ruleset `20924439` active and targeting `main`. Its internal rules are controlled by the repository operator and are not interpreted as deployment authority.
3. Create the `production` environment with required reviewer `0xFlicker`, prevent self-review enabled, administrator bypass disabled, and no environment secrets. The broker independently requires the designated active `main` ruleset and exact current `main` workflow revision, so environment branch filters are not approval authority.
4. Preserve the successful sole-maintainer proof evidence from [run `31999647070`, attempt 1](https://github.com/0xFlicker/influence-game/actions/runs/31999647070): App actor `flick-ai-dev[bot]` ID `270169057`, reviewer `0xFlicker`, current `main`, no callback, and no host authority.
5. Keep the temporary proof workflow removed; production approval is available only through the repository-dispatch broker.

The broker itself accepts only `repository_dispatch`; it does not expose a human `workflow_dispatch` entrypoint. GitHub reruns retain the original repository-dispatch provenance and are accepted when the exact rerun attempt succeeds.

## Approval flow

Linode uploads one immutable `production-approval-request.json` per attempt and dispatches only its run, attempt, artifact, and content digest. Influence waits for that exact attempt to succeed, verifies its trusted workflow and actor, checks both the GitHub artifact archive digest and JSON digest, and validates the operation schema.

The protected job repeats the download and validation after approval, rechecks the current environment and designated active `main` ruleset, verifies approval history against user ID `97764360`, and uploads `production-approval.json`. Its callback again contains only artifact locators and a digest.

Linode independently repeats the proof, compares the embedded request with the original private artifact, rejects controller drift, and writes a private one-time consumption marker before production credentials become available.

Supported operations are:

- `candidate`: one exact E2E-qualified image family.
- `bootstrap-conversion`: conversion bound to the exact private inventory digest and controller. Recovery and inventory collection run directly from the explicit Linode bootstrap dispatch and do not require a separate public approval.
- `break-glass`: one pre-resolved exact image family and public-safe reason.

The Influence run proves approval handoff only. Linode's terminal artifact and host journal prove execution, restoration, or deployment.

## Retry rules

Workflow attempts are evidence, not an authority veto. A failed GitHub job may use **Re-run failed jobs**; artifacts are attempt-specific, and Linode binds every successful rerun to its exact attempt. The same immutable request maps to one durable private operation claim, so an approval callback or execution rerun resumes the original host transaction or returns success when it is already accepted.

A rejection, cancellation, expiry, controller drift, changed request, or terminally restored/aborted host transaction requires a fresh request:

- Candidate retries repeat staging E2E and qualification.
- Bootstrap retries rerun inventory, then request a fresh conversion approval.
- Break-glass retries submit a new SHA and reason request.

Duplicate callback delivery and approval-job reruns are safe because Linode serializes by immutable request content and reuses the original operation claim. Workflows intentionally contain no custom retry loops; ordinary infrastructure failures remain visible and are retried with GitHub's controls.
