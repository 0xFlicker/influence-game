import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import "./episodes.css";

export function GameLibraryShell({ children }: { children: ReactNode }) {
  return <div className="game-library-page min-h-screen flex flex-col">
    <Nav />
    <main className="game-library-content">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Every room has a story.</h1>
      <p className="influence-copy mb-8">Find a House game to enter. Find an episode to get lost in.</p>
      {children}
    </main>
  </div>;
}

export function GameLibrarySkeleton({ shelf, grid = false, toolbar = false }: { shelf?: string; grid?: boolean; toolbar?: boolean }) {
  return <section className="episode-shelf" role="status" aria-label={shelf ? `Loading ${shelf} games` : "Loading games"}>
    {toolbar && <div className="episode-library-toolbar" aria-hidden="true">
      <span className="episode-skeleton-bar h-11 w-full sm:flex-1" />
      {[0, 1, 2].map(index => <span key={index} className="episode-skeleton-bar h-11 w-24 flex-1 sm:flex-none" />)}
    </div>}
    {shelf && <div className="episode-shelf-heading"><h2>{shelf}</h2></div>}
    <div className={grid ? "episode-grid" : "episode-rail episode-skeleton-rail"} aria-hidden="true">
      {[0, 1, 2, 3].map(index => <div key={index} className="episode-skeleton">
        <div className="episode-skeleton-artwork" />
        <div className="space-y-3 p-4">
          <div className="episode-skeleton-bar h-5 w-2/3" />
          <div className="episode-skeleton-bar h-3 w-5/6" />
          <div className="episode-skeleton-bar h-10 w-24" />
        </div>
      </div>)}
    </div>
  </section>;
}
