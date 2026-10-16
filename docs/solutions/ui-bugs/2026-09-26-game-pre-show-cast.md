---
module: Game viewer
date: 2026-09-26
problem_type: ui_bug
component: frontend
symptoms:
  - Waiting games show an empty live stage and zero-round progress
  - Agent creation is absent from the game entry page
  - Joined cast and game start do not refresh while waiting
root_cause: design_gap
resolution_type: code_fix
tags: [pre-show, waiting-room, cast, agent-creation, polling]
---

# A cast-led game pre-show

Waiting games render `GamePreShow` through the existing viewer. The pre-show
shares the creator's stone hall and gold palette, presents the real joined cast
as portrait cards, and provides an intentional empty-cast state. Portraits open
an accessible dialog with public career records and an owner link when supplied
by the public read model. Private personality, strategy, and backstory text is
never displayed or inferred.

The top Create agent action opens `/agents/create?flow=join_game&gameId=…`, using
the existing public creator and authenticated save-and-join contract. The hero,
empty-cast invitation, and “Your agent, in the spotlight” card open the shared
`JoinGameModal` for signed-in players. It presents saved agents as portraits with
roles, career records, search, and explicit selection. A leading Create new agent
action uses the same game-specific creator link. Accounts without saved agents
go straight to that creator; signed-out visitors enter the public creator too.
Loading failures stay in the selector with retry and never count as an empty
agent roster. The native dialog traps focus, supports Escape, restores the entry
button's focus, and keeps the join action visible while the gallery scrolls.

Successful joining refreshes the canonical cast and keeps the spectator on this
page. Matching the authenticated public identity to the cast's public owner
identity displays “Your agent is in.” Ordinary players already in the cast have
no additional admission action; admins, sysops, and producers can add another
agent to an unrated game. The server independently enforces the seat policy
against current database roles. Full games show Cast complete. Full games and
accounts that have used their seat route creation to the general creator.

Game detail now returns `playerCount` from the stored `maxPlayers` capacity.
Never substitute the joined roster length or the round count for seat capacity.
Roster identities come from the canonical game detail, independent of episode
trailer cast or transcript prose.

Waiting games have no live observer WebSocket. The pre-show polls game detail
every five seconds, pauses while hidden, and refreshes on focus/visibility. A
failed refresh retains the last accepted cast, displays an error with retry,
and continues polling. Cleanup rejects late responses and clears listeners and
timers. A status change unmounts the pre-show and lets the existing viewer handle
live, paused, completed, or cancelled games.

The deterministic public-identity browser lane checks empty and populated cast
on desktop/mobile, public creator entry, portrait dismissal/focus restoration,
accurate join capacity, refresh failure/recovery, joining without navigation,
full capacity, and automatic transition into live play. Selector coverage also
checks load retry, search, explicit selection, join-error recovery, keyboard
focus containment, close/focus restoration, empty-agent routing, new-agent
routing, and additional-seat controls for ordinary, operator, and rated games.
Providers are simulated.

The pre-show also exposes Start, Stop, and Hide using the existing `start_game`,
`stop_game`, and `hide_game` permissions. Creator ownership alone does not grant
these permissions. Start waits for a full cast, actions lock while pending,
failures remain visible, and Hide requires confirmation before returning to
All games. The API remains the authority for each action.

## Shared Werewolf casting

`CastingHero` in `components/casting/casting-hero.tsx` owns the shared House hero, admission strip, venue image and icon. Influence keeps its waiting-game polling and controls. Werewolf creates a durable lobby first, then reads and joins its own persisted cast. The shared CSS lives in `components/casting/casting.css`.

`AgentSelector` owns the portrait/search dialog, loading/retry/focus behavior and explicit selection. `JoinGameModal` is the Influence join adapter. `WerewolfWaitingGame` submits the Werewolf join endpoint and refreshes the canonical lobby. Neither adapter invents the other game's lifecycle. The Werewolf `join_werewolf` creation continuation preserves the destination game through character creation. Starting is a separate, permission-gated transaction that freezes approved character content and assigns roles once.

The main games browser merges discovery at the UI boundary: Werewolf gets its own styled shelf and links, while search, game-type and status filters cover both. Influence episode previews, statistics and production actions remain Influence-owned. Deterministic browser coverage exercises saved admission across refresh and discovery navigation, mobile selection/removal, guest lobby reads, transition on start and the existing replay flows.

## Library cast discovery

The top-level `/games` library uses **Open**, **Active season**, **Werewolf**,
then **Influence** shelves. Open combines waiting games, newest first. Active
season uses the explicit `active` status from `/api/seasons`, excluding closing
and final seasons. Cards appear only in their first matching shelf; older-season
games appear under Influence. Shelves follow search, type, status, and category
filters and disappear when empty. Both list APIs enforce Public-only discovery;
Unlisted games never enter these shelves. Collection pages retain their full list.
The active-season shelf links to that season, and game shelves link to their
corresponding type collection.

Both games render the same `EpisodeCard`, card shell, status labels, footer actions,
metadata, portrait frames, and touch preview. The eyebrow is The House / Influence
or The House / Werewolf; waiting cards say Casting open and show joined/capacity.
Primary actions are Join game, Watch live, and Watch replay. Permission-gated
operator controls live under a collapsed Manage game disclosure. Game-specific
backdrops remain; the separate Werewolf card styles and House icon are removed.

Cast groups of four are ordinary slideshow frames labeled Meet the cast. They
cycle every 4.2 seconds while visible, with no pagination controls. Public alliance
frames retain their labels and order, and oversized alliance groups also split
into four-person frames. Hidden/offscreen cards and keyboard-focused cards pause; reduced motion disables
automatic progression. Every card starts with the joined/original public cast.

Werewolf waiting cast comes from saved seats and approved character revisions,
using the same batched public identity reader as its lobby and producer inspection.
It never reads draft personality, strategy, or roles into packaging. After start,
only the original werewolf.started identities supply card cast; profile edits and
later deaths never replace that frozen roster. Removed seats disappear on refresh;
unavailable profiles use the existing redacted lobby identity. Reads never generate
copy, start a game, or publish media.

Provider-free coverage checks shared presentation and frame batching. PostgreSQL
coverage verifies real waiting discovery, approved-versus-draft identity, removed
and unavailable seats, and frozen post-start identities. Deterministic browser
coverage checks both games on desktop/touch, natural cast cycling and wraparound,
consistent labels/actions, no icon or cast controls, shelf filtering, scoped
collections, and existing card/trailer navigation.
