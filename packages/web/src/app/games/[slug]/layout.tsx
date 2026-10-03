import type { Metadata } from "next";
import { getServerGameEntry } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const game = await getServerGameEntry((await params).slug);
    return { robots: { index: game.visibility === "public", follow: true } };
  } catch {
    return { robots: { index: false, follow: false } };
  }
}
export default function GameLayout({ children }: { children: React.ReactNode }) { return children; }
