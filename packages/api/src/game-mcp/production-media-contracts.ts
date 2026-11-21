import Ajv from "ajv";
import sharp from "sharp";
import type { DrizzleDB } from "../db/index.js";
import { AudioTrackConflict, previewAudioTrack, queueAudioBackfill, retryAudioTrack } from "../services/audio-tracks.js";
import { productionGame } from "../services/production-editorial-source.js";
import { readProductionScene, readProductionScenes, type ProductionSceneAudience } from "../services/production-scenes.js";
import { controlVisualMedia } from "../services/visual-media-repair.js";
import { renderMissingReplayScene, ReplayVisualError } from "../services/visual-replay-production.js";
import { readVisualArtifact } from "../services/visual-scene-store.js";
import { WerewolfGameError } from "../services/werewolf-games.js";
import { object } from "./production-editorial-contracts.js";

export const productionMediaToolNames = [
  "read_production_audio",
  "generate_production_audio",
  "list_production_scenes",
  "read_production_scene",
  "generate_production_image",
  "publish_production_image",
] as const;
export type ProductionMediaToolName = typeof productionMediaToolNames[number];
export const productionMediaScopes = ["producer", "producer:media"] as const;

const id = { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" };
const text = { type: "string" };
const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const amount = { type: "number", minimum: 0 };
const hash = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const bool = { type: "boolean" };
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const game = { gameIdOrSlug: id };
const scenes = { ...game, audience: { enum: ["public", "mystery", "omniscient"] } };
const scene = { ...scenes, sceneKey: id };
const imageRequest = { ...scene, requestId: id };
const publicationAudience = { enum: ["public", "private"] };
const page = { offset: integer, limit: { type: "integer", minimum: 1, maximum: 50 } };

export const productionMediaInputs = {
  read_production_audio: object(game),
  generate_production_audio: { type: "object", oneOf: [
    object({ ...game, action: { const: "generate" }, previewHash: hash }),
    object({ ...game, action: { const: "retry" }, trackId: { type: "string", format: "uuid" } }),
  ] },
  list_production_scenes: object({ ...scenes, ...page }, ["gameIdOrSlug", "audience"]),
  read_production_scene: {
    ...object({ ...scene, ...page, versionId: id, groupIndex: integer }, ["gameIdOrSlug", "audience", "sceneKey"]),
    dependencies: { groupIndex: ["versionId"] },
  },
  generate_production_image: { type: "object", oneOf: [
    object({ ...imageRequest, action: { const: "missing" }, previewHash: hash }),
    object({ ...imageRequest, action: { const: "regenerate" }, expectedVersion: integer }),
  ] },
  publish_production_image: object({
    ...imageRequest, versionId: id, expectedVersion: integer, expectedPublication: integer, publicationAudience,
  }),
};

const status = { status: { const: "ok" }, gameId: id };
const track = object({ id, status: { enum: ["queued", "running", "ready", "failed"] }, active: bool, retryable: bool });
const job = object({ id, status: text, step: text, version: integer });
const sceneSummary = object({
  key: id, previewHash: hash, sceneId: nullable(id), roomName: text, round: nullable(integer),
  participants: { type: "array", items: object({ id, name: text }) }, available: bool,
  latestVersion: nullable(integer), activeJob: nullable(job),
});
const sceneVersion = object({ id, version: integer, verificationVersion: text, groupCount: integer });
const receipt = object({
  accepted: bool, code: text, message: text, jobId: id, versionId: id, version: integer, publicationId: id,
}, ["accepted", "code", "message"]);
const error = object({ status: { const: "rejected" }, code: text, message: text });
const output = (fields: Record<string, unknown>) => ({ type: "object", oneOf: [object({ ...status, ...fields }), error] });

export const productionMediaOutputs = {
  read_production_audio: output({
    previewHash: hash, clipCount: integer, characters: integer, estimateUsd: amount, retryBudgetUsd: amount,
    voices: { type: "object", additionalProperties: id }, tracks: { type: "array", items: track },
  }),
  generate_production_audio: output({ trackId: id }),
  list_production_scenes: output({ items: { type: "array", maxItems: 50, items: sceneSummary }, nextOffset: nullable(integer), total: integer }),
  read_production_scene: output({
    scene: sceneSummary, expectedVersion: nullable(integer), expectedPublication: integer, requiresReconciliation: bool,
    jobs: { type: "array", items: job }, versions: { type: "array", items: sceneVersion },
    selectedVersion: nullable(sceneVersion),
    publications: { type: "array", items: object({ id, versionId: id, revision: integer, audience: publicationAudience }) },
    nextOffset: nullable(integer),
  }),
  generate_production_image: output({ receipt }),
  publish_production_image: output({ receipt }),
};

export const productionMediaDescriptions: Record<ProductionMediaToolName, string> = {
  read_production_audio: "Preview audio generation for a completed game. Returns the frozen preview hash, estimates, and durable track states. Poll this tool after queueing.",
  generate_production_audio: "Queue a completed game's audio from the exact preview hash, or explicitly retry a failed track by ID. Can incur provider costs. Poll read_production_audio for readiness.",
  list_production_scenes: "List canonical image opportunities and active jobs for a completed game and presentation audience. Use the exact scene key and preview hash for a missing image.",
  read_production_scene: "Read scene jobs and verified versions. Use the first page for current revision guards. Pass an exact versionId to receive a private image preview in MCP image content. Use zero-based groupIndex to review additional shots.",
  generate_production_image: "Queue a missing scene from its preview hash or regenerate an existing scene at its exact job revision. Can incur provider costs. Reuse the request ID and identical arguments after an ambiguous response.",
  publish_production_image: "Publish an inspected verified scene version to the explicit audience. Use read_production_scene for the exact version ID and revision guards. Reuse the request ID after an ambiguous response.",
};

const ajv = new Ajv({ strict: false, formats: { uuid: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i } });
const inputs = new Map(productionMediaToolNames.map(name => [name, ajv.compile(productionMediaInputs[name])]));
type MediaArgs = {
  gameIdOrSlug: string; audience: ProductionSceneAudience; sceneKey: string;
  offset?: number; limit?: number; previewHash: string; trackId: string; action?: "generate" | "retry" | "missing" | "regenerate";
  requestId: string; expectedVersion: number; expectedPublication: number; versionId?: string; groupIndex?: number;
  publicationAudience: "public" | "private";
};

function result(structuredContent: object, preview?: Buffer) {
  return {
    structuredContent,
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
      ...(preview ? [{ type: "image" as const, mimeType: "image/jpeg", data: preview.toString("base64") }] : []),
    ],
  };
}

function summarizeScene(value: Awaited<ReturnType<typeof readProductionScene>>["scene"]) {
  const { key, previewHash, sceneId, roomName, round, participants, available, latestVersion, activeJob } = value;
  return { key, previewHash, sceneId, roomName, round, participants, available, latestVersion, activeJob };
}

function summarizeVersion(value: NonNullable<Awaited<ReturnType<typeof readProductionScene>>["selectedVersion"]>) {
  return { id: value.id, version: value.version, verificationVersion: value.verificationVersion, groupCount: value.shots?.groups.length ?? 0 };
}

/** Use the same saved game, generation workers, and publication receipts as Studio. */
export async function executeProductionMedia(db: DrizzleDB, userId: string, name: ProductionMediaToolName, input: unknown) {
  if (!inputs.get(name)!(input)) return result({ status: "rejected", code: "invalid_input", message: "Arguments do not match the production media tool schema." });
  const args = input as MediaArgs;
  try {
    const { id: gameId, status } = await productionGame(db, args.gameIdOrSlug);
    if (status !== "completed") throw new ReplayVisualError("Production media tools require a completed game.", "game_not_completed");
    const ok = { status: "ok", gameId };
    if (name === "read_production_audio") {
      const { source, previewHash, characters, estimateUsd, retryBudgetUsd, existing, voices } = await previewAudioTrack(db, gameId);
      return result({ ...ok, previewHash, clipCount: source.lines.length, characters, estimateUsd, retryBudgetUsd,
        voices: Object.fromEntries(Object.entries(voices).map(([speakerId, voice]) => [speakerId, voice.voiceId])),
        tracks: existing.map(({ id, status, active, retryable }) => ({ id, status, active, retryable })) });
    }
    if (name === "generate_production_audio") {
      if (args.action === "generate") return result({ ...ok, trackId: await queueAudioBackfill(db, gameId, userId, args.previewHash) });
      await retryAudioTrack(db, gameId, args.trackId);
      return result({ ...ok, trackId: args.trackId });
    }

    const { audience, offset, limit, sceneKey, versionId, requestId } = args;
    if (name === "list_production_scenes") {
      const { items, nextOffset, total } = await readProductionScenes(db, gameId, { audience, offset, limit });
      return result({ ...ok, items: items.map(summarizeScene), nextOffset, total });
    }
    const detail = await readProductionScene(db, gameId, sceneKey, { audience, offset, limit, versionId });
    if (name === "read_production_scene") {
      const { media, selectedVersion, pages, requiresReconciliation } = detail;
      let preview: Buffer | undefined;
      if (versionId && selectedVersion) {
        const group = args.groupIndex === undefined ? undefined : selectedVersion.shots?.groups[args.groupIndex];
        if (args.groupIndex !== undefined && !group) throw new ReplayVisualError("The selected version has no group shot at that index.", "invalid_group_index");
        const artifact = await readVisualArtifact(db, gameId, group?.imageArtifactId ?? selectedVersion.imageArtifactId);
        preview = await sharp(artifact).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      }
      return result({
        ...ok, scene: summarizeScene(detail.scene), expectedVersion: offset ? null : media.jobs[0]?.version ?? 0,
        expectedPublication: media.publications[0]?.revision ?? 0, requiresReconciliation,
        jobs: media.jobs.map(({ id, status, step, version }) => ({ id, status, step, version })),
        versions: media.versions.map(summarizeVersion), selectedVersion: selectedVersion ? summarizeVersion(selectedVersion) : null,
        publications: media.publications.map(({ id, versionId, revision, audience }) => ({ id, versionId, revision, audience })),
        nextOffset: pages.nextVersionOffset ?? pages.nextJobOffset ?? pages.nextPublicationOffset,
      }, preview);
    }
    if (name === "generate_production_image" && args.action === "missing") {
      return result({ ...ok, receipt: await renderMissingReplayScene(db, gameId, userId, { key: sceneKey, previewHash: args.previewHash, requestId }) });
    }
    const { sceneId } = detail.scene;
    if (!sceneId) throw new ReplayVisualError("Generate the missing scene first.", "scene_missing");
    const control = { sceneId, requestId, expectedVersion: args.expectedVersion };
    if (name === "generate_production_image") {
      return result({ ...ok, receipt: await controlVisualMedia(db, gameId, userId, { ...control, action: "regenerate" }, { oneAtATime: true }) });
    }
    if ("purpose" in detail.scene && args.publicationAudience === "public" &&
      (detail.scene.purpose !== "village" || detail.scene.audience !== "public")) {
      throw new ReplayVisualError("This scene can only be published to private Werewolf production.", "invalid_publication_audience");
    }
    const published = await controlVisualMedia(db, gameId, userId, {
      ...control, action: "publish", versionId: versionId!,
      expectedPublication: args.expectedPublication, audience: args.publicationAudience,
    }, { oneAtATime: true });
    return result({ ...ok, receipt: published });
  } catch (error) {
    if (error instanceof ReplayVisualError) return result({ status: "rejected", code: error.code, message: error.message });
    if (error instanceof AudioTrackConflict) return result({ status: "rejected", code: "audio_conflict", message: error.message });
    if (error instanceof WerewolfGameError) return result({ status: "rejected", code: "game_unavailable", message: error.message });
    throw error;
  }
}
