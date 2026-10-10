# W4 House Cuts — prototype evidence

Date: 2026-10-04. Scope: provider-free source/contract/card prototype. No public runtime changes, paid calls, deployment or publication.

## Deliverable

Run `bun scripts/preview-house-cuts.ts` from the repository root. It writes an HTML review packet and JSON input/output/ranking evidence under `.renders/house-cuts-prototype/` (ignored). Fixtures include Influence public dialogue, Werewolf Mystery discussion, Omniscient pack discussion, and an empty selection from a source without dialogue. Synthetic text and scripted candidates are labeled prominently; the packet is not evidence of model editorial quality.

The old Influence selector is executed on the same fixture events: it returns `unsupported_ineligible`, reason `missing_alliance_receipts`, zero cards. The new proposal contract admits the authored conversation-only example. This comparison proves the eligibility boundary, not that a live model discovered the exchange.

## Inspected behavior

- Source adapters use canonical replay and explicit historical speaker identity. Unknown sources, malformed histories and incomplete games fail.
- Werewolf Mystery excludes pack dialogue, night secrets, roles and terminal results. Private pack text changes do not alter its permitted snapshot hash.
- Structured candidates bind to snapshot/window, quote exact source text, identify supported participants and distinguish dialogue from fact references.
- All groups are budgeted before execution. The prototype rejects oversized/over-budget groups rather than dropping early conversation.
- Producer-supplied selection preserves rejected candidates and rejects overlapping source moments. Zero and one-card results work.
- HTML escapes source text, does not render arbitrary supplied URLs as actions, and keeps evidence outside the card.
- Desktop 1280px and mobile 390px browser inspection: readable two-column/stacked dialogue, working source disclosure, no mobile horizontal overflow (scroll width 390 = viewport width 390). Fixture replay targets are diagnostic text, not working live-game links.

## Remaining acceptance

The editorial method and ranking are not approved for rollout. Live execution needs a source loader, shared provider journal/cost adapter and explicit sample/budget authorization. Influence Mingle/huddle source policy, cross-window story discovery, real replay roundtrips, social-image export and durable publication remain in the plan. Current group-per-call granularity requires cost evaluation; fixture invocations are not a paid cost estimate.

## Validation

- `bun run test`: 2,231 passed, 5 existing skips, zero failures (220 files).
- `bun run test:postgres`: 1,855 passed, zero failures (158 files), using isolated `influence_w4_cuts_test`; dropped after completion.
- `bun run check`: all workspace typechecks and lint passed.
- `git diff --check`: passed.
- Browser proof: desktop and 390px mobile as described above. No live-provider or production proof claimed.

## Real-game continuation — hazy-ruby-sand

The operator approved a $2 total `gpt-6-luna` trial on this local completed game. The completed run uses **Mystery/public evidence only**. Automatic approval review blocked exporting Omniscient pack/resolved-night evidence without explicitly naming those contents; that clarification remains pending. No Omniscient provider call was dispatched.

- All 64 permitted entries across 13 canonical conversation/outcome groups were scanned; 14 draft candidates were accepted.
- 16 provider attempts: 13 accepted, three Flex capacity failures. The saved first 12 windows were reused after the last window exhausted its two Flex attempts. One bounded standard-tier capacity retry completed it. No accepted window was paid for again.
- Known token-usage estimates: **$0.002611205**. Three unpriced capacity failures retain **$0.0083183** in conservative reservations. Total accounted against the $1 Mystery sub-budget: **$0.010929505**. These are rate-card estimates/reservations, not a provider invoice.
- `index.html` shows the entire unselected pool, original context and actual replay links. `shortlist.html` is an implementation-agent suggestion of three dialogue-led moments, explicitly not operator approval. Both are in `.renders/house-cuts/hazy-ruby-sand/mystery/`; JSON source, attempts and suggestion reasons are alongside them.
- The actual Mystery replay at `cursor=21` opened into Day 1 playback with roles unknown; it did not restart at introductions. The automated browser refused the `file:` artifact protocol, so no new rendered screenshot acceptance is claimed for this packet. The existing fixture layout has prior desktop/mobile proof.
- No game data, public selector, gallery, social image or publication reference was changed. No Cuts entry is added to the game's landing page by this trial.

### Editorial findings for the human gate

The broader contract admits genuinely dialogue-led candidates: “A standard isn’t a suspect,” “The vote was a pressure test,” and “Kaiya’s claim changes the target.” Exact quotation and reference validation succeeded. A night-only window correctly returned no candidate.

However, isolated vote windows repeatedly produce thin tally summaries (“One vote, five blanks,” “Two votes, no decision”). These pass factual validation but do not justify separate share cards. Whole-group discovery needs a cross-window selection/context pass before treating its output as a finished editorial product. The repeated Seer-claim discussion also demonstrates why a player's challenge about disclosure timing must remain attributed dialogue, not become an unexamined narrative premise. A valid quote does not establish that the speaker's allegation is true.

The suggested edit omits tally-only cards and retains three distinct exchanges. It demonstrates what a producer can select, not an approved automated ranking policy. Broader samples, including a real Influence game, remain necessary before the algorithm gate.

### Continuation validation

- Full provider-free baseline before capacity-recovery adjustment: **2,239 passed, 5 existing skips, zero failures**.
- Final focused editorial/trial tests after that adjustment: **24 passed, zero failures**, including native malformed-output rejection, saved acceptance replay, full-budget rejection, unknown dispatch stop, and bounded standard-tier recovery.
- API source tests cover direct Public/Unlisted access, hidden/active/corrupt rejection, audience isolation and unchanged stored events.
- Full PostgreSQL baseline: **1,857 passed, zero failures** across 159 files, using isolated `influence_w4_real_test`; dropped after completion.
- Final `bun run check`: all workspace typechecks and lint passed.
- Final `git diff --check`: passed.

## Night-story rerun — editorial v2

The operator explicitly approved sending pack dialogue and resolved night choices (including doctor protection) to OpenAI. That resolves the earlier audience-specific approval block for this local sample. Thinking/raw reasoning remain excluded. No publication was authorized or performed.

- Added canonical night packets through the first morning thread, an Omniscient-only confirmed doctor-save seed, and anonymous fact-led eligibility. No-death alone never establishes a save. Selection has no three-card minimum.
- Real `hazy-ruby-sand` run: **69 entries, 12 windows, 7 candidates, 13 provider attempts**. One candidate attempt failed semantic participant validation and was retried successfully. Every attempt has known usage; no capacity fallback was needed.
- This run's estimated cost: **$0.002483855**. Combined with the first Mystery run and its conservative failed-call reservations: **$0.01341336**, below the original $2 aggregate cap. Rate-card estimates are not provider invoices.
- New packet: `.renders/house-cuts/hazy-ruby-sand/night-stories-v2/index.html`. Suggested two-card edit: `shortlist.html` alongside it. Original Mystery artifacts and receipts remain unchanged.
- The model produced **“The pack picked Marnie. The doctor did too.”** It cites pack speech, the resolved target/protection match, and the first morning speech. Canonical evidence identifies Veyra as the protecting doctor and Marnie as the saved player.
- The second suggested card is **“A Seer claim changes the argument.”** Both are implementation-agent suggestions awaiting operator editorial approval. Seven candidates do not imply seven publishable cards.
- Routine early tally windows returned no candidates. A later reciprocal-ballot recap remains thin; the Night 2 Seer/timing-dispute candidate needs the earlier disclosure context before selection. This iteration solves bounded night-to-morning enrichment, not whole-game editorial synthesis.

Validation: **2,242 provider-free tests passed, 5 skipped, zero failed**; **26 focused editorial/trial tests passed**; **2 focused PostgreSQL source-loader tests passed** using isolated `influence_w4_night_test` (dropped afterward); workspace typechecks/lint and `git diff --check` passed. Regression cases distinguish a save from missed protection/no attack, preserve Mystery secrecy, include the first morning thread, retain complete source coverage and admit anonymous fact-only candidates. No new browser-rendered acceptance is claimed for the local HTML packet.

## Operator approval — second v2 Cut

The operator approved **“A Seer claim changes the argument”** (`window-8/kaiya-seer-claim`) for publication, from the `night-stories-v2` Omniscient shortlist. This approval applies to that exact sample candidate, not all seven candidates or the whole editorial algorithm. Publication remains pending implementation of durable House Cuts publication and the shared game gallery; a local HTML file is not a published artifact.

Scope clarification: episode naming currently lives in `episode-presentation.ts`, generating pregame title/teaser copy from cast personalities with an Influence-specific prompt. The roadmap presently places title/release packaging in W5; the focused W4 plan does not explicitly deliver episode naming. Proposed next scope adjustment: shared House title/description editorial generation and producer review in W4, with W5 consuming that approved copy for trailer/cover/release assets. Postgame copy must use audience-appropriate evidence and must not silently overwrite a locked/published episode revision.


## Approved scope correction — automatic publication and Influence parity

The operator confirmed automatic generation, selection and publication after the editorial method is approved. Per-Cut approval, browsing/swapping all candidates, rejection, editing and new regeneration controls were agent-proposed additions, not existing Influence parity. They are removed from W4 requirements and recorded as optional future A2 studio work. The second v2 Cut remains a positively reviewed, publication-approved example; it does not establish a mandatory approval workflow for future Cuts.

The focused plan, architecture diagram, integration tasks, validation wording and pillar roadmap now reflect this boundary. Automatic selection still needs implementation/calibration: the existing local shortlist was selected by the implementation agent. This documentation change neither publishes the sample nor marks the entire editorial method approved. Episode-copy scope remains the separately proposed adjustment described above; this correction does not silently add it to W4.

## Automatic publication implemented and verified locally

This checkpoint supersedes the earlier prototype-only and pending-publication status. The operator approved automatic generation/selection/publication with Influence parity, without a per-Cut approval queue or new producer editing controls. They additionally authorized OpenAI `gpt-6-luna` to receive permitted completed-game evidence (including pack dialogue and resolved night choices), capped at **$1 per audience / $2 per Werewolf game**. Thinking, native reasoning and owner strategy remain excluded.

- Completion transactions now enqueue one Public Influence job or separate Mystery/Omniscient Werewolf jobs. The serial worker persists provider reservations before dispatch, resumes accepted calls, fences publication with a lease token, and stops on an unknown paid outcome. No historical backfill runs automatically.
- The shared game gallery, individual Cut links, social card images and `read_game_cuts` MCP tool read durable publications. GETs never generate content. Hidden games are unavailable; linked Unlisted games work; audiences remain separate. Provider diagnostics and the editorial journal are not returned.
- A final whole-game selection call chooses zero to five distinct moments without a minimum quota. It can use earlier context to reject misleading or repetitive candidates. Exact quotes, attribution, references and links are validated again at publication.
- The old Influence highlight compiler remains only for its existing trailer dependencies. Replacing those inputs belongs to W5; title/description generation was not silently added to W4.

### Real acceptance case

`hazy-ruby-sand` now has real application publications at `/games/hazy-ruby-sand/highlights`:

- **Omniscient:** final model selection independently retained “The pack picked Marnie. The doctor did too.” and the operator-approved “A Seer claim changes the argument.” Published ID: `25113d6d-0c44-45a4-93ba-1f1508af1455`. Saved discovery was reused only after verifying its source hash. Selection cost estimate: **$0.0009384**.
- **Mystery:** the old report no longer matched the current grouping hash, so import stopped before a paid call. The actual worker then generated from the current permitted source and selected one Cut, “A Seer claim—and an immediate timing challenge.” Twelve provider attempts, **$0.00306335** estimated cost.
- Incremental generation cost this implementation pass: **$0.00400175**, using rate-card estimates rather than provider invoices. No other historical games were queued.

### Final validation

- Provider-free baseline: **2,232 passed, 5 skipped, zero failed** (221 files). The lower count reflects removal of obsolete gallery-only tests when the old gallery was removed.
- Required PostgreSQL baseline: **1,864 passed, zero failed** (160 files; 21,610 assertions), using isolated `influence_w4_publication_test` rather than altering the developer's shared test database.
- Final focused worker checks after adding recovery/MCP/Influence regression coverage: **8 passed, zero failed**. These cover completion rollback/idempotency, concurrent claims, visibility changes, audience separation, expired leases, unknown provider outcomes, actual JSON-RPC tool dispatch and persisted Influence source loading through the shared worker.
- Workspace typechecks/lint and `git diff --check` passed.
- Anonymous browser: desktop gallery and individual approved Cut loaded, mobile 390px layout remained legible, and “Watch this moment” navigated to the House replay with Omniscient audience and `cursor=64`. Native sharing opened and was cancelled without sending anything. Screenshot: `/tmp/w4-published-house-cuts.png`.
- Live MCP `read_game` advertises `read_game_cuts` with the selected audience. Direct new-tool discovery in an already-open connector session may require refreshing its cached tool catalog; JSON-RPC dispatch is covered above.

This proves local integration and the named Werewolf acceptance case, not deployment or broad editorial calibration across games. A paid Influence editorial sample remains useful calibration work; deterministic Influence persistence and publication integration are covered.
