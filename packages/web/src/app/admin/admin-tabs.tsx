"use client";

import { AccountInferencePanel } from "./account-inference-panel";
import { ProductionPanel } from "./production-panel";
import { AdminPanel } from "./admin-panel";
import { UserRolesPanel } from "./user-roles-panel";
import { AgentsAdminPanel } from "./agents-admin-panel";
import { InviteCodesPanel } from "./invite-codes-panel";
import { ImportGamePanel } from "./import-game-panel";
import { SeasonAdminPanel } from "./season-admin-panel";
import { FreeQueuePanel } from "./free-queue-panel";
import { AdminOwnerLearningReviews } from "./admin-owner-learning-reviews";
import { AdminProviderHealth } from "./admin-provider-health-view";
import { type AdminTab } from "./admin-sections";

export function AdminTabs({ activeTab }: { activeTab: AdminTab }) {
  return (
    <div>
      {/* Tab content */}
      {activeTab === "inference" && <AccountInferencePanel />}
      {activeTab === "games" && <AdminPanel />}
      {activeTab === "production" && <ProductionPanel />}
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
