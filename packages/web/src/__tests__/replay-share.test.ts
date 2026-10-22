import {expect,test} from "bun:test";
import {parseReplayShare,replayShareHref} from "../lib/replay-share";
import {playerCardMetadata,playerSearch,type PlayerCardGame} from "../lib/player-card";
const preferences = {thinking:true,musicMuted:false,musicVolume:0.67};
test("shares exact cue-local time and playback settings without changing the canonical route", () => {
 const href = replayShareHref("/games/village/replay?audience=omniscient&cursor=73","game:omniscient:73:ballot:2",1234.56,2,preferences);
 const url = new URL(href,"https://thehouse.game");
 expect(url.pathname).toBe("/games/village/replay");expect(url.searchParams.get("cursor")).toBe("73");expect(url.searchParams.get("audience")).toBe("omniscient");
 expect(parseReplayShare(url.searchParams)).toEqual({cue:"game:omniscient:73:ballot:2",time:1.235,speed:2,...preferences});
});
test("a bare replay has no position and invalid settings fail visibly", () => {
 expect(parseReplayShare(new URLSearchParams())).toBeUndefined();
 for (const query of ["t=-1","t=NaN","speed=3","thinking=yes","volume=1.01","muted=0&muted=1","cue=","t=1e100"]) expect(() => parseReplayShare(new URLSearchParams(query))).toThrow();
});
const game:PlayerCardGame = {id:"id",slug:"village",gameKind:"werewolf",status:"completed",visibility:"public",title:"A night in the village",description:"Meet the village.",coverUrl:null};
test("completed player cards preserve settings and audiences and use publicly addressable art", () => {
 const metadata=playerCardMetadata(game,"https://thehouse.game",{audience:"omniscient",cursor:"73",cue:"id:omniscient:73",t:"1.25",speed:"2",thinking:"1",muted:"0",volume:"0.6"});
 expect((metadata.twitter && "card" in metadata.twitter ? metadata.twitter.card : undefined)).toBe("player");
 if (!metadata.twitter || !("card" in metadata.twitter) || metadata.twitter.card !== "player") throw Error("Missing player card");
 expect(metadata.twitter.players).toEqual([{playerUrl:"https://thehouse.game/embed/games/village?cue=id%3Aomniscient%3A73&t=1.25&speed=2&thinking=1&muted=0&volume=0.6&audience=omniscient&cursor=73",streamUrl:"",width:640,height:640}]);
 expect(metadata.openGraph?.images).toEqual(["https://thehouse.game/visual/werewolf/lantern-village.webp"]);
 const miniapp = JSON.parse(String(metadata.other?.["fc:miniapp"]));
 expect(miniapp.button.title).toBe("Watch replay");
 expect(miniapp.button.action.url).toBe("https://thehouse.game/games/village/replay?cue=id%3Aomniscient%3A73&t=1.25&speed=2&thinking=1&muted=0&volume=0.6&audience=omniscient&cursor=73&app=mini");
 expect(playerCardMetadata({...game,visibility:"unlisted"},"https://thehouse.game").robots).toEqual({index:false,follow:false});
});
test("Farcaster Influence moments use the full replay route and only validated settings", () => {
 const metadata = playerCardMetadata({...game,gameKind:"influence"},"https://staging.thehouse.game",{cue:"cue:42",t:"2.5",speed:"0.5",thinking:"0",muted:"1",volume:"0.2",token:"secret",redirect:"https://example.com"},"42");
 const miniapp = JSON.parse(String(metadata.other?.["fc:miniapp"]));
 expect(miniapp.button.action.url).toBe("https://staging.thehouse.game/games/village/replay/42?cue=cue%3A42&t=2.5&speed=0.5&thinking=0&muted=1&volume=0.2&app=mini");
 const bare = JSON.parse(String(playerCardMetadata(game,"https://thehouse.game").other?.["fc:miniapp"]));
 expect(bare.button.action.url).toBe("https://thehouse.game/games/village/replay?audience=mystery&app=mini");
});
test("ineligible and invalid cards do not advertise a player; irrelevant queries are never forwarded", () => {
 expect(JSON.stringify(playerCardMetadata({...game,status:"in_progress"},"https://thehouse.game").twitter)).toContain("summary_large_image");
 expect(JSON.stringify(playerCardMetadata(game,"https://thehouse.game",{},"1").twitter)).toContain("summary_large_image");
 expect(JSON.stringify(playerCardMetadata(game,"https://thehouse.game",{cursor:"4"}).twitter)).toContain("summary_large_image");
 expect(playerSearch({token:"secret",redirect:"https://example.com"},"werewolf")).toBe("?audience=mystery");
 expect(() => playerSearch({audience:"omniscient"},"influence")).toThrow();
});
