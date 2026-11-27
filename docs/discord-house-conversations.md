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
default to Omniscient within the conversation’s access. A clear live reveal
request can proceed directly. For an ambiguous request, The House asks once
and accepts a clear affirmative from the same member. If the game ends during
the exchange, the reply uses the official result under the current grant.
The tool-free consent turn distinguishes a direct request from acceptance of
an existing offer. The grant binds the game, verified account, conversation and
triggering message. The shared room conceals live reveal text and attachments
with Discord spoiler formatting. Later room turns receive a marker in place of
the earlier live reveal text. An owner DM can reveal saved thinking from the
member’s own agents. Its replay and artwork remain in Mystery.

## House links

Paste a House player, agent, game or replay URL, including a House short link.
`resolve_house_link` uses the share registry and current conversation grant to
return a canonical reference and URL. The House reads the referenced record
through its specialized tools. A failed lookup returns a generic result before
the tool can expose facts about an unavailable target. The gateway checks each
outgoing resource URL again immediately before delivery.

An explicit Werewolf Mystery link keeps game and scene reads in Mystery.
An Omniscient URL can only open that audience when the current conversation
already has access. If the audience changes, the previous audience’s moment
is discarded. A replay position is meaningful only within its audience and is
separate from the opaque `read_game` continuation. The House can recover an
exact replay URL from a recent DM only if the current grant still permits it.

## Runtime

The gateway checks Discord channel type, current guild membership, the House
User role and screening status. The House service issues a three-minute
conversation grant. Every MCP read and final delivery recheck authority. Image
references are opaque, scoped to the turn and revalidated when opened. House
services resolve publication and visibility against existing object storage
before returning bytes. The gateway can attach up to two inspected images.

The ARM gateway connects to Discord continuously. It queues at most 12
messages, runs one Codex query at a time, and discards expired work. SQLite
retains only short-lived message IDs for reconnect deduplication. The shared
room reads recent room messages and its explicit Discord reply target. In a DM,
The House can follow a recent subject or a direct reply to the exchange where
the subject came up. It keeps at most four exchanges for 15 minutes in memory,
bound to the same channel, Discord member, verified link and House access lane.
The gateway checks those subject references against the current grant. The next
turn reads the current House record before answering. Prior bot replies, private
tool results, images and spoiler grants stay out of DM history.

Codex runs as UID 10004 in a networkless, read-only container. A per-turn Unix
socket carries the scoped House MCP bridge and a fixed OpenAI inference
transport. The transport filters the actual model-facing catalog to approved
House functions. Replies default to GPT-6.1 Terra. The consent turn uses
GPT-6 Luna with reasoning effort set to `none` and an empty tool catalog. Credentials belong to
the gateway, inference relay and House API. The `SOUL.md` file defines the House
voice and its typed-command rule for intent.

False Floor owns the AWS runtime and Doppler provisioning. The deployment
runbook covers the ARM image build, credential sync, staged proof, host
replacement and rollback. The signed `/verify` Lambda and role worker have an
independent lifecycle.
[Conversation deployment runbook](https://github.com/falsefloor/infra/blob/main/docs/house-discord-agent.md)

## Local verification

Run `bun run test`, `bun run test:postgres` and `bun run check`. The PostgreSQL
Discord-agent tests exercise the actual routes, current roles and account link,
two owners, Influence speech filtering, the live Werewolf audience transition,
canonical link delivery, and opaque media references. The ARM probe uses a
synthetic provider response, local House MCP replay and image fixtures, and the
actual model-facing catalog filter.

With Docker running, run `bash scripts/discord-agent/verify-arm.sh` for the synthetic ARM proof.

## Release qualification

Qualify with local PostgreSQL and Docker. Release the resolver API through
the normal staging qualification and protected production approval. Verify the
deployed resolver catalog and link validation before rolling out a worker that
uses them. The DM subject tracking can release independently against the
existing API.

Confirm a consented member can use a Public game link in `#ask-the-house` and
can recover a recent replay by replying to The House in a verified DM. Use an
owned Unlisted game to check the DM and the room independently. Check a live
Werewolf Mystery link, an authorized reveal where permitted, and reply links
and artwork in the same audience. Use synthetic fixtures for role removal,
disconnect, relinking and another owner’s game. Confirm one reply per message
through worker replacement and check `/verify` independently. Record the
active API revision, worker digests and observed delivery outcome.

Live Discord acceptance uses `#ask-the-house` and consented DMs. House staging
access needs a separate role decision.
