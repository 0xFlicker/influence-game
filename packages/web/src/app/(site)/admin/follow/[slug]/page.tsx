import {HouseGameRoute} from '@/app/games/[slug]/house-route';
import {OperatorFollow} from '@/app/admin/follow/operator-follow';
import {parseReplayAudience,parseReplayCursor,parseReplaySequenceParam} from '@/lib/game-links';
import {notFound} from 'next/navigation';

export default async function FollowPlayer({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {slug}=await params,query=await searchParams;
  const audience=parseReplayAudience(query.audience),cursor=parseReplayCursor(query.cursor);
  const sequence=typeof query.sequence==='string'?parseReplaySequenceParam(query.sequence):undefined;
  if(audience==='invalid'||cursor==='invalid'||query.sequence!==undefined&&sequence===undefined)notFound();
  return <OperatorFollow><HouseGameRoute slug={slug} mode="replay" audience={audience??'mystery'} cursor={query.cursor} startSequence={sequence}/></OperatorFollow>;
}
