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
import OpenAI from "openai";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";

// Valid personality archetype keys
const VALID_PERSONA_KEYS = new Set([
  "honest", "strategic", "deceptive", "paranoid", "social",
  "aggressive", "loyalist", "observer", "diplomat", "wildcard",
]);

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createAgentProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/agent-profiles/generate — AI-assisted personality builder
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/generate", requireAuth(db), async (c) => {
    const body = await c.req.json().catch(() => null);
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

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return c.json({ error: "AI generation not available (OPENAI_API_KEY not configured)" }, 503);
    }

    const isRefine = !!existingProfile;
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const systemPrompt = `You are a character designer for "Influence", a social strategy game where AI agents negotiate, form alliances, betray each other, and vote to eliminate players. Think Big Brother or Survivor but with rich, human-like personalities.

Generate a complete agent personality profile. The character should feel like a real person — not a game bot. Give them depth, quirks, and a communication style that makes them interesting to watch in social situations.

${isRefine ? "The user is refining an existing profile. Improve and flesh out the provided details while respecting the original direction." : "Create a fresh character based on the provided hints."}

Respond with JSON only:
{
  "name": "A first name for the character (creative, memorable)",
  "backstory": "A 2-4 sentence rich backstory — their background, what shaped them, what they care about. This should inform how they speak and relate to others.",
  "personality": "A 2-3 sentence personality description — their vibe, communication style, social tendencies. This drives how the AI agent behaves in conversations.",
  "strategyStyle": "A 1-2 sentence strategic approach — how they play the game, form alliances, handle conflict.",
  "personaKey": "One of: honest, strategic, deceptive, paranoid, social, aggressive, loyalist, observer, diplomat, wildcard — the closest archetype match."
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
        model: "gpt-4o-mini",
        max_tokens: 400,
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userParts.join("\n\n") },
        ],
        response_format: { type: "json_object" },
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
        generated.personaKey && VALID_PERSONA_KEYS.has(generated.personaKey)
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
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { name, backstory, personality, strategyStyle, personaKey, avatarUrl } = body;

    if (!name || !personality) {
      return c.json({ error: "name and personality are required" }, 400);
    }

    if (personaKey && !VALID_PERSONA_KEYS.has(personaKey)) {
      return c.json({ error: `Invalid personaKey. Must be one of: ${[...VALID_PERSONA_KEYS].join(", ")}` }, 400);
    }

    const user = c.get("user");
    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(schema.agentProfiles)
      .values({
        id,
        userId: user.id,
        name,
        backstory: backstory ?? null,
        personality,
        strategyStyle: strategyStyle ?? null,
        personaKey: personaKey ?? null,
        avatarUrl: avatarUrl ?? null,
        gamesPlayed: 0,
        gamesWon: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const profile = db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, id))
      .all()[0]!;

    return c.json(profile, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles — list current user's agent profiles
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles", requireAuth(db), async (c) => {
    const user = c.get("user");

    const profiles = db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.userId, user.id))
      .all();

    return c.json(profiles);
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-profiles/:id — get a single agent profile
  // -------------------------------------------------------------------------

  app.get("/api/agent-profiles/:id", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const profile = db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      )
      .all()[0];

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

    const existing = db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      )
      .all()[0];

    if (!existing) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { name, backstory, personality, strategyStyle, personaKey, avatarUrl } = body;

    if (personaKey !== undefined && personaKey !== null && !VALID_PERSONA_KEYS.has(personaKey)) {
      return c.json({ error: `Invalid personaKey. Must be one of: ${[...VALID_PERSONA_KEYS].join(", ")}` }, 400);
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
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (resetStats) {
      updates.gamesPlayed = 0;
      updates.gamesWon = 0;
    }

    db.update(schema.agentProfiles)
      .set(updates)
      .where(eq(schema.agentProfiles.id, profileId))
      .run();

    // Reset free-track ELO ratings if personality-defining fields changed
    let freeTrackReset = false;
    if (personalityChanged) {
      const freeRating = db
        .select()
        .from(schema.freeTrackRatings)
        .where(eq(schema.freeTrackRatings.agentProfileId, profileId))
        .all()[0];

      if (freeRating) {
        db.update(schema.freeTrackRatings)
          .set({
            rating: 1200,
            gamesPlayed: 0,
            gamesWon: 0,
            peakRating: 1200,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.freeTrackRatings.agentProfileId, profileId))
          .run();
        freeTrackReset = true;
      }
    }

    const updated = db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId))
      .all()[0]!;

    return c.json({ ...updated, statsReset: resetStats, freeTrackReset });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/agent-profiles/:id — delete an agent profile
  // -------------------------------------------------------------------------

  app.delete("/api/agent-profiles/:id", requireAuth(db), async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");

    const existing = db
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, profileId),
          eq(schema.agentProfiles.userId, user.id),
        ),
      )
      .all()[0];

    if (!existing) {
      return c.json({ error: "Agent profile not found" }, 404);
    }

    // Clear references in game_players before deleting
    db.update(schema.gamePlayers)
      .set({ agentProfileId: null })
      .where(eq(schema.gamePlayers.agentProfileId, profileId))
      .run();

    db.delete(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId))
      .run();

    return c.json({ deleted: true });
  });

  return app;
}
