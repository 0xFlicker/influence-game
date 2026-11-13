---
title: Independent product and advertising preferences
module: campaign-conversions
tags: [analytics, consent, advertising, attribution]
problem_type: architecture_pattern
date: 2026-11-12
---

Product analytics and advertising measurement use separate permissions. Neither
permission implies the other. Regional defaults and browser privacy overrides
remain in `analytics-policy.ts`; legacy rejection covers both purposes, while
legacy PostHog acceptance is not affirmative advertising consent.

Conversion outcomes and deterministic IDs are operational records. Permission
controls destination eligibility, not whether a successful mutation happened.
PostHog follows analytics; Meta, Google, TikTok and X follow advertising. Capture,
withdrawal and delivery share the account row lock. Withdrawal permanently
suppresses unfinished deliveries for its purpose; re-enabling affects new events.
Google's affirmative grant comes only from advertising-choice metadata.

Campaign attribution supports either permitted measurement purpose. Clear shared
attribution when both are off, and advertising-only browser metadata when ads
are off. Keep browser acquisition independent of PostHog initialization so
advertising-only visits survive redirects and sign-in.

Migration 0173 preserves old refusals, treats old acceptance as unknown for ads,
and suppresses pre-disclosure queued ad delivery. It does not alter legal
agreement versions or product outcomes. See `docs/product-analytics.md` for the
full contract and verification guidance.

## Preference surface layout

Scope the banner’s wide-screen columns to the banner itself. The Privacy page
renders this same component inside a narrow prose column even on a wide viewport;
a fixed desktop action column there can crush the copy and checkbox labels.
Keep purpose choices and supporting links together, preserve equal visual weight
for all three actions, and test expanded details as well as the collapsed bar.
Native checkbox semantics, an explicitly labelled group, disclosure state and
keyboard access belong to the shared component. Keep the persistent preferences
entry in the site footer, linking to `/privacy#analytics`, rather than overlaying
page content with a floating button.
