import {expect,test} from "bun:test";
import {decodeProductionReview,productionReviewPath,type ProductionReview} from "./review";
const review:ProductionReview={version:1,audience:"omniscient",thinking:true,recipe:{mode:"recipe",thinking:true,base:"full",policies:{thinking:{mode:"any",labels:["smart"]},speech:{mode:"all"}}},music:true,volume:.3,fingerprint:`sha256:${"a".repeat(64)}`};
test("review links round-trip exact intent without source payloads",()=>{const url=new URL(productionReviewPath("game",review),"http://localhost");expect(url.searchParams.get("view")).toBe("cut");expect(decodeProductionReview(url.searchParams.get("review")!)).toEqual(review);});
test("bad review links fail explicitly instead of choosing a default cut",()=>{
 for(const raw of ["{","x".repeat(4097),JSON.stringify({...review,unknown:true}),JSON.stringify({...review,audience:"mystery"}),JSON.stringify({...review,volume:2}),JSON.stringify({...review,thinking:false}),JSON.stringify({...review,recipe:{...review.recipe,policies:{thinking:{mode:"any",labels:["unknown"]}}}})])expect(()=>decodeProductionReview(raw)).toThrow();
});
