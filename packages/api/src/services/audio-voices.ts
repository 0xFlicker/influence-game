import { eq, inArray } from "drizzle-orm";
import { assignPlayerVoice, HOUSE_VOICE, type VoiceAssignment } from "@influence/engine/voice-catalog";
import { schema, type DrizzleDB } from "../db/index.js";

export async function readAgentVoice(db: Pick<DrizzleDB,"select">, id: string): Promise<VoiceAssignment> {
  const [stored] = await db.select().from(schema.agentVoices).where(eq(schema.agentVoices.agentProfileId, id));
  if (stored) return stored.assignment;
  const [agent] = await db.select({ gender: schema.agentProfiles.gender }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id));
  if (!agent) throw new Error("Agent not found");
  return assignPlayerVoice(id, agent.gender ?? null);
}
/** Preview is read-only; freeze these exact assignments when starting the track. */
export async function gameVoiceRoster(db:Pick<DrizzleDB,"select">,gameId:string) {
  const players = await db.select({ id: schema.gamePlayers.id, agentId: schema.gamePlayers.agentProfileId }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  const [start] = await db.select({event:schema.werewolfEvents.event}).from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId,gameId)).orderBy(schema.werewolfEvents.sequence).limit(1);
  if (start?.event.type === "werewolf.started") players.push(...start.event.payload.players.map(player => ({id:player.id,agentId:player.agentProfileId ?? null})));
  return players;
}
export async function previewGameVoices(db:Pick<DrizzleDB,"select">,gameId:string):Promise<Record<string,VoiceAssignment>> {
  const players=await gameVoiceRoster(db,gameId);
  const ids=players.flatMap(player=>player.agentId ? [player.agentId] : []);
  const profiles=new Set(ids.length ? (await db.select({id:schema.agentProfiles.id}).from(schema.agentProfiles).where(inArray(schema.agentProfiles.id,ids))).map(row=>row.id) : []);
  const voices: Record<string, VoiceAssignment> = { house: HOUSE_VOICE };
  for (const player of players) voices[player.id] = player.agentId && profiles.has(player.agentId) ? await readAgentVoice(db, player.agentId) : assignPlayerVoice(player.agentId ?? player.id, null);
  return voices;
}

/** Called under the game-start lock, alongside the frozen roster. */
export async function freezeLiveVoices(tx:Pick<DrizzleDB,"select"|"insert">,gameId:string) {
  const [existing] = await tx.select({id:schema.gameAudioTracks.id}).from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.gameId,gameId));
  if (existing) return;
  const {storeJson} = await import("./payload-storage.js");
  const assignments=await previewGameVoices(tx,gameId);
  await persistGameVoiceDefaults(tx,gameId,assignments);
  const voices = await storeJson(assignments);
  await tx.insert(schema.gameAudioTracks).values({gameId,mode:"live",status:"ready",active:true,voices,budgetUsd:0});
}

export async function persistGameVoiceDefaults(tx:Pick<DrizzleDB,"select"|"insert">,gameId:string,voices:Record<string,VoiceAssignment>) {
  for (const player of await gameVoiceRoster(tx,gameId)) {
    if (!player.agentId || !voices[player.id]) continue;
    const [profile]=await tx.select({id:schema.agentProfiles.id}).from(schema.agentProfiles).where(eq(schema.agentProfiles.id,player.agentId));
    if (profile) await tx.insert(schema.agentVoices).values({agentProfileId:profile.id,assignment:voices[player.id]!}).onConflictDoNothing();
  }
}
