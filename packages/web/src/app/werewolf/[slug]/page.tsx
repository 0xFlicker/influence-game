import { WerewolfEntry } from "../werewolf-entry";
export const metadata = { title: "Werewolf — The House", description: "Join the cast or choose how to watch this village." };
export default async function WerewolfGamePage({params, searchParams}: {params: Promise<{slug: string}>; searchParams: Promise<{audience?: string}>}) {
  const {slug} = await params;
  const {audience} = await searchParams;
  return <WerewolfEntry key={slug} slug={slug} audience={audience === "mystery" || audience === "omniscient" ? audience : undefined} />;
}
