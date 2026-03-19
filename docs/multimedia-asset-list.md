# Influence Multimedia Asset Shopping List

**Author:** Lead Game Designer
**Date:** 2026-03-19
**Status:** v1 — Actionable sourcing list
**Related Issues:** [INF-126](/issues/INF-126) (this spec), [INF-125](/issues/INF-125) (playback feedback)
**References:** [Visual Design Language](./visual-design-language.md), [Viewer Experience Spec](./viewer-experience-spec.md)

---

## Overview

Influence is a **multimedia experience**. The viewing experience should feel like watching a produced television broadcast with a full soundscape — ambient beds, phase-specific musical themes, dramatic stings, and environmental sound design. This document provides actionable prompts and descriptions for sourcing every audio asset needed.

**Voice:** All agent text will eventually run through ElevenLabs for high-quality TTS. Not yet in scope. This list covers instrumental music and sound effects only.

**Sourcing strategy:**
1. Generate stand-in assets via Suno AI for musical themes
2. Source sound effects from free/licensed SFX libraries (Freesound, Epidemic Sound, Artlist)
3. Board will help source final production-quality versions
4. All assets should be royalty-free or owned

---

## 1. Musical Themes (Suno AI Prompts)

Each game phase has a distinct musical identity. Themes should loop seamlessly and layer naturally during transitions. All prompts target **instrumental only** — no vocals.

### 1.1 Main Title Theme

**Usage:** Game start, played over the opening title card and agent introductions.
**Duration:** 60–90 seconds (loopable from 0:30)
**Mood:** Sleek, modern, slightly sinister. Think Netflix reality show opener.

**Suno Prompt:**
```
Cinematic electronic opener, dark minimal synths, pulsing bass,
building tension, modern reality TV theme, sleek and mysterious,
subtle glitch elements, wide stereo pads, no vocals,
instrumental only, 110 BPM, key of D minor
```

**Style tags:** `cinematic electronic, dark ambient, reality tv, minimal synth`

---

### 1.2 Lobby Ambient

**Usage:** Background bed during LOBBY phase (public mixer). Loops continuously.
**Duration:** 120+ seconds (seamless loop)
**Mood:** Social, lightly tense, cocktail party energy with an edge. People are sizing each other up.

**Suno Prompt:**
```
Lounge electronic ambient, soft Rhodes piano chords, light hi-hat shuffle,
warm analog synth pads, subtle tension underneath, sophisticated social
atmosphere, like a high-stakes cocktail party, no vocals, instrumental only,
95 BPM, key of A minor
```

**Style tags:** `lounge electronic, ambient, smooth jazz undertones, minimal`

---

### 1.3 Whisper Room Tension

**Usage:** Background bed during WHISPER phase. Loops continuously.
**Duration:** 120+ seconds (seamless loop)
**Mood:** Secretive, intimate, conspiratorial. Hushed tones. Something is being planned.

**Suno Prompt:**
```
Dark ambient tension, whispering synth textures, barely audible pulse,
low drone with occasional high-frequency shimmer, intimate and secretive,
like passing notes in a dark room, sparse piano notes echoing in reverb,
no vocals, instrumental only, 70 BPM, key of E minor
```

**Style tags:** `dark ambient, tension, cinematic underscore, whisper`

---

### 1.4 Rumor Mill Energy

**Usage:** Background bed during RUMOR phase. Loops continuously.
**Duration:** 120+ seconds (seamless loop)
**Mood:** Chaotic energy, information spreading, gossip. More active than whisper, more dangerous than lobby.

**Suno Prompt:**
```
Glitchy electronic, nervous energy, staccato synth patterns,
distorted bass hits, chaotic but controlled, information overload
aesthetic, news ticker urgency, scattered percussion, rising and
falling micro-tensions, no vocals, instrumental only, 120 BPM,
key of F# minor
```

**Style tags:** `glitch electronic, industrial light, nervous energy, cyberpunk`

---

### 1.5 Diary Room Intimacy

**Usage:** Background bed during DIARY_ROOM phase. Loops continuously.
**Duration:** 120+ seconds (seamless loop)
**Mood:** Confessional. Alone with your thoughts. Intimate, reflective, slightly vulnerable.

**Suno Prompt:**
```
Intimate piano and ambient pads, confessional atmosphere, soft
reverb-drenched keys, gentle warmth with an undertone of sadness,
reality TV diary room mood, reflective and vulnerable, occasional
subtle string swell, no vocals, instrumental only, 80 BPM,
key of C minor
```

**Style tags:** `ambient piano, confessional, intimate, cinematic, emotional`

---

### 1.6 Vote Phase Tension

**Usage:** Background bed during VOTE phase. Builds tension.
**Duration:** 90 seconds (with building intensity — starts sparse, gets denser)
**Mood:** High stakes. Everyone is deciding. The clock is ticking.

**Suno Prompt:**
```
Building tension underscore, ticking clock percussion, dark synth
drones rising slowly in pitch, heartbeat bass pulse, increasing
urgency, countdown feeling, minimal at start then layering elements,
cinematic suspense, no vocals, instrumental only, 100 BPM,
key of B minor
```

**Style tags:** `cinematic tension, suspense, building, dark electronic`

---

### 1.7 Power Phase Drama

**Usage:** Background bed during POWER phase. Short, intense.
**Duration:** 60 seconds
**Mood:** Authority. One player holds all the cards. Weighty, commanding.

**Suno Prompt:**
```
Powerful cinematic synth, deep brass-like bass stabs, commanding
presence, heavy reverb hits, imperial and weighty, the sound of
absolute power, dark orchestral electronic hybrid, slow and
deliberate, no vocals, instrumental only, 85 BPM, key of D minor
```

**Style tags:** `cinematic, power, dark orchestral electronic, epic`

---

### 1.8 Reveal Phase (Vote Results)

**Usage:** Plays during the vote reveal sequence. Must support the one-at-a-time reveal pacing.
**Duration:** 90 seconds (with distinct "beats" that align with individual vote reveals)
**Mood:** The moment of truth. Anxiety, anticipation, building to climax.

**Suno Prompt:**
```
Suspenseful reveal music, rising synth arpeggios with periodic
dramatic pauses, each pause followed by a bass impact hit,
building anticipation like a game show results reveal, reality TV
elimination music, crescendo sections alternating with held
tension, no vocals, instrumental only, 90 BPM, key of G minor
```

**Style tags:** `game show, suspense reveal, cinematic, reality tv, tension`

---

### 1.9 Council / Tribunal Drama

**Usage:** Background during COUNCIL phase and endgame Tribunal.
**Duration:** 120 seconds (loopable)
**Mood:** Judgment. Gravity. Someone is going home. Tribal council energy.

**Suno Prompt:**
```
Dark tribal-influenced electronic, deep toms and ethnic percussion,
low cinematic drones, torch-lit atmosphere like a ritual judgment,
gravity and consequence, Survivor tribal council energy, primal
and modern combined, no vocals, instrumental only, 75 BPM,
key of A minor
```

**Style tags:** `tribal electronic, cinematic dark, judgment, ritual`

---

### 1.10 Elimination Sting

**Usage:** Plays at the moment an agent is eliminated. Short, impactful.
**Duration:** 15–20 seconds
**Mood:** Finality. The axe falls. Dramatic, then somber.

**Suno Prompt:**
```
Dramatic elimination sting, massive bass drop followed by a
single somber piano note, the sound of being cut, finality and
consequence, reality TV elimination moment, impact then silence
then melancholy, short and devastating, no vocals, instrumental
only, free tempo
```

**Style tags:** `dramatic sting, cinematic impact, elimination, somber`

---

### 1.11 Winner Reveal / Coronation

**Usage:** Plays when the winner is announced. Triumphant climax.
**Duration:** 30–45 seconds
**Mood:** Victory. Triumph. The champion rises. Celebratory but earned.

**Suno Prompt:**
```
Triumphant victory theme, soaring synth melody over cinematic
orchestral hits, golden and radiant, the champion emerges,
ascending chord progression, celebration and achievement,
reality TV finale winner moment, euphoric electronic crescendo,
no vocals, instrumental only, 128 BPM, key of D major
```

**Style tags:** `triumphant, victory, cinematic, euphoric electronic, celebration`

---

### 1.12 Endgame Underscore

**Usage:** General underscore for endgame phases (Reckoning, Tribunal, Judgment). More intense than normal rounds.
**Duration:** 180 seconds (loopable)
**Mood:** The final stretch. Everything matters. Heavier, more orchestral, gold-tinted sonically.

**Suno Prompt:**
```
Epic endgame underscore, cinematic orchestral electronics, deep
strings layered with modern synths, heavy importance and weight,
the final chapters, everything hangs in the balance, gold-era
grandeur mixed with dark tension, slow burning intensity,
no vocals, instrumental only, 80 BPM, key of E minor
```

**Style tags:** `epic cinematic, orchestral electronic, endgame, finale`

---

### 1.13 Jury Deliberation

**Usage:** Background during JURY_QUESTIONS and CLOSING_ARGUMENTS.
**Duration:** 120 seconds (loopable)
**Mood:** Interrogation. The fallen have returned. Weighted questions, careful answers.

**Suno Prompt:**
```
Tense courtroom atmosphere, sparse piano with long reverb tails,
low string drones, the weight of judgment, interrogation energy
mixed with formality, measured and deliberate, each note matters,
no vocals, instrumental only, 65 BPM, key of F minor
```

**Style tags:** `courtroom, tension, sparse piano, cinematic, deliberation`

---

## 2. Sound Effects

### 2.1 Transition Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Phase whoosh** | A cinematic swoosh/whoosh — air moving fast, slightly metallic, with a subtle low-frequency tail. Like turning a page in reality. | 0.5–0.8s | Every phase transition |
| **Scene wipe** | A softer, wider whoosh — less aggressive than phase whoosh, more of a gentle wash. Stereo spread left-to-right. | 0.8–1.2s | Scene changes within a phase |
| **Blackout drop** | A deep, resonant bass drop that coincides with the screen going black. Like the air being sucked out of the room. | 0.3–0.5s | Dramatic blackout moments (elimination, winner reveal) |
| **Bloom rise** | A rising shimmer/swell — crystalline high frequencies building upward, like light materializing. | 0.5–1.0s | Phase glow bloom animation |

### 2.2 Vote & Reveal Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Vote lock-in** | A sharp, satisfying "click-lock" — mechanical, decisive, with a subtle digital undertone. Like a combination lock engaging. | 0.2–0.3s | Each individual vote cast |
| **Vote reveal hit** | A medium-impact bass hit with a bright attack — the sound of a name being called. Think game show answer reveal. | 0.3–0.5s | Each voter's choice revealed one-at-a-time |
| **Tally tick** | A quick, light tick sound — like a mechanical counter incrementing. Slightly different pitch each time. | 0.1s | Running tally number updating |
| **Tally complete** | A resonant gong/bell tone — warm, definitive, signals "the count is final." | 1.0–1.5s | Final tally shown |
| **Empowered crown** | A regal, golden shimmer — ascending chime scale, like a crown being placed. Warm and authoritative. | 1.0–1.5s | Empowered player announced |
| **Exposed sting** | A sharp, cold hit — high-pitched metallic ring with a reverb tail. Uncomfortable. Being seen. | 0.5–0.8s | Exposed candidates revealed |

### 2.3 Agent Activity Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Typing indicator start** | Soft bubble/blip sound — like a phone notification but gentler, signaling incoming communication. | 0.1–0.2s | Typing indicator appears |
| **Message send** | A subtle "pop" or "plop" — the satisfying sound of a message arriving. Warm, not clinical. | 0.1–0.15s | Each message bubble appears |
| **Whisper open** | A hushed "shh" combined with a door-creak — the sound of entering a private space. | 0.3–0.5s | Whisper room panel opening |
| **Whisper close** | Reverse of whisper open — the door closing behind you. | 0.3–0.5s | Whisper room panel closing |
| **Rumor drop** | A distorted, slightly ominous version of message send — lower pitch, with a subtle "hiss" tail. | 0.2–0.3s | Anonymous rumor card appearing |

### 2.4 Drama & Impact Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Elimination boom** | A massive, room-shaking bass impact — deep sub-bass hit followed by a cavernous reverb tail. The sound of being removed from the game. | 1.5–2.0s | Agent eliminated |
| **Shield activate** | A bright, crystalline chime with a brief "energy field" sustain — protective, warm, like a force field engaging. | 0.8–1.0s | Shield granted via protect |
| **Shield shatter** | Glass breaking mixed with a descending electronic glitch — the protection is gone. | 0.5–0.8s | Shield expires (used with existing CSS animation) |
| **Auto-eliminate** | A faster, more aggressive version of the elimination boom — no warning, immediate impact. Like a gavel slamming. | 0.8–1.0s | Empowered uses "auto" power |
| **Clock tick** | A steady, prominent tick — not a real clock, but a stylized, slightly reverbed "tick" that feels like time running out. | 0.5s per tick | Timer running low (last 10s of any phase) |
| **Clock expire** | A sharp buzzer/horn — not harsh, but definitive. Time's up. | 0.5–0.8s | Phase timer expires |

### 2.5 Audience / Atmosphere Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Crowd gasp** | A collective inhale — not a full audience, more like 15–20 people reacting in surprise. Subtle, not theatrical. | 0.8–1.2s | Surprising vote reveal, unexpected power move |
| **Crowd murmur** | Low crowd chatter — indistinct, ambient, like people discussing what just happened. | 2–3s (loopable) | After dramatic moments, during vote counting |
| **Crowd cheer** | A warm, celebratory crowd reaction — not a stadium, more like a watch party erupting. | 1.5–2.0s | Winner announced |
| **Tension breath** | A single, deep breath sound — someone holding their breath. Intimate. | 1.0–1.5s | Just before a dramatic reveal |

### 2.6 Endgame-Specific Effects

| Effect | Description | Duration | Usage |
|:-------|:------------|:---------|:------|
| **Endgame trigger** | A deep, resonant gong followed by a sustained drone — the game has shifted. Something ancient and final. | 2.0–3.0s | Transition from normal rounds to endgame |
| **Jury return** | Footsteps + a rising chord swell — the fallen are back, and they have power now. | 1.5–2.0s | Jury members introduced for finale |
| **Verdict drum** | A single, deep drum hit — like a heartbeat amplified. Used once per jury vote revealed. | 0.3–0.5s | Each jury vote revealed |
| **Victory fanfare** | A short brass-synth fanfare — golden, triumphant, definitive. The final exclamation point. | 3–4s | Winner name appears on screen |
| **Confetti burst** | The sound of confetti cannons + a brief crowd pop. Celebratory, but contained. | 1.0–1.5s | Confetti animation fires |

---

## 3. Ambient Audio Beds

Ambient beds run continuously under all other audio, providing a sense of place. They should be barely noticeable when playing alone — felt, not heard.

### 3.1 Phase Ambient Beds

| Scene Type | Ambient Description | Suno Prompt |
|:-----------|:-------------------|:------------|
| **Lobby** | Warm room tone with distant crowd murmur. The sound of a social space — air conditioning hum, distant conversation, occasional glass clink. | `Ambient room tone, social gathering atmosphere, distant muffled conversations, warm and present, cocktail party undercurrent, barely audible, background texture only, no melody, no rhythm, stereo field` |
| **Whisper Rooms** | Near-silence with a slight high-frequency hiss. The sound of an empty room where you can hear your own breathing. Occasional distant thump. | `Near-silent ambient, empty room atmosphere, slight high frequency air, distant muffled bass through walls, intimate silence, the sound of privacy, barely there, no melody, no rhythm` |
| **Tribunal** | Heavy room tone. Deep, cavernous, like a large stone chamber. Slight echo on any sound. Oppressive air. | `Deep cavernous room tone, stone chamber atmosphere, heavy air, slight natural reverb, oppressive and weighty, judgment hall, barely audible drone, no melody, no rhythm` |
| **Diary Room** | Soft, intimate room tone. Close and warm. The sound of a small, padded room — no echo, close walls, comfortable isolation. | `Intimate small room tone, close and warm, padded walls feeling, soft air, comfortable isolation, confessional booth atmosphere, barely audible, no melody, no rhythm` |
| **Endgame Arena** | Expansive, reverberant space. The sound of a large, empty arena with distant crowd presence at the edges. Epic in scale. | `Large arena room tone, expansive reverberant space, distant crowd presence at edges, epic scale atmosphere, finale venue, cavernous but alive, barely audible, no melody, no rhythm` |

---

## 4. Audio Layering Architecture

### 4.1 Audio Priority Stack

Audio layers from lowest to highest priority (higher priority ducks lower layers):

```
Layer 0: Ambient bed (continuous, -24dB)
Layer 1: Phase musical theme (looping, -12dB)
Layer 2: Sound effects (triggered, -6dB to 0dB depending on importance)
Layer 3: Voice (future ElevenLabs TTS, 0dB — when implemented)
```

### 4.2 Crossfade Rules

| Transition | Crossfade Duration | Notes |
|:-----------|:------------------|:------|
| Phase theme to phase theme | 2.0s | Overlap with equal-power crossfade |
| Ambient bed to ambient bed | 3.0s | Slower, imperceptible transition |
| SFX layered over theme | No crossfade | SFX plays on top, theme continues |
| Dramatic moment (elimination) | Theme ducks -6dB for 3s | Make room for the impact SFX |
| Endgame transition | 4.0s crossfade | Slow, weighty shift to endgame audio |

### 4.3 Implementation Notes

- Use the Web Audio API for precise timing and layering
- All musical themes must loop seamlessly (edit loop points in post)
- SFX should be pre-loaded (< 200KB each) for instant playback
- Ambient beds are low-priority — load last, fail silently if missing
- Provide a master volume control and per-layer mute toggles
- Default to audio OFF for first-time viewers (require click-to-enable per browser autoplay policy)

---

## 5. Asset File Naming Convention

```
influence-audio/
  themes/
    theme-main-title.mp3
    theme-lobby.mp3
    theme-whisper.mp3
    theme-rumor.mp3
    theme-diary.mp3
    theme-vote.mp3
    theme-power.mp3
    theme-reveal.mp3
    theme-council.mp3
    theme-elimination-sting.mp3
    theme-winner-reveal.mp3
    theme-endgame.mp3
    theme-jury.mp3
  sfx/
    sfx-phase-whoosh.mp3
    sfx-scene-wipe.mp3
    sfx-blackout-drop.mp3
    sfx-bloom-rise.mp3
    sfx-vote-lockin.mp3
    sfx-vote-reveal-hit.mp3
    sfx-tally-tick.mp3
    sfx-tally-complete.mp3
    sfx-empowered-crown.mp3
    sfx-exposed-sting.mp3
    sfx-typing-start.mp3
    sfx-message-send.mp3
    sfx-whisper-open.mp3
    sfx-whisper-close.mp3
    sfx-rumor-drop.mp3
    sfx-elimination-boom.mp3
    sfx-shield-activate.mp3
    sfx-shield-shatter.mp3
    sfx-auto-eliminate.mp3
    sfx-clock-tick.mp3
    sfx-clock-expire.mp3
    sfx-crowd-gasp.mp3
    sfx-crowd-murmur.mp3
    sfx-crowd-cheer.mp3
    sfx-tension-breath.mp3
    sfx-endgame-trigger.mp3
    sfx-jury-return.mp3
    sfx-verdict-drum.mp3
    sfx-victory-fanfare.mp3
    sfx-confetti-burst.mp3
  ambient/
    ambient-lobby.mp3
    ambient-whisper.mp3
    ambient-tribunal.mp3
    ambient-diary.mp3
    ambient-endgame.mp3
```

---

## 6. Sourcing Priority

### Phase 1 — Generate Stand-Ins (Immediate)

Generate via Suno AI for blocking/stand-in use:
1. Main title theme
2. Lobby ambient theme
3. Whisper room tension
4. Vote phase tension
5. Elimination sting
6. Winner reveal / coronation

### Phase 2 — Source SFX (Next)

Source from free SFX libraries (Freesound.org, Mixkit, Zapsplat):
1. Phase whoosh
2. Vote lock-in
3. Message send pop
4. Elimination boom
5. Clock tick
6. Crowd gasp/murmur/cheer

### Phase 3 — Complete Library (Board-Assisted)

Board to help source or commission:
1. Remaining phase themes (rumor, diary, power, reveal, council, endgame, jury)
2. Remaining SFX (whisper open/close, shield effects, endgame-specific)
3. Ambient beds (all five scene types)
4. Final production mastering of all stand-in Suno tracks

---

## 7. Technical Requirements

| Requirement | Spec |
|:------------|:-----|
| **Format** | MP3 (192kbps minimum) for web delivery; WAV masters for archive |
| **Sample rate** | 44.1kHz |
| **Channels** | Stereo (all themes and ambients), Mono acceptable for short SFX |
| **Loop points** | All themes and ambients must have clean loop points (no click/pop at seam) |
| **Loudness** | Normalize to -14 LUFS (streaming standard) |
| **Max file size** | Themes: < 3MB each; SFX: < 200KB each; Ambients: < 2MB each |
| **Total budget** | ~50MB for complete audio library |
