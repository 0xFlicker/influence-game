import Link from "next/link";
import { Nav } from "@/components/nav";
import { PermissionPageGate } from "@/components/permission-page-gate";
import { CreateGameForm } from "@/app/admin/games/new/create-game-form";

export const metadata = {
  title: "Create Game — Influence",
};

export default function NewGamePage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <PermissionPageGate
          permission="create_game"
          deniedMessage="You need game-creation access to create a new match."
          unauthenticatedMessage="Sign in to create a new game."
        >
          <div className="flex items-center gap-3 mb-8">
            <Link
              href="/games"
              className="influence-copy-muted hover:text-text-primary text-sm transition-colors"
            >
              ← Games
            </Link>
            <span className="influence-copy-muted text-xs">/</span>
            <h1 className="text-2xl font-bold text-text-primary">Create New Game</h1>
          </div>
          <CreateGameForm />
        </PermissionPageGate>
      </main>
    </div>
  );
}
