import { Nav } from "@/components/nav";
import { AdminGate } from "@/components/admin-gate";
import { AdminTabs } from "./admin-tabs";
import type { AdminTab } from "./admin-sections";

export function AdminPageShell({ activeTab }: { activeTab: AdminTab }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <AdminGate>
          <AdminTabs activeTab={activeTab} />
        </AdminGate>
      </main>
    </div>
  );
}
