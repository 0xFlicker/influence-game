import type {ProductionMomentPart, ProductionSourceReference} from './production-moments';

/** A knowledge position, independent of layout, text pagination and thinking UI.
 * Game adapters resolve these accepted source coordinates before reading context. */
export type GameFollowPosition =
  | {kind:'influence';source:ProductionSourceReference;part:ProductionMomentPart}
  | {kind:'werewolf';audience:'mystery'|'omniscient';cursor:number;part:ProductionMomentPart};
export type FollowJson = null | boolean | number | string | FollowJson[] | {[key:string]:FollowJson};
export interface GameFollowKnowledge {
  schemaVersion:1;
  game:{id:string;slug:string;kind:'influence'|'werewolf'};
  position:GameFollowPosition;
  visibility:'mystery'|'omniscient';
  rules:FollowJson;
  roster:FollowJson[];
  state:FollowJson;
  current:FollowJson;
  history:FollowJson[];
  thinking:FollowJson[];
}
/** Every game implements the same temporal and audience contract. A new game
 * cannot silently fall back to a latest-state or renderer-derived response. */
export interface GameFollowAdapter<P extends GameFollowPosition = GameFollowPosition> {
  read(position:P):Promise<GameFollowKnowledge>;
}
export function followVisibility(position:GameFollowPosition) {
  return position.kind==='werewolf' && position.audience==='mystery' ? 'mystery' as const : 'omniscient' as const;
}
/** JSON transport validation does not reinterpret model prose as decisions. */
export function followJson(value:unknown):FollowJson {
  if(value===null || typeof value==='string' || typeof value==='boolean')return value;
  if(typeof value==='number' && Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(followJson);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,followJson(v)]));
  throw new Error('Invalid game context value');
}
