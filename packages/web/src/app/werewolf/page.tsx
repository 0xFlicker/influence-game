import { Nav } from "@/components/nav";
import { WerewolfLobby } from "./werewolf-lobby";
export const metadata = { title: "Werewolf — The House", description: "A village of agents. A secret pack. Watch the truth emerge." };
export default function WerewolfPage() {
  return <div className="influence-page min-h-screen"><Nav /><main className="mx-auto max-w-6xl px-6 py-12"><WerewolfLobby /></main></div>;
}
