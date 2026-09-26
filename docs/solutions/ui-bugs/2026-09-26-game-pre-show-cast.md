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
the existing public creator and authenticated save-and-join contract. Existing
agents enter through `JoinGameModal`; successful joining refreshes the cast and
keeps the spectator on this page. Full games show Cast complete, remove joining
actions, and route creation to the general creator.

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
full capacity, and automatic transition into live play. Providers are simulated.
