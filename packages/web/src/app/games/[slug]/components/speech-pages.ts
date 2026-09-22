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
  const weights = pages.map((page) => Math.max(1, page.trim().split(/\s+/u).length));
  const position = Math.max(0, Math.min(1, progress)) * weights.reduce((a, b) => a + b, 0);
  let end = 0;
  for (let i = 0; i < weights.length; i++) { end += weights[i]; if (position < end) return i; }
  return Math.max(0, pages.length - 1);
}
