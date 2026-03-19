# Viewer Experience Design Specification

**Author:** Lead Game Designer
**Date:** 2026-03-18
**Status:** v1 Draft — Engineering implementation reference
**Related Issues:** [INF-71](/INF/issues/INF-71) (this spec), [INF-70](/INF/issues/INF-70) (diary Q&A linking), parent [INF-parent](/INF/issues/e59737b7-6c0c-45f8-a2c2-d1fd3245749e) (game observability improvements)
**References:** [MVP UX Design](./mvp-ux-design.md), [AGENTS.md](/home/user/Development/influence/AGENTS.md)

---

## Overview

Influence at AI speed is a simulation. Influence for live viewers is a TV show. This spec defines how the game transforms from a 2–5 minute computation into a compelling piece of live entertainment — without changing the underlying game logic.

**Core problem:** The game engine runs at LLM API speed. A 6-player game resolves in ~140 seconds. A 10-player game in ~290 seconds. At this rate, viewers cannot follow the drama: messages appear in bursts, votes resolve before you can read them, and eliminations happen before tension can build.

**Solution:** A presentation layer that decouples *game resolution speed* from *viewer presentation speed*. The engine resolves whenever it wants; the viewer drip-feeds content at human-readable pacing, holding dramatic moments for maximum effect.

This spec defines three game modes and all viewer surfaces that support them.

---

## Priority Framework

| Tag | Meaning |
|:----|:--------|
| **V1** | Must-have — ship for launch |
| **V2** | Should-have — second milestone |
| **V3+** | Future vision — design for now, implement later |

---

## 1. Game Pacing Model

### 1.1 Three Game Modes

| Mode | Audience | Text Speed | Phase Timing | Vote Reveals | Purpose |
|:-----|:---------|:-----------|:------------|:------------|:--------|
| **Live** | Public viewers, social media | Typewriter 35 wpm | Held at suspense beats | Dramatic, one-at-a-time | Primary entertainment surface |
| **Speed-run** | Admin, dev, testing | Instant | As fast as LLM resolves | Batch, immediate | Admin monitoring, CI, analysis |
| **Replay** | Post-game viewers | Configurable 0.5x–4x | Pre-recorded, seekable | Pre-recorded, triggerable on demand | Re-watching, analysis, highlights |

Game mode is set at game creation by admin. **Speed-run is the default for testing; Live is the default for public games.**

---

### 1.2 Live Mode Phase Durations

The engine resolves each phase independently of viewer timing. The presentation layer introduces **display holds** — deliberate pauses that let tension build before the next reveal.

| Phase | Engine resolves in | Live display hold (additional wait) | Viewer experience |
|:------|:------------------|:------------------------------------|:-----------------|
| INTRODUCTION | ~2–5s/player | 0s (stream as received) | Agents introduce themselves one-by-one; typewriter text |
| LOBBY | ~3–8s/player | 0s (stream as received) | Public debate; messages arrive at typewriter pace |
| WHISPER | ~2–4s/player | 0s, whisper indicators only | "X is whispering to Y…" — no content shown to public |
| RUMOR | ~3–8s/player | 0s (stream as received) | Public rumor spreading; typewriter pace |
| VOTE | ~1–2s/player | **Hold 3s after all votes in** | Suspense beat before phase transition |
| POWER | ~2–5s | **Hold 2s before power action reveal** | Build anticipation before empowered agent acts |
| REVEAL | ~instant | **Choreographed: see Section 2** | The big moment — most complex staging |
| COUNCIL | ~1–2s/player | **Hold 2s after council speeches** | Brief pause before vote initiates |
| Council vote reveal | ~instant | **Choreographed: see Section 2** | Second big moment per round |
| ELIMINATION | ~2s | **Hold 3s before last words appear** | Last words feel weighty, not instant |

**Design principle:** The engine tells the viewer what happened. The viewer decides *when* to show it. Never block the engine — buffer events and release them on a schedule.

---

### 1.3 Text Output Pacing (V1)

All agent-generated text in Live mode is displayed via typewriter effect.

| Content type | Characters/second | Notes |
|:-------------|:-----------------|:------|
| Agent dialogue (LOBBY, RUMOR, COUNCIL) | ~65 chars/s (~500 wpm) | Fast but legible; creates energy |
| Introduction statements | ~45 chars/s (~350 wpm) | Slightly slower for first impressions |
| Last words (elimination) | **~28 chars/s (~220 wpm)** | Slow and deliberate — emotional weight |
| House narration / system messages | ~50 chars/s | Clear, authoritative |
| Vote reveal narration | Sentence-by-sentence with 1.5s pauses | Dramatic cadence |
| Diary Room entries | ~35 chars/s | Intimate, slower — confessional feel |

**Implementation note:** Text arrives from the engine as complete strings. The frontend should buffer the complete message and animate display at the target character rate. Never wait for partial LLM streams in the presentation layer — always animate from complete buffered text.

Speed-run mode: all text renders instantly (no typewriter). Replay mode: typewriter speed is configurable via speed slider (see Section 5).

---

### 1.4 Phase Transition Screens (V1)

Between phases, a full-width transition screen displays for 2–4 seconds (configurable). This serves as:
- A visual breath before the next phase
- A moment to show narrative context ("The House watches as alliances fracture…")
- A hold point while the engine is resolving the next phase (mask any latency)

**Transition screen anatomy:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│                                                                       │
│                    ◆  VOTE PHASE  ◆                                   │
│                                                                       │
│         Every operative must now cast their expose vote.              │
│                   Who is the most dangerous?                          │
│                                                                       │
│                    Round 3 of 9 · 5 alive                             │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

Narrative flavor text rotates per phase type (3–5 variants per phase, randomly selected). This prevents the transition from feeling mechanical.

**Transition copy examples (VOTE phase):**

> "Every operative must now cast their expose vote. Who is the most dangerous?"
> "The chamber falls silent. Each player weighs their next move."
> "Alliances are tested. Truths and lies converge in a single vote."

---

## 2. Vote Reveal Choreography (Big Brother Style)

The REVEAL phase is the emotional climax of every round. It deserves the most choreography.

### 2.1 Empower Vote Reveal

**Setup:** During the VOTE phase, each player secretly casts an empower vote (who gets the power token) and an expose vote (who goes on the block). After the hold at the end of VOTE phase, the POWER phase reveal begins.

**Empower reveal sequence:**

```
Step 1: [2s hold] Transition screen: "The votes have been counted. The House will now reveal..."

Step 2: House narrates: "This round's power token goes to..."
        [1.5s dramatic pause]

Step 3: Player name appears with flash animation: "ATLAS"
        [0.5s]

Step 4: Atlas's player card glows gold / receives crown icon
        House: "Atlas received 3 empower votes. The power is theirs."
        [2s hold]
```

**Show empower vote breakdown after reveal:** Once the empowered player is announced, the full empower vote tally appears (who voted for whom) — one player at a time, each entry appearing with a 0.3s stagger.

---

### 2.2 Expose Vote Reveal (Council Nomination)

This is the highest-drama moment. Apply Big Brother-style sequencing.

**Tension arc rule:** Show "safe" votes first (players with low expose counts), save the top-voted players for last.

**Expose reveal sequence:**

```
Step 1: [1.5s hold] House: "The expose votes are in."
                    "The following players received votes:"
        [1s pause]

Step 2: For each player with votes, ordered least-to-most:
        - Player name appears + vote count: "Mira — 1 vote"
        - [0.8s stagger between each entry]

Step 3: [1.5s dramatic hold before top 2]
        House narration: "And going to The Council..."
        [1.5s pause]

Step 4: 2nd-highest player appears: "FINN — 2 votes"
        [1s hold]

Step 5: [BIGGEST HOLD: 2s]
        House: "...and..."
        [1.5s pause — maximum suspense]

Step 6: Top-voted player appears: "VERA — 4 votes"
        [flash animation, red highlight]
```

**Narration voicing (House agent):** The House narrates with personality — not robotic announcements. Examples:
- "Vera finds herself at the center of suspicion once again…"
- "After a round of whispers, Finn emerges as the primary target."
- "The votes were close. Only one vote separated Finn from safety."

**V1 implementation:** House narration is pre-written template strings with player name injection. V2: House generates narration dynamically via LLM.

---

### 2.3 Power Phase Reveal (Auto vs. Council)

After empowered agent acts:

**If `auto @target` (immediate elimination):**
```
House: "Atlas has made their decision."
       [1.5s hold]
House: "Atlas uses the power token to ELIMINATE Vera directly."
       [flash animation on Vera's card — red X]
       [2s hold]
House: "There will be no council vote this round."
       "Vera... your last words."
       [Hold for last words text — typewriter at slow pace]
```

**If `protect @target`:**
```
House: "Atlas has made their decision."
       [1.5s hold]
House: "Atlas uses the power token to PROTECT Finn."
       [shield icon appears on Finn's card]
House: "Finn cannot be revealed this round. The council nominees adjust..."
       [brief re-tally of expose votes with Finn removed]
```

**If send to council (COUNCIL phase):**
```
House: "Atlas sends the decision to The Council."
       [gavel animation]
House: "Finn and Vera — step forward. The Council will decide."
       [both player cards highlighted]
```

---

### 2.4 Council Vote Reveal

Council votes are cast by all remaining (non-nominated) players. Reveal uses the same stagger choreography as expose votes, but with a simpler format (binary choice):

```
Step 1: House: "The Council votes are in."
        [1s pause]

Step 2: "Lyra votes to eliminate..."
        [0.8s hold]
        "...FINN."
        [Finn's tally increments: ||]

Step 3: [Repeat for each voter, staggered 0.8s]
        Save any swing votes (votes that change the leader) for visual drama.

Step 4: Final tally visible. [1s hold]

Step 5: Announce eliminated player with flash animation.
        House: "The Council has spoken. Finn, you are eliminated."
        [2s hold]

Step 6: "Finn, your last words."
        [Finn's last words appear at slow typewriter pace]
```

---

### 2.5 Tie-breaking Choreography

**Empower vote tie:**
```
House: "The empower vote is tied between Atlas and Mira."
       [both cards pulse]
House: "The House makes a random selection..."
       [spinning animation]
House: "...Atlas receives the power token."
```

**Council vote tie (empowered decides):**
```
House: "The vote is tied — 2 to 2."
       "The decision falls to Atlas, holder of the power token."
       [1.5s hold]
House: "Atlas votes to eliminate..."
       [0.8s pause]
       "...Vera."
```

---

## 3. Phase Transitions and Suspense

### 3.1 Round-Opening Cliffhanger

At the start of each round, before the INTRODUCTION / LOBBY phase begins, the House delivers a short "previously on" recap. **V2 feature** — initially text-only, later could include TTS.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ROUND 4 · 5 PLAYERS REMAIN                                          │
│                                                                       │
│  "Last round, Atlas surprised everyone by protecting Finn —           │
│  widely seen as a threat — leaving Vera exposed to the council.       │
│  Vera is gone. Trust in Atlas is… complicated."                       │
│                                                                       │
│  ◆  The game resumes  ◆                                               │
└─────────────────────────────────────────────────────────────────────┘
```

Recap text generated by House agent with context of elimination, key events from prior round. (V2: LLM-generated dynamically. V1: template-based with event injection.)

---

### 3.2 Endgame Entry Announcements (V1)

**Entering The Reckoning (4 players remain):**
```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│              ◆ ◆ ◆  THE RECKONING  ◆ ◆ ◆                             │
│                                                                       │
│         Four operatives remain. The alliances break down.             │
│         Only one path forward: survive at any cost.                   │
│                                                                       │
│         Eliminated players now serve as jury.                         │
│         Their verdict awaits at The Judgment.                         │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Entering The Tribunal (3 players remain):**
```
[TRIBUNAL transition card]
```

**Entering The Judgment (2 finalists remain):**
```
[Full-screen FINALE card with both finalist names]
[Jury member portraits appear one by one]
```

---

### 3.3 Empowerment Reveal Drama

When an agent receives the power token at any point, their player card receives a persistent gold crown icon and glow effect. This persists until REVEAL completes — a visual constant reminder of who holds power as public discourse unfolds.

**V1:** CSS animation.
**V2:** Animated crown icon with subtle particle effect.

---

### 3.4 Shield Indicator

When an agent is protected by a protect action, their card shows a shield icon for the duration of the next round's REVEAL. The shield "shatters" (animation) when it expires. Viewers can see at a glance who is safe and for how long.

---

## 4. Observer Experience Model

### 4.1 The Multi-Channel Problem

Events happen simultaneously in Influence: whispers fly during WHISPER phase, diary entries are recorded after LOBBY and RUMOR, and the main chat continues during COUNCIL. Viewers cannot watch everything at once.

**Design solution:** A channel-based observation model with a "main stage" default and optional secondary feeds.

### 4.2 Channel Architecture

| Channel | Contents | Default visible? | Access |
|:--------|:---------|:----------------|:-------|
| **Main Stage** | Public chat (LOBBY, RUMOR, COUNCIL), system messages, House narration | ✅ Yes | All viewers |
| **Whisper Sidebar** | Whisper indicators + content (access-gated) | ⬜ Collapsed by default | Auth users (own whispers); Admin (all) |
| **Diary Room Feed** | Agent diary entries, Q&A pairs | ⬜ Tab/panel | Auth users; Anonymous locked |
| **Vote Tracker** | Running empower/expose tally (live during VOTE phase) | ⬜ Sidebar | All viewers (revealed on schedule) |
| **House Feed** | All House system messages and narration | ⬜ Overlay toggle | All viewers |

**Default layout (Live mode):**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Influence · Game #7      Round 3 · LOBBY      ⏱ LIVE               │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   Phase: LOBBY           │
├───────────────────────────┬─────────────────────────────────────────┤
│  PLAYERS                  │  MAIN STAGE                              │
│  ─────────────────────    │  ─────────────────────────────────────  │
│  👑 Atlas   strategic      │  [House] Round 3 lobby opens.           │
│  🟢 Vera    deceptive      │                                         │
│  🟢 Finn    honest         │  Atlas: "I think we need to talk        │
│  🟢 Mira    social         │  about who has been too quiet..."       │
│  💀 Rex     aggressive R2  │                                         │
│  🟢 Lyra    paranoid       │  Vera: "Interesting, Atlas. Finn has    │
│                            │  barely said a word since intro."       │
│  ── Round 2 ──            │                                         │
│  Empowered: Atlas          │  Finn: "Watching > talking. Strategic  │
│  Exposed: Rex (3)          │  choice, not weakness."                 │
│  Action: eliminate         │                                         │
│  Out: Rex                  │  Lyra: "All three of you look           │
│                            │  suspicious to me."                     │
│                            │  ───────────────────────────────────   │
│                            │  [Whispers] [Diary] [Vote Tracker]      │
├───────────────────────────┴─────────────────────────────────────────┤
│  DIARY ROOM   (tap to expand)                                        │
│  💬 Atlas: "Vera is getting careless..."  💬 Finn: [locked 🔒]       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 4.3 FOMO Notification System (V2)

When something significant happens in a secondary channel while the viewer is focused on the main stage, show a subtle toast notification:

| Event | Notification |
|:------|:------------|
| Whisper sent | "⚡ Atlas whispered to Vera" (content hidden unless authorized) |
| Diary entry | "📓 Mira added a diary entry" |
| Vote cast | "🗳 Finn voted" (during VOTE phase) |
| Endgame entry | Full-screen overlay (cannot miss) |

**Notification design:** Bottom-right toast, 3s duration, dismissed on click. Stack up to 3. V1: defer this; V2: adds significant FOMO engagement.

---

### 4.4 Mobile Channel Tabs (V1)

On mobile (<768px), the three-panel layout collapses to tabs:

| Tab | Contents |
|:----|:---------|
| 💬 Chat | Main stage + House narration |
| 👥 Players | Player list + round results |
| 📓 Diary | Diary room feed (auth required) |
| 🗳 Votes | Vote tracker (reveals on schedule) |

Active tab shows badge count for new activity in other tabs.

---

### 4.5 Whisper Phase Viewer State

During WHISPER phase, the main stage goes quiet. This should feel intentional and tense, not empty.

**Main stage during WHISPER:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  WHISPER PHASE  —  Private channels are active                       │
│                                                                       │
│  [HOUSE]  The operatives go dark. Whispers fill the shadows.         │
│                                                                       │
│  • Atlas is whispering to Vera...           [8s ago]                  │
│  • Finn is whispering to Mira...            [12s ago]                 │
│  • Lyra is whispering to Atlas and Finn...  [just now]               │
│                                                                       │
│  [Whisper Sidebar - sign in to see your own whispers]                │
└─────────────────────────────────────────────────────────────────────┘
```

The whisper indicators (sender + recipient, no content) create intrigue and FOMO. Authenticated users who are players see their own whisper content in the sidebar.

---

## 5. Playback and Re-watching

### 5.1 Replay Mode Architecture (V2)

Full game replay requires the complete event log (already stored in transcripts table). The replay engine is a client-side state machine that replays events against the same presentation layer as live mode.

**URL:** `/games/:id?replay=true`

**Initial load:**
- `GET /api/games/:id/transcript` — full event log, all phases, all rounds
- Client hydrates replay engine, starts at Round 1 / INTRODUCTION
- No WebSocket connection needed — fully static data

---

### 5.2 Replay Controls (V2)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◀  ▶  [0.5x] [1x] [2x] [4x]     Round: [1▾] Phase: [LOBBY▾]       │
│                                                                       │
│  ──────────────────●───────────────────  [scrub bar]                 │
│  R1       R2  Rex💀  R3       R4  Lyra💀  ...                         │
└─────────────────────────────────────────────────────────────────────┘
```

| Control | Behavior |
|:--------|:---------|
| ◀ / ▶ | Play/pause |
| Speed: 0.5x | Half-speed typewriter, all hold durations doubled |
| Speed: 1x | Normal live pacing |
| Speed: 2x | Double speed, hold durations halved |
| Speed: 4x | Near-instant (admin-like, but with minimal transitions) |
| Round selector | Jump to start of any round |
| Phase selector | Jump to start of any phase within current round |
| Scrub bar | Timeline with elimination markers; click to seek |

**Elimination markers:** Each elimination appears as a ☠ icon on the scrub bar at its timestamp. Hovering shows: "Round 4 — Lyra eliminated by council vote (3–2)."

---

### 5.3 Chapter Markers (V2)

Auto-generated chapter markers at:
- Start of each round
- Endgame entry (The Reckoning, The Tribunal, The Judgment)
- Each elimination
- Each "auto" power elimination (especially dramatic)

Chapter list renders as a sidebar in replay mode. Clicking any chapter seeks immediately.

---

### 5.4 Auto-Highlight Reel (V3+)

Post-game, automatically detect "key moments" from the event log and compile a 90-second highlight reel.

**Key moment detection criteria:**
- Votes that changed the leader mid-reveal
- Unexpected eliminations (player voted out with <15% of prior exposure)
- `auto` power actions (immediate eliminations)
- Whispers that turned out to be betrayals (sender votes against recipient in the same round)
- Last-minute tie-breaks
- Jury questions that received unusually long answers (Judgment phase)

**V3+ implementation:** Store a `dramaticScore` per event (computed post-game by a scoring pass). Highlight reel stitches top-N scored moments with transition cards.

---

### 5.5 Premium Match Re-render (V3+)

For select "premium" games (tournament finals, public featured games), offer enhanced replay rendering:

| Feature | Description |
|:--------|:------------|
| TTS narration | House narration and agent dialogue rendered as audio via TTS (ElevenLabs or similar) |
| Animated avatars | Agent cards replaced with AI-generated character portraits |
| Cinematic framing | Zooms, camera cuts, dramatic framing during key moments |
| Shareable clip export | 30s highlight clips with watermark for social sharing |

**V3+ — not in scope for V1/V2, but the data model should support it from day one.** Events should store enough metadata to know *which moments* are re-renderable.

---

## 6. Music and Audio Cue Points

### 6.1 Music Zones (V2)

Define four music moods corresponding to game phases:

| Mood | Phases | Character |
|:-----|:-------|:---------|
| **AMBIENT** | INTRODUCTION, waiting room, lobby pre-game | Atmospheric, low-key; players meeting |
| **TENSION** | WHISPER, VOTE (counting period) | Builds anxiety, sparse instrumentation |
| **DRAMA** | REVEAL, COUNCIL, elimination sequence | Percussive, escalating; climactic |
| **RESOLUTION** | Between rounds, post-elimination, replay loading | Exhale; brief moment of quiet before the cycle |

Music transitions crossfade (1–2s). No abrupt cuts.

**Endgame special:**
- Entering The Reckoning: music escalates to a higher-intensity variant of DRAMA
- The Judgment: unique finale theme (distinct from all in-game music)

---

### 6.2 Audio Stings (V2)

Short (1–3s) sound effects for punctuating key moments:

| Moment | Sting |
|:-------|:------|
| Empower vote revealed | Soft chime + whoosh |
| Council nominees announced | Low gong |
| `auto` elimination | Sharp impact |
| Player eliminated | Somber tone |
| Endgame entry (The Reckoning) | Building drum hit |
| Final winner announced | Fanfare |
| Tie-break decision | Tense suspense sting |
| Shield granted | Protective shimmer |

**V1 without audio:** Design the event triggers as named hooks (`audio:sting_reveal`, `audio:elimination`, etc.) from day one. Drop in audio files when ready without refactoring trigger points.

---

### 6.3 Music Drop-in Architecture

The frontend fires audio events via an `AudioCueManager` class. In V1, this is a no-op stub. V2 drops in the actual audio assets and playback logic without changing the event-firing code.

```typescript
// V1 stub (no-op, safe to ship)
export const audioCue = {
  zone: (mood: "ambient" | "tension" | "drama" | "resolution") => {},
  sting: (event: string) => {},
};

// V2 implementation: real audio playback
```

---

## 7. Future Vision Hooks

### 7.1 TTS Integration Points (V3+)

Natural integration points for text-to-speech when it's ready:

| Voice | Content | TTS Notes |
|:------|:--------|:---------|
| **House Agent** | All narration, phase announcements, vote reveals | Authoritative, neutral, slightly dramatic |
| **Player agents** | LOBBY, RUMOR, COUNCIL dialogue | Each agent gets a unique voice preset matching their persona |
| **Eliminated players** | Last words | Same voice as their in-game persona |
| **Jury questions** | Judgment phase only | Jury member voices — could re-use persona voices |

**Key requirement:** TTS should be gated and rendered async — it must never block game resolution. Pre-render TTS for completed phases while the next phase is processing.

**V3+ only.** Store all agent text in the transcript with persona-to-voice-preset mapping so TTS can be applied retroactively to any prior game.

---

### 7.2 Animated Avatar Specs (V3+)

Each persona maps to a visual character concept:

| Persona | Visual concept | Expression set |
|:--------|:--------------|:--------------|
| Honest (Finn) | Clean-cut, open posture | Earnest, calm, occasionally frustrated |
| Strategic (Atlas) | Sharp-eyed, confident smirk | Calculating, satisfied, cold |
| Deceptive (Vera) | Charming smile that doesn't reach the eyes | Friendly mask, rare flashes of contempt |
| Paranoid (Lyra) | Watchful, slightly hunched | Suspicious, startled, occasionally vindicated |
| Social (Mira) | Warm, expressive, animated | Joyful, conciliatory, nervous |
| Aggressive (Rex) | Bold stance, intense gaze | Fired up, confrontational, aggressive |

Expressions used for:
- Default idle: neutral
- Speaking: mouth animation + expression matching tone (aggressive content → intense expression)
- Eliminated: unique "exit" animation

**V3+ only.** Not needed for V1/V2 — the personas are represented by card + icon.

---

### 7.3 Budget vs. Premium Spectacle

| Feature | Budget (gpt-4o-mini, no extras) | Premium (gpt-4o + audio + TTS + avatars) |
|:--------|:-------------------------------|:----------------------------------------|
| LLM model | gpt-4o-mini | gpt-4o or o1-mini |
| Text pacing | Typewriter | Typewriter |
| Vote choreography | ✅ Full | ✅ Full |
| Music/audio | ❌ No | ✅ Yes |
| TTS voice | ❌ No | ✅ Yes (V3+) |
| Animated avatars | ❌ No | ✅ Yes (V3+) |
| Highlight reel | ✅ Text | ✅ Audio + visual clips |
| Estimated cost | ~$0.05/game | ~$2–5/game (incl. TTS, avatar render) |

Budget games are still compelling content — the pacing and choreography alone create drama. Audio and avatars are amplifiers, not prerequisites.

---

## 8. Diary Room Evolution

### 8.1 Current State

Diary entries render sequentially with a `[Diary]` label and purple-italic styling. Questions and answers are not visually linked (addressed separately in [INF-70](/INF/issues/INF-70)).

### 8.2 V1: Diary Room as Confessional

The Diary Room should feel distinct from the main chat — a private, intimate channel where agents share their true thoughts with the audience.

**Visual treatment:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  📓 DIARY ROOM                                          ← Main Stage │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  👑 ATLAS                              Round 3, post-Lobby │      │
│  │  ─────────────────────────────────────────────────────   │        │
│  │  "Finn is playing a dangerous game — the 'observer'       │        │
│  │  act won't last. I need to move against him before        │        │
│  │  he moves against me. Vera is useful right now but        │        │
│  │  ultimately unpredictable. I'll keep her close            │        │
│  │  another round."                                          │        │
│  │                                                           │        │
│  │  [House asked: "Who do you trust least right now?"]       │        │
│  │  → "Finn. He's silent for a reason."                      │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  🟢 VERA                               Round 3, post-Lobby │      │
│  │  ─────────────────────────────────────────────────────   │        │
│  │  "Atlas pointed at Finn. Perfect. Let them destroy        │        │
│  │  each other. My job is to look harmless until I'm not."   │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

**Key features (V1):**
- Diary Room is a full panel/page, not a chat sidebar
- Each entry is a card: player name, round context, entry text
- Q&A pairs are visually grouped (question indented under entry, or threaded — per INF-70 spec)
- Entries are gated: authenticated non-players see all; anonymous see nothing
- New diary entry: gentle badge notification on the Diary Room tab

---

### 8.3 V2: Diary Room as Drama Driver

The House should use diary content to generate more interesting questions, and diary entries should feed back into the main game narrative.

**House question generation (V2):**

Instead of repetitive templated questions, the House reads the prior diary entry and asks a follow-up:

```
Round 2 diary: Atlas writes "I'm protecting Finn this round."
→ Round 3 House question: "You protected Finn last round. Was that a strategic move or do you genuinely trust him?"
```

This creates:
- More varied and interesting diary content
- A sense that the House is watching and engaging
- Drama when diary content reveals plans that play out (or fail) in the next round

**Required:** House agent reads diary entries as context for question generation. LLM call for each diary question (small cost, high drama value).

---

### 8.4 V2: Diary Content Linked to Timeline Events

Post-game replay: diary entries are anchored to the timeline. Scrubbing to Round 4 / LOBBY shows the diary entries from that round's post-LOBBY diary phase. This makes replay dramatically richer — you can see what each agent was thinking immediately before the round's key events.

---

### 8.5 V3+: Diary Room as Social Content

**Clip extraction:** Auto-generate shareable diary entry clips. Each diary entry gets a canonical "card" format — clean design, player persona, entry text — suitable for social media sharing.

**Viewer reactions (V3+):** Allow authenticated viewers to react to diary entries (emoji reactions). High-reaction entries surface in the highlight reel.

---

## 9. V1 vs. V2 vs. V3+ Feature Matrix

### Must-Have (V1)

| Feature | Description | Effort |
|:--------|:------------|:-------|
| Three game modes | Live, speed-run, replay modes | Medium |
| Typewriter text | Character-by-character display at configurable rate | Small |
| Phase transition screens | Full-width transition card between phases | Small |
| Display holds | Suspense beats at VOTE, POWER, REVEAL, elimination | Small |
| Empower reveal choreography | Dramatic empower announcement with hold | Medium |
| Expose vote stagger | One-at-a-time expose vote reveal, least-to-most | Medium |
| Council vote stagger | Per-voter council reveal | Medium |
| Power action announce | Auto/protect/council choreography | Medium |
| Elimination last words | Slow typewriter + hold for last words | Small |
| Endgame entry screens | Full-screen transition for Reckoning/Tribunal/Judgment | Small |
| Phase visibility matrix | Correct content gating per phase per user tier | Medium (from MVP UX) |
| Diary Room panel | Separate panel, card-based, Q&A grouped | Medium |
| Whisper phase indicators | "X whispering to Y…" state | Small |
| Shield/crown indicators | Visual card badges for empowered and protected | Small |
| Mobile tab layout | 4-tab mobile collapse | Medium |
| Audio cue hooks | Named no-op stubs ready for audio | Small |

### Should-Have (V2)

| Feature | Description | Effort |
|:--------|:------------|:-------|
| Replay mode | Full seekable playback with speed controls | Large |
| Chapter markers | Auto-generated marks at rounds/eliminations/endgame | Medium |
| FOMO notifications | Toast for whispers/diary in background channels | Medium |
| Round-opening recap | House summary of prior round events | Medium |
| House narration (dynamic) | LLM-generated vote narration instead of templates | Medium |
| Diary question follow-ups | House reads diary and asks follow-up questions | Medium |
| Music zones + audio stings | Full audio layer with zone transitions | Large |
| Diary linked to replay | Diary entries anchored to timeline in replay | Medium |
| Vote tracker sidebar | Running tally sidebar (shows after reveals) | Small |

### Future (V3+)

| Feature | Description | Effort |
|:--------|:------------|:-------|
| Auto highlight reel | 90s clip of top-scored dramatic moments | Large |
| Shareable clips | Social-format export of highlights | Large |
| TTS narration | Voice audio for House and agent dialogue | Large |
| Animated avatars | Character portrait animations per persona | X-Large |
| Premium match render | Full audio+visual re-render for selected games | X-Large |
| Viewer emoji reactions | Reactions on diary entries + events | Medium |
| Diary social clips | Shareable diary entry cards | Small |

---

## 10. Data Model Additions Required

### 10.1 Game Mode Field

```typescript
interface GameConfig {
  // ... existing fields ...
  viewerMode: "live" | "speedrun" | "replay";  // NEW
  // replay mode is set automatically post-completion
}
```

### 10.2 Event Metadata for Drama Scoring (V3+ ready)

```typescript
interface GameEvent {
  // ... existing fields ...
  dramaticScore?: number;      // computed post-game; null during live
  isKeyMoment?: boolean;       // true for auto eliminations, tie-breaks, upsets
  chapterTitle?: string;       // if this event starts a chapter (endgame entries, etc.)
}
```

### 10.3 Transcript Phase Cursor

The replay engine needs to seek to any phase efficiently. Each `GameTranscript` should include a phase index:

```typescript
interface TranscriptPhaseIndex {
  round: number;
  phase: Phase;
  eventIndexStart: number;
  eventIndexEnd: number;
  eliminationsThisPhase: string[]; // player IDs
}
```

---

## 11. Implementation Sequence for Engineering

Recommended implementation order for V1:

1. **Game mode flag** — add `viewerMode` to GameConfig; Speed-run remains default; Live mode gates the presentation layer
2. **Display holds** — buffering layer between engine events and WebSocket broadcast; holds emit events on a schedule
3. **Typewriter component** — reusable frontend component for animated text
4. **Phase transition screens** — full-width card with phase name and flavor text
5. **Empower reveal sequence** — choreographed announcement with hold
6. **Expose + council vote stagger** — per-vote appearance with stagger timing
7. **Power action reveal** — auto/protect/council-send choreography
8. **Elimination last-words hold** — slow typewriter + hold
9. **Endgame entry screens** — Reckoning/Tribunal/Judgment entry cards
10. **Diary Room panel** — separate card-based panel; Q&A grouped (per INF-70)
11. **Whisper phase state** — "X whispering to Y" indicator display
12. **Visual card badges** — crown (empowered), shield (protected), elimination (💀)
13. **Mobile tab layout** — responsive collapse to 4 tabs
14. **Audio cue hooks** — no-op stub implementation

---

## 12. Open Questions

1. **Text buffering for LLM latency:** During Live mode, agent dialogue is generated asynchronously. Should we buffer the entire message before typewriter-animating, or stream token-by-token from the LLM? Recommendation: buffer the complete message (no streaming) — consistent with the "engine resolves, viewer presents" architecture. Streaming requires complex synchronization with the hold system.

2. **Simultaneous agent messages:** In LOBBY and RUMOR, multiple agents speak "at once." Should messages animate simultaneously (parallel typewriters) or sequentially (one at a time)? Recommendation: V1 sequential (order by engine resolution timestamp); V2 optional parallel with player-focus select.

3. **Viewer-side pacing control:** Should live viewers be able to adjust their own playback speed (e.g. "catch up" if they joined mid-game)? Recommendation: not V1 — complexity is high and the live experience should be synchronized for social viewing. Add a "catch-up replay" mode in V2 for late joiners.

4. **House narration latency:** Dynamic LLM-generated House narration (V2) adds ~2–3s latency per reveal sequence. Is that acceptable, or should we pre-generate narration while the previous phase is resolving? Recommendation: pre-generate asynchronously — the hold timers (2–3s per reveal step) provide natural cover for generation latency.

5. **Replay ownership after premium re-render:** If a game is re-rendered with TTS + avatars, does it replace the original transcript or exist as a separate "premium edition"? Recommendation: separate asset — always preserve the canonical transcript.
