"use client";

import { useState } from "react";
import { AdminPanel } from "./admin-panel";
import { UserRolesPanel } from "./user-roles-panel";
import { PermissionGate } from "@/components/admin-gate";

type Tab = "games" | "users";

export function AdminTabs() {
  const [activeTab, setActiveTab] = useState<Tab>("games");

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
        <PermissionGate permission="manage_roles">
          <TabButton
            active={activeTab === "users"}
            onClick={() => setActiveTab("users")}
          >
            Users & Roles
          </TabButton>
        </PermissionGate>
      </div>

      {/* Tab content */}
      {activeTab === "games" && <AdminPanel />}
      {activeTab === "users" && <UserRolesPanel />}
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
