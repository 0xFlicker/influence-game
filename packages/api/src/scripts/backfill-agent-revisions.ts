import { sql } from "drizzle-orm";
import { closeDB, createDB, type DrizzleDB, schema } from "../db/index.js";
import {
  ensureActiveAgentRevisionInTransaction,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "../services/agent-revisions.js";

export interface AgentRevisionBackfillResult {
  profilesScanned: number;
  revisionsCreated: number;
  revisionsReused: number;
  countersRecomputed: number;
}

export async function backfillAgentRevisions(db: DrizzleDB): Promise<AgentRevisionBackfillResult> {
  const profiles = await db.select().from(schema.agentProfiles);
  let revisionsCreated = 0;

  for (const profile of profiles) {
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM agent_profiles
        WHERE id = ${profile.id}
        FOR UPDATE
      `);
      const currentProfile = (await tx.select().from(schema.agentProfiles)
        .where(sql`${schema.agentProfiles.id} = ${profile.id}`)
        .limit(1))[0];
      if (!currentProfile || currentProfile.currentRevisionId) return false;
      const ensured = await ensureActiveAgentRevisionInTransaction(tx, {
        profile: currentProfile,
        effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(currentProfile),
        trigger: "initial_backfill",
      });
      return ensured.created;
    });
    if (created) revisionsCreated += 1;
  }

  const recomputed = await db.execute(sql`
    UPDATE agent_profiles AS profile
    SET games_played = (
          SELECT count(*)::int
          FROM game_players AS player
          JOIN games AS game ON game.id = player.game_id
          WHERE player.agent_profile_id = profile.id
            AND game.status = 'completed'
        ),
        games_won = (
          SELECT count(*)::int
          FROM game_players AS player
          JOIN games AS game ON game.id = player.game_id
          JOIN game_results AS result ON result.game_id = game.id
          WHERE player.agent_profile_id = profile.id
            AND game.status = 'completed'
            AND result.winner_id = player.id
        )
  `);

  return {
    profilesScanned: profiles.length,
    revisionsCreated,
    revisionsReused: profiles.length - revisionsCreated,
    countersRecomputed: recomputed.count,
  };
}

if (import.meta.main) {
  try {
    const result = await backfillAgentRevisions(createDB());
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDB();
  }
}
