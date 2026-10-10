import { AdminTabs } from "./admin-tabs";
import type { AdminTab } from "./admin-sections";
export function AdminPageShell({ activeTab }: { activeTab: AdminTab }) {
  return <AdminTabs activeTab={activeTab} />;
}
