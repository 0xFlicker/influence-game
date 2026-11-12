import { schema, type DrizzleDB } from "../db/index.js";
import {
  assignPlayerVoice,
  isPlayerVoiceId,
} from "@influence/engine/voice-catalog";
type Writer = Pick<DrizzleDB, "insert">;
export async function publishSubmittedVoice(
  tx: Writer,
  profile: typeof schema.agentProfiles.$inferSelect,
  snapshot: Record<string, unknown>,
) {
  const raw = snapshot.voiceAssignment;
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Submitted voice is invalid");
  const voice = raw as { voiceId?: unknown; origin?: unknown };
  if (
    !isPlayerVoiceId(voice.voiceId) ||
    !["automatic", "selected"].includes(String(voice.origin))
  )
    throw new Error("Submitted voice is invalid");
  const assignment = assignPlayerVoice(
    profile.id,
    profile.gender,
    voice.origin === "selected" ? voice.voiceId : undefined,
  );
  await tx
    .insert(schema.agentVoices)
    .values({ agentProfileId: profile.id, assignment })
    .onConflictDoUpdate({
      target: schema.agentVoices.agentProfileId,
      set: { assignment, updatedAt: new Date() },
    });
}
