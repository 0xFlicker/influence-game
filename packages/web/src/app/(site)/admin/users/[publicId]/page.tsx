import { UserAccountPanel } from "@/app/admin/user-account-panel";

export const metadata = { title: "User account — The House Admin" };

export default async function AdminUserPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <UserAccountPanel key={publicId} publicId={publicId} />;
}
