# House game visibility — implementation verification

Date: 2026-10-02. Checkout: `codex/werewolf`, `/Users/user/.codex/worktrees/werewolf/influence-game`.

## Delivered

Both games accept Public (default) or Unlisted. Unlisted means anyone with the link can watch; it is excluded from general discovery, public profile game activity and public season receipt aggregates. Personal/operator contexts remain separately scoped. Invalid values, including explicit null and retired Private, are rejected at creation and fail closed in ordinary stored-game reads. Missing historical fields keep the established Public default.

Removed the Private selector, collection and account-dependent identity retry. Werewolf lobby and direct creation both persist the same setting. The House identity supplies visibility to subtree robots metadata. Hidden games are rejected by ordinary detail/media reads and new stream admission; delivery rechecks close existing Influence streams. Serialized checks preserve publication/snapshot ordering. Werewolf retains its polling error path, which clears buffered playback after denial.

No gameplay, Mystery/Omniscient spoiler boundary, publication choice, privileged evidence permission, management permission or frozen character ownership rule changed.

## Evidence

| Check | Result |
| --- | --- |
| Provider-free baseline | 2,205 pass, 5 skip, 0 fail |
| Full isolated PostgreSQL baseline | 1,827 pass, 0 fail |
| Final focused API regressions | 124 pass, 0 fail; includes stream ordering |
| Type checks and lint | Pass |
| Anonymous Unlisted Werewolf browser journey | Pass: entry, noindex, discovery exclusion, audience validation, replay and shared source cursor |
| Unlisted results image in browser | Pass: actual image bytes loaded signed out, signed in and after sign-out; hidden game removed image access |
| Both creation forms in browser | Pass: desktop/mobile layout, Public/Unlisted selector, persisted Unlisted and signed-out casting access |

Browser fixtures use isolated databases, local API/web children and fake credentials with a mocked runner. No paid generation, staging writes, publishing or deployment was performed. The broader unrelated browser suite was not run. Local screenshots are `/tmp/visibility-{influence,werewolf}-{desktop,mobile}.png` and `/tmp/house-werewolf-entry-{desktop,mobile}.png`.

## Review notes

- Discovery filtering happens in SQL before the Werewolf 100-row limit and public aggregates. A regression inserts 101 earlier Unlisted games per kind and confirms the public row remains available.
- Explicit JSON null differs from an absent field; the SQL and runtime validators agree.
- Existing hidden-game tests previously expected successful detail reads; those assertions now require 404.
- Private reasoning/event scopes remain untouched: they are not game visibility.
- The image journey caught an existing integration regression: no results route mounted `GameBanner`. Restored its mount inside the completed results panel and reran the real browser journey successfully.
- Browser-generated Next.js configuration changes are reverted after harness execution.
- Local retired records are inventoried in the plan and were not changed. Explicit conversion to Unlisted is proposed separately.

## Integration learning

Keep game visibility in one small House-level contract. Discovery and direct-link availability are separate questions. Apply discovery at query boundaries and direct-read checks at every content entry, including media and live delivery. Game adapters own audience and publication semantics; they do not need separate game-visibility policy or membership lookup. A future third game should reuse these predicates and the common selector.
