# Influence Design System Reference

**Status:** Initial execution reference for UI/UX standardization
**Audience:** Frontend Engineer, Lead Game Designer, CEO/board for open decisions
**Sources synthesized:** `docs/visual-design-language.md`, `docs/mvp-ux-design.md`, `docs/viewer-experience-spec.md`, `docs/replay-experience-spec.md`, `docs/whisper-rooms-and-anonymous-rumors-spec.md`, `docs/rules-page-content.md`, `docs/persona-designs.md`, current `packages/web`

## Purpose

This document is the implementation-facing design baseline for the current Influence frontend pass. It exists to stop repeated discovery work and to resolve which product language, visual rules, and route patterns the UI should follow right now.

Influence is not a productivity app and not a generic chat UI. The product should feel like a produced social-strategy broadcast with backstage tools around it.

This document is intentionally practical:

- define the shared visual foundation once
- define reusable primitives before page-level polish
- separate viewer-facing broadcast surfaces from player/admin utility surfaces
- resolve doc mismatches where possible
- flag unresolved decisions explicitly instead of letting them drift into implementation

## First-Pass Scope

This pass standardizes the current product surfaces:

- marketing shell: `/`, `/about`, `/rules`
- public game discovery: `/games`, `/games/free`, `/games/[slug]`
- authenticated player surfaces: `/dashboard`, `/dashboard/profile`, `/dashboard/agents`
- operator surfaces: `/admin`, `/admin/games/new`, related admin tabs

This pass should deliver:

- one consistent token system across all surfaces
- one clear typography system
- one shared surface hierarchy for cards, panels, overlays, tables, feeds, and forms
- one canonical route-family model
- one consistent product-language baseline for personas, viewer modes, and House/broadcast framing

## Non-Goals

Do not use this pass to:

- redesign the engine or game rules
- introduce new game mechanics
- settle tokenomics or onchain product architecture
- expand the phase machine beyond what the engine currently exposes
- fully implement future-only concepts from specs that are still pending approval
- turn all utility surfaces into theatrical spectacle at the cost of speed or clarity

## Product Positioning

The product has three visual modes, not one:

1. **Broadcast mode**
   Used for live game viewing and replay. Cinematic, atmospheric, TV-first.
2. **Player utility mode**
   Used for agent creation, queueing, and history. Still branded, but faster and more legible.
3. **Operator control mode**
   Used for admin workflows. Dense, calm, operational, with brand cues rather than spectacle.

The current repo already trends this way in structure, but the styling is inconsistent. Standardization should preserve those three modes instead of flattening them.

## Canonical Product Decisions

These are the default decisions frontend should follow unless explicitly overruled.

### 1. Persona roster shown in product: 13 personas

Current shipped UI already exposes 13 personas:

- original 6
- expanded 4 from `docs/persona-designs.md`
- additional 3 now present in product surfaces: `contrarian`, `provocateur`, `martyr`

Frontend should treat the current roster as 13 canonical product personas for selector UIs, avatar assets, and roster displays.

Rules and marketing copy that still say 10 archetypes are outdated and should be treated as content debt, not a blocker for UI standardization. This roster is public-facing because it is part of agent creation and editing, not an internal-only admin set.

### 2. Public/default viewer behavior

Canonical default:

- `speedrun` is the default for admin/testing flows
- public in-progress viewing is not a current product default

Current mismatch:

- viewer spec imagines a future public live-view mode
- admin create form currently defaults `viewerMode` to `speedrun`

Frontend should present viewer mode as an explicit product decision with environment-aware defaults:

- admin/private workflows can default to `speedrun`
- do not assume public users can watch in-progress games yet
- treat live-view as a future-facing mode until the viewing model is reworked, likely around releasing whole rounds at a time

UI copy should reflect the actual product state: in-progress viewing is currently an admin/operator experience, not a public browsing expectation.

### 3. Core round language

For player-facing rules and utility surfaces, the standard round loop is:

- Lobby
- Whisper
- Rumor
- Vote
- Power
- Council

`Introduction`, `Reveal`, `Diary Room`, and endgame sub-phases should be treated as presentation states, special phases, or separate segments when the engine exposes them, but not as a reason to make the basic product language inconsistent.

### 4. The House is the moderator voice

System narration should use “The House” as the canonical moderator identity across viewer, replay, rules, and admin summaries.

### 5. Influence is a reality-show strategy game, not “hidden roles” by default

Current `about` copy mentions hidden roles and secret objectives. That is not aligned with the current rules spec. Frontend and content should not imply hidden-role gameplay unless the engine actually supports it.

### 6. Anonymous rumors are canonical

Rumor content is anonymous during the rumor phase and remains unattributed until the reveal/voting sequence surfaces authorship. Frontend should treat anonymous rumors as canonical game language, not as a future variant.

### 7. Viewers always see whisper rooms

Whisper-room content should be treated as viewer-visible. Frontend should not hide whisper contents behind replay-only access or activity indicators only.

## Shared Visual Foundation

### Design Principle

Color should behave like atmosphere and signal, not decoration. The viewer should feel like they are watching a control-room feed from a produced elimination show.

### Foundations

Use the existing CSS token direction in `packages/web/src/app/globals.css` as the foundation of record.

Core neutrals:

- `--void`: primary background
- `--surface`: default panel
- `--surface-raised`: elevated panel/modal
- `--surface-overlay`: fullscreen overlays and dimmed systems
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--border`, `--border-active`, `--border-strong`

Glass treatment:

- glass is allowed for broadcast overlays, HUD chips, transition bugs, and elevated media surfaces
- glass should not be the default treatment for every dashboard card

### Phase color language

Phase color is environmental, not a solid-fill palette swap. Use phase color to tint:

- scene background glow
- edge lighting
- active chips and highlights
- overlay accents
- spotlight glows

Do not use phase color as the full background of forms, tables, or utility cards.

### Agent color language

Each persona/archetype gets a persistent identity accent used for:

- avatar halo
- left border or keyline in messages/cards
- spotlight accents
- roster highlights

Do not rely on emoji alone to communicate persona identity.

## Typography

### System

Adopt a two-track typography hierarchy:

- **Display:** condensed/tight, high tracking, used for phase labels, overlays, hero moments, round markers
- **Body/UI:** clean sans, medium weight, used for forms, tables, message bodies, labels
- **Mono:** use sparingly for timers, IDs, tallies, and operational metadata

The current visual docs call for `Inter Tight` + `Inter` + `JetBrains Mono`. The current app still uses system sans. Standardization should move toward the specified stack.

### Rules

- all-caps tracked labels are for broadcast framing and section meta, not long-form content
- body copy should prioritize readability over drama
- dashboard/admin forms should never use ultra-wide tracking for primary content
- viewer overlays can use theatrical type scale; utility pages should stay compact

## Surface Hierarchy

Use the following hierarchy consistently across the app.

### Tier 1: Canvas

The full-page environment. Usually void background plus atmospheric lighting.

Use for:

- game viewer
- replay
- hero sections

### Tier 2: Primary panel

The main content container for a route.

Use for:

- game feed
- admin section
- dashboard primary content block
- rules/article body

Treatment:

- subtle border
- low-contrast fill
- large radius
- restrained shadow

### Tier 3: Secondary card

Subsections within a panel.

Use for:

- queue cards
- persona cards
- history cards
- settings groups
- table wrappers

### Tier 4: Overlay / spotlight

Reserved for moments that interrupt the base flow.

Use for:

- phase transition overlays
- House narration overlays
- join modals
- deletion confirmations
- reveal choreography

Only one Tier 4 surface should dominate at a time.

## Shared Primitives

Frontend should standardize around the following primitives before doing route-by-route polish.

### Navigation shell

One top nav component with route-family awareness:

- public routes: Games, Free Games, Rules, About
- authenticated routes: add Dashboard, Profile
- admin routes: add Admin

Visual direction:

- keep nav lean and utility-first
- use the brand wordmark or refined text mark, not a generic text label
- mobile nav should feel like an overlay sheet, not simply stacked links beneath a border

Brand execution note:

- the wordmark and font upgrade belong in this pass, not a later standalone brand pass

### Buttons

Use four button intents:

- primary
- secondary
- ghost
- danger

Buttons should differ by intent, not by page.

### Status treatments

Standardize a badge system for:

- game status: waiting, live, completed, void
- viewer mode: live, speedrun, replay
- persona/archetype
- admin-only or restricted states
- queue/joined state

Badges should use shared sizing, radius, casing, and border opacity.

### Cards

Card patterns needed:

- content card
- selectable card
- metric/stat card
- media/state card
- destructive confirmation card

Do not rebuild card spacing and border rules per page.

### Forms

All forms should use the same primitives for:

- section label
- helper text
- error text
- segmented option groups
- textarea/input shell
- selection grid

The current admin create-game form is the best starting shape for segmented controls; the agent form is the best starting shape for stacked narrative inputs.

### Tables and data lists

Admin and dashboard history views need one consistent dense data treatment:

- restrained row contrast
- visible column hierarchy
- badges for status and placement
- strong hover state only when rows are actionable

### Message/feed primitives

Viewer and replay work should use a shared message grammar:

- message bubble
- House/system bubble
- spotlight message
- last words state
- whisper thread card
- diary card

## Route Families

Route organization should be treated as product architecture, not just file layout.

### 1. Broadcast family

Routes:

- `/games`
- `/games/free`
- `/games/[slug]`

Purpose:

- public viewing
- live drama
- replay and discovery

Visual rule:

- highest atmospheric intensity
- strongest phase/environmental lighting
- most motion

### 2. Player family

Routes:

- `/dashboard`
- `/dashboard/profile`
- `/dashboard/agents`

Purpose:

- create and manage agents
- join games
- review performance

Visual rule:

- cleaner utility surfaces
- fewer transitions
- denser information layout
- still branded by palette and typography

### 3. Operator family

Routes:

- `/admin`
- `/admin/games/new`
- admin game history/import/invite/user-role panels

Purpose:

- create, monitor, fill, start, stop, and audit games

Visual rule:

- least theatrical
- highest clarity
- fast scanability
- broadcast language only where it helps orient game state

### 4. Editorial family

Routes:

- `/`
- `/about`
- `/rules`

Purpose:

- explain the game
- recruit viewers and creators
- define trust in the product

Visual rule:

- hybrid of brand and readability
- not as cinematic as live viewer
- not as dense as dashboard/admin

## Viewer-Specific Guidance

### Live viewer

The live viewer is a future-facing experience, not the current public default. When used, it should feel produced, paced, and intentional.

Key rules:

- one focal area at a time
- phase transitions are full-scene moments
- player roster behaves like a broadcast lower-third/supporting HUD
- diary room and whisper views should feel like cutaways, not tabs copied from SaaS

### Replay

Replay is scene-based, not transcript-row-based.

Frontend should preserve:

- room/scene framing
- replay controls as media controls
- reveal pacing
- whisper content visibility after game end

### Speedrun

Speedrun is operational. It is allowed to be visually simpler and text-denser than live/replay.

## Persona System Guidance

### Canonical structure for player-facing persona selection

A player-created agent should be expressed as:

- avatar
- agent name
- base persona/archetype
- backstory
- personality description
- strategy style

The base persona is a scaffold, not the full identity.

### What to expose vs hide

Expose:

- base persona
- visible profile/backstory
- strategic flavor fields that shape self-expression

Do not expose yet:

- hidden internal ratings
- secret power stats
- explicit numeric social/strategy meters

The current product direction is character-driven and audience-readable. Hidden simulation stats may be useful later, but exposing them now would flatten the social drama.

## Copy and Product-Language Rules

### Approved vocabulary

Prefer:

- The House
- live
- replay
- speedrun
- whisper rooms
- rumor
- council
- finalists
- jury
- archetype or persona

Avoid unless engine/product truly supports it:

- hidden roles
- secret objectives
- “chat app” metaphors
- generic creator-platform language

### Naming consistency

- Use “Free Games” for the daily queue product
- Use “Agent” for player-created contestants
- Use persona names consistently with archetype keys
- Use “Replay” for post-game playback, not “results viewer”

## Known Mismatches To Resolve In Implementation

These are the main conflicts across the current docs/codebase. Frontend should not silently pick a different answer on each page.

### Persona count mismatch

- rules/content docs still reference 10 archetypes
- current UI exposes 13

Resolution for this pass:

- UI should standardize around 13
- content docs/pages should be updated to match

### Viewer mode mismatch

- viewer spec: live is the long-term public-facing ambition
- admin create form default: speedrun

Resolution for this pass:

- keep both modes visible where useful for operators
- do not position public live viewing as a current default product behavior

### Whisper visibility mismatch

- older assumptions hid whispers from live viewers
- current direction is that viewers can always see whisper rooms

Resolution for this pass:

- viewer and replay design should both treat whisper-room content as visible
- do not design around whisper secrecy from the audience

### Rules/about mismatch

- `about` currently implies hidden roles/secret objectives
- current rules and UI do not position the game that way

Resolution for this pass:

- remove hidden-role framing from public copy unless separately approved

### Phase naming mismatch

- some docs describe six main phases
- some specs describe viewer choreography with additional named segments
- some current code paths still surface older names like `discussion`

Resolution for this pass:

- standardize public-facing labels around the current product loop
- treat older/internal names as technical debt to normalize in implementation

## Decisions Resolved In Thread

The following product decisions were clarified in issue discussion and are now treated as settled for this pass:

1. The 13-persona roster is public-facing.
2. Anonymous rumors are canonical.
3. Wordmark/font upgrade belongs in this design pass.
4. Public in-progress viewing is not the current default experience; current live viewing remains admin-oriented for now.
5. Viewers can always see whisper rooms.

## Delivery Order For Frontend

Recommended implementation order:

1. standardize tokens, typography, button/card/badge/form primitives
2. normalize navigation and route-family shells
3. update editorial pages to use canonical product language
4. standardize dashboard and admin utility surfaces
5. refine game browser/free games discovery views
6. finish live viewer/replay polish on top of the shared primitives

This order reduces rework. The viewer should not be re-styled in isolation from the rest of the system.

## Definition Of Done For This Design Pass

The pass is successful when:

- a frontend engineer can implement against this document without another research round
- every route clearly belongs to a route family with an expected visual density
- typography, surfaces, and status treatments are reusable instead of route-specific
- persona roster and viewer mode defaults are no longer ambiguous in the UI
- remaining uncertainty is isolated in a short list of board-level decisions
