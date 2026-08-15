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
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <AdminGate>
          <AdminTabs />
        </AdminGate>
      </main>
    </div>
  );
}
