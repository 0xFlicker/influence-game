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
  allowlisted `utm_source`, `utm_medium`, `utm_campaign`.
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
MCP activity and actual participation are not inferred from browser joining.
Daily Free acceptance is queue entry, not proof of seating in a match.

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
Missing credentials or upload failures fail the release build before image push.
The plugin deletes maps after upload; Docker additionally checks that no static
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
link. Confirm one entry in PostHog Activity, anonymous-to-account continuity,
creation/join requested and confirmed outcomes, and watch increments. Pause and
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
analytics, with PostHog as a service provider, not sale or cross-site advertising.
Reassess before adding sensitive properties, advertising, or serving children.

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
