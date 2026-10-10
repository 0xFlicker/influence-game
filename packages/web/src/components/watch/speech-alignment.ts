export interface AlignedSpan {
  textStart: number;
  textEnd: number;
  startMs: number;
  endMs: number;
}
/** Page boundaries must not split a supplied timed span. Supply word-level spans for long dialogue. */
export function alignedPage(
  pages: readonly string[],
  text: string,
  spans: readonly AlignedSpan[],
  elapsedMs: number,
): number {
  let offset = 0,
    page = 0;
  for (const [index, copy] of pages.entries()) {
    const start = text.indexOf(copy, offset);
    if (start < 0)
      throw new Error("Speech pagination does not match aligned text");
    const end = start + copy.length;
    const matching = spans.filter(
      (span) => span.textStart < end && span.textEnd > start,
    );
    if (!matching.length) throw new Error("Speech page has no alignment");
    if (
      matching.some(
        (span) =>
          (span.textStart < start &&
            text.slice(span.textStart, start).trim()) ||
          (span.textEnd > end && text.slice(end, span.textEnd).trim()),
      )
    )
      throw new Error(
        "Speech alignment crosses a page boundary; supply smaller timed spans",
      );
    if (elapsedMs >= matching[0]!.startMs) page = index;
    offset = end;
  }
  return page;
}
