import {and,eq,inArray,sql} from "drizzle-orm";
import {resolveProductionMomentIds,selectProductionMoments,validateProductionTags,
  type ProductionCatalog,type ProductionSelection,type ProductionTags} from "@influence/engine/production-moments";
import {schema,type DrizzleDB} from "../db/index.js";

export interface MomentAnnotation {momentId: string; tags: ProductionTags; revision: number}
export class AnnotationConflict extends Error {
  constructor(readonly current: MomentAnnotation) {super("Moment tags changed. Compare your draft with the saved tags before retrying.");}
}
export function decodeAnnotationReplacement(value: unknown): {expectedRevision:number;tags:ProductionTags} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Annotation replacement must be an object");
  const body = value as Record<string,unknown>;
  if (Object.keys(body).sort().join() !== "expectedRevision,tags" || !Number.isSafeInteger(body.expectedRevision)
    || Number(body.expectedRevision) < 0 || Number(body.expectedRevision) >= 2147483647)
    throw new Error("Annotation replacement requires a valid expectedRevision and tags");
  return {expectedRevision:Number(body.expectedRevision),tags:validateProductionTags(body.tags)};
}

/** Callers supply the current authorized catalog, never trust a decoded client key. */
export async function replaceMomentAnnotation(db: Pick<DrizzleDB,"select"|"insert"|"update">, catalog: ProductionCatalog, momentId: string,
  actorId: string, replacement: unknown): Promise<MomentAnnotation> {
  resolveProductionMomentIds(catalog,[momentId]);
  const input = decodeAnnotationReplacement(replacement);
  const table = schema.productionMomentAnnotations;
  const changes = {tags:{...input.tags},updatedById:actorId,updatedAt:new Date()};
  const [written] = input.expectedRevision === 0
    ? await db.insert(table).values({...changes,gameId:catalog.gameId,momentKey:momentId,revision:1})
      .onConflictDoNothing().returning()
    : await db.update(table).set({...changes,revision:sql`${table.revision} + 1`})
      .where(and(eq(table.gameId,catalog.gameId),eq(table.momentKey,momentId),eq(table.revision,input.expectedRevision))).returning();
  if (written) return {momentId,tags:written.tags,revision:written.revision};
  const [current] = await db.select().from(table).where(and(eq(table.gameId,catalog.gameId),eq(table.momentKey,momentId)));
  throw new AnnotationConflict({momentId,tags:current?.tags ?? {},revision:current?.revision ?? 0});
}

/** One SQL read is a consistent tag snapshot; unauthorized keys never leave it. */
export async function readMomentAnnotations(db: Pick<DrizzleDB,"select">, catalog: ProductionCatalog): Promise<MomentAnnotation[]> {
  const available = new Set(catalog.moments.map(moment => moment.id));
  if (!available.size) return [];
  const table = schema.productionMomentAnnotations;
  const rows = await db.select().from(table).where(and(eq(table.gameId,catalog.gameId),inArray(table.momentKey,[...available])))
    .limit(available.size);
  return rows.filter(row => available.has(row.momentKey)).map(row => ({momentId:row.momentKey,tags:row.tags,revision:row.revision}));
}

/** The resolved snapshot records exact IDs. Later predicate edits cannot change it. */
export async function resolveAnnotatedSelection(db: Pick<DrizzleDB,"select">, catalog: ProductionCatalog,
  selection: ProductionSelection) {
  const annotations = await readMomentAnnotations(db,catalog);
  const tags = Object.fromEntries(annotations.map(row => [row.momentId,row.tags]));
  const moments = selectProductionMoments(catalog,selection,tags);
  const byId = new Map(annotations.map(row => [row.momentId,row]));
  return {momentIds:moments.map(moment => moment.id),
    annotations:moments.map(moment => byId.get(moment.id) ?? {momentId:moment.id,tags:{},revision:0})};
}
