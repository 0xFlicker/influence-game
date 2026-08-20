#!/usr/bin/env bun
/**
 * Influence Game — Batch Simulation Runner
 *
 * Runs multiple game simulations and outputs structured analysis.
 *
 * Usage:
 *   bun run simulate
 *   bun run simulate -- --games 5 --players 6
 *   bun run simulate -- --games 3 --players 6 --personas Atlas,Vera,Finn,Mira,Rex,Lyra
 *   bun run simulate -- --variant mingle
 *   bun run simulate -- --variant power-lobby-mingle
 *   bun run simulate -- --variant mingle --diary
 *   bun run simulate -- --variant mingle --house-summaries
 *   bun run simulate -- --variant mingle --rich-producer
 *   bun run simulate -- --variant mingle --chatty --reasoning-summary auto
 *   bun run simulate -- --model-catalog katana:grok-4-3 --reasoning-policy high
 *
 * OPERATOR-ONLY format-kernel proof. Implementing agents document these commands
 * but must not run or wait on them. Start from the reported branch/HEAD with a
 * clean worktree, choose one provider, and keep every batch capped at two rounds.
 *
 * Hosted OpenAI (Doppler dev may set a local base URL; the catalog forces hosted):
 *   doppler run --project social-strategy-agent --config dev -- \
 *     bun run simulate -- \
 *     --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
 *     --model-catalog openai:gpt-5-mini --flex --llm-timeout-sec 900
 *
 * Local LM Studio (load the model and serve 127.0.0.1:1234 first):
 *   INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
 *     bun run simulate:local -- \
 *     --games 1 --players 8 --max-rounds 2 --variant mingle --chatty \
 *     --model <lm-studio-model-id> --llm-timeout-sec 300
 *
 * Inspect the new batch summary.md, game-1.txt, and game-1-turns.jsonl. Flex
 * summaries include tier-aware run spend plus one all-model cost comparison.
 * Require FORMAT MENU -> FORMAT LOCKED -> FORMAT RESOLVE on two-card rounds,
 * model-authored format actions (`decisionSource: "llm"` with useful thinking),
 * no fallback, and no default Power/Council elimination. Omission uses the
 * frozen six-format default. For proof of one round-1-eligible card, append
 * `--formats <id>` and require FORMAT LOCKED -> FORMAT RESOLVE with no
 * format.menu_offered event, format-pick turn, or empowered pick model call.
 * Restricted History requires round 3 plus a round-1-eligible companion format.
 * See
 * docs/local-model-evaluation.md for the complete pass/fail and triage checklist.
 *   # Whole-game timeout is off by default; only set when you want a hard wall clock:
 *   #   --game-timeout-sec 7200
 *
 * The --chatty output (and written transcripts) now interleave House action lines
 * ("X votes: ...", "FORMAT LOCKED: ...", "Y format ballot: ...") with the agent's
 * hidden `thinking` (bright white) and model-side reasoning evidence (bright cyan)
 * when present, including raw local `reasoningContext` or labeled OpenAI summaries.
 *
 * Each game also writes:
 * - `game-{N}-turns.jsonl`: clean structured records for normalized agent turns,
 *   including `thinking` and `reasoningContext` / labeled provider summaries when available.
 * - `game-{N}-events.jsonl`: clean canonical domain events accepted by the engine,
 *   suitable for replaying into a game projection or serving through the local game MCP.
 *   This is the same canonical envelope persisted by API-backed games; CLI
 *   simulations remain local JSONL runs and do not write API database rows.
 *   A direct accepted action may carry the fresh decision receipt returned by
 *   that exact call; accepted writers do not use `getLastPrivateDecisionId()`.
 *   API-backed runs reconcile trace/cognition/prompt-reuse rows only after the
 *   durable append assigns the final sequence. CLI JSONL does not perform that
 *   API-side reconciliation or historical backfill.
 *   API-backed durable checkpoints may expose a status-only hydration passport
 *   through admin inspection, but private player/House continuity capsules and
 *   model reasoning remain outside public transcript, websocket, and canonical
 *   event output. A candidate passport requires sealed checkpoint-boundary
 *   evidence across the manifest, actor witness, accumulators, transcript
 *   watermark, token cursor, and continuity capsules; it is not runtime resume.
 * - `game-{N}-prompt-reuse.json`: structural prompt-prefix reuse rollup (hashes/counts only).
 * - `game-{N}-recall-plan.json`: **safe structural Recall Plan receipt aggregate** for
 *   selective-context-recall evaluation (R16/R17). Contains prompt-class counts,
 *   budget token estimates, selected lane/source-class counts, and an actor-authorized
 *   event-boundary rollup only. It never stores recalled dialogue, names, entry IDs,
 *   rejected counts, prompt payloads, thinking, or reasoning context.
 *   Full simulation JSON / private traces remain separate producer artifacts and are
 *   **not** the R13 promotion input — use this file (or the frozen late-game corpus
 *   tests in `context-recall-evaluation.test.ts`) for the deterministic promotion gate.
 *   A full simulation is the integration/watchability evaluation level, not controlled
 *   evidence that one Recall Plan revision caused a quality change. When that causal
 *   question remains, use the local targeted workflow in
 *   `docs/prompt-thread-context-evaluation.md` before paying for another whole game.
 *   Its `strategic-probe` makes zero provider calls and proves only selection direction
 *   for the two real Mingle-intent contexts, not model use or behavior. The probe's
 *   evaluation-only output includes content-free rank, score, target/current-round
 *   match, serialized-cost, and terminal-reason diagnostics.
 *
 * Use JSONL artifacts for post-run analysis instead of parsing ANSI-colored
 * `game-{N}.txt` output.
 *
 * Live standard rounds make one House `mingle-room-assignment` request from the
 * living roster and locked format, then emit one assignment record per player
 * with source/repair metadata. They do not request per-player `mingle-intent`;
 * historical traces and isolated prompt-lab fixtures may still contain it.
 * Named-alliance records are inspectable through both turns and canonical
 * events: post-pick `alliance-action` turns capture proposal/accept/decline/
 * counter/amend behavior. Each call exposes only its current legal opportunity;
 * the engine binds proposal/version identity and maps request-local amendment
 * handles. `alliance-huddle-schedule` turns capture private House
 * grant/skip rationale, `alliance-huddle-turn` records capture member speech
 * plus structured target/action/commitment/contingency/dissent facts, and
 * `alliance-huddle-outcome` records carry those facts forward alongside a
 * compact House summary. Huddle transcript entries use `scope: "huddle"` and
 * are producer/debug evidence, not public/player-safe live transcript.
 * Modern product-dialogue capture also carries additive normalized actor
 * identity, audience, dialogue kind, and formal-speech correlation context for
 * durable API match-read surfaces; local `--chatty` formatting and simulation
 * artifacts remain first-class and continue to surface thinking / reasoningContext
 * for human review without treating them as public speech.
 * Format-kernel turns record `format-pick` when a two-card menu exists,
 * `format-ballot`, `bounce-pointer`, `format-tiebreak`, and one post-commit
 * `elimination-message` action. The
 * elimination message receives named voters only for public votes; sealed
 * formats pass received counts without voter identities. This participating-agent
 * context is intentionally narrower than operator transport: sanitized accepted
 * ballot mappings are readable there immediately after durable record, while
 * viewer named Roll Call presentation remains resolution-gated. Together the format
 * records expose nine typed agent decisions: pickRoundFormat,
 * getSaveOrEliminateBallot, getVoteBombBallot, getMajorityEliminationBallot,
 * getEvenVotesBallot, getRestrictedHistoryBallot,
 * getBouncePointer, getSafetyBounceVote, and breakFormatEliminationTie. Their
 * responses include `decisionSource` and nullable `fallbackReason`; reasoning
 * is diagnostic evidence, never canonical game fact. Safety Bounce pointer
 * prompts render the acting player's computed status and the exact consequence:
 * SAFE makes the target VULNERABLE; VULNERABLE makes the target SAFE.
 * Specialized
 * `candidate-selection`, `power-action`, and Council records remain readable
 * for legacy/classic runs but are not the expected standard-round lane.
 * Private decision turns carry compact strategy candidates on existing gameplay
 * and diary calls; there is no separate strategic-reflection cadence. Ordinary
 * `strategyDelta` values are reserved for exceptional actionable changes to
 * future posture. Strict schemas use JSON null, and compatible non-strict outputs
 * may omit the field, when current strategy still applies. The exact string
 * `"null"` is normalized to the same no-change outcome. Producer review should
 * retain accepted/rejected/no-change diagnostics and group strategy-candidate
 * counts plus output tokens by action family without treating prose as canonical
 * fact or alliance obligation. In
 * API-backed games, versioned player continuity capsules carry compact strategy
 * state across supported phase-boundary startup recovery;
 * local CLI simulations remain uninterrupted-run artifacts unless an API path
 * is used.
 *
 * Prompt-continuity validation should check the current-board contract in
 * player prompts, phase-specific format/endgame rules, typed recent decisions,
 * questions-only Judgment prompts for jurors, and legacy Council role-aware
 * diary prompts when that classic lane is exercised. These keep eliminated
 * players useful as history, jury context, or social evidence without turning
 * them back into live targets.
 * API-backed saved agents also pass owner-authored personality, backstory,
 * strategy instructions, and temperature into InfluenceAgent. Those inputs,
 * together with resolved model/provider/reasoning/tool policy, define the
 * effective analytical revision; simulation comparisons should hold the same
 * snapshot constant rather than relying on a mutable display profile.
 *
 * `--rich-producer` enables private House Strategy Bible Packet updates,
 * packet-backed long-form House summaries, bounded format-resolution diary
 * sessions, legacy Council diary compatibility, and producer-brief records for
 * validating House strategic carry-forward through the local game MCP.
 * Use `--diary` when you only want those bounded diary sessions without the
 * private rich-producer packet stack.
 * Default console mode (no `--chatty`) prints an **operator action feed**: phase
 * markers, room seating, votes/format choices/ballots, alliance actions, House
 * outcome lines, and House MC summaries — without thinking/reasoning spam.
 * Use `--chatty` for full transcript + thinking/reasoning. Use
 * `--no-operator-feed` / `--quiet` for phase-progress-only. Use
 * `--no-house-summaries` to suppress the between-round House MC block.
 * Structured round facts remain in the house-mc-summary turns JSONL payload.
 */

import type OpenAI from "openai";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { GameRunner, type AgentTurnEvent, type GameStreamEvent, type TranscriptEntry } from "./game-runner";
import type { CanonicalGameEvent } from "./canonical-events";
import { InfluenceAgent, type Personality } from "./agent";
import { LLMHouseInterviewer } from "./house-interviewer";
import { PromptReuseAggregate, RecallPlanReceiptAggregate } from "./prompt-reuse";
import { DEFAULT_CONFIG, MIN_NEW_GAME_PLAYERS, Phase, type GameConfig, type UUID } from "./types";
import { resolveFormatManifest, type LaunchFormatId } from "./formats";
import {
  TokenTracker,
  estimateCostAllModels,
  estimateCostAllModelsForFlexRun,
  estimateTierAwareOpenAICost,
  type TokenUsage,
  type CostEstimate,
  type ServiceTierUsage,
  type TierAwareCostEstimate,
  type OpenAIServiceTier,
} from "./token-tracker";
import {
  aggregateInstrumentation,
  instrumentGame,
  type BatchInstrumentation,
  type GameInstrumentation,
  type GitMetadata,
  type SimulationRunMetadata,
} from "./simulation-instrumentation";
import { createLlmClientFromEnv, describeLlmProvider } from "./llm-client";
import type { LlmToolChoiceMode, OpenAIReasoningSummaryMode } from "./llm-client";
import {
  DEFAULT_MODEL_ID,
  inferModelCapabilities,
  normalizeReasoningPolicy,
  resolveCatalogIdForModel,
  resolveModelSelection,
  type ModelReasoningPolicy,
  type ModelRequestCapabilities,
  type ProviderProfileId,
} from "./model-catalog";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/** Per-request LLM timeout only. Whole-game timeout is opt-in (null = none). */
const DEFAULT_LLM_TIMEOUT_MS = 45 * 1000;

export interface SimArgs {
  games: number;
  players: number;
  /** Cap standard rounds so the sim can stop before endgame (alive count hits 4). */
  maxRounds: number;
  personas: string[] | null;
  model: string;
  modelCatalogId?: string;
  reasoningPolicy?: ModelReasoningPolicy;
  variant: string;
  /**
   * Whole-game wall-clock timeout in ms. Null means no game-level timeout —
   * only set when the user passes --game-timeout-* or INFLUENCE_SIM_GAME_TIMEOUT_MS.
   */
  gameTimeoutMs: number | null;
  llmTimeoutMs: number;
  /** Chatty mode: print formatted transcript entries live to console as they happen. */
  chatty: boolean;
  /**
   * Operator action feed (default on): print choice/outcome lines live without
   * thinking/reasoning. Independent of chatty; chatty adds transcript + reasoning.
   */
  operatorFeed: boolean;
  /** Print concise House MC summaries live (default on; independent of chatty). */
  houseSummaries: boolean;
  /** Enable House Strategy Bible, long-form summaries, producer briefs, and bounded diary validation. */
  richProducer?: boolean;
  /** Enable bounded diary-room sessions in simulation config. */
  enableDiary?: boolean;
  /** Hosted OpenAI Responses API reasoning summary mode. Null disables it. */
  openAIReasoningSummary?: OpenAIReasoningSummaryMode | null;
  /** Use OpenAI Flex processing, with a per-request standard-tier fallback after three Flex 429s. */
  flex: boolean;
  /** Frozen legal format subset for every game in this batch. */
  formatManifest: LaunchFormatId[];
}

interface SimulationModelRuntime {
  modelId: string;
  providerProfileId: ProviderProfileId;
  catalogId?: string;
  capabilities: ModelRequestCapabilities;
  reasoningPolicy: ModelReasoningPolicy;
  preferredToolChoiceMode?: LlmToolChoiceMode;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReasoningSummaryArg(value: string | undefined): OpenAIReasoningSummaryMode | null | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") {
    return normalized;
  }
  if (normalized === "off" || normalized === "none" || normalized === "false" || normalized === "disabled") {
    return null;
  }
  console.warn(`Ignoring invalid reasoning summary mode "${value}". Use auto, concise, detailed, or off.`);
  return undefined;
}

export function parseArgs(argv = process.argv.slice(2)): SimArgs {
  const envGameTimeout = process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS;
  const args: SimArgs = {
    games: 3,
    players: MIN_NEW_GAME_PLAYERS,
    maxRounds: 10,
    personas: null,
    model: DEFAULT_MODEL_ID,
    ...(process.env.INFLUENCE_SIM_MODEL_CATALOG_ID && { modelCatalogId: process.env.INFLUENCE_SIM_MODEL_CATALOG_ID }),
    ...(normalizeReasoningPolicy(process.env.INFLUENCE_SIM_REASONING_POLICY) && {
      reasoningPolicy: normalizeReasoningPolicy(process.env.INFLUENCE_SIM_REASONING_POLICY)!,
    }),
    variant: process.env.INFLUENCE_SIM_VARIANT ?? "baseline",
    // No whole-game timeout unless env or CLI sets one (local/LLM sims regularly exceed 10m).
    gameTimeoutMs: envGameTimeout ? readPositiveInt(envGameTimeout, 0) || null : null,
    llmTimeoutMs: readPositiveInt(process.env.INFLUENCE_SIM_LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS),
    chatty: false,
    operatorFeed: process.env.INFLUENCE_SIM_OPERATOR_FEED !== "false",
    // House MC is generated by default; print it unless explicitly disabled.
    houseSummaries: process.env.INFLUENCE_SIM_HOUSE_SUMMARIES !== "false",
    richProducer: process.env.INFLUENCE_SIM_RICH_PRODUCER === "true",
    enableDiary: process.env.INFLUENCE_SIM_DIARY === "true",
    openAIReasoningSummary: undefined,
    flex: true,
    formatManifest: resolveFormatManifest(undefined),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--games" && next) {
      args.games = parseInt(next, 10);
      i++;
    } else if (arg === "--players" && next) {
      args.players = Number(next);
      i++;
    } else if ((arg === "--max-rounds" || arg === "--rounds") && next) {
      args.maxRounds = parseInt(next, 10);
      i++;
    } else if (arg === "--personas" && next) {
      args.personas = next.split(",").map((s) => s.trim());
      i++;
    } else if (arg === "--model" && next) {
      args.model = next;
      i++;
    } else if ((arg === "--model-catalog" || arg === "--model-catalog-id") && next) {
      args.modelCatalogId = next;
      i++;
    } else if ((arg === "--reasoning-policy" || arg === "--thinking-depth") && next) {
      const reasoningPolicy = normalizeReasoningPolicy(next);
      if (reasoningPolicy) {
        args.reasoningPolicy = reasoningPolicy;
      } else {
        console.warn(`Ignoring invalid reasoning policy "${next}". Use action-policy, low, medium, or high.`);
      }
      i++;
    } else if (arg === "--variant" && next) {
      args.variant = next;
      i++;
    } else if ((arg === "--formats" || arg === "--format-manifest") && next !== undefined) {
      args.formatManifest = resolveFormatManifest(
        next.split(",").map((value) => value.trim()).filter(Boolean),
      );
      i++;
    } else if (arg === "--game-timeout-ms" && next) {
      args.gameTimeoutMs = readPositiveInt(next, 0) || null;
      i++;
    } else if (arg === "--game-timeout-sec" && next) {
      const parsedSeconds = readPositiveInt(next, 0);
      args.gameTimeoutMs = parsedSeconds > 0 ? parsedSeconds * 1000 : null;
      i++;
    } else if (arg === "--no-game-timeout" || arg === "--game-timeout-off") {
      args.gameTimeoutMs = null;
    } else if (arg === "--llm-timeout-ms" && next) {
      args.llmTimeoutMs = parseInt(next, 10);
      i++;
    } else if (arg === "--llm-timeout-sec" && next) {
      args.llmTimeoutMs = parseInt(next, 10) * 1000;
      i++;
    } else if (arg === "--chatty" || arg === "--verbose" || arg === "-v") {
      args.chatty = true;
    } else if (arg === "--operator-feed" || arg === "--actions") {
      args.operatorFeed = true;
    } else if (arg === "--no-operator-feed" || arg === "--quiet") {
      args.operatorFeed = false;
    } else if (arg === "--house-summaries" || arg === "--summaries") {
      args.houseSummaries = true;
    } else if (arg === "--no-house-summaries" || arg === "--no-summaries") {
      args.houseSummaries = false;
    } else if (arg === "--rich-producer") {
      args.richProducer = true;
      args.enableDiary = true;
    } else if (arg === "--no-rich-producer") {
      args.richProducer = false;
    } else if (arg === "--diary" || arg === "--enable-diary") {
      args.enableDiary = true;
    } else if (arg === "--no-diary") {
      args.enableDiary = false;
    } else if (arg === "--reasoning-summary" && next) {
      args.openAIReasoningSummary = parseReasoningSummaryArg(next);
      i++;
    } else if (arg === "--no-reasoning-summary") {
      args.openAIReasoningSummary = null;
    } else if (arg === "--standard" || arg === "--no-flex") {
      args.flex = false;
    } else if (arg === "--flex") {
      args.flex = true;
    } else if (arg === "--standard" || arg === "--no-flex") {
      args.flex = false;
    }
  }

  if (args.richProducer === true) {
    args.enableDiary = true;
  }

  if (isNaN(args.games) || args.games < 1) args.games = 3;
  if (!Number.isInteger(args.players) || args.players < MIN_NEW_GAME_PLAYERS) {
    throw new Error(`--players must be an integer of at least ${MIN_NEW_GAME_PLAYERS}`);
  }
  if (args.personas && args.personas.length < MIN_NEW_GAME_PLAYERS) {
    throw new Error(`--personas must include at least ${MIN_NEW_GAME_PLAYERS} names`);
  }
  if (args.players > DEFAULT_CONFIG.maxPlayers) args.players = DEFAULT_CONFIG.maxPlayers;
  // At least 1 standard round; keep an upper bound so typos don't run forever.
  if (isNaN(args.maxRounds) || args.maxRounds < 1) args.maxRounds = 1;
  if (args.maxRounds > 50) args.maxRounds = 50;
  if (args.gameTimeoutMs !== null && (isNaN(args.gameTimeoutMs) || args.gameTimeoutMs < 1)) {
    args.gameTimeoutMs = null;
  }
  if (isNaN(args.llmTimeoutMs) || args.llmTimeoutMs < 1) args.llmTimeoutMs = DEFAULT_LLM_TIMEOUT_MS;

  return args;
}

function readGitField(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readGitMetadata(): GitMetadata {
  const commitSha = readGitField(["rev-parse", "HEAD"]);
  const status = readGitField(["status", "--porcelain"]);

  return {
    branch: readGitField(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha,
    commitShortSha: commitSha ? commitSha.slice(0, 7) : null,
    isDirty: status === null ? null : status.length > 0,
  };
}

function buildRunMetadata(
  args: SimArgs,
  timestamp: string,
  openAIReasoningSummary?: OpenAIReasoningSummaryMode,
  modelRuntime?: SimulationModelRuntime,
): SimulationRunMetadata {
  return {
    variant: args.variant,
    timestamp,
    command: process.argv.join(" "),
    cwd: process.cwd(),
    git: readGitMetadata(),
    args: {
      games: args.games,
      players: args.players,
      maxRounds: args.maxRounds,
      personas: args.personas,
      model: modelRuntime?.modelId ?? args.model,
      ...(modelRuntime?.catalogId && { modelCatalogId: modelRuntime.catalogId }),
      ...(modelRuntime?.providerProfileId && { providerProfileId: modelRuntime.providerProfileId }),
      ...(modelRuntime?.reasoningPolicy && { reasoningPolicy: modelRuntime.reasoningPolicy }),
      ...(args.modelCatalogId && { modelCatalogId: args.modelCatalogId }),
      ...(args.reasoningPolicy && { reasoningPolicy: args.reasoningPolicy }),
      variant: args.variant,
      gameTimeoutMs: args.gameTimeoutMs,
      llmTimeoutMs: args.llmTimeoutMs,
      operatorFeed: args.operatorFeed,
      houseSummaries: args.houseSummaries,
      richProducer: args.richProducer ?? false,
      enableDiary: args.enableDiary ?? false,
      openAIReasoningSummary,
      flex: args.flex,
    },
  };
}

const POWER_LOBBY_VARIANTS = new Set([
  "power-lobby",
  "power-lobby-after-vote",
  "power-lobby-v2",
  "power-lobby-mingle",
  "mingle-power-lobby",
  "power-lobby-v2-mingle",
  "mingle-power-lobby-v2",
]);

const MINGLE_VARIANTS = new Set([
  "baseline",
  "mingle",
  "power-lobby-mingle",
  "mingle-power-lobby",
  "power-lobby-v2-mingle",
  "mingle-power-lobby-v2",
]);

export function isPowerLobbyVariant(variant: string): boolean {
  return POWER_LOBBY_VARIANTS.has(variant.toLowerCase());
}

export function isMingleVariant(variant: string): boolean {
  return MINGLE_VARIANTS.has(variant.toLowerCase());
}

export function buildSimulationConfig(
  variant: string,
  options: {
    agentActionTimeoutMs?: number;
    richProducer?: boolean;
    enableDiary?: boolean;
    maxRounds?: number;
    formatManifest?: readonly LaunchFormatId[];
  } = {},
): GameConfig {
  const mingle = isMingleVariant(variant);
  const richProducer = options.richProducer === true;
  const enableDiary = options.enableDiary === true || richProducer;
  const maxRounds = options.maxRounds ?? 10;

  return {
    ...DEFAULT_CONFIG,
    timers: {
      introduction: 0,
      lobby: 0,
      mingle: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
      plea: 0,
      accusation: 0,
      defense: 0,
      openingStatements: 0,
      juryQuestions: 0,
      closingArguments: 0,
      juryVote: 0,
    },
    maxRounds,
    formatManifest: resolveFormatManifest(options.formatManifest),
    diaryRoomAfterPhases: enableDiary ? [Phase.FORMAT_RESOLVE, Phase.COUNCIL] : [],
    lobbyMessagesPerPlayer: 1,
    powerLobbyAfterVote: isPowerLobbyVariant(variant),
    mingleSessionsPerRound: mingle ? 3 : DEFAULT_CONFIG.mingleSessionsPerRound,
    agentActionTimeoutMs: options.agentActionTimeoutMs ?? 90_000,
    enableHouseRoundSummaries: true,
    enableHouseStrategyBible: richProducer,
    enableHouseLongFormSummaries: richProducer,
    enableHouseProducerBriefs: richProducer,
  };
}

// ---------------------------------------------------------------------------
// Cast of available personas
// ---------------------------------------------------------------------------

const FULL_CAST: Array<{ name: string; personality: Personality }> = [
  { name: "Atlas", personality: "strategic" },
  { name: "Vera", personality: "deceptive" },
  { name: "Finn", personality: "honest" },
  { name: "Mira", personality: "social" },
  { name: "Rex", personality: "aggressive" },
  { name: "Lyra", personality: "paranoid" },
  { name: "Kael", personality: "loyalist" },
  { name: "Echo", personality: "observer" },
  { name: "Sage", personality: "diplomat" },
  { name: "Jace", personality: "wildcard" },
  { name: "Rune", personality: "provocateur" },
  { name: "Wren", personality: "martyr" },
  { name: "Nyx", personality: "contrarian" },
  { name: "Vex", personality: "broker" },
];

function selectCast(
  count: number,
  requestedPersonas: string[] | null,
  openai: OpenAI,
  modelRuntime: SimulationModelRuntime,
  toolChoiceMode: LlmToolChoiceMode = "named",
  openAIReasoningSummary?: OpenAIReasoningSummaryMode,
  privateTraceSink?: import("./game-runner").PrivateTraceSink,
): InfluenceAgent[] {
  let selected: Array<{ name: string; personality: Personality }>;

  if (requestedPersonas) {
    // Match requested names to the full cast
    selected = requestedPersonas
      .map((name) => FULL_CAST.find((c) => c.name.toLowerCase() === name.toLowerCase()))
      .filter((c): c is { name: string; personality: Personality } => c != null);

    if (selected.length < MIN_NEW_GAME_PLAYERS) {
      console.error(
        `Error: Only ${selected.length} valid personas found. Need at least ${MIN_NEW_GAME_PLAYERS}. Available: ${FULL_CAST.map((c) => c.name).join(", ")}`,
      );
      process.exit(1);
    }
  } else {
    // Shuffle and pick `count` from the full cast
    const shuffled = [...FULL_CAST].sort(() => Math.random() - 0.5);
    selected = shuffled.slice(0, Math.min(count, shuffled.length));
  }

  return selected.map(({ name, personality }) => {
    const id: UUID = randomUUID();
    return new InfluenceAgent(id, name, personality, openai, modelRuntime.modelId, undefined, undefined, {
      toolChoiceMode,
      ...(openAIReasoningSummary && { openAIReasoningSummary }),
      providerProfileId: modelRuntime.providerProfileId,
      ...(modelRuntime.catalogId && { catalogId: modelRuntime.catalogId }),
      modelCapabilities: modelRuntime.capabilities,
      reasoningPolicy: modelRuntime.reasoningPolicy,
      privateTraceSink,
    });
  });
}

// ---------------------------------------------------------------------------
// Game result types
// ---------------------------------------------------------------------------

export interface GameResult {
  gameNumber: number;
  status: "completed" | "failed";
  winnerName: string | undefined;
  winnerPersona: string | undefined;
  rounds: number;
  eliminationOrder: string[];
  endgameType: string;
  playerPersonas: Record<string, string>;
  durationMs: number;
  transcriptPath: string;
  jsonPath: string;
  progressPath: string;
  turnsPath: string;
  eventsPath: string;
  error?: string;
  tokenUsage: {
    perAgent: Record<string, TokenUsage>;
    total: TokenUsage;
    byServiceTier: ServiceTierUsage;
  };
  instrumentation: GameInstrumentation;
}

export interface AggregateStats {
  metadata: SimulationRunMetadata;
  requestedGames: number;
  attemptedGames: number;
  totalGames: number;
  completedGames: number;
  failedGames: number;
  partial: boolean;
  model: string;
  perPersona: Record<
    string,
    {
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgSurvivalRound: number;
      timesEmpowered: number;
      timesOnJury: number;
    }
  >;
  perEndgameType: Record<string, number>;
  overall: {
    avgGameLength: number;
    roundDistribution: Record<number, number>;
    avgDurationMs: number;
  };
  tokenUsage: {
    total: TokenUsage;
    costEstimates: CostEstimate[];
    byServiceTier: ServiceTierUsage;
    tierAwareCost: TierAwareCostEstimate | null;
    flexCostEstimates: CostEstimate[];
  };
  instrumentation: BatchInstrumentation;
}

// ---------------------------------------------------------------------------
// Extract data from transcript
// ---------------------------------------------------------------------------

function extractEndgameType(transcript: readonly TranscriptEntry[]): string {
  let lastStage = "normal";
  for (const entry of transcript) {
    if (entry.scope === "system") {
      if (entry.text.includes("THE JUDGMENT")) lastStage = "judgment";
      else if (entry.text.includes("THE TRIBUNAL")) lastStage = "tribunal";
      else if (entry.text.includes("THE RECKONING")) lastStage = "reckoning";
    }
  }
  return lastStage;
}

function getSurvivalRound(
  eliminationOrder: string[],
  playerName: string,
  totalRounds: number,
): number {
  const idx = eliminationOrder.indexOf(playerName);
  if (idx === -1) return totalRounds; // Survived to the end
  // Approximate: eliminated earlier = lower round
  return Math.max(1, Math.ceil(((idx + 1) / eliminationOrder.length) * totalRounds));
}

function mergeServiceTierUsage(target: ServiceTierUsage, source: ServiceTierUsage): void {
  for (const [tier, usage] of Object.entries(source) as Array<[OpenAIServiceTier, TokenUsage]>) {
    const total = target[tier] ?? {
      promptTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      callCount: 0,
      emptyResponses: 0,
    };
    total.promptTokens += usage.promptTokens;
    total.cachedTokens += usage.cachedTokens;
    total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    total.completionTokens += usage.completionTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.totalTokens += usage.totalTokens;
    total.callCount += usage.callCount;
    total.emptyResponses += usage.emptyResponses;
    target[tier] = total;
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats computation
// ---------------------------------------------------------------------------

export function computeAggregateStats(
  results: GameResult[],
  model: string,
  metadata: SimulationRunMetadata,
  partial = false,
): AggregateStats {
  const completedResults = results.filter((result) => result.status === "completed");
  const perPersona: AggregateStats["perPersona"] = {};
  const perEndgameType: Record<string, number> = {};
  let totalRounds = 0;
  let totalDuration = 0;
  const roundDist: Record<number, number> = {};
  const batchTokens: TokenUsage = {
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    callCount: 0,
    emptyResponses: 0,
  };
  const batchServiceTierUsage: ServiceTierUsage = {};

  for (const result of completedResults) {
    // Track rounds
    totalRounds += result.rounds;
    totalDuration += result.durationMs;
    roundDist[result.rounds] = (roundDist[result.rounds] ?? 0) + 1;

    // Track endgame types
    perEndgameType[result.endgameType] = (perEndgameType[result.endgameType] ?? 0) + 1;

    // Strategy stats apply only to completed games. Spend is accumulated below
    // across all attempted games, including partially completed failures.

    // Track per-persona stats
    for (const [name, persona] of Object.entries(result.playerPersonas)) {
      if (!perPersona[persona]) {
        perPersona[persona] = {
          gamesPlayed: 0,
          wins: 0,
          winRate: 0,
          avgSurvivalRound: 0,
          timesEmpowered: 0,
          timesOnJury: 0,
        };
      }
      const stats = perPersona[persona]!;
      stats.gamesPlayed++;
      if (result.winnerName === name) stats.wins++;
      stats.avgSurvivalRound += getSurvivalRound(
        result.eliminationOrder,
        name,
        result.rounds,
      );
    }
  }

  for (const result of results) {
    batchTokens.promptTokens += result.tokenUsage.total.promptTokens;
    batchTokens.cachedTokens += result.tokenUsage.total.cachedTokens;
    batchTokens.cacheWriteTokens = (batchTokens.cacheWriteTokens ?? 0) + (result.tokenUsage.total.cacheWriteTokens ?? 0);
    batchTokens.completionTokens += result.tokenUsage.total.completionTokens;
    batchTokens.reasoningTokens += result.tokenUsage.total.reasoningTokens;
    batchTokens.totalTokens += result.tokenUsage.total.totalTokens;
    batchTokens.callCount += result.tokenUsage.total.callCount;
    batchTokens.emptyResponses += result.tokenUsage.total.emptyResponses;
    mergeServiceTierUsage(batchServiceTierUsage, result.tokenUsage.byServiceTier);
  }

  // Compute averages
  for (const stats of Object.values(perPersona)) {
    stats.winRate = stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;
    stats.avgSurvivalRound =
      stats.gamesPlayed > 0 ? stats.avgSurvivalRound / stats.gamesPlayed : 0;
  }

  return {
    metadata,
    requestedGames: metadata.args.games,
    attemptedGames: results.length,
    totalGames: completedResults.length,
    completedGames: completedResults.length,
    failedGames: results.length - completedResults.length,
    partial,
    model,
    perPersona,
    perEndgameType,
    overall: {
      avgGameLength: completedResults.length > 0 ? totalRounds / completedResults.length : 0,
      roundDistribution: roundDist,
      avgDurationMs: completedResults.length > 0 ? totalDuration / completedResults.length : 0,
    },
    tokenUsage: {
      total: batchTokens,
      costEstimates: estimateCostAllModels(batchTokens),
      byServiceTier: batchServiceTierUsage,
      tierAwareCost: metadata.args.flex
        ? estimateTierAwareOpenAICost(batchServiceTierUsage, model)
        : null,
      flexCostEstimates: metadata.args.flex ? estimateCostAllModelsForFlexRun(batchTokens) : [],
    },
    instrumentation: aggregateInstrumentation(completedResults.map((result) => result.instrumentation)),
  };
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------

function formatEntry(e: TranscriptEntry): string {
  const reset = "\x1b[0m";
  const thinkingColor = "\x1b[97m";
  const reasoningColor = "\x1b[96m";
  const yellow = "\x1b[33m";
  const prefix = `R${e.round}/${e.phase}`;
  const roomTag = e.roomId != null ? ` room=${e.roomId}` : "";
  const scopeTag = e.scope === "mingle"
    ? ` [mingle→${e.to?.join(",") || ""}${roomTag}]`
    : e.scope === "whisper"
      ? ` [whisper→${e.to?.join(",") || ""}]`
      : e.scope === "huddle"
        ? " [huddle]"
        : e.scope === "thinking"
          ? " [thinking]"
          : "";
  let line = `${prefix} ${e.from}${scopeTag}: ${e.text}`;
  const t = (e.thinking || "").trim();
  const r = (e.reasoningContext || "").trim();
  if (t && r && t === r) {
    // Identical content (common for local reasoning models + tool "thinking" schema):
    // show the reasoning evidence once (cyan). Streaming reasoning contexts and
    // provider summaries are first-class for --chatty observability; duplicate reprint
    // after the message (e.g. under "summary prompt" history in takeMingleTurn) is not needed.
    line += `\n    ${reasoningColor}reasoning: ${e.reasoningContext}${reset}`;
  } else {
    if (e.thinking) {
      line += `\n    ${thinkingColor}thinking: ${e.thinking}${reset}`;
    }
    if (e.reasoningContext) {
      line += `\n    ${reasoningColor}reasoning: ${e.reasoningContext}${reset}`;
    }
  }
  // Color system/House lines for better readability
  if (e.from === "House" || e.scope === "system") {
    line = `${yellow}${line}${reset}`;
  }
  return line;
}

function formatTranscript(transcript: readonly TranscriptEntry[]): string {
  return transcript.map(formatEntry).join("\n");
}

const TRANSCRIPT_BACKED_AGENT_TURN_ACTIONS = new Set([
  "introduction",
  "lobby-message",
  "rumor",
  "vote",
  "empower-revote",
  "endgame-elimination-vote",
  "tribunal-jury-tiebreaker-vote",
  "elimination-message",
  "council-vote",
  "plea",
  "accusation",
  "tribunal-defense",
  "opening-statement",
  "jury-question",
  "jury-answer",
  "closing-argument",
  "jury-vote",
  "power-lobby-message",
  "power-action",
  "diary-answer",
]);

function isTranscriptBackedAgentTurn(event: AgentTurnEvent): boolean {
  if (event.action === "mingle-turn") {
    // Delivered room speech already prints as a transcript entry; keep that path.
    // Operator-only no_reply / movement facts print via the agent-turn trace.
    return event.response.messageDelivered === true;
  }
  return TRANSCRIPT_BACKED_AGENT_TURN_ACTIONS.has(event.action);
}

function shouldPrintChattyAgentTurn(event: AgentTurnEvent): boolean {
  if (isTranscriptBackedAgentTurn(event)) return false;
  // Operator fact lines (text) should print even without model thinking.
  return Boolean(event.thinking || event.reasoningContext || (event.text && event.text.trim()));
}

export function formatAgentTurnTrace(event: AgentTurnEvent): string | null {
  if (!shouldPrintChattyAgentTurn(event)) return null;

  const reset = "\x1b[0m";
  const thinkingColor = "\x1b[97m";
  const reasoningColor = "\x1b[96m";
  const prefix = `R${event.round}/${event.phase}`;
  const to = event.to && event.to.length > 0 ? `→${event.to.join(",")}` : "";
  const room = event.roomId != null ? ` room=${event.roomId}` : "";
  let line = `${prefix} ${event.actor.name} [trace:${event.action}${to}${room}]`;
  if (event.text) {
    line += `: ${event.text}`;
  }

  const t = (event.thinking || "").trim();
  const r = (event.reasoningContext || "").trim();
  if (t && r && t === r) {
    line += `\n    ${reasoningColor}reasoning: ${event.reasoningContext}${reset}`;
  } else {
    if (event.thinking) {
      line += `\n    ${thinkingColor}thinking: ${event.thinking}${reset}`;
    }
    if (event.reasoningContext) {
      line += `\n    ${reasoningColor}reasoning: ${event.reasoningContext}${reset}`;
    }
  }
  return line;
}

/** Actions that are pure producer/debug and skip the default operator action feed. */
const OPERATOR_FEED_SKIP_ACTIONS = new Set([
  "house-producer-brief",
  "house-strategy-bible",
  "house-long-form-summary",
  "diary-answer",
]);

/**
 * Compact one-line operator feed entry (no thinking/reasoning).
 * Default non-chatty console uses this so you can follow gameplay without --chatty.
 */
export function formatOperatorActionLine(event: AgentTurnEvent): string | null {
  if (OPERATOR_FEED_SKIP_ACTIONS.has(event.action)) return null;

  if (event.action === "house-mc-summary") {
    // Printed separately as [House MC] so we do not double-print here.
    return null;
  }

  const text = typeof event.text === "string" ? event.text.trim() : "";
  if (!text) return null;

  const speaker = event.actor?.name?.trim() ?? "";
  // Speech turns (lobby/intro/etc.) store only the message body; always name the speaker.
  // Decision turns often already start with the actor name ("Finn votes: …") — don't double it.
  const textAlreadyNamed =
    speaker.length > 0 &&
    (text === speaker ||
      text.startsWith(`${speaker} `) ||
      text.startsWith(`${speaker}:`) ||
      text.startsWith(`${speaker}→`) ||
      text.startsWith(`${speaker} `) ||
      text.startsWith(`${speaker} sealed`) ||
      text.startsWith(`${speaker} intent`) ||
      text.startsWith(`${speaker} alliance`) ||
      text.startsWith(`${speaker} huddle`) ||
      text.startsWith(`${speaker} reflection`) ||
      text.startsWith(`${speaker} strategy`) ||
      text.startsWith(`${speaker} room`) ||
      text.startsWith(`${speaker} →`));
  if (speaker && speaker !== "House" && speaker !== "The House" && !textAlreadyNamed) {
    return `  R${event.round}/${event.phase} ${speaker}: ${text}`;
  }
  return `  R${event.round}/${event.phase}: ${text}`;
}

/** House system announcements that carry operator-critical board facts. */
export function isOperatorHouseSystemLine(text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  if (/^=== /.test(line)) return true;
  if (/^(Empowered:|FORMAT |RULES:|ELIMINATED:|Elimination:|Empowered tiebreak|Re-vote |Bounce:|Bounce complete)/i.test(line)) {
    return true;
  }
  if (/ballots?:/i.test(line) || / nets:/i.test(line) || /vote reveal:/i.test(line)) return true;
  if (/Format .+ eliminated/i.test(line)) return true;
  if (/Open rooms are skipped/i.test(line)) return true;
  return false;
}

export function formatRoomAllocationOperatorLine(entry: TranscriptEntry): string | null {
  if (!entry.roomMetadata) return null;
  const text = entry.text?.trim();
  if (text) {
    return `  R${entry.round}/${entry.phase}: rooms — ${text}`;
  }
  const rooms = entry.roomMetadata.rooms
    .map((room) => {
      // RoomAllocation may only have playerIds; names live in entry text when present.
      return `Room ${room.roomId} (${room.playerIds.length})`;
    })
    .join(" | ");
  return `  R${entry.round}/${entry.phase}: rooms — ${rooms || "none"} | excluded=${entry.roomMetadata.excluded.join(", ") || "none"}`;
}

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

export function renderMarkdownSummary(stats: AggregateStats, results: GameResult[]): string {
  const lines: string[] = [];

  lines.push("# Simulation Results");
  lines.push("");
  lines.push(`**Variant:** ${stats.metadata.variant}`);
  lines.push(`**Git:** ${stats.metadata.git.commitShortSha ?? "unknown"} (${stats.metadata.git.branch ?? "unknown branch"}${stats.metadata.git.isDirty ? ", dirty" : ""})`);
  lines.push(`**Command:** \`${stats.metadata.command}\``);
  lines.push(`**Timestamp:** ${stats.metadata.timestamp}`);
  lines.push(`**Games completed:** ${stats.completedGames}/${stats.requestedGames}`);
  lines.push(`**Games attempted:** ${stats.attemptedGames}`);
  if (stats.failedGames > 0) lines.push(`**Failed games:** ${stats.failedGames}`);
  if (stats.partial) lines.push("**Partial batch:** yes");
  lines.push(`**Model:** ${stats.model}`);
  lines.push(
    `**Timeouts:** game ${stats.metadata.args.gameTimeoutMs == null ? "none" : `${(stats.metadata.args.gameTimeoutMs / 1000).toFixed(0)}s`}, LLM request ${(stats.metadata.args.llmTimeoutMs / 1000).toFixed(0)}s`,
  );
  lines.push(`**Avg game length:** ${stats.overall.avgGameLength.toFixed(1)} rounds`);
  lines.push(
    `**Avg duration:** ${(stats.overall.avgDurationMs / 1000).toFixed(0)}s per game`,
  );
  lines.push("");

  // Instrumentation summary
  lines.push("## Instrumentation");
  lines.push("");
  lines.push("| Signal | Count |");
  lines.push("|--------|------:|");
  lines.push(`| Power actions | ${stats.instrumentation.powerActions.total} |`);
  lines.push(`| Power eliminate | ${stats.instrumentation.powerActions.counts.eliminate} |`);
  lines.push(`| Power protect | ${stats.instrumentation.powerActions.counts.protect} |`);
  lines.push(`| Power pass | ${stats.instrumentation.powerActions.counts.pass} |`);
  lines.push(`| Empowered actors | ${Object.keys(stats.instrumentation.powerActions.actorCounts).length} |`);
  lines.push(`| Consecutive eliminate repeats | ${stats.instrumentation.powerActions.consecutiveEliminates.total} |`);
  lines.push(`| Repeated protect-same-target occurrences | ${stats.instrumentation.powerActions.repeatedProtectSameTarget.total} |`);
  lines.push(`| Auto-eliminations | ${stats.instrumentation.autoEliminations.total} |`);
  lines.push(`| Reveal phases | ${stats.instrumentation.council.revealPhases} |`);
  lines.push(`| Council phases | ${stats.instrumentation.council.councilPhases} |`);
  lines.push(`| Council votes | ${stats.instrumentation.council.councilVotes} |`);
  lines.push(`| Reckoning markers | ${stats.instrumentation.endgame.reckoning} |`);
  lines.push(`| Tribunal markers | ${stats.instrumentation.endgame.tribunal} |`);
  lines.push(`| Judgment markers | ${stats.instrumentation.endgame.judgment} |`);
  lines.push(`| Mingle rooms | ${stats.instrumentation.rooms.totalRooms} |`);
  lines.push(`| Mingle sessions instrumented | ${stats.instrumentation.rooms.mingleSessions.length} |`);
  lines.push(`| Room exclusions | ${stats.instrumentation.rooms.totalExclusions} |`);
  lines.push(`| Repeated room-pair occurrences | ${stats.instrumentation.rooms.repeatedPairs.totalRepeatedOccurrences} |`);
  lines.push(`| House room assignments | ${stats.instrumentation.rooms.assignmentSources.house} |`);
  lines.push(`| Repaired room assignments | ${stats.instrumentation.rooms.assignmentSources.repaired} |`);
  lines.push(`| Fallback room assignments | ${stats.instrumentation.rooms.assignmentSources.fallback} |`);
  lines.push(`| Movement-derived room records | ${stats.instrumentation.rooms.assignmentSources.movement} |`);
  lines.push(`| Room assignment repair notes | ${stats.instrumentation.rooms.assignmentSources.repairNotes} |`);
  lines.push(`| House Strategy Bible calls | ${stats.instrumentation.houseProducer.strategyBibleCalls} |`);
  lines.push(`| House MC summary calls | ${stats.instrumentation.houseProducer.mcSummaryCalls} |`);
  lines.push(`| House MC transcript entries | ${stats.instrumentation.houseProducer.mcSummaryTranscriptEntries} |`);
  lines.push(`| House long-form summaries | ${stats.instrumentation.houseProducer.longFormSummaryCalls} |`);
  lines.push(`| House producer briefs | ${stats.instrumentation.houseProducer.producerBriefCalls} |`);
  lines.push(`| Immediate repeat rooms flagged | ${stats.instrumentation.rooms.repeatPairFlags.immediateRepeats} |`);
  lines.push(`| Avoidable consecutive exclusions flagged | ${stats.instrumentation.rooms.exclusionFlags.avoidableConsecutiveExclusions} |`);
  lines.push(`| LLM empty/fallback responses | ${stats.instrumentation.actionUsage.totalEmptyResponses} |`);
  lines.push("");

  if (Object.keys(stats.instrumentation.powerActions.actionDistributionByActor).length > 0) {
    lines.push("## Power Action Distribution");
    lines.push("");
    lines.push("| Actor | Actions | Eliminate | Protect | Pass |");
    lines.push("|-------|--------:|----------:|--------:|-----:|");
    const actors = Object.keys(stats.instrumentation.powerActions.actionDistributionByActor).sort(
      (a, b) =>
        (stats.instrumentation.powerActions.actorCounts[b] ?? 0) -
          (stats.instrumentation.powerActions.actorCounts[a] ?? 0) ||
        a.localeCompare(b),
    );
    for (const actor of actors) {
      const distribution = stats.instrumentation.powerActions.actionDistributionByActor[actor];
      if (!distribution) continue;
      lines.push(
        `| ${actor} | ${stats.instrumentation.powerActions.actorCounts[actor] ?? 0} | ${distribution.eliminate} | ${distribution.protect} | ${distribution.pass} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.powerActions.consecutiveEliminates.occurrences.length > 0) {
    lines.push("## Consecutive Power Eliminates");
    lines.push("");
    lines.push("| Actor | Rounds | Targets |");
    lines.push("|-------|--------|---------|");
    for (const occurrence of stats.instrumentation.powerActions.consecutiveEliminates.occurrences) {
      lines.push(
        `| ${occurrence.actor} | ${occurrence.previousRound} -> ${occurrence.round} | ${occurrence.previousTarget} -> ${occurrence.target} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.powerActions.repeatedProtectSameTarget.repeats.length > 0) {
    lines.push("## Repeated Protect Targets");
    lines.push("");
    lines.push("| Actor | Target | Protects | Repeats | Rounds |");
    lines.push("|-------|--------|---------:|--------:|--------|");
    for (const repeat of stats.instrumentation.powerActions.repeatedProtectSameTarget.repeats) {
      lines.push(
        `| ${repeat.actor} | ${repeat.target} | ${repeat.protectActions} | ${repeat.repeatedOccurrences} | ${repeat.rounds.join(", ")} |`,
      );
    }
    lines.push("");
  }

  if (Object.keys(stats.instrumentation.rooms.participationByPlayer).length > 0) {
    lines.push("## Room Participation");
    lines.push("");
    lines.push("| Player | Rooms | Exclusions |");
    lines.push("|--------|------:|-----------:|");
    const players = new Set([
      ...Object.keys(stats.instrumentation.rooms.participationByPlayer),
      ...Object.keys(stats.instrumentation.rooms.exclusionsByPlayer),
    ]);
    for (const player of [...players].sort()) {
      lines.push(
        `| ${player} | ${stats.instrumentation.rooms.participationByPlayer[player] ?? 0} | ${stats.instrumentation.rooms.exclusionsByPlayer[player] ?? 0} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.rooms.repeatedPairs.pairs.length > 0) {
    lines.push("## Repeated Room Pairs");
    lines.push("");
    lines.push("| Pair | Count | Rounds |");
    lines.push("|------|------:|--------|");
    for (const pair of stats.instrumentation.rooms.repeatedPairs.pairs) {
      lines.push(`| ${pair.pair.join(" + ")} | ${pair.count} | ${pair.rounds.join(", ")} |`);
    }
    lines.push("");
  }

  if (Object.keys(stats.instrumentation.actionUsage.byAction).length > 0) {
    lines.push("## LLM Action Usage");
    lines.push("");
    lines.push("| Action | Calls | Empty/Fallback | Empty Rate | Tokens |");
    lines.push("|--------|------:|---------------:|-----------:|-------:|");
    const actionEntries = Object.entries(stats.instrumentation.actionUsage.byAction).sort(
      ([, a], [, b]) => b.callCount - a.callCount,
    );
    for (const [action, usage] of actionEntries) {
      lines.push(
        `| ${action} | ${usage.callCount} | ${usage.emptyResponses} | ${(usage.emptyResponseRate * 100).toFixed(1)}% | ${usage.totalTokens.toLocaleString()} |`,
      );
    }
    lines.push("");
  }

  // Per-persona table
  lines.push("## Per-Persona Stats");
  lines.push("");
  lines.push("| Persona | Played | Wins | Win Rate | Avg Survival |");
  lines.push("|---------|--------|------|----------|--------------|");

  const sorted = Object.entries(stats.perPersona).sort(
    ([, a], [, b]) => b.winRate - a.winRate,
  );
  for (const [persona, s] of sorted) {
    lines.push(
      `| ${persona} | ${s.gamesPlayed} | ${s.wins} | ${(s.winRate * 100).toFixed(0)}% | ${s.avgSurvivalRound.toFixed(1)} |`,
    );
  }

  lines.push("");

  // Endgame type distribution
  lines.push("## Endgame Types");
  lines.push("");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  for (const [type, count] of Object.entries(stats.perEndgameType)) {
    lines.push(`| ${type} | ${count} |`);
  }

  lines.push("");

  // Round distribution
  lines.push("## Round Distribution");
  lines.push("");
  lines.push("| Rounds | Games |");
  lines.push("|--------|-------|");
  for (const [rounds, count] of Object.entries(stats.overall.roundDistribution).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    lines.push(`| ${rounds} | ${count} |`);
  }

  lines.push("");

  // Token usage summary
  lines.push("## Token Usage");
  lines.push("");
  const tu = stats.tokenUsage.total;
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total LLM calls | ${tu.callCount.toLocaleString()} |`);
  lines.push(`| Prompt tokens | ${tu.promptTokens.toLocaleString()} |`);
  lines.push(`| Cached input tokens | ${tu.cachedTokens.toLocaleString()} |`);
  if ((tu.cacheWriteTokens ?? 0) > 0) {
    lines.push(`| Cache-write input tokens | ${tu.cacheWriteTokens!.toLocaleString()} |`);
  }
  lines.push(`| Completion tokens | ${tu.completionTokens.toLocaleString()} |`);
  if (tu.reasoningTokens > 0) {
    lines.push(`| Reasoning tokens (CoT) | ${tu.reasoningTokens.toLocaleString()} |`);
    lines.push(`| Visible output tokens | ${(tu.completionTokens - tu.reasoningTokens).toLocaleString()} |`);
  }
  lines.push(`| Total tokens | ${tu.totalTokens.toLocaleString()} |`);
  if (tu.emptyResponses > 0) {
    lines.push(`| Empty/fallback responses | ${tu.emptyResponses} (${((tu.emptyResponses / tu.callCount) * 100).toFixed(1)}%) |`);
  }
  lines.push("");

  if (stats.metadata.args.flex) {
    const byTier = stats.tokenUsage.byServiceTier;
    const tierAwareCost = stats.tokenUsage.tierAwareCost;
    const pricedCalls = (byTier.flex?.callCount ?? 0) + (byTier.auto?.callCount ?? 0) + (byTier.default?.callCount ?? 0);
    const unpricedCalls = Math.max(0, tu.callCount - pricedCalls);

    lines.push("## Flex Run Cost");
    lines.push("");
    if (byTier.flex) {
      lines.push(`- Flex: ${byTier.flex.callCount.toLocaleString()} calls, $${(tierAwareCost?.flexCost ?? 0).toFixed(4)} estimated.`);
    }
    if (byTier.auto || byTier.default) {
      const fallbackCalls = (byTier.auto?.callCount ?? 0) + (byTier.default?.callCount ?? 0);
      lines.push(`- Auto/default fallback: ${fallbackCalls.toLocaleString()} calls, $${(tierAwareCost?.fallbackCost ?? 0).toFixed(4)} estimated.`);
    }
    if (byTier.priority) {
      lines.push(`- Priority (unexpected): ${byTier.priority.callCount.toLocaleString()} calls, not priced.`);
    }
    if (unpricedCalls > 0 && !byTier.priority) {
      lines.push(`- Missing returned tier: ${unpricedCalls.toLocaleString()} calls, not priced.`);
    }
    if (tierAwareCost) {
      lines.push(`- **This run:** ${(tierAwareCost.flexCalls + tierAwareCost.fallbackCalls).toLocaleString()} priced calls, **$${tierAwareCost.totalCost.toFixed(4)} estimated.**`);
    } else {
      lines.push("- **This run:** unavailable for this model.");
    }
    lines.push("");
    lines.push("Flex responses use Flex rates. Auto/default fallback responses use standard rates; 429 resource-unavailable retries are not charged.");
    if (unpricedCalls > 0) {
      lines.push("The run total excludes calls whose returned tier does not have a configured simulator rate.");
    }
    lines.push("");

    lines.push("## Cost Estimates");
    lines.push("");
    lines.push("| Model | Input Cost | Output Cost | Total Cost |");
    lines.push("|-------|------------|-------------|------------|");
    for (const est of stats.tokenUsage.flexCostEstimates) {
      const marker = est.model === stats.model ? " *" : "";
      lines.push(
        `| ${est.model}${marker} | $${est.inputCost.toFixed(4)} | $${est.outputCost.toFixed(4)} | $${est.totalCost.toFixed(4)} |`,
      );
    }
    lines.push("");
    lines.push("_* = model used for this simulation. Flex-supported OpenAI models use Flex rates; unsupported OpenAI models and Grok use standard rates._");
    lines.push("");
  } else {
    // Cost estimates across standard model tiers
    lines.push("## Cost Estimates");
    lines.push("");
    lines.push("| Model | Input Cost | Output Cost | Total Cost |");
    lines.push("|-------|-----------|-------------|------------|");
    for (const est of stats.tokenUsage.costEstimates) {
      const marker = est.model === stats.model ? " *" : "";
      lines.push(
        `| ${est.model}${marker} | $${est.inputCost.toFixed(4)} | $${est.outputCost.toFixed(4)} | $${est.totalCost.toFixed(4)} |`,
      );
    }
    lines.push("");
    lines.push(`_* = model used for this simulation_`);
    lines.push("");
  }

  // Individual game results
  lines.push("## Individual Games");
  lines.push("");
  lines.push("| # | Status | Winner | Persona | Rounds | Endgame | Duration | Tokens | LLM Calls |");
  lines.push("|---|--------|--------|---------|--------|---------|----------|--------|-----------|");
  for (const r of results) {
    lines.push(
      `| ${r.gameNumber} | ${r.status} | ${r.winnerName ?? "draw"} | ${r.winnerPersona ?? "-"} | ${r.rounds} | ${r.endgameType} | ${(r.durationMs / 1000).toFixed(0)}s | ${r.tokenUsage.total.totalTokens.toLocaleString()} | ${r.tokenUsage.total.callCount} |`,
    );
  }

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failed Game Diagnostics");
    lines.push("");
    lines.push("| # | Error | Progress Log | Turns Log | Events Log | Transcript |");
    lines.push("|---|-------|--------------|-----------|------------|------------|");
    for (const result of failed) {
      lines.push(
        `| ${result.gameNumber} | ${(result.error ?? "unknown").replace(/\|/g, "\\|")} | ${result.progressPath} | ${result.turnsPath} | ${result.eventsPath} | ${result.transcriptPath} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function writeBatchArtifacts(
  batchDir: string,
  metadata: SimulationRunMetadata,
  model: string,
  results: GameResult[],
  partial: boolean,
): { stats: AggregateStats; markdown: string } {
  const stats = computeAggregateStats(results, model, metadata, partial);
  const markdown = renderMarkdownSummary(stats, results);

  writeFileSync(join(batchDir, "summary.md"), markdown);
  writeFileSync(join(batchDir, "stats.json"), JSON.stringify(stats, null, 2));
  writeFileSync(
    join(batchDir, "results.json"),
    JSON.stringify(
      {
        metadata,
        stats,
        games: results,
      },
      null,
      2,
    ),
  );

  return { stats, markdown };
}

class SimulationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Simulation game timed out after ${timeoutMs}ms`);
    this.name = "SimulationTimeoutError";
  }
}

function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number | null,
  onTimeout: () => void,
): Promise<T> {
  if (timeoutMs == null || timeoutMs < 1) {
    return operation;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new SimulationTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function summarizeProgressEvent(event: GameStreamEvent): Record<string, unknown> {
  if (event.type === "agent_turn") {
    return {
      event: event.type,
      round: event.round,
      phase: event.phase,
      action: event.action,
      actor: event.actor.name,
    };
  }

  if (event.type === "phase_change") {
    return {
      event: event.type,
      phase: event.phase,
      round: event.round,
      alivePlayers: event.alivePlayers.map((player) => player.name),
    };
  }

  if (event.type === "transcript_entry") {
    const entry = event.entry;
    return {
      event: event.type,
      round: entry.round,
      phase: entry.phase,
      scope: entry.scope,
      from: entry.from,
      textPreview: entry.text.replace(/\s+/g, " ").slice(0, 160),
      ...(entry.to && { to: entry.to }),
      ...(entry.roomId != null && { roomId: entry.roomId }),
      ...(entry.roomMetadata && {
        roomMetadata: {
          rooms: entry.roomMetadata.rooms.map((room) => ({
            roomId: room.roomId,
            playerCount: room.playerIds.length,
          })),
          excluded: entry.roomMetadata.excluded,
        },
      }),
    };
  }

  if (event.type === "player_eliminated") {
    return {
      event: event.type,
      round: event.round,
      playerName: event.playerName,
    };
  }

  return {
    event: event.type,
    winnerName: event.winnerName,
    totalRounds: event.totalRounds,
  };
}

function writeProgress(
  progressPath: string,
  gameNumber: number,
  startedAt: number,
  event: Record<string, unknown>,
): void {
  appendFileSync(
    progressPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      gameNumber,
      ...event,
    })}\n`,
  );
}

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsiFromValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(ANSI_PATTERN, "");
  if (Array.isArray(value)) return value.map(stripAnsiFromValue);
  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      cleaned[key] = stripAnsiFromValue(child);
    }
    return cleaned;
  }
  return value;
}

export function serializeAgentTurnEvent(
  gameNumber: number,
  startedAt: number,
  event: AgentTurnEvent,
  now = Date.now(),
): Record<string, unknown> {
  const { timestamp: eventTimestamp, ...eventWithoutTimestamp } = event;
  const record: Record<string, unknown> = {
    timestamp: new Date(now).toISOString(),
    elapsedMs: now - startedAt,
    gameNumber,
    eventTimestamp,
    ...eventWithoutTimestamp,
  };
  return stripAnsiFromValue(record) as Record<string, unknown>;
}

export function serializeCanonicalGameEvent(
  gameNumber: number,
  startedAt: number,
  event: CanonicalGameEvent,
  now = Date.now(),
): Record<string, unknown> {
  return stripAnsiFromValue({
    timestamp: new Date(now).toISOString(),
    elapsedMs: now - startedAt,
    gameNumber,
    eventSequence: event.sequence,
    eventType: event.type,
    visibility: event.visibility,
    payloadVersion: event.payloadVersion,
    canonicalEvent: event,
  }) as Record<string, unknown>;
}

function writeAgentTurn(
  turnsPath: string,
  gameNumber: number,
  startedAt: number,
  event: AgentTurnEvent,
): void {
  appendFileSync(turnsPath, `${JSON.stringify(serializeAgentTurnEvent(gameNumber, startedAt, event))}\n`);
}

function writeCanonicalEvent(
  eventsPath: string,
  gameNumber: number,
  startedAt: number,
  event: CanonicalGameEvent,
): void {
  appendFileSync(eventsPath, `${JSON.stringify(serializeCanonicalGameEvent(gameNumber, startedAt, event))}\n`);
}

function getHouseSummaryText(event: AgentTurnEvent): string | null {
  if (event.action !== "house-mc-summary") return null;
  const summary = event.response.summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  return typeof event.text === "string" && event.text.trim() ? event.text.trim() : null;
}

function attachProgressLogger(
  runner: GameRunner,
  progressPath: string,
  turnsPath: string,
  eventsPath: string,
  gameNumber: number,
  startedAt: number,
  chatty: boolean,
  operatorFeed: boolean,
  houseSummaries: boolean,
): void {
  runner.setCanonicalEventListener((event) => {
    writeCanonicalEvent(eventsPath, gameNumber, startedAt, event);
  });

  runner.setStreamListener((event) => {
    if (event.type === "agent_turn") {
      writeAgentTurn(turnsPath, gameNumber, startedAt, event);
      if (chatty) {
        const trace = formatAgentTurnTrace(event);
        if (trace) console.log(trace);
      } else if (operatorFeed) {
        const actionLine = formatOperatorActionLine(event);
        if (actionLine) console.log(actionLine);
      }
      if (houseSummaries) {
        const summary = getHouseSummaryText(event);
        if (summary) console.log(`\n[House MC] ${summary}\n`);
      }
      return;
    }

    const progress = summarizeProgressEvent(event);
    writeProgress(progressPath, gameNumber, startedAt, progress);

    if (event.type === "phase_change") {
      console.log(
        `  Progress: R${event.round} ${event.phase} | alive=${event.alivePlayers.map((player) => player.name).join(", ")}`,
      );
    } else if (event.type === "player_eliminated") {
      console.log(`  Progress: R${event.round} ELIMINATED ${event.playerName}`);
    } else if (event.type === "transcript_entry" && event.entry.roomMetadata) {
      if (operatorFeed || chatty) {
        const seating = formatRoomAllocationOperatorLine(event.entry);
        if (seating) console.log(seating);
      } else {
        console.log(
          `  Progress: R${event.entry.round} room allocation | rooms=${event.entry.roomMetadata.rooms.length} | excluded=${event.entry.roomMetadata.excluded.join(", ") || "none"}`,
        );
      }
    } else if (
      !chatty &&
      operatorFeed &&
      event.type === "transcript_entry" &&
      event.entry.scope === "system" &&
      event.entry.from === "House" &&
      !event.entry.roomMetadata &&
      isOperatorHouseSystemLine(event.entry.text)
    ) {
      console.log(`  R${event.entry.round}/${event.entry.phase} House: ${event.entry.text}`);
    }

    // Chatty mode: print full formatted transcript entries live
    if (chatty && event.type === "transcript_entry") {
      console.log(formatEntry(event.entry));
    }
  });
}

function resolveCatalogBackedSimulationModel(args: SimArgs): SimulationModelRuntime | null {
  if (!args.modelCatalogId) return null;
  const resolved = resolveModelSelection(
    {
      catalogId: args.modelCatalogId,
      ...(args.reasoningPolicy && { reasoningPolicy: args.reasoningPolicy }),
    },
  );
  return {
    modelId: resolved.modelId,
    providerProfileId: resolved.providerProfile.id,
    catalogId: resolved.catalogId,
    capabilities: resolved.model.capabilities,
    reasoningPolicy: resolved.reasoningPolicy,
    ...(resolved.model.preferredToolChoiceMode && { preferredToolChoiceMode: resolved.model.preferredToolChoiceMode }),
  };
}

function resolveLegacySimulationModel(
  args: SimArgs,
  providerProfileId: ProviderProfileId,
): SimulationModelRuntime {
  return {
    modelId: args.model,
    providerProfileId,
    ...(resolveCatalogIdForModel(args.model, providerProfileId) && {
      catalogId: resolveCatalogIdForModel(args.model, providerProfileId),
    }),
    capabilities: inferModelCapabilities(args.model, providerProfileId),
    reasoningPolicy: args.reasoningPolicy ?? "action-policy",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const runTimestamp = new Date().toISOString();
  let catalogModelRuntime: SimulationModelRuntime | null = null;
  try {
    catalogModelRuntime = resolveCatalogBackedSimulationModel(args);
  } catch (error) {
    console.error(`Error: invalid model catalog selection: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const llmConfig = createLlmClientFromEnv(process.env, {
    timeout: args.llmTimeoutMs,
    maxRetries: 0,
    flexProcessing: args.flex,
    ...(catalogModelRuntime && { providerProfileId: catalogModelRuntime.providerProfileId }),
  });
  if (!llmConfig) {
    console.error(
      "Error: no LLM provider configured. Set OPENAI_API_KEY for OpenAI, or INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 for LM Studio.",
    );
    process.exit(1);
  }

  const openai = llmConfig.client;
  const modelRuntime = catalogModelRuntime ?? resolveLegacySimulationModel(args, llmConfig.providerProfileId);
  args.model = modelRuntime.modelId;
  const openAIReasoningSummary = args.openAIReasoningSummary !== undefined
    ? args.openAIReasoningSummary ?? undefined
    : llmConfig.openAIReasoningSummary;
  const metadata = buildRunMetadata(args, runTimestamp, openAIReasoningSummary, modelRuntime);

  console.log(`\n=== Influence Batch Simulation ===`);
  console.log(`Games: ${args.games} | Players per game: ${args.players} | Max rounds: ${args.maxRounds} | Model: ${modelRuntime.modelId} | Variant: ${args.variant}`);
  if (modelRuntime.catalogId) console.log(`Model catalog: ${modelRuntime.catalogId}`);
  console.log(`Reasoning policy: ${modelRuntime.reasoningPolicy}`);
  console.log(`Provider: ${describeLlmProvider(llmConfig)} | API key: ${llmConfig.apiKeySource} | Tool choice: ${llmConfig.toolChoiceMode}`);
  console.log(`OpenAI reasoning summaries: ${openAIReasoningSummary ?? "off"}`);
  if (args.flex) {
    console.log(
      llmConfig.flexProcessingEnabled
        ? "Flex processing enabled: 429s retry with exponential backoff, then fall back to auto after three Flex failures."
        : "Flex processing requested but unavailable for this provider; continuing without a service tier override.",
    );
  }
  console.log(
    `Timeouts: game ${args.gameTimeoutMs == null ? "none (opt-in via --game-timeout-sec)" : `${(args.gameTimeoutMs / 1000).toFixed(0)}s`} | LLM request ${(args.llmTimeoutMs / 1000).toFixed(0)}s`,
  );
  if (args.maxRounds < Math.max(1, args.players - 4)) {
    console.log(
      `Pre-endgame cap: maxRounds=${args.maxRounds} stops after standard format rounds (endgame starts at 4 alive; would need ${Math.max(0, args.players - 4)} elim(s) to reach it).`,
    );
  }
  if (args.chatty) {
    console.log("Chatty mode enabled: live formatted transcript + thinking/reasoning will be printed to console.");
  } else if (args.operatorFeed) {
    console.log("Operator feed enabled: choices, seating, ballots, and outcomes print live (no thinking/reasoning). Use --chatty for full traces.");
  } else {
    console.log("Quiet mode: phase progress only. Pass default operator feed (omit --quiet) or --chatty for more detail.");
  }
  if (args.houseSummaries) {
    console.log("House MC summaries: on (between-round catch-up). Disable with --no-house-summaries.");
  } else {
    console.log("House MC summaries: off.");
  }
  if (args.richProducer === true) console.log("Rich producer mode enabled: House Strategy Bible, long-form summaries, producer briefs, and bounded diary sessions will be captured.");
  else if (args.enableDiary === true) console.log("Diary mode enabled: bounded diary sessions will run in simulation config.");
  console.log(`Git: ${metadata.git.commitShortSha ?? "unknown"} (${metadata.git.branch ?? "unknown branch"}${metadata.git.isDirty ? ", dirty" : ""})`);
  if (args.personas) console.log(`Personas: ${args.personas.join(", ")}`);
  console.log("");

  // Simulation config: no timers (agents respond as fast as they can)
  const simConfig = buildSimulationConfig(args.variant, {
    agentActionTimeoutMs: Math.max(args.llmTimeoutMs * 2, args.llmTimeoutMs + 5_000),
    richProducer: args.richProducer ?? false,
    enableDiary: args.enableDiary ?? false,
    maxRounds: args.maxRounds,
    formatManifest: args.formatManifest,
  });

  // Create output directory
  const timestamp = runTimestamp.replace(/[:.]/g, "-").slice(0, 19);
  const batchDir = join(import.meta.dir, "..", "docs", "simulations", `batch-${timestamp}`);
  mkdirSync(batchDir, { recursive: true });
  console.log(`Artifacts: ${batchDir}`);
  console.log("");

  const results: GameResult[] = [];
  let timedOutGame = false;
  const flushPartialAndExit = (signal: "SIGINT" | "SIGTERM"): void => {
    writeBatchArtifacts(batchDir, metadata, modelRuntime.modelId, results, true);
    console.error(
      `\n${signal} received. Partial aggregate artifacts saved from ${results.filter((result) => result.status === "completed").length} completed game(s) to: ${batchDir}`,
    );
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => flushPartialAndExit("SIGINT"));
  process.once("SIGTERM", () => flushPartialAndExit("SIGTERM"));

  for (let g = 1; g <= args.games; g++) {
    console.log(`--- Game ${g}/${args.games} ---`);
    const startTime = Date.now();

    // Create fresh agents for each game
    const toolChoiceMode = modelRuntime.preferredToolChoiceMode ?? llmConfig.toolChoiceMode;
    const promptReuse = new PromptReuseAggregate();
    const recallPlanReceipts = new RecallPlanReceiptAggregate();
    const privateTraceSink: import("./game-runner").PrivateTraceSink = (trace) => {
      promptReuse.add(trace.promptReuse);
      // Safe structural aggregate only — never the full private-trace payload (R16/R17).
      recallPlanReceipts.add(trace.recallPlanReceipt);
    };
    const agents = selectCast(args.players, args.personas, openai, modelRuntime, toolChoiceMode, openAIReasoningSummary, privateTraceSink);
    const playerPersonas: Record<string, string> = {};
    const playerNameById: Record<string, string> = {};
    const gameTracker = new TokenTracker();
    for (const agent of agents) {
      playerPersonas[agent.name] = agent.personality;
      playerNameById[agent.id] = agent.name;
      agent.setTokenTracker(gameTracker);
    }

    console.log(`  Players: ${agents.map((a) => a.name).join(", ")}`);

    const houseInterviewer = new LLMHouseInterviewer(openai, modelRuntime.modelId, {
      toolChoiceMode,
      providerProfileId: modelRuntime.providerProfileId,
      ...(modelRuntime.catalogId && { catalogId: modelRuntime.catalogId }),
      modelCapabilities: modelRuntime.capabilities,
      reasoningPolicy: modelRuntime.reasoningPolicy,
      privateTraceSink,
    });
    houseInterviewer.setTokenTracker(gameTracker);
    const runner = new GameRunner(agents, simConfig, houseInterviewer, {
      maxRoundsMode: "exact",
    });
    const transcriptPath = join(batchDir, `game-${g}.txt`);
    const jsonPath = join(batchDir, `game-${g}.json`);
    const progressPath = join(batchDir, `game-${g}-progress.jsonl`);
    const turnsPath = join(batchDir, `game-${g}-turns.jsonl`);
    const eventsPath = join(batchDir, `game-${g}-events.jsonl`);
    const promptReusePath = join(batchDir, `game-${g}-prompt-reuse.json`);
    // Dedicated safe evaluation artifact (R16/R17) — not full private-trace JSON.
    const recallPlanPath = join(batchDir, `game-${g}-recall-plan.json`);
    writeFileSync(turnsPath, "");
    writeFileSync(eventsPath, "");
    writeProgress(progressPath, g, startTime, {
      event: "game_start",
      players: agents.map((agent) => agent.name),
      variant: args.variant,
      model: args.model,
      ...(modelRuntime.catalogId && { modelCatalogId: modelRuntime.catalogId }),
      providerProfileId: modelRuntime.providerProfileId,
      reasoningPolicy: modelRuntime.reasoningPolicy,
      gameTimeoutMs: args.gameTimeoutMs,
      llmTimeoutMs: args.llmTimeoutMs,
      houseSummaries: args.houseSummaries,
      richProducer: args.richProducer ?? false,
      enableDiary: args.enableDiary ?? false,
      openAIReasoningSummary: openAIReasoningSummary ?? "off",
      houseProducer: {
        enableHouseRoundSummaries: simConfig.enableHouseRoundSummaries ?? true,
        enableHouseStrategyBible: simConfig.enableHouseStrategyBible ?? false,
        enableHouseLongFormSummaries: simConfig.enableHouseLongFormSummaries ?? false,
        enableHouseProducerBriefs: simConfig.enableHouseProducerBriefs ?? false,
        diaryRoomAfterPhases: simConfig.diaryRoomAfterPhases ?? [],
      },
      transcriptPath,
      jsonPath,
      turnsPath,
      eventsPath,
      promptReusePath,
      recallPlanPath,
    });
    attachProgressLogger(
      runner,
      progressPath,
      turnsPath,
      eventsPath,
      g,
      startTime,
      args.chatty,
      args.operatorFeed,
      args.houseSummaries,
    );
    console.log(`  Progress log: ${progressPath}`);
    console.log(`  Turns log: ${turnsPath}`);
    console.log(`  Events log: ${eventsPath}`);

    try {
      const result = await runWithTimeout(
        runner.run(),
        args.gameTimeoutMs,
        () => {
          runner.abort();
          writeProgress(progressPath, g, startTime, {
            event: "game_timeout",
            timeoutMs: args.gameTimeoutMs,
            transcriptEntries: runner.transcriptLog.length,
          });
        },
      );
      const durationMs = Date.now() - startTime;

      const eliminationOrder = result.eliminationOrder;
      const endgameType = extractEndgameType(result.transcript);

      const gameTotalUsage = gameTracker.getTotalUsage();
      const perAgentUsage = gameTracker.getAllUsage();
      const instrumentation = instrumentGame(result.transcript, perAgentUsage, playerNameById);
      const gameResult: GameResult = {
        gameNumber: g,
        status: "completed",
        winnerName: result.winnerName,
        winnerPersona: result.winnerName ? playerPersonas[result.winnerName] : undefined,
        rounds: result.rounds,
        eliminationOrder,
        endgameType,
        playerPersonas,
        durationMs,
        transcriptPath,
        jsonPath,
        progressPath,
        turnsPath,
        eventsPath,
        tokenUsage: {
          perAgent: perAgentUsage,
          total: gameTotalUsage,
          byServiceTier: gameTracker.getUsageByServiceTier(),
        },
        instrumentation,
      };
      writeFileSync(promptReusePath, JSON.stringify(promptReuse.snapshot(), null, 2));
      writeFileSync(recallPlanPath, JSON.stringify(recallPlanReceipts.snapshot(), null, 2));
      results.push(gameResult);
      writeProgress(progressPath, g, startTime, {
        event: "game_completed",
        winnerName: result.winnerName ?? "draw",
        rounds: result.rounds,
        transcriptEntries: result.transcript.length,
      });

      console.log(
        `  Winner: ${result.winnerName ?? "draw"} (${gameResult.winnerPersona ?? "-"}) | Rounds: ${result.rounds} | ${(durationMs / 1000).toFixed(0)}s | ${gameTotalUsage.totalTokens.toLocaleString()} tokens (${gameTotalUsage.callCount} calls)`,
      );

      // Save transcript
      writeFileSync(transcriptPath, formatTranscript(result.transcript));
      // Full game JSON remains a producer artifact (transcript + result). It is not
      // the safe Recall Plan promotion input — that is game-{N}-recall-plan.json only.
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            metadata,
            result: gameResult,
            transcript: result.transcript,
            canonicalEvents: runner.getCanonicalEvents(),
          },
          null,
          2,
        ),
      );
      writeBatchArtifacts(batchDir, metadata, modelRuntime.modelId, results, g < args.games);
    } catch (err) {
      if (err instanceof SimulationTimeoutError) timedOutGame = true;
      const durationMs = Date.now() - startTime;
      console.error(`  Game ${g} FAILED after ${(durationMs / 1000).toFixed(0)}s: ${err}`);
      const transcript = [...runner.transcriptLog];
      const perAgentUsage = gameTracker.getAllUsage();
      const instrumentation = instrumentGame(transcript, perAgentUsage, playerNameById);
      const gameResult: GameResult = {
        gameNumber: g,
        status: "failed",
        winnerName: undefined,
        winnerPersona: undefined,
        rounds: 0,
        eliminationOrder: [],
        endgameType: "error",
        playerPersonas,
        durationMs,
        transcriptPath,
        jsonPath,
        progressPath,
        turnsPath,
        eventsPath,
        error: err instanceof Error ? err.message : String(err),
        tokenUsage: {
          perAgent: perAgentUsage,
          total: gameTracker.getTotalUsage(),
          byServiceTier: gameTracker.getUsageByServiceTier(),
        },
        instrumentation,
      };
      writeFileSync(promptReusePath, JSON.stringify(promptReuse.snapshot(), null, 2));
      writeFileSync(recallPlanPath, JSON.stringify(recallPlanReceipts.snapshot(), null, 2));
      results.push(gameResult);
      writeProgress(progressPath, g, startTime, {
        event: "game_failed",
        error: gameResult.error ?? "unknown error",
        transcriptEntries: transcript.length,
      });
      writeFileSync(transcriptPath, formatTranscript(transcript));
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            metadata,
            result: gameResult,
            transcript,
            canonicalEvents: runner.getCanonicalEvents(),
          },
          null,
          2,
        ),
      );
      writeBatchArtifacts(batchDir, metadata, modelRuntime.modelId, results, g < args.games);
      if (timedOutGame) break;
    }
  }

  // Compute aggregates (stats.json + results.json written under batchDir)
  const { stats, markdown } = writeBatchArtifacts(batchDir, metadata, modelRuntime.modelId, results, false);

  // Text summary only — full stats JSON is on disk (stats.json), not dumped to the terminal
  console.log("\n" + markdown);

  console.log(`\nSimulation artifacts saved to: ${batchDir}`);
  if (stats.failedGames > 0) {
    console.error(`Simulation completed with ${stats.failedGames} failed game(s). See progress logs in: ${batchDir}`);
    if (timedOutGame) process.exit(1);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
