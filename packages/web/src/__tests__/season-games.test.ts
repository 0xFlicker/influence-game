import { expect, test } from "bun:test";
import { featuredSeasonGame, playableSeasonGame, seasonGameLabel, type SeasonGame } from "../app/seasons/season-games";
const game = (id:string,status:SeasonGame['status'],date:string):SeasonGame => ({id,slug:id,status,gameKind:'influence',createdAt:date,startedAt:null,endedAt:null});
test('discovery prefers live, then newest replay, then waiting without mutating the feed',()=>{
 const old=game('old','completed','2026-01-01'),latest=game('latest','completed','2026-01-03'),waiting=game('waiting','waiting','2026-01-04'),live=game('live','in_progress','2026-01-02');
 const feed=[old,waiting,latest,live];expect(featuredSeasonGame(feed)).toBe(live);expect(feed[0]).toBe(old);
 expect(featuredSeasonGame([waiting,old,latest])).toBe(latest);expect(featuredSeasonGame([waiting])).toBe(waiting);expect(featuredSeasonGame([])).toBeUndefined();
});
test('only actual live/completed games offer playback; waiting and interrupted states stay truthful',()=>{
 for(const status of ['waiting','suspended','cancelled'] as const)expect(playableSeasonGame(game(status,status,'2026-01-01'))).toBe(false);
 expect(seasonGameLabel(game('waiting','waiting','2026-01-01'))).toBe('Awaiting start');
 expect(seasonGameLabel(game('suspended','suspended','2026-01-01'))).toBe('Paused');
 expect(playableSeasonGame(game('live','in_progress','2026-01-01'))).toBe(true);
 expect(playableSeasonGame(game('done','completed','2026-01-01'))).toBe(true);
});
