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

Native sharing needs a fresh user gesture after asynchronous link creation. Keep
the prepared URL in a small dialog with native-share and copy actions. Creation
limits belong in shared database admission, while preview/resolution reads remain
outside that allowance. Do not trust spoofable forwarding headers for abuse keys.

See [House sharing](../../house-sharing.md) for the contract and validation scope.
