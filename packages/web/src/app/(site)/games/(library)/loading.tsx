import { GameLibraryShell, GameLibrarySkeleton } from "@/app/games/game-library-loading";

export default function LoadingGames() {
  return <GameLibraryShell><GameLibrarySkeleton toolbar /></GameLibraryShell>;
}
