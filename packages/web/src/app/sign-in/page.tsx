import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { AuthenticationRoute } from "@/components/authentication-route";

export const metadata: Metadata = {
  title: "Sign in — Influence",
};

export default function SignInPage() {
  return (
    <div className="influence-page flex min-h-screen flex-col">
      <Nav />
      <AuthenticationRoute intent="sign_in" />
    </div>
  );
}
