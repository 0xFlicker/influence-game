"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { AdminPanel } from "./admin-panel";
import { UserRolesPanel } from "./user-roles-panel";
import { AgentsAdminPanel } from "./agents-admin-panel";
import { InviteCodesPanel } from "./invite-codes-panel";
import { ImportGamePanel } from "./import-game-panel";
import { PermissionGate } from "@/components/admin-gate";
import { SeasonAdminPanel } from "./season-admin-panel";
import { FreeQueuePanel } from "./free-queue-panel";
import { AdminOwnerLearningReviews } from "./admin-owner-learning-reviews";

type Tab = "games" | "reviews" | "seasons" | "free-queue" | "agents" | "users" | "invites" | "import";

const VALID_TABS: Tab[] = ["games", "reviews", "seasons", "free-queue", "agents", "users", "invites", "import"];

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
      <div
        className="mb-8 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.025] p-1 sm:grid-cols-4 xl:grid-cols-8"
        aria-label="Admin sections"
      >
        <TabButton
          active={activeTab === "seasons"}
          onClick={() => setActiveTab("seasons")}
        >
          Seasons
        </TabButton>
        <TabButton
          active={activeTab === "games"}
          onClick={() => setActiveTab("games")}
        >
          Games
        </TabButton>
        <TabButton
          active={activeTab === "reviews"}
          onClick={() => setActiveTab("reviews")}
        >
          Reviews
        </TabButton>
        <TabButton
          active={activeTab === "free-queue"}
          onClick={() => setActiveTab("free-queue")}
        >
          Free Queue
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
        <TabButton
          active={activeTab === "import"}
          onClick={() => setActiveTab("import")}
        >
          Import Game
        </TabButton>
      </div>

      {/* Tab content */}
      {activeTab === "games" && <AdminPanel />}
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}
