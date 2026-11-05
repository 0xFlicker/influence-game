import {sceneSpeechDurationMs} from "./scene-speech-timing";

export const PORTRAIT_ROOM_PAGE_SIZE = 3;
export const PORTRAIT_ROOM_PAGE_HOLD_MS = 3500;

/** Keep the speaker visible while rotating through the other attendees. */
export function portraitRoomPageCount(count: number): number {
  return count > 4 ? Math.ceil((count - 1) / PORTRAIT_ROOM_PAGE_SIZE) : 1;
}

export function portraitRoomDurationMs(text: string, count: number): number {
  return Math.max(sceneSpeechDurationMs(text), portraitRoomPageCount(count) * PORTRAIT_ROOM_PAGE_HOLD_MS + 1050);
}

export function portraitRoomPage(elapsedMs: number, durationMs: number, count: number): number {
  const pages = portraitRoomPageCount(count);
  return Math.min(pages - 1, Math.max(0, Math.floor(Math.max(0, elapsedMs - 650) / Math.max(1, durationMs - 1050) * pages)));
}
