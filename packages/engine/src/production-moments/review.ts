import {decodeProductionSelection,type ProductionRecipe,type ProductionAudience} from "./index";
import {stableProductionJson} from "./export";
export interface ProductionReview {
  version:1; audience:ProductionAudience; thinking:boolean; recipe:ProductionRecipe; music:boolean; volume:number; fingerprint:string;
}
/** Bounded navigation intent only. This never grants access or acknowledges review. */
export function decodeProductionReview(value:string):ProductionReview {
  if (value.length > 4096) throw new Error("Review link is too large. Request a new cut preview.");
  let input:unknown;
  try {input=JSON.parse(value);} catch {throw new Error("Invalid review link. Request a new cut preview.");}
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid review link");
  const v=input as Record<string,unknown>;
  if (Object.keys(v).sort().join() !== "audience,fingerprint,music,recipe,thinking,version,volume" || v.version !== 1 || !["public","mystery","omniscient"].includes(String(v.audience)) || typeof v.thinking !== "boolean" || v.audience === "mystery" && v.thinking || typeof v.music !== "boolean" || typeof v.volume !== "number" || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1 || typeof v.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v.fingerprint)) throw new Error("Invalid review link. Request a new cut preview.");
  const recipe=decodeProductionSelection(v.recipe);
  if (recipe.mode !== "recipe" || recipe.thinking !== v.thinking) throw new Error("Review recipe does not match its thinking setting");
  return {version:1,audience:v.audience as ProductionAudience,thinking:v.thinking,recipe,music:v.music,volume:v.volume,fingerprint:v.fingerprint};
}
export function productionReviewPath(gameId:string,review:ProductionReview):string {
  const value=stableProductionJson(review);decodeProductionReview(value);
  const query=new URLSearchParams({audience:review.audience,thinking:review.thinking ? "on":"off",view:"cut",review:value});
  return `/admin/production/games/${encodeURIComponent(gameId)}?${query}`;
}
