import {EmbedRoute} from "../embed-route";
import type {ReplaySearch} from "@/lib/player-card";
export default async function Page({params,searchParams}: {params:Promise<{slug:string;sequence:string}>;searchParams:Promise<ReplaySearch>}) {
  return <EmbedRoute {...await params} search={await searchParams} />;
}
