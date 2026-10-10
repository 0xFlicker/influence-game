---
title: Saved wheel transition for top-level navigation
type: ideation
status: saved-not-active
date: 2026-09-30
---

# Saved wheel transition for top-level navigation

The user removed this effect from Werewolf's Overview / Production / Costs / Activity tabs: they sit three navigation levels deep. Keep those sections as immediate prepared swaps. Consider the wheel for a future top-level left/right swipe; this note does not enable it on any current route or add swipe handling.

The working implementation is preserved in commit `d13df468`, in `packages/web/src/app/admin/werewolf/workspace.tsx`, its CSS module, and `packages/web/src/hooks/use-live-reduced-motion.ts`. The relevant implementation is copied below so the effect can be revisited without leaving unused runtime code.

## Effect recipe

- Prepare the destination first; the existing view stays visible during reads.
- Use a 220 ms ease-out arc: 14 px translation, 1.5° rotation, transform origin `50% 130vh`.
- Keep one live React owner. The outgoing layer is a temporary inert, aria-hidden DOM copy with IDs removed.
- Reveal the incoming pane using an opaque clipped wipe; don't crossfade overlapping paragraph text.
- Cancel prior motion on interruption, access loss, unmount or a live reduced-motion change. Reduced motion uses an immediate prepared swap.
- Clip only while animating, keep resting focus outlines/menus visible, and scope gestures to the eventual top-level interaction. Gesture thresholds, touch/scroll arbitration and navigation semantics remain future design work.

### Outgoing layer (original workspace context)

```tsx
  function clearExit() { overlay.current?.replaceChildren(); }
  function captureExit(next: Section) {
    session.set(`${scrollKey}${displayed}`, window.scrollY);
    clearExit();
    if (reduceMotion || !pane.current || !overlay.current) return;
    const copy = pane.current.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-workspace-section");
    copy.inert = true; copy.setAttribute("aria-hidden", "true");
    copy.removeAttribute("id"); copy.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    overlay.current.append(copy);
    const direction = sections.indexOf(next) > sections.indexOf(displayed) ? 1 : -1;
    const animation = copy.animate([{ clipPath: "inset(0 0 0 0)", transform: "rotate(0deg)" }, { clipPath: direction > 0 ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)", transform: `translateX(${-direction * 14}px) rotate(${-direction * 1.5}deg)` }], { duration: 220, easing: "ease-out" });
    animation.onfinish = () => copy.remove();
  }
```

### Incoming layer

```tsx
const direction = sections.indexOf(displayed) > sections.indexOf(previous.current) ? 1 : -1;
if (!reduceMotion) pane.current?.animate([
  { transform: `translateX(${direction * 14}px) rotate(${direction * 1.5}deg)` },
  { transform: "none" },
], { duration: 220, easing: "ease-out" });
```

```css
.stage { position: relative; isolation: isolate; overflow: clip; min-height: 240px; padding: 4px; margin: -4px; }
.content { transform-origin: 50% 130vh; position: relative; background: #08090b; }
.exitLayer { position: absolute; inset: 4px; pointer-events: none; z-index: 2; overflow: hidden; }
.exitLayer > div { transform-origin: 50% 130vh; background: #08090b; }
```

### Live motion preference

```tsx
"use client";
import { useSyncExternalStore } from "react";
const query = "(prefers-reduced-motion: reduce)";
function subscribe(changed: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
/** The installed Motion hook snapshots at mount; admin transitions also honor live changes. */
export function useLiveReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
```

The previous browser evidence proved prepared-navigation continuity, not suitability for every navigation depth. User feedback determines placement: the Werewolf workspace now keeps the continuity without this animation.
