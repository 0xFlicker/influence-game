import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { ProfileContent } from "./profile-content";

export const metadata = {
  title: "Profile — Influence",
};

export default function ProfilePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 px-6 py-10 max-w-2xl mx-auto w-full">
        <AuthGate>
          <ProfileContent />
        </AuthGate>
      </main>
    </div>
  );
}
