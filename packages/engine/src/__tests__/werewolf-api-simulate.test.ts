import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWerewolfApiArgs, runWerewolfApiSimulation } from "../werewolf/api-simulate";
import { projectWerewolfView, type WerewolfPublicEntry } from "../werewolf/observation";
import { replayWerewolf, startWerewolf, werewolfConfig } from "../werewolf/rules";
import { runWerewolf, werewolfFallback } from "../werewolf/runner";
import type { WerewolfEvent } from "../werewolf/types";
import { werewolfReportEntry } from "../werewolf/report";

const originalFetch = globalThis.fetch;
let sessionToken: string | undefined, mcpToken: string | undefined;
let reportDir: string;
let reportIndex = 0;
const runArgs = (argv: string[] = []) => ({ ...parseWerewolfApiArgs(argv, {}), out: join(reportDir, `report-${reportIndex++}.txt`) });
beforeEach(async () => {
  reportDir = await mkdtemp(join(tmpdir(), "werewolf-report-"));
  sessionToken = process.env.INFLUENCE_API_SESSION_TOKEN;
  mcpToken = process.env.INFLUENCE_MCP_TOKEN;
  delete process.env.INFLUENCE_API_SESSION_TOKEN;
  process.env.INFLUENCE_MCP_TOKEN = "test-mcp-token";
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [["INFLUENCE_API_SESSION_TOKEN", sessionToken], ["INFLUENCE_MCP_TOKEN", mcpToken]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(reportDir, { recursive: true, force: true });
});

async function fixture(disagree = false) {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Curious", backstory: "", strategy: "", avatarUrl: null }));
  const events: WerewolfEvent[] = [startWerewolf("report-game", players, werewolfConfig("two_wolves", 1), "report-seed")];
  const initial = replayWerewolf(events);
  const final = await runWerewolf({ read: async () => events, append: async event => { events.push(event); } }, {
    async decide({ request }) {
      if (disagree && request.action === "attack") {
        const state = replayWerewolf(events);
        const wolves = state.aliveIds.filter(id => state.roles[id] === "werewolf");
        return { kind: "target", targetId: request.legalTargetIds[wolves.indexOf(request.actorId)]!, thinking: "PRIVATE_THINKING" };
      }
      if (request.action === "open_thread") return { kind: "opening", text: "Who changed their mind?", cue: null, recipientIds: request.legalRecipientIds.slice(0, 3) };
      if (request.action === "vote" && request.voteMode === "plurality") {
        const alive = replayWerewolf(events).aliveIds;
        return { kind: "target", targetId: alive[(alive.indexOf(request.actorId) + 1) % alive.length]!, thinking: "" };
      }
      return request.legalTargetIds.length ? werewolfFallback(replayWerewolf(events), request)
        : { kind: "speech", cue: null, text: request.action === "pack_talk" ? "SECRET_PACK" : "Compare the claims." };
    },
  });
  return { initial, final, events };
}

describe("Werewolf API simulation", () => {
  test("defaults to a full match with a safety cap and rejects invalid configuration before dispatch", () => {
    expect(parseWerewolfApiArgs([], {})).toMatchObject({ preset: "one_wolf", maxDays: 10, audience: "mystery", transcript: false, agentProfileIds: [], providerManifest: [{ catalogId: "openai:gpt-6-luna", reasoningPolicy: "low" }] });
    for (const args of [["--preset", "unknown"], ["--max-days", "0"], ["--max-days", "21"], ["--audience", "player"], ["--agent", "same", "--agent", "same"], ["--timeout-seconds", "NaN"], ["--api-url", "https://example.com"], ["--game", ""], ["--unknown"], ["--summaries"], ["--response-rounds", "1"], ["--response-rounds", "0"], ["--response-rounds", "4"]]) expect(() => parseWerewolfApiArgs(args, {})).toThrow();
    expect(parseWerewolfApiArgs(["--preset", "two_wolves", "--agent", "owned-1", "--agent", "owned-2"], {}).agentProfileIds).toEqual(["owned-1", "owned-2"]);
  });

  test("creates exactly one Werewolf game using CLI auth, polls to completion, and reports canonical outcomes", async () => {
    const { initial, final } = await fixture();
    const requests: { path: string; method: string; body?: unknown }[] = [];
    let polls = 0;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const request = (input instanceof Request ? input : new Request(input.toString(), init)), path = new URL(request.url).pathname;
      requests.push({ path, method: request.method, ...(request.method === "POST" ? { body: await request.json() } : {}) });
      if (path === "/api/auth/local-cli-session") return Response.json({ token: "test-session", user: { permissions: ["create_game", "start_game"] } });
      if (request.method === "POST") {
        expect(request.headers.get("Authorization")).toBe("Bearer test-session");
        return Response.json({ id: "report-game", slug: "report-slug" }, { status: 201 });
      }
      const state = polls++ === 0 ? initial : final;
      return Response.json({ slug: "report-slug", status: state.outcome ? "completed" : "in_progress", view: projectWerewolfView(state, "mystery") });
    }, { preconnect: originalFetch.preconnect });
    const args = runArgs(["--preset", "two_wolves", "--agent", "owned-1", "--transcript"]);
    const lines: string[] = [];
    const result = await runWerewolfApiSimulation(args, { sleep: async () => {
      // The report is readable before the game completes, not just at exit.
      const partial = await readFile(args.out, "utf8");
      expect(partial).toContain("Started report-slug");
      expect(partial).toContain("Cast (mystery)");
      expect(partial).not.toContain("Result:");
    }, log: line => { lines.push(line); } });
    expect(requests.map(request => request.path)).toEqual(["/api/auth/local-cli-session", "/api/werewolf", "/api/werewolf/report-game", "/api/werewolf/report-game"]);
    expect(requests[1]?.body).toMatchObject({ preset: "two_wolves", maxDays: 10, agentProfileIds: ["owned-1"], providerManifest: [{ catalogId: "openai:gpt-6-luna", reasoningPolicy: "low" }] });
    expect(result.status).toBe("completed");
    expect(result.report).toContain("http://localhost:3001/games/report-slug/replay?audience=mystery");
    expect(result.report).toContain("Night 1:");
    expect(result.report).toContain("Votes:");
    expect(result.report.match(/Result:/g)).toHaveLength(1);
    expect(result.report).not.toContain("SECRET_PACK");
    expect(result.report).not.toContain("PRIVATE_THINKING");
    expect(result.report).toContain("Compare the claims.");
    expect(result.report).toContain("Ballots:");
    expect(result.report).toContain("Alive (7)");
    expect(await readFile(result.outputPath, "utf8")).toBe(`${lines.join("\n")}\n`);
    expect(result.report).toBe(lines.join("\n"));
  });

  test("watching an existing game requires no login, creation, or model call", async () => {
    const { final } = await fixture();
    delete process.env.INFLUENCE_MCP_TOKEN;
    let count = 0;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const request = (input instanceof Request ? input : new Request(input.toString(), init));
      expect(request.method).toBe("GET");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(request.url).toBe("http://127.0.0.1:3000/api/werewolf/report-slug?audience=omniscient");
      count++;
      return Response.json({ slug: "report-slug", status: "completed", view: projectWerewolfView(final, "omniscient") });
    }, { preconnect: originalFetch.preconnect });
    const result = await runWerewolfApiSimulation(runArgs(["--game", "report-slug", "--audience", "omniscient", "--transcript"]), { log: () => {} });
    expect(result.report).toContain("Day 1 · thread 1");
    expect(result.report).toContain("[opening · turn 1]");
    expect(result.report).toContain("[answer · turn");
    expect(count).toBe(1);
    expect(result.report).toContain("SECRET_PACK");
    expect(result.report).toContain("Compare the claims.");
    expect(result.report).toContain("Seer checked");
    expect(result.report).not.toContain("PRIVATE_THINKING");
    for (const player of final.players) {
      expect(result.report).toContain(`${player.name} [${final.roles[player.id]}]: Compare the claims.`);
      expect(result.report.split("\n").some(line => line.trimStart().startsWith(`${player.name}:`))).toBe(false);
      if (final.roles[player.id] === "werewolf") expect(result.report).toContain(`[Pack] ${player.name} [werewolf]: SECRET_PACK`);
    }
  });

  test("Omniscient explains failed pack ballots and still prints Doctor and Seer actions", async () => {
    const { final } = await fixture(true);
    globalThis.fetch = Object.assign(async () => Response.json({ slug: "report-slug", status: "completed", view: projectWerewolfView(final, "omniscient") }), { preconnect: originalFetch.preconnect });
    const { report } = await runWerewolfApiSimulation(runArgs(["--game", "report-slug", "--audience", "omniscient"]), { log: () => {} });
    expect(report).toContain("[Pack] Night 1 · ballot 1/3");
    expect(report).toContain("[Pack] Night 1 · ballot 3/3");
    expect(report).not.toContain("ballot 4/3");
    expect(report).toContain("Disagreement. Swap the opening speaker and propose again.");
    expect(report).toContain("Three ballots without agreement. No pack attack tonight.");
    expect(report).toContain("Night 1: Everyone survived.");
    expect(report).toContain("Doctor protected");
    expect(report).toContain("Seer checked");
    expect(report).not.toContain("PRIVATE_THINKING");
    const mystery = projectWerewolfView(final, "mystery");
    const publicReport = mystery.entries.map(entry => werewolfReportEntry(entry, mystery, true)).join("\n");
    expect(publicReport).not.toContain("[Pack]");
    expect(publicReport).not.toContain("failed to agree");
    expect(publicReport).not.toContain("Doctor protected");
    expect(publicReport).toContain("Night 1: Everyone survived.");
  });

  test("a failed creation is not retried and a stopped game is not presented as a completed result", async () => {
    process.env.INFLUENCE_API_SESSION_TOKEN = "test-session";
    let calls = 0;
    globalThis.fetch = Object.assign(async () => { calls++; return Response.json({ error: "No admission" }, { status: 503 }); }, { preconnect: originalFetch.preconnect });
    const args = runArgs();
    await expect(runWerewolfApiSimulation(args, { log: () => {} })).rejects.toThrow("503");
    expect(calls).toBe(1);
    expect(await readFile(args.out, "utf8")).toContain("Check http://localhost:3001/games/type/werewolf before launching again");
    const { initial } = await fixture();
    globalThis.fetch = Object.assign(async () => Response.json({ slug: "report-slug", status: "suspended", view: projectWerewolfView(initial, "mystery") }), { preconnect: originalFetch.preconnect });
    await expect(runWerewolfApiSimulation(runArgs(["--game", "report-slug"]), { log: () => {} })).rejects.toThrow("suspended");
  });

  test("completed Mystery readback reveals roles only after the result", async () => {
    const { final } = await fixture();
    globalThis.fetch = Object.assign(async () => Response.json({ slug: "report-slug", status: "completed", view: projectWerewolfView(final, "mystery") }), { preconnect: originalFetch.preconnect });
    const { report } = await runWerewolfApiSimulation(runArgs(["--game", "report-slug", "--transcript"]), { log: () => {} });
    const cast = report.split("\n").find(line => line.startsWith("Cast"));
    expect(cast).toBe(`Cast (mystery): ${final.players.map(player => player.name).join(", ")}`);
    expect(report.indexOf("Roles revealed:")).toBeGreaterThan(report.indexOf("Result:"));
    expect(report).toContain("(dead)");
    expect(report).not.toContain("unknown");
    expect(report).not.toMatch(/\[(werewolf|villager|seer|doctor)\]/);
    for (const player of final.players) expect(report).toContain(`${player.name}: Compare the claims.`);
  });

  test("preserves the created game's identity and resume command when the first read fails", async () => {
    process.env.INFLUENCE_API_SESSION_TOKEN = "test-session";
    const args = runArgs();
    let calls = 0;
    globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
      calls++;
      return init?.method === "POST" ? Response.json({ id: "already-created", slug: "saved-game" }) : Response.json({ error: "Read unavailable" }, { status: 503 });
    }, { preconnect: originalFetch.preconnect });
    await expect(runWerewolfApiSimulation(args, { log: () => {} })).rejects.toThrow("503");
    const report = await readFile(args.out, "utf8");
    expect(report).toContain("http://localhost:3001/games/saved-game/replay?audience=mystery");
    expect(report).toContain("--game 'already-created'");
    expect(report).toContain("Report stopped:");
    expect(calls).toBe(2);
  });

  test("emits honest waiting updates without repeating events and preserves the report on timeout", async () => {
    const { initial } = await fixture();
    globalThis.fetch = Object.assign(async () => Response.json({ slug: "report-slug", status: "in_progress", view: projectWerewolfView(initial, "mystery") }), { preconnect: originalFetch.preconnect });
    const args = runArgs(["--game", "report-slug", "--timeout-seconds", "65"]);
    let now = 0;
    await expect(runWerewolfApiSimulation(args, { now: () => now, sleep: async ms => { now += ms; }, log: () => {} })).rejects.toThrow("continues on the server");
    const report = await readFile(args.out, "utf8");
    expect(report.match(/\[Waiting/g)).toHaveLength(2);
    expect(report.match(/Cast \(mystery\)/g)).toHaveLength(1);
    expect(report).toContain("no new public update yet");
    expect(report).toContain("--game 'report-slug'");
    expect(report).not.toContain("Result:");
  });

  test("live ballot readiness changes without public events, heartbeats stay informative, and reveal remains once", async () => {
    const { events, final } = await fixture();
    const boundary = events.findIndex(event => event.type === "werewolf.phase_started" && event.payload.phase === "vote");
    const state = replayWerewolf(events.slice(0, boundary + 1));
    const view = projectWerewolfView(state, "mystery");
    const total = state.aliveIds.length;
    const counts = [0, 3, 3, 3, total];
    let polls = 0, now = 0;
    globalThis.fetch = Object.assign(async () => {
      const ready = counts[polls++];
      return Response.json(ready === undefined
        ? { slug: "report-slug", status: "completed", view: projectWerewolfView(final, "mystery"), voteProgress: null }
        : { slug: "report-slug", status: "in_progress", view, voteProgress: {
          kind: "day_vote", voteMode: "majority", day: 1, thread: 1, total, ready, requiredVotes: Math.floor(total / 2) + 1,
        } });
    }, { preconnect: originalFetch.preconnect });
    const { report } = await runWerewolfApiSimulation(runArgs(["--game", "report-slug", "--transcript"]), {
      now: () => now, sleep: async () => { now += 15_000; }, log: () => {},
    });
    const updates = report.split("\n").filter(line => line.startsWith("[Voting"));
    expect(updates).toHaveLength(4);
    expect(updates[0]).toContain(`0/${total} decisions ready`);
    expect(updates[1]).toContain(`3/${total} decisions ready`);
    expect(updates[2]).toContain("[Voting 45s]");
    expect(updates[2]).toContain("ballots sealed");
    expect(report).toContain("Choices reveal together; no public speech during voting");
    expect(report.match(/\[Vote\]/g)).toHaveLength(1);
    expect(updates[3]).toContain("All decisions ready; committing ballots and resolving");
    expect(updates.join("\n")).not.toMatch(/Player|Abstain|PRIVATE_THINKING|SECRET_PACK/);
    expect(report.indexOf("All decisions ready")).toBeLessThan(report.indexOf("Ballots:"));
    expect(report.match(/  Ballots:/g)).toHaveLength(final.history.filter(entry => entry.kind === "vote").length);
    expect(report.match(/Result:/g)).toHaveLength(1);
    expect(report).not.toContain("no new public update yet");
  });

  test("rejects inconsistent live counts rather than displaying fabricated progress", async () => {
    const { events } = await fixture();
    const boundary = events.findIndex(event => event.type === "werewolf.phase_started" && event.payload.phase === "vote");
    const state = replayWerewolf(events.slice(0, boundary + 1));
    globalThis.fetch = Object.assign(async () => Response.json({ slug: "report-slug", status: "in_progress",
      view: projectWerewolfView(state, "mystery"), voteProgress: { kind: "day_vote", voteMode: "majority", day: 1, thread: 1,
        total: state.aliveIds.length, ready: state.aliveIds.length + 1, requiredVotes: Math.floor(state.aliveIds.length / 2) + 1 } }),
    { preconnect: originalFetch.preconnect });
    await expect(runWerewolfApiSimulation(runArgs(["--game", "report-slug"]), { log: () => {} })).rejects.toThrow("Invalid Werewolf vote progress");
  });

  test("an existing report is never overwritten and prevents game creation", async () => {
    const args = runArgs();
    await writeFile(args.out, "Previous game");
    let called = false;
    globalThis.fetch = Object.assign(async () => { called = true; return Response.json({}); }, { preconnect: originalFetch.preconnect });
    await expect(runWerewolfApiSimulation(args, { log: () => {} })).rejects.toThrow("EEXIST");
    expect(called).toBe(false);
    expect(await readFile(args.out, "utf8")).toBe("Previous game");
  });

  test("Mystery never gains private night facts when formatting the same canonical game", async () => {
    const { final } = await fixture();
    const mystery = projectWerewolfView(final, "mystery");
    const report = mystery.entries.map(entry => werewolfReportEntry(entry, mystery, true)).join("\n");
    expect(report).not.toContain("SECRET_PACK");
    expect(report).not.toContain("Seer checked");
    expect(report).not.toContain("Doctor protected");
    expect(report).not.toContain("Pack targeted");
  });

  test("roles follow the audience; cues remain separate notes and passes remain recorded", async () => {
    const { final } = await fixture();
    const view = projectWerewolfView(final, "omniscient");
    for (const [text, unavailable] of [["A claim.", false], [null, false], [null, true]] as const) {
      const entry: WerewolfPublicEntry = { kind: "discussion", day: 1, contribution: {
        thread: 1, openerId: "p0", stage: "reply", recipientIds: [], replyToTurn: null, nextSpeakerId: null, turn: 2, publicHistoryPosition: 10,
        actorId: "p1", text, cue: unavailable ? null : "A brittle laugh.", unavailable,
      } };
      expect(werewolfReportEntry(entry, view)).toContain(`Player 1 [${final.roles.p1}]: ${unavailable ? "[unavailable]" : text ?? "[pass]"}`);
      expect(werewolfReportEntry(entry, view)).not.toContain("brittle");
      if (!unavailable) expect(werewolfReportEntry(entry, view, true)).toContain("[production note: A brittle laugh.]");
      expect(werewolfReportEntry(entry, { ...view, audience: "mystery" }, true)).not.toMatch(/\[(werewolf|villager|seer|doctor)\]/);
    }
  });
});
