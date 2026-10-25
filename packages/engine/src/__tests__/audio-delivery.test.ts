import { describe, expect, test } from "bun:test";
import {
  AUDIO_INLINE_TAGS, AUDIO_WRAPPING_TAGS, audioDeliveryGuidance,
  compileAudioDelivery, normalizeAudioDelivery, normalizeAudioPayload, type AudioDeliveryContext,
} from "../audio-delivery";

describe("audio delivery normalization", () => {
  test("separates clean dialogue from delivery without rewriting words or whitespace", () => {
    const source = "  <soft>I trust <emphasis>Ada</emphasis>.</soft> [pause] Do you?\n";
    const result = normalizeAudioDelivery(source);
    expect(result.sourceText).toBe(source);
    expect(result.cleanText).toBe("  I trust Ada.  Do you?\n");
    expect(result.taggedText).toBe(source);
    expect(result.annotations).toEqual([
      { kind: "wrap", tag: "soft", textStart: 2, textEnd: 14 },
      { kind: "wrap", tag: "emphasis", textStart: 10, textEnd: 13 },
      { kind: "inline", tag: "pause", textStart: 15 },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  for (const tag of AUDIO_WRAPPING_TAGS) {
    test(`retains supported ${tag} delivery in thinking`, () => {
      const result = compileAudioDelivery(`<${tag}>Why Ada?</${tag}>`, "thinking");
      expect(result.cleanText).toBe("Why Ada?");
      expect(result.taggedText).toBe(`<${tag}>Why Ada?</${tag}>`);
      expect(result.synthesisText).toContain(`<${tag}>Why Ada?</${tag}>`);
      expect(result.diagnostics).toEqual([]);
    });
  }
  for (const tag of AUDIO_INLINE_TAGS) {
    test(`retains supported ${tag} expression but removes it from clean text`, () => {
      const result = normalizeAudioDelivery(`Wait[${tag}]Ada.`);
      expect(result.cleanText).toBe("WaitAda.");
      expect(result.taggedText).toBe(`Wait[${tag}]Ada.`);
      expect(result.annotations).toEqual([{ kind: "inline", tag, textStart: 4 }]);
    });
  }

  test("does not mistake unknown brackets, math, HTML or escaped examples for delivery tags", () => {
    const source = "[Ada] [unknown] <candidate>Ada</candidate> <3 &lt;soft&gt; 2 < 3 > 1";
    const result = normalizeAudioDelivery(source);
    expect(result.cleanText).toBe(source);
    expect(result.annotations).toEqual([]);
  });

  test("maps Unicode and repeated words back to their exact original spans", () => {
    const source = "🐺<soft>é e\u0301</soft>[sigh]🐺é";
    const result = normalizeAudioDelivery(source);
    expect(result.cleanText).toBe("🐺é e\u0301🐺é");
    expect(result.annotations[0]).toEqual({ kind: "wrap", tag: "soft", textStart: 2, textEnd: 6 });
    let end = 0;
    for (const span of result.sourceMap) {
      expect(span.textStart).toBe(end);
      expect(source.slice(span.sourceStart, span.sourceEnd)).toBe(result.cleanText.slice(span.textStart, span.textEnd));
      end = span.textEnd;
    }
    expect(end).toBe(result.cleanText.length);
  });

  test("removes identical nesting, retaining distinct tags and disjoint spans", () => {
    const source = "<higher-pitch>A <soft><higher-pitch>B</higher-pitch></soft> C</higher-pitch> <higher-pitch>D</higher-pitch>";
    const result = normalizeAudioDelivery(source);
    expect(result.taggedText).toBe("<higher-pitch>A <soft>B</soft> C</higher-pitch> <higher-pitch>D</higher-pitch>");
    expect(result.annotations.map(annotation => annotation.tag)).toEqual(["higher-pitch", "soft", "higher-pitch"]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["duplicate-wrapper"]);
  });

  test.each([
    ["<soft>Hello", "Hello", "Hello"],
    ["Hello</soft>", "Hello", "Hello"],
    ["<soft>A<emphasis>B</soft>C</emphasis>", "ABC", "<soft>AB</soft>C"],
    ["<soft voice='helios'>Hi</soft>", "Hi", "Hi"],
    ["<SOFT>Hi</SOFT>", "Hi", "Hi"],
    ["Hi[pause length=100] there", "Hi there", "Hi there"],
    ["<soft></soft>A", "A", "A"],
    ["[soft]A[/soft]", "A", "A"],
    ["<pause>A", "A", "A"],
    ["A<soft", "A", "A"],
    ["A[pause", "A", "A"],
  ])("handles unusable controls without throwing: %s", (source, clean, tagged) => {
    const result = normalizeAudioDelivery(source);
    expect(result.cleanText).toBe(clean);
    expect(result.taggedText).toBe(tagged);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(normalizeAudioDelivery(result.taggedText).taggedText).toBe(tagged);
  });

  test("does not reject or overflow on deeply nested or long valid text", () => {
    const words = "I am still listening. ".repeat(10_000);
    const result = normalizeAudioDelivery("<soft>".repeat(20_000) + words + "</soft>".repeat(20_000));
    expect(result.cleanText).toBe(words);
    expect(result.taggedText).toBe(`<soft>${words}</soft>`);
    expect(result.annotations).toHaveLength(1);
  });
});

describe("context-specific delivery compilation", () => {
  test.each([
    ["speech", "Plain words", null],
    ["night-speech", "Plain words", null],
    ["thinking", "<higher-pitch>Plain words</higher-pitch>", "higher-pitch"],
    ["night-thinking", "<lower-pitch>Plain words</lower-pitch>", "lower-pitch"],
  ] as const)("compiles %s without confusing prompt guidance and enforced fallback", (context, expected, fallback) => {
    const result = compileAudioDelivery("Plain words", context);
    expect(result.synthesisText).toBe(expected);
    expect(result.fallbackTag).toBe(fallback);
    expect(result.annotations).toEqual([]);
  });

  test("preserves soft and emphasis together at night", () => {
    const source = "<soft>It was <emphasis>Ada</emphasis>.</soft>[pause]";
    expect(compileAudioDelivery(source, "night-speech").synthesisText).toBe(source);
    expect(compileAudioDelivery("<loud>Ada!</loud>", "night-speech").synthesisText).toBe("<loud>Ada!</loud>");
  });

  test("respects a preferred pitch on a partial authored span", () => {
    const source = "Maybe <higher-pitch>Ada</higher-pitch> knows.";
    const result = compileAudioDelivery(source, "thinking");
    expect(result.fallbackTag).toBeNull();
    expect(result.synthesisText).toBe(source);
  });

  test("night thinking adds only its matching fallback and preserves other tags", () => {
    const source = "<higher-pitch>Why?</higher-pitch><soft>Ask Ada.</soft>[sigh]";
    const result = compileAudioDelivery(source, "night-thinking");
    expect(result.synthesisText).toBe(`<lower-pitch>${source}</lower-pitch>`);
    expect(result.cleanText).toBe("Why?Ask Ada.");
    expect(result.fallbackTag).toBe("lower-pitch");
  });

  test("unusable preferred tags do not prevent the thinking fallback", () => {
    const result = compileAudioDelivery("<higher-pitch>Why?", "thinking");
    expect(result.synthesisText).toBe("<higher-pitch>Why?</higher-pitch>");
    expect(result.diagnostics[0]?.code).toBe("unmatched-control");
    expect(compileAudioDelivery("<higher-pitch> </higher-pitch>Why?", "thinking").synthesisText)
      .toBe("<higher-pitch> Why?</higher-pitch>");
  });

  test("empty thinking does not invent words or a pitch wrapper", () => {
    for (const source of ["", "  ", "<higher-pitch></higher-pitch>", "[pause]"]) {
      expect(compileAudioDelivery(source, "thinking").fallbackTag).toBeNull();
    }
  });

  test("normalization and compilation are idempotent for every context", () => {
    const examples = [
      "A", "<soft><soft>A</soft>B</soft>", "<soft>A<emphasis>B</soft>C</emphasis>",
      "<higher-pitch>A</higher-pitch>[pause]B", "<lower-pitch>[laugh]A</lower-pitch>",
    ];
    for (const context of ["speech", "night-speech", "thinking", "night-thinking"] satisfies AudioDeliveryContext[]) {
      for (const source of examples) {
        const first = compileAudioDelivery(source, context);
        const second = compileAudioDelivery(first.synthesisText, context);
        expect(second.synthesisText).toBe(first.synthesisText);
        expect(second.cleanText).toBe(first.cleanText);
      }
    }
  });

  test("guidance allows mixtures and keeps machine-interpreted fields out of scope", () => {
    expect(audioDeliveryGuidance(false)).toContain("Prefer <higher-pitch>");
    expect(audioDeliveryGuidance(true)).toContain("Prefer <soft> around nighttime speech and <lower-pitch>");
    expect(audioDeliveryGuidance(true)).toContain("other tags and mixtures are welcome");
    expect(audioDeliveryGuidance(false)).toContain("Do not put tags in IDs, targets, votes");
  });
});


test("schema-owned paths clean nested speech without interpreting decision fields", () => {
  const original = { target: "<soft>Ada</soft>", thinking: "<emphasis>Be careful.</emphasis>",
    whispers: [{ to: "Ada", text: "<soft>Hello.</soft>" }], strategy: { note: "unchanged" } };
  const result = normalizeAudioPayload(original, { fields: ["thinking", "whispers.*.text"], nighttime: true });
  expect(result.value).toEqual({ ...original, thinking: "Be careful.", whispers: [{ to: "Ada", text: "Hello." }] });
  expect(original.whispers[0]!.text).toBe("<soft>Hello.</soft>");
  expect(result.audioDelivery.fields.map(field => field.path)).toEqual([["thinking"], ["whispers", "0", "text"]]);
  expect(result.audioDelivery.fields[0]!.delivery.synthesisText).toBe("<lower-pitch><emphasis>Be careful.</emphasis></lower-pitch>");
  expect(result.audioDelivery.fields[1]!.delivery.context).toBe("night-speech");
});
