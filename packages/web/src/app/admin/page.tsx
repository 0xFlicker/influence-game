"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { adminLanding } from "./admin-sections";
export default function Page() {
  const user = usePermissions(), router = useRouter();
  const href = adminLanding(user);
  useEffect(() => { if (!user.loading && href) router.replace(href); }, [user.loading, href, router]);
  return <p role="status">{href ? "Opening administration…" : "No administration access."}</p>;
}
