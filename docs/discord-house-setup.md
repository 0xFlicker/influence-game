# The House Discord Setup

The House Discord is configured by an idempotent operator script that uses a
Discord bot token. Do not automate this with a personal Discord user token.

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
