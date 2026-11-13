# Account deletion

Account deletion closes the human account, removes its public profile and its
standalone agent profiles, and clears active account identity fields. It does
not delete agents' recorded participation or recursively delete games.

## Approved behavior

- Keep character names and generated portraits in historical games. Remove
  current owner identity and links. There is no user-upload or voice-cloning
  exception workflow in this feature.
- Preserve all existing entries, including the standing free queue, waiting
  games, readied season games, and championships. They may start and finish.
  Keep their profiles, revisions, configuration, assets, results, and dialogue.
- End account access across sessions and MCP/OAuth. A future signup is a new
  account, with no restoration of the old account or agent ownership.
- Keep canonical events and frozen media unchanged. Recursive game deletion
  and historical-media takedowns are separate operations.

## User flow and API

Profile settings → Delete account explains retained game content and existing
entries, requires typing `DELETE`, and submits `DELETE /api/account` with
`{"confirmation":"DELETE"}` and an Influence session bearer token.

The endpoint requires a session issued within ten minutes. An older session
gets `403 REAUTH_REQUIRED`; sign out and sign back in, then retry. Current legal
acceptance is not required to leave. No target user ID is accepted. HTTP 202
means the account is closed and external cleanup is pending, not that every
processor has physically erased every copy. The browser signs out across tabs
using the existing session coordinator and resets its analytics identity.

## Storage and continuity

`users.deleted_at` is irreversible. The row is a non-login continuity record:
email, wallet association, handle, and display name are null. Private internal
IDs, public UUID, ratings and game relationships remain. Older internal IDs may
themselves contain legacy provider identifiers; these are restricted operational
references, not anonymized data. Do not describe this operation as total erasure
of every identifier or all user-authored content.

Credential bindings, verified email claims, OAuth codes/access/refresh tokens,
account roles, pending Discord verification, attribution links, unused invite
codes, and unaccepted entry intents are removed. Owner-name fields in current
competition receipts and season honors are cleared. Game acceptance, queue
eligibility, results, dialogue, frozen character revisions, private game evidence,
and already-created editorial media remain intact. Legacy immutable wallet-role
audit and frozen operational snapshots remain restricted historical records;
they are not a source of authentication authority.

Discovery uses account visibility separately from character eligibility.
`publiclyVisibleAgentContent()` hides standalone profiles; `eligibleAgentContent()`
continues to admit existing entries. Replay previews retain the character but
omit profile links and owner identity. Public identity resolution and both
account leaderboards exclude deleted accounts. Database fences prevent stale
requests from recreating credentials or identity fields after deletion.

## Connected services

`account_deletion_tasks` durably queues Clerk, Privy, and PostHog cleanup. The
game worker processes tasks every ten seconds with row locks, capped retry delays,
and sanitized errors. Retry targets are cleared after provider acknowledgement.
PostHog acknowledges asynchronous erasure; it is not a physical-erasure receipt.
Farcaster is an independent identity: only its House binding is deleted.

Discord uses the existing durable role-removal process. The link immediately
loses House authority; its Discord ID remains only until managed roles are
removed or membership is confirmed absent. Deletion does not delete the person's
Discord account. No new identifying Discord audit is written on completion.

Required deployment configuration:

- Existing `CLERK_SECRET_KEY`, `PRIVY_APP_ID`, and `PRIVY_APP_SECRET` for the
  providers actually linked to the account.
- `POSTHOG_PROJECT_ID` and `POSTHOG_PERSONAL_API_KEY` with person read/delete
  permission, and `POSTHOG_API_HOST` if different from `https://us.posthog.com`.
  The ingestion token cannot perform erasure. Missing configuration remains a
  visible retry, never a successful cleanup.

Review pending work without printing target identifiers:

```sql
SELECT provider, count(*), min(next_attempt_at), max(attempts)
FROM account_deletion_tasks WHERE completed_at IS NULL GROUP BY provider;
SELECT count(*) FROM discord_connections WHERE disconnecting;
```

Account-linked click IDs, browser user agent, MCP client IDs and public analytics
identity are removed from local conversion records. Campaign labels and
authoritative historical outcome totals remain; delivery is suppressed. New
tracking cannot repopulate the deleted account. Already-delivered advertising
platform records, restricted audits and backups are subject to the separate
privacy-request/retention process; this release does not claim universal
third-party erasure. Restore procedures must reapply account deletion records
before reopening access or restarting external delivery.

## Retention criteria and manual review

False Floor's service operator owns retention review. Review retained personal
information at least annually and when a privacy request, resolved dispute,
provider change, or service closure changes the need for it. Record the category,
purpose, decision, next review date, and any applicable legal hold without copying
unnecessary personal information into the review record. A legal hold must have a
specific reason and be reviewed when that reason ends; it is not blanket permission
to retain every record indefinitely.

| Retained category | Purpose and end/review criteria |
| --- | --- |
| Deleted-account internal IDs, public UUIDs, ratings and game relationships | Maintain accepted entries, results and historical replay relationships. Retain while the corresponding history is maintained and the link is necessary; review whether each identifier is still needed. A legacy provider identifier requires its own necessity assessment, not an assumption that all IDs are anonymous. |
| Pending provider cleanup targets and Discord IDs | Complete deletion or role removal. Existing code clears targets after acknowledgement and removes the Discord connection after removal/confirmed absence. Review unresolved retries weekly until resolved. |
| Completed cleanup receipts | Demonstrate the request was handled and diagnose disputes. Retain only the minimal receipt while needed for an unresolved request, concrete dispute, or applicable legal obligation; review annually and after resolution. |
| Restricted wallet-role audits, frozen operational snapshots and private provider evidence | Investigate specific security issues, establish accepted game integrity, or resolve disputes. Review separately from public replay content; retain identifying details only while necessary for that purpose or a documented legal hold. Restricted access alone is not a retention justification. |
| Historical characters, dialogue, portraits and editorial materials | Maintain game history and the permitted editorial/promotional uses. Account closure does not itself remove them. Review personal information within them on request and when its use ends; the content license does not override applicable privacy rights. |
| Delivered advertising-platform data | Handle applicable privacy requests under the relevant platform process. Local suppression does not establish remote erasure. Verify each platform's retention settings and request outcome rather than treating a local account deletion as completion. |
| Backups | Disaster recovery only. Retain for the configured recovery window, then expire through the backup lifecycle. Confirm and record the actual database and object-version lifecycle periods; they have not been verified in this review. Reapply deletion records before restoring access or delivery. |

These are operator review criteria, not a new automated purge implementation or
a claim that all existing records already meet them. Where a review identifies
information that must be removed and existing tools cannot safely do so, record
and escalate that implementation need in time to meet the applicable deadline.
Do not alter canonical game history ad hoc. New deletion mechanisms are outside
this wording change.

This purpose-based approach follows the [ICO's storage-limitation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/);
it does not assume UK law applies solely because the service is accessible there.

## Connected-service review — November 12, 2026

Source inspection confirms the following existing paths; this is not a receipt
of production erasure or verification of deployed credentials:

- `services/account-deletion.ts` queues bound Clerk/Privy identities and the
  PostHog public ID in the same transaction that closes the local account.
- `services/account-deletion-worker.ts` calls Clerk's user DELETE endpoint,
  Privy's `deleteUser`, and PostHog's person DELETE with `delete_events=true`
  and `delete_recordings=true`. Failed requests retain targets for retry; success
  clears the target. Clerk/Privy not-found responses are treated as complete.
- `index.ts` schedules the cleanup worker in an active game-worker process;
  checking the gateway alone cannot establish cleanup is running.
- The account-deletion PostgreSQL tests inject a deterministic executor to
  verify retry/acknowledgement behavior. They do not contact those providers.
- Discord revokes House authority immediately and uses its existing role-removal
  queue. Farcaster's independent account is not deleted. Previously delivered
  advertising records are not erased by this worker.

Clerk documents the [user DELETE endpoint](https://clerk.com/docs/reference/backend/user/delete-user).
PostHog documents the [person deletion flags and asynchronous processing](https://posthog.com/docs/data/persons).
Provider acknowledgement must not be described as proof of physical erasure.

Read-only Doppler name checks on November 12 found `CLERK_SECRET_KEY`,
`PRIVY_APP_ID` and `PRIVY_APP_SECRET` in both `social-strategy-agent/stg` and
`social-strategy-agent/prd`. Neither config contained `POSTHOG_PROJECT_ID` or
`POSTHOG_PERSONAL_API_KEY`. Unless separately injected by the hosts, PostHog
cleanup cannot complete with those configurations. `POSTHOG_API_HOST` is also
absent, which is acceptable for the default US endpoint. No values were printed
or credentials changed; presence does not prove validity or permissions.

Read-only checks of the running staging and production game-worker containers
confirmed the same credential presence/absence. Both workers were healthy. In
each environment, `account_deletion_tasks` contained zero rows and Discord had
zero disconnecting connections. There is therefore no current queued backlog,
but also no completed provider-cleanup receipt in those tables to validate a
real deletion. PostHog cleanup needs both missing settings before it can succeed.
These checks used aggregate queries in read-only transactions; no account or
provider data was deleted.

Outstanding operational evidence: credential permissions, provider completion for an
explicitly approved disposable account, and actual backup/provider retention
settings. No live account deletion is authorized by this review. Use the aggregate
queries above; keep account identifiers and secrets out of PRs and logs.

## Verification and release

Use the disposable PostgreSQL test database, never a real user account:

```sh
cd packages/api
bun test src/__tests__/account-deletion.test.ts src/__tests__/free-queue.test.ts --max-concurrency 1
bun test src/__tests__/influence-production-source.test.ts src/__tests__/werewolf-production-source.test.ts --max-concurrency 1
```

Run root `bun run test`, `bun run test:postgres`, and `bun run check` before merge.
External provider deletion is not part of required tests. Before claiming this
works in production, deploy the migration and code together, configure erasure
credentials, and verify cleanup with an explicitly approved disposable account.
No game presentation, timing, dialogue, or frozen source changes are intended;
existing selections, bundles and MP4s do not require regeneration for deletion.
The production-source regressions compare accepted source hashes, catalog,
dialogue and frame/window content before and after deleting a character's owner.
