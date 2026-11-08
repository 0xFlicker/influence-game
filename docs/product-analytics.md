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
(`POST /api/attribution/retain`, plus the signup request payload). First touch
is never overwritten; a direct visit never replaces the last non-direct touch.
The acquisition window is 90 days before signup. Reporting uses first touch
for acquisition and last-non-direct for assist analysis; the two are never
blended. Missing attribution is reported as `unknown` — identity is never
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

Acquisition counts unique new accounts reaching each outcome. Enrollment
(`season_entry`) is not placement (`game_placed`), and returning viewing is
measured by identified `watch_*` events on days after signup together with
`owner_returned`; no server watch event is claimed.

Delivery: a worker delivers pending rows to PostHog capture and, when
configured, to the advertising platform (next section), recording status,
attempts and the last error on the row. Delivery failure never blocks or
rolls back a product mutation.

## Advertising-platform feedback

No advertising platform is configured today: there is no pixel, tag or CAPI
credential in the repository or Doppler inventory, and no platform SDK is
installed. The prepared Meta Conversions API adapter in
`campaign-conversions.ts` activates only when `META_PIXEL_ID` and
`META_CAPI_ACCESS_TOKEN` are set; rows then record `platform_status =
delivered`, otherwise `unconfigured` — unconfigured delivery is never
reported as operational. Mapping: `signup_completed` → `CompleteRegistration`,
`agent_ready` → `AgentReady`, `season_entry` → `SeasonEntry`, deduplicated by
`event_id` = the deterministic conversion ID, with the retained `fbclid`
sent as the click identifier when present. Intermediate steps are observed
internally and are not sent as equal-value platform conversions. Free season
enrollment is never labelled a purchase and no revenue value is invented;
the bidding objective stays a business choice separate from these success
metrics. Google/TikTok delivery is not implemented and needs a platform
decision plus credentials before any launch. Required setup: choose the
launch platform(s), create the pixel/dataset, set the two env vars in
Doppler, and complete the privacy reassessment below. Do not launch
advertisements or spend without separate authorization.

## Campaign reporting

Internal source of truth: `GET /api/admin/campaign-report` (admin permission)
groups authoritative conversions by campaign, creative and landing variant:
new accounts → ready agents → unique season entrants, with cost per signup,
ready agent and season entrant when spend is supplied by the caller from the
platform export (`?spend={"campaign":amount}`). Spend is never invented or
stored as revenue; generation/service costs are tracked separately from
advertising spend. PostHog dashboard 2224772 remains the interaction funnel
(spend has no in-repo source and stays platform-side until supplied).
Report platform-reported results separately from internal results: they
differ by consent loss, attribution window (90 days, UTC), conversion delay
(server events carry the mutation timestamp; platform delivery is async),
duplicate handling (deterministic IDs internally; `event_id` on the
platform), and internal/test-traffic exclusion (production hostname, staff
and private-route exclusions, plus the admin-only internal report).
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
