import Link from "next/link";
import { Nav } from "@/components/nav";
import { AdminGate } from "@/components/admin-gate";
import { GameHistoryBrowser } from "./game-history-browser";

export const metadata = {
  title: "Game History — Influence Admin",
};

export default function AdminGamesPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <AdminGate>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Link
                href="/admin"
                className="text-white/40 hover:text-white/70 text-sm transition-colors"
              >
                ← Dashboard
              </Link>
              <span className="text-white/20">/</span>
              <h1 className="text-2xl font-bold text-white">Game History</h1>
            </div>
            <Link
              href="/admin/games/new"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              + New Game
            </Link>
          </div>
          <GameHistoryBrowser />
        </AdminGate>
      </main>
    </div>
  );
}
