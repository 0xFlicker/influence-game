---
title: Preserve social players behind short links
date: 2026-10-22
module: House sharing
tags: [sharing, replay, farcaster, player-card, rate-limits]
problem_type: integration_issue
---

# Short links must retain both preview metadata and replay coordinates

Long replay URLs carry cue-local time, speed, thinking, music and audience settings.
Replacing them with generic redirects can lose card discovery or return users to
the wrong moment. Farcaster also merges query parameters from a cast URL into its
action URL, so trusting those parameters would weaken an immutable short link.

Store only validated same-app route coordinates under an immutable random code.
Serve the original card metadata directly in the short page's initial HTML head;
send browsers to the full saved route and X players to the existing anonymous
iframe. Farcaster launches the short resolver, which accepts only its `app=mini`
context hint and restores the frozen settings. Use one snapshot from the Share
click, including across failed creation retries.

Live and completed viewers share the same replay coordinates. Validate a live
moment at creation and resolution against the same game and audience rules.
Pass an explicit Influence sequence to the player even when newer events are
available. Completion requires no update to the saved destination.

Signup campaign links are issued by campaign operators. They forward validated
acquisition parameters to the chosen landing page. Keep that query handling
scoped to campaign links so ordinary shares still restore their saved settings.

Native sharing needs a fresh user gesture after asynchronous link creation. Keep
the prepared URL in a small dialog with native-share and copy actions. Creation
limits belong in shared database admission, while preview/resolution reads remain
outside that allowance. Do not trust spoofable forwarding headers for abuse keys.

Account ownership deduplicates by sharer and saved route. Keep the analytics UUID
separate from the navigation code, since an unlisted replay can be link-accessible.
Only the consented browser navigation records the open. A preview can resolve
metadata repeatedly without changing any count.

See [House sharing](../../house-sharing.md) for the contract and validation scope.
