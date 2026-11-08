# The House product analytics

PostHog US project **671431** measures the browser journey. Dashboard:
https://us.posthog.com/project/671431/dashboard/2224772

## Configuration

The web runtime reads `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` into `/runtime-config`.
This is a public ingestion token, not a personal API credential. It is configured
in production Doppler (`social-strategy-agent/prd`) and the local ignored web
`.env.local`. The production release already allows `NEXT_PUBLIC_*` through its
web environment filter. Deployment, including the normal manual production gate,
is required before live visitors emit these events.

The browser SDK sends ingestion requests through `https://k.thehouse.game`, the
PostHog reverse proxy. The proxy and its DNS/TLS routing are managed outside this
repository; confirm they route SDK ingestion and static assets to the US project
before releasing. Source-map uploads still use `https://us.posthog.com`.
The SDK's UI host also stays at `https://us.posthog.com` for toolbar links.

Collection is limited to `thehouse.game`; localhost, previews and staging do not
pollute the production project. Browser SDK loading happens after auth hydration.
Admin, sysop and producer accounts and admin/auth routes are excluded. Signed-out
visits cannot be classified as staff. Identify uses only the public account UUID;
logout/account switching resets the analytics identity. Do Not Track and the
Global Privacy Control and privacy-page browser opt-out disable collection.
Regional consent gates SDK initialization as described below.

## Event contract

All events have `channel=web` and `environment=production`.

- `$pageview`: sanitized current URL, SDK referrer/device/session attribution,
  and validated campaign attribution (next section).
- `$pageleave`: SDK-managed browser exit event with previous-page duration and
  scroll metadata. In-app navigation carries that metadata on the next pageview;
  no duplicate manual leave event is sent for each route change.
- `$web_vitals`: controlled by the PostHog project's Web Vitals setting. The SDK
  configuration leaves performance capture unset to honor that setting.
- `$exception`: browser unhandled errors/rejections and currently displayed
  React route-boundary errors. Console errors are not captured. Collection starts
  only after analytics/auth initialization and follows the same privacy controls.
- `agent_creation_opened`: entry into public creation, with `flow`.
- `join_opened`, `join_agent_selected`: saved-agent selector opened/submitted.
  An open selector emits its opening once capture becomes active; selectors
  closed before readiness are never backfilled.
- Operations `agent_creation_turn`, `agent_generation`, `agent_portrait`,
  `agent_save`, `influence_join`, `werewolf_join`, `daily_entry` each emit
  `_requested`, `_succeeded`, `_failed`. Attempts share `attempt_id`. Outcomes
  include `duration_ms`; failures include HTTP status (0 for transport errors).
- `watch_opened`, `watch_started`, `watch_seeked`, `watch_progress`,
  `watch_buffer_end_reached`: shared director engagement. Properties include
  `watch_id`, `game_id` (Influence UUID or Werewolf slug), `game_kind`, `watch_mode`
  and canonical `position` when available.

Success means the browser received and decoded a successful API response, not a
button click. These events are best-effort browser telemetry, **not server audit
records**: blocked analytics or a lost response can omit committed successes.
Authoritative conversions are the server events below; browser events explain
interaction and abandonment and are never the only conversion evidence.
Daily Free acceptance is queue entry, not proof of seating in a match.

## Campaign attribution

Supported fields, retained after format validation in the browser sanitizer
(`packages/web/src/lib/analytics-privacy.ts`), first-party retention
(`packages/web/src/lib/campaign-attribution.ts`) and the server validator
(`packages/api/src/services/campaign-conversions.ts`):

| Field | Query parameter | Meaning |
| --- | --- | --- |
| source / medium / campaign | `utm_source` / `utm_medium` / `utm_campaign` | Campaign source |
| creative | `utm_content` | Creative/ad identity |
| audience | `utm_term` | Audience/keyword identity |
| click ID | `gclid`, `fbclid`, `msclkid`, `ttclid`, `dclid`, `gbraid`, `wbraid` | Platform click identifier |
| landing variant | `landing_variant` | Landing-page variant |
| onboarding variant | `onboarding_variant` | Onboarding experiment assignment (kept separate from acquisition) |
| starter identity | `starter_prompt`, `starter_skill` | Starter prompt/skill **IDs only**, never prompt text |

Before this change, the sanitizer deleted `utm_content`, `utm_term` and
`gclid`/`fbclid`/`msclkid`, and the other click IDs were never captured, so no
creative or click-level attribution survived. Now validated values are kept
(including nested `$set`/`$set_once`/`$initial_*` forms); values that fail the
format checks, unlisted `utm_*` fields and `search_keyword` are dropped.
Credentials, OAuth codes, emails and prompt text are still removed by the
URL/exception scrubbers — that protection is scoped to secret-bearing fields
and is unchanged.

Retention: the first eligible non-direct touch and the latest non-direct touch
are stored with timestamps, first in consent-gated browser storage, then on
`user_campaign_attribution` after authorized account linking
(`POST /api/attribution/retain`, plus the signup request payload). The authenticated
endpoint also synchronizes the effective analytics preference, including denials
when no attribution exists. First touch
is never overwritten; a direct visit never replaces the last non-direct touch.
The browser exposes a 90-day window helper, but the current report does not
apply a date window or implement assist analysis. It groups recorded outcomes by
first-touch attribution; do not describe it as a dated acquisition-cohort report. Missing attribution is reported as `unknown` — identity is never
inferred from IP addresses or fabricated across devices.

Remaining gaps: pre-consent touches are not queued or backfilled (see Regional
consent), anonymous pre-signup creation is stitched in PostHog by `identify`
but has no server visitor-to-account claim, and cross-device journeys without
sign-in stay unattributed.

## Server conversion events

Recorded in `campaign_conversion_events` by
`packages/api/src/services/campaign-conversions.ts`, inside the mutation's
transaction where the mutation owns one, with deterministic IDs so retries,
switches, repeated requests and replays cannot duplicate a conversion.
`distinct_id` is always the public account UUID, never the internal user ID.
Attribution is the owner's retained first touch; channel is `web`, `mcp`
(with the OAuth `clientId` from the MCP auth context, never tool arguments)
or `api`.

| Event | Fires when | Deduplication ID |
| --- | --- | --- |
| `signup_completed` | New account row committed (`created === true` only) | `signup:{userId}` |
| `agent_creation_started` | First successful creation-assistant turn per account | `agent_creation_started:{userId}` |
| `agent_created` | Agent profile created (each additional agent counted separately) | `agent_created:{agentId}` |
| `agent_ready` | Agent published and eligible (immediate publish or screening publication) | `agent_ready:{agentId}:{revisionId}` |
| `season_entry` | Enrolled in the intended season (queued or switched) | `season_entry:{userId}:{seasonId}` |
| `game_placed` | Placed in a game (distinct from enrollment; not yet emitted) | reserved |
| `mcp_linked` | MCP account linking (not yet emitted; MCP conversions already carry channel/client) | reserved |
| `owner_returned` | Existing account signs in on a new UTC day (reactivation, never signup) | `owner_returned:{userId}:{date}` |

Signup counts unique new accounts. Ready-agent and season-entry columns count
unique accounts independently; returning owners can contribute to those columns.
They are not yet restricted to the signup cohort. Enrollment
(`season_entry`) is not placement (`game_placed`), and returning viewing is
measured by identified `watch_*` events on days after signup together with
`owner_returned`; no server watch event is claimed.

Delivery checks the account preference immediately before sending. The account
row lock serializes withdrawal, event capture, and delivery across workers; no
new send starts after withdrawal is acknowledged. Requests already sent cannot
be recalled. PostHog, Meta, Google, TikTok, and X each have independent five-attempt upload budgets and
five-second HTTP timeouts. Missing configuration consumes no attempts. A
delivered destination is not resent when another retries. PostHog receives a
stable event UUID through the [US ingestion API](https://posthog.com/docs/api/capture);
Ad platforms receive a deterministic conversion ID. Unsupported funnel events
are `not_applicable`, not delivered. Google processing has a separate polling
schedule described below. The worker drains on shutdown.

Signup tracking runs in a separate bounded transaction after account creation.
Failure logs a payload-free warning and does not prevent session issuance. The
worker reconciles missing signup events from canonical account records older
than one minute (allowing the signup transaction to finish), keeping
the original creation time. Recovery is internal-only (`suppressed`) because
historical permission cannot be inferred; re-running recovery is idempotent.
Historical account recovery is not a new paid conversion.

## Advertising-platform feedback

The server outbox supports Meta, Google Ads Data Manager, TikTok Events API,
and X Conversion API. Configuration is per destination; this implementation
has not activated credentials, deployed tracking, or sent live test events.
No browser ad pixel is added. The signup flow stays unchanged.

Only three authoritative outcomes are sent: `signup_completed`, `agent_ready`,
and `season_entry`. Agent readiness and free season enrollment are never
labelled purchases, and payloads contain no invented revenue. The bidding
objective remains a campaign setup decision.

| Destination | Mapping and matching | Configuration |
| --- | --- | --- |
| Meta | `CompleteRegistration`, `AgentReady`, `SeasonEntry`; SHA-256 public account ID and retained `fbclid` as timestamped `fbc` | `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` |
| Google Ads | A distinct `UPLOAD_CLICKS` conversion action for each outcome; retained `gclid`, `gbraid`, or `wbraid` | OAuth client ID/secret/refresh token, customer ID, three action IDs; see operations guide |
| TikTok | `CompleteRegistration`, custom `AgentReady` and `SeasonEntry`; SHA-256 public account ID and retained `ttclid` | `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_ACCESS_TOKEN` |
| X | A distinct Events Manager event ID for each outcome; retained `twclid` | Pixel ID, three event IDs, Ads API consumer key/secret and user access token/secret |

Google and X events without their matching click identifier are
`not_applicable`; we do not substitute email, phone, IP, or fingerprinting.
The event's frozen first acquisition touch supplies identifiers, including
when later outcomes happen over MCP/API. This does not add cross-device or
view-through attribution. TikTok/Meta can receive the hashed public account ID
without a click ID. No payload includes wallet addresses, private strategy,
prompts, or credentials in URLs.

[TikTok custom web events](https://ads.tiktok.com/resources/help/article/custom-events?lang=en)
currently support reporting but not campaign optimization. Optimize toward
standard `CompleteRegistration` until an appropriate supported objective is
chosen; do not rename free enrollment to a purchase. X requires a developer
app with Ads API access and an authorized Ads Manager account. Set up events
in [X Events Manager](https://docs.x.com/x-ads-api/measurement/web-conversions)
using Lead/Custom types appropriate to these free outcomes.

Google uses the current [Data Manager offline conversion API](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events),
not the legacy Google Ads click-upload endpoint. Enable Data Manager in the
OAuth project; authorize `https://www.googleapis.com/auth/datamanager` with
offline access. Use Website (Import from clicks), type `UPLOAD_CLICKS`, actions
owned by the configured customer. Customer IDs have ten digits without
hyphens; action IDs are numeric. For braided click IDs, do not configure
one-per-click counting, which Google rejects. Complete Google's applicable
account/measurement terms in the Ads UI before activation.

Google receives the affirmative analytics choice as `adUserData =
CONSENT_GRANTED` only when explicitly recorded at event capture. Regional
default permission is `CONSENT_STATUS_UNSPECIFIED`, not a fabricated grant;
Google may reject it according to account defaults and consent requirements.
`adPersonalization` is always `CONSENT_DENIED`. The saved explicit-choice
metadata does not change the regional policy or re-enable a denied account.
Later acceptance never changes an older event's consent snapshot.

All destinations obey the same account-wide permission and withdrawal lock,
including DNT/GPC and MCP/API outcomes. Migration `0168_ad_platform_conversions`
defaults Google/TikTok/X statuses to `suppressed` on existing rows; only newly
captured permitted events become `pending`. Re-enabling tracking never
backfills suppressed events. Missing configuration consumes no attempts; adding
credentials can deliver eligible new rows that were waiting as `unconfigured`.

Google destination identity, TikTok pixel ID, and X pixel/event IDs are
committed before sending. Credential rotation does not redirect pending retries
to new conversion actions. Correct a misconfigured frozen destination only
after confirming whether that event was already accepted by the provider.

### Delivery acknowledgements and retries

- PostHog and Meta retain their existing HTTP acknowledgement behavior.
- TikTok requires HTTP success and response `code = 0`; HTTP 200 with an error
  code is a failed attempt. X requires HTTP success and exactly one
  `data.conversions_processed`, with no errors.
- Google ingestion returns a `requestId`, which is persisted as `processing`,
  not delivered. Its separate diagnostics check starts after 30 minutes,
  backs off by 1.3 to hourly, and stops after 25 checks or the 24-hour window.
  See [Google diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics).
- Only Google's matching-destination `SUCCESS` marks delivery. `FAILED` means
  every record failed and can retry under the five-upload budget. A failed
  status read retains the accepted request and never starts another upload.
  `PARTIAL_SUCCESS` or unresolved processing becomes `review_required`;
  inspect diagnostics for the saved request ID before any manual replay.
- Each attempt preserves the original conversion ID and mutation timestamp.
  These provide the platforms' deduplication keys; provider acceptance and
  attribution are distinct, and network ambiguity cannot establish an
  end-to-end exactly-once guarantee.
- Existing `platform_status` and `platform_attempts` remain Meta-specific.
  Google, TikTok, and X each have their own status, attempt, and error columns.
- Google/TikTok/X errors have separate payload-free columns. Retries never
  expose provider response bodies, access tokens, or refresh tokens in logs.
  `delivered_at` is populated only after PostHog and every applicable ad
  destination has completed (historically suppressed destinations are skipped).

Configure worker credentials only for environments authorized to send real
conversions. Verify each configured platform's event diagnostics with an
explicitly authorized test journey before launching advertisements or spend.

## Campaign reporting

Internal source of truth: `GET /api/admin/campaign-report` (admin permission)
returns campaign totals and creative/landing-variant breakdowns with explicit
`level` fields. Campaign totals include cost per signup, ready-agent owner and
season entrant when campaign spend is supplied from the platform export
(`?spend={"campaign":amount}`). Creative rows contain counts and null costs;
campaign-level spend cannot establish a creative-level cost. Spend is never invented or
stored as revenue; generation/service costs are tracked separately from
advertising spend. PostHog dashboard 2224772 remains the interaction funnel
(spend has no in-repo source and stays platform-side until supplied).
Report platform-reported results separately from internal results: they
differ by consent loss, platform attribution windows, conversion delay
(server events carry the mutation timestamp; platform delivery is async),
duplicate handling (deterministic IDs internally; `event_id` on the
platform), and traffic scope. Browser collection excludes non-production hosts, staff and
private routes; the internal server report includes operational outcomes and
requires admin permission. Configure production delivery tokens only in production.
Returning viewers are identified watchers on days after signup; timezone for
daily returning counts is UTC.

## Watching semantics

The director is sampled every 250 ms. Only visible, playing, advancing samples
count. Pauses, loading waits, seek jumps and browser-sleep gaps are excluded.
`watch_progress` flushes deltas every 30 seconds and on visibility/page exit.
`active_seconds` measures wall time; `new_content_seconds` measures the union of
viewed content intervals per cue in this mounted watch session. Rewatching an
interval adds active time but not new coverage. Playback speed therefore affects
content seconds without multiplying wall time. Sampling conservatively omits cue
boundary intervals and the final partial sample. Browser termination can lose a
last batch. These are engagement estimates, not proof of human attention.

Sum `active_seconds` / 60 for total watch minutes. Sum per `watch_id` before taking
median/percentiles for session duration. Never average individual heartbeat
increments to report average session watch time. Coverage is deduplicated within
a mounted watch session only. `watch_buffer_end_reached` is NOT completion: Werewolf
loads bounded windows and seeking can reach the end. No completion percentage is
claimed without a whole-game playable-duration denominator. Trailers are separate
from this full-game instrumentation and are not included in watch time.

## Funnels

Use ordered funnels, production/web filters, and raw counts alongside percentages.

1. Assisted creation: `agent_creation_opened` → `agent_generation_succeeded` →
   `agent_save_succeeded` (7 days). Also retain the direct opened → saved funnel
   for advanced creation and returning drafts.
2. Influence/Werewolf: `join_opened` → respective join requested → succeeded
   (1 day). Filter the opening event by `game_kind`. Direct create-and-join flows
   can bypass the saved-agent selector; use request → success to cover all entry.
3. Daily Free: `daily_entry_requested` → `daily_entry_succeeded`.
4. Watching: `watch_opened` → `watch_started` → `watch_progress`. Hold `watch_id`
   constant to avoid combining unrelated viewing sessions.
5. Navigation: use PostHog paths from `$pageview` and the explicit events. Web
   Analytics provides entry-page/referrer and campaign exploration.

## Privacy and reliability

No request/response bodies, raw errors, agent text, wallet addresses or emails are
captured. Automatic clicks and surveys
are disabled. SDK-generated URLs, including nested acquisition properties, lose
queries/fragments; referrers retain origin only. The recorder's URL masking hook
also strips credentials, queries and fragments from rrweb metadata and SPA URLs.
DOM session recording on `/agents/create` and `/dashboard` masks all text/inputs
and blocks whole forms, dialogs, iframes, images, video and canvas. Agent editor
and review routes are not recorded. Playback
itself uses explicit events instead of recording media. Review actual masking
with a controlled account before relying on recordings for diagnosis.

Analytics failure never retries or blocks a product mutation. Tests cover private
URL stripping, operation allowlisting, unchanged API outcomes, speed, seeks,
repeat coverage, pauses, stalled clocks and browser sleep.

## Error reports and source maps

Error messages can contain prompts, responses and credentials, so they are
replaced entirely, rather than relying on a list of secret patterns. Only
standard error types, handled/synthetic flags, exception relationships and
same-origin `/_next/static/*.js` frame coordinates survive. Function names,
locals, source snippets, breadcrumbs, custom exception types and derived raw
exception values/fingerprints are removed. Queries and fragments are removed
from frame URLs. Valid chunk/release IDs are retained for source-map resolution.
This trades message detail for privacy; diagnosis uses the original source and
line/column. Error types without app frames may group broadly.

The scope is browser failures, including the app and profile route boundaries.
This does not instrument API/worker/server exceptions or failures before SDK
initialization. Production Next.js server-render errors expose only their generic
browser representation; private server stack traces are not collected here.

Main CI web-image builds use `@posthog/nextjs-config` to generate native Turbopack
debug IDs, upload maps to US project 671431, and attach release `the-house-web`
with the full git SHA. The GitHub Actions repository secret
`POSTHOG_PERSONAL_API_KEY` needs PostHog error-tracking write access. It is passed
only to the web build via a BuildKit secret, never a public env var, build arg,
runtime env or image layer. `POSTHOG_UPLOAD_SOURCEMAPS=1` selects this release-build
step; local and PR preview builds do not upload maps or need the credential.
The PostHog integration handles credential and upload failures normally; there
are no separate secret-presence checks. Upload failure stops the build before image push.
The compiler hook scopes upload and deletion to `<distDir>/static`, the browser
bundles. Server and build-tool chunks are excluded: build-tool chunks can lack
native debug IDs, and this integration does not collect server exceptions.
The web package pins and explicitly selects PostHog CLI 0.18.10; the plugin's
default resolver otherwise selects its webpack dependency's older CLI, which
does not support these native Turbopack IDs.
The plugin deletes browser maps after upload; Docker additionally checks that no static
`.map` files remain before packaging the runtime. Production promotes this same
immutable image, so the uploaded maps match the shipped chunks.

Tests exercise the installed plugin's compiler hook with a fake upload transport:
release IDs and native debug IDs, upload-before-delete, and failing the build on
upload errors. They do not prove production PostHog permissions or symbolication.
After deployment, verify a controlled non-sensitive error from a non-staff account
appears with redacted text and an original-source stack frame, and confirm a
browser request for the corresponding `.map` is not served.

## Release verification

After the code is deployed, use a non-staff account and a tagged public landing
link. In browser network tools, confirm SDK requests use `k.thehouse.game` and
succeed, including static assets and event ingestion. Confirm one entry in
PostHog Activity, anonymous-to-account continuity, creation/join requested and
confirmed outcomes, and watch increments. Pause and
hide the replay to confirm time stops; seek forward and verify coverage does not
jump. Use existing saved agents where possible; do not spend on generation merely
to test analytics. Navigate between public pages, then leave the site and confirm
the final `$pageleave` and previous-page duration. With Web Vitals enabled in the
project, confirm `$web_vitals` arrives. Both SDK events must carry production/web
properties and obey the same exclusions, URL sanitization and opt-out as custom
events. Verify the opt-out stops events. Dashboard empty/sample states
before production collection are not traffic evidence.

## Regional consent (reviewed October 17, 2026)

The banner has one analytics category and equally accessible Accept/Reject
buttons outside the US. The US notice offers Got it and Reject optional tracking;
it is shown once per browser storage lifetime and dismissed on navigation. Its
separate notice-shown marker never grants consent or changes the analytics choice.
On desktop (1024px and wider), the notice spans the bottom edge with its text
and actions side by side to reduce vertical obstruction. Smaller screens retain
the inset, stacked card; both layouts scroll within short viewports.
The banner explains measurement and navigation-diagnosis purposes and
links directly to the analytics section of the Privacy policy, which describes
masked session recordings and shows their status. There is no separate recording
prompt. Ordinary events and recordings share these start conditions:

| Detected location | Before a saved choice | After Accept | After Reject |
| --- | --- | --- | --- |
| United States | Both on | Both on | Both off |
| All other countries or unknown | Both off | Both on | Both off |

This is an explicit reviewed allowlist, not a claim that all other countries
require opt-in. US rules generally distinguish notice/opt-out from sensitive
data, minors, sale, advertising, and other restricted purposes. The US default-on policy includes masked session replay at the owner’s request.
This is a product choice, not a conclusion that every US state exempts session
replay from consent; state interception laws and the actual data captured matter.
Our scope is adult-facing, non-sensitive product
analytics, with PostHog as a service provider. Paid acquisition measurement
(campaign fields and click IDs above) is part of that scope as of this change:
explicit opt-outs, DNT and Global Privacy Control still disable collection,
and no pre-consent queue was added. Reassess before adding sensitive
properties, serving children, or activating platform delivery (Advertising-
platform feedback) — activation sends the mapped conversion events and the
permitted click identifier to the chosen platform under its terms, which is
a distinct sharing decision from first-party measurement.

Sources and limits:
- California AG: https://oag.ca.gov/privacy/ccpa
- Colorado AG: https://coag.gov/resources/colorado-privacy-act/
- Australia APP 3: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information
- UK statistical exemption excludes tracking individual visitors; our identified
  funnels do not rely on it: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/
- France's narrow audience-measurement exemption is not assumed:
  https://www.cnil.fr/fr/node/677
- Australia, Canada and other jurisdictions have not been cleared for default-on collection
  in this implementation. They use consent, not a guessed global exemption.

`/analytics-region` reads Cloudflare's `CF-IPCountry` on requests carrying
`CF-Ray`, and returns only country and policy mode. Both browser and CDN caching
are disabled; this endpoint must never be put behind a cache-everything rule.
Cloudflare proxying and its IP Geolocation setting were verified enabled in the
production dashboard. Actual origin header delivery still needs post-deployment
verification. No IP lookup vendor or browser location permission is used. The
application does not store the IP or country for consent decisions. Cloudflare's
country estimate is not residence and can be affected by VPNs. Missing, malformed,
Tor and unknown values require consent. Direct-origin clients can forge headers;
this is a preference hint, never an authorization or residency proof.

The versioned browser preference persists until changed or browser storage is
cleared. DNT and Global Privacy Control override acceptance. Blocked storage
fails closed. Rejection stops capture/recording and clears SDK persistence;
other tabs receive the storage event. No page reload interrupts unsaved forms.
Temporary route and staff exclusions stop recording and capture in that tab
without writing a shared SDK opt-out preference that would affect other tabs.
No pre-consent event queue is retained. Watch measurement starts only when SDK
capture is active, so accepting cannot backfill earlier viewing. Acquisition and
funnel steps before consent may be missing; report that limitation alongside
conversion rates. The Privacy page always offers the same controls.

Verify US, Australia/EU/UK, missing country, explicit rejection, acceptance, GPC/DNT,
cross-tab rejection, and reload persistence. Test location policy using request
headers locally; production requests must use Cloudflare's actual header.

## Account preference and operational reporting

`user_analytics_preferences` stores the effective account-wide analytics choice.
Missing preferences fail closed for collection/delivery, but are not stored as
an explicit rejection. A later resolved regional preference can initialize them;
already-suppressed events remain suppressed. Browser signup transmits the effective choice
only after regional consent is ready; DNT/GPC override acceptance. Signed-in
browsers synchronize even a rejection with no campaign touch. An existing
account denial survives automatic sync from another tab/device; re-enabling
requires a fresh explicit choice with the current preference version. A delayed
enable retry cannot override a newer withdrawal. MCP/API conversions consult the
same record. Attribution writes also require the current version, so an in-flight
touch from before withdrawal cannot be restored after re-enabling. Initial sync
returns the version; subsequent browser requests supply it.

Events captured without permission have both destinations permanently
`suppressed` and no campaign attribution. Withdrawal suppresses all pending
delivery and clears retained account/browser campaign touches and conversion
attribution. Re-enabling permits future events only. Browser requests are
serialized and bound to the current account; stale responses cannot enable a
new session, and account switching clears the previous account's touches. A
failed sync stops browser tracking; the server change takes effect only when
acknowledged. Browser choice persists locally. Failed synchronization retries with a bounded
backoff (up to 30 seconds), and navigation also resynchronizes it.

Operational account/agent/enrollment records and internal outcome counts remain
available when analytics is off. They do not authorize optional browser histories
or ad attribution. The privacy page discloses this distinction and Meta, Google, TikTok, and X sharing.
Migration 0167 suppresses pre-existing events without recorded permission and
clears their attribution; it preserves all product records and outcome counts.

`GET /api/admin/campaign-report` returns rows with `level: campaign | creative`.
Campaign rows have null creative/landingVariant fields and use campaign spend
for cost calculations. Creative rows retain outcome counts but all spend/cost
fields are null until actual creative-level spend is supported. Never add the
counts of campaign totals to their creative breakdowns. Spend inputs must be
finite, nonnegative amounts. For $100 and 8 signups the campaign cost per signup
is $12.50; creatives with 6 and 2 signups do not each receive $100 of spend.

Regression coverage: `campaign-conversions.test.ts` exercises real PostgreSQL
withdrawal/re-enable, unknown preferences, MCP behavior, independent delivery
retries, signup write failure/recovery, and campaign/creative totals.
`campaign-consent-sync.test.tsx` exercises the real React component with delayed
transport responses, withdrawal during an allow request, and account switching.
`analytics-consent.test.ts` covers regional policy, GPC, cross-tab withdrawal and
browser attribution clearing. No live provider delivery is required for tests.
