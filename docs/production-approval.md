# Production approval

Influence is the human approval surface for application production changes. It does not receive production host credentials, raw bootstrap inventory, registry mutation authority, Doppler tokens, or deployment-control credentials. Private `linode-iac` qualifies requests, verifies approval receipts, and owns execution evidence.

The GitHub App must grant read-only Actions and Contents access for provenance plus read-only Environments access for the zero-environment-secrets check. The designated repository ruleset is readable through GitHub's metadata permission; its internal checks and bypass policy remain operator-owned. Workflows mint the policy token separately and use it only for these checks. Callback dispatch uses a separate Contents-write token; the App has no Administration, Deployments, or Packages permission.

## Repository configuration

Before enabling Linode approval receivers:

1. Merge the approval broker into `influence-game/main`.
2. Keep repository ruleset `20924439` active and targeting `main`. Its internal rules are controlled by the repository operator and are not interpreted as deployment authority.
3. Create the `production` environment with required reviewer `0xFlicker`, prevent self-review enabled, administrator bypass disabled, protected branches only, and no environment secrets.
4. Run `TEMPORARY: Production Approval Principal Proof`. The first human-authored job dispatches a second App-authored run. Approve only the second run; it verifies its approval history and live policy before recording `flick-ai-dev[bot]` ID `270169057`, reviewer `0xFlicker`, no callback, and no host authority.
5. Remove the temporary proof workflow before enabling Linode execution receivers.

The broker itself accepts only `repository_dispatch`. A human-started rerun or workflow dispatch is never approval authority.

## Approval flow

Linode uploads one immutable `production-approval-request.json` and dispatches only its run, attempt, artifact, and content digest. Influence waits for that exact first-attempt run to succeed, verifies its trusted workflow and actor, checks both the GitHub artifact archive digest and JSON digest, and validates the operation schema.

The protected job repeats the download and validation after approval, rechecks the current environment and designated active `main` ruleset, verifies approval history against user ID `97764360`, and uploads `production-approval.json`. Its callback again contains only artifact locators and a digest.

Linode independently repeats the proof, compares the embedded request with the original private artifact, rejects controller drift, and writes a private one-time consumption marker before production credentials become available.

Supported operations are:

- `candidate`: one exact E2E-qualified image family.
- `bootstrap-inventory`: durable recovery plus private inventory collection.
- `bootstrap-conversion`: conversion bound to the exact private inventory digest and controller.
- `break-glass`: one pre-resolved exact image family and public-safe reason.

The Influence run proves approval handoff only. Linode's terminal artifact and host journal prove execution, restoration, or deployment.

## Retry rules

Every approval and source request must be workflow attempt 1. Rejection, cancellation, expiry, verifier failure, controller drift, or a consumed authority requires a fresh request:

- Candidate retries repeat staging E2E and qualification.
- Bootstrap retries restart the inventory and two-approval cycle.
- Break-glass retries submit a new SHA and reason request.

Never rerun an approval job or reuse an approval artifact. Duplicate callback delivery is safe because Linode serializes and consumes by the exact approval artifact ID.
