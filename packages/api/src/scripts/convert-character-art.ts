import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { bundledHouseBody } from "@influence/engine/house-character-art";
import { loadPayloads, payloadHash } from "../services/payload-storage.js";
import { isSavedCharacterArt, saveReadyCharacterArt } from "../services/character-art-save.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";

/** Explicit stopped-writer conversion only. Never imported by a playback route. */
export async function convertCharacterArt(db: DrizzleDB) {
  const participants = await db.execute(sql`INSERT INTO game_players (id, game_id, werewolf_player_id, agent_profile_id, persona, agent_config)
    SELECT gen_random_uuid()::text, event.game_id, player->>'id', profile.id,
      CASE WHEN profile.id IS NULL THEN player::text ELSE jsonb_build_object('name', player->>'name')::text END, '{}'
    FROM werewolf_events event CROSS JOIN LATERAL jsonb_array_elements(event.event->'payload'->'players') player
    LEFT JOIN agent_profiles profile ON profile.id = player->>'agentProfileId'
    WHERE event.event->>'type' = 'werewolf.started' ON CONFLICT (game_id, werewolf_player_id) DO NOTHING RETURNING id`);
  const jobs = await db.select().from(schema.characterCutouts).where(eq(schema.characterCutouts.status, "ready"));
  if (!jobs.length) return { participantsCreated: participants.length, finishedImages: 0 };
  const sources: Array<{ profileId: string | null; gameId: string | null; playerId: string; url: string; hash?: string }> = [];
  for (const profile of await db.select().from(schema.agentProfiles)) {
    const url = profile.fullBodyReferenceUrl;
    if (!url || isSavedCharacterArt(url) || bundledHouseBody(url)) continue;
    const [revision] = profile.contentRevisionId ? await loadPayloads(db.select({ snapshot: schema.agentContentRevisions.snapshot })
      .from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.contentRevisionId))) : [];
    sources.push({ profileId: profile.id, gameId: null, playerId: profile.id, url, hash: (revision?.snapshot.assets as Record<string, string> | undefined)?.[url] });
  }
  for (const player of await db.select().from(schema.gamePlayers).where(sql`${schema.gamePlayers.agentProfileId} IS NULL`)) {
    const persona = JSON.parse(player.persona) as { fullBodyReferenceUrl?: string };
    if (persona.fullBodyReferenceUrl && !isSavedCharacterArt(persona.fullBodyReferenceUrl) && !bundledHouseBody(persona.fullBodyReferenceUrl))
      sources.push({ profileId: null, gameId: player.gameId, playerId: player.werewolfPlayerId ?? player.id, url: persona.fullBodyReferenceUrl });
  }
  for (const source of sources) {
    const hash = source.hash ?? payloadHash(await readVisualProfileImage(source.url, { name: "", personaKey: "" }));
    const job = jobs.find(job => job.sourceHash === hash);
    if (!job) continue;
    await db.transaction(async tx => {
      await tx.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts).where(eq(schema.characterCutouts.id, job.id)).for("update");
      await tx.insert(schema.characterCutoutDemands).values({ id: crypto.randomUUID(), agentProfileId: source.profileId,
        gameId: source.gameId, playerId: source.playerId, sourceKey: source.url, recipe: job.recipe, cutoutId: job.id }).onConflictDoNothing();
      await tx.update(schema.characterCutoutDemands).set({ cutoutId: job.id, error: null }).where(and(
        eq(schema.characterCutoutDemands.playerId, source.playerId), eq(schema.characterCutoutDemands.sourceKey, source.url), eq(schema.characterCutoutDemands.recipe, job.recipe)));
      await tx.update(schema.characterCutouts).set({ artSavedAt: null }).where(eq(schema.characterCutouts.id, job.id));
    });
  }
  for (const job of jobs) await saveReadyCharacterArt(db, job.id);
  return { participantsCreated: participants.length, finishedImages: jobs.length };
}

export async function assertCharacterArtConverted(db: DrizzleDB) {
  const missing = await db.execute(sql`SELECT event.game_id FROM werewolf_events event
    CROSS JOIN LATERAL jsonb_array_elements(event.event->'payload'->'players') player
    WHERE event.event->>'type' = 'werewolf.started' AND NOT EXISTS (
      SELECT 1 FROM game_players seat WHERE seat.game_id = event.game_id AND seat.werewolf_player_id = player->>'id'
    ) LIMIT 1`);
  if (missing.length) throw new Error("Historical Werewolf participants need the one-time character art conversion");
  const [job] = await db.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts)
    .where(and(eq(schema.characterCutouts.status, "ready"), isNull(schema.characterCutouts.artSavedAt))).limit(1);
  if (job) throw new Error("Finished character art has not been saved; run the conversion before starting this release");
}
