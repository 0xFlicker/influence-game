import { expect, test } from "bun:test";
import { destination, readAnnouncementJob, roomContext, type DiscordMessage } from "../../packages/api/src/discord/conversation/policy.js";

const origin = "https://thehouse.game";
const guild = "1521921716224393436";
const channelId = "1521921716224393437";
const botId = "1521921716224393438";
const replayUrl = `${origin}/games/copper-fox/replay?audience=mystery`;
const nonce = "stable-discord-nonce";
const fixture = new URL("./announcement-gateway-fixture.ts", import.meta.url).pathname;

async function run(scenario: string) {
  const child = Bun.spawn([process.execPath, fixture, scenario], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Announcement fixture failed for ${scenario}\n${stdout}${stderr}`);
  const result = stdout.trim().split("\n").at(-1)!;
  return (JSON.parse(result) as { calls: Array<{ action: string; body?: Record<string, unknown> }> }).calls;
}

test("only the configured channel and canonical links in the current audience can become jobs", () => {
  const job = { id: "job", lease: "lease", channelId, kind: "finish", facts: { gameKind: "werewolf", season: null }, url: replayUrl };
  expect(readAnnouncementJob(job, channelId, origin)).toEqual(job);
  for (const url of [replayUrl.replace("mystery", "omniscient"), `${replayUrl}&cursor=1`, `${replayUrl}#spoiler`,
    replayUrl.replace("thehouse.game", "example.com"), `${origin}/games/copper-fox`]) {
    expect(readAnnouncementJob({ ...job, url }, channelId, origin)).toBeNull();
  }
  expect(readAnnouncementJob({ ...job, channelId: botId }, channelId, origin)).toBeNull();
  expect(readAnnouncementJob({ ...job, facts: { gameKind: "werewolf", season: "x".repeat(8192) } }, channelId, origin)).toBeNull();
});

test("House room history preserves a recap's Mystery link and masks the prose even for a reply", () => {
  const recap: DiscordMessage = { id: "1521921716224393439", channel_id: channelId, guild_id: guild, type: 0,
    author: { id: botId, bot: true }, content: `${replayUrl}\n\n||Copper Fox was a wolf.||` };
  const current: DiscordMessage = { ...recap, id: "1521921716224393441", author: { id: "1521921716224393440" },
    content: "Show me the replay", message_reference: { message_id: recap.id, channel_id: channelId } };
  const marker = { id: recap.id, speaker: "house", disclosure: "game_recap", replayUrl };
  const history = roomContext(current, [recap], botId, origin);
  expect(history).toEqual({ recent: [marker], repliedTo: marker });
  expect(JSON.stringify(history)).not.toContain("was a wolf");
  expect(destination(recap, guild, channelId)).toBeNull();
  expect(roomContext(current, [{ ...recap, author: { id: current.author.id } }], botId, origin).repliedTo?.disclosure).toBeUndefined();
});

test("the gateway sends one start with exact authored copy and a confirmed receipt", async () => {
  const calls = await run("start");
  expect(calls.map(call => call.action)).toEqual(["announcement-claim", "codex", "check-discord-channel", "announcement-begin", "post-to-discord", "announcement-complete"]);
  expect(calls[4]?.body).toEqual({ content: `${origin}/games/copper-fox\n\nInfluence has begun in Season 1.`, flags: 4,
    nonce, enforce_nonce: true, allowed_mentions: { parse: [] } });
  expect(calls.at(-1)?.body).toEqual({ id: "job-1", lease: "lease-1", channelId, outcome: "posted", messageId: "1521921716224393439" });
});

test("the gateway corrects an oversized draft once then posts a replay link with every recap line hidden", async () => {
  const calls = await run("correction");
  expect(calls.filter(call => call.action === "codex")).toHaveLength(2);
  expect(calls[2]?.body).toHaveProperty("correction", "message");
  expect(calls.filter(call => call.action === "post-to-discord").map(call => call.body?.content)).toEqual([
    `${origin}/games/copper-fox/replay\n\n||Copper Fox won the jury vote.||\n||The final elimination broke the tie.||`,
  ]);
});

test("a visibility denial stops before Discord send and leaves API suppression intact", async () => {
  const calls = await run("restricted");
  expect(calls.map(call => call.action)).toEqual(["announcement-claim", "codex", "check-discord-channel", "announcement-begin"]);
});

test("an inbound conversation takes precedence when it arrives during a claim", async () => {
  const calls = await run("interactive-race");
  expect(calls.map(call => call.action)).toEqual(["announcement-claim", "check-discord-channel", "member-turn"]);
});

test("an explicit Discord 429 requeues only with a bounded Retry-After value", async () => {
  const calls = await run("rate-limited");
  expect(calls.filter(call => call.action === "post-to-discord")).toHaveLength(1);
  expect(calls.at(-1)?.body).toEqual({ id: "job-1", lease: "lease-1", channelId, outcome: "rate_limited", retryAfterSeconds: 10 });
  const invalidHeader = await run("bad-retry-header");
  expect(invalidHeader.filter(call => call.action === "post-to-discord")).toHaveLength(1);
  expect(invalidHeader.at(-1)?.body).toEqual({ id: "job-1", lease: "lease-1", channelId, outcome: "rate_limited" });
});

test("a second Discord 429 requeues after the bounded transport retry uses the same nonce", async () => {
  const calls = await run("rate-limited-twice");
  expect(calls.filter(call => call.action === "post-to-discord").map(call => call.body?.nonce)).toEqual([nonce, nonce]);
  expect(calls.at(-1)?.body).toEqual({ id: "job-1", lease: "lease-1", channelId, outcome: "rate_limited", retryAfterSeconds: 0.001 });
});

for (const [scenario, posts, outcome] of [
  ["author-unavailable", 0, "retry"], ["wrong-guild", 0, "failed"],
  ["lost-begin", 0, "unconfirmed"], ["ambiguous", 1, "unconfirmed"], ["upstream-failure", 1, "unconfirmed"],
  ["rejected", 1, "failed"],
] as const) {
  test(`the gateway handles ${scenario} with at most one Discord send and the correct receipt`, async () => {
    const calls = await run(scenario);
    expect(calls.filter(call => call.action === "post-to-discord")).toHaveLength(posts);
    expect(calls.at(-1)?.body).toEqual({ id: "job-1", lease: "lease-1", channelId, outcome });
  });
}
