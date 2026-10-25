import {werewolfHouseSpeech, werewolfNightHouseSpeech} from "@influence/engine/werewolf/house-speech";
import { and, eq, isNotNull } from "drizzle-orm";
import { compileAudioDelivery, type AudioDeliveryContext } from "@influence/engine/audio-delivery";
import type { VoiceAssignment } from "@influence/engine/voice-catalog";
import type { ProductionAudience } from "@influence/engine/production-moments";
import { schema, type DrizzleDB } from "../db/index.js";
import { buildInfluenceProductionSourceSnapshot } from "./influence-production-source.js";
import { buildWerewolfProductionSourceSnapshot } from "./werewolf-production-source.js";
import { readJson } from "./payload-storage.js";
import { sha256StableJson } from "./stable-hash.js";

export interface AudioSourceLine {
  momentId: string;
  /** Audience-specific delivery may have its own clip identity at one production moment. */
  productionMomentId?: string;
  watch?: Partial<Record<ProductionAudience, import("@influence/engine/audio-watch").AudioWatchCoordinate>>;
  speakerId: string | null;
  text: string;
  synthesisText: string;
  context: AudioDeliveryContext;
  eventSequence: number;
  annotationSequence?: number;
  audiences: ProductionAudience[];
}
export interface AudioSourceManifest {
  version: 1;
  gameId: string;
  throughEventSequence: number;
  lines: AudioSourceLine[];
}
export interface AudioClipRecipe extends AudioSourceLine {
  version: 1;
  voice: VoiceAssignment;
  codec: "mp3";
  sampleRate: 44100;
  bitRate: 192000;
}
export function audioRecipe(line: AudioSourceLine, voice: VoiceAssignment): AudioClipRecipe {
  return { ...line, version: 1, voice, codec: "mp3", sampleRate: 44100, bitRate: 192000 };
}
export function audioSourceHash(line: AudioSourceLine) {
  return sha256StableJson({ momentId: line.momentId, text: line.text, speakerId: line.speakerId });
}

/** Read accepted production sources, never raw provider reasoning or contestant context. */
export async function readAudioSource(db: DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0], gameId: string, live = false): Promise<AudioSourceManifest> {
  const [game] = await db.select({ kind: schema.games.gameKind }).from(schema.games).where(eq(schema.games.id, gameId));
  if (!game) throw new Error("Audio game not found");
  const lines: AudioSourceLine[] = [];
  let throughEventSequence: number;
  if (game.kind === "werewolf") {
    const events = await db.select({event:schema.werewolfEvents.event}).from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId,gameId)).orderBy(schema.werewolfEvents.sequence);
    const source = await buildWerewolfProductionSourceSnapshot(db, gameId, { audience: "omniscient", thinking: true }, live);
    const mystery = await buildWerewolfProductionSourceSnapshot(db, gameId, { audience: "mystery", thinking: false }, live);
    const publicMoments = new Map(mystery.catalog.moments.map(moment => [moment.id,moment]));
    const publicIds = new Set(publicMoments.keys());
    throughEventSequence = source.snapshot.throughEventSequence;
    for (const moment of source.catalog.moments) {
      const position = source.window.moments.find(row => row.cursor === moment.order.anchor);
      const eventSequence = "eventSequence" in moment.source ? moment.source.eventSequence : 0;
      const actionKind = moment.part.kind;
      const action = actionKind === "protect" || actionKind === "investigate" || actionKind === "hunt"
        ? position?.night?.actions.find(action => action.kind === actionKind) : undefined;
      const house = position && (["scene", "outcome", "result", "pack_vote"].includes(actionKind) || action)
        ? action ? werewolfNightHouseSpeech(action, position.snapshot.players) : werewolfHouseSpeech(position.entry, position.snapshot.players, position.snapshot.rulesVersion) : null;
      if (house && position) {
        const publicMoment = publicMoments.get(moment.id);
        const publicPosition = publicMoment && mystery.window.moments.find(row => row.cursor === publicMoment.order.anchor);
        const publicText = publicPosition ? werewolfHouseSpeech(publicPosition.entry, publicPosition.snapshot.players, publicPosition.snapshot.rulesVersion) : null;
        const coordinate = {kind: "werewolf" as const, cursor: moment.order.anchor, actorId: null, part: "speech" as const, ...(action && {action: action.kind})};
        const line: AudioSourceLine = {momentId: moment.id, speakerId: null, text: house, synthesisText: compileAudioDelivery(house, "speech").synthesisText,
          context: "speech", eventSequence, watch: {omniscient: coordinate}, audiences: ["omniscient"]};
        if (publicText && publicMoment) {
          const watch = {kind: "werewolf" as const, cursor: publicMoment.order.anchor, actorId: null, part: "speech" as const};
          if (publicText === house) {line.audiences.unshift("mystery"); line.watch!.mystery = watch;}
          else lines.push({...line, momentId: `${moment.id}:mystery`, productionMomentId: moment.id, text: publicText, synthesisText: compileAudioDelivery(publicText, "speech").synthesisText, watch: {mystery: watch}, audiences: ["mystery"]});
        }
        lines.push(line);
        continue;
      }
      let text: string | null | undefined;
      if (moment.kind === "thinking") text = source.thoughts.find(row => row.eventSequence === eventSequence && row.actorId === moment.actorId)?.thinking;
      else if (moment.part.kind === "night-speech") {
        const action = moment.part.action;
        const night = position?.night?.actions.find(row => row.kind === action && "actorId" in row && row.actorId === moment.actorId);
        if (night && night.kind !== "hunt") text = night.speech?.text;
      } else if (moment.kind === "speech" || moment.kind === "ballot") {
        const entry = position?.entry;
        if (entry?.kind === "discussion") text = entry.contribution.unavailable ? null : entry.contribution.text;
        else if (entry && "text" in entry && !("unavailable" in entry && entry.unavailable)) text = entry.text;
      }
      if (!text?.trim()) continue;
      const thought = moment.kind === "thinking";
      const thoughtAction = source.thoughts.find(row => row.eventSequence === eventSequence && row.actorId === moment.actorId)?.action;
      const nighttime = moment.part.kind === "night-speech" || (thoughtAction ? ["pack_talk","attack","investigate","protect","pack_propose"].includes(thoughtAction) : position?.snapshot.phase === "night");
      const context: AudioDeliveryContext = thought ? nighttime ? "night-thinking" : "thinking" : nighttime ? "night-speech" : "speech";
      const annotationSequence = moment.part.kind === "night-speech" ? events.findLast(({event}) => event.sequence <= eventSequence && event.type === "werewolf.action_accepted" && event.payload.actorId === moment.actorId && event.payload.action === (moment.part.kind === "night-speech" ? moment.part.action : null))?.event.sequence : eventSequence;
      lines.push({ ...(annotationSequence !== undefined && {annotationSequence}), momentId: moment.id, speakerId: moment.actorId ?? null, text, synthesisText: compileAudioDelivery(text, context).synthesisText,
        context, eventSequence, watch: {
          omniscient: {kind:"werewolf",cursor:moment.order.anchor,actorId:moment.actorId ?? null,part:thought ? "thinking" : "speech",...(moment.part.kind === "night-speech" && {action:moment.part.action})},
          ...(publicMoments.has(moment.id) && {mystery:{kind:"werewolf",cursor:publicMoments.get(moment.id)!.order.anchor,actorId:moment.actorId ?? null,part:thought ? "thinking" : "speech"}}),
        }, audiences: publicIds.has(moment.id) ? ["mystery", "omniscient"] : ["omniscient"] });
    }
  } else {
    const source = await buildInfluenceProductionSourceSnapshot(db, gameId, {}, live);
    throughEventSequence = source.snapshot.throughEventSequence;
    for (const moment of source.catalog.moments) {
      const ref = moment.source;
      const frame = ref.kind === "influence-event" ? source.frames.find(row => row.sequence === ref.eventSequence) : undefined;
      const presentation = moment.part.kind === "influence-presentation" ? moment.part.presentation : null;
      const action = presentation?.kind === "empower_ballot" ? presentation.revote ? "empower-revote" : "vote"
        : presentation?.kind === "format_roll_call" ? "format-ballot"
        : presentation?.kind === "endgame_ballot" ? frame?.phase === "JURY_VOTE" ? "jury-vote" : presentation.juryTiebreaker ? "tribunal-jury-tiebreaker-vote" : "endgame-elimination-vote" : null;
      let message = ref.kind === "influence-transcript" ? source.messages.find(row => String(row.id) === ref.transcriptId)
        : action ? source.messages.find(row => row.round === frame?.round && row.decisionSpeech?.actorId === moment.actorId && row.decisionSpeech?.action === action)
        : undefined;
      const transcript = message;
      if (message?.acceptedBallot && moment.kind !== "thinking") {
        const ballot = message.acceptedBallot, receipt = message.entrySequence;
        message = source.messages.find(row => row.round === transcript!.round && row.phase === transcript!.phase && row.decisionSpeech?.actorId === ballot.voterId && receipt !== undefined && row.decisionSpeech.receiptEntrySequence === receipt);
      }
      const event = frame?.viewerDecisionEvent;
      const text = moment.kind === "thinking" ? ref.kind === "influence-event"
        ? source.acceptedThoughts.find(row => row.eventSequence === ref.eventSequence && row.actorId === moment.actorId)?.thinking : message?.thinking
        : event?.type === "format.two_names_plea_recorded" && presentation?.kind === "two_names_plea" && event.payload.status === "accepted" ? event.payload.text
        : ["speech", "scene", "ballot"].includes(moment.kind) ? message?.text : undefined;
      if (!text?.trim()) continue;
      const context = moment.kind === "thinking" ? "thinking" : "speech";
      lines.push({ ...(message?.firstDurableEventSequence != null && {annotationSequence:message.firstDurableEventSequence}), momentId: moment.id, speakerId: moment.actorId ?? null, text,
        synthesisText: compileAudioDelivery(text, context).synthesisText, context,
        watch: {public:{kind:"influence",...(ref.kind === "influence-transcript" && {transcriptId:ref.transcriptId}),eventSequence:"eventSequence" in ref ? ref.eventSequence : message?.firstDurableEventSequence ?? 0,actorId:moment.actorId ?? null,part:context}},
        eventSequence: "eventSequence" in ref ? ref.eventSequence : message?.firstDurableEventSequence ?? 0, audiences: ["public"] });
    }
  }
  const calls = await db.select({ actorId: schema.providerLogicalCalls.actorId, sequence: schema.providerLogicalCalls.canonicalEventSequence,
    semantic: schema.providerLogicalCalls.semanticCoordinate, delivery: schema.providerLogicalCalls.audioDelivery })
    .from(schema.providerLogicalCalls).where(and(eq(schema.providerLogicalCalls.gameId, gameId), isNotNull(schema.providerLogicalCalls.acceptedAttemptId), isNotNull(schema.providerLogicalCalls.audioDelivery)));
  for (const call of calls) {
    const semantic = call.semantic;
    const sequence = semantic && typeof semantic === "object" && "kind" in semantic && semantic.kind === "werewolf_action" && "eventSequence" in semantic
      ? semantic.eventSequence : call.sequence;
    if (typeof sequence !== "number" || sequence > throughEventSequence || !call.delivery) continue;
    const delivery = await readJson(call.delivery);
    for (const line of lines.filter(line => (line.annotationSequence ?? line.eventSequence) === sequence && line.speakerId === call.actorId)) {
      const fields = delivery.fields.filter(field => field.delivery.cleanText === line.text && field.delivery.context === line.context);
      if (fields.length > 1 && new Set(fields.map(field => field.delivery.synthesisText)).size > 1) throw new Error("Ambiguous accepted audio annotations");
      if (fields[0]) line.synthesisText = fields[0].delivery.synthesisText;
    }
  }
  return { version: 1, gameId, throughEventSequence, lines };
}
