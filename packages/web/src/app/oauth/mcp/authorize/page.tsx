import { Suspense } from "react";
import { McpOAuthAuthorizeClient } from "./authorize-client";

export default function McpOAuthAuthorizePage() {
  return (
    <Suspense fallback={<AuthorizeShell status="Loading..." />}>
      <McpOAuthAuthorizeClient />
    </Suspense>
  );
}

function AuthorizeShell({ status }: { status: string }) {
  return (
    <main className="min-h-screen bg-[rgb(var(--void))] px-4 py-10 text-[rgb(var(--text-primary))]">
      <section className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="influence-panel w-full rounded-lg p-6 text-center">
          <p className="influence-copy-muted text-sm">{status}</p>
        </div>
      </section>
    </main>
  );
}
