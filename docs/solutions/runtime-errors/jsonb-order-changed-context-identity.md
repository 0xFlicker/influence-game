---
title: JSONB field order changed a durable call's context identity
date: 2026-10-25
module: strategy state and durable provider calls
problem_type: runtime_error
tags: [jsonb, context-hash, recovery, strategy-state]
---

# JSONB strategy order broke recovery

Production `void-lilac-blade` repeatedly adopted pending turn 490, then stopped with
`Context source changed under the same logical call`. Committed turn 489, canonical
event 309, dialogue 522 and publication 889 stayed unchanged. Each failure released
ownership, allowing another adoption while the game remained `in_progress`.

`compactionCharacter.currentStrategy` embeds `JSON.stringify(getCompactStrategyState())`.
The original in-memory strategy has insertion order; restored PostgreSQL JSONB has
different key order. Spread-based cloning preserved the database order. Canonical
hashing of the outer object cannot normalize JSON already embedded in a string.

Reconstruct compact strategy in its original explicit field order, including nested
`priorEpoch`, before serialization. Preserve the existing hash algorithm, saved
hashes, provider contracts and attempt evidence. A real context change remains an
integrity error. Report expected, actual and component hashes without context text;
under the matching owner epoch, mark execution `repair_required` and relinquish
ownership to prevent repeated automatic adoption. This is unrelated to context size.

The recovery patch also recognizes the structured `providerAbsence` marker. An
existing rules-legal unavailable result must not claim an accepted provider value
or performance cue. The commit guard remains strict; failed attempts stay saved.

## Exact-game proof

The private capture used a PostgreSQL `REPEATABLE READ READ ONLY` transaction and
the normal durable-store reader, which validates canonical event hashes and the
dialogue frontier. It included the frozen player records, committed snapshot,
pending intent and original provider failure. The private object body was checked
against its manifest SHA-256 and byte length before use.

The [offline reproducer](durable-context-recovery-probe.ts) restores the actual
`GameRunner`, builds its next intent, checks it against the saved turn, reads the
saved attempt through the context guard, and compiles the provider request. All
network access and provider dispatch are disabled. It stops before reservation,
terminal journaling or turn commit. No application database is opened by the probe.

| Check | Result |
| --- | --- |
| Saved turn / pending turn | 489 / 490, subcall 1 |
| Production serializer | Hash differs; saved-context guard rejects before compilation |
| Patched serializer | Hash equals the original saved hash |
| Patched native request | Deep-equal to the original recorded request, including schema |
| Context spans | 9 |
| Network calls / terminal writes / turn commits | 0 / 0 / 0 |
| Saved snapshot | Unchanged |

Identities:

```text
baseline: e502692546a92e870de96767bdea72311af3095f
game: 625510cc-2854-4080-87c4-0fdb79d576a4
logical call: sha256:349e43c7bee246e8b3c95c800b74d340647946cb6c88a3b7d07633acbd17885b
saved and patched context: sha256:4009d462ea43a00c83890be7d2bf6be6591edee3d81147b61d941fba0701be85
production serializer after JSONB: sha256:5e74b9bead43f7de730b69f726dd398693b2cb84c05188cdb4a57022f1a723a8
private capture SHA-256: 7c372e23006cdce23b21a1b91645b7f6a94842df21a8799e692318a670f7cf6e
provider evidence SHA-256: 7478ec662e53a3ea40db11ea76e03649812b3354e07b352d20fe039a430177ca
provider evidence bytes: 73963
```

The production-serializer hash is an offline reproduction from the actual saved
frontier, not a hash captured by the old live error message. Only the serializer
was reverted for that negative control; the exact patched bytes were then restored
and the successful proof repeated.

Private inputs and receipts remain in the ignored local directory
`docs/simulations/2026-10-25-void-lilac-blade-recovery/`. They are not committed.
Given an authorized private capture with the documented fixture shape, reproduce
without credentials or provider calls:

```sh
bun docs/solutions/runtime-errors/durable-context-recovery-probe.ts \
  docs/simulations/2026-10-25-void-lilac-blade-recovery/void-lilac-blade.private.json
```

Regression coverage traverses actual JSONB, interrupts after a failed fallback,
checks equal context identity on recovery and accepted-result replay without another
dispatch, and rejects genuine strategy changes before transport. Owner-fence tests
prove a stale owner cannot block the game or change its committed frontier.

This is preparation and offline evidence, not proof of live continuation. The patch
requires no SQL migration. Release matching gateway/worker images through the
[normal fenced handoff](../../deployment/game-worker-operations.md#drain-contract),
then verify the existing game advances from its saved frontier. Do not rewrite its
hashes, clear provider evidence, recreate the game or bypass the integrity guard.

Related earlier integration incident: [void-fawn-edge investigation](../../plans/2026-10-23-void-fawn-edge-fixes.md).
