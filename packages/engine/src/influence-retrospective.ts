import { canonicalJson } from "@influence/prompt-lab-protocol";
import { formalSpeechDisplayText } from "./accepted-formal-speech";
import type { CanonicalGameEvent } from "./canonical-events";
import { replayCanonicalEvents } from "./game-projection";
import type { TranscriptEntry } from "./game-runner.types";
import { Phase, PlayerStatus } from "./types";
import { RetrospectiveContractError, type RetrospectiveInputV1 } from "./retrospective";
import { appendRetrospectiveSection, freezeRetrospectiveGame, type RetrospectiveCapacityPolicy } from "./retrospective-context";

/** Supplied from original game setup, never the current editable Agent Profile. */
export interface InfluenceRetrospectiveSeat {
  id: string;
  name: string;
  personality: string;
  backstory: string;
  influenceStrategy: string;
}

/** Exhaustive fact allowlist. Prose, cognition and provider/production internals
 * never become factual summaries, even when they occur inside canonical payloads.
 */
function influenceFact(event: CanonicalGameEvent): unknown {
  switch (event.type) {
    case "game.roster_initialized": return { players: event.payload.players.map(({ id, name, gender }) => ({ id, name, ...(gender !== undefined && { gender }) })), formats: event.payload.formatManifest };
    case "game.phase_entered": return { phase: event.payload.phase, remainingPlayerIds: event.payload.remainingPlayers.map(player => player.id) };
    case "round.started": return { round: event.payload.round };
    case "shields.expired": return { expiredPlayerIds: event.payload.expiredPlayerIds };
    case "mingle.rooms_allocated": return { rooms: event.payload.rooms.map(({ roomId, beat, playerIds }) => ({ roomId, beat, playerIds })), excluded: event.payload.excluded };
    case "vote.cast": return { voterId: event.payload.voterId, empowerTarget: event.payload.empowerTarget, exposeTarget: event.payload.exposeTarget ?? null };
    case "vote.empower_tally_resolved": return { counts: event.payload.counts, empowered: event.payload.empowered, tied: event.payload.tied, method: event.payload.method };
    case "vote.empower_revote_cast": return { voterId: event.payload.voterId, target: event.payload.target };
    case "vote.empower_vote_cleared": return { voterId: event.payload.voterId };
    case "vote.empowered_set": return { empowered: event.payload.empowered, method: event.payload.method };
    case "format.menu_offered": return { empoweredId: event.payload.empoweredId, offeredFormatIds: event.payload.offeredFormatIds };
    case "format.selected": return { empoweredId: event.payload.empoweredId, formatId: event.payload.formatId };
    case "format.two_names_setup": return { empoweredId: event.payload.empoweredId, initialNomineeIds: event.payload.initialNomineeIds, overrideHolderId: event.payload.overrideHolderId };
    case "format.two_names_mingle_completed": return { window: event.payload.window, finalistPlayerIds: event.payload.finalistPlayerIds };
    case "format.two_names_override_declined": return { overrideHolderId: event.payload.overrideHolderId, finalistPlayerIds: event.payload.finalistPlayerIds };
    case "format.two_names_override_used": return { overrideHolderId: event.payload.overrideHolderId, removedNomineeId: event.payload.removedNomineeId };
    case "format.two_names_replacement_named": return { empoweredId: event.payload.empoweredId, replacementNomineeId: event.payload.replacementNomineeId, finalistPlayerIds: event.payload.finalistPlayerIds };
    case "format.two_names_plea_recorded": return { speakerId: event.payload.speakerId, ordinal: event.payload.ordinal, status: event.payload.status, absenceReason: event.payload.absenceReason };
    case "format.ballot_cast": return { formatId: event.payload.formatId, voterId: event.payload.voterId, status: "sealed_ballot_recorded" };
    case "format.ballot_forfeited": return { formatId: event.payload.formatId, voterId: event.payload.voterId, reason: event.payload.reason };
    case "format.safety_bounce_started": return { starterId: event.payload.starterId };
    case "format.safety_bounce_pointer": return { actorId: event.payload.actorId, targetId: event.payload.targetId, classification: event.payload.classification };
    case "format.resolved": {
      if (event.payloadVersion !== 2) throw new RetrospectiveContractError("Retrospective requires the current format resolution contract");
      return { formatId: event.payload.formatId, empoweredId: event.payload.empoweredId,
      eliminatedId: event.payload.eliminatedId, resolutionKind: event.payload.resolutionKind,
      tiedPlayerIds: event.payload.tiedPlayerIds, tiebreakerId: event.payload.tiebreakerId,
      aggregate: event.payload.aggregate };
    }
    case "power.action_set": return { action: event.payload.action.action, target: event.payload.action.action === "pass" ? null : event.payload.action.target };
    case "power.candidates_resolved": return { exposeScores: event.payload.exposeScores, candidates: event.payload.candidates,
      autoEliminated: event.payload.autoEliminated, shieldGranted: event.payload.shieldGranted, method: event.payload.method };
    case "alliance.proposal_submitted":
    case "alliance.counter_submitted":
    case "alliance.proposal_expired": return { allianceId: event.payload.lineage.allianceId, status: event.payload.lineage.status,
      currentVersionId: event.payload.lineage.currentVersionId,
      proposals: event.payload.lineage.versions.map(version => ({ versionId: version.versionId,
        proposerId: version.proposerId, memberIds: version.terms.memberIds, counterIndex: version.counterIndex })) };
    case "alliance.response_recorded": return { allianceId: event.payload.lineage.allianceId, playerId: event.payload.playerId,
      response: event.payload.response, versionId: event.payload.versionId };
    case "alliance.activated":
    case "alliance.amendment_resolved":
    case "alliance.closed":
    case "alliance.archived": return { allianceId: event.payload.alliance.id, memberIds: event.payload.alliance.memberIds,
      status: event.payload.alliance.status, closedReason: event.payload.alliance.closedReason ?? null, archivedReason: event.payload.alliance.archivedReason ?? null };
    case "alliance.huddle_scheduled":
    case "alliance.huddle_skipped": return { allianceId: event.payload.schedule.allianceId, window: event.payload.schedule.window,
      decision: event.payload.schedule.decision, memberIds: event.payload.schedule.memberIds };
    case "alliance.huddle_completed": return { allianceId: event.payload.session.allianceId, window: event.payload.session.window, speakerIds: event.payload.session.speakerIds };
    case "alliance.huddle_outcome_recorded": {
      if (event.payloadVersion !== 2) throw new RetrospectiveContractError("Retrospective requires the current huddle outcome contract");
      return { allianceId: event.payload.outcome.allianceId, window: event.payload.outcome.window, status: "recorded" };
    }
    case "council.vote_cast": return { voterId: event.payload.voterId, target: event.payload.target };
    case "council.elimination_resolved": return { empoweredId: event.payload.empoweredId, candidates: event.payload.candidates,
      votes: event.payload.tally.votes, eliminated: event.payload.eliminated, method: event.payload.method };
    case "player.last_message_recorded":
    case "player.elimination_message_recorded": return { playerId: event.payload.playerId, status: "speech_recorded" };
    case "player.eliminated": return { playerId: event.payload.playerId, eliminatedRound: event.payload.eliminatedRound };
    case "endgame.stage_set": return { stage: event.payload.stage, lastEmpoweredFromRegularRounds: event.payload.lastEmpoweredFromRegularRounds };
    case "endgame.elimination_vote_cast": return { voterId: event.payload.voterId, target: event.payload.target };
    case "endgame.elimination_resolved": return { stage: event.payload.stage, votes: event.payload.tally.votes,
      juryTiebreakerVotes: event.payload.juryTiebreakerVotes ?? null, eliminated: event.payload.eliminated, method: event.payload.method };
    case "jury.vote_cast": return { jurorId: event.payload.jurorId, finalistId: event.payload.finalistId };
    case "jury.winner_determined": return { votes: event.payload.tally.votes, winnerId: event.payload.winnerId,
      method: event.payload.method, voteCounts: event.payload.voteCounts.map(({ id, votes }) => ({ id, votes })) };
    case "judgment.speech_recorded": return { speechKind: event.payload.speechKind, playerId: event.payload.playerId,
      addresseeId: event.payload.addresseeId ?? null, provenance: event.payload.provenance };
    case "endgame.speech_recorded": return { speechKind: event.payload.speechKind, playerId: event.payload.playerId,
      targetId: event.payload.targetId ?? null, counterpartId: event.payload.counterpartId ?? null, provenance: event.payload.provenance };
    case "round.result_recorded": {
      const result = event.payload.result;
      return { round: result.round, empoweredId: result.empoweredId, exposeScores: result.exposeScores,
        candidates: result.candidates, powerAction: result.powerAction, powerTarget: result.powerTarget,
        eliminated: result.eliminated, shieldGranted: result.shieldGranted ?? null, formatId: result.formatId ?? null };
    }
    case "visual.operation_recorded":
    case "visual.cue_recorded":
    case "mingle.coordination_receipt_recorded": return { status: "private_production_or_coordination_metadata_omitted" };
    case "retrospective.started":
    case "retrospective.statement_recorded":
    case "retrospective.completed": throw new RetrospectiveContractError("Retrospective cannot be part of its own source account");
  }
  const unhandled: never = event;
  throw new RetrospectiveContractError(`Unsupported retrospective event: ${String(unhandled)}`);
}

function eventQuotes(event: CanonicalGameEvent): Array<Pick<RetrospectiveInputV1["dialogue"][number], "actorId" | "scope" | "audiencePlayerIds" | "text">> {
  const publicSpeech = (actorId: string, text: string) => ({ actorId, text, scope: "public" as const, audiencePlayerIds: [] });
  switch (event.type) {
    case "player.last_message_recorded":
    case "player.elimination_message_recorded": return [publicSpeech(event.payload.playerId, event.payload.message)];
    case "judgment.speech_recorded":
    case "endgame.speech_recorded": return [publicSpeech(event.payload.playerId, event.payload.text)];
    case "format.two_names_plea_recorded": return event.payload.text === null ? [] : [publicSpeech(event.payload.speakerId, event.payload.text)];
    case "alliance.proposal_submitted":
    case "alliance.counter_submitted": {
      const version = event.payload.lineage.versions.find(version => version.versionId === event.payload.lineage.currentVersionId);
      return version ? [{ actorId: version.proposerId, scope: "alliance", audiencePlayerIds: [...version.terms.memberIds],
        text: canonicalJson({ name: version.terms.name, purpose: version.terms.purpose, timebox: version.terms.timebox }) }] : [];
    }
    case "alliance.huddle_outcome_recorded": {
      if (event.payloadVersion !== 2) throw new RetrospectiveContractError("Retrospective requires the current huddle outcome contract");
      return event.payload.outcome.facts.map(fact => ({
      actorId: fact.actorPlayerId,
      scope: "huddle", audiencePlayerIds: null,
      // These are recorded communications, not proof that a promise was fulfilled.
      text: canonicalJson(fact.kind === "proposal" || fact.kind === "commitment"
        ? { factId: fact.factId, kind: fact.kind, actionKind: fact.actionKind, targetPlayerId: fact.targetPlayerId, confidence: fact.confidence }
        : fact.kind === "response" ? { factId: fact.factId, kind: fact.kind, counterpartFactId: fact.counterpartFactId, stance: fact.stance,
          replacementActionKind: fact.replacementActionKind ?? null, replacementTargetPlayerId: fact.replacementTargetPlayerId ?? null, confidence: fact.confidence }
          : { factId: fact.factId, kind: fact.kind, conditionKind: fact.conditionKind, conditionPlayerId: fact.conditionPlayerId ?? null,
            effectActionKind: fact.effectActionKind, effectTargetPlayerId: fact.effectTargetPlayerId, confidence: fact.confidence }),
      }));
    }
    default: return [];
  }
}

export function freezeInfluenceRetrospective(options: {
  events: readonly CanonicalGameEvent[];
  transcript: readonly TranscriptEntry[];
  /** Captured at the original outcome by the owning turn, not a current read head. */
  transcriptThroughSequence: number;
  /** Owning durable turn's canonical boundary for each product speech. The two
   * sequence spaces are independent; never derive this relation from prose.
   */
  dialogueAnchors: readonly { entrySequence: number; eventSequence: number }[];
  seats: readonly InfluenceRetrospectiveSeat[];
  capacities: RetrospectiveCapacityPolicy;
}) {
  const projection = replayCanonicalEvents(options.events), outcome = projection.retrospectiveOutcomeSource;
  if (!outcome || !Number.isSafeInteger(options.transcriptThroughSequence) || options.transcriptThroughSequence < 0) {
    throw new RetrospectiveContractError("Influence retrospective requires canonical outcome and original dialogue boundary");
  }
  const prefix = options.events.slice(0, outcome.eventSequence), original = replayCanonicalEvents(prefix);
  if (!prefix.some(event => event.type === "game.roster_initialized" && event.payload.formatManifest !== undefined)) {
    throw new RetrospectiveContractError("Retrospective requires a current frozen roster");
  }
  if (options.seats.length !== original.playerOrder.length || options.seats.some(seat => original.players[seat.id]?.name !== seat.name)) {
    throw new RetrospectiveContractError("Influence retrospective characters must use original seat identity");
  }
  const winnerId = original.acceptedOutcomes.juryWinner?.winnerId
    ?? original.playerOrder.find(id => original.players[id]?.status === PlayerStatus.ALIVE);
  if (!winnerId || !original.playerOrder.includes(winnerId)) throw new RetrospectiveContractError("Influence retrospective has no canonical winner");
  const exits = prefix.flatMap(event => event.type === "player.eliminated" ? [event.payload.playerId] : []);
  if (new Set(exits).size !== exits.length || exits.includes(winnerId)) throw new RetrospectiveContractError("Invalid Influence exit history");
  const speakerIds = [...exits, ...original.playerOrder.filter(id => !exits.includes(id) && id !== winnerId), winnerId];
  const input: RetrospectiveInputV1 = { version: 1, outcome, sections: [], dialogue: [] };
  let phase = Phase.INIT;
  for (const event of prefix) {
    if (event.type === "game.phase_entered") phase = event.payload.phase;
    else if (event.phase !== null) phase = event.phase;
    appendRetrospectiveSection(input.sections, `round:${event.round}/${phase}`, event.sequence,
      `${event.type} ${canonicalJson(influenceFact(event))}${event.sequence === outcome.eventSequence ? `; outcome winner=${winnerId}` : ""}`);
  }
  const productEntries = options.transcript.filter(entry => entry.entrySequence !== undefined && entry.entrySequence <= options.transcriptThroughSequence);
  if (productEntries.length !== options.transcriptThroughSequence || productEntries.some((entry, index) => entry.entrySequence !== index + 1)) {
    throw new RetrospectiveContractError("Retrospective requires the complete ordered product-dialogue prefix");
  }
  const anchors = new Map(options.dialogueAnchors.map(anchor => [anchor.entrySequence, anchor.eventSequence]));
  if (anchors.size !== options.dialogueAnchors.length || options.dialogueAnchors.some(anchor => !Number.isSafeInteger(anchor.entrySequence)
    || anchor.entrySequence < 1 || anchor.entrySequence > options.transcriptThroughSequence || !Number.isSafeInteger(anchor.eventSequence)
    || anchor.eventSequence < 1 || anchor.eventSequence > outcome.eventSequence)) {
    throw new RetrospectiveContractError("Invalid retrospective dialogue source anchors");
  }
  let lastAnchor = 0;
  for (const entry of productEntries) {
    if (!["public", "mingle", "huddle", "whisper"].includes(entry.scope)) continue;
    if (entry.phase === Phase.RETROSPECTIVE || entry.phase === Phase.END
      || !prefix.some(event => event.round === entry.round && (event.phase === entry.phase
        || event.type === "game.phase_entered" && event.payload.phase === entry.phase))) {
      throw new RetrospectiveContractError(`Dialogue phase is outside the original game account: ${entry.round}/${entry.phase}, entry ${entry.entrySequence}`);
    }
    if (!entry.speakerPlayerId || !original.playerOrder.includes(entry.speakerPlayerId) || !entry.text.trim()) {
      throw new RetrospectiveContractError("Retrospective dialogue requires canonical speaker identity and nonblank text");
    }
    const eventSequence = anchors.get(entry.entrySequence!);
    if (eventSequence === undefined || eventSequence < lastAnchor) {
      throw new RetrospectiveContractError("Retrospective speech requires an ordered owning-turn source anchor");
    }
    lastAnchor = eventSequence;
    // Formal accepted speech has its own exact source. No fuzzy text/name match.
    const linked = prefix.find(event => (event.type === "judgment.speech_recorded" || event.type === "endgame.speech_recorded"
      || event.type === "player.last_message_recorded" || event.type === "player.elimination_message_recorded" || event.type === "format.two_names_plea_recorded")
      && eventQuotes(event).length > 0 && (
      event.sourcePointers.some(pointer => pointer.kind === "transcript_entry" && pointer.sequence === entry.entrySequence && pointer.actorId === entry.speakerPlayerId)
      || event.type === "endgame.speech_recorded" && event.payload.correlationKey === entry.dialogueContext?.formalSpeechCorrelationKey));
    if (linked) {
      const quote = eventQuotes(linked)[0]!;
      const displayText = linked.type === "endgame.speech_recorded" ? formalSpeechDisplayText({
        kind: linked.payload.speechKind, text: linked.payload.text, targetId: linked.payload.targetId,
        counterpartId: linked.payload.counterpartId,
      }, { targetName: linked.payload.targetId ? original.players[linked.payload.targetId]?.name : undefined })
        : linked.type === "judgment.speech_recorded" ? formalSpeechDisplayText({
          kind: linked.payload.speechKind, text: linked.payload.text, counterpartId: linked.payload.addresseeId,
        }, { counterpartName: linked.payload.addresseeId ? original.players[linked.payload.addresseeId]?.name : undefined }) : quote.text;
      if (quote.actorId !== entry.speakerPlayerId || displayText !== entry.text || entry.scope !== "public") {
        throw new RetrospectiveContractError("Canonical and correlated product speech differ");
      }
      continue;
    }
    const scope = entry.scope;
    if (scope !== "public" && scope !== "mingle" && scope !== "huddle" && scope !== "whisper") throw new RetrospectiveContractError("Invalid retrospective speech scope");
    if (scope !== "public" && !Array.isArray(entry.audiencePlayerIds)) throw new RetrospectiveContractError("Private dialogue requires its recorded audience");
    input.dialogue.push({ eventSequence, source: { kind: "transcript_entry", sequence: entry.entrySequence! },
      actorId: entry.speakerPlayerId, scope, audiencePlayerIds: scope === "public" ? [] : [...entry.audiencePlayerIds!], text: entry.text });
  }
  for (const event of prefix) for (const quote of eventQuotes(event)) {
    if (!original.playerOrder.includes(quote.actorId) || !quote.text.trim()) throw new RetrospectiveContractError("Invalid canonical retrospective quote");
    input.dialogue.push({ eventSequence: event.sequence, source: { kind: "canonical_event", sequence: event.sequence }, ...quote });
  }
  input.dialogue.sort((a, b) => a.eventSequence - b.eventSequence
    || (a.source.kind === b.source.kind ? a.source.sequence - b.source.sequence : a.source.kind === "canonical_event" ? -1 : 1));
  return freezeRetrospectiveGame(input, speakerIds, options.seats.map(seat => ({
    id: seat.id, name: seat.name, personality: seat.personality, backstory: seat.backstory, strategy: seat.influenceStrategy,
  })), projection.retrospective?.definition ?? null, options.capacities);
}
