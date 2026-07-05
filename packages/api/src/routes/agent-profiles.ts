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
import { randomUUID } from "crypto";
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
import { normalizeAgentAvatarUrlInput } from "../services/agent-profile-management.js";
import {
  completeAvatarGenerationRequest,
  latestAvatarCompletion,
  latestAvatarCompletionsByAgentProfileId,
  recordAvatarChange,
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

    const { name, backstory, personality, strategyStyle, personaKey, avatarUrl } = body;

    if (!name || !personality) {
      return c.json({ error: "name and personality are required" }, 400);
    }

    if (personaKey && !isUserSelectableAgentArchetype(personaKey)) {
      return c.json({ error: `Invalid personaKey. Must be one of: ${formatUserSelectableAgentArchetypeKeys()}` }, 400);
    }

    const parsedAvatarUrl = normalizeAgentAvatarUrlInput(avatarUrl, new URL(c.req.url).origin);
    if (!parsedAvatarUrl.ok) {
      return c.json({ error: parsedAvatarUrl.error }, 400);
    }

    const user = c.get("user");
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.insert(schema.agentProfiles)
      .values({
        id,
        userId: user.id,
        name,
        backstory: backstory ?? null,
        personality,
        strategyStyle: strategyStyle ?? null,
        personaKey: personaKey ?? null,
        avatarUrl: parsedAvatarUrl.value ?? null,
        gamesPlayed: 0,
        gamesWon: 0,
        createdAt: now,
        updatedAt: now,
      });

    if (parsedAvatarUrl.value) {
      await recordAvatarChange(db, {
        userId: user.id,
        agentProfileId: id,
        source: "web_upload",
        status: "completed",
        previousAvatarUrl: null,
        newAvatarUrl: parsedAvatarUrl.value,
      });
    }

    const profile = (await db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, id)))[0]!;

    return c.json(profile, 201);
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
      ...profile,
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

    return c.json(profile);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-profiles/:id — update an agent profile
  // -------------------------------------------------------------------------

  app.patch("/api/agent-profiles/:id", requireAuth(db), async (c) => {
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

    const body = await parseJsonBody(c, "PATCH /api/agent-profiles/:id");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { name, backstory, personality, strategyStyle, personaKey, avatarUrl } = body;

    if (personaKey !== undefined && personaKey !== null && !isUserSelectableAgentArchetype(personaKey)) {
      return c.json({ error: `Invalid personaKey. Must be one of: ${formatUserSelectableAgentArchetypeKeys()}` }, 400);
    }

    const parsedAvatarUrl = normalizeAgentAvatarUrlInput(avatarUrl, new URL(c.req.url).origin);
    if (!parsedAvatarUrl.ok) {
      return c.json({ error: parsedAvatarUrl.error }, 400);
    }

    // If personality-defining fields changed and the agent has played games, reset stats
    const personalityChanged =
      (name !== undefined && name !== existing.name) ||
      (personality !== undefined && personality !== existing.personality) ||
      (personaKey !== undefined && personaKey !== existing.personaKey) ||
      (backstory !== undefined && backstory !== existing.backstory) ||
      (strategyStyle !== undefined && strategyStyle !== existing.strategyStyle);

    const hasGamesPlayed = existing.gamesPlayed > 0;
    const resetStats = personalityChanged && hasGamesPlayed;

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name;
    if (backstory !== undefined) updates.backstory = backstory;
    if (personality !== undefined) updates.personality = personality;
    if (strategyStyle !== undefined) updates.strategyStyle = strategyStyle;
    if (personaKey !== undefined) updates.personaKey = personaKey;
    if (avatarUrl !== undefined) updates.avatarUrl = parsedAvatarUrl.value;
    if (resetStats) {
      updates.gamesPlayed = 0;
      updates.gamesWon = 0;
    }

    await db.update(schema.agentProfiles)
      .set(updates)
      .where(eq(schema.agentProfiles.id, profileId));

    if (avatarUrl !== undefined && updates.avatarUrl !== existing.avatarUrl) {
      await recordAvatarChange(db, {
        userId: user.id,
        agentProfileId: profileId,
        source: "web_manual_update",
        status: "completed",
        previousAvatarUrl: existing.avatarUrl,
        newAvatarUrl: updates.avatarUrl as string | null,
      });
    }

    const updated = (await db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId)))[0]!;

    return c.json({ ...updated, statsReset: resetStats });
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

    // Clear references in game_players before deleting
    await db.update(schema.gamePlayers)
      .set({ agentProfileId: null })
      .where(eq(schema.gamePlayers.agentProfileId, profileId));

    await db.delete(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId));

    return c.json({ deleted: true });
  });

  return app;
}
