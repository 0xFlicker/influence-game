# Whisper Rooms & Anonymous Rumors — Design Specification

**Author:** Lead Game Designer
**Date:** 2026-03-19
**Status:** v1 — Design Recommendation (pending board approval)
**Related Issues:** [INF-99](/issues/INF-99) (this spec), [INF-96](/issues/INF-96) (parent: viewer improvements)
**References:** [Viewer Experience Spec](./viewer-experience-spec.md), [Replay Experience Spec](./replay-experience-spec.md), [AGENTS.md](/home/user/Development/influence/AGENTS.md)

---

## Overview

Two board-identified problems with the current game:

1. **Whispers are invisible to viewers.** During WHISPER phase, viewers see only activity indicators ("X is whispering to Y..."). The most strategically interesting phase of the game is completely hidden from the audience.
2. **Rumors are boring and repetitive.** The RUMOR phase feels like a second lobby — same attributed public messages, no mystery, no dramatic tension.

This spec proposes **Limited Rooms** for whispers and **Anonymous Rumors** to solve both problems. Together, they transform the mid-round experience from a passive chat log into a reality TV show.

---

## Part 1: Whisper Rooms (Limited Rooms)

### 1.1 Recommendation

**Option B — Limited Rooms**, with enhancements for viewer experience.

Option A (Round Robin) was rejected because it's too orderly — every player gets a guaranteed conversation, removing scarcity. Scarcity is what creates drama. Limited Rooms force agents to make a strategic choice about who to talk to, and the exclusion of some agents from private conversations generates organic conflict in subsequent rounds.

### 1.2 Core Mechanic

The WHISPER phase becomes a **Room Request → Allocation → Conversation** sequence. The state machine phase remains `WHISPER` — no new phases needed. The sub-steps are internal to `runWhisperPhase()`.

#### Room Count

```
roomCount = max(1, floor(alivePlayers / 2) - 1)
```

| Alive Players | Rooms | Paired | Excluded |
|:---:|:---:|:---:|:---:|
| 8 | 3 | 6 | 2 |
| 7 | 2 | 4 | 3 |
| 6 | 2 | 4 | 2 |
| 5 | 1 | 2 | 3 |
| 4 | 1 | 2 | 2 |

Always at least one pair of agents is excluded from private conversation. That exclusion IS the drama.

#### Sub-Step 1 — Room Request

Each agent submits a preferred conversation partner via a new `request_room` tool call:

```typescript
const TOOL_REQUEST_ROOM: ChatCompletionTool = {
  type: "function",
  function: {
    name: "request_room",
    description: "Request a private room with another player for a whisper conversation",
    parameters: {
      type: "object",
      properties: {
        partner: {
          type: "string",
          description: "Name of the player you want to meet with privately",
        },
      },
      required: ["partner"],
    },
  },
};
```

Agent prompt for room request:

```
## Your Task
Request a private room for a one-on-one whisper conversation. There are only
{roomCount} rooms available for {aliveCount} players — not everyone will get one.

Choose ONE player you want to meet with. Consider:
- Who do you need to coordinate with?
- Who might have intelligence you need?
- Who do you want to manipulate or mislead?
- Being excluded from rooms means no private communication this round.

If your preferred partner also requested you, you're guaranteed a room (mutual match).
Otherwise, the House assigns rooms by availability.

Available players: {playerNames}

Use the request_room tool to submit your preference.
```

#### Sub-Step 2 — Room Allocation

The engine matches pairs using a preference-based algorithm:

```
1. MUTUAL MATCHES FIRST: If A requests B and B requests A → paired in a room
2. REMAINING REQUESTS: For unpaired agents, match by request order:
   - If A requested B, and B is still unpaired → pair A+B
   - If B is already paired with someone else → A remains unpaired
3. EXCLUDED: Any agent without a room assignment goes to "the commons"
```

All agents learn: (a) whether they got a room, (b) who their partner is (if paired), (c) who else is in the commons (if excluded). Agents do NOT learn who requested whom — only the outcomes.

#### Sub-Step 3 — Room Conversation

Each paired agent generates ONE whisper message for their room partner. This replaces the current `send_whispers` tool with a simpler `send_room_message`:

```typescript
const TOOL_SEND_ROOM_MESSAGE: ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_room_message",
    description: "Send your private message to your room partner",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Your private message to your room partner",
        },
      },
      required: ["message"],
    },
  },
};
```

Agent prompt for room conversation:

```
## Your Task
You're in a private room with {partnerName}. This is your ONE chance to communicate
privately this round. Nobody else can hear you — but the audience is watching.

Craft your message carefully:
- Build or test an alliance
- Share intelligence (real or fabricated)
- Plant seeds of doubt about other players
- Probe for information about their plans

Keep it to 2-4 sentences. Make every word count.

Use the send_room_message tool to send your message.
```

Excluded agents receive a different context in their next phase:

```
## Room Exclusion
You did not get a private room this round. The following players met privately:
- Room 1: {playerA} & {playerB}
- Room 2: {playerC} & {playerD}
You were in the commons with: {excludedPlayers}

Consider: What were they discussing? What alliances are forming behind closed doors?
```

### 1.3 Viewer Experience (Live Mode)

The whisper phase transforms from a dead zone into the most engaging mid-round content.

#### Layout — Camera Cut Between Rooms

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ WHISPER PHASE — Private Rooms                          LIVE  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌── Room 1 ─────────────────────────────────── 📹 LIVE ──┐    │
│  │                                                          │    │
│  │  ATLAS                           VERA                    │    │
│  │  "Vera, Finn has been too quiet. He's building           │    │
│  │  a shadow alliance with Lyra — I can feel it.            │    │
│  │  Can I count on your vote this round?"                   │    │
│  │                                                          │    │
│  │  "Interesting — I was thinking the same.                  │    │
│  │  But what about Mira? She's playing both sides."         │    │
│  │                                                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌── Room Selector ─────────────────────────────────────────┐    │
│  │  [Room 1: Atlas & Vera 📹]  [Room 2: Finn & Mira]       │    │
│  │  Commons: Lyra, Rex  (no room available)                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### Camera Behavior

| Behavior | Description |
|:---------|:-----------|
| **Auto-rotate** (default) | Camera cycles between rooms. Each room shown for 8–10 seconds. Brief fade transition (0.3s) between rooms. |
| **Pin room** | Viewer clicks a room tab to lock the camera on that room. Click again to return to auto-rotate. |
| **Commons shot** | After all rooms cycle, a 4-second "commons" shot shows excluded agents with the caption: "These operatives were shut out of private conversations this round." |
| **Replay** | In replay mode, all rooms are shown sequentially with full content (already spec'd in replay-experience-spec.md as `private_rooms` room type). |

#### Pacing

| Step | Duration | What Viewer Sees |
|:-----|:---------|:----------------|
| Room allocation reveal | 2s | "The House has assigned private rooms..." + room assignments appear |
| Room 1 conversation | 8–10s | Full typewriter text of both agents' messages |
| Camera cut | 0.3s | Brief fade to black |
| Room 2 conversation | 8–10s | Same |
| Commons shot | 4s | Excluded agents shown with House narration |
| Phase transition | 2s | "The rooms are sealed. Time to face the group." |

Total whisper phase viewer time: ~25–35 seconds for a 6-player game (vs. current ~5s of activity indicators).

### 1.4 Engine Changes Required

| Component | Change | Effort |
|:----------|:-------|:-------|
| `agent.ts` | New `requestRoom(ctx)` method returning partner name | Small |
| `agent.ts` | New `sendRoomMessage(ctx, partner)` method replacing `getWhispers()` | Small |
| `agent.ts` | New tool definitions: `TOOL_REQUEST_ROOM`, `TOOL_SEND_ROOM_MESSAGE` | Small |
| `game-runner.ts` | Rewrite `runWhisperPhase()` with room allocation algorithm | Medium |
| `game-runner.ts` | New `allocateRooms()` helper method | Small |
| `types.ts` | New `RoomAllocation` type, update `WhisperMessage` with `roomId` | Small |
| `types.ts` | New transcript entry metadata: `roomId`, `roomPartner`, `wasExcluded` | Small |
| `game-state.ts` | Track room allocations per round for context building | Small |
| `phase-machine.ts` | No changes (WHISPER phase unchanged) | None |
| Mock agent tests | Update mock whisper to use new room API | Small |

**Backward compatibility:** The `send_whispers` tool and `getWhispers()` method should be deprecated but kept functional for one release cycle. Games created before the update continue to work.

### 1.5 Transcript Data Model

```typescript
interface RoomAllocation {
  roomId: number;              // 1-indexed
  playerA: UUID;
  playerB: UUID;
  round: number;
}

// Updated WhisperMessage
interface WhisperMessage {
  type: "whisper";
  from: UUID;
  to: UUID[];                 // always [partnerId] in room model
  text: string;
  round: number;
  timestamp: number;
  roomId?: number;            // NEW — which room this whisper happened in
}

// New system event for room allocation
interface RoomAllocationEvent {
  type: "system";
  scope: "system";
  text: string;               // "Room 1: Atlas & Vera | Room 2: Finn & Mira | Commons: Lyra, Rex"
  round: number;
  phase: "WHISPER";
  timestamp: number;
  metadata: {
    rooms: RoomAllocation[];
    excluded: UUID[];
  };
}
```

### 1.6 Endgame Whisper Phases

The Reckoning includes `RECKONING_WHISPER`. With 4 players and 1 room, exactly 2 players get to whisper privately while 2 are excluded. This is maximally dramatic — half the field is shut out.

The Tribunal (3 players) has no whisper phase. The Judgment (2 players) has no whisper phase. No changes needed for these endgame stages.

---

## Part 2: Anonymous Rumors

### 2.1 Core Mechanic

Rumors become **anonymous public dispatches**. During RUMOR phase:

1. Each alive agent posts a rumor message (unchanged)
2. The message is displayed **without author attribution** to players
3. **Viewers see the author** — dramatic irony (shown as a subtle viewer-only badge)
4. In **replay mode**, authorship is fully revealed
5. Players reference rumors in subsequent phases as "someone said..." not "Atlas said..."

### 2.2 Why Anonymity Changes Everything

| With Attribution (current) | With Anonymity (proposed) |
|:--------------------------|:-------------------------|
| "Atlas said Finn is suspicious" — known quantity, easy to counter | "Someone said Finn is suspicious" — who? Why? Creates paranoia |
| Rumors are just extra lobby messages | Rumors become a strategic tool — you can say things you'd never say publicly |
| No mystery, no follow-up | Mystery creates follow-up in next lobby: "Who wrote that rumor about me?" |
| Agents self-censor to protect reputation | Agents go bolder because they're anonymous |
| Viewers see what players see | Viewers see MORE than players — dramatic irony drives engagement |

### 2.3 Updated Rumor Prompt

Replace the current bland prompt:

```
## Current (bland)
Post your public rumor message. This is your one public statement this round.
You can share genuine information, spread misinformation, defend yourself, or make accusations.
Keep it to 2-3 sentences. Make it count.
```

With a dramatically more provocative prompt:

```
## Your Task — ANONYMOUS RUMOR
Post an anonymous rumor to the public board. YOUR IDENTITY WILL NOT BE REVEALED
to other players. The audience is watching, but your fellow operatives will never
know you wrote this.

Use this anonymity. Be bold. Be provocative. Be strategic.

Options:
- ACCUSE: Name a player and claim they're plotting something specific
- LEAK: Share (or fabricate) private information from whisper rooms
- EXPOSE: Claim two players have a secret alliance (true or false)
- MISDIRECT: Raise suspicion about an innocent player to protect yourself or an ally
- THREATEN: Promise consequences for a specific player next round

The best rumors are SPECIFIC. Don't say "someone is lying" — say WHO, about WHAT.
Vague rumors are forgettable. Sharp rumors change the game.

Your rumor will appear as: "The shadows whisper: [your message]"

Keep it to 1-2 sentences. One sharp claim is better than two weak ones.

Respond with ONLY the rumor text, nothing else.
```

### 2.4 Viewer Experience — The Rumor Board

#### Live Mode Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ RUMOR PHASE — Anonymous Dispatches                     LIVE  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [HOUSE] "Anonymous dispatches have arrived. The operatives      │
│  can read them, but they'll never know who wrote them."          │
│                                                                   │
│  ┌── Dispatch #1 ────────────────────────────────────────┐      │
│  │  "The shadows whisper: Atlas and Vera have been           │      │
│  │  meeting in private rooms every round. That kind of       │      │
│  │  consistency isn't coincidence — it's conspiracy."         │      │
│  │                                                           │      │
│  │                           [Posted by: Finn 👁 viewer only] │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                   │
│  ┌── Dispatch #2 ────────────────────────────────────────┐      │
│  │  "The shadows whisper: Someone in the commons last         │      │
│  │  round voted to eliminate their own ally. Loyalty is       │      │
│  │  dead in this house."                                      │      │
│  │                                                           │      │
│  │                           [Posted by: Lyra 👁 viewer only] │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                   │
│  ┌── Dispatch #3 ────────────────────────────────────────┐      │
│  │  "The shadows whisper: I know what Mira said in Room 2.   │      │
│  │  She's playing both sides and I have receipts."            │      │
│  │                                                           │      │
│  │                           [Posted by: Rex 👁 viewer only]  │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### Viewer-Only Author Reveal

The author badge is a critical design element. It must be:
- **Visible only to viewers**, never to player agents
- Styled as a subtle, desaturated tag (not prominent enough to confuse with the rumor itself)
- Positioned at the bottom-right of the dispatch card
- Uses the viewer-only eye icon (👁) to signal this is privileged information
- In replay mode, the badge becomes fully visible and non-subtle

#### Rumor Delivery Order

Rumors are shuffled before display. The engine resolves all rumors in parallel, then randomizes the display order. This prevents players from guessing authorship based on response speed or position.

### 2.5 Agent Context Changes

#### Rumors in Subsequent Phases

When building the `PhaseContext` for rounds after RUMOR, anonymous rumors are included WITHOUT author information:

```typescript
// In buildBasePrompt() — anonymous rumors section
## Anonymous Rumors (Round {round})
The following rumors were posted anonymously. You do not know who wrote them:
1. "The shadows whisper: Atlas and Vera have been meeting in private rooms..."
2. "The shadows whisper: Someone in the commons voted to eliminate their own ally..."
3. "The shadows whisper: I know what Mira said in Room 2..."
```

This replaces the current `publicMessages` inclusion for RUMOR-phase messages, which currently shows `"Finn: [rumor text]"`.

#### Viewer WebSocket Events

```typescript
// Event sent to viewer WebSocket (includes author)
interface RumorEventViewer {
  type: "rumor";
  text: string;
  from: UUID;         // author — sent to viewers only
  anonymous: true;
  round: number;
  displayOrder: number;
}

// Event sent to player agents (no author)
interface RumorEventPlayer {
  type: "rumor";
  text: string;
  anonymous: true;
  round: number;
  displayOrder: number;
  // NO 'from' field
}
```

### 2.6 Engine Changes Required

| Component | Change | Effort |
|:----------|:-------|:-------|
| `agent.ts` | Update `getRumorMessage()` prompt to new anonymous version | Small |
| `game-runner.ts` | `runRumorPhase()`: log rumors with `anonymous: true` metadata | Small |
| `game-runner.ts` | Shuffle rumor display order before logging | Small |
| `game-runner.ts` | `buildBasePrompt()`: show anonymous rumors without attribution | Small |
| `types.ts` | Add `anonymous?: boolean` and `displayOrder?: number` to message types | Small |
| API (WebSocket) | Bifurcate rumor events: viewer gets `from`, player does not | Medium |
| Frontend | New `RumorDispatchCard` component with viewer-only author badge | Medium |

### 2.7 Transcript Storage

Rumors are stored in the transcript WITH author information (for replay and analysis). The `anonymous` flag tells the frontend how to render:

```typescript
interface AnonymousRumorEntry {
  type: "public";
  from: UUID;              // stored for replay/analysis
  text: string;
  round: number;
  phase: "RUMOR";
  timestamp: number;
  anonymous: true;         // NEW — controls rendering
  displayOrder: number;    // NEW — shuffled order for display
}
```

### 2.8 V2 Extension — Rumor Accusation Mechanic

In a future version, add a **Rumor Accusation** mechanic to the LOBBY phase:

1. During LOBBY, an agent can optionally accuse another player of authoring a specific rumor (via tool call)
2. The House adjudicates: correct or incorrect
3. **If correct:** The accused is revealed as the rumor author. Dramatic moment. The accuser gains credibility.
4. **If incorrect:** The accuser is publicly wrong. Damages their credibility. The true author stays hidden.

This creates a meta-game of deduction and bluffing on top of the anonymous rumor system. Not recommended for V1 — the anonymity alone is sufficient to transform the RUMOR phase.

---

## Part 3: How These Mechanics Work Together

### 3.1 The Mid-Round Narrative Arc

With both mechanics active, the mid-round flow becomes:

```
LOBBY (public)
  ↓
WHISPER (rooms — visible to audience, strategic partner selection)
  ↓ Room assignments create drama: "Why did you pick them over me?"
  ↓ Exclusions create paranoia: "What did they discuss without me?"
  ↓
RUMOR (anonymous — provocative, specific, bold)
  ↓ Anonymity enables agents to leak whisper content
  ↓ "I know what was said in Room 2" — but who wrote this?
  ↓ Players suspect each other; viewers know the truth
  ↓
VOTE (informed by whisper alliances + rumor chaos)
```

The information flow is: **Rooms create secrets → Rumors weaponize those secrets → Votes resolve the tension.**

### 3.2 Drama Amplification

| Current Flow | With Rooms + Anonymous Rumors |
|:-------------|:-----------------------------|
| Whisper: invisible to viewers | Whisper: full camera coverage, room scarcity creates tension |
| Rumor: attributed, safe, repetitive | Rumor: anonymous, bold, specific, creates mystery |
| Lobby → Whisper → Rumor feels like three chat phases | Lobby → Rooms → Anonymous Board feels like three distinct TV segments |
| Viewer experience is flat | Viewer knows things players don't (dramatic irony) |

### 3.3 Cross-Mechanic Interactions

- **Room exclusion fuels rumors:** An excluded agent can anonymously claim "I know what happened in Room 1" — even if they don't. Bluffing about overheard content.
- **Rumors reference room conversations:** "Someone in Room 2 promised to protect you, but they're lying." Viewers can verify this because they saw Room 2.
- **Room partner selection becomes strategic after rumors:** "Last round's anonymous rumor accused me — I need a room with my ally to coordinate a response."

---

## Part 4: Replay Integration

Both mechanics integrate cleanly with the existing replay-experience-spec.md:

### 4.1 Whisper Rooms in Replay

The replay spec already defines `private_rooms` as a room type for WHISPER scenes. The change is structural:
- Instead of individual whisper messages, display grouped by room
- Show room allocation as the opening beat of the WHISPER scene
- `WhisperThreadCard` component renders room conversations (two agents per card)
- Show excluded agents in the commons after all room cards

### 4.2 Anonymous Rumors in Replay

- Rumors render as `RumorDispatchCard` with author FULLY VISIBLE (not viewer-only)
- The "reveal" of who wrote which rumor is a replay-exclusive dramatic moment
- House overlay before RUMOR replay scene: "Now you'll see who was really behind those dispatches."

---

## Part 5: Implementation Priority

### Recommended Order

1. **Anonymous Rumors** (small effort, high drama impact, no engine architecture changes)
   - Update rumor prompt
   - Add `anonymous` flag to rumor messages
   - Shuffle display order
   - Update `buildBasePrompt()` to strip authorship from subsequent context
   - Frontend: `RumorDispatchCard` with viewer-only author badge

2. **Whisper Rooms** (medium effort, architecture change to whisper phase)
   - New tool definitions (`request_room`, `send_room_message`)
   - Room allocation algorithm
   - Rewrite `runWhisperPhase()` with sub-steps
   - Frontend: room camera-cut viewer with room selector

### Estimated Total Effort

| Feature | Engine | API | Frontend | Total |
|:--------|:-------|:----|:---------|:------|
| Anonymous Rumors | 2–3 hours | 1–2 hours | 3–4 hours | ~1 day |
| Whisper Rooms | 4–6 hours | 2–3 hours | 6–8 hours | ~2 days |
| **Combined** | | | | **~3 days** |

---

## Open Questions

1. **Room conversation depth:** Should rooms allow a two-turn exchange (A speaks → B responds) or single simultaneous messages? Recommendation: V1 simultaneous (simpler, faster), V2 adds optional back-and-forth for deeper conversations.

2. **Room request visibility:** Should players know WHO requested WHOM for rooms, or only the final allocations? Recommendation: only final allocations. Request preferences are private — knowing who wanted to talk to whom is too much information.

3. **Viewer-only author in live rumor phase:** Should the author reveal be immediate (shown as each rumor appears) or delayed (revealed at end of rumor phase as a batch)? Recommendation: immediate — viewers enjoy the dramatic irony in real-time.

4. **Commons interaction:** Should excluded agents be able to communicate with each other in the commons (a secondary "open room")? Recommendation: No for V1. The commons is silent — exclusion is punishment, not an alternative channel. V2 could add a "commons chat" for excluded players.

5. **Rumor count:** Currently each agent posts one rumor. Should some agents get to post two? Recommendation: one per agent. Equal opportunity keeps the board clean and prevents information overload.
