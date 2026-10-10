export interface SpeechAlignment {textStart:number;textEnd:number;startMs:number;endMs:number}
export interface SpeechAttachment {
  messageId:string;speakerId:string|null;textHash:string;file:string;alignment?:SpeechAlignment[];
}
/** Local recording evidence. File names, paths and object URLs never enter a frozen cut. */
export interface ProductionRecording {
  momentId:string;messageId:string;speakerId:string|null;textHash:string;sha256:string;durationMs:number;
  alignment?:SpeechAlignment[];
}
const hash = (value:unknown):value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function spans(value:unknown):SpeechAlignment[] {
  if (!Array.isArray(value) || !value.length || value.length > 50000) throw new Error("Speech alignment must contain bounded spans");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid speech alignment span");
    const span = item as SpeechAlignment;
    if (Object.keys(span).sort().join() !== "endMs,startMs,textEnd,textStart" || !Number.isSafeInteger(span.textStart)
      || !Number.isSafeInteger(span.textEnd) || span.textStart < 0 || span.textEnd <= span.textStart
      || !Number.isFinite(span.startMs) || !Number.isFinite(span.endMs) || span.startMs < 0 || span.endMs <= span.startMs)
      throw new Error("Invalid speech alignment span");
    return {...span};
  });
}
export function validateAlignment(value:unknown,text:string,durationMs:number):SpeechAlignment[] {
  const result = spans(value);let lastText = 0,lastTime = 0;
  for (const span of result) {
    if (span.textStart !== lastText || span.textEnd > text.length || span.startMs < lastTime || span.endMs > durationMs)
      throw new Error("Speech alignment must cover text in order within the recording");
    lastText = span.textEnd;lastTime = span.endMs;
  }
  if (lastText !== text.length) throw new Error("Speech alignment does not cover the whole message");
  return result;
}
export function decodeSpeechAttachments(value:unknown):SpeechAttachment[] {
  if (!Array.isArray(value) || value.length > 50000) throw new Error("Speech manifest must be a bounded array");
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid speech attachment");
    const entry = item as SpeechAttachment;
    if (Object.keys(entry).some(key => !["messageId","speakerId","textHash","file","alignment"].includes(key))
      || typeof entry.messageId !== "string" || !entry.messageId || entry.messageId.length > 8192
      || entry.speakerId !== null && (typeof entry.speakerId !== "string" || !entry.speakerId || entry.speakerId.length > 200)
      || !hash(entry.textHash) || typeof entry.file !== "string" || !entry.file || entry.file.length > 2048 || seen.has(entry.messageId))
      throw new Error("Invalid or duplicate speech attachment");
    seen.add(entry.messageId);
    return {...entry,...(entry.alignment !== undefined && {alignment:spans(entry.alignment)})};
  });
}
export function decodeProductionRecordings(value:unknown):ProductionRecording[] {
  if (!Array.isArray(value) || value.length > 50000) throw new Error("Frozen recordings must be a bounded array");
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid frozen recording");
    const entry = item as ProductionRecording;
    if (Object.keys(entry).some(key => !["momentId","messageId","speakerId","textHash","sha256","durationMs","alignment"].includes(key))
      || typeof entry.momentId !== "string" || !entry.momentId || entry.momentId.length > 8192
      || typeof entry.messageId !== "string" || !entry.messageId || entry.messageId.length > 8192
      || entry.speakerId !== null && (typeof entry.speakerId !== "string" || !entry.speakerId || entry.speakerId.length > 200)
      || !hash(entry.textHash) || !hash(entry.sha256) || !Number.isFinite(entry.durationMs) || entry.durationMs <= 0 || entry.durationMs > 86400000
      || seen.has(entry.momentId)) throw new Error("Invalid or duplicate frozen recording");
    seen.add(entry.momentId);
    const alignment = entry.alignment === undefined ? undefined : spans(entry.alignment);
    if (alignment?.some(span => span.endMs > entry.durationMs)) throw new Error("Frozen alignment exceeds recording duration");
    return {...entry,...(alignment && {alignment})};
  });
}
