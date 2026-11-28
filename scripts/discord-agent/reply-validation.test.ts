import { expect, test } from "bun:test";
import {
  discordReplyAttachmentLimit, discordReplyImageRefLengthLimit, replySchema, ReplyValidationError,
  validatedReply, type ReplyValidationReason,
} from "../../packages/api/src/discord/conversation/policy.js";

const reply = {
  messages: ["Here are the replay scenes."],
  imageRefs: Array.from({ length: discordReplyAttachmentLimit }, (_, index) => `opaque-scene-${index + 1}`),
  spoiler: { action: "none", game: "" },
  subject: { kind: "none", id: "" },
};

function rejectedReply(value: unknown) {
  try {
    validatedReply(value);
  } catch (error) {
    if (error instanceof ReplyValidationError) return error;
    throw error;
  }
  throw new Error("Expected reply validation to reject the draft");
}

test("the model schema and runtime accept Discord's ten selected image references", () => {
  expect(discordReplyAttachmentLimit).toBe(10);
  expect(replySchema.properties.imageRefs.maxItems).toBe(discordReplyAttachmentLimit);
  expect(validatedReply(reply).imageRefs).toEqual(reply.imageRefs);
  expect(validatedReply({ ...reply, imageRefs: [] }).imageRefs).toEqual([]);
  const excessive = rejectedReply({ ...reply, imageRefs: [...reply.imageRefs, "do-not-echo-extra-ref"] });
  expect(excessive.reason).toBe("attachment_count");
  expect(JSON.stringify(excessive)).not.toContain("do-not-echo-extra-ref");
  const longRef = "r".repeat(discordReplyImageRefLengthLimit);
  expect(validatedReply({ ...reply, imageRefs: [longRef] }).imageRefs).toEqual([longRef]);
  expect(rejectedReply({ ...reply, imageRefs: [longRef + "r"] }).reason).toBe("attachment_ref");
});

test("malformed drafts expose only closed validation reasons for a correction", () => {
  const cases: Array<[unknown, ReplyValidationReason]> = [
    [null, "shape"],
    [{ ...reply, extra: "untrusted field" }, "shape"],
    [{ ...reply, messages: ["", 5] }, "message"],
    [{ ...reply, imageRefs: "not-an-array" }, "attachment_ref"],
    [{ ...reply, imageRefs: [false] }, "attachment_ref"],
    [{ ...reply, spoiler: { action: "invented", game: "secret-game" } }, "spoiler"],
    [{ ...reply, subject: { kind: "unrecognized", id: "secret-id" } }, "subject"],
  ];
  for (const [draft, expected] of cases) {
    const error = rejectedReply(draft);
    expect(error.reason).toBe(expected);
    expect(error.message).toBe("Invalid reply");
  }
});
