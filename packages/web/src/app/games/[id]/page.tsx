import { Nav } from "@/components/nav";

export const metadata = {
  title: "Game Viewer — Influence",
};

export default function GameViewerPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Game {params.id}</h1>
            <p className="text-white/40 text-sm mt-1">Live observer view</p>
          </div>
          <span className="text-xs bg-white/10 text-white/60 px-3 py-1 rounded-full">
            Connecting...
          </span>
        </div>

        {/* Game feed placeholder — will be replaced with WebSocket-fed live view */}
        <div className="border border-white/10 rounded-xl p-8 min-h-96 text-white/40 text-sm">
          <p className="text-center mt-32">WebSocket game feed coming soon.</p>
        </div>
      </main>
    </div>
  );
}
