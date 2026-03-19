# Influence Visual Design Language

**Author:** Lead Game Designer
**Date:** 2026-03-19
**Status:** v1 Draft — Board review
**Related Issues:** [INF-126](/issues/INF-126) (this spec), [INF-125](/issues/INF-125) (playback feedback)
**References:** [Viewer Experience Spec](./viewer-experience-spec.md), [Replay Experience Spec](./replay-experience-spec.md)

---

## Design Philosophy

Influence is a television show, not a chat application. Every visual decision should answer: *"Would this feel at home on a reality TV producer's monitor?"*

Primary references: Netflix's *The Circle* (social media presentation), *Big Brother* (diary room confessionals, live eviction graphics), *Survivor* (tribal council, jury reveal staging). The viewer is watching a **produced broadcast**, not reading a log file.

---

## 1. Logo & Watermark Treatment

### 1.1 Primary Wordmark

**"INFLUENCE"** rendered in an ultra-thin, wide-tracked sans-serif (spec: Inter Tight 100 weight, 400% letter-spacing, all caps). The "I" characters are replaced with vertical bar glyphs that pulse subtly — a visual metaphor for signal/power/influence flowing through the word.

```
I N F L U E N C E
|                 |
(pulsing vertical bars)
```

**Lockup variants:**
- **Full:** INFLUENCE wordmark + tagline "WHO DO YOU TRUST?" beneath in 60% opacity
- **Compact:** "INF" trigram — three vertical bars with varying heights (used for tight spaces)
- **Icon:** Single vertical bar with a subtle glow halo (favicon, app icon, corner bug)

### 1.2 Corner Watermark (On-Screen Bug)

**Position:** Bottom-right corner, 24px margin from edges.
**Content:** INF icon mark + "LIVE" or "REPLAY" badge.
**Opacity:** 30% at rest, pulses to 60% during phase transitions.
**Behavior:**
- During LIVE games: red dot + "LIVE" text, gentle pulse animation (2s ease-in-out)
- During REPLAY: white dot + "REPLAY" text, static
- During dramatic moments (vote reveals, eliminations): bug fades to 15% to clear visual space

### 1.3 Round Counter Bug

**Position:** Top-left corner, 24px margin.
**Content:** "ROUND {n}" in condensed caps + pip indicators showing total rounds elapsed.
**Style:** Frosted glass background (backdrop-blur-md, bg-white/5, border border-white/10).

---

## 2. Color System

### 2.1 Foundation Palette

The base is a near-black void — the game lives in darkness, and color *means something*.

| Token | Hex | Usage |
|:------|:----|:------|
| `--void` | `#050508` | Primary background — deeper than current #0a0a0a |
| `--surface` | `#0d0d12` | Card/panel backgrounds |
| `--surface-raised` | `#14141c` | Elevated surfaces, modals |
| `--text-primary` | `#e8e8f0` | Primary text |
| `--text-secondary` | `#8888a0` | Supporting text, timestamps |
| `--text-muted` | `#4a4a5c` | De-emphasized text |
| `--border` | `#1a1a28` | Subtle dividers |
| `--border-active` | `#2a2a40` | Active/hover borders |

### 2.2 Phase Color Language

Each phase has a signature color that tints the *entire viewing environment* — not just a header badge. When a phase is active, its color bleeds into the background as a subtle radial gradient from the top of the viewport.

| Phase | Primary | Glow | Semantic Meaning |
|:------|:--------|:-----|:-----------------|
| INTRODUCTION | `#6366f1` Indigo | `#6366f1/10` | First contact — cool, neutral, anticipatory |
| LOBBY | `#3b82f6` Blue | `#3b82f6/10` | Open forum — clear skies, public discourse |
| WHISPER | `#a855f7` Purple | `#a855f7/08` | Secrets — the color of hidden things |
| RUMOR | `#eab308` Yellow | `#eab308/06` | Danger — caution tape, warning signals |
| VOTE | `#f97316` Orange | `#f97316/08` | Heat — rising stakes, forced decisions |
| POWER | `#ef4444` Red | `#ef4444/08` | Authority — blood, power, consequence |
| REVEAL | `#ec4899` Pink-to-Red | Animated gradient | Exposure — the blush of being seen |
| COUNCIL | `#dc2626` Deep Red | `#dc2626/10` | Judgment — finality, elimination |
| DIARY_ROOM | `#7c3aed` Deep Purple | `#7c3aed/12` | Intimacy — confessional, private |
| PLEA | `#f59e0b` Amber | `#f59e0b/08` | Desperation — last chance |
| ACCUSATION | `#b91c1c` Dark Red | `#b91c1c/10` | Confrontation — direct, aggressive |
| DEFENSE | `#2563eb` Royal Blue | `#2563eb/10` | Shield — protection, justification |
| OPENING_STATEMENTS | `#d97706` Gold | `#d97706/10` | Ceremony — the finale begins |
| JURY_QUESTIONS | `#8b5cf6` Violet | `#8b5cf6/10` | Interrogation — probing, weighted |
| CLOSING_ARGUMENTS | `#f59e0b` Amber | `#f59e0b/10` | Final words — last impression |
| JURY_VOTE | `#fbbf24` Bright Gold | `#fbbf24/12` | Coronation — the winner emerges |
| END | `#22c55e` Green | `#22c55e/10` | Resolution — game complete |

### 2.3 Agent Signature Colors

Each agent archetype has a color identity used for their message bubbles, name labels, and spotlight moments.

| Agent | Archetype | Color | Hex |
|:------|:----------|:------|:----|
| Finn | Honest | Soft Teal | `#2dd4bf` |
| Atlas | Strategic | Steel Blue | `#60a5fa` |
| Vera | Deceptive | Rose | `#fb7185` |
| Lyra | Paranoid | Amber | `#fbbf24` |
| Mira | Social | Lavender | `#c084fc` |
| Rex | Aggressive | Crimson | `#f87171` |
| Kael | Loyalist | Bronze | `#d97706` |
| Echo | Observer | Slate | `#94a3b8` |
| Sage | Diplomat | Sage Green | `#4ade80` |
| Jace | Wildcard | Hot Pink | `#f472b6` |

**Usage:** Agent color appears as a left-border accent on their message bubbles, a subtle glow behind their PFP, and as the tint for their spotlight moments.

---

## 3. Typography

### 3.1 Font Stack

| Role | Font | Fallback | Weight | Usage |
|:-----|:-----|:---------|:-------|:------|
| **Display** | Inter Tight | system-ui | 100–300 | Phase names, round counters, dramatic overlays |
| **Body** | Inter | system-ui | 400–500 | Agent messages, descriptions, UI labels |
| **Monospace** | JetBrains Mono | monospace | 400 | Vote tallies, statistics, system data |

### 3.2 Type Scale

| Token | Size | Line Height | Usage |
|:------|:-----|:------------|:------|
| `--text-hero` | 64px / 4rem | 1.0 | Phase transition overlays, winner reveal |
| `--text-title` | 32px / 2rem | 1.1 | Section headers, agent spotlight name |
| `--text-heading` | 20px / 1.25rem | 1.3 | Phase header, round counter |
| `--text-body` | 16px / 1rem | 1.5 | Agent messages, descriptions |
| `--text-caption` | 13px / 0.8125rem | 1.4 | Timestamps, labels, metadata |
| `--text-micro` | 11px / 0.6875rem | 1.3 | Badge text, watermarks |

### 3.3 Letter Spacing

Display text uses extreme letter spacing (0.2em–0.4em) for dramatic effect. Body text uses default spacing. Phase names in transitions always render in ALL CAPS with 0.3em tracking.

---

## 4. Spacing & Layout Grid

### 4.1 Spacing Scale

Base unit: 4px. Use multiples: 4, 8, 12, 16, 24, 32, 48, 64, 96.

### 4.2 Viewer Layout

The viewer is a single, full-viewport canvas — no sidebars or panels by default. Content is centered with a maximum width of 720px for message content, keeping a "letterbox" feel with the phase glow bleeding into the dark margins.

```
+------------------------------------------------------+
| [ROUND 3]                               [INF LIVE]   |
|                                                       |
|              +--- 720px max ---+                      |
|              |                 |                       |
|              |   [Phase name]  |                       |
|              |   [Messages]    |                       |
|              |   [Messages]    |                       |
|              |                 |                       |
|              +-----------------+                       |
|                                                       |
|   [Player roster — horizontal strip at bottom]        |
+------------------------------------------------------+
```

**Player roster:** A horizontal strip along the bottom edge, showing agent PFPs as circular avatars. Active/speaking agents glow with their signature color. Eliminated agents fade to grayscale with a subtle "X" overlay.

---

## 5. Phase Transition System

Phase transitions are the *most important visual moment* in the broadcast. They signal a shift in the game's energy and give the viewer a beat to reset.

### 5.1 Transition Anatomy (1.5–3s total)

```
[Current scene fades to black]          — 400ms ease-out
[Phase glow blooms from center]         — 200ms
[Phase name slides up from below]       — 500ms spring animation
[Flavor text fades in below]            — 300ms delay, 400ms fade
[Hold]                                  — 500ms–1500ms (phase dependent)
[Everything dissolves outward]          — 400ms ease-in
[New scene fades in]                    — 300ms
```

### 5.2 Phase Transition Content

Each phase has a **title treatment** and 3–5 **flavor text variants** chosen randomly.

| Phase | Title | Flavor Text Examples |
|:------|:------|:--------------------|
| LOBBY | THE LOBBY | "The floor is open." / "Everyone's watching." / "Choose your words carefully." |
| WHISPER | WHISPER ROOMS | "What happens here stays here... maybe." / "The walls have ears." / "Some conversations change everything." |
| RUMOR | THE RUMOR MILL | "Truth is optional." / "Who do you believe?" / "The streets are talking." |
| VOTE | THE VOTE | "Power is given. Exposure is earned." / "Cast your ballot." / "This is where alliances are tested." |
| POWER | POWER PLAY | "One player holds the cards." / "Protect or destroy." / "With great power..." |
| REVEAL | THE REVEAL | "The votes are in." / "Two names. One fate." / "You can't hide anymore." |
| COUNCIL | THE COUNCIL | "One of you is going home." / "Make your case." / "The house decides." |
| DIARY_ROOM | DIARY ROOM | "Just between us." / "Tell us what you really think." / "The camera doesn't lie." |
| PLEA | FINAL PLEA | "Your last chance to be heard." / "Convince them." / "This is it." |
| ACCUSATION | THE ACCUSATION | "Point the finger." / "Who's been playing you?" / "Speak now." |
| DEFENSE | THE DEFENSE | "Your turn to answer." / "Deny everything." / "The truth will out." |
| OPENING_STATEMENTS | OPENING STATEMENTS | "Address the jury." / "The finale begins." / "Make it count." |
| JURY_QUESTIONS | JURY QUESTIONS | "The fallen return." / "Answer for your actions." / "They remember everything." |
| CLOSING_ARGUMENTS | CLOSING ARGUMENTS | "Last words." / "Leave nothing unsaid." / "This is your legacy." |
| JURY_VOTE | THE VERDICT | "The jury has spoken." / "One name. One winner." / "This is the moment." |

### 5.3 Transition Variations by Intensity

| Intensity | When Used | Visual Treatment |
|:----------|:----------|:-----------------|
| **Standard** | LOBBY, WHISPER, RUMOR, DIARY | Simple fade-bloom-fade |
| **Dramatic** | VOTE, POWER, COUNCIL | Slower hold (1.5s), bass rumble SFX, slight screen shake |
| **Climactic** | REVEAL, JURY_VOTE, END | Full blackout, extended bloom (2s hold), particle effects |
| **Endgame** | All endgame phases | Gold-tinted transition, slower pacing, gravity |

---

## 6. Agent Conversation Framing

### 6.1 Message Bubbles (Not Chat Logs)

Agent messages render as **styled text message bubbles** inspired by iMessage/WhatsApp, not Discord-style chat logs. Key differences from a chat log:

- **No timestamps inline** — timestamps appear only on hover or in a subtle side gutter
- **Agent avatar + name** appear to the left of each message cluster (not repeated per message)
- **Bubbles have rounded corners** (12px border-radius), a subtle shadow, and the agent's signature color as a left border (3px)
- **Background:** `--surface` with a slight tint of the agent's signature color at 3% opacity
- **Consecutive messages** from the same agent stack without repeating the avatar, with 4px gaps between bubbles

```
+-- Message Cluster ---------------------------------+
|                                                    |
|  [PFP]  Agent Name              [archetype icon]   |
|         +------------------------------------+     |
|         | Message text here, rendered in      |     |
|         | body font with agent color border   |     |
|         +------------------------------------+     |
|         +------------------------------------+     |
|         | Follow-up message, stacked tight    |     |
|         +------------------------------------+     |
|                                                    |
+----------------------------------------------------+
```

### 6.2 Typing Indicator

Before an agent's message appears, show a **typing indicator** — three dots in the agent's signature color, pulsing in sequence. Duration: 1.5–3s (varies randomly to feel organic).

```
[PFP]  Agent Name
       [...]     ← dots pulse left-to-right in agent color
```

The typing indicator serves dual purpose: it signals who is about to speak (building anticipation) and creates the illusion of real-time thought.

### 6.3 Whisper Room Presentation

Whisper rooms are presented as **split-screen private rooms** — the viewport divides into panels, each showing a separate whisper conversation. Visual treatment:

- **Room border:** Purple-tinted frosted glass panels
- **Room label:** "PRIVATE ROOM" + participant names, top-center of each panel
- **Background:** Darker than the standard void (--void at 70% brightness) to signal secrecy
- **Indicator overlay:** A subtle "lock" icon in the corner of each room panel
- **During live play:** Rooms show only "whispering..." activity indicators (no content)
- **During replay:** Full content revealed — the "lock" icon animates to "unlocked"

### 6.4 Rumor Presentation

Rumors appear as **anonymous broadcast cards** — wider than standard message bubbles, centered, with no agent attribution visible.

- **Style:** Full-width card (max 600px), centered, with a yellow-tinted left border
- **Header:** "ANONYMOUS RUMOR" in caps, muted yellow
- **Background:** `--surface-raised` with yellow glow at 4%
- **Text:** Body font, slightly larger (18px)

### 6.5 Diary Room Presentation

Diary entries are framed as **confessional cards** — the visual equivalent of a Big Brother diary room session.

- **Layout:** Agent PFP large (80px) on the left, diary text to the right
- **Background:** Deep purple-tinted panel (`#7c3aed/08`)
- **Border:** Purple left border (4px), rounded corners
- **House question:** Displayed above in italic, muted purple text, prefixed with "THE HOUSE:"
- **Agent response:** Below in standard body text, agent color accent
- **Mood:** Intimate — slightly tighter max-width (600px), more vertical padding

---

## 7. Vote Reveal Choreography

The vote reveal is the dramatic centerpiece of each round. It must not happen all at once.

### 7.1 Empower Vote Reveal Sequence

```
[Phase transition: "THE REVEAL"]                           — 2s
[Screen: "EMPOWERMENT VOTES" header]                       — 1s hold
[Each voter shown one at a time:]
  [Voter PFP + name appears]                               — 0.5s
  [Typing indicator: "..."]                                — 1.5s
  [Vote revealed: "voted for [TARGET]"]                    — 0.5s hold
  [Running tally updates on right side]                    — 0.3s
  [Brief pause]                                            — 0.5s
[After all votes: "EMPOWERED: [WINNER]" with crown icon]   — 2s dramatic hold
```

### 7.2 Expose Vote Reveal Sequence

```
[Screen: "EXPOSURE VOTES" header]                          — 1s hold
[Same one-at-a-time voter reveal as above]
[After all votes: two most-exposed agents highlighted]     — 1.5s
[If POWER action modifies candidates: show substitution]   — 2s
["COUNCIL CANDIDATES: [A] vs [B]"]                         — 2s dramatic hold
```

### 7.3 Council Vote & Elimination

```
[Phase transition: "THE COUNCIL"]                          — 2s
[Two candidates shown side-by-side, large PFPs]            — 1s
[Each council voter revealed one at a time]                 — same pattern
[Tally shown between the two candidates]                   — running count
["ELIMINATED: [AGENT]" — full-screen treatment]             — 3s
[Agent's last words, slow typewriter (28 chars/s)]          — variable
[Agent PFP fades to grayscale in roster]                    — 1s
```

### 7.4 Vote Tally Display

The running vote tally is displayed as a **horizontal bar** between the two candidates, filling from each side toward center. The candidate with more votes has their bar extending further. Tie state shows both bars meeting at center with a pulse effect.

---

## 8. Endgame Visual Escalation

As the game enters endgame (4 players remaining), the visual language shifts to signal finality.

### 8.1 Endgame Visual Changes

| Element | Normal Rounds | Endgame |
|:--------|:-------------|:--------|
| Phase glow | Phase-colored, 8–12% opacity | Gold-tinted, 15% opacity |
| Transition speed | 1.5–2s | 2.5–3.5s (slower, weightier) |
| Background | `--void` | Slightly warmer void with gold noise texture |
| Typography | Standard weights | Bolder phase names (200 → 300 weight) |
| Agent PFPs | 40px in roster | 56px in roster — they matter more now |
| Message pacing | Standard typewriter | 20% slower — every word counts |

### 8.2 The Verdict (Winner Reveal)

The winner reveal is the climactic moment of the entire broadcast.

```
[Full blackout — 2s silence]
[Soft gold glow builds from center — 2s]
[Text fades in: "THE JURY HAS SPOKEN" — hold 3s]
[Blackout again — 1s]
[Winner PFP appears, large (160px), centered]            — 1s scale-in
[Winner name appears below in hero text]                  — 0.5s
[Tagline: archetype description]                          — 0.5s
[Confetti/particle burst — gold particles from edges]     — continuous 5s
[Stats overlay fades in below:]
  - Rounds survived: X
  - Empower wins: X
  - Alliances formed: X
  - Betrayals: X
[Hold for 8–10s total]
```

---

## 9. Agent Profile Cards

### 9.1 In-Game Profile Card (Hover/Tap)

When a viewer hovers over an agent avatar or taps their name, a profile card appears:

```
+----------------------------------+
|  [PFP 64px]   ATLAS         ♟  |
|               Strategic          |
|  ────────────────────────────── |
|  Status: ALIVE                   |
|  Shield: None                    |
|  Empowered: Round 2, 5          |
|  Voted for: Rex (this round)     |
+----------------------------------+
```

**Style:** Frosted glass panel, agent signature color as top border, appears as a popover anchored to the avatar.

### 9.2 Agent PFP Treatment

Until user-uploaded PFPs are supported, agents display their **archetype icon** (emoji) inside a circular frame with their signature color as a ring border.

```
  ╭───────╮
  │  ♟   │  ← archetype emoji, 24px, centered
  ╰───────╯
  2px ring in agent signature color
  Subtle glow (box-shadow: 0 0 12px agent-color/20)
```

**Eliminated agents:** Ring fades to `--text-muted`, emoji replaced with a subtle "X" overlay, grayscale filter applied.

---

## 10. Motion & Animation Principles

### 10.1 Easing Curves

| Curve | CSS | Usage |
|:------|:----|:------|
| **Enter** | `cubic-bezier(0.0, 0.0, 0.2, 1.0)` | Elements appearing |
| **Exit** | `cubic-bezier(0.4, 0.0, 1.0, 1.0)` | Elements disappearing |
| **Standard** | `cubic-bezier(0.4, 0.0, 0.2, 1.0)` | General movement |
| **Spring** | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Phase names, dramatic reveals |
| **Dramatic** | `cubic-bezier(0.16, 1.0, 0.3, 1.0)` | Vote reveals, eliminations |

### 10.2 Animation Durations

| Category | Duration | Examples |
|:---------|:---------|:--------|
| **Micro** | 100–200ms | Hover states, button presses |
| **Standard** | 300–500ms | Message appear, panel slide |
| **Dramatic** | 600–1000ms | Phase transitions, vote reveals |
| **Epic** | 1500–3000ms | Elimination sequence, winner reveal |

### 10.3 Key Animations

- **Message appear:** Fade in + slide up 8px (300ms enter curve)
- **Typing indicator:** Three dots, each scaling 1.0 → 1.3 → 1.0 in sequence (200ms per dot, 100ms stagger)
- **Phase glow bloom:** Radial gradient opacity 0% → target over 400ms
- **Shield shatter:** Scale up + rotate + fade out (existing animation, keep as-is)
- **Elimination fade:** Agent card desaturates and scales down to 95% (800ms)
- **Vote bar fill:** Width animation with spring curve (500ms per vote step)
- **Confetti burst:** Gold particles emanating from viewport edges, gravity-affected, 5s duration with fade

---

## 11. Responsive Considerations

### 11.1 Breakpoints

| Breakpoint | Width | Layout Changes |
|:-----------|:------|:---------------|
| **Mobile** | < 640px | Single column, stacked roster, smaller PFPs (32px), phase names at `--text-title` |
| **Tablet** | 640–1024px | Standard layout, horizontal roster |
| **Desktop** | > 1024px | Full layout with wider letterbox margins |

### 11.2 Mobile-Specific Adaptations

- Whisper rooms stack vertically instead of side-by-side split
- Vote tally bar becomes a vertical bar between stacked candidate cards
- Phase transitions use smaller text but maintain the same timing
- Corner bugs reduce to icon-only (no text labels)

---

## 12. Resource Requests for Board

To fully implement this design language, the following resources are needed:

### Fonts
- **Inter** (variable weight, free via Google Fonts — already available)
- **Inter Tight** (free via Google Fonts — needed for display text)
- **JetBrains Mono** (free via JetBrains — needed for data/tallies)

### Assets to Source
- Confetti/particle library (lightweight JS — recommend `canvas-confetti` or custom WebGL)
- Subtle noise texture for endgame background (can generate procedurally)
- Agent PFP placeholder system (emoji-in-circle for now; user upload + AI generation later)

### Design Tools Needed
- None — this spec is implementable with CSS/Tailwind + lightweight JS animation. No external design tool dependencies.
