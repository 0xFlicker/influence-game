import { Nav } from "@/components/nav";
import { AdminGate } from "@/components/admin-gate";
import { AdminTabs } from "./admin-tabs";

export const metadata = {
  title: "Admin — Influence",
};

export default function AdminPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <AdminGate>
          <AdminTabs />
        </AdminGate>
      </main>
    </div>
  );
}
