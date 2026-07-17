import { Nav } from "@/components/nav";

export default function PublicPlayerProfileLoading() {
  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      <Nav />
      <main
        className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
        aria-busy="true"
        aria-label="Loading player profile"
      >
        <div className="space-y-6">
          <div className="influence-panel h-40 animate-pulse rounded-xl" />
          <div className="influence-panel h-64 animate-pulse rounded-xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="influence-panel h-48 animate-pulse rounded-xl" />
            <div className="influence-panel h-48 animate-pulse rounded-xl" />
          </div>
          <p className="influence-copy-muted text-center text-sm">
            Loading player profile…
          </p>
        </div>
      </main>
    </div>
  );
}
