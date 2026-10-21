import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { schema } from "../db/index.js";
import { createGameRoutes } from "../routes/games.js";
import { setupTestDB } from "./test-utils.js";

const enabled = process.env.NEXT_PUBLIC_ENABLED_GAMES;
afterEach(() => {
  if (enabled === undefined) delete process.env.NEXT_PUBLIC_ENABLED_GAMES;
  else process.env.NEXT_PUBLIC_ENABLED_GAMES = enabled;
});

describe("recently finished homepage games", () => {
  test("selects the latest public completion per kind without exposing private metadata", async () => {
    process.env.NEXT_PUBLIC_ENABLED_GAMES = "influence,werewolf";
    const db = await setupTestDB();
    const base = {status: "completed" as const, config: JSON.stringify({visibility:"public", secret:"PRIVATE_CONFIG"}), createdAt:"2026-10-01T00:00:00Z", endedAt:"2026-10-20T12:00:00Z"};
    const fixtures: (typeof schema.games.$inferInsert)[] = [
      {...base, id:randomUUID(),slug:"latest-influence",gameKind:"influence",createdAt:"2026-09-01T00:00:00Z"},
      {...base, id:randomUUID(),slug:"newer-start-older-finish",gameKind:"influence",endedAt:"2026-10-19T12:00:00Z"},
      {...base, id:randomUUID(),slug:"latest-werewolf",gameKind:"werewolf"},
      {...base, id:randomUUID(),slug:"older-werewolf",gameKind:"werewolf",endedAt:"2026-10-18T12:00:00Z"},
      {...base, id:randomUUID(),slug:"hidden",hiddenAt:"2026-10-20T00:00:00Z",endedAt:"2026-10-21T12:00:00Z"},
      {...base, id:randomUUID(),slug:"private",config:JSON.stringify({visibility:"private"}),endedAt:"2026-10-21T12:00:00Z"},
      {...base, id:randomUUID(),slug:"cancelled",status:"cancelled",endedAt:"2026-10-21T12:00:00Z"},
      {...base, id:randomUUID(),slug:"missing-completion",endedAt:null},
    ];
    await db.insert(schema.games).values(fixtures);
    const app = new Hono().route("/",createGameRoutes(db));
    const response = await app.request("/api/games/recently-finished");
    expect(response.status).toBe(200);
    const games = await response.json() as Array<{slug:string;completedAt:string}>;
    expect(games.map((g: {slug:string}) => g.slug)).toEqual(["latest-influence", "latest-werewolf"]);
    expect(games[0]!.completedAt).toBe(base.endedAt);
    expect(Object.keys(games[0]!).sort()).toEqual(["cast","completedAt","gameKind","id","slug","title"]);
    expect(JSON.stringify(games)).not.toContain("PRIVATE_CONFIG");
    process.env.NEXT_PUBLIC_ENABLED_GAMES = "werewolf";
    const wolves = await (await app.request("/api/games/recently-finished")).json() as Array<{slug:string}>;
    expect(wolves.map(g => g.slug)).toEqual(["latest-werewolf"]);
  });

  test("returns an empty selection when nothing has finished", async () => {
    const db = await setupTestDB();
    const app = new Hono().route("/",createGameRoutes(db));
    expect(await (await app.request("/api/games/recently-finished")).json()).toEqual([]);
  });
});
