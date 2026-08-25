"use client";

import Link from "next/link";
import { AdminPanel } from "./admin-panel";
import { UserRolesPanel } from "./user-roles-panel";
import { AgentsAdminPanel } from "./agents-admin-panel";
import { InviteCodesPanel } from "./invite-codes-panel";
import { ImportGamePanel } from "./import-game-panel";
import { PermissionGate } from "@/components/admin-gate";
import { SeasonAdminPanel } from "./season-admin-panel";
import { FreeQueuePanel } from "./free-queue-panel";
import { AdminOwnerLearningReviews } from "./admin-owner-learning-reviews";
import { AdminProviderHealth } from "./admin-provider-health-view";
import { ADMIN_TABS, adminTabHref, type AdminTab } from "./admin-sections";

export function AdminTabs({ activeTab }: { activeTab: AdminTab }) {
  return (
    <div>
      {/* Tab bar */}
      <div
        className="mb-8 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.025] p-1 sm:grid-cols-4 xl:grid-cols-9"
        aria-label="Admin sections"
      >
        {ADMIN_TABS.map((tab) => {
          const link = (
            <TabLink key={tab.id} tab={tab.id} active={activeTab === tab.id}>
              {tab.label}
            </TabLink>
          );
          return "permission" in tab ? (
            <PermissionGate key={tab.id} permission={tab.permission}>{link}</PermissionGate>
          ) : link;
        })}
      </div>

      {/* Tab content */}
      {activeTab === "games" && <AdminPanel />}
      {activeTab === "providers" && <AdminProviderHealth />}
      {activeTab === "reviews" && <AdminOwnerLearningReviews />}
      {activeTab === "seasons" && <SeasonAdminPanel />}
      {activeTab === "free-queue" && <FreeQueuePanel />}
      {activeTab === "agents" && <AgentsAdminPanel />}
      {activeTab === "users" && <UserRolesPanel />}
      {activeTab === "invites" && <InviteCodesPanel />}
      {activeTab === "import" && <ImportGamePanel />}
    </div>
  );
}

function TabLink({
  tab,
  active,
  children,
}: {
  tab: AdminTab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={adminTabHref(tab)}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"
      }`}
    >
      {children}
    </Link>
  );
}
