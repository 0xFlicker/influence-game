"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { AdminPanel } from "./admin-panel";
import { UserRolesPanel } from "./user-roles-panel";
import { AgentsAdminPanel } from "./agents-admin-panel";
import { InviteCodesPanel } from "./invite-codes-panel";
import { PermissionGate } from "@/components/admin-gate";

type Tab = "games" | "agents" | "users" | "invites";

const VALID_TABS: Tab[] = ["games", "agents", "users", "invites"];

export function AdminTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = searchParams.get("tab");
  const activeTab: Tab = VALID_TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "games";

  const setActiveTab = useCallback(
    (tab: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "games") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-8 border-b border-white/10">
        <TabButton
          active={activeTab === "games"}
          onClick={() => setActiveTab("games")}
        >
          Games
        </TabButton>
        <TabButton
          active={activeTab === "agents"}
          onClick={() => setActiveTab("agents")}
        >
          Agents
        </TabButton>
        <PermissionGate permission="manage_roles">
          <TabButton
            active={activeTab === "users"}
            onClick={() => setActiveTab("users")}
          >
            Users & Roles
          </TabButton>
        </PermissionGate>
        <TabButton
          active={activeTab === "invites"}
          onClick={() => setActiveTab("invites")}
        >
          Invites
        </TabButton>
      </div>

      {/* Tab content */}
      {activeTab === "games" && <AdminPanel />}
      {activeTab === "agents" && <AgentsAdminPanel />}
      {activeTab === "users" && <UserRolesPanel />}
      {activeTab === "invites" && <InviteCodesPanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "border-indigo-500 text-white"
          : "border-transparent text-white/40 hover:text-white/70"
      }`}
    >
      {children}
    </button>
  );
}
