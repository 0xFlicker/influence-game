# Games, creation and playback

The House is the venue. Influence and Werewolf share character identity and visuals, but keep separate strategy notes, rules and outcomes. Create games at `/games/new` and browse them at `/games`. The [House cast](house-cast.md) supplies fixed default names, archetypes and portraits; saved character creation offers a [guided assistant and advanced editor](agent-creation-assistant.md). Saved strategy changes affect subsequent games, not frozen historical rosters.

## Influence

Influence combines public Lobby conversation, private Mingle rooms, named alliances, empowerment voting, selected round formats, elimination and endgame decisions. The engine owns eligibility, format resolution, jury facts and the winner. Classic Power/Council code is a historical lane rather than the default format path. See [domain concepts](../CONCEPTS.md).

Lobby, Mingle and selected alliance huddles use bounded sequential speech/pass decisions: new-game defaults are 320 UTF-8 bytes per speech and 400 per participant. Two ordinary Mingle rounds have one simultaneous movement checkpoint. Each contribution commits under its own durable provider slot before the next context is prepared.

The House selects alliance proposal opportunities and private huddle participants; players author proposals, consent and dialogue. House scheduling does not establish alliance facts or manufacture commitments. Attendees retain their session dialogue after membership changes; outsiders receive no session existence or scheduling information. A spoken disclosure remains a claim, not access to the private session. See [conversation evidence and recall](reasoning-transcript-observability.md).

## Werewolf

Werewolf uses six to eight players, one or two wolves, optional Seer/Doctor roles and faction victory. Mystery playback protects private night information; Omniscient can show roles and private actions. It is separate from Influence's Daily queue, ratings, jury and season competition.

Fresh games use **rules v11**, frozen at creation, including waiting lobbies. A private daily priority survey orders ordinary speaking opportunities. Discussion uses one shared byte allowance, followed by a public sequential ballot; elimination requires a strict majority of all living players. Abstentions are legal and a shortfall means no elimination. Doctor, Seer and lone-wolf decisions include a target and private spoken explanation; multiple wolves negotiate through proposals. Historical games retain their frozen version's contracts. See the [full rules and evaluation guide](werewolf.md).

## Completion and playback

Fresh games continue after their competitive outcome with one speech from each original contestant. Retrospectives distinguish knowledge available during play from postgame revelations and use canonical facts rather than earlier speakers' claims. A failed required speech preserves the outcome and pauses completion. After `retrospective.completed`, Influence playback returns to canonical winner/standings presentation. See [retrospective execution and recovery](game-retrospective-runtime.md).

Discussion passes are skipped even with **Show thinking** enabled. Canonical pass records and private thinking remain available for authorized debugging; ballot abstentions remain public. Spoken huddles use the normal thinking toggle without widening contestant recall.

Playback speed, thinking visibility and thinking order are player preferences. They do not change model reasoning or execution speed. Creation-time Speed-run/Live and phase timing presets have been removed; API evaluation uses Influence's `--max-rounds` or Werewolf's maximum-day ceiling. See [watch timing](watch-timeline.md), [Audio Mode](audio-mode.md) and [Studio](production-studio.md).

## Visibility and sharing

Both games support **Public** (listed; anyone can watch) and **Unlisted** (omitted from discovery; anyone with the link can watch). Public is the default, including `simulate:api`, `simulate:werewolf:api` and `simulate:models`. Use `--visibility unlisted` explicitly; completion preserves the selection. Unlisted pages use `noindex`, but links can be forwarded. Private visibility is no longer supported. Hidden is a separate moderation control blocking ordinary viewer routes and subsequent stream delivery.

Anonymous casting/replay/media reads respect game visibility and audience boundaries. Joining, owner learning, raw evidence and production actions retain their own permissions. Invalid stored visibility is rejected, not silently made public.

**Share this moment** captures the player's audience, canonical cue and playback settings. Share controls produce House short links; they do not call a model or change accepted game history. See [sharing and short-link behavior](house-sharing.md).

## Models and media operations

Characters can select Default or an available free model; admins/sysops can choose supported experimental exact IDs. Contestant and House routes have separate fallbacks, frozen before execution. Current choices, recovery caps and native-provider setup live in [model routing](model-routing.md).

API games support [Visual Mode](visual-mode.md); the admin [Werewolf workspace](werewolf.md#admin-and-production-workspace) provides activity, costs and scene production. Completed-game repairs and published replacements belong to production tooling. For reusable character cutouts, start with the read-only inventory command and follow the environment-specific [cutout runbook](deployment/character-cutouts.md):

```sh
bun run cutouts:backfill inventory --env local --scope example-models
```

For provider-free fixtures, durable API launches, mixed-model previews and spending/evidence requirements, use [local model evaluation](local-model-evaluation.md) and [Werewolf evaluation](werewolf.md#local-evaluation-and-proof).
