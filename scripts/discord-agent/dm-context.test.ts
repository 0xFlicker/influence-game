import { expect, test } from "bun:test";
import {
  activeOffer, availableDmHistory, dmContext, revalidateDmSubject, subjectsFromRead,
  validatedReply, type DiscordMessage, type DmHistory, type SpoilerOffer, type Subject,
} from "../../packages/api/src/discord/conversation/policy.js";

const channel = "1521921716224393438";
const member = "1521921716224393439";
const current: DiscordMessage = {
  id: "1521921716224393450", channel_id: channel, author: { id: member }, type: 0, content: "Post it again?",
};
const owner = { link: "verified-link", lane: "owner" as const };
const oldGame = { kind: "game", id: "old-game" } as const;
const newGame = { kind: "game", id: "new-game" } as const;
const history: DmHistory = {
  ...owner, channel, member,
  entries: [
    { messageId: "1521921716224393441", replyIds: ["1521921716224393442", "1521921716224393443"],
      memberText: "How did the first game end? ".repeat(130) + "Here is the final question.", subject: oldGame, expires: 100 },
    { messageId: "1521921716224393444", replyIds: ["1521921716224393445"],
      memberText: "Tell me about the second game.", subject: newGame, expires: 150 },
  ],
};

function replyingTo(id: string, channelId = channel): DiscordMessage {
  return { ...current, type: 19, message_reference: { message_id: id, channel_id: channelId, type: 0 } };
}

function toolResult(value: object) {
  return Response.json({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

test("DM context keeps a checked explicit parent and bounded recent subjects in order", async () => {
  const firstReply = replyingTo(history.entries[0].replyIds[1]!);
  const checked: Subject[] = [];
  const context = await dmContext(availableDmHistory(history, firstReply, owner, 99), firstReply, async reference => {
    checked.push(reference);
    return true;
  });
  const firstPart = replyingTo(history.entries[0].replyIds[0]!);
  expect((await dmContext(history.entries, firstPart, async () => true)).repliedTo).toEqual(context.repliedTo);
  expect(checked).toEqual([oldGame, newGame]);
  expect(context).toEqual({
    memberMessages: history.entries.map(entry => entry.memberText),
    recentSubjects: [oldGame, newGame],
    repliedTo: { speaker: "house", memberMessage: history.entries[0].memberText, subject: oldGame },
  });
  const firstQuestion = replyingTo(history.entries[0].messageId);
  expect((await dmContext(history.entries, firstQuestion, async () => true)).repliedTo?.speaker).toBe("requesting_member");
  expect((await dmContext(history.entries, current, async () => true)).recentSubjects.at(-1)).toEqual(newGame);
});

test("DM context excludes unavailable, expired, future and mismatched history", async () => {
  const firstReply = replyingTo(history.entries[0].replyIds[1]!);
  const context = await dmContext(history.entries, firstReply, async reference => reference.id !== oldGame.id);
  expect(context.repliedTo).toBeUndefined();
  expect(context.recentSubjects).toEqual([newGame]);
  expect(context.memberMessages).toEqual([history.entries[1].memberText]);
  expect(availableDmHistory(history, current, owner, 100)).toEqual([history.entries[1]]);
  expect(availableDmHistory(history, current, { ...owner, lane: "staff" }, 99)).toEqual([]);
  expect(availableDmHistory(history, current, { ...owner, link: "relinked" }, 99)).toEqual([]);
  expect(availableDmHistory(history, { ...current, author: { id: channel } }, owner, 99)).toEqual([]);
  const otherChannel = replyingTo(history.entries[0].replyIds[1]!, "1521921716224393460");
  expect((await dmContext(history.entries, otherChannel, async () => true)).repliedTo).toBeUndefined();
  const betweenTurns = { ...current, id: "1521921716224393444" };
  expect((await dmContext(history.entries, betweenTurns, async () => true)).recentSubjects).toEqual([oldGame]);
});

test("subject selection derives only canonical IDs from typed successful House responses", async () => {
  const result = toolResult({ game: { id: newGame.id, private: "private answer body" } });
  expect(await subjectsFromRead("read_game", { game: "game-slug" }, result)).toEqual([newGame]);
  expect((await result.json()).content[0].type).toBe("text");
  const player = { kind: "player", id: "player-public-id" };
  expect(await subjectsFromRead("read_player", { player: "Handle" }, toolResult({
    status: "found", profile: { identity: { publicId: player.id }, private: "do not retain" },
  }))).toEqual([player]);
  expect(await subjectsFromRead("read_player", { player: "Handle" }, toolResult({
    status: "ambiguous", candidates: [{ publicId: player.id }],
  }))).toEqual([]);
  expect(await subjectsFromRead("read_agent", { agent: "private-agent" }, toolResult({
    publicProfile: { status: "not_found" }, profile: { id: "private-agent", revision: "private data" },
  }))).toEqual([{ kind: "agent", id: "private-agent" }]);
  expect(await subjectsFromRead("read_agent", { agent: "private-agent" }, toolResult({ publicProfile: { status: "not_found" } }))).toEqual([]);
  expect(await subjectsFromRead("read_game", {}, Response.json({ isError: true, content: [{ type: "text", text: '{"game":{"id":"new-game"}}' }] }))).toEqual([]);
  expect(await subjectsFromRead("read_game", {}, new Response("unavailable", { status: 403 }))).toEqual([]);
});

test("reauthorization uses the current grant and ignores successful HTTP responses without a matching subject", async () => {
  const calls: unknown[] = [];
  const stub = async (action: string, body: object) => {
    calls.push({ action, body });
    return action === "validate" ? Response.json({ valid: true }) : toolResult({ status: "not_found" });
  };
  expect(await revalidateDmSubject(newGame, "fresh-grant", stub)).toBe(true);
  expect(await revalidateDmSubject({ kind: "player", id: "deleted-profile" }, "fresh-grant", stub)).toBe(false);
  expect(calls).toEqual([
    { action: "validate", body: { grant: "fresh-grant", games: [newGame.id] } },
    { action: "mcp", body: { grant: "fresh-grant", method: "tools/call", name: "read_player", args: { player: "deleted-profile" } } },
  ]);
  expect(await revalidateDmSubject(newGame, "fresh-grant", async () => Response.json({ valid: false }))).toBe(false);
});

test("a reply to an earlier replay keeps its exact moment only while the fresh grant permits it", async () => {
  const replayUrl = "https://thehouse.game/games/wolf/replay?audience=omniscient&cursor=7";
  const mysteryUrl = "https://thehouse.game/games/wolf/replay?audience=mystery&cursor=3";
  const [reveal] = await subjectsFromRead("resolve_house_link", {}, toolResult({
    status: "found", kind: "replay", reference: "wolf", url: replayUrl,
  }));
  expect(reveal).toEqual({ kind: "game", id: "wolf", replayUrl });
  expect(await subjectsFromRead("resolve_house_link", {}, toolResult({ status: "not_found" }))).toEqual([]);
  const mystery = { ...reveal!, replayUrl: mysteryUrl };
  const entries = [{ ...history.entries[0]!, subject: reveal }, { ...history.entries[1]!, subject: mystery }];
  const firstReply = replyingTo(entries[0]!.replyIds[1]!);
  const freshGrant = async (action: string, body: object) => {
    expect(action).toBe("validate");
    expect(body).toMatchObject({ grant: "fresh-grant", games: ["wolf"] });
    return Response.json({ valid: true, links: [mysteryUrl] });
  };
  const context = await dmContext(entries, firstReply, reference => revalidateDmSubject(reference, "fresh-grant", freshGrant));
  expect(context.repliedTo).toBeUndefined();
  expect(context.recentSubjects).toEqual([mystery]);
  const permitted = await dmContext(entries, firstReply, async () => true);
  expect(permitted.repliedTo?.subject).toEqual(reveal);
  expect(permitted.recentSubjects).toEqual([reveal, mystery]);
});

test("spoiler continuity requires the same principal, eligible lane and direct reply", () => {
  const offer: SpoilerOffer = { ...owner, channel, member, game: "werewolf", reply: history.entries[0].replyIds[0]!, expires: Date.now() + 30_000 };
  expect(activeOffer(offer, current, owner)).toBe(offer);
  expect(activeOffer(offer, replyingTo(offer.reply), owner)).toBe(offer);
  expect(activeOffer(offer, replyingTo(history.entries[1].replyIds[0]!), owner)).toBeUndefined();
  expect(activeOffer(offer, replyingTo(offer.reply, "1521921716224393460"), owner)).toBeUndefined();
  expect(activeOffer(offer, { ...current, message_reference: { type: 1 } }, owner)).toBeUndefined();
  expect(activeOffer(offer, current, { ...owner, lane: "staff" })).toBeUndefined();
  expect(activeOffer(offer, current, owner, offer.expires)).toBeUndefined();
});

test("reply subject is an exact typed field with a bounded identifier", () => {
  const envelope = { messages: ["The result is official.", "Here is how it happened."], imageRefs: [], spoiler: { action: "none", game: "" } };
  expect(validatedReply({ ...envelope, subject: newGame }).subject).toEqual(newGame);
  expect(validatedReply({ ...envelope, subject: { kind: "none", id: "" } }).subject.kind).toBe("none");
  for (const subject of [undefined, {}, { kind: "game", id: "https://thehouse.game/games/game" },
    { kind: "none", id: "game" }, { kind: "account", id: "private" }, { ...newGame, cursor: "old-evidence" }]) {
    expect(() => validatedReply({ ...envelope, subject })).toThrow("Invalid reply");
  }
});

test("the reply schema preserves model-authored order and rejects malformed message parts", () => {
  const messages = ["A long answer. ".repeat(180) + "End of draft.", "\nSecond part with intentional whitespace.  "];
  const envelope = { messages, imageRefs: [], spoiler: { action: "none", game: "" }, subject: { kind: "none", id: "" } };
  expect(validatedReply(envelope).messages).toEqual(messages);
  expect(validatedReply({ ...envelope, messages: [] }).messages).toEqual([]);
  for (const invalid of [undefined, "legacy text", ["valid", 1], ["first", " \n "]]) {
    expect(() => validatedReply({ ...envelope, messages: invalid })).toThrow("Invalid reply");
  }
  expect(() => validatedReply({ ...envelope, text: "legacy text" })).toThrow("Invalid reply");
});
