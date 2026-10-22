import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { ModerationInbox } from "@/app/moderation/moderation-inbox";
export const metadata = { title: "Moderation — Influence" };
export default function ModerationPage() { return <div className="influence-page min-h-screen"><Nav /><AuthGate><ModerationInbox /></AuthGate></div>; }
