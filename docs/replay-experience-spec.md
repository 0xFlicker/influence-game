# Dramatic Replay Experience — Design Specification

**Author:** Lead Game Designer
**Date:** 2026-03-19
**Status:** v1 — Ready for Engineering
**Related Issues:** [INF-89](/INF/issues/INF-89) (this spec), [INF-86](/INF/issues/INF-86) (board feedback), [INF-71](/INF/issues/INF-71) (viewer experience spec v1)
**References:** [Viewer Experience Spec v1](./viewer-experience-spec.md), [game-viewer.tsx](../packages/web/src/app/games/[slug]/game-viewer.tsx)

---

## Overview

The current replay experience is a flat message feed with manual prev/next navigation — it reads like a log, not an experience. The board wants a **video-like replay** that takes a viewer through the game as a living narrative: rooms that change, dramatic reveals, private conversations made visible, and The House interjecting at key moments.

This spec defines the architecture, scene model, room types, timing system, House overlay mechanics, and replay controls for the dramatic replay experience. It is designed to be implemented as a standalone `DramaticReplayViewer` component that replaces the current replay rendering path in `game-viewer.tsx`.

---

## Core Design Principle

**Scene-based, not message-based.** The current replay advances one message at a time. The new replay advances through *scenes* — phase-level chunks of the game. Within each scene, messages are revealed progressively at a configurable pace. Navigation operates at the scene level (skip scene, skip round) while the playhead operates at the message level.

---

## 1. Replay Timeline Model

### 1.1 Scene Definition

A **scene** is a contiguous block of transcript entries sharing the same `(round, phase)` pair, assigned to a *room type* for visual presentation.

```typescript
interface ReplayScene {
  id: string;                    // e.g. "R1-LOBBY", "R2-WHISPER"
  round: number;
  phase: PhaseKey;
  roomType: RoomType;
  messages: TranscriptEntry[];
  houseIntro: string | null;     // House narration before the scene opens
  houseOutro: string | null;     // House narration after the scene closes
}

type RoomType = "lobby" | "private_rooms" | "tribunal" | "diary" | "endgame";
```

### 1.2 Phase-to-Room Mapping

| Phase | Room Type | Visual Theme | Notes |
|-------|-----------|--------------|-------|
| `INTRODUCTION` | `lobby` | Blue/indigo | First impressions, introductions |
| `LOBBY` | `lobby` | Blue/indigo | Open group discussion |
| `RUMOR` | `lobby` | Yellow tint | Rumors spread in the lobby |
| `WHISPER` | `private_rooms` | Purple | **Full content revealed** (game over) |
| `VOTE` | `tribunal` | Orange | Silent vote casting |
| `POWER` | `tribunal` | Red | Power play activation |
| `REVEAL` | `tribunal` | Pink → Red | Progressive vote reveal |
| `COUNCIL` | `tribunal` | Red | Final elimination vote |
| `DIARY_ROOM` | `diary` | Purple | Confessional cards |
| Endgame phases | `endgame` | Amber/Gold | Reckoning/Tribunal/Judgment |

> **Whisper unlock**: In replay mode, whisper content is fully visible because the game has ended. This is one of the highest-value moments of the replay — seeing what was really said in private channels. Present this as a "private rooms" reveal, not an activity-only indicator.

### 1.3 Scene Builder Algorithm

```typescript
function buildReplayScenes(transcript: TranscriptEntry[]): ReplayScene[] {
  // 1. Group messages by (round, phase) maintaining insertion order
  const grouped = new Map<string, TranscriptEntry[]>();
  for (const msg of transcript) {
    const key = `R${msg.round}-${msg.phase}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  // 2. Convert to ordered scene array
  const scenes: ReplayScene[] = [];
  for (const [id, messages] of grouped.entries()) {
    const { round, phase } = messages[0];
    scenes.push({
      id,
      round,
      phase: phase as PhaseKey,
      roomType: phaseToRoomType(phase as PhaseKey),
      messages,
      houseIntro: getHouseIntro(phase as PhaseKey, round),
      houseOutro: getHouseOutro(phase as PhaseKey, messages),
    });
  }

  return scenes;
}
```

---

## 2. Room Layouts

### 2.1 Lobby Room (`lobby`)

Used for `INTRODUCTION`, `LOBBY`, `RUMOR` phases.

**Layout:**
- Full-width chat feed (no sidebar) — the lobby is social and open
- Phase label header: "◆ LOBBY ◆" / "◆ INTRODUCTIONS ◆" / "◆ RUMOR PHASE ◆"
- Messages reveal with Typewriter animation at `agent` rate (65 c/s) during auto-play
- Player roster visible in the right sidebar
- Blue/indigo ambient border (`border-blue-900/20 bg-blue-950/5`)

**Reusable components:** `MessageBubble`, `Typewriter`, `PlayerRoster`

### 2.2 Private Rooms (`private_rooms`)

Used for `WHISPER` phase.

**Layout:**
- **Unlock banner** at top: "The operatives went dark. These are their private conversations."
- Messages grouped by whisper thread (sender ↔ recipients pair)
- Each thread is a card with: sender name + persona emoji, recipient(s), conversation text
- Threads fade in sequentially with 600ms stagger
- Purple ambient border (`border-purple-900/20 bg-purple-950/10`)
- Full whisper text visible (unlike live mode which shows only "X is whispering to Y...")

**Key design note:** This is the biggest departure from live mode. Show the full content. The drama is discovering *what was said*, not that whispering happened.

**Reusable components:** `personaEmoji` helper, `Typewriter`
**New component needed:** `WhisperThreadCard`

### 2.3 Tribunal (`tribunal`)

Used for `VOTE`, `POWER`, `REVEAL`, `COUNCIL` phases.

**Layout:**
- Dramatic dark red ambient border (`border-red-900/20 bg-red-950/5`)
- Sub-phase label in center header
- For `REVEAL` + `COUNCIL`: messages reveal progressively at 1.5s intervals (same as live mode's `RevealModeView`)
- For `VOTE`: show a "votes being cast..." holding state, then reveal
- For `POWER`: dramatic reveal of empowered player with existing amber highlight
- Elimination reveal gets its own full-scene moment (see §3.3)

**Reusable components:** `RevealModeView`, `RevealMessageItem`, `LastWordsMessage`, `EndgameEntryScreen`

### 2.4 Diary Room (`diary`)

Used for `DIARY_ROOM` phase.

**Layout:**
- Full-width confessional card layout
- Existing `DiaryQACard` and `DiaryEntryCard` components, no auth gate (replay viewers see all)
- Cards fade in one-at-a-time at a readable pace
- Purple ambient (`border-purple-900/30 bg-purple-950/10`)

**Reusable components:** `DiaryQACard`, `DiaryEntryCard`, `DiaryRoomPanel` (remove auth gate for replay)

### 2.5 Endgame (`endgame`)

Used for `PLEA`, `ACCUSATION`, `DEFENSE`, `OPENING_STATEMENTS`, `JURY_QUESTIONS`, `CLOSING_ARGUMENTS`, `JURY_VOTE` phases.

**Layout:**
- Endgame entry screens (`EndgameEntryScreen`) trigger at the start of Reckoning/Tribunal/Judgment, same as live mode
- Phases render in tribunal-style with amber/gold theme
- Finalists' names prominent in the sidebar with "FINALIST" badge

**Reusable components:** `EndgameEntryScreen`, existing `ENDGAME_CONFIG`

---

## 3. Scene Transitions

### 3.1 Room Transition Overlay

When the room type changes between scenes (e.g., Lobby → Private Rooms), show the existing `PhaseTransitionOverlay` component with the phase label and flavor text. Duration: 2.3s (same as live).

When the room type stays the same but the phase changes (e.g., `VOTE` → `REVEAL`, both tribunal), use a lighter in-room transition: update the sub-phase header without a full overlay.

### 3.2 Round Boundary

At the start of a new round, show a brief "Round X" separator:
- Animate in over 400ms
- Hold for 1.5s
- Auto-dismiss before the first scene of the new round begins

```
◆ ◆ ◆
ROUND 3
3 operatives remaining
◆ ◆ ◆
```

Use existing `PhaseTransitionOverlay` or a lightweight variant.

### 3.3 Elimination Moment

When a `player_eliminated` event is present in the transcript (detectable from `scope: "system"` messages containing "eliminated" text in COUNCIL scenes), treat it as a special scene beat:

1. Pause auto-play briefly (2s)
2. Show existing `LastWordsMessage` choreography (already implemented, works in replay)
3. After last words complete, pause 1.5s
4. Then advance to next scene

This already works in the current codebase — `LastWordsMessage` has `isReplay: true` rendering. The dramatic replay just needs to ensure it slows down at this moment rather than skipping.

---

## 4. House Overlay Mechanics

The House interjects between scenes as a dark overlay with narration text. These overlays sit above the scene content, do not block the scene from loading, and auto-dismiss after their text finishes.

### 4.1 Overlay Trigger Points

| Trigger | House Text |
|---------|------------|
| Before `WHISPER` scene | "The operatives have gone dark. These are the conversations they didn't want you to hear." |
| Before `REVEAL` scene | "The votes are in. Every operative must now face the truth." |
| After `COUNCIL` scene (if elimination) | "The House has spoken. [Name] has been eliminated." |
| Before endgame entry (Reckoning/Tribunal/Judgment) | Use existing `EndgameEntryScreen` config |
| At `DIARY_ROOM` | "Before they move on, The House has a few questions." |
| At game end | "And then there was one. [Winner] has won Influence." |

### 4.2 Overlay Design

```
+----------------------------------------+
|                                        |
|         ◆  THE HOUSE  ◆               |
|                                        |
|  "The operatives have gone dark."      |
|  "These are the conversations they     |
|   didn't want you to hear."            |
|                                        |
+----------------------------------------+
```

- Full-screen dark overlay (`bg-black/85 fixed inset-0 z-40`)
- House wordmark: "◆ THE HOUSE ◆" in `text-white/30 tracking-[0.4em]`
- Text: `text-white/70 italic text-base md:text-lg`
- Duration: 2.5s (text length-dependent, ~50 wpm display speed)
- **Can be dismissed** by clicking — viewer agency is important here
- Does NOT pause auto-play countdown; scene begins loading behind overlay

### 4.3 Custom House Text Generation (V2)

In V1, House intros are hardcoded strings (see §4.1). In V2, these can be LLM-generated post-game based on the actual transcript content — e.g., "Atlas whispered to three different operatives in this round, none of whom knew about the others." This provides genuine analytical commentary, not just flavor text.

---

## 5. Replay Controls

### 5.1 Control Bar Layout

```
[⏮ Start] [⏭ Prev] — Scene 4 of 23 · R2 WHISPER — [Next ⏭] [End ⏮]
         [⏪ Prev Round]                               [Next Round ⏩]
[⏸ Pause / ▶ Play]  ━━━━━━━━━━━━━━━━━━━━━━━━━━━  Speed: [0.5x] [1x] [2x] [4x]
```

**Scene scrubber:** A horizontal progress bar showing all scenes as segments, color-coded by room type:
- Blue segments: lobby scenes
- Purple segments: private room scenes
- Red segments: tribunal scenes
- Purple-dark segments: diary scenes
- Gold segments: endgame scenes

Clicking a segment jumps to that scene.

### 5.2 Control Behaviors

| Control | Behavior |
|---------|----------|
| ▶ Play / ⏸ Pause | Toggle auto-advance. Pause freezes at current message within scene |
| ← Prev Scene | Jump to start of previous scene |
| → Next Scene | Jump to start of next scene (skip remaining messages in current scene) |
| ⏮ Start | Jump to scene 0, message 0 |
| ⏭ End | Jump to last scene, last message (full reveal state) |
| ⏪ Prev Round | Jump to first scene of previous round |
| ⏩ Next Round | Jump to first scene of next round |
| Speed: 0.5x | Message reveal interval × 2 (slow for accessibility/analysis) |
| Speed: 1x | Default — 2.5s per message |
| Speed: 2x | 1.25s per message |
| Speed: 4x | 0.6s per message (fast skim) |

### 5.3 Auto-Advance Logic

Within a scene, messages reveal at a timed interval based on speed setting:

```
BASE_INTERVAL_MS = 2500  // 1x speed
revealInterval = BASE_INTERVAL_MS / speedMultiplier
```

When all messages in a scene are revealed:
1. Play the scene's `houseOutro` overlay (if any)
2. Pause for `INTER_SCENE_PAUSE_MS` = 800ms
3. Begin scene transition overlay (if room type changes)
4. Advance to next scene and begin auto-revealing its messages

Auto-play stops at the final scene's final message unless looping is enabled (V2 feature).

### 5.4 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `→` | Next scene |
| `←` | Previous scene |
| `]` | Next round |
| `[` | Previous round |
| `1` / `2` / `3` / `4` | Set speed 0.5x / 1x / 2x / 4x |

---

## 6. Live vs Replay Comparison

| Aspect | Live Mode | Dramatic Replay |
|--------|-----------|-----------------|
| Message delivery | Real-time WebSocket stream | Pre-loaded, timed reveal |
| Navigation | None | Scene scrubber, prev/next, skip round |
| Speed | Fixed (1x) | 0.5x, 1x, 2x, 4x |
| Phase transitions | Event-driven, immediate | Scene-gated, with House narration |
| Whisper content | Activity indicators only | Full conversation revealed |
| House overlays | Between live phases | Between scenes, triggerable |
| Endgame screens | Auto-trigger on alive count | Scene-gated |
| Diary auth gate | Required (sign in) | Removed — all visible in replay |
| Controls | None | Full play/pause/scrub/speed |
| Elimination pacing | Choreographed (live) | Choreographed + auto-pause |

**Key replay-exclusive unlocks:**
1. Full whisper content (private rooms reveal)
2. Speed control (analysis mode at 4x, cinematic at 0.5x)
3. Scene scrubbing (jump to any moment)
4. Diary access without auth

---

## 7. Reusable Components Inventory

| Component | Source Location | Reuse Strategy |
|-----------|----------------|----------------|
| `Typewriter` | `components/typewriter.tsx` | Reuse as-is for lobby scene messages |
| `PhaseTransitionOverlay` | `game-viewer.tsx` | Reuse for room transitions |
| `EndgameEntryScreen` | `game-viewer.tsx` | Reuse for endgame moments |
| `RevealModeView` | `game-viewer.tsx` | Reuse for tribunal scenes |
| `RevealMessageItem` | `game-viewer.tsx` | Reuse inside tribunal |
| `LastWordsMessage` | `game-viewer.tsx` | Reuse with `isReplay={true}` |
| `DiaryQACard` | `game-viewer.tsx` | Reuse, remove auth gate |
| `DiaryEntryCard` | `game-viewer.tsx` | Reuse, remove auth gate |
| `PlayerRoster` | `game-viewer.tsx` | Reuse in sidebar |
| `ConnectionBadge` | `game-viewer.tsx` | Show "Replay" status |
| `PhaseHeader` | `game-viewer.tsx` | Adapt to show scene progress |
| `MessageBubble` | `game-viewer.tsx` | Reuse for lobby messages |
| `personaEmoji` | `game-viewer.tsx` | Extract to shared util |
| `phaseColor` | `game-viewer.tsx` | Extract to shared util |

**New components needed:**
- `DramaticReplayViewer` — top-level orchestrator
- `ReplayControlBar` — play/pause/speed/scrub controls
- `SceneScrubber` — visual timeline with room-type segments
- `WhisperThreadCard` — individual whisper conversation card
- `HouseOverlay` — between-scene House narration overlay
- `RoundBoundaryCard` — "Round X / N players remaining" separator

---

## 8. Integration Point

### 8.1 Entry Point

In `game-viewer.tsx`, the current replay path is:

```typescript
const isReplay = !!game && game.status !== "in_progress" && game.status !== "waiting";
```

Add a prop or URL param `?mode=dramatic` to opt into the new viewer. Default to the new experience for all completed games once stable. Keep the raw message-feed view accessible via `?mode=classic` for analysis purposes.

### 8.2 Route

New route: `/games/[slug]?mode=dramatic` or `/games/[slug]/replay`

The `page.tsx` for `games/[slug]` should detect completed games and default to the dramatic replay viewer.

### 8.3 Data Requirements

The dramatic replay viewer needs:
- `GameDetail` (existing) — player roster, winner, metadata
- `TranscriptEntry[]` (existing) — full transcript from `getGameTranscript()`
- No new API endpoints required

---

## 9. Implementation Phases

### Phase 1 — Scene Model + Controls (prerequisite for everything else)
- `buildReplayScenes()` — transcript → scene array
- `DramaticReplayViewer` shell with `ReplayControlBar`
- `SceneScrubber` with colored segments
- Auto-play engine (timed message reveal + scene advance)
- Scene-to-room routing (which layout renders for this scene)

### Phase 2 — Room Layouts
- Lobby room (reuse `MessageBubble` + `Typewriter`)
- Private Rooms room (`WhisperThreadCard` + staggered reveal)
- Tribunal room (reuse `RevealModeView` + adapt for replay)
- Diary room (reuse `DiaryQACard`, no auth gate)

### Phase 3 — House + Transitions
- `HouseOverlay` component
- Trigger logic (§4.1 trigger points)
- Round boundary cards
- Endgame entry screen integration

### Phase 4 — Polish
- Keyboard shortcuts
- Mobile layout adaptation
- Speed controls
- Scene scrubber click-to-seek

---

## Open Questions for Engineering

1. **Route design:** New `/games/[slug]/replay` route, or query param on existing viewer? Query param is simpler; a dedicated route enables better SSR and metadata.

2. **House overlay text:** V1 uses static strings. Should we pre-generate dynamic commentary server-side when a game completes, store in DB, and serve as part of the game record? This avoids LLM calls on replay load.

3. **Whisper threading:** The transcript stores `toPlayerIds[]` on whisper entries. A whisper from Atlas to Vera is one entry; there is no "reply." How should we group? Recommendation: group by `(fromPlayerId, toPlayerIds.sort().join(','))` to create directional threads, then pair them chronologically. A "conversation" between Atlas and Vera is two separate one-way entries that the UI presents as a dialogue.

4. **Mobile layout:** The control bar is complex for mobile. Recommendation: mobile gets simplified controls (play/pause, prev/next scene, speed toggle). Full scrubber is desktop-only in V1.
