import {paginateSpeech} from "@/app/games/[slug]/components/speech-pages";

export interface BubbleTypography {
  width: number; height: number; fontSize: number; lineHeight: number; pages: string[]; footerHeight: number; headerHeight: number;
}
export interface BubbleBudget {width: number; height: number; chrome: number; padding: number; maxFont: number; minFont: number}
export type MeasureBubbleText = (text: string, width: number, fontSize: number) => number;

/** Choose type and one frame for the entire message, never for its current page. */
export function fitBubbleText(text: string, budget: BubbleBudget, measure: MeasureBubbleText): BubbleTypography {
  const {width, height, chrome, padding, maxFont, minFont} = budget;
  const lineHeight = 1.4;
  let fittedWidth = width;
  let contentWidth = Math.max(1, width - padding * 2 - 2);
  const room = Math.max(1, height - chrome);
  let fontSize = maxFont;
  while (fontSize > minFont && measure(text, contentWidth, fontSize) > room) fontSize--;
  const naturalHeight = measure(text, contentWidth, fontSize);
  // A brief reply should not look like a full-width banner. Keep enough width
  // for the speaker label, and preserve the chosen line count while tightening.
  if (naturalHeight <= room && naturalHeight <= fontSize * lineHeight * 2 + .5 && width > 240) {
    let low = 240, high = Math.floor(width);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (measure(text, Math.max(1, mid - padding * 2 - 2), fontSize) <= naturalHeight + .5) high = mid;
      else low = mid + 1;
    }
    fittedWidth = low; contentWidth = Math.max(1, fittedWidth - padding * 2 - 2);
  }
  const multipage = measure(text, contentWidth, fontSize) > room;
  const footer = multipage && room >= fontSize * lineHeight + 22 ? 22 : 0;
  const pages = paginateSpeech(text, page => measure(page, contentWidth, fontSize) <= Math.max(1, room - footer));
  const tallest = Math.max(...pages.map(page => measure(page, contentWidth, fontSize)));
  return {width:fittedWidth, height: Math.min(height, Math.ceil(tallest + chrome + footer)), fontSize, lineHeight, pages, footerHeight:footer, headerHeight:chrome - padding * 2 - 2};
}
