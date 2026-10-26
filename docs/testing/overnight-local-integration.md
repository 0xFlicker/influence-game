# Local multi-model audio and cutout qualification

This checkout integrates the October 25 overnight evaluation. Keep the exact game
IDs, provider evidence, media and shared ledger in the sibling `evidence/` folder.
The existing localhost database and object store retain canonical history. Do not
reset their volumes or change saved character profiles to prepare this evaluation.

Start API, game worker and web in separate terminals using
`bash scripts/overnight-local-services.sh api`, `worker`, and `web`. The script uses
the existing Doppler `social-strategy-agent/dev` configuration, localhost database
and object storage, ports 3000/3002/3001, and the original local upload directory.
No credentials are included in the script. The existing CLI session authenticates
API simulations and exports; browser sign-in remains its ordinary separate flow.

## Shared provider budget

`INFLUENCE_LOCAL_TASK_BUDGET` enables a local-only, operator-controlled ledger.
It is rejected in production. Every game must appear in `allowedGameIds` before
its first model request. Both games, contestant fallback, context adaptation and
House episode naming use the same pre-dispatch hook. Unrelated automatic screening,
learning, image generation, health probes and House Cuts are disabled in this mode.
Generation failures retain canonical acceptance and the existing recovery path.

The local retrospective-retake CLI also honors this opt-in ledger for text
generation, retries and context adaptation. Its explicit editorial model choice
still requires an allowed game, an allowed provider and sufficient remaining
currency allowance when `INFLUENCE_LOCAL_TASK_BUDGET` is set. With that variable
unset, the command retains its ordinary explicit-generation behavior. Retake
evidence is saved in its new generation directory before dispatch and before
settling usage; failed terminal evidence persistence retains the reservation.

Gateway and game workers serialize ledger updates through a heartbeat lock with bounded contention retries. A crashed owner's stale lock can be recovered without changing any charge entries. Stop every old local-budget process before upgrading the locking implementation; an abandoned legacy `.lock` file requires operator verification that no old writer remains before removing that file. Never remove the ledger or its reservations to recover a lock. The new lock is a directory maintained by `proper-lockfile`; do not manually remove a live lock.

The ledger maintains independent ceilings of $15 OpenAI, 10,000 Katana credits,
and $15 xAI. The user subsequently authorized a separate $10 Meta API cap; native Meta
Contributor text is charged against that independent pool.
Prior-task holds are explicit and must be reconciled from retained evidence.
Never delete, reset or reduce a ledger to enable another request.

Text reservation counts UTF-8 request bytes plus 16,384 framing tokens and the
explicit maximum output allowance at twice the highest documented price tier.
Known terminal usage settles at those conservative rates, retaining the larger
provider receipt. Missing usage or failed evidence persistence retains the entire
reservation. Katana conversion uses its documented $0.0052/credit reference,
rounding upward and retaining native credit receipts. TTS charges every dispatch
at $30 per million UTF-8 bytes, conservatively above its published $15 per million
characters, including markup, retries and uncertain outcomes. No refunds are
assumed for TTS. This is an admission guard and upper-bound ledger, not an invoice.

If the durable journal rejects a newly reserved attempt before dispatch (for example, a cooldown or exhausted fallback allowance), retain its reservation receipt as `not_dispatched` with zero charged. This is the only automatic admission refund. Existing reservations, uncertain provider outcomes, and failed evidence persistence keep their holds; a rejected attempt ID cannot be reused to dispatch without a fresh reservation.

Focused guard validation:

```sh
bun test packages/engine/src/__tests__/local-task-budget.test.ts
```

Required integration checks remain `bun run test`, sequential `bun run test:postgres`,
and `bun run check`, followed by live paid API games and actual viewer/export checks.
Provider-free fixtures do not establish live provider acceptance or audible output.

## Eight-character cast

GPT Sol, Claude Sonnet, Claude Haiku, Gemini Pro, Meta Spark, Kimi K3, DeepSeek Flash,
and Grok 4.6 retain their current saved profile identities and model preferences.
GPT Luna is the House and common recovery route. Existing circular portraits remain
unchanged. Full-body derivatives must preserve source dimensions and head geometry,
fall back to the original when unavailable, and be pinned into new export snapshots.

The final clean games use native Meta `muse-spark-1.3-contributor`. GLM is prohibited for these runs; prior debug-game substitutions remain historical evidence. Each actual xAI audio dispatch reserves from the shared ledger using its durable attempt ID.

The faint rectangle in the supplied Sonnet screenshot came from Werewolf opening CSS (`border` plus rectangular `box-shadow`). Full-body opening shots now retain the same image box with a transparent border and alpha-following shadow. Browser and Remotion share this frame. Portrait fallback styling and all source/cutout pixels remain unchanged.

The corrected explicit voice cast is Sol=sal, Sonnet=atlas, Haiku=iris, Gemini=altair, Meta=liora, Kimi=ara, DeepSeek=kepler, Grok=sirius, House=helios. The harness checks persisted selected profile assignments before creating a lobby, preventing automatic seeded defaults from silently substituting for the approved audition choices. Existing games require the voice-correction recovery operation; profile edits alone do not change frozen tracks.

## Returning to the development checkout

The integrated development checkout is `/Users/user/Development/influence-game`
on `codex/overnight-local-integration`. The original `codex/peragent-model-selection`
branch and its untracked research assets remain preserved.

The launcher accepts `INFLUENCE_LOCAL_TASK_EVIDENCE_DIR`, or reads a plain absolute
path from ignored `.overnight-evidence-dir.local`. This keeps the existing budget,
generated assets, game evidence, and completed videos in their original location
without copying or overwriting them. Missing budget ledger fails before startup.

From this checkout, start only API and viewer in separate persistent terminals:

```sh
bash scripts/overnight-local-services.sh api
bash scripts/overnight-local-services.sh web
```

The launcher enables `CHARACTER_CUTOUT_MODE=local`; plain startup defaults that
feature to disabled and therefore omits even already-generated cutouts. Artwork
comes from ordinary frozen references. The corrected Gemini profile is used by new
games; the four older demos retain their original identity. See the
[publication workflow](../deployment/character-art-replacement.md). Keep the paid
game/audio worker off for viewing completed games. The existing database and
object-store containers are reused unchanged.
