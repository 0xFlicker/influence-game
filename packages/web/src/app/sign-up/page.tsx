import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { AuthenticationRoute } from "@/components/authentication-route";

export const metadata: Metadata = {
  title: "Create account — Influence",
};

export default function SignUpPage() {
  return (
    <div className="influence-page flex min-h-screen flex-col">
      <Nav />
      <AuthenticationRoute intent="create_account" />
    </div>
  );
}
