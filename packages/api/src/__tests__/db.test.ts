/**
 * Database schema and operations tests.
 *
 * Uses a PostgreSQL test database with table truncation for isolation.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { randomUUID } from "crypto";
import { setupTestDB } from "./test-utils.js";

describe("Database Schema", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  describe("users", () => {
    test("insert and query a user", async () => {
      const id = randomUUID();
      await db.insert(schema.users)
        .values({
          id,
          walletAddress: "0xABC123",
          email: "test@example.com",
          displayName: "Test User",
        });

      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.walletAddress).toBe("0xABC123");
      expect(rows[0]!.email).toBe("test@example.com");
      expect(rows[0]!.displayName).toBe("Test User");
      expect(rows[0]!.createdAt).toBeTruthy();
    });

    test("wallet address is unique", async () => {
      const wallet = "0xUNIQUE";
      await db.insert(schema.users)
        .values({ id: randomUUID(), walletAddress: wallet });

      let threw = false;
      try {
        await db.insert(schema.users)
          .values({ id: randomUUID(), walletAddress: wallet });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("user can have null wallet and null email", async () => {
      const id = randomUUID();
      await db.insert(schema.users)
        .values({ id, displayName: "No Wallet" });

      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id));

      expect(rows[0]!.walletAddress).toBeNull();
      expect(rows[0]!.email).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------

  describe("games", () => {
    test("insert and query a game", async () => {
      const gameId = randomUUID();
      const config = { timers: {}, maxRounds: 10, minPlayers: 5, maxPlayers: 8 };

      await db.insert(schema.games)
        .values({
          id: gameId,
          slug: `test-${gameId}`,
          config: JSON.stringify(config),
          status: "waiting",
          minPlayers: 5,
          maxPlayers: 8,
        });

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("waiting");
      expect(JSON.parse(rows[0]!.config)).toEqual(config);
    });

    test("game status defaults to waiting", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("waiting");
    });

    test("game slug is required by the database", async () => {
      let threw = false;
      try {
        await db.execute(sql`
          INSERT INTO games (id, config)
          VALUES (${randomUUID()}, '{}')
        `);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("game slug is unique in the database", async () => {
      const slug = `test-${randomUUID()}`;
      await db.insert(schema.games).values({ id: randomUUID(), slug, config: "{}" });

      let threw = false;
      try {
        await db.insert(schema.games).values({ id: randomUUID(), slug, config: "{}" });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("cognitive artifact capture defaults off for existing game inserts", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.cognitiveArtifactCaptureVersion).toBe(0);
      expect(rows[0]!.transcriptCaptureVersion).toBe(0);
      expect(rows[0]!.formalSpeechCaptureVersion).toBe(0);
    });

    test("transcript entry_sequence is partially unique per game and allows null legacy rows", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      await db.insert(schema.transcripts).values([
        {
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "legacy a",
          timestamp: 1,
          entrySequence: null,
        },
        {
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "legacy b",
          timestamp: 2,
          entrySequence: null,
        },
        {
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "modern 1",
          timestamp: 3,
          entrySequence: 1,
          audiencePlayerIds: [],
          captureVersion: 1,
          dialogueKind: "public_speech",
          safeContext: { version: 1 },
        },
      ]);

      let threw = false;
      try {
        await db.insert(schema.transcripts).values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "duplicate sequence",
          timestamp: 4,
          entrySequence: 1,
          audiencePlayerIds: [],
          captureVersion: 1,
          dialogueKind: "public_speech",
          safeContext: { version: 1 },
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("game status transitions", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      // Start the game
      await db.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId));

      let rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("in_progress");
      expect(rows[0]!.startedAt).toBeTruthy();

      // Complete the game
      await db.update(schema.games)
        .set({
          status: "completed",
          endedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId));

      rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("completed");
      expect(rows[0]!.endedAt).toBeTruthy();
    });

    test("game can be marked suspended for inspection", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}", status: "in_progress" });

      await db.update(schema.games)
        .set({
          status: "suspended",
          endedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId));

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("suspended");
      expect(rows[0]!.endedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Game Players
  // -------------------------------------------------------------------------

  describe("game_players", () => {
    test("insert players for a game", async () => {
      const userId = randomUUID();
      const gameId = randomUUID();

      await db.insert(schema.users).values({ id: userId });
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      const playerId = randomUUID();
      const persona = { name: "Atlas", personality: "Strategic calculator" };
      const agentConfig = { model: "gpt-5-nano", temperature: 0.9 };

      await db.insert(schema.gamePlayers)
        .values({
          id: playerId,
          gameId,
          userId,
          persona: JSON.stringify(persona),
          agentConfig: JSON.stringify(agentConfig),
        });

      const rows = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.persona)).toEqual(persona);
      expect(JSON.parse(rows[0]!.agentConfig)).toEqual(agentConfig);
    });

    test("multiple players per game", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      for (let i = 0; i < 6; i++) {
        await db.insert(schema.gamePlayers)
          .values({
            id: randomUUID(),
            gameId,
            persona: JSON.stringify({ name: `Player${i}` }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          });
      }

      const rows = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));

      expect(rows).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // Transcripts
  // -------------------------------------------------------------------------

  describe("transcripts", () => {
    test("insert and query transcript entries", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      await db.insert(schema.transcripts)
        .values([
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: "player-1",
            scope: "public",
            text: "I am Atlas.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "WHISPER",
            fromPlayerId: "player-1",
            scope: "whisper",
            toPlayerIds: JSON.stringify(["player-2"]),
            text: "Let's form an alliance.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "LOBBY",
            scope: "system",
            text: "Round 1 has begun.",
            timestamp: Date.now(),
          },
        ]);

      const rows = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));

      expect(rows).toHaveLength(3);

      const whisper = rows.find((r) => r.scope === "whisper");
      expect(whisper).toBeTruthy();
      expect(JSON.parse(whisper!.toPlayerIds!)).toEqual(["player-2"]);

      const system = rows.find((r) => r.scope === "system");
      expect(system!.fromPlayerId).toBeNull();
    });

    test("transcript entries are auto-incremented", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      await db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "First",
          timestamp: 1000,
        });

      await db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "Second",
          timestamp: 2000,
        });

      const rows = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));

      expect(rows[0]!.id).toBeLessThan(rows[1]!.id);
    });
  });

  // -------------------------------------------------------------------------
  // Game Results
  // -------------------------------------------------------------------------

  describe("game_results", () => {
    test("insert and query game result", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      const resultId = randomUUID();
      const tokenUsage = {
        promptTokens: 45000,
        completionTokens: 12000,
        totalTokens: 57000,
        estimatedCost: 0.05,
      };

      await db.insert(schema.gameResults)
        .values({
          id: resultId,
          gameId,
          winnerId: "player-1",
          roundsPlayed: 5,
          tokenUsage: JSON.stringify(tokenUsage),
        });

      const rows = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.roundsPlayed).toBe(5);
      expect(JSON.parse(rows[0]!.tokenUsage)).toEqual(tokenUsage);
    });

    test("one result per game (unique constraint)", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          roundsPlayed: 5,
          tokenUsage: "{}",
        });

      let threw = false;
      try {
        await db.insert(schema.gameResults)
          .values({
            id: randomUUID(),
            gameId,
            roundsPlayed: 3,
            tokenUsage: "{}",
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("draw game has null winnerId", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}" });

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: null,
          roundsPlayed: 10,
          tokenUsage: "{}",
        });

      const rows = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));

      expect(rows[0]!.winnerId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Durable Game Run Kernel
  // -------------------------------------------------------------------------

  describe("durable game run kernel", () => {
    async function createGameOwner() {
      const gameId = randomUUID();
      const ownerEpoch = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, slug: `test-${gameId}`, config: "{}", status: "in_progress" });
      await db.insert(schema.gameRunOwners)
        .values({
          id: randomUUID(),
          gameId,
          ownerEpoch,
          processId: "test-process",
        });
      return { gameId, ownerEpoch };
    }

    test("owner row tracks active durable head and kernel health", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();

      const rows = await db
        .select()
        .from(schema.gameRunOwners)
        .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.gameId).toBe(gameId);
      expect(rows[0]!.status).toBe("active");
      expect(rows[0]!.runSource).toBe("api");
      expect(rows[0]!.lastPersistedEventSequence).toBe(0);
      expect(rows[0]!.kernelHealth).toBe("healthy");
    });

    test("only one active owner can exist per game", async () => {
      const { gameId } = await createGameOwner();

      let threw = false;
      try {
        await db.insert(schema.gameRunOwners)
          .values({
            id: randomUUID(),
            gameId,
            ownerEpoch: randomUUID(),
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("canonical event rows store metadata and JSONB envelope", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();
      const envelope = {
        sequence: 1,
        gameId,
        type: "game.roster_initialized",
        timestamp: new Date().toISOString(),
        visibility: "public",
        payloadVersion: 1,
        source: "engine",
        payload: { players: [] },
      };

      await db.insert(schema.gameEvents)
        .values({
          gameId,
          sequence: 1,
          eventType: "game.roster_initialized",
          eventHash: "sha256:test",
          ownerEpoch,
          visibility: "public",
          payloadVersion: 1,
          sourcePointers: [{ kind: "game", id: gameId }],
          envelope,
        });

      const rows = await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.sequence).toBe(1);
      expect(rows[0]!.eventType).toBe("game.roster_initialized");
      expect(rows[0]!.eventHash).toBe("sha256:test");
      expect(rows[0]!.envelope).toEqual(envelope);
      expect(rows[0]!.sourcePointers).toEqual([{ kind: "game", id: gameId }]);
    });

    test("event sequence uniqueness detects conflicting duplicates", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();
      const envelope = {
        sequence: 1,
        gameId,
        type: "game.roster_initialized",
        timestamp: new Date().toISOString(),
        visibility: "public",
        payloadVersion: 1,
        source: "engine",
        payload: { players: [] },
      };

      await db.insert(schema.gameEvents)
        .values({
          gameId,
          sequence: 1,
          eventType: "game.roster_initialized",
          eventHash: "sha256:first",
          ownerEpoch,
          visibility: "public",
          envelope,
        });

      let threw = false;
      try {
        await db.insert(schema.gameEvents)
          .values({
            gameId,
            sequence: 1,
            eventType: "game.roster_initialized",
            eventHash: "sha256:different",
            ownerEpoch,
            visibility: "public",
            envelope,
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("event rows reject envelope metadata disagreement", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();
      const wrongGameId = randomUUID();

      let threw = false;
      try {
        await db.insert(schema.gameEvents)
          .values({
            gameId,
            sequence: 1,
            eventType: "game.roster_initialized",
            eventHash: "sha256:test",
            ownerEpoch,
            visibility: "public",
            envelope: {
              sequence: 1,
              gameId: wrongGameId,
              type: "game.roster_initialized",
              timestamp: new Date().toISOString(),
              visibility: "public",
              payloadVersion: 1,
              source: "engine",
              payload: { players: [] },
            },
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("game watch state summaries store compact rows and enforce counts", async () => {
      const { gameId } = await createGameOwner();
      const validSummary = {
        gameId,
        slug: "schema-summary-row",
        schemaVersion: 1,
        status: "in_progress" as const,
        source: "durable_projection" as const,
        currentRound: 1,
        currentPhase: "LOBBY",
        maxRounds: 10,
        totalPlayers: 2,
        alivePlayers: 1,
        eliminatedPlayers: 1,
        unknownPlayers: 0,
        eventCursorSequence: 1,
        eventCursorSource: "trusted_prefix" as const,
        eventCursorEventType: "round.resolved",
        projectionAvailability: "available" as const,
        projectionEventLogStatus: "complete" as const,
        projectionStatus: "complete" as const,
        projectionEventCount: 1,
        projectionTrustedEventCount: 1,
        projectionValidPrefixLength: 1,
        projectionLastTrustedSequence: 1,
        projectionDiagnostics: [],
        finalStatus: "not_final" as const,
        lastRefreshReason: "schema_test",
      };

      await db.insert(schema.gameWatchStateSummaries).values(validSummary);

      const rows = await db
        .select()
        .from(schema.gameWatchStateSummaries)
        .where(eq(schema.gameWatchStateSummaries.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe("durable_projection");
      expect(rows[0]!.eventCursorSequence).toBe(1);

      const invalidGameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: invalidGameId, slug: `test-${invalidGameId}`, config: "{}" });

      let threw = false;
      try {
        await db.insert(schema.gameWatchStateSummaries)
          .values({
            ...validSummary,
            gameId: invalidGameId,
            totalPlayers: 3,
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("checkpoint and evidence manifest rows reference durable boundaries", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();
      const eventEnvelope = {
        sequence: 1,
        gameId,
        type: "game.roster_initialized",
        timestamp: new Date().toISOString(),
        visibility: "public",
        payloadVersion: 1,
        source: "engine",
        payload: { players: [] },
      };
      await db.insert(schema.gameEvents)
        .values({
          gameId,
          sequence: 1,
          eventType: "game.roster_initialized",
          eventHash: "sha256:event-1",
          ownerEpoch,
          visibility: "public",
          envelope: eventEnvelope,
        });

      const checkpointId = randomUUID();
      await db.insert(schema.gameCheckpoints)
        .values({
          id: checkpointId,
          gameId,
          ownerEpoch,
          lastEventSequence: 1,
          eventHeadHash: "sha256:head-1",
          projectionHash: "sha256:projection-1",
          snapshot: { phase: "INTRODUCTION", players: [] },
        });

      const manifestId = randomUUID();
      await db.insert(schema.gameEvidenceManifests)
        .values({
          id: manifestId,
          gameId,
          ownerEpoch,
          eventSequence: 1,
          evidenceType: "llm_prompt",
          retentionClass: "debug",
          accessScope: "producer_admin",
          storageProvider: "linode_object_storage",
          storageBucket: "private-content",
          storageKey: "content/test/raw.jsonl",
          sourcePointers: [{ kind: "game_event", sequence: 1 }],
          metadata: { redacted: true, byteLength: 1234 },
        });

      await db.insert(schema.gameEvidenceManifestReads)
        .values({
          manifestId,
          gameId,
          accessorRole: "producer",
          purpose: "debug",
          outcome: "allowed",
        });

      const checkpoints = await db
        .select()
        .from(schema.gameCheckpoints)
        .where(eq(schema.gameCheckpoints.gameId, gameId));
      const manifests = await db
        .select()
        .from(schema.gameEvidenceManifests)
        .where(eq(schema.gameEvidenceManifests.gameId, gameId));
      const reads = await db
        .select()
        .from(schema.gameEvidenceManifestReads)
        .where(eq(schema.gameEvidenceManifestReads.manifestId, manifestId));

      expect(checkpoints[0]!.lastEventSequence).toBe(1);
      expect(checkpoints[0]!.snapshot).toEqual({ phase: "INTRODUCTION", players: [] });
      expect(manifests[0]!.redactionStatus).toBe("active");
      expect(manifests[0]!.metadata).toEqual({ redacted: true, byteLength: 1234 });
      expect(reads).toHaveLength(1);
      expect(reads[0]!.outcome).toBe("allowed");
    });

    test("cognitive artifact rows store split payloads and read outcomes", async () => {
      const { gameId, ownerEpoch } = await createGameOwner();
      const userId = randomUUID();
      const playerId = randomUUID();
      const artifactId = randomUUID();
      const envelope = {
        sequence: 1,
        gameId,
        type: "phase.action_recorded",
        timestamp: new Date().toISOString(),
        visibility: "producer",
        payloadVersion: 1,
        source: "engine",
        payload: { action: "vote" },
      };

      await db.insert(schema.users)
        .values({ id: userId, displayName: "Player Owner" });
      await db.insert(schema.gamePlayers)
        .values({
          id: playerId,
          gameId,
          userId,
          persona: "{}",
          agentConfig: "{}",
        });
      await db.insert(schema.gameEvents)
        .values({
          gameId,
          sequence: 1,
          eventType: "phase.action_recorded",
          eventHash: "sha256:artifact-event-1",
          ownerEpoch,
          visibility: "producer",
          envelope,
        });

      await db.insert(schema.gameCognitiveArtifacts)
        .values({
          id: artifactId,
          gameId,
          eventSequence: 1,
          artifactType: "strategy",
          actorRole: "player",
          actorPlayerId: playerId,
          actorUserId: userId,
          action: "vote",
          phase: "COUNCIL",
          round: 1,
          payloadByteLength: 74,
          payload: {
            decisionLog: [{ target: "player-2", reason: "coalition risk" }],
          },
        });

      await db.insert(schema.gameCognitiveArtifactReads)
        .values({
          artifactId,
          gameId,
          actorPlayerId: playerId,
          artifactType: "strategy",
          accessorUserId: userId,
          authProfile: "participant",
          purpose: "mcp_read_artifact",
          outcome: "allowed",
        });

      const artifacts = await db
        .select()
        .from(schema.gameCognitiveArtifacts)
        .where(eq(schema.gameCognitiveArtifacts.id, artifactId));
      const reads = await db
        .select()
        .from(schema.gameCognitiveArtifactReads)
        .where(eq(schema.gameCognitiveArtifactReads.artifactId, artifactId));

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.captureVersion).toBe(1);
      expect(artifacts[0]!.visibilityStatus).toBe("active");
      expect(artifacts[0]!.redactionStatus).toBe("active");
      expect(artifacts[0]!.payload).toEqual({
        decisionLog: [{ target: "player-2", reason: "coalition risk" }],
      });
      expect(reads).toHaveLength(1);
      expect(reads[0]!.outcome).toBe("allowed");

      let threw = false;
      try {
        await db.execute(sql`
          INSERT INTO game_cognitive_artifacts (
            id,
            game_id,
            artifact_type,
            actor_role,
            action,
            payload_byte_length,
            payload
          ) VALUES (
            ${randomUUID()},
            ${gameId},
            'private_trace',
            'player',
            'vote',
            0,
            '{}'::jsonb
          )
        `);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-table relationships
  // -------------------------------------------------------------------------

  describe("relationships", () => {
    test("full game lifecycle: create user, game, players, transcripts, results", async () => {
      // Create users
      const userId1 = randomUUID();
      const userId2 = randomUUID();
      await db.insert(schema.users)
        .values([
          { id: userId1, walletAddress: "0xAAA", displayName: "Alice" },
          { id: userId2, walletAddress: "0xBBB", displayName: "Bob" },
        ]);

      // Create game
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({
          id: gameId,
          slug: `test-${gameId}`,
          config: JSON.stringify({ maxRounds: 10 }),
          status: "waiting",
          createdById: userId1,
        });

      // Players join
      const p1 = randomUUID();
      const p2 = randomUUID();
      await db.insert(schema.gamePlayers)
        .values([
          {
            id: p1,
            gameId,
            userId: userId1,
            persona: JSON.stringify({ name: "Atlas" }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          },
          {
            id: p2,
            gameId,
            userId: userId2,
            persona: JSON.stringify({ name: "Vera" }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          },
        ]);

      // Game starts
      await db.update(schema.games)
        .set({ status: "in_progress", startedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId));

      // Transcript entries
      await db.insert(schema.transcripts)
        .values([
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: p1,
            scope: "public",
            text: "I am Atlas.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: p2,
            scope: "public",
            text: "Call me Vera.",
            timestamp: Date.now(),
          },
        ]);

      // Game completes
      await db.update(schema.games)
        .set({ status: "completed", endedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId));

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: p1,
          roundsPlayed: 5,
          tokenUsage: JSON.stringify({ totalTokens: 57000 }),
        });

      // Verify full state
      const game = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));
      expect(game[0]!.status).toBe("completed");

      const players = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));
      expect(players).toHaveLength(2);

      const transcript = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));
      expect(transcript).toHaveLength(2);

      const result = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));
      expect(result).toHaveLength(1);
      expect(result[0]!.winnerId).toBe(p1);
    });
  });
});
