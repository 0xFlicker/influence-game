export const DRAMATIC_ADVANCE_SUPPRESS_SELECTOR = [
  "[data-replay-controls]",
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
].join(", ");

export function shouldSuppressDramaticAdvance(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest(DRAMATIC_ADVANCE_SUPPRESS_SELECTOR) !== null;
}
