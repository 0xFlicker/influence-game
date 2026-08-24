import { notFound } from "next/navigation";
import { AdminPageShell } from "../admin-page-shell";
import { adminTabLabel, isAdminTab } from "../admin-sections";

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return {
    title: isAdminTab(tab) ? `${adminTabLabel(tab)} — Influence Admin` : "Influence Admin",
  };
}

export default async function AdminTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!isAdminTab(tab) || tab === "games") notFound();
  return <AdminPageShell activeTab={tab} />;
}
