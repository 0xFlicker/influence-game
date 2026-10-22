import {expect,test} from "bun:test";
import {gameReplayHref,werewolfMomentHref,parseReplayAudience,parseReplayCursor} from "../lib/game-links";
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
