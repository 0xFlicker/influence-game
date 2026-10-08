import { cubicBezier, easeInOut, easeOut } from "motion";
import type { PresentationCue } from "./types";

type Ease = "easeInOut" | "easeOut" | [number, number, number, number];
interface Entrance {
  element: HTMLElement;
  keyframes: {
    opacity: number[];
    y?: number[];
    scale?: number[];
    rotateY?: number[];
  };
  options: { duration: number; delay: number; ease: Ease };
}

/** One entrance definition for the browser's controls and offline frame sampling. */
export function presentationEntrances(
  root: HTMLElement,
  cue: PresentationCue | null,
  reduced: boolean,
  entering: boolean,
): Entrance[] {
  if (!entering) return [];
  const entrances: Entrance[] = [];
  root
    .querySelectorAll<HTMLElement>("[data-two-names-reveal]")
    .forEach((element) => {
      const index = Number(element.dataset.dossierIndex ?? 0);
      const dossier = element.dataset.twoNamesReveal === "dossier";
      entrances.push({
        element,
        keyframes: reduced
          ? { opacity: [0, 1] }
          : {
              opacity: [0, 1],
              y: [18, 0],
              rotateY: [dossier ? (index === 0 ? -22 : 22) : 0, 0],
            },
        options: {
          duration: reduced ? 0.2 : 0.8,
          delay: dossier && !reduced ? index * 0.18 : 0,
          ease: [0.16, 1, 0.3, 1],
        },
      });
    });
  if (
    reduced ||
    cue?.source !== "format" ||
    cue.kind !== "safety_bounce_pointer"
  )
    return entrances;
  const candidates = root.querySelectorAll<HTMLElement>(
    '[data-pointer-cycle-candidate="true"]',
  );
  candidates.forEach((element, index) =>
    entrances.push({
      element,
      keyframes: { opacity: [0.2, 1, 0.28], scale: [0.97, 1.04, 1] },
      options: { delay: index * 0.2, duration: 0.32, ease: "easeInOut" },
    }),
  );
  const delay = candidates.length * 0.2;
  const classified = Array.from(
    root.querySelectorAll<HTMLElement>("[data-board-member]"),
  ).find((element) => element.dataset.boardMember === cue.targetId);
  const accepted = Array.from(
    root.querySelectorAll<HTMLElement>("[data-accepted-target]"),
  ).find((element) => element.dataset.acceptedTarget === cue.targetId);
  if (classified)
    entrances.push({
      element: classified,
      keyframes: { opacity: [0.35, 1], y: [20, 0], scale: [0.96, 1] },
      options: { delay, duration: 0.38, ease: "easeOut" },
    });
  if (accepted)
    entrances.push({
      element: accepted,
      keyframes: { opacity: [0.45, 1], scale: [0.985, 1] },
      options: { delay, duration: 0.35, ease: "easeOut" },
    });
  return entrances;
}

export function samplePresentationEntrances(
  root: HTMLElement,
  cue: PresentationCue | null,
  elapsedMs: number,
  reduced: boolean,
) {
  for (const { element, keyframes, options } of presentationEntrances(
    root,
    cue,
    reduced,
    true,
  )) {
    const progress = Math.max(
      0,
      Math.min(1, (elapsedMs / 1000 - options.delay) / options.duration),
    );
    const ease = Array.isArray(options.ease)
      ? cubicBezier(...options.ease)
      : options.ease === "easeInOut"
        ? easeInOut
        : easeOut;
    const sample = (values: number[]) => {
      const position = progress * (values.length - 1),
        index = Math.min(values.length - 2, Math.floor(position));
      return (
        values[index]! +
        (values[index + 1]! - values[index]!) * ease(position - index)
      );
    };
    element.style.opacity = String(sample(keyframes.opacity));
    element.style.transform = [
      keyframes.y ? `translateY(${sample(keyframes.y)}px)` : "",
      keyframes.scale ? `scale(${sample(keyframes.scale)})` : "",
      keyframes.rotateY ? `rotateY(${sample(keyframes.rotateY)}deg)` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
}
