---
title: Give every open-conversation contribution a durable provider slot
date: 2026-10-19
module: Influence durable conversations
problem_type: integration_issue
component: game runner
severity: high
tags: [durability, provider-journal, mingle, huddles, privacy, evaluation]
---

# Give every open-conversation contribution a durable provider slot

## Failure

The first localhost API evaluation of bounded Mingle exposed repeated accepted
responses. A conversation can advance its private cursor and append dialogue
without advancing the canonical event head. Calling the same actor/action again
with only the phase/event coordinate therefore reused an earlier logical call.
The journal correctly replayed that identity, but the runner had assigned it to
a different contribution.

The diagnostic game is `48ef761d-826e-40bf-aa1b-b18d175e9518`
(`true-slate-path`). Its accepted history and provider evidence were retained;
it is not evidence of corrected conversation quality.

## Fix

Plan each conversational contribution as a `single_provider` durable turn with
an explicit actor/action/contract slot. Use engine-only turns for room opening,
movement commits, session opening, and completion. The slot distinguishes new
contributions even when the event head is unchanged. Recovery of the same
planned turn still reuses its accepted provider value without another charge.

Apply this consistently to normal and endgame Lobby, ordinary Mingle, and
huddles. Do not put private scheduler counters into the model prompt to make
the call unique: execution identity and contestant knowledge are separate.

## Proof

- `durable-game-runner.test.ts` checks distinct planned Mingle slots and restart
  behavior through the accepted conversation cursor.
- `named-alliances-huddles.test.ts` covers immutable attendance, private passes,
  owner fencing, and a differential context test with an unrelated huddle.
- Fresh localhost API games use the corrected provider planning; retained
  requests, responses, retries, cognition, and canonical turns allow inspection
  of both the original failure and the corrected behavior.

Any replacement of a fixed beat with an iterative conversation needs this
identity review. Passing engine-only mocks does not prove production provider
calls are distinct.
