import { INFLUENCE_BALLOT_ACTIONS } from "../influence-decision-speech";
import type { ViewerDecisionEvent } from "../viewer-decision-events";
import { assembleProductionCatalog, type InfluenceProductionPresentation, type ProductionSource } from "./index";

/** Structured display metadata only. Legacy prose subparts stay inside this row. */
export interface InfluenceProductionTranscript {
  id: string | number; timestamp: number; round: number; phase: string; scope: string;
  entrySequence?: number | null; firstDurableEventSequence?: number | null;
  dialogueKind?: string | null; presentationPurpose?: string;
  anonymous?: boolean; speakerPlayerId?: string | null; fromPlayerId?: string | null;
  decisionSpeech?: { action: string; actorId: string; receiptEntrySequence?: number };
  acceptedBallot?: { voterId: string; targetId: string; purpose: "empower" | "eliminate" | "winner" };
  thinking?: string | null;
  retrospectiveSource?: { eventSequence: number; ordinal: number };
}
export interface InfluenceProductionFrame {
  sequence: number; timestamp: number; round: number; phase: string; eventType?: string;
  players: readonly { id: string; name?: string; status?: string }[];
  viewerDecisionEvent?: ViewerDecisionEvent;
  /** Producer-only accepted sealed slot. Public watch frames remain unchanged. */
  productionBallot?: { kind: "eliminate" | "winner" | "council"; voterId: string };
}
export interface InfluenceProductionThought {
  eventSequence: number; actorId: string; thinking: string;
  /** Accepted identity and permitted reveal are deliberately separate. */
  revealEventSequence?: number;
  defaultThinking: boolean;
}

export const INFLUENCE_PRODUCTION_FORMAT_PHASES = ["INTRODUCTION", "LOBBY", "VOTE", "FORMAT_MENU", "FORMAT_PICK", "FORMAT_MINGLE", "FORMAT_RESOLVE", "RETROSPECTIVE", "END"] as const;
export const INFLUENCE_PRODUCTION_PHASE_ORDER = [
  "INIT", "INTRODUCTION", "LOBBY", "MINGLE_I", "PRE_VOTE_HUDDLE", "VOTE", "FORMAT_MENU", "FORMAT_PICK", "FORMAT_MINGLE", "FORMAT_RESOLVE", "WHISPER", "MINGLE", "POST_VOTE_MINGLE", "RUMOR", "POWER", "REVEAL", "PRE_COUNCIL_HUDDLE", "COUNCIL", "PLEA", "ACCUSATION", "DEFENSE", "DIARY_ROOM", "OPENING_STATEMENTS", "JURY_QUESTIONS", "CLOSING_ARGUMENTS", "JURY_VOTE", "RETROSPECTIVE", "END", "SUSPENDED",
] as const;
const FORMAT_AUTHORITY_PHASES = new Set(["VOTE", "FORMAT_MENU", "FORMAT_PICK", "FORMAT_RESOLVE"]);

export function isInfluenceProductionStoryDialogue(message: Pick<InfluenceProductionTranscript, "decisionSpeech" | "scope" | "acceptedBallot" | "dialogueKind" | "presentationPurpose" | "anonymous" | "speakerPlayerId" | "fromPlayerId">): boolean {
  if (message.decisionSpeech) return true;
  if (message.scope === "thinking" || message.scope === "diary") return false;
  if (message.acceptedBallot?.purpose === "winner") return false;
  if (message.dialogueKind === "house_summary" || message.presentationPurpose === "farewell" || message.acceptedBallot) return true;
  return message.scope !== "system" && Boolean(message.anonymous || message.speakerPlayerId || message.fromPlayerId);
}
export function isInfluenceProductionSocialTranscript(message: Pick<InfluenceProductionTranscript, "decisionSpeech" | "phase" | "presentationPurpose" | "dialogueKind">): boolean {
  if (message.decisionSpeech) return !INFLUENCE_BALLOT_ACTIONS.has(message.decisionSpeech.action) && message.decisionSpeech.action !== "format-ballot";
  return message.dialogueKind === "house_summary" || message.presentationPurpose === "farewell" || !FORMAT_AUTHORITY_PHASES.has(message.phase);
}

type SourceRow = {
  source: ProductionSource; round: number; phase: string; sequence: number | null;
  lane: "classic" | "format" | "endgame"; summary?: boolean; serial: number;
};
function phaseRank(phase: string) {
  const format = (INFLUENCE_PRODUCTION_FORMAT_PHASES as readonly string[]).indexOf(phase);
  if (format >= 0) return format;
  const replay = (INFLUENCE_PRODUCTION_PHASE_ORDER as readonly string[]).indexOf(phase);
  return replay >= 0 ? INFLUENCE_PRODUCTION_FORMAT_PHASES.length + replay : Number.MAX_SAFE_INTEGER;
}
function compareRows(a: SourceRow, b: SourceRow) {
  if (a.round !== b.round) return a.round - b.round;
  if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) return a.sequence - b.sequence;
  const phase = phaseRank(a.phase) - phaseRank(b.phase);
  if (phase) return phase;
  if (a.lane !== b.lane) {
    if (a.lane === "classic") return a.summary ? 1 : -1;
    if (b.lane === "classic") return b.summary ? -1 : 1;
    return a.lane === "format" ? -1 : 1;
  }
  return a.serial - b.serial;
}

/** One source/semantic-part inventory for API authorization and browser binding.
 * Game-owned canonical reduction/validation happens before calling this helper;
 * this enumerates presentation, never computes a vote or game result. */
export function buildInfluenceProductionSources(input: {
  gameId: string; gameKernel: "classic" | "format";
  /** Frozen v3 source snapshots retain their original separate speech moments. */
  attachDecisionSpeech?: boolean;
  transcripts: readonly InfluenceProductionTranscript[];
  frames: readonly InfluenceProductionFrame[];
  thoughts?: readonly InfluenceProductionThought[];
}): ProductionSource[] {
  if (input.gameKernel !== "classic" && input.gameKernel !== "format") throw new Error("Invalid Influence production kernel");
  const frames = [...input.frames].sort((a, b) => a.sequence - b.sequence);
  const frameBySequence = new Map<number, InfluenceProductionFrame>();
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 1 || frameBySequence.has(frame.sequence)) throw new Error("Invalid or ambiguous Influence production frame");
    if (frame.viewerDecisionEvent && frame.viewerDecisionEvent.sequence !== frame.sequence) throw new Error("Influence decision provenance does not match its frame");
    if (frame.productionBallot && (Object.keys(frame.productionBallot).sort().join() !== "kind,voterId" || !["eliminate", "winner", "council"].includes(frame.productionBallot.kind) || typeof frame.productionBallot.voterId !== "string" || !frame.players.some(player => player.id === frame.productionBallot!.voterId)
      || frame.phase !== (frame.productionBallot.kind === "winner" ? "JURY_VOTE" : frame.productionBallot.kind === "council" ? "COUNCIL" : "VOTE"))) throw new Error("Invalid Influence production sealed ballot context");
    frameBySequence.set(frame.sequence, frame);
  }
  const rows: SourceRow[] = [];
  let serial = 0;
  const append = (source: ProductionSource, round: number, phase: string, sequence: number | null, lane: SourceRow["lane"], summary = false) => rows.push({ source, round, phase, sequence, lane, summary, serial: serial++ });
  const transcripts = [...input.transcripts].sort((a, b) => a.timestamp - b.timestamp || (typeof a.id === "number" && typeof b.id === "number" ? a.id - b.id : String(a.id).localeCompare(String(b.id))));
  const transcriptIds = new Set<string>();
  for (const message of transcripts) {
    if (transcriptIds.has(String(message.id))) throw new Error("Ambiguous Influence production transcript row");
    transcriptIds.add(String(message.id));
    if (message.decisionSpeech && message.scope === "system") continue;
    if (input.attachDecisionSpeech !== false && input.gameKernel === "format" && message.decisionSpeech && ["bounce-pointer", "format-tiebreak", "format-two-names-tiebreak"].includes(message.decisionSpeech.action)) {
      const speech = message.decisionSpeech;
      if (frames.some(frame => frame.round === message.round && (frame.viewerDecisionEvent?.type === "format.safety_bounce_pointer" ? speech.action === "bounce-pointer" && frame.viewerDecisionEvent.payload.actorId === speech.actorId : frame.viewerDecisionEvent?.type === "format.resolved" && speech.action !== "bounce-pointer" && frame.viewerDecisionEvent.payload.tiebreakerId === speech.actorId))) continue;
    }
    if (!isInfluenceProductionStoryDialogue(message) || input.gameKernel === "format" && !isInfluenceProductionSocialTranscript(message)) continue;
    const token = message.anonymous ? undefined : message.speakerPlayerId ?? message.fromPlayerId ?? undefined;
    const roster = frames.find(frame => frame.round === message.round)?.players ?? [];
    const named = roster.filter(player => player.name === token);
    const actorId = token ? roster.find(player => player.id === token)?.id ?? (named.length === 1 ? named[0]!.id : token) : undefined;
    const latestFrame = frames.findLast(frame => frame.round === message.round && frame.timestamp <= message.timestamp);
    if (message.phase === "RETROSPECTIVE" && (!message.retrospectiveSource || !actorId || message.anonymous)
      || message.phase !== "RETROSPECTIVE" && message.retrospectiveSource) throw new Error("Retrospective dialogue requires exact canonical provenance");
    const sequence = message.retrospectiveSource?.eventSequence ?? message.firstDurableEventSequence ?? latestFrame?.sequence ?? null;
    append({ kind: "influence-transcript", transcriptId: String(message.id), order: { anchor: 0, offset: 0 },
      presentation: message.acceptedBallot ? "ballot" : actorId || message.anonymous ? "speech" : "scene",
      ...(message.acceptedBallot ? { ballot: { voterId: message.acceptedBallot.voterId, purpose: message.acceptedBallot.purpose } } : {}),
      ...(actorId ? { actorId } : {}), thinking: actorId ? message.thinking : undefined, defaultThinking: Boolean(actorId),
      ...(message.retrospectiveSource ? { retrospectiveSource: message.retrospectiveSource } : {}),
    }, message.round, message.phase, sequence, "classic", message.dialogueKind === "house_summary");
  }

  const releases = new Map<number, number>();
  const initialEmpower = new Map<string, number>(), revotes = new Map<string, number>(), formatBallots = new Map<string, number>();
  const eliminationBallots = new Map<string, number>(), winnerBallots = new Map<string, number>(), councilBallots = new Map<string, number>();
  let round = -1, pendingEmpower = false;
  let acceptedWinnerId: string | undefined;
  let pendingEndgameExit: { round: number; playerId: string } | null = null;
  const format = (event: ViewerDecisionEvent, presentation: InfluenceProductionPresentation, phase = event.phase ?? "INIT") => {
    const actorId = "actorId" in presentation ? presentation.actorId : undefined;
    const actions = presentation.kind === "safety_bounce_pointer" ? ["bounce-pointer"] : presentation.kind === "format_tiebreak" ? ["format-tiebreak", "format-two-names-tiebreak"] : [];
    const speech = input.attachDecisionSpeech !== false ? transcripts.find(row => row.round === event.round && row.decisionSpeech && row.decisionSpeech.actorId === actorId && actions.includes(row.decisionSpeech.action)) : undefined;
    append({kind:"influence-event",eventSequence:event.sequence,presentation,order:{anchor:0,offset:0}, ...(speech?.thinking && {thinking:speech.thinking,defaultThinking:false,actorId})},event.round,phase,event.sequence,"format");
  };
  const tally = (event: ViewerDecisionEvent, purpose: "empower" | "format" | "eliminate" | "winner", juryTiebreaker = false, revote = false, lane: SourceRow["lane"] = "format", phase = event.phase ?? "INIT") => append({ kind: "influence-event", eventSequence: event.sequence, presentation: { kind: "ballot_tally", purpose, juryTiebreaker, revote }, order: { anchor: 0, offset: 0 } }, event.round, phase, event.sequence, lane);
  const exposeEmpower = (event: ViewerDecisionEvent, revote: boolean, roster: readonly { id: string }[]) => {
    const ballots = revote ? revotes : initialEmpower;
    for (const player of roster) {
      const acceptedSequence = ballots.get(player.id);
      if (acceptedSequence === undefined) continue;
      format(event, { kind: "empower_ballot", voterId: player.id, revote });
      releases.set(acceptedSequence, event.sequence);
    }
    if (ballots.size) tally(event, "empower", false, revote);
  };

  for (const frame of frames) {
    const event = frame.viewerDecisionEvent;
    if (frame.round !== round) { initialEmpower.clear(); revotes.clear(); formatBallots.clear(); eliminationBallots.clear(); winnerBallots.clear(); councilBallots.clear(); pendingEmpower = false; round = frame.round; }
    const sealed = frame.productionBallot;
    if (sealed) {
      const accepted = sealed.kind === "eliminate" ? eliminationBallots : sealed.kind === "winner" ? winnerBallots : councilBallots;
      if (accepted.has(sealed.voterId)) throw new Error("Ambiguous accepted sealed ballot provenance");
      accepted.set(sealed.voterId, frame.sequence);
    }
    if (frame.eventType === "retrospective.completed") {
      const survivors = frame.players.filter(player => player.status === "alive");
      const winnerId = acceptedWinnerId ?? (survivors.length === 1 ? survivors[0]!.id : undefined);
      if (winnerId) append({kind:"influence-event",eventSequence:frame.sequence,
        presentation:{kind:"endgame_winner",actorId:winnerId},order:{anchor:0,offset:0}},frame.round,"RETROSPECTIVE",frame.sequence,"endgame");
    }
    if (!event) continue;
    if (event.type === "jury.winner_determined") acceptedWinnerId = event.payload.winnerId;
    if (event.type === "vote.cast" || event.type === "vote.empower_revote_cast") {
      const accepted = event.type === "vote.cast" ? initialEmpower : revotes;
      if (accepted.has(event.payload.voterId)) throw new Error("Ambiguous accepted Empower ballot provenance");
      accepted.set(event.payload.voterId, event.sequence);
    }
    if (event.type === "vote.empower_tally_resolved") for (const sequence of initialEmpower.values()) releases.set(sequence, event.sequence);
    if (event.type === "vote.empowered_set") for (const sequence of (event.payload.method === "revote" || event.payload.method === "wheel" && revotes.size ? revotes : initialEmpower).values()) releases.set(sequence, releases.get(sequence) ?? event.sequence);
    if (event.type === "council.vote_cast" && !sealed) {
      if (councilBallots.has(event.payload.voterId)) throw new Error("Ambiguous accepted council ballot provenance");
      councilBallots.set(event.payload.voterId, event.sequence);
    }
    if (event.type === "council.elimination_resolved") { for (const [voterId, sequence] of councilBallots) if (event.payload.tally.votes[voterId]) releases.set(sequence, event.sequence); councilBallots.clear(); }
    if (event.type === "endgame.elimination_resolved" || event.type === "jury.winner_determined") {
      const winner = event.type === "jury.winner_determined", phase = winner ? "JURY_VOTE" : "VOTE";
      const accepted = winner ? winnerBallots : eliminationBallots;
      for (const [voterId, sequence] of accepted) if (event.payload.votes[voterId]) releases.set(sequence, event.sequence);
      accepted.clear();
      const ballots = (votes: Readonly<Record<string, string>>, juryTiebreaker: boolean) => {
        let count = 0;
        for (const player of frame.players) {
          if (!votes[player.id]) continue;
          append({ kind: "influence-event", eventSequence: event.sequence, presentation: { kind: "endgame_ballot", voterId: player.id, juryTiebreaker }, order: { anchor: 0, offset: 0 } }, event.round, phase, event.sequence, "endgame");
          count++;
        }
        if (count) tally(event, winner ? "winner" : "eliminate", juryTiebreaker, false, "endgame", phase);
      };
      ballots(event.payload.votes, false);
      if (event.type === "endgame.elimination_resolved") {
        ballots(event.payload.juryTiebreakerVotes, true);
        pendingEndgameExit = { round: event.round, playerId: event.payload.eliminatedId };
      } else append({ kind: "influence-event", eventSequence: event.sequence, presentation: { kind: "endgame_winner", actorId: event.payload.winnerId }, order: { anchor: 0, offset: 0 } }, event.round, phase, event.sequence, "endgame");
    } else if (event.type === "player.eliminated" && pendingEndgameExit?.round === event.round && pendingEndgameExit.playerId === event.payload.playerId) {
      append({ kind: "influence-event", eventSequence: event.sequence, presentation: { kind: "endgame_elimination", actorId: event.payload.playerId }, order: { anchor: 0, offset: 0 } }, event.round, "VOTE", event.sequence, "endgame");
      pendingEndgameExit = null;
    }
    if (input.gameKernel !== "format") continue;
    switch (event.type) {
      case "vote.empower_tally_resolved":
        exposeEmpower(event, false, frame.players);
        pendingEmpower = event.payload.method === "tie_pending";
        format(event, { kind: pendingEmpower ? "empowered_tie" : "empowered_tally", actorId: event.payload.empowered });
        break;
      case "vote.empowered_set":
        if (pendingEmpower) { exposeEmpower(event, true, frame.players); format(event, { kind: "empowered_tally", actorId: event.payload.empowered }); pendingEmpower = false; }
        break;
      case "format.menu_offered": format(event, { kind: "format_menu", actorId: event.payload.empoweredId }); break;
      case "format.selected":
        format(event, { kind: "format_selected", stage: "choice_legible", actorId: event.payload.empoweredId });
        format(event, { kind: "format_selected", stage: "rules_reveal", actorId: event.payload.empoweredId }); break;
      case "format.two_names_setup":
        format(event, { kind: "two_names_empowered_intro", actorId: event.payload.empoweredId });
        format(event, { kind: "two_names_initial_names", actorId: event.payload.empoweredId });
        format(event, { kind: "two_names_override_draw", actorId: event.payload.overrideHolderId }); break;
      case "format.two_names_mingle_completed": format(event, { kind: "two_names_mingle_complete", window: event.payload.window }); break;
      case "format.two_names_override_declined": format(event, { kind: "two_names_override_declined", actorId: event.payload.overrideHolderId }); break;
      case "format.two_names_override_used": format(event, { kind: "two_names_override_removed", actorId: event.payload.overrideHolderId }); break;
      case "format.two_names_replacement_named": format(event, { kind: "two_names_replacement", actorId: event.payload.empoweredId }); break;
      case "format.two_names_plea_recorded": format(event, { kind: "two_names_plea", actorId: event.payload.speakerId }); break;
      case "format.safety_bounce_started": format(event, { kind: "safety_bounce_started", actorId: event.payload.starterId }); break;
      case "format.safety_bounce_pointer": format(event, { kind: "safety_bounce_pointer", actorId: event.payload.actorId }); break;
      case "format.ballot_cast": case "format.ballot_forfeited":
        if (formatBallots.has(event.payload.voterId)) throw new Error("Ambiguous accepted format ballot provenance");
        formatBallots.set(event.payload.voterId, event.sequence); break;
      case "format.resolved": {
        const p = event.payload;
        const voters = p.aggregate.capability === "two_names" ? p.aggregate.eligibleVoterIds : frame.players.map(player => player.id);
        for (const voterId of voters) {
          const acceptedSequence = formatBallots.get(voterId);
          if (acceptedSequence === undefined) continue;
          format(event, { kind: "format_roll_call", voterId }); releases.set(acceptedSequence, event.sequence);
        }
        if (formatBallots.size) tally(event, "format");
        format(event, { kind: "format_aggregate" });
        if (p.tiebreakerId) { format(event, { kind: "format_tiebreak", actorId: p.tiebreakerId }); format(event, { kind: "format_deciding_vote", actorId: p.tiebreakerId }); }
        format(event, { kind: "format_elimination", actorId: p.eliminatedId }); break;
      }
    }
  }

  for (const thought of input.thoughts ?? []) {
    const accepted = frameBySequence.get(thought.eventSequence);
    const sealed = accepted?.productionBallot || accepted?.viewerDecisionEvent && ["vote.cast", "vote.empower_revote_cast", "format.ballot_cast", "format.ballot_forfeited", "council.vote_cast"].includes(accepted.viewerDecisionEvent.type);
    const acceptedVoter = accepted?.productionBallot?.voterId ?? (accepted?.viewerDecisionEvent && "voterId" in accepted.viewerDecisionEvent.payload ? accepted.viewerDecisionEvent.payload.voterId : undefined);
    if (sealed && acceptedVoter !== thought.actorId) throw new Error("Influence thinking actor does not match its accepted ballot");
    const releasedSequence = releases.get(thought.eventSequence);
    // Pending accepted choices have no revealed presentation in this prefix.
    if (sealed && releasedSequence === undefined) continue;
    const reveal = frameBySequence.get(thought.revealEventSequence ?? releasedSequence ?? thought.eventSequence);
    if (!accepted || !reveal || reveal.sequence < accepted.sequence || !accepted.players.some(player => player.id === thought.actorId)) throw new Error("Invalid Influence thinking source/reveal provenance");
    if (releasedSequence !== undefined && reveal.sequence < releasedSequence) throw new Error("Influence thinking precedes its permitted ballot reveal");
    append({ kind: "influence-thinking", eventSequence: thought.eventSequence, actorId: thought.actorId, thinking: thought.thinking, defaultThinking: thought.defaultThinking, order: { anchor: 0, offset: 0 } }, reveal.round, reveal.phase, reveal.sequence, "format");
    const isFormatTiebreak = accepted.viewerDecisionEvent?.type === "format.resolved"
      && accepted.viewerDecisionEvent.payload.tiebreakerId === thought.actorId;
    // Resolution thinking belongs to the deciding choice, even if this player
    // also cast a regular ballot revealed by the same aggregate event.
    const sibling = rows.find(row => row.sequence === reveal.sequence && row.source.kind === "influence-event"
      && (isFormatTiebreak
        ? row.source.presentation.kind === "format_tiebreak" && row.source.presentation.actorId === thought.actorId
        : "voterId" in row.source.presentation && row.source.presentation.voterId === thought.actorId));
    if (sibling) { rows.at(-1)!.serial = sibling.serial - 0.5; rows.at(-1)!.lane = sibling.lane; }
  }

  rows.sort(compareRows);
  const result: ProductionSource[] = [];
  let previous: SourceRow | undefined, summarized = false;
  for (const [index, row] of rows.entries()) {
    const source = { ...row.source, order: { anchor: index + 1, offset: 1 } };
    const isThought = source.kind === "influence-thinking";
    if (!isThought && previous && (previous.round !== row.round || previous.phase !== row.phase)) {
      if (!summarized) {
        const primary = assembleProductionCatalog({ gameId: input.gameId, gameKind: "influence", audience: "public", sources: [source] }).moments.find(m => m.kind !== "thinking");
        if (!primary || primary.source.kind === "influence-bridge") throw new Error("House bridge has no supported following source");
        let first = index;
        while (first > 0 && rows[first - 1]!.source.kind === "influence-thinking" && rows[first - 1]!.round === row.round && rows[first - 1]!.phase === row.phase) first--;
        result.push({ kind: "influence-bridge", following: primary.source, followingPart: primary.part, order: { anchor: first + 1, offset: 0 } });
      }
      summarized = false;
    }
    result.push(source);
    if (!isThought) { if (row.summary) summarized = true; previous = row; }
  }
  // Fail ambiguous descriptors at their owner before either API or web uses them.
  if (result.some(source => source.kind !== "influence-thinking"))
    result.unshift({kind: "opening", gameKind: "influence", order: {anchor: 0, offset: 0}});
  assembleProductionCatalog({ gameId: input.gameId, gameKind: "influence", audience: "public", sources: result });
  return result.sort((a, b) => a.order.anchor - b.order.anchor || a.order.offset - b.order.offset);
}
