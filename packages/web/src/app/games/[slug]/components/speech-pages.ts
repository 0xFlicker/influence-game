import {normalizeAudioDelivery} from "@influence/engine/audio-delivery";

/** Split measured prose without rewriting it. Every character belongs to one page. */
export function paginateSpeech(text: string, fits: (text: string) => boolean): string[] {
  if (!text || fits(text)) return [text];
  const tokens = text.match(/\S+\s*|\s+/gu) ?? [text];
  const pages: string[] = [];
  let start = 0;
  while (start < tokens.length) {
    let low = start + 1, high = tokens.length, end = start;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(tokens.slice(start, mid).join(''))) { end = mid; low = mid + 1; }
      else high = mid - 1;
    }
    if (end === start) {
      // A single unbroken word can itself exceed the frame.
      const characters = Array.from(tokens[start]);
      let length = 1;
      while (length < characters.length && fits(characters.slice(0, length + 1).join(''))) length++;
      pages.push(characters.slice(0, length).join(''));
      tokens[start] = characters.slice(length).join('');
      if (!tokens[start]) start++;
      continue;
    }
    if (end < tokens.length) {
      for (let i = end; i > start; i--) {
        if (/[.!?]["'”’)]*\s*$/u.test(tokens[i - 1])) { end = i; break; }
      }
    }
    pages.push(tokens.slice(start, end).join(''));
    start = end;
  }
  return pages;
}

export function speechPageIndex(pages: readonly string[], progress: number): number {
  const starts = speechPageStarts(pages);
  const position = Math.max(0, Math.min(1, progress));
  return Math.max(0, starts.findLastIndex(start => start <= position));
}

/** The same word-weighted boundaries serve rendering and manual navigation. */
export function speechPageStarts(pages: readonly string[]): number[] {
  const weights = pages.map(page => Math.max(1, page.trim().split(/\s+/u).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let position = 0;
  return weights.map(weight => {const start = position / total; position += weight; return start;});
}

/** Clean a historical page without changing frozen pagination or audio offsets.
 * Normalize the whole source so tags split across page boundaries also disappear.
 */
export function cleanSpeechPage(pages: readonly string[], index: number): string {
  const start = pages.slice(0, index).reduce((length, page) => length + page.length, 0);
  const end = start + (pages[index]?.length ?? 0);
  const source = pages.join("");
  return normalizeAudioDelivery(source).sourceMap.map(span => {
    const from = Math.max(start, span.sourceStart), to = Math.min(end, span.sourceEnd);
    return from < to ? source.slice(from, to) : "";
  }).join("");
}
