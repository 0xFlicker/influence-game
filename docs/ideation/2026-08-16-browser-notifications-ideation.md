# Influence Browser Notifications Ideation

**Status:** Working product direction, not requirements or an implementation plan  
**Captured:** 2026-08-16

## Context

The production blue-green release work is already in flight and remains a separate effort. This direction introduces browser notifications as retention infrastructure, beginning with game results and activation of the existing review feature.

## Product problem

Players have little reason to return after leaving a game. The existing review feature has effectively no adoption outside the operator. Notifications should create useful reasons to return rather than acting as generic marketing blasts.

## Notification foundation

- Put account-level preferences under **Profile / Settings / Notifications**.
- Store push subscriptions per account and browser/device rather than treating one account as one endpoint.
- Show the permission state and allow users to remove obsolete device subscriptions.
- Keep category preferences separate from device subscriptions so a user can control what is sent without losing every registered browser.
- Never trigger the browser permission dialog on page load or without an explicit user action.

## Permission invitation

Use an in-app invitation before invoking the browser's native permission UI.

- **New players:** after entering their first game, offer: “Want to know how it ends? Enable game-result notifications.”
- **Returning players:** an authenticated player with game history and no active push subscription sees a one-time in-app invitation on their next visit.
- Selecting **Enable** invokes the browser permission request.
- Selecting **Not now** snoozes the in-app invitation for 30 days. Notification Settings remains available throughout the snooze.
- A browser-level denial is respected. The application does not automatically invoke the native prompt again.

## First notification categories

### Game results

- A winner who opted into results receives an explicit, celebratory **You won** notification. This is intentionally a spoiler because the preference clearly promises the result and winners are already announced through public Daily Dispatch content.
- Other participating players can receive a neutral **Your game finished** notification.
- Result notifications deep-link to the completed game and its result/replay experience.

### Review reminders

- After a player has completed three games and has no review activity, send a reminder that deep-links directly into the existing review flow.
- This is a targeted activation experiment, not the entire notification architecture.

## Product measures worth watching

- in-app invitation acceptance and dismissal;
- native permission grant and denial;
- valid subscription count and delivery success;
- notification click-through by category;
- review starts and completions attributable to reminders;
- return rate after game-result notifications.

## Questions for requirements and planning

- Which result events should non-winners receive: elimination, final completion, or both?
- What account and authentication boundary is required before registering a device?
- What preference defaults apply after permission is granted?
- How should expired and invalid subscriptions be pruned?
- What rate limits, deduplication keys, and delivery receipts are required?
- What exact review state counts as “no review activity” for the three-game reminder?

