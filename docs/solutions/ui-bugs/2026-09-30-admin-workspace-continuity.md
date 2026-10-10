---
module: House administration
date: 2026-09-30
problem_type: ui_bug
component: frontend
symptoms:
  - Game content disappears while changing admin sections
  - Navigation loses production request identity and image review drafts
  - Late responses can restore denied data or expire a newer login
root_cause: design_gap
resolution_type: code_fix
tags: [admin, werewolf, navigation, query-cache, authorization, reduced-motion, production]
---

# Preserve ownership before animating administration

**Placement update:** user feedback removed the wheel from the third-level Werewolf tabs. Those sections now swap prepared content immediately. The [effect and source are saved](../../ideation/2026-09-30-top-level-wheel-transition.md) for a possible top-level swipe; the motion discussion below records the earlier experiment.

The persistent admin layout owns the authenticated `AdminSession`; the persistent Werewolf game layout owns the visible section. Root QueryClient keys include account/auth generation and resource URL. Exact request endpoint/body and draft source/revision live outside leaf components. Unmounting a section closes its modal and effects without losing permitted recovery state.

Prepare ordinary section navigation before pushing history. Keep the old URL/content on preparation failure. History navigation has already changed the URL, so explicitly label retained content and settle to the target or its error. An increasing intent counter prevents slow old destinations from winning. Keep one React section owner; an inert, aria-hidden DOM image is sufficient for the brief exit animation.

An accepted POST is not proof that a subsequent inventory GET contains its receipt. Keep dependent actions locked until the returned job/version/publication appears. Otherwise a fast review → publish click can submit an older version. An unknown response retains the exact original request identity. Reconciliation without idempotency requires a server receipt read before explicit resubmission.

Access loss needs both cancellation and a completion fence. Scope Production denial separately from game visibility, remove private images/dialogs as well as query data, and clear drafts/operations on session loss. The API wrapper also checks the captured token and auth generation before dispatching `auth:expired`; query cleanup alone cannot stop an old 401 from expiring a newer login.

Use a live `matchMedia` subscription for runtime reduced-motion changes. The installed Motion hook did not react during the browser test. Cancel in-progress spatial animation when the preference changes. Avoid alpha-crossfading dense paragraph layers: the resulting doubled text is distracting. The final 220 ms arc uses an opaque clipped wipe inside stationary navigation.

Evidence and limitations: [A1 implementation record](../../plans/2026-09-30-002-refactor-admin-continuity-and-production-studio.md#implementation-and-local-validation--2026-09-30). Browser recordings verify prepared transitions and detected revocation; no equivalent before/after CPU benchmark or complete cross-account browser matrix was produced.
