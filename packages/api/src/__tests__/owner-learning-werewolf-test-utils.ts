import { randomUUID } from "node:crypto";
import { replayWerewolf, runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";

export async function playedWerewolfReview(db: DrizzleDB, existingOwner?: string) {
  const ownerUserId = existingOwner ?? randomUUID();
  if (!existingOwner) await db.insert(schema.users).values({ id: ownerUserId });
  const profiles = [];
  for (let i = 0; i < 8; i++) profiles.push((await createOwnedAgentProfile(db, { userId: ownerUserId }, {
    name: `Learner ${i}`, personality: "Patient", gender: "non-binary", personaKey: "observer", backstory: "Librarian",
    strategyStyle: "INFLUENCE_ONLY", werewolfStrategyStyle: null,
  })).profile);
  const game = await createWerewolfGame(db, ownerUserId, { preset: "two_wolves", agentProfileIds: profiles.map(p => p.id), maxDays: 1, visibility: "unlisted" });
  const claim = await claimWerewolfGame(db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db, game.id, claim.claim.ownerEpoch);
  const initial = replayWerewolf(await store.read());
  const wolves = initial.players.filter(p => initial.roles[p.id] === "werewolf");
  const villager = initial.players.find(p => initial.roles[p.id] === "villager")!;
  const agent: WerewolfAgent = { async decide({ request }) {
    if (request.action === "open_thread") return { kind: "opening", recipientIds: request.legalRecipientIds.slice(0, 3), text: "What changed?", cue: null };
    if (["attack", "protect", "investigate", "vote"].includes(request.action)) return {
      kind: "target", targetId: request.action === "vote" ? (request.voteMode === "plurality" ? request.legalTargetIds[0]! : null) : request.legalTargetIds.includes(villager.id) ? villager.id : request.legalTargetIds[0]!,
      thinking: `OWN_THINKING_${request.actorId}`,
    };
    return { kind: "speech", text: request.action === "pack_talk" ? "PRIVATE_PACK" : "PUBLIC_DIALOGUE", cue: null };
  } };
  await runWerewolf(store, agent);
  return { ownerUserId, game, profiles, wolves, villager };
}
