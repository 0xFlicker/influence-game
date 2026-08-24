import { AdminPageShell } from "./admin-page-shell";

export const metadata = {
  title: "Admin — Influence",
};

export default function AdminPage() {
  return <AdminPageShell activeTab="games" />;
}
