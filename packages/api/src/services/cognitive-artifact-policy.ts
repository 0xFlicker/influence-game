import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactType,
} from "../db/schema.js";
import type { GamesMcpClaims } from "../game-mcp/claims.js";
import type { MatchAccessContext } from "./match-access-context.js";
import { hasPrivateMatchLaneAccess } from "./match-access-context.js";

export type CognitiveArtifactAuthProfile = "subject" | "producer" | "admin_api";

/**
 * Explicit cognition surface capability (U5 will enforce fully).
 * Callers must pass a capability rather than relying on incidental role metadata.
 * Producer/sysop claim metadata must never widen a subject_owner surface.
 */
export type CognitionSurfaceCapability =
  | "subject_owner"
  | "participant_web"
  | "producer";

export interface CognitiveArtifactAccessor {
  userId?: string;
  authProfile: CognitiveArtifactAuthProfile;
  roles?: readonly string[];
  permissions?: readonly string[];
  claims?: GamesMcpClaims;
  /**
   * Optional per-game ownership snapshot. When present for a matching gameId,
   * ownership checks prefer this immutable seat set over cross-game claims.
   */
  matchAccess?: MatchAccessContext;
  /**
   * Explicit surface capability. U5 applies subject_owner to Production MCP;
   * absent capability preserves pre-U5 behavior for existing call sites.
   */
  surfaceCapability?: CognitionSurfaceCapability;
}

export interface CognitiveArtifactPolicyContext {
  gameId: string;
  artifactType: CognitiveArtifactType;
  actorRole: CognitiveArtifactActorRole;
  action?: string | null;
  phase?: string | null;
  actorPlayerId?: string | null;
  actorUserId?: string | null;
  actorAgentProfileId?: string | null;
}

export function hasProducerCognitiveArtifactAccess(accessor: CognitiveArtifactAccessor): boolean {
  // Explicit subject_owner surfaces never widen via producer/sysop metadata.
  if (accessor.surfaceCapability === "subject_owner") {
    return false;
  }
  if (accessor.surfaceCapability === "producer") {
    return true;
  }
  const roles = new Set(accessor.roles ?? []);
  const permissions = new Set(accessor.permissions ?? []);
  return accessor.authProfile === "producer" ||
    accessor.authProfile === "admin_api" ||
    roles.has("sysop") ||
    roles.has("producer") ||
    permissions.has("view_admin") ||
    permissions.has("manage_roles");
}

export function ownsCognitiveArtifactActor(
  accessor: CognitiveArtifactAccessor,
  context: Pick<CognitiveArtifactPolicyContext, "actorPlayerId" | "actorUserId" | "actorAgentProfileId"> & {
    gameId?: string;
  },
): boolean {
  if (!accessor.userId) return false;
  if (context.actorUserId && context.actorUserId === accessor.userId) return true;

  const matchAccess = accessor.matchAccess;
  if (matchAccess && (!context.gameId || matchAccess.gameId === context.gameId)) {
    if (context.actorPlayerId && matchAccess.ownedPlayerIds.has(context.actorPlayerId)) {
      return true;
    }
    if (
      context.actorAgentProfileId
      && matchAccess.ownedAgentProfileIds.has(context.actorAgentProfileId)
    ) {
      return true;
    }
    return false;
  }

  const claims = accessor.claims;
  if (context.actorPlayerId && claims?.playerIds.has(context.actorPlayerId)) return true;
  if (context.actorAgentProfileId && claims?.agentProfileIds.has(context.actorAgentProfileId)) {
    return true;
  }
  return false;
}

export function canReadCognitiveArtifact(
  accessor: CognitiveArtifactAccessor,
  context: CognitiveArtifactPolicyContext,
): boolean {
  if (hasProducerCognitiveArtifactAccess(accessor)) return true;
  if (accessor.authProfile !== "subject") return false;

  if (!subjectHasParticipatingGameAccess(accessor, context.gameId)) return false;

  if (
    context.actorRole === "house" ||
    context.actorRole === "system" ||
    context.actorRole === "producer"
  ) {
    return false;
  }

  // subject_owner (U5 Production MCP) requires ownership for every artifact type.
  if (accessor.surfaceCapability === "subject_owner") {
    return ownsCognitiveArtifactActor(accessor, context);
  }

  if (context.artifactType === "reasoning") {
    return ownsCognitiveArtifactActor(accessor, context);
  }
  if (isAllianceHuddleArtifactContext(context)) {
    return ownsCognitiveArtifactActor(accessor, context);
  }
  return context.artifactType === "thinking" || context.artifactType === "strategy";
}

function isAllianceHuddleArtifactContext(context: CognitiveArtifactPolicyContext): boolean {
  return context.action === "alliance-action" ||
    context.action?.startsWith("alliance-huddle-") === true ||
    context.phase === "MINGLE_I" ||
    context.phase === "PRE_VOTE_HUDDLE" ||
    context.phase === "PRE_COUNCIL_HUDDLE";
}

export function canListCognitiveArtifactsForGame(
  accessor: CognitiveArtifactAccessor,
  gameId: string,
): boolean {
  if (hasProducerCognitiveArtifactAccess(accessor)) return true;
  return accessor.authProfile === "subject" &&
    subjectHasParticipatingGameAccess(accessor, gameId);
}

/**
 * Participating ownership for cognition — creator-only is not enough when a
 * MatchAccessContext is supplied (private lane semantics).
 */
function subjectHasParticipatingGameAccess(
  accessor: CognitiveArtifactAccessor,
  gameId: string,
): boolean {
  const matchAccess = accessor.matchAccess;
  if (matchAccess && matchAccess.gameId === gameId) {
    return hasPrivateMatchLaneAccess(matchAccess);
  }
  return Boolean(accessor.claims?.joinedGameIds.has(gameId));
}
