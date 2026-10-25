/** Frozen xAI stock catalog from the October 24, 2026 audition.
 * Never derive saved identity from the ordering of a live provider response.
 * Provider gender labels describe voices, not inferred character identities.
 */
export const VOICE_CATALOG_VERSION = "xai-stock-2026-10-24";
export const VOICE_ASSIGNMENT_VERSION = 1;
export const STOCK_VOICES = Object.freeze([
  Object.freeze({ id: "altair", name: "Altair", gender: "male" } as const),
  Object.freeze({ id: "ara", name: "Ara", gender: "female" } as const),
  Object.freeze({ id: "atlas", name: "Atlas", gender: "male" } as const),
  Object.freeze({ id: "aurora", name: "Aurora", gender: "female" } as const),
  Object.freeze({ id: "carina", name: "Carina", gender: "female" } as const),
  Object.freeze({ id: "castor", name: "Castor", gender: "male" } as const),
  Object.freeze({ id: "celeste", name: "Celeste", gender: "female" } as const),
  Object.freeze({ id: "cosmo", name: "Cosmo", gender: "male" } as const),
  Object.freeze({ id: "eve", name: "Eve", gender: "female" } as const),
  Object.freeze({ id: "helios", name: "Helios", gender: "male" } as const),
  Object.freeze({ id: "helix", name: "Helix", gender: "male" } as const),
  Object.freeze({ id: "iris", name: "Iris", gender: "female" } as const),
  Object.freeze({ id: "kepler", name: "Kepler", gender: "male" } as const),
  Object.freeze({ id: "leo", name: "Leo", gender: "male" } as const),
  Object.freeze({ id: "liora", name: "Liora", gender: "female" } as const),
  Object.freeze({ id: "lumen", name: "Lumen", gender: "male" } as const),
  Object.freeze({ id: "luna", name: "Luna", gender: "female" } as const),
  Object.freeze({ id: "lux", name: "Lux", gender: "male" } as const),
  Object.freeze({ id: "naksh", name: "Naksh", gender: "male" } as const),
  Object.freeze({ id: "orion", name: "Orion", gender: "male" } as const),
  Object.freeze({ id: "perseus", name: "Perseus", gender: "male" } as const),
  Object.freeze({ id: "rex", name: "Rex", gender: "male" } as const),
  Object.freeze({ id: "rigel", name: "Rigel", gender: "male" } as const),
  Object.freeze({ id: "sal", name: "Sal", gender: "male" } as const),
  Object.freeze({ id: "sirius", name: "Sirius", gender: "male" } as const),
  Object.freeze({ id: "ursa", name: "Ursa", gender: "female" } as const),
  Object.freeze({ id: "zagan", name: "Zagan", gender: "male" } as const),
  Object.freeze({ id: "zenith", name: "Zenith", gender: "male" } as const),
 ] as const);
export type StockVoiceId = typeof STOCK_VOICES[number]["id"];
export type PlayerVoiceId = Exclude<StockVoiceId, "helios">;
export type VoiceGender = "male" | "female" | "non-binary" | null;
export const HOUSE_VOICE_ID = "helios";
export const PLAYER_VOICES = Object.freeze(STOCK_VOICES.filter(
  (voice): voice is Exclude<typeof STOCK_VOICES[number], { id: "helios" }> => voice.id !== HOUSE_VOICE_ID,
));

export interface VoiceAssignment {
  readonly provider: "xai";
  readonly voiceId: StockVoiceId;
  readonly catalogVersion: typeof VOICE_CATALOG_VERSION;
  readonly assignmentVersion: typeof VOICE_ASSIGNMENT_VERSION;
  readonly seedIdentity: string;
  readonly origin: "automatic" | "selected" | "house";
}
export function isPlayerVoiceId(value: unknown): value is PlayerVoiceId {
  return typeof value === "string" && PLAYER_VOICES.some(voice => voice.id === value);
}

/** FNV-1a over UTF-16 code units, matching the engine's established seed convention.
 * Identity distribution only; this is not a security or content-integrity hash.
 */
function voiceSeed(identity: string): number {
  let hash = 0x811c9dc5;
  for (const char of `agent-voice:${VOICE_ASSIGNMENT_VERSION}:${identity}`.split("")) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return hash >>> 0;
}

/** Resolve only when assigning/resetting or freezing a missing choice. Persist
 * the returned record; existing assignments must never be recomputed on reads.
 * Manual choices may cross gender labels. No names or portraits are inspected.
 */
export function assignPlayerVoice(identity: string, gender: VoiceGender, selected?: unknown): VoiceAssignment {
  if (!identity.trim()) throw new Error("A stable character identity is required for voice assignment");
  if (selected !== undefined && !isPlayerVoiceId(selected)) throw new Error("Choose an eligible player stock voice; Helios is reserved for the House");
  const matched = gender === "male" || gender === "female" ? PLAYER_VOICES.filter(voice => voice.gender === gender) : PLAYER_VOICES;
  const pool = matched.length ? matched : PLAYER_VOICES;
  const voiceId = isPlayerVoiceId(selected) ? selected : pool[voiceSeed(identity) % pool.length]!.id;
  return Object.freeze({ provider: "xai", voiceId, catalogVersion: VOICE_CATALOG_VERSION,
    assignmentVersion: VOICE_ASSIGNMENT_VERSION, seedIdentity: identity, origin: selected === undefined ? "automatic" : "selected" });
}
export const HOUSE_VOICE: VoiceAssignment = Object.freeze({ provider: "xai", voiceId: HOUSE_VOICE_ID,
  catalogVersion: VOICE_CATALOG_VERSION, assignmentVersion: VOICE_ASSIGNMENT_VERSION, seedIdentity: "house:global", origin: "house" });
