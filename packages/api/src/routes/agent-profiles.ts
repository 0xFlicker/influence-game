/**
 * Agent Profile REST API routes.
 *
 * CRUD for saved, reusable player agent profiles:
 *   POST   /api/agent-profiles           — create a new agent profile
 *   GET    /api/agent-profiles           — list current user's agent profiles
 *   GET    /api/agent-profiles/:id       — get a single agent profile
 *   PATCH  /api/agent-profiles/:id       — update an agent profile
 *   DELETE /api/agent-profiles/:id       — delete an agent profile
 *   POST   /api/agent-profiles/generate  — AI-assisted personality builder
 */

import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  createLlmClientFromEnv,
  resolveModelForTier,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  formatUserSelectableAgentArchetypeKeys,
  isUserSelectableAgentArchetype,
} from "../services/agent-archetypes.js";
import {
  AgentProfileManagementError,
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  completeAvatarGenerationRequest,
  latestAvatarCompletion,
  latestAvatarCompletionsByAgentProfileId,
  requestAvatarCompletion,
} from "../services/avatar-generation.js";

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createAgentProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/agent-profiles/generate — AI-assisted personality builder
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/generate", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/generate");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { traits, occupation, backstoryIdea, archetype, name, existingProfile } = body as {
      traits?: string;
      occupation?: string;
      backstoryIdea?: string;
      archetype?: string;
      name?: string;
      existingProfile?: {
        name?: string;
        backstory?: string;
        personality?: string;
        strategyStyle?: string;
        personaKey?: string;
      };
    };

    if (!traits && !occupation && !backstoryIdea && !archetype && !existingProfile) {
      return c.json({ error: "Provide at least one of: traits, occupation, backstoryIdea, archetype, or existingProfile to refine" }, 400);
    }

    const llmConfig = createLlmClientFromEnv();
    if (!llmConfig) {
      return c.json({ error: "AI generation not available (LLM provider not configured)" }, 503);
    }

    const isRefine = !!existingProfile;
    const openai = llmConfig.client;

    const systemPrompt = `You are a character designer for "Influence", a social strategy game where AI agents negotiate, form alliances, betray each other, and vote to eliminate players. Think Big Brother or Survivor but with rich, human-like personalities.

Generate a complete agent personality profile. The character should feel like a real person — not a game bot. Give them depth, quirks, and a communication style that makes them interesting to watch in social situations.

${isRefine ? "The user is refining an existing profile. Improve and flesh out the provided details while respecting the original direction." : "Create a fresh character based on the provided hints."}

Respond with JSON only:
{
  "name": "A first name for the character (creative, memorable)",
  "backstory": "A 2-4 sentence rich backstory — their background, what shaped them, what they care about. This should inform how they speak and relate to others.",
  "personality": "A 2-3 sentence personality description — their vibe, communication style, social tendencies. This drives how the AI agent behaves in conversations.",
  "strategyStyle": "A 1-2 sentence strategic approach — how they play the game, form alliances, handle conflict.",
  "personaKey": "One of: ${formatUserSelectableAgentArchetypeKeys()} — the closest archetype match."
}`;

    const userParts: string[] = [];
    if (isRefine && existingProfile) {
      userParts.push(`Refine this existing profile:\n${JSON.stringify(existingProfile, null, 2)}`);
    }
    if (name) userParts.push(`Preferred name: ${name}`);
    if (traits) userParts.push(`Key traits: ${traits}`);
    if (occupation) userParts.push(`Occupation/background: ${occupation}`);
    if (backstoryIdea) userParts.push(`Backstory idea: ${backstoryIdea}`);
    if (archetype) userParts.push(`Preferred archetype: ${archetype}`);

    try {
      const response = await openai.chat.completions.create({
        model: resolveModelForTier("budget"),
        max_completion_tokens: 5200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userParts.join("\n\n") },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "agent_profile_generation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                backstory: { type: "string" },
                personality: { type: "string" },
                strategyStyle: { type: "string" },
                personaKey: { type: "string" },
              },
              required: ["name", "backstory", "personality", "strategyStyle", "personaKey"],
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return c.json({ error: "AI generation returned empty response" }, 502);
      }

      const generated = JSON.parse(content) as {
        name?: string;
        backstory?: string;
        personality?: string;
        strategyStyle?: string;
        personaKey?: string;
      };

      // Validate personaKey
      const validatedPersonaKey =
        isUserSelectableAgentArchetype(generated.personaKey)
          ? generated.personaKey
          : "strategic";

      return c.json({
        name: generated.name ?? name ?? "Unknown",
        backstory: generated.backstory ?? null,
        personality: generated.personality ?? "A mysterious player.",
        strategyStyle: generated.strategyStyle ?? null,
        personaKey: validatedPersonaKey,
      });
    } catch (err) {
      console.error("[agent-profiles] AI generation failed:", err);
      return c.json({ error: "AI generation failed" }, 502);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-profiles — create a new agent profile
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const user = c.get("user");
    try {
      const result = await createOwnedAgentProfile(db, {
        userId: user.id,
        publicBaseUrl: new URL(c.req.url).origin,
        avatarChangeSource: "web_upload",
      }, {
        name: body.name,
        backstory: body.backstory,
        personality: body.personality,
        strategyStyle: body.strategyStyle,
        personaKey: body.personaKey,
        avatarUrl: body.avatarUrl,
      });
      return c.json(playerSafeAgentProfile(result.profile), 201);
    } catch (error) {
      if (error instanceof AgentProfileManagementError) {
        return c.json({ error: error.message }, error.statusCode === 404 ? 404 : 400);
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-profiles/:id/avatar/generate — request generated PFP
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/:id/avatar/generate", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");
    const publicBaseUrl = new URL(c.req.url).origin;

    const existing = (await db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      ))[0];

    if (!existing) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    const completion = await requestAvatarCompletion(db, {
      userId: user.id,
      agentProfileId: profileId,
      triggerSource: "web_user_prompt",
      publicBaseUrl,
      userRoles: c.get("userRoles") ?? [],
    });

    if (completion.status === "accepted" && completion.generationRequestId) {
      void completeAvatarGenerationRequest(db, completion.generationRequestId, {
        publicBaseUrl,
      }).catch((error) => {
        console.warn("[agent-profiles] Background avatar generation failed:", error);
      });
    }

    return c.json({ avatarCompletion: completion }, completion.status === "accepted" ? 202 : 200);
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles/:id/avatar/generation — read generated PFP status
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles/:id/avatar/generation", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const existing = (await db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      ))[0];

    if (!existing) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    const completion = await latestAvatarCompletion(db, user.id, profileId);
    return c.json({
      avatarUrl: existing.avatarUrl,
      avatarCompletion: completion ?? {
        status: existing.avatarUrl ? "already_provided" : "skipped",
        avatarUrl: existing.avatarUrl,
        reason: existing.avatarUrl ? "Agent already has an avatar." : "No avatar generation has been requested.",
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles/avatar-generations — batch-read generated PFP status
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles/avatar-generations", requireAuth(db), async (c) => {
    const user = c.get("user");
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50);

    const completions = await latestAvatarCompletionsByAgentProfileId(db, user.id, ids);
    return c.json({
      avatarCompletions: Object.fromEntries(completions),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles — list current user's agent profiles
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles", requireAuth(db), async (c) => {
    const user = c.get("user");

    const profiles = await db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.userId, user.id));

    const completions = await latestAvatarCompletionsByAgentProfileId(
      db,
      user.id,
      profiles.map((profile) => profile.id),
    );

    return c.json(profiles.map((profile) => ({
      ...playerSafeAgentProfile(profile),
      avatarCompletion: completions.get(profile.id),
    })));
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles/:id — get a single agent profile
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles/:id", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const profile = (await db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      ))[0];

    if (!profile) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    return c.json(playerSafeAgentProfile(profile));
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-profiles/:id — update an agent profile
  // -------------------------------------------------------------------------

  app.patch("/api/agent-profiles/:id", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const body = await parseJsonBody(c, "PATCH /api/agent-profiles/:id");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const result = await updateOwnedAgentProfile(db, {
        userId: user.id,
        publicBaseUrl: new URL(c.req.url).origin,
        avatarChangeSource: "web_manual_update",
      }, profileId, {
        name: body.name,
        backstory: body.backstory,
        personality: body.personality,
        strategyStyle: body.strategyStyle,
        personaKey: body.personaKey,
        avatarUrl: body.avatarUrl,
      });
      return c.json({ ...playerSafeAgentProfile(result.profile), statsReset: false });
    } catch (error) {
      if (error instanceof AgentProfileManagementError) {
        return c.json({ error: error.message }, error.statusCode === 404 ? 404 : 400);
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/agent-profiles/:id — delete an agent profile
  // -------------------------------------------------------------------------

  app.delete("/api/agent-profiles/:id", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const existing = (await db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      ))[0];

    if (!existing) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    const [competitionReceipt, competitionRating, competitionSnapshot] = await Promise.all([
      db.select({ id: schema.competitionReceipts.id })
        .from(schema.competitionReceipts)
        .where(eq(schema.competitionReceipts.agentProfileId, profileId))
        .limit(1),
      db.select({ agentProfileId: schema.agentCompetitionRatings.agentProfileId })
        .from(schema.agentCompetitionRatings)
        .where(eq(schema.agentCompetitionRatings.agentProfileId, profileId))
        .limit(1),
      db.select({ id: schema.competitionRatingSnapshots.id })
        .from(schema.competitionRatingSnapshots)
        .where(eq(schema.competitionRatingSnapshots.agentProfileId, profileId))
        .limit(1),
    ]);
    if (competitionReceipt.length > 0
      || competitionRating.length > 0
      || competitionSnapshot.length > 0) {
      return c.json({
        error: "Agents with rated competition history cannot be deleted because producer season records still reference them.",
        code: "rated_history_exists",
      }, 409);
    }

    await db.transaction(async (tx) => {
      // Unrated legacy seats may outlive a deleted unused profile. Rated
      // competition rows retain restrictive references and will fail closed.
      await tx.update(schema.gamePlayers)
        .set({ agentProfileId: null, agentRevisionId: null })
        .where(eq(schema.gamePlayers.agentProfileId, profileId));
      await tx.update(schema.agentProfiles).set({ currentRevisionId: null })
        .where(eq(schema.agentProfiles.id, profileId));
      await tx.delete(schema.agentRevisions)
        .where(eq(schema.agentRevisions.agentProfileId, profileId));
      await tx.delete(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, profileId));
    });

    return c.json({ deleted: true });
  });

  return app;
}

function playerSafeAgentProfile(profile: typeof schema.agentProfiles.$inferSelect) {
  const { currentRevisionId: _currentRevisionId, ...safe } = profile;
  return safe;
}
