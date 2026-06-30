import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactType,
} from "../db/schema.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { CognitiveArtifactReadModel } from "../services/cognitive-artifact-read-model.js";
import {
  hasProducerCognitiveArtifactAccess,
  type CognitiveArtifactAccessor,
} from "../services/cognitive-artifact-policy.js";

export function createCognitiveArtifactRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  const readModel = new CognitiveArtifactReadModel(db);

  app.get("/api/games/:idOrSlug/cognitive-artifacts", requireAuth(db), async (c) => {
    const result = await readModel.listArtifacts({
      gameIdOrSlug: c.req.param("idOrSlug"),
      artifactType: parseArtifactType(c.req.query("artifactType")),
      actorPlayerId: optionalQuery(c.req.query("actorPlayerId")),
      limit: parseLimit(c.req.query("limit")),
    }, accessorFromContext(c));

    return c.json(result, result.ok ? 200 : statusToHttp(result.status));
  });

  app.get("/api/games/:idOrSlug/cognitive-artifacts/:artifactId", requireAuth(db), async (c) => {
    const result = await readModel.readArtifact({
      gameIdOrSlug: c.req.param("idOrSlug"),
      artifactId: c.req.param("artifactId"),
      artifactType: parseArtifactType(c.req.query("artifactType")),
      actorRole: parseActorRole(c.req.query("actorRole")),
      actorPlayerId: optionalQuery(c.req.query("actorPlayerId")),
      purpose: "web_read_cognitive_artifact",
    }, accessorFromContext(c));

    return c.json(result, result.ok ? 200 : statusToHttp(result.status));
  });

  return app;
}

function accessorFromContext(c: Context<AuthEnv>): CognitiveArtifactAccessor {
  const user = c.get("user");
  const roles = c.get("userRoles") ?? [];
  const permissions = c.get("userPermissions") ?? [];
  const subjectAccessor: CognitiveArtifactAccessor = {
    userId: user.id,
    authProfile: "subject",
    roles,
    permissions,
  };
  if (hasProducerCognitiveArtifactAccess(subjectAccessor)) {
    return {
      ...subjectAccessor,
      authProfile: "admin_api",
    };
  }
  return subjectAccessor;
}

function optionalQuery(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseArtifactType(value: string | undefined): CognitiveArtifactType | undefined {
  return value === "reasoning" || value === "thinking" || value === "strategy"
    ? value
    : undefined;
}

function parseActorRole(value: string | undefined): CognitiveArtifactActorRole | undefined {
  return value === "player" ||
    value === "juror" ||
    value === "house" ||
    value === "system" ||
    value === "producer"
    ? value
    : undefined;
}

function statusToHttp(status: string): 200 | 403 | 404 {
  if (status === "denied") return 403;
  if (status === "not_found") return 404;
  return 200;
}
