import {eq,or} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
import {buildInfluenceProductionSourceSnapshot,decodeInfluenceProductionSnapshot} from "./influence-production-source.js";
import {buildWerewolfProductionSourceSnapshot,decodeWerewolfProductionSnapshot} from "./werewolf-production-source.js";
import {WerewolfGameError} from "./werewolf-games.js";
import type {VisualTransaction} from "./visual-execution-boundary.js";
export class ProductionEditorialInputError extends Error {}
export function productionOptions(body:Record<string,unknown>):{audience:"public"|"mystery"|"omniscient";thinking:boolean} {
  const {audience,thinking}=body;
  if (!["public","mystery","omniscient"].includes(String(audience)) || typeof thinking !== "boolean" || audience === "mystery" && thinking) throw new ProductionEditorialInputError("Choose a valid audience and explicit thinking option; Mystery cannot include thinking");
  return {audience:audience as "public"|"mystery"|"omniscient",thinking};
}
export async function productionGame(db:Pick<DrizzleDB,"select">,id:string) {
  const [game]=await db.select({id:schema.games.id,gameKind:schema.games.gameKind}).from(schema.games).where(or(eq(schema.games.id,id),eq(schema.games.slug,id)));
  if (!game) throw new WerewolfGameError("Production game not found",404);
  return game;
}
export async function completeProductionSource(tx:VisualTransaction,id:string,body:Record<string,unknown>) {
  const game = await productionGame(tx,id), access = productionOptions(body);
  if (game.gameKind === "werewolf") {
    if (access.audience === "public") throw new ProductionEditorialInputError("Werewolf requires Mystery or Omniscient audience");
    return buildWerewolfProductionSourceSnapshot(tx,game.id,{audience:access.audience,thinking:access.thinking,
      snapshot:body.snapshot === undefined ? undefined : decodeWerewolfProductionSnapshot(body.snapshot)});
  }
  if (access.audience !== "public") throw new ProductionEditorialInputError("Influence uses its public audience");
  return buildInfluenceProductionSourceSnapshot(tx,game.id,{snapshot:body.snapshot === undefined ? undefined : decodeInfluenceProductionSnapshot(body.snapshot)});
}
export type EditorialSource = Awaited<ReturnType<typeof completeProductionSource>>;
