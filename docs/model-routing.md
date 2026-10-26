# Character and House models

Characters have one operational `modelPreference`, shared across Influence and Werewolf. It is independent of strategy text and moderation revisions. The three free models are OpenAI GPT-6 Luna (Flex), Katana DeepSeek Flash (`deepseek-v4-flash`), and Meta Muse 1.3 Contributor (`muse-spark-1.3-contributor`), alongside Default. GLM Flash was removed from free selection after another minimal Katana inference returned HTTP 502 with no output on October 25, 2026 (America/Denver). Admins/sysops can choose any text model ID understood by a configured adapter. Discovery is advisory, not paid qualification. Unknown capability claims and prices remain labelled as unknown or inferred.

Edit a character's preference in its editor. Admin creation has separate contestant and House routes. In the admin game list, **Models** opens cast overrides, shared contestant fallbacks, House fallbacks, and exclusions. An explicit Default override selects the game default; removing the override restores the enrollment preference. The short best-effort explanation needs no consent checkbox. Subscription billing and media-model selection are outside this setting.

## Authority and recovery

The character editor uses a searchable model combobox in a compact preference row. Type a model name, provider or ID to filter; arrow keys navigate and Enter selects. Selection updates the form draft; **Save changes** persists it atomically with the other edits. Cancel discards the change. Admins/sysops can expand “Use an exact model ID” for manual entry. The preference remains operational metadata outside content moderation; the best-effort notice stays beside the control.

`MODEL_CATALOG` and `modelCatalogEntryById` expose resolved model records: audited provider capabilities and the provider-qualified rate card are attached before API, UI, or runtime consumers read them. The inventory adds discovery availability; game creation has no separate model facts or descriptive catalog. Unknown prices remain null, never another model's price. Capability evidence and exact-schema requirements remain structured diagnostics, not picker warning prose.

`provider-model-facts.ts` resolves the checked OpenAI/Katana snapshots and Meta's documented text models. Curated definitions contain product labels and evaluation status only; capabilities and rates come from these facts. Documented OpenAI snapshot aliases share their family's facts, with explicit exceptions such as the pre-structured-output GPT-4o snapshot. No guessed future date inherits rates. Katana capability parameters apply only to Katana's adapter, and local/custom endpoints never inherit hosted pricing merely because an ID matches. Adaptive reasoning respects the frozen model's supported effort levels.

Saved-agent cards, casting choices, Daily selection and admin agent rows show an explicit model preference alongside archetype information. Portrait previews on these current-profile surfaces show it too. Default or an absent preference renders nothing. These labels describe the current preference, not a historical game's actual execution or fallback.

Game-view avatar popups in Influence and Werewolf show the selection saved for that game beneath the archetype: a cast override takes precedence over the enrollment snapshot. Default or a missing selection shows no model label. Later profile edits do not change it, and the label does not claim which model answered a particular turn after fallback.

This also applies to existing games with saved selections. Watch hydration, replay player reconstruction and alliance member projections must retain this field through to the avatar popup.

Run `doppler run --project social-strategy-agent --config dev -- bun run audit:models` to check all configured provider listings for missing pricing or undocumented capabilities. It only lists models: no inference or paid tests. Unavailable providers are reported separately without invalidating healthy catalogs. The captured inventory regression test checks every model from the [2026-10-23 audit](audits/2026-10-23-model-catalog.md); refresh the audit and facts together when provider listings change.

All character, cast, contestant and House route controls use the shared `ModelPricing` display: estimated provider USD per million input/output tokens, rounded to at most three decimal places in readable text. Positive rates below $0.001 are shown as “<$0.001”; absent rates show “Pricing unavailable”. Rounding is presentation-only. Stored rates, source dates, cached-input rates, provider minimums and tier adjustments retain full precision for accounting. Luna's displayed rate card remains Flex.

GPT-6.1 Sol has an explicit documented catalog entry and provider-qualified rates, checked against the [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) on 2026-10-23. Accounting includes cached input, cache writes, Flex and the published >272K-input-token adjustment. This is a documentation audit, not a paid gameplay qualification. Provider discovery and exact-ID validation both exclude known image-generation, audio, video, embedding and moderation model families; text models that accept images remain eligible.

Game creation and model settings use a collapsed “Allowed models” checklist. All models are allowed by default; unchecked choices become exclusions. Longer catalogs are searchable, saved exclusions remain visible when discovery omits them, and models currently used by routes or explicit cast overrides are marked “In use”.

Enrollment snapshots the requested preference. Start rechecks current owner entitlement, unless an admin supplied a cast override, and freezes `config.modelRouting` in the same transaction as roster/start authority. Order is cast override → enrollment preference → game default. A later profile edit affects future enrollments only. Model metadata is frozen with the routes so discovery/catalog updates cannot rewrite an active run. New seats no longer carry a competing `agentConfig.model`.

Every contestant uses its own frozen route, including retrospective speech and context adaptation. An explicit preference runs first, followed by the entire `defaultManifest`, skipping duplicates: for example, Kimi → Luna → Grok. Default starts at the first entry of `defaultManifest`. `defaultModelMaxFallbackCalls` sets the shared contestant allowance for that first entry when it serves as a fallback (default 24, editable before start); primary calls do not consume it. Other fallback entries retain their own caps. `houseManifest` contains the independent House primary and fallbacks. Known image-incompatible fallbacks are skipped for Influence image inputs; an explicitly incompatible primary gets an actionable error. Werewolf scene rendering does not give contestant text calls image inputs.

Existing coordinator behavior handles refusal, bounded retries, provider health, strict-schema failures, and context adaptation. No permissive JSON repair is introduced. A coordinated Luna request always uses Flex, including fallback use, without the legacy transport's automatic Standard escalation. Empty fallback chains are allowed. Exhaustion retains the owning phase's legal absence/error behavior.

Request parameters respect the frozen model capabilities. Non-reasoning OpenAI models receive neither reasoning effort nor reasoning summaries, even when an action requests a summary. Non-reasoning models and audited OpenAI models without Flex support use their ordinary `auto` service tier; this is the selected model's supported initial lane, not a retry escalation. Flex eligibility is frozen from the audited Flex rate card with new assignments. Older frozen non-reasoning records already identify the incompatible lane; other historical records without explicit Flex capability retain their recorded tier behavior. Luna remains Flex-only.

A retryable response with a valid future `Retry-After` advances immediately to the next permitted model. The failed model stays unavailable until its durable cooldown expires; other models on the same provider remain usable. Repeated service/transport failures without that header use the existing threshold and cooldown. Authentication remains provider-wide; configuration failures stay model-specific and require a successful explicit probe. Cooldowns survive actor changes and worker restarts.

Katana Claude requests compile nullable enums to equivalent `anyOf` branches at the adapter boundary. Local semantic validation still uses the original exact schema, including legal IDs, required fields and rejection of extra fields. This follows the [Claude structured-output schema reference](https://platform.claude.com/docs/en/build-with-claude/structured-outputs); provider-free equivalence tests do not establish live Katana acceptance.

Fallback caps count dispatch reservations, shared across contestants by route, with a separate House allowance. Primary use and accepted replay do not count. Retries and uncertain dispatches do. Game-level advisory locking serializes reservations from game workers and episode-naming workers. Call caps are not dollar budgets.

## House text inventory

| Responsibility | Owner and route |
|---|---|
| Mingle rooms, alliance proposers, selected huddles | `LLMHouseInterviewer`, injected House runtimes |
| Live narrative summaries and long-form gameplay summary | Same House interviewer and strict coordinator |
| Diary question and follow-up/close | Same House interviewer |
| Episode title and description | `episode-presentation.ts`, House runtimes and durable provider journal; fenced by episode revision/lease |
| Contestant actions, reasoning, retrospective speeches | Contestant runtime, never the House model |
| Context compaction | Original invocation's route and audience boundary |
| Outside-game character generation; images/audio/video | Existing independent settings; not part of this policy |

Never call a provider directly from a new House responsibility. Inject the game route and use the shared coordinator, exact schema, semantic validator, journal and evidence storage. Do not use `as any` to bypass invocation contracts.

## API and MCP

| Operation | HTTP | MCP |
|---|---|---|
| Role-filtered model metadata | `GET /api/provider-models` | `read_model_catalog` |
| Save owned character preference | `PATCH /api/agent-profiles/:id/model-preference` | `set_agent_model` |
| Inspect assignments and execution report | `GET /api/model-routing/games/:id` | `read_game_model_routing` |
| Edit waiting game's policy/overrides | `PUT /api/model-routing/games/:id` | `set_game_model_routing` |

HTTP and MCP use the same ownership and current-database-role checks. An admin override does not grant the profile owner broader model access. Saved configuration cannot supply sealed assignments. Game policy writes stop at start. New game creation accepts `modelRouting`; the existing manifest input remains an admin creation shorthand that is normalized into the single policy.

Catalog discovery reports `complete`, `partial`, or `unavailable`, plus a `providers` array with each configured provider's display name and catalog status. One failed lookup (such as offline LM Studio) does not discard successful listings or mark their models unavailable. These diagnostics remain in the API/MCP response; model forms do not display catalog-status banners. Recommended automatic fallbacks come only from confirmed available listings. Catalog status describes discovery, not inference health; raw upstream errors, credentials and endpoint URLs are not returned.

## Catalog and prices

The normalized Katana snapshot in `packages/engine/src/katana-catalog-snapshot.json` was read from [public model metadata](https://kat.imgnai.com/v1/models/text) on October 23, 2026. It records documented inputs, strict-schema support, context/output limits, request controls, price tiers and minimum/rounding charges. These are provider claims, not gameplay test results.

| Route | Input / cached input / output USD per million | Evidence |
|---|---|---|
| Luna Flex | 0.05 / 0.005 / 0.25 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-luna), October 23; long-context/cache-write tiers retained |
| GLM Flash | 0.156 / 0.0312 / 0.52 | Katana October 23 metadata |
| DeepSeek Flash | 0.1001 / 0.02002 / 0.2002 | Katana October 23 metadata |
| Muse Contributor | 0.10 / 0.002 / 0.20 | Existing October 14 [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits) record; public refresh unavailable October 23 |

Katana's 0.1-credit increment/minimum at the documented USD reference produces a $0.00052 request minimum. Small calls therefore need not cost the nominal token-rate comparison. Grok 4.6 now has a route-qualified price and a 200,000-input-token tier. GLM 5.2's current structured metadata says 0.0346115 input / 0.033495 cached / 7.105 output; this differs from older audit/prose rates. Accounting explicitly uses the dated structured metadata, not the old prose. Meta's retained date is not a claim of a fresh audit. Other legacy table entries remain estimates; review their sources before relying on a new experiment's budget.

Rate cards are provider-qualified and captured on attempts before dispatch. Terminal receipts retain their version/source, unsuccessful billable attempts, and separate provider-reported versus estimated costs. An unknown route retains usage with an unknown price; it never borrows Luna pricing. This last behavior fixes an existing reporting bug.

See [cutover](deployment/game-model-routing-cutover.md), [simulation usage](local-model-evaluation.md), and the [House character proposal](plans/house-character-model-assignments.md).
