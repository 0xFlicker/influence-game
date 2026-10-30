# Follow a game with the House

All follow controls live in **House Studio** (`http://localhost:8787`). Paste a live/replay game URL into **Follow a game**, choose the Werewolf viewing mode if the URL does not already specify it, and click **Follow game**. Studio opens a named operator player tab under `/admin/follow/:slug`. Sign into the game with Producer or Sysop access. The existing player runs there with an automatic, paired connection to this Studio; no port entry or follow controls appear in the player.

Operator players open **paused in theater mode**, including live games and links to a replay position. Size/capture the tab in OBS, then press Play when ready. Theater fills the browser viewport without requesting native browser fullscreen. Leaving theater or pausing later is still under operator control. Ordinary public viewers keep their existing startup behavior.

For images, click **Share game tab** in Studio, select that operator tab in the browser chooser, and verify Studio's preview. **Stop sharing images** and **Stop following** are also in Studio. Closing the operator player ends its connection. Public live, replay and embed viewers never mount the operator bridge and expose no follow UI or localhost connections, even if a pairing fragment is appended to their URL.

Tab sharing is available as soon as the paired player connects, even while paused before its first context reveal. Preview starts immediately; screenshot uploads wait for a valid game position, so setting up the capture does not require starting playback.

The temporary pairing is created by Studio and bound to the chosen game and game-site origin. Its token travels in the operator URL fragment, not a server query or game context. Only one player can claim it; replacement, stop or player closure invalidates it. Choosing another game opens a fresh detached operator tab and retires the old paired playback. Screenshot uploads come from Studio and require that active pairing. Producer/Sysop checks protect the operator view and the context API. The implementation targets current games, without historical compatibility paths.

## Structured knowledge

`@influence/engine/game-follow` defines a versioned `GameFollowKnowledge` envelope and a game adapter contract. The player sends its canonical source coordinate and semantic action part to `POST /api/admin/production/games/:id/follow-context`. The API reads canonical events, frozen identities, accepted dialogue and stored cognition in one consistent database snapshot. It returns rules, roster/background, state, current facts, history and thinking. No DOM text, visual layout, transcript parsing or screen recognition determines game knowledge.

Visibility is determined by game mode, independently of the **Show thinking** toggle:

- **Mystery Werewolf:** audience-projected public events and state; no role fields, private night choices or thinking.
- **Omniscient Werewolf:** accepted public/private knowledge and thinking through the current action.
- **Influence:** accepted knowledge through playback, including dialogue, votes, alliances and available cognition.

A composite canonical event can contain several actions. The shared semantic coordinates distinguish ballots, tally, outcome, role explanation and role result. The browser waits for the action's existing reveal point on the shared playback clock (respecting pause, speed and seek); this adds no commentary pacing delay. Only reached facts are released; prefetched choices and later outcomes stay out. The projection uses a valid contiguous event prefix, with separately released current facts where an event is still partly revealed. New game kinds must implement the adapter and its audience/temporal tests; there is no latest-state fallback. Skipped display of thinking does not suppress eligible thinking in the feed.

The backend receives the complete bounded snapshot. GPT-Live receives setup once, then compact newly released event/action and attributed-thinking messages while game speech plays. Studio validates each semantic item against the append budget; only oversized items require a GPT-6-Luna summary, retained with its source evidence. It no longer chunks raw JSON or resends rules/profiles on speaker changes. Full rulebooks, personality/strategy records and history remain backend-readable. Its backend `get_stream_context` reads the same bounded knowledge. Direct MCP reads of the followed game and unbounded collections/traces are automatically denied while following, so they cannot fetch the current game head or private Mystery facts. Rules/model metadata and explicitly named other games remain available. MCP, audience and Codex connections stay connected. Existing context from before following is retained; the operator decides when to start a new session.

Seeking aborts obsolete context requests; delayed responses cannot attach to a new position or game. Joining midway makes the permitted prefix available for analysis without instructing the House to narrate a recap. Context failures appear beside the follow controls and never suspend the game.

## Images and speech

Studio tab sharing captures actual video pixels, sampling a JPEG every two seconds at up to 1280 pixels wide. This is an initial image sampling choice, not a commentary limit. The House keeps only the latest frame in memory, associated with its game and position; a frame for another position is not supplied as the current view. Stop sharing stops the media tracks and clears the image. Sampling latency can miss brief changes.

The vision backend's `get_game_image` tool supplies actual image content through Eve's image/file parts. GPT-Live receives the backend's observations. Images do not enter JSON prose or determine canonical game facts. Sampling itself makes no provider calls; the backend inspects the latest image during its normal delegated analysis.

The existing audio element's actual `playing` event and published clip speaker ID control speech priority. Preloading and silent audio unlock do not claim the floor. Audible game speech locally mutes the House and sends GPT-Live the yield instruction. End, pause or mute immediately releases that temporary mute. Manual House mute remains independent. Music does not claim the floor. Audience/Codex context continues; their speak cues wait while game speech plays. Commentary remains prompt guided, without delays, quotas, new audio routing or recovery machinery.

Music ducking runs in the game player on both Mac and Windows. The House's existing audible audio meter sends speaking/silent transitions back over the follow connection. Either audible game speech or House speech lowers opening and gameplay music to 35% of the selected volume; overlapping voices apply that reduction only once. Muted, paused or zero-volume House output does not duck music. When speech ends or following disconnects, the selected music volume is restored (game speech still ducks independently). Music mute preferences and character voice volume are unchanged. OBS/Voicemeeter can keep their current routing; human-microphone ducking is not added.

The Studio checkbox **Pause game while the House speaks** enables buffered commentary. GPT-Live receives the current contribution and decides whether to comment. Studio captures generated PCM while the current game speaker finishes, asks the paired player to hold, and waits for its quiet-boundary acknowledgment before playback. The player freezes the cue clock synchronously at that boundary and suspends further speech/thinking media; background music continues ducked during House playback. Late House audio uses the same path and waits for the currently active game speaker. No reply-to-request correlation or separate comment/pass model is used. No audio means no hold. A 1.2-second capture-quiet heuristic preserves short internal pauses; the hold releases only after scheduled audio and the device output latency drain. Muting the House clears its queued speech; disconnecting, stopping following or disabling the checkbox releases the hold. Manual player pause is preserved. Public pages mount no follow connection or controls.

## Windows localhost development

Start the Mac API gateway and web app in separate terminals. A game worker is unnecessary for viewing a retained game:

```sh
bun run dev:api
bun run dev:web
```

In the Mac `house-host` checkout:

```sh
bun scripts/tunnel-game-to-pc.mjs
```

The helper uses the existing `borg-pc-1:2222` SSH connection and loopback-only WSL forwards: Windows `http://localhost:3001` → Mac web, Windows `http://localhost:3000` → Mac API. Keep it running. This preserves the localhost secure context required by Privy. The House still runs on the PC. Occupied listening ports produce an error; no service is replaced or permanent proxy installed.

Use `http://localhost:3001` in Windows. Allow local-network access if Chrome asks. The bridge accepts the normal localhost development origin, The House production origin, and existing staging origin. Remote HTTPS-to-localhost behavior is not qualified by the local test.

## Validation

- API tests cover current Werewolf/Influence knowledge, role/thinking visibility, staged actions, ballot boundaries, future-suffix independence and Producer authorization.
- The Chrome tests run the real operator boundary and publisher with a deterministic API: public viewers have no follow UI or socket traffic, non-producers are denied, changing DOM text has no effect, and stale seek responses are discarded. Studio tests launch the paired tab and verify captured video pixels become JPEG images.
- House tests cover typed messages, image/position association, actual vision content parts, MCP read bounds, mute-before-steering, immediate unmute, manual mute and audience/Codex continuity.
- `watch-voice.test.tsx` covers actual media events, preload/mute/pause/end and playback continuity.

Local validation on 2026-10-29: repository typecheck/lint and the House build passed; the provider-free baseline passed 3,123 tests (five skipped), with three additional contract tests passing separately. House unit tests passed 48 tests and the two browser suites passed five tests. The PostgreSQL baseline passed 2,269 tests with one unrelated staging-render cleanup timeout; that file and the final follow-context tests passed together on retry (13 tests). Database checks used a disposable database to avoid competing with another checkout's test run.

Music ducking validation on 2026-10-30: six browser tests, 29 music/voice tests, 48 House unit tests and typecheck/lint passed. A synthetic tone exercised the real House meter and bridge, including mute, pause, zero volume and silence. Player checks covered speaker handoffs, changing music volume while ducked, stop and disconnect restoration. No paid providers were used.

The Windows loopback forwards were previously checked with HTTP requests. Windows browser/Privy login, native game-tab selection, and a listening rehearsal with the updated integration remain operator acceptance checks. No new paid game or GPT-Live run is part of this context implementation. Optional OBS/Voicemeeter automation remains separate work.

Operator-only correction validation: nine game-browser tests and five House-browser tests passed without paid calls, including Studio popup pairing, tab capture/preview, audio interruption/ducking, public isolation and role denial. All 49 House unit tests and repository typecheck/lint passed.

Development lifecycle correction (2026-10-30): the operator publisher defers socket creation to a cancellable microtask so React Strict Mode's discarded setup never consumes the one-use pairing. Browser fixtures run under Strict Mode and assert exactly one socket attempt; real player closure still ends following. This does not add reconnection or change pairing authorization.

The correction passed ten Strict Mode browser cases plus a cross-project smoke using the real House Studio server/WebSocket and the actual operator publisher: the paired player published fixture context, enabled Stop/Share, and released on close without any GPT-Live session. Windows localhost ports 3001 and 3000 returned HTTP 200 after restoring detached Mac web/gateway/tunnel processes. An invalidated pairing requires a fresh Follow game click; restoring the tunnel does not revive an expired token.

## Commentary boundaries and completed playback

The paired player publishes a separate commentary boundary from its canonical cues and the existing recorded playback clock. A night-resolution screen is kept together with the following daytime announcement; quiet gaps between these screens do not release buffered House audio. Announcements, including the result reveal, reserve the floor until their narration/read window finishes. This does not widen or otherwise change the Mystery/Omniscient knowledge projection.

After the retrospective reaches the closing results reprise, the player explicitly reports concluded playback. House Studio sends one acknowledged game-finished update and asks for a closing take followed by discussion with the operator. Buffering and the automatic microphone gate end at that boundary; manual microphone/House mute selections remain authoritative. The winner's first reveal is not the end-of-game conversation trigger.
