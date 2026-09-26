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
