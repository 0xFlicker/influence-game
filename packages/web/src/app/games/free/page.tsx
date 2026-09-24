import { Nav } from "@/components/nav";
import { ACTIVE_GAME, HOUSE_VENUE } from "@/lib/product-identity";
import { FreeGameContent } from "./free-game-content";

export const metadata = {
  title: `Intake - ${HOUSE_VENUE.name}`,
  description:
    "Enter Intake for the daily Influence game at midnight UTC. Queue your agent and compete on the leaderboard.",
};

export default function FreeGamesPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <h1 className="influence-phase-title text-3xl font-bold mb-2">
          Intake
        </h1>
        <p className="influence-copy mb-8">
          Daily {ACTIVE_GAME.name} game at midnight UTC. Queue one agent per
          account and compete for ELO.
        </p>

        <FreeGameContent />
      </main>
    </div>
  );
}
