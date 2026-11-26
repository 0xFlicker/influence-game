# Signup capacity and account email

New House accounts use one PostgreSQL token bucket. The initial rate and
capacity are 25. People → Signups sets the number of slots per 24 hours and the
maximum balance. The bucket starts full and refills continuously. A rate
change settles elapsed refill at the old rate before applying the new capacity.
The signup panel checks availability before asking for email, password, or an
invite code. When full, it shows an estimated next slot and leaves sign-in
available. The estimate does not reserve a slot. If the last slot is taken
during signup, the same panel shows the wait and preserves verified progress.
The API checks availability for new accounts before requesting an invite code
and claims the slot when account creation commits.

People → Invites issues campaign links. Keep the link fragment when adding
campaign query parameters. Links work during their scheduled window. A browser
session issued during that window can bypass the bucket once in the following
24 hours. Closing the campaign stops new issuance. Campaign attribution and
its consent rules are independent of signup admission.

All new accounts require Cloudflare Turnstile. Configure a Managed widget per
environment and allow the hostname from the API's existing `WEB_BASE_URL`.
Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the web runtime and
`TURNSTILE_SECRET_KEY` in the API. The API checks that same hostname and the
`house_signup` action. With separate browser and API origins, use same-site HTTPS
and include the exact web origin in `CORS_ORIGINS`. The default same-origin
proxy works for campaign cookies. Keep the site key public and the secret
restricted to the API environment.

## Account support

People → Users accepts an exact email lookup and opens the account by its public
ID. A conflict requires resolving the account outside this lookup flow. Use the
account page and type its current confirmation name to close the account. Only
sysops can close another admin or sysop account. The last sysop and service
principals are protected from deletion. See [account deletion](../account-deletion.md)
for preservation of games and asynchronous provider cleanup.

## Email migration

Provision a different persistent 32-byte random base64 key in each environment
as `ACCOUNT_EMAIL_HMAC_KEY`. Supply the same key to every API, game worker,
and migration process connected to that environment's database. Store it in
the runtime secret manager, outside PostgreSQL. The migration writes a
key-check value so a changed or missing key fails startup. Retain the key
independently of database backups and verify access during recovery rehearsals.

1. Rehearse against a disposable copy of the old schema with synthetic email,
   conflicting claims, active accounts and deleted-account fixtures.
2. Select the approved exact API/web/worker images and migration set. Verify
   stopping and recovering writers through the existing release controls.
   Drain active games, enter maintenance, and stop every application writer
   before changing the live database. Verify the backup and restore procedure
   and allow disk and WAL headroom for rewriting the affected tables.
3. With writers stopped, invoke the exact candidate image's migration command
   with its environment configuration and database connection.
   `bun dist/migrate.js --account-email-cutover` runs the transactional
   backfill and drops the plaintext columns, then rewrites the tables.
   Ordinary runtime startup rejects the incompatible upgrade.
4. Verify aggregate hash coverage, absence of the plaintext columns, working
   Clerk and Privy matching, admin lookup and verification against the candidate
   privately. Start the exact candidate API and workers and restore ingress
   through the maintenance release controls after those checks pass.
5. Record where plaintext-era backups, WAL and logs can persist and their
   retention deadlines. Keep access restricted. Before reopening a restored
   plaintext-era database, reapply this cutover and account deletions with the
   environment's key. After candidate writes, recover forward.

The rolling release gate rejects the email schema cutover. The existing offline
controller recognizes the earlier payload-storage migration. Qualify an
account-email maintenance procedure on staging before requesting production
approval for the exact candidate. Widget provisioning and plaintext-era backup
retention are environment operations.
