import { beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createHouseShareRoutes } from "../routes/house-share-links.js";
import { admitShareCreation, saveShareLink } from "../services/house-share-links.js";
import { parseHouseShareTarget } from "@influence/engine/house-share-target";
import { setupTestDB } from "./test-utils.js";
import { schema, type DrizzleDB } from "../db/index.js";
let db: DrizzleDB;
beforeEach(async () => {
  db = await setupTestDB(); process.env.JWT_SECRET = "short-share-tests";
  await db.insert(schema.games).values({id: "share-game", slug: "red-fox", gameKind: "werewolf", status: "completed", config: JSON.stringify({visibility: "unlisted"})});
});
const post = (app: ReturnType<typeof createHouseShareRoutes>, path: string, headers = {}) => app.request("/api/share-links", {method: "POST", headers: {"Content-Type": "application/json", ...headers}, body: JSON.stringify({path})});

test("anonymous creation deduplicates immutable replay coordinates across instances", async () => {
  const target = parseHouseShareTarget("/games/red-fox/replay?audience=omniscient&cursor=3&cue=id%3A3&t=1.25&speed=2&thinking=1&muted=0&volume=0.6");
  const links = await Promise.all(Array.from({length: 12}, () => saveShareLink(db, target)));
  expect(new Set(links.map(link => link.code)).size).toBe(1);
  expect(links[0]!.code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
  const app = createHouseShareRoutes(db), response = await post(app, target.path);
  expect(response.status).toBe(200);
  const created = await response.json() as {code:string;path:string}; expect(created.path).toBe(`/s/${links[0]!.code}`);
  const resolved = await app.request(`/api/share-links/${links[0]!.code}?t=99&redirect=https://evil.test`);
  expect(((await resolved.json()) as {path:string}).path).toBe(target.path);
  expect((await db.select().from(schema.houseShareLinks))).toHaveLength(1);
});

test("unknown, hidden, incomplete and mismatched targets cannot become share links", async () => {
  const app = createHouseShareRoutes(db);
  for (const path of ["https://thehouse.game/rules", "//evil.test", "/admin", "/games/red-fox/replay?token=secret"]) expect((await post(app, path)).status).toBe(400);
  for (const path of ["/games/missing", "/profile/missing", "/games/red-fox/replay/3"]) expect((await post(app, path)).status).toBe(404);
  await db.update(schema.games).set({status:"in_progress"}).where(eq(schema.games.id,"share-game"));
  expect((await post(app,"/games/red-fox/replay")).status).toBe(404);
  expect((await post(app,"/games/red-fox")).status).toBe(200);
  await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,"share-game"));
  const response = await post(app, "/games/red-fox/replay"); const {code} = await response.json() as {code:string;path:string};
  await db.update(schema.games).set({hiddenAt: new Date().toISOString()}).where(eq(schema.games.id, "share-game"));
  expect((await app.request(`/api/share-links/${code}`)).status).toBe(404);
  expect((await post(app, "/games/red-fox")).status).toBe(404);
  expect((await app.request("/api/share-links/123456789A")).status).toBe(404);
});

test("creation rejects unexpected fields and oversized or malformed bodies", async () => {
  const app=createHouseShareRoutes(db);
  for(const body of ['{"path":"/rules","redirect":"https://evil.test"}',"null","[]","invalid"]){
    expect((await app.request("/api/share-links",{method:"POST",headers:{"Content-Type":"application/json"},body})).status).toBe(400);
  }
  expect((await post(app,"/rules?"+"a".repeat(5000))).status).toBe(413);
});

test("shared atomic minute allowance rejects automation and expires without daily caps", async () => {
  await db.insert(schema.houseShareRateLimits).values({key: "visitor:v", count: 119, resetAt: new Date(Date.now() + 60_000)});
  const outcomes = await Promise.allSettled(Array.from({length: 8}, () => admitShareCreation(db, "v", "source")));
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  await db.execute(sql`UPDATE house_share_rate_limits SET reset_at = now() - interval '1 second'`);
  await admitShareCreation(db, "v", "source");
  await db.insert(schema.houseShareRateLimits).values({key: "source:blocked", count: 6000, resetAt: new Date(Date.now() + 60_000)});
  await expect(admitShareCreation(db, "new-cookie", "blocked")).rejects.toThrow("Too many");
});

test("forged forwarding headers do not evade the ingress limit; reads remain available", async () => {
  const app = createHouseShareRoutes(db);
  const response = await post(app, "/rules"); const {code} = await response.json() as {code:string;path:string};
  await db.execute(sql`UPDATE house_share_rate_limits SET count = 6000 WHERE key LIKE 'source:%'`);
  const blocked = await post(createHouseShareRoutes(db), "/about", {"X-Forwarded-For": "1.2.3.4", "CF-Connecting-IP": "4.3.2.1"});
  expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
  expect((await app.request(`/api/share-links/${code}`)).status).toBe(200);
});
