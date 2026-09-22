import { and, asc, eq } from "drizzle-orm";
import { Phase } from "@influence/engine";
import { visualRoomForPhase } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";

/** Viewer selection only; no accepted game or transcript records are rewritten. */
export async function readViewerMedia(db: DrizzleDB, gameId: string, snapshot?: Record<string, number>) {
  const [scenes, publications, versions, dialogue, stages] = await Promise.all([
    db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, gameId)).orderBy(asc(schema.visualScenes.boundarySequence)),
    db.select().from(schema.visualMediaPublications).where(eq(schema.visualMediaPublications.gameId, gameId)).orderBy(asc(schema.visualMediaPublications.revision)),
    db.select().from(schema.visualMediaVersions).where(eq(schema.visualMediaVersions.gameId, gameId)),
    db.select({ sequence: schema.transcripts.entrySequence, kind: schema.transcripts.dialogueKind, scope: schema.transcripts.scope, phase: schema.transcripts.phase, speaker: schema.transcripts.speakerPlayerId,
      context: schema.transcripts.safeContext, audience: schema.transcripts.audiencePlayerIds, turn: schema.gameTurns.turnSequence, baseEvents: schema.gameTurns.baseEventSequence }).from(schema.transcripts)
      .innerJoin(schema.gameTurns, eq(schema.transcripts.gameTurnId, schema.gameTurns.id))
      .where(and(eq(schema.transcripts.gameId, gameId), eq(schema.gameTurns.status, "committed"))),
    db.select({ sequence: schema.gameEvents.sequence, envelope: schema.gameEvents.envelope }).from(schema.gameEvents).where(and(eq(schema.gameEvents.gameId, gameId), eq(schema.gameEvents.eventType, "endgame.stage_set"))).orderBy(asc(schema.gameEvents.sequence)),
  ]);
  const bindings: Record<string, string> = {};
  for (const row of dialogue) {
    if (!row.sequence || !row.speaker || row.scope === "diary" || row.scope === "thinking" || row.context?.presentationPurpose === "farewell" || row.context?.acceptedBallot) continue;
    if (row.context?.visualScene) { bindings[row.sequence] = row.context.visualScene.id; continue; }
    const phase = row.phase as Phase;
    if (phase === Phase.INTRODUCTION || (phase === Phase.MINGLE || phase === Phase.MINGLE_I || phase === Phase.POST_VOTE_MINGLE || phase === Phase.FORMAT_MINGLE) && row.context?.roomId == null) continue;
    const stage = stages.filter(s => s.sequence <= row.baseEvents).at(-1)?.envelope;
    const stageValue = (stage?.payload as { stage?: unknown } | undefined)?.stage;
    const endgame = stageValue === "reckoning" || stageValue === "tribunal" || stageValue === "judgment" ? stageValue : undefined;
    const room = visualRoomForPhase(phase, row.context?.roomId, endgame);
    if (!room) continue;
    const scene = scenes.filter(s => s.roomId === room && s.boundarySequence < row.turn && s.afterDialogueSequence < row.sequence!).at(-1);
    if (!scene || !scene.plan.cast.some(m => m.id === row.speaker)) continue;
    // Private-room audiences must match exactly; public phase casts come from the saved scene plan.
    if (room.startsWith("mingle-")) {
      const members = new Set([row.speaker, ...(row.audience ?? [])]);
      if (members.size !== scene.plan.cast.length || scene.plan.cast.some(m => !members.has(m.id))) continue;
    }
    bindings[row.sequence] = scene.id;
  }
  const url = (id: string) => `/api/games/${gameId}/visual/artifacts/${id}`;
  const selection = snapshot ?? Object.fromEntries(publications.map(p => [p.sceneId, p.revision]));
  return { publicationSnapshot: selection, bindings,
    scenes: scenes.flatMap(scene => {
      const selected = publications.find(p => p.sceneId === scene.id && p.revision === selection[scene.id]);
      const version = selected && versions.find(v => v.id === selected.versionId);
      const image = version?.imageArtifactId ?? (scene.status === "ready" ? scene.imageArtifactId : null);
      if (!image) return [];
      return [{ id: scene.id, roomId: scene.roomId, version: scene.boundarySequence, mediaVersionId: version?.id ?? null, publicationRevision: selected?.revision ?? 0,
        afterDialogueSequence: scene.afterDialogueSequence, imageUrl: url(image), participantIds: (version?.plan ?? scene.plan).cast.map(m => m.id), anchors: version?.localization.anchors ?? scene.anchors ?? [] }];
    }),
  };
}
