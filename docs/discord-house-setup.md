# The House Discord Setup

The House Discord is configured by an idempotent operator script that uses a
Discord bot token. Do not automate this with a personal Discord user token.

## Current credential status — October 25, 2026

The original `social-strategy-agent/dev/DISCORD_HOUSE_BOT_TOKEN` below was checked
read-only and returned HTTP 401. A working token already exists in the False Floor
Doppler project `overclaw-house`, config `prd`, as `DISCORD_BOT_TOKEN`, under the
operator's scope `/Users/user/Development/overclaw/workspace-house`. It authenticates
as The House application `1521918515752472606` and can access The House guild
`1521918107554152468`. No token reset was necessary.

The script still expects the original environment variable names; its historical
command below is not a working credential configuration as currently stored. Do
not rerun whole-server setup just to validate credentials. The bot has no registered
commands or interactions endpoint, and account verification is not implemented.
See the [verification and runtime plan](plans/2026-10-25-001-feat-house-discord-verification-plan.md)
for the canonical secret source, current inventory, and proposed rollout.

## Required Secrets

The script expects the following secrets in the Doppler `dev` config for the
`social-strategy-agent` project:

- `DISCORD_HOUSE_GUILD_ID`
- `DISCORD_HOUSE_BOT_TOKEN`

The bot needs enough server permissions to manage roles, channels, messages,
AutoMod, onboarding, and guild settings. Administrator is acceptable for the
setup pass; reduce the bot role later if it remains installed long-term.

## Run

```bash
doppler run --project social-strategy-agent --config dev -- \
  bun scripts/setup-house-discord.ts
```

The script creates or updates:

- Low-trust public roles and staff roles.
- Public read-only, support, community, and staff channel categories.
- Forum channels for help and bug reports.
- Pinned starter messages for welcome, rules, status, known issues, and support
  routing.
- Server safety fields such as verification level, default notifications, and
  explicit content filtering.
- AutoMod rules for scam/support impersonation language, mention spam, spam,
  and slurs/sexual content.
- Welcome screen and onboarding default channels when Discord accepts those API
  updates.

The script does not create a public invite link and does not assign human users
to staff roles.

## Manual Follow-Up

Discord's documented Membership Screening API no longer exposes rules-screening
write operations. After the script runs, verify these items in the Discord UI:

- Community setup is enabled.
- Rules Screening is enabled with the rules from `#rules`.
- The `#rules`, `#announcements`, and `#automod-alerts` channels are selected in
  the Community and Safety settings.
- Onboarding shows useful defaults. Add or review role-choice prompts in the UI
  because Discord requires existing prompt IDs for API prompt edits.
- Staff roles are assigned only to intended users.
- The bot role can be lowered below human admin roles if it will stay installed.
