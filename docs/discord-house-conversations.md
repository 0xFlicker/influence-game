# Talking with The House in Discord

Verify your House account with `/verify` to chat in `#ask-the-house` or in a
one-to-one DM. In the shared channel, The House answers without a mention. It
can read accepted speech and saved gameplay thinking for Public games and show
public player profiles, agent identity and frozen artwork. Shared responses may
include Influence huddles and whispers. Discord channel and guild IDs bind
delivery.

In a DM, The House can look up games your agents played, their public speech,
your agents’ saved thinking and your agents’ private revisions. An explicit
current House Producer or Admin role also enables the staff account, agent and
game reasoning tools in a DM. Available reasoning depends on what the provider
actually returned and the House retained. The Discord role badge is a community
access projection. The House API resolves the account’s current roles.

Live Werewolf starts in Mystery. The game’s canonical outcome switches the
default to Omniscient. A clear request for a live reveal can use Omniscient
directly. For an ambiguous request, The House asks once and accepts a clear
affirmative follow-up from the same member. It interprets meaning in a
tool-free Codex turn with exact structured output. The resulting grant binds the
game, verified account, conversation and triggering message. Shared live
reveals visibly identify themselves as spoilers. Owner DMs stay within the
member’s gameplay and agent access.

## Runtime

The gateway checks Discord channel type, current guild membership, the House
User role and screening status. The House service issues a three-minute
conversation grant. Every MCP read and final delivery recheck authority. Image
references are opaque, scoped to the turn and revalidated when opened. House
services resolve publication and visibility against existing object storage
before returning bytes. The gateway can attach up to two inspected images.

The ARM gateway connects to Discord continuously. It queues at most 12
messages, runs one Codex query at a time, and discards expired work. SQLite
retains only short-lived message IDs for reconnect deduplication. A bounded
in-memory window carries the member’s recent inputs in the same conversation.
It does not replay prior model outputs or private tool results.

Codex runs as UID 10004 in a networkless, read-only container. A per-turn Unix
socket carries the scoped House MCP bridge and a fixed OpenAI inference
transport. The transport filters the actual model-facing catalog to approved
House functions. Replies default to GPT-6.1 Terra. The consent turn uses
GPT-6 Luna with reasoning effort set to `none` and an empty tool catalog. Credentials belong to
the gateway, inference relay and House API. The `SOUL.md` file defines the House
voice and its typed-command rule for intent.

False Floor owns the AWS runtime and Doppler provisioning in its
[`infra` repository](https://github.com/falsefloor/infra). See the conversation
deployment runbook there for the ARM image build, credential sync, staged proof,
host replacement and rollback. The signed `/verify` Lambda and role worker have
an independent lifecycle.

## Local verification

Run `bun run test`, `bun run test:postgres` and `bun run check`. The PostgreSQL
Discord-agent tests exercise the actual routes, current roles and account link,
two owners, Influence speech filtering, the live Werewolf audience transition,
and opaque media references. The ARM probe uses a synthetic provider response,
a local House MCP image fixture and the actual model-facing catalog filter.

With Docker running, run `bash scripts/discord-agent/verify-arm.sh` for the synthetic ARM proof.

## Release qualification

The release uses local PostgreSQL and Docker qualification, followed by the
existing protected production approval and consented checks in
`#ask-the-house` and DMs. These are the only live acceptance destinations.
Any future access to House staging needs its own role decision. The
production House role grant does not confer staging access.
