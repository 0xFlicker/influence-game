# MVP UX Design: Admin Panel, Player Agent Config, Game Viewer

**Author:** Lead Game Designer
**Date:** 2026-03-17
**Status:** Draft — pending review
**Related:** [INF-46](/INF/issues/INF-46), [INF-39](/INF/issues/INF-39) implementation strategy

---

## Overview

Three surfaces define the Influence MVP user experience:

| Surface | Route | Access |
|:--------|:------|:-------|
| Admin Panel | `/admin` | `10xeng.eth` only |
| Player Agent Config | `/games/:id/join` | Authenticated wallet |
| Game Viewer | `/games/:id` | Anonymous + authenticated |

All surfaces share a common auth layer: **SIWE (Sign-In with Ethereum)** via RainbowKit, JWT sessions, Next.js App Router. The admin gate resolves `10xeng.eth` on-chain and compares against `session.address`.

---

## 1. Admin Panel (`/admin`)

### Access Control

- Route is protected by `AdminMiddleware`: resolves `10xeng.eth` ENS → address, compares to `session.address`.
- Unauthenticated users → redirect to `/connect`.
- Authenticated non-admin users → 403 page ("This area is restricted to game operators.").
- No public indication that `/admin` exists.

---

### 1.1 Game Creation Flow (`/admin/games/new`)

**Goal:** Admin creates a new game, configuring all parameters before it opens for players to join.

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  [← Back to Dashboard]          Create New Game                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  PLAYERS                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Player count: [ 4 ] [ 6 ] [ 8 ] [10] [12]  (radio)         │    │
│  │  Slot type:    ○ All AI   ○ Mixed (human + AI fill)           │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  MODEL TIER                                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  ○ Budget    gpt-4o-mini       ~$0.05/game                    │    │
│  │  ○ Standard  gpt-4o            ~$0.79/game                    │    │
│  │  ○ Premium   o1-mini           ~$2.10/game  (est.)            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  PERSONA POOL                                                         │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  [✓] Honest   [✓] Strategic  [✓] Deceptive  [✓] Paranoid     │    │
│  │  [✓] Social   [✓] Aggressive [✓] Loyalist   [✓] Observer     │    │
│  │  [✓] Diplomat [✓] Wildcard                                    │    │
│  │                                                               │    │
│  │  Fill strategy:                                               │    │
│  │  ○ Random from pool  ○ Balanced (no duplicates until needed)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  TIMING CONFIG          (Advanced ▾)                                  │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Preset:  ○ Fast (20s phases)  ● Standard  ○ Slow (60s)       │    │
│  │  Max rounds: [auto]                                           │    │
│  │  ── or expand to set each phase individually ──               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  VISIBILITY                                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  ○ Public (listed, anonymous viewable)                        │    │
│  │  ○ Unlisted (link-only)                                       │    │
│  │  ○ Private (admin + players only)                             │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  COST ESTIMATE:  ~$0.05/game   [  Create Game  ]                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Fields and Data

| Field | Type | Validation | Default |
|:------|:-----|:-----------|:--------|
| `playerCount` | `4 \| 6 \| 8 \| 10 \| 12` | required | 6 |
| `slotType` | `all_ai \| mixed` | required | `all_ai` |
| `modelTier` | `budget \| standard \| premium` | required | `budget` |
| `personaPool` | `string[]` | ≥ 2 selected | all 10 |
| `fillStrategy` | `random \| balanced` | required | `balanced` |
| `timingPreset` | `fast \| standard \| slow \| custom` | required | `standard` |
| `maxRounds` | `number \| "auto"` | ≥ 5 | `auto` (computed) |
| `visibility` | `public \| unlisted \| private` | required | `public` |

**`mixed` mode (future):** Reserves N player slots for wallet-authenticated humans; AI fills remaining slots when game starts or a deadline is hit. V1 ships `all_ai` only — keep toggle visible but disabled with a "Coming soon" tooltip.

**Cost estimate** is computed client-side from `playerCount × phaseCount × avgTokensPerPhase × modelRate`. Display is informational only.

**On submit:** `POST /api/games` → returns `game.id` → redirect to `/admin/games/:id`.

---

### 1.2 Active Game Monitoring Dashboard (`/admin`)

**Goal:** See all in-progress games at a glance; drill down to any game viewer or force-stop a game.

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  Influence Admin                          [+ New Game]  [👛 0x10x…]  │
├─────────────────────────────────────────────────────────────────────┤
│  ACTIVE GAMES (3)                                                     │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  #7  6-player · Round 3/9 · Standard    │   [View]  [⏹ Stop]      │
│  │  ████████░░░░░░░░░░  LOBBY phase         │                         │
│  │  👥 6 alive  💀 0 elim  ⏱ 14s remain     │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  #6  10-player · Round 7/13 · Budget    │   [View]  [⏹ Stop]      │
│  │  ████████████████░░  VOTE phase          │                         │
│  │  👥 4 alive  💀 6 elim  ⏱ 8s remain      │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  #5  4-player · Endgame · Standard      │   [View]  [⏹ Stop]      │
│  │  ████████████████████  JURY_VOTE         │                         │
│  │  👥 2 alive  💀 2 elim  Finalists: Finn, Sage │                    │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  WAITING TO START (1)                                                 │
│  ┌─────────────────────────────────────────┐                         │
│  │  #8  6-player · Not started · Budget    │   [View]  [▶ Start] [🗑] │
│  │  Waiting for players (0/0 humans joined) │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  RECENT GAMES (last 5)   [View all →]                                 │
│  #4  Winner: Atlas (strategic)  6p  8 rounds  Budget   Mar 17        │
│  #3  Winner: Mira (social)      6p  7 rounds  Standard  Mar 17       │
│  ...                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Data Model (per game card)

```typescript
interface GameSummary {
  id: string;
  gameNumber: number;
  status: "waiting" | "in_progress" | "complete" | "stopped";
  playerCount: number;
  currentRound: number;
  maxRounds: number;
  currentPhase: Phase;
  phaseTimeRemaining: number | null; // ms
  alivePlayers: number;
  eliminatedPlayers: number;
  modelTier: "budget" | "standard" | "premium";
  finalists?: [string, string]; // names, endgame only
}
```

**Real-time updates:** Admin dashboard subscribes to a server-sent events (SSE) stream at `/api/admin/games/stream`. Each game emits a summary update on every phase change. This avoids WebSocket complexity for a low-frequency admin view; reserve full WebSocket for the game viewer.

**Stop game:** `POST /api/games/:id/stop` with admin JWT. Shows confirmation modal: "This will end the game immediately. Results will be marked as void." Irreversible.

---

### 1.3 Game History / Results Browser (`/admin/games`)

**Goal:** Browse all games (complete + stopped), filter, and drill into transcripts.

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  Game History                                         [← Dashboard]  │
├───────────────────────────────────────────────────────────────────  │
│  Filter: [Status ▾]  [Model ▾]  [Player Count ▾]  [Date range ▾]    │
│  Search: [________________________]                                   │
├───────────────────────────────────────────────────────────────────  │
│  #   Winner         Players  Rounds  Model     Date       Status     │
│  ─────────────────────────────────────────────────────────────────   │
│  4   Atlas (strat)  6p       8       Budget    Mar 17 14:30  ✓ done  │
│  3   Mira (social)  6p       7       Standard  Mar 17 12:00  ✓ done  │
│  2   —              4p       —       Budget    Mar 16         ✗ void │
│  1   Vera (decep)   6p       5       Budget    Mar 16         ✓ done │
│                                                               [→ View]│
└─────────────────────────────────────────────────────────────────────┘
```

- Clicking any row → `/games/:id` (read-only replay mode).
- Export row (future): download full transcript JSON.

---

## 2. Player Agent Configuration (`/games/:id/join`)

### Access Control

- Requires authenticated wallet session (SIWE).
- Game must be in `waiting` status; slot must be available.
- One agent per wallet per game.

---

### 2.1 Auth Gate

```
┌─────────────────────────────────────────────────────────────────────┐
│  Join Game #8                                                         │
│                                                                       │
│  6-player · Budget · Starting soon                                    │
│                                                                       │
│  To join, connect your wallet and sign in.                            │
│                                                                       │
│  [  Connect Wallet  ]   (RainbowKit modal)                            │
└─────────────────────────────────────────────────────────────────────┘
```

After wallet connect + SIWE sign, the page transitions to the Agent Config form. No page reload — React state transition.

---

### 2.2 Agent Config Form

**Goal:** Players name their agent and choose a persona. Strategy hint is optional but encouraged. The form is simple and fast — joining a game should take < 60 seconds.

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  Configure Your Agent                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Agent Name                                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Nova                                              [12/24]    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  Names must be unique in this game.                                   │
│                                                                       │
│  Choose a Persona                                                     │
│  ─────────────────────────────────────────────────────────────────   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  🎯 Strategic │  │  🎭 Deceptive │  │  🤝 Honest   │               │
│  │  Atlas       │  │  Vera        │  │  Finn        │               │
│  │  Calculated, │  │  Manipulates,│  │  Transparent,│               │
│  │  targets     │  │  spreads     │  │  builds real │               │
│  │  threats     │  │  misinform.  │  │  alliances   │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  😱 Paranoid  │  │  💬 Social   │  │  💥 Aggressive│               │
│  │  Lyra        │  │  Mira        │  │  Rex         │               │
│  │  Trusts no   │  │  Charm and   │  │  Fast action,│               │
│  │  one, pre-   │  │  likability  │  │  targets     │               │
│  │  empts elim  │  │              │  │  strong      │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  🔥 Loyalist  │  │  🕵️ Observer  │  │  🌐 Diplomat │               │
│  │  Kael        │  │  Echo        │  │  Sage        │               │
│  │  Fierce      │  │  Patient,    │  │  Coalition   │               │
│  │  loyalty,    │  │  watches,    │  │  architect,  │               │
│  │  deadly if   │  │  strikes     │  │  indispens-  │               │
│  │  betrayed    │  │  late        │  │  able broker │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐                                                     │
│  │  🎲 Wildcard  │                                                     │
│  │  Jace        │                                                     │
│  │  Unpredictable by design,      │                                   │
│  │  chaos is your shield          │                                   │
│  └──────────────┘                                                     │
│                                                                       │
│  Strategy Hint  (optional)                                            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Give your agent a secret strategic note. This stays hidden   │    │
│  │  from other players.                                          │    │
│  │                                                               │    │
│  │  [e.g. "Target any player who speaks first."]    [0/200]      │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Preview                                                              │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Nova  ·  Strategic                                           │    │
│  │  "Calculated. Targets the most dangerous players first."      │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  [  Join Game  ]                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**On submit:** `POST /api/games/:id/join` with `{ name, persona, strategyHint }` → 201 created → redirect to `/games/:id` (waiting room view).

---

### 2.3 Template System

Each persona card corresponds to a canonical persona from the engine. The card renders a **fixed archetype description** derived from `PERSONALITY_PROMPTS` — players cannot edit it.

The selected persona determines:
1. The base `PERSONALITY_PROMPTS[persona]` injected into every LLM call.
2. The `ENDGAME_PERSONALITY_HINTS[persona]` used in endgame phases.
3. The icon/color shown in the game viewer to identify the player.

Players choose the archetype that matches how they *want* their agent to play. The template's default name (e.g. "Atlas" for strategic) is pre-filled but overridable.

---

### 2.4 Customization: Allowed vs Locked

| Field | Allowed | Notes |
|:------|:--------|:------|
| Agent name | ✅ Free text | 2–24 chars, profanity filter, unique per game |
| Persona selection | ✅ Pick from 10 templates | Cannot define custom personality prompts |
| Strategy hint | ✅ Free text ≤ 200 chars | Appended to system prompt as: `"Secret strategy: {hint}"` |
| Personality prompt body | 🔒 Locked | Preserves game balance; prevents prompt injection gaming |
| Endgame hint | 🔒 Locked | Derived from persona, cannot override |
| Model selection | 🔒 Locked | Set by admin at game creation |

**Design rationale for locking personality body:** Allowing players to write arbitrary system prompts would break game balance, enable prompt-injection attacks against other agents, and make simulation analysis meaningless. The persona template is the player's core expression of strategy — the customizable surface (name + hint) lets them personalize without breaking the game.

---

## 3. Game Viewer (`/games/:id`)

### 3.1 Access Tiers

| User type | Whispers visible? | Diary Room visible? | Public chat | Vote breakdown |
|:----------|:-----------------|:--------------------|:------------|:--------------|
| Anonymous | ❌ | ❌ | ✅ (with delay) | ✅ after round ends |
| Authenticated (non-player) | ❌ | ✅ | ✅ live | ✅ after round ends |
| Player (wallet = game participant) | Own whispers only | Own diary entries | ✅ live | ✅ after round ends |
| Admin | ✅ All whispers | ✅ All diary | ✅ live | ✅ live |

**Anonymous delay:** Public messages are shown with a 30-second delay for anonymous users. This incentivizes wallet login for the full live experience while keeping games discoverable.

**Vote breakdown timing:** Empower/expose vote tallies are revealed when the REVEAL phase ends (consistent with game rules). Council vote results show immediately after POWER phase resolves.

---

### 3.2 Live Observation Layout

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  Influence · Game #7                       Round 3  ·  LOBBY phase   │
│  ████████░░░░░░░░░░░░   ⏱ 14s                                         │
├──────────────────────────────┬──────────────────────────────────────┤
│  PLAYERS (6)                 │  CHAT                                 │
│                              │                                       │
│  🟢 Atlas   strategic        │  [SYSTEM] Round 3 lobby opens.        │
│  🟢 Vera    deceptive        │                                       │
│  🟢 Finn    honest           │  Atlas: "I think we should consider   │
│  🟢 Mira    social           │  who's been quiet this round..."      │
│  💀 Rex     aggressive  R2   │                                       │
│  🟢 Lyra    paranoid         │  Vera: "Interesting point. Finn has   │
│                              │  barely spoken since the intro."      │
│  ── Round 2 result ──        │                                       │
│  Empowered: Atlas            │  Finn: "I've been watching more than  │
│  Exposed: Rex (3 votes)      │  talking. That's a choice, not a      │
│  Power: eliminate            │  weakness."                           │
│  Eliminated: Rex             │                                       │
│                              │  Lyra: "All three of you are          │
│  ── Jury (0) ──              │  suspicious to me."                   │
│  (endgame only)              │                                       │
│                              │  Mira: "Can we talk about alliances   │
│                              │  instead of accusations? 😊"          │
│                              │  ─────────────────────────────────── │
│                              │  [🔒 Whispers hidden - Sign in]       │
├──────────────────────────────┴──────────────────────────────────────┤
│  DIARY ROOM   (sign in to unlock)                                    │
│  💬 Atlas: [hidden]   💬 Finn: [hidden]   💬 Mira: [hidden]          │
└─────────────────────────────────────────────────────────────────────┘
```

#### Phase Visibility Matrix

| Phase | Chat feed shows | Whisper panel | Diary room | Vote display |
|:------|:----------------|:-------------|:-----------|:------------|
| INTRODUCTION | Intro statements | — | — | — |
| LOBBY | Public messages | Sign-in prompt | Hidden until auth | — |
| WHISPER | "X is whispering..." (no content) | Own whispers (players) / All (admin) | — | — |
| RUMOR | Public messages | — | — | — |
| VOTE | "X has voted." | — | — | — |
| POWER | System: "Atlas holds the power token" | — | Diary entries visible (auth) | Empower/expose after REVEAL |
| REVEAL | System: vote breakdown | — | — | Now visible |
| COUNCIL | Council speeches | — | — | Council vote after resolution |
| DIARY_ROOM | — | — | New entries (auth) | — |
| Endgame phases | Full statements | — | — | Jury vote after JURY_VOTE |

**Whisper content:** During WHISPER phase, anonymous/unauth users see "Atlas is whispering to Vera." Authenticated non-players see the chat appears to pause. Player users see their own whispers in a side panel. Admin sees all.

---

### 3.3 Finished Game Replay (`/games/:id?replay=true`)

**Goal:** Watch any completed game from the beginning, scrubbing through rounds and phases.

#### Wireframe Description

```
┌─────────────────────────────────────────────────────────────────────┐
│  Game #4 Replay  ·  Atlas won  ·  6 players  ·  8 rounds            │
├─────────────────────────────────────────────────────────────────────┤
│  Round: [1][2][3][4][5][6][7][8]         Phase: [◀] LOBBY [▶]       │
│                                                                       │
│  [same 3-panel layout as live view, but static data per phase]       │
│                                                                       │
│  ── TIMELINE ──────────────────────────────────────────────────     │
│  R1  R2  R3  R4  R5  R6  R7  R8                                      │
│  |   |   |   |   |   |   |   |                                       │
│  Rex💀     Lyra💀  Mira💀  Finn💀  Vera💀                              │
│  R2   ...  R4      R5      R6      R7                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Replay data:** All phases of a completed game are stored in the `transcripts` table. Replay fetches the full game object once (`GET /api/games/:id/transcript`) and replays client-side — no WebSocket needed.

**Timeline:** Horizontal round track showing elimination events. Clicking a round sets the round and phase scrubber to that round's start.

**Diary Room in replay:** All diary entries are visible to authenticated users in replay mode (no delay). Anonymous users still see only public transcript.

---

## 4. Data Flows

### 4.1 Game Creation (Admin)

```
Admin clicks "Create Game"
  → POST /api/games { playerCount, modelTier, personaPool, timing, visibility }
  → Server: validate config, generate player slots, persist game (status: waiting)
  → Response: { gameId, gameNumber }
  → Admin redirect → /admin/games/:id
  → If all_ai: Server immediately assigns AI agents to all slots
  → Admin clicks "Start" → POST /api/games/:id/start
  → Server: instantiate GameRunner, begin INTRODUCTION phase
  → WebSocket broadcast begins
```

### 4.2 Player Join + Agent Config

```
Player navigates to /games/:id/join
  → GET /api/games/:id → check status === "waiting", slots available
  → Player connects wallet (RainbowKit)
  → SIWE sign → POST /api/auth/siwe → JWT issued, session stored
  → Player submits form → POST /api/games/:id/join { name, persona, strategyHint }
  → Server: validate name uniqueness, reserve slot, persist AgentConfig
  → Response: { playerId }
  → Redirect → /games/:id (waiting room)
  → On game start: server injects AgentConfig into InfluenceAgent constructor
```

### 4.3 Live Game Observation (WebSocket)

```
Viewer loads /games/:id
  → GET /api/games/:id → current game state snapshot
  → Client connects WebSocket: ws://api/games/:id/ws?token={jwt}
  → Server auth: verify JWT, determine access tier
  → For each GameEvent emitted by GameEventBus:
      → Server filters event fields by access tier
      → Broadcast to all connected viewers (each gets tier-appropriate payload)
  → Client updates React state → re-renders chat/player/phase panels
  → On disconnect: server removes from subscriber set
```

### 4.4 Event Payload Filtering by Access Tier

```typescript
function filterEventForTier(
  event: GameEvent,
  tier: "anonymous" | "authenticated" | "player" | "admin",
  playerId?: string
): Partial<GameEvent> {
  if (event.type === "WHISPER") {
    if (tier === "admin") return event;
    if (tier === "player" && (event.from === playerId || event.to.includes(playerId))) return event;
    return { type: "WHISPER", from: event.from, to: event.to }; // redact text
  }
  if (event.type === "DIARY_ENTRY") {
    if (tier === "anonymous") return null; // drop entirely
    if (tier === "player" && event.from !== playerId) return { type: "DIARY_ENTRY_INDICATOR", from: event.from };
    return event;
  }
  return event; // all other events unfiltered
}
```

---

## 5. Recommendations

### 5.1 Persona Cards — Don't Show Strategy Hints to Observers

The strategy hint is entered by the player and injected into the system prompt. **It must never be displayed to other players or observers during the game.** It is only shown:
- Back to the player who entered it (in their own game viewer panel)
- In the full transcript export (post-game, admin only)

### 5.2 Start with Anonymous Delay = 30s, Tune Based on Retention

The 30s delay for anonymous viewers creates incentive to authenticate without blocking discovery. If analytics show bounce rates > 50% on the game viewer, reduce to 15s or eliminate the delay on public games. Instrument this from day one.

### 5.3 Persona Duplicate Policy

In the current engine, the cast factory assigns personas without duplicates up to 10 players. For the admin UI, default `fillStrategy = "balanced"` (no duplicates until all 10 are used, then allow repeats). A "Random" mode that allows duplicates from round 1 should be clearly labeled — it creates less diverse games.

### 5.4 Name Uniqueness Check

Validate agent name uniqueness at form submission against the current game slot list. Do a real-time async check on blur (debounced 400ms) so players know before clicking Join.

### 5.5 Admin-Only: Per-Persona Win Rate Widget (Future)

Once game history accumulates, add a small chart to the admin dashboard showing win rates by persona across recent games. This gives the admin a live balance signal without needing to run simulations. Feeds directly into the tuning workflow.

### 5.6 Mobile Consideration

The game viewer three-panel layout (players / chat / diary) collapses to a tabbed layout on mobile:
- Tab 1: Chat (default)
- Tab 2: Players + round results
- Tab 3: Diary Room (auth)

Admin panel is desktop-only for V1 — game creation is a low-frequency admin action.

---

## 6. Open Questions

1. **Waiting room UX:** When a player has joined but the game hasn't started, what do they see at `/games/:id`? A lobby countdown? A list of other joined players? Recommend showing confirmed slots (names + personas) but keeping strategy hints private. Admin can see all.

2. **Game failure handling:** If a WebSocket disconnects mid-game (server restart, etc.), what does the viewer show? Recommend a "Reconnecting..." banner with exponential backoff. Game state is always re-fetchable from the REST endpoint.

3. **Human player turn UI (mixed mode, future):** When a human player needs to submit a vote or council choice, the game viewer must transform into an action surface. This is out of scope for V1 but the data model should support it — the `joined` flag on a game slot should distinguish `human` vs `ai` from the start.

4. **Transcript privacy after game ends:** Should whispers be visible in replay to all authenticated users, or only admin? Recommend authenticated users see redacted whispers (sender + recipient revealed, text hidden) in replay. Admin sees all. This keeps the post-game detective experience interesting.
