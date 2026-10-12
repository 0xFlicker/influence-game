import {decodeSpeechAttachments,validateAlignment,type SpeechAttachment} from "@influence/engine/production-moments/recordings";
import type {ExportCue} from "./cues";
export {decodeSpeechAttachments,validateAlignment} from "@influence/engine/production-moments/recordings";
export type {SpeechAlignment,SpeechAttachment,ProductionRecording} from "@influence/engine/production-moments/recordings";

/** Validate ALL imported references before either host opens or caches audio files. */
export async function validateSpeechManifest(value:unknown,permittedSpeech:readonly ExportCue[],hashText:(text:string)=>string|Promise<string>) {
  const entries = decodeSpeechAttachments(value),byMessage = new Map<string,ExportCue[]>();
  for (const cue of permittedSpeech) if (cue.speech) {
    const cues = byMessage.get(cue.speech.messageId) ?? [];cues.push(cue);byMessage.set(cue.speech.messageId,cues);
  }
  const result:{entry:SpeechAttachment;cue:ExportCue}[] = [];
  for (const entry of entries) {
    const matches = byMessage.get(entry.messageId) ?? [];
    if (matches.length !== 1) throw new Error(`Speech message is missing or ambiguous: ${entry.messageId}`);
    const cue = matches[0]!,speech = cue.speech!;
    if (speech.speakerId !== entry.speakerId || await hashText(speech.text) !== entry.textHash) throw new Error(`Speech speaker/text mismatch: ${entry.messageId}`);
    if (entry.alignment) validateAlignment(entry.alignment,speech.text,Number.MAX_SAFE_INTEGER);
    result.push({entry,cue});
  }
  return result;
}
