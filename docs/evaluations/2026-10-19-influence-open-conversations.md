# Influence open conversations: localhost API evaluation

The user authorized full 6–8-player localhost API games within a fresh $25
inference budget. These games are durable API records, inspectable in the player,
Studio, API, and authorized MCP reads. No production deployment was performed.

Subsequent product change: spoken huddles now expose their saved structured
thinking through the normal Show thinking playback toggle. The speech-only
observations below describe the evaluated implementation before that change;
passes still produce no playback beat. No new inference is needed to replay the
existing saved thoughts.

Follow-up validation: 2,735 provider-free tests, 2,094 PostgreSQL tests, 35 focused
playback tests, and the final 173-test API projection/privacy rerun passed;
typecheck and lint passed. A browser check of `lean-peach-gem/replay/30` showed
Lyra's saved huddle thought with Show thinking enabled and hid it when disabled.
No additional inference was used. Verification evidence is saved under the
private evaluation directory's `huddle-thinking-followup/` subdirectory.

## Runs

| Game | Model | Players | Purpose |
| --- | --- | --- | --- |
| `true-slate-path` (`48ef761d-826e-40bf-aa1b-b18d175e9518`) | Muse 1.3 Contributor | 6 | Diagnostic first run; exposed reused provider-call identities. Completed, evidence retained; exclude from corrected conversation-quality conclusions. |
| `lean-peach-gem` (`05491d9d-0ede-4c85-a72c-19dc4f997688`) | GPT‑6 Luna | 6 | Corrected per-contribution provider slots; completed through retrospective. Wren won the jury vote 2–1 over Riven. |
| `punk-brown-rock` (`43df8c40-46ec-45a2-97b7-ec7a055ef917`) | Muse 1.3 Contributor | 8 | Corrected larger-cast evaluation; completed six rounds and the retrospective. Kael won the jury vote 3–2 over Zara. |

Local replay URLs use `http://localhost:3001/games/<slug>/replay`.

All games used the initial 320-byte speech ceiling, 400 bytes per participant per
conversation, and two ordinary Mingle room rounds with one movement boundary.
Paid games used portrait playback. Generated room-image selection, exact-cast
reuse, accepted-prefix restrictions, and saved scene bindings were exercised by
deterministic API/renderer tests, not by paid image generation in this batch.

The initial bug and fix are documented in
[Per-contribution provider slots](../solutions/architecture-patterns/2026-10-19-per-contribution-provider-slots.md).
We did not rewrite the diagnostic game's accepted history. Fresh games exercise
the corrected runner.

## Corrected Luna game

| Surface | Decisions | Spoken contributions | Spoken UTF-8 bytes |
| --- | ---: | ---: | ---: |
| Lobby, including endgame | 30 | 29 | 6,519 |
| Ordinary Mingle | 30 | 28 | 6,572 |
| Three huddles | 19 | 14 | 3,154 |

There were seven voluntary passes and one movement-only choice from a solo
room. All 79 conversation decisions retained structured thinking and distinct
durable provider slots. Every speech fit the 320-byte ceiling; the largest was
301 bytes. All 222 provider-attempt evidence objects were exported and verified
against their stored hashes and lengths. The evidence includes a recovered
transport timeout and a rejected empty strategy delta. The cognitive record
contains 166 thinking, 156 strategy, and 25 reasoning artifacts across the game.

The pass reasons were sensible: settled ballot commitments, already expressed
support, avoiding redundant chatter, and listening rather than disclosing more.
None of the inspected pass explanations relied on seeing another player's
private pass. A movement-only `noReply` is not counted as voluntary silence.

The first movement boundary merged two pairs into a four-person room while the
remaining pair stayed together. In round two, the solo Orion joined a group via
the movement-only decision. The room arrangement changed only at the boundary.
Whole-game speech counts ranged from seven to eighteen per player, reflecting
different survival lengths as well as floor selection; this is not a per-window
fairness measure. No accepted speech was an exact duplicate of another.

The conversation had direct answers, disagreement, reassurance, humor, changes
of position, and replies to earlier statements. For example, Riven's proposed
no-EXIT safety bloc became a specific Lyra EXIT plan after other players pushed
for a concrete decision. Players then checked commitments in the huddle. This
is qualitative evidence from one full game, not proof that every conversation
is natural or that this tuning is optimal.

### Recall and privacy

Across 111 saved calls containing recent attended huddle context, all 525
included speech entries matched the actor's immutable session audience. No
foreign huddle speech appeared in that recent-context section. Thane's round-2
ballot retained his own round-1 huddle with Lyra, while the four-person alliance
received its round-2 exchange. A public disclosure does not grant raw-session
access. Differential deterministic tests additionally cover hidden session
existence, references, caches, and recall receipts.

All 14 accepted huddle speeches appear in the production source with no thinking.
Browser inspection during live replay showed the exact four-person huddle
as a portrait room: Jace, Riven, Wren, and Orion. Passes produce no playback beat.
The completed replay also shows huddles as speech only with Show thinking enabled
and ends on final standings after the retrospective. Its observed full timeline
with thinking enabled was 40:24; this is not a matched comparison against the old
conversation format. No participant missed every opportunity in any completed
Luna conversation, but the scheduler makes no such guarantee.

The localhost MCP manifest reports complete canonical facts, complete finale
integrity, and completed settlement. Its owner transcript/cognition lanes remain
denied to this creator-only test identity, which owns no participating seat. That
denial must not be mistaken for lost evidence or bypassed via producer privileges;
the manifest's formal-speech parity warnings reflect its unavailable owner lane.

### Remaining quality issues

- Short List arithmetic remains unreliable. Orion proposed an illegal Jace
  self-vote; Jace caught it, but the replacement plan incorrectly treated three
  votes on Thane versus two on Jace as eliminating Thane. Other agents repeated
  that mistake. The engine still applied the canonical rule correctly.
- Identity slips remain: Orion described Jace's self-vote restriction as his own;
  some thinking referred to the actor's own name as though discussing someone
  else. This is model reasoning quality, not evidence of swapped engine actors.
- Huddles sometimes sought a new promise from someone absent, despite ordinary
  Mingle already being over. A final prompt clarification now states that the
  session cannot move rooms or obtain new answers from absent players and that
  formal alliance actions for the social window have finished. These completed
  games predate that clarification; do not claim it has paid-game validation.
- Some exchanges repeat vote arithmetic and conditional commitments. Keep the
  initial allowances for now; this sample does not justify increasing them.

## Corrected eight-player Muse game

The game exercised both social windows of Two Names in round three, followed by
another Save or Exit round and the endgame. Its dialogue carried forward earlier
phrases, relationships, and commitments. Some huddles moved from reassurance to
specific ballot and override negotiation. In the round-three huddle, Zara,
Thane, and Kael each passed after confirming their pact; saved thinking explicitly
identified repetition and over-selling as reasons to stop.

Silence is still inconsistent. In round four, an eight-speech huddle largely
reconfirmed the same four-player pact and repeated shared language about being
steady, breathing easier, and holding together. Ordinary Mingle had already
established that pact. This is a useful candidate for prompt tuning: reassurance
can be valuable without being new information, but agents should distinguish a
needed response from another round of mutually repeated agreement. Do not add a
prose classifier or force passes merely because no new fact was introduced.

| Surface | Decisions | Spoken contributions | Spoken UTF-8 bytes |
| --- | ---: | ---: | ---: |
| Lobby, including endgame | 56 | 56 | 12,075 |
| Ordinary Mingle, including both Two Names windows | 68 | 64 | 14,907 |
| Three huddles | 20 | 14 | 2,401 |

Eight decisions were voluntary passes; two were solo movement-only decisions.
All 144 conversation decisions retained thinking and distinct durable slots.
No participant missed every opportunity in a completed conversation. Every
accepted speech fit its allowance; the largest was 316 bytes. All 434 provider
attempts were exported and verified against their stored hashes and lengths.
The cognitive record contains 337 thinking and 310 strategy artifacts; Muse's
opaque provider reasoning is retained in raw evidence rather than presented as
readable native reasoning.

The actual saved requests contained 693 recent-huddle entries across 141 calls.
Every entry matched the actor's immutable session audience. The production
source contains all 14 huddle speeches and no huddle thinking. As in Luna, this
audit supplements the differential privacy tests rather than proving privacy
solely from one successful game.

Browser verification reached final standings after the retrospective. The
observed full replay timeline was 71:28 with Show thinking off and 71:38 with it
on. This longer six-round, eight-player game is not a matched speed comparison;
bounded conversations alone do not guarantee a short overall show.

The live run exercised feedback-informed length repair: Finn's 324-byte draft
was rejected against a 320-byte allowance. His retry received the full draft,
exact sizes, four-byte overage, and rejected structured decision, then shortened
the speech while preserving its target, question, strategy, and thinking.

Other provider failures deserve separate interpretation. Three transport
timeouts recovered. Two optional House summaries hit their output-token limits.
Two Tribunal jury tiebreaker calls returned prose instead of the required tool;
the existing phase-level fallback supplied explicitly marked engine decisions.
Those votes are not accepted agent choices, even when the prose suggests a
target. They limit strategic-quality conclusions about the Tribunal outcome.
These failures did not discard evidence or prevent the full game from finishing.

## Verification

- Final provider-free baseline: 2,735 passed, five skipped, zero failures.
- Final PostgreSQL baseline: 2,091 passed, zero failures. An earlier run exposed
  an assertion depending on permission-array order; it now compares sorted
  values. The focused admin routes, game routes (including huddle pagination),
  and lifecycle configuration run also passed all 163 tests.
- API browser suite: 71 passed, five skipped, five failures caused by the optional
  analytics-consent overlay intercepting unrelated actions. The harness now
  opts out explicitly. Rerunning all three affected files passed eight tests.
- Focused privacy, provider-slot, visual binding, and malformed-output tests pass.
- Typecheck and lint pass. No live provider credentials enter deterministic CI.

## Evidence and accounting

Private exports, progress logs, the spend ledger, and the browser screenshot live
under `packages/engine/docs/simulations/influence-open-conversations-2026-10-19/`
and remain ignored by Git. They retain original sanitized provider evidence,
canonical events, accepted calls, transcripts, cognitive artifacts, and committed
turns. Stored reasoning is the reasoning the provider exposes; hidden internal
chain of thought is not available to the application.

All three games and their automatically scheduled House Cuts jobs are terminal.
The games completed; all three House Cuts jobs failed with `Cut participant has
no source evidence`. Their journals and 34 attempts are preserved separately.
These are editorial-output failures, not successful cuts or failed games.

| Accounting | Reported-usage estimate | Conservative reservation total |
| --- | ---: | ---: |
| Gameplay, including diagnostic run and retries | $0.893634 | $6.983893 |
| Automatic postgame editorial jobs | $0.006452 | $0.095870 |
| **Combined** | **$0.900086** | **$7.079763** |

The aggregate remains below the authorized $25 cap even using the conservative
total. These are local estimates and reservations, not a provider invoice.
Seven gameplay reservations have no reported usage and retain their full reserve;
they are not silently counted as free. `accounting-summary.json`, the final
ledger snapshot, and the separate editorial journal document the calculation.

All 859 gameplay provider-attempt evidence objects across the three games were
exported and hash/length verified. Server logs also retain an owner-scan deadlock
that recovered and a secondary private-trace indexing warning during ownership
change. The primary provider evidence objects are intact; this report does not
claim every secondary index was free of warnings. The immutable exports include
accepted history and failed attempts without rewriting the diagnostic game.
