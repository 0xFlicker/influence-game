import { expect, test } from "bun:test";
import {
  activeOffer, decideSpoilerTurn, discordContentLimit, discordReplyContent, discordReplyForm, roomContext, spoilerOfferContext, validatedConsent,
  type DiscordMessage, type SpoilerOffer, type TurnAuthority,
} from "../../packages/api/src/discord/conversation/policy.js";

const channel = "1521921716224393438";
const requester = "1521921716224393439";
const otherMember = "1521921716224393440";
const offerMessage = "1521921716224393445";
const bot = "1521921716224393446";
const authority: TurnAuthority = { link: "connected-account", lane: "room" };
const live = { gameId: "game-copper-fox", slug: "copper-fox", settled: false };
const settled = { ...live, settled: true };
const current: DiscordMessage = {
  id: "1521921716224393450", channel_id: channel, author: { id: requester }, type: 19,
  content: "Go ahead.", message_reference: { channel_id: channel, message_id: offerMessage },
};
const authorize = { action: "authorize", game: live.gameId } as const;
const ask = { action: "offer", game: live.gameId } as const;
const offer: SpoilerOffer = { ...authority, channel, member: requester, game: live.gameId, reply: offerMessage, expires: 100 };

test("an ambiguous question opens one offer and a direct request needs no prior offer", async () => {
  const options = {
    message: current, authority, offer: undefined, now: () => 50, readTarget: async () => live,
    interpret: async () => { throw new Error("An offer must use no consent inference"); },
  };
  expect(await decideSpoilerTurn(ask, options)).toEqual({ action: "offer", target: live });
  expect(await decideSpoilerTurn(ask, { ...options, offer })).toEqual({ action: "offer_pending" });
  expect(await decideSpoilerTurn(ask, {
    ...options, offer, message: { ...current, message_reference: { channel_id: channel, message_id: "1521921716224393449" } },
  })).toEqual({ action: "offer_pending" });
  expect(await decideSpoilerTurn(authorize, {
    ...options, message: { ...current, content: "Give me the live Omniscient reveal." },
    interpret: async (_, matchingOffer) => {
      expect(matchingOffer).toBe(false);
      return validatedConsent({ intent: "direct" });
    },
  })).toEqual({ action: "reveal", target: live });
});

test("only the matching requester, lane, channel and current unexpired offer can accept an offer", async () => {
  let time = 50;
  const options = {
    message: current, authority, offer, now: () => time, readTarget: async () => live,
    interpret: async () => validatedConsent({ intent: "matching_offer" }),
  };
  expect(await decideSpoilerTurn(authorize, options)).toEqual({ action: "reveal", target: live });
  expect(await decideSpoilerTurn(authorize, {
    ...options, message: { ...current, author: { id: otherMember } },
    interpret: async (_, matchingOffer) => {
      expect(matchingOffer).toBe(false);
      return validatedConsent({ intent: "matching_offer" });
    },
  })).toEqual({ action: "ask_explicitly" });
  expect(await decideSpoilerTurn(authorize, { ...options, authority: { ...authority, lane: "owner" } })).toEqual({ action: "ask_explicitly" });
  expect(await decideSpoilerTurn(authorize, {
    ...options, message: { ...current, message_reference: { channel_id: otherMember, message_id: offerMessage } },
  })).toEqual({ action: "offer_pending" });
  expect(await decideSpoilerTurn(authorize, {
    ...options, interpret: async (_, matchingOffer) => {
      expect(matchingOffer).toBe(true);
      time = 100;
      return validatedConsent({ intent: "matching_offer" });
    },
  })).toEqual({ action: "ask_explicitly" });
});

test("settlement during a consent decision returns to the official outcome without elevation", async () => {
  const checks: string[] = [];
  const options = {
    message: current, authority, offer, now: () => 50,
    readTarget: async (game: string) => {
      checks.push(game);
      return checks.length === 1 ? live : settled;
    },
    interpret: async () => validatedConsent({ intent: "matching_offer" }),
  };
  expect(await decideSpoilerTurn(authorize, options)).toEqual({ action: "settled", target: settled });
  expect(checks).toEqual([live.gameId, live.gameId]);
  expect(await decideSpoilerTurn(authorize, {
    ...options, readTarget: async () => settled,
    interpret: async () => { throw new Error("Settled games require no consent inference"); },
  })).toEqual({ action: "settled", target: settled });
});

test("a settled offer keeps only an authorized subject for the original member's follow-up", async () => {
  const fresh = { ...offer, expires: Date.now() + 10_000 };
  let requests = 0;
  const api = async (action: string, body: object) => {
    requests++;
    expect(action).toBe("spoiler");
    expect(body).toEqual({ grant: "current-grant", game: live.gameId });
    return Response.json(settled);
  };
  expect(await spoilerOfferContext(activeOffer(fresh, current, authority), "current-grant", api)).toEqual({ settledGame: live.gameId });
  expect(await spoilerOfferContext(activeOffer(fresh, { ...current, author: { id: otherMember } }, authority), "current-grant", api)).toBeUndefined();
  expect(requests).toBe(1);
  expect(await spoilerOfferContext(fresh, "current-grant", async () => Response.json({ ...live, settled: "false" }))).toBeUndefined();
  expect(await spoilerOfferContext(fresh, "current-grant", async () => Response.json(live))).toEqual({ offer: fresh });
});

test("live room deliveries spoiler every nonblank line and mark attached art to blur", () => {
  const text = "A ||delimiter made from `code`.\r\n\r\nSecond paragraph\\";
  const image = { mimeType: "image/png", data: "aW1hZ2U=" };
  const form = discordReplyForm(current, text, [image], true)!;
  expect(JSON.parse(form.get("payload_json") as string)).toMatchObject({
    content: "||A ¦¦delimiter made from ′code′.||\n\n||Second paragraph＼||",
    flags: 4,
    attachments: [{ id: 0, filename: "house-1.png", is_spoiler: true }],
    message_reference: { message_id: current.id, channel_id: current.channel_id, fail_if_not_exists: true },
  });
  expect((form.get("files[0]") as File).name).toBe("house-1.png");
  const plain = discordReplyForm(current, text, [image], false)!;
  expect(JSON.parse(plain.get("payload_json") as string)).toMatchObject({ content: text, attachments: [{ id: 0, filename: "house-1.png" }] });
  expect(JSON.parse(plain.get("payload_json") as string).attachments[0]).not.toHaveProperty("is_spoiler");
  const artOnly = discordReplyForm(current, "", [image], true)!;
  expect(JSON.parse(artOnly.get("payload_json") as string)).toMatchObject({
    content: "", attachments: [{ id: 0, filename: "house-1.png", is_spoiler: true }],
  });
  expect(discordReplyForm(current, "  ", [], true)).toBeNull();
});

test("full spoiler wrapping is measured before delivery, with no clipping to fit a multipart post", () => {
  const longest = "x".repeat(discordContentLimit - 4);
  const exact = discordReplyForm(current, longest, [], true)!;
  expect(JSON.parse(exact.get("payload_json") as string).content).toBe(`||${longest}||`);
  expect(discordReplyContent("  A complete line.  \n \t\n  The conclusion.", true))
    .toBe("||  A complete line.  ||\n \t\n||  The conclusion.||");
  const lines = Array.from({ length: 450 }, (_, index) => `Spoiler line ${index}`);
  const text = lines.join("\n");
  const wrapped = lines.map(line => `||${line}||`).join("\n");
  expect(discordReplyContent(text, true)).toBe(wrapped);
  expect(() => discordReplyForm(current, text, [], true)).toThrow(RangeError);
  expect(() => discordReplyForm(current, longest + "y", [], true)).toThrow(RangeError);
  expect(() => discordReplyForm(current, "x".repeat(discordContentLimit + 1), [], false)).toThrow(RangeError);
});

test("ordered parts use distinct stable Discord nonces and keep the original reply reference", () => {
  const messages = ["First answer.\n\nA second paragraph.", "Next part includes words that must stay intact.", "Final words."];
  const payloads = messages.map((text, part) => JSON.parse(discordReplyForm(current, text, [], false, part)!.get("payload_json") as string));
  expect(payloads.map(payload => payload.content)).toEqual(messages);
  const nonces = payloads.map(payload => payload.nonce);
  expect(nonces[0]).toBe(current.id);
  expect(new Set(nonces).size).toBe(messages.length);
  expect(nonces.every(nonce => typeof nonce === "string" && nonce.length <= 25)).toBe(true);
  for (const [part, payload] of payloads.entries()) {
    expect(payload.message_reference).toEqual({ message_id: current.id, channel_id: current.channel_id, fail_if_not_exists: true });
    expect(JSON.parse(discordReplyForm(current, messages[part]!, [], false, part)!.get("payload_json") as string).nonce).toBe(payload.nonce);
  }
});

test("room context masks prior House live reveals, including explicit reply targets after replacement", () => {
  const prior: DiscordMessage = {
    ...current, id: offerMessage, author: { id: bot, bot: true },
    content: "||The only wolf is the secret contestant.||\n\n||The replay confirms it.||",
  };
  const fullHistory = "The canonical game link is ready. ".repeat(65) + "This is the last sentence.";
  const context = roomContext(current, [prior, { ...prior, id: "1521921716224393444", content: fullHistory }], bot);
  const marker = { id: offerMessage, speaker: "house", disclosure: "live_werewolf_spoiler" };
  expect(context.repliedTo).toEqual(marker);
  expect(context.recent.at(-1)).toEqual(marker);
  expect(JSON.stringify(context)).not.toContain("secret contestant");
  expect(context.recent[0]?.text).toBe(fullHistory);
  const impersonated = { ...prior, author: { id: otherMember } };
  expect(roomContext(current, [impersonated], bot).repliedTo?.speaker).toBe("room_member");
  const attachmentOnly = { ...prior, content: "", attachments: [{ flags: 1 << 3 }] };
  expect(roomContext(current, [attachmentOnly], bot).repliedTo).toEqual(marker);
  const plainAttachment = { ...prior, content: "", attachments: [{ flags: 1 << 5 }] };
  expect(roomContext(current, [plainAttachment], bot).repliedTo).toBeUndefined();
  const olderFormat = { ...prior, content: "**Live Werewolf spoiler for this room.**\nUnformatted old spoiler." };
  expect(roomContext(current, [olderFormat], bot).repliedTo).toEqual(marker);
  expect(roomContext(current, [{ ...olderFormat, author: { id: otherMember } }], bot).repliedTo?.disclosure).toBeUndefined();
});
