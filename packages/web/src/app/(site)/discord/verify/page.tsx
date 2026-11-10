import type { Metadata } from "next";
import { DiscordVerification } from "@/components/discord-verification";

export const metadata: Metadata = { title: "Connect Discord — The House", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function DiscordVerificationPage() { return <DiscordVerification />; }
