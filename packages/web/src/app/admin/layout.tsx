import { Suspense } from "react";
import { AdminShell } from "./admin-shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen bg-[#08090b]" />}><AdminShell>{children}</AdminShell></Suspense>;
}
