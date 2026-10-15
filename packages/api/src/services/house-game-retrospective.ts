import { eq } from "drizzle-orm";
import { Phase, replayCanonicalEvents, retrospectiveProgress, type RetrospectiveOutcomeSource, type RetrospectiveStateV1 } from "@influence/engine";
import { buildWerewolfResults } from "@influence/engine/werewolf/results";
import { replayWerewolf, werewolfExecutionFinished } from "@influence/engine/werewolf";
import { walkWerewolfHistory } from "@influence/engine/werewolf/watch";
import { gameReplaySequenceHref, gameResultsHref, werewolfMomentHref } from "@influence/engine/game-links";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { sha256StableJson } from "./stable-hash.js";
import { HouseInspectionError, houseGameIdentity, resolveHouseSpectatorGame } from "./house-game-access.js";
import { HOUSE_PAGE_BYTES, houseJsonBytes } from "./house-read-cursor.js";

export interface RetrospectiveReadInput { gameIdOrSlug: string; gameKind?: "influence" | "werewolf"; cursor?: string; limit?: number }
interface Cursor { version: 1; gameId: string; gameKind: "influence" | "werewolf"; throughSequence: number; throughHash: string;
  definitionHash: string | null; statementCount: number; afterOrdinal: number; poll: boolean }
const isHash = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
function encode(cursor: Cursor) { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
function decode(token: string): Cursor {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error("shape");
    const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("object");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join() !== ["version", "gameId", "gameKind", "throughSequence", "throughHash", "definitionHash", "statementCount", "afterOrdinal", "poll"].sort().join()
      || record.version !== 1 || typeof record.gameId !== "string" || !record.gameId || !["influence", "werewolf"].includes(String(record.gameKind))
      || !Number.isSafeInteger(record.throughSequence) || Number(record.throughSequence) < 1 || !isHash(record.throughHash)
      || record.definitionHash !== null && !isHash(record.definitionHash) || typeof record.poll !== "boolean"
      || [record.statementCount, record.afterOrdinal].some(value => !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 12)) throw Error("fields");
    const cursor = record as unknown as Cursor;
    if (cursor.afterOrdinal > cursor.statementCount || cursor.poll && cursor.afterOrdinal !== cursor.statementCount) throw Error("ordinal");
    return cursor;
  } catch { throw new HouseInspectionError("invalid_cursor", "Invalid retrospective cursor; restart this traversal"); }
}
interface Speaker {
  actorId: string; name: string; ordinal: number; avatarUrl: string | null;
  part: { gameKind: "influence"; won: boolean; eliminatedRound: number | null }
    | { gameKind: "werewolf"; role: "werewolf" | "villager" | "seer" | "doctor"; won: boolean; alive: boolean; eliminatedDay: number | null; eliminatedBy: "night" | "vote" | null };
}

/** Read-only, explicitly post-outcome disclosure; no input dossiers or provider calls. */
export async function readHouseGameRetrospective(db: DrizzleDB, input: RetrospectiveReadInput) {
  return db.transaction(async tx => {
    const game = await resolveHouseSpectatorGame(tx, input.gameIdOrSlug);
    if (input.gameKind && input.gameKind !== game.gameKind) throw new HouseInspectionError("unsupported_game_kind", "Requested game kind does not match this game");
    const limit = input.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new HouseInspectionError("invalid_input", "Limit must be between 1 and 20");
    const previous = input.cursor ? decode(input.cursor) : null;
    if (previous && (previous.gameId !== game.id || previous.gameKind !== game.gameKind)) throw new HouseInspectionError("invalid_cursor", "Cursor belongs to a different retrospective");
    let head: { sequence: number; hash: string }, outcome: RetrospectiveOutcomeSource | null, retrospective: RetrospectiveStateV1 | null;
    let requiredStatements: number, speakers: Speaker[], links: Map<number, string>;
    let latestSequence = 0;
    let executionWithoutRetrospective = false;
    const checkPinnedPrefix = (state: RetrospectiveStateV1 | null) => {
      if (previous && ((state?.definition.definitionHash ?? null) !== previous.definitionHash || (state?.statements.length ?? 0) !== previous.statementCount))
        throw new HouseInspectionError("invalid_cursor", "Pinned retrospective definition or accepted prefix changed");
    };
    const through = (events: readonly { sequence: number }[], hashes: Map<number, string>) => {
      if (previous && hashes.get(previous.throughSequence) !== previous.throughHash) throw new HouseInspectionError("invalid_cursor", "Pinned retrospective history changed");
      const sequence = previous && !previous.poll ? previous.throughSequence : events.at(-1)?.sequence;
      latestSequence = events.at(-1)?.sequence ?? 0;
      if (!sequence || !hashes.has(sequence)) throw new HouseInspectionError("not_completed", "The competitive outcome has not been recorded");
      head = { sequence, hash: hashes.get(sequence)! };
      return sequence;
    };
    try {
      if (game.gameKind === "werewolf") {
        const full = await readWerewolfEvents(tx, game.id);
        const completeState = replayWerewolf(full);
        executionWithoutRetrospective = completeState.config.rulesVersion === 7 && werewolfExecutionFinished(completeState);
        if (game.status === "completed" && !werewolfExecutionFinished(completeState)) throw Error("Missing execution completion proof");
        if (previous) checkPinnedPrefix(replayWerewolf(full.filter(event => event.sequence <= previous.throughSequence)).retrospective);
        const sequence = through(full, new Map(full.map(event => [event.sequence, sha256StableJson(event)]))), events = full.filter(event => event.sequence <= sequence);
        const state = replayWerewolf(events);
        outcome = state.retrospectiveOutcomeSource; retrospective = state.retrospective; requiredStatements = state.players.length;
        // Rules v7 records the outcome but never initializes a retrospective source.
        if (state.config.rulesVersion === 7 && state.outcome) {
          const completed = events.find(event => event.type === "werewolf.completed")!;
          outcome = { gameId: game.id, gameKind: "werewolf", eventSequence: completed.sequence, eventHash: sha256StableJson(completed) };
        }
        if (!outcome) throw new HouseInspectionError("not_completed", "The competitive outcome has not been recorded");
        const results = buildWerewolfResults(events);
        speakers = (retrospective?.definition.speakerIds ?? []).map((actorId, ordinal) => {
          const player = results.players.find(player => player.id === actorId)!;
          return { actorId, name: player.name, ordinal, avatarUrl: `/api/werewolf/${encodeURIComponent(game.id)}/characters/${encodeURIComponent(actorId)}?audience=omniscient&cursor=${results.source.cursor}`,
            part: { gameKind: "werewolf" as const, role: player.role, won: player.won, alive: player.alive, eliminatedDay: player.elimination?.day ?? null, eliminatedBy: player.elimination?.kind ?? null } };
        });
        links = new Map([...walkWerewolfHistory(events, "omniscient")].filter(frame => frame.entry?.kind === "speech" && frame.entry.purpose === "retrospective")
          .map(frame => [frame.event.sequence, werewolfMomentHref(game.slug, "omniscient", frame.cursor)]));
      } else {
        const persisted = await getPersistedGameEvents(tx, game.id);
        if (persisted.status === "invalid") throw new HouseInspectionError("unavailable", "Canonical retrospective history failed validation");
        const full = persisted.events.map(event => event.envelope), completeState = replayCanonicalEvents(full);
        const enteredRetrospective = Boolean(completeState.retrospective) || full.some(event => event.phase === Phase.RETROSPECTIVE);
        executionWithoutRetrospective = game.status === "completed" && !enteredRetrospective;
        if (game.status === "completed" && enteredRetrospective && (!completeState.retrospective?.completedAtEventSequence || completeState.phase !== Phase.END)) throw Error("Missing execution completion proof");
        if (previous) checkPinnedPrefix(replayCanonicalEvents(full.filter(event => event.sequence <= previous.throughSequence)).retrospective);
        const sequence = through(full, new Map(persisted.events.map(event => [event.sequence, event.eventHash])));
        const state = replayCanonicalEvents(full.filter(event => event.sequence <= sequence));
        outcome = state.retrospectiveOutcomeSource; retrospective = state.retrospective; requiredStatements = state.playerOrder.length;
        if (!outcome) throw new HouseInspectionError("not_completed", "The competitive outcome has not been recorded");
        const images = await tx.select({ id: schema.gamePlayers.id, persona: schema.gamePlayers.persona }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, game.id));
        const eliminated = [...state.acceptedOutcomes.councilEliminations, ...state.acceptedOutcomes.endgameEliminations];
        speakers = (retrospective?.definition.speakerIds ?? []).map((actorId, ordinal) => ({ actorId, name: state.players[actorId]!.name, ordinal,
          avatarUrl: (() => { const stored = images.find(player => player.id === actorId); const persona = stored ? JSON.parse(stored.persona) as Record<string, unknown> : null;
            return typeof persona?.avatarUrl === "string" ? persona.avatarUrl : null; })(),
          part: { gameKind: "influence" as const, won: state.acceptedOutcomes.juryWinner?.winnerId === actorId, eliminatedRound: eliminated.find(exit => exit.eliminated === actorId)?.round ?? null } }));
        links = new Map((retrospective?.statements ?? []).map(statement => [statement.eventSequence, gameReplaySequenceHref(game.slug, statement.eventSequence)]));
      }
    } catch (error) {
      if (error instanceof HouseInspectionError) throw error;
      throw new HouseInspectionError("unavailable", "Retrospective history is unavailable or invalid");
    }
    const accepted = retrospective?.statements ?? [], definitionHash = retrospective?.definition.definitionHash ?? null;
    if (previous && (previous.definitionHash !== definitionHash && !(previous.poll && previous.definitionHash === null)
      || previous.statementCount > accepted.length || !previous.poll && previous.statementCount !== accepted.length)) throw new HouseInspectionError("invalid_cursor", "Pinned retrospective definition or accepted prefix changed");
    const after = previous?.afterOrdinal ?? 0, config = JSON.parse(game.config) as Record<string, unknown>;
    const failure = config.retrospectiveFailure as { id: string; code: string; head: { sequence: number; hash: string } } | null | undefined;
    const recovery = game.status === "suspended" && head!.sequence === latestSequence ? { expectedHead: head!, expectedFailureId: failure?.id ?? null, reasonCode: failure?.code ?? "retrospective_paused" } : null;
    for (let count = Math.min(limit, accepted.length - after); count >= 0; count--) {
      const end = after + count, cursor: Cursor = { version: 1, gameId: game.id, gameKind: game.gameKind, throughSequence: head!.sequence, throughHash: head!.hash,
        definitionHash, statementCount: accepted.length, afterOrdinal: end, poll: false };
      const value = { schemaVersion: 1 as const, game: houseGameIdentity(game), gameKind: game.gameKind, outcome: outcome!, source: head!, initialized: retrospective !== null,
        progress: retrospectiveProgress(outcome!, retrospective, requiredStatements, executionWithoutRetrospective), speakers,
        statements: accepted.slice(after, end).map(statement => {
          const href = links.get(statement.eventSequence);
          if (!href) throw new HouseInspectionError("unavailable", "Accepted speech has no canonical replay link");
          return { actorId: statement.actorId, ordinal: statement.ordinal, eventSequence: statement.eventSequence, speech: statement.speech, href };
        }),
        nextCursor: end < accepted.length ? encode(cursor) : null,
        pollCursor: end === accepted.length && game.status === "in_progress" ? encode({ ...cursor, poll: true }) : null,
        recovery, resultsHref: gameResultsHref(game.slug), contentTrust: "untrusted_game_authored" as const };
      if (houseJsonBytes(value) + 4096 <= HOUSE_PAGE_BYTES) return value;
      if (count === 0 || count === 1 && after < accepted.length) throw new HouseInspectionError("entry_too_large", "A complete retrospective entry exceeds the response budget");
    }
    throw new HouseInspectionError("entry_too_large", "Retrospective metadata exceeds the response budget");
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
