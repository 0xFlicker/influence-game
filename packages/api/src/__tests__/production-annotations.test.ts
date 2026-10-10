import {beforeEach,expect,test} from "bun:test";
import {assembleProductionCatalog,resolveProductionMomentIds} from "@influence/engine/production-moments";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {AnnotationConflict,replaceMomentAnnotation,readMomentAnnotations,resolveAnnotatedSelection} from "../services/production-annotations.js";

let db: DrizzleDB;
const catalog = assembleProductionCatalog({gameId:"annotated",gameKind:"influence",audience:"public",
  sources:[{kind:"influence-transcript",transcriptId:"42",presentation:"speech",actorId:"actor",thinking:"Private thought",
    defaultThinking:true,order:{anchor:1,offset:0}}]});
const thought = catalog.moments[0]!.id, speech = catalog.moments[1]!.id;
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values({id:"operator"});
  await db.insert(schema.games).values({id:"annotated",slug:"annotated",config:"{}"});
});
test("simultaneous inserts and updates accept exactly one revision",async () => {
  const inserts = await Promise.allSettled(["first","second"].map(value => replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:0,tags:{cut:value}})));
  expect(inserts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(inserts.filter(result => result.status === "rejected")).toHaveLength(1);
  const updates = await Promise.allSettled(["third","fourth"].map(value => replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:1,tags:{cut:value}})));
  expect(updates.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const conflict = updates.find(result => result.status === "rejected");
  expect(conflict?.status === "rejected" && conflict.reason instanceof AnnotationConflict).toBe(true);
  expect((await readMomentAnnotations(db,catalog))[0]!.revision).toBe(2);
});
test("empty maps retain revision; lost responses reconcile by reading saved state",async () => {
  await replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:0,tags:{cut:"youtube"}});
  await replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:1,tags:{}});
  await expect(replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:0,tags:{cut:"stale"}})).rejects.toBeInstanceOf(AnnotationConflict);
  expect(await readMomentAnnotations(db,catalog)).toEqual([{momentId:thought,tags:{},revision:2}]);
  await replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:2,tags:{cut:"youtube"}});
  await expect(replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:2,tags:{cut:"youtube"}})).rejects.toBeInstanceOf(AnnotationConflict);
  expect((await readMomentAnnotations(db,catalog))[0]!.revision).toBe(3);
});
test("nonzero revision cannot create an absent row; malformed or unauthorized keys do not write",async () => {
  await expect(replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:1,tags:{cut:"x"}})).rejects.toBeInstanceOf(AnnotationConflict);
  for (const body of [{expectedRevision:0,tags:{cut:""}},{expectedRevision:0,tags:{cut:"x"},extra:true},{expectedRevision:0,tags:["x"]}])
    await expect(replaceMomentAnnotation(db,catalog,thought,"operator",body)).rejects.toThrow();
  await expect(replaceMomentAnnotation(db,catalog,"handcrafted-private-key","operator",{expectedRevision:0,tags:{cut:"x"}})).rejects.toThrow("Unavailable");
  expect(await readMomentAnnotations(db,catalog)).toEqual([]);
});
test("tagged selections freeze independent exact IDs and survive later predicate edits",async () => {
  await replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:0,tags:{cut:"youtube",channel:"A"}});
  await replaceMomentAnnotation(db,catalog,speech,"operator",{expectedRevision:0,tags:{cut:"other"}});
  const selection = await resolveAnnotatedSelection(db,catalog,{mode:"tagged",thinking:true,predicate:{cut:"youtube",channel:"A"}});
  expect(selection.momentIds).toEqual([thought]);
  await replaceMomentAnnotation(db,catalog,thought,"operator",{expectedRevision:1,tags:{cut:"changed"}});
  expect(resolveProductionMomentIds(catalog,selection.momentIds).map(moment => moment.id)).toEqual([thought]);
  const current = await resolveAnnotatedSelection(db,catalog,{mode:"tagged",thinking:true,predicate:{cut:"youtube",channel:"A"}});
  expect(current.momentIds).toEqual([]);
  expect(selection.annotations).toEqual([{momentId:thought,tags:{cut:"youtube",channel:"A"},revision:1}]);
  const hiddenThought = await resolveAnnotatedSelection(db,catalog,{mode:"tagged",thinking:false,predicate:{cut:"changed"}});
  expect(hiddenThought.momentIds).toEqual([]);
});
