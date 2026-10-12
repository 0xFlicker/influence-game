export interface TimingAdjustments {
  readingRate?:number;thinkingRate?:number;conversationGapMs?:number;ballotHoldMs?:number;
  tallyHoldMs?:number;establishingHoldMs?:number;motionScale?:number;postSpeechHoldMs?:number;
}
export interface TimingProfile extends TimingAdjustments {
  ending:"finish-score"|{holdMs:number};overrides:Record<string,TimingAdjustments>;
}
function record(value:unknown,label:string):Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string,unknown>;
}
const adjustmentKeys = ["readingRate","thinkingRate","conversationGapMs","ballotHoldMs","tallyHoldMs","establishingHoldMs","motionScale","postSpeechHoldMs"];
function adjustments(value:unknown):TimingAdjustments {
  const input = record(value,"Timing adjustments");
  for (const [key,amount] of Object.entries(input)) {
    if (!adjustmentKeys.includes(key)) throw new Error(`Unknown timing field: ${key}`);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || ((key.endsWith("Rate") || key === "motionScale") && amount === 0))
      throw new Error(`Invalid timing value: ${key}`);
  }
  return input as TimingAdjustments;
}
/** Shared strict presentation settings for producer requests and both hosts. */
export function parseTimingProfile(value:unknown = {}):TimingProfile {
  const input = {...record(value,"Timing profile")};
  const ending = input.ending ?? "finish-score";
  const overrides = record(input.overrides ?? {},"Cue overrides");
  delete input.ending;delete input.overrides;
  if (ending !== "finish-score") {
    const fixed = record(ending,"Ending");
    if (Object.keys(fixed).length !== 1 || typeof fixed.holdMs !== "number" || !Number.isFinite(fixed.holdMs) || fixed.holdMs < 0)
      throw new Error("Ending requires a nonnegative holdMs");
  }
  if (Object.keys(overrides).length > 50000) throw new Error("Too many timing overrides");
  return {...adjustments(input),ending:ending as TimingProfile["ending"],
    overrides:Object.fromEntries(Object.entries(overrides).map(([key,value]) => [key,adjustments(value)]))};
}
export interface ProductionPresentationSettings {
  width:number;height:number;fps:number;reducedMotion:boolean;music:boolean;volume:number;profile:TimingProfile;
}
export function decodeProductionSettings(value:unknown):ProductionPresentationSettings {
  const input = record(value,"Presentation settings");
  if (Object.keys(input).sort().join() !== "fps,height,music,profile,reducedMotion,volume,width") throw new Error("Presentation settings require exact geometry, motion, music, volume and profile fields");
  if (![input.width,input.height].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 128 && n <= 7680 && n%2 === 0)
    || typeof input.fps !== "number" || !Number.isSafeInteger(input.fps) || input.fps < 1 || input.fps > 120
    || typeof input.reducedMotion !== "boolean" || typeof input.music !== "boolean"
    || typeof input.volume !== "number" || !Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1) throw new Error("Invalid presentation geometry or playback settings");
  return {width:input.width as number,height:input.height as number,fps:input.fps,
    reducedMotion:input.reducedMotion,music:input.music,volume:input.volume,profile:parseTimingProfile(input.profile)};
}
