import {expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {decodeProductionExport, stableProductionJson, type ProductionExportDescriptor} from "./export";

test("frozen full, tagged, IDs and recipe descriptors retain the exact hashed payload", () => {
  const selections: ProductionExportDescriptor["selection"][] = [
    {mode:"full",thinking:true},
    {mode:"tagged",thinking:true,predicate:{tone:"sharp",cut:"youtube"},includeOpening:false,includeResult:true},
    {mode:"ids",thinking:true,ids:["moment-B","moment-A"]},
    {mode:"recipe",thinking:true,base:"full",policies:{speech:{mode:"none"},thinking:{mode:"any",labels:["fourth_wall","smart"]}}},
  ];
  for (const selection of selections) {
    const payload: Omit<ProductionExportDescriptor,"hash"> = {
      schema:"house.production-selection",version:1,gameId:"frozen-game",gameKind:"influence",audience:"public",
      sourceSnapshot:{throughEventSequence:42,publicationCutoff:"2026-10-09T12:00:00Z",sourceHash:"source-pin"},
      momentIds:["moment-A","moment-B"],selection,
      settings:{width:640,height:360,fps:30,reducedMotion:false,music:true,volume:.5,profile:{ending:"finish-score",overrides:{}}},
      copy:{title:"Frozen copy"},recordings:[],annotations:[{momentId:"moment-A",tags:{"label.smart":"true",cut:"youtube"},revision:2},{momentId:"moment-B",tags:{},revision:0}],
    };
    const hash = `sha256:${createHash("sha256").update(stableProductionJson(payload)).digest("hex")}`;
    const {hash: decodedHash,...decoded} = decodeProductionExport(JSON.parse(JSON.stringify({...payload,hash})));
    expect(decodedHash).toBe(hash);
    expect(stableProductionJson(decoded)).toBe(stableProductionJson(payload));
    expect(`sha256:${createHash("sha256").update(stableProductionJson(decoded)).digest("hex")}`).toBe(hash);
  }
});
