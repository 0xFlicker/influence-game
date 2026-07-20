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

import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import {
  createLlmClientFromEnv,
  resolveModelSelection,
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
  adoptOwnedDraftAvatarAndCreateAgentProfile,
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  latestAvatarCompletion,
  latestAvatarCompletionsByAgentProfileId,
  requestAndStartAvatarCompletion,
  requestAndStartDraftAvatarCompletion,
  resumeOwnedDraftAvatarCompletion,
  type AvatarCompletionRead,
} from "../services/avatar-generation.js";
import type { AgentMutationReceipt } from "../services/agent-mutation-receipt.js";
import { acquireDailyFreeLocks } from "../services/queue-enrollment.js";
import { lockProfileAfterLiveRosterGames } from "../services/owned-seat-projection.js";
import { isAgentGender, type AgentGender } from "../lib/agent-gender.js";

const AGENT_PROFILE_GENERATION_CATALOG_ID = "openai:gpt-5-nano";
const GENERATED_AGENT_SURNAMES = [
  "Hartwell", "Langford", "Marlowe", "Sorrell", "Voss", "Ashford", "Bellamy", "Caldwell",
  "Dunmore", "Ellery", "Fairchild", "Grantham", "Hollis", "Iverson", "Kestrel", "Lockwood",
  "Mercer", "North", "Orsini", "Prescott", "Quill", "Rutherford", "Sinclair", "Tallis",
] as const;
const MAX_GENERATED_AGENT_NAME_LENGTH = 80;

export function resolveAgentProfileGenerationLlm(
  env: NodeJS.ProcessEnv = process.env,
) {
  const selection = resolveModelSelection(
    { catalogId: AGENT_PROFILE_GENERATION_CATALOG_ID },
    null,
  );
  const llmConfig = createLlmClientFromEnv(env, {
    providerProfileId: selection.providerProfile.id,
  });

  return llmConfig
    ? { ...llmConfig, modelId: selection.modelId }
    : null;
}

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createAgentProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // Draft portrait generation — starts as soon as AI Help returns profile text
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/avatar/generate-draft", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/avatar/generate-draft");
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80
      || typeof body.personality !== "string" || !body.personality.trim() || body.personality.trim().length > 8_000
      || (body.backstory !== undefined && (typeof body.backstory !== "string" || body.backstory.length > 2_000))
      || (body.strategyStyle !== undefined && (typeof body.strategyStyle !== "string" || body.strategyStyle.length > 2_000))
      || !isAgentGender(body.gender)) {
      return c.json({ error: "Draft portrait fields are missing or exceed agent profile limits" }, 400);
    }

    const user = c.get("user");
    const publicBaseUrl = new URL(c.req.url).origin;
    const completion = await requestAndStartDraftAvatarCompletion(db, {
      userId: user.id,
      profile: {
        name: body.name.trim(),
        gender: body.gender,
        backstory: typeof body.backstory === "string" ? body.backstory : null,
        personality: body.personality.trim(),
        strategyStyle: typeof body.strategyStyle === "string" ? body.strategyStyle : null,
        personaKey: isUserSelectableAgentArchetype(body.personaKey) ? body.personaKey : "strategic",
      },
      publicBaseUrl,
      userRoles: c.get("userRoles") ?? [],
    }, { publicBaseUrl });

    return c.json({ avatarCompletion: completion }, completion.status === "accepted" ? 202 : 200);
  });

  app.get("/api/agent-profiles/avatar/generation-drafts/:id", requireAuth(db), async (c) => {
    const completion = await resumeOwnedDraftAvatarCompletion(
      db,
      c.get("user").id,
      c.req.param("id"),
      { publicBaseUrl: new URL(c.req.url).origin },
    );
    if (!completion) return c.json({ error: "Draft portrait request not found" }, 404);
    return c.json({ avatarCompletion: completion });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-profiles/generate — AI-assisted personality builder
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/generate", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/generate");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { traits, occupation, backstoryIdea, archetype, name, gender, existingProfile } = body as {
      traits?: string;
      occupation?: string;
      backstoryIdea?: string;
      archetype?: string;
      name?: string;
      gender?: AgentGender;
      existingProfile?: {
        name?: string;
        backstory?: string;
        personality?: string;
        strategyStyle?: string;
        personaKey?: string;
        gender?: AgentGender;
      };
    };

    if (!traits && !occupation && !backstoryIdea && !archetype && !existingProfile) {
      return c.json({ error: "Provide at least one of: traits, occupation, backstoryIdea, archetype, or existingProfile to refine" }, 400);
    }

    const llmConfig = resolveAgentProfileGenerationLlm();
    if (!llmConfig) {
      return c.json({ error: "AI generation not available (LLM provider not configured)" }, 503);
    }

    const isRefine = !!existingProfile;
    const openai = llmConfig.client;
    const requestedGender = isAgentGender(gender)
      ? gender
      : isAgentGender(existingProfile?.gender) ? existingProfile.gender : undefined;

    const systemPrompt = `You are a character designer for "Influence", a social strategy game where AI agents negotiate, form alliances, betray each other, and vote to eliminate players. Think Big Brother or Survivor but with rich, human-like personalities.

Generate a complete agent personality profile. The character should feel like a real person — not a game bot. Give them depth, quirks, and a communication style that makes them interesting to watch in social situations.

${isRefine ? "The user is refining an existing profile. Improve and flesh out the provided details while respecting the original direction." : "Create a fresh character based on the provided hints."}

Respond with JSON only:
{
  "name": "A distinctive full first and last name for the character (creative, memorable)",
  "backstory": "A 2-4 sentence rich backstory — their background, what shaped them, what they care about. This should inform how they speak and relate to others. Refer to them by their first name or pronouns, never their full name.",
  "personality": "A 2-3 sentence personality description — their vibe, communication style, social tendencies. This drives how the AI agent behaves in conversations. Refer to them by their first name or pronouns, never their full name.",
  "strategyStyle": "A 1-2 sentence strategic approach — how they play the game, form alliances, handle conflict. Refer to them by their first name or pronouns, never their full name.",
  "personaKey": "One of: ${formatUserSelectableAgentArchetypeKeys()} — the closest archetype match.",
  "gender": "One of: male, female, non-binary. Keep the character's pronouns and details consistent with this choice."
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
    if (requestedGender) userParts.push(`Required gender: ${requestedGender}. Do not change it.`);

    try {
      const response = await openai.chat.completions.create({
        model: llmConfig.modelId,
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
                gender: { type: "string", enum: ["male", "female", "non-binary"] },
              },
              required: ["name", "backstory", "personality", "strategyStyle", "personaKey", "gender"],
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
        gender?: unknown;
      };

      // Validate personaKey
      const validatedPersonaKey =
        isUserSelectableAgentArchetype(generated.personaKey)
          ? generated.personaKey
          : "strategic";
      const existingNames = await db
        .select({ name: schema.agentProfiles.name })
        .from(schema.agentProfiles);
      const generatedName = allocateGeneratedAgentName(
        generated.name ?? name ?? "Unknown",
        new Set(existingNames.map((profile) => profile.name)),
      );
      const profile = updateGeneratedProfileNameReferences({
        name: generated.name ?? name ?? "Unknown",
        backstory: generated.backstory ?? null,
        personality: generated.personality ?? "A mysterious player.",
        strategyStyle: generated.strategyStyle ?? null,
      }, generatedName.name);

      return c.json({
        name: profile.name,
        backstory: profile.backstory,
        personality: profile.personality,
        strategyStyle: profile.strategyStyle,
        personaKey: validatedPersonaKey,
        gender: resolveGeneratedAgentGender(generated, requestedGender),
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
      const publicBaseUrl = new URL(c.req.url).origin;
      let draftCompletion = null;
      let result;
      if (!body.avatarUrl && typeof body.avatarGenerationRequestId === "string") {
        const adopted = await adoptOwnedDraftAvatarAndCreateAgentProfile(db, {
          userId: user.id,
          publicBaseUrl,
        }, body.avatarGenerationRequestId, {
          name: typeof body.name === "string" ? body.name : "",
          gender: isAgentGender(body.gender) ? body.gender : null,
          backstory: typeof body.backstory === "string" && body.backstory.trim() ? body.backstory : null,
          personality: typeof body.personality === "string" ? body.personality : "",
          strategyStyle: typeof body.strategyStyle === "string" && body.strategyStyle.trim() ? body.strategyStyle : null,
          personaKey: typeof body.personaKey === "string" ? body.personaKey : null,
        }, {
          name: body.name,
          backstory: body.backstory,
          personality: body.personality,
          strategyStyle: body.strategyStyle,
          personaKey: body.personaKey,
          gender: body.gender,
        });
        if (!adopted.ok) {
          const messages = {
            not_found: "Draft portrait request not found.",
            pending: "Portrait generation is still in progress.",
            profile_changed: "Agent details changed after portrait generation. Regenerate the portrait.",
            already_consumed: "Draft portrait request has already been used.",
          } as const;
          return c.json({ error: messages[adopted.reason] }, adopted.reason === "pending" ? 409 : 400);
        }
        draftCompletion = adopted.completion;
        result = adopted.result;
      } else {
        result = await createOwnedAgentProfile(db, {
          userId: user.id,
          publicBaseUrl,
          avatarChangeSource: "web_upload",
        }, {
          name: body.name,
          backstory: body.backstory,
          personality: body.personality,
          strategyStyle: body.strategyStyle,
          personaKey: body.personaKey,
          gender: body.gender,
          avatarUrl: body.avatarUrl,
        });
      }
      if (result.profile.avatarUrl) {
        return c.json({
          ...playerSafeAgentProfile(result.profile),
          receipt: result.receipt,
        }, 201);
      }
      if (draftCompletion) {
        return c.json({
          ...playerSafeAgentProfile(result.profile),
          receipt: withAvatarCompletionReceipt(result.receipt, draftCompletion),
          avatarCompletion: draftCompletion,
        }, 201);
      }

      let avatarCompletion;
      try {
        avatarCompletion = await requestAndStartAvatarCompletion(db, {
          userId: user.id,
          agentProfileId: result.profile.id,
          triggerSource: "web_create_default",
          publicBaseUrl,
          userRoles: c.get("userRoles") ?? [],
        }, { publicBaseUrl });
      } catch (error) {
        console.warn("[agent-profiles] Failed to request automatic avatar generation:", error);
        const failedCompletion = {
          status: "failed",
          reason: "Portrait generation could not be started.",
          retryable: true,
        } as const;
        return c.json({
          ...playerSafeAgentProfile(result.profile),
          receipt: withAvatarCompletionReceipt(result.receipt, failedCompletion),
          avatarCompletion: failedCompletion,
        }, 201);
      }
      return c.json({
        ...playerSafeAgentProfile(result.profile),
        receipt: withAvatarCompletionReceipt(result.receipt, avatarCompletion),
        avatarCompletion,
      }, 201);
    } catch (error) {
      if (error instanceof AgentProfileManagementError) {
        return agentProfileErrorResponse(c, error);
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

    const completion = await requestAndStartAvatarCompletion(db, {
      userId: user.id,
      agentProfileId: profileId,
      triggerSource: "web_user_prompt",
      publicBaseUrl,
      userRoles: c.get("userRoles") ?? [],
    }, { publicBaseUrl });

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
        gender: body.gender,
        avatarUrl: body.avatarUrl,
      });
      return c.json({
        ...playerSafeAgentProfile(result.profile),
        statsReset: false,
        receipt: result.receipt,
      });
    } catch (error) {
      if (error instanceof AgentProfileManagementError) {
        return agentProfileErrorResponse(c, error);
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
    const result = await db.transaction(async (tx) => {
      await acquireDailyFreeLocks(tx);
      const locked = await lockProfileAfterLiveRosterGames(tx, {
        profileId,
        userId: user.id,
      });
      if (!locked.profile) return "not-found" as const;
      if (locked.liveGameIds.length > 0) return "active-game" as const;

      const standingEntry = await tx.select({ id: schema.freeGameQueue.id })
        .from(schema.freeGameQueue)
        .where(eq(schema.freeGameQueue.agentProfileId, profileId))
        .limit(1);
      if (standingEntry.length > 0) return "standing" as const;

      const [competitionReceipt, competitionRating, competitionSnapshot] = await Promise.all([
        tx.select({ id: schema.competitionReceipts.id })
          .from(schema.competitionReceipts)
          .where(eq(schema.competitionReceipts.agentProfileId, profileId))
          .limit(1),
        tx.select({ agentProfileId: schema.agentCompetitionRatings.agentProfileId })
          .from(schema.agentCompetitionRatings)
          .where(eq(schema.agentCompetitionRatings.agentProfileId, profileId))
          .limit(1),
        tx.select({ id: schema.competitionRatingSnapshots.id })
          .from(schema.competitionRatingSnapshots)
          .where(eq(schema.competitionRatingSnapshots.agentProfileId, profileId))
          .limit(1),
      ]);
      if (competitionReceipt.length > 0
        || competitionRating.length > 0
        || competitionSnapshot.length > 0) return "rated" as const;

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
      return "deleted" as const;
    });

    if (result === "not-found") return c.json({ error: "Agent profile not found" }, 404);
    if (result === "active-game") {
      return c.json({
        error: "An agent in a waiting or active game cannot be deleted.",
        code: "active_game_exists",
      }, 409);
    }
    if (result === "standing") {
      return c.json({
        error: "Leave Daily Free or switch agents before deleting this agent.",
        code: "daily_free_entry_exists",
      }, 409);
    }
    if (result === "rated") {
      return c.json({
        error: "Agents with rated competition history cannot be deleted because producer season records still reference them.",
        code: "rated_history_exists",
      }, 409);
    }

    return c.json({ deleted: true });
  });

  return app;
}

export function resolveGeneratedAgentGender(generated: {
  gender?: unknown;
  backstory?: string;
  personality?: string;
  strategyStyle?: string;
}, requestedGender?: AgentGender): AgentGender {
  if (requestedGender) return requestedGender;
  if (isAgentGender(generated.gender)) return generated.gender;

  const prose = [generated.backstory, generated.personality, generated.strategyStyle]
    .filter(Boolean)
    .join(" ");
  const femalePronouns = prose.match(/\b(she|her|hers|herself)\b/gi)?.length ?? 0;
  const malePronouns = prose.match(/\b(he|him|his|himself)\b/gi)?.length ?? 0;
  if (femalePronouns > malePronouns) return "female";
  if (malePronouns > femalePronouns) return "male";
  return "non-binary";
}

export function allocateGeneratedAgentName(
  generatedName: string,
  occupiedNames: Set<string>,
): { name: string; changed: boolean } {
  const requestedName = generatedName.trim().replace(/\s+/g, " ").slice(0, MAX_GENERATED_AGENT_NAME_LENGTH).trimEnd() || "Agent";
  const normalizedOccupiedNames = new Set(
    [...occupiedNames].map(normalizeAgentProfileName),
  );
  if (hasLastName(requestedName) && !normalizedOccupiedNames.has(normalizeAgentProfileName(requestedName))) {
    return { name: requestedName, changed: false };
  }

  const firstNames = requestedName.split(" ").slice(0, -1).join(" ")
    || requestedName.split(" ")[0]
    || "Agent";
  for (const surname of GENERATED_AGENT_SURNAMES) {
    const candidate = generatedNameCandidate(firstNames, surname);
    if (!normalizedOccupiedNames.has(normalizeAgentProfileName(candidate))) {
      return { name: candidate, changed: true };
    }
  }

  for (let ordinal = 2; ordinal < 10_000; ordinal += 1) {
    const candidate = generatedNameCandidate(firstNames, `${GENERATED_AGENT_SURNAMES[0]} ${ordinal}`);
    if (!normalizedOccupiedNames.has(normalizeAgentProfileName(candidate))) {
      return { name: candidate, changed: true };
    }
  }

  throw new Error("Could not allocate a unique generated agent name");
}

export function updateGeneratedProfileNameReferences<T extends {
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
}>(profile: T, name: string): T {
  if (profile.name === name) return profile;
  const nameReference = new RegExp(escapeRegExp(profile.name), "gi");
  const replaceName = (value: string | null) => value?.replace(nameReference, name) ?? null;
  return {
    ...profile,
    name,
    backstory: replaceName(profile.backstory),
    personality: replaceName(profile.personality) ?? profile.personality,
    strategyStyle: replaceName(profile.strategyStyle),
  };
}

function hasLastName(name: string): boolean {
  return name.trim().split(/\s+/).length >= 2;
}

function generatedNameCandidate(firstNames: string, surname: string): string {
  const maxFirstNameLength = MAX_GENERATED_AGENT_NAME_LENGTH - surname.length - 1;
  return `${firstNames.slice(0, maxFirstNameLength).trimEnd() || "Agent"} ${surname}`;
}

function normalizeAgentProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playerSafeAgentProfile(profile: typeof schema.agentProfiles.$inferSelect) {
  const { currentRevisionId: _currentRevisionId, ...safe } = profile;
  return safe;
}

function agentProfileErrorResponse(
  c: Context<AuthEnv>,
  error: AgentProfileManagementError,
): Response {
  const body = {
    code: error.code,
    error: error.message,
    retryable: error.retryable,
    ...(error.details && { details: error.details }),
  };
  if (error.statusCode === 404) return c.json(body, 404);
  if (error.statusCode === 409) return c.json(body, 409);
  return c.json(body, 400);
}

function withAvatarCompletionReceipt(
  receipt: AgentMutationReceipt,
  avatarCompletion: AvatarCompletionRead,
): AgentMutationReceipt {
  const warnings = avatarCompletion.status === "failed"
    && !receipt.warnings.includes("avatar_generation_failed")
    ? [...receipt.warnings, "avatar_generation_failed" as const]
    : receipt.warnings;
  return { ...receipt, avatarCompletion, warnings };
}
