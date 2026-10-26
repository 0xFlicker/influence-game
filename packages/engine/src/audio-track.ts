/** Audience-filtered metadata only. Provider markup and requests stay private. */
export interface PublishedAudioClip {
  momentId: string;
  watch?: import("./audio-watch").AudioWatchCoordinate;
  speakerId: string | null;
  textHash: string;
  versionId: string;
  sha256: string;
  durationMs: number;
  url: string;
}
export interface PublishedAudioTrack {
  id: string;
  clips: PublishedAudioClip[];
}
