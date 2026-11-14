import {sceneSpeechDurationMs} from "./scene-speech-timing";

export const PORTRAIT_ROOM_PAGE_SIZE = 3;
export const PORTRAIT_ROOM_PAGE_HOLD_MS = 3500;

/** Guests read their complete name during their own cast page; the speaker stays throughout. */
export function portraitRoomNameProgress(progress: number, page: number, pages: number, speaker: boolean): number {
  return Math.max(0,Math.min(1,speaker ? progress : progress*pages-page));
}

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

export function roomSpeechDurationMs(text:string,count:number,paginateLargeCast:boolean):number {
  return paginateLargeCast && count>4 ? portraitRoomDurationMs(text,count)
    : count>8 ? portraitRoomDurationMs(text,count) : sceneSpeechDurationMs(text);
}
