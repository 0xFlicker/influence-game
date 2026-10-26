/** Provider delivery markup only. Never use this parser to infer game facts.
 * Vocabulary checked against https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
 * on 2026-10-24. Bump the version when normalization or the vocabulary changes.
 */
export const AUDIO_DELIVERY_VERSION = 1;
export const AUDIO_WRAPPING_TAGS = [
  "soft", "whisper", "loud", "build-intensity", "decrease-intensity",
  "higher-pitch", "lower-pitch", "slow", "fast", "sing-song", "singing", "emphasis",
] as const;
export const AUDIO_INLINE_TAGS = [
  "pause", "long-pause", "hum-tune", "laugh", "chuckle", "giggle", "cry",
  "tsk", "tongue-click", "lip-smack", "breath", "inhale", "exhale", "sigh",
] as const;
export type AudioWrappingTag = typeof AUDIO_WRAPPING_TAGS[number];
export type AudioInlineTag = typeof AUDIO_INLINE_TAGS[number];
export type AudioDeliveryContext = "speech" | "night-speech" | "thinking" | "night-thinking";

/** Explicit schema-owned field paths; * visits array items only, never arbitrary object keys. */
export interface AudioDeliveryPolicy { fields: readonly string[]; nighttime: boolean }
export interface AcceptedAudioDelivery {
  version: typeof AUDIO_DELIVERY_VERSION;
  fields: Array<{ path: string[]; delivery: CompiledAudioDelivery }>;
}

/** Clean only declared presentation fields. IDs, targets and other decision
 * fields remain untouched and subject to the original exact schema validation.
 */
export function normalizeAudioPayload(value: unknown, policy: AudioDeliveryPolicy): {
  value: unknown; audioDelivery: AcceptedAudioDelivery;
} {
  const result: AcceptedAudioDelivery = { version: AUDIO_DELIVERY_VERSION, fields: [] };
  const visit = (node: unknown, segments: readonly string[], path: string[]): unknown => {
    const [segment, ...remaining] = segments;
    if (segment === undefined) {
      if (typeof node !== "string") return node;
      const thinking = path.at(-1) === "thinking";
      const context = thinking ? policy.nighttime ? "night-thinking" : "thinking"
        : policy.nighttime ? "night-speech" : "speech";
      const delivery = compileAudioDelivery(node, context);
      result.fields.push({ path, delivery });
      return delivery.cleanText;
    }
    if (segment === "*") return Array.isArray(node)
      ? node.map((item, index) => visit(item, remaining, [...path, String(index)])) : node;
    if (!node || typeof node !== "object" || Array.isArray(node) || !Object.hasOwn(node, segment)) return node;
    const record = node as Record<string, unknown>;
    return { ...record, [segment]: visit(record[segment], remaining, [...path, segment]) };
  };
  let clean = value;
  for (const field of policy.fields) clean = visit(clean, field.split("."), []);
  return { value: clean, audioDelivery: result };
}

/** All offsets are UTF-16 code units, matching JS strings and existing alignment contracts. */
export interface AudioTextSpan {
  sourceStart: number;
  sourceEnd: number;
  textStart: number;
  textEnd: number;
}
export type AudioDeliveryAnnotation =
  | { kind: "wrap"; tag: AudioWrappingTag; textStart: number; textEnd: number }
  | { kind: "inline"; tag: AudioInlineTag; textStart: number };
export interface AudioDeliveryDiagnostic {
  code: "malformed-control" | "unmatched-control" | "crossed-control" | "empty-wrapper" | "duplicate-wrapper";
  sourceStart: number;
  sourceEnd: number;
}
/** Private production document: persist in a bucket, not an inline database body.
 * Only cleanText belongs in presentation or subsequent contestant context.
 */
export interface AudioDeliveryDocument {
  version: typeof AUDIO_DELIVERY_VERSION;
  sourceText: string;
  cleanText: string;
  sourceMap: AudioTextSpan[];
  annotations: AudioDeliveryAnnotation[];
  diagnostics: AudioDeliveryDiagnostic[];
  taggedText: string;
}

const wrapping = new Set<string>(AUDIO_WRAPPING_TAGS);
const inline = new Set<string>(AUDIO_INLINE_TAGS);
type Token = {
  kind: "open" | "close" | "inline";
  tag: AudioWrappingTag | AudioInlineTag;
  sourceStart: number;
  sourceEnd: number;
  textStart: number;
  nonWhitespaceLength: number;
  pair?: number;
  keep: boolean;
};
type Piece = { text: string } | { token: number };

/** Tolerant, iterative normalization. Broken delivery controls are diagnostics,
 * never structured-decision failures. Unknown bracketed prose is left literal.
 * No trimming, whitespace collapsing, punctuation rewriting or HTML decoding.
 */
export function normalizeAudioDelivery(sourceText: string): AudioDeliveryDocument {
  const diagnostics: AudioDeliveryDiagnostic[] = [];
  const sourceMap: AudioTextSpan[] = [];
  const tokens: Token[] = [];
  const pieces: Piece[] = [];
  const text: string[] = [];
  let textLength = 0;
  let nonWhitespaceLength = 0;
  let cursor = 0;
  const append = (start: number, end: number) => {
    if (start === end) return;
    const value = sourceText.slice(start, end);
    text.push(value);
    pieces.push({ text: value });
    sourceMap.push({ sourceStart: start, sourceEnd: end, textStart: textLength, textEnd: textLength + value.length });
    textLength += value.length;
    nonWhitespaceLength += value.replace(/\s/gu, "").length;
  };
  const diagnose = (token: Pick<Token, "sourceStart" | "sourceEnd">, code: AudioDeliveryDiagnostic["code"]) => {
    diagnostics.push({ code, sourceStart: token.sourceStart, sourceEnd: token.sourceEnd });
  };
  // Unknown prose stays literal; recognized controls with attributes or a
  // missing final delimiter are inert. Never eat words after an unfinished tag.
  const candidates = /<\/?([a-zA-Z][a-zA-Z-]*)(?:\s+[^<>]*|\s*\/)?\s*>|\[\/?([a-zA-Z][a-zA-Z-]*)(?:\s+[^\[\]]*)?\]|<\/?([a-zA-Z][a-zA-Z-]*)$|\[\/?([a-zA-Z][a-zA-Z-]*)$/gu;
  for (const match of sourceText.matchAll(candidates)) {
    const raw = match[0];
    const name = (match[1] ?? match[2] ?? match[3] ?? match[4])!;
    const tag = name.toLowerCase();
    const isWrapper = wrapping.has(tag);
    const isInline = inline.has(tag);
    if (!isWrapper && !isInline) continue;
    append(cursor, match.index);
    cursor = match.index + raw.length;
    const closing = raw.startsWith("</");
    const expected = isInline ? `[${tag}]` : `<${closing ? "/" : ""}${tag}>`;
    const token: Token = {
      kind: isInline ? "inline" : closing ? "close" : "open",
      tag: tag as AudioWrappingTag | AudioInlineTag,
      sourceStart: match.index, sourceEnd: cursor, textStart: textLength, nonWhitespaceLength,
      keep: raw === expected,
    };
    if (!token.keep) diagnose(token, "malformed-control");
    pieces.push({ token: tokens.length });
    tokens.push(token);
  }
  append(cursor, sourceText.length);
  const cleanText = text.join("");

  const stack: number[] = [];
  const byTag = new Map<string, number[]>();
  const pop = () => {
    const index = stack.pop()!;
    byTag.get(tokens[index]!.tag)!.pop();
    return index;
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.keep || token.kind === "inline") continue;
    if (token.kind === "open") {
      stack.push(index);
      const indices = byTag.get(token.tag) ?? [];
      indices.push(index);
      byTag.set(token.tag, indices);
      continue;
    }
    const opening = byTag.get(token.tag)?.at(-1);
    if (opening === undefined) {
      token.keep = false;
      diagnose(token, "unmatched-control");
      continue;
    }
    while (stack.at(-1) !== opening) {
      const crossed = tokens[pop()]!;
      crossed.keep = false;
      diagnose(crossed, "crossed-control");
    }
    pop();
    const start = tokens[opening]!;
    start.pair = index;
    token.pair = opening;
    if (start.nonWhitespaceLength === token.nonWhitespaceLength) {
      start.keep = token.keep = false;
      diagnose(start, "empty-wrapper");
    }
  }
  for (const index of stack) {
    tokens[index]!.keep = false;
    diagnose(tokens[index]!, "unmatched-control");
  }

  const active = new Set<string>();
  const annotations: AudioDeliveryAnnotation[] = [];
  for (const token of tokens) {
    if (!token.keep) continue;
    if (token.kind === "inline") {
      annotations.push({ kind: "inline", tag: token.tag as AudioInlineTag, textStart: token.textStart });
    } else if (token.kind === "open") {
      const end = tokens[token.pair!]!;
      if (active.has(token.tag)) {
        token.keep = end.keep = false;
        diagnose(token, "duplicate-wrapper");
      } else {
        active.add(token.tag);
        annotations.push({ kind: "wrap", tag: token.tag as AudioWrappingTag, textStart: token.textStart, textEnd: end.textStart });
      }
    } else {
      active.delete(token.tag);
    }
  }
  const taggedText = pieces.map(piece => {
    if ("text" in piece) return piece.text;
    const token = tokens[piece.token]!;
    if (!token.keep) return "";
    return token.kind === "inline" ? `[${token.tag}]` : `<${token.kind === "close" ? "/" : ""}${token.tag}>`;
  }).join("");
  return { version: AUDIO_DELIVERY_VERSION, sourceText, cleanText, sourceMap, annotations, diagnostics, taggedText };
}

export interface CompiledAudioDelivery extends AudioDeliveryDocument {
  context: AudioDeliveryContext;
  /** Original annotations remain distinct from the compiler-added fallback. */
  fallbackTag: "higher-pitch" | "lower-pitch" | null;
  synthesisText: string;
}

/** Context must come from canonical phase/moment metadata, never from prose.
 * Night speech is a prompt preference, not a forced soft wrapper. Thinking
 * fallback respects an authored preferred-pitch span anywhere in the text.
 */
export function compileAudioDelivery(sourceText: string, context: AudioDeliveryContext): CompiledAudioDelivery {
  const document = normalizeAudioDelivery(sourceText);
  const preferred = context === "thinking" ? "higher-pitch" : context === "night-thinking" ? "lower-pitch" : null;
  const fallbackTag = preferred && document.cleanText.trim()
    && !document.annotations.some(annotation => annotation.kind === "wrap" && annotation.tag === preferred)
    ? preferred : null;
  return {
    ...document, context, fallbackTag,
    synthesisText: fallbackTag ? `<${fallbackTag}>${document.taggedText}</${fallbackTag}>` : document.taggedText,
  };
}

/** Prepared for default generation in both audio and non-audio games. Callers
 * must persist annotations and publish clean text before enabling this guidance.
 */
export function audioDeliveryGuidance(nighttime: boolean): string {
  return [
    "Delivery tags are optional production notes inside spoken text and thinking, never game actions.",
    `You may mix these wrapping tags around phrases: ${AUDIO_WRAPPING_TAGS.map(tag => `<${tag}>...</${tag}>`).join(", ")}.`,
    `You may insert these expression tags: ${AUDIO_INLINE_TAGS.map(tag => `[${tag}]`).join(", ")}.`,
    nighttime
      ? "Prefer <soft> around nighttime speech and <lower-pitch> around nighttime thinking; other tags and mixtures are welcome."
      : "Prefer <higher-pitch> around thinking; other tags and mixtures are welcome.",
    "Use tags sparingly and only in requested speech/thinking fields. Never add a thinking field when it is absent from the schema. Preserve the exact requested JSON shape. Do not put tags in IDs, targets, votes or other machine-interpreted fields.",
  ].join("\n");
}
