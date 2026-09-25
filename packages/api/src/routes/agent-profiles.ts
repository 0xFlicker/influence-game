import { readOwnerContent } from "../services/agent-content-submissions.js";
import sharp from "sharp";
import { APIConnectionTimeoutError } from "openai";
import { isCreationStage } from "@influence/engine/agent-creation-assistant";
import { selectCreationCommand } from "../services/agent-creation-assistant.js";
import { characterProfileSchemaFor, decodeCharacterProfile } from "../services/character-profile-contract.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { exportCharacterPortrait, generateVisualProfileReference } from "../services/visual-profile-generation.js";
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
import { eq, and, isNull } from "drizzle-orm";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { describeAgentCreationTraits, isAgentCreationTraitId, type AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  resolveAgentCreationLlm,
} from "../lib/openai-budget-generation-llm.js";
import {
  isUserSelectableAgentArchetype,
  USER_SELECTABLE_AGENT_ARCHETYPES,
  USER_SELECTABLE_AGENT_ARCHETYPE_KEYS,
} from "../services/agent-archetypes.js";
import {
  AgentProfileManagementError,
  createOwnedAgentProfile,
  MAX_AGENT_DISPLAY_NAME_LENGTH,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  latestAvatarCompletion,
  latestAvatarCompletionsByAgentProfileId,
  requestAndStartAvatarCompletion,
  requestAndStartDraftAvatarCompletion,
  resumeOwnedDraftAvatarCompletion,
  resumeOwnedAttachedAvatarCompletions,
} from "../services/avatar-generation.js";
import { archiveOwnedAgentProfile } from "../services/agent-profile-lifecycle.js";
import { isAgentGender, type AgentGender } from "../lib/agent-gender.js";

const GENERATED_AGENT_SURNAMES = [
  "Hartwell", "Langford", "Marlowe", "Sorrell", "Voss", "Ashford", "Bellamy", "Caldwell",
  "Dunmore", "Ellery", "Fairchild", "Grantham", "Hollis", "Iverson", "Kestrel", "Lockwood",
  "Mercer", "North", "Orsini", "Prescott", "Quill", "Rutherford", "Sinclair", "Tallis",
] as const;
/** Interactive character creation uses Standard processing with a bounded timeout. */
export function resolveAgentProfileGenerationLlm(
  env: NodeJS.ProcessEnv = process.env,
) {
  return resolveAgentCreationLlm(env);
}

function buildAgentProfileGenerationSystemPrompt(
  isRefine: boolean,
  allowedPersonaKeys: readonly string[],
): string {
  const archetypeChoices = USER_SELECTABLE_AGENT_ARCHETYPES
    .filter((archetype) => allowedPersonaKeys.includes(archetype.key))
    .map((archetype) => `- ${archetype.key} (${archetype.label}): ${archetype.description}`)
    .join("\n");
  return `You are a character designer for "Influence", a social strategy game where AI agents negotiate, form alliances, betray each other, and vote to eliminate players. Think Big Brother or Survivor, but with vivid, memorable personalities and character designs.

Generate a complete agent personality profile. The character should feel like a vivid person — not a game bot. Give them depth, quirks, and a communication style that makes them interesting to watch in social situations. Distinctive non-human and anthropomorphic characters are welcome; never flatten a chosen creature or object form into a human wearing a costume. Honor all selected character ingredients throughout the profile and visualDesign.

${isRefine ? "The user is refining an existing profile. Improve and flesh out the provided details while respecting the original direction." : "Create a fresh character based on the provided hints."}

Respond with JSON only:
{
  "name": "A distinctive full first and last name for the character (creative, memorable, ${MAX_AGENT_DISPLAY_NAME_LENGTH} characters or fewer)",
  "backstory": "A 2-4 sentence rich backstory — their background, what shaped them, what they care about. This should inform how they speak and relate to others. Refer to them by their first name or pronouns, never their full name.",
  "personality": "A detailed character prompt in 4-6 sentences: motivations, contradictions, flaws, voice, social habits and how they react under pressure. Include concrete behaviors that make them distinctive to play and watch. Refer to them by their first name or pronouns, never their full name.",
  "strategyStyle": "A 1-2 sentence strategic approach — how they play the game, form alliances, handle conflict. Refer to them by their first name or pronouns, never their full name.",
  "personaKey": "Return exactly one of the valid archetype keys listed below.",
  "gender": "One of: male, female, non-binary. Keep the character's pronouns and details consistent with this choice.",
  "performanceInstructions": "Specific posture, gestures, movement, mannerisms and vocal delivery for performing this character; at most 2000 characters.",
  "visualDesign": "A coherent full-body visual design that honors the selected species or object form: silhouette, face or defining features, clothing when appropriate, colors and distinctive details. Keep it reproducible and preserve the identity and form of supplied reference artwork; at most 8000 characters.",
  "introQuips": ["Three short, entertaining first-person lines this character might say. Stay in character; these are dialogue, never explanations or private reasoning. Each line is at most 160 characters."]
}

Valid archetypes:
${archetypeChoices}`;
}

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createAgentProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.post("/api/agent-profiles/creation-assistant", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/creation-assistant");
    if (!body || !isCreationStage(body.stage) || typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000
      || !Array.isArray(body.history) || body.history.length > 24 || body.history.some((value: unknown) => typeof value !== "string" || value.length > 2000)
      || !Array.isArray(body.sections) || body.sections.length > 8 || body.sections.some((value: unknown) => typeof value !== "string" || !["name", "personaKey", "gender", "personality", "backstory", "strategyStyle", "performanceInstructions", "visualDesign"].includes(value))) {
      return c.json({ error: "Invalid creation assistant turn" }, 400);
    }
    try {
      return c.json({ command: await selectCreationCommand(body.stage, body.message, body.history as string[], body.sections as string[], c.req.raw.signal) });
    } catch (error) {
      console.error("[creation-assistant] Turn failed", error);
      if (error instanceof APIConnectionTimeoutError) return c.json({ error: "The character assistant took too long to respond. Your text is still here—please try again." }, 504);
      return c.json({ error: "The assistant could not complete this turn. Try again or use Advanced create." }, 502);
    }
  });
  app.post("/api/agent-profiles/portrait-crop", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/portrait-crop");
    if (!body) return c.json({ error: "A portrait crop is required" }, 400);
    const { headRectangle, ...crop } = body;
    try { return c.json(await exportCharacterPortrait(crop as unknown as import("@influence/engine/character-portrait").PortraitCrop, new URL(c.req.url).origin, headRectangle)); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Portrait export failed" }, 400); }
  });
  app.post("/api/agent-profiles/visual-reference", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/visual-reference");
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Invalid JSON body" }, 400);
    try {
      return c.json(await generateVisualProfileReference(db, c.get("user").id, body as Record<string, unknown>, new URL(c.req.url).origin));
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Reference generation failed" }, 409); }
  });

  // -------------------------------------------------------------------------
  // Draft portrait generation — starts as soon as AI Help returns profile text
  // -------------------------------------------------------------------------

  app.post("/api/agent-profiles/avatar/generate-draft", requireAuth(db), async (c) => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/avatar/generate-draft");
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > MAX_AGENT_DISPLAY_NAME_LENGTH
      || typeof body.personality !== "string" || !body.personality.trim() || body.personality.trim().length > AGENT_PROFILE_LIMITS.personality
      || (body.backstory !== undefined && (typeof body.backstory !== "string" || body.backstory.length > AGENT_PROFILE_LIMITS.backstory))
      || (body.strategyStyle !== undefined && (typeof body.strategyStyle !== "string" || body.strategyStyle.length > AGENT_PROFILE_LIMITS.strategyStyle))
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

    const { changeRequest, allowPersonaChange, traits, creationTraitIds, occupation, backstoryIdea, archetype, name, gender, existingProfile } = body as {
      changeRequest?: string;
      allowPersonaChange?: boolean;
      traits?: string;
      creationTraitIds?: string[];
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
        performanceInstructions?: string;
        visualDesign?: string;
        avatarUrl?: string | null;
        fullBodyReferenceUrl?: string | null;
      };
    };

    if (changeRequest !== undefined && (typeof changeRequest !== "string" || changeRequest.trim().length === 0 || changeRequest.length > 2_000)) {
      return c.json({ error: "changeRequest must be a non-empty string of at most 2000 characters" }, 400);
    }

    if (creationTraitIds !== undefined && (!Array.isArray(creationTraitIds)
      || creationTraitIds.length > 12
      || creationTraitIds.some((id) => !isAgentCreationTraitId(id))
      || new Set(creationTraitIds).size !== creationTraitIds.length)) {
      return c.json({ error: "creationTraitIds must contain up to 12 unique valid character ingredients" }, 400);
    }

    if (!traits && !creationTraitIds?.length && !occupation && !backstoryIdea && !archetype && !existingProfile && !changeRequest) {
      return c.json({ error: "Provide a prompt, character ingredients, traits, occupation, backstory idea, archetype, or existing profile to refine" }, 400);
    }

    const llmConfig = resolveAgentProfileGenerationLlm();
    if (!llmConfig) {
      return c.json({ error: "AI generation not available (LLM provider not configured)" }, 503);
    }

    const isRefine = !!existingProfile;
    const openai = llmConfig.client;
    const selectedArchetype = isUserSelectableAgentArchetype(existingProfile?.personaKey)
      ? existingProfile.personaKey
      : isUserSelectableAgentArchetype(archetype) ? archetype : undefined;
    const allowedPersonaKeys = selectedArchetype && allowPersonaChange !== true
      ? [selectedArchetype]
      : USER_SELECTABLE_AGENT_ARCHETYPE_KEYS;
    const requestedGender = isAgentGender(gender)
      ? gender
      : isAgentGender(existingProfile?.gender) ? existingProfile.gender : undefined;

    const systemPrompt = buildAgentProfileGenerationSystemPrompt(isRefine, allowedPersonaKeys);

    const userParts: string[] = [];
    if (isRefine && existingProfile) {
      userParts.push(`Refine this existing profile:\n${JSON.stringify(existingProfile, null, 2)}`);
    }
    if (changeRequest) userParts.push(`User's requested changes (follow these instructions while preserving unrelated profile details):\n${changeRequest.trim()}`);
    if (selectedArchetype) {
      userParts.push(allowPersonaChange === true
        ? `Current base archetype: ${selectedArchetype}. The user has allowed you to choose from these valid archetypes: ${USER_SELECTABLE_AGENT_ARCHETYPE_KEYS.join(", ")}. Return one of these exact keys in personaKey.`
        : `The user's selected base archetype is ${selectedArchetype}. Keep it fixed and return exactly ${selectedArchetype} in personaKey.`);
    } else {
      userParts.push(`Choose personaKey only from these valid archetypes: ${allowedPersonaKeys.join(", ")}.`);
    }
    if (name) userParts.push(`Preferred name: ${name}`);
    if (traits) userParts.push(`Key traits: ${traits}`);
    if (creationTraitIds?.length) {
      userParts.push(`Selected character ingredients (honor each as a creative constraint in the profile and visualDesign):\n${describeAgentCreationTraits(creationTraitIds as AgentCreationTraitId[]).join("\n")}`);
    }
    if (occupation) userParts.push(`Occupation/background: ${occupation}`);
    if (backstoryIdea) userParts.push(`Backstory idea: ${backstoryIdea}`);
    if (archetype) userParts.push(`Preferred archetype: ${archetype}`);
    if (requestedGender) userParts.push(`Required gender: ${requestedGender}. Do not change it.`);

    try {
      const sourceUrl = existingProfile?.fullBodyReferenceUrl || existingProfile?.avatarUrl;
      const reference = sourceUrl ? await sharp(await readVisualProfileImage(sourceUrl, { name: existingProfile?.name ?? "", personaKey: existingProfile?.personaKey ?? "" })).rotate().png().toBuffer() : null;
      const response = await openai.chat.completions.create({
        model: llmConfig.modelId,
        service_tier: "default",
        reasoning_effort: "low",
        max_completion_tokens: 5200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: reference ? [
            { type: "text", text: userParts.join("\n\n") + "\nPreserve this character's visible identity when refining visualDesign." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${reference.toString("base64")}`, detail: "high" } },
          ] : userParts.join("\n\n") },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "agent_profile_generation",
            strict: true,
            schema: characterProfileSchemaFor(allowedPersonaKeys),
          },
        },
      }, { signal: c.req.raw.signal });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return c.json({ error: "AI generation returned empty response" }, 502);
      }

      if (response.choices[0]?.finish_reason !== "stop") throw new Error("Incomplete character profile");
      const generated = decodeCharacterProfile(content, allowedPersonaKeys);
      const existingNames = await db
        .select({ name: schema.agentProfiles.name })
        .from(schema.agentProfiles);
      const generatedName = allocateGeneratedAgentName(
        generated.name,
        new Set(existingNames.map((profile) => profile.name)),
      );
      const profile = updateGeneratedProfileNameReferences({
        name: generated.name,
        backstory: generated.backstory ?? null,
        personality: generated.personality,
        strategyStyle: generated.strategyStyle ?? null,
      }, generatedName.name);

      return c.json({
        name: profile.name,
        backstory: profile.backstory,
        personality: profile.personality,
        strategyStyle: profile.strategyStyle,
        personaKey: generated.personaKey,
        performanceInstructions: generated.performanceInstructions,
        visualDesign: generated.visualDesign,
        introQuips: generated.introQuips,
        gender: resolveGeneratedAgentGender(generated, requestedGender),
      });
    } catch (err) {
      console.error("[agent-profiles] AI generation failed:", err);
      if (err instanceof APIConnectionTimeoutError) return c.json({ error: "Character generation took too long. Your draft is unchanged—please try again." }, 504);
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
      if (!isUuid(body.creationRequestId)) {
        return c.json({ error: "creationRequestId must be a UUID." }, 400);
      }
      const avatarGenerationRequestId = typeof body.avatarGenerationRequestId === "string"
        ? body.avatarGenerationRequestId
        : undefined;
      const result = await createOwnedAgentProfile(db, {
        userId: user.id,
        publicBaseUrl,
        avatarChangeSource: "web_upload",
        ...(avatarGenerationRequestId && { avatarGenerationRequestId }),
      }, {
        name: body.name,
        backstory: body.backstory,
        personality: body.personality,
        strategyStyle: body.strategyStyle,
        personaKey: body.personaKey,
        gender: body.gender,
        avatarUrl: body.avatarUrl,
        fullBodyReferenceUrl: body.fullBodyReferenceUrl,
        performanceInstructions: body.performanceInstructions,
        visualDesign: body.visualDesign,
        portraitCrop: body.portraitCrop,
        headPosition: body.headPosition,
        submissionId: body.submissionId,
        expectedContentRevisionId: body.expectedContentRevisionId,
        creationRequestId: body.creationRequestId,
      });
      return c.json({ ...playerSafeAgentProfile(result.profile), receipt: result.receipt }, 201);
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

    await resumeOwnedAttachedAvatarCompletions(db, user.id, ids);
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
      .where(and(eq(schema.agentProfiles.userId, user.id), isNull(schema.agentProfiles.archivedAt)));

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

  // Recover an Agent after creation committed but its response was lost.
  app.get("/api/agent-profiles/creation-requests/:id", requireAuth(db), async (c) => {
    const creationRequestId = c.req.param("id");
    if (!isUuid(creationRequestId)) {
      return c.json({ error: "creationRequestId must be a UUID." }, 400);
    }
    const user = c.get("user");
    const profile = (await db.select().from(schema.agentProfiles).where(and(
      eq(schema.agentProfiles.userId, user.id),
      eq(schema.agentProfiles.creationRequestId, creationRequestId),
    )).limit(1))[0];
    if (!profile) return c.json({ error: "Agent creation request not found" }, 404);
    const avatarCompletion = await latestAvatarCompletion(db, user.id, profile.id) ?? undefined;
    return c.json({
      ...playerSafeAgentProfile(profile),
      ...(avatarCompletion && { avatarCompletion }),
    });
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

    const avatarCompletion = await latestAvatarCompletion(db, user.id, profile.id) ?? undefined;
    return c.json({
      ...playerSafeAgentProfile(profile),
      ownerContent: await readOwnerContent(db, profile),
      ...(avatarCompletion && { avatarCompletion }),
    });
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
        ...(typeof body.avatarGenerationRequestId === "string" && {
          avatarGenerationRequestId: body.avatarGenerationRequestId,
        }),
      }, profileId, {
        name: body.name,
        backstory: body.backstory,
        personality: body.personality,
        strategyStyle: body.strategyStyle,
        personaKey: body.personaKey,
        gender: body.gender,
        avatarUrl: body.avatarUrl,
        fullBodyReferenceUrl: body.fullBodyReferenceUrl,
        performanceInstructions: body.performanceInstructions,
        visualDesign: body.visualDesign,
        portraitCrop: body.portraitCrop,
        headPosition: body.headPosition,
        submissionId: body.submissionId,
        expectedContentRevisionId: body.expectedContentRevisionId,
        sourceReviewId: body.sourceReviewId,
        expectedRevisionId: body.expectedRevisionId,
      });
      return c.json({
        ...playerSafeAgentProfile(result.profile),
        statsReset: false,
        receipt: result.receipt,
        ...(result.avatarCompletion && { avatarCompletion: result.avatarCompletion }),
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
    const result = await archiveOwnedAgentProfile(db, user.id, profileId);

    if (result === "not-found") return c.json({ error: "Agent profile not found" }, 404);
    if (result === "active-game") {
      return c.json({
        error: "An agent in a waiting or active game cannot be archived.",
        code: "active_game_exists",
      }, 409);
    }
    if (result === "standing") {
      return c.json({
        error: "Leave Daily Free or switch agents before archiving this agent.",
        code: "daily_free_entry_exists",
      }, 409);
    }
    if (result === "rated") {
      return c.json({
        error: "Agents with rated competition history cannot be archived because producer season records still reference them.",
        code: "rated_history_exists",
      }, 409);
    }

    return c.json({ archived: true });
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

  throw new Error("Structured gender is required");
}

export function allocateGeneratedAgentName(
  generatedName: string,
  occupiedNames: Set<string>,
): { name: string; changed: boolean } {
  const requestedName = generatedName.trim().replace(/\s+/g, " ").slice(0, MAX_AGENT_DISPLAY_NAME_LENGTH).trimEnd() || "Agent";
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
  const maxFirstNameLength = MAX_AGENT_DISPLAY_NAME_LENGTH - surname.length - 1;
  return `${firstNames.slice(0, maxFirstNameLength).trimEnd() || "Agent"} ${surname}`;
}

function normalizeAgentProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playerSafeAgentProfile(profile: typeof schema.agentProfiles.$inferSelect) {
  const {
    currentRevisionId: _currentRevisionId,
    creationRequestId: _creationRequestId,
    creationPayloadFingerprint: _creationPayloadFingerprint,
    ...safe
  } = profile;
  return { ...safe, profileRevisionId: _currentRevisionId };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
