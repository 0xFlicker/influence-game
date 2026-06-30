import Link from "next/link";
import { Nav } from "@/components/nav";
import { AdminGate } from "@/components/admin-gate";
import { ACTIVE_GAME, HOUSE_VENUE } from "@/lib/product-identity";
import { CreateGameForm } from "./create-game-form";

export const metadata = {
  title: `Create ${ACTIVE_GAME.name} Game - ${HOUSE_VENUE.name} Admin`,
};

export default function NewGamePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <AdminGate>
          <div className="flex items-center gap-3 mb-8">
            <Link
              href="/admin"
              className="text-white/40 hover:text-white/70 text-sm transition-colors"
            >
              ← Dashboard
            </Link>
            <span className="text-white/20">/</span>
            <h1 className="text-2xl font-bold text-white">
              Create {ACTIVE_GAME.name} Game
            </h1>
          </div>
          <CreateGameForm />
        </AdminGate>
      </main>
    </div>
  );
}
