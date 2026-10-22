import { notFound } from "next/navigation";
import { AdminPageShell } from "@/app/admin/admin-page-shell";
import { adminTabLabel, isAdminTab } from "@/app/admin/admin-sections";

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return {
    title: isAdminTab(tab) ? `${adminTabLabel(tab)} — Influence Admin` : "Influence Admin",
  };
}

export default async function AdminTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!isAdminTab(tab) || tab === "games" || tab === "production") notFound();
  return <AdminPageShell activeTab={tab} />;
}
