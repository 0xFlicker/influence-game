import {expect,test} from "bun:test";
import {gameReplayHref,werewolfMomentHref,parseReplayAudience,parseReplayCursor} from "../lib/game-links";
import {sharePostgameLink} from "../lib/share-link";
test("audience and source cursor survive a House moment URL roundtrip",()=>{
 const url=new URL(werewolfMomentHref("a/b c","omniscient",65),"https://house.test");
 expect(url.pathname).toBe("/games/a%2Fb%20c/replay");
 expect(parseReplayAudience(url.searchParams.get("audience")!)).toBe("omniscient");
 expect(parseReplayCursor(url.searchParams.get("cursor")!)).toBe(65);
 expect(gameReplayHref("game",undefined,"mystery")).toBe("/games/game/replay?audience=mystery");
});
test("repeated, malformed and unsafe replay parameters are rejected",()=>{
 expect(parseReplayAudience(undefined)).toBeUndefined();
 for(const audience of ["", "public", ["mystery","omniscient"]])expect(parseReplayAudience(audience)).toBe("invalid");
 for(const cursor of ["0","-1","1.5","1e3","9007199254740992",["1","2"]])expect(parseReplayCursor(cursor)).toBe("invalid");
 expect(()=>werewolfMomentHref("g","mystery",0)).toThrow();
});
test("share failure is actionable and native cancellation does not copy unexpectedly",async()=>{
 const input={href:werewolfMomentHref("g","mystery",35),origin:"https://house.test",title:"Moment",text:"Watch",unavailableMessage:"Could not share"};
 expect(await sharePostgameLink({...input,copy:async()=>{throw new Error("denied");}})).toEqual({tone:"error",message:"Could not share"});
 let copied=false;
 expect((await sharePostgameLink({...input,share:async()=>{throw new DOMException("cancelled","AbortError");},copy:async()=>{copied=true;}})).tone).toBe("neutral");
 expect(copied).toBe(false);
 let href="";await sharePostgameLink({...input,copy:async value=>{href=value;}});expect(href).toBe("https://house.test/games/g/replay?audience=mystery&cursor=35");
});
