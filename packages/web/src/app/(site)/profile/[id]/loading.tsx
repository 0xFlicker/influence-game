import { Nav } from "@/components/nav";

export default function PublicPlayerProfileLoading() {
  return (
    <div className="flex min-h-dvh min-w-0 flex-col overflow-x-hidden">
      <Nav />
      <main
        className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
        aria-busy="true"
        aria-label="Loading player profile"
      >
        <div className="space-y-6">
          <div className="influence-panel h-[25rem] rounded-xl motion-safe:animate-pulse lg:h-[22rem]" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="influence-panel h-48 rounded-xl motion-safe:animate-pulse" />
            <div className="influence-panel h-48 rounded-xl motion-safe:animate-pulse" />
          </div>
          <p className="influence-copy-muted text-center text-sm">
            Loading player profile…
          </p>
        </div>
      </main>
    </div>
  );
}
