import { fixtureWerewolfRetrospective, fixtureRetrospectiveCapacity } from "@influence/engine";
import { randomUUID } from "node:crypto";
import { legacyWerewolfConfig, replayWerewolf, runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";
import { eq } from "drizzle-orm";

export async function playedWerewolfReview(db: DrizzleDB, existingOwner?: string) {
  const ownerUserId = existingOwner ?? randomUUID();
  if (!existingOwner) await db.insert(schema.users).values({ id: ownerUserId });
  const profiles = [];
  for (let i = 0; i < 8; i++) profiles.push((await createOwnedAgentProfile(db, { userId: ownerUserId }, {
    name: `Learner ${i}`, personality: "Patient", gender: "non-binary", personaKey: "observer", backstory: "Librarian",
    strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: null,
  })).profile);
  const game = await createWerewolfGame(db, ownerUserId, { preset: "two_wolves", agentProfileIds: profiles.map(p => p.id), maxDays: 1, visibility: "unlisted" });
  // Owner-learning parity is a replay of the historical thread/checkpoint
  // flow. Pin its starting event explicitly so it does not inherit fresh-game
  // defaults when the active rules version advances.
  const [started] = await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, game.id));
  if (!started || started.event.type !== "werewolf.started") throw new Error("Expected started Werewolf fixture");
  const historicalStart = { ...started.event, payload: { ...started.event.payload, config: legacyWerewolfConfig("two_wolves", 1) } };
  await db.update(schema.werewolfEvents).set({ event: historicalStart }).where(eq(schema.werewolfEvents.gameId, game.id));
  const [gameRow] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
  if (gameRow) await db.update(schema.games).set({ config: JSON.stringify({ ...(JSON.parse(gameRow.config ?? "{}") as Record<string, unknown>), rulesVersion: 8 }) }).where(eq(schema.games.id, game.id));
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  const initial = replayWerewolf(await store.read());
  const wolves = initial.players.filter(p => initial.roles[p.id] === "werewolf");
  const villager = initial.players.find(p => initial.roles[p.id] === "villager")!;
  const agent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective, async decide({ request }) {
    // One spoken thread retains public replies/answers without playing a full
    // discussion for every seat in each owner-learning workflow test.
    if (request.action === "open_thread") return request.actorId === wolves[0]!.id
      ? { kind: "opening", recipientIds: request.legalRecipientIds.slice(0, 3), text: "What changed?", cue: null }
      : { kind: "opening", recipientIds: [], text: null, cue: null };
    if (["attack", "protect", "investigate", "vote"].includes(request.action)) return {
      kind: "target", targetId: request.action === "vote" ? (request.voteMode === "plurality" ? request.legalTargetIds[0]! : null) : request.legalTargetIds.includes(villager.id) ? villager.id : request.legalTargetIds[0]!,
      thinking: `OWN_THINKING_${request.actorId}`,
    };
    return { kind: "speech", text: request.action === "pack_talk" ? "PRIVATE_PACK" : "PUBLIC_DIALOGUE", cue: null };
  } };
  await runWerewolf(store, agent);
  return { ownerUserId, game, profiles, wolves, villager };
}
