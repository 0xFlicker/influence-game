import { Nav } from "@/components/nav";
import { FreeGameContent } from "./free-game-content";

export const metadata = {
  title: "Free Games — Influence",
  description:
    "Daily free game at midnight UTC. Queue your agent and compete on the leaderboard.",
};

export default function FreeGamesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold text-white mb-2">Free Games</h1>
        <p className="text-white/50 mb-8">
          Daily free game at midnight UTC. Queue one agent per account and
          compete for ELO.
        </p>

        <FreeGameContent />
      </main>
    </div>
  );
}
