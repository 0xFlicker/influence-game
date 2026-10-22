/** Stable cue identity plus local time avoids drift when earlier thoughts load lazily. */
export interface ReplayShareState {
  cue?: string;
  time: number;
  speed: number;
  thinking: boolean;
  musicMuted: boolean;
  musicVolume: number;
}
export const REPLAY_SHARE_KEYS = ["cue", "t", "speed", "thinking", "muted", "volume"] as const;
export function parseReplayShare(search: URLSearchParams): ReplayShareState | undefined {
  if (!REPLAY_SHARE_KEYS.some(key => search.has(key))) return undefined;
  for (const key of REPLAY_SHARE_KEYS) if (search.getAll(key).length > 1) throw new Error("Invalid replay link: repeated playback setting.");
  const number = (key: string, fallback: number, max: number) => {
    const value = search.get(key);
    if (value === null) return fallback;
    if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > max) throw new Error(`Invalid replay ${key}.`);
    return Number(value);
  };
  const bool = (key: string, fallback: boolean) => {
    const value = search.get(key);
    if (value === null) return fallback;
    if (value !== "0" && value !== "1") throw new Error(`Invalid replay ${key}.`);
    return value === "1";
  };
  const cue = search.get("cue") ?? undefined;
  if (cue !== undefined && (!cue || cue.length > 512 || /[\x00-\x1f]/.test(cue))) throw new Error("Invalid replay cue.");
  const speed = number("speed", 1, 4);
  if (![0.5, 1, 2, 4].includes(speed)) throw new Error("Invalid replay speed.");
  return {cue, time:number("t", 0, Number.MAX_SAFE_INTEGER / 1000), speed, thinking:bool("thinking", false), musicMuted:bool("muted", true), musicVolume:number("volume", 0.3, 1)};
}
