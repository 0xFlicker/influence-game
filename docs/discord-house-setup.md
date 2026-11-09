# The House Discord verification and setup

## Implementation status — November 8, 2026

Verification is deployed in production at application commit
`11b049b35d96c927a853a716741d1c36110c584a` (PR #317). AWS infrastructure is
deployed from `falsefloor/infra` PR #39. The website uses
House login, Discord OAuth (`identify` with PKCE), and explicit account confirmation.
PostgreSQL stores the private one-to-one association and durable role delivery.
The AWS-compatible worker applies cumulative House User, Moderator, Admin and
Sysop roles. A signed Discord `/verify` command returns the website link privately.
Refresh and disconnect are available at `/discord/verify` and linked from Profile.

Live role-change subscriptions and the conversational House agent are not part of
this slice. A trusted controller can resolve fresh House authority through the
internal identity endpoint; a Discord role itself never grants House API access.
The current source of truth for the broader runtime is the
[verification plan](plans/2026-10-25-001-feat-house-discord-verification-plan.md).

## Credentials and configuration

Canonical House credentials are in False Floor Doppler project `overclaw-house`,
config `prd`, operator scope `/Users/user/Development/overclaw/workspace-house`.
`DISCORD_BOT_TOKEN` authenticated successfully on November 8; the older
`social-strategy-agent/dev/DISCORD_HOUSE_BOT_TOKEN` returned 401. The operator added
`DISCORD_CLIENT_SECRET`. Discord accepted an application-only client-credentials
exchange on November 8; that temporary app token was immediately revoked. No
user OAuth authorization or role delivery was performed by this credential check.
Never print values, put them in command arguments, or copy them into browser env.

| Variable | Consumers | Value / purpose |
| --- | --- | --- |
| `DISCORD_APP_ID` | API, interactions, setup | `1521918515752472606` |
| `DISCORD_HOUSE_GUILD_ID` | API, worker, interactions, setup | `1521918107554152468` |
| `DISCORD_CLIENT_SECRET` | Linode API only | OAuth code exchange |
| `DISCORD_REDIRECT_URI` | Linode API only | `https://thehouse.game/discord/callback` in production; exact environment URI |
| `DISCORD_BOT_TOKEN` | AWS worker, operator setup | Discord bot REST access |
| `DISCORD_HOUSE_PUBLIC_KEY` | Interactions | Compare with the application's public key in the developer portal |
| `DISCORD_WORKER_TOKEN` | API and AWS worker | Separate random 32-byte base64url secret, minimum 43 characters |
| `DISCORD_CONTROLLER_TOKEN` | API and future trusted controller | Separate random secret; cannot claim or acknowledge role work |
| `HOUSE_API_URL` | AWS worker | House API origin, e.g. `https://thehouse.game` |
| `HOUSE_WEB_URL` | Interactions | `https://thehouse.game` |
| `DISCORD_ROLE_USER_ID` | AWS worker | Resolve House User ID from SSM at deployment |
| `DISCORD_ROLE_MODERATOR_ID` | AWS worker | Resolve House Moderator ID from SSM at deployment |
| `DISCORD_ROLE_ADMIN_ID` | AWS worker | Resolve House Admin ID from SSM at deployment |
| `DISCORD_ROLE_SYSOP_ID` | AWS worker | Resolve House Sysop ID from SSM at deployment |

### Production role configuration

Verified November 8, 2026 in application `1521918515752472606`, guild
`1521918107554152468`, AWS account `978355607658`, region `us-west-1`.
`DISCORD_HOUSE_GUILD_ID` is present in the production Doppler config above.
Role IDs are non-secret standard-tier SSM `String` parameters, using the existing
House production namespace convention. Credentials remain in Doppler.

| Worker environment variable | SSM parameter | Discord role ID |
| --- | --- | --- |
| `DISCORD_ROLE_USER_ID` | `/house/discord/prod/roles/user` | `1569107229599211650` |
| `DISCORD_ROLE_MODERATOR_ID` | `/house/discord/prod/roles/moderator` | `1521921693646458953` |
| `DISCORD_ROLE_ADMIN_ID` | `/house/discord/prod/roles/admin` | `1521921692392357919` |
| `DISCORD_ROLE_SYSOP_ID` | `/house/discord/prod/roles/sysop` | `1569107230811496518` |

All four roles are unmanaged and have no Administrator permission. Admin was
narrowed to the explicit setup-script permissions, and Admin/Sysop channel
overwrites were updated to preserve the intended access. A readback of the
configured role permissions and channel overwrites showed community access for all
four cumulative tiers, staff access for Moderator and above, and no staff access
for User alone. This is a permission calculation, not a live role-delivery test.
The bot's highest role was position 10; User, Moderator, Admin, and Sysop were at
positions 2, 8, 9, and 1 respectively. Existing human memberships were not changed.

On November 8, 2026, the bot role was verified with explicit Manage Roles enabled
and Administrator disabled. Its role remains above all four verification roles.
Live role delivery still needs to be verified after deployment. Preserve independent
owner and recovery access.

The `HouseDiscord-prod` stack now owns `house-discord-prod-interactions` and
`house-discord-prod-worker`. Its definitions and deployment runbook live in
[`falsefloor/infra`](https://github.com/falsefloor/infra/blob/main/docs/house-discord.md).
CloudFormation resolves the four role parameters into the worker environment;
readback confirmed all four IDs above. The worker's AWS adapter reads only its bot
and worker credentials from encrypted SSM parameters on each invocation. Identity,
role policy and durable work remain in the House application and PostgreSQL.

The two Doppler projects belong to different workplaces, so cross-project secret
references cannot be used. The infrastructure operator script
`scripts/sync-house-discord.py` materializes the selected canonical House secrets
into `social-strategy-agent/prd` for the Linode API and into the two SSM
SecureString parameters `/house/discord/prod/credentials/bot-token` and
`/house/discord/prod/credentials/worker-token`. Run it after credential rotation
and reload the API through the existing release controller. It generates missing
worker/controller tokens only once and verifies copies without logging values.

The production OAuth callback `https://thehouse.game/discord/callback` is
registered. Discord accepted its signed validation of the interactions endpoint
`https://fawne5hhd7kvx5s4smkycpfwh40adhwt.lambda-url.us-west-1.on.aws/`.
Unsigned requests returned HTTP 401. The guild-only `/verify` command is registered
as `1569117100516311183`. Effective `@everyone` permissions permit viewing and
using application commands in `#general`, `#influence-lobby`, `#watch-parties`,
and `#agent-lab`, so an unverified member can start there. No setup messages or
human memberships were changed.

EventBridge invokes one durable delivery every minute. The schedule
`house-discord-prod-role-delivery` is enabled. A direct production worker invocation
returned `idle`, proving encrypted SSM credential access and the database-backed
API queue. Production page/callback responses and the separate human, worker, and
controller authorization boundaries passed live checks. Actual human OAuth and
role delivery remain the operator's sysop acceptance test.
The stack uses the account's shared Lambda concurrency quota of 10. Error,
throttle and delivery-retry alarms are present, with no notification destination
configured. Logs retain 30 days. Source pins and artifact hashes are recorded by
the infrastructure build; the deployed application worker source matches PR #317.

Keep separate environment credentials and Discord guilds for development/staging;
do not run automatic QA against the production guild. No Discord credentials are
needed in CI. The House API needs neither the bot token nor AWS credentials for
verification. The worker needs neither PostgreSQL credentials nor the OAuth secret.

### Release evidence

- [Application CI](https://github.com/0xFlicker/influence-game/actions/runs/42531010046) and [browser coverage](https://github.com/0xFlicker/influence-game/actions/runs/42531010038) passed on the merged revision.
- [Staging deployment](https://github.com/0xFlicker/linode-iac/actions/runs/42532513338) and [live E2E qualification](https://github.com/0xFlicker/influence-game/actions/runs/42532897614) passed.
- [Protected production approval](https://github.com/0xFlicker/influence-game/actions/runs/42533234256) and [production deployment](https://github.com/0xFlicker/linode-iac/actions/runs/42533343869) completed. Host evidence reached terminal accepted state, with the exact qualified image family and migration set. Public health reports the same application commit.
- `HouseDiscord-prod` reached `CREATE_COMPLETE`; both Lambda functions are active. The worker source pin `c6cc4c5b3499768345ae0b642c29df40c0946a0a` is byte-equivalent in its runtime files to the merged application commit.

To test: run `/verify` in `#general`, or open
[the verification page](https://thehouse.game/discord/verify), sign into the House,
authorize Discord, and confirm both accounts. Allow about one minute for delivery.
A House sysop receives all four House roles. Use **Refresh roles** for subsequent
House role changes; real-time role-change subscriptions are outside v0.

## Role and identity semantics

Any authenticated human House account receives User. Moderator adds Moderator;
Admin adds Moderator and Admin; Sysop receives all four. `gamer`, `player` and
`producer` do not imply a staff tier. Existing House signup, invite, and legal
acceptance requirements still apply. Service principals cannot verify.

OAuth state is random, hashed at rest, expires after ten minutes, and is bound to
the House account, browser nonce, application, redirect URI and guild. The nonce
also serves as the PKCE verifier. The callback is an isolated document with no
analytics or external resources; it clears the URL before returning to the app.
The confirmation screen names both accounts. A successful exchange alone creates
no connection. OAuth access/refresh tokens are never stored. One House account and
one Discord user may each have only one connection.

The connection and delivery cursor commit together. Delivery leases survive API
restarts, retry with backoff, respect Discord rate limits, and check current roles
before writes and acknowledgement. Only the four configured roles are managed;
unrelated roles are preserved. Removals precede grants. Screening-pending members
receive no grants. Missing members retain their link and can join then refresh.

Discord Administrator permission is never assigned automatically. Every managed
role must be below the bot, unmanaged, and free of Administrator. The production
House Admin role now uses the setup script’s explicit permissions instead of
Administrator.
An independently maintained owner/recovery role can retain ultimate server control.

Disconnect disables identity resolution immediately, then queues role removal. The
link stays reserved until removal succeeds, preventing account reuse while access
remains. Only Discord's explicit Unknown Member response counts as an absent member; an
unknown guild or missing bot access leaves cleanup pending. Verification attempts are purged
after expiry and audit entries after 90 days by bounded scheduled cleanup. Identity
and role status are private API responses, not public profile fields.

Role changes after a successful delivery require **Refresh roles** in v0. The
UI and `syncStatus` describe completion of the last requested update, not continuous
agreement between current House RBAC and Discord. Trusted
bot actions must resolve current database authority every time, so a demoted sysop
loses bot authority even while their Discord role projection is stale. Future
real-time syncing should enqueue the same durable revision on RBAC changes.

## Operator setup script

This script changes the live guild, including roles, channels, safety settings,
onboarding, welcome messages, and a guild-scoped `/verify` command. It is not a
read-only credential check. Review the diff and target guild before running it.
It does not assign staff roles to humans or create an invite link.

```bash
doppler run --scope /Users/user/Development/overclaw/workspace-house \
  --project overclaw-house --config prd -- bun scripts/setup-house-discord.ts
```

The whole-server setup script needs broad setup permissions. The production bot
role is above the four verification roles, has Manage Roles enabled, and does not
have Administrator. Verify live role delivery after deployment.
Keep Community and Rules Screening enabled. Check rules, announcements and AutoMod
channels and review onboarding prompts in the Discord UI. A bot used only for
verification needs no Message Content or privileged member-list gateway intent.

## Deployment order

1. Register the exact callback `https://thehouse.game/discord/callback` on The House
   application in the Discord developer portal. Configure staging separately.
2. The four verification roles, channel overwrites, bot hierarchy, bot permissions
   and SSM role IDs are prepared as documented above. Recheck them before rollout
   and verify live delivery afterward.
3. Materialize only the API keys from Doppler into the Linode API runtime secrets.
   Existing `linode-iac` production environment generation already passes private
   keys to API and filters web keys; it does not need a new proxy route. Existing
   `/api/*` routing reaches API; `/discord/callback` and `/discord/verify` reach Next.
   Ensure proxy/error/APM logging excludes callback query strings and OAuth bodies.
4. Release API/web using the normal staging and production approval process. The
   standard migrator applies `0166_discord_verification.sql`; it adds three tables
   and does not move existing account/game data. Deploying the code enables the
   flow; there is no feature flag.
5. Build the AWS handler with `bun run discord:build`. The artifact is
   `.renders/house-discord-lambda/index.mjs`, handler `index.handler`, Node runtime.
   Provision through the False Floor AWS IaC owner in account `978355607658`,
   `us-west-1`: HTTPS Lambda function URL for interactions and a scheduled invocation
   (`source: aws.events`) every minute for delivery. Use at least 60 seconds timeout;
   the worker bounds external role work to 50 seconds with two-minute leases. One
   invocation processes one connection; queue latency increases with a backlog.
   Resolve the four SSM parameters above into the matching worker environment
   variables in the deployment IaC; the worker does not fetch them itself.
   Give the scheduled worker reserved concurrency one, logs with bounded retention,
   and alarms on errors/throttles. If sharing the handler bundle between functions,
   use separate functions/config so worker execution cannot delay `/verify`.
6. Supply only each function's listed secrets, publish the interactions URL in the
   Discord developer portal, and verify the signed PING handshake. Never log the
   raw interaction body. There must be one owner of interactions for this app.
7. Complete the live proof below before announcing verification. The Discord roles,
   their relevant channel overwrites, the Doppler guild ID and SSM parameters have
   been configured. Worker IaC wiring, Linode runtime secrets, portal settings and
   the live rollout remain release work.

## Live proof and recovery

Use a consented ordinary account and the operator's real House sysop account.
From the guild, invoke `/verify`, log into House, authorize Discord, inspect both
identities, confirm, and wait for server roles. Confirm sysop resolves from fresh
House RBAC through the controller endpoint. Verify an ordinary user gets no staff
roles, unrelated roles survive, membership screening remains effective, and the
same Discord identity cannot connect to another House account.

Test refresh, role demotion plus refresh, disconnect, retry after a deliberate
worker outage, and disconnect while the member is absent. The UI distinguishes
connection success from completed delivery and exposes a safe retry status.

Watch pending/retrying connections, oldest `next_attempt_at`, attempts and safe
`last_error` codes in PostgreSQL; use Lambda error/throttle alarms as a second
signal. Never inspect OAuth codes or token values in logs. An API/worker outage
leaves durable work pending. Repair configuration and refresh, or let backoff retry.
Stop the schedule before replacing worker credentials or managed-role mappings.
Do not change managed-role IDs while links retain old roles: first remove the old
managed grants. Do not roll back the additive database tables after users connect;
retain queued cleanup and audit state. Restore the previous app/worker release
through the normal deployment process, then reconcile pending role delivery.

## Validation

```bash
bun run test
bun run test:postgres
bun run check
bun run discord:build
cd packages/api
DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml \
  ./src/e2e/discord-verification.e2e.test.ts
```

DB tests exercise authentication, account/browser binding, uniqueness races,
expiry, fresh role resolution, lease recovery, disconnect, and the worker against
mocked Discord with the actual House API/PostgreSQL. Interaction tests sign real
Ed25519 messages. Browser coverage uses isolated PostgreSQL and a synthetic Discord
boundary; it proves website confirmation, delivery status, refresh and disconnect,
not a real Discord grant. Screenshots are under `.renders/discord-verification/`.

Protocol reference: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).

## Focused account-linker interface

The verification page uses a standalone full-height account-linker presentation.
The shared site footer is omitted only on `/discord/verify`; other account and
site pages retain it. Paired House and Discord identity cards stay visible through
confirmation, delivery, and disconnect. Current House roles appear as individual
badges, with Sysop emphasized. The success message describes the last requested
role update; it does not imply ongoing role synchronization.

The existing authenticated confirmation, membership-screening retries, explicit
role refresh, and disconnect confirmation remain intact. Browser coverage exercises
these states against an isolated PostgreSQL database with a synthetic Discord
boundary, and captures mobile/desktop screenshots under `.renders/discord-verification/`.
