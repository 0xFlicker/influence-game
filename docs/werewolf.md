# Werewolf

Werewolf is a separate, unranked game under The House. Choose Werewolf in the game-creation screen or open `/werewolf` from the navigation to create or watch a game. The first release uses public custom games, existing saved characters, and the existing game-worker deployment. It does not enroll contestants in Influence's Daily Free queue or award Influence ratings, season points, career wins, jury results, or owner-learning reviews.

## Character and strategy

One Agent Profile owns the shared name, personality, backstory, and visual assets. `strategyStyle` is specifically the Influence strategy; `werewolfStrategyStyle` is specifically the Werewolf strategy. The editor presents both. Owned profile REST writes and MCP `create_agent` / `update_agent` accept the Werewolf field with the existing strategy length limit. Public character previews do not expose it.

Characters can enter with blank Werewolf notes. The game uses a Werewolf-specific archetype approach (for example, Observer gathers claim/vote evidence while Aggressive pressures suspects), with conditional village/wolf tactics and Seer/Doctor responsibilities. Unknown or missing archetypes use the Strategic approach. Owner-written notes replace the default. The editor offers a preview and “Customize this strategy”; leaving it blank keeps the default automatic. The exact effective text is frozen in the start event for owned and House characters, so later edits cannot alter a replay.

The Aggressor preserves a confrontational temperament: challenge rebuttals, counter-question accusers, and concede reluctantly. Overcommitting and drawing suspicion are character weaknesses, not automatically prompt failures. Tactical judgment can change the target or choose silence without making the character conciliatory. Village aggression distinguishes verified knowledge from suspicion; wolf aggression can deliberately discredit credible accusers. Evaluate faction benefit rather than survival alone. This revised default applies to fresh games with blank Werewolf notes; existing frozen strategies and owner-written notes retain their text.

The AI editor and character creator know both strategy fields and both games' rules. A strategy-only edit changes only the selected game notes, preserving all shared details and the other game's notes, including blanks. It does not load or generate images. Exact provider schemas require the requested strategy and reject missing, fenced, extra-field, or malformed output without changing the draft. New character generation supplies separate suggestions for both games; Influence learning proposals still target Influence only.

There is no cross-game strategy fallback. Empty Werewolf notes use the selected archetype's Werewolf baseline within the assigned role. Existing immutable content revisions that predate these notes have no owner-written Werewolf guidance. Both fields participate in content submission and moderation. A Werewolf-only edit creates a content revision while preserving the Influence analytical revision, rating identity, and review freshness.

Starting a custom game atomically freezes the eligible, published character content, its content-revision reference, its Werewolf strategy, the provider manifest, the roster, the rules version, and randomly assigned roles. There is no waiting lobby in this version. Choose zero to the preset's seat limit of distinct owned characters; House characters fill empty seats. Duplicate display names and unavailable or archived characters are rejected. Subsequent profile edits cannot change a running game. House fill uses shared personality descriptions and Werewolf archetype defaults, with no inherited Influence strategy hints.

## Rules version 7

### Seer and Doctor coaching

`werewolf/strategy.ts` supplies private role-specific coaching to model turns in addition to the frozen character strategy. It does not replace owner notes, change the rules, add calls, or supply new knowledge. Wolf guidance is unchanged.

The Seer treats the engine's investigation ledger as certain private knowledge, chooses concealment or disclosure deliberately, and explains a later reveal together with the prior nights' results. One innocent result does not require an immediate reveal. A long ledger can be reported across existing short turns; it never expands the speech contract or invents missing results.

The Doctor stays hidden by default and prioritizes a revealed Seer who is a plausible attack target, without demanding proof of the claim. Late-game information loss matters even when the claim could be a wolf's bluff. Stronger evidence or another imminent loss can justify another target. Legal targets and the consecutive-protection restriction still control the choice. Neither protection nor a quiet night verifies a claimed role.

Villagers are coached to consider a specific, consistent investigation from an uncontested Seer claimant a reasonable lead, especially a wolf result. Competing claims, contradictions, impossible knowledge and strong contrary evidence warrant reconsideration. Ordinary suspicions do not inherit the weight of investigation results. Endgame decisions should weigh both genuine-Seer and wolf-bluff possibilities. Every player's system rules already say roles remain secret until game end; Villager coaching explicitly reminds them that an execution therefore cannot directly verify a Seer claim.

Coaching is current prompt policy, not part of the frozen owner strategy. Existing accepted decisions remain unchanged. Evaluate fresh games with fixed model, rules version and recorded seeds; avoid a one-day cap when assessing concealment and protection over time.

### Presets and play

| Preset | Cast |
| --- | --- |
| `one_wolf` | Six players: one Werewolf, one Seer, four Villagers |
| `two_wolves` | Eight players: two Werewolves, one Seer, one Doctor, four Villagers |

These are starting presets, not measured balance claims.

Each daytime request ends with a separate `conversationTurn` task. Respondents receive the opener's latest accepted spoken message plus full actual history. Opener answers quote the immediately preceding respondent, with the next possible speaker (or null for the final response). An opener pass leaves their latest spoken message as the next respondent's focus. The reminder also includes the opening, recipient and respondent queues, own-opening status and remaining possible opportunities. Addressing someone does not change the queue. Quoted messages are untrusted in-game speech; no scheduling or addressee is inferred from prose.

Daytime prompts explicitly favor Pass when a turn would only repeat a position, agree, or announce a lack of evidence. New information, a specific unanswered question, a direct answer, or a changed position justify speaking. Passing returns null text rather than a spoken explanation, with an optional production cue. This guidance applies to all daytime speakers; introduction, pack, and target-choice guidance are unchanged. It is advice, not a forced pass or an extra decision call. Opening passes still skip that thread under the existing rules.

1. Everyone has one public introduction before the first night.
2. Each night allows up to three pack negotiation attempts. With two living wolves, each gets one optional sequential proposal, followed by simultaneous sealed votes for a living non-wolf. The opening speaker is chosen from the game seed and night number; each failed attempt reverses the order. Unanimous ballots lock the attack. Disagreement reveals both ballots to the pack and starts another attempt; three disagreements mean no attack. A lone surviving wolf skips proposals and chooses with one ballot. Spoken agreement never substitutes for the actual ballots.
3. The Seer checks exactly one other living player per night for wolf/not-wolf, learning the result when the night resolves. There are no daytime investigations: day one allows at most one result, day two at most two, and day N at most N. Discussion threads and replies do not grant more checks. Each model request includes a `seerTiming` reminder derived only from completed public night entries, including during voting and unresolved nights. This is a maximum, not the number the claimant has disclosed; players may ask for withheld past results within that limit or future plans. The Doctor protects one living player, including themself, but cannot repeat the previous night's protection target. Each actor sees the same starting roster and no other role's pending choices.
4. Night resolves simultaneously. Protection prevents an agreed attack, including an attack on the Doctor. The Doctor and Seer act once per night even when the pack fails to agree. The Seer's result is recorded even if the Seer dies; a dead Seer cannot tell anyone. The public learns only who died, or that everyone survived, without learning whether protection or disagreement prevented a death.
5. Opening order is shuffled once from the game seed and rotates across nights, skipping eliminated players. Each living player gets at most one opening per day. An opener chooses zero to three distinct other living recipients in order; the rest of the room follows in a seeded random order fixed for that thread. Each respondent speaks or passes once. After each spoken response the opener may speak or pass, answering that respondent while knowing the next possible speaker. A respondent pass skips the opener answer. An opening pass skips the thread. Every accepted contribution is public before the next call; there are no repeated response rounds or artificial pacing delays.
6. After each earlier thread, including a skipped opening, every living player casts a fresh sealed target vote or null to hear more. A strict majority of all living players ends the day immediately; otherwise the next opening begins. After the final opening, everyone must choose another living player. That final ballot uses plurality: the unique highest vote count eliminates its target, even below a majority. A tie for highest means no village elimination; normal night actions follow. The final ballot replaces the checkpoint rather than adding a second vote. All ballots reveal together and never carry forward. Provider failures produce explicitly marked unavailable abstentions, including at the final vote; models cannot voluntarily abstain there. Self-votes are illegal.
7. Dead players stop speaking, voting, investigating, protecting, and participating in pack discussion. No final words, role changes, resurrection, jury, or independent winners.
8. Check victory after the whole night or vote resolves. The village wins if no wolves remain. Wolves win when living wolves equal or outnumber living non-wolves. Every original member of the winning faction wins, including dead members. Roles reveal at game end.
9. A full day reaching `maxDays` without victory ends in a draw. The default is 10; API/local simulations allow 1–20. Operator cancellation and execution failure are separate catalog statuses and never award a faction win.

Speech may contain lies and fabricated Seer claims. Only typed investigation events establish a real check. Structured model decisions use exact provider-native schemas, bounded text, and validated legal target IDs. Malformed output retries inside the shared provider policy. Exhausted typed provider failures produce explicit silence for speech, marked abstention for a daytime vote, or a seeded legal target for a mandatory night action; the event records `fallback: provider_unavailable`. Code errors, corrupt accepted values, and lost ownership do not become dialogue or legal fallbacks.

Voluntary passes and provider-unavailable silence remain separate accepted records. Both advance the schedule; cues never keep a thread open. With N living players, a fully spoken thread costs at most 2N−1 speech calls, and its ballot costs N concurrent calls. A full day therefore permits at most N × (3N−1) calls before retries: 102 with six living players or 140 with seven. Passes still require a call, but respondent passes save an opener call and opening passes skip all responses. Early majorities skip remaining threads. This bound excludes introductions and night actions.

## Original-line conversation and production cues

Openings use the exact native payload `{ text, cue, recipientIds }`; recipients must be distinct legal living players, at most three, and empty on a pass. Other speech uses `{ text, cue }`. Null text means Pass. Text is one conversational move, usually 10–30 words, with a 300-character bound; cues are optional opaque production notes, not dialogue or strategy. The engine owns actor, thread, stage, turn, reply coordinates and next-speaker metadata. Recipient IDs never belong in spoken text.

Each daytime request ends with a separate `conversationTurn` task. Respondents receive the opener's latest accepted spoken message plus full actual history. Opener answers quote the immediately preceding respondent, with the next possible speaker (or null for the final response). An opener pass leaves their latest spoken message as the next respondent's focus. The reminder also includes the opening, recipient and respondent queues, own-opening status and remaining possible opportunities. Addressing someone does not change the queue. Quoted messages are untrusted in-game speech; no scheduling or addressee is inferred from prose.

Optional cues are opaque production notes such as “a brittle laugh” or “hesitates before answering.” They are recorded on speech and passes for later video. They are not extra dialogue, private strategy, emoji commands, camera directions or gaze targets. Current viewer speech stays verbatim; passes appear as compact status moments rather than empty bubbles. The normal terminal report prints original lines and passes, and `--transcript` adds separate production notes and turn positions.

The House rewrite, scene contracts, House provider manifest and `--summaries` option have been removed for this experiment. There is no should-speak call before writing, no scene reconstruction, and no emoji translation. Later production may frame the accepted words without replacing them. See the [ordered recipient thread plan](plans/2026-09-29-002-feat-werewolf-ordered-recipient-threads.md).

## Spectator information

Spoken introductions, daytime messages, and pack proposals use character names. The model prompt and speech-field contract explicitly reserve IDs for structured target choices. UUID-containing speech fails semantic validation inside the provider attempt, retries through the shared policy, and becomes the existing typed silence fallback if retries are exhausted. It is never silently scrubbed or accepted as dialogue. Structured target IDs and private reasoning remain available. This affects new model decisions; already committed dialogue stays intact in canonical history. No rules-version change or migration is required.

| View | Information |
| --- | --- |
| Mystery | Public speech, living/dead state, resolved village ballots and public night outcomes. Roles and faction result appear only at the ending. Pack ballots remain hidden. |
| Omniscient | The same public facts plus all roles, pack proposals, resolved pack ballots with attempt/outcome, and resolved attack/protection/investigation details. Pending ballots remain hidden. |
| Contestant | Public facts, shared self-character, selected strategy, own role, and only that role's authorized private knowledge. Wolves receive pack identities/chat, current attempt/speaking order, previously resolved pack ballots, and resolved pack targets including blocked or absent attacks; the Seer receives their own checks; the Doctor receives their own last protection target. |

Omniscient viewers may separately enable Thinking, initially off. `/api/werewolf/:id/thinking?audience=omniscient&cursor=N` returns captured `thinking` for committed contributions up to that exact audience-local moment. Speech/pass thinking is saved with accepted provider results; target thinking releases at its pack/day/night resolution. Mystery cannot request thinking, including after completion. Thinking is not provider-native reasoning traces. Neither audience receives owner strategies, provider payloads, seeds, or raw canonical events. Old speech without captured thinking stays unavailable. This addition needs no migration or rules-version change. Contestants have no tool that can fetch the public Omniscient endpoint. The mode switch changes only a viewer projection, never game rules or agent context.

Every game page opens Mystery at the beginning, including completed games. Playback requests use a count of visible entries for the selected audience. The server rebuilds that exact prefix, including player death/role/result visibility at that point. Hidden night actions cannot advance a Mystery cursor. Switching audience returns to the beginning because the two visible-entry timelines differ. The client discards stale requests and cannot display an earlier Omniscient response under Mystery controls. `Latest` deliberately jumps to the current end. HTTP reads use `private, no-store`; this game does not consume the Influence WebSocket/replay transports or transcript parser. Metadata and game-list cards contain no winner or role spoilers.

## Persistence and execution

`games.gameKind` distinguishes `influence` and `werewolf`; Influence's `classic` / `format` kernel distinction stays inside Influence. Werewolf stores its canonical log in `werewolf_events` and planned action/observation hashes in `werewolf_turns`. No transcript text is parsed into state. Shared `game_run_owners` leases fence dispatch and commits, and shared provider journaling retains attempts, accepted values, and spend.

Each action has a stable `werewolf_action` semantic coordinate keyed by its next event sequence. Before dispatch, the store verifies the current prefix and persists the legal request and a hash of the seat's observation. The provider journal checks that plan, actor, day, action, and active owner. After provider acceptance, the rules validate the exact decision again; the append transaction locks the game and owner, replays the committed prefix, checks the plan, and commits one event. Final result, catalog completion, and owner closure commit together.

Daytime discussion reserves exactly one action coordinate and freezes that speaker’s current observation. Its accepted `werewolf.action_accepted` event immediately adds one public contribution and advances the thread state. Only then can the next player dispatch. Recovery reuses a provider result accepted before an interrupted commit, without another call or changed context. Public history positions count only public entries; private pack activity cannot leak through internal event coordinates. Original speech and cues are never rewritten.

Pack ballots retain the frozen batch mechanism after sequential proposals. `werewolf.pack_vote_resolved` records the attempt, individual ballots, unanimous target or null, and agreement/attempt-limit end reason. Only that event reveals ballots to wolves and advances the Omniscient timeline; Mystery is unchanged. Retry observations include resolved ballots, never pending votes. Seeded fallback targets bind to each reserved action sequence. Rules v7 requires a new game. Experimental v1–v6 logs remain intact but are rejected on read and resume; there is no compatibility adapter or SQL migration for this change. Restart gateway and game worker before launching a fresh game. The removed `--response-rounds` option and API `responseRounds` field now fail validation.

Daytime vote checkpoints dispatch every living player's sealed decision concurrently. All slots are prepared before dispatch, every accepted result remains in the durable provider journal, and one canonical resolution reveals the full ledger. Restart after a partial commitment reuses those accepted values without redispatch. Concurrent dispatch changes ballot latency, not ballot counts. Ordered threads add opener-answer calls as described above.

Live spectator GETs expose a separate `voteProgress` object during an unresolved daytime ballot: day, thread, total living voters, decisions ready, vote mode and nullable majority threshold. Ready counts combine committed ballots with accepted provider-journal results for the remaining exact slots, deduplicated and scoped to this checkpoint. No choices, voter identities, reasoning, retries, or hidden night activity are exposed. Explicit cursor reads and stopped games return null progress; contestants still receive only `view`. The API CLI emits a one-time explanation, updates on count changes and 30-second voting heartbeats. Elapsed time is since this reporter first observed the checkpoint, not server-wide game time. This progress is live telemetry, never an authoritative vote or historical replay event. There is no public dialogue during sealed voting, and the reporter does not turn private rationale into public speech. No inference is added by reporting.

Restart adopts the same log with a new owner epoch. A provider result accepted before an interrupted event commit is replayed from the journal rather than called again. A stale worker cannot dispatch or append. A corrupt log is suspended instead of inferred from transcript text, and it does not block recovery of unrelated games. Graceful shutdown aborts in-flight execution and releases ownership for adoption. This is the Werewolf event cursor; it does not use Influence's XState snapshot, elimination reducer, or completion settlement.

Run the existing gateway **and** `INFLUENCE_API_ROLE=game-worker` service. A gateway accepts creation but does not execute games itself. Apply `0103_account_roles.sql` and then `0104_werewolf.sql` before deploying either service. The earlier worktree-only `0103_werewolf` migration was renumbered without changing its SQL: databases that already applied it need its existing journal entry reconciled after account roles, rather than running the same DDL again. Do not run this renumbered migration blindly against such a database. The shared local `influence_dev` database was backed up and reconciled on 2026-09-30: account roles applied once and the existing Werewolf journal timestamp moved to `0104`; normal migration checks pass. This does not repair other databases automatically. Its journal timestamp follows the parallel `0101_visual_shots` and `0102_visual_review_mode` migrations, so a shared local database that has applied those does not skip Werewolf. The worktree now includes those visual-production migrations and the shared renderer from `origin/main`; visual production is still separate from Werewolf gameplay. A database that applied `0103` before receiving `0101` and `0102` needs its earlier migration coverage checked: the timestamp-based migrator will not automatically backfill skipped earlier entries. Deployment remains the release gate; no feature flag or new infrastructure/package is required.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/werewolf` | Requires `create_game` and `start_game`. Body: `preset`, `agentProfileIds`, optional `providerManifest`, optional `maxDays` and `responseRounds` (1–3, default 1). Starts a public custom game and returns `{ id, slug }`. |
| `GET /api/werewolf` | Up to 100 visible games, newest first, without result spoilers. |
| `GET /api/werewolf/:idOrSlug?audience=mystery&cursor=1` | Audience view plus `latestCursor`. Omit `cursor` for the current end. `audience` defaults to Mystery; Omniscient must be explicit. |
| `POST /api/werewolf/:id/stop` | Requires `stop_game`. Revokes the worker, cancels the game, and preserves accepted history. |

The existing `/api/games` creation, classic/format readers, admin game list, and Influence MCP match inspection remain Influence surfaces. They reject or exclude Werewolf instead of applying defaults. Werewolf operations are available through the HTTP API; the existing management MCP's moderator-action prohibition remains in effect.

## Admin and production workspace

Open **Games → Werewolf** at `/admin/werewolf`. The persistent House administration shell groups routes under Games, Production, Operations and People, showing only destinations permitted for the current account. Producer-only accounts land on Werewolf instead of the Influence list. Search, lifecycle and hidden filters stay in the URL when entering a game and returning. Each game has Overview, Production, Costs and Activity; narrow screens use the section selector. Overview and Activity use the canonical omniscient projection, including original contributions, cues and resolved ballots, without private model reasoning.

| Operation | Current authority | Availability |
| --- | --- | --- |
| List, overview, activity, costs | `view_admin`, Producer or Sysop | Running, stopped, completed and hidden games |
| Hide / restore public discovery | `hide_game` | Any current Werewolf game |
| Stop | `stop_game` | In-progress games; retains history, cannot resume |
| Inspect / generate / repair / publish images | Producer or Sysop | Completed games |

`GET /api/admin/werewolf`, `GET /api/admin/werewolf/:id`, `GET /api/admin/werewolf/:id/activity`, `GET /api/admin/werewolf/:id/costs` and `PATCH /api/admin/werewolf/:id/visibility` enforce current database permissions, including revocation. Stop reuses `POST /api/werewolf/:id/stop`; no Influence recovery, settlement or ratings controls are borrowed. Hiding excludes the game from public lists and direct spectator API reads, while retaining admin access. It does not delete records or revoke images someone already saved.

The game detail endpoint returns a compact, explicitly selected `snapshot`; it no longer embeds the full transcript. Activity returns a self-contained authorized `WerewolfView`. Its players, audience, entries and cursor belong to the same read. If the current header advances beyond that cursor, Activity labels its own snapshot. Detail accepts an ID or slug; Activity and Costs use the resolved game ID. Both detail and Activity still replay canonical history server-side; this split reduces response size, not replay CPU.

Section clicks prepare the destination while keeping the current content and URL. Success adds one history entry and swaps the ready content; failure offers Retry/Cancel without blanking the page. Back/Forward honors the browser's destination and labels retained content while it loads. Header and navigation stay stationary; ready section content swaps immediately without a page transition animation. The wheel effect is [saved for a future top-level swipe interaction](ideation/2026-09-30-top-level-wheel-transition.md). Switching section tabs preserves the current page scroll position; heading focus uses `preventScroll`. The browser may clamp the position when the new section is shorter.

Admin reads and production operations belong to the authenticated admin session. Warm sections reuse cached data; the visible summary checks status/access every ten seconds and on focus. Detected access loss clears the affected evidence and drafts; losing Production access does not remove an otherwise authorized Overview. Logout/account replacement clears the session, and late responses cannot restore it. Network or server errors retain the last successful data with an error message. Revocation is enforced on detection, not by an instantaneous push notification.

Production request records retain their original endpoint, payload and request identity across section/game navigation. A lost response offers explicit recovery with the same request; an accepted write followed by a failed refresh remains accepted. Dependent actions wait until inventory contains the accepted receipt. Reconciliation has no idempotency key: check its server receipt before explicitly resubmitting. Image-review drafts retain source identity and revision in session memory; changed imagery requires discarding a conflicting draft before editing. Leaving a modal removes its focus trap. Browser reloads discard this client memory; durable server receipts remain authoritative.

Costs reuse the provider spend ledger and media render journal. Actual, estimated, retry/failed and unpriced amounts are separate; **N/C is unknown or absent accounting, not free inference**. Production attempts are shown separately from gameplay. Costs show reported/estimated coverage, unpriced calls, token buckets, model/action tables and expandable **Most expensive recorded calls**. This is the returned subset, not a complete call ledger. Recorded zero and missing prices remain distinct, and retries are not added to spend twice. Technical pricing JSON remains secondary. No backfill performs inference.

Production derives lobby membership and the private pack room from canonical Werewolf event prefixes. A new scene is needed when a room's living cast changes; repeated turns with the same room roster reuse it. The scene boundary uses the Werewolf event sequence, not an Influence turn cursor. Cues remain original production notes in v1; a future validated presentation track can interpret emotion and directed attention without changing game facts. Resolved vote identity/timing drives the public replay as well as Activity.

The existing production endpoints under `/api/admin/production/games/:id/visual` provide one-at-a-time jobs, immutable versions, source-image review, repair, receipts and explicit publication. Character references come from the game's captured content revision and content-addressed bytes, never an edited current profile. A missing captured full-body image may use its captured portrait. Built-in House characters use bundled portraits. Missing custom references are named and reject generation; no automatic replacement is generated.

Use **Preview character framing** to select a speaker. It reuses the lobby renderer for verified source panels, including three or more saved panels, and uses a neutral individual full-body/portrait fallback for an uncovered character. The renderer still presents one focused image, with at most two main image layers during a transition and blurred surroundings. **Correct images** keeps good panels and their character mapping without requiring stitching.

### Public visual replay

Open `/werewolf/<slug>` for the visual player: original contributions play one at a time through the shared Influence scene renderer and measured speech pages. Play/pause, previous/next, position, speed, Space and arrow keys control the replay. Input controls retain their native keyboard behavior. Images buffer before the reading clock starts; hidden tabs pause it. Failed or missing scenes use captured full-body/portrait references, then a named fallback. No playback action generates art or calls a model. Passes retain their performance note without inventing speech. The transcript and resolved decision ledgers remain available below the player.

Mystery and Omniscient use audience-local positions. Switching modes restarts from the beginning and removes the previous audience immediately. Early prefixes keep their original living cast and hidden roles; Omniscient additionally includes pack proposals, ballots and resolved night actions. Live playback waits at the accepted frontier; Latest jumps to the latest committed moment.

In Production, save/review imagery and choose **Publish for viewers**. New candidates never replace public images automatically. Migration `0105_visual_publication_audience` preserves existing Werewolf approvals as private; they require explicit public publication. Influence publications retain their existing public meaning. A viewer session pins a publication cutoff, so a later publish takes effect on a new page load. The public API selects only an explicitly published version with the correct room, cast and canonical boundary. Source panels do not need stitching. The legacy Influence media routes still reject Werewolf; `/api/werewolf/:id/presentation`, `/media/:asset` and `/characters/:player` enforce Werewolf visibility and audience/cursor checks. Private pack images cannot be retrieved under Mystery, even by guessing an artifact ID. Hiding a game blocks new presentation and image reads.

Animated emotional/gaze cues, speech synthesis, video export, live image generation and the production studio remain separate work. Original cue text and accepted moment identity are preserved for that next layer.

## Local evaluation and proof

From the repository root, use the API launcher to create a normal watchable game and save a follow-along text report. It reuses the existing CLI login (or `INFLUENCE_API_SESSION_TOKEN`) and requires `create_game` plus `start_game`. The local OAuth page currently labels its required grant **Developer access**, which includes producer evidence and private reasoning access; approve that grant only for the intended local client. The API worker owns the provider credentials, Flex configuration, and durable game. Apply the existing Werewolf migration before first use; the reporting changes require no additional migration.

Start these services in separate terminals from this checkout. The scripts load the Doppler `dev` configuration. Local PostgreSQL must be running, and that configuration must point at the intended local database and provider.

```sh
bun run dev:api          # gateway, port 3000
bun run dev:game-worker  # executes games, port 3002
bun run dev:web          # browser viewer, port 3001
```

Then, in another terminal:

```sh
bun run mcp:game:login # once, or when the saved login expires
bun run simulate:werewolf:api

# Eight seats, two wolves, Seer and Doctor; include selected owned characters.
bun run simulate:werewolf:api --preset two_wolves --agent PROFILE_ID

# Deliberately shortened smoke test; can draw before a faction wins.
bun run simulate:werewolf:api --max-days 2 --out /tmp/werewolf-smoke.txt

# Read an existing game without creating another or making model calls.
bun run simulate:werewolf:api --game GAME_ID_OR_SLUG --audience omniscient --transcript
```

Defaults: six House characters, one wolf and one Seer, `openai:gpt-6-luna`, low reasoning, a ten-day safety cap, and Mystery viewing. A normal match ends as soon as a faction wins; ten days is a ceiling rather than a target. This replaces the old two-day smoke default so a first game can reach its natural result. `--agent` is repeatable; empty seats use House characters with Werewolf archetype defaults. `--model-catalog`, `--reasoning-policy`, `--api-url`, `--web-url`, and `--timeout-seconds` are explicit overrides (`--help` lists them). `--api-url` is local loopback only. `--game` skips login and creation and renders an existing game from the beginning, then follows new entries.

The default report prints the watch URL, cast and rules, phase/thread headings, original speech and passes, night outcomes, named ballots, survivors, and result. `--transcript` adds production notes and opening/reply/answer positions. Opening headings list invited recipients in order; final ballots are labeled as plurality rather than majority. Omniscient labels all speakers with roles and exposes resolved private actions; Mystery delays role disclosure until the ending. Waiting updates every 30 seconds do not invent model progress.

Omniscient labels every speaker with their actual role, such as `Vera [villager]: ...` and `[Pack] Echo [werewolf]: ...`, including passes. Mystery keeps dialogue role-free even during completed-game readback.

Omniscient also prints each pack ballot as `Night N · ballot X/3`, with named choices and the agreement, retry, or no-attack outcome. Doctor protection and Seer checks remain visible when no attack was agreed. Up to six proposal calls and six ballot calls can occur with two wolves; agreement stops attempts immediately. A lone wolf uses one ballot call. Reporting adds no inference.

Every API run saves a unique text file under `packages/engine/docs/simulations/`, appending after each poll so it can be followed with `tail -f`. `--out` selects a new file and never overwrites an existing report. Reading reports adds no model calls. The worker pays only for configured player decisions and their provider retries; no House generation occurs. Closing/timing out the CLI does not stop its server game. The printed resume command reads the same accepted conversation. Creation is never automatically retried; check `/werewolf` after an ambiguous creation error.

The standalone engine simulator remains separate; it does not create API games:

```sh
# No provider calls. Saves a private canonical JSON log under engine/docs/simulations.
bun run simulate:werewolf --preset two_wolves --seed sample-1

# An explicit opt-in model evaluation; requires the selected provider's configuration.
bun run simulate:werewolf --preset one_wolf --model-catalog openai:gpt-6-luna --transcript

bun run test
bun run test:postgres
bun run check

cd packages/api
DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml src/e2e/werewolf.e2e.test.ts --max-concurrency 1
```

`--chatty` prints private structured decision records, including `thinking`; it is not a spectator feed. The local JSON log also contains roles, strategies, and hidden decisions. Keep it private. Local simulation does not claim the API's provider-journal crash guarantee. The browser test creates and drops its own database, uses a fake model inventory and scripted contestants, and cleans up API/web/browser processes. PostgreSQL unit tests use `setupTestDB()` and its process lock. Use a dedicated `TEST_DATABASE_URL` when a different checkout has already applied newer migrations.

The pure engine and PostgreSQL tests cover full matches, prefix replay, secrecy, role actions, fallback contracts, owner replacement, malformed provider retries, and accepted-result recovery. The browser journey covers strategy editing, real API creation, worker completion, spectator modes, replay from the start, and phone layout. Live-provider role balance and watchability remain evaluation work requiring an explicit opt-in run.

## Modules and follow-on work

- Rules, events, knowledge, model contracts, and simulation: [`packages/engine/src/werewolf/`](../packages/engine/src/werewolf/).
- Database/service boundary: [`werewolf-games.ts`](../packages/api/src/services/werewolf-games.ts), [`werewolf-runtime.ts`](../packages/api/src/services/werewolf-runtime.ts), [`werewolf-schema.ts`](../packages/api/src/db/werewolf-schema.ts), [`routes/werewolf.ts`](../packages/api/src/routes/werewolf.ts).
- Viewer and custom-game creation: [`packages/web/src/app/werewolf/`](../packages/web/src/app/werewolf/).
- Research, dependency inventory, and source map: [Werewolf plan](plans/2026-09-26-001-feat-werewolf-game-mode-plan.md).

Measure bluff quality, claim tracking, Seer disclosure, pack coordination, win rates by seed/role/model, fallback frequency, latency, and spend before tuning the presets. Hunter and other complex roles, automated scheduling, Werewolf ratings/reviews, and generated narration/video are separate extensions. Renaming the repository remains a separate TODO.
