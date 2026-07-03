import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactType,
} from "../db/schema.js";
import type { GamesMcpClaims } from "../game-mcp/claims.js";

export type CognitiveArtifactAuthProfile = "subject" | "producer" | "admin_api";

export interface CognitiveArtifactAccessor {
  userId?: string;
  authProfile: CognitiveArtifactAuthProfile;
  roles?: readonly string[];
  permissions?: readonly string[];
  claims?: GamesMcpClaims;
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
  context: Pick<CognitiveArtifactPolicyContext, "actorPlayerId" | "actorUserId" | "actorAgentProfileId">,
): boolean {
  if (!accessor.userId) return false;
  const claims = accessor.claims;
  if (context.actorUserId && context.actorUserId === accessor.userId) return true;
  if (context.actorPlayerId && claims?.playerIds.has(context.actorPlayerId)) return true;
  if (context.actorAgentProfileId && claims?.agentProfileIds.has(context.actorAgentProfileId)) return true;
  return false;
}

export function canReadCognitiveArtifact(
  accessor: CognitiveArtifactAccessor,
  context: CognitiveArtifactPolicyContext,
): boolean {
  if (hasProducerCognitiveArtifactAccess(accessor)) return true;
  if (accessor.authProfile !== "subject") return false;
  const claims = accessor.claims;
  if (!claims?.joinedGameIds.has(context.gameId)) return false;
  if (
    context.actorRole === "house" ||
    context.actorRole === "system" ||
    context.actorRole === "producer"
  ) {
    return false;
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
    Boolean(accessor.claims?.joinedGameIds.has(gameId));
}
