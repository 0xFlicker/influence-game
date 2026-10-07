import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { loadHouseCutSource } from "../services/house-cut-source.js";
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function fixture() {
  const id = "cut-source-game", slug = "cut-source-slug";
  const events = await werewolfResultsFixture("village", id);
  await db.insert(schema.games).values({ id, slug, gameKind: "werewolf", status: "completed", config: '{"visibility":"public"}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  return { id, slug, events };
}
test("real loader supports direct Public and Unlisted reads, with audience isolation and no writes", async () => {
  const { id, slug, events } = await fixture();
  for (const visibility of ["public", "unlisted"]) {
    await db.update(schema.games).set({ config: JSON.stringify({ visibility }) }).where(eq(schema.games.id, id));
    const mystery = await loadHouseCutSource(db, slug, "mystery");
    const omni = await loadHouseCutSource(db, id, "omniscient");
    expect(mystery.game).toEqual({ id, slug, kind: "werewolf" });
    expect(mystery.hash).not.toBe(omni.hash);
    expect(JSON.stringify(mystery)).not.toMatch(/SECRET_|protectedId|attackTargetId|investigation|winnerIds/);
    expect(mystery.evidence.every(e => e.replayHref?.includes("audience=mystery"))).toBe(true);
  }
  expect((await db.select().from(schema.werewolfEvents)).map(row => row.event)).toEqual(events);
  await expect(loadHouseCutSource(db, slug, "public")).rejects.toThrow("Choose mystery");
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  await expect(loadHouseCutSource(db, slug, "omniscient")).rejects.toThrow("unavailable");
});
test("missing, active and corrupt histories fail before any discovery", async () => {
  await expect(loadHouseCutSource(db, "missing", "mystery")).rejects.toThrow();
  const { id, events } = await fixture();
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, id));
  await expect(loadHouseCutSource(db, id, "omniscient")).rejects.toThrow("completed");
  await db.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, id));
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence, events.length));
  await expect(loadHouseCutSource(db, id, "omniscient")).rejects.toThrow("complete");
});
