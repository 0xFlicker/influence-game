# Werewolf

Werewolf is a separate, unranked game under The House. Choose Werewolf at `/games/new`; discover both games at `/games`. Individual Werewolf matches use `/games/:slug`, with playback at `/games/:slug/replay`; there is no separate root Werewolf navigation or creation page. The first release uses public custom games, existing saved characters, and the existing game-worker deployment. It does not enroll contestants in Influence's Daily Free queue or award Influence ratings, season points, career wins, jury results, or owner-learning reviews.

The creation form selects Seer and Doctor by default. Changing village size selects one wolf for six or seven players, or two wolves for eight players. The wolf count and role checkboxes remain editable.

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

The player inspector's **Decisions** tab replaces the empty Strategy lens and separate Thinking tab. `/api/werewolf/:id/decisions?audience=mystery|omniscient&cursor=N&actorId=ID` returns only that player's resolved decisions through the audience-local replay position, newest first in the UI. Mystery gets public day ballots (including intentional Hear more and unavailable choices), never thinking or night decisions, even after completion. Omniscient also gets each resolved pack ballot, Doctor protection and Seer result, with captured decision thinking expandable independently of the stage's Show thinking preference. Each entry links to its resolution; rewinding or changing players clears stale responses. No decisions yet is a normal early-game state. The projection uses canonical events, not transcript inference, and makes no model calls. Speech thinking remains available on the stage through the existing thinking endpoint.

Every game page opens Mystery at the beginning, including completed games. Playback requests use a count of visible entries for the selected audience. The server rebuilds that exact prefix, including player death/role/result visibility at that point. Hidden night actions cannot advance a Mystery cursor. Switching audience returns to the beginning because the two visible-entry timelines differ. The client discards stale requests and cannot display an earlier Omniscient response under Mystery controls. `Latest` deliberately jumps to the current end. HTTP reads use `private, no-store`; this game does not consume the Influence WebSocket/replay transports or transcript parser. Metadata and game-list cards contain no winner or role spoilers.

## Persistence and execution

`games.gameKind` distinguishes `influence` and `werewolf`; Influence's `classic` / `format` kernel distinction stays inside Influence. Werewolf stores its canonical log in `werewolf_events` and planned action/observation hashes in `werewolf_turns`. No transcript text is parsed into state. Shared `game_run_owners` leases fence dispatch and commits, and shared provider journaling retains attempts, accepted values, and spend.

Each action has a stable `werewolf_action` semantic coordinate keyed by its next event sequence. Before dispatch, the store verifies the current prefix and persists the legal request and a hash of the seat's observation. The provider journal checks that plan, actor, day, action, and active owner. After provider acceptance, the rules validate the exact decision again; the append transaction locks the game and owner, replays the committed prefix, checks the plan, and commits one event. Final result, catalog completion, and owner closure commit together.

Daytime discussion reserves exactly one action coordinate and freezes that speaker’s current observation. Its accepted `werewolf.action_accepted` event immediately adds one public contribution and advances the thread state. Only then can the next player dispatch. Recovery reuses a provider result accepted before an interrupted commit, without another call or changed context. Public history positions count only public entries; private pack activity cannot leak through internal event coordinates. Original speech and cues are never rewritten.

Pack ballots retain the frozen batch mechanism after sequential proposals. `werewolf.pack_vote_resolved` records the attempt, individual ballots, unanimous target or null, and agreement/attempt-limit end reason. Only that event reveals ballots to wolves and advances the Omniscient timeline; Mystery is unchanged. Retry observations include resolved ballots, never pending votes. Seeded fallback targets bind to each reserved action sequence. Rules v7 requires a new game. Experimental v1–v6 logs remain intact but are rejected on read and resume; there is no compatibility adapter or SQL migration for this change. Restart gateway and game worker before launching a fresh game. The removed `--response-rounds` option and API `responseRounds` field now fail validation.

Daytime vote checkpoints dispatch every living player's sealed decision concurrently. All slots are prepared before dispatch, every accepted result remains in the durable provider journal, and one canonical resolution reveals the full ledger. Restart after a partial commitment reuses those accepted values without redispatch. Concurrent dispatch changes ballot latency, not ballot counts. Ordered threads add opener-answer calls as described above.

Live spectator GETs expose a separate `voteProgress` object during an unresolved daytime ballot: day, thread, total living voters, decisions ready, vote mode and nullable majority threshold. Ready counts combine committed ballots with accepted provider-journal results for the remaining exact slots, deduplicated and scoped to this checkpoint. No choices, voter identities, reasoning, retries, or hidden night activity are exposed. Explicit cursor reads and stopped games return null progress; contestants still receive only `view`. The API CLI emits a one-time explanation, updates on count changes and 30-second voting heartbeats. Elapsed time is since this reporter first observed the checkpoint, not server-wide game time. This progress is live telemetry, never an authoritative vote or historical replay event. There is no public dialogue during sealed voting, and the reporter does not turn private rationale into public speech. No inference is added by reporting.

Restart adopts the same log with a new owner epoch. A provider result accepted before an interrupted event commit is replayed from the journal rather than called again. A stale worker cannot dispatch or append. A corrupt log is suspended instead of inferred from transcript text, and it does not block recovery of unrelated games. Graceful shutdown aborts in-flight execution and releases ownership for adoption. This is the Werewolf event cursor; it does not use Influence's XState snapshot, elimination reducer, or completion settlement.

Run the existing gateway **and** `INFLUENCE_API_ROLE=game-worker` service. A gateway accepts creation but does not execute games itself. Apply the normal migration chain before deploying either service. Main owns `0104_visual_panel_harmonization`; Werewolf migrations follow as `0105`–`0112`, with strictly increasing journal timestamps. Fresh installs and databases migrated through main follow this chain normally.

Development databases that already applied the earlier worktree-only Werewolf chain need manual migration-journal reconciliation after a backup; do not rerun their existing DDL. The 2026-10-06 merge renumbered that chain and added main's saved-panel harmonization migration, including `source_version_id`, its immutable-input check and panel-source constraint. Such databases need those additions and the combined `harmonize`/`forms` mode constraint even if their latest timestamp causes the normal migrator to skip them. This merge does not alter or reset operator databases. Earlier local reconciliations do not cover this new merge. Deployment remains the release gate.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/werewolf` | Requires `create_game` and `start_game`. Body: `preset`, `agentProfileIds`, optional `providerManifest`, optional `maxDays` and `visibility` (`public` or `unlisted`, default `public`). Starts a custom game and returns `{ id, slug }`. |
| `GET /api/werewolf` | Up to 100 visible games, newest first, without result spoilers. |
| `GET /api/werewolf/:idOrSlug?audience=mystery&cursor=1` | Audience view plus `latestCursor`. Omit `cursor` for the current end. `audience` defaults to Mystery; Omniscient must be explicit. |
| `POST /api/werewolf/:id/stop` | Requires `stop_game`. Revokes the worker, cancels the game, and preserves accepted history. |

The existing `/api/games` creation and classic/format readers remain Influence surfaces. House entry, participation history and spectator MCP inspection dispatch by game kind. Werewolf casting uses `/api/werewolf/lobbies` and the join/start endpoints; moderator operations remain outside the management MCP contract.

## Admin and production workspace

Open **Games → Werewolf** at `/admin/werewolf`. The persistent House administration shell groups routes under Games, Production, Operations and People, showing only destinations permitted for the current account. Producer-only accounts land on Werewolf instead of the Influence list. Search, lifecycle and hidden filters stay in the URL when entering a game and returning. Each game has Overview, Production, Costs and Activity; narrow screens use the section selector. Overview and Activity use the canonical omniscient projection, including original contributions, cues and resolved ballots, without private model reasoning.

| Operation | Current authority | Availability |
| --- | --- | --- |
| List, overview, activity, costs | `view_admin`, Producer or Sysop | Running, stopped, completed and hidden games |
| Hide / restore public discovery | `hide_game` | Any current Werewolf game |
| Stop | `stop_game` | In-progress games; retains history, cannot resume |
| Inspect / generate / repair / publish images | Producer or Sysop | Completed games, or the exact boundary paused for visuals |
| Change visual failure policy / resume visual pause | `start_game` plus Production access | Visual-owned suspension; explicit resume only |

`GET /api/admin/werewolf`, `GET /api/admin/werewolf/:id`, `GET /api/admin/werewolf/:id/activity`, `GET /api/admin/werewolf/:id/costs` and `PATCH /api/admin/werewolf/:id/visibility` enforce current database permissions, including revocation. Stop reuses `POST /api/werewolf/:id/stop`; no Influence recovery, settlement or ratings controls are borrowed. Hiding excludes the game from public lists and direct spectator API reads, while retaining admin access. It does not delete records or revoke images someone already saved.

The game detail endpoint returns a compact, explicitly selected `snapshot`; it no longer embeds the full transcript. Activity returns a self-contained authorized `WerewolfView`. Its players, audience, entries and cursor belong to the same read. If the current header advances beyond that cursor, Activity labels its own snapshot. Detail accepts an ID or slug; Activity and Costs use the resolved game ID. Both detail and Activity still replay canonical history server-side; this split reduces response size, not replay CPU.

Section clicks prepare the destination while keeping the current content and URL. Success adds one history entry and swaps the ready content; failure offers Retry/Cancel without blanking the page. Back/Forward honors the browser's destination and labels retained content while it loads. Header and navigation stay stationary; ready section content swaps immediately without a page transition animation. The wheel effect is [saved for a future top-level swipe interaction](ideation/2026-09-30-top-level-wheel-transition.md). Switching section tabs preserves the current page scroll position; heading focus uses `preventScroll`. The browser may clamp the position when the new section is shorter.

Admin reads and production operations belong to the authenticated admin session. Warm sections reuse cached data; the visible summary checks status/access every ten seconds and on focus. Detected access loss clears the affected evidence and drafts; losing Production access does not remove an otherwise authorized Overview. Logout/account replacement clears the session, and late responses cannot restore it. Network or server errors retain the last successful data with an error message. Revocation is enforced on detection, not by an instantaneous push notification.

Production request records retain their original endpoint, payload and request identity across section/game navigation. A lost response offers explicit recovery with the same request; an accepted write followed by a failed refresh remains accepted. Dependent actions wait until inventory contains the accepted receipt. Reconciliation has no idempotency key: check its server receipt before explicitly resubmitting. Image-review drafts retain source identity and revision in session memory; changed imagery requires discarding a conflicting draft before editing. Leaving a modal removes its focus trap. Browser reloads discard this client memory; durable server receipts remain authoritative.

Costs reuse the provider spend ledger and media render journal. Actual, estimated, retry/failed and unpriced amounts are separate; **N/C is unknown or absent accounting, not free inference**. Production attempts are shown separately from gameplay. Costs show reported/estimated coverage, unpriced calls, token buckets, model/action tables and expandable **Most expensive recorded calls**. This is the returned subset, not a complete call ledger. Recorded zero and missing prices remain distinct, and retries are not added to spend twice. Technical pricing JSON remains secondary. No backfill performs inference.

Production derives village, private pack and hunt membership from canonical Werewolf event prefixes. A new scene is needed when a room's living cast changes; repeated turns with the same room roster reuse it. The scene boundary uses the Werewolf event sequence, not an Influence turn cursor. Cues remain original production notes in v1; a future validated presentation track can interpret emotion and directed attention without changing game facts. Resolved vote identity/timing drives the public replay as well as Activity.

The existing production endpoints under `/api/admin/production/games/:id/visual` provide one-at-a-time jobs, immutable versions, source-image review, repair, receipts and explicit publication. Character references come from the game's captured content revision and content-addressed bytes, never an edited current profile. A missing captured full-body image may use its captured portrait. Built-in House characters use bundled portraits. Missing custom references are named and reject generation; no automatic replacement is generated.

Use **Preview character framing** to select a speaker. It reuses the lobby renderer for verified source panels, including three or more saved panels, and uses a neutral individual full-body/portrait fallback for an uncovered character. The renderer still presents one focused image, with at most two main image layers during a transition and blurred surroundings. **Correct images** keeps good panels and their character mapping without requiring stitching.

### Required visuals and recovery

Create-game Visual Mode offers **Best effort** (default) and **Require visuals**, using the shared House policy field. Missing historical configuration stays Best effort. Require visuals stops before a conversation decision if its required scene or wolf form is unavailable. Hunt preparation happens after the accepted night result and before completion, so even a game-ending night can pause safely without repeating the night.

Open **Admin → Production → Repair visuals**, or the Werewolf game's Production section. The saved pause identifies the exact required work and reason. A missing scene appears even if generation failed before creating a scene row. Render or regenerate it, review and **Publish for viewers**, then explicitly **Resume game**. A lone wolf uses **Repair wolf form** without inventing a pack meeting; the worker verifies and saves that derivative for reuse. Policy changes and publication never resume execution by themselves. To continue with original character art, select Best effort and then Resume. An active repair must finish first.

Production requires Producer or Sysop access; changing policy and resuming additionally requires `start_game`. Ordinary errors, stopped games and hidden-game permissions are unchanged. The public player displays a visual-repair pause and continues polling; its existing session receives the exact repair selected on resume. Private pack/hunt media still follows audience restrictions. Accepted decisions and historical scenes are not rewritten.

Apply `0112_werewolf_visual_recovery.sql` before running this version. It adds form-only work to the existing media queue with an explicit target constraint. Cached Best effort failures are rechecked against the current policy at each later preparation boundary. Changing to Require visuals pauses for explicit repair without retrying the paid attempt or rewriting accepted history. Provider attempts, costs and uncertain outcomes retain their original journal; regeneration is explicit and does not clear unresolved charges. See [W7A recovery learnings](solutions/architecture-patterns/werewolf-visual-recovery-at-canonical-boundaries.md).

### Public visual replay

Open `/games/<slug>` for the shared game page or `/games/<slug>/replay` for the House watch player. Influence and Werewolf share the shell, cast rail, inspector layout, transport, fullscreen, keyboard handling and the extracted House presentation scheduler. Each game owns its projection, scene/chapter navigation and rendering policy. Original accepted contributions remain the dialogue; there is no House rewrite or additional model call.

Play/pause and speed control one clock. Previous/Next and `[`/`]` move between opening threads or other group actions. The outline settings button beside fullscreen contains readable shortcuts and viewing options. Arrow/Enter advancement retains House speech reveal/page/hide behavior. Seeking and scrubbing preserve play/pause intent; **Go Live** follows new committed material. Replays autoplay after loading saved device preferences. Input controls retain their native keys. Hidden tabs pause playback. Images settle before reading time starts; missing imagery uses frozen portraits, then a named fallback. Passes and unavailable contributions retain their source positions and notes in the transcript but never create a timed speech frame. Speech uses measured pagination with more space before splitting into pages.

The Transcript button opens bounded readback through the active position. Select a cast member for their frozen personality/backstory and inspector sections. Omniscient's **Show thinking** toggle defaults off and remembers the device's saved choice and thinking order; it fetches accepted thinking only through the active position, showing the current speaker’s exact contribution in scene and the selected player’s eligible evidence in the inspector. Mystery never requests thinking, even at the ending. The Decisions tab shows resolved choices through the selected replay position, with expandable decision thinking for Omniscient; owner notes remain private.

Mystery and Omniscient have separate audience-local positions. Choose Mystery or Omniscient before entering the player. The mode stays fixed for that viewing session; explicit `?audience=mystery` and `?audience=omniscient` links enter directly. Choosing another mode starts a separate session. The player has no in-match mode switch. Early prefixes retain their original cast and role visibility. Live polling and prefetch update available content without moving a paused viewer. The read-only `/api/werewolf/:id/watch` returns windows of at most 64 source entries (default 32), minimal snapshots and a scene/chapter index; the browser retains at most three windows. Only a contiguous loaded source range enters the playback timeline; distant cached seek destinations never bridge a missing window. Viewer reads batch frozen reference metadata without loading cast image bytes; character endpoints load only the requested image. Silent stretches are consumed without Pass cards, including across window boundaries. The existing `/presentation` route remains available for its existing callers.

In Production, save/review imagery and choose **Publish for viewers**. New candidates never replace public images automatically. Migration `0106_visual_publication_audience` preserves existing Werewolf approvals as private; they require explicit public publication. Influence publications retain their existing public meaning. A viewer session pins a publication cutoff, so a later publish takes effect on a new page load. The public API selects only an explicitly published version with the correct room, cast and canonical boundary. Source panels do not need stitching. The legacy Influence media routes still reject Werewolf; `/api/werewolf/:id/presentation`, `/media/:asset` and `/characters/:player` enforce Werewolf visibility and audience/cursor checks. Private pack images cannot be retrieved under Mystery, even by guessing an artifact ID. Hiding a game blocks new presentation and image reads.

Animated emotional/gaze cues, speech synthesis and the production studio remain separate work. Original cue text and accepted moment identity are preserved for that next layer.

### Werewolf art regeneration

Production uses the approved Lantern Village backgrounds: the village round table, ruined pack cellar with built-in seating, and moonlit lane. **Regenerate scene** rebuilds the plan from that scene's canonical cast and purpose, including older games. Night hunts appear as separate missing scenes; they do not need a new game or new dialogue. Doctor saves and nights without an accepted attack target do not generate hunt images and are omitted from the producer scene inventory. Successful attacks place the target in the foreground left and the wolves smaller in the background right, at the far end of the alley, following behind with wide separation and readable faces. New games and producer regeneration use this composition; existing published successful-hunt images need regeneration to change positions.

The worker prepares and verifies wolf forms from the game's original frozen art, preserving its rendering style and distinctive clothing. Verified forms are reusable, with newly measured head positions. Normal regeneration keeps them; **Regenerate wolf forms too** creates a new set for the candidate. Expand **Wolf forms used** in version review to inspect its references. Neither action rewrites agent profiles or frozen originals. Job intent is immutable and retries resolve the same generation; unknown provider charges require reconciliation before further form generation. Migrations `0109` and `0110` add versioned immutable character variants.

Publish a candidate explicitly when ready. Scene and reference generation use the existing provider accounting, worker lease and image review workflow. Omniscient playback shows the doctor and protected player, the seer and investigated player with the recorded wolf/not-wolf result, then the pack and target before the recorded dawn outcome. Each is a separate Previous/Next, arrow and slider stop. When protection prevented the recorded attack, the hunt panel names the saved player and identifies the Doctor with a framed portrait; the save uses character art rather than a generated hunt composite. Protection without a matching attack is not labeled a save. Role beats use original character art, include self-protection and actions completed by a player who dies that night, and still appear when the pack has no target. Absent roles or missing choices do not create beats. Mystery receives only the public dawn outcome, with no private action payloads or hunt media. At the first permitted pack appearance each night, published wolf forms alternate with the original pictures on a deterministic, bouncy 3.6-second entrance (the second wolf starts 240ms later). A lone wolf gets the entrance before that night’s hunt, including a survivor that appeared with the pack on earlier nights. It runs at one position per night in the canonical sequence. Previous/Next and timeline seeks to that position start at its transformation lead-in, preserving play/pause state; later pack lines show the settled form. Missing forms use original art, and missing hunt composites can reuse earlier published pack forms. Pausing freezes the pose; reduced motion dissolves without bounce. Confirmed night deaths add a brief red/white claw accent before the dimmed, named dawn outcome. Saves never receive the death effect. All motion uses the shared replay clock.

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

Every API run saves a unique text file under `packages/engine/docs/simulations/`, appending after each poll so it can be followed with `tail -f`. `--out` selects a new file and never overwrites an existing report. Reading reports adds no model calls. The worker pays only for configured player decisions and their provider retries; no House generation occurs. Closing/timing out the CLI does not stop its server game. The printed resume command reads the same accepted conversation. Creation is never automatically retried; check `/games/type/werewolf` after an ambiguous creation error.

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
- Viewer and custom-game creation: [`packages/web/src/components/games/werewolf/`](../packages/web/src/components/games/werewolf/).
- Research, dependency inventory, and source map: [Werewolf plan](plans/2026-09-26-001-feat-werewolf-game-mode-plan.md).

Measure bluff quality, claim tracking, Seer disclosure, pack coordination, win rates by seed/role/model, fallback frequency, latency, and spend before tuning the presets. Hunter and other complex roles, automated scheduling, Werewolf ratings/reviews, and generated narration/video are separate extensions. Renaming the repository remains a separate TODO.

### In-scene thinking

Omniscient viewers can toggle captured thinking in place. The shared House player shows a thought bubble before speech by default, keeps it anchored above speech for the entire spoken line, then fades both bubbles out together. Player settings can switch to **Speech first**, which reads and dismisses the line before showing its full thought, without navigating or restarting the game. Both orders use the existing playback clock, including pause, speed and manual advance. Thinking appears only when evidence matches the current speaker and accepted contribution; no thought is invented for missing captures or attached to an unrelated outcome frame. Mystery never requests thinking. Influence uses the same bubble and timing controls with its own evidence adapter. Thinking lives inside the existing scene backdrop, above speech, with a descending circle tail toward the portrait. It reserves no outer black strip; the text stack fits within the stage and uses smaller text on short screens.

Single-person Werewolf reveals use the House studio portrait layout. Day vote checkpoints reveal accepted target ballots one at a time into the shared cumulative ledger, followed by silent portraits collecting into **Hear more**. Unavailable ballots have a separate **Unavailable** bucket. Neither label becomes spoken dialogue. The result follows the roll call; rewinding within it removes later receipts. The source cursor remains the checkpoint cursor throughout its presentation subcues.

Bubble typography measures the full contribution before display. Short messages use larger text (up to 28 px for speech, 22 px for thoughts) and a shorter bubble. Narrow/short scenes use lower type limits. Padding stays consistent within the layout; longer content reduces type to a readable minimum, then paginates. Every page shares the font and frame fitted to the tallest page, so the bubble does not resize during reading. The same fitting applies to Influence and Werewolf.

### Casting a custom village

`/games` includes a distinct Werewolf shelf, with shared search/status filtering and an explicit game-type filter. Both games use the shared House card template and open `/games/:slug`, with game-specific episode actions. The public discovery APIs remain game-specific so Werewolf does not inherit Influence results, ratings or season projections.

At `/games/new`, **Create Werewolf Game** requires `create_game` and saves a waiting lobby. Configure 6, 7 or 8 players, 1 or 2 wolves, and optional Seer and Doctor roles. Model routing, reasoning, fallback budgets, archetype pool and balanced/random casting use the shared House form. Werewolf archetypes keep their own strategy guidance. It does not start model calls. Share its URL to invite players. The shared House portrait selector now joins that persisted game; refreshing, leaving, or another browser opening the URL reads the same cast. Creating a new agent from the lobby uses the `join_werewolf` continuation and returns to that game after saving and joining.

Authenticated players can enter one owned, eligible agent. Current admins, sysops and producers can enter multiple owned agents and remove cast members; ordinary players may remove only their own. Duplicate joins are idempotent while waiting, and all admission/removal/start operations lock the game row to serialize capacity and the start boundary. The lobby shows only approved public identity, never private personality/strategy or roles. Archived or withheld members are redacted and must be removed before starting.

**Start Werewolf** separately requires `start_game`, respects deployment admission, fills remaining seats with House agents, freezes each member's current approved identity and Werewolf strategy, assigns roles, and atomically commits `werewolf.started` with `in_progress`. No roles or gameplay events exist before that point. Blank Werewolf strategy uses the archetype default; Influence strategy is never substituted. The waiting page refreshes into the viewing-mode choice when the game starts. Cancelled unstarted games have no replay. The CLI's existing immediate-create-and-start API remains its explicit simulation path.

Migration `0107_werewolf_lobbies.sql` adds the admission table; it does not change historical game events. The House hall, icon, casting hero and agent selector are shared; Werewolf owns its admission state and rules. Waiting games in the admin list link to their casting lobby rather than attempting to render gameplay or production before any events exist.


## Automatic visuals and public integration

Enable **Visual Mode** at creation to prepare scenes for each changed living village roster, each changed multi-wolf pack roster, and resolved nights with an attack target. Introductions use individual frozen character art. The game worker uses the shared House scene renderer, frozen revision assets, durable paid-attempt accounting, and bounded repair policy. Unavailable imagery continues with character art. Game stop, cancellation and ownership loss fence acceptance and publication; a restart reuses the same scene rather than repaying for accepted imagery.

The initial accepted scene is automatically published for spectator playback. Live sessions admit newly arriving automatic originals even when their session publication cutoff predates the image. Producer replacements still obey the session cutoff. Mystery cannot fetch pack scenes; scene membership and event boundaries remain canonical. Production remains the completed-game review and repair workspace. Enabling visuals incurs image-provider costs in addition to player inference; it currently produces viewer scenes, not additional image input in Werewolf agents' observations.

Portraits and full-body references have separate immutable URLs. Cast chips use portraits; the shared solo renderer uses a full-body reference when present. It must not crop that reference as a portrait. Before the first contribution, or at the live frontier, the player displays a reduced-motion-aware waiting pulse rather than an ending.

`NEXT_PUBLIC_ENABLED_GAMES` is a comma-separated deployment setting (`influence,werewolf` by default). Supply the same value to the API runtime and web build; `Dockerfile.web` accepts it as a build argument. Omit a game to disable new creation and discovery while preserving existing match URLs. This is a rollout setting, not an authorization boundary. Both games' public rules remain readable.

Rules are maintained in `docs/rules-page-content.md` (Influence) and `docs/werewolf-rules-page-content.md` (Werewolf), rendered directly at `/rules?game=influence|werewolf`. Update those Markdown files instead of copying rules into JSX. Desktop uses a chapter sidebar; mobile uses a sticky bottom game/section selector. Docker copies both documents into the runtime image.

## House entry and moment sharing

Both games now enter through `/games/:slug`. Casting, episode layout, cards and playback controls share House components while game modules retain their own data and rules. `/werewolf/:slug` was removed. Choose Mystery or Omniscient before playback; there is no mid-match audience switch. Public entry and replay work signed out.

In player settings, **Share this moment** uses native sharing or copies a link such as `/games/example/replay?audience=mystery&cursor=65`. The cursor is a stable source entry for that audience, not an animation or page index. Opening the link begins in that source window with device preferences. Missing audience with a cursor, repeated/invalid values and unavailable initial positions fail explicitly. Links confer no private access. See [integration knowledge](solutions/architecture-patterns/house-game-entry-and-replay-moments.md).


### House game visibility

Influence and Werewolf share **Public** (listed; anyone can watch) and **Unlisted** (absent from public discovery; anyone with the link can watch). Public is the default. Both support anonymous casting/replay/media reads; joining and operator actions retain their existing permissions. API simulation launchers accept `--visibility public|unlisted` (or `INFLUENCE_API_SIM_VISIBILITY`). Completion preserves the selection. Unlisted pages use `noindex`; links can still be forwarded.

Private game visibility has been removed. Hidden is a separate moderation control that blocks normal viewer routes and subsequent stream delivery. Audience/cursor/publication rules, raw evidence, owner learning and production permissions are unchanged. Retired or invalid stored visibility is rejected rather than silently made public. No operator database rows are automatically converted.
